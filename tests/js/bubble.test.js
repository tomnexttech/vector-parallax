import test from 'node:test';
import assert from 'node:assert/strict';
import { orderOf, countsOf, diffOf, available, hbOf, MIN_READS, ORDER_JA } from '../../js/bubble.js';
import { sides } from '../../js/entry.js';
import { readMix, noteRead } from '../../js/tasks.js';

const m = (id, home, type = home === 'intl' ? '海外主流' : '全国紙') => ({ id, outlet: id.toUpperCase(), home, type, ts: 1 });
const e = (sid, members, extra = {}) => ({ key: 'st-' + sid, obj: { sid }, case: { sid }, members, n: members.length, last: 1, field: '国際', ...extra });
const A = e('a', [m('a1', 'jp'), m('a2', 'jp'), m('a3', 'intl'), m('a4', 'jp', '政府一次')]);   // three sides
const B = e('b', [m('b1', 'intl'), m('b2', 'intl')]);                                            // abroad only
const C = e('c', [m('c1', 'jp', '地方紙'), m('c2', 'jp', '専門')], { field: '経済' });           // small outlets only
const D = e('d', [m('d1', 'jp'), m('d2', 'intl')]);                                               // two sides
const es = [B, C, D, A];

test('the orders that cannot be made are not offered', () => {
  assert.deepEqual(available({}), ['all']);
  assert.deepEqual(available({ reaction: { events: {}, items: {} } }), ['all'], 'a file with no counts');
  assert.deepEqual(available({ reaction: { events: { a: { hb: { sum: 3 } } } }, reads: { n: MIN_READS } }), ['popular', 'mine', 'all']);
  assert.equal(orderOf(es, 'popular', { sidesOf: sides }), null);
  assert.equal(orderOf(es, 'mine', { sidesOf: sides, reads: { n: MIN_READS - 1 } }), null);
  assert.equal(orderOf(es, 'nonsense', { sidesOf: sides }), null);
  assert.deepEqual(Object.values(ORDER_JA), ['人気順', '自分の読み方順', 'PARALLAX']);
});

test('全体: more sides first, then more kinds of outlet; 人気順: the bookmarks counted by the build', () => {
  assert.deepEqual(orderOf(es, 'all', { sidesOf: sides }).map((x) => x.obj.sid), ['a', 'd', 'c', 'b']);
  const reaction = { events: { b: { hb: { sum: 90 } }, d: { hb: { sum: 5 } } }, items: { c1: { hb: 40 }, c2: { hb: 2 } } };
  assert.equal(hbOf(C, reaction), 42, 'the items when the event has no sum');
  assert.deepEqual(orderOf(es, 'popular', { sidesOf: sides, reaction }).map((x) => x.obj.sid), ['b', 'c', 'd'], 'no bookmark: not in the list');
});

test('自分の読み方順: closest to the fields and sides this device opened', () => {
  let reads = [];
  for (let i = 0; i < MIN_READS; i++) reads = noteRead(reads, { k: 'k' + i, f: '経済', jp: 3, intl: 0, gov: 0 }, i);
  const mine = orderOf(es, 'mine', { sidesOf: sides, reads: readMix(reads) });
  assert.equal(mine[0].obj.sid, 'c');
  assert.equal(mine.at(-1).obj.sid, 'b');
});

test('what changes in the first ten: counted on the events, the life label only with its file', () => {
  const impact = { events: { c: { areas: ['price'] } } };
  const all = countsOf(orderOf(es, 'all', { sidesOf: sides }), { sidesOf: sides, impact, top: 2 });
  const pop = countsOf([B, C], { sidesOf: sides, impact, top: 2 });
  assert.deepEqual(all, { intl_only: 0, small_only: 0, life: 0 });
  assert.deepEqual(pop, { intl_only: 1, small_only: 1, life: 1 });
  assert.deepEqual(diffOf(pop, all), [
    { k: 'intl_only', ja: '海外だけのニュース', from: 1, to: 0 },
    { k: 'small_only', ja: '地方紙・小さな媒体だけのニュース', from: 1, to: 0 },
    { k: 'life', ja: '暮らしのラベル', from: 1, to: 0 }]);
  assert.equal(countsOf(es, { sidesOf: sides }).life, null, 'no impact.json: not counted and not shown');
  assert.deepEqual(diffOf(countsOf([B], { sidesOf: sides }), countsOf([A], { sidesOf: sides })).map((d) => d.k), ['intl_only']);
});
