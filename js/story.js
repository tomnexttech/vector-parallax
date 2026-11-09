/* story — the board's news told in the order of a story: the point, how it went, each side's headlines, the sources.
 * Nothing new is collected: the same reports and the same outlets, put in another order.
 *
 *   STORY                                           the sections in their order: [id, Japanese name]
 *   sideOf(it) -> 'jp' | 'intl' | 'gov'            the side of one report, as the rest of the page counts it
 *   timeline(members, { gap }) -> [{ it, side, off, gap }]
 *                                                   the reports on one line in the order of their time (the untimed at the end);
 *                                                   off = seconds from the first report, gap = true where the report comes long
 *                                                   after the one before (gap seconds and more)
 *   sourcesOf(members, { outletOf }) -> [{ name, type, side, n, first }]
 *                                                   each outlet once, in the order of its first report, with its count */

export const GOV = '政府一次';
export const STORY = [['pt', '要点'], ['cv', '媒体の比べ'], ['tl', '経過'], ['sd', '各側の見出し'], ['src', '出典の一覧']];
export const TL_CAP = 12;
export const GAP_S = 3 * 3600;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const byTime = (a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity);

export const sideOf = (it) => (isObj(it) && it.type === GOV ? 'gov' : isObj(it) && it.home === 'intl' ? 'intl' : 'jp');

export function timeline(members, { gap = GAP_S } = {}) {
  const ms = (Array.isArray(members) ? members : []).filter(isObj).sort(byTime);
  const t0 = ms.find((it) => isNum(it.ts));
  let prev = null;
  return ms.map((it) => {
    const timed = isNum(it.ts);
    const row = { it, side: sideOf(it), off: timed && t0 ? it.ts - t0.ts : null, gap: !!(timed && prev && it.ts - prev.ts >= gap) };
    if (timed) prev = it;
    return row;
  });
}

export function sourcesOf(members, { outletOf = (it) => str(it.media) || str(it.outlet) } = {}) {
  const got = new Map();
  for (const it of (Array.isArray(members) ? members : []).filter(isObj).sort(byTime)) {
    const name = str(outletOf(it)).trim();
    if (!name) continue;
    const x = got.get(name);
    if (x) x.n += 1;
    else got.set(name, { name, type: str(it.type), side: sideOf(it), n: 1, first: it });
  }
  return [...got.values()];
}
