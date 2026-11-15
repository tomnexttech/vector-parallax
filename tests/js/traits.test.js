// 媒体の特徴 (js/traits.js): Sir 11-15 「データから明らかなメディアの特徴を無視し、比較や考察を拒否することは情報に対して誠実とは言えない。
// この会社＝全てが極右と断定することは間違いだが、逆に参考にしないことも間違い。」 Counted against the mean of the outlet's side, with the
// count and the span; too few reports give the counts only; no label is put on an outlet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statsOf, traitsOf, notesOf, termsOf, sideOf, traitsBlock, ratingsOf, TRAIT_MIN } from '../../js/traits.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outletOf = (it) => it.outlet;
let id = 0;
const it = (outlet, home, title, ts = 1000 + id) => ({ id: String(++id), outlet, home, title, ts, type: home === 'intl' ? '海外主流' : '全国紙' });
// A carries economy news only Japan reports; B and C carry the world news both sides report
function world() {
  const es = [];
  for (let i = 0; i < 12; i++) es.push({ key: `a${i}`, field: '経済', members: [it('A', 'jp', `日銀 利上げ 批判 ${i}`), it('B', 'jp', `景気 ${i}`)] });
  for (let i = 0; i < 12; i++) es.push({ key: `w${i}`, field: '国際', members: [it('B', 'jp', `米国 選挙 ${i}`), it('C', 'jp', `米国 大統領 ${i}`), it('X', 'intl', `US election ${i}`)] });
  for (let i = 0; i < 3; i++) es.push({ key: `c${i}`, field: '国際', members: [it('C', 'jp', `欧州 ${i}`), it('A', 'jp', `欧州 首脳 ${i}`), it('X', 'intl', `Europe ${i}`)] });
  return es;
}

test('the words of a headline: kanji and katakana runs, latin words without the common ones', () => {
  assert.ok(termsOf('日銀が利上げ、ウクライナ情勢').includes('日銀'));
  assert.ok(termsOf('日銀が利上げ、ウクライナ情勢').includes('ウクライナ'));
  assert.ok(termsOf('The election results after the vote').includes('election'));
  assert.ok(!termsOf('The election results after the vote').includes('after'));
  assert.equal(sideOf([{ home: 'intl' }, { home: 'intl' }, { home: 'jp' }]), 'intl');
});

test('one outlet\'s counts: its news, its reports, its span, the news only its side carried', () => {
  const s = statsOf(world(), 'A', { outletOf });
  assert.equal(s.n, 15); assert.equal(s.reports, 15); assert.equal(s.side, 'jp');
  assert.equal(s.alone, 12, 'the economy news has no report abroad');
  assert.equal(s.tone.nNeg, 12, '批判 in twelve headlines');
  assert.equal(statsOf(world(), 'nobody', { outletOf }), null);
});

test('beside the mean of its side: field mix, own-side news, the outlets alongside; three lines at most, each with its numbers', () => {
  const t = traitsOf(world(), 'A', { outletOf, biasOf: () => null, fields: ['国際', '経済'] });
  assert.equal(t.few, false);
  const eco = t.fields.find((r) => r.f === '経済');
  assert.equal(Math.round(eco.pc), 80);
  assert.ok(eco.d > 12, 'A carries far more economy news than B and C');
  assert.ok(t.alone.pc > t.alone.base);
  assert.ok(t.notes.length >= 1 && t.notes.length <= 3);
  assert.ok(t.notes.every((x) => /\d/.test(x)), 'every line carries its numbers');
  assert.ok(t.notes.every((x) => !/(極右|極左|右派|左派|偏向)/.test(x)), 'no label on the outlet');
  assert.ok(t.words.some((w) => w.w === '日銀'), 'a word it uses far more than the others');
});

test('too few reports: the counts and no tendency', () => {
  const es = world().slice(0, TRAIT_MIN - 2);
  const t = traitsOf(es, 'A', { outletOf, biasOf: () => null, fields: [] });
  assert.equal(t.few, true);
  assert.deepEqual(t.notes, []);
  assert.deepEqual(notesOf({ ...t, few: false, fields: [], words: [], alone: { base: null }, agree: {}, tone: {}, bias: { n: 0 } }), []);
});

test('the sheet: the basis line, the sections under their short names, outside ratings with source and the day checked', () => {
  const made = [];
  const h = (tag, attrs, ...kids) => { const e = { tag, attrs: attrs || {}, kids: kids.flat(Infinity).filter((x) => x != null) }; made.push(e); return e; };
  const t = traitsOf(world(), 'A', { outletOf, biasOf: () => ({ ok: true, score: 40 }), fields: ['国際', '経済'] });
  const ratings = { sources: { mbfc: { name: 'Media Bias/Fact Check' } }, bias_ja: { 'LEAST BIASED': '偏り最小' }, fact_ja: { HIGH: '高い' }, outlets: { A: [{ src: 'mbfc', bias: 'LEAST BIASED', factual: 'HIGH', url: 'https://example.org/a', updated: '2026-04-09', checked: '2026-11-15' }] } };
  const secs = [];
  traitsBlock(t, { h, clock: () => '11/15 9:00', ratings, head: (k) => k, sec: (title) => { secs.push(title); return h('h3', { text: title }); } });
  assert.deepEqual(secs, ['outlet.note', 'outlet.fields', 'outlet.alone', 'outlet.agree', 'outlet.words', 'outlet.tone', 'outlet.bias', 'outlet.ext']);
  assert.ok(made.some((e) => /記事 15 件・話 15 件・11\/15 9:00〜11\/15 9:00/.test(e.attrs.text || '')));
  assert.ok(made.some((e) => /確かめた日 2026-11-15/.test(e.attrs.text || '')));
});

test('the outside ratings on file each name their page and the day they were checked', () => {
  const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ratings.json'), 'utf8'));
  const rows = Object.values(r.outlets).flat();
  assert.ok(rows.length >= 1);
  for (const x of rows) {
    assert.match(x.url, /^https:\/\//);
    assert.match(x.checked, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.sources[x.src], x.src);
    assert.ok(r.bias_ja[x.bias] && r.fact_ja[x.factual], `${x.bias} / ${x.factual} have Japanese names`);
  }
});

test('an outlet is found in the ratings by its own name or by another name of it: "AP News" is "AP"', () => {
  const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ratings.json'), 'utf8'));
  assert.equal(ratingsOf(r, 'AP').length, 1);
  assert.equal(ratingsOf(r, 'AP News'), r.outlets.AP);
  assert.equal(ratingsOf(r, 'ap news'), r.outlets.AP);
  assert.equal(ratingsOf(r, 'The Wall Street Journal'), r.outlets.WSJ);
  assert.equal(ratingsOf(r, 'CNN.co.jp'), r.outlets.CNN);
  assert.deepEqual(ratingsOf(r, 'NHK'), []);          // an outlet nobody rated stays without a row
  assert.deepEqual(ratingsOf(null, 'AP'), []);
  assert.deepEqual(ratingsOf({ outlets: { A: [1] }, aliases: { B: 'Z' } }, 'B'), []);   // an alias that points nowhere finds nothing
});
