/* wall — the same events shown another way: how many at a time (js/prefs.js COUNTS) and how they are laid out (LAYOUTS). Fewer events, more of each:
 * the photo larger, the description as quoted, the outlets in a row, the related headlines and the small figures of js/dossier.js. More events,
 * the headline and the numbers only. The order, the filters and the headlines are those of the priority list; only the way of showing changes.
 *
 *   wallOn(view, floorMode)                 -> whether the wall stands in place of the single event (the whole map keeps the middle)
 *   levelOf(count)                          -> 'xl' | 'l' | 'm' | 's' | 'xs'  how much of an event a card shows
 *   perOf(count)                            -> how many at a time; 'many' is a long page
 *   pageOf(list, count, page)               -> { items, page, pages, from, to, total }
 *   pageHolding(list, key, count)           -> the page an event stands on, or null
 *   kindOf(e, m, photo, flash)              -> 'doc' | 'video' | 'flash' | 'number' | 'plain'  the shape of a card follows what it holds
 *   numberIn(text)                          -> a number with its unit as printed in a headline (never a date), or null
 *   createWall(deps)                        -> { render(box, view) }
 */
export const PER_MANY = 60;
const LEVELS = { 1: 'xl', 2: 'xl', 4: 'l', 6: 'm', 9: 's', many: 'xs' };

export const levelOf = (count) => LEVELS[count] || 'xs';
export const perOf = (count) => (count === 'many' ? PER_MANY : Math.max(1, Number(count) || 1));
export const wallOn = (view, floorMode) => floorMode !== 'map' && !!view && !(view.layout === 'board' && view.count === '1');

export function pageOf(list, count, page) {
  const l = Array.isArray(list) ? list : [], per = perOf(count);
  const pages = Math.max(1, Math.ceil(l.length / per));
  const p = Math.min(pages - 1, Math.max(0, Number.isInteger(page) ? page : 0));
  const items = l.slice(p * per, p * per + per);
  return { items, page: p, pages, from: items.length ? p * per + 1 : 0, to: p * per + items.length, total: l.length };
}

export function pageHolding(list, key, count) {
  const i = (list || []).findIndex((e) => e && e.key === key);
  return i < 0 ? null : Math.floor(i / perOf(count));
}

// a number with a unit that says how much, as printed in the headline; years, months, days and hours are not amounts
const AMOUNT = /[0-9０-９][0-9０-９,，.．]*\s*(?:兆円|億円|万円|千円|円|兆|億|万人|千人|人|万ドル|億ドル|ドル|%|％|倍|隻|機|棟|戸|基)/;
export const numberIn = (text) => { const r = AMOUNT.exec(String(text || '')); return r ? r[0] : null; };
export function kindOf(e, m, photo, flash) {
  if (m.gov.length && (m.gov.length === m.n || (m.first && m.gov.includes(m.first)))) return 'doc';   // an announcement: a ministry's paper is the source
  if (photo && photo.kind === 'video') return 'video';                                                // the broadcaster's picture leads
  if (flash && flash.new6h >= 4 && flash.sinceH <= 12) return 'flash';                                // several reports just now: only the few that stand out
  if (e && e.heading && numberIn(e.heading.text)) return 'number';
  return 'plain';
}

export function createWall({ h, lk, dossier, lineIcon, headNode, measureOf, photoOf, picsOf, fmtAge, fmtClock, genreShort, describe, relatedOf, lanes, typeWho, new6hOf, outletOf, safeUrl, extLink, biasOf, flashOf, genreIcon,
  onPress, onOpen, onGenre, onWord, onPage }) {
  const stop = (ev) => ev.stopPropagation();
  const ph = (p, cls) => (p ? h('span', { class: `nt-ph ${cls || ''}` }, h('img', { src: p.url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', on: { error: (ev) => ev.target.parentElement.remove() } })) : null);
  const sideOf = (it) => (it.type === '政府一次' ? 'gov' : it.home === 'intl' ? 'intl' : 'jp');
  // every outlet of the event, once, in the hue of its side; each goes to its own article
  function outlets(e, max) {
    const seen = new Set(), all = [];
    for (const it of [...e.members].sort((a, b) => (a.ts || Infinity) - (b.ts || Infinity))) { const n = outletOf(it); if (n && !seen.has(n)) { seen.add(n); all.push(it); } }
    const chip = (it) => { const u = safeUrl(it.link), n = outletOf(it); return u ? extLink(u, { class: 'wt-o', data: { side: sideOf(it) }, title: `${n} の記事を開く`, on: { click: stop } }, n) : h('span', { class: 'wt-o', data: { side: sideOf(it) }, text: n }); };
    return all.length ? h('div', { class: 'wt-os' }, all.slice(0, max).map(chip), all.length > max ? h('span', { class: 'wt-om', text: `ほか ${all.length - max}` }) : null) : null;
  }
  // the numbers of a card: the bar, the outlets, and at the larger sizes each side with its symbol
  function nums(e, m, level) {
    const each = (id) => (m[id].length ? h('span', { class: 'wt-k', data: { side: id } }, lineIcon(id), h('b', { class: 'num', text: m[id].length })) : null);
    return h('span', { class: 'nt-f' }, dossier.ratioBar(m), h('b', { class: 'num', text: e.n }), h('small', { text: '媒体' }),
      level === 'xs' ? null : h('span', { class: 'wt-ks' }, each('jp'), each('intl'), each('gov')),
      biasChip(e),
      level === 'xs' ? null : dossier.go('詳しく見る', () => onOpen(e.key)));
  }
  const act = (e) => ({ home: () => onOpen(e.key), type: () => onOpen(e.key), all: () => onOpen(e.key), word: onWord, absent: () => onOpen(e.key) });
  const figures = (e, m) => h('div', { class: 'figs' }, dossier.biasTile(biasOf(e)), dossier.homeTile(m, act(e)), dossier.typeTile(m, act(e), typeWho(e)), dossier.timeTile(m, lanes(e), new6hOf(e)), dossier.divergeTile(m, act(e)), dossier.overlapTile(m, act(e)));
  const biasChip = (e) => { const b = biasOf(e); return b && b.ok ? lk(dossier.biasMini(b), () => onOpen(e.key), 'バイアス度の内訳を見る', 'bi-chip') : null; };
  function related(e, max) {
    const rel = relatedOf(e).slice(0, max);
    return rel.length ? h('div', { class: 'mn-rel' }, h('span', { class: 'k', text: '関連の見出し' }), h('ul', null, rel.map((x) => h('li', null, lk(x.text, () => onPress(x.key), 'この出来事を開く'))))) : null;
  }

  function card(e, level, sel) {
    const m = measureOf(e);
    const big = level === 'xl' || level === 'l';
    const photo = level === 's' || level === 'xs' ? null : photoOf(e);
    const flash = flashOf(e), kind = kindOf(e, m, photo || (big ? photoOf(e) : null), flash);
    const say = numberIn(e.heading && e.heading.text);
    return h('li', { class: `nt wt lv-${level} k-${kind}${sel ? ' sel' : ''}${e.n >= 8 ? ' s3' : e.n >= 3 ? ' s2' : ''}${photo ? '' : ' noph'}`, data: { key: e.key }, tabindex: '0',
      on: { click: () => onPress(e.key), keydown: (ev) => { if (ev.key === 'Enter') onPress(e.key); } } },
      kind === 'flash' ? h('span', { class: 'wt-band' }, h('b', { text: '新着' }), h('b', { class: 'num', text: `+${flash.new6h}` }), h('small', { text: '6 時間' })) : null,
      kind === 'doc' ? h('span', { class: 'wt-docm' }, lineIcon('gov'), h('b', { text: '発表' }), m.first ? h('small', { text: outletOf(m.first) }) : null) : null,
      h('span', { class: 'nt-top' }, big && e.geo ? h('b', { class: 'banner', text: e.geo.name }) : e.geo ? h('span', { class: 'nt-pl', text: e.geo.name }) : null,
        e.field ? lk(genreShort(e.field), () => onGenre(e.field), `${e.field} の出来事だけ見る`, 'gtag', { genre: e.field }) : null, h('span', { class: 'nt-ag', text: fmtAge(e.last) })),
      kind === 'number' && say && level !== 'xs' ? h('b', { class: 'wt-big', text: say }) : null,
      ph(photo, kind === 'video' ? 'vid' : ''),
      headNode(e, 'nt-t'),
      big ? describe(e) : null,
      nums(e, m, level),
      level === 'xl' ? outlets(e, 24) : level === 'l' ? outlets(e, 8) : level === 'm' ? outlets(e, 4) : null,
      level === 'xl' ? figures(e, m) : level === 'l' ? h('div', { class: 'wt-fig' }, dossier.biasTile(biasOf(e)), e.members.length >= 2 ? dossier.areaSvg(m) : null) : null,
      level === 'xl' ? related(e, 4) : level === 'l' ? related(e, 3) : null);
  }

  // the main subject and the small cards round it: a thin band across the top, the counts on the left, the photos in the middle, the run of time and the two short versions on the right
  function bundle(v) {
    const e = v.main;
    if (!e) return h('p', { class: 'empty big', text: '0 件' });
    const m = measureOf(e);
    let pics = picsOf(e).slice(0, 4);
    if (!pics.length) { const p = photoOf(e); if (p) pics = [p]; }   // the still of the event's own video, when no report carries a photo
    const fig = (p) => h('figure', { class: 'bd-f' }, extLink(p.link || '#', { title: `${p.outlet} の記事を開く` }, h('img', { src: p.url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', on: { error: (ev) => ev.target.closest('figure').remove() } })),
      h('figcaption', null, h('b', { text: p.outlet }), Number.isFinite(p.ts) ? ` ${fmtClock(p.ts)}` : ''));
    const thumbs = v.strip.map((x) => { const p = photoOf(x); return h('button', { type: 'button', class: `bd-th${x.key === e.key ? ' on' : ''}`, title: x.heading.text, 'aria-label': x.heading.text, data: { genre: x.field || 'その他' }, on: { click: () => onPress(x.key) } }, p ? h('img', { src: p.url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', on: { error: (ev) => ev.target.remove() } }) : genreIcon(x.field || 'その他'), h('b', { class: 'num', text: x.n })); });
    const others = v.page.items;
    // a thin event with no photo: the headlines of its field keep the page from standing empty
    const near = pics.length ? [] : v.strip.filter((x) => x.key !== e.key && x.field === e.field).slice(0, 6);
    return h('div', { class: 'bd' },
      h('div', { class: 'dcard bd-strip' }, h('b', { class: 'bd-sk', text: '注目' }), h('b', { class: 'num bd-sn', text: v.total }), h('div', { class: 'bd-ths' }, thumbs)),
      h('div', { class: 'bd-l' }, dossier.biasTile(biasOf(e)), dossier.homeTile(m, act(e)), dossier.typeTile(m, act(e), typeWho(e))),
      h('article', { class: 'dcard bd-m' },
        h('div', { class: 'bd-mh' }, e.geo ? h('b', { class: 'banner', text: e.geo.name }) : h('b', { class: 'banner soft', text: e.field || '分野の外' }), e.geo ? h('span', { class: 'prec', text: e.geo.prec }) : null,
          e.field ? lk(e.field, () => onGenre(e.field), `${e.field} の出来事だけ見る`, 'fd', { genre: e.field }) : null, dossier.go('詳しく見る', () => onOpen(e.key))),
        h('h2', { class: 'bd-t', lang: e.heading.lang || null }, headNode(e, 'h1t')),
        pics.length ? h('div', { class: `bd-ph n${pics.length}` }, pics.map(fig)) : null,
        describe(e), outlets(e, 24), h('div', { class: 'figs bd-figs' }, dossier.divergeTile(m, act(e)), dossier.overlapTile(m, act(e))), related(e, 4),
        near.length ? h('div', { class: 'mn-rel' }, h('span', { class: 'k', text: '同じ分野の見出し' }), h('ul', null, near.map((x) => h('li', null, lk(x.heading.text, () => onPress(x.key), 'この出来事を開く'))))) : null),
      h('div', { class: 'bd-r' }, dossier.timeTile(m, lanes(e), new6hOf(e)), dossier.sides(m, v.angles(e), act(e))),
      others.length ? h('ul', { class: 'bd-o' }, others.map((x) => card(x, v.othersLevel, false))) : null);
  }

  function render(box, v) {
    const body = v.layout === 'bundle' ? bundle(v)
      : v.page.items.length ? h('ul', { class: `wg ${v.layout === 'list' ? 'wl' : ''}`, data: { n: v.count } }, v.page.items.map((e) => card(e, levelOf(v.count), !!v.cur && e.key === v.cur.key)))
        : h('p', { class: 'empty big', text: '0 件' });
    box.replaceChildren(body);
  }
  return { render };
}
