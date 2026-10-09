import { getUser, loadMatches, clearCache, getLeaderboard } from './api.js';
import {
  SPLITS, MILESTONE_NAMES, OVERWORLD_TYPES, BASTION_TYPES,
  runsForPlayer, summarize, groupBy, prettyType, fmt, winRate,
} from './splits.js';
import { TIERS, tierFor, percentile, rankLabel, population, playerPopulation, tierIcon } from './rank.js';
import { DIVISIONS, divisionFor, divisionCounts, eloPercentile } from './elo.js';

const $ = id => document.getElementById(id);

// The site only covers this season (shown in the page header).
const SEASON = 12;

// Elo histograms of ranked players per season (scripts/build-ranks.js), loaded on demand.
const rankData = new Map();
const loadRanks = season => {
  if (!rankData.has(season)) {
    rankData.set(season, fetch(`data/ranks-s${season}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null));
  }
  return rankData.get(season);
};

// Split times from a sample of everyone's ranked matches this season (scripts/build-baseline.js).
let baseline = null;
const baselineReady = fetch('data/baseline.json')
  .then(r => (r.ok ? r.json() : null))
  .then(b => { baseline = b; describeBaseline(b); })
  .catch(() => {});

// Split averages for a random sample of ranked players (scripts/build-player-avgs.js).
// Once there are enough of them, every "Top X%" compares averages with other players'
// averages ("Top X% of players"); until then it falls back to single runs from `baseline`.
const MIN_PLAYERS = 100;
let playerAvgs = null;
const playerAvgsReady = fetch(`data/player-avgs-s${SEASON}.json`)
  .then(r => (r.ok ? r.json() : null))
  .then(d => { playerAvgs = d; describeComparison(); })
  .catch(() => {});
const byPlayers = () => (playerAvgs?.players.length ?? 0) >= MIN_PLAYERS;
const comparePop = (i, seed = {}) => (byPlayers() ? playerPopulation(playerAvgs, i, seed) : population(baseline, i, seed));

// Footer explanation of what "Top X%" is compared against.
function describeComparison() {
  if (!byPlayers()) return;
  const date = new Date(playerAvgs.generatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  $('howRanksBody').innerHTML =
    `Each Top / Bottom % compares your <strong>average</strong> for a split with the <strong>averages of ` +
    `${playerAvgs.players.length.toLocaleString()} ranked players</strong>, picked at random across every rank in season ${playerAvgs.season} ` +
    `(each from their last ${playerAvgs.perPlayer} ranked matches, collected ${date}${playerAvgs.complete ? '' : ', still growing'}). ` +
    `"Top 10%" means your average is faster than 90% of those players' averages. A player counts for a split once they have at least 3 runs of it.`;
}
const state = {
  user: null,
  matches: [],
  ow: null,          // overworld type filter
  bt: null,          // bastion type filter
  // Column sort per table: { col, dir } where dir 1 = ascending, -1 = descending.
  sort: { splits: { col: 'order', dir: 1 }, ow: { col: 'order', dir: 1 }, bt: { col: 'order', dir: 1 }, top: { col: 'avg', dir: 1 } },
  includeResets: false,
  compare: 'type',   // Split Performance with a filter on: rank vs. same seed type ('type') or all runs ('all')
  open: new Set(),   // expanded split rows
};

// Fills the run-based footer text. describeComparison() replaces that text (and these
// spans) once player averages are in use, so this does nothing after that.
function describeBaseline(b) {
  if (!b || !$('baselineSample')) return;
  const date = new Date(b.generatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  // Newer samples (with match ids) are spread across the season; the original was the most recent matches.
  $('baselineSample').textContent = b.ids
    ? `${b.matches.toLocaleString()} ranked matches sampled across season ${b.season}`
    : `${b.matches.toLocaleString()} most recent ranked matches of season ${b.season}`;
  $('baselineDate').textContent = date;
}

// ---------- search ----------

$('search').addEventListener('submit', e => {
  e.preventDefault();
  search($('name').value);
});

// Matches box: a whole number, or "All" (every Season 12 match). null if invalid.
function parseCount(text) {
  const t = text.trim().toLowerCase();
  if (t === 'all') return Infinity;
  return /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : null;
}

async function search(name) {
  if (!name.trim()) return;
  const count = parseCount($('count').value);
  if (count == null) {
    setStatus('Matches must be a whole number (like 75) or "All".', null, true);
    return;
  }
  const go = $('go');
  go.disabled = true;
  setStatus('Looking up player…');
  try {
    const user = await getUser(name);
    const opts = {
      count,
      type: $('type').value,
      season: SEASON,
    };
    setStatus(count === Infinity
      ? `Finding all of ${user.nickname}'s Season ${SEASON} matches…`
      : `Loading ${user.nickname}'s matches…`);
    const matches = await loadMatches(user.uuid, opts, p => {
      if (p.waiting) setStatus(`Hit the API rate limit, waiting ${Math.round(p.waiting / 1000)}s…`);
      else setStatus(`Loading match timelines ${p.done}/${p.total}` +
        (count === Infinity && p.total > 200 ? ' (loading every match can take a few minutes)' : ''),
        p.done / Math.max(1, p.total));
    });
    if (!matches.length) throw new Error(`${user.nickname} has no Season ${SEASON} matches for these settings.`);
    await Promise.all([baselineReady, playerAvgsReady]);
    // Remember the mode used for this search (the dropdown can change before the next search).
    const modeLabel = $('type').selectedOptions[0].textContent;
    Object.assign(state, { user, matches, modeLabel, ow: null, bt: null, open: new Set() });
    history.replaceState(null, '', `?player=${encodeURIComponent(user.nickname)}`);
    setStatus(null);
    render();
  } catch (err) {
    setStatus(err.message || String(err), null, true);
  } finally {
    go.disabled = false;
  }
}

function setStatus(text, progress = null, isError = false) {
  const el = $('status');
  el.hidden = !text;
  el.classList.toggle('error', isError);
  el.innerHTML = '';
  if (!text) return;
  el.append(text);
  if (progress != null) {
    const bar = document.createElement('div');
    bar.className = 'progress';
    bar.innerHTML = `<div style="width:${(progress * 100).toFixed(1)}%"></div>`;
    el.append(bar);
  }
}

// ---------- controls ----------

$('resets').addEventListener('change', e => { state.includeResets = e.target.checked; render(); });
$('clearCache').addEventListener('click', () => { clearCache(); $('clearCache').textContent = 'Cache cleared'; });

// ---------- rendering ----------

function allRuns() {
  return state.matches.flatMap(m => runsForPlayer(m, state.user.uuid, { includeResets: state.includeResets }));
}

const filterRuns = (runs, { ow = state.ow, bt = state.bt } = {}) =>
  runs.filter(r => (!ow || r.ow === ow) && (!bt || r.bt === bt));

const val = s => s?.mean ?? null;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function render() {
  $('results').hidden = false;
  const runs = allRuns();
  const all = summarize(runs);
  renderStickyBar(all);
  renderPlayer(all);
  renderChips(runs);
  const sum = summarize(filterRuns(runs));
  const ranks = rankSplits(sum);
  renderPerformance(sum, ranks);
  renderSplits(sum, ranks);
  renderOverworld(filterRuns(runs, { ow: null }));
  renderBastion(filterRuns(runs, { bt: null }));
  renderFilters();
  renderRankDist();
  renderTopPlayers();   // highlights the searched player if they're in the top 150
}

// ---------- rank distribution ----------

async function renderRankDist() {
  const card = $('rankDist');
  const data = await loadRanks(SEASON);
  card.hidden = !data;
  if (!data) return;

  const counts = divisionCounts(data);
  const total = counts.reduce((s, c) => s + c, 0);
  const date = new Date(data.generatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  $('distDetails').textContent = `${data.pages} pages of ranked matches spread evenly across season ${data.season} ` +
    `(${data.matches.toLocaleString()} matches, collected ${date}), which found ${total.toLocaleString()} ranked players` +
    (data.highestRank ? `; the leaderboard goes down to about #${data.highestRank.toLocaleString()}` : '');
  const peak = Math.max(...counts);
  const u = state.user;
  const mine = u.eloRate != null ? divisionFor(u.eloRate) : null;
  const pctOf = c => {
    const p = (c / total) * 100;
    return p >= 1 ? `${Math.round(p)}%` : p > 0 ? `${p.toFixed(1)}%` : '0%';
  };

  const bars = DIVISIONS.map((d, i) => {
    const tier = TIERS.find(t => t.key === d.tier);
    const you = d === mine;
    const range = d.max === Infinity ? `${d.min}+` : `${d.min}–${d.max}`;
    return `<div class="dist-col${you ? ' you' : ''}" title="${d.name} (${range} Elo): ${counts[i].toLocaleString()} players · ${pctOf(counts[i])}">
      ${you ? '<span class="you-tag">You</span>' : ''}
      <span class="dist-pct">${pctOf(counts[i])}</span>
      <div class="dist-bar" style="height:${peak ? (counts[i] / peak) * 100 : 0}%;background:${tier.color}"></div>
    </div>`;
  }).join('');

  const numerals = DIVISIONS.map(d => `<span>${d.name.split(' ')[1] || ''}</span>`).join('');
  const groups = TIERS.slice().reverse().map(t => {
    const span = DIVISIONS.filter(d => d.tier === t.key).length;
    return `<span class="dist-tier" style="grid-column:span ${span};color:${t.color}">${tierIcon(t.key, 16)}<b>${t.name}</b></span>`;
  }).join('');

  let summary = `${esc(u.nickname)} hasn't finished placement matches yet.`;
  if (mine) {
    const pct = eloPercentile(u.eloRate, data);
    const tier = TIERS.find(t => t.key === mine.tier);
    summary = `${esc(u.nickname)}: <span style="color:${tier.color}">${tierIcon(mine.tier, 14)}${mine.name}</span> · ${u.eloRate} Elo · ` +
      `higher than ${pct > 99 ? Math.min(pct, 99.9).toFixed(1) : pct < 10 ? pct.toFixed(1) : Math.round(pct)}% of players`;
  }

  card.innerHTML = `
    <h2 class="perf-title">${tierIcon('netherite', 32)}<span>Rank Distribution</span>${tierIcon('netherite', 32)}</h2>
    <p class="perf-overall">Season ${data.season} · ${total.toLocaleString()} ranked players sampled</p>
    <p class="dist-caveat">Estimate: this is based on a sample of ${total.toLocaleString()}${data.highestRank > total
      ? ` of roughly ${data.highestRank.toLocaleString()}` : ''} ranked players, not every player.
      Players with very few games are the most likely to be missing.</p>
    <p class="dist-summary">${summary}</p>
    <div class="dist">
      <div class="dist-bars">${bars}</div>
      <div class="dist-numerals">${numerals}</div>
      <div class="dist-tiers">${groups}</div>
    </div>
    <p class="perf-note"><a href="#how-dist">How this is calculated</a></p>`;
}

function renderPlayer(sum) {
  const u = state.user;
  const wr = winRate(sum);
  const pct = wr == null ? '—' : `${Math.round(wr * 100)}%`;
  $('player').innerHTML = `
    <div class="name"><img src="https://mc-heads.net/avatar/${u.uuid}/36" alt="">${esc(u.nickname)}</div>
    <div class="kpis">
      <div class="kpi"><b>${u.eloRate ?? '—'}</b><span>Elo${u.eloRank ? ` · #${u.eloRank}` : ''}</span></div>
      <div class="kpi"><b>${sum.matches}</b><span>Matches analyzed</span></div>
      <div class="kpi" title="${sum.wins}W ${sum.losses}L${sum.draws ? `, ${sum.draws} draw${sum.draws > 1 ? 's' : ''} not counted` : ''}"><b>${pct}</b><span>Win rate</span></div>
      <div class="kpi"><b>${fmt(sum.finish.mean)}</b><span>Avg finish (${sum.completions})</span></div>
      <div class="kpi"><b>${fmt(sum.finish.best)}</b><span>Best finish</span></div>
    </div>`;
}

function renderChips(runs) {
  const make = (el, label, key, types) => {
    const counts = {};
    for (const r of runs) counts[r[key]] = (counts[r[key]] || 0) + 1;
    const present = [...types, ...Object.keys(counts).filter(t => !types.includes(t))].filter(t => counts[t]);
    el.innerHTML = `<span class="label">${label}</span>`;
    for (const t of [null, ...present]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state[key] === t ? ' on' : '');
      b.innerHTML = t ? `${prettyType(t)}<small>${counts[t]}</small>` : 'All';
      b.addEventListener('click', () => { state[key] = t; render(); });
      el.append(b);
    }
  };
  make($('owChips'), 'Overworld', 'ow', OVERWORLD_TYPES);
  make($('btChips'), 'Bastion', 'bt', BASTION_TYPES);
}

// Which seed type matters most for each split, used when the sample has too few runs
// matching both selected types.
const SPLIT_SEED = { overworld: 'ow', nether: 'bt', bastion: 'bt', fortress: 'bt' };

// Percentile + tier for every split (and finish) against the baseline.
// With a seed-type filter on, state.compare picks the comparison: runs on the same
// seed type ('type') or every run ('all'). Same-type comparisons fall back from both
// types -> the split's most relevant type -> all runs when the sample is too small;
// `scopes` records what each split was actually compared against.
function rankSplits(sum) {
  if (!baseline) return null;
  const out = { scopes: [] };
  const filtering = (state.ow || state.bt) && state.compare === 'type';
  const rank = (key, name, i, value) => {
    let pop = comparePop(i), used = 'all';
    if (filtering) {
      const tries = [{ ow: state.ow, bt: state.bt }];
      const own = SPLIT_SEED[key];
      if (state.ow && state.bt && own) tries.push({ [own]: state[own] });
      for (const seed of tries) {
        const p = comparePop(i, seed);
        if (p.narrowed) { pop = p; used = seed; break; }
      }
    }
    const pct = percentile(value, pop.values);
    out[key] = pct == null ? null : { pct, tier: tierFor(pct), label: rankLabel(pct) };
    if (filtering && value != null) out.scopes.push({ name, used });
  };
  SPLITS.forEach((s, i) => rank(s.key, s.name, i, val(sum.splits[s.key])));
  rank('finish', 'Finish', 'finish', val(sum.finish));
  return out;
}

// What a split was compared against, e.g. "players on Shipwreck" or "Shipwreck runs".
function scopeName(seed) {
  const types = seed === 'all' ? '' : [seed.ow && prettyType(seed.ow), seed.bt && prettyType(seed.bt)].filter(Boolean).join(' + ');
  if (byPlayers()) return types ? `players on ${types}` : 'all players';
  return types ? `${types} runs` : 'all runs';
}

// Compare-to switch for Split Performance; only shown while a seed-type filter is on.
function compareSwitch(ranks) {
  if (!state.ow && !state.bt) return '';
  const scope = [state.ow && prettyType(state.ow), state.bt && prettyType(state.bt)].filter(Boolean).join(' + ');
  const opt = (value, label) =>
    `<button type="button" data-compare="${value}" aria-pressed="${state.compare === value}"${state.compare === value ? ' class="on"' : ''}>${label}</button>`;
  let note = byPlayers()
    ? "Ranked against other players' averages on every seed type."
    : 'Ranked against all runs, on every seed type.';
  if (state.compare === 'type') {
    // Group splits by what they were compared against, e.g. "Overworld vs. players on Shipwreck".
    const groups = new Map();
    for (const { name, used } of ranks.scopes) {
      const label = scopeName(used);
      groups.set(label, [...(groups.get(label) || []), name]);
    }
    const wanted = scopeName({ ow: state.ow, bt: state.bt });
    // Player averages are stored per single seed type, so a pair can never be matched exactly.
    const why = byPlayers() && state.ow && state.bt
      ? "Players' averages are kept per seed type, so with two filters each split is ranked on the type that matters most for it: "
      : `Not enough ${wanted} in the sample for every split, so: `;
    note = [...groups.keys()].every(k => k === wanted)
      ? `Ranked against ${wanted} only.`
      : why + [...groups].map(([label, names]) => `${names.join(', ')} vs. ${label}`).join('; ') + '.';
  }
  return `<div class="compare">
      <span class="compare-label">Compare to</span>
      <div class="seg" role="group" aria-label="Compare to">${opt('type', scope)}${opt('all', 'All seed types')}</div>
    </div>
    <p class="compare-note">${note}</p>`;
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-compare]');
  if (!btn || state.compare === btn.dataset.compare) return;
  state.compare = btn.dataset.compare;
  render();
});

const rankHtml = r => (r
  ? `<span class="rank" style="color:${r.tier.color}">${tierIcon(r.tier.key)}${r.label}</span>`
  : '<span class="muted">—</span>');

function renderPerformance(sum, ranks) {
  const card = $('perf');
  card.hidden = !ranks;
  if (!ranks) return;

  // Heptagon radar: outer edge = top of the ladder, center = slowest.
  const N = SPLITS.length, W = 160, H = 100, cx = 80, cy = 55, R = 34;
  const pt = (i, r) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const poly = r => SPLITS.map((_, i) => pt(i, r).map(n => n.toFixed(2)).join(',')).join(' ');
  const rings = [0.2, 0.4, 0.6, 0.8].map(f => `<polygon points="${poly(R * f)}" class="ring"/>`).join('');
  const spokes = SPLITS.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="spoke"/>`; }).join('');
  const shape = SPLITS.map((s, i) => {
    const r = ranks[s.key];
    const score = r ? Math.max(0.06, 1 - r.pct / 100) : 0.06;
    return pt(i, R * score).map(n => n.toFixed(2)).join(',');
  }).join(' ');

  const labels = SPLITS.map((s, i) => {
    const [x, y] = pt(i, R + 9);
    const r = ranks[s.key];
    const side = x < cx - 2 ? 'left' : x > cx + 2 ? 'right' : 'mid';
    return `<div class="axis ${side}" style="left:${(x / W) * 100}%;top:${(y / H) * 100}%">
      <div class="axis-name">${s.name.replace(' travel', '')}</div>
      <div class="axis-val" style="color:${r ? r.tier.color : '#888'}">${r ? `${tierIcon(r.tier.key, 14)}<span>${fmt(val(sum.splits[s.key]), { tenths: false })}</span><span class="sep"> / </span><span>${r.label}</span>` : 'no data'}</div>
    </div>`;
  }).join('');

  const fin = ranks.finish;
  card.innerHTML = `
    <h2 class="perf-title">${tierIcon('diamond', 32)}<span>Split Performance</span>${tierIcon('diamond', 32)}</h2>
    <div class="filter-line center" data-filters></div>
    ${compareSwitch(ranks)}
    ${fin ? `<p class="perf-overall">Finish <b>${fmt(val(sum.finish), { tenths: false })}</b> <span style="color:${fin.tier.color}">${tierIcon(fin.tier.key, 14)}${fin.label} · ${fin.tier.name}</span></p>` : ''}
    <div class="radar">
      <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">
        <polygon points="${poly(R)}" class="ring outer"/>${rings}${spokes}
        <polygon points="${shape}" class="shape"/>
      </svg>
      ${labels}
    </div>
    <ul class="perf-list">${SPLITS.map(s => { const r = ranks[s.key]; return `<li><span>${s.name}</span><span>${fmt(val(sum.splits[s.key]), { tenths: false })}</span><span style="color:${r ? r.tier.color : '#888'}">${r ? tierIcon(r.tier.key, 16) + r.label : '—'}</span></li>`; }).join('')}</ul>
    <ul class="tier-legend">${TIERS.map((t, i) => `<li style="color:${t.color}">${tierIcon(t.key, 16)}${t.name}
      <span>${i < 4 ? `Top ${t.max}%` : `Bottom ${100 - TIERS[i - 1].max}%`}</span></li>`).join('')}</ul>
    <p class="perf-note"><a href="#how-ranks">How % is calculated</a></p>`;
}

// ---------- sortable tables ----------

// Copy each column's header text onto its cells so phones can show rows as labeled cards.
function labelCells(table) {
  const labels = [...table.querySelectorAll('thead th')].map(th => th.textContent.replace(/[▲▼]/g, '').trim());
  table.querySelectorAll('tbody tr').forEach(tr =>
    [...tr.children].forEach((td, i) => { if (i > 0) td.dataset.label = labels[i]; }));
}

// Sort rows by a column getter; empty values always sink to the bottom.
function sortBy(rows, get, dir) {
  return rows
    .map((row, i) => ({ row, v: get(row), i }))
    .sort((a, b) => (a.v == null) - (b.v == null) || (a.v == null ? 0 : (a.v - b.v) * dir) || a.i - b.i)
    .map(x => x.row);
}

// Label with a superscript info icon glued to its last word (so the icon never wraps alone).
function withInfo(label) {
  const i = label.lastIndexOf(' ');
  return `${label.slice(0, i + 1)}<span class="nowrap">${label.slice(i + 1)}<span class="info" aria-hidden="true">i</span></span>`;
}

// Header cells as sort buttons. `cols` entries: { key, label, dir } (dir = first-click direction).
function sortHeader(table, cols) {
  const { col, dir } = state.sort[table];
  const mobile = `<caption class="mobile-sort"><label>Sort by <select class="sort-select">${cols.map(c =>
    `<option value="${c.key}" data-dir="${c.dir}"${c.key === col ? ' selected' : ''}>${c.label}</option>`).join('')}</select></label>` +
    `<button type="button" class="sort-dir" aria-label="Reverse sort order">${dir === 1 ? '▲' : '▼'}</button></caption>`;
  return mobile + `<thead><tr>${cols.map(c => {
    const on = c.key === col;
    const arrow = on ? (dir === 1 ? '▲' : '▼') : '';
    return `<th aria-sort="${on ? (dir === 1 ? 'ascending' : 'descending') : 'none'}">` +
      `<button type="button" class="sort${on ? ' on' : ''}${c.tip ? ' has-tip' : ''}" data-sort="${c.key}" data-dir="${c.dir}"${c.tip ? ` title="${esc(c.tip)}"` : ''}>${c.tip ? withInfo(c.label) : c.label}<span class="arrow">${arrow}</span></button></th>`;
  }).join('')}</tr></thead>`;
}

function bindSort(el, table, rerender) {
  labelCells(el);
  el.querySelector('.sort-select').addEventListener('change', e => {
    const opt = e.target.selectedOptions[0];
    state.sort[table] = { col: opt.value, dir: Number(opt.dataset.dir) };
    rerender();
  });
  el.querySelector('.sort-dir').addEventListener('click', () => {
    state.sort[table] = { ...state.sort[table], dir: -state.sort[table].dir };
    rerender();
  });
  el.querySelectorAll('button.sort').forEach(b => b.addEventListener('click', () => {
    const cur = state.sort[table];
    state.sort[table] = cur.col === b.dataset.sort
      ? { col: cur.col, dir: -cur.dir }
      : { col: b.dataset.sort, dir: Number(b.dataset.dir) };
    rerender();
  }));
}

// ---------- active seed-type filters ----------

// Tags for the selected overworld / bastion types, each with a button to clear it.
// `compact` drops the explanatory text (used in the sticky top bar).
function filterTags(compact = false) {
  const tags = [['ow', 'Overworld'], ['bt', 'Bastion']]
    .filter(([key]) => state[key])
    .map(([key, label]) => `<button type="button" class="ftag" data-clear="${key}" title="Clear this filter">` +
      `<span class="ftag-kind">${label}: </span><b>${prettyType(state[key])}</b><span aria-hidden="true">×</span></button>`);
  if (compact) return tags.length ? tags.join('') : '<span class="ftag-label">All seed types</span>';
  return tags.length
    ? `<span class="ftag-label">Filtered by</span>${tags.join('')}`
    : '<span class="ftag-label">Showing all seed types · click a type row to filter</span>';
}

function renderFilters() {
  document.querySelectorAll('[data-filters]').forEach(el => { el.innerHTML = filterTags(); });
  $('sbFilters').innerHTML = filterTags(true);
}

// Sticky top bar: player, active filters, matches analyzed and mode.
function renderStickyBar(all) {
  const u = state.user;
  $('stickyBar').hidden = false;
  $('sbPlayer').innerHTML = `<img src="https://mc-heads.net/avatar/${u.uuid}/24" alt="">${esc(u.nickname)}`;
  $('sbMeta').innerHTML =
    `<span><b>${all.matches}</b> matches<span class="sb-long"> analyzed</span></span><span class="sb-mode">${esc(state.modeLabel)}</span>`;
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-clear]');
  if (!btn) return;
  state[btn.dataset.clear] = null;
  render();
});

function renderSplits(sum, ranks) {
  $('splitsNote').textContent =
    `${sum.runs} runs` + (sum.fortressFirst ? ` · ${sum.fortressFirst} fortress-first` : '');

  // Stacked bar of average time per split.
  const total = SPLITS.reduce((t, s) => t + (val(sum.splits[s.key]) || 0), 0);
  $('splitBar').innerHTML = SPLITS.map(s => {
    const v = val(sum.splits[s.key]);
    if (!v) return '';
    const w = (v / total) * 100;
    return `<div style="width:${w}%;background:var(--s-${s.key})" title="${s.name}: ${fmt(v)}"></div>`;
  }).join('');

  const cols = [
    { key: 'order',   label: 'Split',      dir: 1,  get: s => SPLITS.indexOf(s) },
    { key: 'avg',     label: 'Average',    dir: 1,  get: s => sum.splits[s.key].mean },
    { key: 'best',    label: 'Best',       dir: 1,  get: s => sum.splits[s.key].best },
    { key: 'reached', label: 'Avg End of Split', dir: 1, get: s => sum.reached[s.key].mean,
      tip: 'The average point in the run when that split ends, timed from the start of the match' },
    { key: 'runs',    label: 'Runs',       dir: -1, get: s => sum.splits[s.key].n },
    { key: 'rank',    label: 'Rank',       dir: 1,  get: s => ranks?.[s.key]?.pct },
  ];
  const { col, dir } = state.sort.splits;
  const rows = sortBy(SPLITS, cols.find(c => c.key === col).get, dir);

  let html = sortHeader('splits', cols) + '<tbody>';
  for (const s of rows) {
    const st = sum.splits[s.key];
    const open = state.open.has(s.key);
    const hasMs = s.milestones.length > 0;
    html += `<tr class="${hasMs ? 'split' : ''}${open ? ' open' : ''}" data-key="${s.key}">
      <td><span class="swatch" style="background:var(--s-${s.key})"></span>${s.name}</td>
      <td><b>${fmt(val(st))}</b></td><td>${fmt(st.best)}</td>
      <td>${fmt(val(sum.reached[s.key]))}</td><td class="n">${st.n}</td><td>${rankHtml(ranks?.[s.key])}</td></tr>`;
    for (const m of s.milestones) {
      const ms = sum.milestones[s.key][m];
      html += `<tr class="ms" ${open ? '' : 'hidden'}>
        <td>${MILESTONE_NAMES[m] || m} <span class="muted">from split start</span></td>
        <td>${fmt(val(ms))}</td><td>${fmt(ms.best)}</td>
        <td></td><td class="n">${ms.n}</td><td></td></tr>`;
    }
  }
  html += `<tr class="total"><td>Finish</td><td><b>${fmt(val(sum.finish))}</b></td><td>${fmt(sum.finish.best)}</td>
    <td></td><td class="n">${sum.finish.n}</td><td>${rankHtml(ranks?.finish)}</td></tr></tbody>`;

  const table = $('splitsTable');
  table.innerHTML = html;
  bindSort(table, 'splits', () => renderSplits(sum, ranks));
  table.querySelectorAll('tr.split').forEach(tr => tr.addEventListener('click', () => {
    const k = tr.dataset.key;
    state.open.has(k) ? state.open.delete(k) : state.open.add(k);
    renderSplits(sum, ranks);
  }));
}

// Percentile of the player's average for split i on the row's seed type (`own`), also narrowed
// by the other table's filter (`other`) when the data allows it; otherwise the row's type alone.
function typeRank(i, value, own, other = {}) {
  if (!baseline || value == null) return null;
  const both = comparePop(i, { ...own, ...other });
  return percentile(value, (both.narrowed ? both : comparePop(i, own)).values);
}
const pctBadge = pct => rankHtml(pct == null ? null : { pct, tier: tierFor(pct), label: rankLabel(pct) });

// Pivot table: one row per seed type; every column is sortable.
// Column getters receive (summary, seedType); columns with render() draw their own cell.
function renderPivot(table, runs, key, order, columns) {
  const groups = groupBy(runs, key, order);
  const cols = [
    { key: 'order', label: 'Type',  dir: 1,  get: ([t]) => (order.includes(t) ? order.indexOf(t) : order.length) },
    { key: 'runs',  label: 'Runs',  dir: -1, get: ([, s]) => s.runs },
    { key: 'win',   label: 'Win %', dir: -1, get: ([, s]) => winRate(s) },
    ...columns.map((c, j) => ({ key: c.key || `c${j}`, label: c.label, tip: c.tip, dir: 1, get: ([t, s]) => c.get(s, t) })),
  ];
  const { col, dir } = state.sort[key];
  const rows = sortBy(groups, (cols.find(c => c.key === col) || cols[0]).get, dir);

  // Fastest / slowest per time column (types with at least 3 runs).
  const extremes = columns.map(c => {
    if (c.render) return null;
    const vs = groups.filter(([, s]) => s.runs >= 3).map(([t, s]) => c.get(s, t)).filter(v => v != null);
    return vs.length >= 2 ? [Math.min(...vs), Math.max(...vs)] : null;
  });

  let html = sortHeader(key, cols) + '<tbody>';
  for (const [type, s] of rows) {
    const wr = winRate(s);
    html += `<tr data-type="${esc(type)}" class="${state[key] === type ? 'active' : ''}">
      <td>${prettyType(type)}</td><td class="n">${s.runs}</td><td>${wr == null ? '—' : Math.round(wr * 100) + '%'}</td>`;
    columns.forEach((c, j) => {
      const v = c.get(s, type);
      if (c.render) { html += `<td>${c.render(v)}</td>`; return; }
      const ex = extremes[j];
      const cls = ex && s.runs >= 3 && v != null ? (v === ex[0] ? 'fast' : v === ex[1] ? 'slow' : '') : '';
      html += `<td class="${cls}">${fmt(v)}</td>`;
    });
    html += '</tr>';
  }
  table.innerHTML = html + '</tbody>';
  bindSort(table, key, () => renderPivot(table, runs, key, order, columns));
  table.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => {
    state[key] = state[key] === tr.dataset.type ? null : tr.dataset.type;
    render();
  }));
}

function renderOverworld(runs) {
  const ms = m => s => val(s.milestones.overworld[m]);
  renderPivot($('owTable'), runs, 'ow', OVERWORLD_TYPES, [
    { label: 'Obtain iron', get: ms('story.smelt_iron') },
    { label: 'Iron pick', get: ms('story.iron_tools') },
    { label: 'Enter Nether', get: s => val(s.splits.overworld) },
    { key: 'netherRank', label: 'Rank', render: pctBadge,
      tip: `Your average Enter Nether time vs. ${byPlayers() ? "other players' averages" : "all players' runs"} on this overworld type`,
      get: (s, t) => typeRank(0, val(s.splits.overworld), { ow: t }, { bt: state.bt }) },
    { label: 'Terrain to Bastion', get: s => val(s.splits.nether) },
    { label: 'Finish', get: s => val(s.finish) },
  ]);
}

function renderBastion(runs) {
  const ms = m => s => val(s.milestones.bastion[m]);
  renderPivot($('btTable'), runs, 'bt', BASTION_TYPES, [
    { label: 'Terrain to Bastion', get: s => val(s.splits.nether) },
    { label: 'Loot chest', get: ms('nether.loot_bastion') },
    { label: 'Bastion split', tip: 'Enter Bastion to Enter Fortress', get: s => val(s.splits.bastion) },
    { key: 'bastionRank', label: 'Rank', render: pctBadge,
      tip: `Your average Bastion split vs. ${byPlayers() ? "other players' averages" : "all players' runs"} on this bastion type`,
      get: (s, t) => typeRank(2, val(s.splits.bastion), { bt: t }, { ow: state.ow }) },
    { label: 'Fortress split', tip: 'Fortress Enter to Blind', get: s => val(s.splits.fortress) },
    { label: 'Finish', get: s => val(s.finish) },
  ]);
}

// ---------- top-150 drop-down on the Player box ----------

const lb = { users: null, shown: [], active: -1, open: false };
const nameInput = $('name');
const LB_MAX = 50;   // autocomplete results shown at once

// Every ranked player found by scripts/build-ranks.js (the API has no player search),
// used for name autocomplete. Loaded the first time the Player box is used.
let playerIndex = null;
let playerIndexReady = null;
function loadPlayerIndex() {
  playerIndexReady ??= fetch(`data/player-index-s${SEASON}.json`)
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      playerIndex = d ? d.players.map(([nickname, eloRate, eloRank]) => ({ nickname, eloRate, eloRank, key: nickname.toLowerCase() })) : [];
    })
    .catch(() => { playerIndex = []; });
  return playerIndexReady;
}

function lbRow(u, i) {
  const d = divisionFor(u.eloRate);
  const tier = d && TIERS.find(t => t.key === d.tier);
  return `<li role="option" id="lb-${i}" data-name="${esc(u.nickname)}" aria-selected="false">
    <span class="lb-rank">${u.eloRank ?? ''}</span>
    <span class="lb-name"><img src="https://mc-heads.net/avatar/${encodeURIComponent(u.uuid || u.nickname)}/20" alt="" loading="lazy">${esc(u.nickname)}</span>
    <span class="lb-elo"${tier ? ` style="color:${tier.color}" title="${d.name}"` : ''}>${d ? tierIcon(d.tier, 14) : ''}${u.eloRate}</span>
  </li>`;
}

// Players whose name contains q: exact match first, then names starting with q, then the
// rest; strongest first within each. Top-150 entries (live leaderboard data) win over the index.
function lbSearch(q) {
  const byName = new Map();
  for (const u of playerIndex || []) if (u.key.includes(q)) byName.set(u.key, u);
  for (const u of lb.users || []) {
    const key = u.nickname.toLowerCase();
    if (key.includes(q)) byName.set(key, { ...u, key });
  }
  const tierOf = u => (u.key === q ? 0 : u.key.startsWith(q) ? 1 : 2);
  return [...byName.values()].sort((a, b) => tierOf(a) - tierOf(b) || b.eloRate - a.eloRate);
}

function lbRender() {
  const list = $('lbList');
  const typed = nameInput.value.trim();
  const q = typed.toLowerCase();
  if (!q && !lb.users) {
    list.innerHTML = `<li class="lb-msg">${lb.error ? 'Couldn’t load the leaderboard. You can still type a name and press Search.' : 'Loading the top 150…'}</li>`;
    return;
  }
  if (q && !playerIndex && !lb.users) {
    list.innerHTML = '<li class="lb-msg">Loading the player list…</li>';
    return;
  }
  const matches = q ? lbSearch(q) : lb.users;
  lb.shown = q ? matches.slice(0, LB_MAX) : matches;    // the cap only applies to search results
  lb.active = Math.min(lb.active, lb.shown.length - 1);
  list.innerHTML = lb.shown.length
    ? lb.shown.map(lbRow).join('') +
      (matches.length > LB_MAX ? `<li class="lb-msg">Showing ${LB_MAX} of ${matches.length.toLocaleString()} players. Keep typing to narrow it down.</li>` : '')
    : `<li class="lb-msg">No ranked player found matching “${esc(typed)}”. Press Search to look them up anyway.</li>`;
  $('lbHeadLabel').textContent = q ? 'Players' : 'Top 150';
  lbHighlight();
}

function lbHighlight() {
  $('lbList').querySelectorAll('[role=option]').forEach((li, i) => {
    li.setAttribute('aria-selected', String(i === lb.active));
    if (i === lb.active) li.scrollIntoView({ block: 'nearest' });
  });
  if (lb.active >= 0) nameInput.setAttribute('aria-activedescendant', `lb-${lb.active}`);
  else nameInput.removeAttribute('aria-activedescendant');
}

async function lbOpen() {
  if (lb.open) return;
  lb.open = true;
  lb.active = -1;
  $('lbPop').hidden = false;
  nameInput.setAttribute('aria-expanded', 'true');
  lbRender();
  if (!playerIndex) loadPlayerIndex().then(() => { if (lb.open) lbRender(); });
  if (!lb.users) {
    try { lb.users = await getLeaderboard(SEASON); lb.error = false; } catch { lb.error = true; }
    if (lb.open) lbRender();
  }
}

function lbClose() {
  lb.open = false;
  $('lbPop').hidden = true;
  nameInput.setAttribute('aria-expanded', 'false');
  nameInput.removeAttribute('aria-activedescendant');
}

function lbPick(name) {
  nameInput.value = name;
  lbClose();
  search(name);
}

nameInput.addEventListener('focus', lbOpen);
nameInput.addEventListener('click', lbOpen);
nameInput.addEventListener('input', () => { lb.active = -1; lbOpen(); lbRender(); });
nameInput.addEventListener('blur', () => setTimeout(lbClose, 120));
nameInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!lb.open) lbOpen();
    if (!lb.shown.length) return;
    const n = lb.shown.length;
    lb.active = e.key === 'ArrowDown' ? (lb.active + 1) % n : lb.active < 0 ? n - 1 : (lb.active - 1 + n) % n;
    lbHighlight();
  } else if (e.key === 'Enter' && lb.open && lb.active >= 0) {
    e.preventDefault();
    lbPick(lb.shown[lb.active].nickname);
  } else if (e.key === 'Escape' && lb.open) {
    e.preventDefault();
    lbClose();
  }
});
// mousedown (not click) so the pick happens before the input's blur closes the list
$('lbList').addEventListener('mousedown', e => {
  const li = e.target.closest('[role=option]');
  if (!li) return;
  e.preventDefault();
  lbPick(li.dataset.name);
});
$('search').addEventListener('submit', lbClose);

// ---------- Top players (Elo top 150, data/players-s12.json from scripts/build-players.js) ----------

const TP_MIN_RUNS = 3;   // a player needs this many runs of the split (on the seed type) to be listed
const TP_TIERS = [
  { key: 'all', label: 'All', max: 100 },
  { key: 'top1', label: 'Top 1%', max: 1 },
  { key: 'netherite', label: 'Top 5%', max: 5, tier: 'netherite' },
  { key: 'diamond', label: 'Top 20%', max: 20, tier: 'diamond' },
  { key: 'emerald', label: 'Top 40%', max: 40, tier: 'emerald' },
  { key: 'gold', label: 'Top 60%', max: 60, tier: 'gold' },
];
const tp = { data: null, split: 'overworld', seed: '', tier: 'all' };

const tpReady = fetch(`data/players-s${SEASON}.json`)
  .then(r => (r.ok ? r.json() : null))
  .then(async d => {
    tp.data = d;
    await Promise.all([baselineReady, playerAvgsReady]);
    if (d) initTopPlayers();
  })
  .catch(() => {});

function initTopPlayers() {
  $('topPlayers').hidden = false;
  $('tpSplit').innerHTML = SPLITS.map(s => `<option value="${s.key}">${s.name}</option>`).join('') +
    '<option value="finish">Finish time</option>';
  $('tpSeed').innerHTML = '<option value="">Any seed type</option>' +
    `<optgroup label="Overworld type">${OVERWORLD_TYPES.map(t => `<option value="ow:${t}">${prettyType(t)}</option>`).join('')}</optgroup>` +
    `<optgroup label="Bastion type">${BASTION_TYPES.map(t => `<option value="bt:${t}">${prettyType(t)}</option>`).join('')}</optgroup>`;
  $('tpSplit').addEventListener('change', e => { tp.split = e.target.value; renderTopPlayers(); });
  $('tpSeed').addEventListener('change', e => { tp.seed = e.target.value; renderTopPlayers(); });
  renderTopPlayers();
}

// One row per listed player for the chosen split + seed type, with percentile vs. all sample runs.
function tpRows() {
  const i = tp.split === 'finish' ? 'finish' : SPLITS.findIndex(s => s.key === tp.split);
  const [kind, type] = tp.seed ? tp.seed.split(':') : [];
  const pop = baseline ? comparePop(i, kind ? { [kind]: type } : {}) : null;
  const rows = [];
  for (const p of tp.data.players) {
    const sc = p.scopes[tp.seed || 'all'];
    if (!sc) continue;
    const avg = i === 'finish' ? sc.f : sc.m[i];
    const runs = i === 'finish' ? sc.fn : sc.n[i];
    if (avg == null || runs < TP_MIN_RUNS) continue;
    rows.push({ p, avg, runs, pct: pop ? percentile(avg, pop.values) : null });
  }
  return { rows, narrowed: pop?.narrowed, sample: pop?.values.length ?? 0 };
}

function renderTopPlayers() {
  if (!tp.data) return;
  const { rows, narrowed, sample } = tpRows();
  const splitName = tp.split === 'finish' ? 'Finish time' : SPLITS.find(s => s.key === tp.split).name;
  const seedName = tp.seed ? prettyType(tp.seed.split(':')[1]) : '';

  // When the snapshot was taken, so newer games missing from the list don't look like a bug.
  const when = new Date(tp.data.generatedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  $('tpNote').textContent = `Season ${tp.data.season} Elo top 150 · ${tp.data.complete ? '' : `still collecting (${tp.data.players.length} of 150 so far) · `}` +
    `averages from each player's last ${tp.data.perPlayer} ranked matches, as of ${when}`;

  // Tier chips with counts.
  $('tpTiers').innerHTML = '<span class="label">Show</span>' + TP_TIERS.map(t => {
    const count = t.key === 'all' ? rows.length : rows.filter(r => r.pct != null && r.pct <= t.max).length;
    return `<button type="button" class="chip${tp.tier === t.key ? ' on' : ''}" data-tptier="${t.key}">` +
      `${t.tier ? tierIcon(t.tier, 14) : ''}${t.label}<small>${count}</small></button>`;
  }).join('');

  const tier = TP_TIERS.find(t => t.key === tp.tier);
  const shown = tier.key === 'all' ? rows : rows.filter(r => r.pct != null && r.pct <= tier.max);
  const cols = [
    { key: 'player', label: 'Player', dir: 1, get: r => r.p.rank },
    { key: 'elo', label: 'Elo', dir: -1, get: r => r.p.elo },
    { key: 'avg', label: `Avg ${splitName}`, dir: 1, get: r => r.avg },
    { key: 'runs', label: 'Runs', dir: -1, get: r => r.runs },
    { key: 'pct', label: 'Rank', dir: 1, get: r => r.pct,
      tip: byPlayers()
        ? `Player's average vs. the averages of ${playerAvgs.players.length} sampled players${seedName ? ` on ${seedName}` : ''}, across every rank`
        : `Player's average vs. all ${seedName ? `${seedName} ` : ''}runs in the ${baseline?.matches.toLocaleString() ?? ''}-match sample` },
  ];
  const { col, dir } = state.sort.top;
  const sorted = sortBy(shown, (cols.find(c => c.key === col) || cols[2]).get, dir);
  const me = state.user?.uuid;

  let html = sortHeader('top', cols) + '<tbody>';
  sorted.forEach((r, n) => {
    html += `<tr data-name="${esc(r.p.nickname)}" class="${r.p.uuid === me ? 'active' : ''}" title="Load ${esc(r.p.nickname)}'s stats">
      <td><span class="tp-pos">${n + 1}</span><img class="tp-head" src="https://mc-heads.net/avatar/${r.p.uuid}/20" alt="" loading="lazy">${esc(r.p.nickname)}<span class="tp-lb">#${r.p.rank}</span></td>
      <td>${r.p.elo}</td><td><b>${fmt(r.avg)}</b></td><td class="n">${r.runs}</td><td>${pctBadge(r.pct)}</td></tr>`;
  });
  if (!sorted.length) {
    html += `<tr class="tp-empty"><td colspan="5">No players ${tier.key === 'all' ? `with ${TP_MIN_RUNS}+ runs of this split${seedName ? ` on ${seedName}` : ''}` : `in ${tier.label.toLowerCase()} for this split${seedName ? ` on ${seedName}` : ''}`}.</td></tr>`;
  }
  const table = $('tpTable');
  table.innerHTML = html + '</tbody>';
  bindSort(table, 'top', renderTopPlayers);
  table.querySelectorAll('tbody tr[data-name]').forEach(tr => tr.addEventListener('click', () => {
    nameInput.value = tr.dataset.name;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    search(tr.dataset.name);
  }));

  $('tpCaveat').textContent = (tp.split === 'finish'
    ? `Players are listed when they have at least ${TP_MIN_RUNS} finished runs (completions)`
    : `Players are listed when they have at least ${TP_MIN_RUNS} runs of this split`) +
    `${seedName ? ` on ${seedName} seeds` : ''} in their last ${tp.data.perPlayer} matches, so games played since the date above aren't counted yet. Ranks compare each average with ` +
    (byPlayers()
      ? `the averages of ${sample.toLocaleString()} randomly sampled ranked players${narrowed ? ` on ${seedName}` : ''}, across every rank`
      : `${narrowed ? `${sample.toLocaleString()} ${seedName} runs` : `${sample.toLocaleString()} runs on all seed types`} from the comparison sample`) +
    `${tp.seed && !narrowed ? ` (too few for ${seedName} alone, so all seed types are used)` : ''}. Click a player to load their stats.`;
}

document.addEventListener('click', e => {
  const chip = e.target.closest('[data-tptier]');
  if (!chip) return;
  tp.tier = chip.dataset.tptier;
  renderTopPlayers();
});

// ---------- Matches box quick picks ----------

const COUNT_OPTIONS = ['25', '50', '100', '200', '300', 'All'];
const countInput = $('count');
const countList = $('countList');
let countActive = -1;

countList.innerHTML = COUNT_OPTIONS.map((o, i) =>
  `<li role="option" id="count-${i}" data-value="${o}" aria-selected="false">${o === 'All' ? 'All <span>(every match)</span>' : o}</li>`).join('');

function countHighlight() {
  countList.querySelectorAll('[role=option]').forEach((li, i) => li.setAttribute('aria-selected', String(i === countActive)));
  if (countActive >= 0) countInput.setAttribute('aria-activedescendant', `count-${countActive}`);
  else countInput.removeAttribute('aria-activedescendant');
}
function countOpen() {
  if (!countList.hidden) return;
  countList.hidden = false;
  countInput.setAttribute('aria-expanded', 'true');
  countActive = COUNT_OPTIONS.findIndex(o => o.toLowerCase() === countInput.value.trim().toLowerCase());
  countHighlight();
}
function countClose() {
  countList.hidden = true;
  countInput.setAttribute('aria-expanded', 'false');
  countInput.removeAttribute('aria-activedescendant');
}

countInput.addEventListener('focus', () => { countOpen(); countInput.select(); });
countInput.addEventListener('click', countOpen);
countInput.addEventListener('blur', () => setTimeout(countClose, 120));
countInput.addEventListener('input', () => { countActive = -1; countHighlight(); });
countInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    countOpen();
    const n = COUNT_OPTIONS.length;
    countActive = e.key === 'ArrowDown' ? (countActive + 1) % n : countActive < 0 ? n - 1 : (countActive - 1 + n) % n;
    countHighlight();
  } else if (e.key === 'Enter' && !countList.hidden && countActive >= 0) {
    e.preventDefault();
    countInput.value = COUNT_OPTIONS[countActive];
    countClose();
  } else if (e.key === 'Escape') {
    countClose();
  }
});
countList.addEventListener('mousedown', e => {
  const li = e.target.closest('[role=option]');
  if (!li) return;
  e.preventDefault();
  countInput.value = li.dataset.value;
  countClose();
});

// Support shareable links: ?player=Name
const initial = new URLSearchParams(location.search).get('player');
if (initial) { $('name').value = initial; search(initial); }
