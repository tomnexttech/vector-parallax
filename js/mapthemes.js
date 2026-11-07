/* mapthemes — the map coloured by a theme: how many articles of it are placed in each country and prefecture. No DOM, except Path2D on demand.
 *
 *   loadBorders(url)                  -> Promise<borders>   assets/map/borders.json (tools/build_borders.py; Natural Earth, public domain)
 *   decodeBorders(doc)                -> { countries, prefs, byName, prefByName, japan }   entries { name, iso, box, rings, cx, cy, w, path }
 *   whereIs(b, { lat, lon, name, country })  -> { country, pref }   by name first, then by the outline, then the nearest within a degree and a half
 *   tally(b, rows)                    -> { countries, prefs: [{ e, n, events }] (heaviest first), total, placed, events }   rows: { lat, lon, name, country, weight }
 *   stepsFor(max), levelOf(steps, n), levelAlpha(level, L), stepLabel(step)      the legend's steps
 *   nameList(b)                       -> the quiet names of the ground, for map.setNames
 *
 * The count is what it says: articles with a known place, nothing about what they say. The lines are Natural Earth's lines of de facto
 * control, a guide for colouring only. */
import { nameKey, prefOf } from './map.js';

const inBox = (b, lat, lon) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

function decodeRing(code, unit) {
  const out = new Float32Array(code.length);
  let x = 0, y = 0;
  for (let i = 0; i < code.length; i += 2) { x += code[i]; y += code[i + 1]; out[i] = x / unit; out[i + 1] = y / unit; }
  return out;
}
function ringArea(r) {
  let a = 0, cx = 0, cy = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, x0 = r[2 * i], y0 = r[2 * i + 1], x1 = r[2 * j], y1 = r[2 * j + 1], c = x0 * y1 - x1 * y0;
    a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  }
  return a ? { area: Math.abs(a / 2), cx: cx / (3 * a), cy: cy / (3 * a) } : { area: 0, cx: r[0], cy: r[1] };
}
function entry(raw, unit) {
  const rings = raw.r.map((c) => decodeRing(c, unit));
  const box = raw.b.map((v) => v / unit);
  let best = null, bestRing = null;
  for (const r of rings) { const q = ringArea(r); if (!best || q.area > best.area) { best = q; bestRing = r; } }
  let w = box[2] - box[0];
  if (bestRing) { let lo = Infinity, hi = -Infinity; for (let i = 0; i < bestRing.length; i += 2) { if (bestRing[i] < lo) lo = bestRing[i]; if (bestRing[i] > hi) hi = bestRing[i]; } w = hi - lo; }
  return { name: raw.n, iso: raw.a || '', box, rings, cx: best ? best.cx : (box[0] + box[2]) / 2, cy: best ? best.cy : (box[1] + box[3]) / 2, w, path: null };
}
export function decodeBorders(doc) {
  const countries = (doc.c || []).map((x) => entry(x, doc.cu || 20)), prefs = (doc.p || []).map((x) => entry(x, doc.pu || 100));
  const byName = new Map(countries.map((c) => [c.name, c])), prefByName = new Map(prefs.map((p) => [p.name, p]));
  return { countries, prefs, byName, prefByName, japan: byName.get('日本') || null, src: doc.src || '' };
}
export function loadBorders(url = 'assets/map/borders.json') {
  return fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then(decodeBorders);
}

/** even-odd over all the rings of an entry */
export function inEntry(e, lat, lon) {
  if (!inBox(e.box, lat, lon)) return false;
  let hit = false;
  for (const r of e.rings) {
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}
const firstIn = (list, lat, lon) => { for (const e of list) if (inEntry(e, lat, lon)) return e; return null; };
function nearest(list, lat, lon, reach) {
  let best = null, bd = reach;
  for (const e of list) {
    const b = e.box, dx = lon < b[0] ? b[0] - lon : lon > b[2] ? lon - b[2] : 0, dy = lat < b[1] ? b[1] - lat : lat > b[3] ? lat - b[3] : 0;
    if (dx > reach || dy > reach) continue;
    const c = Math.cos((lat * Math.PI) / 180);
    for (const r of e.rings) for (let i = 0; i < r.length; i += 2) { const d = Math.hypot((r[i] - lon) * c, r[i + 1] - lat); if (d < bd) { bd = d; best = e; } }
  }
  return best;
}
export function whereIs(b, { lat, lon, name, country }) {
  const key = nameKey(name), pfName = prefOf(key);
  let pref = pfName ? b.prefByName.get(pfName) || null : null;
  let c = pref ? b.japan : b.byName.get(key) || null;
  if (!c && Number.isFinite(lat) && Number.isFinite(lon)) c = firstIn(b.countries, lat, lon) || nearest(b.countries, lat, lon, 1.5);
  if (c && c === b.japan && !pref && !country && key !== '日本' && Number.isFinite(lat)) pref = firstIn(b.prefs, lat, lon) || nearest(b.prefs, lat, lon, 1);
  return { country: c, pref };
}

export function tally(b, rows) {
  const cs = new Map(), ps = new Map();
  let total = 0, placed = 0, events = 0;
  const add = (m, e, w) => { const o = m.get(e) || { e, n: 0, events: 0 }; o.n += w; o.events++; m.set(e, o); };
  for (const r of rows || []) {
    const w = r.weight > 0 ? r.weight : 1;
    total += w; events++;
    const at = whereIs(b, r);
    if (!at.country) continue;
    placed += w;
    add(cs, at.country, w);
    if (at.pref) add(ps, at.pref, w);
  }
  const heavy = (m) => [...m.values()].sort((a, c) => c.n - a.n || c.events - a.events);
  return { countries: heavy(cs), prefs: heavy(ps), total, placed, events };
}

// ---------------------------------------------------------------- the legend's steps: round numbers, at most five, each twice or so the last
const NICE = [1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 5000];
export function stepsFor(max) {
  if (!(max > 0)) return [];
  let e = NICE.filter((x) => x <= max);
  if (e.length > 5) { const out = []; for (let i = 0; i < 5; i++) out.push(e[Math.round((i * (e.length - 1)) / 4)]); e = [...new Set(out)]; }
  return e.map((from, i) => ({ from, to: i + 1 < e.length ? e[i + 1] - 1 : max }));
}
export function levelOf(steps, n) { let k = -1; for (let i = 0; i < steps.length; i++) if (n >= steps[i].from) k = i; return k; }
export const levelAlpha = (level, L) => (level < 0 ? 0 : 0.2 + 0.56 * (L > 1 ? level / (L - 1) : 1));
export const stepLabel = (s) => (s.from === s.to ? String(s.from) : `${s.from}〜${s.to}`);

/** the entry's outline in degrees, made once */
export function pathOf(e) {
  if (e.path || typeof Path2D !== 'function') return e.path;
  const p = new Path2D();
  for (const r of e.rings) {
    p.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
    p.closePath();
  }
  e.path = p;
  return p;
}
/** the quiet names of the ground */
export function nameList(b) {
  return [...b.countries.map((c) => ({ name: c.name, cx: c.cx, cy: c.cy, w: c.w, pref: false, jp: c === b.japan })),
    ...b.prefs.map((p) => ({ name: p.name, cx: p.cx, cy: p.cy, w: p.w, pref: true, jp: true }))];
}
