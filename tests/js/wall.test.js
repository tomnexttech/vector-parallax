import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallOn, levelOf, perOf, pageOf, pageHolding, PER_MANY } from '../../js/wall.js';
import { COUNTS, LAYOUTS, cleanView, loadView, saveView, countsFor, countIn, nextOf, VIEW_KEY } from '../../js/prefs.js';

const es = (n) => Array.from({ length: n }, (_, i) => ({ key: `k${i}` }));
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; };

test('the single event on the usual board is not a wall; every other choice is; the whole map keeps the middle', () => {
  assert.equal(wallOn({ layout: 'board', count: '1' }, 'case'), false);
  assert.equal(wallOn({ layout: 'board', count: '4' }, 'case'), true);
  assert.equal(wallOn({ layout: 'bundle', count: '1' }, 'case'), true);
  assert.equal(wallOn({ layout: 'list', count: '1' }, 'flat'), true);
  assert.equal(wallOn({ layout: 'list', count: '4' }, 'map'), false);
});

test('fewer events, more of each', () => {
  assert.deepEqual(COUNTS.map(levelOf), ['xl', 'xl', 'l', 'm', 's', 'xs']);
  assert.equal(perOf('many'), PER_MANY); assert.equal(perOf('6'), 6);
});

test('pages: the order stays, the last page is short, a page out of range comes back in', () => {
  const l = es(10);
  const a = pageOf(l, '4', 0);
  assert.deepEqual(a.items.map((x) => x.key), ['k0', 'k1', 'k2', 'k3']);
  assert.equal(a.pages, 3); assert.equal(a.from, 1); assert.equal(a.to, 4); assert.equal(a.total, 10);
  const c = pageOf(l, '4', 9);
  assert.equal(c.page, 2); assert.deepEqual(c.items.map((x) => x.key), ['k8', 'k9']); assert.equal(c.from, 9); assert.equal(c.to, 10);
  assert.deepEqual(pageOf([], '4', 0).items, []);
  assert.equal(pageOf([], '4', 0).from, 0);
});

test('pageHolding finds the page of the event in focus', () => {
  assert.equal(pageHolding(es(10), 'k5', '4'), 1);
  assert.equal(pageHolding(es(10), 'nope', '4'), null);
});

test('the choice is kept in this browser; a damaged value falls back field by field', () => {
  const s = mem();
  assert.deepEqual(loadView(s), { count: '1', layout: 'board' });
  assert.equal(saveView(s, { count: '6', layout: 'bundle' }), true);
  assert.deepEqual(loadView(s), { count: '6', layout: 'bundle' });
  s.setItem(VIEW_KEY, '{oops');
  assert.deepEqual(loadView(s), { count: '1', layout: 'board' });
  assert.deepEqual(cleanView({ count: 'x', layout: 'list' }), { count: '1', layout: 'list' });
  assert.deepEqual(cleanView({ count: 4, layout: 'nope' }), { count: '4', layout: 'board' });
  assert.deepEqual(loadView(null), { count: '1', layout: 'board' });
  assert.equal(saveView(null, { count: '6', layout: 'list' }), false);
  const broken = { getItem() { throw new Error('private'); }, setItem() { throw new Error('private'); } };
  assert.deepEqual(loadView(broken), { count: '1', layout: 'board' });
  assert.equal(saveView(broken, { count: '6', layout: 'list' }), false);
});

test('a small screen offers fewer counts, and a kept count falls to the nearest it can show', () => {
  assert.deepEqual(countsFor(1440, 900), COUNTS);
  assert.deepEqual(countsFor(390, 844), ['1', '2', '4']);
  assert.deepEqual(countsFor(844, 390), ['1', '2', '4', '6']);
  assert.equal(countIn('many', ['1', '2', '4']), '4');
  assert.equal(countIn('6', ['1', '2', '4']), '4');
  assert.equal(countIn('2', ['1', '2', '4']), '2');
});

test('the keys step round the choices', () => {
  assert.equal(nextOf(LAYOUTS, 'list'), 'board');
  assert.equal(nextOf(['1', '2', '4'], '2'), '4');
  assert.equal(nextOf(['1', '2', '4'], 'zz'), '1');
});
