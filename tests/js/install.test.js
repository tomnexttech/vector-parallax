import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './helpers.js';
import { standalone, iosSafari, wantIosSheet, closeIosSheet, offlineLine, KEY } from '../../js/install.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), keys: () => [...m.keys()] }; };

test('iPhone and iPad Safari get the steps; Chrome on iOS and a Mac do not', () => {
  assert.equal(iosSafari(IPHONE), true);
  assert.equal(iosSafari(IPAD_AS_MAC, 5), true);
  assert.equal(iosSafari(IPAD_AS_MAC, 0), false);
  assert.equal(iosSafari(CHROME_IOS), false);
});

test('the steps show once: never when already on the home screen, never after they were closed', () => {
  const s = mem();
  assert.equal(wantIosSheet({ ua: IPHONE, store: s }), true);
  assert.equal(wantIosSheet({ ua: IPHONE, store: s, isStandalone: true }), false);
  closeIosSheet(s);
  assert.equal(wantIosSheet({ ua: IPHONE, store: s }), false);
  assert.deepEqual(s.keys(), [KEY]);
  // a private window throws: the steps may show again, nothing breaks
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(wantIosSheet({ ua: IPHONE, store: bad }), true);
  closeIosSheet(bad);
});

test('standalone: display-mode or the iOS flag', () => {
  assert.equal(standalone({ matchMedia: () => ({ matches: true }), navigator: {} }), true);
  assert.equal(standalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } }), true);
  assert.equal(standalone({ matchMedia: () => ({ matches: false }), navigator: {} }), false);
  assert.equal(standalone(null), false);
});

test('offline: the time of the data in hand, in red; nothing while online', () => {
  assert.equal(offlineLine({ online: true, generatedAt: 0 }), null);
  const x = offlineLine({ online: false, generatedAt: 1000, now: 1000 + 7.5 * 3600, clock: () => '11/11 15:13' });
  assert.deepEqual(x, { text: 'オフライン　11/11 15:13 のデータ（7 時間前）', bad: true });
  assert.equal(offlineLine({ online: false, generatedAt: null }).bad, true);
});

// the service worker, run in a sandbox: what it keeps and what it answers when the network is gone
function loadSw() {
  const src = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const L = {};
  const self = { addEventListener: (k, fn) => { L[k] = fn; }, location: { origin: 'https://site.test' }, skipWaiting: () => {}, clients: { claim: () => {} } };
  const store = new Map();
  const reloads = [];  // the install takes each file past the HTTP cache (cache: 'reload')
  const caches = {
    open: async () => ({ addAll: async (xs) => { for (const x of xs) { const k = typeof x === 'string' ? x : x.url; store.set(k, 'shell:' + k); if (typeof x !== 'string') reloads.push(x.cache); } }, put: async (req, res) => { store.set(new URL(req.url).pathname, res); } }),
    keys: async () => [], delete: async () => true,
    match: async (req) => { const p = typeof req === 'string' ? req : new URL(req.url).pathname; return store.get(p) || store.get(p.replace(/^\//, '')) || null; },
  };
  const ctx = vm.createContext({ self, caches, URL, Request: class { constructor(u, o) { this.url = u; this.cache = o && o.cache; } }, Response: { error: () => 'ERROR' }, fetch: async () => { throw new Error('offline'); }, Promise });
  vm.runInContext(src + '\n;globalThis.__SHELL = SHELL; globalThis.__CACHE = CACHE;', ctx);
  return { L, store, ctx, reloads };
}

test('the service worker keeps the app files, and answers a page from the cache when offline', async () => {
  const { L, store, ctx } = loadSw();
  for (const f of ['js/search.js', 'js/netview.js', 'js/install.js', 'js/mail.js', 'assets/icons/icon-maskable-512.png', 'index.html', 'manifest.webmanifest']) assert.ok(ctx.__SHELL.includes(f), f);
  for (const f of ctx.__SHELL) assert.ok(!/^https?:/.test(f) && f.length, f);
  let waited;
  L.install({ waitUntil: (p) => { waited = p; } });
  await waited;
  assert.ok(store.has('index.html'));
  // the data seen last: kept on the way in, answered when the network is gone
  store.set('/data/latest.json', 'LAST');
  let answer;
  L.fetch({ request: { method: 'GET', url: 'https://site.test/data/latest.json', mode: 'cors' }, respondWith: (p) => { answer = p; } });
  assert.equal(await answer, 'LAST');
  L.fetch({ request: { method: 'GET', url: 'https://site.test/news/whatever', mode: 'navigate' }, respondWith: (p) => { answer = p; } });
  assert.equal(await answer, 'shell:index.html');
});

test('every file the service worker keeps is in the repository', () => {
  const { ctx } = loadSw();
  for (const f of ctx.__SHELL) {
    if (f === './') continue;
    assert.doesNotThrow(() => readFileSync(path.join(ROOT, f)), f);
  }
});
