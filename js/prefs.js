/* prefs — what a visitor chose to watch. Kept only in that visitor's browser (localStorage); never sent anywhere.
 *
 *   loadWatch(storage) -> [term]          storage may be missing or throw (private window): returns []
 *   saveWatch(storage, list) -> boolean   false when it could not be kept (the list still works for this visit)
 *   addWatch(list, term) -> [term]        trimmed, at most 40 characters, no duplicates (NFKC, case-insensitive), at most 20
 *   removeWatch(list, term) -> [term]
 *   hitsOf(list, text) -> [term]          the watched terms found in a text
 *   terms(list, max, len) -> [term]       the same cleaning for any list of words (js/settings.js uses it for the muted words) */

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
