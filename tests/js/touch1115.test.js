import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT } from './helpers.js';
import path from 'node:path';

// measured 11-15 in a headless Chrome at 390, 430, 820 and 1024 px wide, light and dark (the screens of an iPhone and an iPad; not the devices)
const css = readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const media = (q) => { const i = css.lastIndexOf(`@media ${q}`); assert.ok(i >= 0, `@media ${q}`); let d = 0, j = css.indexOf('{', i); const s = j; for (; j < css.length; j++) { if (css[j] === '{') d++; else if (css[j] === '}' && --d === 0) break; } return css.slice(s, j); };

test('a phone: the sheet (媒体の特徴) sits over the top bar, so 閉じる is in reach', () => {
  const bar = /\.tb\s*\{[^}]*z-index:\s*(\d+)/.exec(css);
  const z = /\.sheet-layer\s*\{\s*z-index:\s*(\d+)/.exec(media('(max-width: 760px)'));
  assert.ok(z, 'a z-index for the sheet on a phone');
  assert.ok(!bar || Number(z[1]) > Number(bar[1]), 'above the bar');
  assert.ok(Number(z[1]) > 30);
});

test('a finger: the chips, the outlets of 媒体比較, the links of a list row and the sheet buttons are 44 px', () => {
  const m = media('(pointer: coarse)');
  for (const s of ['.fr-chip', '.entry .gn', '.cv-om', '.cv-more', '#sheet .tbb', '#full-btn']) assert.ok(m.includes(s), s);
  assert.match(m, /\.rm \.lk \{[^}]*min-height: 44px/);
  assert.match(m, /:is\(\.cv-om, \.rm \.lk\) \{[^}]*min-width: 44px/);
  assert.match(m, /#sheet \.ds-x \{[^}]*min-height: 44px/);
});

test('a tablet: the four ways in put the number under the name, as on a phone', () => {
  const m = media('(min-width: 761px) and (max-width: 1100px)');
  assert.match(m, /\.fr-tab \{[^}]*flex-direction: column/);
});
