import test from 'node:test';
import assert from 'node:assert/strict';
import { quadMatrix, unquad, turnover } from '../../js/floor.js';
import { SCROLL, nextSpeed, backMs } from '../../js/autoscroll.js';

const fwd = (M, u, v) => { const [a, b, c, d, e, f, g, h] = M, w = g * u + h * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]; };

test('a point on the turned floor is carried back to the same place on the canvas', () => {
  // a trapezoid like the floor laid back: the far edge narrower and higher
  const q = [[120, 40], [520, 40], [640, 300], [0, 300]];
  const M = quadMatrix(q);
  for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5], [0.2, 0.8], [0.9, 0.1]]) {
    const [X, Y] = fwd(M, u, v);
    const back = unquad(M, X, Y);
    assert.ok(Math.abs(back[0] - u) < 1e-9 && Math.abs(back[1] - v) < 1e-9, `${u},${v} -> ${back}`);
  }
  assert.deepEqual(fwd(M, 0, 0), [120, 40]);
});

test('a flat floor is the plain offset', () => {
  const M = quadMatrix([[10, 20], [110, 20], [110, 70], [10, 70]]);
  const [u, v] = unquad(M, 60, 45);
  assert.ok(Math.abs(u - 0.5) < 1e-12 && Math.abs(v - 0.5) < 1e-12);
});

test('the scan line runs only for what was replaced, not for the first look', () => {
  assert.equal(turnover(null, new Set(['a'])), 0);
  assert.equal(turnover(new Set(['a', 'b']), new Set(['a', 'b'])), 0);
  assert.equal(turnover(new Set(['a', 'b', 'c', 'd']), new Set(['a', 'b', 'c', 'e'])), 0.5);
});

test('the list moves slowly, fills its speed, eases before the end, and goes back in 0.5 to 1.4 s', () => {
  let v = 0;
  for (let i = 0; i < 60; i++) v = nextSpeed(v, 1000, 0.05);   // 3 s far from the end
  assert.ok(v > SCROLL.pxs * 0.95 && v <= SCROLL.pxs);
  assert.ok(nextSpeed(0, 1000, 0.05) < SCROLL.pxs * 0.1);       // it starts slowly
  let w = SCROLL.pxs;
  for (let i = 0; i < 100; i++) w = nextSpeed(w, 4, 0.05);       // 4 px before the end
  assert.ok(w < SCROLL.pxs * 0.2);
  assert.equal(backMs(10), 500);
  assert.equal(backMs(100000), 1400);
});
