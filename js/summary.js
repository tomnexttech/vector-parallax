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

/** what each outlet's own article says (story.read, made by reading the article body; the shape is tolerant of the names the build may use):
 *  { outlets: [{ outlet, side, body (true when the body was read), focus_ja, words: [short quotes], absent_ja: [what the others carry and this one does not] }], clash_ja }
 *  null when the story has none or the shape is not one. Nothing is made up here: a field that is missing is left out. */
export function readOf(story) {
  // the shape of docs/read-shape.md: read.outlets are the outlets whose body was read; read.unread are the ones that were not, with the reason
  const r = isObj(story) ? story.read : null;
  if (!isObj(r) || r.status !== 'ok') return null;
  const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
  const SIDE = { '国内': 'jp', '海外': 'intl', '官公庁': 'gov', jp: 'jp', intl: 'intl', gov: 'gov' };
  const outlets = (Array.isArray(r.outlets) ? r.outlets : []).filter(isObj).map((o) => ({
    outlet: clean(o.outlet), side: SIDE[o.side] || '', item: clean(o.item), body: true, focus: clean(o.focus),
    facts: (Array.isArray(o.facts) ? o.facts : []).map(clean).filter(Boolean),
    words: (Array.isArray(o.wording) ? o.wording : []).filter(isObj).map((w) => ({ quote: clean(w.quote), note: clean(w.note) })).filter((w) => w.quote),
    absent: (Array.isArray(o.omits) ? o.omits : []).map((x) => (isObj(x) ? clean(x.text) : clean(x))).filter(Boolean), head: '',
  })).filter((o) => o.outlet && (o.focus || o.facts.length));
  const unread = (Array.isArray(r.unread) ? r.unread : []).filter(isObj).map((u) => ({ outlet: clean(u.outlet), side: SIDE[u.side] || '', item: clean(u.item), why: clean(u.why_ja) })).filter((u) => u.outlet);
  const clash = clean(r.contrast), dva = clean(r.domestic_vs_abroad);
  if (outlets.length < 2) return null;
  return { outlets, unread, clash, dva, at: typeof r.at === 'number' ? r.at : null };
}

/** the reason each outlet's body was not read (story.read.unread[].why_ja), by outlet name; kept even when fewer than two bodies were read, so a row that says "not read" can say why */
export function unreadWhy(story) {
  const r = isObj(story) ? story.read : null;
  const out = {};
  if (!isObj(r) || !Array.isArray(r.unread)) return out;
  for (const u of r.unread) {
    if (!isObj(u) || typeof u.outlet !== 'string' || typeof u.why_ja !== 'string') continue;
    const o = u.outlet.replace(/\s+/g, ' ').trim(), w = u.why_ja.replace(/\s+/g, ' ').trim();
    if (o && w && !out[o]) out[o] = w;
  }
  return out;
}

export function briefIndex(stories) {
  const out = new Map();
  for (const st of Array.isArray(stories) ? stories : []) {
    const br = briefOf(st);
    if (br) out.set(memberKey(st.member_ids), br);
  }
  return out;
}
