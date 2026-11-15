// The wheel in a real Chrome (2026-11-16, "中央部分がスクロールできない"): on 詳しく見る the wheel over the middle column — the title card, 要点, the
// table of 媒体比較, its row names and its right edge — scrolls the screen to its end, and the home of a window the card fits in does not scroll at all.
// It opens a real Chrome, so it runs only when an assembled site and a Chrome are at hand:
//   python tools/assemble_site.py --out _site && PLX_SITE_DIR=_site node --test tests/js/wheel_browser.test.js
// Otherwise it is skipped, and tests/js/interact1116.test.js holds the rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { serve, findChrome } from '../../tools/overflow_check.mjs';

/** a headless Chrome with no sound and a new profile, removed at the end */
async function launch(chromePath) {
  const prof = path.join(os.tmpdir(), 'wheel_browser_' + process.pid);
  fs.rmSync(prof, { recursive: true, force: true });
  const proc = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--mute-audio', '--lang=ja', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { await new Promise((r) => setTimeout(r, 150)); try { port = Number(fs.readFileSync(path.join(prof, 'DevToolsActivePort'), 'utf8').split(String.fromCharCode(10))[0]); } catch { /* not yet */ } }
  if (!port) throw new Error('chrome did not start');
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  let id = 0; const cb = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const { ok, no } = cb.get(d.id); cb.delete(d.id); d.error ? no(new Error(d.error.message)) : ok(d.result); } });
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const n = ++id; cb.set(n, { ok, no }); ws.send(JSON.stringify({ id: n, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');
  await S('Network.setCacheDisabled', { cacheDisabled: true }); await S('Network.setBypassServiceWorker', { bypass: true });
  return {
    S,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async go(url, wait) { await S('Page.navigate', { url }); await new Promise((r) => setTimeout(r, wait)); },
    async ev(expr) { const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; },
    async close() {
      try { await send('Browser.close'); } catch { /* gone */ }
      try { ws.close(); } catch { /* */ }
      const gone = proc.exitCode !== null ? Promise.resolve() : new Promise((r) => proc.once('exit', r));
      try { proc.kill(); } catch { /* */ }
      await Promise.race([gone, new Promise((r) => setTimeout(r, 5000))]);
      await new Promise((r) => setTimeout(r, 300));
      try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 15, retryDelay: 300 }); } catch { /* */ }
    },
  };
}

const site = process.env.PLX_SITE_DIR || '';
const chrome = findChrome();
const READY = `(async () => { for (let i = 0; i < 160; i++) { if (document.documentElement.dataset.screen) { await new Promise((r) => setTimeout(r, 900)); return 1; } await new Promise((r) => setTimeout(r, 250)); } return 0; })()`;

test('the wheel scrolls 詳しく見る from anywhere in its middle column, and the home does not scroll for nothing', { skip: !site || !fs.existsSync(site) || !chrome ? 'needs PLX_SITE_DIR (an assembled site) and Chrome' : false, timeout: 600000 }, async () => {
  if (!fs.existsSync(`${site}/blank.html`)) fs.writeFileSync(`${site}/blank.html`, '<!doctype html><meta charset=utf-8><title>blank</title>');
  const { srv, port } = await serve(site);
  const b = await launch(chrome);
  const bad = [];
  try {
    for (const [w, h] of [[1920, 1080], [2000, 1033], [1440, 900]]) {
      for (const theme of ['light', 'dark']) {
        await b.S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await b.S('Emulation.setTouchEmulationEnabled', { enabled: false });
        await b.go(`http://127.0.0.1:${port}/blank.html`, 150);
        await b.ev(`localStorage.clear(); localStorage.setItem('parallax.tour.v1','1'); localStorage.setItem('parallax.settings.v1', JSON.stringify({ look: { theme: '${theme}', ui: 'ja' } })); 1`);
        await b.go(`http://127.0.0.1:${port}/#home`, 2500);
        await b.ev(READY);
        const homeExtra = await b.ev(`(() => { const x = document.getElementById('board'); return x ? x.scrollHeight - x.clientHeight : 0; })()`);
        if (homeExtra > 0) bad.push(`${w}x${h} ${theme} home scrolls ${homeExtra}px`);
        await b.ev(`document.getElementById('sc-board').click(); 1`); await b.sleep(1800);
        // five places in the middle column, found on the page itself
        const pts = await b.ev(`(() => { const c = (sel, fx, fy) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.height > 4 && r.top < innerHeight ? [Math.round(r.left + r.width * fx), Math.round(Math.min(innerHeight - 30, r.top + Math.min(r.height, 120) * fy))] : null; };
          return { title: c('#p-case .t-place', 0.4, 0.5), point: c('#p-case .t-ai', 0.5, 0.5), table: c('#p-case .cv-sc', 0.5, 0.6), rows: c('#p-case .cv-sc th, #p-case .cv-l', 0.5, 0.5), edge: c('#p-case .cv-sc', 0.97, 0.6) }; })()`);
        for (const [name, p] of Object.entries(pts)) {
          if (!p) continue;
          await b.ev(`(() => { for (const e of document.querySelectorAll('*')) if (e.scrollTop) e.scrollTop = 0; return 1; })()`);
          for (let k = 0; k < 40; k++) { await b.S('Input.dispatchMouseEvent', { type: 'mouseWheel', x: p[0], y: p[1], deltaX: 0, deltaY: 600 }); await b.sleep(40); }
          await b.sleep(600);
          const r = await b.ev(`(() => { const x = document.getElementById('board'); return [Math.round(x.scrollTop), x.scrollHeight - x.clientHeight]; })()`);
          if (r[1] > 0 && r[0] < r[1] - 2) bad.push(`${w}x${h} ${theme} wheel over ${name} stopped at ${r[0]} of ${r[1]}`);
        }
      }
    }
  } finally { await b.close(); srv.close(); }
  assert.deepEqual(bad, []);
});
