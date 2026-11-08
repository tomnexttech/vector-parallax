/* newsdesk — what a news site puts around the list: the breaking line, the rankings, the local news, the narrowed search. No DOM.
 *
 *   breakingOf({ quakes, tsunami, events, now, off }) -> [{ id, kind, ... }]   the line under the bar, the most urgent first:
 *                                           tsunami information, quakes of 5- or more in the last six hours (JMA), news whose reports
 *                                           rose sharply (SURGE). off = the ids the reader closed; they stay away while the same thing lasts
 *   breakingText(b, clock) -> { tag, text }
 *   keepOff(off, list) -> off               the closed ids that are still on the list (the rest are forgotten)
 *   rankBy(events, score, { cap }) -> [{ e, rank, v }]     highest first; equal values share a rank; 0 and below are left out
 *   PLACE_CHOICES -> [{ key, ja, group }]   the prefectures and the countries a reader may choose as home
 *   cleanPlace(v) -> key | ''
 *   localOf(events, key) -> events          the news that name the place (js/places.js), most outlets first
 *   searchOf(events, { span, side, outlet, sort, now, sideN, outletOf }) -> events
 *   outletsOf(events, outletOf) -> [{ name, n }]
 *
 * Neutral by rule: a count is a count of the collected headlines; nothing here says what an outlet did not do. */
import { PLACES } from './places.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);

/* the rise that puts a news on the line. Measured on the builds of 11/3-11/8: the most reports of one news in six hours was 8
 * (8 outlets, first 4.3 h before), and in the history of 30 days no news reached more than 8 outlets within six hours of its first
 * report. 12 new reports, 10 outlets, first within 6 h: above every ordinary day seen so far. */
export const SURGE = { new6h: 12, sinceH: 6, outlets: 10 };
export const QUAKE_H = 6;
const SHINDO = { '5-': 5, '5+': 6, '6-': 7, '6+': 8, 7: 9, '7': 9 };
const SHINDO_JA = (v) => str(v).replace('-', '弱').replace('+', '強');

export function breakingOf({ quakes, tsunami, events, now, off } = {}) {
  const t0 = isNum(now) ? now : Date.now() / 1000;
  const closed = new Set(arr(off));
  const out = [];
  for (const t of arr(tsunami)) {
    if (!isObj(t)) continue;
    const at = isNum(t.issued) ? t.issued : isNum(t.t) ? t.t : null;
    out.push({ id: 'tsu-' + (str(t.id) || `${str(t.title)}|${at}`), kind: 'tsunami', title: str(t.title) || '津波の情報', place: str(t.place) || str(t.area), at, go: 'disaster' });
  }
  const qs = arr(quakes).filter((q) => isObj(q) && (SHINDO[str(q.shindo)] || 0) >= 5 && isNum(q.ts) && t0 - q.ts <= QUAKE_H * 3600 && q.ts <= t0 + 600)
    .sort((a, b) => SHINDO[str(b.shindo)] - SHINDO[str(a.shindo)] || b.ts - a.ts);
  for (const q of qs) out.push({ id: 'q-' + str(String(q.id)), kind: 'quake', shindo: str(q.shindo), mag: isNum(q.mag) ? q.mag : null, place: str(q.place), at: q.ts, url: str(q.url), go: 'disaster' });
  const ss = arr(events).filter((e) => isObj(e) && isNum(e.new6h) && e.new6h >= SURGE.new6h && isNum(e.sinceH) && e.sinceH <= SURGE.sinceH && isNum(e.n) && e.n >= SURGE.outlets)
    .sort((a, b) => b.new6h - a.new6h || b.n - a.n);
  for (const e of ss) out.push({ id: 'n-' + str(e.id || e.key), kind: 'surge', key: str(e.key), title: str(e.title), new6h: e.new6h, n: e.n, sinceH: e.sinceH, go: 'news' });
  return out.filter((b) => !closed.has(b.id));
}

export function breakingText(b, clock = () => '') {
  if (!isObj(b)) return { tag: '', text: '' };
  const at = isNum(b.at) ? clock(b.at) : '';
  if (b.kind === 'tsunami') return { tag: '津波', text: [b.title, b.place].filter(Boolean).join(' ') + (at ? `・${at}` : '') };
  if (b.kind === 'quake') return { tag: '地震', text: `震度${SHINDO_JA(b.shindo)} ${b.place || '—'}${isNum(b.mag) ? ` M${b.mag.toFixed(1)}` : ''}${at ? `・${at}` : ''}` };
  if (b.kind === 'surge') return { tag: '報道が急増', text: `${b.title}・6 時間で ${b.new6h} 件・${b.n}社` };
  return { tag: '', text: '' };
}

export const keepOff = (off, list) => { const ids = new Set(arr(list).map((b) => b.id)); return arr(off).filter((x) => typeof x === 'string' && ids.has(x)); };

export function rankBy(events, score, { cap = 20 } = {}) {
  const xs = arr(events).map((e) => ({ e, v: score(e) })).filter((x) => isNum(x.v) && x.v > 0)
    .sort((a, b) => b.v - a.v || (isNum(b.e.n) ? b.e.n : 0) - (isNum(a.e.n) ? a.e.n : 0) || (isNum(b.e.last) ? b.e.last : 0) - (isNum(a.e.last) ? a.e.last : 0));
  let rank = 0, prev = null;
  return xs.slice(0, cap).map((x, i) => { if (x.v !== prev) { rank = i + 1; prev = x.v; } return { e: x.e, rank, v: x.v }; });
}

const PREF_KEYS = Object.keys(PLACES).filter((k) => !PLACES[k].ja);
const COUNTRY_KEYS = ['JP', 'US', 'CN', 'KR', 'NK', 'TW', 'RU', 'UA', 'IR', 'IL', 'UK', 'FR', 'DE', 'IN'];
export const PLACE_CHOICES = [
  ...PREF_KEYS.map((k) => ({ key: k, ja: k, group: '都道府県' })),
  ...COUNTRY_KEYS.map((k) => ({ key: k, ja: PLACES[k].ja, group: '国' })),
];
const CHOICE = new Set(PLACE_CHOICES.map((x) => x.key));
export const cleanPlace = (v) => (typeof v === 'string' && CHOICE.has(v) ? v : '');
export const placeName = (k) => { const c = PLACE_CHOICES.find((x) => x.key === k); return c ? c.ja : ''; };

export function localOf(events, key) {
  const k = cleanPlace(key);
  if (!k) return [];
  const want = k === 'JP' ? new Set(['JP', 'OKINAWA', ...PREF_KEYS]) : k === '沖縄' ? new Set(['沖縄', 'OKINAWA']) : new Set([k]);
  return arr(events).filter((e) => isObj(e) && arr(e.places).some((p) => want.has(p)))
    .sort((a, b) => (b.n || 0) - (a.n || 0) || (b.last || 0) - (a.last || 0));
}

export const SPANS = [['6h', '6 時間', 6 * 3600], ['24h', '24 時間', 24 * 3600], ['all', '全部', Infinity]];
export const SEARCH_SIDES = [['all', '全部'], ['jp', '国内'], ['intl', '海外'], ['gov', '官公庁']];
export const SORTS = [['n', '報道が多い順'], ['new', '新しい順']];
export const QF0 = { span: 'all', side: 'all', outlet: '', sort: 'n' };

export function searchOf(events, { span = 'all', side = 'all', outlet = '', sort = 'n', now, sideN, outletOf = (it) => it.media || it.outlet } = {}) {
  const s = SPANS.find((x) => x[0] === span) || SPANS[2];
  const t0 = isNum(now) ? now : Date.now() / 1000;
  const out = arr(events).filter((e) => {
    if (!isObj(e)) return false;
    if (s[2] !== Infinity && !(isNum(e.last) && e.last >= t0 - s[2])) return false;
    if (side !== 'all' && typeof sideN === 'function' && !(sideN(e, side) > 0)) return false;
    if (outlet && !arr(e.members).some((it) => isObj(it) && outletOf(it) === outlet)) return false;
    return true;
  });
  return out.sort(sort === 'new' ? (a, b) => (b.last || 0) - (a.last || 0) || (b.n || 0) - (a.n || 0) : (a, b) => (b.n || 0) - (a.n || 0) || (b.last || 0) - (a.last || 0));
}

export function outletsOf(events, outletOf = (it) => it.media || it.outlet) {
  const n = new Map();
  for (const e of arr(events)) for (const o of new Set(arr(e && e.members).filter(isObj).map(outletOf).filter(Boolean))) n.set(o, (n.get(o) || 0) + 1);
  return [...n].map(([name, c]) => ({ name, n: c })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'ja'));
}
