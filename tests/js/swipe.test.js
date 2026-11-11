import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { flowItems, clampStep, MAX_ITEMS, PER_SIDE } from '../../js/swipe.js';
import { sides, titleOf } from '../../js/entry.js';

const it = (id, home, title, type) => ({ id, outlet: id.toUpperCase(), home, type: type || (home === 'intl' ? '海外主流' : '全国紙'), ts: 100, title, link: 'https://example.org/' + id });
const ev = (k, members, extra = {}) => ({ key: k, members, titled: members, heading: { text: members[0].title, outlet: members[0].outlet }, ...extra });

test('one event to a screen; its sides in the order Japan, abroad, ministries; four headlines a side at most', () => {
  const many = Array.from({ length: 6 }, (_, i) => it('j' + i, 'jp', '国内 ' + i));
  const items = flowItems([ev('k1', [it('x', 'intl', 'Abroad'), it('g', 'jp', '発表', '政府一次'), ...many])], { sidesOf: sides, titleOf });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].sides.map((s) => [s.k, s.ja, s.n, s.heads.length]), [['jp', '国内', 6, PER_SIDE], ['intl', '海外', 1, 1], ['gov', '官公庁', 1, 1]]);
  assert.equal(items[0].title, 'Abroad');
  assert.equal(items[0].sides[1].heads[0].link, 'https://example.org/x');
});

test('hidden and folded events are not shown; the list stops at its cap', () => {
  const a = ev('a', [it('a', 'jp', 'a')]), b = ev('b', [it('b', 'jp', 'b')], { hid: 'outlet' }), c = ev('c', [it('c', 'jp', 'c')], { foldedInto: 'a' });
  assert.deepEqual(flowItems([a, b, c], { sidesOf: sides, titleOf }).map((x) => x.key), ['a']);
  const lots = Array.from({ length: MAX_ITEMS + 5 }, (_, i) => ev('e' + i, [it('e' + i, 'jp', 't')]));
  assert.equal(flowItems(lots, { sidesOf: sides }).length, MAX_ITEMS);
  assert.deepEqual(flowItems(null, { sidesOf: sides }), []);
});

test('the steps stay inside the list', () => {
  assert.equal(clampStep(0, -1, 5), 0);
  assert.equal(clampStep(4, 1, 5), 4);
  assert.equal(clampStep(2, 1, 5), 3);
  assert.equal(clampStep(0, 1, 0), 0);
});

test('every move has a key and a button; the layer is a dialog with a heading; the snap is set in the style', () => {
  const src = readFileSync(path.join(ROOT, 'js', 'swipe.js'), 'utf8');
  for (const k of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Escape']) assert.ok(src.includes(k), k);
  for (const b of ['前へ', '次へ', '比べる', '閉じる']) assert.ok(src.includes(`'${b}'`), b);
  assert.match(src, /'aria-label': `\$\{sd\.ja\}の見出しへ`/, 'a button for each side');
  assert.match(src, /h\('article', \{ class: 'fl-item', 'aria-labelledby'/);
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /id="hr-flow" role="dialog" aria-modal="true" aria-labelledby="fl-title"/);
  const css = readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
  assert.match(css, /\.fl-list \{[^}]*overflow-x: hidden;[^}]*scroll-snap-type: y mandatory/);
  assert.match(css, /\.fl-strip \{[^}]*overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory/);
});
