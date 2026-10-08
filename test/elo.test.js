import { test } from 'node:test';
import assert from 'node:assert/strict';
import { divisionFor, divisionCounts, eloPercentile } from '../src/elo.js';

test('division boundaries', () => {
  assert.equal(divisionFor(0).name, 'Coal I');
  assert.equal(divisionFor(599).name, 'Coal III');
  assert.equal(divisionFor(600).name, 'Iron I');
  assert.equal(divisionFor(1649).name, 'Diamond I');
  assert.equal(divisionFor(1650).name, 'Diamond II');
  assert.equal(divisionFor(1999).name, 'Diamond III');
  assert.equal(divisionFor(2000).name, 'Netherite');
  assert.equal(divisionFor(2600).name, 'Netherite');
});

test('histogram rolls up into divisions and percentiles', () => {
  const counts = [];
  counts[50] = 2;    // 500-509 -> Coal III
  counts[100] = 6;   // 1000-1009 -> Gold II
  counts[210] = 2;   // 2100-2109 -> Netherite
  const hist = { step: 10, counts: Array.from(counts, c => c || 0) };
  const div = divisionCounts(hist);
  assert.equal(div[2], 2);
  assert.equal(div[7], 6);
  assert.equal(div[15], 2);
  assert.equal(eloPercentile(1005, hist), 50);   // 2 below + half of 6 = 5 of 10
  assert.equal(eloPercentile(2500, hist), 100);
  assert.equal(eloPercentile(null, hist), null);
});
