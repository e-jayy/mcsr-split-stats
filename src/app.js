import { getUser, loadMatches, clearCache } from './api.js';
import {
  SPLITS, MILESTONE_NAMES, OVERWORLD_TYPES, BASTION_TYPES,
  runsForPlayer, summarize, groupBy, prettyType, fmt,
} from './splits.js';
import { TIERS, tierFor, percentile, rankLabel, population, tierIcon } from './rank.js';

const $ = id => document.getElementById(id);

// Split times from a sample of everyone's recent ranked matches (scripts/build-baseline.js).
let baseline = null;
const baselineReady = fetch('data/baseline.json')
  .then(r => (r.ok ? r.json() : null))
  .then(b => { baseline = b; describeBaseline(b); })
  .catch(() => {});

const state = {
  user: null,
  matches: [],
  ow: null,          // overworld type filter
  bt: null,          // bastion type filter
  // Column sort per table: { col, dir } where dir 1 = ascending, -1 = descending.
  sort: { splits: { col: 'order', dir: 1 }, ow: { col: 'order', dir: 1 }, bt: { col: 'order', dir: 1 } },
  includeResets: false,
  open: new Set(),   // expanded split rows
};

function describeBaseline(b) {
  if (!b) return;
  const date = new Date(b.generatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  $('baselineMatches').textContent = b.matches.toLocaleString();
  $('baselineSeason').textContent = b.season ? ` of season ${b.season}` : '';
  $('baselineDate').textContent = date;
}

// ---------- search ----------

$('search').addEventListener('submit', e => {
  e.preventDefault();
  search($('name').value);
});

async function search(name) {
  if (!name.trim()) return;
  const go = $('go');
  go.disabled = true;
  setStatus('Looking up player…');
  try {
    const user = await getUser(name);
    const opts = {
      count: Number($('count').value),
      type: $('type').value,
      season: $('season').value,
    };
    setStatus(`Loading ${user.nickname}'s matches…`);
    const matches = await loadMatches(user.uuid, opts, p => {
      if (p.waiting) setStatus(`Hit the API rate limit, waiting ${Math.round(p.waiting / 1000)}s…`);
      else setStatus(`Loading match timelines ${p.done}/${p.total}`, p.done / Math.max(1, p.total));
    });
    if (!matches.length) throw new Error(`${user.nickname} has no matches for these settings.`);
    await baselineReady;
    Object.assign(state, { user, matches, ow: null, bt: null, open: new Set() });
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
  renderPlayer(summarize(runs));
  renderChips(runs);
  const sum = summarize(filterRuns(runs));
  const ranks = rankSplits(sum);
  renderPerformance(sum, ranks);
  renderSplits(sum, ranks);
  renderOverworld(filterRuns(runs, { ow: null }));
  renderBastion(filterRuns(runs, { bt: null }));
}

function renderPlayer(sum) {
  const u = state.user;
  const pct = sum.matches ? Math.round((sum.wins / sum.matches) * 100) : 0;
  $('player').innerHTML = `
    <div class="name"><img src="https://mc-heads.net/avatar/${u.uuid}/36" alt="">${esc(u.nickname)}</div>
    <div class="kpis">
      <div class="kpi"><b>${u.eloRate ?? '—'}</b><span>Elo${u.eloRank ? ` · #${u.eloRank}` : ''}</span></div>
      <div class="kpi"><b>${sum.matches}</b><span>Matches analyzed</span></div>
      <div class="kpi"><b>${pct}%</b><span>Win rate</span></div>
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

// Percentile + tier for every split (and finish) against the baseline.
function rankSplits(sum) {
  if (!baseline) return null;
  const out = {};
  const rank = (key, i, value) => {
    const pop = population(baseline, i, { ow: state.ow, bt: state.bt });
    const pct = percentile(value, pop.values);
    out[key] = pct == null ? null : { pct, tier: tierFor(pct), label: rankLabel(pct) };
  };
  SPLITS.forEach((s, i) => rank(s.key, i, val(sum.splits[s.key])));
  rank('finish', 'finish', val(sum.finish));
  return out;
}

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

function renderSplits(sum, ranks) {
  const parts = [state.ow && prettyType(state.ow), state.bt && prettyType(state.bt)].filter(Boolean);
  $('splitsNote').textContent =
    `${sum.runs} runs${parts.length ? ` on ${parts.join(' + ')}` : ''}` +
    (sum.fortressFirst ? ` · ${sum.fortressFirst} fortress-first` : '');

  // Stacked bar of average time per split.
  const total = SPLITS.reduce((t, s) => t + (val(sum.splits[s.key]) || 0), 0);
  $('splitBar').innerHTML = SPLITS.map(s => {
    const v = val(sum.splits[s.key]);
    if (!v) return '';
    const w = (v / total) * 100;
    return `<div style="width:${w}%;background:var(--s-${s.key})" title="${s.name}: ${fmt(v)}">${w > 9 ? s.name.split(' ')[0] : ''}</div>`;
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

// Pivot table: one row per seed type; every column is sortable.
function renderPivot(table, runs, key, order, columns) {
  const groups = groupBy(runs, key, order);
  const winRate = s => (s.matches ? s.wins / s.matches : null);
  const cols = [
    { key: 'order', label: 'Type',  dir: 1,  get: ([t]) => (order.includes(t) ? order.indexOf(t) : order.length) },
    { key: 'runs',  label: 'Runs',  dir: -1, get: ([, s]) => s.runs },
    { key: 'win',   label: 'Win %', dir: -1, get: ([, s]) => winRate(s) },
    ...columns.map((c, j) => ({ key: `c${j}`, label: c.label, tip: c.tip, dir: 1, get: ([, s]) => c.get(s) })),
  ];
  const { col, dir } = state.sort[key];
  const rows = sortBy(groups, (cols.find(c => c.key === col) || cols[0]).get, dir);

  // Fastest / slowest per time column (types with at least 3 runs).
  const extremes = columns.map(c => {
    const vs = groups.filter(([, s]) => s.runs >= 3).map(([, s]) => c.get(s)).filter(v => v != null);
    return vs.length >= 2 ? [Math.min(...vs), Math.max(...vs)] : null;
  });

  let html = sortHeader(key, cols) + '<tbody>';
  for (const [type, s] of rows) {
    const wr = winRate(s);
    html += `<tr data-type="${esc(type)}" class="${state[key] === type ? 'active' : ''}">
      <td>${prettyType(type)}</td><td class="n">${s.runs}</td><td>${wr == null ? '—' : Math.round(wr * 100) + '%'}</td>`;
    columns.forEach((c, j) => {
      const v = c.get(s);
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
    { label: 'Fortress split', tip: 'Fortress Enter to Blind', get: s => val(s.splits.fortress) },
    { label: 'Finish', get: s => val(s.finish) },
  ]);
}

// Support shareable links: ?player=Name
const initial = new URLSearchParams(location.search).get('player');
if (initial) { $('name').value = initial; search(initial); }
