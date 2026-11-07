// node --test tests/js/tasks.test.js — the visitor's own task list (browser storage only)
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTasks, saveTasks, addTask, toggleTask, removeTask, hasTask, TASK_KEY, MAX_TITLE, loadReads, saveReads, clearReads, noteRead, readMix, READ_KEY, MAX_READS } from '../../js/tasks.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

test('add keeps one per event and per title, newest first, and a bad link is not kept', () => {
  let l = addTask([], { title: ' 台風31号 ', sid: 's1', link: 'https://example.org/a' }, 1000);
  l = addTask(l, { title: '別の見出し', sid: 's1' }, 2000);
  l = addTask(l, { title: '台風31号' }, 3000);
  l = addTask(l, { title: '日銀', link: 'javascript:alert(1)' }, 4000);
  assert.equal(l.length, 2);
  assert.equal(l[0].title, '日銀'); assert.equal(l[0].link, '');
  assert.equal(l[1].link, 'https://example.org/a');
  assert.ok(hasTask(l, 's1')); assert.ok(!hasTask(l, 's2')); assert.ok(!hasTask(l, ''));
  assert.equal(addTask([], { title: 'x'.repeat(999) }, 1)[0].title.length, MAX_TITLE);
  assert.deepEqual(addTask([], { title: '  ' }, 1), []);
});

test('toggle, remove, and the round trip through storage; broken storage gives an empty list', () => {
  const st = mem();
  let l = addTask([], { title: 'a', sid: 's1' }, 1);
  l = toggleTask(l, l[0].id); assert.equal(l[0].done, true);
  assert.ok(saveTasks(st, l));
  assert.deepEqual(loadTasks(st), l);
  assert.deepEqual(removeTask(l, l[0].id), []);
  st.setItem(TASK_KEY, '{not json'); assert.deepEqual(loadTasks(st), []);
  st.setItem(TASK_KEY, JSON.stringify([{ id: 1 }, null, { id: 'ok', title: 'b' }])); assert.equal(loadTasks(st).length, 1);
  assert.deepEqual(loadTasks(null), []); assert.equal(saveTasks(null, l), false);
});

test('自分の読み方: one entry per news, newest first, counted by side, field and type; this browser only, cleared on request', () => {
  const mem = new Map(); const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  let l = [];
  l = noteRead(l, { k: 'a', f: '国際', jp: 2, intl: 3, gov: 0, types: { 全国紙: 2, 海外主流: 3 } }, 100);
  l = noteRead(l, { k: 'b', f: '経済', jp: 1, intl: 0, gov: 1, types: { 通信社: 1, 政府一次: 1 } }, 200);
  l = noteRead(l, { k: 'a', f: '国際', jp: 2, intl: 3, gov: 0, types: { 全国紙: 2, 海外主流: 3 } }, 300);
  assert.deepEqual(l.map((x) => x.k), ['a', 'b']);
  assert.equal(noteRead(l, { k: '' }, 1), l);
  const m = readMix(l);
  assert.equal(m.n, 2); assert.equal(m.since, 200);
  assert.deepEqual(m.sides, { jp: 3, intl: 3, gov: 1 });
  assert.deepEqual(m.fields, [['経済', 1], ['国際', 1]]);
  assert.deepEqual(m.types[0], ['海外主流', 3]);
  assert.equal(noteRead([], { k: 'x', jp: -1, intl: 1.5, types: { a: 'z' } }, 1)[0].jp, 0);
  assert.ok(saveReads(store, l)); assert.deepEqual(loadReads(store).map((x) => x.k), ['a', 'b']);
  assert.ok(clearReads(store)); assert.equal(store.getItem(READ_KEY), null); assert.deepEqual(loadReads(store), []);
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(loadReads(bad), []); assert.equal(saveReads(bad, l), false); assert.equal(clearReads(bad), false); assert.equal(saveReads(null, l), false);
  let many = []; for (let i = 0; i < MAX_READS + 5; i++) many = noteRead(many, { k: 'k' + i, jp: 1 }, i);
  assert.equal(many.length, MAX_READS);
  assert.deepEqual(readMix(null), { n: 0, since: null, sides: { jp: 0, intl: 0, gov: 0 }, fields: [], types: [] });
});
