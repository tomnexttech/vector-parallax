/* bubble — the same news in three orders, and what changes in the first ten when the order changes.
 *   popular  the most bookmarked first (はてなブックマーク, data/reaction.json); not offered when that file holds no counts
 *   mine     closest to what this device opened (fields and sides, this browser only); not offered under five reads
 *   all      the page's own order: events told by more sides, then by more kinds of outlet, then by more outlets
 * Only counts are shown ("海外だけのニュース 0 件 → 3 件"); nothing says that the reader is being steered.
 *
 *   ORDERS, ORDER_JA, TOP, MIN_READS
 *   SMALL_TYPES                                      the outlet types counted as small (local papers, specialist media, party papers)
 *   hbOf(e, reaction) -> number | null               the event's bookmarks: the build's sum for the event, else the sum over its items
 *   orderOf(es, kind, opt) -> events | null          null when the order cannot be made from the data at hand
 *                     opt = { sidesOf, reaction, reads: readMix(...), typesOf(e) }
 *   countsOf(list, { sidesOf, impact, top }) -> { intl_only, small_only, life }
 *   diffOf(a, b) -> [{ k, ja, from, to }]            the counts that differ, in a fixed order
 *   available({ reaction, reads }) -> ['popular'?, 'mine'?, 'all'] */

export const ORDERS = ['popular', 'mine', 'all'];
export const ORDER_JA = { popular: '人気順', mine: '自分の読み方順', all: 'PARALLAX' };
export const TOP = 10;
export const MIN_READS = 5;
export const SMALL_TYPES = ['地方紙', '専門', '政党機関紙', '週刊誌', '独立系'];
export const COUNT_JA = { intl_only: '海外だけのニュース', small_only: '地方紙・小さな媒体だけのニュース', life: '暮らしのラベル' };
const GOV = '政府一次';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const sidOf = (e) => (e && e.case && e.case.sid) || (e && e.obj && e.obj.sid) || null;

export function hbOf(e, reaction) {
  if (!isObj(reaction)) return null;
  const sid = sidOf(e);
  const ev = sid && isObj(reaction.events) ? reaction.events[sid] : null;
  if (isObj(ev) && isObj(ev.hb) && isNum(ev.hb.sum)) return ev.hb.sum;
  if (!isObj(reaction.items)) return null;
  let s = 0, any = false;
  for (const it of arr(e && e.members)) { const r = it && reaction.items[it.id]; if (isObj(r) && isNum(r.hb)) { s += r.hb; any = true; } }
  return any ? s : null;
}

const sideCount = (s) => (arr(s.jp).length > 0) + (arr(s.intl).length > 0) + (arr(s.gov).length > 0);
const kindsOf = (e) => new Set(arr(e && e.members).map((it) => it && it.type).filter(Boolean)).size;

export function available({ reaction, reads } = {}) {
  const out = [];
  if (isObj(reaction) && ((isObj(reaction.events) && Object.keys(reaction.events).length) || (isObj(reaction.items) && Object.keys(reaction.items).length))) out.push('popular');
  if (isObj(reads) && reads.n >= MIN_READS) out.push('mine');
  out.push('all');
  return out;
}

export function orderOf(es, kind, { sidesOf, reaction = null, reads = null } = {}) {
  const list = arr(es).filter((e) => e && !e.hid && !e.foldedInto);
  const last = (e) => (isNum(e.last) ? e.last : 0);
  const n = (e) => (isNum(e.n) ? e.n : 0);
  if (kind === 'popular') {
    if (!available({ reaction }).includes('popular')) return null;
    return list.map((e) => ({ e, v: hbOf(e, reaction) })).filter((x) => x.v != null && x.v > 0)
      .sort((a, b) => b.v - a.v || last(b.e) - last(a.e)).map((x) => x.e);
  }
  if (kind === 'mine') {
    if (!isObj(reads) || reads.n < MIN_READS) return null;
    const fTot = arr(reads.fields).reduce((a, [, v]) => a + v, 0) || 1;
    const fShare = new Map(arr(reads.fields).map(([f, v]) => [f, v / fTot]));
    const sTot = (reads.sides.jp + reads.sides.intl + reads.sides.gov) || 1;
    const score = (e) => {
      const s = sidesOf(e), m = arr(e.members).length || 1;
      const side = (arr(s.jp).length * reads.sides.jp + arr(s.intl).length * reads.sides.intl + arr(s.gov).length * reads.sides.gov) / (m * sTot);
      return (fShare.get(e.field) || 0) + side;
    };
    return list.map((e) => ({ e, v: score(e) })).sort((a, b) => b.v - a.v || n(b.e) - n(a.e) || last(b.e) - last(a.e)).map((x) => x.e);
  }
  if (kind === 'all') {
    return list.map((e) => ({ e, s: sideCount(sidesOf(e)), k: kindsOf(e) }))
      .sort((a, b) => b.s - a.s || b.k - a.k || n(b.e) - n(a.e) || last(b.e) - last(a.e)).map((x) => x.e);
  }
  return null;
}

export function countsOf(list, { sidesOf, impact = null, top = TOP } = {}) {
  const out = { intl_only: 0, small_only: 0, life: 0 };
  for (const e of arr(list).slice(0, top)) {
    const s = sidesOf(e);
    if (arr(s.intl).length && !arr(s.jp).length && !arr(s.gov).length) out.intl_only++;
    const ms = arr(e.members).filter((it) => it && it.type !== GOV);
    if (ms.length && ms.every((it) => SMALL_TYPES.includes(it.type))) out.small_only++;
    const sid = sidOf(e);
    if (isObj(impact) && isObj(impact.events) && sid && isObj(impact.events[sid]) && arr(impact.events[sid].areas).length) out.life++;
  }
  if (!(isObj(impact) && isObj(impact.events))) out.life = null;   // no file: not counted, not shown
  return out;
}

export function diffOf(a, b) {
  return Object.keys(COUNT_JA).filter((k) => isNum(a && a[k]) && isNum(b && b[k]) && a[k] !== b[k]).map((k) => ({ k, ja: COUNT_JA[k], from: a[k], to: b[k] }));
}
