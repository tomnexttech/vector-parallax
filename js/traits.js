/* traits — 媒体の特徴: what the collected headlines show of one outlet, beside the outlets of its own side. Counted, never labelled.
 * Every figure carries its count and its span; an outlet with fewer than TRAIT_MIN reports gets its counts and no tendency.
 * Outside ratings (data/ratings.json) are shown apart, with their source and the day they were checked, and never mixed in.
 *
 *   sideOf(items) -> 'jp' | 'intl' | 'gov'
 *   termsOf(title) -> [term]                         the words of a headline (kanji runs, katakana runs, latin words)
 *   statsOf(events, outlet, { outletOf, biasOf })    -> the counts of one outlet (null when it carried nothing)
 *   traitsOf(events, outlet, { outletOf, biasOf, fields }) -> { me, base, fields, alone, agree, words, tone, bias, notes, few }
 *   traitsBlock(t, { h, clock, ratings, head })      -> the nodes of the sheet
 *
 * The base is the mean over the outlets of the same side that have TRAIT_MIN reports or more (each outlet counts once). */

import { toneOf } from './front.js';

export const TRAIT_MIN = 10;
export const BIAS_BINS = [0, 20, 40, 60, 80, 101];
const GOV = '政府一次';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const mean = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
const median = (xs) => { const s = [...xs].filter(isNum).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sideOfItem = (it) => (it.type === GOV ? 'gov' : it.home === 'intl' ? 'intl' : 'jp');

export function sideOf(items) {
  const n = { jp: 0, intl: 0, gov: 0 };
  for (const it of arr(items)) if (it && typeof it === 'object') n[sideOfItem(it)]++;
  return n.gov > n.jp && n.gov > n.intl ? 'gov' : n.intl > n.jp ? 'intl' : 'jp';
}

const STOP = new Set('the and for with from that this into over after what will says said amid more than about have has been were their they which when where while could would should against under also its his her new news live update updates first last year years week day today report reports latest video watch how why who are was not but all out one two can may just now off back still as at by in of on or to up is it be an a us uk'.split(' '));
const STOP_JA = new Set(['最大', '最小', '最新', '最高', '最低', '速報', '更新', '発表', '関連', '一部', '全国', '今年', '今月', '来年', '昨年', '同日', '政府', '日本']);
export function termsOf(title) {
  const t = str(title), out = new Set();
  for (const m of t.matchAll(/[一-龥々〆ヵヶ]{2,}|[ァ-ヴー]{3,}/g)) if (!STOP_JA.has(m[0])) out.add(m[0]);
  for (const m of t.matchAll(/[A-Za-z][A-Za-z'-]{3,}/g)) { const w = m[0].toLowerCase().replace(/'s$/, ''); if (!STOP.has(w)) out.add(w); }
  return [...out];
}

/** one outlet's counts over the events it appears in */
export function statsOf(events, outlet, { outletOf = (it) => str(it.media) || str(it.outlet), biasOf = () => null } = {}) {
  const mine = [], items = [];
  for (const e of arr(events)) {
    const ms = arr(e && e.members).filter((m) => m && typeof m === 'object');
    const own = ms.filter((m) => outletOf(m) === outlet);
    if (!own.length) continue;
    mine.push({ e, ms, own });
    items.push(...own);
  }
  if (!mine.length) return null;
  const side = sideOf(items);
  const ts = items.map((it) => it.ts).filter(isNum);
  const fields = new Map();
  let alone = 0;
  const others = [];
  const scores = [];
  for (const { e, ms } of mine) {
    const f = str(e.field) || 'その他';
    fields.set(f, (fields.get(f) || 0) + 1);
    const outs = new Set(ms.map(outletOf).filter(Boolean));
    others.push(outs.size - 1);   // the other outlets that carried the same news
    // only its side carried the news: no report of the other of Japan and abroad
    const other = side === 'intl' ? 'jp' : 'intl';
    if (side !== 'gov' && !ms.some((m) => sideOfItem(m) === other)) alone++;
    const b = biasOf(e);
    if (b && b.ok && isNum(b.score)) scores.push(b.score);
  }
  const titles = items.map((it) => str(it.title)).filter(Boolean);
  const tone = toneOf(titles);
  return { outlet, side, n: mine.length, reports: items.length, from: ts.length ? Math.min(...ts) : null, to: ts.length ? Math.max(...ts) : null,
    fields, alone, othersMean: mean(others), solo: others.filter((x) => x === 0).length, titles, tone, scores };
}

const pct = (a, b) => (b ? (a / b) * 100 : 0);
/** the outlet beside the mean of its side. fields = the order the page uses */
export function traitsOf(events, outlet, { outletOf, biasOf, fields = [] } = {}) {
  const me = statsOf(events, outlet, { outletOf, biasOf });
  if (!me) return null;
  const names = new Set();
  for (const e of arr(events)) for (const m of arr(e && e.members)) if (m && typeof m === 'object' && outletOf(m)) names.add(outletOf(m));
  const peers = [...names].filter((x) => x !== outlet).map((x) => statsOf(events, x, { outletOf, biasOf })).filter((s) => s && s.side === me.side && s.reports >= TRAIT_MIN);
  const few = me.reports < TRAIT_MIN;
  const order = [...fields, ...[...me.fields.keys()].filter((f) => !fields.includes(f))];
  const fieldRows = order.map((f) => {
    const mine = pct(me.fields.get(f) || 0, me.n), base = mean(peers.map((p) => pct(p.fields.get(f) || 0, p.n)));
    return { f, n: me.fields.get(f) || 0, pc: mine, base, d: base == null ? null : mine - base };
  }).filter((r) => r.n > 0 || (r.base != null && r.base >= 5));
  const alone = { n: me.alone, of: me.n, pc: pct(me.alone, me.n), base: mean(peers.map((p) => pct(p.alone, p.n))) };
  const agree = { avg: me.othersMean, solo: me.solo, soloPc: pct(me.solo, me.n), base: mean(peers.map((p) => p.othersMean).filter(isNum)), baseSolo: mean(peers.map((p) => pct(p.solo, p.n))) };
  // the words it uses far more than the rest of its side: in 3 of its headlines or more, at least twice the rate of the others
  const restTitles = peers.flatMap((p) => p.titles);
  const count = (titles) => { const m = new Map(); for (const t of titles) for (const w of termsOf(t)) m.set(w, (m.get(w) || 0) + 1); return m; };
  const cm = count(me.titles), cr = count(restTitles), nm = Math.max(1, me.titles.length), nr = Math.max(1, restTitles.length);
  const own = new Set(termsOf(outlet).concat(outlet.toLowerCase()));
  const words = [...cm.entries()].filter(([w, c]) => c >= 3 && !own.has(w))
    .map(([w, c]) => ({ w, n: c, lift: (c / nm) / (((cr.get(w) || 0) + 0.5) / (nr + 0.5)), rest: cr.get(w) || 0 }))
    .filter((x) => x.lift >= 2).sort((a, b) => b.lift - a.lift || b.n - a.n).slice(0, 6);
  const per100 = (t, n) => (n ? ((t.nNeg + t.nPos) ? { neg: (t.nNeg / n) * 100, pos: (t.nPos / n) * 100 } : { neg: 0, pos: 0 }) : { neg: 0, pos: 0 });
  const tm = per100(me.tone, me.titles.length);
  const tb = { neg: mean(peers.map((p) => per100(p.tone, p.titles.length).neg)), pos: mean(peers.map((p) => per100(p.tone, p.titles.length).pos)) };
  const tone = { nNeg: me.tone.nNeg, nPos: me.tone.nPos, neg: me.tone.neg, pos: me.tone.pos, of: me.titles.length, negPer: tm.neg, posPer: tm.pos, baseNeg: tb.neg, basePos: tb.pos };
  const bins = BIAS_BINS.slice(0, -1).map((lo, i) => me.scores.filter((s) => s >= lo && s < BIAS_BINS[i + 1]).length);
  const bias = { n: me.scores.length, bins, med: median(me.scores), base: median(peers.flatMap((p) => p.scores)) };
  const t = { me, peers: peers.length, few, fields: fieldRows, alone, agree, words, tone, bias };
  t.fieldGate = fieldGate(fieldRows);
  t.notes = few ? [] : notesOf(t);
  return t;
}

const SIDE_JA = { jp: '国内', intl: '海外', gov: '官公庁' };
const r0 = (x) => Math.round(x);
export const FIELD_OTHER_MAX = 50, FIELD_TOP_MAX = 85, FIELD_BASE_MIN = 3;
/** whether the split of fields says something of this side: null when it does, else why not ({ k: 'other' | 'top', f, pc }) */
export function fieldGate(rows) {
  const o = arr(rows).find((r) => r.f === 'その他');
  if (o && (o.pc > FIELD_OTHER_MAX || (o.base != null && o.base > FIELD_OTHER_MAX))) return { k: 'other', f: 'その他', pc: Math.max(o.pc, o.base || 0) };
  const top = arr(rows).filter((r) => r.f !== 'その他' && r.base != null).sort((a, b) => b.base - a.base)[0];
  if (top && top.base >= FIELD_TOP_MAX) return { k: 'top', f: top.f, pc: top.base };
  return null;
}
const gateJa = (g, s) => (g.k === 'other' ? `分野が決まらない話（その他）が ${r0(g.pc)}% あり、分野の割合は比べられないため、考察に入れていません。`
  : `${s}の媒体の話は平均 ${r0(g.pc)}% が「${g.f}」に入り、分野の分け方がこの側の違いを拾えないため、分野の差は考察に入れていません。`);
/** what the data lets one say, at most three lines, the largest gaps first. A gap too small for the counts is left out */
export function notesOf(t) {
  const s = SIDE_JA[t.me.side], out = [];
  // その他 is what no rule placed: a gap there says little of the outlet, so it is drawn but not told
  if (!t.fieldGate) for (const r of t.fields) if (r.f !== 'その他' && r.d != null && r.base >= FIELD_BASE_MIN && Math.abs(r.d) >= 12 && r.n >= 3) out.push({ v: Math.abs(r.d) / 12,
    text: `${r.f}の話の割合が ${r0(r.pc)}% で、${s}の媒体の平均（${r0(r.base)}%）より ${r0(Math.abs(r.d))} ポイント${r.d > 0 ? '高い' : '低い'}。` });
  if (t.alone.base != null && Math.abs(t.alone.pc - t.alone.base) >= 10 && t.me.side !== 'gov') out.push({ v: Math.abs(t.alone.pc - t.alone.base) / 10,
    text: `${s}の媒体だけが報じた話の割合が ${r0(t.alone.pc)}%（${t.alone.n} 件）で、平均の ${r0(t.alone.base)}% より${t.alone.pc > t.alone.base ? '高い' : '低い'}。` });
  const da = isNum(t.agree.avg) && isNum(t.agree.base) ? t.agree.avg - t.agree.base : 0;
  if (Math.abs(da) >= 1 && (t.agree.avg >= t.agree.base * 1.5 || t.agree.avg <= t.agree.base / 1.5)) out.push({ v: 1.2,
    text: `一つの話を一緒に報じた他社は平均 ${t.agree.avg.toFixed(1)} 社で、${s}の媒体の平均（${t.agree.base.toFixed(1)} 社）より${da > 0 ? '多く、他社と揃いやすい' : '少なく、他社が載せない話が多い'}。` });
  const dn = isNum(t.tone.baseNeg) ? t.tone.negPer - t.tone.baseNeg : 0;
  if (t.tone.nNeg >= 3 && Math.abs(dn) >= 4) out.push({ v: Math.abs(dn) / 4,
    text: `見出しの否定の語（批判・懸念 など）は 100 本あたり ${t.tone.negPer.toFixed(1)} 回で、平均（${t.tone.baseNeg.toFixed(1)} 回）より${dn > 0 ? '多い' : '少ない'}。` });
  if (t.bias.n >= 5 && isNum(t.bias.base) && Math.abs(t.bias.med - t.bias.base) >= 10) out.push({ v: Math.abs(t.bias.med - t.bias.base) / 10,
    text: `載せた話のバイアス度は中央値 ${r0(t.bias.med)} で、${s}の媒体の話全体（${r0(t.bias.base)}）より${t.bias.med > t.bias.base ? '高い' : '低い'}。` });
  if (t.words.length >= 2) out.push({ v: 0.9, text: `ほかの${s}の媒体より目立って多い語は「${t.words.slice(0, 3).map((x) => x.w).join('」「')}」。` });
  return out.sort((a, b) => b.v - a.v).slice(0, 3).map((x) => x.text);
}

// ---------------------------------------------------------------- outside ratings, found by the outlet's name or by another name of it
const nameKey = (s) => String(s == null ? '' : s).normalize('NFKC').trim().toLowerCase();
/** the rows of data/ratings.json for an outlet: its own name first, then the aliases table ("AP News" is "AP"); [] when none */
export function ratingsOf(ratings, outlet) {
  if (!ratings || !ratings.outlets || typeof ratings.outlets !== 'object') return [];
  const own = ratings.outlets, name = str(outlet);
  if (Array.isArray(own[name])) return own[name];
  const k = nameKey(name);
  for (const key of Object.keys(own)) if (nameKey(key) === k) return arr(own[key]);
  const al = ratings.aliases && typeof ratings.aliases === 'object' ? ratings.aliases : {};
  for (const a of Object.keys(al)) if (nameKey(a) === k && Array.isArray(own[al[a]])) return own[al[a]];
  return [];
}

// ---------------------------------------------------------------- the DOM
/** o ={ h, clock(ts), ratings (data/ratings.json or null), head(id) -> heading, sec(title, n) } */
export function traitsBlock(t, o) {
  const { h } = o;
  if (!t) return [];
  const span = t.me.from != null ? `${o.clock(t.me.from)}〜${o.clock(t.me.to)}` : '';
  const basis = h('p', { class: 'tr-basis num', text: `記事 ${t.me.reports} 件・話 ${t.me.n} 件${span ? `・${span}` : ''}・比べた${SIDE_JA[t.me.side]}の媒体 ${t.peers} 社` });
  const out = [], aside = [];
  out.push(o.sec(o.head('outlet.note')), basis, ...[].concat(
    t.few ? h('p', { class: 'tr-few', text: `記事が ${t.me.reports} 件で、傾向を言うには少ないため、数だけを出します。` })
      : t.notes.length ? h('ul', { class: 'tr-notes' }, t.notes.map((x) => h('li', { text: x })))
        : [h('p', { class: 'tr-few', text: `考察に入れた項（${t.fieldGate ? '' : '分野・'}独自率・同報社数・否定の語・バイアス度）に、基準を超える平均との差はありません。` }),
          h('p', { class: 'tr-few tr-th num', text: `基準: ${t.fieldGate ? '' : '分野 12 ポイント・'}独自率 10 ポイント・同報社数 1.5 倍かつ 1 社・否定の語 100 本あたり 4 回・バイアス度 10。${t.fieldGate ? '' : `棒の分野のうち、平均 ${FIELD_BASE_MIN}% 未満の分野と 3 件未満の分野は数えません。`}` })]));
  // the field mix: a bar that swings from the side's mean
  const rows = t.fields.filter((r) => r.base != null).slice(0, 9);
  if (rows.length && !t.few) {
    const m = Math.max(10, ...rows.map((r) => Math.abs(r.d)));
    out.push(o.sec(o.head('outlet.fields')), h('div', { class: 'tr-dv', role: 'img', 'aria-label': rows.map((r) => `${r.f} ${r0(r.pc)}%、平均 ${r0(r.base)}%`).join('。') },
      h('p', { class: 'tr-ax', 'aria-hidden': 'true' }, h('span'), h('span', { text: '平均より少ない' }), h('span', { text: '平均より多い' }), h('span', { text: '割合' })),
      rows.map((r) => h('div', { class: 'tr-r', 'aria-hidden': 'true' }, h('span', { class: 'tr-k', text: r.f }),
        h('span', { class: 'tr-b' }, h('i', { class: r.d < 0 ? 'lo' : 'hi', style: `--w:${((Math.abs(r.d) / m) * 50).toFixed(1)}%` })),
        h('span', { class: 'tr-v num' }, h('b', { text: `${r0(r.pc)}%` }), h('small', { text: ` 平均 ${r0(r.base)}%` }))))),
      t.fieldGate ? h('p', { class: 'tr-few tr-gate', text: gateJa(t.fieldGate, SIDE_JA[t.me.side]) }) : null);
  }
  // own-side news and the outlets alongside it: the outlet against the mean, two short rows
  const pair = (k, mine, base, unit, of) => h('div', { class: 'tr-pr' }, h('span', { class: 'tr-k', text: k }),
    h('span', { class: 'tr-g', 'aria-hidden': 'true' }, h('i', { class: 'me', style: `--w:${Math.min(100, mine).toFixed(1)}%` }), base != null ? h('i', { class: 'avg', style: `--x:${Math.min(100, base).toFixed(1)}%` }) : null),
    h('span', { class: 'tr-v num' }, h('b', { text: `${r0(mine)}${unit}` }), of ? h('small', { text: ` ${of}` }) : null, base != null ? h('small', { text: ` 平均 ${r0(base)}${unit}` }) : null));
  if (t.me.side !== 'gov') out.push(o.sec(o.head('outlet.alone'), `${t.alone.n} / ${t.alone.of}`), pair(o.head(`front.${t.me.side}`), t.alone.pc, t.alone.base, '%', `${t.alone.n} 件`));
  out.push(o.sec(o.head('outlet.agree')), h('dl', { class: 'tr-kv' },
    h('dt', { text: o.head('outlet.with') }), h('dd', { class: 'num', text: isNum(t.agree.avg) ? `1 話あたり ${t.agree.avg.toFixed(1)} 社${isNum(t.agree.base) ? `（平均 ${t.agree.base.toFixed(1)} 社）` : ''}` : '—' }),
    h('dt', { text: o.head('outlet.solo') }), h('dd', { class: 'num', text: `${t.agree.solo} 件・${r0(t.agree.soloPc)}%${isNum(t.agree.baseSolo) ? `（平均 ${r0(t.agree.baseSolo)}%）` : ''}` })));
  if (t.words.length) out.push(o.sec(o.head('outlet.words'), t.words.length), h('ul', { class: 'tr-ws' }, t.words.map((x) => h('li', null,
    h('b', { lang: /^[\x00-\x7f]+$/.test(x.w) ? 'en' : null, text: x.w }), h('span', { class: 'num', text: `${x.n} 回` }), h('small', { class: 'num', text: `ほかの社の ${x.lift >= 10 ? Math.round(x.lift) : x.lift.toFixed(1)} 倍の率` })))));
  // the reaction words per 100 headlines: 否定 to the left, 肯定 to the right, its own beside the mean
  const tm = Math.max(1, t.tone.negPer, t.tone.posPer, t.tone.baseNeg || 0, t.tone.basePos || 0);
  const tw = (v) => `--w:${((v / tm) * 100).toFixed(1)}%`;
  out.push(o.sec(o.head('outlet.tone'), `${t.tone.nNeg + t.tone.nPos} 語`), h('div', { class: 'tr-tone', role: 'img', 'aria-label': `100 本あたり 否定 ${t.tone.negPer.toFixed(1)}、肯定 ${t.tone.posPer.toFixed(1)}` },
    ...[['この社', t.tone.negPer, t.tone.posPer, 'me'], ['平均', t.tone.baseNeg, t.tone.basePos, 'avg']].filter((x) => isNum(x[1])).map(([k, n, p, c]) => h('div', { class: `tr-tr ${c}`, 'aria-hidden': 'true' },
      h('span', { class: 'tr-k', text: k }), h('b', { class: 'num', text: n.toFixed(1) }), h('span', { class: 'pp-th neg' }, h('i', { style: tw(n) })), h('span', { class: 'pp-th pos' }, h('i', { style: tw(p) })), h('b', { class: 'num', text: p.toFixed(1) }))),
    h('p', { class: 'pp-tk', 'aria-hidden': 'true' }, h('span'), h('span'), h('span', { text: '否定（見出し 100 本あたり）' }), h('span', { text: '肯定' }), h('span')),
    t.tone.neg.length + t.tone.pos.length ? h('p', { class: 'tr-tl', text: [...t.tone.neg, ...t.tone.pos].slice(0, 6).map((x) => `${x.w} ${x.n}`).join('・') } ) : null));
  // the spread of the bias index over the news it carried
  if (t.bias.n) {
    const bm = Math.max(1, ...t.bias.bins);
    out.push(o.sec(o.head('outlet.bias'), `${t.bias.n} 件`), h('div', { class: 'tr-hist', role: 'img', 'aria-label': t.bias.bins.map((n, i) => `${BIAS_BINS[i]}〜${BIAS_BINS[i + 1] - 1}: ${n} 件`).join('、') },
      t.bias.bins.map((n, i) => h('div', { class: 'tr-hb', 'aria-hidden': 'true' }, h('span', { class: 'num', text: n || '' }), h('i', { style: `--h:${((n / bm) * 100).toFixed(1)}%` }), h('small', { class: 'num', text: `${BIAS_BINS[i]}〜` })))),
      h('p', { class: 'tr-basis num', text: `中央値 ${r0(t.bias.med)}${isNum(t.bias.base) ? `・${SIDE_JA[t.me.side]}の媒体の話全体 ${r0(t.bias.base)}` : ''}` }));
  }
  // outside ratings: shown as published, with the source and the day checked; never part of the counts above
  const rs = ratingsOf(o.ratings, t.me.outlet);
  if (rs.length) {
    const src = o.ratings.sources || {}, bj = o.ratings.bias_ja || {}, fj = o.ratings.fact_ja || {};
    aside.push(o.sec(o.head('outlet.ext')), h('ul', { class: 'tr-ext' }, rs.map((r) => h('li', null,
      h('a', { href: str(r.url), target: '_blank', rel: 'noopener noreferrer', text: (src[r.src] && src[r.src].name) || r.src }),
      h('span', null, '偏り ', h('b', { text: bj[r.bias] || r.bias }), h('small', { lang: 'en', text: ` ${r.bias}` })),
      h('span', null, '事実性 ', h('b', { text: fj[r.factual] || r.factual }), h('small', { lang: 'en', text: ` ${r.factual}` })),
      h('small', { class: 'num', text: `先方の更新 ${str(r.updated)}・確かめた日 ${str(r.checked)}` }), str(r.note_ja) ? h('small', { class: 'tr-en', text: str(r.note_ja) }) : null))),
    h('p', { class: 'tr-few', text: '外部の評価は参考です。PARALLAX の数とは別に、先方のページの表記のまま載せています。' }));
  }
  out.aside = aside;   // the outside ratings: the page puts them beside the figures, never among them
  return out;
}
