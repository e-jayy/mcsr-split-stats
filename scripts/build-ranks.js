// Builds data/ranks-s<season>.json: an Elo histogram of ranked players, found by
// sampling match pages spread evenly across the season. The /matches list
// includes each player's current Elo, so no per-match requests are needed.
//
//   node scripts/build-ranks.js [season] [--pages 600]
//
// Throttled to stay under the API limit (500 requests / 10 minutes):
// 600 pages take about 15 minutes.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { listMatches, seasonRange } from './lib/sample.js';

const STEP = 10;              // histogram bucket width in Elo
const args = process.argv.slice(2);
const PAGES = args.includes('--pages') ? Number(args[args.indexOf('--pages') + 1]) : 600;
const seasonArg = args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--pages');

// Season (default: the current one) and its first / last match ids.
const season = seasonArg ? Number(seasonArg) : (await listMatches(null, null, 1))[0].season;
const { first: lo, last } = await seasonRange(season);
console.log(`Season ${season}: match ids ${lo}–${last}, sampling ${PAGES} pages`);

// Visit pages in van der Corput order (0, 1/2, 1/4, 3/4, ...) so that a run
// stopped early still covers the whole season evenly.
const vdc = n => { let x = 0, b = 0.5; for (; n; n >>= 1, b /= 2) if (n & 1) x += b; return x; };
const order = Array.from({ length: PAGES }, (_, p) => p).sort((a, b) => vdc(a) - vdc(b));

const players = new Map();    // uuid -> { elo, rank }
let matches = 0;
let done = 0;

// Pages in the currently published file: progress saves only replace it once this run has
// covered more pages, so a refresh that's cut short keeps the previous full sample.
let existingPages = 0;
try { existingPages = JSON.parse(await readFile(new URL(`../data/ranks-s${season}.json`, import.meta.url), 'utf8')).pages; } catch {}

// Written every 50 pages (once past the published file) and at the end.
async function save() {
  const counts = [];
  let highestRank = 0;
  for (const { elo, rank } of players.values()) {
    const i = Math.max(0, Math.floor(elo / STEP));
    counts[i] = (counts[i] || 0) + 1;
    if (rank > highestRank) highestRank = rank;
  }
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(new URL(`../data/ranks-s${season}.json`, import.meta.url), JSON.stringify({
    generatedAt: new Date().toISOString(),
    season,
    pages: done,
    matches,
    players: players.size,
    // Largest leaderboard position seen: a rough count of all ranked players.
    highestRank,
    step: STEP,
    counts: Array.from(counts, c => c || 0),
  }));
  return highestRank;
}

for (const p of order) {
  const before = Math.round(lo + ((last - lo) * (p + 1)) / PAGES) + 1;
  try {
    for (const m of await listMatches(season, before, 100)) {
      matches++;
      for (const u of m.players) {
        if (u.eloRate != null) players.set(u.uuid, { elo: u.eloRate, rank: u.eloRank });
      }
    }
  } catch (e) {
    console.warn(`  skip page ${p}: ${e.message}`);
  }
  if (++done % 50 === 0 && done > existingPages) {
    await save();
    console.log(`  ${done}/${PAGES} pages, ${players.size} ranked players (saved)`);
  }
}

const highestRank = await save();
console.log(`Wrote data/ranks-s${season}.json: ${players.size} players from ${matches} matches (highest rank seen #${highestRank})`);
