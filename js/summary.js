/* summary — 出来事ごとの一行の要約（story.summary）の読み方。DOM に触れない。docs/CONTRACT-public.md §13。
 *
 *   summaryOf(story)      -> null | { text, provider, model, madeAt }   形が崩れていれば null（頁は何も出さない）
 *   memberKey(ids)        -> 顔ぶれの鍵（id を並べ替えて連結）。build の members_digest と同じ「顔ぶれ」を指す
 *   summaryIndex(stories) -> Map(顔ぶれの鍵 -> summary)。BYOK で stories を組み直した後、規則のままの story に元の要約を戻すために使う
 *   summaryLabel(sm)      -> "provider · model"（どの AI が書いたか）
 *   briefOf(story)        -> null | { rows: [{ key, label, text, unknown }], provider, model, madeAt }   詳しい要約（story.brief。CONTRACT §13.1）。what_ja が無ければ null
 *   briefIndex(stories)   -> Map(顔ぶれの鍵 -> brief)。BYOK で組み直した後、規則のままの story に元の詳しい要約を戻す
 * 要約は AI の見出しを持つ story には付かない。見出しの丸写しは build が捨てている（quoted_fields）。 */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function summaryOf(story) {
  const s = isObj(story) ? story.summary : null;
  if (!isObj(s)) return null;
  const text = typeof s.text_ja === 'string' ? s.text_ja.replace(/\s+/g, ' ').trim() : '';
  if (!text || !isNum(s.made_at)) return null;
  if (typeof s.provider !== 'string' || !s.provider || typeof s.model !== 'string' || !s.model) return null;
  return { text, provider: s.provider, model: s.model, madeAt: s.made_at };
}

export function memberKey(ids) {
  return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string').slice().sort().join('|') : '';
}

export function summaryIndex(stories) {
  const out = new Map();
  for (const st of Array.isArray(stories) ? stories : []) {
    const sm = summaryOf(st);
    if (sm && !(isObj(st.ai) && st.origin === 'ai')) out.set(memberKey(st.member_ids), sm);
  }
  return out;
}

export function summaryLabel(sm) {
  return sm ? `${sm.provider} \u00b7 ${sm.model}` : '';
}

// 詳しい要約（story.brief）。欄は 4 つ。空の欄と、中身が「伝えられていない」の欄は行ごと出さない。出せる行が一つも無ければ要点の枠ごと出さない（null）
export const BRIEF_ROWS = [['what_ja', '何が起きたか'], ['background_ja', '経緯'], ['views_ja', '伝え方'], ['next_ja', '今後の焦点']];
export const BRIEF_UNKNOWN = '伝えられていない';

// words that praise or blame (data/prompt.json summary.judgement_ja, the same list). The AI may not add one: a line with such a word that no headline
// of the event carries is not shown (a line published before the rule is cut here, at the page)
export const JUDGE_WORDS = ['偉業', '快挙', '歴史的', '完璧', '惨敗', '圧勝', '衝撃', '見事', '残念', '素晴らしい', '画期的', '大失態', '異常な', '驚異'];
const fold = (s) => String(s == null ? '' : s).normalize('NFKC').toLowerCase();
export function judged(text, material) {
  const t = fold(text), src = fold((Array.isArray(material) ? material : [material]).join(' '));
  return JUDGE_WORDS.some((w) => t.includes(w) && !src.includes(w));
}

export function briefOf(story) {
  const b = isObj(story) ? story.brief : null;
  if (!isObj(b)) return null;
  const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  if (!clean(b.what_ja) || !isNum(b.made_at)) return null;
  if (typeof b.provider !== 'string' || !b.provider || typeof b.model !== 'string' || !b.model) return null;
  const rows = BRIEF_ROWS.map(([key, label]) => ({ key, label, text: clean(b[key]) })).filter((r) => r.text && r.text !== BRIEF_UNKNOWN);
  if (!rows.length) return null;
  // 中身の違い（CONTRACT §13.2）: 文と、その材料にした item の id。どの社の説明から読めたかは、頁が id から引く
  const diffs = (Array.isArray(b.diffs) ? b.diffs : []).filter(isObj).map((d) => ({ text: clean(d.text_ja), ids: (Array.isArray(d.refs) ? d.refs : []).filter((x) => typeof x === 'string') })).filter((d) => d.text && d.ids.length).slice(0, 3);
  return { rows, diffs, provider: b.provider, model: b.model, madeAt: b.made_at };
}

export function briefIndex(stories) {
  const out = new Map();
  for (const st of Array.isArray(stories) ? stories : []) {
    const br = briefOf(st);
    if (br) out.set(memberKey(st.member_ids), br);
  }
  return out;
}
