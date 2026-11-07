/* prefs — what a visitor chose to watch. Kept only in that visitor's browser (localStorage); never sent anywhere.
 *
 *   loadWatch(storage) -> [term]          storage may be missing or throw (private window): returns []
 *   saveWatch(storage, list) -> boolean   false when it could not be kept (the list still works for this visit)
 *   addWatch(list, term) -> [term]        trimmed, at most 40 characters, no duplicates (NFKC, case-insensitive), at most 20
 *   removeWatch(list, term) -> [term]
 *   hitsOf(list, text) -> [term]          the watched terms found in a text
 *   terms(list, max, len) -> [term]       the same cleaning for any list of words (js/settings.js uses it for the muted words)
 *   cleanView(x) / loadView(storage) / saveView(storage, v)   how many events at a time and how they are laid out: { count, layout }
 *   countsFor(width, height) -> [count]   the counts a screen of this size offers; countIn(count, allowed) -> the nearest it can show
 *   nextOf(list, v) -> the next choice, round again at the end */

export const WATCH_KEY = 'parallax.watch.v1';
export const MAX_TERMS = 20;
export const MAX_LEN = 40;

export const fold = (s) => (typeof s === 'string' ? s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim() : '');

export function terms(list, max = MAX_TERMS, len = MAX_LEN) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(list) ? list : []) {
    if (typeof x !== 'string') continue;
    const t = x.replace(/\s+/g, ' ').trim().slice(0, len);
    const k = fold(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
const clean = (list) => terms(list);

export function loadWatch(storage) {
  try {
    const raw = storage ? storage.getItem(WATCH_KEY) : null;
    return raw ? clean(JSON.parse(raw)) : [];
  } catch { return []; }
}

export function saveWatch(storage, list) {
  try {
    if (!storage) return false;
    storage.setItem(WATCH_KEY, JSON.stringify(clean(list)));
    return true;
  } catch { return false; }
}

export function addWatch(list, term) {
  return clean([...(Array.isArray(list) ? list : []), term]);
}

export function removeWatch(list, term) {
  const k = fold(term);
  return clean(list).filter((x) => fold(x) !== k);
}

export function hitsOf(list, text) {
  const t = fold(text);
  if (!t) return [];
  return clean(list).filter((x) => t.includes(fold(x)));
}

// ---------------------------------------------------------------- how many at a time, and how they are laid out (js/wall.js)
export const VIEW_KEY = 'parallax.view.v1';
export const COUNTS = ['1', '2', '4', '6', '9', 'many'];
export const LAYOUTS = ['board', 'bundle', 'list'];
export const COUNT_JA = { 1: '1', 2: '2', 4: '4', 6: '6', 9: '9', many: '多い' };
export const LAYOUT_JA = { board: '標準', bundle: '主役', list: '一覧' };

export function cleanView(x) {
  const o = x && typeof x === 'object' ? x : {};
  const c = String(o.count);
  return { count: COUNTS.includes(c) ? c : '1', layout: LAYOUTS.includes(o.layout) ? o.layout : 'board' };
}
export function loadView(storage) {
  try {
    const raw = storage ? storage.getItem(VIEW_KEY) : null;
    return cleanView(raw ? JSON.parse(raw) : null);
  } catch { return cleanView(null); }
}
export function saveView(storage, v) {
  try {
    if (!storage) return false;
    storage.setItem(VIEW_KEY, JSON.stringify(cleanView(v)));
    return true;
  } catch { return false; }
}
/** a phone held upright: up to 4; held sideways: up to 6; else everything */
export function countsFor(width, height) {
  if (width <= 560) return COUNTS.slice(0, 3);
  if (height <= 500) return COUNTS.slice(0, 4);
  return COUNTS;
}
export function countIn(count, allowed) {
  if (allowed.includes(count)) return count;
  const i = COUNTS.indexOf(count);
  for (let k = i; k >= 0; k--) if (allowed.includes(COUNTS[k])) return COUNTS[k];
  return allowed[0];
}
export function nextOf(list, v) {
  const i = list.indexOf(v);
  return list[(i + 1) % list.length];
}
