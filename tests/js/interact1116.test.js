// 2026-11-16: the headlines abroad in Japanese (訳), one rule for the wheel and the keys, the home without a scroll for nothing,
// the cards of 詳しく見る in dark, and a map that moves under nothing blurred. Each test fails if the fault comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { trOf, setTrMode } from '../../js/trans.js';
import { stepOf, scrollerOf } from '../../js/scrollkeys.js';

const css = readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
const app = readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const entry = readFileSync(path.join(ROOT, 'js', 'entry.js'), 'utf8');
const hero = readFileSync(path.join(ROOT, 'js', 'hero.js'), 'utf8');
const mapgl = readFileSync(path.join(ROOT, 'js', 'mapgl.js'), 'utf8');
const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

test('a headline abroad shows its Japanese (訳) and keeps the headline as published', () => {
  setTrMode('ja');
  const it = { title: 'Iran strikes US base in Bahrain', lang: 'en', title_ja: 'イランがバーレーンの米軍基地を攻撃', desc: 'The attack came after', desc_ja: '攻撃は後に起きた' };
  const t = trOf(it);
  assert.equal(t.text, 'イランがバーレーンの米軍基地を攻撃');
  assert.equal(t.tr, true);
  assert.equal(t.lang, null);
  assert.equal(t.orig, 'Iran strikes US base in Bahrain');
  assert.equal(t.desc, '攻撃は後に起きた');
  assert.equal(t.descOrig, 'The attack came after');
  // no translation: the headline as published, marked English
  const n = trOf({ title: 'Ukraine talks resume', lang: 'en' });
  assert.deepEqual([n.text, n.tr, n.lang], ['Ukraine talks resume', false, 'en']);
  // a Japanese headline is never replaced
  const j = trOf({ title: '熊本市長選で現職が4選', lang: 'ja', title_ja: 'x' });
  assert.deepEqual([j.text, j.tr], ['熊本市長選で現職が4選', false]);
  // a translation that is not Japanese is not used
  assert.equal(trOf({ title: 'A', lang: 'en', title_ja: 'B' }).tr, false);
  // the setting 元の見出し / English keeps the headline as published
  setTrMode('orig');
  assert.equal(trOf(it).text, 'Iran strikes US base in Bahrain');
  setTrMode('ja');
});

test('every screen that shows an outlet\'s headline goes through the translation', () => {
  assert.match(app, /import \{ setTrMode, trOf, trMark, trMode \} from '\.\/trans\.js';/);
  assert.match(app, /const it = rep \|\| e\.titled\[0\], t = trOf\(it\);/, 'the title of a news without an AI headline');
  assert.match(app, /if \(hd\.tr\) return h\('span', \{ class: cls \}, h\('span', \{ class: 'xl-m'/, 'the title carries 訳');
  for (const k of ["class: 'mh'", "class: 'tl-hl'", "class: 'rp-h'", "class: 'lf-h'", "class: 'lk ppr-t'"]) assert.ok(app.includes(k) && new RegExp(`trMark\\(h, tt\\)[^\\n]*|${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*trMark`).test(app), k);
  assert.match(entry, /const tt = trOf\(it\), link = o\.safeUrl\(it\.link\), t2 = tt\.text, d = tt\.desc/, '国内／海外の見出し in the detail');
  assert.match(hero, /x\.title_ja && !\/\[぀-ヿ一-鿿\]\/\.test\(x\.title\)\) return \{ text: x\.title_ja/, 'the home card leads in Japanese');
  assert.match(app, /!e\.heading\.tr && JA_CHARS\.test/, 'a translation does not fold two news into one');
  assert.match(sw, /'js\/trans\.js'/);
  assert.match(sw, /'js\/scrollkeys\.js'/);
});

test('the wheel: no box that cannot scroll holds it, and sheets keep theirs', () => {
  const at = css.lastIndexOf('one rule for the wheel');
  assert.ok(at > 0);
  const tail = css.slice(at);
  assert.match(tail, /:is\(\.pb, \.col, \.c1, \.c2, \.c3, \.c4, \.mc-l, \.fl-list\) \{ overscroll-behavior-y: auto; \}/);
  assert.match(tail, /:is\(\[role="dialog"\], \.sheet-layer, \.sheet-wrap\) :is\(\.pb, \.app-body, \.mc-l, \.fl-list, \.col\) \{ overscroll-behavior-y: contain; \}/);
  assert.match(tail, /#p-anom\) > \.pb \{ overflow-y: auto;/, 'the small lists on the right take the wheel');
  // nothing after this block puts contain back on those boxes
  const after = tail.slice(tail.indexOf('overscroll-behavior-y: contain; }') + 10);
  assert.doesNotMatch(after, /overscroll-behavior(-y)?: contain/);
});

test('the keys move the box the wheel moves', () => {
  const box = { clientHeight: 800, scrollHeight: 4000 };
  assert.deepEqual(stepOf('PageDown', false, box), { by: 680 });
  assert.deepEqual(stepOf(' ', true, box), { by: -680 });
  assert.deepEqual(stepOf('Home', false, box), { top: 0 });
  assert.deepEqual(stepOf('End', false, box), { top: 4000 });
  assert.equal(stepOf('ArrowDown', false, box), null, 'the arrows stay with the news list');
  assert.equal(typeof scrollerOf, 'function');
  assert.match(app, /installScrollKeys\(document, window\)/);
});

test('the home has no scroll for nothing; 詳しく見る\'s middle cards sit inside their pane and are not black in dark', () => {
  assert.match(css, /\.hr-amb \{ bottom: 0; \}/);
  assert.match(css, /#p-case > \.pb \{ padding-top: 20px; padding-bottom: 24px; \}/);
  const dark = css.slice(css.lastIndexOf(':root:not([data-theme="light"]):not(#w1)'));
  assert.match(css, /#p-case :is\(\.dcard, \.t-ai, \.sd, \.nt, \.t-reps, \.t-place\):not\(\.cov\) \{\s*background: rgba\(255, 255, 255, \.06\)/);
  assert.ok(dark.length > 0);
});

test('the map moves under nothing blurred and does no heavy work per frame', () => {
  assert.match(css, /\.mpanel \{ -webkit-backdrop-filter: none; backdrop-filter: none;/);
  assert.match(mapgl, /map\.on\('move', \(\) => \{ painted\(true\); \}\);/, 'the marks are grouped again when the map stops');
  assert.match(mapgl, /if \(hoverQ \|\| map\.isMoving\(\)\) return;/, 'no query of the marks on every mouse event of a drag');
});
