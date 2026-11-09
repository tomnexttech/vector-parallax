#!/usr/bin/env node
// map_touch_check — does a double tap zoom the map where one finger is meant to move it? Opens an assembled site (tools/assemble_site.py --out _site) in Chrome with the
// screen of an iPad or an iPhone (touch, the device's UA) and measures the zoom before and after a double tap in the middle of the map:
//   screen   the 地図 screen (#map)                      full   the small map of the home, pressed, so that it opens to the whole screen
// The map is waited for until it is idle (loaded, not moving) before the finger goes down: MapLibre takes a tap only when it lasts under 500ms by the clock of the page, and a Chrome that draws
// by software holds a big map that is still loading tiles for 150-300ms a frame. The finger goes down away from the middle (the scene is centred on an event, and a tap on its mark is a press).
// The 0 of the v47 table for the iPad was the opened map lying under the panes of the home (z-index 1 against 1, the later pane on top), see docs/landscape-list-v48.md.
// Profile and server live in the temp folder and are removed.
//   node tools/map_touch_check.mjs --site _site [--sizes 820x1180,390x844p] [--modes screen,full]     exit 1 when a double tap did not zoom by about 1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, serve, findChrome, UA } from './overflow_check.mjs';

const MAP = `(() => { const gc = [...document.querySelectorAll('canvas')].find((x) => x.mapGl); const m = gc && gc.mapGl; const c = document.querySelector('.mgl canvas.maplibregl-canvas'); const r = c && c.getBoundingClientRect();
  return m ? { z: m.getZoom(), rect: [r.left, r.top, r.width, r.height], full: document.documentElement.dataset.mapfull || '' } : null; })()`;
const IDLE = `(async () => { const gc = [...document.querySelectorAll('canvas')].find((x) => x.mapGl); const m = gc && gc.mapGl; if (!m) return 0;
  for (let i = 0; i < 120; i++) { if (m.loaded() && !m.isMoving()) { await new Promise((r) => setTimeout(r, 400)); if (m.loaded()) return 1; } await new Promise((r) => setTimeout(r, 200)); } return 0; })()`;

/** -> { rows: [{ size, mode, dz, opened, ok }], failed } */
export async function check({ site, chrome, sizes = ['820x1180', '390x844p'], modes = ['screen', 'full'], log = () => {} }) {
  const { srv, port } = await serve(site);
  const b = await launch(chrome);
  const rows = [];
  try {
    for (const sz of sizes) {
      const m = /(\d+)x(\d+)(p?)/.exec(sz), w = +m[1], h = +m[2];
      await b.device(w, h, m[3] ? UA.iphone : UA.ipad);
      for (const mode of modes) {
        await b.go(`http://127.0.0.1:${port}/blank.html`, 150);
        await b.ev(`localStorage.clear(); localStorage.setItem('parallax.tour.v1','1'); 1`);
        await b.go(`http://127.0.0.1:${port}/${mode === 'screen' ? '#map' : '#home'}`, 3000);
        await b.ev(`(async () => { for (let i = 0; i < 160; i++) { if (document.documentElement.dataset.screen) { await new Promise((r) => setTimeout(r, 600)); return 1; } await new Promise((r) => setTimeout(r, 250)); } return 0; })()`).catch(() => 0);
        await b.sleep(4000); await b.ev(IDLE);
        const tap = async (x, y) => { await b.touch('touchStart', [[x, y]]); await b.sleep(40); await b.touch('touchEnd', []); };
        if (mode === 'full') {
          const p = await b.ev(`(() => { document.getElementById('p-map').scrollIntoView({ block: 'center' }); const q = document.querySelector('.mgl canvas.maplibregl-canvas').getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; })()`);
          await b.sleep(600); await tap(p[0], p[1]); await b.sleep(1200); await b.ev(IDLE);
        }
        const a = await b.ev(MAP);
        if (!a) { const row = { size: sz, mode, dz: null, opened: false, ok: false }; rows.push(row); log(row); continue; }
        // a point where the map's own canvas is on top (a card or a label of the map would take the tap), off the middle: the scene is centred on an event, and a tap on its mark is a press, not a zoom
        const at = await b.ev(`(() => { const r = ${JSON.stringify(a.rect)}; for (const [fx, fy] of [[0.25, 0.55], [0.75, 0.55], [0.25, 0.4], [0.75, 0.4], [0.3, 0.65], [0.7, 0.65], [0.5, 0.75]]) { const x = r[0] + r[2] * fx, y = r[1] + r[3] * fy; const e = document.elementFromPoint(x, y); if (e && e.classList && e.classList.contains('maplibregl-canvas')) return [x, y]; } return null; })()`);
        if (!at) { const row = { size: sz, mode, dz: null, opened: true, ok: false }; rows.push(row); log(row); continue; }
        const [cx, cy] = at;
        await tap(cx, cy); await b.sleep(110); await tap(cx, cy); await b.sleep(1200);
        const z = await b.ev(MAP), dz = Math.round((z.z - a.z) * 100) / 100;
        const row = { size: sz, mode, dz, opened: mode === 'full' ? a.full === '1' : true, ok: Math.abs(dz - 1) < 0.2 && (mode !== 'full' || a.full === '1') };
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
  const { rows, failed } = await check({ site, chrome, sizes: arg('sizes') ? arg('sizes').split(',') : undefined, modes: arg('modes') ? arg('modes').split(',') : undefined,
    log: (r) => console.log(`${r.size.padEnd(10)} ${r.mode.padEnd(7)} double tap ${r.dz == null ? 'no map' : (r.dz >= 0 ? '+' : '') + r.dz} ${r.ok ? 'ok' : 'NOT ZOOMED'}`) });
  console.log(`${rows.length - failed.length} of ${rows.length} zoomed`);
  process.exit(failed.length ? 1 : 0);
}
