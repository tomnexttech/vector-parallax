/* hazards — earthquakes, typhoons and disasters for the map and the world column. No DOM.
 *
 *   loadHazards(dataDir, now) -> Hazards        reads <dataDir>hazards.json when the build wrote one, otherwise asks the public
 *                                               sources directly from the visitor's browser (all four send CORS headers)
 *   normalize(raw, now) -> Hazards              accepts the shape below (already normalized) or the raw replies of the sources
 *   distKm(a, b), bearing(a, b), nearby(center, list, km)
 *
 * Hazards = { from: 'data' | 'live' | null,
 *   quakes:    [{ id, lat, lon, mag, depthKm, place, ts, shindo, src: 'jma' | 'usgs', url }],
 *   typhoons:  [{ id, number, name, nameEn, ts, center:[lat,lon], pressure, windMs, gustMs, intensity, scale, course, speedKmh, location,
 *                 track:[[lat,lon]], forecast:[{ h, ts, center:[lat,lon], radiusKm, area:{arcs, lines} }], storm:[{area, km}], gale:[{area, km}] }],
 *   disasters: [{ id, type, name, lat, lon, alert, ts, url }],
 *   status: { usgs, jma_quake, jma_typhoon, gdacs: { ok, n, at, err } } }
 *
 * Nothing here is invented: a source that could not be read is reported as such (ok:false, n:null), never as zero. */

const USGS = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
const JMA_Q = 'https://www.jma.go.jp/bosai/quake/data/list.json';
const JMA_TC = 'https://www.jma.go.jp/bosai/typhoon/data/';
const GDACS = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP';
export const QUAKE_WINDOW_S = 24 * 3600;      // quakes of the last 24 hours
export const USGS_MIN_MAG = 4.0;               // world quakes shown from this magnitude (Japan comes from JMA)
const TIMEOUT_MS = 12000;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => { const n = typeof v === 'string' ? Number(v) : v; return isNum(n) ? n : null; };
const secs = (v) => { if (isNum(v)) return v > 1e12 ? Math.floor(v / 1000) : v; const t = Date.parse(str(v)); return Number.isFinite(t) ? Math.floor(t / 1000) : null; };
const safeUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : null; } catch { return null; } };

export function distKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
export function bearing(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const DIR8 = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
export const dir8 = (deg) => DIR8[Math.round(deg / 45) % 8];
export function nearby(center, list, km) {
  if (!center) return [];
  return arr(list).filter((x) => isNum(x.lat) && isNum(x.lon))
    .map((x) => ({ x, d: distKm(center, x), b: bearing(center, x) })).filter((o) => o.d <= km).sort((a, b) => a.d - b.d);
}

// JMA writes the intensity as 1..4, 5-, 5+, 6-, 6+, 7
export const shindoJa = (v) => { const t = str(v); return !t ? null : t.replace('-', '弱').replace('+', '強'); };
const SHINDO_RANK = { 1: 1, 2: 2, 3: 3, 4: 4, '5-': 5, '5+': 6, '6-': 7, '6+': 8, 7: 9 };
export const shindoRank = (v) => SHINDO_RANK[str(v)] || 0;

function jmaCoord(cod) {
  const m = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+)?/.exec(str(cod));
  if (!m) return null;
  return { lat: Number(m[1]), lon: Number(m[2]), depthKm: m[3] ? Math.abs(Number(m[3])) / 1000 : null };
}

function fromJmaList(list, now) {
  const seen = new Set(), out = [];
  for (const q of arr(list)) {                       // newest report first; one row per event
    if (!isObj(q) || seen.has(q.eid)) continue;
    const c = jmaCoord(q.cod), ts = secs(q.at), mag = num(q.mag);
    if (!c || !isNum(ts) || mag == null) continue;
    seen.add(q.eid);
    if (now - ts > QUAKE_WINDOW_S) continue;
    out.push({ id: 'jma-' + q.eid, lat: c.lat, lon: c.lon, depthKm: c.depthKm, mag, place: str(q.anm), ts, shindo: str(q.maxi) || null, src: 'jma', url: 'https://www.jma.go.jp/bosai/map.html#contents=earthquake_map' });
  }
  return out;
}

function fromUsgs(gj, now) {
  const out = [];
  for (const f of arr(gj && gj.features)) {
    const p = isObj(f.properties) ? f.properties : {}, g = f.geometry && arr(f.geometry.coordinates);
    const mag = num(p.mag), ts = secs(p.time);
    if (!g || g.length < 2 || mag == null || !isNum(ts) || now - ts > QUAKE_WINDOW_S) continue;
    out.push({ id: 'usgs-' + str(f.id), lat: g[1], lon: g[0], depthKm: num(g[2]), mag, place: str(p.place), ts, shindo: null, src: 'usgs', url: safeUrl(p.url) });
  }
  return out;
}

/** one list: JMA for Japan, USGS elsewhere; a USGS event within 150 km and 5 minutes of a JMA one is the same quake */
function mergeQuakes(jma, usgs) {
  const keep = usgs.filter((u) => u.mag >= USGS_MIN_MAG && !jma.some((j) => Math.abs(j.ts - u.ts) < 300 && distKm(j, u) < 150));
  return [...jma, ...keep].sort((a, b) => b.ts - a.ts);
}

function fromJmaTyphoon(tc, forecast, spec) {
  const fc = arr(forecast), sp = arr(spec);
  const title = fc.find((x) => x && x.part === 'title') || sp.find((x) => x && x.part === 'title') || {};
  const now = sp.find((x) => x && isObj(x.part) && x.advancedHours === 0) || {};
  const ana = fc.find((x) => x && isObj(x.part) && x.advancedHours === 0) || {};
  const pos = isObj(now.position) && Array.isArray(now.position.deg) ? now.position.deg : (Array.isArray(ana.center) ? ana.center : null);
  if (!pos) return null;
  const track = [...arr(ana.track && ana.track.preTyphoon), ...arr(ana.track && ana.track.typhoon)].filter((p) => Array.isArray(p) && p.length === 2);
  const forecasts = fc.filter((x) => x && isObj(x.part) && x.advancedHours > 0 && Array.isArray(x.center)).map((x) => ({
    h: x.advancedHours, ts: secs(x.validtime && x.validtime.UTC), center: x.center,
    radiusKm: isObj(x.probabilityCircle) && isNum(x.probabilityCircle.radius) ? x.probabilityCircle.radius / 1000 : null,
    area: isObj(x.stormWarningArea) ? { arcs: arr(x.stormWarningArea.arc), lines: arr(x.stormWarningArea.line) } : null,
  }));
  const wind = isObj(now.maximumWind) ? now.maximumWind : {};
  const ranges = (xs) => arr(xs).map((r) => ({ area: str(r.area), km: num(r.range && r.range.km) })).filter((r) => r.km != null);
  return {
    id: str(tc.tropicalCyclone), number: str(title.typhoonNumber || tc.typhoonNumber), name: str(title.name && title.name.jp), nameEn: str(title.name && title.name.en),
    category: str(isObj(title.category) ? title.category.jp : ''), ts: secs(now.validtime && now.validtime.UTC) || secs(tc.issue), center: pos,
    pressure: num(now.pressure), windMs: num(wind.sustained && wind.sustained['m/s']), gustMs: num(wind.gust && wind.gust['m/s']),
    intensity: str(now.intensity) === '-' ? '' : str(now.intensity), scale: str(now.scale) === '-' ? '' : str(now.scale),
    course: str(now.course), speedKmh: num(now.speed && now.speed['km/h']), location: str(now.location),
    track, forecast: forecasts, storm: ranges(now.stormWarning), gale: ranges(now.galeWarning),
    url: 'https://www.jma.go.jp/bosai/map.html#contents=typhoon',
  };
}

const GDACS_TYPE = { EQ: '地震', TC: '熱帯低気圧', FL: '洪水', VO: '火山', DR: '干ばつ', WF: '林野火災', TS: '津波' };
export const disasterJa = (t) => GDACS_TYPE[t] || t || '災害';
function fromGdacs(gj) {
  const out = [];
  for (const f of arr(gj && gj.features)) {
    const p = isObj(f.properties) ? f.properties : {}, g = f.geometry && arr(f.geometry.coordinates);
    if (!g || g.length < 2 || !isNum(g[0]) || !isNum(g[1])) continue;
    const alert = str(p.alertlevel) || 'Green';
    if (p.eventtype === 'EQ' && alert === 'Green') continue;   // ordinary quakes are already on the quake layer
    out.push({ id: `gdacs-${str(p.eventtype)}-${p.eventid}`, type: str(p.eventtype), name: str(p.name) || str(p.eventname), lat: g[1], lon: g[0],
      alert, ts: secs(p.todate) || secs(p.fromdate), url: safeUrl(p.url && p.url.report) });
  }
  return out;
}

async function getJson(url) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl ? ctl.signal : undefined });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { if (t) clearTimeout(t); }
}
const st = (ok, n, at, err) => ({ ok, n: ok ? n : null, at: at || null, err: ok ? '' : (err || '取得できず') });
const errOf = (e) => (e && e.name === 'AbortError' ? '時間切れ' : e && e.message ? String(e.message).slice(0, 40) : '取得できず');

const pt = (o) => (isObj(o) && isNum(o.lat) && isNum(o.lon) ? [o.lat, o.lon] : null);
const circle = (o) => (isObj(o) && isNum(o.lat) && isNum(o.lon) && isNum(o.r_km) ? { center: [o.lat, o.lon], km: o.r_km } : null);
/** data/hazards.json (parallax-hazards/1, CONTRACT 18.7) in the shape the map and the panel draw */
function fromBuild(raw) {
  const quakes = [
    ...arr(raw.quakes_jp).filter((q) => isObj(q) && isNum(q.lat) && isNum(q.lon) && isNum(q.mag) && isNum(q.t)).map((q) => ({
      id: str(q.id), lat: q.lat, lon: q.lon, mag: q.mag, depthKm: num(q.depth_km), place: str(q.place), ts: q.t, shindo: str(q.maxint) || null, src: 'jma', url: safeUrl(q.url), tsunami: str(q.tsunami) || null })),
    ...arr(raw.quakes_world).filter((q) => isObj(q) && isNum(q.lat) && isNum(q.lon) && isNum(q.mag) && isNum(q.t)).map((q) => ({
      id: str(q.id), lat: q.lat, lon: q.lon, mag: q.mag, depthKm: num(q.depth_km), place: str(q.place), ts: q.t, shindo: null, src: 'usgs', url: safeUrl(q.url) })),
  ].sort((a, b) => b.ts - a.ts);
  const typhoons = arr(raw.typhoons).filter((t) => isObj(t) && isNum(t.lat) && isNum(t.lon)).map((t) => ({
    id: str(t.id), number: String(t.number ?? ''), name: str(t.label) || str(t.name), src: str(t.src), ts: num(t.time), center: [t.lat, t.lon],
    pressure: num(t.pressure), windMs: num(t.wind), gustMs: num(t.gust), intensity: str(t.intensity_jp), scale: str(t.scale_jp), location: str(t.location_jp),
    course: str(t.course_jp), speedKmh: num(t.speed_kmh), alert: t.alert || null, url: safeUrl(t.url),
    track: arr(t.track).map(pt).filter(Boolean),
    forecast: arr(t.forecast).filter((f) => isObj(f) && isNum(f.lat) && isNum(f.lon)).map((f) => ({ h: num(f.hours), ts: num(f.t), center: [f.lat, f.lon], radiusKm: num(f.r_km), area: null })),
    storm: arr(t.storm_dirs).map((r) => ({ area: str(r.dir), km: num(r.km) })).filter((r) => r.km != null),
    gale: arr(t.gale_dirs).map((r) => ({ area: str(r.dir), km: num(r.km) })).filter((r) => r.km != null),
    stormC: circle(t.storm), galeC: circle(t.gale), stormKm: num(t.storm_r_km), galeKm: num(t.gale_r_km),
    envelope: isObj(t.storm_area) ? { arcs: arr(t.storm_area.arcs), lines: arr(t.storm_area.lines) } : null,
    cone: Array.isArray(t.cone) ? t.cone.filter(Array.isArray) : null,
  }));
  const disasters = arr(raw.disasters).filter((d) => isObj(d) && isNum(d.lat) && isNum(d.lon) && d.current !== false && !d.same_as).map((d) => ({
    id: str(d.id), type: str(d.type), typeJa: str(d.type_jp), name: str(d.label) || str(d.name), lat: d.lat, lon: d.lon, alert: str(d.alert) || 'Green', ts: num(d.to) || num(d.from), url: safeUrl(d.url) }));
  return { from: 'data', at: num(raw.generated_at), quakes, typhoons, disasters, tsunami: arr(raw.tsunami).filter(isObj), status: isObj(raw.sources) ? raw.sources : {} };
}

/** An already normalized object (from the build) is checked field by field; anything else is dropped, never guessed. */
export function normalize(raw, now) {
  const out = { from: 'data', quakes: [], typhoons: [], disasters: [], status: {} };
  if (!isObj(raw)) return { ...out, from: null };
  if (raw.schema === 'parallax-hazards/1' || Array.isArray(raw.quakes_jp)) return fromBuild(raw);
  out.quakes = arr(raw.quakes).filter((q) => isObj(q) && isNum(q.lat) && isNum(q.lon) && isNum(q.mag) && isNum(q.ts))
    .map((q) => ({ id: str(q.id) || `${q.src}-${q.ts}`, lat: q.lat, lon: q.lon, mag: q.mag, depthKm: num(q.depthKm ?? q.depth_km), place: str(q.place),
      ts: q.ts, shindo: str(q.shindo) || null, src: str(q.src) || 'data', url: safeUrl(q.url) }));
  out.typhoons = arr(raw.typhoons).filter((t) => isObj(t) && Array.isArray(t.center)).map((t) => ({ ...t, track: arr(t.track), forecast: arr(t.forecast), storm: arr(t.storm), gale: arr(t.gale) }));
  out.disasters = arr(raw.disasters).filter((d) => isObj(d) && isNum(d.lat) && isNum(d.lon));
  out.status = isObj(raw.status) ? raw.status : {};
  if (isNum(now)) out.quakes = out.quakes.filter((q) => now - q.ts <= QUAKE_WINDOW_S);
  return out;
}

export async function loadHazards(dataDir, now) {
  try {
    const res = await fetch(dataDir + 'hazards.json', { cache: 'no-store', credentials: 'same-origin' });
    if (res.ok) { const j = await res.json(); if (isObj(j) && (Array.isArray(j.quakes) || Array.isArray(j.typhoons) || Array.isArray(j.quakes_jp))) return normalize(j, now); }
  } catch { /* the build has not written one: ask the sources */ }
  const out = { from: 'live', quakes: [], typhoons: [], disasters: [], status: {} };
  const at = Math.floor(Date.now() / 1000);
  const [u, j, g, t] = await Promise.allSettled([getJson(USGS), getJson(JMA_Q), getJson(GDACS), getJson(JMA_TC + 'targetTc.json')]);
  const usgs = u.status === 'fulfilled' ? fromUsgs(u.value, now) : [];
  const jma = j.status === 'fulfilled' ? fromJmaList(j.value, now) : [];
  out.status.usgs = u.status === 'fulfilled' ? st(true, usgs.length, at) : st(false, 0, at, errOf(u.reason));
  out.status.jma_quake = j.status === 'fulfilled' ? st(true, jma.length, at) : st(false, 0, at, errOf(j.reason));
  out.quakes = mergeQuakes(jma, usgs);
  out.disasters = g.status === 'fulfilled' ? fromGdacs(g.value) : [];
  out.status.gdacs = g.status === 'fulfilled' ? st(true, out.disasters.length, at) : st(false, 0, at, errOf(g.reason));
  if (t.status === 'fulfilled') {
    const list = arr(t.value).filter((x) => isObj(x) && /^TC\d+$/.test(str(x.tropicalCyclone)));
    const got = await Promise.allSettled(list.map((x) => Promise.all([getJson(`${JMA_TC}${x.tropicalCyclone}/forecast.json`), getJson(`${JMA_TC}${x.tropicalCyclone}/specifications.json`)])));
    got.forEach((r, i) => { if (r.status === 'fulfilled') { const ty = fromJmaTyphoon(list[i], r.value[0], r.value[1]); if (ty) out.typhoons.push(ty); } });
    const bad = got.filter((r) => r.status !== 'fulfilled').length;
    out.status.jma_typhoon = bad ? st(false, 0, at, `${bad} 件読めず`) : st(true, out.typhoons.length, at);
  } else out.status.jma_typhoon = st(false, 0, at, errOf(t.reason));
  return out;
}
