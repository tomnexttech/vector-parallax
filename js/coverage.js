/* coverage — 媒体の比べ（CONTRACT §23）。board の case.coverage（parallax/coverage.py が作る）を検査して、表の節点にする。
 * 媒体を横に、内容の点（誰・何・いつ・どこ・数・理由・反応・今後）を縦に、各セルはその媒体の見出し・要旨の中の語句（そのままの一部）か、
 * 「見出しと要旨には出ていない」か、言語が違うので照合していない印。下に、同じ事を指す語の選び方の違い。
 * 守る線: 材料は見出しと要旨だけ。出ていないのは「見出しと要旨には出ていない」という事実だけで、報じなかった・隠したとは書かない。
 * 媒体の意図は書かない。数は書かれた通り。AI は使わない（語の抜き出しと束ねは規則）。この欄が無い・壊れている時は coverageOf が null を返し、呼ぶ側は何も出さない（今までの表示）。
 *
 *   coverageOf(raw)                -> { outlets, rows, words, findings } | null     検査して整える（文字は切り詰め、番号は範囲内だけ）
 *   findingsOf(raw, n)             -> [{ kind, row, outlets, others, side, text, evidence }]   どこが違うか（§23.1。決まった型の文だけ・型の外は落とす）
 *   leadRows(cov, n)               -> rows    最初に見せる行: 一部の媒体にだけ出ている行を先に、元の並びのまま
 *   gapsOf(row)                    -> { have, none, na }
 *   createCoverage({ h })          -> { node(cov, opt), table(cov, opt), words(cov) }
 */
export const KIND_JA = { who: '誰', what: '何', when: 'いつ', where: 'どこ', num: '数', why: '理由', react: '反応', next: '今後' };
export const SIDE_JA = { jp: '国内', intl: '海外', gov: '官公庁' };
export const LEAD_ROWS = 7;
export const FIND_KINDS = ['only_side', 'word_choice', 'num_diff', 'lead_differs', 'first_gap'];
export const FIND_JA = { only_side: '載せた点', word_choice: '言葉の選び方', num_diff: '数', lead_differs: '見出しの最初の語', first_gap: '最初の時刻' };
/** the sentence under its label: a sentence that starts with the label's own words (見出しの最初の語：…) loses them there, and keeps them on the first card */
export const unlabel = (f) => { const l = FIND_JA[f && f.kind], t = String((f && f.text) || ''); return l && t.startsWith(l + '：') ? t.slice(l.length + 1) : t; };
/** the words a finding may never use (CONTRACT 4.7: what is not in the collected headlines is not "not reported") */
const SILENT = /報じなかった|報じていない|報じず|報じられなかった|報道しなかった|報道していない|報道せず|伝えなかった|伝えていない|黙殺|did not report|didn't report|not reported by|failed to report|no coverage/i;
/** the rows named by a word of the report itself: the narrow table keeps only a mark in the cell (the word is the row's name) */
export const TERM_KINDS = ['who', 'what', 'where'];
const SIDES = Object.keys(SIDE_JA);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : '');
const clip = (s, n) => Array.from(s).slice(0, n).join('');

const idx = (v, n) => [...new Set(arr(v).filter((i) => Number.isInteger(i) && i >= 0 && i < n))].sort((a, b) => a - b);
export function findingsOf(raw, n) {
  return arr(raw).filter(isObj).filter((f) => FIND_KINDS.includes(f.kind)).map((f) => {
    const text = clip(str(f.text).trim(), 160);
    if (!text || SILENT.test(text)) return null;
    return {
      kind: f.kind, row: KIND_JA[f.row] ? f.row : null, outlets: idx(f.outlets, n), others: idx(f.others, n), side: SIDES.includes(f.side) ? f.side : null, text,
      evidence: arr(f.evidence).filter((e) => isObj(e) && Number.isInteger(e.o) && e.o >= 0 && e.o < n).slice(0, 4).map((e) => ({ o: e.o, p: clip(str(e.p), 60), k: clip(str(e.k), 40) })),
    };
  }).filter(Boolean).slice(0, 5);
}

export function coverageOf(raw) {
  try {
    if (!isObj(raw) || raw.v !== 1) return null;
    const outlets = arr(raw.outlets).filter(isObj).map((o) => ({ name: clip(str(o.name).trim(), 40), side: SIDES.includes(o.side) ? o.side : 'jp', lang: o.lang === 'en' ? 'en' : 'ja', desc: o.desc === true }))
      .filter((o) => o.name).slice(0, 14);
    if (outlets.length < 2 || outlets.length !== arr(raw.outlets).length) return null;
    const rows = arr(raw.rows).filter(isObj).map((r) => {
      if (!KIND_JA[r.k]) return null;
      const c = arr(r.c);
      const cells = outlets.map((_, i) => {
        const x = c[i];
        if (isObj(x) && str(x.p).trim()) return { p: clip(str(x.p).trim(), 60), k: clip(str(x.k), 40) };
        return x === null ? null : '';
      });
      return { k: r.k, t: clip(str(r.t).trim(), 40), c: cells };
    }).filter((r) => r && r.t && r.c.some((x) => x)).slice(0, 14);
    const words = arr(raw.words).filter(isObj).map((w) => ({
      t: clip(str(w.t).trim(), 30),
      v: arr(w.v).filter(isObj).map((x) => ({ w: clip(str(x.w).trim(), 30), o: [...new Set(arr(x.o).filter((i) => Number.isInteger(i) && i >= 0 && i < outlets.length))].sort((a, b) => a - b) })).filter((x) => x.w && x.o.length).slice(0, 6),
    })).filter((w) => w.t && w.v.length >= 2).slice(0, 4);
    if (rows.length < 2 && !words.length) return null;
    return { outlets, rows, words, findings: findingsOf(raw.findings, outlets.length) };
  } catch { return null; }
}

/** per row: how many outlets carry it, how many do not (in the language of the row), how many were not compared */
export function gapsOf(row) {
  const have = row.c.filter((x) => x).length, na = row.c.filter((x) => x === null).length;
  return { have, none: row.c.length - have - na, na };
}

export function leadRows(cov, n = LEAD_ROWS) {
  if (cov.rows.length <= n) return cov.rows;
  const rank = cov.rows.map((r, i) => { const g = gapsOf(r); return { i, v: (g.have > 0 && g.none > 0 ? 2 : 0) + (g.have >= 2 ? 1 : 0) }; });
  const keep = new Set(rank.sort((a, b) => b.v - a.v || a.i - b.i).slice(0, n).map((x) => x.i));
  return cov.rows.filter((_, i) => keep.has(i));
}

const isEn = (s) => /^[\x00-\x7f]+$/.test(s);

export function createCoverage({ h }) {
  /** the sentence the outlet published, cut at the word: before, the word (marked), after */
  const mark = (text, key) => {
    const i = key ? text.indexOf(key) : -1;
    return i < 0 ? [h('span', { class: 'cv-b', text })] : [h('span', { class: 'cv-b', text: text.slice(0, i) }), h('mark', { text: key }), h('span', { class: 'cv-a', text: text.slice(i + key.length) })];
  };
  const cell = (c, o, term) => {
    if (c === null) return h('td', { class: 'na', data: { side: o.side }, title: '言語が違うので照合していません' }, h('span', { class: 'sr', text: '照合なし' }), h('span', { 'aria-hidden': 'true', text: '·' }));
    if (c === '') return h('td', { class: 'off', data: { side: o.side }, title: `${o.name} の見出しと要旨には出ていない` }, h('span', { class: 'sr', text: '出ていない' }), h('span', { 'aria-hidden': 'true', text: '—' }));
    return h('td', { class: 'on' + (term ? ' t' : ''), data: { side: o.side }, lang: o.lang === 'en' ? 'en' : null, title: `${o.name}: ${c.p}` },
      term ? h('i', { class: 'cv-dot', 'aria-hidden': 'true' }) : null, h('span', { class: 'cv-p' }, ...mark(c.p, c.k)));
  };
  const label = (r) => {
    const g = gapsOf(r), n = g.have + g.none;
    const [k1, k2] = r.k === 'num' && r.t.includes('・') ? r.t.split('・') : [null, null];
    const term = TERM_KINDS.includes(r.k);
    const name = term ? r.t : k1 ? k2 : r.t;
    const sub = [term ? KIND_JA[r.k] : k1, n > 1 ? `${g.have}/${n}` : null].filter(Boolean).join('・');
    return h('th', { scope: 'row', title: n > 1 ? `${n} 社中 ${g.have} 社の見出しか要旨に出ている` : null }, h('span', { class: 'cv-l', lang: isEn(name) ? 'en' : null, text: name }), sub ? h('small', { class: 'num', text: sub }) : null);
  };
  function table(cov, { rows } = {}) {
    const list = rows || cov.rows;
    return h('table', { class: 'cv-t' },
      h('thead', null, h('tr', null, h('th', { scope: 'col', class: 'cv-c' }, h('span', { class: 'sr', text: '内容の点' })),
        cov.outlets.map((o) => h('th', { scope: 'col', data: { side: o.side } }, h('b', { text: o.name }), o.desc ? null : h('small', { text: '見出しのみ' }))))),
      h('tbody', null, list.map((r) => h('tr', { data: { k: r.k } }, label(r), r.c.map((c, i) => cell(c, cov.outlets[i], TERM_KINDS.includes(r.k)))))));
  }
  /** the choice of words: one line per thing, each word the outlets used for it */
  function words(cov) {
    if (!cov.words.length) return null;
    return h('div', { class: 'cv-w' }, h('h4', { text: '言い方の違い' }), h('ul', null, cov.words.map((w) => h('li', null, h('b', { text: w.t }),
      h('span', { class: 'cv-v' }, w.v.map((x) => h('span', { class: 'cv-x' },
        h('span', { class: 'cv-wd', lang: isEn(x.w) ? 'en' : null, text: x.w }),
        h('i', { class: 'cv-d', 'aria-hidden': 'true' }, x.o.slice(0, 6).map((i) => h('i', { data: { side: cov.outlets[i].side } }))),
        h('small', { text: x.o.slice(0, 3).map((i) => cov.outlets[i].name).join('・') + (x.o.length > 3 ? ` ほか ${x.o.length - 3}` : '') }))))))));
  }
  /** where the outlets differ: a few lines of fixed form, above the table (CONTRACT 23.1) */
  function findings(cov) {
    const list = cov && Array.isArray(cov.findings) ? cov.findings : [];
    if (!list.length) return null;
    return h('div', { class: 'cv-w cv-f' }, h('h4', { text: '違い' }), h('ul', null, list.map((f, i) => h('li', { data: { kind: f.kind } }, i && list[i - 1].kind === f.kind ? null : h('b', { text: FIND_JA[f.kind] }), h('span', { text: unlabel(f) })))));   // a label once for the sentences of one kind
  }
  /** the sign that the table runs on to the right: the outlets that are not wholly in view are counted, the right edge fades (css), the label sits above the table.
   *  It is measured on the page (the sizes are only known there), after each paint, on a scroll and on a resize; without a page (a test) nothing is measured and nothing is shown. */
  const watchScroll = (wrap, box, hint) => {
    if (typeof box.getBoundingClientRect !== 'function' || typeof box.addEventListener !== 'function') return null;
    let shown = null;
    const measure = () => {
      const over = box.scrollWidth - box.clientWidth > 2;
      const edge = box.getBoundingClientRect().right;
      const rest = over ? [...box.querySelectorAll('thead th[data-side]')].filter((th) => th.getBoundingClientRect().right > edge + 1).length : 0;
      wrap.toggleAttribute('data-over', over);
      wrap.toggleAttribute('data-more', rest > 0);
      wrap.toggleAttribute('data-left', box.scrollLeft > 2);
      if (rest > 0 && rest !== shown) { shown = rest; hint.textContent = `→ あと ${rest} 社`; }
    };
    box.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    return () => { if (ro) { ro.disconnect(); ro.observe(box); if (box.firstElementChild) ro.observe(box.firstElementChild); } measure(); };   // the table itself grows when the fonts come in
  };
  /** the whole card: the table (the lead rows, the rest behind a button) and the choice of words */
  function node(cov, { n = LEAD_ROWS } = {}) {
    const lead = leadRows(cov, n), more = cov.rows.length - lead.length;
    const box = h('div', { class: 'cv-sc', role: 'region', tabindex: '0', 'aria-label': '媒体の比べの表（横に流せます）' });
    const hint = h('p', { class: 'cv-hint', 'aria-hidden': 'true' });
    const wrap = h('div', { class: 'cv-wrap' }, hint, box);
    const watched = watchScroll(wrap, box, hint);
    let all = false;
    const paint = () => { box.replaceChildren(table(cov, { rows: all ? cov.rows : lead })); if (watched) watched(); };
    paint();
    const hasNa = cov.rows.some((r) => r.c.some((x) => x === null));
    const btn = more > 0 ? h('button', { type: 'button', class: 'cv-more', 'aria-expanded': 'false', on: { click: () => { all = !all; btn.setAttribute('aria-expanded', String(all)); btn.textContent = all ? '行を減らす' : `残り ${more} 行を見る`; paint(); } } }, `残り ${more} 行を見る`) : null;
    return h('section', { class: 'cov', 'aria-label': '媒体の比べ' },
      h('h3', { class: 'st-h', data: { st: 'cv' } }, '媒体の比べ',
        h('span', { class: 'cv-lg' }, h('span', { class: 'on', text: '出ている' }), h('span', { class: 'off', text: '見出しと要旨には出ていない' }), hasNa ? h('span', { class: 'na', text: '照合なし' }) : null)),
      findings(cov), wrap, btn, words(cov));
  }
  return { node, table, words, findings };
}
