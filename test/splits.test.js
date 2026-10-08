import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trimMatch, runsForPlayer, summarize, fmt } from '../src/splits.js';

const A = 'aaa', B = 'bbb';
const ev = (uuid, time, type) => ({ uuid, time, type });

const match = trimMatch({
  id: 1, date: 0, season: 12, forfeited: false,
  seed: { overworld: 'SHIPWRECK', nether: 'BRIDGE' },
  result: { uuid: A, time: 500000 },
  completions: [{ uuid: A, time: 500000 }],
  timelines: [
    ev(A, 491000, 'projectelo.timeline.dragon_death'),
    ev(A, 450000, 'story.enter_the_end'),
    ev(A, 437000, 'story.follow_ender_eye'),
    ev(A, 360000, 'projectelo.timeline.blind_travel'),
    ev(A, 312000, 'nether.obtain_blaze_rod'),
    ev(A, 308000, 'nether.find_fortress'),
    ev(A, 226000, 'nether.loot_bastion'),
    ev(A, 142000, 'nether.find_bastion'),
    ev(A, 103000, 'story.enter_the_nether'),
    ev(A, 16000, 'story.smelt_iron'),
    // B: fortress first, then dies and resets
    ev(B, 90000, 'story.enter_the_nether'),
    ev(B, 120000, 'nether.find_fortress'),
    ev(B, 200000, 'nether.find_bastion'),
    ev(B, 250000, 'projectelo.timeline.reset'),
    ev(B, 300000, 'story.enter_the_nether'),
  ],
});

test('bastion-first run produces every split', () => {
  const [r] = runsForPlayer(match, A);
  assert.equal(r.route, 'bastion');
  assert.deepEqual(r.splits, {
    overworld: 103000, nether: 39000, bastion: 166000, fortress: 52000,
    blind: 77000, stronghold: 13000, end: 50000,
  });
  assert.equal(r.milestones.overworld['story.smelt_iron'], 16000);
  assert.equal(r.milestones.bastion['nether.loot_bastion'], 84000);
  assert.equal(r.milestones.fortress['nether.obtain_blaze_rod'], 4000);
  assert.equal(r.finish, 500000);
  assert.ok(r.won);
});

test('fortress-first run skips bastion-route splits', () => {
  const [r] = runsForPlayer(match, B);
  assert.equal(r.route, 'fortress');
  assert.equal(r.splits.overworld, 90000);
  assert.equal(r.splits.nether, undefined);
  assert.equal(r.splits.bastion, undefined);
});

test('resets split into attempts timed from the reset', () => {
  assert.equal(runsForPlayer(match, B).length, 1);
  const runs = runsForPlayer(match, B, { includeResets: true });
  assert.equal(runs.length, 2);
  assert.equal(runs[1].splits.overworld, 50000);
  const sum = summarize(runs);
  assert.equal(sum.matches, 1);
  assert.equal(sum.splits.overworld.mean, 70000);
});

test('fmt', () => {
  assert.equal(fmt(103000), '1:43.0');
  assert.equal(fmt(59960), '1:00.0');
  assert.equal(fmt(5400), '0:05.4');
  assert.equal(fmt(null), '—');
});
