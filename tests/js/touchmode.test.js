import test from 'node:test';
import assert from 'node:assert/strict';
import { isCoarse, touchLive, nearTap } from '../../js/touchmode.js';

// a page, as far as the module reads it: <html data-*>, #app[data-lp], #board[data-floor], and the media queries
const page = ({ root = {}, lp = null, floor = null, sideways = false, coarse = true } = {}) => {
  const els = { app: lp ? { dataset: { lp } } : { dataset: {} }, board: floor ? { dataset: { floor } } : null };
  const doc = { documentElement: { dataset: root }, getElementById: (id) => els[id] || null };
  const win = { matchMedia: (q) => ({ matches: /pointer: coarse/.test(q) ? coarse : /orientation: landscape/.test(q) ? sideways : false }) };
  return { doc, win };
};

test('the 地図 screen, the opened map and the sideways map pane take one finger', () => {
  assert.equal(touchLive(page({ root: { sect: 'map' }, floor: 'flat' })), true);
  assert.equal(touchLive(page({ root: { mapfull: '1' }, floor: 'flat' })), true);
  assert.equal(touchLive(page({ sideways: true, lp: 'p-map', floor: 'flat' })), true);
  assert.equal(touchLive(page({ floor: 'map' })), true);
});

test('the small map that lies in a page a finger scrolls does not', () => {
  assert.equal(touchLive(page({ floor: 'flat' })), false);
  assert.equal(touchLive(page({ floor: 'case' })), false);
  assert.equal(touchLive(page({ sideways: true, lp: 'p-case', floor: 'flat' })), false);
  assert.equal(touchLive(page({ sideways: false, lp: 'p-map', floor: 'flat' })), false, 'the pane of a phone held upright is a part of the page');
  assert.equal(touchLive(page({ root: { sect: 'home' }, floor: 'flat' })), false);
});

test('a screen made for fingers is told from a mouse', () => {
  assert.equal(isCoarse(page({ coarse: true }).win), true);
  assert.equal(isCoarse(page({ coarse: false }).win), false);
  assert.equal(isCoarse({}), false, 'no matchMedia: not a finger');
});

test('a second tap that comes soon and near is a double tap; a slow or far one is not', () => {
  const a = { t: 1000, x: 100, y: 100 };
  assert.equal(nearTap(a, { t: 1200, x: 110, y: 96 }), true);
  assert.equal(nearTap(a, { t: 1400, x: 100, y: 100 }), false);
  assert.equal(nearTap(a, { t: 1100, x: 200, y: 100 }), false);
  assert.equal(nearTap(null, { t: 1100, x: 100, y: 100 }), false);
});
