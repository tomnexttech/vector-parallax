/* tasks — the visitor's own list of things to look into. Kept in that browser only (localStorage); nothing leaves it.
 *
 *   loadTasks(store) -> [{ id, title, sid, link, at, done }]      saveTasks(store, list) -> bool
 *   addTask(list, { title, sid, link }, now) -> list (newest first; the same event or title is not added twice)
 *   toggleTask(list, id)  removeTask(list, id)  hasTask(list, sid) */

export const TASK_KEY = 'parallax.tasks.v1';
export const MAX_TASKS = 200;
export const MAX_TITLE = 200;
const ok = (t) => t && typeof t === 'object' && typeof t.id === 'string' && typeof t.title === 'string' && t.title.trim();

export function loadTasks(store) {
  try { const j = store ? JSON.parse(store.getItem(TASK_KEY) || 'null') : null; return Array.isArray(j) ? j.filter(ok).slice(0, MAX_TASKS) : []; } catch { return []; }
}
export function saveTasks(store, list) {
  try { if (!store) return false; store.setItem(TASK_KEY, JSON.stringify(list.slice(0, MAX_TASKS))); return true; } catch { return false; }
}
export function addTask(list, item, now) {
  const title = String((item && item.title) || '').trim().slice(0, MAX_TITLE);
  if (!title) return list;
  const sid = typeof item.sid === 'string' ? item.sid : '';
  if (list.some((x) => (sid && x.sid === sid) || x.title === title)) return list;
  const link = typeof item.link === 'string' && /^https?:\/\//.test(item.link) ? item.link : '';
  const at = Number.isFinite(now) ? now : Date.now();
  return [{ id: 't' + at.toString(36) + '-' + list.length.toString(36), title, sid, link, at, done: false }, ...list].slice(0, MAX_TASKS);
}
export const toggleTask = (list, id) => list.map((x) => (x.id === id ? { ...x, done: !x.done } : x));
export const removeTask = (list, id) => list.filter((x) => x.id !== id);
export const hasTask = (list, sid) => !!sid && list.some((x) => x.sid === sid);
