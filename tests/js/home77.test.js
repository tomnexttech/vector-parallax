// the home in three columns (v77): the list, the news in focus, the fields; what each outlet writes comes from story.read, and says so when the body was not read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOf } from '../../js/summary.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

test('readOf: the shape of docs/read-shape.md: read outlets with focus, facts, wording and omits; the unread with the reason; nothing unless two were read', () => {
  const o = (name, side) => ({ outlet: name, side, focus: ' 補助の延長 ', facts: ['補助は3月まで。'], wording: [{ quote: 'ease the burden', note: '負担の軽減を前に出す' }], omits: [{ text: '本文にはガソリンの記述がない。', from: 'x' }] });
  const r = readOf({ read: { status: 'ok', at: 5, outlets: [o('A', '国内'), o('B', '海外'), { outlet: '', focus: 'x' }], contrast: ' 食い違い ', domestic_vs_abroad: '差',
    unread: [{ outlet: 'NHK', side: '国内', why_ja: '利用条件が認めていない' }] } });
  assert.equal(r.outlets.length, 2);
  assert.deepEqual(r.outlets[0], { outlet: 'A', side: 'jp', body: true, focus: '補助の延長', facts: ['補助は3月まで。'], words: [{ quote: 'ease the burden', note: '負担の軽減を前に出す' }], absent: ['本文にはガソリンの記述がない。'], head: '' });
  assert.equal(r.outlets[1].side, 'intl');
  assert.deepEqual(r.unread, [{ outlet: 'NHK', side: 'jp', why: '利用条件が認めていない' }]);
  assert.equal(r.clash, '食い違い');
  assert.equal(r.dva, '差');
  assert.equal(readOf({}), null);
  assert.equal(readOf({ read: { status: 'unread', outlets: [o('A', '国内'), o('B', '海外')] } }), null);
  assert.equal(readOf({ read: { status: 'ok', outlets: [o('A', '国内')] } }), null);
});

test('the home has a list column, three columns on a wide window, and the read block steps down with the fit', () => {
  assert.match(read('index.html'), /id="hlist"/);
  const css = read('css/app.css');
  assert.match(css, /grid-template-columns: 300px minmax\(0, 1fr\) 320px;[^}]*"tabs tabs tabs" "chips hero gap" "list hero gap"/);
  assert.match(css, /\.hr-card:is\(\[data-fit="1"\][^{]*\) \.hr-rw \{ display: none; \}/);
  const js = read('js/app.js');
  assert.match(js, /function paintHomeList/);
  assert.match(js, /read: hxRead2/);
});
