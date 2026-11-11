/* search — the search box made to forgive how a word is written, and narrowed further. No DOM, no network.
 *
 *   fold(s) -> string                     NFKC, small letters, hiragana as katakana, no long-vowel mark, no middle dot
 *   aliasGroups(json) -> [[word, ...]]    the alias table of the data (data/aliases.json); any of three shapes is read:
 *                                         { groups: [[...]] } | [[...]] | { "<word>": [...] }. A damaged entry is left out
 *   expand(q, { groups, off }) -> { terms: [{ text, alts: [{ text, key? }] }], chips: [{ text, key?, on }] }
 *                                         each word of the query, with the other ways of writing it (the alias table, the place
 *                                         names of js/places.js). chips are the added ways, shown over the result; off = the chips
 *                                         the visitor took away
 *   matcherOf(x, off) -> (e) => bool      every word must match: its text or one of its ways in the event's words, or its place
 *   narrow(events, f, ctx) -> events      the narrowing beyond js/newsdesk.js searchOf (which it wraps, unchanged): the span, the
 *                                         field, one side only, the life label (data/impact.json), the order by reaction
 *                                         (data/reaction.json). A label or an order whose file is missing is not offered
 *   archiveHits(days, x, off) -> [{ sid, date, title, outlet, n_outlets, sides, last_ts }]   the seven days (CONTRACT 21.3)
 *   toHash(q, f, off) / fromHash(hash) -> { q, f, off } | null      the address of a search: words and choices only
 *
 * Neutral by rule: a count is a count of the collected headlines. A reaction is the size of the interest, not a vote. */
import { PLACES, placeJa, placesIn } from './places.js';
import { searchOf } from './newsdesk.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);

export const Q_MAX = 80;
export const SPANS = [['6h', '6 時間', 6 * 3600], ['24h', '24 時間', 24 * 3600], ['36h', '36 時間', Infinity], ['7d', '7 日', 7 * 86400]];
export const SIDES = [['all', '全部'], ['jp', '国内'], ['intl', '海外'], ['gov', '官公庁']];
export const SORTS = [['n', '報道が多い順'], ['new', '新しい順'], ['react', '反応が多い順']];
export const F0 = { span: '36h', side: 'all', outlet: '', sort: 'n', field: '', only: false, life: false };

export function fold(s) {
  let t = str(s).normalize('NFKC').toLowerCase();
  t = t.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  return t.replace(/[ー‐―・·]/g, '');
}

export function aliasGroups(json) {
  let raw = [];
  if (Array.isArray(json)) raw = json;
  else if (isObj(json) && Array.isArray(json.groups)) raw = json.groups;
  else if (isObj(json)) raw = Object.entries(json).filter(([k, v]) => !['schema', 'note', 'generated_at'].includes(k) && Array.isArray(v)).map(([k, v]) => [k, ...v]);
  const out = [];
  for (const g of raw) {
    const words = (Array.isArray(g) ? g : isObj(g) && Array.isArray(g.words) ? g.words : [])
      .filter((w) => typeof w === 'string' && w.trim() && w.length <= 40).map((w) => w.trim());
    const u = [...new Set(words)];
    if (u.length >= 2) out.push(u.slice(0, 24));
  }
  return out.slice(0, 4000);
}

const ASCII = /^[a-z0-9 .&'-]+$/;
const SHORT_ASCII = (f) => ASCII.test(f) && f.replace(/[^a-z0-9]/g, '').length <= 3;
/** the place keys a word names: "US" (a key itself), "米国", "アメリカ", "United States" */
function placeKeys(word) {
  const up = str(word).normalize('NFKC').trim().toUpperCase();
  const keys = new Set();
  if (PLACES[up] && PLACES[up].ja) keys.add(up);
  for (const k of placesIn(word)) keys.add(k);
  for (const [k, p] of Object.entries(PLACES)) if (p.ja && fold(p.ja) === fold(word)) keys.add(k);
  return [...keys];
}

export function expand(q, { groups = [], off = [] } = {}) {
  const words = str(q).normalize('NFKC').trim().slice(0, Q_MAX).split(/\s+/).filter(Boolean).slice(0, 6);
  const offSet = new Set(arr(off).map(fold));
  const byWord = new Map();
  for (const g of arr(groups)) for (const w of g) { const f = fold(w); if (!byWord.has(f)) byWord.set(f, []); byWord.get(f).push(g); }
  const terms = [], chips = [], seenChip = new Set();
  for (const w of words) {
    const fw = fold(w);
    const alts = [], seen = new Set([fw]);
    const add = (text, key) => {
      const f = key ? 'place:' + key : fold(text);
      if (seen.has(f)) return;
      seen.add(f);
      alts.push(key ? { text, key } : { text });
      if (!seenChip.has(f)) { seenChip.add(f); chips.push({ text, key: key || null, on: !offSet.has(key ? fold(text) : f) }); }
    };
    for (const g of byWord.get(fw) || []) for (const a of g) add(a);
    for (const k of placeKeys(w)) add(placeJa(k) === k ? k : `${placeJa(k)}（${k}）`, k);
    for (const a of [...alts]) if (!a.key) for (const k of placeKeys(a.text)) add(placeJa(k) === k ? k : `${placeJa(k)}（${k}）`, k);
    terms.push({ text: w, alts });
  }
  return { terms, chips };
}

function foldedHay(e) {
  if (!isObj(e)) return '';
  const src = typeof e.hay === 'string' ? e.hay : [e.title, ...arr(e.heads).map((x) => x && x.title)].filter(Boolean).join(' \n ');
  if (e._foldSrc !== src) { e._foldSrc = src; e._fold = fold(src); }   // kept on the event until its words change
  return e._fold;
}
function hasWord(hay, f) {
  if (!f) return false;
  if (!SHORT_ASCII(f)) return hay.includes(f);
  const re = new RegExp(`(^|[^a-z0-9])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`);
  return re.test(hay);
}

export function matcherOf(x, off = []) {
  const offSet = new Set(arr(off).map(fold));
  const terms = arr(x && x.terms);
  if (!terms.length) return () => true;
  return (e) => {
    const hay = foldedHay(e);
    const places = new Set(arr(e && e.places));
    return terms.every((t) => {
      if (hasWord(hay, fold(t.text))) return true;
      for (const a of t.alts) {
        if (offSet.has(fold(a.text))) continue;
        if (a.key ? places.has(a.key) || hasWord(hay, fold(placeJa(a.key))) : hasWord(hay, fold(a.text))) return true;
      }
      return false;
    });
  };
}

export const sidOf = (e) => (isObj(e) ? (isObj(e.case) && str(e.case.sid)) || (isObj(e.obj) && str(e.obj.sid)) || str(e.sid) : '');
/** the reaction of an event, one number to order by: the bookmarks first, then the views (data/reaction.json) */
export function reactionScore(reaction, sid) {
  const r = isObj(reaction) && isObj(reaction.events) ? reaction.events[sid] : null;
  if (!isObj(r)) return null;
  const hb = isObj(r.hb) && isNum(r.hb.sum) ? r.hb.sum : null, yt = isObj(r.yt) && isNum(r.yt.views) ? r.yt.views : null;
  return hb == null && yt == null ? null : { hb: hb || 0, yt: yt || 0 };
}
export const lifeOf = (impact, sid) => {
  const x = isObj(impact) && isObj(impact.events) ? impact.events[sid] : null;
  return isObj(x) && arr(x.areas).length ? x : null;
};
export const hasReaction = (reaction) => isObj(reaction) && isObj(reaction.events) && Object.keys(reaction.events).length > 0;
export const hasLife = (impact) => isObj(impact) && isObj(impact.events) && Object.values(impact.events).some((x) => isObj(x) && arr(x.areas).length);

export function narrow(events, f = F0, { now, sideN, outletOf, reaction = null, impact = null } = {}) {
  const t0 = isNum(now) ? now : Date.now() / 1000;
  const sp = SPANS.find((s) => s[0] === f.span) || SPANS[2];
  const base = searchOf(events, { span: 'all', side: f.side || 'all', outlet: f.outlet || '', sort: f.sort === 'new' ? 'new' : 'n', now: t0, sideN, outletOf });
  let out = base.filter((e) => {
    if (sp[2] !== Infinity && sp[0] !== '7d' && !(isNum(e.last) && e.last >= t0 - sp[2])) return false;
    if (f.field && e.field !== f.field) return false;
    if (f.only && typeof sideN === 'function') {
      const jp = sideN(e, 'jp') > 0, intl = sideN(e, 'intl') > 0;
      if (jp === intl) return false;
    }
    if (f.life && hasLife(impact) && !lifeOf(impact, sidOf(e))) return false;
    return true;
  });
  if (f.sort === 'react' && hasReaction(reaction)) {
    const sc = new Map(out.map((e) => [e, reactionScore(reaction, sidOf(e))]));
    out = out.map((e, i) => ({ e, i })).sort((a, b) => {
      const x = sc.get(a.e), y = sc.get(b.e);
      if (!x || !y) return (x ? -1 : 0) - (y ? -1 : 0) || a.i - b.i;
      return y.hb - x.hb || y.yt - x.yt || a.i - b.i;
    }).map((x) => x.e);
  }
  return out;
}

export function archiveHits(days, x, off = [], { cap = 60, skip = new Set() } = {}) {
  const m = matcherOf(x, off);
  const by = new Map();
  for (const d of arr(days)) {
    if (!isObj(d) || d.schema !== 'parallax-archive-day/1') continue;
    for (const en of arr(d.events)) {
      if (!isObj(en) || !/^s[0-9a-f]{12}$/.test(str(en.sid)) || skip.has(en.sid)) continue;
      const probe = { title: str(en.title), heads: arr(en.heads).filter(isObj).map((hd) => ({ title: str(hd.title) })), places: placesIn([en.title, ...arr(en.heads).map((hd) => isObj(hd) && hd.title)].filter(Boolean).join(' ')) };
      if (!m(probe)) continue;
      const prev = by.get(en.sid);
      if (prev && (prev.last_ts || 0) >= (en.last_ts || 0)) continue;
      by.set(en.sid, { sid: en.sid, date: str(d.date), title: str(en.title), outlet: str(en.outlet), n_outlets: isNum(en.n_outlets) ? en.n_outlets : 0,
        sides: isObj(en.side_outlets) ? en.side_outlets : isObj(en.sides) ? en.sides : {}, last_ts: isNum(en.last_ts) ? en.last_ts : null });
    }
  }
  return [...by.values()].sort((a, b) => (b.last_ts || 0) - (a.last_ts || 0) || b.n_outlets - a.n_outlets).slice(0, cap);
}
/** the day files to read for seven days: the index's days, newest first, seven at most */
export const archiveDays = (index) => (isObj(index) && index.schema === 'parallax-archive/1' ? arr(index.days).filter((d) => isObj(d) && /^\d{4}-\d{2}-\d{2}$/.test(str(d.date))).map((d) => d.date).slice(0, 7) : []);

const ok = (list, v) => list.some((x) => x[0] === v);
export function toHash(q, f = F0, off = []) {
  const p = new URLSearchParams();
  p.set('q', str(q).slice(0, Q_MAX));
  if (f.span !== F0.span) p.set('span', f.span);
  if (f.side !== F0.side) p.set('side', f.side);
  if (f.sort !== F0.sort) p.set('sort', f.sort);
  if (f.outlet) p.set('outlet', str(f.outlet).slice(0, 60));
  if (f.field) p.set('field', str(f.field).slice(0, 30));
  if (f.only) p.set('only', '1');
  if (f.life) p.set('life', '1');
  if (arr(off).length) p.set('x', arr(off).slice(0, 12).join(','));
  return '#' + p.toString();
}
export function fromHash(hash) {
  const raw = str(hash).replace(/^#/, '');
  if (!raw.startsWith('q=')) return null;
  const p = new URLSearchParams(raw);
  const q = str(p.get('q')).trim().slice(0, Q_MAX);
  if (!q) return null;
  const v = (k, list) => (ok(list, p.get(k)) ? p.get(k) : F0[k]);
  const f = { span: v('span', SPANS), side: v('side', SIDES), sort: v('sort', SORTS), outlet: str(p.get('outlet')).slice(0, 60), field: str(p.get('field')).slice(0, 30), only: p.get('only') === '1', life: p.get('life') === '1' };
  const off = str(p.get('x')).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
  return { q, f, off };
}
