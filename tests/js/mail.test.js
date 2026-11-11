import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';
import { KEY, MAX, cleanAddr, loadAddr, saveAddr, clearAddr, bodyOf, subjectOf, mailtoOf, itemsOf } from '../../js/mail.js';

const ADDR = 'visitor@example.com';
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), dump: () => [...m] }; };
const item = (i, extra = {}) => ({ title: `見出し ${i} `.repeat(6), jp: 4, intl: 3, finding: '人数は国内 3 社が載せ、海外 2 社の見出しと要旨には出ていない', life: '税・社会保険', url: `https://site.test/s/s${String(i).padStart(12, '0')}.html`, ...extra });

test('the address: one plain shape, kept under one key only, and deleted', () => {
  const s = mem();
  assert.equal(cleanAddr(' visitor@example.com '), ADDR);
  for (const bad of ['', 'no-at', 'a@b', 'a b@c.d', 'a@b.c?cc=x', 'x'.repeat(300) + '@a.b', null]) assert.equal(cleanAddr(bad), '', String(bad));
  assert.equal(saveAddr(s, 'not an address'), false);
  assert.deepEqual(s.dump(), []);
  assert.equal(saveAddr(s, ADDR), true);
  assert.deepEqual(s.dump().map(([k]) => k), [KEY]);
  assert.equal(loadAddr(s), ADDR);
  clearAddr(s);
  assert.equal(loadAddr(s), '');
  assert.deepEqual(s.dump(), []);
  assert.equal(loadAddr({ getItem: () => '{bad json' }), '');
});

test('the body stops at 1800 characters, at a whole item, with one link to the rest', () => {
  const items = Array.from({ length: 40 }, (_, i) => item(i));
  const b = bodyOf({ when: '11/11', built: '11/11 15:13', items, more: 'https://site.test/' });
  assert.ok(b.length <= MAX, `length ${b.length}`);
  assert.equal(MAX, 1800);
  assert.match(b, /続きは頁で：https:\/\/site\.test\/$/);
  assert.match(b, /^11\/11 のニュース（11\/11 15:13 の構築）/);
  const n = (b.match(/^\d+\. /gm) || []).length;
  assert.ok(n >= 1 && n < 40);
  assert.ok(b.includes(`${n}. `) && !b.includes(`${n + 1}. `), 'cut at a whole item');
  const few = bodyOf({ when: '11/11', built: 'x', items: [item(1)] });
  assert.match(few, /国内 4社・海外 3社/);
  assert.match(few, /暮らし：税・社会保険/);
});

test('mailto: the draft in the visitor\'s own mail app; nothing else is opened', () => {
  const u = mailtoOf(ADDR, subjectOf('11/11'), 'a&b=c\n2');
  assert.match(u, /^mailto:visitor@example\.com\?subject=/);
  assert.ok(u.includes('body=a%26b%3Dc%0A2'));
  assert.match(mailtoOf('', 's', 'b'), /^mailto:\?subject=s&body=b$/);
  assert.match(mailtoOf('x@y.z?bcc=evil@e.f', 's', 'b'), /^mailto:\?/);
});

test('the items: the board\'s order, the counts of each side, the first finding, the life label, the page', () => {
  const es = [{ key: 'a', case: { sid: 'sa' }, heading: { text: 'A' } }, { key: 'b', case: { sid: 'sb' }, heading: { text: 'B' } }, { key: 'c', case: { sid: 'sc' }, heading: { text: 'C' } }];
  const board = { priority: ['sb', 'zz', 'sa'], cases: { sb: { coverage: { findings: [{ kind: 'only_side', text: '型の文' }] } } } };
  const impact = { events: { sa: { areas: ['tax', 'care'] } } };
  const xs = itemsOf(es, { board, impact, sidOf: (e) => e.case.sid, sides: () => ({ jp: 2, intl: 1 }), pageOf: (s) => `https://site.test/s/${s}.html`, areaJa: { tax: '税・社会保険' } });
  assert.deepEqual(xs.map((x) => x.title), ['B', 'A']);
  assert.equal(xs[0].finding, '型の文');
  assert.equal(xs[1].life, '税・社会保険・care');
  assert.equal(xs[1].url, 'https://site.test/s/sa.html');
});

test('the address never leaves the device: no network, no address bar, no other key, no file of the site', () => {
  const mail = readFileSync(path.join(ROOT, 'js', 'mail.js'), 'utf8');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|location\s*[.=]|history\./.test(mail), 'mail.js has no way out but the mailto link');
  // the wiring in app.js: the address is read from the field and the one key only, and goes nowhere but the mailto href
  const app = readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const region = app.slice(app.indexOf('// ==== app:begin ===='), app.indexOf('// ==== app:end ===='));
  assert.ok(region.length > 100);
  const mailPart = region.slice(region.indexOf('// ---- the mail draft'), region.indexOf('// ---- the app on the home screen'));
  assert.ok(mailPart.length > 100);
  assert.ok(!/fetch\(|sendBeacon|XMLHttpRequest|replaceState|location\.hash|setItem\(|saveSettings|saveOwnAI/.test(mailPart), 'the mail wiring writes no other place');
  // nothing in the files that are published names a mail address of a visitor
  for (const f of ['manifest.webmanifest', 'index.html', 'sw.js']) assert.ok(!/@[a-z0-9-]+\.[a-z]/i.test(readFileSync(path.join(ROOT, f), 'utf8').replace(/@media|@font-face|@import/g, '')), f);
});

test('the key is the only key mail.js writes', () => {
  const src = readFileSync(path.join(ROOT, 'js', 'mail.js'), 'utf8');
  const keys = [...src.matchAll(/(?:setItem|getItem|removeItem)\(\s*([A-Za-z_'".]+)/g)].map((m) => m[1]);
  assert.ok(keys.length >= 3);
  assert.ok(keys.every((k) => k === 'KEY'), keys.join(','));
  assert.equal(KEY, 'parallax.mail.v1');
});
