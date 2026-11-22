/* portal — PARALLAX as one site with several ways of looking (見方). No DOM here.
 *
 *   VIEWS                                  the ways of looking, each with the pages it holds
 *   viewOfSect(sect) -> 'news'|'place'|'market'|'portal'|null
 *   pageOf(sect, screen) -> page id        the page that is open (the three screens of the news view are pages of one section, 'home')
 *   cardsOf(facts) -> [{ id, ja, lead, figure: { n, unit } | null, links }]   what the entrance shows for each view
 *   landing({ hash, search, storage, demo }) -> 'portal' | null   the entrance is the first thing a new visitor sees;
 *                                          a returning visitor goes where they last were (kept in this browser only)
 *   rememberView(storage, id) / lastView(storage)
 *
 * Neutral by rule: the entrance ranks no outlet and says nothing of the news itself; it counts what the site holds. */

export const VIEW_KEY = 'parallax.view.v1';

export const VIEWS = [
  { id: 'news', ja: 'ニュース比較', lead: '同じニュースを、国内・海外・官公庁がどう伝えたか',
    pages: [
      { id: 'home', ja: 'ホーム', sect: 'home', screen: 'home' }, { id: 'board', ja: '詳しく見る', sect: 'home', screen: 'board' }, { id: 'simple', ja: '比べる', sect: 'home', screen: 'simple' },
      { id: 'news', ja: 'ニュース', sect: 'news' }, { id: 'politics', ja: '政治', sect: 'politics' }, { id: 'video', ja: '映像', sect: 'video' },
    ] },
  { id: 'place', ja: '地域', lead: '場所から、起きている事と、その土地の話題を見る',
    pages: [{ id: 'map', ja: '地図', sect: 'map' }, { id: 'disaster', ja: '災害', sect: 'disaster' }] },
  { id: 'market', ja: '市場', lead: '金利・為替・商品と、株の過去の確率を、限界つきで読む',
    pages: [{ id: 'market', ja: '経済指標', sect: 'market' }, { id: 'stocks', ja: '株の確率', sect: 'stocks' }] },
];
const ID = new Set(VIEWS.map((v) => v.id));
const OF_SECT = new Map(VIEWS.flatMap((v) => v.pages.map((p) => [p.sect, v.id])));

export const viewOfSect = (sect) => (sect === 'portal' ? 'portal' : OF_SECT.get(sect) || null);
export function pageOf(sect, screen) {
  for (const v of VIEWS) for (const p of v.pages) if (p.sect === sect && (!p.screen || p.screen === screen)) return p.id;
  return null;
}

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export function cardsOf(facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  const fig = (v, unit) => (n(v) == null ? null : { n: v, unit });
  const figs = { news: fig(f.events, '件のニュース'), place: fig(f.quakes, '件の地震（24 時間）'), market: fig(f.series, '系列') };
  return VIEWS.map((v) => ({ id: v.id, ja: v.ja, lead: v.lead, figure: figs[v.id], links: v.pages.map((p) => ({ id: p.id, ja: p.ja, sect: p.sect, screen: p.screen || null })) }));
}

export function lastView(storage) {
  try { const v = storage && storage.getItem(VIEW_KEY); return ID.has(v) ? v : null; } catch { return null; }
}
export function rememberView(storage, id) {
  if (!ID.has(id)) return false;
  try { storage.setItem(VIEW_KEY, id); return true; } catch { return false; }
}

/** the entrance: an empty address, no event asked for, not the booth's demo, and no view kept yet; ?portal=1 always, ?portal=0 never */
export function landing({ hash = '', search = '', storage = null, demo = false } = {}) {
  const q = new URLSearchParams(search);
  if (q.get('portal') === '0') return null;
  if (q.get('portal') === '1') return 'portal';
  if (demo || String(hash || '').replace(/^#/, '')) return null;
  for (const k of ['sid', 't', 'q', 'm', 'tour', 'demo']) if (q.has(k)) return null;
  return lastView(storage) ? null : 'portal';
}
