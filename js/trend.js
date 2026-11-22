/* trend — what the collected news says about one place: the topics at the top, the topics that are rising (the recent hours against the hours
 * before), the fields, and how the outlets treat it. No DOM. Every number is a count of the headlines this page holds (CONTRACT: a count is a
 * count; nothing is estimated, and nothing is made up where there is no data). What the public talks about (social media, search) is not in
 * these data: `TREND_SOURCES` says so, and the screen shows that slot as empty until a source is connected (docs/trend-sources.md).
 *
 *   scopeOf(text)                          -> a scope from what was typed: a prefecture, else words that a headline must carry
 *   scopeLabel(scope)                      -> the name shown
 *   scopeMatch(scope)                      -> (event) => boolean
 *   trendOf(events, scope, { now, windowH }) -> the model the screen draws (see below)
 *   dailyOf(archiveDays, scope)            -> [{ date, events, outlets }] from the seven-day archive, or []
 *   busiestPlaces(events, n)               -> [{ name, n }] the prefectures with the most events, to start from
 *
 * An event is the app's entry: { key, n, field, first, last, geo, heading:{text}, titled:[{title}], members:[{ id, ts, outlet, media, type, home, title }] } */
import { PLACES } from './places.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const norm = (s) => (typeof s === 'string' ? s.normalize('NFKC') : '');
const outletOf = (it) => str(it && it.media) || str(it && it.outlet);

export const PREFS = Object.keys(PLACES).filter((k) => !PLACES[k].ja);
export const GOV = '政府一次';
/** the recent part of the window and the part before it: a third and two thirds of the hours held */
export const RECENT_SHARE = 1 / 3;

/** where a data source for the public's talk (social media, search) would be connected. Empty on purpose: nothing is counted here */
export const TREND_SOURCES = [];

/** the prefecture a typed word means (東京都 -> 東京, 京都府 -> 京都, 北海道 -> 北海道), else null */
export function prefOf(text) {
  const t = norm(text).trim();
  if (!t) return null;
  if (PREFS.includes(t)) return t;
  const bare = t.replace(/[都府県]$/, '');
  return PREFS.includes(bare) ? bare : null;
}

/** a scope from a typed word: a prefecture, else a name (city, ward, town, country, anything) that a headline must carry */
export function scopeOf(text) {
  const t = norm(text).trim().slice(0, 40);
  if (!t) return null;
  const p = prefOf(t);
  return p ? { kind: 'pref', name: p } : { kind: 'text', name: t };
}
export const scopeLabel = (s) => (!s ? '' : s.kind === 'box' ? '地図の表示範囲' : s.kind === 'pref' ? (s.name === '北海道' ? s.name : s.name === '東京' ? '東京都' : s.name === '京都' || s.name === '大阪' ? s.name + '府' : s.name + '県') : s.name || '');

/** the headlines of an event: the only text that may say it is about a place (an outlet named 中国新聞 is not news of China) */
const titlesOf = (e) => [e.heading && e.heading.text, ...arr(e.titled).map((it) => it && it.title), ...arr(e.members).map((it) => it && it.title)].filter((t) => typeof t === 'string' && t);

/** does the text name the prefecture: with or without 県・府・都. 東京都 holds 京都, which is not Kyoto */
export function mentions(text, name) {
  let t = norm(text);
  if (!t || !name) return false;
  if (name === '京都') t = t.replace(/東京都/g, '東京');
  return t.includes(name);
}

const rad = (d) => (d * Math.PI) / 180;
export function km(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

export function scopeMatch(scope) {
  if (!scope) return () => false;
  if (scope.kind === 'pref') {
    return (e) => (e.geo && !e.geo.country && (e.geo.key === scope.name || mentions(e.geo.name, scope.name))) || titlesOf(e).some((t) => mentions(t, scope.name));
  }
  if (scope.kind === 'box') {
    const { west, east, south, north } = scope;
    return (e) => !!e.geo && !e.geo.country && isNum(e.geo.lat) && e.geo.lat >= south && e.geo.lat <= north && (west <= east ? e.geo.lon >= west && e.geo.lon <= east : e.geo.lon >= west || e.geo.lon <= east);
  }
  const name = norm(scope.name).toLowerCase();
  const near = scope.kind === 'point' && isNum(scope.lat) && isNum(scope.lon) ? scope : null;
  return (e) => {
    const g = e.geo;
    if (g && name && (norm(g.name).toLowerCase() === name || norm(g.key).toLowerCase() === name)) return true;
    if (near && g && !g.country && isNum(g.lat) && km(near, g) <= (near.km || 60)) return true;
    return !!name && titlesOf(e).some((t) => norm(t).toLowerCase().includes(name));
  };
}

const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);
const sideOf = (it) => (it.type === GOV ? 'gov' : it.home === 'intl' ? 'intl' : 'jp');

/** the headlines of the whole page by outlet, once each (an item that stands in two events is counted once) */
function wholeOf(events) {
  const seen = new Set(), by = new Map(), fieldN = new Map();
  let total = 0;
  for (const e of events) {
    let any = false;
    for (const it of arr(e.members)) { if (!isObj(it) || seen.has(it.id)) continue; seen.add(it.id); bump(by, outletOf(it)); total++; any = true; }
    if (any && e.field) bump(fieldN, e.field);
  }
  return { by, total, fieldN, events: events.length };
}

/** the model of one place. `events` is every event on the page (the share of the whole is told beside the share of the place) */
export function trendOf(events, scope, { now, windowH = 36, top = 5 } = {}) {
  const all = arr(events).filter((e) => e && !e.foldedInto && !e.hid);
  const whole = wholeOf(all);
  const hit = scopeMatch(scope);
  const es = scope ? all.filter(hit) : [];
  const t1 = isNum(now) ? now : Math.max(0, ...all.map((e) => e.last || 0));
  const hours = windowH, recentH = Math.max(1, Math.round(hours * RECENT_SHARE)), priorH = Math.max(1, hours - recentH);
  const cut = t1 - recentH * 3600, from = t1 - hours * 3600;

  const seen = new Set();
  const outlets = new Map();   // name -> { n, side, fields:Map }
  const sides = { jp: 0, intl: 0, gov: 0 };
  let heads = 0, recent = 0, prior = 0;
  const rows = es.map((e) => {
    let r = 0, p = 0;
    for (const it of arr(e.members)) {
      if (!isObj(it)) continue;
      if (isNum(it.ts) && it.ts >= cut) r++; else if (isNum(it.ts) && it.ts >= from) p++;
      if (seen.has(it.id)) continue;
      seen.add(it.id); heads++;
      sides[sideOf(it)]++;
      const o = outlets.get(outletOf(it)) || { n: 0, side: sideOf(it), fields: new Map() };
      o.n++; if (e.field) bump(o.fields, e.field);
      outlets.set(outletOf(it), o);
    }
    recent += r; prior += p;
    const first = isNum(e.first) ? e.first : null;
    return { e, recent: r, prior: p, fresh: first != null && first >= cut };
  });

  // the topics at the top: the most outlets, then the newest
  const topList = [...rows].sort((a, b) => (b.e.n || 0) - (a.e.n || 0) || (b.e.last || 0) - (a.e.last || 0)).slice(0, top);

  // the topics that are rising: more headlines an hour in the recent hours than before, or new in the recent hours. Three headlines at least
  const perH = (r, p) => ({ r: r / recentH, p: p / priorH });
  const rising = rows.map((x) => ({ ...x, ...perH(x.recent, x.prior) }))
    .filter((x) => x.recent >= 3 && (x.prior === 0 || x.r >= x.p * 1.5))
    .sort((a, b) => (b.r - b.p) - (a.r - a.p) || (b.e.n || 0) - (a.e.n || 0)).slice(0, top)
    .map((x) => ({ e: x.e, recent: x.recent, prior: x.prior, fresh: x.fresh, ratio: x.prior === 0 ? null : x.r / x.p }));

  // the fields: the share of this place's events beside the share of all events
  const fieldN = new Map();
  for (const x of rows) if (x.e.field) bump(fieldN, x.e.field);
  const fields = [...fieldN].map(([f, n]) => ({ field: f, n, share: es.length ? n / es.length : 0, whole: whole.events ? (whole.fieldN.get(f) || 0) / whole.events : 0 }))
    .sort((a, b) => b.n - a.n);

  // the outlets: how many headlines of the place each ran, and how much of that outlet's own output it is
  const outletRows = [...outlets].map(([name, o]) => {
    const top1 = [...o.fields].sort((a, b) => b[1] - a[1])[0];
    const own = whole.by.get(name) || o.n;
    return { name, n: o.n, side: o.side, own, share: own ? o.n / own : 0, field: top1 ? top1[0] : '' };
  }).sort((a, b) => b.n - a.n || b.share - a.share);

  const pace = recent + prior >= 6 ? { recent, prior, ratio: prior ? recent / recentH / (prior / priorH) : null } : null;
  return {
    scope, label: scopeLabel(scope), events: es.length, heads, outlets: outletRows.length, sides, wholeEvents: whole.events, wholeHeads: whole.total,
    recentH, priorH, recent, prior, pace, top: topList.map((x) => ({ e: x.e, recent: x.recent, prior: x.prior, fresh: x.fresh })), rising, fields,
    outletRows, sources: TREND_SOURCES,
  };
}

/** the seven-day archive, counted for the place: events and outlet-reports a day. Only a place a headline can name (a prefecture or words) */
export function dailyOf(days, scope) {
  if (!scope || scope.kind === 'box') return [];
  const out = [];
  for (const d of arr(days)) {
    if (!isObj(d) || d.schema !== 'parallax-archive-day/1') continue;
    const evs = arr(d.events).filter((en) => isObj(en) && [en.title, ...arr(en.heads).map((x) => isObj(x) && x.title)].some((t) => (scope.kind === 'pref' ? mentions(t, scope.name) : norm(t).toLowerCase().includes(norm(scope.name).toLowerCase()))));
    out.push({ date: str(d.date), events: evs.length, outlets: evs.reduce((a, en) => a + (isNum(en.n_outlets) ? en.n_outlets : 0), 0), all: arr(d.events).length });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** the prefectures with the most events on the page: where to start */
export function busiestPlaces(events, n = 6) {
  const all = arr(events).filter((e) => e && !e.foldedInto && !e.hid);
  const by = new Map();
  for (const e of all) {
    const ts = titlesOf(e);
    for (const p of PREFS) if ((e.geo && !e.geo.country && e.geo.key === p) || ts.some((t) => mentions(t, p))) bump(by, p);
  }
  return [...by].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, c]) => ({ name, label: scopeLabel({ kind: 'pref', name }), n: c }));
}

/** what is said about the place on Bluesky (data/social.json, made by parallax/social.py in the build): the row of this place, or why there is none.
 *  { state: 'none'|'off'|'row', ... }: 'none' = the file is not there; 'off' = the place is not among those collected; 'row' = numbers */
export function socialOf(doc, scope) {
  if (!scope || scope.kind === 'box') return { state: 'off', why: 'box' };
  if (!isObj(doc) || doc.schema !== 'parallax-social/1' || !isObj(doc.places)) return { state: 'none' };
  const key = scope.name;
  const r = isObj(doc.places[key]) ? doc.places[key] : null;
  if (!r) return { state: 'off', why: 'place' };
  if (!r.ok) return { state: 'failed', at: doc.generated_at, err: str(r.err) };
  const rec = r.recent || {}, pri = r.prior || {};
  const rh = num0(doc.recent_h) || 12, ph = num0(doc.prior_h) || 24;
  const per = (n, h) => (h ? n / h : 0);
  const pace = num0(pri.n) > 0 && !rec.capped && !pri.capped ? per(rec.n, rh) / per(pri.n, ph) : null;
  const t = isObj(r.tone) ? r.tone : { n: 0, pos: 0, neg: 0, none: 0 };
  return { state: 'row', at: doc.generated_at, recentH: rh, priorH: ph, recent: num0(rec.n), prior: num0(pri.n), capped: !!(rec.capped || pri.capped), pace,
    sample: num0(rec.sample), authors: num0(rec.authors), terms: arr(r.terms), tone: t, precision: isNum(r.precision) ? r.precision : null,
    bias: str(doc.bias_ja), toneNote: str(doc.tone_ja), source: isObj(doc.source) ? str(doc.source.name) : 'Bluesky' };
}
const num0 = (v) => (isNum(v) ? v : 0);

/** where the map goes for a scope: the middle and a zoom (a map's zoom level: 512 px tiles). A prefecture and a country by their point, a town by the point of the
 *  events that stand there, a press on the map where it was pressed. The shown range stays where it is (null). */
export function focusOf(events, scope) {
  if (!scope || scope.kind === 'box') return null;
  if (scope.kind === 'point') return isNum(scope.lat) && isNum(scope.lon) ? { lat: scope.lat, lon: scope.lon, z: 9.5 } : null;
  if (scope.kind === 'pref') { const p = PLACES[scope.name]; return p ? { lat: p.lat, lon: p.lon, z: scope.name === '北海道' ? 5.8 : 7.2 } : null; }
  const name = norm(scope.name).toLowerCase();
  const country = Object.values(PLACES).find((p) => p.ja && p.ja === scope.name);
  if (country) return { lat: country.lat, lon: country.lon, z: country.wide ? 3.8 : 5 };
  const hit = scopeMatch(scope), pts = arr(events).filter((e) => e && !e.foldedInto && e.geo && isNum(e.geo.lat) && hit(e));
  const local = pts.filter((e) => !e.geo.country);
  const by = new Map();
  for (const e of (local.length ? local : pts)) { const k = `${e.geo.key}|${e.geo.lat}|${e.geo.lon}`; const r = by.get(k) || { n: 0, g: e.geo }; r.n++; by.set(k, r); }
  const best = [...by.values()].sort((x, y) => y.n - x.n)[0];
  if (!best) return null;
  const g = best.g;
  const exact = norm(g.name).toLowerCase() === name || norm(g.key).toLowerCase() === name;
  return { lat: g.lat, lon: g.lon, z: g.country ? 4.8 : exact ? 9.5 : 8 };
}
