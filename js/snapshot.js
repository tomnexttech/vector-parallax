/* snapshot — 前回の AI の見方を保った回（ai_run.status が kept_previous）の読み方。DOM に触れない。docs/CONTRACT-public.md §12。
 *
 *   keptView(data) -> null | { view, aiAt, fetchedAt, reason, snapRun }
 *     view: ai_snapshot を「ふつうの parallax/1 の形」に直した物。generated_at は取得の時刻（source_fetched_at）。頁はこれで AI の見方を描く。
 *     この回自身の items・rule_clusters・stories とは混ぜない（別の一揃いのまま渡す）。
 *     読めない形（時刻が数でない・items か stories が無い）なら null: 頁は AI の見方を出さず、そう言う。
 *   noticeParts(kept, fmtFull, explain, errors) -> { lead, ai, why }: 頁に出す明示の文
 *   isOld(ts, now, max) -> 6 時間（既定）を過ぎたか */

export const SIX_H = 6 * 3600;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function isOld(ts, now, max = SIX_H) {
  return isNum(ts) && isNum(now) && now - ts > max;
}

/** 最初に開いた時の見方。AI の結果がある時は 'ai'（status が ok / partial / recorded、または前回を保った kept_previous で
 *  保った物が読める時）。AI の結果が無い時（off・nokey・error で保った物も無い）だけ 'rules'。URL の #rules / #ai はこれより先（呼ぶ側で扱う）。 */
export function defaultView(data) {
  if (!isObj(data) || !isObj(data.ai_run)) return 'rules';
  const st = data.ai_run.status;
  if (st === 'ok' || st === 'partial' || st === 'recorded') {
    return Array.isArray(data.stories) && data.stories.some((s) => isObj(s) && s.origin === 'ai') ? 'ai' : 'rules';
  }
  if (st === 'kept_previous') return keptView(data) ? 'ai' : 'rules';
  return 'rules';
}

export function keptView(data) {
  if (!isObj(data) || !isObj(data.ai_run) || data.ai_run.status !== 'kept_previous') return null;
  const sn = data.ai_snapshot;
  if (!isObj(sn) || !isNum(sn.ai_at) || !isNum(sn.source_fetched_at)) return null;
  if (!isObj(sn.items) || !Array.isArray(sn.rule_clusters) || !Array.isArray(sn.stories)) return null;
  const snapRun = isObj(sn.ai_run) ? sn.ai_run : {};
  const reason = data.ai_run.reason === 'nokey' || data.ai_run.reason === 'error' ? data.ai_run.reason : '';
  return {
    view: {
      schema: data.schema,
      generated_at: sn.source_fetched_at,
      window_h: isNum(sn.window_h) && sn.window_h > 0 ? sn.window_h : 36,
      edition: typeof sn.edition === 'string' ? sn.edition : data.edition,
      items: sn.items,
      rule_clusters: sn.rule_clusters,
      blocks: Array.isArray(sn.blocks) ? sn.blocks : [],
      stories: sn.stories,
      ai_run: snapRun,
      sources: [],
    },
    aiAt: sn.ai_at,
    fetchedAt: sn.source_fetched_at,
    reason,
    snapRun,
  };
}

/** 短い札の組（[見出し, 値]）。lead はいつの取得の AI の束ねか、ai は AI 自身の時刻の見出し、why はこの回の AI（無ければ null）、rules は規則の束。
 *  fmtFull(ts) は時刻の文字列、explain(codes) は誤り符号を閲覧者向けの文にする関数、errors はこの回の誤り符号。 */
export function noticeParts(kept, fmtFull, explain, errors) {
  const lead = ['AI のまとめ', `${fmtFull(kept.fetchedAt)} の取得`];
  let why = null;
  if (kept.reason === 'nokey') why = ['今回', '鍵なし'];
  else if (kept.reason === 'error') why = ['今回', ['失敗', explain(errors)].filter(Boolean).join('・')];
  return { lead, ai: '結果', why, rules: ['自動のまとめ', '今回の取得'] };
}
