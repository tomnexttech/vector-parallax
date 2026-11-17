/* motion — the board answers a change with a short move, and says what changed. Nothing here runs by itself: every call is the answer
 * to a press or the sign that a value in the data changed (2026-11-17, from notes on how a scene is paced: the one who leads comes first
 * and the rest follow, one move is short, what leaves and what comes move together and slowly at both ends, a still gap between moves,
 * only the changed cell tells). Only transform (translate, scale) and opacity are animated, never the layout, so a phone does not stall.
 * Nothing moves with prefers-reduced-motion or the setting 動きを抑える (data-calm): every call then does only what it was asked for, at once.
 *
 *   calm()                          -> bool  motion is off
 *   rise(els, { res, step, cap, dy, delay })   the leader first, each next one `step` ms later (the whole within `cap` ms); an element fades up from dy px
 *   swap(root, pick, render, dir)   what is on screen leaves and the new comes in together (420 ms, slow at both ends, 16 px); dir 1 | -1 | 0 (0: fade only)
 *   grow(els, { origin, res, step, cap, delay })   bars that stretch from their start (scaleX) in a flock, 90 ms apart
 *   count(el, to, { ms })           a number that steps up in tenths of a second (10 Hz, constant speed, never rolling smoothly)
 *   pop(el), dip(els, keep)         the chosen control settles; the others step back and return
 *   glow(el)                        the one cell whose value changed lights once (900 ms)
 *   viewSwap(fn, dir)               a change of screen as a view transition (the old and the new move together); fn runs at once when it cannot
 */
export const OUT = 'cubic-bezier(.16, 1, .3, 1)';
export const IO = 'cubic-bezier(.45, 0, .2, 1)';
export const RES = 220, STEP = 90, SWAP = 420;

export function calm() {
  try {
    if (typeof document === 'undefined' || !document.documentElement) return true;
    return document.documentElement.hasAttribute('data-calm') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch { return true; }
}
const can = (el) => !!el && typeof el.animate === 'function' && typeof el.getBoundingClientRect === 'function' && !calm();
const list = (x) => [x].flat(3).filter((e) => e && typeof e.animate === 'function');

export function rise(els, { res = RES, step = STEP, cap = 800, dy = 8, delay = 0 } = {}) {
  const xs = list(els);
  if (!xs.length || calm()) return 0;
  const gap = xs.length > 1 ? Math.min(step, Math.max(0, (cap - res - delay) / (xs.length - 1))) : 0;
  xs.forEach((el, i) => { try { el.animate([{ opacity: 0, translate: `0 ${dy}px` }, { translate: '0 0' }], { duration: res, delay: delay + i * gap, easing: OUT, fill: 'backwards' }); } catch { /* an old browser: it simply appears */ } });
  return delay + (xs.length - 1) * gap + res;
}

export function grow(els, { origin = 'left', res = 500, step = STEP, cap = 640, delay = 0 } = {}) {
  const xs = list(els);
  if (!xs.length || calm()) return 0;
  const gap = xs.length > 1 ? Math.min(step, Math.max(0, (cap - res - delay) / (xs.length - 1))) : 0;
  xs.forEach((el, i) => {
    const o = typeof origin === 'function' ? origin(el) : origin;
    try { el.animate([{ transform: 'scaleX(0)', transformOrigin: `${o} center` }, { transform: 'scaleX(1)', transformOrigin: `${o} center` }], { duration: res, delay: delay + i * gap, easing: OUT, fill: 'backwards' }); } catch { /* */ }
  });
  return delay + (xs.length - 1) * gap + res;
}

/** what is on screen (the elements pick(root) names) stays as a ghost that leaves while render() puts the new ones in, which come in together with it */
export function swap(root, pick, render, dir = 1) {
  if (!can(root) || typeof getComputedStyle !== 'function') { render(); return; }
  let olds, rects, pr, sx, sy;
  try {
    olds = list(pick(root));
    pr = root.getBoundingClientRect(); sx = root.scrollLeft || 0; sy = root.scrollTop || 0;
    rects = olds.map((o) => o.getBoundingClientRect());
  } catch { render(); return; }
  render();
  let news;
  try { news = list(pick(root)).filter((n) => !olds.includes(n)); } catch { return; }
  if (!news.length) return;
  const dx = 16 * dir, opt = { duration: SWAP, easing: IO };
  for (const n of news) { try { n.animate([{ opacity: 0, translate: `${dx}px 0` }, { translate: '0 0' }], { ...opt, fill: 'backwards' }); } catch { /* */ } }
  let rel = null;
  try { if (getComputedStyle(root).position === 'static') { rel = root.style.position; root.style.position = 'relative'; } } catch { /* */ }
  const cs = getComputedStyle(root), bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
  let left = olds.length;
  const done = () => { left -= 1; if (left <= 0 && rel !== null) root.style.position = rel; };
  olds.forEach((o, i) => {
    const r = rects[i];
    if (!(r.width > 0 && r.height > 0)) { done(); return; }
    for (const e of [o, ...o.querySelectorAll('[id]')]) e.removeAttribute('id');
    o.setAttribute('aria-hidden', 'true'); o.setAttribute('inert', ''); o.removeAttribute('tabindex');
    Object.assign(o.style, { position: 'absolute', left: `${r.left - pr.left - bl + sx}px`, top: `${r.top - pr.top - bt + sy}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', boxSizing: 'border-box', pointerEvents: 'none', zIndex: '2' });
    root.append(o);
    let a;
    try { a = o.animate([{ translate: '0 0' }, { opacity: 0, translate: `${-dx}px 0` }], { ...opt, fill: 'forwards' }); } catch { o.remove(); done(); return; }
    const end = () => { o.remove(); done(); };
    a.finished.then(end, end);
  });
}

export function count(el, to, { ms = 900, delay = 0 } = {}) {
  if (!el || calm() || !Number.isFinite(to)) return false;
  const m = /^(\D*)(\d[\d,]*)(\D*)$/.exec(String(el.textContent || '').trim());
  if (!m) return false;
  const pre = m[1], suf = m[3], end = Math.round(to);
  if (end <= 0) return false;
  const w = el.getBoundingClientRect ? el.getBoundingClientRect().width : 0;
  const keep = { d: el.style.display, w: el.style.minWidth, a: el.style.textAlign };
  if (w > 0) { el.style.display = 'inline-block'; el.style.minWidth = `${w}px`; el.style.textAlign = 'right'; }
  const tick = 100, n = Math.max(2, Math.round(ms / tick));
  let k = 0;
  el.textContent = `${pre}0${suf}`;
  const fin = () => { el.textContent = `${pre}${end}${suf}`; el.style.display = keep.d; el.style.minWidth = keep.w; el.style.textAlign = keep.a; };
  setTimeout(() => {
    const t = setInterval(() => {
      k += 1;
      if (k >= n || !el.isConnected) { clearInterval(t); fin(); return; }
      el.textContent = `${pre}${Math.round(end * k / n)}${suf}`;
    }, tick);
  }, delay);
  return true;
}

/** a chosen control settles a little (it comes in from 4 % smaller); the others stay where they are */
export function pop(el) {
  if (!can(el)) return;
  try { el.animate([{ transform: 'scale(.96)' }, { transform: 'scale(1)' }], { duration: 300, easing: OUT }); } catch { /* */ }
}

/** the others step back and return (a dip of opacity), while the chosen one pops */
export function dip(els, keep) {
  for (const el of list(els)) if (el !== keep && can(el)) { try { el.animate([{ opacity: 1 }, { opacity: .7, offset: .3 }, { opacity: 1 }], { duration: 480, easing: IO }); } catch { /* */ } }
}

export function glow(el) {
  if (!el || !el.classList || calm()) return;
  el.classList.remove('mo-glow'); void el.offsetWidth; el.classList.add('mo-glow');
  setTimeout(() => { try { el.classList.remove('mo-glow'); } catch { /* */ } }, 950);
}

/** a change of screen: with a view transition the old screen and the new one move together (css/app.css, "motion"); otherwise fn runs at once */
let inSwap = false;
export function viewSwap(fn, dir = 1) {
  if (inSwap || calm() || typeof document === 'undefined' || typeof document.startViewTransition !== 'function') return fn();
  const de = document.documentElement;
  de.dataset.vt = dir < 0 ? 'back' : 'fore';
  let out;
  try {
    out = document.startViewTransition(() => { inSwap = true; try { fn(); } finally { inSwap = false; } });
  } catch { delete de.dataset.vt; return fn(); }
  const clear = () => { delete de.dataset.vt; };
  out.finished.then(clear, clear);
  return out.updateCallbackDone;
}
