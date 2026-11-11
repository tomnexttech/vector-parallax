import test from 'node:test';
import assert from 'node:assert/strict';
import { mountOrb, fib, orbColour, STATES } from '../../js/orb.js';

// a canvas that takes every call, and a window that counts the frames asked for
function rig({ hidden = false, reduced = false } = {}) {
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const listeners = {};
  const doc = { hidden, documentElement: { hasAttribute: () => false }, createElement: () => ({ setAttribute() {}, getContext: () => ctx, remove() {}, width: 0, height: 0 }),
    addEventListener: (k, f) => { listeners[k] = f; }, removeEventListener: (k) => { delete listeners[k]; } };
  const raf = [];
  const win = { devicePixelRatio: 1, matchMedia: (q) => ({ matches: reduced && /reduce/.test(q) }), requestAnimationFrame: (f) => { raf.push(f); return raf.length; }, cancelAnimationFrame() {}, performance: { now: () => 1000 } };
  const host = { append() {}, getBoundingClientRect: () => ({ width: 200, height: 200 }) };
  return { doc, win, host, raf, listeners };
}

test('hidden: not one frame is asked for, and none is drawn', () => {
  const r = rig({ hidden: true });
  const o = mountOrb(r.host, { win: r.win, doc: r.doc });
  o.setState('speaking'); o.pulse(); o.setBands([1, 1, 1, 1]);
  assert.equal(r.raf.length, 0, 'requestAnimationFrame is never called while the page is hidden');
  assert.equal(o.drawn(), 0);
  // shown again: it starts
  r.doc.hidden = false; r.listeners.visibilitychange();
  assert.equal(r.raf.length, 1);
  o.destroy();
});

test('reduced motion: one still frame per change, then no frame is asked for', () => {
  const r = rig({ reduced: true });
  const o = mountOrb(r.host, { win: r.win, doc: r.doc });
  assert.equal(r.raf.length, 1);
  r.raf.shift()(1000);
  assert.equal(o.drawn(), 1);
  assert.equal(r.raf.length, 0, 'no next frame');
  o.setState('speaking');
  assert.equal(r.raf.length, 1, 'a change draws one more still frame');
  r.raf.shift()(1016);
  assert.equal(r.raf.length, 0);
  assert.equal(o.drawn(), 2);
  o.destroy();
});

test('speaking runs at the frame rate; idle waits between frames; an unknown state is idle; error is still', () => {
  const r = rig();
  const o = mountOrb(r.host, { win: r.win, doc: r.doc });
  o.setState('speaking');
  r.raf.shift()(1000);
  assert.equal(r.raf.length, 1, 'speaking asks for the next frame at once');
  o.setState('nonsense'); assert.equal(o.state(), 'idle');
  o.setState('error');
  r.raf.shift()(1016);
  assert.equal(r.raf.length, 0, 'error is drawn once and stays still');
  assert.deepEqual(STATES, ['idle', 'thinking', 'speaking', 'error']);
  o.destroy();
});

test('the colours: ice white, white, red; no yellow, green or orange', () => {
  assert.deepEqual(orbColour('speaking'), [246, 251, 253]);
  assert.deepEqual(orbColour('error'), [240, 104, 92]);
  for (const s of STATES) { const [r, g, b] = orbColour(s); if (s !== 'error') assert.ok(b >= r && b >= g - 30, `${s} is a cold white`); }
  const pts = fib(100, () => 0.5);
  assert.equal(pts.length, 100);
  for (const p of pts) assert.ok(Math.abs(Math.hypot(p.x, p.y, p.z) - 1) < 1e-9);
});
