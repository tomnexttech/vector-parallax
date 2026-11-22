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

import { HEAD } from './heads.js';
import { leadLine } from './coverage.js';
import { trOf, trMark } from './trans.js';

// the ways in are short nouns from the one table of headings (js/heads.js, docs/copy-canon.md)
export const FRONT_TABS = [['gap', HEAD['front.gap']], ['jp', HEAD['front.jp']], ['intl', HEAD['front.intl']], ['bias', HEAD['front.bias']]];
export const TONE_NEG = ['抗議', '反発', '批判', '非難', '反対', '懸念', '憂慮', '反論', '警告', '不満', '怒り', '追及', '否定', '拒否'];
export const TONE_POS = ['歓迎', '支持'];
export const TONE_NEG_EN = ['condemn', 'criticis', 'criticiz', 'protest', 'warned', 'concern', 'denied', 'rejected'];
export const TONE_POS_EN = ['welcomed'];
export const TONE_MIN = 3;
export const PAPER_HEADS = 5;
export const PAPER_MIN = 2;
export const STALE_S = 12 * 3600;
/** a collection is due every 8 hours (the actual run of GitHub's schedule, js/snapshot.js DUE_S): a value older than this is amber, older than STALE_S red */
export const AGING_S = 8 * 3600;

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

/** the three weights of a count in the table of the fields (Cantina's table of three levels): the larger side of the row is bold (hi); the smaller one is
 *  mid when it is at least 40% of the larger one, and dim when it is less. A tie is hi on both sides. Only the two counts decide it. */
export function tierOf(n, other) {
  if (n >= other) return ' hi';
  return other > 0 && n / other >= 0.4 ? ' mid' : '';
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
    const names = [...new Set(list.map(outletOf).filter(Boolean))];
    return { side: k, n: list.length, outlets: names.length, names, few: list.length < PAPER_MIN, words: k === 'gov' ? [] : arr(words[k]).slice(0, 5), wordsAll: k === 'gov' ? [] : arr(words[k]), titles, nums: numbersOf(titles), tone: toneOf(titles),
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
const SIDE_COL = { jp: HEAD['paper.jp'], intl: HEAD['paper.intl'], gov: HEAD['paper.gov'] };

/** the reaction words of one side as a bar that swings from the middle: the words of 否定 to the left, of 肯定 to the right, each as
 *  long as its count over the largest count of any side (so the sides compare). Counted words only; nothing is judged */
export function toneBar(h, t, max) {
  const m = Math.max(1, max || 0), w = (n) => `--w:${((n / m) * 100).toFixed(1)}%`;
  return h('div', { class: 'pp-tone2' },
    h('div', { class: 'pp-tsw', role: 'img', 'aria-label': `否定の語 ${t.nNeg}、肯定の語 ${t.nPos}` },
      h('b', { class: 'num neg', text: String(t.nNeg) }),
      h('span', { class: 'pp-th neg', 'aria-hidden': 'true' }, h('i', { style: w(t.nNeg) })),
      h('span', { class: 'pp-th pos', 'aria-hidden': 'true' }, h('i', { style: w(t.nPos) })),
      h('b', { class: 'num pos', text: String(t.nPos) })),
    h('p', { class: 'pp-tk', 'aria-hidden': 'true' }, h('span', { text: '否定' }), h('span', { text: '肯定' })),
    h('p', { class: 'pp-tw' }, h('span', { text: t.neg.slice(0, 3).map((x) => `${x.w} ${x.n}`).join('・') || '—' }), h('span', { text: t.pos.slice(0, 3).map((x) => `${x.w} ${x.n}`).join('・') || '—' })),
    h('small', { class: 'pp-tn', text: '見出しの語の数' }));
}

/** the value's own time, red when old (docs: data-freshness) */
function stamp(h, gen, now, clock, short) {
  if (!isNum(gen)) return h('span', { class: 'fr-at stale', text: '未取得' });
  const old = isNum(now) && now - gen > STALE_S, aging = !old && isNum(now) && now - gen > AGING_S;
  return h('time', { class: 'fr-at num' + (old ? ' stale' : aging ? ' aging' : ''), text: `${old && short ? short(gen) : clock(gen)} の値`,
    title: aging || old ? `次の収集が遅れています。定時実行は GitHub の都合で遅れる事があり、直近の実績は 4〜13 時間おきです` : null });   // an old value carries its date
}

/** a tab's number: a string, or parts [{ k: '国内', v: '30%', side: 'jp' }] whose figure carries the side's colour */
function countEl(h, c) {
  if (!Array.isArray(c)) return h('b', { class: 'fr-v num', text: c });
  return h('span', { class: 'fr-v' }, c.map((x) => h('span', { class: 'fr-vp', data: x.side ? { side: x.side } : null }, x.k ? h('span', { class: 'k', text: x.k }) : null, h('b', { class: 'num', text: x.v }), x.u ? h('span', { class: 'u', text: x.u }) : null)));
}

/** o = { h, tab, field, fields, counts: { gap: '国内 62%' | parts, one: …, bias: … }, onTab(id), onField(f|null) } */
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
    on: { click: () => o.onTab(id), keydown: key } }, h('span', { class: 'fr-kk' }, h('span', { class: 'fr-k', text: ja }), o.subs && o.subs[id] ? h('small', { class: 'fr-sub', text: o.subs[id] }) : null),
    o.counts && o.counts[id] && o.counts[id].length ? countEl(h, o.counts[id]) : null)));
  // the fields: the same round icons and short names as the list of 詳しく見る (js/genres.js genreBar, built by the page and passed in as chipsEl); the plain chips only without a page
  const chips = o.chipsEl ? h('div', { class: 'fr-chips' }, o.chipsEl) : h('div', { class: 'fr-chips', role: 'group', 'aria-label': '分野' },
    h('button', { type: 'button', class: 'fr-chip', 'aria-pressed': String(!o.field), on: { click: () => o.onField(null) } }, 'すべて'),
    arr(o.fields).map((f) => h('button', { type: 'button', class: 'fr-chip', 'aria-pressed': String(o.field === f), on: { click: () => o.onField(f) } }, f)));
  root.replaceChildren(tabs, chips);
}

/** a row of the list of one side: the headline in the page's language first. A translation (the AI's) carries 訳 and the published
 *  headline under it in the smallest step; a headline left in English carries 英語 (docs/design-1115b.md §5) */
function headRow(h, o, e) {
  const hd = o.headOf ? o.headOf(e) : { text: o.titleOf(e) };
  return h('button', { type: 'button', class: 'fr-row' + (hd.mark ? ' fr-hd' : ''), on: { click: () => o.pick(e.key) } },
    hd.mark ? h('span', { class: 'fr-mk', text: hd.mark }) : null,
    h('span', { class: 'fr-rt', lang: hd.lang || null, text: cleanTitle(hd.text) }),
    hd.orig ? h('small', { class: 'fr-orig', lang: hd.origLang || null, text: cleanTitle(hd.orig) }) : null,
    // under the headline: how many outlets carried it and when the first one did (counted values of the event, nothing written)
    isNum(e.n) && e.n > 0 ? h('span', { class: 'fr-rm' }, h('span', { class: 'num' }, h('b', { text: e.n }), ' 社'),
      isNum(e.first) && typeof o.short === 'function' ? h('time', { class: 'num', text: o.short(e.first) }) : null) : null);
}

/** the panel under the card. o = { h, tab, field, gap, one: [{ side, ja, events }], bias: [{ key, title, score }], gen, now, clock,
 *  titleOf(e), pick(key), detail(key) } */
export function renderGap(root, o) {
  if (!root) return;
  const { h } = o;
  let title = '', body = null, den = '', tot = null;
  if (o.tab === 'jp' || o.tab === 'intl') {
    // one side's own news: the stories only that side's outlets carried, most outlets first
    title = HEAD[`front.${o.tab}`];
    const g = arr(o.one).find((x) => x.side === o.tab) || { events: [] };
    const shown = Math.min(12, g.events.length);
    den = g.events.length ? (g.events.length > shown ? `上位 ${shown} / ${g.events.length} 件` : `${g.events.length} 件`) : '';
    body = g.events.length ? h('div', { class: 'fr-one', data: { side: o.tab } }, h('ul', null, g.events.slice(0, 12).map((e) => h('li', null, headRow(h, o, e)))))
      : h('p', { class: 'fr-empty', text: o.field ? `${o.field}では 0 件です。分野を「すべて」に戻すと出ることがあります。` : '今は 0 件です。' });
  } else if (o.tab === 'bias') {
    title = HEAD['front.bias'];
    const list = arr(o.bias), ap = o.apart || { jp: 0, intl: 0 };
    body = list.length ? h('ol', { class: 'fr-bias' },
      h('li', { class: 'fr-bh', 'aria-hidden': 'true' }, h('span', { text: HEAD['panel.topic'] }), h('span', { text: HEAD['panel.score'] })),
      list.map((x) => h('li', null, h('button', { type: 'button', class: 'fr-row fr-br', 'aria-label': `${cleanTitle(x.title)}、偏り度 ${x.score}`, on: { click: () => o.detail(x.key) } },
        h('span', { class: 'fr-bt', text: cleanTitle(x.title) }),
        h('span', { class: 'fr-bm', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.max(0, Math.min(100, x.score))}%` })),
        h('b', { class: 'num', text: String(x.score) })))))
      : h('p', { class: 'fr-empty', text: '偏りを測れる話はまだありません。' });
    // the scale as a key under the list: where 0 and 100 stand, and what was left out of the order (a story one side carried alone has nothing to set against)
    const scale = list.length ? h('p', { class: 'fr-key', 'aria-hidden': 'true' }, h('span', { text: '0 ＝ 集めた媒体の構成どおり' }), h('span', { text: '100 ＝ 構成から大きく外れる' })) : null;
    const apart = ap.jp + ap.intl ? h('div', { class: 'fr-apart' }, h('span', { class: 'fr-al', text: '順位の外・片側だけの話' }),
      ap.jp ? h('button', { type: 'button', class: 'fr-ab', data: { side: 'jp' }, on: { click: () => o.onTab && o.onTab('jp') } }, h('span', { text: '日本独自' }), h('b', { class: 'num', text: String(ap.jp) }), h('span', { class: 'u', text: '件' })) : null,
      ap.intl ? h('button', { type: 'button', class: 'fr-ab', data: { side: 'intl' }, on: { click: () => o.onTab && o.onTab('intl') } }, h('span', { text: '海外独自' }), h('b', { class: 'num', text: String(ap.intl) }), h('span', { class: 'u', text: '件' })) : null) : null;
    den = list.length ? ((o.scored || list.length) > list.length ? `上位 ${list.length} / ${o.scored} 話を測定` : `${list.length} 話を測定`) : '';
    tot = h('div', { class: 'fr-bx' }, scale, apart);
  } else {
    title = o.field ? HEAD['panel.events'] : HEAD['panel.fields'];
    const g = o.gap || { rows: [] };
    body = g.rows.length ? h('div', { class: g.rows.some((r) => r.key) ? 'fr-gap ev' : 'fr-gap', role: 'img', 'aria-label': g.rows.map((r) => `${r.field} 国内 ${r.jp} 件、海外 ${r.intl} 件`).join('。') },
      h('p', { class: 'fr-ax', 'aria-hidden': 'true' }, h('span'), h('span', { class: 'fr-axm' }, h('span', { data: { side: 'jp' }, text: '国内寄り' }), h('span', { data: { side: 'intl' }, text: '海外寄り' })), h('span', { class: 'fr-nh', text: '国内' }), h('span', { class: 'fr-nh', text: '海外' })),
      g.rows.map((r) => h('div', { class: 'fr-gr', data: { lean: r.d < 0 ? 'jp' : r.d > 0 ? 'intl' : 'even' } },
        r.key ? h('button', { type: 'button', class: 'fr-gl ev', title: cleanTitle(r.field), on: { click: () => o.pick(r.key) } }, cleanTitle(r.field)) : typeof o.onField === 'function' && !o.field ? h('button', { type: 'button', class: 'fr-gl fld', title: `${r.field}の話を見る`, on: { click: () => o.onField(r.field) } }, r.field) : h('span', { class: 'fr-gl', text: r.field }),
        h('span', { class: 'fr-gb', 'aria-hidden': 'true' }, h('i', { data: { side: r.d < 0 ? 'jp' : 'intl' }, style: `--w:${(Math.abs(r.d) * 50).toFixed(1)}%` })),
        h('span', { class: 'fr-gn num' + tierOf(r.jp, r.intl), text: String(r.jp) }), h('span', { class: 'fr-gn num' + tierOf(r.intl, r.jp), text: String(r.intl) }))))
      : h('p', { class: 'fr-empty', text: '日本と海外を比べられる話は今ありません。' });
    den = g.rows.length ? `${o.field ? `上位 ${g.rows.length} 話の記事` : '分野が付いた話の記事'} ${(g.jp + g.intl).toLocaleString('ja-JP')} 件` : '';
    // the share over all the rows: one bar of the two sides under the table
    const sh = jpShare(g);
    if (sh != null) tot = h('div', { class: 'fr-tot', role: 'img', 'aria-label': `国内 ${sh}%、海外 ${100 - sh}%` },
      h('p', { class: 'fr-tl', 'aria-hidden': 'true' }, h('span', { data: { side: 'jp' } }, h('span', { class: 'k', text: '国内' }), h('b', { class: 'num', text: `${sh}%` })),
        h('span', { class: 'fr-tm', text: o.field || '全分野' }), h('span', { data: { side: 'intl' } }, h('span', { class: 'k', text: '海外' }), h('b', { class: 'num', text: `${100 - sh}%` }))),
      h('span', { class: 'fr-tb', 'aria-hidden': 'true' }, h('i', { data: { side: 'jp' }, style: `width:${sh}%` }), h('i', { data: { side: 'intl' }, style: `width:${100 - sh}%` })));
  }
  const foot = h('p', { class: 'fr-foot' }, den ? h('span', { class: 'num', text: den }) : null, stamp(h, o.gen, o.now, o.clock, o.short));
  root.replaceChildren(h('header', { class: 'fr-h' }, h('h2', { id: 'gap-h', text: title })), body, tot, foot);
  root.setAttribute('aria-labelledby', 'gap-h');
}

/** the newspapers side by side. o = { h, paper: paperOf(m), clock, span(sec), outlet(it), safeUrl, icon(side) } */
export function renderPaper(o) {
  const { h, paper } = o;
  if (!paper || !paper.cols.length) return null;
  const cols = paper.cols;
  const tmax = Math.max(0, ...cols.map((c) => Math.max(c.tone.nNeg, c.tone.nPos)));
  const nameEl = (name) => (o.openOutlet && name !== '—' ? h('button', { type: 'button', class: 'pp-om', title: '媒体の特徴', on: { click: () => o.openOutlet(name) } }, name) : h('b', { text: name }));
  const outletEl = (it) => nameEl(o.outlet(it) || '—');
  // the reports of the two sides may fall on two days: then every time carries its date (00:59 beside 18:32 alone reads the wrong way round)
  const when = o.when || o.clock;
  const tsAll = cols.flatMap((c) => [c.first, ...c.heads.map((it) => it.ts)]).filter(isNum);
  const day = (ts) => String(when(ts)).split(' ')[0];
  const clockOf = tsAll.length && new Set(tsAll.map(day)).size > 1 && o.when ? o.when : o.clock;
  const cell = (c, k) => {
    if (c.few && k !== 'first' && k !== 'heads') return h('p', { class: 'pp-few', text: `記事 ${c.n} 件` });
    if (k === 'words') return c.words.length ? h('ul', { class: 'pp-ws' }, c.words.map((x) => h('li', null, x.w, h('small', { class: 'num', text: x.n })))) : h('p', { class: 'pp-none', text: '—' });
    if (k === 'nums') return c.nums.length ? h('ul', { class: 'pp-ns' }, c.nums.map((x) => h('li', { class: x.only ? 'only' : null, title: x.only ? 'ほかの側の見出しに無い数字' : null }, x.text))) : h('p', { class: 'pp-none', text: '見出しに数字はありません' });
    if (k === 'tone') {
      const t = c.tone, n = t.nNeg + t.nPos;
      if (!n) return h('p', { class: 'pp-none', text: '反応語なし' });
      if (n < TONE_MIN) return h('p', { class: 'pp-none pp-few-w', text: [...t.neg, ...t.pos].map((x) => `${x.w} ${x.n}`).join('・') });
      return toneBar(h, t, tmax);
    }
    if (k === 'first') return h('p', { class: 'pp-first' }, h('b', { class: 'num', text: c.first != null ? clockOf(c.first) : '—' }), c.ahead ? h('span', { class: 'pp-ahead', text: leadLine(SIDE_JA[c.side], o.span(c.ahead)) }) : null);
    const seen = new Set(c.heads.map((it) => o.outlet(it)).filter(Boolean)), rest = arr(c.names).filter((x) => !seen.has(x));
    const restEl = rest.length ? h('p', { class: 'pp-rest' }, h('span', { class: 'k num', text: `ほか ${rest.length} 社` }), ...rest.flatMap((x, i) => [i ? '・' : '', nameEl(x)])) : null;
    return h('div', { class: 'pp-hw' }, h('ol', { class: 'pp-hs' }, c.heads.map((it) => { const link = o.safeUrl ? o.safeUrl(it.link) : null; return h('li', null,
      h('span', { class: 'pp-ho' }, outletEl(it), isNum(it.ts) ? h('span', { class: 'num', text: clockOf(it.ts) }) : null),
      ((tt) => (link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', lang: tt.lang, title: tt.tr ? `原文: ${tt.orig}` : null }, trMark(h, tt), tt.text || '—') : h('span', { lang: tt.lang }, trMark(h, tt), tt.text || '—')))(trOf(it))); })), restEl);
  };
  const ROWS = ['words', 'nums', 'tone', 'first', 'heads'].map((k) => [k, HEAD[`paper.${k}`]]);
  // the row 初報 counts every outlet of the story (媒体比較 on 詳しく見る counts the outlets it compared: 照合 6 社); each says which
  const nAll = new Set(cols.flatMap((c) => arr(c.names))).size;
  // the words of Japan and abroad in one figure across both columns: a word both sides used sits in the middle with a bar to each side
  // a row empty on every side is one line across the columns, not the same line twice
  const none = (k) => (cols.length < 2 || cols.some((c) => c.few) ? ''
    : k === 'nums' && cols.every((c) => !c.nums.length) ? 'どちらの見出しにも数字はありません'
      : k === 'tone' && cols.every((c) => !(c.tone.nNeg + c.tone.nPos)) ? 'どちらの見出しにも反応語なし' : '');
  const wb = wordBars(paper);
  const wide = wb.length ? h('div', { class: 'pp-c pp-wide', role: 'cell', 'aria-label': wb.map((r) => `${r.w} 国内 ${r.jp}・海外 ${r.intl}`).join('、') },
    h('p', { class: 'pp-wax', 'aria-hidden': 'true' }, h('span', { text: '◀ 国内見出し' }), h('span'), h('span', { text: '海外見出し ▶' })),
    wb.map((r) => h('div', { class: 'pp-wr' + (r.jp && r.intl ? ' both' : ''), 'aria-hidden': 'true' },
      h('span', { class: 'pp-wn num', text: r.jp || '' }), h('span', { class: 'pp-wb jp', data: { side: 'jp' } }, h('i', { style: `--w:${((r.jp / wb.max) * 100).toFixed(1)}%` })),
      h('span', { class: 'pp-ww', text: r.w }),
      h('span', { class: 'pp-wb intl', data: { side: 'intl' } }, h('i', { style: `--w:${((r.intl / wb.max) * 100).toFixed(1)}%` })), h('span', { class: 'pp-wn num', text: r.intl || '' }))),
    h('small', { class: 'pp-tn', text: '見出しに出た回数' })) : null;
  return h('div', { class: 'pp', style: `--n:${cols.length}`, role: 'table', 'aria-label': '同じニュースの伝え方' },
    h('div', { class: 'pp-r pp-hd', role: 'row' }, h('span', { class: 'pp-k', role: 'columnheader' }), cols.map((c) => h('span', { class: 'pp-c', role: 'columnheader', data: { side: c.side } },
      o.icon ? o.icon(c.side) : null, h('span', { text: SIDE_COL[c.side] }), h('b', { class: 'num', text: c.outlets }), h('span', { class: 'pp-u', text: '社' })))),
    ROWS.map(([k, ja]) => h('div', { class: 'pp-r', role: 'row', data: { row: k } }, h('span', { class: 'pp-k', role: 'rowheader' }, ja, k === 'first' && nAll ? h('small', { class: 'pp-sc num', text: `全 ${nAll} 社` }) : null),
      k === 'words' && wide ? wide : none(k) ? h('div', { class: 'pp-c pp-wide', role: 'cell' }, h('p', { class: 'pp-none', text: none(k) }))
        : cols.map((c) => h('div', { class: 'pp-c', role: 'cell', data: { side: c.side }, 'aria-label': SIDE_JA[c.side] }, cell(c, k))))));
}

/** words that name one thing in two languages (data/aliases.json: groups and words) stand in one row of the figure: set once, when the table is read */
let WORD_GROUPS = [];
export function setWordGroups(g) { WORD_GROUPS = arr(g).filter((x) => Array.isArray(x) && x.length >= 2).map((x) => x.map((w) => str(w)).filter(Boolean)); }
const wkey = (w) => str(w).normalize('NFKC').toLowerCase().replace(/['’]s$/, '');   // SpaceX's is SpaceX

/** the rows of the figure of words: a word both sides used first (by its total), then Japan's own, then abroad's own; at most 8.
 *  A word and the same word in the other language (スターシップ / Starship) are one row, counted over every form.
 *  [] unless both Japan and abroad have a column with words. rows.max = the largest count, the bars' full length */
export function wordBars(paper, groups = WORD_GROUPS) {
  const cols = paper && Array.isArray(paper.cols) ? paper.cols : [];
  const jp = cols.find((c) => c.side === 'jp'), intl = cols.find((c) => c.side === 'intl');
  if (!jp || !intl || jp.few || intl.few || (!arr(jp.words).length && !arr(intl.words).length)) return [];
  // the table's order first, so the row is named as the table names it (スペースX, not the shorter スペース the headlines also use)
  const formsOf = (w) => { const k = wkey(w), g = groups.find((x) => x.some((y) => wkey(y) === k)); return g ? [...new Set([...g, w])] : [w]; };
  // the words shown: each side's top words; their counts: from each side's whole list (a word low on one side still counts there)
  const count = (c, forms) => {
    const lws = forms.map((f) => f.toLowerCase());
    const byList = Math.max(0, ...forms.map((f) => { const x = arr(c.wordsAll || c.words).find((y) => y && y.w === f); return x && isNum(x.n) ? x.n : 0; }));
    return Math.max(byList, arr(c.titles).filter((t) => lws.some((lw) => str(t).toLowerCase().includes(lw))).length);
  };
  const seen = new Set(), rows = [];
  for (const w of [...new Set([...arr(jp.words), ...arr(intl.words)].map((x) => x && str(x.w)).filter(Boolean))]) {
    const forms = formsOf(w), id = forms.map(wkey).sort()[0];
    if (seen.has(id)) continue;
    seen.add(id);
    // the form on the row is the page's language when the group has one (the Japanese page: the Japanese form; the English page: the Latin one)
    const en = typeof document !== 'undefined' && document.documentElement && document.documentElement.lang === 'en';
    const ja = (f) => /[぀-ヿ一-鿿]/.test(f);
    const label = forms.find((f) => (en ? !ja(f) : ja(f))) || w;
    rows.push({ w: label, jp: count(jp, forms), intl: count(intl, forms) });
  }
  const live = rows.filter((r) => r.jp + r.intl > 0);
  const rank = (r) => (r.jp && r.intl ? 0 : r.jp ? 1 : 2);
  live.sort((a, b) => rank(a) - rank(b) || (b.jp + b.intl) - (a.jp + a.intl));
  const out = live.slice(0, 8);
  out.max = Math.max(1, ...out.map((r) => Math.max(r.jp, r.intl)));
  return out;
}
