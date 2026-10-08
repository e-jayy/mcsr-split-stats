// MCSR Ranked API client with a localStorage cache for match details.
// Docs: https://docs.mcsrranked.com/  (limit: 500 requests / 10 minutes)

import { trimMatch } from './splits.js';

const BASE = 'https://api.mcsrranked.com';
const CACHE_KEY = 'mcsr-splits:matches:v1';
const CONCURRENCY = 5;

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class ApiError extends Error {}

async function getJSON(path, onWait) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(BASE + path);
    if (res.status === 429) {
      const wait = (Number(res.headers.get('Retry-After')) || 30) * 1000;
      onWait?.(wait);
      await sleep(wait);
      continue;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.status !== 'success') {
      throw new ApiError(typeof body?.data === 'string' ? body.data : `Request failed (${res.status})`);
    }
    return body.data;
  }
  throw new ApiError('Rate limited by the MCSR Ranked API. Try again in a few minutes.');
}

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}

function saveCache(cache) {
  let ids = Object.keys(cache);
  // Drop the oldest matches until it fits in storage.
  while (ids.length) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); return; } catch {
      ids.sort((a, b) => cache[a].date - cache[b].date);
      for (const id of ids.splice(0, Math.ceil(ids.length / 4))) delete cache[id];
    }
  }
}

export function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}

export async function getUser(name) {
  try {
    return await getJSON(`/users/${encodeURIComponent(name.trim())}`);
  } catch (e) {
    throw new ApiError(`Couldn't find a player called "${name}".`);
  }
}

// Elo leaderboard (the API returns the top 150) for a season. Fetched once per page load.
let leaderboard = null;
export function getLeaderboard(season) {
  leaderboard ??= getJSON(`/leaderboard?season=${season}`)
    .then(d => d.users)
    .catch(e => { leaderboard = null; throw e; });
  return leaderboard;
}

// List match ids (newest first), paging with `before`.
async function listMatches(uuid, { count, type, season }, onWait) {
  const out = [];
  let before = null;
  while (out.length < count) {
    const q = new URLSearchParams({ count: String(Math.min(100, count - out.length + 10)) });
    if (type) q.set('type', type);
    if (season) q.set('season', season);
    if (before) q.set('before', before);
    const page = await getJSON(`/users/${uuid}/matches?${q}`, onWait);
    if (!page.length) break;
    for (const m of page) if (!m.decayed && out.length < count) out.push(m.id);
    before = page[page.length - 1].id;
    if (page.length < Number(q.get('count'))) break;
  }
  return out;
}

// Fetch trimmed match details for a player's recent matches.
export async function loadMatches(uuid, opts, onProgress) {
  const onWait = ms => onProgress({ waiting: ms });
  const ids = await listMatches(uuid, opts, onWait);
  const cache = loadCache();
  const missing = ids.filter(id => !cache[id]);
  let done = ids.length - missing.length;
  onProgress({ done, total: ids.length });

  let next = 0;
  async function worker() {
    while (next < missing.length) {
      const id = missing[next++];
      try {
        cache[id] = trimMatch(await getJSON(`/matches/${id}`, onWait));
      } catch (e) {
        console.warn('Skipping match', id, e);
      }
      onProgress({ done: ++done, total: ids.length });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  saveCache(cache);
  return ids.map(id => cache[id]).filter(Boolean);
}
