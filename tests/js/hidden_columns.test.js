// The detailed screen must not carry a hidden window of charts below the fold (the report of 11-22: "something moves up and down behind the panel when scrolling").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const css = readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');

test('the home-only column (.c1: sources, hours, fields) is not drawn on the detailed screen, so the board has nothing to scroll to', () => {
  const rules = css.split('}').filter((r) => /\[data-screen="board"\]\[data-home="board"\]/.test(r) && /> \.c1\s*\{/.test(r + '}'));
  assert.ok(rules.length >= 1, 'a rule hides .c1 on the detailed screen');
  assert.match(rules[rules.length - 1], /display:\s*none\s*!important/);
  assert.match(rules[rules.length - 1], /:not\(\[data-wall="1"\]\)/);          // the same scope as the layout rule it overrides
  const at = css.lastIndexOf('@media', css.indexOf('[data-home="board"]:not(#z1)'));
  assert.match(css.slice(at, at + 40), /min-width:\s*1101px/);                  // only where the layout rule that gives .c1 its second row lives
});

test('the board does not scroll by itself on the wide detailed screen (the left-over row gap and padding made 24px of it)', () => {
  const rule = css.split('}').filter((r) => /\[data-home="board"\]:not\(#z1\)/.test(r) && !/> \.c1/.test(r) && /overflow-y/.test(r));
  assert.equal(rule.length, 1);
  assert.match(rule[0], /overflow-y:\s*hidden\s*!important/);
});

test('the layout rule that places .c1 in a second grid row is still the only place that gives it a row, and the hiding rule is later in the file', () => {
  const place = css.indexOf('> .c1 { display: grid; grid-template-columns: repeat(3');
  const hide = css.indexOf('[data-home="board"]:not(#z1)');
  assert.ok(place > 0 && hide > place);
});
