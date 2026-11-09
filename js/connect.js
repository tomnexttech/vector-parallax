/* connect — the small window where a viewer connects their own AI: log in with OpenRouter, or paste a key (that part is in the settings).
 * It draws and calls back; it keeps nothing. js/app.js owns the key (js/settings.js) and the login (js/login.js).
 *
 *   createConnect({ root, get, active, login, test, model, forget, settings }) -> { open(), close(), isOpen(), render(), say(text, err) }
 *     get() -> the viewer's AI config (cleanOwnAI)     active() -> { kind, ja, model } | null
 *     login() -> starts the login (leaves the page)    test() -> Promise<{ ok, err }>
 *     model(kind, value) -> keeps the model name        forget(kind) -> removes the key of that provider
 *     settings() -> opens the settings at the AI section (where a key is pasted)
 *
 * The words are plain statements of where the key goes and who pays. No promise, no tagline. */

import { PROVIDERS } from './provider.js';
import { modelOk } from './settings.js';
import { errJa } from './ownai.js';

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

export function createConnect({ root, get, active, login, test, model, forget, settings }) {
  let open = false, back = null, msg = null, busy = false;
  const win = root.querySelector('.ownwin');

  function say(text, err) {
    msg = text ? { text, err: !!err } : null;
    const n = win.querySelector('[data-f="own-msg"]');
    if (n) { n.textContent = msg ? msg.text : ''; n.hidden = !msg; n.classList.toggle('err', !!(msg && msg.err)); }
  }

  async function onTest() {
    if (busy) return;
    const a = active();
    if (!a) { say('先にログインするか、鍵を入れてください', true); return; }
    busy = true; say(`試しています（${a.ja} · ${a.model}）`);
    let r;
    try { r = await test(); } catch { r = { ok: false, err: 'network' }; }
    busy = false;
    say(r && r.ok ? `つながりました（${a.ja} · ${a.model}）` : `つながりません：${errJa(r && r.err)}`, !(r && r.ok));
  }

  function onModel(kind, value) {
    const t = String(value).trim();
    if (t && !modelOk(t, kind)) { say(kind === 'openrouter' ? '型の名は 提供元/型 の形です（半角の英数と . _ - : /）' : '型の名は半角の英数と . _ - だけです', true); return; }
    model(kind, t);
    const a = active();
    say(t ? `型を ${t} にしました` : `型を既定（${a ? a.model : PROVIDERS[kind].model}）に戻しました`);
    render();
  }

  function body() {
    const cfg = get(), a = active();
    if (!a) {
      return [
        h('p', { class: 'own-lead', text: 'OpenRouter のアカウントでログインします。Claude、GPT、Gemini などを選べます。' }),
        h('div', { class: 'own-btns' },
          h('button', { type: 'button', class: 'tbb own-go', data: { f: 'own-login' }, on: { click: () => login() } }, 'OpenRouter でログイン'),
          h('button', { type: 'button', class: 'tbb', data: { f: 'own-key' }, on: { click: () => { close(false); settings(); } } }, '鍵を貼る')),
        h('p', { class: 'own-foot', text: '鍵はこのブラウザにだけ保存し、openrouter.ai にだけ送ります。料金は OpenRouter の残高から引かれます。' }),
      ];
    }
    const p = PROVIDERS[a.kind];
    const input = h('input', { type: 'text', class: 'set-in own-model', list: 'own-models', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', placeholder: p.model, id: 'own-model-in', data: { f: 'own-model' } });
    input.value = cfg.models[a.kind] || '';
    input.addEventListener('change', () => onModel(a.kind, input.value));
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); onModel(a.kind, input.value); } });
    return [
      h('dl', { class: 'own-st' },
        h('dt', { text: '状態' }), h('dd', { text: 'つながっています' }),
        h('dt', { text: '提供元' }), h('dd', { text: a.ja }),
        h('dt', null, h('label', { for: 'own-model-in', text: '型' })), h('dd', null, input)),
      h('datalist', { id: 'own-models' }, p.models.map((m) => h('option', { value: m }))),
      h('div', { class: 'own-btns' },
        h('button', { type: 'button', class: 'tbb', data: { f: 'own-test' }, on: { click: onTest } }, '接続を試す'),
        h('button', { type: 'button', class: 'tbb', data: { f: 'own-forget' }, on: { click: () => { forget(a.kind); say(a.kind === 'openrouter' ? 'このブラウザの鍵を消しました。OpenRouter の鍵は openrouter.ai の設定で取り消せます' : 'このブラウザの鍵を消しました'); render(); } } }, '接続を外す')),
      h('p', { class: 'own-foot', text: `ニュース詳細の「要約」「違いを見る」「質問」と、データと AI の「実行」に使います。料金は ${a.ja} のアカウントに掛かります。` }),
    ];
  }

  function render() {
    if (!open) return;
    const fkey = (() => { const f = document.activeElement; return f && win.contains(f) && f.dataset ? f.dataset.f || '' : ''; })();
    win.replaceChildren(
      h('header', { class: 'set-top' }, h('h2', { id: 'own-title', text: '自分の AI' }),
        h('p', { class: 'set-priv', text: 'このブラウザだけに保存' }),
        h('button', { type: 'button', class: 'ds-x', data: { f: 'own-close' }, on: { click: () => close(true) } }, '閉じる')),
      h('div', { class: 'own-body' }, body(),
        h('p', { class: 'set-msg' + (msg && msg.err ? ' err' : ''), role: 'status', 'aria-live': 'polite', hidden: !msg, data: { f: 'own-msg' }, text: msg ? msg.text : '' })));
    const again = fkey && win.querySelector(`[data-f="${CSS.escape(fkey)}"]`);
    if (again) again.focus({ preventScroll: true });
  }

  function openIt() {
    back = document.activeElement;
    open = true; msg = null; root.hidden = false;
    document.body.classList.add('set-open');
    render();
    const first = win.querySelector('.own-go, [data-f="own-test"]');
    if (first) first.focus({ preventScroll: true });
    return true;
  }
  function close(restore) {
    if (!open) return false;
    open = false; root.hidden = true;
    document.body.classList.remove('set-open');
    if (restore !== false && back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
    return true;
  }
  root.addEventListener('click', (ev) => { if (ev.target === root) close(true); });
  root.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(true); return; }
    if (ev.key !== 'Tab') return;
    const f = [...win.querySelectorAll('button, input')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  });
  return { open: openIt, close: () => close(true), isOpen: () => open, render, say };
}
