// MCSR Ranked Elo divisions and helpers for the rank-distribution chart.

export const DIVISIONS = [
  { tier: 'coal',      name: 'Coal I',      min: 0,    max: 399 },
  { tier: 'coal',      name: 'Coal II',     min: 400,  max: 499 },
  { tier: 'coal',      name: 'Coal III',    min: 500,  max: 599 },
  { tier: 'iron',      name: 'Iron I',      min: 600,  max: 699 },
  { tier: 'iron',      name: 'Iron II',     min: 700,  max: 799 },
  { tier: 'iron',      name: 'Iron III',    min: 800,  max: 899 },
  { tier: 'gold',      name: 'Gold I',      min: 900,  max: 999 },
  { tier: 'gold',      name: 'Gold II',     min: 1000, max: 1099 },
  { tier: 'gold',      name: 'Gold III',    min: 1100, max: 1199 },
  { tier: 'emerald',   name: 'Emerald I',   min: 1200, max: 1299 },
  { tier: 'emerald',   name: 'Emerald II',  min: 1300, max: 1399 },
  { tier: 'emerald',   name: 'Emerald III', min: 1400, max: 1499 },
  { tier: 'diamond',   name: 'Diamond I',   min: 1500, max: 1649 },
  { tier: 'diamond',   name: 'Diamond II',  min: 1650, max: 1799 },
  { tier: 'diamond',   name: 'Diamond III', min: 1800, max: 1999 },
  { tier: 'netherite', name: 'Netherite',   min: 2000, max: Infinity },
];

export const divisionFor = elo => DIVISIONS.find(d => elo >= d.min && elo <= d.max) ?? null;

// Player counts per division from an Elo histogram ({ step, counts }).
export function divisionCounts({ step, counts }) {
  const out = DIVISIONS.map(() => 0);
  counts.forEach((c, i) => {
    const d = DIVISIONS.indexOf(divisionFor(i * step));
    if (d >= 0) out[d] += c;
  });
  return out;
}

// Percent of sampled players with a lower Elo (players in the same bucket count half).
export function eloPercentile(elo, { step, counts }) {
  const total = counts.reduce((s, c) => s + c, 0);
  if (!total || elo == null) return null;
  const b = Math.max(0, Math.floor(elo / step));
  let below = 0;
  for (let i = 0; i < Math.min(b, counts.length); i++) below += counts[i];
  return ((below + (counts[b] || 0) / 2) / total) * 100;
}
