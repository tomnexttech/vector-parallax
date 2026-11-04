/* validate — AI の答えを検査して Story の元にする（parallax/validate.py と同じ規則・同じ表で試験する）。
 * docs/CONTRACT-public.md §4.3・§4.4。tests/fixtures/validate_cases.json の全例が Python と JS の両方で通る。
 *
 *   validate(request, rawText, prompt, items)
 *     -> { blocks: { bid: [{ member_ids, origin: 'ai'|'rule', ai }] },
 *          counts: { dropped_ids, dup_ids, unassigned_ids, flags_vetoed, quoted_fields, report_words, silence_words },
 *          errors: ['json'|'shape'] }
 *
 * request は ai_requests の一件（doc に別名と rule_groups、alias に別名 -> item id）。
 * items は item id -> item（home・type・outlet を 4.4 で、title を引用検査で読む）。別名は外へ出さない。
 * 文字の扱いは Python と揃える: 長さと切り詰めはコードポイント単位、空白は明示した集合。 */

export const MAINSTREAM_TYPES = ['公共放送', '通信社', '全国紙', '民放'];
export const PRIMARY_TYPE = '政府一次';
export const ELLIPSIS = '…';
export const QUOTE_MIN = 10;

// 空白（4.3）。\s ではなく Python と同じ集合を明示する
const WS = /[\t\n\x0b\x0c\r \x85\xa0\u2028\u2029\u3000]+/g;
const DROP = /[\p{Cc}\p{Cf}\p{Cs}]/gu;
const LN = /[\p{L}\p{N}]/u;
const FENCE = /^```[A-Za-z0-9_-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*```$/;
// Python の str.strip() と同じ空白（\x1c-\x1f・\x85 を含み、\ufeff を含まない）
const PY_WS = '\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000';

const cpLen = (s) => Array.from(s).length;
function pyStrip(s) {
  let a = 0, b = s.length;
  while (a < b && PY_WS.includes(s[a])) a++;
  while (b > a && PY_WS.includes(s[b - 1])) b--;
  return s.slice(a, b);
}
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 引用検査用の折り畳み: NFKC・小文字・カテゴリ L* と N* の文字だけ残す。 */
export function fold(text) {
  return Array.from(text.normalize('NFKC').toLowerCase()).filter((ch) => LN.test(ch)).join('');
}

/** field（掃除済み）が見出しの丸写しか。見出しが field を含む、または field が見出しを含む。 */
export function copies(field, foldedTitles) {
  const f = fold(field);
  if (!f) return false;
  const fl = cpLen(f);
  return foldedTitles.some((t) => (cpLen(t) >= QUOTE_MIN && f.includes(t)) || (fl >= QUOTE_MIN && t.includes(f)));
}

/** 題（headline_ja・headline_en）が報じ方の語を含むか（CONTRACT §4.6）。語の表は prompt.report_words。Python の report_hit と同じ。 */
export function reportHit(text, prompt) {
  if (!prompt || prompt.rights_mode !== 'strict') return false;   // quote（既定）では検査しない（CONTRACT §14）
  const rw = isObj(prompt.report_words) ? prompt.report_words : {};
  const nf = (x) => String(x).normalize('NFKC').toLowerCase();
  let t = nf(text);
  for (const a of Array.isArray(rw.allowed_ja) ? rw.allowed_ja : []) t = t.split(nf(a)).join(' ');
  if ((Array.isArray(rw.ja) ? rw.ja : []).some((w) => t.includes(nf(w)))) return true;
  return (Array.isArray(rw.en) ? rw.en : []).some((w) =>
    new RegExp('(^|[^a-z])' + nf(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z])').test(t));
}

/** 文が「報じなかった」系の語を含むか（CONTRACT §4.7）。mode に関わらず検査する。Python の silence_hit と同じ。 */
export function silenceHit(text, prompt) {
  const sw = isObj(prompt && prompt.silence_words) ? prompt.silence_words : {};
  const nf = (x) => String(x).normalize('NFKC').toLowerCase();
  const t = nf(text);
  if ((Array.isArray(sw.ja) ? sw.ja : []).some((w) => t.includes(nf(w)))) return true;
  return (Array.isArray(sw.en) ? sw.en : []).some((w) =>
    new RegExp('(^|[^a-z])' + nf(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z])').test(t));
}

/** 文字列でなければ ''。空白を一つに畳み、Cc/Cf/Cs を除き、コードポイントで limit に切る。 */
export function clean(value, limit) {
  if (typeof value !== 'string') return '';
  let s = pyStrip(value.replace(WS, ' '));
  s = pyStrip(s.replace(DROP, '').replace(WS, ' '));
  const cps = Array.from(s);
  if (cps.length > limit) s = cps.slice(0, Math.max(limit - 1, 0)).join('') + ELLIPSIS;
  return s;
}

function parseAnswer(rawText) {
  if (typeof rawText !== 'string') throw new Error('json');
  let t = pyStrip(rawText);
  const m = FENCE.exec(t);
  if (m) t = pyStrip(m[1]);
  try { return JSON.parse(t); } catch { throw new Error('json'); }
}

/** 4.4。members は item の配列。-> { kept, dropped: [{flag, why}] } */
export function vetoFlags(flags, members) {
  const kept = [], dropped = [];
  const outlets = new Set(members.map((m) => m.outlet));
  for (const f of flags) {
    let why = null;
    if (f === 'overseas_only') {
      if (members.some((m) => m.home === 'jp')) why = 'has_jp_outlet';
    } else if (f === 'jp_main_not_found') {
      if (outlets.size < 2) why = 'single_outlet';
      else if (members.some((m) => m.home === 'jp' && MAINSTREAM_TYPES.includes(m.type))) why = 'has_jp_mainstream';
    } else if (f === 'primary_only') {
      if (members.some((m) => m.type !== PRIMARY_TYPE)) why = 'has_non_primary';
    }
    if (why) dropped.push({ flag: f, why });
    else kept.push(f);
  }
  return { kept, dropped };
}

function emptyResult(errors) {
  return {
    blocks: {},
    counts: { dropped_ids: 0, dup_ids: 0, unassigned_ids: 0, flags_vetoed: 0, quoted_fields: 0, report_words: 0, silence_words: 0 },
    errors: errors ? [...errors] : [],
  };
}

export function validate(request, rawText, prompt, items) {
  const out = emptyResult();
  let answer;
  try { answer = parseAnswer(rawText); } catch (e) { out.errors.push(e.message); return out; }
  if (!isObj(answer) || !Array.isArray(answer.blocks)) { out.errors.push('shape'); return out; }

  let doc;
  try { doc = JSON.parse(request.doc); } catch { out.errors.push('shape'); return out; }
  const alias = isObj(request.alias) ? request.alias : {};
  const reqBlocks = new Map();
  for (const b of Array.isArray(doc && doc.blocks) ? doc.blocks : []) {
    const aliases = (Array.isArray(b.items) ? b.items : []).map((it) => it.id);
    if (aliases.some((a) => typeof a !== 'string' || !has(alias, a))) { out.errors.push('shape'); return out; }
    reqBlocks.set(b.bid, { aliases, set: new Set(aliases), groups: Array.isArray(b.rule_groups) ? b.rule_groups : [] });
  }

  const lim = prompt.limits;
  const allowed = Array.isArray(prompt.flags) ? prompt.flags : [];
  const counts = out.counts;
  const real = (a) => alias[a];
  const itemOf = (id) => (has(items, id) && isObj(items[id]) ? items[id] : {});

  for (const entry of answer.blocks) {
    if (!isObj(entry)) continue;
    const bid = entry.bid;
    if (typeof bid !== 'string' || bid === '__proto__' || !reqBlocks.has(bid) || has(out.blocks, bid)) continue;
    const rb = reqBlocks.get(bid);
    const storiesIn = Array.isArray(entry.stories) ? entry.stories : [];
    const titles = [];                                       // 引用検査: この塊の見出し（null は除く）
    for (const a of rb.aliases) {
      const t = itemOf(real(a)).title;
      if (typeof t === 'string') titles.push(fold(t));
    }
    const used = new Set();
    const built = [];                                        // { members[別名], ai | null }
    for (const st of storiesIn) {
      if (!isObj(st)) continue;
      const members = [];
      const mids = Array.isArray(st.member_ids) ? st.member_ids : [];
      for (const a of mids) {
        if (typeof a !== 'string' || !rb.set.has(a)) counts.dropped_ids += 1;
        else if (used.has(a)) counts.dup_ids += 1;
        else { used.add(a); members.push(a); }
      }
      if (!members.length) continue;
      const realItems = members.map((a) => itemOf(real(a)));
      const text = (key, limit, headline) => {
        const v = clean(key ? st[key] : undefined, limit);
        if (v && copies(v, titles)) { counts.quoted_fields += 1; return ''; }
        if (v && silenceHit(v, prompt)) { counts.silence_words += 1; return ''; }   // 「報じなかった」系（§4.7）
        if (v && headline && reportHit(v, prompt)) { counts.report_words += 1; return ''; }   // 題は事実の叙述に限る（§4.6）
        return v;
      };
      const hja = text('headline_ja', lim.headline_ja, true);
      const hen = text('headline_en', lim.headline_en, true);
      if (!hja && !hen) { built.push({ members, ai: null }); continue; }   // 信用しない: 後で未割当へ戻す
      const seenAngle = new Set(), angles = [];
      for (const ag of Array.isArray(st.angles) ? st.angles : []) {
        if (!isObj(ag)) continue;
        const iid = ag.item_id;
        if (typeof iid !== 'string' || !members.includes(iid) || seenAngle.has(iid)) continue;
        let focus = clean(ag.focus_ja, lim.focus_ja);
        if (focus && copies(focus, titles)) { counts.quoted_fields += 1; focus = ''; }
        else if (focus && silenceHit(focus, prompt)) { counts.silence_words += 1; focus = ''; }
        seenAngle.add(iid);                                  // 先勝ち: 空の物が先でも二つ目は採らない
        if (focus) angles.push({ item_id: real(iid), focus_ja: focus });
      }
      const flags = [], seenFlag = new Set();
      for (const f of Array.isArray(st.flags) ? st.flags : []) {
        if (typeof f === 'string' && allowed.includes(f) && !seenFlag.has(f)) { seenFlag.add(f); flags.push(f); }
      }
      const { kept, dropped } = vetoFlags(flags, realItems);
      counts.flags_vetoed += dropped.length;
      const note = kept.length ? text('flag_note_ja', lim.flag_note_ja) : '';
      const contrast = text('contrast_ja', lim.contrast_ja);
      built.push({
        members,
        ai: { headline_ja: hja, headline_en: hen, angles, contrast_ja: contrast, flags: kept, flags_dropped: dropped, flag_note_ja: note },
      });
    }

    const result = [];
    for (const { members, ai } of built) {
      if (ai === null) for (const a of members) used.delete(a);   // 全部読んだ後に未割当へ戻す
      else result.push({ member_ids: members.map(real), origin: 'ai', ai });
    }
    const grouped = new Set();
    for (const g of rb.groups) {
      const grp = Array.isArray(g) ? g : [];
      for (const a of grp) grouped.add(a);
      const left = grp.filter((a) => !used.has(a));
      if (left.length) {
        counts.unassigned_ids += left.length;
        result.push({ member_ids: left.map(real), origin: 'rule', ai: null });
      }
    }
    const stray = rb.aliases.filter((a) => !grouped.has(a) && !used.has(a));
    if (stray.length) {                                      // rule_groups に載らなかった別名（契約上は無いはず）
      counts.unassigned_ids += stray.length;
      result.push({ member_ids: stray.map(real), origin: 'rule', ai: null });
    }
    out.blocks[bid] = result;
  }
  return out;
}
