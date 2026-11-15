/* samestory — one story told twice. The bundles of a fetch sometimes split one news in two (the Japanese reports in one, the reports
 * abroad in the other), and each half then shows the opposite share of the sides. Two bundles are the same story when their own
 * headlines (the AI's title in Japanese and English, else the headline the board chose) share three or more names and words, one of
 * them a specific one (a name in katakana or Latin letters, or a word of three kanji or more), and those make up at least three tenths of the
 * smaller headline's words. The smaller bundle is folded into the larger, whose reports become the union of the two, so every screen
 * counts the one story once. The reports' own headlines are not compared: they carry the outlets' names and the photo captions.
 *
 *   clean(title) -> string               the headline without the outlet after it (「 - 沖縄タイムス」「：時事ドットコム」) or the 【】 label
 *   wordsOf(titles) -> Set               the names and words of headlines: runs of katakana (3+), of Latin letters (3+), of kanji (2+)
 *   sameStory(a, b) -> boolean           a and b are Sets of wordsOf
 *   foldSame(events, { titlesOf, idOf }) -> number of folds   marks e.foldedInto on the smaller, appends its reports to the larger */

// words that every kind of news carries: they tell nothing of which story it is
const COMMON = new Set(['大統領', '首相', '政府', '日本', '米国', '中国', '韓国', '発表', '速報', '会見', '記者', '関係', '問題', '方針', '可能', '検討', '今後',
  '国内', '海外', '世界', '情報', '報道', '午前', '午後', '今日', '本日', '明日', '昨日', '画像', '写真', '動画', '映像', '記事', '時事', 'ニュース', 'ドットコム',
  'NEWS', 'THE', 'AND', 'FOR', 'WITH', 'THAT', 'FROM', 'SAYS', 'SAID', 'AFTER', 'OVER', 'INTO', 'WILL', 'HAS', 'HAVE', 'ARE', 'WAS', 'NEW', 'ITS', 'NOT', 'BUT',
  'WHAT', 'WHY', 'HOW', 'WHO', 'THIS', 'ABOUT', 'UPDATE', 'LIVE', 'LATEST', 'REPORT', 'REPORTS', 'RESULTS']);
const RUN = /[ァ-ヴー]{3,}|[A-Za-z][A-Za-z.’']{2,}|[一-鿿々]{2,}/g;
const SPECIFIC = /^(?:[ァ-ヴー]{3,}|[A-Z][A-Z.’']{2,}|[一-鿿々]{3,})$/;

export function clean(t) {
  return String(t || '').split(/\s[|｜]\s/)[0].replace(/【[^】]*】/g, ' ').replace(/\s+[-－]\s+[^-－]+$/, '').replace(/[：:]\s*時事ドットコム\s*$/, '').trim();
}

export function wordsOf(titles) {
  const out = new Set();
  for (const t of Array.isArray(titles) ? titles : [titles]) {
    if (typeof t !== 'string') continue;
    for (const m of clean(t).match(RUN) || []) {
      const w = /^[A-Za-z]/.test(m) ? m.replace(/[.’']+$/, '').replace(/[’']S$/i, '').toUpperCase() : m;
      if (w.length >= 2 && !COMMON.has(w)) out.add(w);
    }
  }
  return out;
}

export function sameStory(a, b) {
  if (!(a instanceof Set) || !(b instanceof Set) || !a.size || !b.size) return false;
  let n = 0, sp = 0;
  for (const w of a) if (b.has(w)) { n++; if (SPECIFIC.test(w)) sp++; }
  return n >= 3 && sp >= 1 && n / Math.min(a.size, b.size) >= 0.3;
}

export function foldSame(events, { titlesOf, idOf = (it) => it } = {}) {
  const es = (Array.isArray(events) ? events : []).filter((e) => e && !e.foldedInto && Array.isArray(e.members));
  if (typeof titlesOf !== 'function' || es.length < 2) return 0;
  const big = [...es].sort((x, y) => y.members.length - x.members.length);
  const words = new Map(big.map((e) => [e, wordsOf(titlesOf(e))]));
  const kept = [];
  let folds = 0;
  for (const e of big) {
    const into = kept.find((k) => sameStory(words.get(k), words.get(e)));
    if (!into) { kept.push(e); continue; }
    const have = new Set(into.members.map(idOf).filter((x) => x != null));
    const add = e.members.filter((it) => { const id = idOf(it); return id == null || !have.has(id); });
    into.members = into.members.concat(add);
    if (Array.isArray(into.ids) && Array.isArray(e.ids)) into.ids = [...new Set([...into.ids, ...e.ids])];
    e.foldedInto = into.key;
    into.sameAs = [...(into.sameAs || []), e.key];
    folds++;
  }
  return folds;
}
