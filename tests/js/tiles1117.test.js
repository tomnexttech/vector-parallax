// 11-17 (the phone's 詳しく見る): 掲載の停止 stands at the very foot of the news, not among the buttons; the headline is not a tile inside the tile;
// the tiles take one ground (the --ui-* tokens), dark and light.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const app = read('js/app.js');
const css = read('css/app.css');
const v70 = css.slice(css.indexOf('/* ==== v70:begin'), css.indexOf('/* ==== v70:end ==== */'));

test('掲載の停止 is the last part of the news, outside the row of buttons', () => {
  const tools = app.slice(app.indexOf("const tools = h('div', { class: 'ch-tools' }"), app.indexOf("const head = h('div', { class: 'ch-main' }"));
  assert.ok(tools.length > 100);
  assert.doesNotMatch(tools, /stopreq|掲載の停止/);
  const node = app.slice(app.indexOf("const node = h('div', { class: 'case-in' }"));
  assert.match(node, /h\('div', \{ class: 'cbody nophoto' \}, members, side\),[\s\S]*h\('p', \{ class: 'ch-stop' \}, extLink\([^)]*掲載の停止の依頼[\s\S]*'掲載の停止'\)\)\);/);
});

test('the headline stands on the tile that holds the news (no tile of its own), on a wide screen and on a phone', () => {
  assert.match(v70, /#p-case \.dcard\.t-place \{ background: none; box-shadow: none; border-radius: 0;/);
  assert.match(v70, /@media \(max-width: 1100px\) \{[\s\S]*#p-case :is\(\.dcard, \.sd, \.nt, \.t-ai, \.t-reps, \.t-status\):not\(\.cov\) \{ background: none; box-shadow: none;/);
});

test('three roles of ground are tokens in both themes, and the v70 block writes no colour of its own into a background', () => {
  for (const t of ['--ui-face', '--ui-face-edge', '--ui-press', '--ui-press-hover', '--ui-on', '--ui-chrome']) assert.ok(css.includes(`${t}:`), t);
  assert.ok(/:root(?::not\(#u[0-9a-c]\))+\[data-theme="light"\] \{ --ui-face: /.test(v70), 'the light values win over the earlier light passes');
  const bad = [...v70.matchAll(/background(?:-color)?:\s*(rgba?\([^;}]*)/g)].map((m) => m[1]).filter((x) => !/^rgba\(255, 255, 255, \.(72|85|96)\)|^rgba\(36, 48, 100, \.07\)/.test(x));
  assert.deepEqual(bad, []);
});
