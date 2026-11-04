// node --test tests/js/prefs.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWatch, saveWatch, addWatch, removeWatch, hitsOf, WATCH_KEY, MAX_TERMS, MAX_LEN } from '../../js/prefs.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

test('add trims, folds case and width, and keeps no duplicates', () => {
  let l = addWatch([], '  北朝鮮 ');
  l = addWatch(l, '北朝鮮');
  l = addWatch(l, 'ＢＯＪ');
  l = addWatch(l, 'boj');
  assert.deepEqual(l, ['北朝鮮', 'ＢＯＪ']);
  assert.equal(addWatch([], 'x'.repeat(99))[0].length, MAX_LEN);
  let many = [];
  for (let i = 0; i < 30; i++) many = addWatch(many, 'w' + i);
  assert.equal(many.length, MAX_TERMS);
  assert.deepEqual(removeWatch(['A', 'b'], 'a'), ['b']);
});

test('saved only in the given storage; broken or missing storage does not throw', () => {
  const s = mem();
  assert.equal(saveWatch(s, ['米国', '米国']), true);
  assert.equal(s.m.get(WATCH_KEY), '["米国"]');
  assert.deepEqual(loadWatch(s), ['米国']);
  s.setItem(WATCH_KEY, '{not json');
  assert.deepEqual(loadWatch(s), []);
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadWatch(bad), []);
  assert.equal(saveWatch(bad, ['a']), false);
  assert.deepEqual(loadWatch(null), []);
});

test('hits are case and width insensitive', () => {
  assert.deepEqual(hitsOf(['boj', '台湾'], '日銀 BOJ が据え置き'), ['boj']);
  assert.deepEqual(hitsOf(['x'], ''), []);
});
