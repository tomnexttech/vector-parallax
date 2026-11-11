/* reaction — data/reaction.json（parallax-reaction/1、CONTRACT §25.1）の読み口。形の検査だけで DOM は持たない。
 * 世論の反応は「関心の量」（はてなブックマークの件数・放送局の動画の視聴回数・Wikipedia の閲覧数）で、賛否ではない。
 * 値はその値の時刻と一緒に返し、取れない源は ok: false と理由のまま返す（値を埋めない）。画面は「賛成・反対」「炎上」を言わない。
 *
 *   reactionOf(raw)              -> { generatedAt, sources, items, events, notUsed } | null
 *   eventReaction(r, sid, now)   -> { hb, yt, wiki } | null   各値に at と stale（6 時間）
 *   itemBookmarks(r, id)         -> 件数 | null
 *   sourceLines(r)               -> [{ id, ja, ok, n, at, err }]   取れた源・取れなかった源の一覧（「計り方」の欄）
 */
export const SCHEMA = 'parallax-reaction/1';
export const STALE_H = 6;
export const SOURCE_JA = { hatena: 'はてなブックマーク', youtube: 'YouTube の視聴回数', wikipedia: 'Wikipedia の閲覧数' };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v, n = 200) => (typeof v === 'string' ? Array.from(v.trim()).slice(0, n).join('') : '');
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const ts = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const stale = (at, now) => at === null || (now - at) / 3600 > STALE_H;

export function reactionOf(raw) {
  try {
    if (!isObj(raw) || raw.schema !== SCHEMA) return null;
    const sources = {};
    for (const k of Object.keys(SOURCE_JA)) {
      const s = isObj(raw.sources) && isObj(raw.sources[k]) ? raw.sources[k] : null;
      sources[k] = s ? { ok: s.ok === true, n: int(s.n) ?? 0, at: ts(s.fetched_at), err: str(s.err) } : { ok: false, n: 0, at: null, err: 'no entry' };
    }
    const items = {};
    if (isObj(raw.items)) for (const [id, v] of Object.entries(raw.items)) if (isObj(v) && int(v.hb) !== null) items[id] = int(v.hb);
    const events = {};
    if (isObj(raw.events)) {
      for (const [sid, v] of Object.entries(raw.events)) {
        if (!isObj(v)) continue;
        const e = {};
        if (isObj(v.hb) && int(v.hb.sum) !== null) {
          const bs = isObj(v.hb.by_side) ? v.hb.by_side : {};
          e.hb = { sum: int(v.hb.sum), max: int(v.hb.max) ?? 0, n: int(v.hb.n) ?? 0, bySide: { jp: int(bs.jp) ?? 0, intl: int(bs.intl) ?? 0, gov: int(bs.gov) ?? 0 }, at: ts(v.hb.at) ?? sources.hatena.at };
        }
        if (isObj(v.yt) && int(v.yt.views) !== null) e.yt = { views: int(v.yt.views), n: int(v.yt.n) ?? 0, at: ts(v.yt.at) };
        const wiki = arr(v.wiki).filter((w) => isObj(w) && str(w.title, 80) && Array.isArray(w.views) && w.views.length === 7)
          .map((w) => ({ title: str(w.title, 80), lang: w.lang === 'en' ? 'en' : 'ja', views: w.views.map((x) => int(x)), from: str(w.from, 10), to: str(w.to, 10) })).slice(0, 3);
        if (wiki.length) e.wiki = wiki;
        if (Object.keys(e).length) events[sid] = e;
      }
    }
    const notUsed = arr(raw.not_used).filter(isObj).map((x) => ({ name: str(x.name, 40), why: str(x.why, 240), url: /^https:\/\//.test(str(x.url)) ? str(x.url) : null })).filter((x) => x.name && x.why);
    return { generatedAt: ts(raw.generated_at), latestAt: ts(raw.latest_generated_at), sources, items, events, notUsed };
  } catch { return null; }
}

export function eventReaction(r, sid, now = Date.now() / 1000) {
  const e = r && r.events[sid];
  if (!e) return null;
  const out = {};
  if (e.hb) out.hb = { ...e.hb, stale: stale(e.hb.at, now) };
  if (e.yt) out.yt = { ...e.yt, stale: stale(e.yt.at, now) };
  if (e.wiki) out.wiki = e.wiki.map((w) => ({ ...w, total: w.views.every((x) => x === null) ? null : w.views.reduce((a, x) => a + (x || 0), 0) }));
  return Object.keys(out).length ? out : null;
}

export function itemBookmarks(r, id) {
  return r && Object.prototype.hasOwnProperty.call(r.items, id) ? r.items[id] : null;
}

export function sourceLines(r) {
  if (!r) return [];
  return Object.entries(SOURCE_JA).map(([id, ja]) => ({ id, ja, ...r.sources[id] }));
}
