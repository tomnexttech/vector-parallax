/* settings_panel — the settings window: the sections on the left, their items on the right. Every change takes effect at once.
 * It draws only; js/settings.js keeps the rules and js/app.js applies the result to the board.
 *
 *   createSettingsPanel({ root, get, set, info, watch }) -> { open(section), close(), isOpen(), render() }
 *     get() -> settings          set(next) -> boolean (kept in this browser or not)
 *     info() -> { types: [[type, n]], fields: [name], outlets: [name], hidden: { n, by }, calmSystem, saved }
 *     watch: { get() -> [term], set([term]) }      the watched words travel in the same file
 *     ai: { get() -> own-AI choice, set(choice) -> boolean, active() -> { kind, ja, model } | null, test() -> Promise<{ ok, err }> }
 *                                                  the viewer's own AI (js/settings.js keeps it apart from the settings; the key is never exported) */

import { STATIONS } from './tv.js';
import { PANES, MUTE_WORDS, MUTE_OUTLETS, NAME_LEN, KIND_JA, addTerm, removeTerm, cleanSettings, defaults, exportSettings, importSettings, cleanOwnAI, keyOk, modelOk } from './settings.js';
import { KINDS, PROVIDERS } from './provider.js';
import { errJa } from './ownai.js';
import { PLACE_CHOICES } from './newsdesk.js';

const SECTIONS = [
  ['tv', '映像', '<rect x="2.5" y="4.5" width="15" height="11" rx="2"/><path d="M8.5 8v4l3.4-2z"/>'],
  ['news', 'ニュース', '<rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M6 7.5h8M6 10.5h8M6 13.5h5"/>'],
  ['mute', 'ミュート', '<path d="M2.8 10s2.6-4.8 7.2-4.8 7.2 4.8 7.2 4.8-2.6 4.8-7.2 4.8S2.8 10 2.8 10z"/><circle cx="10" cy="10" r="2.1"/><path d="M4.2 15.8L15.8 4.2"/>'],
  ['motion', '動き', '<path d="M3 10h9.5M9.5 6.5L13 10l-3.5 3.5M16.5 4.5v11"/>'],
  ['look', '外観', '<circle cx="10" cy="10" r="6.5"/><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" stroke="none"/>'],
  ['panes', '盤の欄', '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M7.5 3.5v13M12.5 3.5v6.5h5"/>'],
  ['ai', '自分の AI', '<path d="M10 3l1.7 4.3L16 9l-4.3 1.7L10 15l-1.7-4.3L4 9l4.3-1.7z"/><path d="M15.5 13.5v3M14 15h3"/>'],
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

export function createSettingsPanel({ root, get, set, info, watch, ai, view }) {
  let sec = 'tv', open = false, msg = null, resetArm = 0, back = null, aiMsg = null, aiBusy = false;
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
          row('最初に開く見方', '自動は AI のまとめがあれば AI。上の帯でいつでも替えられる', seg('view', '最初に開く見方', s.news.view, [['auto', '自動'], ['ai', 'AI'], ['rules', '自動']], (n, v) => { n.news.view = v; })),
          row('見出しの言語', 'AI の題が無い出来事は、報じた媒体の見出しを出す', seg('lang', '見出しの言語', s.news.lang, [['ja', '日本語'], ['en', 'English'], ['orig', '元の見出し']], (n, v) => { n.news.lang = v; })),
          row('国内と海外', '両方で報じられた出来事は常に出す', seg('scope', '国内と海外', s.news.scope, [['all', '両方'], ['jp', '国内'], ['intl', '海外']], (n, v) => { n.news.scope = v; })),
          row('地元のニュース', 'ホームとかんたん表示に、選んだ地名が出るニュースの欄を出す。選びはこのブラウザだけに残す', h('select', { class: 'set-sel', 'aria-label': '地元のニュース', data: { f: 'local' }, on: { change: (ev) => { const v = ev.target.value; change((n) => { n.local.place = v; }); } } },
            h('option', { value: '', selected: !s.local.place ? true : null }, '選ばない'),
            ['都道府県', '国'].map((g) => h('optgroup', { label: g }, PLACE_CHOICES.filter((x) => x.group === g).map((x) => h('option', { value: x.key, selected: s.local.place === x.key ? true : null }, x.ja)))))),
        ]),
        group('媒体の種類', inf.types.map(([t, k]) => row(t, null, [h('span', { class: 'set-k', text: `媒体 ${k}` }), sw(`ty-${t}`, !tOff.has(t), t, (n, v) => { n.news.types_off = v ? n.news.types_off.filter((x) => x !== t) : [...n.news.types_off, t]; })])),
          '表示する種類の媒体が一つでも報じた出来事は出す', allOn('types', '全て表示', 'ty-all')),
        group('分野', inf.fields.map((f) => row(f, null, sw(`fd-${f}`, !fOff.has(f), f, (n, v) => { n.news.fields_off = v ? n.news.fields_off.filter((x) => x !== f) : [...n.news.fields_off, f]; }))),
          null, allOn('fields', '全て表示', 'fd-all')),
      ];
    },
    mute(s, inf) {
      const hd = inf.hidden;
      const by = Object.entries(hd.by).filter(([, n]) => n).map(([k, n]) => `${KIND_JA[k] || k} ${n}`).join(' · ');
      return [
        h('p', { class: 'set-lead' }, h('span', { text: '当たった出来事は一覧と地図から外し、上の帯に数を出す。注目の行はラベルだけ残して畳む。' }),
          h('b', { class: 'num', text: ` いま ${hd.n} 件` }), by ? h('span', { class: 'set-by', text: `（${by}）` }) : null),
        group('語', terms('mw', s.mute.words, MUTE_WORDS, '見出しに含む語', (n, v) => { n.mute.words = addTerm(n.mute.words, v, MUTE_WORDS); }, (n, t) => { n.mute.words = removeTerm(n.mute.words, t); }),
          '全角と半角、大文字と小文字は同じに扱う'),
        group('媒体', terms('mo', s.mute.outlets, MUTE_OUTLETS, '媒体の名', (n, v) => { n.mute.outlets = addTerm(n.mute.outlets, v, MUTE_OUTLETS, NAME_LEN); }, (n, t) => { n.mute.outlets = removeTerm(n.mute.outlets, t); }, 'set-outlets'),
          '隠すのは、その媒体だけが報じた出来事。他も報じた出来事は残す'),
        h('datalist', { id: 'set-outlets' }, inf.outlets.map((o) => h('option', { value: o }))),
        h('p', { class: 'set-gf' }, '分野と媒体の種類は ', h('button', { type: 'button', class: 'set-link', data: { f: 'go-news' }, on: { click: () => go('news') } }, 'ニュース'), ' で選ぶ'),
      ];
    },
    motion(s, inf) {
      return [
        group('', [
          row('出来事の自動切替', '12 秒ごとに注目の次の出来事へ。触れている間は止まる', sw('m-cases', s.motion.cases, '出来事の自動切替', (n, v) => { n.motion.cases = v; })),
          row('一覧の自動送り', '見切れる一覧をゆっくり送る', sw('m-scroll', s.motion.scroll, '一覧の自動送り', (n, v) => { n.motion.scroll = v; })),
          row('動きを減らす', `この端末は動きを${inf.calmSystem ? '減らす' : '減らさない'}設定`, seg('m-calm', '動きを減らす', s.motion.calm, [['system', 'システムに従う'], ['on', '常に減らす']], (n, v) => { n.motion.calm = v; })),
          row('操作の音・押した時', '押した時と切り替えた時にごく小さな音。スマホは押した時に短く震える', sw('m-sound', s.motion.sound, '押した時の音', (n, v) => { n.motion.sound = v; })),
          row('操作の音・当てた時', 'カーソルを当てた時にごく小さな音', sw('m-hsound', s.motion.hoverSound, '当てた時の音', (n, v) => { n.motion.hoverSound = v; })),
        ], '動きを減らすと、自動の送りと切替の動き、地図の移動の動きを止める'),
      ];
    },
    look(s) {
      return [group('', [row('外観', null, seg('look-theme', '外観', s.look.theme, [['dark', 'ダーク'], ['light', 'ライト']], (n, v) => { n.look.theme = v; })), row('字の大きさ', null, seg('look-size', '字の大きさ', s.look.size, [['m', '標準'], ['l', '大きい']], (n, v) => { n.look.size = v; })),
        row('言語', null, seg('look-ui', '言語', s.look.ui, [['auto', 'ブラウザに合わせる'], ['ja', '日本語'], ['en', 'English']], (n, v) => { n.look.ui = v; }))])];
    },
    panes(s) {
      const off = new Set(s.panes.off);
      const pick = (f, label, value, opts, fn) => h('div', { class: 'seg', role: 'group', 'aria-label': label },
        opts.map(([v, ja]) => h('button', { type: 'button', 'aria-pressed': String(value === v), data: { f: `${f}-${v}` }, on: { click: () => { fn(v); render(); } } }, ja)));
      const vw = view ? view.get() : null;
      return [vw ? group('一度に見るニュース', [row('件数', null, pick('v-count', '件数', vw.count, vw.counts, view.setCount)), row('並べ方', null, pick('v-layout', '並べ方', vw.layout, vw.layouts, view.setLayout))]) : null,
        group('', PANES.map(([id, ja]) => row(ja, id === 'tv' ? '隠している間は読み込まない' : null,
        sw(`p-${id}`, !off.has(id), ja, (n, v) => { n.panes.off = v ? n.panes.off.filter((x) => x !== id) : [...n.panes.off, id]; }))), '出来事と注目の欄は常に出す')];
    },
    ai() {
      const cfg = cleanOwnAI(ai.get());
      const kind = cfg.kind, p = PROVIDERS[kind] || null;
      const dflt = p ? (kind === 'gemini' && ai.fallback && modelOk(ai.fallback()) ? ai.fallback() : p.model) : '';
      const rows = [row('状態', null, h('b', { class: 'set-state', data: { f: 'ai-state' }, text: p && cfg.keys[kind] ? '設定済み' : '未設定' })), row('提供元', 'なしのままでも、AI のまとめは今まで通り全部使える',
        h('div', { class: 'seg', role: 'group', 'aria-label': '提供元' },
          [['none', 'なし'], ...KINDS.map((k) => [k, PROVIDERS[k].ja])].map(([v, ja]) => h('button', {
            type: 'button', 'aria-pressed': String(kind === v), data: { f: `ai-kind-${v}` }, on: { click: () => aiChange((c) => { c.kind = v; }) } }, ja))))];
      if (p) {
        const keyIn = h('input', { type: 'password', class: 'set-in', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', placeholder: '鍵を貼り付ける', 'aria-label': `${p.ja} の鍵`, data: { f: 'ai-key' } });
        keyIn.value = cfg.keys[kind];
        keyIn.addEventListener('change', () => onKey(keyIn.value));
        keyIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); onKey(keyIn.value); } });
        const show = h('button', { type: 'button', class: 'tbb', 'aria-pressed': 'false', 'aria-label': '鍵の表示を切り替える', data: { f: 'ai-show' }, on: { click: (ev) => {
          const on = keyIn.type === 'password'; keyIn.type = on ? 'text' : 'password';
          ev.currentTarget.setAttribute('aria-pressed', String(on)); ev.currentTarget.textContent = on ? '隠す' : '表示'; } } }, '表示');
        const modelIn = h('input', { type: 'text', class: 'set-in', list: 'set-ai-models', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', placeholder: dflt, 'aria-label': `${p.ja} の型`, data: { f: 'ai-model' } });
        modelIn.value = cfg.models[kind];
        modelIn.addEventListener('change', () => onModel(modelIn.value));
        modelIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); onModel(modelIn.value); } });
        rows.push(row('鍵', `${cfg.keys[kind] ? '保存済み' : '未入力'}・送る先は ${p.host} だけ`, [keyIn, show]));
        rows.push(row('型', `空なら各社の今の型（${dflt}）`, modelIn));
        rows.push(row('接続', null, [
          h('button', { type: 'button', class: 'tbb', data: { f: 'ai-test' }, on: { click: onTest } }, '接続を試す'),
          h('button', { type: 'button', class: 'tbb', data: { f: 'ai-forget' }, on: { click: onForget } }, '鍵を消す')]));
      }
      return [
        h('p', { class: 'set-lead', text: '鍵はこのブラウザの中だけに保存し、選んだ提供元にだけ送る。費用はあなたの契約に掛かる' }),
        group('', rows, '使い道は、声の操作と、出来事の欄の「自分の AI に聞く」。AI のまとめや要約は、鍵がなくても今のまま使える'),
        p ? h('datalist', { id: 'set-ai-models' }, p.models.map((m) => h('option', { value: m }))) : null,
        h('p', { class: 'set-msg' + (aiMsg && aiMsg.err ? ' err' : ''), role: 'status', 'aria-live': 'polite', hidden: !aiMsg, data: { f: 'ai-msg' }, text: aiMsg ? aiMsg.text : '' }),
      ];
    },
    data() {
      const armed = Date.now() < resetArm;
      return [
        group('', [
          row('書き出す', '設定とフォローする言葉を一つの JSON に（鍵は入れない）', h('button', { type: 'button', class: 'tbb', data: { f: 'd-exp' }, on: { click: onExport } }, 'JSON を書き出す')),
          row('読み込む', '書き出した JSON から戻す', h('button', { type: 'button', class: 'tbb', data: { f: 'd-imp' }, on: { click: () => file.click() } }, 'JSON を読み込む')),
          row('既定に戻す', 'フォローする言葉と自分の AI は残す', h('button', { type: 'button', class: 'tbb' + (armed ? ' warn' : ''), data: { f: 'd-reset' }, on: { click: onReset } }, armed ? 'もう一度押すと戻す' : '既定に戻す')),
        ]),
        msg ? h('p', { class: 'set-msg' + (msg.err ? ' err' : ''), role: 'status', text: msg.text }) : null,
      ];
    },
  };

  // ------------------------------------------------------------ 自分の AI: the key is kept when the field is left, the window is not drawn again, so a click on the next button is never lost
  function say(text, err) {
    aiMsg = text ? { text, err: !!err } : null;
    const n = root.querySelector('[data-f="ai-msg"]');
    if (n) { n.textContent = aiMsg ? aiMsg.text : ''; n.hidden = !aiMsg; n.classList.toggle('err', !!(aiMsg && aiMsg.err)); }
  }
  const noKeep = 'このブラウザに保存できない（プライベートウィンドウなど）。この窓を閉じるまでは効く';
  function aiChange(fn, text) {
    const next = cleanOwnAI(ai.get());
    fn(next);
    const ok = ai.set(next);
    aiMsg = ok ? (text ? { text } : null) : { err: true, text: noKeep };
    render();
  }
  function onKey(v) {
    const t = String(v).trim(), cur = cleanOwnAI(ai.get()), kind = cur.kind;
    if (kind === 'none') return;
    if (t && !keyOk(t)) { say('鍵に使えない文字が入っている（半角の英数と記号だけ・8 文字以上・空白なし）', true); return; }
    if (cur.keys[kind] === t) return;
    cur.keys[kind] = t;
    const ok = ai.set(cur);
    keyState(kind, ok && t);
    say(!ok ? noKeep : t ? 'このブラウザに保存した' : '鍵を消した', !ok);
  }
  function onModel(v) {
    const t = String(v).trim(), cur = cleanOwnAI(ai.get()), kind = cur.kind;
    if (kind === 'none') return;
    if (t && !modelOk(t)) { say('型の名は半角の英数と . _ - だけ', true); return; }
    if (cur.models[kind] === t) return;
    cur.models[kind] = t;
    const ok = ai.set(cur);
    say(!ok ? noKeep : t ? `型を ${t} にした` : '型を既定に戻した', !ok);
  }
  /** the line under 鍵 follows what is kept, without drawing the window again */
  function keyState(kind, kept) {
    const f = root.querySelector('[data-f="ai-key"]'), r = f && f.closest('.set-r'), d = r && r.querySelector('.set-d');
    if (d && PROVIDERS[kind]) d.textContent = `${kept ? '保存済み' : '未入力'}・送る先は ${PROVIDERS[kind].host} だけ`;
  }
  async function onTest() {
    if (aiBusy) return;
    const k = root.querySelector('[data-f="ai-key"]'); if (k) onKey(k.value);
    const a = ai.active();
    if (!a) { say('先に提供元を選び、鍵を入れてください', true); return; }
    aiBusy = true; say(`試している…（${a.ja} · ${a.model}）`);
    let r;
    try { r = await ai.test(); } catch { r = { ok: false, err: 'network' }; }
    aiBusy = false;
    say(r && r.ok ? `つながった（${a.ja} · ${a.model}）` : `つながらない：${errJa(r && r.err)}`, !(r && r.ok));
  }
  function onForget() {
    const kind = cleanOwnAI(ai.get()).kind;
    if (kind === 'none') return;
    aiChange((c) => { c.keys[kind] = ''; }, 'この提供元の鍵を消した');
  }

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
    msg = { text: `読み込んだ${r.watch ? `（フォローする言葉 ${r.watch.length}）` : ''}` }; render();
  }
  function onReset() {
    if (Date.now() >= resetArm) { resetArm = Date.now() + 4000; render(); setTimeout(() => { if (open && sec === 'data') render(); }, 4100); return; }
    resetArm = 0;
    set(defaults());
    msg = { text: '既定に戻した' }; render();
  }

  // ------------------------------------------------------------ the window
  function go(k) { sec = k; msg = null; aiMsg = null; resetArm = 0; render(); const b = root.querySelector(`.set-nav[data-k="${k}"]`); if (b) b.focus(); }
  function render() {
    if (!open) return;
    const active = document.activeElement;
    const fkey = active && root.contains(active) && active.dataset ? active.dataset.f || (active.classList.contains('set-nav') ? `nav-${active.dataset.k}` : '') : '';
    const s = get(), inf = info();
    const win = root.querySelector('.setwin');
    const title = (SECTIONS.find(([k]) => k === sec) || SECTIONS[0])[1];
    win.replaceChildren(
      h('header', { class: 'set-top' }, h('h2', { id: 'set-title', text: '設定' }),
        h('p', { class: 'set-priv', text: sec === 'ai' ? 'このブラウザだけに保存・選んだ提供元にだけ送る' : 'このブラウザだけに保存・送信しない' }),
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
    open = true; msg = null; aiMsg = null; root.hidden = false;
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
