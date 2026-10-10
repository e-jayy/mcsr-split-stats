import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierFor, percentile, rankLabel, population } from '../src/rank.js';

test('tier boundaries', () => {
  assert.equal(tierFor(5).key, 'netherite');
  assert.equal(tierFor(5.1).key, 'diamond');
  assert.equal(tierFor(20).key, 'diamond');
  assert.equal(tierFor(40).key, 'emerald');
  assert.equal(tierFor(60).key, 'gold');
  assert.equal(tierFor(60.1).key, 'iron');   // bottom 40%
  assert.equal(tierFor(80.1).key, 'coal');   // bottom 20%
  assert.equal(tierFor(100).key, 'coal');
});

test('percentile counts faster runs, ties half', () => {
  const pop = [10, 20, 30, 40];
  assert.equal(percentile(5, pop), 0);
  assert.equal(percentile(20, pop), 37.5);
  assert.equal(percentile(50, pop), 100);
  assert.equal(percentile(null, pop), null);
});

test('labels', () => {
  assert.equal(rankLabel(0.2), 'Top 1%');
  assert.equal(rankLabel(10), 'Top 10%');
  assert.equal(rankLabel(90.7), 'Bottom 9%');
});

test('population narrows by seed type only with enough samples', () => {
  const runs = [
    ...Array.from({ length: 40 }, (_, i) => ({ ow: 'VILLAGE', bt: 'BRIDGE', s: [i], f: null })),
    ...Array.from({ length: 5 }, (_, i) => ({ ow: 'SHIPWRECK', bt: 'BRIDGE', s: [i], f: null })),
  ];
  assert.equal(population({ runs }, 0, { ow: 'VILLAGE' }).values.length, 40);
  assert.equal(population({ runs }, 0, { ow: 'SHIPWRECK' }).narrowed, false);
  assert.equal(population({ runs }, 0, { ow: 'SHIPWRECK' }).values.length, 45);
});

test('playerPopulation uses one average per player with enough runs', async () => {
  const { playerPopulation } = await import('../src/rank.js');
  const sc = (m0, n0) => ({ m: [m0, null], n: [n0, 0], f: null, fn: 0 });
  const players = [
    ...Array.from({ length: 35 }, (_, i) => ({ scopes: { all: sc(100 + i, 5), 'ow:VILLAGE': sc(200 + i, 3) } })),
    { scopes: { all: sc(50, 2) } },                    // too few runs: left out
  ];
  const data = { players };
  assert.equal(playerPopulation(data, 0).values.length, 35);
  const v = playerPopulation(data, 0, { ow: 'VILLAGE' });
  assert.ok(v.narrowed);
  assert.equal(Math.min(...v.values), 200);
  assert.equal(playerPopulation(data, 0, { bt: 'HOUSING' }).narrowed, false);
  assert.equal(playerPopulation(data, 0, { ow: 'VILLAGE', bt: 'HOUSING' }).narrowed, false);
});

test('seedKey names single types and overworld + bastion pairs', async () => {
  const { seedKey, playerPopulation } = await import('../src/rank.js');
  assert.equal(seedKey(), 'all');
  assert.equal(seedKey({ ow: 'VILLAGE' }), 'ow:VILLAGE');
  assert.equal(seedKey({ bt: 'BRIDGE' }), 'bt:BRIDGE');
  assert.equal(seedKey({ ow: 'VILLAGE', bt: 'BRIDGE' }), 'ow:VILLAGE|bt:BRIDGE');
  assert.equal(seedKey({ ow: null, bt: '' }), 'all');
  // a pair narrows once enough players have pair averages
  const sc = v => ({ m: [v], n: [3], f: null, fn: 0 });
  const players = Array.from({ length: 30 }, (_, i) => ({ scopes: { all: sc(100 + i), 'ow:VILLAGE|bt:BRIDGE': sc(500 + i) } }));
  const p = playerPopulation({ players }, 0, { ow: 'VILLAGE', bt: 'BRIDGE' });
  assert.ok(p.narrowed);
  assert.equal(Math.min(...p.values), 500);
});
