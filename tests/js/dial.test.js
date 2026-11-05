import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detent, tapStep, fade, nrm, MARK, RINGS, PHONE } from '../../js/dial.js';

test('a ring rests on the nearest step and never past either end', () => {
  assert.equal(detent(2.4, 10), 2);
  assert.equal(detent(2.6, 10), 3);
  assert.equal(detent(-0.4, 10), 0);
  assert.equal(detent(9.4, 10), 9);
  assert.equal(detent(3, 0), 0);
});

test('a tap turns the touched step to the mark', () => {
  const P = RINGS[1].P;
  assert.equal(tapStep(4, MARK, P, 10), 4);
  assert.equal(tapStep(4, MARK + P, P, 10), 5);
  assert.equal(tapStep(4, MARK - 2 * P, P, 10), 2);
  assert.equal(tapStep(0, MARK - 3 * P, P, 10), 0);
});

test('steps fade out toward the edges of the quarter', () => {
  const P = RINGS[0].P;
  assert.equal(fade(0, P), 1);
  assert.ok(fade(1.5, P) < 1 && fade(1.5, P) > 0);
  assert.equal(fade(3, P), 0);
  assert.equal(nrm(350), -10);
  assert.equal(nrm(-190), 170);
});

test('the dial is for phones only', () => {
  assert.match(PHONE, /max-width: 760px/);
  assert.match(PHONE, /max-height: 500px/);
});
