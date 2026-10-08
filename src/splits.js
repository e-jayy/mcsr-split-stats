// Split analysis for MCSR Ranked match timelines.
// Pure functions only (no DOM, no fetch) so this can be tested with Node.

export const EV = {
  START: '@start',
  FINISH: '@finish',
  RESET: 'projectelo.timeline.reset',
  NETHER: 'story.enter_the_nether',
  BASTION: 'nether.find_bastion',
  FORTRESS: 'nether.find_fortress',
  BLIND: 'projectelo.timeline.blind_travel',
  EYE: 'story.follow_ender_eye',
  END: 'story.enter_the_end',
};

export const MILESTONE_NAMES = {
  'story.smelt_iron': 'Obtain iron',
  'story.iron_tools': 'Iron pickaxe',
  'story.form_obsidian': 'Form obsidian',
  'nether.loot_bastion': 'Loot chest',
  'nether.obtain_crying_obsidian': 'Crying obsidian',
  'nether.obtain_blaze_rod': 'First blaze rod',
  'projectelo.timeline.death': 'Death',
  'projectelo.timeline.dragon_death': 'Dragon killed',
};

// Each split runs from one timeline event to the next. `bastionRoute` splits
// only count when the player found the bastion before the fortress.
export const SPLITS = [
  { key: 'overworld', name: 'Overworld', from: EV.START, to: EV.NETHER,
    milestones: ['story.smelt_iron', 'story.iron_tools'] },
  { key: 'nether', name: 'Terrain to Bastion', from: EV.NETHER, to: EV.BASTION, bastionRoute: true,
    milestones: [] },
  { key: 'bastion', name: 'Bastion', from: EV.BASTION, to: EV.FORTRESS, bastionRoute: true,
    milestones: ['nether.loot_bastion', 'nether.obtain_crying_obsidian'] },
  { key: 'fortress', name: 'Fortress', from: EV.FORTRESS, to: EV.BLIND, bastionRoute: true,
    milestones: ['nether.obtain_blaze_rod'] },
  { key: 'blind', name: 'Blind travel', from: EV.BLIND, to: EV.EYE, milestones: [] },
  { key: 'stronghold', name: 'Stronghold', from: EV.EYE, to: EV.END, milestones: [] },
  { key: 'end', name: 'End', from: EV.END, to: EV.FINISH,
    milestones: ['projectelo.timeline.dragon_death'] },
];

export const OVERWORLD_TYPES = ['VILLAGE', 'BURIED_TREASURE', 'SHIPWRECK', 'DESERT_TEMPLE', 'RUINED_PORTAL'];
export const BASTION_TYPES = ['BRIDGE', 'HOUSING', 'STABLES', 'TREASURE'];

export function prettyType(t) {
  if (!t) return 'Unknown';
  return t.toLowerCase().split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// Reduce an API match-detail object to what the analysis needs (keeps the cache small).
export function trimMatch(m) {
  const tl = {};
  for (const e of m.timelines || []) (tl[e.uuid] ||= []).push([e.type, e.time]);
  for (const k in tl) tl[k].sort((a, b) => a[1] - b[1]);
  const completions = {};
  for (const c of m.completions || []) completions[c.uuid] = c.time;
  return {
    id: m.id,
    date: m.date,
    season: m.season,
    ow: m.seed?.overworld ?? m.seedType ?? null,
    bt: m.seed?.nether ?? m.bastionType ?? null,
    forfeited: !!m.forfeited,
    decayed: !!m.decayed,
    winner: m.result?.uuid ?? null,
    completions,
    tl,
  };
}

// Break one player's timeline into attempts (a reset restarts the seed).
function attempts(events) {
  const out = [{ start: 0, events: [] }];
  for (const [type, time] of events) {
    if (type === EV.RESET) out.push({ start: time, events: [] });
    else out[out.length - 1].events.push([type, time]);
  }
  return out;
}

function firstTimes(events) {
  const first = {};
  for (const [type, time] of events) if (!(type in first)) first[type] = time;
  return first;
}

// Produce per-attempt run records for a player in a trimmed match.
// Times in the record are relative to the attempt start.
export function runsForPlayer(match, uuid, { includeResets = false } = {}) {
  const events = match.tl[uuid];
  if (!events) return [];
  const all = attempts(events);
  const runs = [];
  all.forEach((att, i) => {
    if (i > 0 && !includeResets) return;
    const isLast = i === all.length - 1;
    const abs = firstTimes(att.events);
    abs[EV.START] = att.start;
    if (isLast && match.completions[uuid] != null) abs[EV.FINISH] = match.completions[uuid];
    const rel = {};
    for (const k in abs) rel[k] = abs[k] - att.start;

    const b = rel[EV.BASTION], f = rel[EV.FORTRESS];
    const bastionFirst = b != null && (f == null || b < f);

    const splits = {};
    const milestones = {};
    for (const s of SPLITS) {
      const a = rel[s.from], z = rel[s.to];
      if (a == null) continue;
      if (s.bastionRoute && !bastionFirst) continue;
      if (z != null && z >= a) splits[s.key] = z - a;
      // Milestones: first occurrence inside this split's window, relative to split start.
      const windowEnd = z != null && z >= a ? z : Infinity;
      const ms = {};
      for (const type of s.milestones) {
        const hit = att.events.find(([t, time]) => t === type && time - att.start >= a && time - att.start <= windowEnd);
        if (hit) ms[type] = hit[1] - att.start - a;
      }
      milestones[s.key] = ms;
    }

    runs.push({
      matchId: match.id,
      date: match.date,
      ow: match.ow,
      bt: match.bt,
      attempt: i,
      won: match.winner === uuid,
      forfeited: match.forfeited,
      completed: rel[EV.FINISH] != null,
      finish: rel[EV.FINISH] ?? null,
      reached: rel,
      route: b == null && f == null ? 'none' : bastionFirst ? 'bastion' : 'fortress',
      splits,
      milestones,
      deaths: att.events.filter(([t]) => t === 'projectelo.timeline.death').length,
    });
  });
  return runs;
}

export function stats(values) {
  const v = values.filter(x => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, mean: null, best: null };
  return {
    n: v.length,
    mean: v.reduce((s, x) => s + x, 0) / v.length,
    best: v[0],
  };
}

// Aggregate a list of run records into split + milestone statistics.
export function summarize(runs) {
  const splits = {};
  const milestones = {};
  const reached = {};
  for (const s of SPLITS) {
    splits[s.key] = stats(runs.map(r => r.splits[s.key]));
    milestones[s.key] = {};
    for (const m of s.milestones) milestones[s.key][m] = stats(runs.map(r => r.milestones[s.key]?.[m]));
    reached[s.key] = stats(runs.map(r => (r.splits[s.key] != null ? r.reached[s.to] : null)));
  }
  const firstAttempts = runs.filter(r => r.attempt === 0);
  return {
    runs: runs.length,
    matches: firstAttempts.length,
    wins: firstAttempts.filter(r => r.won).length,
    completions: runs.filter(r => r.completed).length,
    fortressFirst: runs.filter(r => r.route === 'fortress').length,
    finish: stats(runs.map(r => r.finish)),
    splits,
    milestones,
    reached,
  };
}

export function groupBy(runs, key, order) {
  const groups = new Map(order.map(k => [k, []]));
  for (const r of runs) {
    const k = r[key] ?? 'UNKNOWN';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups].filter(([, rs]) => rs.length).map(([k, rs]) => [k, summarize(rs)]);
}

export function fmt(ms, { tenths = true } = {}) {
  if (ms == null) return '—';
  const unit = tenths ? 100 : 1000;
  const t = Math.round(ms / unit);            // tenths (or whole seconds)
  const perMin = 60000 / unit;
  const m = Math.floor(t / perMin);
  const rest = t - m * perMin;
  const ss = tenths
    ? `${String(Math.floor(rest / 10)).padStart(2, '0')}.${rest % 10}`
    : String(rest).padStart(2, '0');
  return `${m}:${ss}`;
}
