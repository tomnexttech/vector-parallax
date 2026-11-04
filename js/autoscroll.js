/* autoscroll — a list that does not fit in its pane scrolls itself, slowly, and stops for the hand.
 *
 *   startAutoScroll(selector, { held }) -> stop()        held() -> true while a sheet or a panel is open in front
 *
 * One slow, even speed (SCROLL.pxs CSS px a second) that fills over SCROLL.tau seconds and eases out SCROLL.ease px before the
 * end; at the end it holds SCROLL.hold ms, goes back to the top in one move (0.5 to 1.4 s, eased at both ends) and waits
 * SCROLL.rest ms before it starts again. It stops while the pointer is within SCROLL.near px of the list or touching it, and
 * for SCROLL.wheel ms after the wheel moved that list; then it goes on from where the list is (the hand and this move the same
 * scrollTop, so the position is always read back from the list). It writes only when the position moves by one device pixel,
 * and only at the head of a frame. Nothing moves when the visitor asked for reduced motion. */

export const SCROLL = { pxs: 16, tau: 0.8, ease: 48, hold: 3000, rest: 2600, back: 1100, near: 40, wheel: 8000, touch: 4000 };

/** the speed after dt seconds, given the room left before the end */
export function nextSpeed(v, left, dt) {
  const want = SCROLL.pxs * Math.max(0.18, Math.min(1, left / SCROLL.ease));
  return v + (want - v) * (1 - Math.exp(-dt / SCROLL.tau));
}
/** how long the move back to the top takes from a position (ms) */
export const backMs = (from) => Math.max(500, Math.min(1400, (from / SCROLL.back) * 1000));
const ease2 = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function startAutoScroll(selector, { held } = {}) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const st = new WeakMap();
  let pt = null, els = [], elsAt = 0, timer = 0, raf = 0, lastT = 0, live = true;
  const near = (e) => { pt = { x: e.clientX, y: e.clientY }; };
  const wheel = (e) => {
    const el = e.target && e.target.closest ? e.target.closest(selector) : null;
    const s = el && st.get(el);
    if (s) { s.until = performance.now() + SCROLL.wheel; s.v = 0; }
  };
  const touch = (e) => {
    const el = e.target && e.target.closest ? e.target.closest(selector) : null;
    const s = el && st.get(el);
    if (s) { s.until = performance.now() + SCROLL.touch; s.v = 0; }
  };
  document.addEventListener('mousemove', near, { passive: true });
  document.addEventListener('wheel', wheel, { passive: true });
  document.addEventListener('pointerdown', touch, { passive: true });
  document.addEventListener('touchmove', touch, { passive: true });

  function at(ms) {
    if (timer || raf || !live) return;
    const go = () => { timer = 0; raf = requestAnimationFrame(() => { raf = 0; tick(); }); };
    if (ms <= 17) go(); else timer = setTimeout(go, ms);
  }
  function tick() {
    const now = performance.now();
    const dt = Math.min(0.25, Math.max(0, (now - (lastT || now)) / 1000)); lastT = now;
    if (reduce.matches || document.hidden) { at(1000); return; }
    if (now - elsAt > 5000) { els = [...document.querySelectorAll(selector)]; elsAt = now; }
    const idle = !(held && held());
    const px = 1 / (window.devicePixelRatio || 1);
    const stepMs = (1000 * px) / SCROLL.pxs;
    let wake = 1000;
    for (const el of els) {
      if (!el.isConnected) continue;
      let s = st.get(el);
      if (!s) { s = { pos: el.scrollTop, w: el.scrollTop, v: 0, until: 0, hold: 0, rest: now + SCROLL.rest, room: 0, rAt: 0, rect: null, back: null }; st.set(el, s); }
      if (now - s.rAt > 2000) { s.room = el.scrollHeight - el.clientHeight; s.rect = el.getBoundingClientRect(); s.rAt = now; }
      const stop = (ms) => { s.until = Math.max(s.until, now + ms); s.v = 0; };
      if (!idle) stop(1500);
      else if (pt && s.rect) { const r = s.rect, m = SCROLL.near; if (pt.x > r.left - m && pt.x < r.right + m && pt.y > r.top - m && pt.y < r.bottom + m) stop(SCROLL.touch); }
      if (s.room < 4) continue;
      if (now < s.until) { s.back = null; wake = Math.min(wake, s.until - now + 5); continue; }
      const cur = el.scrollTop;
      if (Math.abs(cur - s.w) > 1) { s.pos = cur; s.w = cur; s.back = null; }   // moved by the hand or redrawn: start from there
      if (s.back) {
        const t = Math.min(1, (now - s.back.t0) / s.back.d);
        const q = Math.round((s.back.from * (1 - ease2(t))) / px) * px;
        if (q !== s.w) { el.scrollTop = q; s.w = q; }
        if (t >= 1) { s.back = null; s.pos = 0; s.rest = now + SCROLL.rest; wake = Math.min(wake, SCROLL.rest); } else wake = 0;
        continue;
      }
      if (s.hold) {
        if (now < s.hold) { wake = Math.min(wake, s.hold - now + 5); continue; }
        s.hold = 0; s.v = 0;
        s.back = { t0: now, from: cur, d: backMs(cur) };
        wake = 0; continue;
      }
      if (now < s.rest) { wake = Math.min(wake, s.rest - now + 5); continue; }
      s.v = nextSpeed(s.v, s.room - s.pos, dt);
      s.pos = Math.min(s.room, s.pos + s.v * dt);
      const q = Math.round(s.pos / px) * px;                       // write only when it moved by one device pixel
      if (q !== s.w) { el.scrollTop = q; s.w = q; }
      if (s.room - s.pos < 0.5) { s.pos = s.room; s.hold = now + SCROLL.hold; wake = Math.min(wake, SCROLL.hold); continue; }
      wake = Math.min(wake, Math.max(stepMs, (1000 * px) / Math.max(0.5, s.v)));
    }
    at(Math.min(1000, wake));
  }
  at(1000);
  return () => {
    live = false; clearTimeout(timer); cancelAnimationFrame(raf);
    document.removeEventListener('mousemove', near); document.removeEventListener('wheel', wheel);
    document.removeEventListener('pointerdown', touch); document.removeEventListener('touchmove', touch);
  };
}
