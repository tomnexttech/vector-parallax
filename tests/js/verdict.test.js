import test from 'node:test';
import assert from 'node:assert/strict';
import { verdictOf, SHOW_AGREE } from '../../js/verdict.js';
import { coverageOf } from '../../js/coverage.js';

const on = (p) => ({ p, k: p });
const cov = (outlets, rows, findings = []) => coverageOf({ v: 1, outlets, rows, words: [], findings });
const O = (name, side) => ({ name, side, lang: 'ja', desc: true });

test('a row both sides carry, in 3/4 of the outlets compared, is an agreement; a row one side alone carries is a split with its counts', () => {
  const c = cov([O('a', 'jp'), O('b', 'jp'), O('c', 'intl'), O('d', 'intl')], [
    { k: 'who', t: '首相', c: [on('首相'), on('首相'), on('首相'), on('首相')] },
    { k: 'num', t: '数・人数', c: [on('3人'), on('3人'), '', ''] },
    { k: 'why', t: '理由', c: ['', '', '', ''] }]);
  const v = verdictOf(c, { ok: true, score: 40, terms: [{}, {}], skipped: [{}] });
  assert.deepEqual(v.agree.map((a) => [a.label, a.hv, a.cm]), [['誰：首相', 4, 4]]);
  assert.equal(v.split.length, 1);
  assert.deepEqual([v.split[0].a.side, v.split[0].a.hv, v.split[0].b.hv, v.split[0].b.cm], ['home', 2, 0, 2]);
  assert.equal(v.split[0].lvl, 'mid');
  assert.deepEqual(v.bias, { score: 40, measured: 2, total: 3 });
});

test('no number is made up: with one side only, or no table, there is no verdict; a bias that could not be measured has no score', () => {
  assert.equal(verdictOf(null, null), null);
  const one = cov([O('a', 'jp'), O('b', 'jp')], [{ k: 'who', t: 'x', c: [on('x'), on('x')] }, { k: 'what', t: 'y', c: [on('y'), '']}]);
  assert.equal(verdictOf(one, null), null);
  const two = cov([O('a', 'jp'), O('b', 'intl')], [{ k: 'who', t: 'x', c: [on('x'), '']}, { k: 'what', t: 'y', c: ['', on('y')] }]);
  const v = verdictOf(two, { ok: false, reason: '記事が少なく測れません' });
  assert.equal(v.bias.score, null);
  assert.equal(v.bias.reason, '記事が少なく測れません');
  assert.ok(v.split.every((s) => s.lvl === 'weak'));
  assert.match(v.headline, /傾向とは言えません/);
});

test('the sentences never say an outlet did not report, and the limits always name the material', () => {
  const c = cov([O('a', 'jp'), O('b', 'intl'), O('c', 'intl')], [{ k: 'who', t: 'x', c: [on('x'), '', '']}, { k: 'what', t: 'y', c: ['', on('y'), on('y')] }]);
  const v = verdictOf(c, null);
  const all = JSON.stringify(v);
  assert.doesNotMatch(all, /報じなかった|報じていない|隠し/);
  assert.match(v.limits[0], /見出しと要旨だけ/);
  assert.ok(SHOW_AGREE >= 1);
});
