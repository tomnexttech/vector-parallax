import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { isDemo, runReset, createIdle, readFrozen, freeze, unfreeze, frozenFetch, demoKey, RESET_STEPS, LIMIT_MS, WARN_MS, FROZEN_KEY, DEMO_CACHE } from '../../js/demo.js';

test('the booth is asked for by ?demo=1 only', () => {
  assert.equal(isDemo('?demo=1'), true);
  assert.equal(isDemo('?demo=0'), false);
  assert.equal(isDemo(''), false);
  assert.equal(isDemo('?x=1&demo=1'), true);
});

// a small model of the page: what 最初から has to put back
const INIT = () => ({ speaking: false, layers: [], q: '', order: 'all', genre: 'all', screen: 'home', reads: [], tasks: [], hero: 0, scroll: 0 });
function stepsFor(s) {
  const i = INIT();
  return {
    speech: () => { s.speaking = i.speaking; }, layers: () => { s.layers = []; }, search: () => { s.q = i.q; }, order: () => { s.order = i.order; },
    genre: () => { s.genre = i.genre; }, screen: () => { s.screen = i.screen; }, reads: () => { s.reads = []; }, tasks: () => { s.tasks = []; }, hero: () => { s.hero = i.hero; }, scroll: () => { s.scroll = i.scroll; },
  };
}

test('最初から: every part changed comes back to the first state, in order, even when one part fails', () => {
  const s = { speaking: true, layers: ['sheet', 'flow'], q: '米国', order: 'popular', genre: '経済', screen: 'compare', reads: [{ k: 'a' }], tasks: [{ id: 1 }], hero: 3, scroll: 900 };
  const done = runReset(stepsFor(s));
  assert.deepEqual(done, RESET_STEPS);
  assert.deepEqual(s, INIT());
  const s2 = { ...INIT(), q: 'x', tasks: [1] };
  const st = stepsFor(s2);
  st.genre = () => { throw new Error('gone'); };
  assert.deepEqual(runReset(st), RESET_STEPS.filter((k) => k !== 'genre'));
  assert.deepEqual([s2.q, s2.tasks], ['', []]);
});

test('the app gives a step for every name of 最初から', () => {
  const app = readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const body = app.slice(app.indexOf('function hxReset()'), app.indexOf('function hxWarn('));
  for (const k of RESET_STEPS) assert.match(body, new RegExp(`\\b${k}: \\(\\) =>`), k);
});

test('90 seconds untouched: a notice with 続ける for 10 seconds, then back to the start; reading aloud is not counted', () => {
  let t = 0, warned = [], resets = 0, held = false;
  const idle = createIdle({ now: () => t, held: () => held, onWarn: (on, sec) => warned.push([on, sec]), onReset: () => { resets++; } });
  t = LIMIT_MS - 1; assert.equal(idle.tick(), 'idle');
  t = LIMIT_MS; assert.equal(idle.tick(), 'warn');
  assert.deepEqual(warned.at(-1), [true, 10]);
  idle.touch();   // 続ける
  assert.equal(warned.at(-1)[0], false);
  t += LIMIT_MS + WARN_MS - 1; assert.equal(idle.tick(), 'warn');
  t += 1; assert.equal(idle.tick(), 'reset');
  assert.equal(resets, 1);
  held = true; t += LIMIT_MS * 3; assert.equal(idle.tick(), 'held');
  held = false; assert.equal(idle.tick(), 'idle', 'the time read aloud did not count');
  idle.stop(); t += LIMIT_MS * 2; assert.equal(idle.tick(), 'stopped');
});

test('the presenter\'s keys, never while typing', () => {
  assert.equal(demoKey({ key: 'r', target: { tagName: 'DIV' } }), 'reset');
  assert.equal(demoKey({ key: 'R', target: { tagName: 'BODY' } }), 'reset');
  assert.equal(demoKey({ key: 'ArrowRight', target: {} }), 'next');
  assert.equal(demoKey({ key: 'ArrowLeft', target: {} }), 'prev');
  assert.equal(demoKey({ key: ' ', target: { tagName: 'DIV' } }), 'read');
  assert.equal(demoKey({ key: ' ', target: { tagName: 'BUTTON' } }), null, 'space on a button presses the button');
  assert.equal(demoKey({ key: 'r', target: { tagName: 'INPUT' } }), null);
  assert.equal(demoKey({ key: 'r', ctrlKey: true, target: {} }), null);
  assert.equal(demoKey({ key: 'x', target: {} }), null);
});

// Cache Storage and localStorage in memory
function fakes() {
  const boxes = new Map(), mem = new Map();
  const caches = {
    open: async (name) => { if (!boxes.has(name)) boxes.set(name, new Map()); const m = boxes.get(name); return { put: async (k, v) => { m.set(k, v); }, match: async (k) => m.get(k) }; },
    delete: async (name) => boxes.delete(name),
  };
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  return { boxes, caches, store, mem };
}
const res = (body, ok = true) => ({ ok, body, clone() { return res(body, ok); } });

test('この版で固定: the files of this edition are kept on the device, read from there, and let go again', async () => {
  const { boxes, caches, store } = fakes();
  const net = [];
  const fetch = async (u) => { net.push(u); return u.endsWith('impact.json') ? res('', false) : res('net:' + u); };
  const r = await freeze({ caches, fetch, store, base: 'data/', files: ['latest.json', 'board.json', 'impact.json'], gen: 1794377596, now: 5000 });
  assert.deepEqual(r, { at: 5000, gen: 1794377596, n: 2 });
  assert.deepEqual(readFrozen(store), { at: 5000, gen: 1794377596 });
  assert.deepEqual([...boxes.get(DEMO_CACHE).keys()], ['data/latest.json', 'data/board.json']);
  const ff = frozenFetch(async (u) => res('live:' + (typeof u === 'string' ? u : u.url)), caches, 'data/');
  assert.equal((await ff('data/latest.json', { cache: 'no-store' })).body, 'net:data/latest.json', 'the kept file, not the network');
  assert.equal((await ff('https://example.github.io/vector-parallax/data/board.json?x=1')).body, 'net:data/board.json');
  assert.equal((await ff('data/hazards.json')).body, 'live:data/hazards.json', 'a file not kept comes from the network');
  assert.equal((await ff('data/latest.json', { method: 'POST' })).body, 'live:data/latest.json');
  await unfreeze({ caches, store });
  assert.equal(readFrozen(store), null);
  assert.equal(boxes.has(DEMO_CACHE), false);
  assert.equal(store.getItem(FROZEN_KEY), null);
  await assert.rejects(freeze({ caches, fetch: async () => res('', false), store, files: ['latest.json'] }), /nothing kept/);
});
