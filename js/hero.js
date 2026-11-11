/* hero — the first card of the home: one event, the outlets of Japan and abroad as one bar split at its centre, what only one side's
 * headlines carry and what both carry, the differences in fixed sentences (findings), and three buttons.
 *
 * The card comes from data/hero.json (parallax-hero/1, docs/final-plan-20261111.md 3.5), which is small and read before latest.json.
 * When that file is missing, broken, or older than the latest.json on screen, the same choice is made here from the events on screen.
 *
 *   readHero(json) -> { picks, generated_at, latest_generated_at } | null    the file's picks, each one checked; a broken one is dropped
 *   pickHeroes(es, opt) -> picks                                            the choice of the build, made on the events on screen
 *                     opt = { sidesOf, outletOf, oneSideOf, leadPool, titleOf, sameOf(e), reactionOf(sid), max }
 *   localFindings(cov, first) -> findings | null                           only when the board carries no findings of its own (undefined)
 *   pointsOf(cov) -> { jp, intl, both }                                     the rows of the table that one side only, or both, carry
 *   splitOf(pick) -> { jp, intl, gov, max, wJp, wIntl }                     the bar: each half filled by its outlets over the larger side
 *   gapText(sec) -> '1 時間 27 分'
 *   createHero({ h, root, fmt, on }) -> { render(picks, meta), go(i), step(d), index(), current(), clear() }
 *
 * Neutral by rule: a side is never ranked or called right or wrong; the sides' hues are on the bar only. What a side's headlines do
 * not carry is said as "not in the headlines and summaries", never as "did not report". Numbers are counted values, nothing else. */

export const HERO_SCHEMA = 'parallax-hero/1';
export const MAX_PICKS = 5;
export const MAX_FINDINGS = 3;
export const FIRST_GAP_MIN_S = 30 * 60;     // a gap between the two sides' first reports shorter than this is not said (the clocks of feeds drift)
export const TIERS = ['split', 'both', 'one_side'];
export const KINDS = ['only_side', 'word_choice', 'num_diff', 'lead_differs', 'first_gap'];
export const SIDE_JA = { jp: '国内', intl: '海外', gov: '官公庁' };
export const COL_JA = { jp: '国内だけ', both: '両方', intl: '海外だけ' };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const arr = (v) => (Array.isArray(v) ? v : []);
const cnt = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const byTime = (a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity);
/** the row's own word; the row of dates is named by what it holds (いつ is the question, not a name) */
export const rowName = (r) => (r && r.t === 'いつ' ? '時期' : str(r && r.t));
const safeUrl = (u) => { if (typeof u !== 'string' || !u) return null; try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; } };

export function gapText(sec) {
  const m = Math.round(Math.abs(sec) / 60);
  if (m < 60) return `${m} 分`;
  const hh = Math.floor(m / 60), mm = m % 60;
  return mm ? `${hh} 時間 ${mm} 分` : `${hh} 時間`;
}

// ---------------------------------------------------------------- the file
function cleanFinding(f) {
  if (!isObj(f) || !KINDS.includes(f.kind) || !str(f.text).trim()) return null;
  return { kind: f.kind, row: str(f.row) || null, side: ['jp', 'intl', 'gov'].includes(f.side) ? f.side : null, text: f.text.trim().slice(0, 160),
    outlets: arr(f.outlets).filter(Number.isInteger), others: arr(f.others).filter(Number.isInteger),
    evidence: arr(f.evidence).filter(isObj).slice(0, 6).map((x) => ({ o: Number.isInteger(x.o) ? x.o : null, p: str(x.p).slice(0, 160), k: str(x.k).slice(0, 40) })) };
}
function cleanSide(x) {
  return isObj(x) ? { n: cnt(x.n), outlets: cnt(x.outlets), first_ts: isNum(x.first_ts) ? x.first_ts : null } : { n: 0, outlets: 0, first_ts: null };
}
function cleanHead(x) {
  if (!isObj(x) || !str(x.title).trim() || !['jp', 'intl', 'gov'].includes(x.side)) return null;
  return { id: str(x.id), side: x.side, outlet: str(x.outlet), ts: isNum(x.ts) ? x.ts : null, title: x.title.trim(), link: safeUrl(x.link) };
}
export function cleanSame(x) {
  if (!isObj(x)) return null;
  const words = (v) => arr(v).filter((w) => typeof w === 'string' && w).slice(0, 12);
  const link = (l) => (isObj(l) ? { a: str(l.a), b: str(l.b), sim: isNum(l.sim) ? l.sim : null, words: words(l.words), places: words(l.places), nums: words(l.nums), dt_min: isNum(l.dt_min) ? l.dt_min : null } : null);
  return {
    by: x.by === 'ai' ? 'ai' : 'rule',
    rule_groups: cnt(x.rule_groups),
    links: arr(x.links).map(link).filter(Boolean).slice(0, 6),
    ai_joined: arr(x.ai_joined).filter(isObj).slice(0, 6).map((j) => ({ cids: words(j.cids), best: link(j.best) })),
    words: words(x.words), places: words(x.places), span_s: isNum(x.span_s) ? x.span_s : null,
  };
}
function cleanPick(p) {
  if (!isObj(p) || !str(p.sid) || !TIERS.includes(p.tier) || !isObj(p.title) || !str(p.title.text).trim()) return null;
  const pts = isObj(p.points) ? p.points : {};
  const words = (v) => arr(v).filter((w) => typeof w === 'string' && w).slice(0, 8);
  const s = isObj(p.sides) ? p.sides : {};
  const out = {
    sid: p.sid, tier: p.tier,
    title: { text: p.title.text.trim(), outlet: str(p.title.outlet), lang: p.title.lang === 'en' ? 'en' : 'ja', ai: p.title.ai === true },
    sides: { jp: cleanSide(s.jp), intl: cleanSide(s.intl), gov: cleanSide(s.gov) },
    points: { jp: words(pts.jp), intl: words(pts.intl), both: words(pts.both) },
    findings: arr(p.findings).map(cleanFinding).filter(Boolean).slice(0, MAX_FINDINGS),
    heads: arr(p.heads).map(cleanHead).filter(Boolean).slice(0, 6),
    same: cleanSame(p.same),
    reaction: isObj(p.reaction) ? { hb: isNum(p.reaction.hb) ? p.reaction.hb : null, yt: isNum(p.reaction.yt) ? p.reaction.yt : null, at: isNum(p.reaction.at) ? p.reaction.at : null } : null,
    key: str(p.key) || null,
  };
  if (out.tier !== 'one_side' && !(out.sides.jp.outlets && out.sides.intl.outlets)) return null;   // a split or both card needs both sides
  return out;
}
export function readHero(j) {
  if (!isObj(j) || j.schema !== HERO_SCHEMA || !Array.isArray(j.picks)) return null;
  return { picks: j.picks.map(cleanPick).filter(Boolean).slice(0, MAX_PICKS), generated_at: isNum(j.generated_at) ? j.generated_at : null,
    latest_generated_at: isNum(j.latest_generated_at) ? j.latest_generated_at : null };
}

// ---------------------------------------------------------------- the choice, made on the page
/** the rows of the media table (CONTRACT 23) one side only carries, and the rows both carry; named by the row's own word */
export function pointsOf(cov) {
  const out = { jp: [], intl: [], both: [] };
  if (!isObj(cov) || !Array.isArray(cov.outlets) || !Array.isArray(cov.rows)) return out;
  const sideAt = cov.outlets.map((o) => (isObj(o) ? o.side : null));
  const has = { jp: sideAt.includes('jp'), intl: sideAt.includes('intl') };
  if (!has.jp || !has.intl) return out;
  for (const r of cov.rows) {
    if (!isObj(r) || !str(r.t)) continue;
    const on = new Set(arr(r.c).map((c, i) => (c ? sideAt[i] : null)).filter((x) => x === 'jp' || x === 'intl'));
    const k = on.size === 2 ? 'both' : on.has('jp') ? 'jp' : on.has('intl') ? 'intl' : null;
    const nm = rowName(r);
    if (k && !out[k].includes(nm)) out[k].push(nm);
  }
  for (const k of Object.keys(out)) out[k] = out[k].slice(0, 4);
  return out;
}

/** findings for a board that does not carry its own (the data branch writes coverage.findings; [] there means none, and is kept).
 *  Only what the table and the clocks show: a row one side carries, the word sets of the table, the gap between the first reports. */
export function localFindings(cov, first) {
  if (!isObj(cov) || !Array.isArray(cov.outlets)) return null;
  if (Array.isArray(cov.findings)) return cov.findings.map(cleanFinding).filter(Boolean).slice(0, MAX_FINDINGS);
  const out = [];
  const sideAt = cov.outlets.map((o) => (isObj(o) ? o.side : null));
  const nOf = (s) => sideAt.filter((x) => x === s).length;
  for (const r of arr(cov.rows)) {
    if (!isObj(r) || !str(r.t)) continue;
    const idx = arr(r.c).map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    const sides = new Set(idx.map((i) => sideAt[i]));
    if (sides.size !== 1) continue;
    const s = [...sides][0], o = s === 'jp' ? 'intl' : s === 'intl' ? 'jp' : null;
    if (!o || !nOf(o)) continue;
    const others = sideAt.map((x, i) => (x === o ? i : -1)).filter((i) => i >= 0);
    out.push({ kind: 'only_side', row: str(r.k) || null, side: s, outlets: idx, others,
      text: `${rowName(r)}は${SIDE_JA[s]} ${idx.length} 社が載せ、${SIDE_JA[o]} ${others.length} 社の見出しと要旨には出ていない`,
      evidence: idx.slice(0, 3).map((i) => ({ o: i, p: str(r.c[i] && r.c[i].p), k: str(r.c[i] && r.c[i].k) })) });
  }
  for (const w of arr(cov.words)) {
    if (!isObj(w) || !str(w.t)) continue;
    const vs = arr(w.v).filter((v) => isObj(v) && str(v.w) && arr(v.o).length);
    if (vs.length < 2) continue;
    out.push({ kind: 'word_choice', row: null, side: null, outlets: vs.flatMap((v) => arr(v.o).filter(Number.isInteger)), others: [],
      text: `${w.t}：${vs.map((v) => `「${v.w}」${arr(v.o).length} 社`).join('・')}`, evidence: [] });
  }
  if (isObj(first) && isNum(first.jp) && isNum(first.intl) && Math.abs(first.jp - first.intl) >= FIRST_GAP_MIN_S) {
    const [a, b] = first.jp < first.intl ? ['jp', 'intl'] : ['intl', 'jp'];
    out.push({ kind: 'first_gap', row: null, side: a, outlets: [], others: [], text: `${SIDE_JA[a]}が${SIDE_JA[b]}より ${gapText(first.jp - first.intl)}早く報じた`, evidence: [] });
  }
  const rank = (f) => KINDS.indexOf(f.kind);
  return out.sort((x, y) => rank(x) - rank(y)).slice(0, MAX_FINDINGS);
}

/** the reason the build put these headlines in one event, from the story's own basis when relations.json is not there */
export function sameFromBasis(basis) {
  if (!isObj(basis)) return null;
  return cleanSame({ by: basis.by, words: basis.words, places: basis.places, span_s: basis.time_span, links: [], ai_joined: [] });
}

/** the words of the headlines themselves for a column of the card: for each row name, the phrase one outlet of that side carries
 *  (the media table's own cell, CONTRACT 23). Without the table, or a row of that name, the name alone. */
export function phrasesOf(cov, col, names) {
  const list = arr(names).filter((n) => typeof n === 'string' && n);
  const nm = (n) => (n === 'いつ' ? '時期' : n);
  if (!isObj(cov) || !Array.isArray(cov.outlets) || !Array.isArray(cov.rows)) return list.map((name) => ({ name: nm(name), phrase: '', outlet: '' }));
  const sideAt = cov.outlets.map((o) => (isObj(o) ? o.side : null));
  return list.map((name) => {
    const r = cov.rows.find((x) => isObj(x) && (x.t === name || rowName(x) === name));
    const cells = r ? arr(r.c).map((c, i) => ({ c, i })).filter(({ c, i }) => isObj(c) && str(c.p).trim() && (col === 'both' ? sideAt[i] === 'jp' || sideAt[i] === 'intl' : sideAt[i] === col)) : [];
    const hit = cells[0];
    const o = hit && cov.outlets[hit.i];
    return { name: nm(name), phrase: hit ? str(hit.c.p).trim() : '', outlet: isObj(o) ? str(o.name) : '' };
  });
}

/** a finding as a row of dots, one dot an outlet: carried (on) or not (off), grouped by side. From the board's outlet numbers when the
 *  media table is on the page, else from the counted values of the finding's own fixed sentence. null: a finding not of this shape. */
export function dotsOf(f, cov) {
  if (!isObj(f)) return null;
  const sideAt = isObj(cov) && Array.isArray(cov.outlets) ? cov.outlets.map((o) => (isObj(o) ? o.side : null)) : null;
  const order = ['jp', 'intl', 'gov'];
  if (f.kind === 'only_side') {
    const row = sideAt && f.row ? arr(cov.rows).find((r) => isObj(r) && r.k === f.row) : null;
    const m = /^(.+?)は(?=(国内|海外|官公庁) )/.exec(f.text);
    const label = row ? rowName(row) : m ? (m[1].replace(/^「|」$/g, '') === 'いつ' ? '時期' : m[1].replace(/^「|」$/g, '')) : '';
    if (!label) return null;
    let groups = null;
    if (sideAt && (f.outlets.length || f.others.length)) {
      const on = new Set(f.outlets), all = [...new Set([...f.outlets, ...f.others])];
      groups = order.map((k) => ({ side: k, on: all.filter((i) => sideAt[i] === k && on.has(i)).length, off: all.filter((i) => sideAt[i] === k && !on.has(i)).length }));
    } else {
      const [a, b] = f.text.split('、');
      const count = (s, k) => { const x = new RegExp(`${SIDE_JA[k]} (\\d+) 社`).exec(s || ''); return x ? Number(x[1]) : 0; };
      groups = order.map((k) => ({ side: k, on: count(a, k), off: count(b, k) }));
    }
    groups = groups.filter((g) => g.on + g.off > 0);
    return groups.length ? { label, sets: [{ word: '', groups }] } : null;
  }
  if (f.kind === 'word_choice') {
    const [label, rest] = f.text.split('：');
    if (!label || !rest) return null;
    const w = sideAt ? arr(cov.words).find((x) => isObj(x) && x.t === label) : null;
    const sets = [...rest.matchAll(/「([^」]+)」(\d+) 社/g)].map(([, word, n]) => {
      const v = w ? arr(w.v).find((x) => isObj(x) && x.w === word) : null;
      if (v && arr(v.o).length) return { word, groups: order.map((k) => ({ side: k, on: arr(v.o).filter((i) => sideAt[i] === k).length, off: 0 })).filter((g) => g.on) };
      return { word, groups: [{ side: null, on: Number(n), off: 0 }] };
    });
    return sets.length ? { label, sets } : null;
  }
  return null;
}

/** the headline the card leads with: an outlet's own when the card's title was written by the AI, the AI's one sentence kept for below */
export function leadOf(p) {
  if (!isObj(p) || !isObj(p.title)) return { text: '', lang: 'ja', outlet: '', ai: '' };
  if (!p.title.ai) return { text: p.title.text, lang: p.title.lang, outlet: p.title.outlet, ai: '' };
  const hs = arr(p.heads);
  const x = hs.find((y) => y.outlet && y.outlet === p.title.outlet) || hs.find((y) => y.side === 'jp') || hs[0];
  if (!x) return { text: p.title.text, lang: p.title.lang, outlet: '', ai: '' };
  return { text: x.title, lang: /[぀-ヿ一-鿿]/.test(x.title) ? 'ja' : 'en', outlet: x.outlet, ai: p.title.text };
}

export function splitOf(p) {
  const s = isObj(p) && isObj(p.sides) ? p.sides : {};
  const jp = cnt(s.jp && s.jp.outlets), intl = cnt(s.intl && s.intl.outlets), gov = cnt(s.gov && s.gov.outlets);
  const max = Math.max(jp, intl, 1);
  return { jp, intl, gov, max, wJp: jp / max, wIntl: intl / max };
}

function pickOf(e, tier, o) {
  const s = o.sidesOf(e), outletOf = o.outletOf;
  const side = (list) => ({ n: list.length, outlets: new Set(list.map(outletOf).filter(Boolean)).size, first_ts: list.length && isNum(list[0].ts) ? list[0].ts : null });
  const sides = { jp: side(s.jp), intl: side(s.intl), gov: side(s.gov) };
  const cov = e.case && isObj(e.case.coverage) ? e.case.coverage : null;
  const t = o.titleOf(e);
  const head = (it, k) => ({ id: str(it.id), side: k, outlet: outletOf(it), ts: isNum(it.ts) ? it.ts : null, title: str(it.title).trim(), link: safeUrl(it.link) });
  const sid = e.case ? e.case.sid : e.obj && e.obj.sid ? e.obj.sid : e.key;
  return cleanPick({
    sid, key: e.key, tier,
    title: { text: t.text, outlet: t.outlet, lang: /[぀-ヿ一-鿿]/.test(t.text) ? 'ja' : 'en', ai: !!t.ai },
    sides,
    points: tier === 'one_side' ? {} : pointsOf(cov),
    findings: tier === 'one_side' ? [] : (localFindings(cov, { jp: sides.jp.first_ts, intl: sides.intl.first_ts }) || []),
    heads: ['jp', 'intl', 'gov'].flatMap((k) => s[k].filter((it) => str(it.title).trim()).slice(0, 2).map((it) => head(it, k))),
    same: typeof o.sameOf === 'function' ? o.sameOf(e) : null,
    reaction: typeof o.reactionOf === 'function' ? o.reactionOf(sid) : null,
  });
}

/** the build's choice (docs/final-plan 3.5), made on the events on screen: split = both sides with two outlets or more, a media table
 *  and a finding, by findings, then outlets, then the newest; then both = a headline on each side; then one_side = the top of the news
 *  of one side only (Japan only, abroad only). Nothing found: [] (the page keeps its home as it is). */
export function pickHeroes(es, o) {
  const max = isNum(o && o.max) ? o.max : MAX_PICKS;
  const list = arr(es).filter((e) => e && !e.hid && !e.foldedInto && Array.isArray(e.members));
  const outletOf = o.outletOf;
  const outs = (l) => new Set(l.map(outletOf).filter(Boolean)).size;
  const rows = list.map((e) => ({ e, s: o.sidesOf(e) }));
  const newest = (a, b) => (b.e.last || 0) - (a.e.last || 0);
  const seen = new Set(), picks = [];
  const add = (e, tier) => { if (picks.length >= max) return; const p = pickOf(e, tier, o); if (p && !seen.has(p.sid)) { seen.add(p.sid); picks.push(p); } };
  const split = rows.filter((r) => outs(r.s.jp) >= 2 && outs(r.s.intl) >= 2 && r.e.case && isObj(r.e.case.coverage))
    .map((r) => ({ ...r, f: arr(localFindings(r.e.case.coverage, { jp: r.s.jp[0] && r.s.jp[0].ts, intl: r.s.intl[0] && r.s.intl[0].ts })).length }))
    .filter((r) => r.f > 0)
    .sort((a, b) => b.f - a.f || (outs(b.s.jp) + outs(b.s.intl)) - (outs(a.s.jp) + outs(a.s.intl)) || newest(a, b));
  for (const r of split) add(r.e, 'split');
  const both = rows.filter((r) => r.s.jp.length && r.s.intl.length).sort((a, b) => (outs(b.s.jp) + outs(b.s.intl)) - (outs(a.s.jp) + outs(a.s.intl)) || newest(a, b));
  for (const r of both) add(r.e, 'both');
  if (picks.length < max && typeof o.oneSideOf === 'function') {
    const pool = typeof o.leadPool === 'function' ? o.leadPool(list) : list;
    const groups = o.oneSideOf(pool, { sidesOf: o.sidesOf, outletOf }).filter((g) => g.side === 'jp' || g.side === 'intl');
    const tops = groups.map((g) => g.events[0]).filter(Boolean).sort((a, b) => b.n - a.n);
    for (const e of tops) add(e, 'one_side');
  }
  return picks;
}

// ---------------------------------------------------------------- the card
export function createHero({ h, root, fmt = {}, on = {} }) {
  const clock = typeof fmt.clock === 'function' ? fmt.clock : (ts) => String(ts);
  const short = typeof fmt.short === 'function' ? fmt.short : clock;
  let picks = [], i = 0, meta = {};
  const call = (k, ...a) => (typeof on[k] === 'function' ? on[k](...a) : undefined);

  function bar(p, extra = '') {
    const sp = splitOf(p);
    const half = (k, w) => h('span', { class: 'hr-half', data: { side: k } }, h('i', { style: `width:${(w * 100).toFixed(1)}%` }));
    const lab = sp.jp && sp.intl ? `国内 ${sp.jp} 社、海外 ${sp.intl} 社` : sp.jp ? `国内 ${sp.jp} 社` : `海外 ${sp.intl} 社`;
    return h('div', { class: 'hr-split' + extra, role: 'img', 'aria-label': lab },
      h('span', { class: 'hr-n', data: { side: 'jp' } }, h('span', { class: 'k', text: '国内' }), h('b', { class: 'num', text: sp.jp }), h('span', { class: 'u', text: '社' })),
      h('span', { class: 'hr-bar', 'aria-hidden': 'true' }, half('jp', sp.wJp), h('span', { class: 'hr-mid' }), half('intl', sp.wIntl)),
      h('span', { class: 'hr-n', data: { side: 'intl' } }, h('span', { class: 'k', text: '海外' }), h('b', { class: 'num', text: sp.intl }), h('span', { class: 'u', text: '社' })));
  }
  function cols(p) {
    if (p.tier === 'split') {
      // one headline's own words a column, the names of the points small before it
      const quote = (list) => {
        const hit = list.find((x) => x.phrase && x.phrase !== x.name);
        if (!hit) return h('ul', null, list.map((x) => h('li', null, h('span', { class: 'p', text: x.name }))));
        return h('ul', null, h('li', { title: hit.outlet || null }, h('span', { class: 'k', text: list.map((x) => x.name).join('・') }), h('span', { class: 'p', text: hit.phrase })));
      };
      const col = (k) => h('div', { class: 'hr-col', data: { col: k } }, h('h3', { text: COL_JA[k] }),
        p.points[k].length ? quote(phrasesOf(p.cov, k, p.points[k])) : h('p', { class: 'hr-none', text: '—' }));
      return h('div', { class: 'hr-cols' }, col('jp'), col('both'), col('intl'));
    }
    if (p.tier === 'both') {
      const side = (k) => h('div', { class: 'hr-col hr-heads', data: { col: k } }, h('h3', { text: SIDE_JA[k] }),
        h('ul', null, p.heads.filter((x) => x.side === k).slice(0, 2).map((x) => h('li', null, h('span', { class: 'o', text: x.outlet }), h('span', { class: 't', text: x.title })))));
      return h('div', { class: 'hr-cols two' }, side('jp'), side('intl'));
    }
    const k = p.sides.jp.outlets ? 'jp' : 'intl';
    return h('div', { class: 'hr-cols one' }, h('div', { class: 'hr-col hr-heads', data: { col: k } }, h('h3', { text: COL_JA[k] }),
      h('ul', null, p.heads.filter((x) => x.side === k).slice(0, 2).map((x) => h('li', null, h('span', { class: 'o', text: x.outlet }), h('span', { class: 't', text: x.title }))))),
      h('p', { class: 'hr-note', text: on.oneSideNote || '' }));
  }
  function dots(d) {
    const g = (x) => h('span', { class: 'hr-dg', data: { side: x.side || 'n' } },
      Array.from({ length: x.on }, () => h('i', { class: 'on' })), Array.from({ length: x.off }, () => h('i', { class: 'off' })));
    return h('span', { class: 'hr-dots', 'aria-hidden': 'true' }, d.sets.map((s) => h('span', { class: 'hr-ds' }, s.word ? h('span', { class: 'w', text: `「${s.word}」` }) : null, s.groups.map(g))));
  }
  function finding(f, cov) {
    const d = dotsOf(f, cov);
    if (!d) return h('li', { data: { kind: f.kind } }, h('p', { class: 'hr-ft', text: f.text }));
    return h('li', { data: { kind: f.kind } }, h('details', { class: 'hr-fd' },
      h('summary', null, h('span', { class: 'hr-fl', text: d.label }), dots(d), h('span', { class: 'sr', text: f.text })),
      h('p', { class: 'hr-ft', 'aria-hidden': 'true', text: f.text })));
  }
  function card(p) {
    const n = picks.length;
    const old = isNum(meta.gen) && isNum(meta.now) && meta.now - meta.gen > 6 * 3600;
    const lead = leadOf(p);
    const flash = (k) => (last && last.sid === p.sid && last[k] !== p.sides[k].outlets ? ' hr-flash' : '');
    const stepBtn = (d) => h('button', { type: 'button', class: 'hr-step', 'aria-label': d < 0 ? '前の候補' : '次の候補', on: { click: () => step(d) } }, d < 0 ? '‹' : '›');
    let sx = null, sy = null;
    const swipe = n > 1 ? {
      pointerdown: (ev) => { if (ev.pointerType === 'mouse') return; sx = ev.clientX; sy = ev.clientY; },
      pointerup: (ev) => { if (sx == null) return; const dx = ev.clientX - sx, dy = ev.clientY - sy; sx = null; if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1); },
      pointercancel: () => { sx = null; },
    } : null;
    const sp = bar(p, flash('jp') || flash('intl'));
    return h('article', { class: 'hr-card', data: { tier: p.tier }, 'aria-labelledby': 'hr-t', on: swipe },
      h('div', { class: 'hr-main' },
        h('p', { class: 'hr-meta' + (old ? ' stale' : '') }, isNum(meta.gen) ? h('time', { class: 'num', text: `${short(meta.gen)} 時点` }) : null,
          lead.outlet ? h('span', { class: 'hr-src', text: lead.outlet }) : null,
          n > 1 ? h('span', { class: 'hr-pos num', 'aria-live': 'polite', text: `${i + 1} / ${n}` }) : null),
        h('div', { class: 'hr-head' + (n > 1 ? ' hr-head-nav' : '') }, n > 1 ? stepBtn(-1) : null,
          h('h2', { class: 'hr-t', id: 'hr-t', lang: lead.lang === 'en' ? 'en' : null, text: lead.text }),
          n > 1 ? stepBtn(1) : null),
        sp,
        p.sides.gov.outlets ? h('p', { class: 'hr-gov' }, h('span', { text: '官公庁' }), h('b', { class: 'num', text: p.sides.gov.outlets })) : null,
        cols(p),
        p.findings.length ? h('ul', { class: 'hr-find' }, p.findings.map((f) => finding(f, p.cov))) : null,
        lead.ai ? h('p', { class: 'hr-ai' }, h('span', { class: 'aimk', text: 'AI' }), h('span', { text: lead.ai })) : null,
        h('div', { class: 'hr-acts' },
          h('button', { type: 'button', class: 'hr-b', on: { click: () => call('open', p) } }, '元の記事'),
          h('button', { type: 'button', class: 'hr-b', on: { click: () => call('why', p) } }, '束ねた理由'),
          h('button', { type: 'button', class: 'hr-b hr-go', on: { click: () => call('compare', p) } }, '比べる'))),
      h('div', { class: 'hr-side' }, call('orbSlot', p) || null));
  }
  let last = null;
  function paint() {
    if (!root) return;
    if (!picks.length) { root.hidden = true; root.replaceChildren(); last = null; call('change', null); return; }
    root.hidden = false;
    const p = picks[i];
    root.replaceChildren(card(p));
    last = { sid: p.sid, jp: p.sides.jp.outlets, intl: p.sides.intl.outlets };
    call('change', p);
  }
  /** the first look: the card's three buttons light once, one after another (no card of words over them) */
  function cue(win) {
    const w = win || globalThis;
    const at = (k) => (root && root.querySelectorAll ? root.querySelectorAll('.hr-acts .hr-b')[k] : null);   // read each time: the card may be drawn again meanwhile
    const n = root && root.querySelectorAll ? root.querySelectorAll('.hr-acts .hr-b').length : 0;
    for (let k = 0; k < n; k++) w.setTimeout(() => { const b = at(k); if (!b) return; b.classList.remove('hr-cue'); void b.offsetWidth; b.classList.add('hr-cue'); w.setTimeout(() => { const c = at(k); if (c) c.classList.remove('hr-cue'); }, 1400); }, 350 + k * 700);
    return n;
  }
  function render(list, m = {}) { const was = picks[i] && picks[i].sid; picks = arr(list).slice(0, MAX_PICKS); meta = m || {}; const k = picks.findIndex((p) => p.sid === was); i = m.keep && k >= 0 ? k : 0; paint(); }
  function go(k) { if (!picks.length) return false; i = ((k % picks.length) + picks.length) % picks.length; paint(); return true; }
  function step(d) { return go(i + d); }
  return { render, go, step, cue, index: () => i, current: () => picks[i] || null, picks: () => picks.slice(), clear: () => render([]) };
}
