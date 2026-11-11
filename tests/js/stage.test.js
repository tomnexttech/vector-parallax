import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { STAGE, isStage, u, wantsShow, isShow, focusView, coverPick } from '../../js/stage.js';
import { hit, draw, layout, graphFromPairs } from '../../js/netview.js';

const css = readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

/** reads the three features of STAGE and answers for a window of w by h */
function matches(q, w, h) {
  const f = {};
  for (const m of q.matchAll(/\(([a-z-]+):\s*([^)]+)\)/g)) f[m[1]] = m[2].trim();
  const [a, b] = f['min-aspect-ratio'].split('/').map(Number);
  return w >= parseFloat(f['min-width']) && h >= parseFloat(f['min-height']) && w / h >= a / b;
}

test('the stage of the stylesheet is the stage of the script, word for word, and it is one block at the end', () => {
  const at = css.indexOf(`@media ${STAGE} {`);
  assert.ok(at > 0, 'css/app.css has the @media of js/stage.js STAGE');
  assert.equal(css.indexOf(`@media ${STAGE} {`, at + 1), -1, 'only one stage block');
  assert.ok(css.lastIndexOf('/* ==== stage:end ==== */') > css.lastIndexOf('/* ==== integrate:end ==== */'), 'the stage comes after every other rule, so it wins by order');
  const block = css.slice(at, css.indexOf('/* ==== stage:end ==== */'));
  assert.doesNotMatch(block, /!important/, 'the stage wins by order, never by !important');
  assert.match(block, /--u: min\(calc\(100vw \/ 1920\), calc\(100dvh \/ 1080\)\)/);
});

test('a projector, a 16:9 laptop and a 13-inch Mac are a stage; a tablet, a phone and a 4:3 window are not', () => {
  for (const [w, h] of [[1920, 1080], [1280, 720], [1366, 768], [1440, 900], [1470, 956], [2560, 1440]]) assert.ok(matches(STAGE, w, h), `${w}x${h} is a stage`);
  assert.match(STAGE, /\(hover: hover\) and \(pointer: fine\)$/, 'a touch tablet held sideways (1280 by 800, 3:2) is not a stage: the stage asks for a mouse');
  for (const [w, h] of [[1180, 820], [1366, 1024], [1024, 1366], [820, 1180], [1024, 768], [390, 844], [844, 390], [932, 430], [1280, 1024], [1200, 700]]) assert.ok(!matches(STAGE, w, h), `${w}x${h} is not a stage`);
});

test('isStage asks the window and never throws; u is 1 on 1920 by 1080 and the same frame scaled elsewhere', () => {
  assert.equal(isStage({ matchMedia: (q) => ({ matches: q === STAGE }) }), true);
  assert.equal(isStage({ matchMedia: () => ({ matches: false }) }), false);
  assert.equal(isStage({ matchMedia: () => { throw new Error('no'); } }), false);
  assert.equal(isStage(null), false);
  assert.equal(u({ innerWidth: 1920, innerHeight: 1080 }), 1);
  assert.equal(u({ innerWidth: 1280, innerHeight: 720 }), 1280 / 1920);
  assert.equal(u({ innerWidth: 1440, innerHeight: 900 }), 1440 / 1920);
});

test('the worker keeps js/stage.js with the shell, under a new name of the cache', () => {
  assert.match(sw, /const SHELL_APP = \[[^\]]*'js\/stage\.js'/);
  assert.match(sw, /const CACHE = 'parallax-v53';/);
});

test('the figure of ties draws larger points and words on a stage, and the same as before elsewhere', () => {
  const g = graphFromPairs([{ sid: 'a', n: 4, sides: { jp: 2, intl: 2, gov: 0 } }, { sid: 'b', n: 9, sides: { jp: 5, intl: 4, gov: 0 } }], [{ a: 'a', b: 'b', words: ['FBI', '捜査'], places: [] }]);
  const pos = layout(g, { w: 400, h: 300 });
  const log = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { log.push([k, ...a]); return { width: 10 }; }), set: (t, k, v) => { t[k] = v; log.push(['set', k, v]); return true; } });
  draw(ctx, g, pos, { w: 400, h: 300, sel: 'a', label: () => 'x' });
  assert.ok(log.some((e) => e[0] === 'set' && e[1] === 'font' && e[2] === '13px system-ui, sans-serif'));
  const r1 = log.filter((e) => e[0] === 'arc').map((e) => e[3]);
  log.length = 0;
  draw(ctx, g, pos, { w: 400, h: 300, sel: 'a', label: () => 'x', fs: 22, rs: 1.6 });
  assert.ok(log.some((e) => e[0] === 'set' && e[1] === 'font' && e[2] === '22px system-ui, sans-serif'));
  const r2 = log.filter((e) => e[0] === 'arc').map((e) => e[3]);
  r1.forEach((r, i) => assert.ok(Math.abs(r2[i] - r * 1.6) < 1e-9));
  // a click just outside the old reach of a point lands on it when the point is drawn larger
  const p = pos[1], far = 3 + Math.min(9, Math.sqrt(9) * 2.2) + 10;
  assert.equal(hit(pos, g, p.x + far, p.y), -1);
  assert.equal(hit(pos, g, p.x + far, p.y, 1.6), 1);
});

test('the show is asked for by ?show, and is a show only on a stage', () => {
  assert.equal(wantsShow({ search: '?tour=0&show', hash: '' }), true);
  assert.equal(wantsShow({ search: '', hash: '#map&show' }), true);
  assert.equal(wantsShow({ search: '?shows=1', hash: '#showcase' }), false);
  assert.equal(wantsShow(null), false);
  const doc = (on) => ({ documentElement: { hasAttribute: (k) => on && k === 'data-show' } });
  assert.equal(isShow({ matchMedia: () => ({ matches: true }), document: doc(true) }), true);
  assert.equal(isShow({ matchMedia: () => ({ matches: false }), document: doc(true) }), false, 'a phone with ?show draws as it always does');
  assert.equal(isShow({ matchMedia: () => ({ matches: true }), document: doc(false) }), false);
});

test('the figure seen from the chosen news: it stands in the middle and its farthest tie reaches a third of the figure', () => {
  const pos = [{ x: 380, y: 280 }, { x: 390, y: 280 }, { x: 100, y: 100 }];
  const v = focusView(pos, 0, [1], 800, 600);
  assert.deepEqual(v[0], { x: 400, y: 300 });
  assert.ok(Math.abs(v[1].x - 430) < 1e-9 && v[1].y === 300, 'a near tie is drawn out, at most 3 times');
  assert.equal(focusView(pos, 9, [], 800, 600), pos, 'nothing chosen: the same points');
});

test('the media table of the show: the outlets that carry most on each side, the rows where the sides differ most', () => {
  const side = ['jp', 'jp', 'jp', 'jp', 'intl', 'intl'];
  const on = [
    [1, 1, 1, 0, 0, 0],   // Japan only: differs most
    [1, 1, 0, 0, 1, 1],   // both
    [0, 0, 0, 0, 1, 1],   // abroad only
    [0, 0, 0, 0, 0, 0],   // nobody: never shown
  ].map((r) => r.map(Boolean));
  const p = coverPick(on, side, { per: 2, rows: 2 });
  assert.deepEqual(p.cols, [0, 1, 4, 5]);
  assert.deepEqual(p.rows, [0, 2]);
});
