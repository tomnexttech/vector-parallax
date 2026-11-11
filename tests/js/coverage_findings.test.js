import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson, clone } from './helpers.js';
import { coverageOf, findingsOf, createCoverage, FIND_KINDS } from '../../js/coverage.js';

// the board of the sample (tests/fixtures/make_data_samples.py) is not committed; the hero sample carries the findings of its first card
const hero = readJson('tests', 'fixtures', 'hero.sample.json');
const cov = {
  v: 1,
  outlets: [{ name: 'A', side: 'jp', lang: 'ja', desc: true }, { name: 'B', side: 'jp', lang: 'ja', desc: false }, { name: 'X', side: 'intl', lang: 'ja', desc: false }],
  rows: [{ k: 'num', t: '数・人数', c: [{ p: '300人が抗議', k: '300人' }, '', { p: '5000人が抗議', k: '5000人' }] }, { k: 'who', t: '長官', c: [{ p: '長官', k: '長官' }, { p: '長官', k: '長官' }, ''] }],
  words: [],
  findings: [
    { kind: 'only_side', row: 'who', outlets: [0, 1], others: [2], side: 'jp', text: '「長官」は国内 2 社が載せ、海外 1 社の見出しと要旨には出ていない', evidence: [{ o: 0, p: '長官', k: '長官' }] },
    { kind: 'num_diff', row: 'num', outlets: [0], others: [2], side: null, text: '人数が違う：300人（A）・5000人（X）', evidence: [] },
  ],
};

test('findings are read with the table, in range and in fixed kinds', () => {
  const c = coverageOf(cov);
  assert.equal(c.findings.length, 2);
  assert.deepEqual(c.findings[0].outlets, [0, 1]);
  assert.ok(hero.picks[0].findings.length >= 1);
  assert.ok(hero.picks[0].findings.every((f) => FIND_KINDS.includes(f.kind)));
});

test('a finding with a silence word, an unknown kind or numbers out of range is cut', () => {
  const x = clone(cov.findings);
  x.push({ kind: 'only_side', text: '海外 1 社は報じなかった', outlets: [0] }, { kind: 'other', text: 'x' }, { ...x[0], outlets: [0, 9, -1, 1.5, true] });
  const got = findingsOf(x, 3);
  assert.equal(got.length, 3);
  assert.deepEqual(got[2].outlets, [0]);
  assert.deepEqual(findingsOf('x', 3), []);
  assert.deepEqual(coverageOf({ ...cov, findings: undefined }).findings, []);
});

test('the card shows the lines above the table', () => {
  const h = (tag, attrs, ...kids) => {
    const n = { tag, attrs: attrs || {}, kids: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) };
    n.replaceChildren = (...k) => { n.kids = k.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false); };
    return n;
  };
  const text = (n) => (typeof n === 'string' ? n : (n.attrs.text || '') + n.kids.map(text).join(''));
  const card = createCoverage({ h }).node(coverageOf(cov));
  const f = card.kids.find((k) => k.attrs && k.attrs.class === 'cv-w cv-f');
  assert.ok(f);
  assert.match(text(f), /違い/);
  assert.match(text(f), /人数が違う/);
  assert.ok(card.kids.indexOf(f) < card.kids.findIndex((k) => k.attrs && k.attrs.class === 'cv-wrap'));
  assert.equal(createCoverage({ h }).findings(coverageOf({ ...cov, findings: [] })), null);
});
