/* entry — the simple view. One line says what the site is; today's big news come as large cards in one strip (a row of six on a wide
 * screen, a strip under the thumb on a phone), each with a photo the outlets published (or the field's line symbol on the field's
 * colour), the field in the corner, the title, a thin bar of the share of each side and the counts. The first card is the one shown
 * under the strip. The chosen news shows how the three sides told it: three figures (the share of the reports, the first report of
 * each side by the clock and how the reports added up, the words the headlines used on both sides or on one side only), then the
 * headlines of Japan, abroad and the ministries side by side, its videos and the outlets not seen. At the end: back to the cards, and
 * the same news on the detailed screen.
 *
 *   entryEvents(pri, n) -> events          the priority order, events reported from both sides or by three outlets or more, without the
 *                                          ones the visitor's settings hide; the event opened first (pickFirst) leads
 *   sides(e) -> { jp, intl, gov }          the reports of an event, each side in time order
 *   original(e) -> { text, outlet }        the headline as published and its outlet
 *   titleOf(e) -> { text, outlet, ai }     the AI's title when it wrote one (the page marks it AI), else the headline as published
 *   firstLine(s, clock) -> string          the first report on each side, by the clock
 *   renderEntry(root, opt)                 opt = { h, events, sel, pick, gen, fmt: { clock, short, span }, aiTag, aiBy, aiAt, safeUrl,
 *                                                  absent(e), full(), detail(key, { bias }), measure(e) (js/dossier.js), bias(e) (js/bias.js),
 *                                                  dossier (ratioBar, areaSvg, biasMini), photo(e) -> { url, outlet, ts, link, kind?, id? } | null,
 *                                                  videos(e) -> stories[].videos }
 *
 * Neutral by rule: no side gets a rank or a label of right or wrong. The three sides carry a line symbol and a hue only so that a
 * card's counts lead to their column: the same weight for each, never red or green. Headlines are shown as published, with the
 * outlet, the time, the type and the link, and nothing of an article's text; a side without a report says only that the collected
 * news do not show one. Photos are the outlets' own, shown whole (never cropped), with the outlet and the time under them; the
 * symbols are plain lines written here. */
import { genreIcon, genreShort } from './genres.js';
import { STATIONS, videosOf, playOfVideo, embedSrc } from './tv.js';

export const GOV = '政府一次';
export const CARDS = 6;
export const PER_COL = 5;
export const LEAD = '同じニュースを、国内と海外のメディア、官公庁がどう伝えたか並べて比べるサイトです。';
export const HINT = 'ニュースを押すと、下に伝え方の違いが出ます';
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
  down: '<path d="M10 4v11.5M5 10.5l5 5 5-5"/>',
  right: '<path d="M7.5 4.5l5.5 5.5-5.5 5.5"/>',
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');
const outletOf = (it) => str(it.media) || str(it.outlet);
const byTime = (a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity);
const JA = /[぀-ヿ一-鿿]/;

export function entryEvents(pri, n = CARDS) {
  const all = (Array.isArray(pri) ? pri : []).filter((e) => e && !e.hid && !e.foldedInto && (e.cover === 'both' || e.n >= 3));
  const best = pickFirst(all);
  return best ? [best, ...all.filter((e) => e !== best)].slice(0, n) : all.slice(0, n);   // the event shown under the cards is the first card
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
  const sel = events.find((e) => e.key === o.sel) || events[0] || null;
  const fieldOf = (e) => str(e.field) || 'その他';
  const photo = (e) => (o.photo ? o.photo(e) : null);
  const credit = (p) => `${p.kind === 'video' ? '映像' : '写真'}：${p.outlet || '—'}${isNum(p.ts) ? `・${fmt.clock(p.ts)}` : ''}`;
  const badge = (f) => h('span', { class: 'en-g', data: { genre: f } }, genreIcon(f), genreShort(f));
  // the figures of js/dossier.js count the same three sides; without them the counts of sides(e) alone
  const meas = (e) => {
    if (o.measure) return o.measure(e);
    const x = sides(e);
    return { ...x, n: x.jp.length + x.intl.length + x.gov.length, words: { jp: [], intl: [] }, firstOf: { jp: x.jp[0] || null, intl: x.intl[0] || null, gov: x.gov[0] || null }, lag: null };
  };
  const ratio = (m) => (o.dossier ? o.dossier.ratioBar(m) : null);
  // the photo whole, or the field's symbol on its colour; a photo that does not load turns into the symbol and drops its credit
  const fig = (e, p, cls, withBadge, on) => {
    const f = fieldOf(e);
    return h('span', { class: `en-ph ${cls}${p ? '' : ' none'}`, data: { genre: f } },
      p ? h('img', { src: p.url, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', on: { error: (ev) => {
        const box = ev.target.parentElement, c = box.nextElementSibling;
        box.classList.add('none'); ev.target.replaceWith(genreIcon(f)); if (c && c.classList.contains('en-cr')) c.remove();
      } } }) : genreIcon(f),
      withBadge ? badge(f) : null, on ? h('span', { class: 'en-on', text: '表示中' }) : null);
  };
  const titleEl = (t, cls, tag = 'span') => h(tag, { class: cls }, t.ai ? h('span', { class: 'aimk', text: 'AI' }) : null, t.ai ? t.text : `「${t.text}」`,
    !t.ai && t.outlet ? h('span', { class: 'en-o', text: `（${t.outlet}）` }) : null);
  const counts = (m) => h('span', { class: 'en-c' }, SIDES.map(([k, , short]) => h('span', { class: m[k].length ? 'en-k' : 'en-k zero', data: { side: k } }, lineIcon(k), short, h('b', { text: m[k].length }))));

  const head = h('header', { class: 'en-head' },
    h('h2', null, '今日の大きなニュース', h('span', { class: 'n', text: `${events.length} 件` })),
    h('button', { type: 'button', class: 'tbb en-full', id: 'full-btn', 'aria-label': '詳しい画面へ', on: { click: o.full } }, h('span', { class: 'w', text: '詳しい画面へ' }), h('span', { class: 's', text: '詳しく' }), lineIcon('right')),
    h('p', { class: 'en-lead', text: LEAD }));
  if (!sel) { root.replaceChildren(head, h('p', { class: 'empty big', text: 'ニュース 0 件' })); return; }

  const prev = root.querySelector('.en-cards'), keep = prev ? prev.scrollLeft : null;   // the strip stays where the visitor left it
  const cards = h('div', { class: 'en-cards', role: 'group', 'aria-label': '今日の大きなニュース' }, events.map((e) => {
    const p = photo(e), m = meas(e), on = e === sel;
    return h('button', { type: 'button', class: 'en-card', data: { genre: fieldOf(e) }, 'aria-pressed': String(on), on: { click: () => o.pick(e.key) } },
      fig(e, p, 'card', true, on), p ? h('span', { class: 'en-cr', text: credit(p) }) : null, titleEl(titleOf(e), 'en-h'), h('span', { class: 'en-bar' }, ratio(m)), counts(m));
  }));
  const pick = h('section', { class: 'en-pick', 'aria-label': 'ニュースを選ぶ' }, h('p', { class: 'en-hint' }, lineIcon('down'), HINT), cards);

  const s = sides(sel), m = meas(sel), t = titleOf(sel), p = photo(sel), f = fieldOf(sel);
  const go = (q) => () => { const a = root.querySelector(q); if (a) a.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  const nOut = new Set((Array.isArray(sel.members) ? sel.members : []).filter((it) => it && typeof it === 'object').map(outletOf).filter(Boolean)).size;
  // the AI's lines: each in its own box with who wrote it, when, and that it can be wrong
  const aiBox = (text, by, at) => h('div', { class: 'en-ai' }, h('p', { class: 'en-ai-t', text }), h('p', { class: 'en-ai-n' }, o.aiTag(by, at), h('span', { text: AI_NOTE })));
  const sm = sel.summary && str(sel.summary.text_ja).trim(), ct = sel.ai && str(sel.ai.contrast_ja).trim();
  const ais = [sm ? aiBox(sm, [str(sel.summary.provider), str(sel.summary.model)], sel.summary.made_at) : null, ct ? aiBox(ct, o.aiBy || [], o.aiAt) : null].filter(Boolean);

  // ---- the three figures: only what the headlines can count; a figure without its data is left out
  const tile = (cls, title, body) => h('section', { class: `en-fg ${cls}` }, h('h4', { class: 'en-fh', text: title }), body);
  const pct = (n) => (m.n ? `${Math.round((n / m.n) * 100)}%` : '');
  const b = o.bias ? o.bias(sel) : null;
  const share = tile('fg-share', '件数の割合', h('div', { class: 'en-share' },
    h('span', { class: 'en-bigbar' }, ratio(m)),
    h('ul', { class: 'en-lg' }, SIDES.map(([k, , short]) => h('li', { class: m[k].length ? null : 'zero', data: { side: k } },
      lineIcon(k), h('span', { class: 'kl', text: short }), h('b', { class: 'num', text: m[k].length }), h('span', { class: 'u', text: '件' }), h('span', { class: 'pc num', text: pct(m[k].length) })))),
    b && b.ok && o.dossier && o.detail ? h('button', { type: 'button', class: 'en-bias', title: 'バイアス度の内訳を詳しい画面で見る', on: { click: () => o.detail(sel.key, { bias: true }) } }, o.dossier.biasMini(b), lineIcon('right')) : null));
  const firsts = SIDES.filter(([k]) => m.firstOf && m.firstOf[k]);
  const lag = isNum(m.lag) ? Math.abs(m.lag) : null;
  const area = o.dossier && o.dossier.areaSvg ? o.dossier.areaSvg(m) : null;
  const time = firsts.length ? tile('fg-time', '最初に報じた時刻', h('div', { class: 'en-time' },
    lag != null ? h('p', { class: 'en-lag' }, h('span', { class: 'k', text: '国内と海外の差' }), h('b', { class: 'num', text: lag < 60 ? '1分未満' : fmt.span(lag) }),
      h('span', { class: 'w', text: m.lag > 0 ? '海外が先' : m.lag < 0 ? '国内が先' : '同じ時刻' })) : null,
    h('ul', { class: 'en-firsts' }, SIDES.map(([k, , short]) => { const it = m.firstOf[k]; return h('li', { class: it ? null : 'zero', data: { side: k } },
      lineIcon(k), h('span', { class: 'kl', text: short }), h('b', { class: 'num', text: it ? fmt.short(it.ts) : '—' }), h('span', { class: 'o', text: it ? outletOf(it) : '' })); })),
    area ? h('figure', { class: 'en-run' }, area, h('figcaption', { text: '件数の積み上がり' })) : null)) : null;
  const wj = (m.words && m.words.jp) || [], wx = (m.words && m.words.intl) || [];
  const chip = (x) => h('span', { class: 'en-w' }, x.w, x.n > 1 ? h('small', { class: 'num', text: x.n }) : null);
  const row = (label, list, side) => (list.length ? h('div', side ? { class: 'en-wr', data: { side } } : { class: 'en-wr' },
    h('span', { class: 'k' }, side ? lineIcon(side) : null, label), h('span', { class: 'en-ws' }, list.slice(0, 6).map(chip))) : null);
  const two = s.intl.length > 0 && s.jp.length + s.gov.length > 0;
  const rows = two ? [row('共通する言葉', wj.filter((x) => x.both), null), row(s.gov.length ? '国内・官公庁だけ' : '国内だけ', wj.filter((x) => !x.both), 'jp'), row('海外だけ', wx.filter((x) => !x.both), 'intl')].filter(Boolean)
    : [row('よく出た言葉', wj.length ? wj : wx, wj.length ? 'jp' : 'intl')].filter(Boolean);
  const words = rows.length ? tile('fg-words', two ? '使った言葉の違い' : '見出しの言葉', h('div', { class: 'en-words' }, rows)) : null;

  // ---- the headlines side by side: a side without a report is one line, not an empty column
  const item = (it) => {
    const link = o.safeUrl(it.link), t2 = str(it.title).trim(), en = it.lang === 'en' ? 'en' : null;
    return h('li', null,
      h('span', { class: 'en-m' }, h('b', { text: outletOf(it) || '—' }), str(it.type) ? h('span', { class: 'en-ty', text: it.type }) : null, h('span', { class: 'mt', text: isNum(it.ts) ? fmt.clock(it.ts) : '—' })),
      link ? h('a', { class: 'en-a', href: link, target: '_blank', rel: 'noopener noreferrer', lang: en }, t2 ? `「${t2}」` : outletOf(it))
        : h('span', { class: 'en-a', lang: en, text: t2 ? `「${t2}」` : '—' }));
  };
  const has = SIDES.filter(([k]) => s[k].length), miss = SIDES.filter(([k]) => !s[k].length);
  const col = ([k, title]) => h('section', { class: 'en-col', data: { side: k } },
    h('h4', null, lineIcon(k), h('span', { text: title }), h('span', { class: 'n', text: s[k].length })),
    h('ol', { class: 'en-list' }, s[k].slice(0, PER_COL).map(item)),
    s[k].length > PER_COL && o.detail ? h('button', { type: 'button', class: 'en-rest', on: { click: () => o.detail(sel.key) } }, `残り ${s[k].length - PER_COL} 件を詳しい画面で見る`) : null);
  const missEl = miss.length ? h('p', { class: 'en-miss' }, miss.map(([k, title]) => h('span', { class: 'en-mk', data: { side: k } }, lineIcon(k), title)),
    h('span', { text: 'は、集めたニュースには見当たりません' }), h('button', { type: 'button', class: 'en-to', on: { click: go('.cb-absent') } }, '見当たらない媒体へ')) : null;

  // ---- the videos: a still and a play mark; a press puts the player in its place (muted until the visitor turns the sound on)
  const vids = videosOf(o.videos ? o.videos(sel) : [], STATIONS, 3);
  const video = (v, cls = '') => {
    const st = STATIONS.find((x) => x.id === v.station), name = st ? st.name : str(v.station), ts = Number(v.ts);
    const label = `${name}「${v.title}」`;
    const play = h('button', { type: 'button', class: 'en-vb', 'aria-label': `再生 ${label}`, on: { click: () => play.replaceWith(h('span', { class: 'en-vf' },
      h('iframe', { src: embedSrc(playOfVideo(v), { auto: true, sound: false }), title: label, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }))) } },
      h('img', { src: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', on: { error: (ev) => ev.target.remove() } }),
      lineIcon('play', 'en-pi'));
    return h('div', { class: `en-v ${cls}`.trim() }, play,
      h('span', { class: 'en-m' }, h('b', { text: name }), isNum(ts) && ts > 0 ? h('span', { class: 'mt', text: fmt.clock(ts) }) : null),
      h('span', { class: 'en-vh', lang: JA.test(v.title) ? null : 'en', text: v.title }));
  };
  // on a wide screen the first video leads beside the title (a report's photo is often the same still); on a phone it stays with the others
  const lead = vids[0] || null;
  const headFig = lead ? h('div', { class: 'en-fig lead' }, video(lead)) : p ? h('figure', { class: 'en-fig' }, fig(sel, p, 'big', false),
    h('figcaption', { class: 'en-cr' }, p.link ? h('a', { href: p.link, target: '_blank', rel: 'noopener noreferrer', text: credit(p) }) : credit(p))) : null;
  const vidEl = vids.length ? h('section', { class: `en-vids${vids.length === 1 ? ' one' : ''}`, 'aria-label': '映像' },
    h('h3', { class: 'en-sub' }, lineIcon('play'), '映像', h('span', { class: 'n', text: vids.length })),
    h('div', { class: 'en-vl' }, vids.map((v) => video(v, v === lead ? 'is-lead' : '')))) : null;

  const foot = h('div', { class: 'en-foot' },
    h('button', { type: 'button', class: 'en-btn', on: { click: go('.en-pick') } }, lineIcon('up'), 'ほかのニュースを選ぶ'),
    o.detail ? h('button', { type: 'button', class: 'en-btn pri', on: { click: () => o.detail(sel.key) } }, 'このニュースを詳しい画面で見る', lineIcon('right')) : null);

  root.replaceChildren(head, pick,
    h('section', { class: 'en-sel', data: { genre: f }, 'aria-label': '選んだニュースの伝え方' },
      h('div', { class: 'en-top' + (headFig ? '' : ' nop') },
        h('div', { class: 'en-tx' }, badge(f), titleEl(t, 'en-st', 'h2'), h('p', { class: 'en-tot', text: `${nOut} 媒体・${m.n} 件` }), ais),
        headFig),
      h('h3', { class: 'en-sub' }, '伝え方の違い'),
      h('div', { class: 'en-figs' }, share, time, words),
      h('h3', { class: 'en-sub' }, '各メディアの見出し'),
      has.length ? h('div', { class: 'en-cols', style: `--n:${has.length}` }, has.map(col)) : null,
      missEl, vidEl, o.absent(sel), foot));
  if (keep != null) cards.scrollLeft = keep;
}
