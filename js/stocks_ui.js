/* stocks_ui — the 株の確率 page of the 市場 view (js/stocks.js counts; this draws).
 *
 *   createStocks({ h, s, items, again }) -> { page() -> { big, unit, facts, body, foot } }
 *     h, s    the element helpers app.js hands over (HTML, SVG)
 *     items() the first report of each event now on the site: [{ ts, title, n, key }]
 *     again() draw the page again
 *
 * The site holds no stock prices: no source was found whose terms let a public page show them (docs/market-view.md). The series
 * here is the visitor's own file (read in this browser, sent nowhere) or a made-up sample that says so on every number. Colours:
 * a rise is green, a fall is red, always with the sign ▲ ▼ beside it; the date of the last close is on the figure, and an old one
 * is marked as old, never shown as today's. */

import { parseCsv, sampleBars, edgeOf, signalsOf, newsMoves, age, wilson, LIMITS, H, MIN_SCENES } from './stocks.js';

const pct = (v, d = 1) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(d)}%` : '—');
const share = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—');
const md = (d) => { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${Number(m[1])}/${Number(m[2])}` : '—'; };
/** the sample's own made-up headlines: a made-up price is never tied to a real headline */
const SAMPLE_ITEMS = [['2026-10-06', '見本の出来事 A'], ['2026-10-21', '見本の出来事 B'], ['2026-11-04', '見本の出来事 C'], ['2026-11-13', '見本の出来事 D']]
  .map(([d, title], i) => ({ ts: Date.parse(d + 'T03:00:00Z') / 1000, title, n: 0, key: `sample${i}` }));
const GRADE = { above: '基準より上', below: '基準より下', same: '基準と区別できない', few: '数が足りない' };

export function createStocks({ h, s, items, again }) {
  const st = { bars: null, label: '', sample: false, words: '', error: '', rejected: 0 };

  function load(text, name) {
    const r = parseCsv(text);
    st.error = r.error; st.rejected = r.rejected;
    if (!r.error) { st.bars = r.bars; st.sample = false; st.label = (name || '読み込んだ銘柄').replace(/\.[a-z0-9]+$/i, ''); }
    again();
  }
  const useSample = () => { st.bars = sampleBars(7, 2500); st.sample = true; st.label = '見本（架空の銘柄）'; st.error = ''; st.words = ''; again(); };
  const clear = () => { st.bars = null; st.sample = false; st.error = ''; st.words = ''; again(); };

  const arrow = (v) => (v > 0 ? '▲' : v < 0 ? '▼' : '＝');
  const move = (v, d = 1) => h('span', { class: 'sk-mv ' + (v > 0 ? 'up' : v < 0 ? 'dn' : 'fl') }, h('span', { 'aria-hidden': 'true', text: arrow(v) }), h('span', { class: 'num', text: pct(v, d) }));

  function chart(bars) {
    const b = bars.slice(-120), W = 640, Hh = 150;
    const vs = b.map((x) => x.c), lo = Math.min(...vs), hi = Math.max(...vs);
    const X = (i) => (i / (b.length - 1)) * W, Y = (v) => 8 + (1 - (v - lo) / ((hi - lo) || 1)) * (Hh - 16);
    const up = b[b.length - 1].c >= b[0].c;
    const d = b.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(x.c).toFixed(1)}`).join('');
    const svg = s('svg', { viewBox: `0 0 ${W} ${Hh}`, class: 'sk-chart ' + (up ? 'up' : 'dn'), role: 'img', preserveAspectRatio: 'none', 'aria-label': `直近 ${b.length} 営業日の終値。${md(b[0].d)} は ${b[0].c}、${md(b[b.length - 1].d)} は ${b[b.length - 1].c}` },
      s('path', { class: 'a', d: `${d}L${W} ${Hh}L0 ${Hh}Z` }), s('path', { class: 'l', d, 'vector-effect': 'non-scaling-stroke' }));
    b.forEach((x, i) => svg.append(s('rect', { class: 'h', x: (X(i) - W / b.length / 2).toFixed(1), y: 0, width: (W / b.length).toFixed(1), height: Hh }, s('title', {}, document.createTextNode(`${md(x.d)} ${x.c}`)))));
    return h('figure', { class: 'sk-fig' }, svg, h('figcaption', { class: 'num' }, h('span', { text: md(b[0].d) }), h('span', { text: `${lo} 〜 ${hi}` }), h('span', { text: md(b[b.length - 1].d) })));
  }

  function intro() {
    const file = h('input', { type: 'file', accept: '.csv,.txt,text/csv,text/plain', class: 'sk-file', id: 'sk-file', 'aria-label': '日足の CSV を選ぶ' });
    file.addEventListener('change', () => { const f = file.files && file.files[0]; if (!f) return; if (f.size > 2e6) { st.error = 'ファイルが大きすぎます（2 MB まで）。'; again(); return; } const r = new FileReader(); r.onload = () => load(String(r.result || ''), f.name); r.readAsText(f); });
    return h('section', { class: 'sk-in' },
      h('p', { class: 'sk-lead', text: 'このサイトは株価を持っていません。表示と再配布を認める規約を確かめられた配信元が、まだ無いためです。' }),
      h('p', { class: 'sk-sub', text: '手元の日足（日付と終値の CSV）を読み込むと、この画面の中だけで数えます。ファイルは送信も保存もしません。' }),
      h('div', { class: 'sk-act' },
        h('label', { class: 'tbb sk-pick', for: 'sk-file' }, '日足の CSV を読み込む'), file,
        h('button', { type: 'button', class: 'tbb', on: { click: useSample } }, '見本で見る（架空の値）'),
        st.bars ? h('button', { type: 'button', class: 'tbb', on: { click: clear } }, '消す') : null),
      st.error ? h('p', { class: 'sk-err', role: 'alert', text: st.error }) : null,
      st.rejected && !st.error ? h('p', { class: 'sk-sub', text: `読めなかった行が ${st.rejected} 行あります。` }) : null);
  }

  function signalsBlock(bars) {
    const e = edgeOf(bars), sg = signalsOf(bars);
    if (!e.base) return h('p', { class: 'empty', text: `日足が ${bars.length} 本です。数えるには ${60 + H} 本以上が要ります。` });
    const rows = e.rows.map((r) => {
      const now = sg.find((x) => x.id === r.id);
      const lowN = r.grade === 'few';
      return h('tr', null,
        h('td', null, h('b', { text: r.ja }), h('span', { class: 'sk-how', text: r.how }), now && now.on ? h('span', { class: 'sk-on', text: '今は当たっている' }) : null),
        h('td', { class: 'r num', 'data-l': '日数', text: String(r.days) }), h('td', { class: 'r num', 'data-l': '独立な場面', text: String(r.scenes) }),
        h('td', { class: 'r num', 'data-l': `${H} 営業日後に上がっていた割合` }, lowN ? '—' : share(r.up), lowN ? null : h('span', { class: 'sk-ci', text: ` ${share(r.ci[0])}〜${share(r.ci[1])}` })),
        h('td', { class: 'sk-g g-' + r.grade, 'data-l': '基準との比べ', text: GRADE[r.grade] }));
    });
    return [
      h('table', { class: 'dt sk-t' }, h('thead', null, h('tr', null, [['信号'], ['日数', 'r'], ['独立な場面', 'r'], [`${H} 営業日後に上がっていた割合`, 'r'], ['基準との比べ']].map(([t, c]) => h('th', { class: c || null, scope: 'col', text: t })))), h('tbody', null, rows)),
      h('p', { class: 'sk-sub num', text: `基準（どの日でも ${H} 営業日後に上がっていた割合）は ${share(e.base.up)}、${e.base.days} 日。区間は 95%（独立な場面での Wilson）。独立な場面が ${MIN_SCENES} 未満の信号は、割合を出しません。` }),
    ];
  }

  function newsBlock(bars) {
    const input = h('input', { type: 'text', class: 'sk-w', maxlength: 40, placeholder: '会社名や言葉（例: 日銀）', value: st.words, 'aria-label': 'この銘柄に結ぶ言葉', autocomplete: 'off' });
    const go = () => { st.words = input.value; again(); const el = document.getElementById('sk-w'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } };
    input.id = 'sk-w';
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
    const r = newsMoves(bars, st.sample ? SAMPLE_ITEMS : items(), st.sample ? ['見本'] : st.words.split(/[\s、,]+/));
    const body = st.sample ? [h('p', { class: 'sk-sub', text: '見本の値は、実在のニュースと結びません。ここに出る見出しも架空です。手元の CSV を読み込むと、本物の見出しと結びます。' })]
      : [h('div', { class: 'sk-wrap' }, input, h('button', { type: 'button', class: 'tbb', on: { click: go } }, '結ぶ'))];
    if (!st.sample && !st.words.trim()) body.push(h('p', { class: 'sk-sub', text: '言葉を入れると、その言葉を見出しに含むニュースが出た日の、終値の動きを数えます。' }));
    else if (!r.n) body.push(h('p', { class: 'empty', text: `「${st.words.trim()}」を含むニュースは、読み込んだ期間にありません。` }));
    else {
      body.push(h('p', { class: 'sk-sub num', text: `${r.n} 件のうち、その日の終値が前日より上がったのは ${r.up}、下がったのは ${r.down}、ほぼ変わらずが ${r.flat}。` }));
      body.push(h('ul', { class: 'sk-nl' }, r.rows.slice(0, 8).map((x) => h('li', null, h('span', { class: 'sk-nt' }, st.sample ? h('span', { class: 'sk-tag', text: '架空' }) : null, st.sample ? ' ' : null, x.title), h('span', { class: 'sk-nm num' }, h('span', { text: st.sample ? md(x.day) : `${md(x.day)}・${x.n}社` }), move(x.d1), x.d5 == null ? null : h('span', { class: 'sk-5' }, '4 日後 ', move(x.d5)))))));
    }
    body.push(h('p', { class: 'sk-sub', text: 'ニュースの日の動きを数えただけで、原因とは言えません。同じ日の別の出来事や市場全体の動きと区別できません。' }));
    return body;
  }

  function page() {
    const body = [intro()];
    let big = '—', unit = '株価のデータは未接続', facts = [['読み込み', 'なし'], ['配信元', '許諾を確認中']];
    if (st.bars) {
      const b = st.bars, last = b[b.length - 1], prev = b[b.length - 2], ag = age(b), c1 = (last.c - prev.c) / prev.c * 100;
      const c5 = b.length > 5 ? (last.c - b[b.length - 6].c) / b[b.length - 6].c * 100 : null, c20 = b.length > 20 ? (last.c - b[b.length - 21].c) / b[b.length - 21].c * 100 : null;
      big = String(last.c); unit = `${st.label}・${md(last.d)} の終値`;
      facts = [['前日比', pct(c1, 2), c1 < 0 ? 'err' : ''], ['5 営業日', pct(c5, 2)], ['20 営業日', pct(c20, 2)], ['値の日付', `${last.d}${ag.stale ? `（${ag.days} 日前・古い値）` : ''}`, ag.stale ? 'err' : ''], ['本数', `${b.length} 本`]];
      body.push(h('section', { class: 'sk-card' + (ag.stale ? ' old' : '') },
        h('header', { class: 'sk-h' }, h('div', null, h('h3', { class: 'sk-n', text: st.label }), st.sample ? h('span', { class: 'sk-tag', text: '架空の値・実在の銘柄ではありません' }) : null),
          h('div', { class: 'sk-big' }, h('b', { class: 'num', text: String(last.c) }), move(c1, 2), h('span', { class: 'sk-d num' + (ag.stale ? ' old' : ''), text: `${last.d} の終値${ag.stale ? `・${ag.days} 日前の値` : ''}` }))),
        chart(b)));
      body.push(h('h3', { class: 'ds-sec' }, '過去確率'), ...[].concat(signalsBlock(b)));
      body.push(h('h3', { class: 'ds-sec' }, 'ニュース反応'), ...newsBlock(b));
    }
    body.push(h('ul', { class: 'sk-lim' }, LIMITS.map((x) => h('li', { text: x }))));
    return { bare: true, big, unit, facts, body, foot: '判断材料の表示であり、売買の推奨ではありません。株価は読み込んだ物だけを使い、このサイトは持っていません' };
  }
  return { page, load, useSample, clear, state: st, wilson };
}
