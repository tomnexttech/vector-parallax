/* tidy — published wording made easier to read on screen. Nothing is rewritten in the data file; the page tidies its own copy.
 *
 *   tightJa(s) -> string          the spaces between two Japanese characters taken out; a space next to a Latin letter or a figure stays
 *   gapsJa(s) -> number           how many such spaces a text has
 *   tidyGovTitles(data, min = 3)  closes the gaps in the titles of the ministries' papers (type 政府一次) that carry `min` or more of
 *                                 them, in place, and returns how many titles it closed. Those are the gaps a page's line breaks leave
 *                                 (e-Gov: 「一 部を改正する」「及 び」). A title with one or two is left as published: the ministries and
 *                                 the outlets put a space between phrases on purpose (「上野厚生労働大臣 閣議後記者会見のお知らせ」). */
const GOV = '政府一次';
const JA = '\\u3001-\\u303f\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff01-\\uff0f\\uff1a-\\uff20\\uff3b-\\uff40\\uff5b-\\uff65';
const GAP = new RegExp(`([${JA}])[ \\u3000\\u00a0]+(?=[${JA}])`, 'gu');

export const tightJa = (s) => (typeof s === 'string' ? s.replace(GAP, '$1') : s);
export const gapsJa = (s) => (typeof s === 'string' ? (s.match(GAP) || []).length : 0);

export function tidyGovTitles(data, min = 3) {
  let n = 0;
  const each = (box) => {
    const list = Array.isArray(box) ? box : box && typeof box === 'object' ? Object.values(box) : [];
    for (const it of list) if (it && typeof it === 'object' && it.type === GOV && gapsJa(it.title) >= min) { it.title = tightJa(it.title); n += 1; }
  };
  if (data && typeof data === 'object') { each(data.items); each(data.window_items); }
  return n;
}
