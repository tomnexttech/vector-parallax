// The critique of v56 (11-15): the numbers of one screen must agree, and a reading must not tell the gaps of the rules as an outlet's trait.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordsOfTitle, headlineWords } from '../../js/dossier.js';
import { paperOf } from '../../js/front.js';
import { fieldGate, notesOf } from '../../js/traits.js';

test('an English word and its Japanese word meet on one row: Donbas and ドンバス, membership and 加盟', () => {
  const en = wordsOfTitle('U.S. floated idea of Ukraine ceding Donbas for NATO membership').map((w) => w.name);
  assert.ok(en.includes('ドンバス') && en.includes('加盟') && en.includes('ウクライナ'), en.join(','));
  const jp = headlineWords([{ title: 'NATO加盟でドンバス撤退可能か' }, { title: 'U.S. floated idea of Ukraine ceding Donbas for NATO membership' }]);
  const don = jp.find((x) => x.w === 'ドンバス');
  assert.ok(don && don.n === 2, JSON.stringify(jp));
});

test('a side\'s column knows every outlet it counts, so the ones its five headlines leave out can be named', () => {
  const items = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((o, i) => ({ outlet: o, media: o, home: 'intl', title: `t ${i}`, ts: 100 + i }));
  const p = paperOf({ jp: [], intl: items, gov: [], words: { jp: [], intl: [] } });
  const c = p.cols.find((x) => x.side === 'intl');
  assert.equal(c.outlets, 8);
  assert.equal(c.names.length, 8);
  assert.ok(c.heads.length < c.names.length);
});

test('a field gap is not told where the rules leave most news unplaced or where the side\'s outlets never get the field', () => {
  assert.equal(fieldGate([{ f: '国際', pc: 20, base: 4 }, { f: 'その他', pc: 70, base: 81 }]).k, 'other');
  assert.equal(fieldGate([{ f: '国際', pc: 83, base: 86 }, { f: '経済', pc: 17, base: 0 }]).k, 'top');
  assert.equal(fieldGate([{ f: '国際', pc: 40, base: 50 }, { f: '経済', pc: 50, base: 30 }]), null);
  const t = { me: { side: 'intl' }, fields: [{ f: '国際', n: 19, pc: 50, base: 60, d: -10 }, { f: '経済', n: 4, pc: 17, base: 0, d: 17 }], fieldGate: null,
    alone: { base: null }, agree: {}, tone: {}, bias: { n: 0 }, words: [] };
  assert.deepEqual(notesOf(t), [], 'a field the side\'s outlets almost never get (平均 0%) is no trait of the outlet');
});
