/* bias — バイアス度: how lopsided the coverage of one event is, 0 to 100, from what can be counted on this page. No DOM.
 * It measures how the event was covered, not whether anything in it is true: a high value does not mean the content is wrong.
 * No outlet carries a hand-made label of left or right, and no term comes without a measured source. A term that cannot be measured
 * is left out and the rest are averaged, with equal weight; with too few reports no number is given at all.
 *
 * Each share is held against what chance alone would give from the outlets collected, so that three domestic outlets are weak evidence
 * of a tilt and thirty are strong: a story with few outlets does not come out high merely for being small.
 *
 *   sourceBase(sources)                 -> { jp, intl, items: { jp, intl }, shares }  the outlets collected and the headlines they gave
 *   biasOf(m, { base, angles })         -> { ok: false, reason } | { ok: true, score, terms: [{ id, ja, value, formula, ai }], skipped: [{ id, ja, why }], formula }
 *     m = measure(e) of js/dossier.js; angles = Map(item id -> the AI's focus line) or null
 */
import { wordsOfTitle } from './dossier.js';

export const MIN_REPORTS = 3;
export const MIN_OUTLETS = 2;
export const TOO_FEW = '記事が少なく測れません';
export const LAG_FULL_H = 24;     // a gap of a day or more between the two sides' first reports counts in full
export const Z_FULL = 3;          // three times what chance would give counts in full
export const WORD_FULL = 0.45;    // same-language headlines sharing this much of their words count as overlapping in full (about the top tenth of the events measured on 2026-11-08)

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');
const outletOf = (it) => str(it.media) || str(it.outlet);
const pct = (x) => `${Math.round(x * 100)}%`;
const clip100 = (v) => Math.max(0, Math.min(100, v));

export function sourceBase(sources) {
  const jp = new Set(), intl = new Set(), kinds = new Map(), items = { jp: 0, intl: 0 };
  for (const r of Array.isArray(sources) ? sources : []) {
    if (!r || typeof r !== 'object') continue;
    const name = str(r.outlet) || str(r.name);
    if (!name) continue;
    const side = r.home === 'intl' ? 'intl' : 'jp';
    (side === 'intl' ? intl : jp).add(name);
    if (isNum(r.n)) items[side] += r.n;
    if (str(r.type)) kinds.set(r.type, (kinds.get(r.type) || new Set()).add(name));
  }
  const total = [...kinds.values()].reduce((a, s2) => a + s2.size, 0);
  return { jp: jp.size, intl: intl.size, items, shares: Object.fromEntries([...kinds].map(([t, s2]) => [t, s2.size / total])) };
}

const jaccard = (a, b) => {
  if (!a.size && !b.size) return null;
  let same = 0;
  for (const x of a) if (b.has(x)) same++;
  return same / (a.size + b.size - same);
};
const langOf = (it) => (str(it.lang) || (/[぀-ヿ一-鿿]/.test(str(it.title)) ? 'ja' : 'en'));

/** how far a seen share stands from the share of the whole, in units of what chance alone would give with n draws */
function againstChance(seen, ground, n) {
  const sd = Math.sqrt((ground * (1 - ground)) / n);
  return sd > 0 ? { value: clip100((Math.abs(seen - ground) / sd / Z_FULL) * 100), sd } : null;
}
function region(m, base) {
  if (!base || !(base.jp + base.intl)) return { why: '集めた媒体の数が無い' };
  const J = new Set([...m.jp, ...m.gov].map(outletOf).filter(Boolean)), X = new Set(m.intl.map(outletOf).filter(Boolean));
  const all = J.size + X.size;
  if (!all) return { why: '媒体名が無い' };
  const seen = X.size / all, ground = base.intl / (base.jp + base.intl), r = againstChance(seen, ground, all);
  if (!r) return { why: '集めた媒体が片方だけ' };
  return { value: r.value, formula: `|海外の媒体の割合 ${pct(seen)} − 集めた媒体全体の海外の割合 ${pct(ground)}| ÷ ${all}社で偶然に出る振れ ${pct(r.sd)} ÷ ${Z_FULL}（上限 100）` };
}
function kinds(m, base) {
  const shares = base && base.shares ? Object.values(base.shares) : [];
  if (shares.length < 2 || !m.n) return { why: '媒体の種類が足りない' };
  const hhi = m.types.reduce((a, t) => a + (t.n / m.n) ** 2, 0);
  // what the sum of squared shares comes to when m.n reports are drawn from the outlets collected
  const chance = 1 / m.n + (1 - 1 / m.n) * shares.reduce((a, p) => a + p * p, 0);
  return { value: clip100(((hhi - chance) / (1 - chance)) * 100), formula: `(各種類の割合の二乗の和 ${hhi.toFixed(2)} − ${m.n} 件で偶然に出る値 ${chance.toFixed(2)}) ÷ (1 − ${chance.toFixed(2)})（0 未満は 0）` };
}
function volume(m, base) {
  const J = m.jp.length, X = m.intl.length, n = J + X;
  if (!n) return { why: '国内と海外の報道が無い' };
  const tot = base && base.items ? base.items.jp + base.items.intl : 0;
  if (!tot) return { why: '集めた見出しの数が無い' };
  const ground = base.items.intl / tot, r = againstChance(X / n, ground, n);
  if (!r) return { why: '集めた見出しが片方だけ' };
  return { value: r.value, formula: `|海外の件数の割合 ${pct(X / n)}（国内 ${J}・海外 ${X}）− 集めた見出し全体の海外の割合 ${pct(ground)}| ÷ ${n} 件で偶然に出る振れ ${pct(r.sd)} ÷ ${Z_FULL}（上限 100）` };
}
function lag(m) {
  if (!isNum(m.lag)) return { why: '片方の初報の時刻が無い' };
  const h = Math.abs(m.lag) / 3600;
  return { value: clip100((h / LAG_FULL_H) * 100), formula: `国内と海外の初報の差 ${h.toFixed(1)} 時間 ÷ ${LAG_FULL_H} 時間（上限 100）` };
}
function words(m, exclude) {
  const byLang = new Map();
  for (const it of [...m.jp, ...m.gov, ...m.intl].filter((x) => str(x.title))) { const k = langOf(it); byLang.set(k, [...(byLang.get(k) || []), new Set(wordsOfTitle(it.title, exclude).map((w) => w.name))]); }
  let sum = 0, pairs = 0;
  for (const l of byLang.values()) for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) { const v = jaccard(l[i], l[j]); if (v != null) { sum += v; pairs++; } }
  if (!pairs) return { why: '同じ言語の見出しが二つ無い' };
  const mean = sum / pairs;
  return { value: clip100((1 - Math.min(1, mean / WORD_FULL)) * 100), formula: `1 − 同じ言語の見出しの組の語の重なりの平均 ${mean.toFixed(2)}（${pairs} 組）÷ ${WORD_FULL}（0 未満は 0）` };
}
// the AI writes every report's focus in Japanese, so here the two sides can be set against each other across languages
function aiFocus(m, angles) {
  if (!angles || !angles.size) return { why: 'AI の読みが無い' };
  const bag = (l) => new Set(l.flatMap((it) => wordsOfTitle(str(angles.get(it.id))).map((w) => w.name)));
  const J = bag([...m.jp, ...m.gov]), X = bag(m.intl);
  if (!J.size || !X.size) return { why: 'AI の読みが片方だけ' };
  const v = jaccard(J, X);
  return { value: clip100((1 - v) * 100), formula: `1 − 国内と海外の着目の語の重なり ${v.toFixed(2)}（AI の文から）`, ai: true };
}

export function biasOf(m, { base = null, angles = null } = {}) {
  const outlets = new Set([...m.jp, ...m.gov, ...m.intl].map(outletOf).filter(Boolean));
  if (m.n < MIN_REPORTS || outlets.size < MIN_OUTLETS) return { ok: false, reason: TOO_FEW };
  const parts = [['region', '媒体の国や地域の偏り', region(m, base)], ['kinds', '媒体の種類の偏り', kinds(m, base)], ['volume', '国内と海外の量の差', volume(m, base)],
    ['lag', '報じ始めの時刻の差', lag(m)], ['words', '見出しの語の重なりの低さ', words(m, [...outlets])], ['ai', '着目の違い', aiFocus(m, angles)]];
  const terms = parts.filter(([, , r]) => isNum(r.value)).map(([id, ja, r]) => ({ id, ja, value: Math.round(r.value), formula: r.formula, ai: !!r.ai }));
  const skipped = parts.filter(([, , r]) => !isNum(r.value)).map(([id, ja, r]) => ({ id, ja, why: r.why }));
  if (terms.length < 2) return { ok: false, reason: TOO_FEW };
  const score = Math.round(terms.reduce((a, t) => a + t.value, 0) / terms.length);
  return { ok: true, score, terms, skipped, formula: `(${terms.map((t) => t.value).join(' + ')}) ÷ ${terms.length} = ${score}` };
}
