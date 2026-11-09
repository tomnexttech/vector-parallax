import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageOf, gapsOf, leadRows, createCoverage, LEAD_ROWS, TERM_KINDS } from '../../js/coverage.js';
import { STORY } from '../../js/story.js';

// a small stand-in for the page's h(): { tag, attrs, kids }
const h = (tag, attrs, ...kids) => {
  const n = { tag, attrs: attrs || {}, kids: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) };
  n.replaceChildren = (...k) => { n.kids = k.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false); };
  n.setAttribute = (k, v) => { n.attrs[k] = v; };
  return n;
};
const text = (n) => (typeof n === 'string' ? n : n && n.kids ? (n.attrs.text || '') + n.kids.map(text).join('') : '');

const all = (n, f, out = []) => { if (n && typeof n === 'object') { if (f(n)) out.push(n); n.kids.forEach((k) => all(k, f, out)); } return out; };

const raw = () => ({
  v: 1,
  outlets: [{ name: '朝日新聞', side: 'jp', lang: 'ja', desc: false }, { name: 'NHK', side: 'jp', lang: 'ja', desc: true }, { name: 'AFP', side: 'intl', lang: 'ja', desc: true }, { name: 'The Times', side: 'intl', lang: 'en', desc: true }],
  rows: [
    { k: 'who', t: 'ペニャ', c: ['', { p: '…ペニャ大統領を罷免', k: 'ペニャ' }, { p: 'サンティアゴ・ペニャ大統領が5日', k: 'ペニャ' }, null] },
    { k: 'when', t: 'いつ', c: ['', '', { p: '…大統領が5日', k: '5日' }, null] },
    { k: 'num', t: '数・割合', c: ['', { p: '人口の半数近くが', k: '半数' }, { p: '人口のほぼ半数が', k: 'ほぼ半数' }, null] },
    { k: 'why', t: '理由', c: [{ p: '経営破綻めぐり', k: 'めぐり' }, '', '', null] },
  ],
  words: [{ t: '職を離れる', v: [{ w: '罷免', o: [1] }, { w: '辞任', o: [2] }] }],
});

test('the section is in the list of an event, after the point', () => {
  assert.deepEqual(STORY.map((x) => x[0]), ['pt', 'cv', 'tl', 'sd', 'src']);
});

test('coverageOf: a table made by the build reads back, text is cut and numbers stay in range', () => {
  const c = coverageOf(raw());
  assert.equal(c.outlets.length, 4);
  assert.equal(c.rows.length, 4);
  assert.deepEqual(c.rows[0].c.map((x) => (x === null ? null : x === '' ? '' : x.k)), ['', 'ペニャ', 'ペニャ', null]);
  const wild = raw();
  wild.rows[0].c[1] = { p: 'あ'.repeat(200), k: 'い'.repeat(200) };
  wild.rows.push({ k: 'weird', t: 'x', c: ['x', 'x', 'x', 'x'] });
  wild.words[0].v[0].o = [1, 99, -1, 1.5, 1];
  const k = coverageOf(wild);
  assert.ok(Array.from(k.rows[0].c[1].p).length <= 60);
  assert.ok(!k.rows.some((r) => r.k === 'weird'));
  assert.deepEqual(k.words[0].v[0].o, [1]);
});

test('coverageOf: an old file, a broken shape, one outlet: null, so the screen is as it was', () => {
  for (const bad of [undefined, null, 3, 'x', [], {}, { v: 2 }, { ...raw(), v: 2 }, { ...raw(), outlets: [raw().outlets[0]] }, { ...raw(), outlets: 'x' }, { ...raw(), outlets: [{ name: '' }, { name: 'a' }] }, { ...raw(), rows: 'x', words: 'y' }]) {
    assert.equal(coverageOf(bad), null, JSON.stringify(bad) && JSON.stringify(bad).slice(0, 60));
  }
  assert.doesNotThrow(() => coverageOf({ v: 1, outlets: [{ name: 'a' }, { name: 'b' }], rows: [null, 3, { k: 'who', c: 5 }], words: [3] }));
});

test('gapsOf: carried, not found in the headline and the description, not compared (another language)', () => {
  const c = coverageOf(raw());
  assert.deepEqual(gapsOf(c.rows[0]), { have: 2, none: 1, na: 1 });
  assert.deepEqual(gapsOf(c.rows[3]), { have: 1, none: 2, na: 1 });
});

test('leadRows: the rows only some outlets carry come first, the original order inside', () => {
  const cov = { outlets: raw().outlets, rows: Array.from({ length: 10 }, (_, i) => ({ k: 'who', t: 'r' + i, c: i < 3 ? [{ p: 'a', k: 'a' }, { p: 'a', k: 'a' }, { p: 'a', k: 'a' }, { p: 'a', k: 'a' }] : i === 9 ? ['', '', '', { p: 'a', k: 'a' }] : ['', { p: 'a', k: 'a' }, '', ''] })), words: [] };
  const lead = leadRows(cov, 4);
  assert.equal(lead.length, 4);
  assert.deepEqual(lead.map((r) => r.t), ['r3', 'r4', 'r5', 'r6']);          // 全部が載せている行は後ろへ
  assert.equal(leadRows(coverageOf(raw()), 7).length, 4);
  assert.equal(LEAD_ROWS, 7);
});

test('the card: the outlets across, a dash where the headline and the description do not carry it, a dot where it was not compared; no word of silence', () => {
  const { node } = createCoverage({ h });
  const el = node(coverageOf(raw()));
  assert.equal(el.tag, 'section');
  const ths = all(el, (n) => n.tag === 'th' && n.attrs.scope === 'col' && n.kids.some((k) => k.tag === 'b'));
  assert.deepEqual(ths.map((t) => text(t.kids.find((k) => k.tag === 'b'))), ['朝日新聞', 'NHK', 'AFP', 'The Times']);
  const tds = all(el, (n) => n.tag === 'td');
  assert.equal(tds.length, 16);
  assert.equal(tds.filter((t) => t.attrs.class.startsWith('on')).length, 6);
  assert.equal(tds.filter((t) => t.attrs.class === 'off').length, 6);
  assert.equal(tds.filter((t) => t.attrs.class === 'na').length, 4);
  assert.ok(tds.filter((t) => t.attrs.class === 'off').every((t) => /見出しと要旨には出ていない/.test(t.attrs.title)));
  assert.ok(tds.filter((t) => t.attrs.class === 'na').every((t) => /言語が違う/.test(t.attrs.title)));
  const marks = all(el, (n) => n.tag === 'mark');
  assert.deepEqual(marks.map((m) => m.attrs.text), ['ペニャ', 'ペニャ', '5日', '半数', 'ほぼ半数', 'めぐり']);
  const all_text = text(el);
  for (const w of ['報じなかった', '報じていない', '報道しなかった', '隠', '意図', '黙殺']) assert.ok(!all_text.includes(w), w);
});

test('the card: the words of the row name the term; a term row keeps a mark for the narrow table; the count of outlets is the count in the table', () => {
  const { node } = createCoverage({ h });
  const el = node(coverageOf(raw()));
  assert.deepEqual(TERM_KINDS, ['who', 'what', 'where']);
  const rowTh = all(el, (n) => n.tag === 'th' && n.attrs.scope === 'row');
  assert.equal(text(rowTh[0].kids[0]), 'ペニャ');
  assert.match(text(rowTh[0]), /誰・2\/3/);                                   // 3 社を照合して 2 社
  const dots = all(el, (n) => n.tag === 'i' && n.attrs.class === 'cv-dot');
  assert.equal(dots.length, 2);
  assert.equal(all(el, (n) => n.attrs && n.attrs.role === 'region').length, 1);
  assert.equal(all(el, (n) => n.attrs && n.attrs.tabindex === '0').length, 1);
  assert.match(text(el), /言い方の違い/);
  assert.match(text(el), /職を離れる/);
});

test('the rest of the rows is behind a button that says how many', () => {
  const { node } = createCoverage({ h });
  const c = coverageOf(raw());
  c.rows = Array.from({ length: 10 }, (_, i) => ({ k: 'what', t: 'w' + i, c: ['', { p: 'x', k: 'x' }, { p: 'x', k: 'x' }, ''] }));
  const el = node(c, { n: 7 });
  const btn = all(el, (n) => n.tag === 'button')[0];
  assert.equal(text(btn), '残り 3 行を見る');
  assert.equal(all(el, (n) => n.tag === 'tr' && n.attrs.data && n.attrs.data.k).length, 7);
  assert.equal(all(node({ ...c, rows: c.rows.slice(0, 5) }), (n) => n.tag === 'button').length, 0);
});
