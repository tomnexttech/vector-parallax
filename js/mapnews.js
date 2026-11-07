/* mapnews — the news under the map: what is reported at the place pressed on the map, or the priority list, as a sheaf of tiles;
 * and the event in focus told at the side (its whole headline, the description as quoted, its video, the related headlines), so that the
 * map can stay on the screen while it is read. The map says what was pressed through a window event, `parallax:map-select`
 * with { place, lat, lon, country }, and that a card was closed with `parallax:map-clear`.
 *
 *   newsAt(events, pick, { km, nearby, limit })     -> the events at that place, the exact place first, then by the number of outlets
 *   newsView({ events, pri, cur, picked, scope, leadKey, km, nearby }) -> { scope, pick, near, pri, list, lead }
 *   headOf(view)                                    -> the heading: the place, or the priority list when there is none
 *   createMapNews({ ... })                          -> { render(box, view) }
 * Photos come through photoOf (the simple view's photo of an event) and are shown whole. */
import { placeJa, placesIn } from './places.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');
const low = (v) => str(v).toLowerCase();

/** the headlines of an event, the only text that may say it is about a place (an outlet called 中国新聞 is not news of China) */
const titles = (e) => [e.heading && e.heading.text, ...(Array.isArray(e.members) ? e.members.map((m) => m && m.title) : [])].filter((t) => typeof t === 'string' && t);

/** a place pressed: the same name, or within the radius of a point; a country's representative point only meets that country.
 *  An event with no place of its own comes in when a headline names the place; an event that stands at another place does not */
export function newsAt(events, pick, { km = 500, nearby = null, limit = 60 } = {}) {
  if (!pick) return [];
  const place = low(pick.place);
  const known = !!place && placesIn(pick.place).length > 0;
  const pool = (events || []).filter((e) => e && !e.foldedInto && !e.hid);
  const sameName = (e) => !!place && !!e.geo && (low(e.geo.name) === place || low(e.geo.key) === place);
  const said = (e) => !!place && titles(e).some((t) => (known ? placesIn(t).some((k) => low(placeJa(k)) === place) : low(t).includes(place)));
  const near = new Set();
  if (isNum(pick.lat) && isNum(pick.lon) && !pick.country && nearby) {
    const pts = pool.filter((e) => e.geo && !e.geo.country).map((e) => ({ e, lat: e.geo.lat, lon: e.geo.lon }));
    for (const x of nearby({ lat: pick.lat, lon: pick.lon }, pts, km)) near.add(x.x.e);
  }
  const rank = (e) => (sameName(e) ? 0 : near.has(e) ? 1 : 2);
  return pool.filter((e) => sameName(e) || near.has(e) || (!e.geo && said(e)))
    .sort((a, b) => rank(a) - rank(b) || (b.n || 0) - (a.n || 0) || (b.last || 0) - (a.last || 0)).slice(0, limit);
}

/** what the section shows: a place pressed on the map (else where the event in focus stands), its list, and the event told at the side,
 *  which always stands in that list: the first of it, or the card pressed since. With no place, the priority list and the event in focus */
export function newsView({ events, pri, cur, picked, scope, leadKey, km = 500, nearby = null }) {
  const pick = picked || (cur && cur.geo ? { place: cur.geo.name, lat: cur.geo.lat, lon: cur.geo.lon, country: !!cur.geo.country } : null);
  const near = newsAt(events, pick, { km, nearby });
  const s = scope === 'pri' || !near.length ? 'pri' : 'near';
  const list = s === 'near' ? near : pri || [];
  const lead = s !== 'near' ? cur || null : near.find((e) => e.key === leadKey) || (!picked && near.includes(cur) ? cur : near[0]);
  return { scope: s, pick, near, pri: pri || [], list, lead };
}
export const headOf = (v) => (v.scope === 'near' && v.pick ? `${v.pick.place || '選んだ地点'} のニュース` : '注目のニュース');

export function createMapNews({ h, lk, headNode, ratioOf, photoOf, fmtAge, fmtClock, genreShort, onSelect, onGenre, onScope, onDetails, describe, relatedOf, videoOf }) {
  function tile(e, sel) {
    const p = photoOf(e);
    return h('li', { class: `nt${sel ? ' sel' : ''}${e.n >= 8 ? ' s3' : e.n >= 3 ? ' s2' : ''}`, data: { key: e.key }, tabindex: '0',
      on: { click: () => onSelect(e.key), keydown: (ev) => { if (ev.key === 'Enter') onSelect(e.key); } } },
      h('span', { class: 'nt-top' }, e.field ? lk(genreShort(e.field), () => onGenre(e.field), `${e.field} の出来事だけ見る`, 'gtag', { genre: e.field }) : null,
        e.geo ? h('span', { class: 'nt-pl', text: e.geo.name }) : null, h('span', { class: 'nt-ag', text: fmtAge(e.last) })),
      p ? h('span', { class: 'nt-ph' }, h('img', { src: p.url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', on: { error: (ev) => ev.target.parentElement.remove() } })) : null,
      headNode(e, 'nt-t'),
      h('span', { class: 'nt-f' }, ratioOf(e), h('b', { class: 'num', text: e.n }), h('small', { text: '媒体' })));
  }
  function aside(e) {
    const vid = videoOf(e);
    const rel = relatedOf(e);
    const play = vid ? h('button', { type: 'button', class: 'mn-v', 'aria-label': `再生 ${vid.name}「${vid.v.title}」`, on: { click: () => play.replaceWith(h('span', { class: 'mn-vf' },
      h('iframe', { src: vid.src, title: `${vid.name}「${vid.v.title}」`, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }))) } },
      h('img', { src: `https://i.ytimg.com/vi/${vid.v.id}/mqdefault.jpg`, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', on: { error: (ev) => ev.target.remove() } }),
      h('span', { class: 'mn-vn', text: vid.name })) : null;
    return h('article', { class: 'mn-sel' },
      h('div', { class: 'mn-sh' }, e.geo ? h('b', { class: 'banner', text: e.geo.name }) : null, h('span', { class: 'mn-m' }, ratioOf(e), h('b', { class: 'num', text: e.n }), h('small', { text: '媒体' })), isNum(e.last) ? h('small', { text: fmtClock(e.last) }) : null),
      h('h3', { lang: e.heading.lang || null }, headNode(e, 'mn-t')),
      describe(e), play,
      rel.length ? h('div', { class: 'mn-rel' }, h('span', { class: 'k', text: '関連の見出し' }), h('ul', null, rel.map((x) => h('li', null, lk(x.text, () => onSelect(x.key), 'この出来事を開く'))))) : null,
      h('button', { type: 'button', class: 'mn-go', on: { click: () => onDetails(e.key) } }, '詳しく見る'));
  }
  function render(box, v) {
    const head = h('header', { class: 'ph' }, h('h2', { text: headOf(v) }),
      h('span', { class: 'mn-seg', role: 'group', 'aria-label': '下の段に出すニュース' },
        h('button', { type: 'button', 'aria-pressed': String(v.scope === 'near'), disabled: v.near.length ? null : true, on: { click: () => onScope('near') } }, 'この地点', h('span', { class: 'n', text: v.near.length })),
        h('button', { type: 'button', 'aria-pressed': String(v.scope === 'pri'), on: { click: () => onScope('pri') } }, '注目', h('span', { class: 'n', text: v.pri.length }))));
    const list = v.list, e = v.lead;
    box.replaceChildren(head, h('div', { class: 'mn-b' }, e ? aside(e) : null,
      list.length ? h('ul', { class: 'mn-tiles' }, list.map((x) => tile(x, !!e && x.key === e.key))) : h('p', { class: 'empty', text: '0 件（地図の印を押すと、その地点のニュースを出す）' })));
  }
  return { render };
}
