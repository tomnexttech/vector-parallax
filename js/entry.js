/* entry — the simple view: today's events as six cards; one chosen shows the reports from Japan, from abroad and from the
 * ministries side by side, in three columns of the same width, type and colour, with the outlets not seen under them.
 * The board stays as the detailed view; one button in the bar goes from one to the other (js/app.js).
 *
 *   entryEvents(pri, n) -> events                    the priority order, events reported from both sides or by three outlets or more,
 *                                                    without the ones the visitor's settings hide
 *   sides(e) -> { jp, intl, gov }                    the reports of an event, each side in time order
 *   renderEntry(root, opt)                           opt = { h, events, sel, pick, gen, fmt: { clock, short, span }, aiTag, absent, full }
 *
 * Neutral by rule: no side gets a colour, a rank or a label of right or wrong; the headlines are shown as published, with the
 * outlet, the time, the type and the link; an empty column says only that the fetched feeds do not show one. */

export const GOV = '政府一次';
export const CARDS = 6;
export const PER_COL = 8;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v : '');
const outletOf = (it) => str(it.media) || str(it.outlet);
const byTime = (a, b) => (isNum(a.ts) ? a.ts : Infinity) - (isNum(b.ts) ? b.ts : Infinity);

export function entryEvents(pri, n = CARDS) {
  return (Array.isArray(pri) ? pri : []).filter((e) => e && !e.hid && !e.foldedInto && (e.cover === 'both' || e.n >= 3)).slice(0, n);
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

/** the line above the columns when the AI wrote none: the first report on each side, by the clock */
export function firstLine(s, clock) {
  const a = s.jp[0], b = s.intl[0];
  const part = (k, it) => (it && isNum(it.ts) ? `${k} ${outletOf(it)} ${clock(it.ts)}` : '');
  const gap = a && b && isNum(a.ts) && isNum(b.ts) ? `（差 ${Math.round(Math.abs(b.ts - a.ts) / 60)} 分）` : '';
  const ps = [part('国内', a), part('海外', b)].filter(Boolean);
  return ps.length ? `初報 ${ps.join('／')}${gap}` : '';
}

export function renderEntry(root, o) {
  const { h, events, fmt } = o;
  const sel = events.find((e) => e.key === o.sel) || events[0] || null;
  const head = h('header', { class: 'en-head' },
    h('h2', { text: '今日の出来事' }), h('span', { class: 'n', text: events.length }),
    h('button', { type: 'button', class: 'tbb', id: 'full-btn', on: { click: o.full } }, '詳しく見る'));
  const cards = h('div', { class: 'en-cards', role: 'group', 'aria-label': '今日の出来事' }, events.map((e) => {
    const s = sides(e), t = original(e);
    return h('button', { type: 'button', class: 'en-card', 'aria-pressed': String(e === sel), on: { click: () => o.pick(e.key) } },
      h('span', { class: 'en-h' }, `「${t.text}」`, t.outlet ? h('span', { class: 'en-o', text: `（${t.outlet}）` }) : null),
      h('span', { class: 'en-c' }, `国内 ${s.jp.length}・海外 ${s.intl.length}・官公庁 ${s.gov.length}`, h('span', { class: 'en-t', text: isNum(e.first) && isNum(o.gen) ? `初報から ${fmt.span(o.gen - e.first)}` : '' })),
      e.summary && str(e.summary.text_ja) ? h('span', { class: 'en-ai' }, h('span', { text: e.summary.text_ja }), o.aiTag([str(e.summary.provider), str(e.summary.model)], e.summary.made_at)) : null);
  }));
  if (!sel) { root.replaceChildren(head, h('p', { class: 'empty big', text: '出来事 0 件' })); return; }
  const s = sides(sel);
  const toAbsent = () => { const a = root.querySelector('.cb-absent'); if (a) a.scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  const col = (title, list) => h('section', { class: 'en-col' },
    h('h3', null, title, h('span', { class: 'n', text: list.length })),
    list.length ? h('ol', { class: 'en-list' }, list.slice(0, PER_COL).map((it) => {
      const link = o.safeUrl(it.link), title2 = str(it.title).trim();
      return h('li', null,
        h('span', { class: 'en-m' }, h('span', { class: 'mt', text: isNum(it.ts) ? fmt.clock(it.ts) : '—' }), h('b', { text: outletOf(it) }), h('span', { text: str(it.type) })),
        link ? h('a', { class: 'en-a', href: link, target: '_blank', rel: 'noopener noreferrer', lang: it.lang === 'en' ? 'en' : null }, title2 ? `「${title2}」` : outletOf(it))
          : h('span', { class: 'en-a', text: title2 ? `「${title2}」` : '—' }));
    })) : h('p', { class: 'en-none' }, '取得した配信には見当たりません', h('button', { type: 'button', class: 'en-to', on: { click: toAbsent } }, '見当たらない媒体へ')),
    list.length > PER_COL ? h('p', { class: 'en-rest', text: `残り ${list.length - PER_COL} 件` }) : null);
  const diff = sel.ai && str(sel.ai.contrast_ja)
    ? h('p', { class: 'en-diff' }, h('span', { text: sel.ai.contrast_ja }), o.aiTag(o.aiBy, o.aiAt))
    : firstLine(s, fmt.clock) ? h('p', { class: 'en-diff', text: firstLine(s, fmt.clock) }) : null;
  const t = original(sel);
  root.replaceChildren(head, cards,
    h('section', { class: 'en-sel', 'aria-label': '選んだ出来事' },
      h('h2', { class: 'en-st' }, `「${t.text}」`, t.outlet ? h('span', { class: 'en-o', text: `（${t.outlet}）` }) : null),
      diff,
      h('div', { class: 'en-cols' }, col('国内の報道', s.jp), col('海外の報道', s.intl), col('官公庁の資料', s.gov)),
      o.absent(sel)));
}
