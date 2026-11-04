/* settings_panel — the settings window: the sections on the left, their items on the right. Every change takes effect at once.
 * It draws only; js/settings.js keeps the rules and js/app.js applies the result to the board.
 *
 *   createSettingsPanel({ root, get, set, info, watch }) -> { open(section), close(), isOpen(), render() }
 *     get() -> settings          set(next) -> boolean (kept in this browser or not)
 *     info() -> { types: [[type, n]], fields: [name], outlets: [name], hidden: { n, by }, calmSystem, saved }
 *     watch: { get() -> [term], set([term]) }      the watched words travel in the same file */

import { STATIONS } from './tv.js';
import { PANES, MUTE_WORDS, MUTE_OUTLETS, NAME_LEN, KIND_JA, addTerm, removeTerm, cleanSettings, defaults, exportSettings, importSettings } from './settings.js';

const SECTIONS = [
  ['tv', '映像', '<rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="M8.5 8v4l3.4-2z"/>'],
  ['news', 'ニュース', '<rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M6 7.5h8M6 10.5h8M6 13.5h5"/>'],
  ['mute', 'ミュート', '<path d="M2.8 10s2.6-4.8 7.2-4.8 7.2 4.8 7.2 4.8-2.6 4.8-7.2 4.8S2.8 10 2.8 10z"/><circle cx="10" cy="10" r="2.1"/><path d="M4.2 15.8L15.8 4.2"/>'],
  ['motion', '動き', '<path d="M3 10h9.5M9.5 6.5L13 10l-3.5 3.5M16.5 4.5v11"/>'],
  ['panes', '盤の欄', '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M7.5 3.5v13M12.5 3.5v6.5h5"/>'],
  ['data', '保存と復元', '<path d="M10 3v9M6.5 8.5L10 12l3.5-3.5M3.5 13.5v3h13v-3"/>'],
];
const SVGNS = 'http://www.w3.org/2000/svg';

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'data') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = String(dv);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) { if (kid == null || kid === false) continue; el.append(kid instanceof Node ? kid : document.createTextNode(String(kid))); }
  return el;
}
function icon(paths) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = paths;      // fixed shapes of this file, never data
  return s;
}
const clone = (x) => JSON.parse(JSON.stringify(x));

export function createSettingsPanel({ root, get, set, info, watch }) {
  let sec = 'tv', open = false, msg = null, resetArm = 0, back = null;
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
  file.addEventListener('change', onFile);

  /** change one thing: a copy of the settings goes through fn, is cleaned, applied and kept */
  function change(fn) {
    const next = clone(get());
    fn(next);
    set(cleanSettings(next));
    render();
  }

  // ------------------------------------------------------------ controls
  const sw = (f, on, label, fn) => h('button', {
    type: 'button', role: 'switch', class: 'sw', 'aria-checked': String(!!on), 'aria-label': label, data: { f },
    on: { click: () => change((s) => fn(s, !on)) } }, h('i'));
  const seg = (f, label, value, opts, fn) => h('div', { class: 'seg', role: 'group', 'aria-label': label },
    opts.map(([v, ja]) => h('button', { type: 'button', 'aria-pressed': String(value === v), data: { f: `${f}-${v}` }, on: { click: () => change((s) => fn(s, v)) } }, ja)));
  const row = (name, desc, ctl, cls) => h('div', { class: 'set-r' + (ctl && ctl.classList && ctl.classList.contains('seg') ? ' set-segr' : '') + (cls ? ' ' + cls : '') },
    h('div', { class: 'set-l' }, h('span', { class: 'set-n', text: name }), desc ? h('span', { class: 'set-d', text: desc }) : null), h('div', { class: 'set-c' }, ctl));
  const group = (title, rows, foot, extra) => h('div', { class: 'set-g' },
    title || extra ? h('div', { class: 'set-gh' }, h('h4', { text: title || '' }), extra || null) : null,
    h('div', { class: 'set-box' }, rows), foot ? h('p', { class: 'set-gf', text: foot }) : null);

  function terms(f, list, max, ph, add, remove, listId) {
    const form = h('form', { class: 'set-add', autocomplete: 'off', on: { submit: (ev) => {
      ev.preventDefault();
      const inp = form.querySelector('input'); const v = inp.value; inp.value = '';
      if (v.trim()) change((s) => add(s, v));
      const again = root.querySelector(`[data-f="${f}-in"]`); if (again) again.focus();
    } } },
    h('input', { type: 'text', maxlength: String(NAME_LEN), placeholder: ph, 'aria-label': ph, list: listId || null, data: { f: `${f}-in` }, disabled: list.length >= max ? true : null }),
    h('button', { type: 'submit', class: 'tbb', data: { f: `${f}-add` }, disabled: list.length >= max ? true : null }, '足す'));
    const items = list.length
      ? h('ul', { class: 'set-terms' }, list.map((t, i) => h('li', null, h('span', { class: 'set-tt', text: t }),
        h('button', { type: 'button', class: 'wx', 'aria-label': `${t} を外す`, data: { f: `${f}-x-${i}` }, on: { click: () => change((s) => remove(s, t)) } }, '外す'))))
      : h('p', { class: 'set-none', text: 'なし' });
    return [h('div', { class: 'set-r set-col' }, form, items), h('div', { class: 'set-r set-cnt' }, h('span', { class: 'set-d', text: `${list.length} / ${max}` }))];
  }

  // ------------------------------------------------------------ sections
  const BODY = {
    tv(s) {
      const off = new Set(s.tv.off);
      const paneOff = s.panes.off.includes('tv');
      const st = s.tv.order.map((id) => STATIONS.find((x) => x.id === id)).filter(Boolean);
      const move = (id, d) => change((n) => { const o = n.tv.order; const i = o.indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; });
      return [
        group('', [
          row('映像の欄', paneOff ? '隠している間は読み込まない' : null, sw('tv-pane', !paneOff, '映像の欄', (n, v) => { n.panes.off = v ? n.panes.off.filter((x) => x !== 'tv') : [...n.panes.off, 'tv']; })),
          row('自動で再生', null, sw('tv-auto', s.tv.auto, '自動で再生', (n, v) => { n.tv.auto = v; })),
          row('最初の音', s.tv.sound && s.tv.auto ? '音を出すと、ブラウザが自動の再生を止めることがある' : null,
            seg('tv-sound', '最初の音', s.tv.sound ? 'on' : 'off', [['off', '消音'], ['on', '出す']], (n, v) => { n.tv.sound = v === 'on'; })),
        ]),
        group('局', st.map((x, i) => h('div', { class: 'set-r set-st' + (off.has(x.id) ? ' off' : '') },
          sw(`st-${x.id}`, !off.has(x.id), x.name, (n, v) => { n.tv.off = v ? n.tv.off.filter((y) => y !== x.id) : [...n.tv.off, x.id]; }),
          h('div', { class: 'set-l' }, h('span', { class: 'set-n', text: x.name }), h('span', { class: 'set-d', text: `${x.mode === 'live' ? 'ライブ' : '最新の動画'} · ${x.home === 'jp' ? '国内' : '海外'}` })),
          h('div', { class: 'set-mv' },
            h('button', { type: 'button', class: 'mv', 'aria-label': `${x.name} を上へ`, disabled: i === 0 ? true : null, data: { f: `up-${x.id}` }, on: { click: () => move(x.id, -1) } }, icon('<path d="M6 12l4-4 4 4"/>')),
            h('button', { type: 'button', class: 'mv', 'aria-label': `${x.name} を下へ`, disabled: i === st.length - 1 ? true : null, data: { f: `dn-${x.id}` }, on: { click: () => move(x.id, 1) } }, icon('<path d="M6 8l4 4 4-4"/>'))))),
        `出来事を選ぶと、表示する局の中から報じた局へ移る。表示 ${st.length - off.size} / ${st.length}`),
      ];
    },
    news(s, inf) {
      const tOff = new Set(s.news.types_off), fOff = new Set(s.news.fields_off);
      const allOn = (k, label, f) => h('button', { type: 'button', class: 'set-link', data: { f }, disabled: (k === 'types' ? tOff : fOff).size ? null : true,
        on: { click: () => change((n) => { n.news[`${k}_off`] = []; }) } }, label);
      return [
        group('', [
          row('最初に開く見方', '自動は AI の束ねがあれば AI。上の帯でいつでも替えられる', seg('view', '最初に開く見方', s.news.view, [['auto', '自動'], ['ai', 'AI'], ['rules', '規則']], (n, v) => { n.news.view = v; })),
          row('見出しの言語', 'AI の題が無い出来事は、報じた媒体の見出しを出す', seg('lang', '見出しの言語', s.news.lang, [['ja', '日本語'], ['en', 'English'], ['orig', '元の見出し']], (n, v) => { n.news.lang = v; })),
          row('国内と海外', '両方で報じられた出来事は常に出す', seg('scope', '国内と海外', s.news.scope, [['all', '両方'], ['jp', '国内'], ['intl', '海外']], (n, v) => { n.news.scope = v; })),
        ]),
        group('源の型', inf.types.map(([t, k]) => row(t, null, [h('span', { class: 'set-k', text: `源 ${k}` }), sw(`ty-${t}`, !tOff.has(t), t, (n, v) => { n.news.types_off = v ? n.news.types_off.filter((x) => x !== t) : [...n.news.types_off, t]; })])),
          '表示する型の源が一つでも報じた出来事は出す', allOn('types', '全て表示', 'ty-all')),
        group('分野', inf.fields.map((f) => row(f, null, sw(`fd-${f}`, !fOff.has(f), f, (n, v) => { n.news.fields_off = v ? n.news.fields_off.filter((x) => x !== f) : [...n.news.fields_off, f]; }))),
          null, allOn('fields', '全て表示', 'fd-all')),
      ];
    },
    mute(s, inf) {
      const hd = inf.hidden;
      const by = Object.entries(hd.by).filter(([, n]) => n).map(([k, n]) => `${KIND_JA[k] || k} ${n}`).join(' · ');
      return [
        h('p', { class: 'set-lead' }, h('span', { text: '当たった出来事は一覧と地図から外し、上の帯に数を出す。注目の行は札だけ残して畳む。' }),
          h('b', { class: 'num', text: ` いま ${hd.n} 件` }), by ? h('span', { class: 'set-by', text: `（${by}）` }) : null),
        group('語', terms('mw', s.mute.words, MUTE_WORDS, '見出しに含む語', (n, v) => { n.mute.words = addTerm(n.mute.words, v, MUTE_WORDS); }, (n, t) => { n.mute.words = removeTerm(n.mute.words, t); }),
          '全角と半角、大文字と小文字は同じに扱う'),
        group('媒体', terms('mo', s.mute.outlets, MUTE_OUTLETS, '媒体の名', (n, v) => { n.mute.outlets = addTerm(n.mute.outlets, v, MUTE_OUTLETS, NAME_LEN); }, (n, t) => { n.mute.outlets = removeTerm(n.mute.outlets, t); }, 'set-outlets'),
          '隠すのは、その媒体だけが報じた出来事。他も報じた出来事は残す'),
        h('datalist', { id: 'set-outlets' }, inf.outlets.map((o) => h('option', { value: o }))),
        h('p', { class: 'set-gf' }, '分野と源の型は ', h('button', { type: 'button', class: 'set-link', data: { f: 'go-news' }, on: { click: () => go('news') } }, 'ニュース'), ' で選ぶ'),
      ];
    },
    motion(s, inf) {
      return [
        group('', [
          row('出来事の自動切替', '12 秒ごとに注目の次の出来事へ。触れている間は止まる', sw('m-cases', s.motion.cases, '出来事の自動切替', (n, v) => { n.motion.cases = v; })),
          row('一覧の自動送り', '見切れる一覧をゆっくり送る', sw('m-scroll', s.motion.scroll, '一覧の自動送り', (n, v) => { n.motion.scroll = v; })),
          row('動きを減らす', `この端末は動きを${inf.calmSystem ? '減らす' : '減らさない'}設定`, seg('m-calm', '動きを減らす', s.motion.calm, [['system', 'システムに従う'], ['on', '常に減らす']], (n, v) => { n.motion.calm = v; })),
        ], '動きを減らすと、自動の送りと切替の動き、地図の移動の動きを止める'),
      ];
    },
    panes(s) {
      const off = new Set(s.panes.off);
      return [group('', PANES.map(([id, ja]) => row(ja, id === 'tv' ? '隠している間は読み込まない' : null,
        sw(`p-${id}`, !off.has(id), ja, (n, v) => { n.panes.off = v ? n.panes.off.filter((x) => x !== id) : [...n.panes.off, id]; }))), '出来事と注目の欄は常に出す')];
    },
    data() {
      const armed = Date.now() < resetArm;
      return [
        group('', [
          row('書き出す', '設定と追う語を一つの JSON に', h('button', { type: 'button', class: 'tbb', data: { f: 'd-exp' }, on: { click: onExport } }, 'JSON を書き出す')),
          row('読み込む', '書き出した JSON から戻す', h('button', { type: 'button', class: 'tbb', data: { f: 'd-imp' }, on: { click: () => file.click() } }, 'JSON を読み込む')),
          row('既定に戻す', '追う語は残す', h('button', { type: 'button', class: 'tbb' + (armed ? ' warn' : ''), data: { f: 'd-reset' }, on: { click: onReset } }, armed ? 'もう一度押すと戻す' : '既定に戻す')),
        ]),
        msg ? h('p', { class: 'set-msg' + (msg.err ? ' err' : ''), role: 'status', text: msg.text }) : null,
      ];
    },
  };

  function onExport() {
    const text = exportSettings(get(), watch.get());
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: 'parallax-settings.json', hidden: true });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    msg = { text: '書き出した（parallax-settings.json）' }; render();
  }
  async function onFile() {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    let text = '';
    try { text = f.size > 200000 ? '' : await f.text(); } catch { text = ''; }
    const r = importSettings(text);
    if (!r.ok) { msg = { err: true, text: r.error === 'big' ? '読み込めない（大きすぎる・空）' : r.error === 'json' ? '読み込めない（JSON ではない）' : '読み込めない（この盤の設定ではない）' }; render(); return; }
    set(r.settings);
    if (r.watch) watch.set(r.watch);
    msg = { text: `読み込んだ${r.watch ? `（追う語 ${r.watch.length}）` : ''}` }; render();
  }
  function onReset() {
    if (Date.now() >= resetArm) { resetArm = Date.now() + 4000; render(); setTimeout(() => { if (open && sec === 'data') render(); }, 4100); return; }
    resetArm = 0;
    set(defaults());
    msg = { text: '既定に戻した' }; render();
  }

  // ------------------------------------------------------------ the window
  function go(k) { sec = k; msg = null; resetArm = 0; render(); const b = root.querySelector(`.set-nav[data-k="${k}"]`); if (b) b.focus(); }
  function render() {
    if (!open) return;
    const active = document.activeElement;
    const fkey = active && root.contains(active) && active.dataset ? active.dataset.f || (active.classList.contains('set-nav') ? `nav-${active.dataset.k}` : '') : '';
    const s = get(), inf = info();
    const win = root.querySelector('.setwin');
    const title = (SECTIONS.find(([k]) => k === sec) || SECTIONS[0])[1];
    win.replaceChildren(
      h('header', { class: 'set-top' }, h('h2', { id: 'set-title', text: '設定' }),
        h('p', { class: 'set-priv', text: 'このブラウザの中だけに保存し、どこへも送らない' }),
        h('button', { type: 'button', class: 'ds-x', data: { f: 'close' }, on: { click: close } }, '閉じる')),
      inf.saved === false ? h('p', { class: 'set-warn', role: 'status', text: 'このブラウザに保存できない（プライベートウィンドウなど）。この窓を閉じるまでは効く' }) : null,
      h('div', { class: 'set-cols' },
        h('nav', { class: 'set-side', 'aria-label': '設定の区分' }, SECTIONS.map(([k, ja, p]) => h('button', {
          type: 'button', class: 'set-nav', 'aria-current': k === sec ? 'page' : null, data: { k, f: `nav-${k}` }, on: { click: () => go(k) } }, icon(p), h('span', { text: ja })))),
        h('div', { class: 'set-main' }, h('h3', { class: 'set-h', text: title }), BODY[sec](s, inf), file)));
    const again = fkey && root.querySelector(`[data-f="${CSS.escape(fkey)}"]`);
    if (again && !again.disabled) again.focus({ preventScroll: true });
  }
  function openAt(k) {
    if (k && SECTIONS.some(([x]) => x === k)) sec = k;
    back = document.activeElement;
    open = true; msg = null; root.hidden = false;
    document.body.classList.add('set-open');
    render();
    const b = root.querySelector(`.set-nav[data-k="${sec}"]`);
    if (b) b.focus({ preventScroll: true });
    return true;
  }
  function close() {
    if (!open) return false;
    open = false; root.hidden = true; resetArm = 0;
    document.body.classList.remove('set-open');
    if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
    return true;
  }
  root.addEventListener('click', (ev) => { if (ev.target === root) close(); });
  return { open: openAt, close, isOpen: () => open, render };
}
