/* front — the home's three ways in and the one figure under the card (docs/design-1115.md §3), and the compare screen's rows that
 * line the sides up like newspapers laid side by side (§5). Counted values only: no side is ranked or called right or wrong.
 *
 *   keepInList(box, el)                      -> bool       brings a row into view inside its own list; nothing around the list moves
 *   gapByField(es, { sidesOf, fields })      -> { rows: [{ field, jp, intl, d }], jp, intl }   reports of Japan and abroad per field
 *   gapByEvent(es, { sidesOf, titleOf, max }) -> rows of the same shape, one an event (a field chosen)
 *   jpShare(gap)                             -> 0..100 | null   the share of Japan's reports in all reports counted
 *   numbersOf(titles)                        -> [{ v, text, n }]    the amounts, people and spans the headlines carry
 *   toneOf(titles)                           -> { neg: [{ w, n }], pos: [{ w, n }], nNeg, nPos }   reaction words, counted (not judged)
 *   paperOf(m, { titleOf })                  -> { cols: [{ side, n, words, nums, tone, first, heads }], lead }   the rows of the compare screen
 *   renderFront(root, o) / renderGap(root, o) / renderPaper(root, o)   the DOM, with the page's h()
 *
 * The reaction words: data/coverage.json react_tone holds the same two lists (tests/js/front.test.js checks they agree). A word is
 * counted where a headline carries it; the page says "見出しの語の数" under the bar and shows no bar with fewer than TONE_MIN words. */

export const FRONT_TABS = [['gap', '日本と海外の差'], ['one', '片側だけの話'], ['bias', '偏りの大きい話']];
export const TONE_NEG = ['抗議', '反発', '批判', '非難', '反対', '懸念', '憂慮', '反論', '警告', '不満', '怒り', '追及', '否定', '拒否'];
export const TONE_POS = ['歓迎', '支持'];
export const TONE_NEG_EN = ['condemn', 'criticis', 'criticiz', 'protest', 'warned', 'concern', 'denied', 'rejected'];
export const TONE_POS_EN = ['welcomed'];
export const TONE_MIN = 3;
export const PAPER_HEADS = 5;
export const PAPER_MIN = 2;
export const STALE_S = 6 * 3600;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const outletOf = (it) => str(it && it.media) || str(it && it.outlet);

/** a headline as a list shows it: the photo's caption a wire puts before it (「…＝4日午後、農水省 - 」) and the tail 「- 写真・画像(1/1)」 dropped */
export function cleanTitle(t) {
  let s = str(t).trim();
  s = s.replace(/\s*[-－–]\s*写真・画像\s*[（(]\d+\s*[／/]\s*\d+[）)]\s*$/, '');
  const cut = s.indexOf(' - ');
  if (cut > 0 && cut < 80 && /＝/.test(s.slice(0, cut)) && s.length - cut > 8) s = s.slice(cut + 3);
  return s.trim();
}

/** the tabs answer the arrow keys as the tabs of WAI-ARIA do: left and right move and choose, Home and End go to the ends */
export function tabKey(key, i, n) {
  if (key === 'ArrowRight') return (i + 1) % n;
  if (key === 'ArrowLeft') return (i - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
}

export function keepInList(box, el) {
  if (!box || !el || typeof box.getBoundingClientRect !== 'function' || typeof el.getBoundingClientRect !== 'function') return false;
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.top < b.top) box.scrollTop += r.top - b.top;
  else if (r.bottom > b.bottom) box.scrollTop += Math.min(r.bottom - b.bottom, r.top - b.top);
  return true;
}

const lean = (jp, intl) => (jp + intl ? (intl - jp) / (jp + intl) : 0);

export function gapByField(es, { sidesOf, fields = [] } = {}) {
  const by = new Map(fields.map((f) => [f, { jp: 0, intl: 0 }]));
  let jp = 0, intl = 0;
  for (const e of arr(es)) {
    if (!e || !by.has(e.field)) continue;
    const s = sidesOf(e), c = by.get(e.field);
    c.jp += s.jp.length; c.intl += s.intl.length; jp += s.jp.length; intl += s.intl.length;
  }
  const rows = fields.map((f) => ({ field: f, ...by.get(f) })).filter((r) => r.jp + r.intl > 0).map((r) => ({ ...r, d: lean(r.jp, r.intl) }));
  return { rows, jp, intl };
}

export function gapByEvent(es, { sidesOf, titleOf = (e) => str(e && e.key), max = 8 } = {}) {
  const rows = arr(es).filter(Boolean).map((e) => { const s = sidesOf(e); return { key: e.key, field: titleOf(e), jp: s.jp.length, intl: s.intl.length }; })
    .filter((r) => r.jp + r.intl > 0).sort((a, b) => (b.jp + b.intl) - (a.jp + a.intl)).slice(0, max).map((r) => ({ ...r, d: lean(r.jp, r.intl) }));
  return { rows, jp: rows.reduce((a, r) => a + r.jp, 0), intl: rows.reduce((a, r) => a + r.intl, 0) };
}

export function jpShare(gap) {
  const t = gap ? gap.jp + gap.intl : 0;
  return t ? Math.round((gap.jp / t) * 100) : null;
}

// ---------------------------------------------------------------- the compare screen's rows
const UNIT_JA = '兆円|億円|万円|円|億ドル|万ドル|ドル|ユーロ|万人|人|件|年|か月|カ月|ヶ月|日|時間|分|%|％|倍|歳|機|発|隻|台|棟|戸|km|キロ|トン|議席|票';
const NUM_RE = new RegExp(`(?:\\$\\s?\\d[\\d,]*(?:\\.\\d+)?\\s?(?:trillion|billion|million|tn|bn|m)?|\\d[\\d,]*(?:\\.\\d+)?\\s?(?:${UNIT_JA}|percent|people|years?|months?|days?|hours?|trillion|billion|million|dead|killed|seats|votes))`, 'gi');
/** the number a figure says, without its unit: 2,000億円 and 2000 meet; a figure the other side does not carry is marked on the page */
export const numValue = (t) => { const m = /\d[\d,]*(?:\.\d+)?/.exec(str(t)); return m ? Number(m[0].replace(/,/g, '')) : null; };
export function numbersOf(titles) {
  const by = new Map();
  for (const t of arr(titles)) {
    const seen = new Set();
    for (const m of str(t).matchAll(NUM_RE)) {
      const text = m[0].replace(/\s+/g, ' ').trim();
      if (/^\d{4}年$/.test(text) || seen.has(text)) continue;   // a year (2026年) is the date, not a figure of the news
      seen.add(text);
      const x = by.get(text) || { v: numValue(text), text, n: 0 };
      x.n++; by.set(text, x);
    }
  }
  return [...by.values()].sort((a, b) => b.n - a.n).slice(0, 6);
}

export function toneOf(titles) {
  const count = (list, en) => list.map((w) => ({ w, n: arr(titles).filter((t) => (en ? str(t).toLowerCase().includes(w) : str(t).includes(w))).length })).filter((x) => x.n > 0);
  const neg = [...count(TONE_NEG), ...count(TONE_NEG_EN, true)].sort((a, b) => b.n - a.n);
  const pos = [...count(TONE_POS), ...count(TONE_POS_EN, true)].sort((a, b) => b.n - a.n);
  return { neg, pos, nNeg: neg.reduce((a, x) => a + x.n, 0), nPos: pos.reduce((a, x) => a + x.n, 0) };
}

/** m = measure(e) of js/dossier.js (or sides(e) with words): one column a side that has a report, the rows in the same order */
export function paperOf(m) {
  if (!m) return { cols: [], lead: null };
  const words = m.words || { jp: [], intl: [] };
  const cols = ['jp', 'intl', 'gov'].filter((k) => arr(m[k]).length).map((k) => {
    const list = arr(m[k]).filter((it) => it && typeof it === 'object');
    const titles = list.map((it) => str(it.title)).filter(Boolean);
    const firstTs = list.map((it) => it.ts).filter(isNum).sort((a, b) => a - b)[0];
    return { side: k, n: list.length, outlets: new Set(list.map(outletOf).filter(Boolean)).size, few: list.length < PAPER_MIN, words: k === 'gov' ? [] : arr(words[k]).slice(0, 5), wordsAll: k === 'gov' ? [] : arr(words[k]), titles, nums: numbersOf(titles), tone: toneOf(titles),
      first: isNum(firstTs) ? firstTs : null, heads: list.slice(0, PAPER_HEADS) };
  });
  const firsts = cols.filter((c) => c.first != null).sort((a, b) => a.first - b.first);
  for (const c of cols) {
    const others = new Set(cols.filter((x) => x !== c).flatMap((x) => x.nums.map((y) => y.v)).filter(isNum));
    c.nums = c.nums.map((x) => ({ ...x, only: cols.length > 1 && isNum(x.v) && !others.has(x.v) }));
    c.ahead = firsts.length > 1 && c === firsts[0] ? firsts[1].first - c.first : null;
  }
  return { cols, lead: firsts[0] ? firsts[0].side : null };
}

// ---------------------------------------------------------------- the DOM
const SIDE_JA = { jp: '国内', intl: '海外', gov: '官公庁' };
const SIDE_COL = { jp: '日本の報道', intl: '海外の報道', gov: '官公庁' };

/** the value's own time, red when old (docs: data-freshness) */
function stamp(h, gen, now, clock, short) {
  if (!isNum(gen)) return h('span', { class: 'fr-at stale', text: '未取得' });
  const old = isNum(now) && now - gen > STALE_S;
  return h('time', { class: 'fr-at num' + (old ? ' stale' : ''), text: `${old && short ? short(gen) : clock(gen)} の値` });   // an old value carries its date
}

/** o = { h, tab, field, fields, counts: { gap: '国内 62%', one: '…', bias: '…' }, onTab(id), onField(f|null) } */
export function renderFront(root, o) {
  if (!root) return;
  const { h } = o;
  const ids = FRONT_TABS.map(([id]) => id);
  const key = (ev) => {
    const j = tabKey(ev.key, ids.indexOf(o.tab), ids.length);
    if (j == null) return;
    ev.preventDefault();
    o.onTab(ids[j]);
    const b = typeof document !== 'undefined' ? document.getElementById(`fr-t-${ids[j]}`) : null;
    if (b) b.focus();
  };
  const tabs = h('div', { class: 'fr-tabs', role: 'tablist', 'aria-label': '何を見るか' }, FRONT_TABS.map(([id, ja]) => h('button', {
    type: 'button', role: 'tab', class: 'fr-tab', id: `fr-t-${id}`, 'aria-selected': String(o.tab === id), 'aria-controls': 'gap', tabindex: o.tab === id ? '0' : '-1', data: { tab: id },
    on: { click: () => o.onTab(id), keydown: key } }, h('span', { class: 'fr-k', text: ja }), o.counts && o.counts[id] ? h('b', { class: 'fr-v num', text: o.counts[id] }) : null)));
  const chips = h('div', { class: 'fr-chips', role: 'group', 'aria-label': '分野' },
    h('button', { type: 'button', class: 'fr-chip', 'aria-pressed': String(!o.field), on: { click: () => o.onField(null) } }, 'すべて'),
    arr(o.fields).map((f) => h('button', { type: 'button', class: 'fr-chip', 'aria-pressed': String(o.field === f), on: { click: () => o.onField(f) } }, f)));
  root.replaceChildren(tabs, chips);
}

/** the panel under the card. o = { h, tab, field, gap, one: [{ side, ja, events }], bias: [{ key, title, score }], gen, now, clock,
 *  titleOf(e), pick(key), detail(key) } */
export function renderGap(root, o) {
  if (!root) return;
  const { h } = o;
  let title = '', body = null, den = '';
  if (o.tab === 'one') {
    title = o.field ? `片側だけの話・${o.field}` : '片側だけの話';
    const gs = arr(o.one).filter((g) => g.side === 'jp' || g.side === 'intl');
    body = gs.some((g) => g.events.length) ? h('div', { class: 'fr-one' }, gs.map((g) => h('section', { class: 'fr-og', data: { side: g.side } },
      h('h3', null, h('span', { text: g.ja }), h('b', { class: 'num', text: `${g.events.length} 件` })),
      g.events.length ? h('ul', null, g.events.slice(0, 5).map((e) => h('li', null, h('button', { type: 'button', class: 'fr-row', on: { click: () => o.pick(e.key) } }, cleanTitle(o.titleOf(e))))))
        : h('p', { class: 'fr-empty', text: `${g.ja}の話は今ありません。` }))))
      : h('p', { class: 'fr-empty', text: '片側だけの話は今ありません。分野を替えると出ることがあります。' });
  } else if (o.tab === 'bias') {
    title = o.field ? `偏りの大きい話・${o.field}` : '偏りの大きい話';
    const list = arr(o.bias);
    body = list.length ? h('ol', { class: 'fr-bias' },
      h('li', { class: 'fr-bh', 'aria-hidden': 'true' }, h('span', { text: '話' }), h('span', { text: 'バイアス度（0〜100）' })),
      list.map((x) => h('li', null, h('button', { type: 'button', class: 'fr-row fr-br', 'aria-label': `${cleanTitle(x.title)}、バイアス度 ${x.score}`, on: { click: () => o.detail(x.key) } },
        h('span', { class: 'fr-bt', text: cleanTitle(x.title) }),
        h('span', { class: 'fr-bm', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.max(0, Math.min(100, x.score))}%` })),
        h('b', { class: 'num', text: String(x.score) })))))
      : h('p', { class: 'fr-empty', text: '偏りを測れる話はまだありません。' });
  } else {
    title = o.field ? `日本と海外の差・${o.field}` : '日本と海外の差';
    const g = o.gap || { rows: [] };
    body = g.rows.length ? h('div', { class: g.rows.some((r) => r.key) ? 'fr-gap ev' : 'fr-gap', role: 'img', 'aria-label': g.rows.map((r) => `${r.field} 国内 ${r.jp} 件、海外 ${r.intl} 件`).join('。') },
      h('p', { class: 'fr-ax', 'aria-hidden': 'true' }, h('span'), h('span', { class: 'fr-axm' }, h('span', { text: '◀ 国内が多い' }), h('span', { text: '海外が多い ▶' })), h('span')),
      g.rows.map((r) => h('div', { class: 'fr-gr', data: { lean: r.d < 0 ? 'jp' : r.d > 0 ? 'intl' : 'even' } },
        r.key ? h('button', { type: 'button', class: 'fr-gl ev', title: cleanTitle(r.field), on: { click: () => o.pick(r.key) } }, cleanTitle(r.field)) : h('span', { class: 'fr-gl', text: r.field }),
        h('span', { class: 'fr-gb', 'aria-hidden': 'true' }, h('i', { data: { side: r.d < 0 ? 'jp' : 'intl' }, style: `--w:${(Math.abs(r.d) * 50).toFixed(1)}%` })),
        h('span', { class: 'fr-gn num', text: `国内 ${r.jp} 件 ・ 海外 ${r.intl} 件` }))))
      : h('p', { class: 'fr-empty', text: '日本と海外を比べられる話は今ありません。' });
    den = g.rows.length ? `記事 ${(g.jp + g.intl).toLocaleString('ja-JP')} 件` : '';
  }
  const foot = h('p', { class: 'fr-foot' }, den ? h('span', { class: 'num', text: den }) : null, stamp(h, o.gen, o.now, o.clock, o.short));
  root.replaceChildren(h('header', { class: 'fr-h' }, h('h2', { id: 'gap-h', text: title })), body, foot);
  root.setAttribute('aria-labelledby', 'gap-h');
}

/** the newspapers side by side. o = { h, paper: paperOf(m), clock, span(sec), outlet(it), safeUrl, icon(side) } */
export function renderPaper(o) {
  const { h, paper } = o;
  if (!paper || !paper.cols.length) return null;
  const cols = paper.cols;
  const cell = (c, k) => {
    if (c.few && k !== 'first' && k !== 'heads') return h('p', { class: 'pp-few', text: `記事 ${c.n} 件` });
    if (k === 'words') return c.words.length ? h('ul', { class: 'pp-ws' }, c.words.map((x) => h('li', null, x.w, h('small', { class: 'num', text: x.n })))) : h('p', { class: 'pp-none', text: '—' });
    if (k === 'nums') return c.nums.length ? h('ul', { class: 'pp-ns' }, c.nums.map((x) => h('li', { class: x.only ? 'only' : null, title: x.only ? 'ほかの側の見出しに無い数字' : null }, x.text))) : h('p', { class: 'pp-none', text: '見出しに数字はありません' });
    if (k === 'tone') {
      const t = c.tone, n = t.nNeg + t.nPos;
      if (!n) return h('p', { class: 'pp-none', text: '見出しに反応の語はありません' });
      if (n < TONE_MIN) return h('p', { class: 'pp-none pp-few-w', text: [...t.neg, ...t.pos].map((x) => `${x.w} ${x.n}`).join('・') });
      return h('div', { class: 'pp-tone' },
        h('span', { class: 'pp-tb', role: 'img', 'aria-label': `否定の側の語 ${t.nNeg}、肯定の側の語 ${t.nPos}` },
          h('i', { class: 'neg', style: `--w:${((t.nNeg / n) * 50).toFixed(1)}%` }), h('i', { class: 'pos', style: `--w:${((t.nPos / n) * 50).toFixed(1)}%` })),
        h('span', { class: 'pp-tl' }, h('span', null, t.neg.slice(0, 3).map((x) => `${x.w} ${x.n}`).join('・') || '—'), h('span', null, t.pos.slice(0, 3).map((x) => `${x.w} ${x.n}`).join('・') || '—')),
        h('small', { class: 'pp-tn', text: '見出しの語の数' }));
    }
    if (k === 'first') return h('p', { class: 'pp-first' }, h('b', { class: 'num', text: c.first != null ? o.clock(c.first) : '—' }), c.ahead ? h('span', { class: 'pp-ahead', text: `（${o.span(c.ahead)} 先）` }) : null);
    return h('ol', { class: 'pp-hs' }, c.heads.map((it) => { const link = o.safeUrl ? o.safeUrl(it.link) : null; return h('li', null,
      h('span', { class: 'pp-ho' }, h('b', { text: o.outlet(it) || '—' }), isNum(it.ts) ? h('span', { class: 'num', text: o.clock(it.ts) }) : null),
      link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', lang: it.lang === 'en' ? 'en' : null, text: str(it.title) || '—' }) : h('span', { lang: it.lang === 'en' ? 'en' : null, text: str(it.title) || '—' })); }));
  };
  const ROWS = [['words', '注目した語'], ['nums', '出てきた数字'], ['tone', '反応の語'], ['first', '報じ始め'], ['heads', '見出し']];
  // the words of Japan and abroad in one figure across both columns: a word both sides used sits in the middle with a bar to each side
  // a row empty on every side is one line across the columns, not the same line twice
  const none = (k) => (cols.length < 2 || cols.some((c) => c.few) ? ''
    : k === 'nums' && cols.every((c) => !c.nums.length) ? 'どちらの見出しにも数字はありません'
      : k === 'tone' && cols.every((c) => !(c.tone.nNeg + c.tone.nPos)) ? 'どちらの見出しにも反応の語はありません' : '');
  const wb = wordBars(paper);
  const wide = wb.length ? h('div', { class: 'pp-c pp-wide', role: 'cell', 'aria-label': wb.map((r) => `${r.w} 国内 ${r.jp}・海外 ${r.intl}`).join('、') },
    h('p', { class: 'pp-wax', 'aria-hidden': 'true' }, h('span', { text: '◀ 日本の見出し' }), h('span'), h('span', { text: '海外の見出し ▶' })),
    wb.map((r) => h('div', { class: 'pp-wr' + (r.jp && r.intl ? ' both' : ''), 'aria-hidden': 'true' },
      h('span', { class: 'pp-wn num', text: r.jp || '' }), h('span', { class: 'pp-wb jp', data: { side: 'jp' } }, h('i', { style: `--w:${((r.jp / wb.max) * 100).toFixed(1)}%` })),
      h('span', { class: 'pp-ww', text: r.w }),
      h('span', { class: 'pp-wb intl', data: { side: 'intl' } }, h('i', { style: `--w:${((r.intl / wb.max) * 100).toFixed(1)}%` })), h('span', { class: 'pp-wn num', text: r.intl || '' }))),
    h('small', { class: 'pp-tn', text: '見出しに出た回数' })) : null;
  return h('div', { class: 'pp', style: `--n:${cols.length}`, role: 'table', 'aria-label': '同じニュースの伝え方' },
    h('div', { class: 'pp-r pp-hd', role: 'row' }, h('span', { class: 'pp-k', role: 'columnheader' }), cols.map((c) => h('span', { class: 'pp-c', role: 'columnheader', data: { side: c.side } },
      o.icon ? o.icon(c.side) : null, h('span', { text: SIDE_COL[c.side] }), h('b', { class: 'num', text: c.outlets }), h('span', { class: 'pp-u', text: '社' })))),
    ROWS.map(([k, ja]) => h('div', { class: 'pp-r', role: 'row', data: { row: k } }, h('span', { class: 'pp-k', role: 'rowheader', text: ja }),
      k === 'words' && wide ? wide : none(k) ? h('div', { class: 'pp-c pp-wide', role: 'cell' }, h('p', { class: 'pp-none', text: none(k) }))
        : cols.map((c) => h('div', { class: 'pp-c', role: 'cell', data: { side: c.side }, 'aria-label': SIDE_JA[c.side] }, cell(c, k))))));
}

/** the rows of the figure of words: a word both sides used first (by its total), then Japan's own, then abroad's own; at most 8.
 *  [] unless both Japan and abroad have a column with words. rows.max = the largest count, the bars' full length */
export function wordBars(paper) {
  const cols = paper && Array.isArray(paper.cols) ? paper.cols : [];
  const jp = cols.find((c) => c.side === 'jp'), intl = cols.find((c) => c.side === 'intl');
  if (!jp || !intl || jp.few || intl.few || (!arr(jp.words).length && !arr(intl.words).length)) return [];
  // the words shown: each side's top words; their counts: from each side's whole list (a word low on one side still counts there)
  const count = (c, w) => { const x = arr(c.wordsAll || c.words).find((y) => y && y.w === w), lw = w.toLowerCase(); return Math.max(x && isNum(x.n) ? x.n : 0, arr(c.titles).filter((t) => str(t).toLowerCase().includes(lw)).length); };
  const shown = [...new Set([...arr(jp.words), ...arr(intl.words)].map((x) => x && str(x.w)).filter(Boolean))];
  const rows = shown.map((w) => ({ w, jp: count(jp, w), intl: count(intl, w) })).filter((r) => r.jp + r.intl > 0);
  const rank = (r) => (r.jp && r.intl ? 0 : r.jp ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || (b.jp + b.intl) - (a.jp + a.intl));
  const out = rows.slice(0, 8);
  out.max = Math.max(1, ...out.map((r) => Math.max(r.jp, r.intl)));
  return out;
}
