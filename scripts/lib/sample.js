// Helpers shared by the data scripts.

import { summarize, SPLITS } from '../../src/splits.js';
import { seedKey } from '../../src/rank.js';
import { get } from './http.js';

// One page of a season's ranked matches, newest first (optionally before a match id).
export const listMatches = (season, before, count) =>
  get(`/matches?type=2&count=${count}${season ? `&season=${season}` : ''}${before ? `&before=${before}` : ''}`);

// First and last match id of a season: the newest match, then a binary search on `before`
// for the oldest (to within 2,000 ids). `latest` is the newest match object.
export async function seasonRange(season) {
  const [latest] = await listMatches(season, null, 1);
  let lo = 1, hi = latest.id + 1;
  while (hi - lo > 2000) {
    const mid = Math.floor((lo + hi) / 2);
    (await listMatches(season, mid, 1)).length ? (hi = mid) : (lo = mid);
  }
  return { first: lo, last: latest.id, latest };
}

// Mean (ms, rounded) and run count per split, plus finish, for one set of runs.
export function scopeStats(runs) {
  const s = summarize(runs);
  return {
    m: SPLITS.map(sp => (s.splits[sp.key].mean == null ? null : Math.round(s.splits[sp.key].mean))),
    n: SPLITS.map(sp => s.splits[sp.key].n),
    f: s.finish.mean == null ? null : Math.round(s.finish.mean),
    fn: s.finish.n,
  };
}

// A player's averages overall ('all'), per seed type ('ow:VILLAGE', 'bt:BRIDGE', ...) and,
// with `pairs`, per overworld + bastion pair ('ow:VILLAGE|bt:BRIDGE'). Keys come from seedKey().
export function playerScopes(runs, { pairs = false } = {}) {
  const scopes = { all: scopeStats(runs) };
  for (const key of ['ow', 'bt']) {
    for (const type of new Set(runs.map(r => r[key]).filter(Boolean))) {
      scopes[seedKey({ [key]: type })] = scopeStats(runs.filter(r => r[key] === type));
    }
  }
  if (pairs) {
    for (const pair of new Set(runs.filter(r => r.ow && r.bt).map(r => `${r.ow} ${r.bt}`))) {
      const [ow, bt] = pair.split(' ');
      scopes[seedKey({ ow, bt })] = scopeStats(runs.filter(r => r.ow === ow && r.bt === bt));
    }
  }
  return scopes;
}
