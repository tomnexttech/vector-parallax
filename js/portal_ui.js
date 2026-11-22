/* portal_ui — the entrance page and the band of views (js/portal.js decides what is in them).
 *
 *   entrance({ h, s, cards, open }) -> [node]      the page body: one card for each view, with its figure and the pages in it
 *   viewBand({ h, views, onView, onPage }) -> { el, paint(view, page) }
 *                                                   the band under the bar: the views, and the pages of the open view
 * Keyboard: the views are a group of buttons (Tab, Enter); the pages are links to the same screens the bar had. */

const ICON = {
  news: 'M3 4.5h14v11H3zM6 8h8M6 11h8M6 14h5',
  place: 'M10 17.5s5.5-4.7 5.5-9a5.5 5.5 0 0 0-11 0c0 4.3 5.5 9 5.5 9zM10 10a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8z',
  market: 'M3 14.5l4-5 3 3 6.5-8M3 17h14',
};
const icon = (s, id) => s('svg', { viewBox: '0 0 20 20', class: 'pt-i', 'aria-hidden': 'true' }, s('path', { d: ICON[id] || ICON.news }));

export function entrance({ h, s, cards, open }) {
  return [
    h('div', { class: 'pt' },
      h('div', { class: 'pt-hd' },
        h('h2', { class: 'pt-t', text: 'Parallax' }),
        h('p', { class: 'pt-s', text: 'ニュース・地域・市場を、同じ物差しで並べて読む。' })),
      h('div', { class: 'pt-g' }, cards.map((c) => h('article', { class: 'pt-c', 'data-view': c.id },
        h('header', { class: 'pt-ch' }, icon(s, c.id), h('h3', { text: c.ja })),
        h('p', { class: 'pt-l', text: c.lead }),
        c.figure ? h('p', { class: 'pt-f' }, h('b', { class: 'num', text: c.figure.n.toLocaleString('ja-JP') }), h('span', { text: c.figure.unit })) : h('p', { class: 'pt-f' }, h('span', { text: '読み込み中' })),
        h('ul', { class: 'pt-p' }, c.links.map((l) => h('li', null, h('button', { type: 'button', class: 'pt-a', on: { click: () => open(l) } }, l.ja)))),
        h('button', { type: 'button', class: 'pt-go', on: { click: () => open(c.links[0]) } }, `${c.ja}を開く`)))),
      h('p', { class: 'pt-n', text: '数は集めたデータの数えです。出典と限界は「データ・AI」から。' })),
  ];
}

export function viewBand({ h, views, onView, onPage }) {
  const pills = h('div', { class: 'vb-v', role: 'group', 'aria-label': '見方' }, views.map((v) => h('button', { type: 'button', class: 'vb-b', 'data-view': v.id, 'aria-pressed': 'false', on: { click: () => onView(v) } }, v.ja)));
  const pages = h('div', { class: 'vb-p', role: 'group', 'aria-label': '画面' });
  const saved = h('button', { type: 'button', class: 'vb-s', on: { click: () => onPage({ sect: 'saved' }) } }, '保存');
  const el = h('nav', { class: 'vb', id: 'views', 'aria-label': '見方と画面' }, pills, pages, saved);
  function paint(view, page) {
    for (const b of pills.children) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    const v = views.find((x) => x.id === view);
    pages.replaceChildren(...(v ? v.pages.map((p) => h('button', { type: 'button', class: 'vb-pg', 'aria-current': p.id === page ? 'page' : null, on: { click: () => onPage(p) } }, p.ja)) : []));
    el.dataset.has = v ? '1' : '0';
  }
  return { el, paint };
}
