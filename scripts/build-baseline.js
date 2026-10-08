// Builds data/baseline.json: split times from a sample of recent ranked matches
// across all players. The app ranks a player's splits against this sample.
//
//   node scripts/build-baseline.js [matchCount=350]
//
// Throttled to stay under the API limit (500 requests / 10 minutes).

import { writeFile, mkdir } from 'node:fs/promises';
import { trimMatch, runsForPlayer, SPLITS } from '../src/splits.js';

const BASE = 'https://api.mcsrranked.com';
const COUNT = Number(process.argv[2]) || 350;
const GAP_MS = 1300;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path) {
  for (;;) {
    const res = await fetch(BASE + path);
    if (res.status === 429) { console.log('rate limited, waiting 60s'); await sleep(60000); continue; }
    const body = await res.json();
    if (body.status !== 'success') throw new Error(`${path}: ${JSON.stringify(body.data)}`);
    await sleep(GAP_MS);
    return body.data;
  }
}

const ids = [];
let before = null;
while (ids.length < COUNT) {
  const page = await get(`/matches?type=2&count=100${before ? `&before=${before}` : ''}`);
  if (!page.length) break;
  for (const m of page) if (!m.decayed && ids.length < COUNT) ids.push(m.id);
  before = page[page.length - 1].id;
}

const runs = [];
let season = null;
for (const [i, id] of ids.entries()) {
  try {
    const raw = await get(`/matches/${id}`);
    season ??= raw.season;
    const match = trimMatch(raw);
    for (const p of raw.players) {
      for (const r of runsForPlayer(match, p.uuid)) {
        runs.push({
          ow: r.ow,
          bt: r.bt,
          elo: p.eloRate ?? null,
          s: SPLITS.map(sp => r.splits[sp.key] ?? null),
          f: r.finish,
        });
      }
    }
  } catch (e) {
    console.warn(`skip ${id}: ${e.message}`);
  }
  if ((i + 1) % 25 === 0) console.log(`${i + 1}/${ids.length} matches, ${runs.length} runs`);
}

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/baseline.json', import.meta.url), JSON.stringify({
  generatedAt: new Date().toISOString(),
  season,
  matches: ids.length,
  splits: SPLITS.map(s => s.key),
  runs,
}));
console.log(`Wrote data/baseline.json: ${runs.length} runs from ${ids.length} matches`);
