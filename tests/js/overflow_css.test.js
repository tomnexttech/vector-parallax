import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT } from './helpers.js';
import path from 'node:path';

const css = readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
const site = readFileSync(path.join(ROOT, 'parallax', 'site.py'), 'utf8');
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
const last = (sel, prop) => { let v = null; for (const r of rules) if (r.sel.split(',').map((s) => s.trim()).includes(sel)) { for (const d of r.body.split(';')) { const k = d.indexOf(':'); if (k > 0 && d.slice(0, k).trim() === prop) v = d.slice(k + 1).trim(); } } return v; };

test('the page itself never scrolls sideways: html and body cut on x, and say so for a touch screen', () => {
  assert.match(last('html', 'overflow-x') || '', /clip/, 'html: overflow-x: clip (hidden before it, for a phone that does not know clip)');
  assert.match(css, /html \{[^}]*overflow-x: hidden; overflow-x: clip;/);
  assert.equal(last('html', 'overscroll-behavior-x'), 'none');
  assert.equal(last('body', 'overflow-x'), 'hidden');
  assert.match(last('html', '-webkit-text-size-adjust') || '', /100%/, 'a phone held sideways must not enlarge the text by itself');
});

test('a region that scrolls up and down does not scroll sideways', () => {
  for (const sel of ['.entry', '.app > .entry', '.sect', '.nw-l', '.nw-r', '#case', '#app #case', '.pb', '.cb', '.about', '.set-main', '.own-body', '.cmd-l']) {
    assert.equal(last(sel, 'overflow-x'), 'hidden', `${sel} must cut on x`);
  }
});

test('a table or strip that is meant to run on is its own box: what is placed inside it stays inside it', () => {
  assert.equal(last('.cv-sc', 'position'), 'relative');
  assert.equal(last('.cv-sc', 'overflow-x'), 'auto');
  assert.match(site, /\.cv-sc\{position:relative;overflow-x:auto/, 'the page of an event keeps the same rule');
  assert.equal(last('.en-cards', 'position'), 'relative');
  assert.equal(last('.cv-sc', 'touch-action'), 'pan-x pan-y');
});

test('a list of rows cuts a row that is wider than its pane inside the list', () => {
  assert.equal(last('.rows', 'overflow-x'), 'clip');
});

test('a field is 16px on a touch screen, so iOS does not zoom the page when it is focused', () => {
  assert.match(css, /@media \(pointer: coarse\) \{ input, select, textarea \{ font-size: 16px; \} \}/);
});

test('the map under a finger: live where it is the screen, a preview where it lies in a page; its buttons are 44 px', () => {
  assert.match(css, /\.mgl\[data-touch="live"\][^{]*\{[^}]*touch-action: none/);
  assert.match(css, /\.mgl\[data-touch="still"\][^{]*\{[^}]*touch-action: auto/);
  assert.match(css, /@media \(pointer: coarse\) \{[^}]*#theater \.m3ctl \{ width: 44px; height: 44px;/);
  assert.match(css, /:root\[data-mapfull\] #p-map \{ position: fixed/);
  assert.match(css, /:root\[data-mapfull\] \.mclose \{[^}]*min-width: 44px; height: 44px;/);
});
