// node --test tests/js/home1117.test.js
// The home on a wide window, 2026-11-17: the card leads with words (headline, then what the news is, then the counts), the photo is a small
// picture at the headline's right, the panel's rows are whole buttons, and the card's steps keep the headline and its brief to the last.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const css = read('css/app.css');
const A = css.indexOf('/* ---- v66 (2026-11-17)'), B = css.indexOf('/* ==== v64:end ==== */');
const v66 = css.slice(A, B);

test('v66 block sits inside the stylesheet and only acts from 1101 px wide', () => {
  assert.ok(A > 0 && B > A);
  assert.match(v66, /^[^]*@media \(min-width: 1101px\) \{/);
  assert.doesNotMatch(v66.replace(/@media \(min-width: 1101px\) \{[^]*$/, ''), /\.hr-/, 'nothing of the card is set outside the wide window');
});

test('the card reads in the order headline, brief, counts, bar, sides, findings, buttons; the photo stands at the headline', () => {
  const m = /grid-template-areas: ("[^;]+");/.exec(v66);
  assert.ok(m);
  assert.deepEqual(m[1].match(/"([^"]+)"/g).map((x) => x.replace(/"/g, '').split(' ')[0]), ['meta', 't', 'brief', 'facts', 'share', 'sds', 'fnd', 'note', 'acts']);
  assert.match(m[1], /"t ph" "brief ph"/);
  assert.match(v66, /\.hr-card \.hr-ph \{ grid-area: ph;[^}]*width: clamp\(116px, 8\.5vw, 164px\)/);
});

test('the steps leave the headline and its brief for last: the sides go before the brief, and the first brief row stays', () => {
  for (let k = 1; k <= 7; k++) assert.ok(v66.includes(`"${k}"`), `a rule names step ${k}`);
  assert.match(v66, /"6"\], \[data-fit="7"\]\) \.hr-sds \{ display: none; \}/);
  assert.match(v66, /\.hr-brief :is\(dt, dd\):nth-child\(n\+3\) \{ display: none; \}/);
  assert.doesNotMatch(v66, /\.hr-brief \{ display: none/);
});

test('the panel: a row is one button the width of the panel, and a field of the table presses from its whole row', () => {
  assert.match(v66, /\.fr-one \.fr-row, [^{]*\{ display: grid;[^}]*width: 100%; min-height: 52px;/);
  assert.match(v66, /\.fr-gl:is\(\.ev, \.fld\)::after \{ content: ""; position: absolute; inset: 0;/);
  const front = read('js/front.js');
  assert.match(front, /class: 'fr-gl fld'/);
  assert.match(front, /class: 'fr-rm'/);
});
