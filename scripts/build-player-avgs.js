// Builds data/player-avgs-s<season>.json: split averages for a random sample of ranked
// players across every Elo level. The site ranks a player's averages against these
// ("Top X% of players"), instead of against single runs.
//
//   node scripts/build-player-avgs.js [--season 12] [--players 500] [--matches 20]
//
// Players are picked at random from match pages spread across the season, so the
// sample follows the real player base. Matches are cached in scripts/.cache/ and
// progress is kept there too, so the script can be stopped and re-run to carry on.
// Results are written every 10 players. Throttled to stay under the API limit.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { trimMatch, runsForPlayer, summarize, SPLITS } from '../src/splits.js';
import { get } from './lib/http.js';

const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : def);
const SEASON = opt('--season', 12);
const TARGET = opt('--players', 500);
const PER_PLAYER = opt('--matches', 20);
const CANDIDATE_PAGES = 60;
const cacheDir = new URL('./.cache/', import.meta.url);
const cacheFile = new URL(`avg-matches-s${SEASON}.json`, cacheDir);       // this script's match cache
const sharedCache = new URL(`matches-s${SEASON}.json`, cacheDir);         // build-players.js cache (read only)
const stateFile = new URL(`avg-state-s${SEASON}.json`, cacheDir);
const outFile = new URL(`../data/player-avgs-s${SEASON}.json`, import.meta.url);

const readJSON = async (url, def) => { try { return JSON.parse(await readFile(url, 'utf8')); } catch { return def; } };
await mkdir(cacheDir, { recursive: true });
const cache = await readJSON(cacheFile, {});
const shared = await readJSON(sharedCache, {});
const state = await readJSON(stateFile, { chosen: null, done: [] });
const save = async () => {
  await writeFile(cacheFile, JSON.stringify(cache));
  await writeFile(stateFile, JSON.stringify(state));
};

const list = (before, count) =>
  get(`/matches?type=2&season=${SEASON}&count=${count}${before ? `&before=${before}` : ''}`);

// 1. Pick the players (once; kept in the state file so re-runs use the same sample).
// Without the cached progress (e.g. a fresh GitHub Actions cache), an existing data file
// can't be resumed. A complete one is left alone; an incomplete one is only replaced once
// the new sample has more players than it.
const existing = await readJSON(outFile, null);
let keepUntil = 0;
if (!state.chosen && existing) {
  if (existing.complete) {
    console.log(`data/player-avgs-s${SEASON}.json is complete (${existing.players.length} players) and there's no saved progress; nothing to do.`);
    console.log('Delete that file to collect a new sample.');
    process.exit(0);
  }
  keepUntil = existing.players.length;
}

if (!state.chosen) {
  const [latest] = await list(null, 1);
  let lo = 1, hi = latest.id + 1;
  while (hi - lo > 2000) {
    const mid = Math.floor((lo + hi) / 2);
    (await list(mid, 1)).length ? (hi = mid) : (lo = mid);
  }
  const seen = new Map();
  for (let p = 0; p < CANDIDATE_PAGES; p++) {
    const before = lo + Math.floor(((latest.id - lo) * (p + 0.5)) / CANDIDATE_PAGES);
    for (const m of await list(before, 100)) {
      for (const u of m.players) if (u.eloRate != null) seen.set(u.uuid, { uuid: u.uuid, elo: u.eloRate });
    }
  }
  const pool = [...seen.values()];
  for (let i = pool.length - 1; i > 0; i--) {          // shuffle, then take the first TARGET
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  state.chosen = pool.slice(0, TARGET);
  await save();
  console.log(`Picked ${state.chosen.length} of ${pool.length} ranked players found on ${CANDIDATE_PAGES} match pages`);
}

// Means (ms, rounded) and run counts per split + finish, for one set of runs.
function scopeStats(runs) {
  const s = summarize(runs);
  return {
    m: SPLITS.map(sp => (s.splits[sp.key].mean == null ? null : Math.round(s.splits[sp.key].mean))),
    n: SPLITS.map(sp => s.splits[sp.key].n),
    f: s.finish.mean == null ? null : Math.round(s.finish.mean),
    fn: s.finish.n,
  };
}

async function writeOut(final) {
  if (state.done.length <= keepUntil) return;
  await writeFile(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    season: SEASON,
    perPlayer: PER_PLAYER,
    complete: final,
    target: state.chosen.length,
    splits: SPLITS.map(s => s.key),
    players: state.done,
  }));
}

// 2. Each player's last PER_PLAYER ranked matches -> split averages (overall and per seed type).
const doneSet = new Set(state.done.map(p => p.id));
let n = 0;
for (const [i, u] of state.chosen.entries()) {
  if (doneSet.has(i)) continue;
  try {
    const ids = (await get(`/users/${u.uuid}/matches?type=2&season=${SEASON}&count=${PER_PLAYER}`))
      .filter(m => !m.decayed).map(m => m.id);
    for (const id of ids) {
      if (cache[id] || shared[id]) continue;
      try { cache[id] = trimMatch(await get(`/matches/${id}`)); } catch (e) { console.warn(`  skip match ${id}: ${e.message}`); }
    }
    const runs = ids.map(id => cache[id] || shared[id]).filter(Boolean).flatMap(m => runsForPlayer(m, u.uuid));
    const scopes = { all: scopeStats(runs) };
    for (const key of ['ow', 'bt']) {
      for (const type of new Set(runs.map(r => r[key]).filter(Boolean))) {
        scopes[`${key}:${type}`] = scopeStats(runs.filter(r => r[key] === type));
      }
    }
    // Only Elo and averages are kept (no names), indexed by position in the sample.
    state.done.push({ id: i, elo: u.elo, matches: runs.filter(r => r.attempt === 0).length, scopes });
  } catch (e) {
    console.warn(`  skip player ${i}: ${e.message}`);
  }
  if (++n % 10 === 0) {
    await save();
    await writeOut(false);
    console.log(`  ${state.done.length}/${state.chosen.length} players (saved)`);
  }
}

await save();
await writeOut(true);
console.log(`Wrote data/player-avgs-s${SEASON}.json: ${state.done.length} players`);
