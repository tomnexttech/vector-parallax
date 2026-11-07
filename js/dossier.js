/* dossier — one event as a sheaf of small cards, in the order of the maker's earlier board: how many reports came from Japan, from
 * abroad and from the ministries (the same three sides as the simple view, js/entry.js), of which kinds of media (DATA SOURCE), how they
 * ran from the first report on (COVERAGE HEAT, the lanes app.js draws), and the two short versions with the words each side's headlines used.
 * Only what can be counted on the page's own headlines. No left or right on any outlet, nothing about truth, nothing from an article's
 * body. The AI's lines keep the AI mark; without them the words come by the rule of parallax/keyterms.py. Each kind of information has its
 * own form: a share a ring, the run of time an area on a time axis, Japan against abroad bars that swing left and right, which outlet used
 * which word a matrix of dots, the index of js/bias.js a half gauge. A figure whose data is not there is left out.
 *
 *   measure(e, { order })                    -> { n, jp, intl, gov, types, first, firstOf, lag, words }   from sides(e)
 *   headlineWords(items, { exclude, limit }) -> [{ w, n }]  the words of these headlines, most used first
 *   compareWords(jp, intl)                   -> the same two lists with `both` on a word found on both sides
 *   sideLines(list, words, angleOf)          -> { ai, words, first }  one side's short line: the AI's focus if it wrote one, else the words
 *   wordsOfTitle(title, exclude)             -> [{ name, shown, ... }]  the words of one headline
 *   runOf(m)                                 -> [{ ts, it, jp, intl, gov }]  the reports adding up along the time
 *   divergeRows(m)                           -> [{ w, jp, intl, both }]  words with a count on each side (empty when a side has no report)
 *   wordMatrix(m)                            -> { outlets, words, has(outlet, word) } | null  which outlet used which word
 *   paperPick(members, headingText)          -> the report the white paper shows: another headline than the title, by the order of the earlier board
 *   createDossier({ h, s, extLink, safeUrl, fmtClock, fmtSpan, lineIcon }) -> { tile, go, ratioBar, homeTile, typeTile, timeTile, sides, paper }
 */
import { placeJa, placesIn } from './places.js';
import { sides as sidesOf, SIDES } from './entry.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');
const outletOf = (it) => str(it.media) || str(it.outlet);

// the words that say nothing about a story: the same lists as parallax/keyterms.py (CONTRACT 18.11), with the commonest English
const STOP_JA = new Set(['政府', '日本', '発表', '明らか', '方針', '検討', '開始', '速報', '独自', '詳報', '続報', '動画', '写真', '画像', '更新', '解説', '社説', '告示', '公表', '掲載',
  '実施', '決定', '一部', '改正', '公示', '通知', '開催', '記事', '概況', '全文', '要旨', '法規的告示', '官庁報告', '人事異動', '国会事項', '政府調達', '省令', '政令', '結果',
  '今日', '以来', '来月', '今月', '今年', '昨年', '前年', '最後', '一方', '全力', '報道', 'ニュース']);
const STOP_EN = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'as', 'in', 'on', 'of', 'for', 'to', 'with', 'by', 'at', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'after', 'over', 'amid', 'into', 'its', 'it',
  'this', 'that', 'these', 'those', 'why', 'how', 'what', 'who', 'when', 'where', 'will', 'would', 'could', 'should', 'may', 'can', 'says', 'say', 'said', 'new', 'not', 'if', 'than', 'up', 'out', 'off', 'here', 'there',
  'just', 'more', 'most', 'some', 'all', 'now', 'our', 'your', 'their', 'his', 'her', 'we', 'you', 'they', 'he', 'she', 'mr', 'ms', 'mrs', 'dr', 'gov', 'sen', 'rep', 'jr', 'sr', 'report', 'reports', 'exclusive',
  'opinion', 'analysis', 'live', 'update', 'updates', 'breaking', 'watch', 'video', 'photos', 'news', 'every', 'each', 'against', 'about', 'before', 'between', 'despite', 'during', 'under', 'without', 'through',
  'has', 'have', 'had', 'below', 'above', 'still', 'many', 'much', 'one', 'two', 'three', 'first', 'last', 'next', 'top', 'big', 'key', 'major', 'then', 'them', 'while', 'back', 'down', 'get', 'gets', 'make', 'makes', 'take', 'takes', 'fall', 'falls', 'rise', 'rises']);
const PARTICLE = /^(?:の|が|を|に|へ|で|と|は|も|や|か|から|まで|より|など|ら)/;
const TOKEN = /[一-鿿々ァ-ヺー]{2,}|[A-Za-z][A-Za-z0-9&'’.-]*[A-Za-z0-9]/g;

function tokens(title) {
  // the trailing outlet name or bracket is not part of the headline's words
  const t = str(title).replace(/[【［\[][^】］\]]*[】］\]]\s*$/, '').replace(/\s[-|｜]\s[^-|｜]+$/, '');
  const out = [];
  for (const m of t.matchAll(TOKEN)) {
    let w = m[0];
    const after = t.slice(m.index + w.length);
    // a run is cut before okurigana: 中間選挙受け -> 中間選挙, 狙う -> nothing
    if (/[一-鿿々]$/.test(w) && /^[ぁ-ん]/.test(after) && !PARTICLE.test(after)) {
      w = w.slice(0, -1);
      if (w.length < 2) continue;
    }
    if (/^[ァ-ヺー]{2}$/.test(w)) continue;   // two katakana alone are rarely a word
    const start = m.index === 0 || /[\s「『（(【\-:：]$/.test(t.slice(0, m.index));
    out.push({ w, start });
  }
  return out;
}

/** the words of one headline. An English word that names a place takes its Japanese name, and a Japanese word that holds a place gives the place as a word of its own, so both sides meet on it */
export function wordsOfTitle(title, exclude = []) {
  const skip = exclude.map((s) => str(s).toLowerCase()).filter(Boolean);
  const parts = tokens(title).flatMap((t) => {
    if (/^[\x20-\x7e’]+$/.test(t.w)) return [t];
    const k = placesIn(t.w)[0], pn = k ? placeJa(k) : '';
    if (!pn || pn === t.w || !t.w.includes(pn)) return [t];
    const rest = t.w.replace(pn, '');
    return rest.length >= 2 ? [{ w: pn, start: t.start }, { w: rest, start: false }] : [{ w: pn, start: t.start }];
  });
  const out = [], seen = new Set();
  for (const { w, start } of parts) {
    const ascii = /^[\x20-\x7e’]+$/.test(w);
    const low = w.toLowerCase();
    if (ascii ? STOP_EN.has(low) || low.length < 3 : STOP_JA.has(w)) continue;
    if (skip.some((s) => s === low || s.includes(low))) continue;
    let name = ascii ? low : w, shown = w, place = false;
    if (ascii) { const k = placesIn(w)[0]; if (k) { name = placeJa(k); shown = name; place = true; } }
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, shown, place, cap: ascii && !place && /^[A-Z]/.test(w) && !start });
  }
  return out;
}

/** the words of these headlines, most used first. A word counts once per headline */
export function headlineWords(items, { exclude = [], limit = 6 } = {}) {
  const seen = new Map();
  for (const it of items || []) {
    for (const w of wordsOfTitle(it && it.title, exclude)) {
      const a = seen.get(w.name) || { w: w.shown, n: 0, cap: 0, place: w.place };
      a.n++;
      if (w.cap) { a.cap++; a.w = w.shown; }
      seen.set(w.name, a);
    }
  }
  const score = (a) => a.n * 10 + (a.place ? 4 : 0) + (a.cap ? 3 : 0) + (a.w.length >= 4 ? 1 : 0);
  return [...seen.values()].sort((a, b) => score(b) - score(a) || a.w.localeCompare(b.w)).slice(0, limit)
    .map((a) => ({ w: a.w, n: a.n }));
}

export function compareWords(jp, intl) {
  const J = new Set(jp.map((x) => x.w.toLowerCase())), X = new Set(intl.map((x) => x.w.toLowerCase()));
  return { jp: jp.map((x) => ({ ...x, both: X.has(x.w.toLowerCase()) })), intl: intl.map((x) => ({ ...x, both: J.has(x.w.toLowerCase()) })) };
}

/** everything the small figures show, from one event. The sides come in time order from sides(e) of the simple view, so a report without a time comes last and is never a first report */
export function measure(e, { order = [] } = {}) {
  const ms = e && Array.isArray(e.members) ? e.members.filter((x) => x && typeof x === 'object') : [];
  const s = sidesOf({ members: ms });
  const firstIn = (l) => (l[0] && isNum(l[0].ts) ? l[0] : null);
  const firstOf = { jp: firstIn(s.jp), intl: firstIn(s.intl), gov: firstIn(s.gov) };
  const rank = (t) => { const i = order.indexOf(t); return i < 0 ? 99 : i; };
  const types = [...new Set(ms.map((it) => str(it.type)))].map((type) => {
    const l = ms.filter((it) => str(it.type) === type);
    return { type, n: l.length, jp: l.filter((it) => it.home !== 'intl').length, intl: l.filter((it) => it.home === 'intl').length };
  }).sort((a, b) => b.n - a.n || rank(a.type) - rank(b.type));
  const exclude = [...new Set(ms.map(outletOf).filter(Boolean))];
  const words = compareWords(headlineWords([...s.jp, ...s.gov], { exclude }), headlineWords(s.intl, { exclude }));
  const timed = ms.filter((it) => isNum(it.ts)).sort((a, b) => a.ts - b.ts);
  return { n: ms.length, ...s, types, words, firstOf, first: timed[0] || null, last: timed[timed.length - 1] || null,
    lag: firstOf.jp && firstOf.intl ? firstOf.jp.ts - firstOf.intl.ts : null };
}

/** one side's short line: the AI's focus for the earliest report it wrote one for (the page puts the AI mark on it), else the side's words */
export function sideLines(list, words, angleOf) {
  const l = list || [];
  const hit = angleOf ? l.find((it) => str(angleOf(it))) : null;
  return { ai: hit ? str(angleOf(hit)) : '', words: (words || []).slice(0, 6), first: l[0] || null };
}

/** the reports adding up along the time, one side at a time; a report without a time is not placed */
export function runOf(m) {
  const sideOf = (it) => (m.gov.includes(it) ? 'gov' : m.intl.includes(it) ? 'intl' : 'jp');
  const c = { jp: 0, intl: 0, gov: 0 };
  return [...m.jp, ...m.intl, ...m.gov].filter((it) => isNum(it.ts)).sort((a, b) => a.ts - b.ts).map((it) => { c[sideOf(it)]++; return { ts: it.ts, it, ...c }; });
}
/** words with a count on each side, the most used first; with one side alone there is nothing to compare */
export function divergeRows(m, limit = 6) {
  if (!m.intl.length || !(m.jp.length + m.gov.length)) return [];
  const exclude = [...new Set([...m.jp, ...m.gov, ...m.intl].map(outletOf).filter(Boolean))];
  const J = headlineWords([...m.jp, ...m.gov], { exclude, limit: 30 }), X = headlineWords(m.intl, { exclude, limit: 30 });
  const key = (w) => w.toLowerCase(), rows = new Map();
  for (const a of J) rows.set(key(a.w), { w: a.w, jp: a.n, intl: 0 });
  for (const a of X) { const r = rows.get(key(a.w)); if (r) r.intl = a.n; else rows.set(key(a.w), { w: a.w, jp: 0, intl: a.n }); }
  return [...rows.values()].sort((a, b) => (b.jp + b.intl) - (a.jp + a.intl) || (Math.min(b.jp, b.intl) - Math.min(a.jp, a.intl))).slice(0, limit);
}
/** which outlet used which word: the words most outlets share first; null with fewer than two outlets or two words */
export function wordMatrix(m, { maxOutlets = 10, maxWords = 8 } = {}) {
  const items = [...m.jp, ...m.gov, ...m.intl];
  const names = [...new Set(items.map(outletOf).filter(Boolean))];
  if (names.length < 2) return null;
  const by = new Map(names.map((n) => [n, new Map()]));
  for (const it of items) { const b = by.get(outletOf(it)); if (b) for (const w of wordsOfTitle(it.title, names)) b.set(w.name, w.shown); }
  const count = new Map(), shown = new Map();
  for (const b of by.values()) for (const [n, s] of b) { count.set(n, (count.get(n) || 0) + 1); shown.set(n, s); }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxWords).map(([n]) => n);
  if (top.length < 2) return null;
  const sideOf = (n) => { const it = items.find((x) => outletOf(x) === n); return m.gov.includes(it) ? 'gov' : m.intl.includes(it) ? 'intl' : 'jp'; };
  const outlets = names.map((name) => ({ name, side: sideOf(name), hits: top.filter((w) => by.get(name).has(w)).length })).sort((a, b) => b.hits - a.hits).slice(0, maxOutlets);
  return { outlets, words: top.map((n) => shown.get(n)), shared: top.map((n) => count.get(n)), has: (o, w) => { const b = by.get(o); return !!b && [...b.values()].includes(w); } };
}

const normT = (t) => str(t).replace(/[\s「」『』]/g, '').toLowerCase();
const PAPER_ORDER = ['政府一次', '全国紙', '通信社', '経済紙', '公共放送'];
/** the white paper: a report with another headline than the title, a ministry's first and so on by type, one with a description before one without */
export function paperPick(members, headingText) {
  const cands = (members || []).filter((m) => m && str(m.title) && normT(m.title) !== normT(headingText));
  const rich = (m) => !!str(m.desc).trim();
  return PAPER_ORDER.map((t) => cands.find((m) => m.type === t && rich(m))).find(Boolean) || cands.find(rich)
    || PAPER_ORDER.map((t) => cands.find((m) => m.type === t)).find(Boolean) || cands[0] || null;
}

// ---------------------------------------------------------------- the drawing
export function createDossier({ h, s, extLink, safeUrl, fmtClock, fmtSpan, lineIcon }) {
  const short = Object.fromEntries(SIDES.map(([k, , ja]) => [k, ja]));
  const arrow = () => s('svg', { viewBox: '0 0 8 8', 'aria-hidden': 'true' }, s('path', { d: 'M2.4 1l3.4 3-3.4 3' }));
  /** the small arrow button: it says where it goes */
  const go = (label, fn) => (fn ? h('button', { type: 'button', class: 'tl-go', title: label, 'aria-label': label, on: { click: (ev) => { ev.stopPropagation(); fn(); } } }, arrow()) : null);
  const tile = (cls, title, sub, body, goBtn) => h('section', { class: `dcard ${cls}` },
    h('header', { class: 'tl-h' }, h('h3', { text: title }), sub ? h('small', { text: sub }) : null, goBtn), h('i', { class: 'tl-u' }), body);

  /** the thin bar in a row: Japan, abroad and the ministries, drawn to scale, in the hues the simple view gives them */
  function ratioBar(m) {
    const seg = (k, n) => (n ? h('i', { data: { side: k }, style: `flex:${n}` }) : null);
    const said = `国内 ${m.jp.length}・海外 ${m.intl.length}${m.gov.length ? `・官公庁 ${m.gov.length}` : ''}`;
    return h('span', { class: 'ratio', role: 'img', 'aria-label': said, title: said }, seg('jp', m.jp.length), seg('intl', m.intl.length), seg('gov', m.gov.length));
  }

  // the ring: the share of each side round a gauge, the count in the middle
  function ring(m) {
    const R = 34, C = 44;
    const svg = s('svg', { viewBox: '0 0 88 88', class: 'tl-ring', role: 'img', 'aria-label': `国内 ${m.jp.length}・海外 ${m.intl.length}・官公庁 ${m.gov.length}` });
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2, r0 = 39.5, r1 = i % 12 === 0 ? 43.5 : 41.5;
      svg.append(s('line', { x1: (C + r0 * Math.sin(a)).toFixed(2), y1: (C - r0 * Math.cos(a)).toFixed(2), x2: (C + r1 * Math.sin(a)).toFixed(2), y2: (C - r1 * Math.cos(a)).toFixed(2), class: 'rt' }));
    }
    svg.append(s('circle', { cx: C, cy: C, r: R, class: 'rb', pathLength: 100 }));
    const parts = [['jp', m.jp.length], ['intl', m.intl.length], ['gov', m.gov.length]].filter(([, n]) => n);
    let at = 0;
    for (const [k, n] of parts) {
      const len = (n / Math.max(1, m.n)) * 100, gap = parts.length > 1 ? 1.4 : 0, draw = Math.max(.5, len - gap);
      svg.append(s('circle', { cx: C, cy: C, r: R, class: 'rs', 'data-side': k, pathLength: 100, 'stroke-dasharray': `${draw.toFixed(2)} ${(100 - draw).toFixed(2)}`, 'stroke-dashoffset': (25 - at).toFixed(2) }));
      at += len;
    }
    svg.append(s('text', { x: C, y: C + 6, class: 'rn', 'text-anchor': 'middle' }, document.createTextNode(String(m.n))));
    return svg;
  }

  function homeTile(m, act) {
    const pct = (n) => (m.n ? `${Math.round((n / m.n) * 100)}%` : '');
    const key = (id) => {
      const n = m[id].length, ja = short[id];
      return h('button', { type: 'button', class: 'tl-k', data: { side: id }, disabled: n ? null : true, title: n ? `${ja}の ${n} 件を一覧で見る` : `${ja} 0 件`, on: { click: () => act.home(id) } },
        lineIcon(id), h('span', { class: 'kl', text: ja }), h('b', { class: 'num', text: n }), h('small', { text: pct(n) }));
    };
    return tile('t-home', '国内と海外', '件数の比', h('div', { class: 'tl-b' }, ring(m), h('div', { class: 'tl-keys' }, key('jp'), key('intl'), m.gov.length ? key('gov') : null)), go('全部の報道を見る', () => act.all()));
  }

  // DATA SOURCE of the earlier board: the type's name over its bar, the count beside it; who and how late in the tooltip
  function typeTile(m, act, who) {
    const top = m.types.slice(0, 6), max = Math.max(1, ...top.map((t) => t.n)), rest = m.types.length - top.length;
    return tile('t-types', '媒体の種類', `${m.types.length} 種類`, h('div', { class: 'tl-bars' },
      top.map((t) => {
        const names = who && who.get(t.type);
        return h('button', { type: 'button', class: 'tl-bar', title: names && names.length ? names.join('、') : `${t.type} ${t.n} 件`, on: { click: () => act.type(t.type) } },
          h('span', { class: 'bb' }, t.jp ? h('i', { data: { side: 'jp' }, style: `width:${(t.jp / max) * 100}%` }) : null, t.intl ? h('i', { data: { side: 'intl' }, style: `width:${(t.intl / max) * 100}%` }) : null),
          h('span', { class: 'bl', text: t.type }), h('b', { class: 'num', text: t.n }));
      }),
      rest > 0 ? h('small', { class: 'tl-more', text: `ほか ${rest} 種類` }) : null), null);
  }

  // the half gauge: a value on a fixed scale, the number in the middle
  function halfGauge(value, { max = 100, label = null, min = 0, text = null } = {}) {
    const share = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const svg = s('svg', { viewBox: '0 0 120 70', class: 'gauge', role: 'img', 'aria-label': `${label || ''} ${text == null ? value : text}` });
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI - (i / 10) * Math.PI, r0 = 52, r1 = i % 5 === 0 ? 58 : 55;
      svg.append(s('line', { x1: (60 + r0 * Math.cos(a)).toFixed(2), y1: (62 - r0 * Math.sin(a)).toFixed(2), x2: (60 + r1 * Math.cos(a)).toFixed(2), y2: (62 - r1 * Math.sin(a)).toFixed(2), class: 'gt' }));
    }
    const arc = 'M14 62 A46 46 0 0 1 106 62';
    svg.append(s('path', { d: arc, class: 'gb', pathLength: 100 }), s('path', { d: arc, class: 'gv', pathLength: 100, 'stroke-dasharray': `${(share * 100).toFixed(1)} 100` }));
    svg.append(s('text', { x: 60, y: 58, class: 'gn', 'text-anchor': 'middle' }, document.createTextNode(text == null ? String(value) : text)));
    return svg;
  }

  /** in a row or on a small card: the name, a thin bar on the 0 to 100 scale, the number */
  const biasMini = (b) => h('span', { class: 'bi-mini' }, h('small', { text: 'バイアス度' }), h('span', { class: 'bi-mb' }, h('i', { style: `width:${b.score}%` })), h('b', { class: 'num', text: b.score }));

  /** バイアス度: the gauge, and a press opens every term with its formula; with too few reports no number at all */
  function biasTile(b, { open = false, onToggle = null } = {}) {
    if (!b || !b.ok) return h('section', { class: 'dcard t-bias none' }, h('header', { class: 'tl-h' }, h('h3', { text: 'バイアス度' })), h('i', { class: 'tl-u' }), h('p', { class: 'tl-none', text: (b && b.reason) || '記事が少なく測れません' }));
    const box = h('section', { class: `dcard t-bias${open ? ' open' : ''}` });
    const more = () => h('div', { class: 'bi-more' },
      h('ul', { class: 'bi-terms' }, b.terms.map((t) => h('li', null,
        h('span', { class: 'bi-n' }, t.ai ? h('span', { class: 'aimk', text: 'AI' }) : null, t.ja), h('span', { class: 'bi-b' }, h('i', { style: `width:${t.value}%` })), h('b', { class: 'num', text: t.value }), h('small', { class: 'bi-f', text: t.formula })))),
      b.skipped.length ? h('p', { class: 'bi-s', text: `外した項：${b.skipped.map((t) => `${t.ja}（${t.why}）`).join('、')}` }) : null,
      h('p', { class: 'bi-eq', text: `バイアス度 = ${b.formula}` }),
      h('p', { class: 'bi-note', text: '報じ方の偏りを測った数です。内容の真偽や媒体の立場を示しません。' }));
    const paint = (isOpen) => {
      box.classList.toggle('open', isOpen);
      box.replaceChildren(h('header', { class: 'tl-h' }, h('h3', { text: 'バイアス度' }), h('small', { text: '0〜100' })), h('i', { class: 'tl-u' }),
        h('button', { type: 'button', class: 'bi-btn', 'aria-expanded': String(isOpen), title: '内訳を開く', on: { click: (ev) => { ev.stopPropagation(); if (onToggle) onToggle(!isOpen); paint(!isOpen); } } }, halfGauge(b.score, { label: 'バイアス度' }), h('span', { class: 'bi-o', text: isOpen ? '内訳を閉じる' : '内訳を開く' })),
        isOpen ? more() : null);
    };
    paint(open);
    return box;
  }

  // the run of time: the reports adding up, stacked by side, on a time axis
  function areaSvg(m) {
    const run = runOf(m);
    if (run.length < 3 || run[run.length - 1].ts <= run[0].ts) return null;   // two reports make a block, not a run: the lanes say it better
    const W = 300, H = 84, TOP = 8, FOOT = 13, t0 = run[0].ts, t1 = run[run.length - 1].ts, total = run.length;
    const X = (t) => 6 + ((t - t0) / (t1 - t0)) * (W - 12), Y = (v) => H - FOOT - (v / total) * (H - FOOT - TOP);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'area', role: 'img', 'aria-label': `報じ始めから ${fmtSpan(t1 - t0)} の間に ${total} 件` });
    for (const v of [0, total]) svg.append(s('line', { x1: 6, x2: W - 6, y1: Y(v), y2: Y(v), class: 'ag' }));
    svg.append(s('text', { x: 6, y: Y(total) - 2, class: 'ax' }, document.createTextNode(`${total} 件`)));
    const order = ['jp', 'intl', 'gov'];
    const lower = (r, k) => order.slice(0, order.indexOf(k)).reduce((a, x) => a + r[x], 0);
    for (const k of order) {
      if (!run[run.length - 1][k]) continue;
      const top = [], low = [];
      run.forEach((r, i) => {
        const p = run[i - 1];
        if (p) { top.push(`${X(r.ts).toFixed(1)},${Y(lower(p, k) + p[k]).toFixed(1)}`); low.push(`${X(r.ts).toFixed(1)},${Y(lower(p, k)).toFixed(1)}`); }
        top.push(`${X(r.ts).toFixed(1)},${Y(lower(r, k) + r[k]).toFixed(1)}`); low.push(`${X(r.ts).toFixed(1)},${Y(lower(r, k)).toFixed(1)}`);
      });
      svg.append(s('polygon', { points: `${top.join(' ')} ${low.reverse().join(' ')}`, class: 'af', 'data-side': k }), s('polyline', { points: top.join(' '), class: 'al', 'data-side': k }));
    }
    // each report: a thin column to point at, its time and outlet in the tooltip, its article on a press
    run.forEach((r) => {
      const col = s('rect', { x: (X(r.ts) - 3).toFixed(1), y: TOP, width: 6, height: H - FOOT - TOP, class: 'ah' }, s('title', {}, document.createTextNode(`${fmtClock(r.ts)} ${outletOf(r.it)}（${r.jp + r.intl + r.gov} 件目）`)));
      const u = safeUrl(r.it.link);
      svg.append(u ? s('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, col) : col);
    });
    svg.append(s('text', { x: 6, y: H - 2, class: 'ax' }, document.createTextNode(fmtClock(t0))), s('text', { x: W - 6, y: H - 2, class: 'ax end' }, document.createTextNode(`+${fmtSpan(t1 - t0)}`)));
    return svg;
  }

  // Japan against abroad: bars that swing left and right of a middle line
  function divergeTile(m, act) {
    const rows = divergeRows(m);
    if (!rows.length) return null;
    const max = Math.max(...rows.flatMap((r) => [r.jp, r.intl]));
    if (max < 2) return null;   // every bar a one says nothing: the two sides' cards already name the words
    const bar = (id, n) => h('span', { class: `dv-b ${id}`, data: { side: id } }, n ? h('i', { style: `width:${(n / max) * 100}%` }) : null, n ? h('small', { class: 'num', text: n }) : null);
    return tile('t-div', '国内と海外の語', null, h('div', { class: 'dv' },
      h('div', { class: 'dv-h' }, h('span', { class: 'j', text: '国内' }), h('span', { text: '' }), h('span', { class: 'x', text: '海外' })),
      rows.map((r) => h('button', { type: 'button', class: `dv-r${r.jp && r.intl ? ' both' : ''}`, title: `「${r.w}」で探す・国内 ${r.jp}・海外 ${r.intl}`, on: { click: () => act.word(r.w) } }, bar('jp', r.jp), h('span', { class: 'dv-w', text: r.w }), bar('intl', r.intl)))), null);
  }

  // which outlet used which word: rows of outlets, columns of words, a dot where they meet
  function overlapTile(m, act) {
    const x = wordMatrix(m);
    if (x && x.outlets.length < 3) return null;   // a matrix needs more than two rows to show a pattern
    if (!x) return null;
    return tile('t-over', '媒体と語の重なり', `${x.outlets.length} 媒体 × ${x.words.length} 語`, h('div', { class: 'mx', style: `--c:${x.words.length}` },
      h('span', { class: 'mx-0' }), x.words.map((w, i) => h('button', { type: 'button', class: 'mx-w', title: `「${w}」で探す・${x.shared[i]} 媒体`, on: { click: () => act.word(w) } }, h('span', { text: w }))),
      x.outlets.flatMap((o) => [h('span', { class: 'mx-o', data: { side: o.side }, text: o.name, title: o.name }),
        ...x.words.map((w) => (x.has(o.name, w) ? h('i', { class: 'mx-d', data: { side: o.side }, title: `${o.name}・${w}` }) : h('i', { class: 'mx-e' })))])), null);
  }

  // COVERAGE HEAT of the earlier board: one number on red (what came new in the last six hours), the lanes, and the first report of each side
  function timeTile(m, lanes, new6h) {
    const firstLink = (id) => {
      const it = m.firstOf[id], ja = `${short[id]}で最初の報道`;
      if (!it) return h('span', { class: 'tl-f off' }, h('span', { class: 'kl', text: ja }), ' —');
      const link = safeUrl(it.link), inner = [h('span', { class: 'kl', text: ja }), h('b', { class: 'num', text: fmtClock(it.ts) })];
      return link ? extLink(link, { class: 'tl-f', data: { side: id }, title: `${outletOf(it)} の記事を開く` }, ...inner) : h('span', { class: 'tl-f', data: { side: id } }, ...inner);
    };
    const lag = isNum(m.lag) ? Math.abs(m.lag) : null;
    const big = isNum(new6h)
      ? h('div', { class: 'tl-big' }, h('i', { text: new6h > 0 ? '▲' : '▶' }), h('b', { class: 'num', text: new6h > 0 ? `+${new6h}` : '0' }), h('small', { text: '6 時間の新着' }))
      : null;
    return tile('t-time', '時間の流れ', m.first && m.last && m.last.ts > m.first.ts ? `+${fmtSpan(m.last.ts - m.first.ts)}` : null, h('div', { class: 'tl-b col' }, big, h('div', { class: 'tl-tw' }, areaSvg(m), lanes),
      h('div', { class: 'tl-firsts' }, firstLink('jp'), firstLink('intl'), lag != null ? h('span', { class: 'tl-f lag' }, h('span', { class: 'kl', text: '差' }), h('b', { class: 'num', text: lag < 60 ? '1分未満' : fmtSpan(lag) })) : null)), null);
  }

  // the two short versions side by side: the side's first headline, its focus (the AI's, marked) and the words its headlines used
  function side(id, ja, list, words, angleOf, act) {
    const l = sideLines(list, words, angleOf);
    if (!list.length) {
      return h('section', { class: 'sd empty', data: { side: id } }, h('header', { class: 'sd-h' }, lineIcon(id), h('b', { text: ja }), h('span', { class: 'n', text: '0 件' })),
        h('p', { class: 'sd-none' }, '集めたニュースには見当たりません', h('button', { type: 'button', class: 'lk', on: { click: () => act.absent() } }, '見当たらない媒体へ')));
    }
    const f = l.first, link = f ? safeUrl(f.link) : null, title = f ? str(f.title) : '';
    return h('section', { class: 'sd', data: { side: id } },
      h('header', { class: 'sd-h' }, lineIcon(id), h('b', { text: ja }),
        h('button', { type: 'button', class: 'n lk', title: `${short[id]}の報道を一覧で見る`, on: { click: () => act.home(id) } }, `${list.length} 件`),
        f && isNum(f.ts) ? h('small', { text: `最初 ${fmtClock(f.ts)} ${outletOf(f)}` }) : null, link ? go('元の記事を開く', () => window.open(link, '_blank', 'noopener,noreferrer')) : null),
      title ? (link ? extLink(link, { class: 'sd-t', lang: f.lang === 'en' ? 'en' : null }, `「${title}」`) : h('p', { class: 'sd-t', text: `「${title}」` })) : null,
      l.ai ? h('p', { class: 'sd-l' }, h('span', { class: 'aimk', text: 'AI' }), l.ai) : null,
      l.words.length ? h('div', { class: 'sd-ws' }, h('span', { class: 'k', text: '着目した語' }), l.words.map((x) => h('button', { type: 'button', class: `sd-w${x.both ? ' both' : ''}`, title: `「${x.w}」で探す${x.both ? '（国内と海外の両方に出た語）' : ''}`, on: { click: () => act.word(x.w) } },
        h('span', { text: x.w }), x.n > 1 ? h('small', { class: 'num', text: x.n }) : null))) : null);
  }
  const sides = (m, angles, act) => {
    const angleOf = (it) => (angles && angles.get(it.id)) || '';
    return h('div', { class: 'sides' }, side('jp', '国内版', [...m.jp, ...m.gov].sort((a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity)), m.words.jp, angleOf, act), side('intl', '海外版', m.intl, m.words.intl, angleOf, act));
  };

  // the one white paper of the earlier board: an outlet's masthead, its headline as published and its description as quoted by descOf
  function paper(it, quote) {
    if (!it) return null;
    const name = outletOf(it), link = safeUrl(it.link);
    return h('section', { class: 'tl-paper' },
      h('header', { class: 'pp-m' }, h('i', { text: name.trim().slice(0, 1) }), h('b', { text: name }), h('small', { text: [str(it.type), isNum(it.ts) ? fmtClock(it.ts) : ''].filter(Boolean).join(' ') })),
      link ? extLink(link, { class: 'pp-t', lang: it.lang === 'en' ? 'en' : null }, str(it.title)) : h('p', { class: 'pp-t', text: str(it.title) }),
      quote, h('footer', { class: 'pp-f' }, h('small', { text: it.type === '政府一次' ? '一次資料' : 'もう一つの見出し' }), link ? go('元の記事を開く', () => window.open(link, '_blank', 'noopener,noreferrer')) : null));
  }
  return { tile, go, ratioBar, homeTile, typeTile, timeTile, sides, paper, biasTile, biasMini, divergeTile, overlapTile, halfGauge, areaSvg };
}

/* the share image of one news, 1200 x 630 (js/app.js shareImage): the headline as published, the share of each side, the first
 * report of each side and the gap, the words both sides used. Only the counts the page already shows; colours and fonts are the
 * page's own (c). */
export const CARD_W = 1200, CARD_H = 630;
const KEEP = '、。，．」』）)！？・ー';
/** wrapLines(text, measure, maxW, maxLines) -> lines; a closing mark stays on its line, the last line ends in … when cut */
export function wrapLines(text, measure, maxW, maxLines) {
  const out = [];
  let line = '';
  for (const ch of Array.from(String(text || ''))) {
    if (!line || measure(line + ch) <= maxW || KEEP.includes(ch)) { line += ch; continue; }
    out.push(line); line = ch;
  }
  if (line) out.push(line);
  if (out.length <= maxLines) return out;
  const cut = out.slice(0, maxLines);
  let last = cut[maxLines - 1];
  while (last && measure(last + '…') > maxW) last = last.slice(0, -1);
  cut[maxLines - 1] = last + '…';
  return cut;
}
/** d = { title, outlet, when, sides: [{ k, label, n, pc, first }], lag, words: [w] }   c = { bg, ink, ink2, ink3, line, lit, jp, intl, gov, font, num } */
export function drawShareCard(g, d, c) {
  const F = (w, px, fam) => `${w} ${px}px ${fam || c.font}`;
  const text = (s, x, y, font, color, align = 'left') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.fillText(s, x, y); g.textAlign = 'left'; };
  g.fillStyle = c.bg; g.fillRect(0, 0, CARD_W, CARD_H);
  g.strokeStyle = c.lit; g.globalAlpha = 0.5; g.lineWidth = 2; g.strokeRect(1, 1, CARD_W - 2, CARD_H - 2); g.globalAlpha = 1;
  g.lineWidth = 3;
  for (const [x, y, dx, dy] of [[24, 24, 1, 1], [CARD_W - 24, 24, -1, 1], [24, CARD_H - 24, 1, -1], [CARD_W - 24, CARD_H - 24, -1, -1]]) {
    g.beginPath(); g.moveTo(x, y + dy * 22); g.lineTo(x, y); g.lineTo(x + dx * 22, y); g.stroke();
  }
  text('Parallax', 64, 80, F(600, 26, c.num), c.ink);
  text(d.when, CARD_W - 64, 80, F(400, 20), c.ink3, 'right');
  g.font = F(600, 40);
  const tl = wrapLines(d.title, (s) => g.measureText(s).width, CARD_W - 128, 3);
  tl.forEach((s, i) => text(s, 64, 146 + i * 54, F(600, 40), c.ink));
  let y = 146 + (tl.length - 1) * 54 + 40;
  if (d.outlet) { text(d.outlet, 64, y, F(400, 20), c.ink2); y += 12; }
  y += 40;
  // the share of each side: one bar, a 2px gap between the parts, the counts under it
  const sides = d.sides.filter((x) => x.n > 0), tot = sides.reduce((a, x) => a + x.n, 0), W = 500;
  text('件数の割合', 64, y, F(500, 20), c.ink3);
  let x = 64;
  for (const s of sides) {
    const w = Math.max(4, (s.n / tot) * (W - 2 * (sides.length - 1)));
    g.fillStyle = c[s.k]; g.beginPath(); if (g.roundRect) g.roundRect(x, y + 14, w, 20, 4); else g.rect(x, y + 14, w, 20); g.fill();
    x += w + 2;
  }
  d.sides.forEach((s, i) => {
    const ly = y + 76 + i * 36;
    g.fillStyle = c[s.k]; g.fillRect(64, ly - 14, 14, 14);
    text(s.label, 88, ly, F(500, 22), s.n ? c.ink : c.ink3);
    text(`${s.n} 件`, 200, ly, F(600, 22, c.num), s.n ? c.ink : c.ink3);
    text(s.pc, 300, ly, F(400, 22, c.num), c.ink2);
  });
  // the first report of each side, and the gap between Japan and abroad
  const X = 640;
  text('最初に報じた時刻', X, y, F(500, 20), c.ink3);
  d.sides.forEach((s, i) => {
    const ly = y + 42 + i * 36;
    text(s.label, X, ly, F(500, 22), s.first ? c.ink : c.ink3);
    text(s.first ? s.first.clock : '—', X + 100, ly, F(600, 22, c.num), s.first ? c.ink : c.ink3);
    if (s.first) { g.font = F(400, 22); const o = wrapLines(s.first.outlet, (t) => g.measureText(t).width, CARD_W - 64 - (X + 240), 1)[0] || ''; text(o, X + 240, ly, F(400, 22), c.ink2); }
  });
  if (d.lag) text(d.lag, X, y + 42 + d.sides.length * 36 + 8, F(600, 24), c.ink);
  if (d.words.length) {
    g.font = F(400, 22);
    const line = wrapLines(`共通する言葉　${d.words.join('・')}`, (t) => g.measureText(t).width, CARD_W - 128, 1)[0];
    text(line, 64, CARD_H - 56, F(400, 22), c.ink2);
  }
}
