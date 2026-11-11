import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

const M = JSON.parse(readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
const HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const png = (f) => { const b = readFileSync(path.join(ROOT, f)); assert.equal(b.toString('hex', 0, 8), '89504e470d0a1a0a', f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

test('the manifest: an id, the page itself as start and scope, full screen', () => {
  assert.equal(M.id, './');
  assert.equal(M.start_url, './');
  assert.equal(M.scope, './');
  assert.equal(M.display, 'standalone');
  assert.deepEqual(M.display_override, ['standalone']);
  assert.ok(M.name && M.short_name && M.short_name.length <= 12);
  assert.match(M.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(M.background_color, /^#[0-9a-f]{6}$/i);
});

test('the icons: files that exist at the size they say; the maskable one is its own file', () => {
  for (const ic of M.icons) {
    const [w, h] = ic.sizes.split('x').map(Number);
    assert.deepEqual(png(ic.src), { w, h }, ic.src);
  }
  const mask = M.icons.filter((i) => String(i.purpose).includes('maskable'));
  const any = M.icons.filter((i) => !String(i.purpose || 'any').includes('maskable'));
  assert.equal(mask.length, 1);
  assert.ok(any.some((i) => i.sizes === '512x512') && any.some((i) => i.sizes === '192x192'));
  assert.ok(!any.some((i) => i.src === mask[0].src), 'the maskable icon is not the plain one reused');
  assert.notDeepEqual(readFileSync(path.join(ROOT, mask[0].src)), readFileSync(path.join(ROOT, 'assets/icons/icon-512.png')));
});

test('the shortcuts: each goes to the page, and the page handles where it points', () => {
  assert.ok(Array.isArray(M.shortcuts) && M.shortcuts.length >= 2);
  for (const s of M.shortcuts) {
    assert.ok(s.name);
    const u = new URL(s.url, 'https://site.test/app/');
    assert.equal(u.origin + u.pathname, 'https://site.test/app/', s.url);
    const k = u.hash.replace('#', '');
    assert.ok(k && new RegExp(`k === '${k}'`).test(APP), `the page opens #${k}`);
    for (const ic of s.icons || []) assert.ok(existsSync(path.join(ROOT, ic.src)), ic.src);
  }
  for (const sc of M.screenshots || []) assert.ok(existsSync(path.join(ROOT, sc.src)), sc.src);
});

test('iPhone: the page asks for full screen and has its touch icon', () => {
  assert.match(HTML, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(HTML, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(HTML, /<meta name="apple-mobile-web-app-title" content="[^"]+">/);
  const t = HTML.match(/<link rel="apple-touch-icon" href="([^"]+)">/);
  assert.ok(t);
  assert.deepEqual(png(t[1]), { w: 180, h: 180 });
  assert.match(HTML, /viewport-fit=cover/);
  assert.match(APP, /navigator\.serviceWorker\.register\('sw\.js'\)/);
});
