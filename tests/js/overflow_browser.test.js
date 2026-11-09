// A page must keep to its width on a phone and a tablet (the sideways drift of the iPad, 2026-11-09). This one opens a real Chrome, so it runs only when both
// an assembled site and a Chrome are at hand:
//   python tools/assemble_site.py --out _site && PLX_SITE_DIR=_site node --test tests/js/overflow_browser.test.js
// (CHROME_PATH names Chrome when it is not where tools/overflow_check.mjs looks.) Otherwise it is skipped, and tests/js/overflow_css.test.js holds the rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { check, findChrome } from '../../tools/overflow_check.mjs';

const site = process.env.PLX_SITE_DIR || '';
const chrome = findChrome();

test('every main page keeps to its width, and nothing drifts under a finger (iPad upright and sideways, iPhone sideways)', { skip: !site || !fs.existsSync(site) || !chrome ? 'needs PLX_SITE_DIR (an assembled site) and Chrome' : false, timeout: 600000 }, async () => {
  if (!fs.existsSync(`${site}/blank.html`)) fs.writeFileSync(`${site}/blank.html`, '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>blank</title>');
  const { rows, failed } = await check({ site, chrome, pages: ['home', 'compare', 'news', 'map', 'saved'], sizes: ['820x1180', '1180x820', '844x390p'] });
  assert.equal(rows.length, 15);
  assert.deepEqual(failed.map((r) => `${r.size} ${r.page} sw=${r.sw}/${r.cw} boxes=${r.boxes.join(',')} moved=${r.moved.join(',')}`), []);
});
