// Percentile ranking of a player's splits against the baseline sample,
// mapped to Minecraft material tiers.

export const TIERS = [
  { key: 'netherite', name: 'Netherite', max: 5,   color: '#c4b2b5', icon: 'ingot' },
  { key: 'diamond',   name: 'Diamond',   max: 20,  color: '#5ef0dd', icon: 'gem' },
  { key: 'emerald',   name: 'Emerald',   max: 40,  color: '#3ee07a', icon: 'gem' },
  { key: 'gold',      name: 'Gold',      max: 60,  color: '#fcdb3f', icon: 'ingot' },
  { key: 'iron',      name: 'Iron',      max: 80,  color: '#d8d8d8', icon: 'ingot' },
  { key: 'coal',      name: 'Coal',      max: 100, color: '#8d8d8d', icon: 'lump' },
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

// ---------- pixel-art icons ----------
// O outline, L light, M mid, D dark, . transparent

const SHAPES = {
  gem: [
    '..OOOO..',
    '.OLLLMO.',
    'OLLMMMMO',
    'OLMMMMDO',
    '.OMMMDO.',
    '..OMDO..',
    '...OO...',
    '........',
  ],
  ingot: [
    '........',
    '...OOOOO',
    '..OLLLLO',
    '.OLMMMDO',
    'OMMMMDO.',
    'ODDDDO..',
    'OOOOO...',
    '........',
  ],
  lump: [
    '........',
    '..OOOO..',
    '.OMLMMO.',
    'OMLMMDMO',
    'OMMMDMMO',
    '.OMDMMO.',
    '..OOOO..',
    '........',
  ],
};

const PALETTES = {
  netherite: { O: '#120e0f', L: '#7a6e70', M: '#4d4344', D: '#2c2425' },
  diamond:   { O: '#0c3b37', L: '#e3fffa', M: '#4aedd9', D: '#1c9e90' },
  emerald:   { O: '#08361a', L: '#c4ffd6', M: '#17dd62', D: '#0a8a3a' },
  gold:      { O: '#5a3a00', L: '#fffbc2', M: '#fcdb3f', D: '#c2860f' },
  iron:      { O: '#3a3a3a', L: '#ffffff', M: '#d8d8d8', D: '#969696' },
  coal:      { O: '#050505', L: '#6e6e6e', M: '#2e2e2e', D: '#181818' },
};

export function tierIcon(tierKey, size = 16) {
  const tier = TIERS.find(t => t.key === tierKey);
  const pal = PALETTES[tierKey];
  let rects = '';
  SHAPES[tier.icon].forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '.') rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${pal[c]}"/>`;
  }));
  return `<svg class="px-icon" width="${size}" height="${size}" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
