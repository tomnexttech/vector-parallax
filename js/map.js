/* map — the world under the board, on one canvas.
 *
 *   createMap(canvas, { base, onPick }) -> { show(scene, animate), resize(), pick(x, y), reset(), view() }
 *
 * scene = { focus: null | { lat, lon, radiusKm: null | number, label },
 *           points: [{ lat, lon, n, pri, country, name, ref }],          events with a place (pri = on the priority list)
 *           quakes, typhoons, disasters (js/hazards.js), fresh: Set of quake ids that arrived since the last look,
 *           layers: { events, pri, radius, quakes, typhoons, disasters } }   a layer that is false is not drawn
 *
 * The ground (Natural Earth II, public domain, bundled tiles) is read once in a Worker into three fields (land, relief, distance
 * from the coast). While the hand moves the whole-world picture is scaled; 160 ms after it stops the Worker draws the visible
 * region at screen resolution (a crisp coast, the relief, a quiet water lining), and labels and the hit list are placed.
 * The map moves only when the event in focus changes, once. A quake that is new in the data rings once; nothing else moves. */

const TILE = 256, COLS = 8, ROWS = 4, WW = COLS * TILE, WH = ROWS * TILE;
export const SPAN = 64;            // degrees of longitude shown around an event (the region, not the street)
const MOVE_MS = 520;
const PULSE_MS = 1400;
export const SETTLE_MS = 160;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const css = (el, name, fb) => getComputedStyle(el).getPropertyValue(name).trim() || fb;
export const quakeR = (mag) => 1.5 + 1.15 * Math.pow(2, (mag - 2) / 1.6);
export const eventR = (n, country) => Math.min(country ? 6 : 13, 2.4 + 1.7 * Math.sqrt(Math.max(1, n)));
const hotQuake = (q) => q.mag >= 5 || ['4', '5-', '5+', '6-', '6+', '7'].includes(q.shindo);
const JSTF = typeof Intl === 'object' ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }) : null;
const dayHour = (ts) => { if (!JSTF || !Number.isFinite(ts)) return ''; const o = {}; for (const p of JSTF.formatToParts(new Date(ts * 1000))) o[p.type] = p.value; return `${o.day}日 ${o.hour}時`; };

function composeHere(base) {
  return new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = WW; c.height = WH;
    const g = c.getContext('2d', { willReadFrequently: true });
    let left = COLS * ROWS;
    const done = () => {
      if (--left) return;
      try {
        const img = g.getImageData(0, 0, WW, WH), p = img.data;
        for (let i = 0; i < p.length; i += 4) {
          const r = p[i], gg = p[i + 1], b = p[i + 2];
          const v = b - r > 18 && b >= gg - 4 ? 19 : 44 + ((0.3 * r + 0.59 * gg + 0.11 * b) / 255) * 18;
          p[i] = v; p[i + 1] = v + 1; p[i + 2] = v + 3;
        }
        g.putImageData(img, 0, 0);
      } catch { /* drawn as it is */ }
      resolve(c);
    };
    for (let col = 0; col < COLS; col++) for (let row = 0; row < ROWS; row++) {
      const im = new Image();
      im.onload = () => { g.drawImage(im, col * TILE, row * TILE, TILE, TILE); done(); };
      im.onerror = done;
      im.src = `${base}/${col}/${ROWS - 1 - row}.jpg`;
    }
  });
}

let groundP = null;
/** -> Promise<{ world, render(view) -> Promise<ImageBitmap|null> | null }> */
function loadGround(base) {
  if (groundP) return groundP;
  groundP = new Promise((resolve) => {
    let w = null;
    try { if (typeof OffscreenCanvas === 'function' && typeof Worker === 'function') w = new Worker(new URL('./map_worker.js', import.meta.url)); } catch { w = null; }
    const plain = () => composeHere(base).then((c) => resolve({ world: c, render: null }));
    if (!w) { plain(); return; }
    const pending = new Map();
    let ready = false;
    const fail = () => { if (ready) return; ready = true; try { w.terminate(); } catch { /* */ } plain(); };
    w.onmessage = (ev) => {
      const d = ev.data || {};
      if (d.world) {
        ready = true;
        resolve({ world: d.world, render: (v) => new Promise((res) => { pending.set(v.key, res); w.postMessage({ view: v }); }) });
        return;
      }
      if (d.key != null && pending.has(d.key)) { const r = pending.get(d.key); pending.delete(d.key); r(d.bitmap || null); return; }
      if (d.error) fail();
    };
    w.onerror = fail;
    w.postMessage({ base: new URL(base, location.href).href, cols: COLS, rows: ROWS, tile: TILE });
  });
  return groundP;
}

export function createMap(canvas, opts = {}) {
  const base = opts.base || 'assets/map/ne2/2';
  const g = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let scene = null, view = null, anim = null, world = null, render = null, sharp = null, sharpReq = 0, picks = [], settle = 0, held = false;
  let pulse = null;
  const pulsed = new Set();
  const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function size() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  }
  const minS = () => Math.max(W / 360, H / 170);
  function target(sc) {
    if (sc && sc.focus) {
      const s = Math.max(W / SPAN, minS());
      return clampV({ lon0: sc.focus.lon - W / 2 / s, lat0: sc.focus.lat + H / 2 / s, s });
    }
    const s = minS() * 1.15;
    return clampV({ lon0: 140 - W / 2 / s, lat0: 35 + H / 2 / s, s });
  }
  function clampV(v) {
    const s = Math.max(minS(), Math.min(W / 6, v.s));
    const lat0 = Math.min(85, Math.max(-85 + H / s, v.lat0));
    let lon0 = Number.isFinite(v.lon0) ? v.lon0 : 0; lon0 = ((lon0 + 180) % 360 + 360) % 360 - 180;
    return { lon0, lat0, s };
  }
  // one copy of the world per 360 degrees: bring x to the copy nearest the canvas (constant time; never loops)
  const X = (v, lon) => {
    const span = 360 * v.s; let x = (lon - v.lon0) * v.s;
    if (!Number.isFinite(x) || !(span > 0)) return NaN;
    return x - span * Math.floor((x - W / 2 + span / 2) / span);
  };
  const Y = (v, lat) => (v.lat0 - lat) * v.s;
  const kmY = (v, km) => (km / 111.32) * v.s;
  const geoAt = (c, km, deg) => { const r = Math.PI / 180, d = km / 111.32; return [c[0] + d * Math.cos(deg * r), c[1] + (d * Math.sin(deg * r)) / Math.max(0.15, Math.cos(c[0] * r))]; };
  const keyOf = (v) => `${v.lon0.toFixed(4)}|${v.lat0.toFixed(4)}|${v.s.toFixed(5)}|${W}|${H}|${dpr}`;

  function ring(v, lat, lon, km) {
    const ry = kmY(v, km), rx = ry / Math.max(0.15, Math.cos((lat * Math.PI) / 180));
    g.beginPath(); g.ellipse(X(v, lon), Y(v, lat), rx, ry, 0, 0, Math.PI * 2);
  }
  function line(v, pts) {
    g.beginPath();
    let prev = null;
    for (const [la, lo] of pts) {
      const x = X(v, lo), y = Y(v, la);
      if (prev == null || Math.abs(x - prev) > W / 2) g.moveTo(x, y); else g.lineTo(x, y);
      prev = x;
    }
  }
  function arcs(v, area) {
    for (const a of area.arcs || []) {
      if (!Array.isArray(a) || a.length < 3 || !Array.isArray(a[2]) || !Array.isArray(a[0])) continue;
      const pts = []; const [a0, a1] = a[2];
      for (let d = a0; d < a1; d += 4) pts.push(geoAt(a[0], a[1] / 1000, d));
      pts.push(geoAt(a[0], a[1] / 1000, a1));
      line(v, pts); g.stroke();
    }
    for (const sg of area.lines || []) { if (Array.isArray(sg) && sg.length === 2) { line(v, sg); g.stroke(); } }
  }

  function requestSharp(v) {
    if (!render) return;
    const key = keyOf(v), id = ++sharpReq;
    render({ lon0: v.lon0, lat0: v.lat0, s: v.s, w: W, h: H, dpr, key }).then((bm) => {
      if (!bm) return;
      if (id !== sharpReq) { try { bm.close(); } catch { /* */ } return; }
      if (sharp) { try { sharp.bitmap.close(); } catch { /* */ } }
      sharp = { key, bitmap: bm };
      if (view && !anim && keyOf(view) === key) paint(view, false);
    });
  }

  function colours() {
    return {
      sea: css(canvas, '--map-sea', '#151618'), grid: css(canvas, '--map-grid', 'rgba(255,255,255,.05)'), label: css(canvas, '--map-label', '#c9cbcf'),
      dot: css(canvas, '--map-dot', 'rgba(231,232,234,.18)'), ink: css(canvas, '--ink', '#e6e7e9'), ink2: css(canvas, '--ink-2', '#a2a5aa'),
      ink3: css(canvas, '--ink-3', '#6f7277'), red: css(canvas, '--red', '#ff5246'), cyan: css(canvas, '--cyan', '#5ac8f0'),
      font: css(canvas, '--font', 'sans-serif'), halo: css(canvas, '--map-halo', 'rgba(14,15,17,.92)'),
    };
  }

  function paint(v, quick) {
    if (pulse && pulse.running) pulse.dirty = true;
    const sc = scene || {};
    const L = sc.layers || {};
    const C = colours();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = C.sea; g.fillRect(0, 0, W, H);
    if (sharp && sharp.key === keyOf(v)) {
      g.imageSmoothingEnabled = false;
      g.drawImage(sharp.bitmap, 0, 0, W, H);
    } else if (world) {
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = quick ? 'low' : 'high';
      const w = 360 * v.s, h = 180 * v.s, x0 = (-180 - v.lon0) * v.s, y0 = (v.lat0 - 90) * v.s;
      for (const off of [-2 * w, -w, 0, w, 2 * w]) if (x0 + off < W && x0 + off + w > 0) g.drawImage(world, 0, 0, WW, WH, x0 + off, y0, w, h);
      if (!quick) requestSharp(v);
    }
    // graticule: 10 degrees near, 30 far; hairlines
    const step = v.s > 14 ? 5 : v.s > 5 ? 10 : 30;
    g.strokeStyle = C.grid; g.lineWidth = 1; g.beginPath();
    for (let lon = -180; lon < 180; lon += step) { const x = Math.round(X(v, lon)) + 0.5; if (x > 0 && x < W) { g.moveTo(x, 0); g.lineTo(x, H); } }
    for (let lat = -80; lat <= 80; lat += step) { const y = Math.round(Y(v, lat)) + 0.5; if (y > 0 && y < H) { g.moveTo(0, y); g.lineTo(W, y); } }
    g.stroke();

    const hits = [], labels = [];
    const tier = {
      focus: { px: 12.5, wt: 600, color: C.cyan, sub: C.cyan },
      hazard: { px: 11.5, wt: 600, color: C.red, sub: C.red },
      big: { px: 12, wt: 600, color: C.ink, sub: C.ink3 },
      mid: { px: 11, wt: 500, color: C.label, sub: C.ink3 },
      small: { px: 10, wt: 400, color: C.ink2, sub: C.ink3 },
      faint: { px: 9.5, wt: 400, color: C.ink3, sub: C.ink3 },
    };
    // disasters (GDACS): a small diamond; red only for an orange or red alert
    if (L.disasters !== false) for (const d of sc.disasters || []) {
      const x = X(v, d.lon), y = Y(v, d.lat);
      if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
      const hot = d.alert === 'Red' || d.alert === 'Orange';
      g.strokeStyle = hot ? C.red : C.ink2; g.globalAlpha = hot ? 1 : 0.6; g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(x, y - 4.5); g.lineTo(x + 4.5, y); g.lineTo(x, y + 4.5); g.lineTo(x - 4.5, y); g.closePath(); g.stroke(); g.globalAlpha = 1;
      hits.push({ x, y, r: 8, kind: 'disaster', d });
      if (hot) labels.push({ x, y, r: 6, text: d.name, w: 6, t: tier.hazard });
    }
    // typhoons: the gale and storm areas as fills, the past track with its points, the forecast circles as a chain of dotted rings
    if (L.typhoons !== false) for (const t of sc.typhoons || []) {
      const [la, lo] = t.center;
      const gale = t.galeC || { center: t.center, km: Math.max(0, ...t.gale.map((r) => r.km || 0)) };
      const storm = t.stormC || { center: t.center, km: Math.max(0, ...t.storm.map((r) => r.km || 0)) };
      if (t.cone && t.cone.length) {
        for (const poly of t.cone) { if (!Array.isArray(poly) || poly.length < 3) continue; line(v, poly); g.closePath(); g.fillStyle = C.red; g.globalAlpha = 0.05; g.fill(); g.globalAlpha = 0.55; g.strokeStyle = C.red; g.setLineDash([2, 3]); g.lineWidth = 1; g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
      }
      if (t.envelope && !quick) { g.strokeStyle = C.red; g.lineWidth = 1; g.globalAlpha = 0.42; arcs(v, t.envelope); g.globalAlpha = 1; }
      for (const f of t.forecast) {
        if (f.radiusKm) { ring(v, f.center[0], f.center[1], f.radiusKm); g.strokeStyle = C.red; g.globalAlpha = 0.6; g.setLineDash([1.5, 3]); g.lineWidth = 1; g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
        if (f.area && !quick) { g.strokeStyle = C.red; g.lineWidth = 1; g.globalAlpha = 0.45; arcs(v, f.area); g.globalAlpha = 1; }
      }
      if (gale.km) { ring(v, gale.center[0], gale.center[1], gale.km); g.fillStyle = C.red; g.globalAlpha = 0.08; g.fill(); g.globalAlpha = 0.5; g.strokeStyle = C.red; g.lineWidth = 1; g.stroke(); g.globalAlpha = 1; }
      if (storm.km) { ring(v, storm.center[0], storm.center[1], storm.km); g.fillStyle = C.red; g.globalAlpha = 0.26; g.fill(); g.globalAlpha = 0.95; g.strokeStyle = C.red; g.lineWidth = 1.2; g.stroke(); g.globalAlpha = 1; }
      if (t.track.length > 1) {
        line(v, [...t.track, t.center]); g.strokeStyle = C.ink2; g.globalAlpha = 0.85; g.lineWidth = 1; g.stroke();
        g.fillStyle = C.ink2;
        for (const [pa, po] of t.track) { g.beginPath(); g.arc(X(v, po), Y(v, pa), 1.1, 0, Math.PI * 2); g.fill(); }
        g.globalAlpha = 1;
      }
      const path = [t.center, ...t.forecast.map((f) => f.center)];
      if (path.length > 1) { line(v, path); g.strokeStyle = C.red; g.setLineDash([4, 3]); g.lineWidth = 1.1; g.stroke(); g.setLineDash([]); }
      for (const f of t.forecast) {
        const fx = X(v, f.center[1]), fy = Y(v, f.center[0]);
        g.fillStyle = C.sea; g.beginPath(); g.arc(fx, fy, 2.6, 0, Math.PI * 2); g.fill();
        g.strokeStyle = C.red; g.lineWidth = 1.2; g.stroke();
        const when = dayHour(f.ts);
        if (when) labels.push({ x: fx, y: fy, r: 4, text: when, w: 1.5, t: tier.faint });
      }
      const x = X(v, lo), y = Y(v, la);
      g.fillStyle = C.red; g.beginPath(); g.arc(x, y, 3.4, 0, Math.PI * 2); g.fill();
      g.strokeStyle = C.red; g.lineWidth = 1.4; g.beginPath(); g.arc(x, y, 7.5, 0, Math.PI * 2); g.stroke();
      hits.push({ x, y, r: 12, kind: 'typhoon', t });
      const no = Number(String(t.number || '').slice(-2));
      const nm = /台風|サイクロン|ハリケーン|熱帯/.test(t.name) ? t.name : `台風${no ? no + '号' : ''} ${t.name}`;
      labels.push({ x, y, r: 9, text: nm.trim(), sub: t.pressure ? ` ${t.pressure} hPa` : '', w: 9, t: tier.hazard });
    }
    // quakes: a ring whose radius follows the magnitude; red from M5 or intensity 4
    if (L.quakes !== false) {
      const qs = [...(sc.quakes || [])].sort((a, b) => a.mag - b.mag);
      for (const q of qs) {
        const x = X(v, q.lon), y = Y(v, q.lat);
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
        const r = quakeR(q.mag), hot = hotQuake(q);
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
        if (hot) { g.fillStyle = C.red; g.globalAlpha = 0.16; g.fill(); }
        g.globalAlpha = hot ? 1 : 0.6; g.strokeStyle = hot ? C.red : C.ink2; g.lineWidth = hot ? 1.3 : 1; g.stroke(); g.globalAlpha = 1;
        hits.push({ x, y, r: r + 4, kind: 'quake', q });
        if (hot || q.mag >= 4.5) labels.push({ x, y, r, text: `M${q.mag.toFixed(1)}`, sub: q.shindo ? ` 震度${q.shindo.replace('-', '弱').replace('+', '強')}` : '', w: 3 + q.mag / 2, t: hot ? tier.hazard : tier.small });
      }
    }
    // events with a place: an area that follows the number of events; a country's representative point is only a dashed ring
    if (L.events !== false) {
      const pts = [...(sc.points || [])].sort((a, b) => (a.pri - b.pri) || (a.n - b.n));
      for (const p of pts) {
        const x = X(v, p.lon), y = Y(v, p.lat);
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
        const r = eventR(p.n, p.country);
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
        if (p.country) { g.setLineDash([2, 2.5]); g.strokeStyle = C.ink2; g.globalAlpha = 0.8; g.lineWidth = 1; g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
        else {
          g.fillStyle = C.dot; g.fill();
          const pri = p.pri && L.pri !== false;
          g.strokeStyle = pri ? C.ink : C.ink2; g.globalAlpha = pri ? 0.95 : 0.5; g.lineWidth = pri ? 1.3 : 1; g.stroke(); g.globalAlpha = 1;
          if (pri) { g.fillStyle = C.ink; g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); }
        }
        hits.push({ x, y, r: r + 5, kind: 'event', p });
        if (p.name) {
          const t = p.country ? tier.faint : p.pri && p.n >= 3 ? tier.big : p.n >= 3 || p.pri ? tier.mid : tier.small;
          labels.push({ x, y, r: r + 2, text: p.name, sub: ` ${p.n}`, w: (p.country ? 0 : 2) + (p.pri ? 2 : 0) + Math.sqrt(p.n), t });
        }
      }
    }
    // focus
    const f = sc.focus;
    let fbox = null;
    if (f) {
      const fx = X(v, f.lon), fy = Y(v, f.lat);
      if (f.radiusKm && L.radius !== false) {
        ring(v, f.lat, f.lon, f.radiusKm); g.strokeStyle = C.cyan; g.globalAlpha = 0.65; g.setLineDash([4, 3]); g.lineWidth = 1; g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
        if (!quick) labels.push({ x: fx, y: fy - kmY(v, f.radiusKm), r: 2, text: `${f.radiusKm} km`, w: 20, t: { ...tier.faint, color: C.cyan } });
      }
      g.fillStyle = C.cyan; g.beginPath(); g.arc(fx, fy, 3.6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = C.cyan; g.lineWidth = 1.3; g.beginPath(); g.arc(fx, fy, 8, 0, Math.PI * 2); g.stroke();
      if (f.label) fbox = { x: fx, y: fy, r: 10, text: f.label, w: 100, t: tier.focus };
    }
    if (quick) return;
    // degree labels on the edges, small
    g.font = `9.5px ${C.font}`; g.fillStyle = C.ink3; g.textBaseline = 'top';
    for (let lon = -180; lon < 180; lon += step) { const x = X(v, lon); if (x > 30 && x < W - 40) g.fillText(`${Math.abs(lon)}°${lon < 0 ? 'W' : lon > 0 ? 'E' : ''}`, x + 3, 4); }
    g.textBaseline = 'middle';
    for (let lat = -80; lat <= 80; lat += step) { const y = Y(v, lat); if (y > 20 && y < H - 24) g.fillText(`${Math.abs(lat)}°${lat < 0 ? 'S' : lat > 0 ? 'N' : ''}`, 5, y - 7); }
    // labels: the focus first, then the heaviest; one that would overlap another is not drawn (a dark halo, no plates)
    const boxes = [];
    const budget = Math.max(14, Math.floor((W * H) / 6500));
    let drawn = 0;
    const place = (l) => {
      const st = l.t;
      g.font = `${st.wt} ${st.px}px ${C.font}`;
      const w1 = g.measureText(l.text).width;
      const subPx = Math.max(9, st.px - 1.5);
      let w2 = 0;
      if (l.sub) { g.font = `400 ${subPx}px ${C.font}`; w2 = g.measureText(l.sub).width; }
      const w = w1 + w2, hgt = st.px + 4;
      for (const [bx, by] of [[l.x + l.r + 4, l.y - hgt / 2], [l.x - l.r - 4 - w, l.y - hgt / 2], [l.x - w / 2, l.y - l.r - hgt - 1], [l.x - w / 2, l.y + l.r + 1]]) {
        const b = [bx - 1, by, w + 2, hgt];
        if (b[0] < 2 || b[0] + b[2] > W - 2 || b[1] < 2 || b[1] + b[3] > H - 16) continue;
        if (boxes.some((o) => b[0] < o[0] + o[2] && b[0] + b[2] > o[0] && b[1] < o[1] + o[3] && b[1] + b[3] > o[1])) continue;
        boxes.push(b);
        g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = C.halo;
        const ty = by + hgt / 2 + 0.5;
        g.font = `${st.wt} ${st.px}px ${C.font}`; g.strokeText(l.text, bx, ty); g.fillStyle = st.color; g.fillText(l.text, bx, ty);
        if (l.sub) { g.font = `400 ${subPx}px ${C.font}`; g.strokeText(l.sub, bx + w1, ty); g.fillStyle = st.sub; g.fillText(l.sub, bx + w1, ty); }
        return true;
      }
      return false;
    };
    // the boxes of the marks themselves are kept free of text
    for (const hgt of hits) if (hgt.kind !== 'event' || hgt.r > 9) boxes.push([hgt.x - 3, hgt.y - 3, 6, 6]);
    if (fbox) place(fbox);
    for (const l of labels.sort((a, b) => b.w - a.w)) { if (drawn >= budget) break; if (place(l)) drawn++; }
    picks = hits;
  }

  /** a quake that is new in the data: one ring that widens and fades, once. The frame under it is kept as it was painted. */
  function ringNew(qs) {
    if (!qs.length || reduce() || !view) return;
    const snap = document.createElement('canvas');
    snap.width = canvas.width; snap.height = canvas.height;
    const sg = snap.getContext('2d');
    sg.drawImage(canvas, 0, 0);
    const v = view, C = colours();
    const t0 = performance.now();
    pulse = { running: true };
    const me = pulse;
    const step = (now) => {
      if (pulse !== me || anim || view !== v) return;
      if (me.dirty) { sg.clearRect(0, 0, snap.width, snap.height); sg.drawImage(canvas, 0, 0); me.dirty = false; }
      const k = Math.min(1, (now - t0) / PULSE_MS);
      g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(snap, 0, 0);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const q of qs) {
        const x = X(v, q.lon), y = Y(v, q.lat), r = quakeR(q.mag);
        g.beginPath(); g.arc(x, y, r + 22 * ease(k), 0, Math.PI * 2);
        g.strokeStyle = hotQuake(q) ? C.red : C.ink; g.globalAlpha = 0.85 * (1 - k); g.lineWidth = 1.4; g.stroke(); g.globalAlpha = 1;
      }
      if (k < 1) requestAnimationFrame(step);
      else { g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(snap, 0, 0); me.running = false; }
    };
    requestAnimationFrame(step);
  }
  function freshQuakes() {
    const sc = scene;
    if (!sc || !sc.fresh || !sc.fresh.size || (sc.layers && sc.layers.quakes === false) || !view) return [];
    const out = [];
    for (const q of sc.quakes || []) {
      if (!sc.fresh.has(q.id) || pulsed.has(q.id)) continue;
      const x = X(view, q.lon), y = Y(view, q.lat);
      if (x < 0 || x > W || y < 0 || y > H) continue;
      pulsed.add(q.id); out.push(q);
    }
    return out;
  }

  function frame(now) {
    if (!anim) return;
    const t = Math.min(1, (now - anim.t0) / MOVE_MS), k = ease(t), a = anim.from, b = anim.to;
    let dl = b.lon0 - a.lon0; dl = ((dl + 180) % 360 + 360) % 360 - 180;
    if (!Number.isFinite(dl) || !Number.isFinite(a.s) || !Number.isFinite(b.s)) { anim = null; view = b; paint(view, false); return; }
    view = { lon0: a.lon0 + dl * k, lat0: a.lat0 + (b.lat0 - a.lat0) * k, s: a.s + (b.s - a.s) * k };
    paint(view, t < 1);
    if (t < 1) requestAnimationFrame(frame); else { anim = null; view = b; ringNew(freshQuakes()); }
  }
  function later() { clearTimeout(settle); settle = setTimeout(() => { if (scene && view) paint(view, false); }, SETTLE_MS); }

  const finite = (v) => v && Number.isFinite(v.lon0) && Number.isFinite(v.lat0) && Number.isFinite(v.s) && v.s > 0;
  function show(sc, animate) {
    const moved = !scene || JSON.stringify(scene.focus) !== JSON.stringify(sc.focus);
    scene = sc;
    size();
    if (!moved && view) { paint(view, false); ringNew(freshQuakes()); return; }
    held = false;
    const to = target(sc);
    if (animate && finite(view) && finite(to) && !reduce()) { anim = { from: view, to, t0: performance.now() }; requestAnimationFrame(frame); }
    else { anim = null; view = to; paint(view, false); ringNew(freshQuakes()); }
  }

  let drag = null;
  canvas.addEventListener('pointerdown', (ev) => { if (!view) return; drag = { x: ev.clientX, y: ev.clientY, v: view, moved: false }; try { canvas.setPointerCapture(ev.pointerId); } catch { /* */ } });
  canvas.addEventListener('pointermove', (ev) => {
    if (drag) {
      const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true; held = true; anim = null; pulse = null;
      view = clampV({ lon0: drag.v.lon0 - dx / drag.v.s, lat0: drag.v.lat0 + dy / drag.v.s, s: drag.v.s });
      paint(view, true); later();
      return;
    }
    const r = canvas.getBoundingClientRect();
    canvas.style.cursor = api.pick(ev.clientX - r.left, ev.clientY - r.top) ? 'pointer' : 'grab';
  });
  canvas.addEventListener('pointerup', (ev) => {
    const d = drag; drag = null;
    if (d && !d.moved && opts.onPick) { const r = canvas.getBoundingClientRect(); const hit = api.pick(ev.clientX - r.left, ev.clientY - r.top); if (hit) opts.onPick(hit); }
  });
  canvas.addEventListener('wheel', (ev) => {
    if (!view) return;
    ev.preventDefault();
    const r = canvas.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const k = Math.pow(1.0018, -ev.deltaY);
    const lon = view.lon0 + mx / view.s, lat = view.lat0 - my / view.s;
    const s = Math.max(minS(), Math.min(W / 6, view.s * k));
    held = true; anim = null; pulse = null;
    view = clampV({ lon0: lon - mx / s, lat0: lat + my / s, s });
    paint(view, true); later();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => api.reset());

  const api = {
    show,
    resize() { if (!scene) return; size(); if (!held || !view) view = target(scene); paint(view, true); later(); },
    reset() { if (!scene) return; held = false; const to = target(scene); if (view && !reduce()) { anim = { from: view, to, t0: performance.now() }; requestAnimationFrame(frame); } else { view = to; paint(view, false); } },
    zoom(k) { if (!view) return false; const s = Math.max(minS(), Math.min(W / 6, view.s * k)); const cl = view.lon0 + W / 2 / view.s, ca = view.lat0 - H / 2 / view.s; held = true; view = clampV({ lon0: cl - W / 2 / s, lat0: ca + H / 2 / s, s }); paint(view, false); return true; },
    pick(x, y) {
      let best = null, bd = Infinity;
      for (const q of picks) { const d = Math.hypot(q.x - x, q.y - y); if (d <= q.r && d < bd) { bd = d; best = q; } }
      return best;
    },
    view: () => view && { ...view, w: W, h: H },
  };
  loadGround(base).then((gr) => { world = gr.world; render = gr.render; if (scene && !anim && view) paint(view, false); });
  return api;
}
