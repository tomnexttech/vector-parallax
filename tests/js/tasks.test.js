// node --test tests/js/tasks.test.js — the visitor's own task list (browser storage only)
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTasks, saveTasks, addTask, toggleTask, removeTask, hasTask, TASK_KEY, MAX_TITLE } from '../../js/tasks.js';

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
