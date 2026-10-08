// Builds data/ranks-s<season>.json: an Elo histogram of ranked players, found by
// sampling match pages spread evenly across the season. The /matches list
// includes each player's current Elo, so no per-match requests are needed.
//
//   node scripts/build-ranks.js [season] [--pages 600]
//
// Throttled to stay under the API limit (500 requests / 10 minutes):
// 600 pages take about 15 minutes.

import { writeFile, mkdir } from 'node:fs/promises';

const BASE = 'https://api.mcsrranked.com';
const GAP_MS = 1300;
const STEP = 10;              // histogram bucket width in Elo
const args = process.argv.slice(2);
const PAGES = args.includes('--pages') ? Number(args[args.indexOf('--pages') + 1]) : 600;
const seasonArg = args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--pages');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(BASE + path);
    } catch (e) {
      if (attempt > 5) throw e;
      await sleep(10000);
      continue;
    }
    if (res.status === 429) {
      const wait = (Number(res.headers.get('Retry-After')) || 60) * 1000;
      console.log(`  rate limited, waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    const body = await res.json().catch(() => null);
    await sleep(GAP_MS);
    if (body?.status !== 'success') throw new Error(`${path}: ${JSON.stringify(body?.data)}`);
    return body.data;
  }
}

const list = (season, before, count) =>
  get(`/matches?type=2&count=${count}${season ? `&season=${season}` : ''}${before ? `&before=${before}` : ''}`);

const [latest] = await list(seasonArg, null, 1);
const season = seasonArg ? Number(seasonArg) : latest.season;

// Smallest match id in the season (binary search on `before`).
let lo = 1, hi = latest.id + 1;
while (hi - lo > 2000) {
  const mid = Math.floor((lo + hi) / 2);
  (await list(season, mid, 1)).length ? (hi = mid) : (lo = mid);
}
console.log(`Season ${season}: match ids ${lo}–${latest.id}, sampling ${PAGES} pages`);

const players = new Map();    // uuid -> { elo, rank }
let matches = 0;
for (let p = 0; p < PAGES; p++) {
  const before = Math.round(lo + ((latest.id - lo) * (p + 1)) / PAGES) + 1;
  try {
    for (const m of await list(season, before, 100)) {
      matches++;
      for (const u of m.players) {
        if (u.eloRate != null) players.set(u.uuid, { elo: u.eloRate, rank: u.eloRank });
      }
    }
  } catch (e) {
    console.warn(`  skip page ${p}: ${e.message}`);
  }
  if ((p + 1) % 50 === 0) console.log(`  ${p + 1}/${PAGES} pages, ${players.size} ranked players`);
}

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
  pages: PAGES,
  matches,
  players: players.size,
  // Largest leaderboard position seen: a rough count of all ranked players.
  highestRank,
  step: STEP,
  counts: Array.from(counts, c => c || 0),
}));
console.log(`Wrote data/ranks-s${season}.json: ${players.size} players from ${matches} matches (highest rank seen #${highestRank})`);
