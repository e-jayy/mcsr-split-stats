// Percentile ranking of a player's splits against the baseline sample,
// mapped to Minecraft material tiers.

import { RANK_ICONS } from './rank-icons.js';

// Text colours are the ones MCSR Ranked uses for each rank name in game.
export const TIERS = [
  { key: 'netherite', name: 'Netherite', max: 5,   color: '#9729be' },
  { key: 'diamond',   name: 'Diamond',   max: 20,  color: '#55ffff' },
  { key: 'emerald',   name: 'Emerald',   max: 40,  color: '#55ff55' },
  { key: 'gold',      name: 'Gold',      max: 60,  color: '#ffaa00' },
  { key: 'iron',      name: 'Iron',      max: 80,  color: '#ffffff' },
  { key: 'coal',      name: 'Coal',      max: 100, color: '#aaaaaa' },
];

export const tierFor = pct => TIERS.find(t => pct <= t.max) ?? TIERS[TIERS.length - 1];

// Percent of baseline values faster than `value` (ties count half). Lower = better.
export function percentile(value, population) {
  if (value == null || !population.length) return null;
  let faster = 0, ties = 0;
  for (const v of population) {
    if (v < value) faster++;
    else if (v === value) ties++;
  }
  return ((faster + ties / 2) / population.length) * 100;
}

export function rankLabel(pct) {
  if (pct == null) return '—';
  return pct <= 50 ? `Top ${Math.max(1, Math.round(pct))}%` : `Bottom ${Math.max(1, Math.round(100 - pct))}%`;
}

// Population of values for split index `i`, narrowed by seed type when that
// still leaves enough runs to be meaningful.
const MIN_SAMPLE = 30;
export function population(baseline, i, { ow, bt } = {}) {
  const pick = rs => rs.map(r => (i === 'finish' ? r.f : r.s[i])).filter(v => v != null);
  const all = pick(baseline.runs);
  if (!ow && !bt) return { values: all, narrowed: false };
  const narrowed = pick(baseline.runs.filter(r => (!ow || r.ow === ow) && (!bt || r.bt === bt)));
  return narrowed.length >= MIN_SAMPLE ? { values: narrowed, narrowed: true } : { values: all, narrowed: false };
}

// Key of a player's averages for a seed filter: 'all', 'ow:VILLAGE', 'bt:BRIDGE' or
// 'ow:VILLAGE|bt:BRIDGE'. Shared by the data scripts and the site.
export function seedKey({ ow, bt } = {}) {
  return [ow && `ow:${ow}`, bt && `bt:${bt}`].filter(Boolean).join('|') || 'all';
}

// Same idea, but the population is other players' *averages* (data/player-avgs-*.json):
// one value per sampled player with at least `minRuns` runs of the split on that seed type
// (or overworld + bastion pair, when the data has pair averages).
export function playerPopulation(data, i, seed = {}, minRuns = 3) {
  const pick = key => data.players.map(p => p.scopes[key]).filter(Boolean)
    .map(sc => (i === 'finish' ? (sc.fn >= minRuns ? sc.f : null) : (sc.n[i] >= minRuns ? sc.m[i] : null)))
    .filter(v => v != null);
  const all = pick('all');
  const key = seedKey(seed);
  if (key === 'all') return { values: all, narrowed: false };
  const narrowed = pick(key);
  return narrowed.length >= MIN_SAMPLE ? { values: narrowed, narrowed: true } : { values: all, narrowed: false };
}

// ---------- rank icons ----------
// Pixel art from MCSR Ranked's Ranked Information screen (src/rank-icons.js). Every icon is
// drawn centred in the same 15x15 box so they line up and keep their in-game relative sizes.

const ICON_BOX = 15;
const iconBodies = {};

function iconBody(key) {
  if (iconBodies[key]) return iconBodies[key];
  const { palette, rows } = RANK_ICONS[key];
  const dx = (ICON_BOX - rows[0].length) / 2, dy = (ICON_BOX - rows.length) / 2;
  let rects = '';
  rows.forEach((row, y) => {
    // One rect per horizontal run of the same colour.
    for (let x = 0; x < row.length;) {
      const c = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === c) end++;
      if (c !== '.') rects += `<rect x="${x + dx}" y="${y + dy}" width="${end - x}" height="1" fill="${palette[parseInt(c, 36)]}"/>`;
      x = end;
    }
  });
  return (iconBodies[key] = rects);
}

// tierKey: coal, iron, gold, emerald, diamond, netherite (or 'unrated').
export function tierIcon(tierKey, size = 16) {
  return `<svg class="px-icon" width="${size}" height="${size}" viewBox="0 0 ${ICON_BOX} ${ICON_BOX}" ` +
    `shape-rendering="crispEdges" aria-hidden="true">${iconBody(tierKey)}</svg>`;
}
