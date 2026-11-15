// v58: what the last look found, held by text checks of the code (the pixels are in screens_v58).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const css = read('css/app.css'), app = read('js/app.js'), pol = read('js/politics_ui.js');

test('the home panel: the table starts under the title and the spare height goes between the rows (no centring)', () => {
  assert.match(css, /\.gap \.fr-gap \{ grid-template-rows: max-content; grid-auto-rows: minmax\(68px, 1fr\); align-content: start; \}/);
  assert.doesNotMatch(css, /\.gap \.fr-gap \{ grid-auto-rows: minmax\(68px, auto\); align-content: center; \}/);
});
test('a pane that scrolls itself fades its top edge once it has moved', () => {
  assert.match(css, /@property --pb-top/);
  assert.match(css, /animation-timeline: scroll\(self\)/);
});
test('the cabinet approval chart keeps room for the label 100 on its left', () => {
  assert.match(pol, /const L = big \? 24 : 30,/);
});
test('a sheet gives the focus back to what opened it, and a redraw does not drop it', () => {
  assert.match(app, /state\.sheetOpener = a && a !== document\.body/);
  assert.match(app, /if \(opener && opener\.isConnected && !opener\.hidden\) opener\.focus/);
  assert.match(app, /if \(hadFocus \|\| focusedClose\)/);
});
test('the same word is not told twice in a news head (a topic named like the field)', () => {
  assert.match(app, /e\.field && !e\.topics\.some\(\(id\) => flagJa\(id\) === e\.field\)/);
});
