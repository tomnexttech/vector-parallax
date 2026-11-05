// node --test tests/js/tidy.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { tightJa, gapsJa, tidyGovTitles } from '../../js/tidy.js';
import { pickFirst, entryEvents } from '../../js/entry.js';

test('spaces between Japanese characters go; next to Latin letters and figures they stay', () => {
  assert.equal(tightJa('自衛隊法施行規則の一 部を改正する省令案及 び若年定年制'), '自衛隊法施行規則の一部を改正する省令案及び若年定年制');
  assert.equal(tightJa('援 助 に　ついて'), '援助について');
  assert.equal(tightJa('ガバメントAI 源内 の AI アプリ'), 'ガバメントAI 源内の AI アプリ');
  assert.equal(tightJa('第 1822 号'), '第 1822 号');
  assert.equal(tightJa('Prime Minister Takaichi'), 'Prime Minister Takaichi');
  assert.equal(gapsJa('一 部を改正 する及 び'), 3);
  assert.equal(tightJa(null), null);
});

test('only the ministries’ titles with three gaps or more are closed, in place', () => {
  const d = { items: {
    a: { type: '政府一次', title: '施行規則の一 部を改正する省令案及 び若年定年制自衛官等 であった者' },
    b: { type: '政府一次', title: '上野厚生労働大臣 閣議後記者会見のお知らせ' },
    c: { type: '公共放送', title: '三重 四日市 住宅と車１台全焼 玄関付近で' },
  } };
  assert.equal(tidyGovTitles(d), 1);
  assert.equal(d.items.a.title, '施行規則の一部を改正する省令案及び若年定年制自衛官等であった者');
  assert.equal(d.items.b.title, '上野厚生労働大臣 閣議後記者会見のお知らせ');
  assert.equal(d.items.c.title, '三重 四日市 住宅と車１台全焼 玄関付近で');
  assert.equal(tidyGovTitles(null), 0);
});

const m = (type, home) => ({ type, home, title: 't' });
const ev = (key, ...ms) => ({ key, cover: 'both', n: ms.length, members: ms });
test('the first event: all three sides, else two, else the first; the simple view keeps it among its cards', () => {
  const jpGov = ev('a', m('公共放送', 'jp'), m('政府一次', 'jp'), m('全国紙', 'jp'));
  const jpIntl = ev('b', m('公共放送', 'jp'), m('通信社', 'intl'));
  const all3 = ev('c', m('公共放送', 'jp'), m('通信社', 'intl'), m('政府一次', 'jp'));
  assert.equal(pickFirst([jpGov, jpIntl, all3]).key, 'c');
  assert.equal(pickFirst([ev('x', m('公共放送', 'jp'), m('全国紙', 'jp'), m('地方紙', 'jp')), jpIntl]).key, 'b');
  assert.equal(pickFirst([]), null);
  const many = [jpGov, jpIntl, jpGov, jpIntl, jpGov, jpIntl, jpGov, all3].map((e, i) => ({ ...e, key: `${e.key}${i}` }));
  const cards = entryEvents(many, 6);
  assert.equal(cards.length, 6);
  assert.equal(pickFirst(cards).key, 'c7');
});
