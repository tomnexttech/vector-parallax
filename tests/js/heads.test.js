// The headings are short nouns (docs/copy-canon.md, Sir 11-15: 「国内外比較　日本独占　海外独占　のようにわかりやすくてシンプル、
// 文章的な長ったらしさをそいだ見出しにしろ」). One table holds them (js/heads.js); this keeps the table to the rule and the old
// sentence-like headings out of the code, so the habit cannot come back by a new screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADS, HEAD, HEAD_EN, HEAD_MAX, RETIRED, headRule } from '../../js/heads.js';
import { tr } from '../../js/i18n.js';
import { FRONT_TABS } from '../../js/front.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every heading of the table is a short noun: 2 to 8 characters, no particle tying a sentence, not 〜の話', () => {
  for (const [k, [ja, en]] of Object.entries(HEADS)) {
    assert.equal(headRule(ja), '', `${k}「${ja}」: ${headRule(ja)}`);
    assert.ok(en && en.length <= 24, `${k} has a short English name`);
  }
  assert.equal(HEAD_MAX, 8);
  for (const bad of ['日本と海外の差', '片側だけの話', '偏りの大きい話', '分野ごとの記事の数', '最初に報じた時刻']) assert.notEqual(headRule(bad), '', `「${bad}」breaks the rule`);
  for (const ok of ['国内外比較', '日本独占', '海外独占', '偏り度', '初報', '分野別']) assert.equal(headRule(ok), '', `「${ok}」keeps it`);
});

test('the ways in of the home come from the table: 国内外比較・日本独占・海外独占・偏り度', () => {
  assert.deepEqual(FRONT_TABS.map(([, ja]) => ja), [HEAD['front.gap'], HEAD['front.jp'], HEAD['front.intl'], HEAD['front.bias']]);
  assert.deepEqual(FRONT_TABS.map(([, ja]) => ja), ['国内外比較', '日本独占', '海外独占', '偏り度']);
});

test('the English page names each heading from the same table', () => {
  for (const [ja, en] of Object.entries(HEAD_EN)) assert.equal(tr(ja), en, ja);
});

test('no retired sentence-like heading is written in the code or the page again', () => {
  const files = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js') && f !== 'heads.js').map((f) => path.join('js', f)).concat(['index.html']);
  const hits = [];
  for (const f of files) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const r of RETIRED) if (new RegExp(`['">]${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"<]`).test(t)) hits.push(`${f}: ${r}`);
  }
  assert.deepEqual(hits, []);
});

test('the headings of the page itself (h2, h3 and the board\'s links in index.html) keep the rule', () => {
  const t = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const heads = [...t.matchAll(/<h[23][^>]*>([^<]+)</g), ...t.matchAll(/<a href="#p-[^"]+"[^>]*>([^<]+)</g)].map((m) => m[1].trim()).filter(Boolean);
  assert.ok(heads.length >= 20);
  assert.deepEqual(heads.filter((x) => headRule(x)), []);
});

// v56 critique: the headings written outside the table (a tile's title, a dt, a summary, an h2 to h4 in the code) broke the rule and
// no test saw them. Every such heading in js/*.js is read here, the same way a reader meets it on the page.
test('every heading written in the code (h1 to h4, dt, summary, a tile\'s title) keeps the rule', async () => {
  const { FIND_JA } = await import('../../js/coverage.js');
  const { ONE_SIDE } = await import('../../js/sections.js');
  const files = fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js'));
  const bad = [];
  let seen = 0;
  for (const f of files) {
    const t = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
    t.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/h\('(h[1-4]|dt|summary)'\s*,\s*(?:\{[^{}]*?text:\s*'([^'$]+)'[^{}]*\}|null\s*,\s*'([^'$]+)'|\{[^{}]*\}\s*,\s*'([^'$]+)')/g)) {
        const s = m[2] || m[3] || m[4]; seen++;
        if (headRule(s)) bad.push(`${f}:${i + 1} <${m[1]}> ${s}: ${headRule(s)}`);
      }
      for (const m of line.matchAll(/tile\('[^']+',\s*'([^']+)'/g)) { seen++; if (headRule(m[1])) bad.push(`${f}:${i + 1} tile ${m[1]}: ${headRule(m[1])}`); }
    });
  }
  for (const [k, ja] of Object.entries(FIND_JA)) if (headRule(ja)) bad.push(`FIND_JA.${k} ${ja}: ${headRule(ja)}`);
  for (const g of ONE_SIDE) if (headRule(g.ja)) bad.push(`ONE_SIDE ${g.ja}: ${headRule(g.ja)}`);
  assert.ok(seen >= 40, `read ${seen} headings`);
  assert.deepEqual(bad, []);
});
