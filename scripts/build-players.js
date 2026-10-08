// Builds data/players-s<season>.json: split averages for the Elo top 150, overall and
// per overworld / bastion type, for the site's "Top players" section.
//
//   node scripts/build-players.js [--season 12] [--matches 50]
//
// Downloaded matches are cached in scripts/.cache/ (git-ignored), so the script can be
// stopped and re-run to carry on, and refreshes only fetch new matches. Results are
// written every 10 players. Throttled to stay under the API limit (500 requests / 10 min).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { trimMatch, runsForPlayer, summarize, SPLITS } from '../src/splits.js';
import { get } from './lib/http.js';

const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : def);
const SEASON = opt('--season', 12);
const PER_PLAYER = opt('--matches', 50);
const cacheDir = new URL('./.cache/', import.meta.url);
const cacheFile = new URL(`matches-s${SEASON}.json`, cacheDir);
const outFile = new URL(`../data/players-s${SEASON}.json`, import.meta.url);

let cache = {};
try { cache = JSON.parse(await readFile(cacheFile, 'utf8')); } catch {}
let unsaved = 0;
async function saveCache() {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(cache));
  unsaved = 0;
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

function playerEntry(u, ids) {
  const runs = ids.map(id => cache[id]).filter(Boolean).flatMap(m => runsForPlayer(m, u.uuid));
  const scopes = { all: scopeStats(runs) };
  for (const key of ['ow', 'bt']) {
    for (const type of new Set(runs.map(r => r[key]).filter(Boolean))) {
      scopes[`${key}:${type}`] = scopeStats(runs.filter(r => r[key] === type));
    }
  }
  return {
    uuid: u.uuid, nickname: u.nickname, elo: u.eloRate, rank: u.eloRank, country: u.country ?? null,
    matches: runs.filter(r => r.attempt === 0).length, scopes,
  };
}

const users = (await get(`/leaderboard?season=${SEASON}`)).users;
console.log(`Season ${SEASON}: ${users.length} leaderboard players, ${PER_PLAYER} matches each, ${Object.keys(cache).length} matches cached`);

const players = [];
// Progress saves only replace the published file once they cover more players than it,
// so a refresh that's cut short never leaves the site with a smaller list.
let existingCount = 0;
try { existingCount = JSON.parse(await readFile(outFile, 'utf8')).players.length; } catch {}
async function writeOut(final) {
  if (!final && players.length <= existingCount) return;
  await writeFile(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    season: SEASON,
    perPlayer: PER_PLAYER,
    complete: final,
    splits: SPLITS.map(s => s.key),
    players,
  }));
}

for (const [i, u] of users.entries()) {
  try {
    const list = await get(`/users/${u.uuid}/matches?type=2&season=${SEASON}&count=${PER_PLAYER}`);
    const ids = list.filter(m => !m.decayed).map(m => m.id);
    for (const id of ids) {
      if (cache[id]) continue;
      try {
        cache[id] = trimMatch(await get(`/matches/${id}`));
        if (++unsaved >= 100) await saveCache();
      } catch (e) {
        console.warn(`  skip match ${id}: ${e.message}`);
      }
    }
    players.push(playerEntry(u, ids));
  } catch (e) {
    console.warn(`  skip ${u.nickname}: ${e.message}`);
  }
  if ((i + 1) % 10 === 0) {
    await saveCache();
    await writeOut(false);
    console.log(`  ${i + 1}/${users.length} players, ${Object.keys(cache).length} matches cached (saved)`);
  }
}

await saveCache();
await writeOut(true);
console.log(`Wrote data/players-s${SEASON}.json: ${players.length} players`);
