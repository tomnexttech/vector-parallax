/* entry — the simple view. One line says what the screen is for; today's events come as six cards, each with a photo the outlets
 * published (or the field's line symbol on the field's colour when none came), the field in the corner, the title and how many
 * reports each side has. The chosen event shows its photo, the AI's lines when there are any (marked AI, with the note that they can
 * be wrong), its videos, and the reports from Japan, from abroad and from the ministries side by side in three columns of the same
 * width and type, with the outlets not seen under them. The board stays as the detailed view; one button goes from one to the other.
 *
 *   entryEvents(pri, n) -> events          the priority order, events reported from both sides or by three outlets or more,
 *                                          without the ones the visitor's settings hide
 *   sides(e) -> { jp, intl, gov }          the reports of an event, each side in time order
 *   original(e) -> { text, outlet }        the headline as published and its outlet
 *   titleOf(e) -> { text, outlet, ai }     the AI's title when it wrote one (the page marks it AI), else the headline as published
 *   firstLine(s, clock) -> string          the first report on each side, by the clock
 *   renderEntry(root, opt)                 opt = { h, events, sel, pick, gen, fmt: { clock, short, span }, aiTag, aiBy, aiAt, safeUrl,
 *                                                  absent(e), full(), photo(e) -> { url, outlet, ts, link, kind?: 'video', id? } | null,
 *                                                  img(item) -> url | null, videos(e) -> stories[].videos }
 *
 * Neutral by rule: no side gets a rank or a label of right or wrong. The three sides carry a line symbol and a hue only so that a
 * card's counts lead to their column: the same weight for each, never red or green. Headlines are shown as published, with the
 * outlet, the time, the type and the link; an empty column says only that the fetched feeds do not show one. Photos are the outlets'
 * own, shown whole (never cropped), with the outlet and the time under them; the symbols are plain lines written here. */
import { genreIcon, genreShort } from './genres.js';
import { STATIONS, videosOf, playOfVideo, embedSrc } from './tv.js';

export const GOV = '政府一次';
export const CARDS = 6;
export const PER_COL = 8;
export const LEAD = '出来事を選ぶと、国内・海外・官公庁の伝え方が並びます';
export const AI_NOTE = 'AI の文は誤りうる';
export const SIDES = [['jp', '国内の報道', '国内'], ['intl', '海外の報道', '海外'], ['gov', '官公庁の資料', '官公庁']];

const SVG_NS = 'http://www.w3.org/2000/svg';
// 20 x 20, strokes only (the page sets the stroke): a house for Japan, an aeroplane for abroad, a page for the ministries' papers
const ICON = {
  jp: '<path d="M3.5 9.2L10 3.8l6.5 5.4"/><path d="M5.3 8v8.5h9.4V8"/><path d="M8.5 16.5v-4.2h3v4.2"/>',
  intl: '<path d="M10 2.8c.9 0 1.3.8 1.3 1.8v3.9l5.4 3.2v1.7l-5.4-1.7v3.1l1.9 1.4v1.3L10 16.8l-3.2.7v-1.3l1.9-1.4v-3.1l-5.4 1.7v-1.7l5.4-3.2V4.6c0-1 .4-1.8 1.3-1.8z"/>',
  gov: '<path d="M5.5 3.5h6.2l2.8 2.8v10.2h-9z"/><path d="M11.5 3.5v3h3M7.8 10h4.4M7.8 12.8h4.4"/>',
  play: '<circle cx="10" cy="10" r="7.5"/><path d="M8.4 6.9l4.5 3.1-4.5 3.1z"/>',
  up: '<path d="M10 16V4.5M5 9.5l5-5 5 5"/>',
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');
const outletOf = (it) => str(it.media) || str(it.outlet);
const byTime = (a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity);
const JA = /[぀-ヿ一-鿿]/;

export function entryEvents(pri, n = CARDS) {
  const all = (Array.isArray(pri) ? pri : []).filter((e) => e && !e.hid && !e.foldedInto && (e.cover === 'both' || e.n >= 3));
  const top = all.slice(0, n), best = pickFirst(all);
  return best && !top.includes(best) ? [...top.slice(0, n - 1), best] : top;   // the event opened first is always among the cards
}

/** the event to open first: reported by all three sides, else by two, else the first; the order of the list decides among equals */
export function pickFirst(list) {
  const es = (Array.isArray(list) ? list : []).filter(Boolean);
  const k = (e) => { const s = sides(e); return (s.jp.length > 0) + (s.intl.length > 0) + (s.gov.length > 0); };
  const rich = (l) => l.find((e) => k(e) === 3) || l.find((e) => k(e) === 2 && e.members.length >= 3);   // three reports and up can be measured
  const named = es.filter((e) => e.field && e.field !== 'その他');   // the first thing shown belongs to a field of the news
  return rich(named) || rich(es) || es.find((e) => k(e) === 2) || es[0] || null;
}

export function sides(e) {
  const ms = e && Array.isArray(e.members) ? e.members.filter((m) => m && typeof m === 'object') : [];
  const gov = ms.filter((m) => m.type === GOV).sort(byTime);
  const jp = ms.filter((m) => m.type !== GOV && m.home !== 'intl').sort(byTime);
  const intl = ms.filter((m) => m.type !== GOV && m.home === 'intl').sort(byTime);
  return { jp, intl, gov };
}

/** the headline as published and its outlet: the event's own headline when it is not the AI's, else its first titled report */
export function original(e) {
  if (e && e.heading && !e.heading.ai && !e.heading.none) return { text: e.heading.text, outlet: str(e.heading.outlet) };
  const t = e && Array.isArray(e.titled) ? [...e.titled].sort(byTime)[0] : null;
  return t ? { text: t.title, outlet: outletOf(t) } : { text: '—', outlet: '' };
}

/** the title of a card: the AI's when it wrote one (marked AI on the page), else the headline as published */
export function titleOf(e) {
  if (e && e.heading && e.heading.ai && !e.heading.none && str(e.heading.text).trim()) return { text: e.heading.text.trim(), outlet: '', ai: true };
  return { ...original(e), ai: false };
}

/** the line under the title when the AI wrote none: the first report on each side, by the clock */
export function firstLine(s, clock) {
  const a = s.jp[0], b = s.intl[0];
  const part = (k, it) => (it && isNum(it.ts) ? `${k} ${outletOf(it)} ${clock(it.ts)}` : '');
  const gap = a && b && isNum(a.ts) && isNum(b.ts) ? `（差 ${Math.round(Math.abs(b.ts - a.ts) / 60)} 分）` : '';
  const ps = [part('国内', a), part('海外', b)].filter(Boolean);
  return ps.length ? `最初に報じた ${ps.join('／')}${gap}` : '';
}

export function lineIcon(k, cls = '') {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 20 20');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', cls ? `en-i ${cls}` : 'en-i');
  s.innerHTML = ICON[k] || '';
  return s;
}

export function renderEntry(root, o) {
  const { h, events, fmt } = o;
  const sel = events.find((e) => e.key === o.sel) || pickFirst(events) || null;
  const fieldOf = (e) => str(e.field) || 'その他';
  const photo = (e) => (o.photo ? o.photo(e) : null);
  const credit = (p) => `${p.kind === 'video' ? '映像' : '写真'}：${p.outlet || '—'}${isNum(p.ts) ? `・${fmt.clock(p.ts)}` : ''}`;
  const badge = (f) => h('span', { class: 'en-g', data: { genre: f } }, genreIcon(f), genreShort(f));
  // the photo whole, or the field's symbol on its colour; a photo that does not load turns into the symbol and drops its credit
  const fig = (e, p, cls, withBadge) => {
    const f = fieldOf(e);
    return h('span', { class: `en-ph ${cls}${p ? '' : ' none'}`, data: { genre: f } },
      p ? h('img', { src: p.url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', on: { error: (ev) => {
        const box = ev.target.parentElement, c = box.nextElementSibling;
        box.classList.add('none'); ev.target.replaceWith(genreIcon(f)); if (c && c.classList.contains('en-cr')) c.remove();
      } } }) : genreIcon(f),
      withBadge ? badge(f) : null);
  };
  const titleEl = (t, cls, tag = 'span') => h(tag, { class: cls }, t.ai ? h('span', { class: 'aimk', text: 'AI' }) : null, t.ai ? t.text : `「${t.text}」`,
    !t.ai && t.outlet ? h('span', { class: 'en-o', text: `（${t.outlet}）` }) : null);
  const counts = (s, e) => h('span', { class: 'en-c' }, SIDES.map(([k, , short]) => h('span', { class: 'en-k', data: { side: k } }, lineIcon(k), short, h('b', { text: s[k].length }))),
    isNum(e.first) && isNum(o.gen) ? h('span', { class: 'en-t', text: `最初の報道から ${fmt.span(o.gen - e.first)}` }) : null);

  const head = h('header', { class: 'en-head' },
    h('div', { class: 'en-ttl' }, h('h2', null, '今日の出来事', h('span', { class: 'n', text: events.length })), h('p', { class: 'en-lead', text: LEAD })),
    h('button', { type: 'button', class: 'tbb en-full', id: 'full-btn', on: { click: o.full } }, '詳しく見る'));
  const cards = h('div', { class: 'en-cards', role: 'group', 'aria-label': '今日の出来事' }, events.map((e) => {
    const p = photo(e);
    return h('button', { type: 'button', class: 'en-card', data: { genre: fieldOf(e) }, 'aria-pressed': String(e === sel), on: { click: () => o.pick(e.key) } },
      fig(e, p, 'card', true), p ? h('span', { class: 'en-cr', text: credit(p) }) : null, titleEl(titleOf(e), 'en-h'), counts(sides(e), e));
  }));
  if (!sel) { root.replaceChildren(head, h('p', { class: 'empty big', text: '出来事 0 件' })); return; }

  const s = sides(sel), t = titleOf(sel), p = photo(sel), f = fieldOf(sel);
  const go = (q) => () => { const a = root.querySelector(q); if (a) a.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  // the AI's lines: each in its own box with who wrote it, when, and that it can be wrong
  const aiBox = (text, by, at) => h('div', { class: 'en-ai' }, h('p', { class: 'en-ai-t', text }), h('p', { class: 'en-ai-n' }, o.aiTag(by, at), h('span', { text: AI_NOTE })));
  const sm = sel.summary && str(sel.summary.text_ja).trim(), ct = sel.ai && str(sel.ai.contrast_ja).trim();
  const ais = [sm ? aiBox(sm, [str(sel.summary.provider), str(sel.summary.model)], sel.summary.made_at) : null, ct ? aiBox(ct, o.aiBy || [], o.aiAt) : null].filter(Boolean);
  const first = firstLine(s, fmt.clock);

  // the event's videos: a still and a play mark; a press puts the player in its place (muted until the visitor turns the sound on)
  const vids = videosOf(o.videos ? o.videos(sel) : [], STATIONS, 3);
  const video = (v) => {
    const st = STATIONS.find((x) => x.id === v.station), name = st ? st.name : str(v.station), ts = Number(v.ts);
    const label = `${name}「${v.title}」`;
    const play = h('button', { type: 'button', class: 'en-vb', 'aria-label': `再生 ${label}`, on: { click: () => play.replaceWith(h('span', { class: 'en-vf' },
      h('iframe', { src: embedSrc(playOfVideo(v), { auto: true, sound: false }), title: label, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }))) } },
      h('img', { src: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', on: { error: (ev) => ev.target.remove() } }),
      lineIcon('play', 'en-pi'));
    return h('div', { class: 'en-v' }, play,
      h('span', { class: 'en-m' }, h('b', { text: name }), isNum(ts) && ts > 0 ? h('span', { class: 'mt', text: fmt.clock(ts) }) : null),
      h('span', { class: 'en-vh', lang: JA.test(v.title) ? null : 'en', text: v.title }));
  };
  // the first video leads in the photo's place (a report's photo is often the same still), and plays there
  const lead = vids[0] || null, more = vids.filter((v) => v !== lead);
  const vidEl = more.length ? h('section', { class: 'en-vids', 'aria-label': '映像' },
    h('h3', { class: 'en-sub' }, lineIcon('play'), lead ? 'ほかの映像' : '映像', h('span', { class: 'n', text: more.length })), h('div', { class: 'en-vl' }, more.map(video))) : null;

  const item = (it) => {
    const link = o.safeUrl(it.link), t2 = str(it.title).trim(), d = str(it.desc).trim(), en = it.lang === 'en' ? 'en' : null, im = o.img ? o.img(it) : null;
    return h('li', { class: im ? 'has-im' : null },
      h('span', { class: 'en-m' }, h('b', { text: outletOf(it) || '—' }), str(it.type) ? h('span', { class: 'en-ty', text: it.type }) : null, h('span', { class: 'mt', text: isNum(it.ts) ? fmt.clock(it.ts) : '—' })),
      link ? h('a', { class: 'en-a', href: link, target: '_blank', rel: 'noopener noreferrer', lang: en }, t2 ? `「${t2}」` : outletOf(it))
        : h('span', { class: 'en-a', lang: en, text: t2 ? `「${t2}」` : '—' }),
      d ? h('span', { class: 'en-q', lang: en, text: `「${d}」` }) : null,
      im ? h('img', { class: 'en-th', src: im, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', on: { error: (ev) => { const li = ev.target.closest('li'); if (li) li.classList.remove('has-im'); ev.target.remove(); } } }) : null);
  };
  const col = ([k, title], list) => h('section', { class: 'en-col', data: { side: k } },
    h('h3', null, lineIcon(k), h('span', { text: title }), h('span', { class: 'n', text: list.length })),
    list.length ? h('ol', { class: 'en-list' }, list.slice(0, PER_COL).map(item))
      : h('p', { class: 'en-none' }, '集めたニュースには見当たりません', h('button', { type: 'button', class: 'en-to', on: { click: go('.cb-absent') } }, '見当たらない媒体へ')),
    list.length > PER_COL ? h('p', { class: 'en-rest', text: `残り ${list.length - PER_COL} 件` }) : null);

  root.replaceChildren(head, cards,
    h('section', { class: 'en-sel', data: { genre: f }, 'aria-label': '選んだ出来事' },
      h('button', { type: 'button', class: 'en-back', on: { click: go('.en-head') } }, lineIcon('up'), 'ほかの出来事を選ぶ'),
      h('div', { class: 'en-top' + (p || lead ? '' : ' nop') },
        lead ? h('div', { class: 'en-fig lead' }, video(lead)) : p ? h('figure', { class: 'en-fig' }, fig(sel, p, 'big', false),
          h('figcaption', { class: 'en-cr' }, p.link ? h('a', { href: p.link, target: '_blank', rel: 'noopener noreferrer', text: credit(p) }) : credit(p))) : null,
        h('div', { class: 'en-tx' }, badge(f), titleEl(t, 'en-st', 'h2'), counts(s, sel), ais, ais.length || !first ? null : h('p', { class: 'en-first', text: first }), vidEl)),
      h('div', { class: 'en-cols' }, SIDES.map((sd) => col(sd, s[sd[0]]))),
      o.absent(sel)));
}
