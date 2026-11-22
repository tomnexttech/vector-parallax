import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unreadWhy } from '../../js/summary.js';
import { measure, wordMatrix, setMatrixGroups } from '../../js/dossier.js';
import { STEPS } from '../../js/tour.js';

const T = 1_790_000_000;
const it = (id, title, home, type, ts, outlet, lang = 'ja') => ({ id, title, home, type, ts, outlet, lang });

test('unreadWhy keeps the reason of an unread outlet even when fewer than two bodies were read', () => {
  const w = unreadWhy({ read: { status: 'ok', outlets: [], unread: [{ outlet: 'NHK', why_ja: ' 利用条件が取得を認めていない ' }, { outlet: 'X' }] } });
  assert.deepEqual(w, { NHK: '利用条件が取得を認めていない' });
  assert.deepEqual(unreadWhy({}), {});
});

test('the table of words by outlet puts one thing named in two languages in one column', () => {
  setMatrixGroups([['ポーランド', 'Poland']]);
  const x = wordMatrix(measure({ members: [it('a', 'ポーランドへの攻撃', 'jp', '全国紙', T, 'A'), it('b', 'Poland attacked', 'intl', '通信社', T, 'B', 'en'), it('c', 'ポーランド政府', 'jp', '民放', T, 'C')] }));
  setMatrixGroups([]);
  if (x) assert.equal(x.words.filter((w) => /^(ポーランド|Poland)$/.test(w)).length, 1);
});

test('the words of the page: 偏り度 everywhere, the tour says 四つの枠', () => {
  for (const f of ['app.js', 'dossier.js', 'entry.js', 'wall.js', 'traits.js', 'hero.js', 'front.js']) assert.doesNotMatch(readFileSync(new URL(`../../js/${f}`, import.meta.url), 'utf8'), /バイアス度/, f);
  assert.equal(STEPS[0].title, '四つの枠');
});
