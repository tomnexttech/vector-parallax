/* trans — a headline abroad in the page's language (docs/CONTRACT-public.md §13.2, 2026-11-16).
 * The build gives an item that is not Japanese `title_ja` (and `desc_ja` when the feed's own description is carried): the AI's translation.
 * On the Japanese screen it is shown in place of the headline, marked 訳 (the AI's reading, like every AI line), with the headline as
 * published one press away; the English screen and the setting 原文 (news.lang 'orig') keep the headline as published.
 *   setTrMode(mode)  'ja' (translate) | 'orig' (as published). app.js sets it from the settings and the page's language.
 *   trOf(it)        -> { text, lang, tr, orig, desc, descLang }
 *   trMark(h, t)    -> the small 訳 mark (null when not translated)
 */
const JA = /[぀-ヿ一-鿿]/;
let mode = 'ja';
const s = (v) => (typeof v === 'string' ? v.trim() : '');

export function setTrMode(m) { mode = m === 'orig' ? 'orig' : 'ja'; }
export function trMode() { return mode; }

function pageIsEnglish() {
  try { return typeof document !== 'undefined' && document.documentElement && document.documentElement.lang === 'en'; } catch { return false; }
}

/** an item's headline and description as the page shows them */
export function trOf(it, m = null) {
  const title = s(it && it.title), desc = s(it && it.desc);
  const foreign = !!title && !JA.test(title) && (!it || it.lang !== 'ja');
  const lang = foreign ? 'en' : null;
  const use = (m || mode) !== 'orig' && !pageIsEnglish() && foreign && JA.test(s(it.title_ja));
  if (!use) return { text: title, lang, tr: false, orig: null, desc, descLang: desc && !JA.test(desc) ? 'en' : null };
  const dj = s(it.desc_ja);
  return { text: s(it.title_ja), lang: null, tr: true, orig: title, desc: dj && desc ? dj : desc, descLang: dj && desc ? null : (desc && !JA.test(desc) ? 'en' : null), descOrig: dj && desc ? desc : '' };
}

/** the small mark before a translated headline; its tooltip holds the headline as published */
export function trMark(h, t) {
  return t && t.tr ? h('span', { class: 'xl-m', title: `原文: ${t.orig}`, text: '訳' }) : null;
}
