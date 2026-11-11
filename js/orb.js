/* orb — a sphere of points held in a ring of ticks, drawn on a Canvas 2D. It shows one of four states and nothing else:
 *   idle      an ice-white sphere turning slowly (20 frames a second)
 *   thinking  the data is being read: it turns faster and the two arcs sweep
 *   speaking  the page is reading aloud: white; each word boundary of the device's voice gives one pulse (pulse()).
 *             A real level only comes through setBands(), fed by an AnalyserNode on audio the page itself plays; the device's voice
 *             (Web Speech API) cannot be measured, so no level is made up for it.
 *   error     red, still
 * It is never drawn while the page is hidden, while it is off screen, or more than once when motion is reduced (one still frame per change).
 * The canvas is aria-hidden; what can be pressed is a <button> placed over it by the caller.
 *
 *   mountOrb(host, { size, win, doc }) -> { setState(s), state(), pulse(), setBands(arr), frame(now), destroy(), running() }
 *   orbColour(state) -> [r, g, b]
 *   fib(n) -> points on a sphere (a Fibonacci lattice) */

export const STATES = ['idle', 'thinking', 'speaking', 'error'];
const COL = { idle: [214, 236, 246], thinking: [178, 226, 246], speaking: [246, 251, 253], error: [240, 104, 92] };
const FPS = { idle: 20, thinking: 30, speaking: 60, error: 0 };
const TAU = Math.PI * 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export const orbColour = (s) => (COL[s] || COL.idle).slice();
export function fib(n, rnd = Math.random) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2, r = Math.sqrt(1 - y * y), t = g * i;
    out.push({ x: Math.cos(t) * r, y, z: Math.sin(t) * r, ph: rnd() * TAU, s: 0.6 + rnd() * 0.8 });
  }
  return out;
}
const nz = (x, y, z) => (Math.sin(x * 1.7 + Math.sin(y * 2.3 + z)) + Math.sin(y * 1.9 + Math.sin(z * 1.3 + x)) + Math.sin(z * 2.1 + Math.sin(x * 1.1 + y))) / 3;

export function mountOrb(host, opt = {}) {
  const win = opt.win || (typeof window !== 'undefined' ? window : null);
  const doc = opt.doc || (typeof document !== 'undefined' ? document : null);
  const cv = doc.createElement('canvas');
  cv.className = 'orb-cv';
  cv.setAttribute('aria-hidden', 'true');
  host.append(cv);
  const ctx = cv.getContext ? cv.getContext('2d') : null;
  const shell = fib(opt.points || 520), inner = fib(160);
  const S = { st: 'idle', raf: 0, last: 0, t: 0, rot: 0, pulseAt: -1e9, bands: null, bandsAt: -1e9, lvl: 0, seen: true, alive: true, w: 0, h: 0, dpr: 1, drawn: 0, col: orbColour('idle') };
  const reduced = () => !!(win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches) || !!(doc.documentElement && doc.documentElement.hasAttribute('data-calm'));
  const hidden = () => !!doc.hidden;

  function size() {
    const r = host.getBoundingClientRect ? host.getBoundingClientRect() : { width: opt.size || 200, height: opt.size || 200 };
    const dpr = Math.min(2, (win && win.devicePixelRatio) || 1);
    const w = Math.max(1, Math.round((r.width || opt.size || 200) * dpr)), hh = Math.max(1, Math.round((r.height || opt.size || 200) * dpr));
    if (w !== S.w || hh !== S.h) { S.w = cv.width = w; S.h = cv.height = hh; S.dpr = dpr; }
  }
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${clamp01(a).toFixed(3)})`;

  function draw(now) {
    if (!ctx) return;
    S.drawn++;
    const { w, h: hh, dpr } = S, st = S.st;
    const dt = Math.min(0.05, Math.max(0, (now - (S.last || now)) / 1000));
    S.last = now; S.t += dt;
    const t = S.t;
    const tc = COL[st] || COL.idle;
    for (let k = 0; k < 3; k++) S.col[k] += (tc[k] - S.col[k]) * (reduced() ? 1 : 1 - Math.exp(-dt * 6));
    const c = S.col;
    const pulse = reduced() ? 0 : Math.max(0, 1 - (now - S.pulseAt) / 520);
    const live = S.bands && now - S.bandsAt < 400;
    const B = live ? S.bands : null;
    const low = B ? clamp01((B[0] + B[1] + B[2]) / 3) : 0, high = B ? clamp01((B[B.length - 1] + B[B.length - 2]) / 2) : 0;
    S.rot += dt * (st === 'thinking' ? 0.6 : st === 'speaking' ? 0.28 : st === 'error' ? 0 : 0.12);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    const cx = w / 2, cy = hh / 2, R = Math.min(w, hh) * 0.3 * (1 + pulse * 0.035 + low * 0.06);
    const tilt = 0.36, ct = Math.cos(tilt), sn = Math.sin(tilt), cr = Math.cos(S.rot), sr = Math.sin(S.rot);
    const amp = 0.012 + pulse * 0.05 + low * 0.05 + (st === 'thinking' ? 0.012 : 0);

    // the ring of ticks: 120 marks, a longer one every 30 degrees, cut open at the bottom
    ctx.lineWidth = Math.max(1, dpr * 0.9);
    const Rt = R * 1.42;
    for (let k = 0; k < 120; k++) {
      const a = (k / 120) * TAU - Math.PI / 2;
      if (Math.abs(((a + Math.PI / 2) % TAU) - Math.PI) < 0.22) continue;
      const long = k % 10 === 0, len = (long ? 0.09 : 0.045) * R * (1 + (B ? B[k % B.length] * 0.8 : 0));
      ctx.strokeStyle = rgba(c, long ? 0.55 : 0.22);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * Rt, cy + Math.sin(a) * Rt); ctx.lineTo(cx + Math.cos(a) * (Rt - len), cy + Math.sin(a) * (Rt - len)); ctx.stroke();
    }
    // two arcs that aim: they sweep while thinking, close in on a pulse, rest apart when idle
    const sweep = st === 'thinking' ? t * 1.6 : st === 'speaking' ? Math.sin(t * 2) * 0.2 : 0;
    const span = 0.55 + pulse * 0.35 + (st === 'thinking' ? 0.2 : 0);
    ctx.lineWidth = Math.max(1.5, dpr * 2.2);
    ctx.strokeStyle = rgba(c, 0.5 + pulse * 0.4);
    for (const base of [-Math.PI / 2, Math.PI / 2]) {
      const a0 = base + sweep - span / 2;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.24, a0, a0 + span); ctx.stroke();
    }
    ctx.lineWidth = Math.max(1, dpr * 0.8);
    ctx.strokeStyle = rgba(c, 0.18);
    ctx.beginPath(); ctx.ellipse(cx, cy, R * 1.12, R * 1.12 * 0.3, 0, 0, TAU); ctx.stroke();

    // the sphere: the outer shell of points, deeper points dimmer, then the inner shell, then the light of the core
    const proj = (p, rr, rot2) => {
      const ca = rot2 ? Math.cos(-S.rot * 1.6) : cr, sa = rot2 ? Math.sin(-S.rot * 1.6) : sr;
      const x1 = p.x * ca + p.z * sa, z1 = -p.x * sa + p.z * ca;
      const y2 = p.y * ct - z1 * sn, z2 = p.y * sn + z1 * ct;
      return [cx + x1 * rr, cy + y2 * rr, z2];
    };
    for (const p of shell) {
      const d = 1 + amp * nz(p.x * 2 + t * 0.4, p.y * 2 + p.ph, p.z * 2 - t * 0.3);
      const q = proj(p, R * d, false);
      const depth = clamp01((q[2] + 1) / 2);
      ctx.fillStyle = rgba(c, (0.12 + 0.78 * depth) * (0.85 + high * 0.15));
      const z = (0.55 + 1.1 * depth) * p.s * dpr;
      ctx.fillRect(q[0] - z / 2, q[1] - z / 2, z, z);
    }
    for (const p of inner) {
      const q = proj(p, R * 0.6 * (1 + amp * 0.8 * Math.sin(t * 2.2 + p.ph)), true);
      const depth = clamp01((q[2] + 1) / 2);
      ctx.fillStyle = rgba(c, 0.1 + 0.4 * depth);
      const z = (0.5 + 0.8 * depth) * dpr;
      ctx.fillRect(q[0] - z / 2, q[1] - z / 2, z, z);
    }
    if (ctx.createRadialGradient) {
      const energy = clamp01(pulse * 0.6 + low * 0.5 + (st === 'speaking' ? 0.25 : st === 'thinking' ? 0.2 : 0.08));
      let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.62);
      g.addColorStop(0, rgba(c, 0.08 + energy * 0.14)); g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 0.62, 0, TAU); ctx.fill();
      g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (0.1 + energy * 0.06));
      g.addColorStop(0, rgba([255, 255, 255], 0.45 + energy * 0.4)); g.addColorStop(1, rgba([255, 255, 255], 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * (0.1 + energy * 0.06), 0, TAU); ctx.fill();
    }
    // the ring a pulse sends out from the core
    if (pulse > 0.02) {
      ctx.strokeStyle = rgba(c, pulse * 0.45); ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath(); ctx.arc(cx, cy, R * (0.3 + (1 - pulse) * 0.9), 0, TAU); ctx.stroke();
    }
  }

  // ---- when to draw: only while seen; reduced motion gets one still frame per change
  const raf = (f) => (win && win.requestAnimationFrame ? win.requestAnimationFrame(f) : 0);
  const caf = (id) => { if (win && win.cancelAnimationFrame && id) win.cancelAnimationFrame(id); };
  const perf = () => (win && win.performance ? win.performance.now() : Date.now());
  let tm = 0;
  function frame(now) {
    S.raf = 0;
    if (!S.alive) return;
    if (hidden() || !S.seen) return;           // nothing is drawn, and no frame is asked for, until it is seen again
    size();
    draw(now);
    if (reduced() || S.st === 'error') return;  // a still frame
    const fps = FPS[S.st] || 20;
    if (fps >= 60) S.raf = raf(frame);
    else { clearTimeout(tm); tm = setTimeout(() => { S.raf = raf(frame); }, 1000 / fps); }
  }
  function kick() { if (S.alive && !S.raf && !hidden() && S.seen) S.raf = raf(frame); }
  const onVis = () => { if (!hidden()) kick(); else { caf(S.raf); S.raf = 0; clearTimeout(tm); } };
  doc.addEventListener('visibilitychange', onVis);
  let io = null;
  if (win && win.IntersectionObserver) {
    io = new win.IntersectionObserver((es) => { for (const e of es) { S.seen = e.isIntersecting; } if (S.seen) kick(); else { caf(S.raf); S.raf = 0; clearTimeout(tm); } });
    io.observe(host);
  }
  let ro = null;
  if (win && win.ResizeObserver) { ro = new win.ResizeObserver(() => { S.last = 0; kick(); }); ro.observe(host); }
  kick();

  return {
    setState(s) { const n = STATES.includes(s) ? s : 'idle'; if (n !== S.st) { S.st = n; kick(); } },
    state: () => S.st,
    pulse() { S.pulseAt = perf(); kick(); },
    setBands(a) { S.bands = Array.isArray(a) && a.length >= 3 ? a.map((x) => clamp01(Number(x) || 0)) : null; S.bandsAt = perf(); kick(); },
    frame: (now) => { S.raf = 0; frame(isFinite(now) ? now : perf()); },
    drawn: () => S.drawn,
    running: () => !!S.raf,
    destroy() { S.alive = false; caf(S.raf); clearTimeout(tm); doc.removeEventListener('visibilitychange', onVis); if (io) io.disconnect(); if (ro) ro.disconnect(); cv.remove(); },
  };
}
