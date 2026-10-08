// Grows data/baseline.json: split times from ranked matches sampled at random
// points across the season. The app ranks a player's splits against this sample.
//
//   node scripts/build-baseline.js [--season 12] [--target 5000]
//
// Each run adds matches to the existing sample (skipping ones it already has),
// saving every 100 matches, until the sample reaches --target matches. Stop it any
// time (Ctrl+C) and run it again later to carry on. Throttled to stay under the API
// limit (500 requests / 10 minutes): roughly 2,500 matches per hour.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { trimMatch, runsForPlayer, SPLITS } from '../src/splits.js';

const BASE = 'https://api.mcsrranked.com';
const GAP_MS = 1300;
const PER_POINT = 40;         // consecutive matches taken at each random point in the season
const SAVE_EVERY = 100;
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : def);
const SEASON = opt('--season', 12);
const TARGET = opt('--target', 5000);
const file = new URL('../data/baseline.json', import.meta.url);

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

const list = (before, count) =>
  get(`/matches?type=2&season=${SEASON}&count=${count}${before ? `&before=${before}` : ''}`);

// Existing sample. Older files have no match ids (they can't be extended without
// risking duplicates), so they're kept on disk until the new sample is larger.
let old = null;
try { old = JSON.parse(await readFile(file, 'utf8')); } catch {}
const resume = old?.season === SEASON && Array.isArray(old.ids);
const ids = new Set(resume ? old.ids : []);
const runs = resume ? old.runs : [];
const keepUntil = !resume && old ? old.matches : 0;
console.log(resume
  ? `Resuming: ${ids.size} matches already sampled`
  : `Starting a new season ${SEASON} sample${keepUntil ? ` (current file kept until it passes ${keepUntil} matches)` : ''}`);

async function save() {
  if (ids.size <= keepUntil) return false;
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(file, JSON.stringify({
    generatedAt: new Date().toISOString(),
    season: SEASON,
    matches: ids.size,
    splits: SPLITS.map(s => s.key),
    ids: [...ids],
    runs,
  }));
  return true;
}

// Season id range: newest match, and the oldest via binary search on `before`.
const [latest] = await list(null, 1);
let lo = 1, hi = latest.id + 1;
while (hi - lo > 2000) {
  const mid = Math.floor((lo + hi) / 2);
  (await list(mid, 1)).length ? (hi = mid) : (lo = mid);
}
console.log(`Season ${SEASON}: match ids ${lo}–${latest.id}, target ${TARGET} matches`);

let added = 0;
while (ids.size < TARGET) {
  const before = lo + Math.floor(Math.random() * (latest.id - lo)) + 1;
  let page;
  try {
    page = await list(before, PER_POINT);
  } catch (e) {
    console.warn(`  skip point ${before}: ${e.message}`);
    continue;
  }
  for (const m of page) {
    if (ids.size >= TARGET) break;
    if (m.decayed || ids.has(m.id)) continue;
    try {
      const raw = await get(`/matches/${m.id}`);
      const match = trimMatch(raw);
      for (const p of raw.players) {
        for (const r of runsForPlayer(match, p.uuid)) {
          runs.push({ ow: r.ow, bt: r.bt, s: SPLITS.map(sp => r.splits[sp.key] ?? null), f: r.finish });
        }
      }
      ids.add(m.id);
      if (++added % SAVE_EVERY === 0) {
        const saved = await save();
        console.log(`  ${ids.size}/${TARGET} matches, ${runs.length} runs${saved ? ' (saved)' : ''}`);
      }
    } catch (e) {
      console.warn(`  skip ${m.id}: ${e.message}`);
    }
  }
}

const saved = await save();
console.log(saved
  ? `Wrote data/baseline.json: ${runs.length} runs from ${ids.size} matches`
  : `Sample (${ids.size}) is still smaller than the current file; nothing written`);
