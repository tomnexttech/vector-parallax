/* The dial (phones only, upright or sideways): two rings under the thumb in the lower right corner, opened and closed by the round
 * button there. The inner ring holds the topics above the list of events, the outer ring holds the events of that list. A ring
 * turns with the finger and clicks at each step (a short vibration where the phone has one); the step that stops at the mark is
 * chosen: a topic filters the list, an event opens. A tap turns the touched step to the mark. The dial presses the board's own
 * buttons and rows, so it keeps no copy of the board. Tablets and desktops do not show it. */
import { SIDEWAYS } from './landscape.js';

export const PHONE = `(max-width: 760px), ${SIDEWAYS}`;
const NS = 'http://www.w3.org/2000/svg';
export const SIZE = 240, C = [206, 206], MARK = 225, HALF = 45;
export const RINGS = [{ ri: 56, ro: 108, P: 30 }, { ri: 114, ro: 198, P: 15 }];

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const nrm = (a) => ((((a + 180) % 360) + 360) % 360) - 180;            // an angle as -180..180
export const detent = (rot, n) => Math.round(clamp(rot, 0, Math.max(0, n - 1)));   // the step resting at the mark
export const tapStep = (rot, a, P, n) => detent(rot + nrm(a - MARK) / P, n);        // the step a tap at angle a lands on
export function fade(rel, P) {                                                     // how much of a step shows, rel steps from the mark
  const a = Math.abs(rel * P), full = HALF - P / 2;
  return a <= full ? 1 : Math.max(0, 1 - (a - full) / P);
}

const rad = (d) => d * Math.PI / 180;
const f1 = (v) => Math.round(v * 10) / 10;
const pt = (r, a) => [f1(C[0] + r * Math.cos(rad(a))), f1(C[1] + r * Math.sin(rad(a)))];
function sector(ri, ro, a0, a1) {
  const [x0, y0] = pt(ro, a0), [x1, y1] = pt(ro, a1), [x2, y2] = pt(ri, a1), [x3, y3] = pt(ri, a0);
  return `M${x0} ${y0}A${ro} ${ro} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${ri} ${ri} 0 0 0 ${x3} ${y3}Z`;
}
function arc(r, a0, a1) { const [x0, y0] = pt(r, a0), [x1, y1] = pt(r, a1); return `M${x0} ${y0}A${r} ${r} 0 0 1 ${x1} ${y1}`; }
function el(tag, attrs, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
}
const textOf = (b) => [...b.childNodes].filter((x) => x.nodeType === 3).map((x) => x.textContent).join('').trim() || b.textContent.trim();

export function initDial({ doc = document, win = window } = {}) {
  const app = doc.getElementById('app');
  if (!app || !win.matchMedia) return null;
  const phone = win.matchMedia(PHONE), side = win.matchMedia(SIDEWAYS);
  const touch = () => ((win.navigator && win.navigator.maxTouchPoints) || 0) > 0 || win.matchMedia('(pointer: coarse)').matches;
  const calm = () => doc.documentElement.hasAttribute('data-calm') || win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const btn = doc.createElement('button');
  btn.type = 'button'; btn.className = 'dial-btn'; btn.hidden = true;
  btn.setAttribute('aria-controls', 'dial'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-label', 'ダイヤルを開く');
  const ico = { open: 'M4.5 15.5a11 11 0 0 1 11-11M9 15.5a6.5 6.5 0 0 1 6.5-6.5', shut: 'M6 6l8 8M14 6l-8 8' };
  const icoPath = el('path', { d: ico.open });
  btn.append(el('svg', { viewBox: '0 0 20 20', 'aria-hidden': 'true' }, icoPath));
  const box = doc.createElement('div');
  box.className = 'dial'; box.id = 'dial'; box.hidden = true;
  box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'ダイヤル（内は論点、外は注目の出来事）');
  const read = doc.createElement('p');
  read.className = 'dial-read'; read.setAttribute('aria-live', 'polite');
  const svg = el('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, width: SIZE, height: SIZE });
  box.append(read, svg);
  app.append(box, btn);

  let R = [], drag = null, open = false, last = 1, again = 0;
  const topics = () => [...doc.querySelectorAll('#pri-chips .chip')].map((b) => ({ el: b, t: textOf(b), n: ((b.querySelector('.n') || {}).textContent || '').trim(), on: b.getAttribute('aria-pressed') === 'true', off: b.disabled }));
  const title = (n) => [...n.childNodes].filter((x) => !(x.nodeType === 1 && /^[A-Z]{1,3}$/.test(x.textContent.trim()))).map((x) => x.textContent).join('').trim();   // the headline without its small mark
  const events = () => [...doc.querySelectorAll('#pri-b .r:not(.folded)')].map((r) => ({ el: r, t: title(r.querySelector('.rt') || r), n: ((r.querySelector('.rn') || {}).textContent || '').trim(), on: r.classList.contains('sel') }));

  function say(r, j) {
    const it = r && r.items[j];
    if (!it) { read.replaceChildren(); return; }
    const k = doc.createElement('span'), t = doc.createElement('b');
    k.className = 'dr-k';
    k.textContent = r.k ? `出来事 ${j + 1} / ${r.n}${it.n ? ' · ' + it.n : ''}` : `論点${it.n ? ' · ' + it.n + ' 件' : ''}`;
    t.textContent = it.t;
    read.replaceChildren(k, t);
  }
  function apply(r) {
    const c = detent(r.rot, r.n);
    r.els.forEach((g, i) => {
      const rel = i - r.rot, op = fade(rel, r.P);
      g.setAttribute('transform', `rotate(${f1(rel * r.P)} ${C[0]} ${C[1]})`);
      g.style.opacity = op.toFixed(3); g.style.display = op <= 0 ? 'none' : '';
      g.classList.toggle('at', i === c); g.classList.toggle('cur', i === r.cur);
    });
  }
  function build() {
    const lists = [topics(), events()];
    const grid = el('g', { 'clip-path': 'url(#dial-cut)' });
    const hits = [];
    R = RINGS.map((g, k) => {
      const items = lists[k], cur = items.findIndex((x) => x.on);
      const r = { k, ...g, items, n: items.length, cur, rot: cur >= 0 ? cur : 0, els: [] };
      const rm = (g.ri + g.ro) / 2;
      grid.append(el('path', { class: 'dl-bed', d: sector(g.ri, g.ro, 180, 270) }));
      items.forEach((it, i) => {
        const a0 = MARK - g.P / 2, a1 = MARK + g.P / 2, s = el('g', { class: 'dl-s' + (it.off ? ' off' : '') });
        const at = (rr, cls, txt) => { const [x, y] = pt(rr, MARK); return el('text', { class: cls, x, y, transform: `rotate(${MARK + 90} ${x} ${y})` }, txt); };
        s.append(el('path', { class: 'dl-p', d: sector(g.ri + 1, g.ro - 1, a0, a1) }));
        if (k === 0) s.append(at(rm + 5, 'dl-t', it.t.length > 5 ? it.t.slice(0, 5) : it.t), at(g.ri + 11, 'dl-n', it.n));
        else s.append(at(g.ro - 24, 'dl-i', String(i + 1).padStart(2, '0')), at(g.ri + 18, 'dl-n', it.n));
        grid.append(s); r.els.push(s);
      });
      grid.append(el('path', { class: 'dl-mark', d: arc(g.ro - 2, MARK - g.P * .22, MARK + g.P * .22) }));
      hits.push(el('path', { class: 'dl-z', 'data-r': String(k), d: sector(g.ri - 3, g.ro + 3, 180, 270) }));
      return r;
    });
    const cut = el('clipPath', { id: 'dial-cut' }, el('rect', { x: 0, y: 0, width: C[0], height: C[1] }));
    svg.replaceChildren(el('defs', {}, cut), grid, ...hits);
    R.forEach(apply);
    say(R[last], detent(R[last].rot, R[last].n));
  }
  function turnTo(r, j, done) {
    cancelAnimationFrame(r.anim);
    const from = r.rot, t0 = performance.now(), dur = calm() ? 0 : 280;
    const step = (t) => {
      const q = dur ? Math.min(1, (t - t0) / dur) : 1, e = 1 - Math.pow(1 - q, 3);
      r.rot = from + (j - from) * e; apply(r);
      if (q < 1) r.anim = requestAnimationFrame(step); else { r.rot = j; apply(r); if (done) done(); }
    };
    r.anim = requestAnimationFrame(step);
  }
  const tick = () => {                          // only after the reader has touched the page: the browser refuses it before
    const n = win.navigator, ua = n && n.userActivation;
    try { if (n && n.vibrate && ua && ua.hasBeenActive) n.vibrate(6); } catch { /* no vibration here */ }
  };
  function toCase() {
    if (side.matches) return;                     // sideways the event is already beside the list
    const c = doc.getElementById('p-case');
    if (!c) return;
    const b = c.getBoundingClientRect();
    if (b.top < 0 || b.top > win.innerHeight * .5) c.scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' });
  }
  function commit(r, j) {
    const it = r.items[j];
    if (!it || it.off) { if (r.cur >= 0) turnTo(r, r.cur); return; }
    if (r.k === 0) { if (!it.on) { it.el.click(); last = 0; build(); } return; }
    if (!it.on) it.el.click();
    r.cur = j; apply(r); toCase();
  }
  const angAt = (e) => {
    const b = svg.getBoundingClientRect(), k = SIZE / (b.width || SIZE);
    const a = Math.atan2((e.clientY - b.top) * k - C[1], (e.clientX - b.left) * k - C[0]) * 180 / Math.PI;
    return (a + 360) % 360;
  };
  svg.addEventListener('pointerdown', (e) => {
    const z = e.target.closest('.dl-z'), r = z && R[+z.dataset.r];
    if (!r || !r.n || drag) return;
    e.preventDefault();
    try { svg.setPointerCapture(e.pointerId); } catch { /* still turns without capture */ }
    cancelAnimationFrame(r.anim);
    const a = angAt(e);
    drag = { id: e.pointerId, r, a, a0: a, x: e.clientX, y: e.clientY, move: 0, shown: detent(r.rot, r.n) };
    last = r.k; say(r, drag.shown);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = drag.r, a = angAt(e), d = nrm(a - drag.a);
    drag.a = a;
    drag.move = Math.max(drag.move, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
    if (drag.move <= 6) return;
    r.rot = clamp(r.rot - d / r.P, -.4, r.n - 1 + .4); apply(r);
    const c = detent(r.rot, r.n);
    if (c !== drag.shown) { drag.shown = c; tick(); say(r, c); }
  });
  const end = (cancel) => (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const g = drag, r = g.r;
    drag = null;
    if (!cancel && g.move <= 6) {
      const j = tapStep(r.rot, g.a0, r.P, r.n);
      if (r.k === 1 && j === r.cur && j === detent(r.rot, r.n)) { setOpen(false); return; }   // the open event once more closes the dial
      tick(); say(r, j); turnTo(r, j, () => commit(r, j)); return;
    }
    const j = detent(r.rot, r.n);
    turnTo(r, j, cancel ? null : () => commit(r, j));
  };
  svg.addEventListener('pointerup', end(false));
  svg.addEventListener('pointercancel', end(true));

  function setOpen(v) {
    open = !!v && !btn.hidden;
    box.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'ダイヤルを閉じる' : 'ダイヤルを開く');
    icoPath.setAttribute('d', open ? ico.shut : ico.open);
    if (open) { last = 1; build(); }
  }
  btn.addEventListener('click', () => setOpen(!open));
  const seen = () => { btn.hidden = !(phone.matches && touch()); if (btn.hidden) setOpen(false); };
  for (const q of [phone, side]) if (q.addEventListener) q.addEventListener('change', seen);
  seen();
  // the list changes under the dial (new data, a filter, the event that steps on by itself): read it again while nothing turns
  const watch = () => { if (!open || drag || R.some((r) => r.anim && r.rot !== Math.round(r.rot))) return; clearTimeout(again); again = setTimeout(() => { if (open && !drag) build(); }, 160); };
  if (typeof MutationObserver !== 'undefined') {
    const mo = new MutationObserver(watch);
    for (const id of ['pri-b', 'pri-chips']) { const n = doc.getElementById(id); if (n) mo.observe(n, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed'] }); }
  }
  return { open: setOpen, isOpen: () => open };
}
