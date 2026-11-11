/* impact — data/impact.json（parallax-impact/1、CONTRACT §25.2）の読み口。形の検査だけで DOM は持たない。
 * 暮らしへの影響が大きい政策のラベル。公開の語の表（data/lifewords.json）で判じ、当たった語（hits）を根拠としてそのまま返す。
 * quiet は測れる事だけ（一次資料があり、主要な媒体の見出しが 1 社以下）。画面の言葉は quietText の通りで、「隠されている」「報じない」とは言わない。
 *
 *   impactOf(raw)              -> { generatedAt, areas, events, docs, caveat } | null
 *   impactFor(imp, sid)        -> { areas: [{ id, ja }], hits, stage, primary, mainstreamN, quiet } | null
 *   quietList(imp)             -> [sid]   一次資料があり主要な媒体の見出しが少ない物（媒体の少ない順ではなく、元の並び）
 *   quietText(e)               -> 「主要な媒体の見出し 1 社」
 *   docsOf(imp, { area })      -> 一次資料（官報・法案・意見募集）
 */
export const SCHEMA = 'parallax-impact/1';
export const LABEL = '暮らし';
export const STAGES = ['検討', '法案', '閣議決定', '成立', '施行', '意見募集'];
export const DOC_JA = { bill: '法案', gazette: '官報', pubcomment: '意見募集' };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v, n = 160) => (typeof v === 'string' ? Array.from(v.trim()).slice(0, n).join('') : '');
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

export function impactOf(raw) {
  try {
    if (!isObj(raw) || raw.schema !== SCHEMA) return null;
    const areas = arr(raw.areas).filter((a) => isObj(a) && /^[a-z]{2,12}$/.test(String(a.id)) && str(a.ja, 20)).map((a) => ({ id: a.id, ja: str(a.ja, 20) }));
    const ids = new Set(areas.map((a) => a.id));
    const events = {};
    if (isObj(raw.events)) {
      for (const [sid, e] of Object.entries(raw.events)) {
        if (!isObj(e)) continue;
        const ar = arr(e.areas).filter((a) => ids.has(a));
        const hits = arr(e.hits).map((x) => str(x, 30)).filter(Boolean).slice(0, 5);
        if (!ar.length || !hits.length) continue;                    // 根拠の語の無いラベルは出さない
        const mn = int(e.mainstream_n) ?? 0;
        events[sid] = { areas: ar, hits, stage: STAGES.includes(e.stage) ? e.stage : null, primary: e.primary === true, mainstreamN: mn, quiet: e.quiet === true && e.primary === true && mn <= 1 };
      }
    }
    const docs = arr(raw.docs).filter((d) => isObj(d) && DOC_JA[d.kind] && str(d.title) && /^https:\/\//.test(str(d.url))).map((d) => ({
      kind: d.kind, kindJa: DOC_JA[d.kind], title: str(d.title), url: str(d.url, 400), date: /^\d{4}-\d{2}-\d{2}$/.test(str(d.date)) ? d.date : null,
      areas: arr(d.areas).filter((a) => ids.has(a)), hits: arr(d.hits).map((x) => str(x, 30)).filter(Boolean).slice(0, 5),
      sid: typeof d.sid === 'string' && d.sid ? d.sid : null, mainstreamN: int(d.mainstream_n) ?? 0,
    })).filter((d) => d.areas.length).slice(0, 30);
    return { generatedAt: int(raw.generated_at), latestAt: int(raw.latest_generated_at), areas, events, docs, caveat: str(raw.caveat, 200) };
  } catch { return null; }
}

export function impactFor(imp, sid) {
  const e = imp && imp.events[sid];
  if (!e) return null;
  const ja = new Map(imp.areas.map((a) => [a.id, a.ja]));
  return { ...e, areas: e.areas.map((id) => ({ id, ja: ja.get(id) })) };
}

export function quietList(imp) {
  return imp ? Object.entries(imp.events).filter(([, e]) => e.quiet).map(([sid]) => sid) : [];
}

export function quietText(e) {
  return e ? `主要な媒体の見出し ${e.mainstreamN} 社` : '';
}

export function docsOf(imp, { area } = {}) {
  if (!imp) return [];
  return area ? imp.docs.filter((d) => d.areas.includes(area)) : imp.docs.slice();
}
