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
