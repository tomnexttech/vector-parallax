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
/* 自分の読み方: what the visitor opened, one entry per news (the latest open) with its reports by side, its field and its outlets'
 * types. Kept in that browser only; the page never sends it anywhere, and 記録を消す removes it.
 *   loadReads(store) -> list   saveReads(store, list) -> bool   clearReads(store) -> bool
 *   noteRead(list, { k, f, jp, intl, gov, types }, now) -> list   newest first, one per k
 *   readMix(list) -> { n, since, sides: { jp, intl, gov }, fields: [[field, n]], types: [[type, n]] }   counted, never scored */
export const READ_KEY = 'parallax.reads.v1';
export const MAX_READS = 300;
const cnt = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const okRead = (r) => r && typeof r === 'object' && typeof r.k === 'string' && r.k && Number.isFinite(r.at);
export function loadReads(store) {
  try { const j = store ? JSON.parse(store.getItem(READ_KEY) || 'null') : null; return Array.isArray(j) ? j.filter(okRead).slice(0, MAX_READS) : []; } catch { return []; }
}
export function saveReads(store, list) {
  try { if (!store) return false; store.setItem(READ_KEY, JSON.stringify(list.slice(0, MAX_READS))); return true; } catch { return false; }
}
export function clearReads(store) {
  try { if (!store) return false; store.removeItem(READ_KEY); return true; } catch { return false; }
}
export function noteRead(list, r, now) {
  if (!r || typeof r.k !== 'string' || !r.k) return list;
  const types = {};
  for (const [t, n] of Object.entries(r.types && typeof r.types === 'object' ? r.types : {})) if (t && cnt(n)) types[String(t).slice(0, 20)] = cnt(n);
  const x = { k: r.k.slice(0, 80), at: Number.isFinite(now) ? now : Date.now(), f: typeof r.f === 'string' ? r.f.slice(0, 20) : '', jp: cnt(r.jp), intl: cnt(r.intl), gov: cnt(r.gov), types };
  return [x, ...(Array.isArray(list) ? list : []).filter((y) => y.k !== x.k)].slice(0, MAX_READS);
}
export function readMix(list) {
  const ls = Array.isArray(list) ? list.filter(okRead) : [];
  const sides = { jp: 0, intl: 0, gov: 0 }, fields = new Map(), types = new Map();
  for (const r of ls) {
    for (const k of Object.keys(sides)) sides[k] += cnt(r[k]);
    if (r.f) fields.set(r.f, (fields.get(r.f) || 0) + 1);
    for (const [t, n] of Object.entries(r.types && typeof r.types === 'object' ? r.types : {})) types.set(t, (types.get(t) || 0) + cnt(n));
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
  return { n: ls.length, since: ls.length ? Math.min(...ls.map((r) => r.at)) : null, sides, fields: top(fields), types: top(types) };
}
export const toggleTask = (list, id) => list.map((x) => (x.id === id ? { ...x, done: !x.done } : x));
export const removeTask = (list, id) => list.filter((x) => x.id !== id);
export const hasTask = (list, sid) => !!sid && list.some((x) => x.sid === sid);
