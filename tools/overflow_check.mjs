#!/usr/bin/env node
// overflow_check — does a page keep to its width on a phone and a tablet? Opens an assembled site (tools/assemble_site.py --out _site) in Chrome with
// the screen of an iPad or an iPhone (touch, the device's UA), and for every page and size reads
//   sw / cw   the scroll width of the document against its client width (the same number = nothing runs off to the right),
//   boxes     the boxes that scroll up and down and also hold more than their width (a finger can pan them: this was the iPad's sideways drift),
//   moved     what moved after a finger was dragged sideways at three places (it must be nothing but the strips and tables made for it).
// The browser's profile and the page's server are made under the temp folder and removed at the end. Nothing is installed. Exit 1 when a cell is not clean.
//   node tools/overflow_check.mjs --site _site [--pages home,compare,map] [--sizes 820x1180,1180x820,844x390p] [--chrome path]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml' };
export const UA = {
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};
export const SIZES = ['768x1024', '820x1180', '834x1194', '1024x1366', '1024x768', '1180x820', '1194x834', '1366x1024', '667x375p', '844x390p', '852x393p', '932x430p'];
const click = (id) => `document.getElementById('${id}').click()`;
export const PAGES = {
  home: { url: '#home' },
  board: { url: '#home', act: click('sc-board') },
  compare: { url: '#home', act: click('sc-simple') },
  news: { url: '#news' }, paper: { url: '#news/paper' }, map: { url: '#map', wait: 6500 },
  market: { url: '#market' }, politics: { url: '#politics' }, disaster: { url: '#disaster' }, video: { url: '#video' }, saved: { url: '#saved' },
  settings: { url: '#home', act: click('set-btn') }, ownai: { url: '#home', act: click('own-btn') },
  search: { url: '#q=%E3%82%A2%E3%83%A1%E3%83%AA%E3%82%AB' }, ties: { url: '#net' }, mail: { url: '#mail' },   // the app branch's search, ties and mail draft (docs/app.md)
};

export function serve(dir) {
  const root = path.resolve(dir);
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end('no'); return; }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(rsp);
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

export function findChrome(given) {
  const c = [given, process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return c.find((x) => x && fs.existsSync(x)) || null;
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.cb = new Map(); this.ev = []; ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && this.cb.has(d.id)) { const { ok, no } = this.cb.get(d.id); this.cb.delete(d.id); d.error ? no(new Error(d.error.message)) : ok(d.result); } else if (d.method) for (const f of this.ev) f(d); }); }
  send(method, params = {}, sessionId) { const id = ++this.id; return new Promise((ok, no) => { this.cb.set(id, { ok, no }); this.ws.send(JSON.stringify({ id, method, params, sessionId })); }); }
}


// the overflow reading, run in the page: what is wider than the viewport and not clipped by a box that scrolls or cuts on its own
export const OVERFLOW_JS = `(() => {
  const de = document.documentElement, cw = de.clientWidth, vw = window.innerWidth;
  const sel = (e) => { let s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; const c = (e.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 3); if (c.length) s += '.' + c.join('.'); return s; };
  const clipped = (e) => {
    for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.position === 'fixed') return true;
      if (p !== document.body && (cs.overflowX !== 'visible' || cs.contain.includes('paint') || cs.clipPath !== 'none')) return true;
    }
    return false;
  };
  const rows = [];
  for (const e of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.position === 'fixed') continue;
    const r = e.getBoundingClientRect();
    if (!(r.width > 0 || r.height > 0)) continue;
    if (r.right > cw + 0.5 && !clipped(e)) rows.push({ s: sel(e), right: Math.round(r.right), w: Math.round(r.width), l: Math.round(r.left), t: e.tagName === 'svg' || e.closest('svg') ? 'svg' : '' });
  }
  const seen = new Map();
  for (const x of rows) { const k = x.s; if (!seen.has(k) || seen.get(k).right < x.right) seen.set(k, x); }
  const list = [...seen.values()].sort((a, b) => b.right - a.right);
  // vertical scrollers (a region that scrolls up and down) that also hold more than their width: a finger can pan them sideways
  const vs = [], sc = [];
  for (const e of [document.documentElement, ...document.body.querySelectorAll('*')]) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || e.clientWidth < 40) continue;
    const ox = cs.overflowX, oy = cs.overflowY, wide = e.scrollWidth > e.clientWidth + 1;
    if (!wide) continue;
    const vert = e === document.documentElement ? true : ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1);
    const pan = ox === 'auto' || ox === 'scroll' || e === document.documentElement;
    const row = { s: sel(e), ox, oy, sw: e.scrollWidth, cw: e.clientWidth, ta: cs.touchAction };
    if (pan && e !== document.documentElement) sc.push(row);
    if (vert && (pan || ox === 'hidden')) vs.push(row);
  }
  return { sw: de.scrollWidth, cw, vw, bsw: document.body.scrollWidth, max: list.length ? list[0].right : 0, n: rows.length, top: list.slice(0, 10), vs: vs.slice(0, 8), nv: vs.length, sc: sc.slice(0, 12) };
})()`;

export async function launch(chromePath) {
  const prof = path.join(os.tmpdir(), 'overflow_check_' + process.pid);
  fs.rmSync(prof, { recursive: true, force: true });
  const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank'], { stdio: 'ignore' });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { await new Promise((r) => setTimeout(r, 150)); try { port = Number(fs.readFileSync(path.join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { /* not yet */ } }
  if (!port) throw new Error('chrome did not start');
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  const cdp = new CDP(ws);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');
  await S('Network.setCacheDisabled', { cacheDisabled: true }); await S('Network.setBypassServiceWorker', { bypass: true });
  await S('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('parallax.tour.v1','1')}catch(e){}" });
  return {
    S,
    async device(w, h, ua) {
      await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: w > h ? 'landscapePrimary' : 'portraitPrimary', angle: w > h ? 90 : 0 } });
      await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); await S('Emulation.setUserAgentOverride', { userAgent: ua });
    },
    async go(url, wait) { await S('Page.navigate', { url }); await new Promise((r) => setTimeout(r, wait)); },
    async ev(expr) { const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    touch: (type, pts) => S('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) }),
    async close() { try { await cdp.send('Browser.close'); } catch { /* gone */ } try { ws.close(); chrome.kill(); } catch { /* */ } await new Promise((r) => setTimeout(r, 400)); try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* */ } },
  };
}

// the app has drawn itself when it has said which screen it is showing (<html data-screen>)
const READY_JS = `(async () => { for (let i = 0; i < 160; i++) { if (document.documentElement.dataset.screen) { await new Promise((r) => setTimeout(r, 600)); return 1; } await new Promise((r) => setTimeout(r, 250)); } return 0; })()`;
const MOVED_JS = `(() => { const out = []; for (const e of [document.documentElement, ...document.body.querySelectorAll('*')]) { if (e.scrollLeft > 0.5 && (e === document.documentElement || e.scrollHeight > e.clientHeight + 1)) out.push((e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0]) + '=' + Math.round(e.scrollLeft)); } return out; })()`;

/** -> { rows: [{ page, size, sw, cw, boxes, moved, ok }], failed } */
export async function check({ site, chrome, pages = Object.keys(PAGES), sizes = ['820x1180', '1180x820', '844x390p'], log = () => {} }) {
  const { srv, port } = await serve(site);
  const b = await launch(chrome);
  const rows = [];
  try {
    for (const sz of sizes) {
      const m = /(\d+)x(\d+)(p?)/.exec(sz), w = +m[1], h = +m[2];
      await b.device(w, h, m[3] ? UA.iphone : UA.ipad);
      for (const name of pages) {
        const p = PAGES[name];
        await b.go(`http://127.0.0.1:${port}/blank.html`, 150);
        await b.ev(`localStorage.clear(); localStorage.setItem('parallax.tour.v1','1'); 1`);
        await b.go(`http://127.0.0.1:${port}/${p.url}`, p.wait || 2400);
        await b.ev(READY_JS).catch(() => 0);
        if (p.act) { await b.ev(p.act).catch(() => {}); await b.sleep(1200); }
        const r = await b.ev(OVERFLOW_JS);
        for (const [x0, y0] of [[w * 0.8, h * 0.35], [w * 0.5, h * 0.6], [w * 0.15, h * 0.2]]) {
          await b.touch('touchStart', [[x0, y0]]);
          for (let i = 1; i <= 8; i++) { await b.touch('touchMove', [[x0 - i * 50, y0]]); await b.sleep(16); }
          await b.touch('touchEnd', []); await b.sleep(300);
        }
        const moved = await b.ev(MOVED_JS), scrollX = await b.ev('Math.round(window.scrollX)');
        const row = { page: name, size: sz, sw: r.sw, cw: r.cw, boxes: r.vs.map((x) => `${x.s}[${x.sw}/${x.cw}]`), moved: scrollX ? [...moved, 'scrollX=' + scrollX] : moved, ok: r.sw === r.cw && r.n === 0 && r.nv === 0 && !moved.length && !scrollX };
        rows.push(row); log(row);
      }
    }
  } finally { await b.close(); srv.close(); }
  return { rows, failed: rows.filter((x) => !x.ok) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const chrome = findChrome(arg('chrome'));
  if (!chrome) { console.error('no Chrome found (--chrome or CHROME_PATH)'); process.exit(2); }
  const site = arg('site', '_site');
  if (!fs.existsSync(path.join(site, 'blank.html'))) fs.writeFileSync(path.join(site, 'blank.html'), '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>blank</title>');
  const { rows, failed } = await check({ site, chrome, pages: arg('pages') ? arg('pages').split(',') : undefined, sizes: arg('sizes') ? arg('sizes').split(',') : undefined,
    log: (r) => console.log(`${r.size.padEnd(10)} ${r.page.padEnd(9)} sw=${r.sw}/${r.cw} ${r.ok ? 'ok' : 'NOT CLEAN ' + JSON.stringify({ boxes: r.boxes, moved: r.moved })}`) });
  console.log(`${rows.length - failed.length} of ${rows.length} clean`);
  process.exit(failed.length ? 1 : 0);
}
