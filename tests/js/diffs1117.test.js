import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { briefOf } from '../../js/summary.js';
import { createHero } from '../../js/hero.js';

const brief = (extra = {}) => ({ what_ja: '貨物船が港で座礁した。', background_ja: '', views_ja: '', next_ja: '', made_at: 1794370000, provider: 'gemini', model: 'm', ...extra });

test('briefOf carries the differences of content with the ids of the items they were read from, three at most', () => {
  const b = briefOf({ brief: brief({ diffs: [{ text_ja: 'a', refs: ['x'] }, { text_ja: '', refs: ['x'] }, { text_ja: 'b', refs: [] }, { text_ja: 'c', refs: ['y', 'z'] }, { text_ja: 'd', refs: ['x'] }, { text_ja: 'e', refs: ['x'] }] }) });
  assert.deepEqual(b.diffs, [{ text: 'a', ids: ['x'] }, { text: 'c', ids: ['y', 'z'] }, { text: 'd', ids: ['x'] }]);
  assert.deepEqual(briefOf({ brief: brief() }).diffs, []);
});

test('the home card shows the first difference as one more row of the brief, with its outlets after it', () => {
  const made = [];
  const h = (tag, attrs, ...kids) => { const el = { tag, attrs: attrs || {}, kids: kids.flat(4).filter((k) => k != null && k !== false) }; made.push(el); return el; };
  const root = { hidden: true, replaceChildren() {} };
  const p = { sid: 's1', tier: 'both', sides: { jp: { outlets: 1 }, intl: { outlets: 1 }, gov: { outlets: 0 } }, heads: [], findings: [], title: 't' };
  const rows = [{ key: 'what_ja', label: '何が起きたか', text: 'w' }, { key: 'background_ja', label: '経緯', text: 'b' }, { key: 'views_ja', label: '伝え方', text: 'v' }, { key: 'diff', label: '各社の中身', text: '港は午前中閉鎖された。', by: ['甲', '乙'] }];
  const hero = createHero({ h, root, fmt: { short: () => '', clock: () => '' }, on: { brief: () => ({ rows, at: 1 }), photo: () => null } });
  hero.render([p]);
  const text = (el) => (el && typeof el === 'object' ? (el.attrs && el.attrs.text != null ? String(el.attrs.text) : '') + (el.kids || []).map(text).join('') : String(el));
  const dds = made.filter((e) => e.tag === 'dd').map(text);
  assert.equal(dds.length, 4);
  assert.equal(dds[3], '港は午前中閉鎖された。甲・乙');
  assert.ok(made.some((e) => e.tag === 'dt' && e.attrs.text === '各社の中身'));
});

test('the page resolves each difference to the items it came from and the css names the list', () => {
  const app = readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  assert.match(app, /e\.members\.find\(\(m\) => m\.id === id\)/);
  assert.match(app, /diffList\(b\)/);
  assert.match(readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8'), /\.ch-diff \.df-by/);
});
