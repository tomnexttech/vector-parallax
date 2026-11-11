/* demo — the page set for a booth: ?demo=1 puts 「最初から」 at the top right (it puts everything back as it was when the page opened),
 * goes back by itself after 90 seconds untouched (after a 10-second notice with 「続ける」, WCAG 2.2.1; never while the page reads aloud),
 * and can keep this edition of the data on this device (「この版で固定」) so that the same screen comes up when the hall's network fails.
 * The kept edition is the device's only (Cache Storage 'parallax-demo'); nothing is committed or sent. Its time is shown in the bar.
 *
 *   isDemo(search) -> bool
 *   RESET_STEPS                                     the names of what 「最初から」 puts back, in order
 *   runReset(steps) -> [names run]                  each step of RESET_STEPS the app gives, in order; a step that throws does not stop the rest
 *   createIdle({ win, limit, warn, held, onWarn, onReset, now }) -> { touch(), tick(), left(), stop() }
 *   FROZEN_FILES, FROZEN_KEY, DEMO_CACHE
 *   readFrozen(store) -> { at, gen } | null
 *   freeze({ caches, fetch, store, base, files, gen, now }) -> Promise<{ at, gen, n }>
 *   unfreeze({ caches, store }) -> Promise
 *   frozenFetch(fetch, caches, base) -> fetch      answers the kept files from the cache, everything else from the network
 *   demoKey(ev) -> 'reset' | 'prev' | 'next' | 'read' | null    the presenter's keys (none while typing) */

export const LIMIT_MS = 90 * 1000;
export const WARN_MS = 10 * 1000;
export const DEMO_CACHE = 'parallax-demo';
export const FROZEN_KEY = 'parallax.demo.v1';
export const FROZEN_FILES = ['latest.json', 'board.json', 'hero.json', 'relations.json', 'reaction.json', 'impact.json', 'labels.json'];
export const RESET_STEPS = ['speech', 'layers', 'search', 'order', 'genre', 'screen', 'reads', 'tasks', 'hero', 'scroll'];

export function isDemo(search) {
  try { return new URLSearchParams(search || '').get('demo') === '1'; } catch { return false; }
}

export function runReset(steps) {
  const done = [];
  for (const k of RESET_STEPS) {
    const f = steps && steps[k];
    if (typeof f !== 'function') continue;
    try { f(); done.push(k); } catch { /* one step that fails does not keep the rest from running */ }
  }
  return done;
}

export function createIdle({ limit = LIMIT_MS, warn = WARN_MS, held = () => false, onWarn, onReset, now = () => Date.now() } = {}) {
  let last = now(), warned = false, stopped = false;
  const call = (f, ...a) => { if (typeof f === 'function') f(...a); };
  return {
    touch() { last = now(); if (warned) { warned = false; call(onWarn, false); } },
    /** called every second: held (reading aloud) counts as being touched */
    tick() {
      if (stopped) return 'stopped';
      if (held()) { last = now(); if (warned) { warned = false; call(onWarn, false); } return 'held'; }
      const idle = now() - last;
      if (idle >= limit + warn) { warned = false; last = now(); call(onReset); return 'reset'; }
      if (idle >= limit) { if (!warned) { warned = true; } call(onWarn, true, Math.ceil((limit + warn - idle) / 1000)); return 'warn'; }
      return 'idle';
    },
    left: () => Math.max(0, limit + warn - (now() - last)),
    stop() { stopped = true; },
  };
}

export function readFrozen(store) {
  try {
    const j = store ? JSON.parse(store.getItem(FROZEN_KEY) || 'null') : null;
    return j && Number.isFinite(j.at) ? { at: j.at, gen: Number.isFinite(j.gen) ? j.gen : null } : null;
  } catch { return null; }
}

export async function freeze({ caches, fetch, store, base = 'data/', files = FROZEN_FILES, gen = null, now = Date.now() }) {
  if (!caches || typeof fetch !== 'function') throw new Error('no cache storage');
  const c = await caches.open(DEMO_CACHE);
  let n = 0;
  for (const f of files) {
    try {
      const res = await fetch(base + f, { cache: 'no-store', credentials: 'same-origin' });
      if (res && res.ok) { await c.put(base + f, res.clone()); n++; }
    } catch { /* a file this build does not have is left out */ }
  }
  if (!n) throw new Error('nothing kept');
  const meta = { at: now, gen: Number.isFinite(gen) ? gen : null };
  try { store.setItem(FROZEN_KEY, JSON.stringify(meta)); } catch { /* the cache still holds it; the time is shown for this visit only */ }
  return { ...meta, n };
}

export async function unfreeze({ caches, store }) {
  try { if (store) store.removeItem(FROZEN_KEY); } catch { /* */ }
  try { if (caches) await caches.delete(DEMO_CACHE); } catch { /* */ }
}

export function frozenFetch(fetch, caches, base = 'data/') {
  const names = new Set(FROZEN_FILES.map((f) => base + f));
  return async function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      const method = (init && init.method) || (input && input.method) || 'GET';
      const path = url ? url.replace(/^\.\//, '').replace(/^https?:\/\/[^/]+\/(?:[^?#]*\/)?(data\/)/, '$1').split(/[?#]/)[0] : '';
      if (method === 'GET' && names.has(path) && caches) {
        const c = await caches.open(DEMO_CACHE);
        const hit = await c.match(path);
        if (hit) return hit;
      }
    } catch { /* the network below */ }
    return fetch(input, init);
  };
}

export function demoKey(ev) {
  if (!ev || ev.metaKey || ev.ctrlKey || ev.altKey) return null;
  const t = ev.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return null;
  if (ev.key === 'r' || ev.key === 'R') return 'reset';
  if (ev.key === 'ArrowLeft') return 'prev';
  if (ev.key === 'ArrowRight') return 'next';
  if (ev.key === ' ' || ev.code === 'Space') { if (t && (t.tagName === 'BUTTON' || t.tagName === 'A')) return null; return 'read'; }
  return null;
}
