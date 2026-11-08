// the event the home leads with: a field of the news first, the bin of "other" only when nothing else is left; the lead rotates through the same pool
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickFirst, leadPool, hardNews, entryEvents } from '../../js/entry.js';

const m = (type, home) => ({ type, home, title: 't' });
const ev = (key, field, ...ms) => ({ key, field, cover: 'both', n: ms.length, members: ms });
const three = () => [m('公共放送', 'jp'), m('通信社', 'intl'), m('政府一次', 'jp')];

test('hardNews: a field of the news counts, the bin of other and a missing field do not', () => {
  assert.equal(hardNews({ field: '政治' }), true);
  assert.equal(hardNews({ field: '国際' }), true);
  assert.equal(hardNews({ field: 'その他' }), false);
  assert.equal(hardNews({ field: '' }), false);
  assert.equal(hardNews({}), false);
  assert.equal(hardNews(null), false);
});

test('pickFirst: a news with a field leads even when an "other" one is reported by more sides', () => {
  const other3 = ev('o', 'その他', ...three());                                          // all three sides, but in the bin
  const intl2 = ev('i', '国際', m('公共放送', 'jp'), m('通信社', 'intl'));              // two sides, two reports, in a field
  assert.equal(pickFirst([other3, intl2]).key, 'i');
  const pol1 = ev('p', '政治', m('公共放送', 'jp'));                                      // one side only, still a field
  assert.equal(pickFirst([other3, pol1]).key, 'p');
});

test('pickFirst: among the fields the old order holds (three sides, else two with three reports, else two, else the first)', () => {
  const a = ev('a', '経済', m('公共放送', 'jp'));
  const b = ev('b', '政治', m('公共放送', 'jp'), m('通信社', 'intl'));
  const c = ev('c', '国際', ...three());
  assert.equal(pickFirst([a, b, c]).key, 'c');
  assert.equal(pickFirst([a, b]).key, 'b');
  assert.equal(pickFirst([a]).key, 'a');
});

test('pickFirst: the bin of "other" leads only when there is no field at all', () => {
  const o1 = ev('o1', 'その他', m('公共放送', 'jp'));
  const o2 = ev('o2', 'その他', ...three());
  assert.equal(pickFirst([o1, o2]).key, 'o2');
  assert.equal(pickFirst([o1]).key, 'o1');
  assert.equal(pickFirst([]), null);
  assert.equal(pickFirst(null), null);
});

test('leadPool: the fields of the news when there are any, else everything; it never invents or reorders', () => {
  const o = ev('o', 'その他', m('公共放送', 'jp'));
  const p = ev('p', '政治', m('公共放送', 'jp'));
  const q = ev('q', '安全保障', m('公共放送', 'jp'));
  assert.deepEqual(leadPool([o, p, o, q]).map((e) => e.key), ['p', 'q']);
  assert.deepEqual(leadPool([o, o]).map((e) => e.key), ['o', 'o']);
  assert.deepEqual(leadPool([]), []);
  assert.deepEqual(leadPool(undefined), []);
});

test('entryEvents: the simple view leads with a field of the news too', () => {
  const other3 = ev('o', 'その他', ...three());
  const intl = ev('i', '国際', m('公共放送', 'jp'), m('通信社', 'intl'), m('全国紙', 'jp'));
  const cards = entryEvents([other3, intl], 6);
  assert.equal(cards[0].key, 'i');
});
