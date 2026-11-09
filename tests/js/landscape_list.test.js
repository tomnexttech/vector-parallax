import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT } from './helpers.js';
import path from 'node:path';

const css = readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
const sideways = '@media (orientation: landscape) and (max-height: 500px) and (max-width: 1100px) {';
const tail = css.slice(css.lastIndexOf('/* ---- v48'));

test('the ranking columns are a div; the topics under a headline (a span, also .rk) are not a grid of 340px columns', () => {
  assert.match(css, /\ndiv\.rk \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(340px, 1fr\)\)/);
  assert.doesNotMatch(css, /\n\.rk \{ display: grid/);
});

test('a phone held sideways: the home list has a picture rule (64x48 beside the headline), so a row is not a full-width photo', () => {
  assert.ok(tail.includes(sideways), 'the v48 block is the sideways phone');
  assert.match(tail, /#pri-b \.rows \.r > \.rth \{[^}]*width: 64px; aspect-ratio: 4 \/ 3/);
  assert.match(tail, /#pri-b \.rows \.r \{ display: grid; grid-template-columns: 64px minmax\(0, 1fr\)/);
  assert.match(tail, /#p-pri \{ display: grid; grid-column: 1 \/ -1 !important; grid-row: 6 !important/);
});

test('a phone held sideways: the title row of the home and the three rows of buttons of the news screen are 44px, the line under a headline is 13px', () => {
  assert.match(tail, /grid-template-rows: 44px minmax\(0, 1fr\)/);
  assert.match(tail, /\.sc-tabs \{[^}]*min-height: 44px/);
  assert.match(tail, /\.nw-l > \.genres \{ height: 44px/);
  assert.match(tail, /\.nw-l > \.chips \{[^}]*min-height: 44px/);
  assert.match(tail, /\.rm \{[^}]*font-size: 13px/);
  assert.match(tail, /\.chip \{[^}]*font-size: 13px/);
});

test('the map opened to the whole screen is above every pane (the panes are position: relative; z-index: 1 and come later in the page, and covered it on an iPad held upright)', () => {
  assert.match(css, /:root\[data-mapfull\] #p-map \{ position: fixed !important; inset: 0; z-index: 80 !important;/);
});
