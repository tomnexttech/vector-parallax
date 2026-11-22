/* trendui — draws the model of js/trend.js under the map: a place to choose, then one quiet column of answers.
 *
 *   createTrendView({ h, headNode, genreShort, fmtAge, onScope, onOpen, onBox })  -> { render(model, ctx) } -> a node
 *
 * ctx = { places: [{ name, label, n }], daily: [{ date, events, outlets }], hasBox: boolean, text: the typed word }
 * Each part says what it counts. The part for what the public talks about (social media) is an empty slot, written as one, until a source is connected. */

import { HEAD } from './heads.js';

const num = (v) => (Number.isFinite(v) ? v : 0);
const pct = (v) => `${Math.round(v * 100)}%`;
const fixed = (v) => (v >= 10 ? String(Math.round(v)) : v.toFixed(1));

export function createTrendView({ h, headNode, genreShort, fmtAge, onScope, onOpen, onBox, sideName = { jp: '国内', intl: '海外', gov: '官公庁' } }) {
  const sec = (id, title, note, ...kids) => h('section', { class: 'pt-s', 'aria-labelledby': `pt-${id}` },
    h('h3', { id: `pt-${id}`, text: title }), note ? h('p', { class: 'pt-note', text: note }) : null, ...kids);

  function picker(ctx) {
    const input = h('input', { type: 'search', class: 'pt-in', placeholder: '都道府県・市区町村（例 大阪、渋谷区）', 'aria-label': '場所を入れる', autocomplete: 'off', spellcheck: 'false', value: ctx.text || '', maxlength: '40' });
    const go = () => onScope(input.value);
    if (ctx.refocus) setTimeout(() => input.focus({ preventScroll: true }), 0);   // the column is drawn again on each choice: the keyboard stays where it was
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
    const chips = ctx.places.length ? h('ul', { class: 'pt-chips', 'aria-label': 'ニュースの多い場所' }, ctx.places.map((p) => h('li', null,
      h('button', { type: 'button', class: 'pt-chip', on: { click: () => onScope(p.name) } }, p.label, h('span', { class: 'n', text: p.n }))))) : null;
    return h('div', { class: 'pt-pick', role: 'search', 'aria-label': '場所を選ぶ' },
      h('div', { class: 'pt-row' }, input,
        h('button', { type: 'button', class: 'pt-btn', on: { click: go } }, '調べる'),
        ctx.hasBox ? h('button', { type: 'button', class: 'pt-btn soft', on: { click: onBox } }, '地図の範囲') : null),
      chips);
  }

  function summary(m) {
    const p = m.pace;
    // a ratio of a few headlines is noise (1 against 52): it is told as a ratio only when the earlier hours hold six or more, else as the two counts
    const pace = p ? (p.ratio != null && p.prior >= 6 ? `直近 ${m.recentH} 時間は、その前の ${m.priorH} 時間の ${fixed(p.ratio)} 倍のペースです。`
      : `直近 ${m.recentH} 時間は ${p.recent} 本、その前の ${m.priorH} 時間は ${p.prior} 本です。`) : '';
    return h('header', { class: 'pt-sum' },
      h('h3', { class: 'pt-name', text: m.label }),
      h('p', { class: 'pt-facts' },
        h('b', { class: 'num', text: m.events }), '件の出来事　', h('b', { class: 'num', text: m.heads }), '本の見出し　', h('b', { class: 'num', text: m.outlets }), '社'),
      pace ? h('p', { class: 'pt-pace', text: pace }) : null);
  }

  function row(x, extra) {
    const e = x.e;
    return h('li', { class: 'pt-r' },
      h('button', { type: 'button', class: 'pt-t', on: { click: () => onOpen(e.key) } }, headNode ? headNode(e, 'pt-h') : h('span', { text: e.heading && e.heading.text })),
      h('span', { class: 'pt-m' }, e.field ? h('span', { class: 'pt-f', text: genreShort(e.field) }) : null, h('span', { class: 'num', text: `${e.n}社` }), Number.isFinite(e.last) ? h('span', { text: fmtAge(e.last) }) : null, extra || null));
  }

  function tops(m) {
    return sec('top', HEAD['trend.top'], '同じ出来事を報じた媒体の数が多い順です。',
      m.top.length ? h('ol', { class: 'pt-l' }, m.top.map((x) => row(x))) : h('p', { class: 'empty', text: '該当する出来事はありません。' }));
  }

  function risings(m) {
    const note = `直近 ${m.recentH} 時間の見出しの数を、その前の ${m.priorH} 時間と 1 時間あたりで比べています。3 本未満は数えません。`;
    if (!m.rising.length) return sec('up', HEAD['trend.up'], note, h('p', { class: 'empty', text: '目立って増えている話題はありません。' }));
    return sec('up', HEAD['trend.up'], note, h('ol', { class: 'pt-l' }, m.rising.map((x) => row(x,
      h('span', { class: 'pt-up' }, x.prior === 0 ? '新しい　' : '', '直近 ', h('b', { class: 'num', text: x.recent }), ' 本　その前 ', h('span', { class: 'num', text: `${x.prior} 本` }))))));
  }

  function fields(m) {
    if (!m.fields.length) return sec('fd', HEAD['trend.fields'], '', h('p', { class: 'empty', text: '分野を数えられる出来事がありません。' }));
    return sec('fd', HEAD['trend.fields'], '棒はこの場所の出来事の割合、細い目盛りはニュース全体の割合です。',
      h('ul', { class: 'pt-bars' }, m.fields.map((f) => h('li', { class: 'pt-bar' },
        h('span', { class: 'pt-k', text: f.field }),
        h('span', { class: 'pt-line', role: 'img', 'aria-label': `${f.field} ${pct(f.share)}、全体では ${pct(f.whole)}` },
          h('i', { class: 'pt-fill', style: `width:${Math.max(2, num(f.share) * 100)}%` }), h('i', { class: 'pt-whole', style: `left:${Math.min(100, num(f.whole) * 100)}%` })),
        h('span', { class: 'num pt-val', text: pct(f.share) })))));
  }

  function outlets(m) {
    const rows = m.outletRows.slice(0, 8);
    const s = m.sides, tot = s.jp + s.intl + s.gov;
    const split = tot ? h('p', { class: 'pt-split' }, ['jp', 'intl', 'gov'].filter((k) => s[k]).map((k) => h('span', { class: `pt-sd ${k}` }, h('i', { 'aria-hidden': 'true' }), sideName[k], h('b', { class: 'num', text: s[k] })))) : null;
    return sec('out', HEAD['trend.outlets'], '見出しの数と、その媒体の全報道に占める割合です。割合が高いほど、その媒体がこの場所を重く扱っています。', split,
      rows.length ? h('table', { class: 'pt-tb', 'aria-label': '媒体ごとの見出し数と割合' },
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: '媒体' }), h('th', { scope: 'col', class: 'r', text: '見出し' }), h('th', { scope: 'col', class: 'r', text: '全体に占める割合' }), h('th', { scope: 'col', class: 'pt-fc', text: '多い分野' }))),
        h('tbody', null, rows.map((o) => h('tr', null,
          h('th', { scope: 'row' }, h('i', { class: `pt-dot ${o.side}`, role: 'img', 'aria-label': sideName[o.side], title: sideName[o.side] }), o.name),
          h('td', { class: 'r num', text: o.n }), h('td', { class: 'r num', text: pct(o.share) }), h('td', { class: 'pt-fc', text: o.field ? genreShort(o.field) : '—' }))))) : h('p', { class: 'empty', text: '報じた媒体はありません。' }));
  }

  function daily(ctx) {
    const d = ctx.daily || [];
    if (d.length < 2) return null;
    const max = Math.max(1, ...d.map((x) => x.events));
    return sec('day', HEAD['trend.days'], 'その日の出来事のうち、この場所の名を見出しに含む物の数です。',
      h('ul', { class: 'pt-days' }, d.map((x) => h('li', { 'aria-label': `${x.date} ${x.events} 件` }, h('i', { style: `height:${Math.max(3, (x.events / max) * 100)}%` }), h('span', { class: 'num', text: x.date.slice(5).replace('-', '/') })))));
  }

  /** what the public says (Bluesky's public posts, counted in the build): numbers only, the sample told in one line, and an empty slot said as one when there is nothing */
  function open(ctx) {
    const so = ctx.social || { state: 'none' };
    const head = h('h3', { id: 'pt-pub', text: HEAD['trend.social'] });
    if (so.state !== 'row') {
      const why = so.state === 'none' ? 'SNS のデータをまだ読めていません。ビルドが次に取るまでお待ちください。'
        : so.state === 'failed' ? 'この場所の SNS のデータは、前回の取得で読めませんでした。値は作っていません。'
        : so.why === 'box' ? '地図の範囲には、SNS のデータを集めていません。都道府県・主な市と区・主な国を選ぶと出ます。'
        : 'この場所の SNS のデータは集めていません。集めているのは、都道府県、主な市と区、主な国です。';
      return h('section', { class: 'pt-s pt-slot', 'aria-labelledby': 'pt-pub' }, head, h('p', { text: why }));
    }
    const age = ctx.now && so.at ? ctx.now - so.at : 0;
    const old = age > 6 * 3600;
    const per = (n, hh) => (hh ? n / hh : 0);
    const pace = so.pace == null ? '' : so.pace >= 1 ? `1 時間あたり ${fixed(per(so.recent, so.recentH))} 件で、その前の ${fixed(so.pace)} 倍です。` : `1 時間あたり ${fixed(per(so.recent, so.recentH))} 件で、その前の ${fixed(so.pace)} 倍に減っています。`;
    const t = so.tone, tn = t.n || 0;
    const share = (k) => (tn ? t[k] / tn : 0);
    const tone = tn ? h('div', { class: 'pt-tone' },
      h('div', { class: 'pt-tbar', role: 'img', 'aria-label': `肯定 ${pct(share('pos'))}、否定 ${pct(share('neg'))}、判定なし ${pct(share('none'))}` },
        h('i', { class: 'p', style: `width:${share('pos') * 100}%` }), h('i', { class: 'g', style: `width:${share('neg') * 100}%` })),
      h('p', { class: 'pt-tleg' }, h('span', { class: 'p' }, '肯定 ', h('b', { class: 'num', text: pct(share('pos')) })), h('span', { class: 'g' }, '否定 ', h('b', { class: 'num', text: pct(share('neg')) })), h('span', { text: `判定なし ${pct(share('none'))}` })),
      h('p', { class: 'pt-note', text: so.toneNote })) : null;
    return h('section', { class: 'pt-s pt-soc', 'aria-labelledby': 'pt-pub' }, head,
      h('p', { class: 'pt-bias', text: so.bias || 'Bluesky の標本です。世論全体の縮図ではありません。' }),
      h('p', { class: 'pt-facts' }, h('b', { class: 'num', text: so.recent.toLocaleString('ja-JP') }), so.capped ? '件以上' : '件', `（直近 ${so.recentH} 時間の投稿）　その前の ${so.priorH} 時間は `, h('b', { class: 'num', text: so.prior.toLocaleString('ja-JP') }), '件'),
      pace ? h('p', { class: 'pt-pace', text: pace }) : null,
      so.terms.length ? h('div', null, h('h4', { text: HEAD['trend.words'] }), h('ul', { class: 'pt-words' }, so.terms.map((w) => h('li', null, w.term, h('span', { class: 'num', text: `${w.recent}件`, title: `その前は ${w.prior} 件・${w.authors} 人` }))))) : h('p', { class: 'empty', text: '目立って増えている言葉はありません。' }),
      tone ? h('div', null, h('h4', { text: HEAD['trend.tone'] }), tone) : null,
      h('p', { class: `pt-src${old ? ' old' : ''}`, text: `標本 ${so.sample} 件・${so.authors} 人。取得 ${ctx.fmtShort ? ctx.fmtShort(so.at) : ''}${old ? '（古い値です）' : ''}${so.precision != null && so.precision < 0.95 ? `。検索が当たった投稿のうち、この語を実際に含むのは標本の約 ${pct(so.precision)} です` : ''}` }));
  }

  function render(m, ctx) {
    const body = !m.scope ? h('p', { class: 'pt-first', text: '地図で場所を押すか、上に都道府県や市区町村を入れてください。その場所に関わるニュースの話題と動きを出します。' })
      : !m.events ? [h('h3', { class: 'pt-name', text: m.label }), h('p', { class: 'pt-first', text: `「${m.label}」を含む出来事は、今のニュースにありません。見出しにその名がある物だけを数えています。別の呼び方も試せます。` }), open(ctx)]
      : [summary(m), tops(m), risings(m), open(ctx), fields(m), outlets(m), daily(ctx)];
    return h('div', { class: 'pt' }, picker(ctx), ...[].concat(body), null);
  }
  return { render };
}
