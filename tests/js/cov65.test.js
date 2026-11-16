// node --test tests/js/cov65.test.js
// v65 (2026-11-16): 媒体比較 in narrow columns. A name is never cut inside a word (the short form of the name heads the column, or the name stands upright),
// a cell shows the word it was matched on, and pressing it reads the sentence under the table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shortName, keyOf, coverageOf, createCoverage } from '../../js/coverage.js';

const read = (p) => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const h = (tag, attrs, ...kids) => {
  const n = { tag, attrs: attrs || {}, kids: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) };
  n.replaceChildren = (...k) => { n.kids = k.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false); };
  return n;
};
const all = (n, f, out = []) => { if (n && typeof n === 'object') { if (f(n)) out.push(n); n.kids.forEach((k) => all(k, f, out)); } return out; };
const css = read('css/app.css');
const v64 = css.slice(css.indexOf('/* ==== v64:begin ===='), css.indexOf('/* ==== v64:end ==== */'));

test('shortName: the name as it is spoken, never cut inside a word', () => {
  assert.equal(shortName('The Japan Times'), 'Japan Times');
  assert.equal(shortName('朝日新聞'), '朝日');
  assert.equal(shortName('共同通信'), '共同');
  assert.equal(shortName('日本経済新聞'), '日経');
  assert.equal(shortName('CRI/人民網'), '人民網');
  assert.equal(shortName('Bloomberg'), 'Bloomberg');
  assert.equal(shortName('NHK'), 'NHK');
  assert.equal(shortName('新聞'), '新聞');
});

test('keyOf: the matched word, else the start of the sentence', () => {
  assert.equal(keyOf({ p: '…President Xi Jinping and', k: 'Xi Jinping' }), 'Xi Jinping');
  assert.equal(keyOf({ p: 'ペニャ大統領を罷免', k: '' }), 'ペニャ大統領を罷免');
  assert.equal(keyOf({ p: '…abcdefghijklmnopqrstuvwxyz', k: 'zzz' }), 'abcdefghijkl…');
});

test('the table carries the short name in data-sn only where it differs, the whole name stays in the text, and each cell carries its word', () => {
  const c = coverageOf({ v: 1,
    outlets: [{ name: '朝日新聞', side: 'jp', lang: 'ja', desc: true }, { name: 'AFP', side: 'intl', lang: 'ja', desc: true }, { name: 'The Times', side: 'intl', lang: 'en', desc: true }],
    rows: [{ k: 'who', t: 'ペニャ', c: [{ p: 'ペニャ大統領を罷免', k: 'ペニャ' }, { p: 'ペニャ氏', k: 'ペニャ' }, null] }, { k: 'why', t: '理由', c: ['', { p: '経営破綻めぐり', k: 'めぐり' }, null] }], words: [] });
  const el = createCoverage({ h }).table(c);
  const heads = all(el, (n) => n.tag === 'b');
  assert.deepEqual(heads.map((b) => (b.attrs.data ? b.attrs.data.sn : null)), ['朝日', null, null]);
  assert.deepEqual(heads.map((b) => b.kids[0].attrs.text), ['朝日新聞', 'AFP', 'The Times']);
  const keys = all(el, (n) => n.attrs && n.attrs.class === 'cv-k');
  assert.deepEqual(keys.map((k) => k.attrs.text), ['ペニャ', 'ペニャ', 'めぐり']);
});

test('the css: no cut inside a word in the names or the cells; narrow columns show the short name, the word and the sentence under the table; a phone keeps its cards', () => {
  assert.doesNotMatch(v64, /overflow-wrap: anywhere; word-break: normal; \}/, 'the names and the cells break at a word');
  assert.match(v64, /\[data-sn\]::after \{ content: attr\(data-sn\); \}/);
  assert.match(v64, /\.cv-wrap\[data-fit="tight"\] \.cv-t td\.on \.cv-k \{ font-size: var\(--fs-2\); \}/);
  assert.match(v64, /\.cv-k\[data-sz="1"\] \{ font-size: 11px;/);
  assert.match(v64, /> \.cv-det\[data-on="1"\] \{ display: block;/);
  // the narrow-column rules are in a block that is only for 761 px and over, so the phone's card of a row is not touched
  const a = v64.indexOf('narrow columns (tight, slim)'), m = v64.indexOf('@media screen and (min-width: 761px) {', a), e = v64.indexOf('/* a column nothing fills', a);
  assert.ok(a > 0 && m > a && e > m);
  assert.match(v64, /\(max-width: 760px\) \{[\s\S]*?\.cv-wrap > \.cv-det \{ display: none !important; \}/);
  const src = read('js/coverage.js');
  assert.match(src, /setAttribute\('data-names', 'v'\)/);
  assert.match(src, /setAttribute\('data-sz'/);
});
