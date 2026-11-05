/* floor — the map as a floor under the event.
 *
 *   createFloor({ map, board, onMode }) -> { mode(), setMode(m), toggle(), paint(info), data(d), local(x, y), pillars(), span() }
 *
 * Three ways to show one map (js/map.js draws it flat on one canvas; this turns the canvas with CSS):
 *   case  the floor is laid back (rotateX 58deg) under the event pane, and the places on the priority list stand up from it as
 *         pillars, with the event in focus as the one red pillar;
 *   map   the event pane folds away and the floor rises to fill the column (rotateX 14deg): the layer bar, the frame and its
 *         reading (LAT / LON / SPAN / OBJECTS / UTC), and TRACKING on one thing at a time;
 *   flat  1280 px and narrower: no 3D, the map lies flat in the page.
 * A pointer on the turned floor is carried back to the canvas through the floor's four corners (a projective map, quadMatrix).
 * Nothing moves by itself: the scan line runs once when the content of the layers changes, TRACKING moves on only when
 * something new appears. */

/** the projective map of the unit square onto the quad q = [tl, tr, br, bl] (screen points) -> [a, b, c, d, e, f, g, h, 1] */
export function quadMatrix(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if ((sx || sy) && den) { g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den; }
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}
/** a screen point -> [u, v] on the unit square (the inverse of quadMatrix); null when it cannot be carried back */
export function unquad(M, X, Y) {
  const [a, b, c, d, e, f, g, h, i] = M;
  const A = e * i - f * h, B = c * h - b * i, C = b * f - c * e;
  const D = f * g - d * i, E = a * i - c * g, F = c * d - a * f;
  const G = d * h - e * g, H = b * g - a * h, I = a * e - b * d;
  const w = G * X + H * Y + I;
  if (!w || !Number.isFinite(w)) return null;
  return [(A * X + B * Y + C) / w, (D * X + E * Y + F) / w];
}
/** how much of a set of keys was replaced (0..1 of the earlier set); 0 when there was no earlier set */
export function turnover(was, now) {
  if (!was) return 0;
  let n = 0;
  for (const k of now) if (!was.has(k)) n++;
  for (const k of was) if (!now.has(k)) n++;
  return n / Math.max(1, was.size);
}

export const SPANS = { case: 100, map: 150 };   // degrees of longitude across the floor (flat uses the map's own)
const PILLARS = 16;                              // the most pillars at once
const TRACK_GAP = 3200;                          // a new thing is held this long before the next new one
const SWEEP_K = 10;                              // a tenth replaced -> the scan line at full strength

export function createFloor({ map, board, onMode }) {
  const $ = (id) => document.getElementById(id);
  const theater = $('theater'), floor = $('floor'), canvas = $('map'), host = $('pillars'), trk = $('ftrk');
  const flatQ = window.matchMedia('(max-width: 1280px)');
  const reduce = () => document.documentElement.hasAttribute('data-calm') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let want = 'case', last = null, data = { counts: {}, track: [], keys: new Set() }, keysWas = null;
  let trackItem = null, trackSeen = null, trackQ = [], trackTimer = 0, clock = 0;

  const mode = () => (flatQ.matches ? 'flat' : want);
  function apply() {
    const m = mode();
    board.dataset.floor = m;
    for (const b of document.querySelectorAll('#modebar [data-m]')) b.setAttribute('aria-pressed', String(b.dataset.m === m));
    $('mtag').textContent = m === 'map' ? 'MAP' : 'CASE';
    theater.removeEventListener('wheel', map.wheel);
    canvas.removeEventListener('wheel', map.wheel);
    if (m === 'map') theater.addEventListener('wheel', map.wheel, { passive: false });
    if (m === 'flat') canvas.addEventListener('wheel', map.wheel, { passive: false });
    clearInterval(clock); clock = 0;
    if (m === 'map') { clock = setInterval(read, 1000); trackStart(); } else trackStop();
    host.hidden = m === 'flat';
  }
  function setMode(m) {
    if (m !== 'case' && m !== 'map') return false;
    if (flatQ.matches) return false;
    if (m === want) return true;
    want = m;
    keysWas = null;                                // entering a view takes a new base; the scan line does not run for it
    apply();
    if (onMode) onMode(m);
    return true;
  }
  // the canvas changes size with the turn: draw it again at the end (and once at the start for the new size)
  floor.addEventListener('transitionend', (ev) => { if (ev.target === floor && ev.propertyName === 'transform') map.resize(); });
  flatQ.addEventListener('change', () => { apply(); if (onMode) onMode(mode()); });
  for (const b of document.querySelectorAll('#modebar [data-m]')) b.addEventListener('click', () => setMode(b.dataset.m));

  function quad() {
    const q = [...floor.querySelectorAll(':scope > .fcn')].map((el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    return q.length === 4 ? quadMatrix(q) : null;
  }
  function local(x, y) {
    const M = quad(), w = canvas.clientWidth, h = canvas.clientHeight;
    if (!M || !w || !h) return null;
    const uv = unquad(M, x, y);
    return uv ? [uv[0] * w, uv[1] * h] : null;
  }

  // ---- pillars: the places of the priority list, and the event in focus (the red one). Styles are set through the CSSOM
  // (the page's CSP has no inline style)
  // The places are kept as shares of the canvas: while the floor turns (CASE <-> MAP) the canvas is stretched by the
  // transition and the pillars stretch with it, so they never stand off the ground they mark.
  const pct = (u, d) => `${((u / (d || 1)) * 100).toFixed(3)}%`;
  const place = (el, x, y, hgt, info) => { el.style.left = pct(x, info.w); el.style.top = pct(y, info.h); el.style.marginTop = `${-hgt}px`; el.style.height = `${hgt}px`; };
  // the pillars are kept from frame to frame (by name), so a name hidden by declutter stays hidden while the map moves
  const kept = new Map();
  const pillarEl = (key, cls) => {
    let el = kept.get(key);
    if (!el) { el = document.createElement('i'); el.append(document.createElement('b')); kept.set(key, el); }
    el.className = cls;
    return el;
  };
  function pillars(info) {
    const m = mode();
    if (m === 'flat' || !info) { host.replaceChildren(); kept.clear(); return; }
    const k = m === 'map' ? 2.2 : 1;
    const ps = info.marks.filter((x) => x.pri && x.x >= 0 && x.x <= info.w && x.y >= 0 && x.y <= info.h)
      .sort((a, b) => b.n - a.n).slice(0, PILLARS);
    const top = Math.max(1, ...ps.map((x) => x.n));
    const els = ps.map((p) => {
      const hgt = Math.round((16 + 46 * Math.sqrt(p.n / top)) * k);
      const el = pillarEl(`ev|${p.name}`, 'pl ev');
      place(el, p.x, p.y, hgt, info);
      el.firstChild.textContent = `${p.name} ${p.n}`;
      return el;
    });
    const f = data.focus && map.xy(data.focus.lat, data.focus.lon);
    const fin = f && f[0] >= 0 && f[0] <= info.w && f[1] >= 0 && f[1] <= info.h;
    // the place of the focus is one pillar: the red one carries its count
    const same = fin ? ps.findIndex((p) => Math.hypot(p.x - f[0], p.y - f[1]) < 6) : -1;
    const sameN = same >= 0 ? ps[same].n : null;
    if (same >= 0) els.splice(same, 1);
    if (fin) {
      const hgt = Math.round(84 * k);
      const el = pillarEl('case', 'pl case');
      place(el, f[0], f[1], hgt, info);
      const t = [data.focus.label, sameN].filter((x) => x != null && x !== '').join(' ');
      el.firstChild.textContent = t; el.firstChild.hidden = !t;
      els.push(el);
    }
    for (const [key, el] of kept) if (!els.includes(el)) kept.delete(key);
    if (els.length !== host.children.length || els.some((el, i) => host.children[i] !== el)) host.replaceChildren(...els);
    if (!info.moving) declutter();
  }
  // a name that would cover a heavier one is not shown (the focus first, then by height)
  function declutter() {
    const bs = [...host.querySelectorAll('.pl b')].map((b) => ({ b, r: b.getBoundingClientRect(), w: b.parentElement.classList.contains('case') ? 1e9 : b.parentElement.offsetHeight }));
    bs.sort((a, b) => b.w - a.w);
    const kept = [];
    for (const x of bs) {
      const hit = kept.some((y) => x.r.left < y.r.right + 2 && x.r.right > y.r.left - 2 && x.r.top < y.r.bottom && x.r.bottom > y.r.top);
      x.b.style.visibility = hit ? 'hidden' : '';
      if (!hit) kept.push(x);
    }
  }

  // ---- the reading of the frame
  function read() {
    if (document.hidden || !last) return;
    const v = last.view, w = last.w, h = last.h;
    const lon = (((v.lon0 + w / 2 / v.s) + 540) % 360) - 180, lat = v.lat0 - h / 2 / v.s, span = w / v.s;
    const n = Object.values(data.counts || {}).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    $('mread').textContent = `LAT ${lat.toFixed(1)}°  LON ${lon.toFixed(1)}°\nSPAN ${span.toFixed(0)}°・OBJECTS ${n}\nUTC ${new Date().toISOString().slice(11, 19)}`;
  }

  // ---- TRACKING: one thing at a time; it moves on only when something new appears in the layers
  const tKey = (x) => `${x.lat.toFixed(2)},${x.lon.toFixed(2)}|${x.label}`;
  function trackStart() {
    const L = data.track || [];
    const inView = (x) => { const p = last ? map.xy(x.lat, x.lon) : null; return !!p && p[0] >= 0 && p[0] <= last.w && p[1] >= 0 && p[1] <= last.h; };
    trackSeen = new Set(L.map(tKey)); trackQ = []; trackItem = L.find(inView) || L[0] || null;
    clearInterval(trackTimer); trackTimer = 0;
    trackShow();
  }
  function trackStop() { clearInterval(trackTimer); trackTimer = 0; trackItem = null; trackSeen = null; trackQ = []; trackShow(); }
  function trackRefresh() {
    if (mode() !== 'map' || !trackSeen) return;
    const L = data.track || [];
    for (const x of L) if (!trackSeen.has(tKey(x)) && !trackQ.some((q) => tKey(q) === tKey(x))) trackQ.push(x);
    trackSeen = new Set(L.map(tKey));
    if (trackQ.length && !trackTimer) { trackStep(); if (trackQ.length) trackTimer = setInterval(trackStep, TRACK_GAP); }
  }
  function trackStep() {
    if (mode() !== 'map' || !trackQ.length) { clearInterval(trackTimer); trackTimer = 0; return; }
    trackItem = trackQ.shift();
    trackShow();
    if (!trackQ.length) { clearInterval(trackTimer); trackTimer = 0; }
  }
  function trackShow() {
    const lab = $('mtrack');
    const p = trackItem && last ? map.xy(trackItem.lat, trackItem.lon) : null;
    const seen = !!p && p[0] >= 0 && p[0] <= last.w && p[1] >= 0 && p[1] <= last.h && mode() === 'map';
    lab.hidden = !seen; trk.hidden = !seen;
    if (!seen) return;
    lab.textContent = trackItem.label;
    trk.style.left = pct(p[0], last.w); trk.style.top = pct(p[1], last.h);
  }

  // ---- the scan line: once, when what the layers hold was replaced (its strength is the share replaced)
  function sweep(keys) {
    const was = keysWas; keysWas = keys;
    const r = turnover(was, keys);
    if (!r || reduce() || mode() === 'flat') return;
    const s = theater.querySelector('.sw');
    if (!s) return;
    s.style.setProperty('--swa', Math.max(0.2, Math.min(1, r * SWEEP_K)).toFixed(2));
    s.classList.remove('go'); void s.offsetWidth; s.classList.add('go');
  }

  apply();
  return {
    mode, setMode,
    toggle: () => setMode(want === 'map' ? 'case' : 'map'),
    local,
    pillars: () => mode() !== 'flat',
    // the map fills the column with a window of latitude (a column is taller than wide: the whole of the longitudes would
    // leave the poles empty); the event view keeps its own width of the world
    span: () => {
      const m = mode();
      if (m !== 'map') return SPANS[m] || null;
      const w = theater.clientWidth, h = theater.clientHeight * 1.062;
      return w && h ? Math.round(Math.max(60, Math.min(SPANS.map, (w * 120) / h))) : SPANS.map;
    },
    paint(info) { last = info; pillars(info); if (mode() === 'map') { read(); trackShow(); } },
    data(d) {
      data = { ...data, ...d };
      if (d.keys) sweep(d.keys);
      trackRefresh();
      if (last) pillars(last);
    },
  };
}
