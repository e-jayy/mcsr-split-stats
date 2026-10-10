// Builds data/players-s<season>.json: split averages for the Elo top N players (default 300),
// overall, per overworld / bastion type and per overworld + bastion pair, for the site's
// "Top players" section. The site shows whoever is in the live top 150, so collecting a
// wider pool means players who climb into the top 150 are usually covered already.
//
//   node scripts/build-players.js [--season 12] [--players 300] [--matches 100]
//
// The API's leaderboard only lists the top 150; ranks below that come from the player
// index (data/player-index-s<season>.json, written by build-ranks.js).
//
// Downloaded matches are cached in scripts/.cache/ (git-ignored), so the script can be
// stopped and re-run to carry on, and refreshes only fetch new matches. Results are
// written every 10 players. Throttled to stay under the API limit (500 requests / 10 min).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { trimMatch, runsForPlayer, SPLITS } from '../src/splits.js';
import { get } from './lib/http.js';
import { playerScopes } from './lib/sample.js';

const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : def);
const SEASON = opt('--season', 12);
const TOP = opt('--players', 300);
const PER_PLAYER = opt('--matches', 100);
const cacheDir = new URL('./.cache/', import.meta.url);
const cacheFile = new URL(`matches-s${SEASON}.json`, cacheDir);
const outFile = new URL(`../data/players-s${SEASON}.json`, import.meta.url);
const indexFile = new URL(`../data/player-index-s${SEASON}.json`, import.meta.url);

let cache = {};
try { cache = JSON.parse(await readFile(cacheFile, 'utf8')); } catch {}
let unsaved = 0;
async function saveCache() {
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheFile, JSON.stringify(cache));
  unsaved = 0;
}

function playerEntry(u, ids) {
  const runs = ids.map(id => cache[id]).filter(Boolean).flatMap(m => runsForPlayer(m, u.uuid));
  return {
    uuid: u.uuid, nickname: u.nickname, elo: u.eloRate, rank: u.eloRank, country: u.country ?? null,
    matches: runs.filter(r => r.attempt === 0).length, scopes: playerScopes(runs, { pairs: true }),
  };
}

// A player's most recent ranked match ids this season (the API returns up to 100 per page).
async function recentMatchIds(uuid) {
  const ids = [];
  let before = null;
  while (ids.length < PER_PLAYER) {
    const count = Math.min(100, PER_PLAYER - ids.length);
    const page = await get(`/users/${uuid}/matches?type=2&season=${SEASON}&count=${count}${before ? `&before=${before}` : ''}`);
    for (const m of page) if (!m.decayed) ids.push(m.id);
    if (page.length < count) break;
    before = page[page.length - 1].id;
  }
  return ids.slice(0, PER_PLAYER);
}

// The pool: the live top 150, then ranks 151..TOP from the player index (looked up live).
const leaders = (await get(`/leaderboard?season=${SEASON}`)).users;
const users = [...leaders];
if (TOP > leaders.length) {
  let index = [];
  try { index = JSON.parse(await readFile(indexFile, 'utf8')).players; } catch {
    console.warn(`No data/player-index-s${SEASON}.json; run build-ranks.js first to go beyond the top ${leaders.length}.`);
  }
  const have = new Set(leaders.map(u => u.nickname.toLowerCase()));
  const rest = index.filter(([name, , rank]) => rank && rank <= TOP && !have.has(name.toLowerCase()))
    .sort((a, b) => a[2] - b[2]);
  for (const [name] of rest) {
    if (users.length >= TOP) break;
    users.push({ nickname: name, pending: true });   // uuid and live Elo filled in when reached
  }
}
console.log(`Season ${SEASON}: ${users.length} players (top ${TOP}), ${PER_PLAYER} matches each, ${Object.keys(cache).length} matches cached`);

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
    pool: TOP,
    complete: final,
    splits: SPLITS.map(s => s.key),
    players,
  }));
}

for (const [i, entry] of users.entries()) {
  try {
    const u = entry.pending ? await get(`/users/${encodeURIComponent(entry.nickname)}`) : entry;
    const ids = await recentMatchIds(u.uuid);
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
    console.warn(`  skip ${entry.nickname}: ${e.message}`);
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
