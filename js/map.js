/* map — the world under the board, on one canvas.
 *
 *   createMap(canvas, { base, onPick, hi, local, onPaint, wheel }) -> { show(scene, animate), resize(), pick(x, y), reset(), zoom(k), view(),
 *                                                                   xy(lat, lon), wheel(ev) }
 *     local(clientX, clientY) -> [x, y] on the canvas, for a canvas that is turned in 3D (js/floor.js); onPaint({ view, w, h, marks, moving })
 *     after every frame; wheel: false leaves the wheel to the caller (api.wheel)
 *
 * scene = { focus: null | { lat, lon, radiusKm: null | number, label },
 *           points: [{ lat, lon, n, pri, country, name, ref }],          events with a place (pri = on the priority list)
 *           quakes, typhoons, disasters (js/hazards.js), fresh: Set of quake ids that arrived since the last look,
 *           layers: { events, pri, radius, quakes, typhoons, disasters },   a layer that is false is not drawn
 *           span: degrees of longitude around the focus (default SPAN), pillars: true when the names of the priority list and of the
 *           focus stand on pillars above the map (js/floor.js) instead of lying on it }
 *
 * The ground, detailed (js/basemap.js): relief, water and coast, rivers, railways, roads, borders, built in a Worker from open
 * tiles (OpenFreeMap vector tiles of OpenStreetMap, AWS Terrain Tiles) as equirectangular sheets; while the hand moves the sheets
 * in hand are scaled, when it stops a sheet for the view is asked for. Where no sheet covers the view (before one arrives,
 * offline, no Worker) the bundled ground below is drawn.
 * The bundled ground (Natural Earth II, public domain, bundled tiles) is read once in a Worker: the coastline is traced into vectors and
 * the relief into one grey field. The land is filled from the coast rings (even-odd) and drawn with one fine line, crisp at every
 * scale and while the hand moves; the relief is clipped to the land (the whole world while moving, the visible region at screen
 * resolution 160 ms after it stops). Optional higher-resolution relief and depth: `hi`, see js/map_worker.js.
 *
 * Marks with the same name are one mark. Inside Japan the marks fold with the scale: prefecture -> region (9) -> the country, when
 * their circles would overlap; a folded mark opens (zooms to its members) when pressed. Labels: the focus first, then hazards,
 * the priority list, the folded and the heavy; one that would overlap another or a mark is not drawn.
 * The map moves only when the event in focus changes, once. A quake that is new in the data rings once; nothing else moves. */

import { createBasemap } from './basemap.js';

const TILE = 256, COLS = 8, ROWS = 4, WW = COLS * TILE, WH = ROWS * TILE;
export const SPAN = 64;            // degrees of longitude shown around an event (the region, not the street)
const MOVE_MS = 520;
const PULSE_MS = 1400;
export const SETTLE_MS = 160;
const ENVELOPE_KM = 900;           // the storm-warning envelope of a typhoon is drawn this far from its centre, fading

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const css = (el, name, fb) => getComputedStyle(el).getPropertyValue(name).trim() || fb;
export const quakeR = (mag) => 1.5 + 1.15 * Math.pow(2, (mag - 2) / 1.6);
export const eventR = (n, country) => Math.min(country ? 6 : 13, 2.4 + 1.7 * Math.sqrt(Math.max(1, n)));
export const clusterR = (n) => Math.min(15, 3.6 + 1.5 * Math.sqrt(Math.max(1, n)));
const markR = (m) => (m.kind === 'cluster' ? clusterR(m.n) : eventR(m.n, m.country));
const hotQuake = (q) => q.mag >= 5 || ['4', '5-', '5+', '6-', '6+', '7'].includes(q.shindo);
const JSTF = typeof Intl === 'object' ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }) : null;
const dayHour = (ts) => { if (!JSTF || !Number.isFinite(ts)) return ''; const o = {}; for (const p of JSTF.formatToParts(new Date(ts * 1000))) o[p.type] = p.value; return `${o.day}日 ${o.hour}時`; };
const lonDiff = (a, b) => ((a - b + 540) % 360) - 180;

// ---------------------------------------------------------------- prefectures and regions (public representative points)
const REGIONS = ['北海道', '東北', '関東', '中部', '近畿', '中国', '四国', '九州', '沖縄'];
const PREFS = [
  ['北海道', 43.06, 141.35, 0], ['青森', 40.82, 140.74, 1], ['岩手', 39.70, 141.15, 1], ['宮城', 38.27, 140.87, 1], ['秋田', 39.72, 140.10, 1],
  ['山形', 38.24, 140.36, 1], ['福島', 37.75, 140.47, 1], ['茨城', 36.34, 140.45, 2], ['栃木', 36.57, 139.88, 2], ['群馬', 36.39, 139.06, 2],
  ['埼玉', 35.86, 139.65, 2], ['千葉', 35.60, 140.12, 2], ['東京', 35.69, 139.69, 2], ['神奈川', 35.45, 139.64, 2], ['新潟', 37.90, 139.02, 3],
  ['富山', 36.70, 137.21, 3], ['石川', 36.59, 136.63, 3], ['福井', 36.07, 136.22, 3], ['山梨', 35.66, 138.57, 3], ['長野', 36.65, 138.18, 3],
  ['岐阜', 35.39, 136.72, 3], ['静岡', 34.98, 138.38, 3], ['愛知', 35.18, 136.91, 3], ['三重', 34.73, 136.51, 4], ['滋賀', 35.00, 135.87, 4],
  ['京都', 35.02, 135.76, 4], ['大阪', 34.69, 135.52, 4], ['兵庫', 34.69, 135.18, 4], ['奈良', 34.69, 135.83, 4], ['和歌山', 34.23, 135.17, 4],
  ['鳥取', 35.50, 134.24, 5], ['島根', 35.47, 133.05, 5], ['岡山', 34.66, 133.93, 5], ['広島', 34.40, 132.46, 5], ['山口', 34.19, 131.47, 5],
  ['徳島', 34.07, 134.56, 6], ['香川', 34.34, 134.04, 6], ['愛媛', 33.84, 132.77, 6], ['高知', 33.56, 133.53, 6], ['福岡', 33.61, 130.42, 7],
  ['佐賀', 33.25, 130.30, 7], ['長崎', 32.74, 129.87, 7], ['熊本', 32.79, 130.74, 7], ['大分', 33.24, 131.61, 7], ['宮崎', 31.91, 131.42, 7],
  ['鹿児島', 31.56, 130.56, 7], ['沖縄', 26.21, 127.68, 8],
];
const PREF_AT = new Map(PREFS.map(([name, lat, lon, region]) => [name, { name, lat, lon, region }]));
const REGION_AT = REGIONS.map((name, r) => {
  const ps = PREFS.filter((p) => p[3] === r);
  return { name, lat: ps.reduce((a, p) => a + p[1], 0) / ps.length, lon: ps.reduce((a, p) => a + p[2], 0) / ps.length };
});
const ALIAS = { Tokyo: '東京', Osaka: '大阪', Kyoto: '京都', Okinawa: '沖縄', Hokkaido: '北海道', Fukuoka: '福岡', Fukushima: '福島', Hiroshima: '広島', Nagasaki: '長崎', Kanagawa: '神奈川', Aichi: '愛知', Hyogo: '兵庫', Niigata: '新潟', Ishikawa: '石川', Kumamoto: '熊本', Miyagi: '宮城' };
const JP_NAMES = new Set(['日本', 'Japan', '日本国']);
// one country, several names in the sources (the bundled table says アメリカ, the board's rules say 米国)
const COUNTRY_ALIAS = { アメリカ: '米国', 'アメリカ合衆国': '米国', 合衆国: '米国', イギリス: '英国', オーストラリア: '豪州', 大韓民国: '韓国', 中華人民共和国: '中国' };
const JP_AT = { lat: 36.2, lon: 138.3 };

/** "東京" / "東京都" / "茨城県" / "京都府" / "Tokyo" -> the prefecture's short name, or null */
export function prefOf(name) {
  const s = String(name || '').trim();
  if (!s) return null;
  if (PREF_AT.has(s)) return s;
  if (ALIAS[s]) return ALIAS[s];
  if (/[都府県]$/.test(s) && PREF_AT.has(s.slice(0, -1))) return s.slice(0, -1);
  return null;
}
const nameKey = (name) => {
  const s = String(name || '').trim();
  return prefOf(s) || (JP_NAMES.has(s) ? '日本' : COUNTRY_ALIAS[s] || s);
};
/** a place inside Japan that is not a prefecture name (横浜, 能登, 嘉手納): the nearest prefecture within reach */
function nearestPref(lat, lon) {
  if (!(lat > 24 && lat < 46 && lon > 122.5 && lon < 149)) return null;
  let best = null, bd = 1.4;
  for (const p of PREF_AT.values()) {
    const d = Math.hypot(p.lat - lat, (p.lon - lon) * Math.cos((lat * Math.PI) / 180));
    if (d < bd) { bd = d; best = p.name; }
  }
  return best;
}

/** the marks to draw at scale s (px per degree): [{ kind: 'one' | 'cluster', level, name, lat, lon, n, pri, country, best, kids }] */
export function marksAt(points, s) {
  const groups = [], byName = new Map();
  for (const p of points || []) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const nm = nameKey(p.name), pf = prefOf(nm);
    const list = byName.get(nm) || [];
    let m = nm ? list.find((q) => Math.abs(q.lat - p.lat) < 10 && Math.abs(lonDiff(q.lon, p.lon)) < 10) : null;
    if (!m) {
      const at = pf ? PREF_AT.get(pf) : p;
      m = { kind: 'one', name: nm || String(p.name || ''), lat: at.lat, lon: at.lon, n: 0, pri: 0, country: true, best: p, pref: pf, jp: nm === '日本' };
      list.push(m); byName.set(nm, list); groups.push(m);
    }
    m.n += p.n || 0;
    if (p.pri) m.pri = 1;
    if (!p.country) m.country = false;
    if ((p.n || 0) > (m.best.n || 0)) { m.best = p; if (!pf) { m.lat = p.lat; m.lon = p.lon; } }
  }
  const out = [], byPref = new Map(), nation = [];
  for (const m of groups) {
    if (!m.pref && !m.jp && !m.country) m.pref = nearestPref(m.lat, m.lon);
    if (m.jp) nation.push(m);
    else if (m.pref) { if (!byPref.has(m.pref)) byPref.set(m.pref, []); byPref.get(m.pref).push(m); }
    else out.push(m);
  }
  const heaviest = (ms) => ms.reduce((a, b) => ((b.best.n || 0) > (a.best.n || 0) ? b : a)).best;
  const sum = (ms) => ms.reduce((a, b) => a + b.n, 0);
  const anyPri = (ms) => (ms.some((m) => m.pri) ? 1 : 0);
  const overlap = (ms, k) => {
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
      const a = ms[i], b = ms[j];
      if (Math.hypot((a.lon - b.lon) * s, (a.lat - b.lat) * s) < k * (markR(a) + markR(b)) + 2) return true;
    }
    return false;
  };
  // prefecture: the places of one prefecture are one mark (one place keeps its own name and point)
  const byRegion = new Map();
  for (const [pf, ms] of byPref) {
    const at = PREF_AT.get(pf);
    const m = ms.length === 1 ? ms[0] : { kind: 'one', name: pf, lat: at.lat, lon: at.lon, n: sum(ms), pri: anyPri(ms), country: false, best: heaviest(ms) };
    m.level = 'pref';
    if (!byRegion.has(at.region)) byRegion.set(at.region, []);
    byRegion.get(at.region).push(m);
  }
  // region: when two of its prefectures would overlap
  const reps = [], jp = [];
  for (const [r, ms] of byRegion) {
    const at = ms.length === 1 ? ms[0] : REGION_AT[r];
    const rep = { kind: 'cluster', level: 'region', name: REGIONS[r], lat: at.lat, lon: at.lon, n: sum(ms), pri: anyPri(ms), country: false, best: heaviest(ms), kids: ms };
    reps.push(rep);
    if (ms.length > 1 && overlap(ms, 0.8)) jp.push(rep); else jp.push(...ms);
  }
  // the country: when two regions (or a region and the country's own point) would overlap
  const top = [...reps, ...nation];
  if (top.length > 1 && overlap(top, 0.55)) {
    out.push({ kind: 'cluster', level: 'country', name: '日本', lat: JP_AT.lat, lon: JP_AT.lon, n: sum(top), pri: anyPri(top), country: false, best: heaviest(top), kids: top });
  } else out.push(...jp, ...nation);
  return out;
}

// ---------------------------------------------------------------- the ground

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
          const v = b - r > 18 && b >= gg - 4 ? 18 : 40 + ((0.3 * r + 0.59 * gg + 0.11 * b) / 255) * 12;
          p[i] = v; p[i + 1] = v; p[i + 2] = v + 1;
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

/** the coast rings as two Path2D in degrees (x = lon, y = lat): fill (even-odd, the world-round ring closed over its pole and laid
 * three times so any copy of the world is covered) and line (the coast alone) */
function coastPaths(lod) {
  const { xy, start, kind } = lod;
  const fill = new Path2D(), line = new Path2D();
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < kind.length; i++) {
    const a = start[i], b = start[i + 1];
    if (b - a < 2) continue;
    const k = kind[i];
    if (k === 2 || k === 3) {
      const pole = k === 2 ? -90 : 90;
      fill.moveTo(xy[2 * a] - 360, pole); line.moveTo(xy[2 * a] - 360, xy[2 * a + 1]);
      for (let c = -1; c <= 1; c++) for (let j = a; j < b; j++) { fill.lineTo(xy[2 * j] + 360 * c, xy[2 * j + 1]); line.lineTo(xy[2 * j] + 360 * c, xy[2 * j + 1]); }
      fill.lineTo(xy[2 * (b - 1)] + 360, pole); fill.closePath();
      continue;
    }
    fill.moveTo(xy[2 * a], xy[2 * a + 1]); line.moveTo(xy[2 * a], xy[2 * a + 1]);
    for (let j = a; j < b; j++) {
      const x = xy[2 * j], y = xy[2 * j + 1];
      if (j > a) { fill.lineTo(x, y); line.lineTo(x, y); }
      if (x < lo) lo = x; if (x > hi) hi = x;
    }
    fill.closePath();
    if (k === 1) line.closePath();
  }
  return { fill, line, lo: Number.isFinite(lo) ? lo : -180, hi: Number.isFinite(hi) ? hi : 180 };
}

let groundP = null;
const hiListeners = new Set();
/** -> Promise<{ world, coast: { fine, coarse } | null, render(view) -> Promise<{ land, water } | null> | null }> */
function loadGround(base, hi) {
  if (groundP) return groundP;
  groundP = new Promise((resolve) => {
    let w = null;
    try { if (typeof OffscreenCanvas === 'function' && typeof Worker === 'function' && typeof Path2D === 'function') w = new Worker(new URL('./map_worker.js', import.meta.url)); } catch { w = null; }
    const plain = () => composeHere(base).then((c) => resolve({ world: c, coast: null, render: null }));
    if (!w) { plain(); return; }
    const pending = new Map();
    let ready = false;
    const fail = () => { if (ready) return; ready = true; try { w.terminate(); } catch { /* */ } plain(); };
    w.onmessage = (ev) => {
      const d = ev.data || {};
      if (d.world) {
        ready = true;
        let coast = null;
        try { if (d.coast) coast = { fine: coastPaths(d.coast.fine), coarse: coastPaths(d.coast.coarse) }; } catch { coast = null; }
        resolve({ world: d.world, coast, render: (v) => new Promise((res) => { pending.set(v.key, res); w.postMessage({ view: v }); }) });
        return;
      }
      if (d.hi) { for (const f of hiListeners) f(); return; }
      if (d.key != null && pending.has(d.key)) { const r = pending.get(d.key); pending.delete(d.key); r(d.bitmap ? { land: d.bitmap, water: d.water || null } : null); return; }
      if (d.error) fail();
    };
    w.onerror = fail;
    const msg = { base: new URL(base, location.href).href, cols: COLS, rows: ROWS, tile: TILE };
    if (hi) { try { msg.hi = new URL(hi, location.href).href; } catch { /* no higher-resolution ground */ } }
    w.postMessage(msg);
  });
  return groundP;
}

export function createMap(canvas, opts = {}) {
  const base = opts.base || 'assets/map/ne2/2';
  const hiSrc = opts.hi || (typeof document === 'object' && document.querySelector('meta[name="parallax-map-hi"]') ? document.querySelector('meta[name="parallax-map-hi"]').content : null);
  const g = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let scene = null, view = null, anim = null, world = null, coast = null, render = null, sharp = null, sharpReq = 0, picks = [], settle = 0, held = false;
  let pulse = null, drag = null;
  const pulsed = new Set();
  // the detailed ground: when a sheet arrives, paint again unless the map is moving (the next frame takes it)
  const basemap = opts.basemap === false ? null : createBasemap({ onReady: () => { if (scene && view && !anim && !drag) paint(view, false); } });
  // for inspection only (the state of the detailed ground: sheets, requests, failures)
  try { Object.defineProperty(canvas, 'groundStats', { value: () => (basemap ? basemap.stats() : null), configurable: true }); } catch { /* */ }
  const reduce = () => document.documentElement.hasAttribute('data-calm') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function size() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    // the layout size: a canvas turned in 3D has a different box on the screen
    W = Math.max(1, Math.round(canvas.clientWidth || r.width)); H = Math.max(1, Math.round(canvas.clientHeight || r.height));
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  }
  const minS = () => Math.max(W / 360, H / 170);
  function target(sc) {
    if (sc && sc.focus) {
      const s = Math.max(W / (sc.span || SPAN), minS());
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
  /** the canvas transform that draws degrees (copy k of the world) */
  const geo = (v, k) => g.setTransform(dpr * v.s, 0, 0, -dpr * v.s, dpr * v.s * (360 * k - v.lon0), dpr * v.s * v.lat0);
  const copies = (v, P) => {
    const a = v.lon0, b = v.lon0 + W / v.s, out = [];
    for (let k = -1; k <= 2; k++) if (b > P.lo + 360 * k && a < P.hi + 360 * k) out.push(k);
    return out.length ? out : [0];
  };

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
  /** [r, g, b] of a hex colour, or null */
  function rgbOf(hex) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  /** a red that fades out from (x, y) over r px, for the envelope; null when the colour is not a hex */
  function fade(hex, x, y, r) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
    if (!m || !(r > 0)) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    const [R, G, B] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${R},${G},${B},.38)`); gr.addColorStop(0.55, `rgba(${R},${G},${B},.26)`); gr.addColorStop(1, `rgba(${R},${G},${B},0)`);
    return gr;
  }

  const closeSharp = (sh) => { if (!sh) return; try { sh.land.close(); } catch { /* */ } try { if (sh.water) sh.water.close(); } catch { /* */ } };
  function requestSharp(v) {
    if (!render) return;
    const key = keyOf(v), id = ++sharpReq;
    render({ lon0: v.lon0, lat0: v.lat0, s: v.s, w: W, h: H, dpr, key }).then((bm) => {
      if (!bm) return;
      if (id !== sharpReq) { closeSharp(bm); return; }
      closeSharp(sharp);
      sharp = { key, land: bm.land, water: bm.water };
      if (view && !anim && keyOf(view) === key) paint(view, false);
    });
  }

  function colours() {
    return {
      sea: css(canvas, '--map-sea', '#121315'), land: css(canvas, '--map-land', '#2a2a2b'), coast: css(canvas, '--map-coast', 'rgba(226,228,232,.34)'),
      grid: css(canvas, '--map-grid', 'rgba(255,255,255,.05)'), label: css(canvas, '--map-label', '#c9cbcf'),
      dot: css(canvas, '--map-dot', 'rgba(231,232,234,.15)'), ink: css(canvas, '--ink', '#e6e7e9'), ink2: css(canvas, '--ink-2', '#a2a5aa'),
      ink3: css(canvas, '--ink-3', '#6f7277'), ink4: css(canvas, '--ink-4', '#4e5156'), red: css(canvas, '--red', '#ff5246'), cyan: css(canvas, '--cyan', '#5ac8f0'),
      font: css(canvas, '--font', 'sans-serif'), halo: css(canvas, '--map-halo', 'rgba(14,15,17,.92)'), light: css(canvas, '--map-mode', '') === 'light',
    };
  }

  function drawWorld(v, quick) {
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = quick ? 'low' : 'high';
    const w = 360 * v.s, h = 180 * v.s, x0 = (-180 - v.lon0) * v.s, y0 = (v.lat0 - 90) * v.s;
    for (const off of [-2 * w, -w, 0, w, 2 * w]) if (x0 + off < W && x0 + off + w > 0) g.drawImage(world, 0, 0, WW, WH, x0 + off, y0, w, h);
  }
  /** the ground: the detailed sheets where they cover the view, the bundled ground under them where they do not */
  function ground(v, quick, C) {
    if (!basemap) { bundled(v, quick, C); return; }
    basemap.colours({ sea: C.sea, land: C.land, coast: C.coast, light: C.light });
    basemap.paint(g, { w: W, h: H, K: dpr, lonL: v.lon0, latT: v.lat0, ppd: v.s, moving: !!quick }, () => bundled(v, quick, C));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  /** the relief over the land, as drawn (a grey about the land tone, LAND = 42 in js/map_worker.js); for the light appearance
   *  (--map-mode: light) the same picture added onto a ground set so that the mean comes out at the light land tone: the land stays
   *  near white, lit slopes lighter and slopes turned away darker, the light still from the north-west */
  function relief(v, quick, C, sh) {
    const draw = () => { if (sh) { g.imageSmoothingEnabled = false; g.drawImage(sh.land, 0, 0, W, H); } else if (world) drawWorld(v, quick); };
    if (!C.light || (!sh && !world)) { draw(); return; }
    const K = 0.42, L = rgbOf(C.land) || [244, 244, 245];
    g.save();
    g.fillStyle = `rgb(${L.map((c) => Math.round(c - 42 * K)).join(',')})`; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = K; draw();
    g.restore();
  }
  /** sea, land (vector rings, the relief clipped to them), the coast as one fine line */
  function bundled(v, quick, C) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C.sea; g.fillRect(0, 0, W, H);
    const sh = sharp && sharp.key === keyOf(v) ? sharp : null;
    if (!quick && !sh && render) requestSharp(v);
    if (!coast) {
      relief(v, quick, C, sh);
      return;
    }
    if (sh && sh.water) { g.imageSmoothingEnabled = false; g.drawImage(sh.water, 0, 0, W, H); }
    const P = v.s < 9 ? coast.coarse : coast.fine;
    const ks = copies(v, P);
    for (const k of ks) {
      g.save();
      geo(v, k);
      g.fillStyle = C.land; g.fill(P.fill, 'evenodd');
      g.clip(P.fill, 'evenodd');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      relief(v, quick, C, sh);
      g.restore();
    }
    g.save();
    g.strokeStyle = C.coast; g.lineJoin = 'round'; g.lineCap = 'round';
    for (const k of ks) { geo(v, k); g.lineWidth = 0.8 / v.s; g.stroke(P.line); }
    g.restore();
  }


  function paint(v, quick) {
    if (pulse && pulse.running) pulse.dirty = true;
    const sc = scene || {};
    const L = sc.layers || {};
    const C = colours();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = C.sea; g.fillRect(0, 0, W, H);
    ground(v, quick, C);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // graticule: hairlines of one device pixel
    const step = v.s > 24 ? 5 : v.s > 6 ? 10 : 30;
    const px = (u) => (Math.round(u * dpr) + 0.5) / dpr;
    g.strokeStyle = C.grid; g.lineWidth = 1 / dpr; g.beginPath();
    for (let lon = -180; lon < 180; lon += step) { const x = px(X(v, lon)); if (x > 0 && x < W) { g.moveTo(x, 0); g.lineTo(x, H); } }
    for (let lat = -80; lat <= 80; lat += step) { const y = px(Y(v, lat)); if (y > 0 && y < H) { g.moveTo(0, y); g.lineTo(W, y); } }
    g.stroke();

    const hits = [], labels = [], storms = [], marks = [];
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
      g.strokeStyle = hot ? C.red : C.ink2; g.globalAlpha = hot ? 1 : 0.55; g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(x, y - 4.5); g.lineTo(x + 4.5, y); g.lineTo(x, y + 4.5); g.lineTo(x - 4.5, y); g.closePath(); g.stroke(); g.globalAlpha = 1;
      hits.push({ x, y, r: 8, kind: 'disaster', d });
      if (hot) labels.push({ x, y, r: 6, text: d.name, rank: 4.2, t: tier.hazard });
    }
    // typhoons: the forecast cone as a faint area only; the envelope near the centre, fading; the forecast circles dotted; the
    // gale and storm areas as fills; the past track with its points
    if (L.typhoons !== false) for (const t of sc.typhoons || []) {
      const [la, lo] = t.center;
      const gale = t.galeC || { center: t.center, km: Math.max(0, ...t.gale.map((r) => r.km || 0)) };
      const storm = t.stormC || { center: t.center, km: Math.max(0, ...t.storm.map((r) => r.km || 0)) };
      const x = X(v, lo), y = Y(v, la);
      if (t.cone && t.cone.length) {
        g.fillStyle = C.red; g.globalAlpha = 0.035;
        for (const poly of t.cone) { if (!Array.isArray(poly) || poly.length < 3) continue; line(v, poly); g.closePath(); g.fill(); }
        g.globalAlpha = 1;
      }
      if (!quick && (t.envelope || t.forecast.some((f) => f.area))) {
        const rad = kmY(v, ENVELOPE_KM);
        g.save(); g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.clip();
        const gr = fade(C.red, x, y, rad);
        g.strokeStyle = gr || C.red; g.globalAlpha = gr ? 1 : 0.3; g.lineWidth = 1;
        if (t.envelope) arcs(v, t.envelope);
        for (const f of t.forecast) if (f.area) arcs(v, f.area);
        g.restore(); g.globalAlpha = 1;
      }
      for (const f of t.forecast) {
        if (f.radiusKm) { ring(v, f.center[0], f.center[1], f.radiusKm); g.strokeStyle = C.red; g.globalAlpha = 0.5; g.setLineDash([1.5, 3]); g.lineWidth = 1; g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
      }
      if (gale.km) { ring(v, gale.center[0], gale.center[1], gale.km); g.fillStyle = C.red; g.globalAlpha = 0.07; g.fill(); g.globalAlpha = 0.45; g.strokeStyle = C.red; g.lineWidth = 1; g.stroke(); g.globalAlpha = 1; }
      if (storm.km) { ring(v, storm.center[0], storm.center[1], storm.km); g.fillStyle = C.red; g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 0.9; g.strokeStyle = C.red; g.lineWidth = 1.2; g.stroke(); g.globalAlpha = 1; }
      if (t.track.length > 1) {
        line(v, [...t.track, t.center]); g.strokeStyle = C.ink2; g.globalAlpha = 0.7; g.lineWidth = 1; g.stroke();
        g.fillStyle = C.ink2;
        for (const [pa, po] of t.track) { g.beginPath(); g.arc(X(v, po), Y(v, pa), 1, 0, Math.PI * 2); g.fill(); }
        g.globalAlpha = 1;
      }
      const path = [t.center, ...t.forecast.map((f) => f.center)];
      if (path.length > 1) { line(v, path); g.strokeStyle = C.red; g.globalAlpha = 0.85; g.setLineDash([4, 3]); g.lineWidth = 1.1; g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
      for (const f of t.forecast) {
        const fx = X(v, f.center[1]), fy = Y(v, f.center[0]);
        g.fillStyle = C.sea; g.beginPath(); g.arc(fx, fy, 2.6, 0, Math.PI * 2); g.fill();
        g.strokeStyle = C.red; g.lineWidth = 1.2; g.stroke();
        const when = dayHour(f.ts);
        if (when) labels.push({ x: fx, y: fy, r: 4, text: when, rank: 0.6, t: tier.faint });
      }
      g.fillStyle = C.red; g.beginPath(); g.arc(x, y, 3.4, 0, Math.PI * 2); g.fill();
      g.strokeStyle = C.red; g.lineWidth = 1.4; g.beginPath(); g.arc(x, y, 7.5, 0, Math.PI * 2); g.stroke();
      hits.push({ x, y, r: 12, kind: 'typhoon', t });
      storms.push({ x, y, rr: Math.max(56, (gale.km ? kmY(v, gale.km) : 0) * 0.9) });
      const no = Number(String(t.number || '').slice(-2));
      const nm = /台風|サイクロン|ハリケーン|熱帯/.test(t.name) ? t.name : `台風${no ? no + '号' : ''} ${t.name}`;
      labels.push({ x, y, r: 9, text: nm.trim(), sub: t.pressure ? ` ${t.pressure} hPa` : '', rank: 5, t: tier.hazard });
    }
    // quakes: a ring whose radius follows the magnitude; red from M5 or intensity 4. Labels for the strongest only: none near a
    // typhoon's centre (the typhoon speaks there), none beside a stronger labelled quake
    if (L.quakes !== false) {
      const qs = [...(sc.quakes || [])].sort((a, b) => a.mag - b.mag);
      const said = [];
      const sayable = [];
      for (const q of qs) {
        const x = X(v, q.lon), y = Y(v, q.lat);
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
        const r = quakeR(q.mag), hot = hotQuake(q);
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
        if (hot) { g.fillStyle = C.red; g.globalAlpha = 0.14; g.fill(); }
        g.globalAlpha = hot ? 1 : 0.5; g.strokeStyle = hot ? C.red : C.ink2; g.lineWidth = hot ? 1.3 : 1; g.stroke(); g.globalAlpha = 1;
        hits.push({ x, y, r: r + 4, kind: 'quake', q, hot });
        if (hot || q.mag >= 4.5) sayable.push({ q, x, y, r, hot });
      }
      for (const k of sayable.reverse()) {
        if (storms.some((st) => Math.hypot(k.x - st.x, k.y - st.y) < st.rr)) continue;
        if (said.some((o) => Math.hypot(k.x - o.x, k.y - o.y) < 40)) continue;
        said.push(k);
        const q = k.q;
        labels.push({ x: k.x, y: k.y, r: k.r, text: `M${q.mag.toFixed(1)}`, sub: q.shindo ? ` 震度${q.shindo.replace('-', '弱').replace('+', '強')}` : '', rank: k.hot ? 4 + q.mag / 100 : 1.4 + q.mag / 100, t: k.hot ? tier.hazard : tier.small });
      }
    }
    // events with a place: one mark per name; inside Japan folded by the scale. A country's representative point is a dashed ring.
    const f = sc.focus;
    let fbox = null;
    if (f && f.label && !sc.pillars) fbox = { x: X(v, f.lon), y: Y(v, f.lat), r: 10, text: f.label, rank: 100, t: tier.focus };
    if (L.events !== false) {
      const ms = marksAt(sc.points || [], v.s).sort((a, b) => (a.pri - b.pri) || (a.n - b.n));
      const fk = f && f.label ? nameKey(f.label) : null;
      for (const m of ms) {
        const x = X(v, m.lon), y = Y(v, m.lat);
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
        const cl = m.kind === 'cluster', r = markR(m), pri = m.pri && L.pri !== false;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
        if (m.country && !cl) { g.setLineDash([2, 2.5]); g.strokeStyle = C.ink2; g.globalAlpha = 0.7; g.lineWidth = 1; g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
        else {
          g.fillStyle = C.dot; g.fill();
          g.strokeStyle = pri ? C.ink : C.ink2; g.globalAlpha = pri ? 0.95 : cl ? 0.7 : 0.5; g.lineWidth = pri ? 1.3 : 1; g.stroke();
          if (cl) { g.beginPath(); g.arc(x, y, r + 3, 0, Math.PI * 2); g.globalAlpha = 0.24; g.lineWidth = 1; g.stroke(); }
          g.globalAlpha = 1;
          if (pri) { g.fillStyle = C.ink; g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); }
        }
        hits.push(cl ? { x, y, r: r + 5, kind: 'cluster', m } : { x, y, r: r + 5, kind: 'event', p: m.best });
        marks.push({ x, y, name: m.name, n: m.n, pri: !!pri, cluster: cl });
        if (fbox && fk && m.name === fk && Math.hypot(x - fbox.x, y - fbox.y) < 40) { fbox.sub = ` ${m.n}`; continue; }
        if (!m.name || !(cl || m.pri || m.n >= 2 || v.s >= 40)) continue;
        const t = m.country && !cl ? tier.faint : (m.pri && m.n >= 3) || (cl && m.n >= 10) ? tier.big : m.n >= 3 || m.pri || cl ? tier.mid : tier.small;
        if (!(sc.pillars && pri)) labels.push({ x, y, r: r + (cl ? 3 : 1), text: m.name, sub: ` ${m.n}`, rank: (m.pri ? 3 : m.country && !cl ? 1 : 2) + Math.min(m.n, 999) / 1000, t, name: true });
      }
    }
    // focus
    if (f) {
      const fx = X(v, f.lon), fy = Y(v, f.lat);
      if (f.radiusKm && L.radius !== false) {
        ring(v, f.lat, f.lon, f.radiusKm); g.strokeStyle = C.cyan; g.globalAlpha = 0.6; g.setLineDash([4, 3]); g.lineWidth = 1; g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
        if (!quick) labels.push({ x: fx, y: fy - kmY(v, f.radiusKm), r: 2, text: `${f.radiusKm} km`, rank: 4.8, t: { ...tier.faint, color: C.cyan } });
      }
      g.fillStyle = C.cyan; g.beginPath(); g.arc(fx, fy, 3.6, 0, Math.PI * 2); g.fill();
      g.strokeStyle = C.cyan; g.lineWidth = 1.3; g.beginPath(); g.arc(fx, fy, 8, 0, Math.PI * 2); g.stroke();
    }
    if (quick) return;
    // degree labels on the edges, small and quiet
    g.font = `9px ${C.font}`; g.fillStyle = C.ink4; g.textBaseline = 'top';
    for (let lon = -180; lon < 180; lon += step) { const x = X(v, lon); if (x > 30 && x < W - 40) g.fillText(`${Math.abs(lon)}°${lon < 0 ? 'W' : lon > 0 ? 'E' : ''}`, x + 3, 4); }
    g.textBaseline = 'middle';
    for (let lat = -80; lat <= 80; lat += step) { const y = Y(v, lat); if (y > 20 && y < H - 24) g.fillText(`${Math.abs(lat)}°${lat < 0 ? 'S' : lat > 0 ? 'N' : ''}`, 5, y - 7); }
    // labels: the focus first, then by rank; one that would overlap another label or a mark is not drawn (a dark halo, no plates)
    const boxes = [], names = new Set();
    const budget = Math.max(8, Math.floor((W * H) / 17000));
    let drawn = 0;
    const place = (l) => {
      const st = l.t;
      g.font = `${st.wt} ${st.px}px ${C.font}`;
      const w1 = g.measureText(l.text).width;
      const subPx = Math.max(9, st.px - 1.5);
      let w2 = 0;
      if (l.sub) { g.font = `400 ${subPx}px ${C.font}`; w2 = g.measureText(l.sub).width; }
      const w = w1 + w2, hgt = st.px + 4;
      // first a place clear of everything; failing that, one that only covers a small quake ring (a soft box)
      for (const relaxed of [false, true]) for (const [bx, by] of [[l.x + l.r + 4, l.y - hgt / 2], [l.x - l.r - 4 - w, l.y - hgt / 2], [l.x - w / 2, l.y - l.r - hgt - 1], [l.x - w / 2, l.y + l.r + 1]]) {
        const b = [bx - 1, by, w + 2, hgt];
        if (b[0] < 2 || b[0] + b[2] > W - 2 || b[1] < 2 || b[1] + b[3] > H - 16) continue;
        if (boxes.some((o) => !(relaxed && o[4]) && b[0] < o[0] + o[2] && b[0] + b[2] > o[0] && b[1] < o[1] + o[3] && b[1] + b[3] > o[1])) continue;
        boxes.push(b);
        g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = C.halo;
        const ty = by + hgt / 2 + 0.5;
        g.font = `${st.wt} ${st.px}px ${C.font}`; g.strokeText(l.text, bx, ty); g.fillStyle = st.color; g.fillText(l.text, bx, ty);
        if (l.sub) { g.font = `400 ${subPx}px ${C.font}`; g.strokeText(l.sub, bx + w1, ty); g.fillStyle = st.sub; g.fillText(l.sub, bx + w1, ty); }
        return true;
      }
      return false;
    };
    // the marks themselves are kept free of text (the core of each circle)
    for (const h of hits) {
      const r = h.kind === 'cluster' || h.kind === 'event' ? Math.max(3, (h.r - 5) * 0.8) : h.kind === 'quake' ? Math.max(2.5, (h.r - 4) * 0.8) : 4;
      boxes.push([h.x - r, h.y - r, 2 * r, 2 * r, h.kind === 'quake' && !h.hot]);
    }
    if (fbox) { place(fbox); names.add(nameKey(fbox.text)); }
    for (const l of labels.sort((a, b) => b.rank - a.rank)) {
      if (drawn >= budget) break;
      if (l.name && names.has(l.text)) continue;
      if (place(l)) { drawn++; if (l.name) names.add(l.text); }
    }
    picks = hits;
    if (opts.onPaint) opts.onPaint({ view: v, w: W, h: H, marks, moving: !!quick });
  }

  /** a folded mark opens: zoom so its members stand apart (or, when they cannot, the heaviest event is chosen) */
  function zoomInto(m, x, y) {
    if (!view) return;
    const kids = m.kids && m.kids.length ? m.kids : [m], fac = m.level === 'country' ? 0.55 : 0.8;
    let need = 0, a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (let i = 0; i < kids.length; i++) {
      const p = kids[i];
      a = Math.min(a, p.lon); b = Math.max(b, p.lon); c = Math.min(c, p.lat); d = Math.max(d, p.lat);
      for (let j = i + 1; j < kids.length; j++) {
        const q = kids[j], dd = Math.hypot(p.lon - q.lon, p.lat - q.lat);
        if (dd > 1e-6) need = Math.max(need, (fac * (markR(p) + markR(q)) + 2) / dd);
      }
    }
    const fit = Math.min((W * 0.7) / Math.max(0.6, b - a), (H * 0.7) / Math.max(0.6, d - c));
    let s = Math.max(need * 1.12, Math.min(fit, view.s * 3));
    s = Math.min(W / 6, Math.max(view.s * 1.35, s));
    if (s <= view.s * 1.02) { if (opts.onPick && m.best) opts.onPick({ x, y, r: 0, kind: 'event', p: m.best }); return; }
    const to = clampV({ lon0: (a + b) / 2 - W / 2 / s, lat0: (c + d) / 2 + H / 2 / s, s });
    held = true; pulse = null;
    if (reduce()) { anim = null; view = to; paint(view, false); }
    else { anim = { from: view, to, t0: performance.now() }; requestAnimationFrame(frame); }
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
    view = t < 1 ? { lon0: a.lon0 + dl * k, lat0: a.lat0 + (b.lat0 - a.lat0) * k, s: a.s + (b.s - a.s) * k } : b;
    paint(view, t < 1);
    if (t < 1) requestAnimationFrame(frame); else { anim = null; ringNew(freshQuakes()); }
  }
  function later() { clearTimeout(settle); settle = setTimeout(() => { if (scene && view) paint(view, false); }, SETTLE_MS); }

  const finite = (v) => v && Number.isFinite(v.lon0) && Number.isFinite(v.lat0) && Number.isFinite(v.s) && v.s > 0;
  function show(sc, animate) {
    const moved = !scene || JSON.stringify(scene.focus) !== JSON.stringify(sc.focus) || scene.span !== sc.span;
    scene = sc;
    size();
    if (!moved && view) { paint(view, false); ringNew(freshQuakes()); return; }
    held = false;
    const to = target(sc);
    if (animate && finite(view) && finite(to) && !reduce()) { anim = { from: view, to, t0: performance.now() }; requestAnimationFrame(frame); }
    else { anim = null; view = to; paint(view, false); ringNew(freshQuakes()); }
  }

  // the point under the pointer on the canvas (through the turn of the floor when the caller knows it)
  const local = (ev) => {
    const p = opts.local ? opts.local(ev.clientX, ev.clientY) : null;
    if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) return p;
    const r = canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (ev) => { if (!view) return; const [x, y] = local(ev); drag = { x, y, v: view, moved: false }; try { canvas.setPointerCapture(ev.pointerId); } catch { /* */ } });
  canvas.addEventListener('pointermove', (ev) => {
    const [lx, ly] = local(ev);
    if (drag) {
      const dx = lx - drag.x, dy = ly - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true; held = true; anim = null; pulse = null;
      view = clampV({ lon0: drag.v.lon0 - dx / drag.v.s, lat0: drag.v.lat0 + dy / drag.v.s, s: drag.v.s });
      paint(view, true); later();
      return;
    }
    canvas.style.cursor = api.pick(lx, ly) ? 'pointer' : 'grab';
  });
  canvas.addEventListener('pointerup', (ev) => {
    const d = drag; drag = null;
    if (!d || d.moved) return;
    const [x, y] = local(ev);
    const hit = api.pick(x, y);
    if (!hit) return;
    if (hit.kind === 'cluster') zoomInto(hit.m, hit.x, hit.y);
    else if (opts.onPick) opts.onPick(hit);
  });
  function onWheel(ev) {
    if (!view) return;
    ev.preventDefault();
    const [lx, ly] = local(ev), mx = Math.max(0, Math.min(W, lx)), my = Math.max(0, Math.min(H, ly));
    const k = Math.pow(1.0018, -ev.deltaY);
    const lon = view.lon0 + mx / view.s, lat = view.lat0 - my / view.s;
    const s = Math.max(minS(), Math.min(W / 6, view.s * k));
    held = true; anim = null; pulse = null;
    view = clampV({ lon0: lon - mx / s, lat0: lat + my / s, s });
    paint(view, true); later();
  }
  if (opts.wheel !== false) canvas.addEventListener('wheel', onWheel, { passive: false });
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
    xy: (lat, lon) => (view ? [X(view, lon), Y(view, lat)] : null),
    wheel: onWheel,
  };
  hiListeners.add(() => { closeSharp(sharp); sharp = null; if (scene && view && !anim) paint(view, false); });
  loadGround(base, hiSrc).then((gr) => { world = gr.world; coast = gr.coast; render = gr.render; if (scene && !anim && view) paint(view, false); });
  return api;
}
