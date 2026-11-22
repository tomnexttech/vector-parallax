// v61 (11-16): the fixes that came out of the six-person debate. Source-level checks for what has no DOM in a node test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.js';

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

test('a page that cannot read its data says what happened and what to do, with a button to read again', () => {
  const app = read('js/app.js');
  assert.match(app, /function whyUnread\(err\)/);
  assert.match(app, /データのファイルが見つかりません（HTTP/);
  assert.match(app, /showFatal\('データを読み込めませんでした', \{ fact: whyUnread\(err\)/);
  assert.match(app, /もう一度読み込む/);
  assert.match(read('index.html'), /<div class="fatal" id="fatal" role="alert" hidden><\/div>/);
});

test('the notes on the データ・AI sheet do not use the name of the 3D map layer, which is position: absolute over the page', () => {
  const css = read('css/app.css');
  assert.match(css, /\.about-notes \{/);
  assert.match(read('js/app.js'), /h\('ul', \{ class: 'about-notes' \}/);
  assert.doesNotMatch(read('js/app.js'), /h\('ul', \{ class: 'floor' \}/);
});

test('the run of time keeps room for its labels: a cap row above the lines and lanes tall enough for a 10-unit name', () => {
  const d = read('js/dossier.js'), a = read('js/app.js');
  assert.match(d, /const W = 300, H = 100, TOP = 16, FOOT = 17,/);
  assert.match(a, /const W = 260, LH = 18, L = 62,/);
  assert.match(read('css/app.css'), /\.board :is\(\.ax, \.lanes \.lt\) \{ font-size: 10px; \}/);
});

test('a photo that is not in yet is tinted by its field, not black', () => {
  assert.match(read('css/app.css'), /:is\(\.rth, \.en-ph, \.hr-ph, \.nt-ph, \.pimg, \.bd-f\):not\(\.none\) \{ background: color-mix\(in srgb, var\(--gc, var\(--ink\)\) 14%, transparent\); \}/);
});

test('the service worker is v66 (the 11-17 home pass)', () => {
  assert.match(read('sw.js'), /const CACHE = 'parallax-v84';/);
});

test('the service worker is v66: a server error (5xx) is answered with the copy kept on the device when there is one', () => {
  const sw = read('sw.js');
  assert.match(sw, /const CACHE = 'parallax-v84';/);
  assert.match(sw, /res\.status >= 500\) return caches\.match\(req/);
});

test('a page that cannot read its data names the next step by what went wrong, and does not say a copy is missing when a 404 says the path is', () => {
  const a = read('js/app.js');
  assert.match(a, /function nextOfUnread\(err\)/);
  assert.match(a, /next: nextOfUnread\(err\)/);
  assert.match(a, /Number\(code\[1\]\) < 500\) return '読み込むファイルの場所を確かめてください/);
});

test('the order says its count once: all of them, or the top of them; a ministry counts on the home side in the order and in the lists of one side', () => {
  const f = read('js/front.js'), a = read('js/app.js');
  assert.match(f, /\? `上位 \$\{list\.length\} \/ \$\{o\.scored\} 話を測定` : `\$\{list\.length\} 話を測定`/);
  assert.match(a, /const homeSides = \(e\) =>/);
  assert.match(a, /oneSideOf\(live\.filter\(inF\), \{ sidesOf: homeSides, outletOf \}\)/);
  assert.match(read('js/heads.js'), /'panel\.score': \['偏り度'/);
});
