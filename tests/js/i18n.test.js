import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { uiLang, tr, EN, UI_LANGS } from '../../js/i18n.js';
import { defaults, cleanSettings } from '../../js/settings.js';

test('Japanese unless the visitor chose; auto follows the browser', () => {
  assert.equal(uiLang('auto', ['ja-JP', 'en']), 'ja');
  assert.equal(uiLang('auto', ['ja']), 'ja');
  assert.equal(uiLang('auto', ['en-US', 'ja']), 'en');
  assert.equal(uiLang('auto', ['fr-FR']), 'en');
  assert.equal(uiLang('auto', []), 'ja');
  assert.equal(uiLang('ja', ['en-US']), 'ja');
  assert.equal(uiLang('en', ['ja-JP']), 'en');
  assert.deepEqual(UI_LANGS, ['auto', 'ja', 'en']);
  assert.equal(defaults().look.ui, 'ja');   // the English words do not yet cover every pane: Japanese by default
  assert.equal(cleanSettings({ look: { ui: 'en' } }).look.ui, 'en');
  assert.equal(cleanSettings({ look: { ui: 'de' } }).look.ui, 'ja');   // an unknown choice falls back to the default
});

test('the page words: exact, by pattern, else as they were', () => {
  assert.equal(tr('ホーム'), 'Home');
  assert.equal(tr('  設定 '), '  Settings ');
  assert.equal(tr('6社・6 件'), '6 outlets · 6 reports');
  assert.equal(tr('残り 3 件を見る'), 'Show the other 3');
  assert.equal(tr('→ あと 4 社'), '→ 4 more outlets');
  assert.equal(tr('→ あと 1 社'), '→ 1 more outlet');
  assert.equal(tr('+1.4時間'), '+1.4 h');
  assert.equal(tr('1時間27分'), '1 h 27 min');
  assert.equal(tr('国内 4・海外 2・官公庁 0'), 'Japan 4 · Abroad 2 · Ministries 0');
  assert.equal(tr('経済 の出来事だけ見る'), 'Only Economy');
  assert.equal(tr('最初に報じた 国内 NHK 10:00／海外 Reuters 11:00（差 60 分）'), 'First reported Japan NHK 10:00／Abroad Reuters 11:00 (60 min apart)');
  assert.equal(tr('「見出しはそのまま」'), '「見出しはそのまま」');
  assert.equal(tr('朝日新聞'), '朝日新聞');
  assert.equal(tr('Reuters'), 'Reuters');
  assert.equal(tr('-48時間'), '-48 h');
  assert.equal(tr('通信社・海外'), 'News agency · Abroad');
  assert.equal(tr('震度5弱'), 'Shindo 5-');
});

test('every English word of the table is English', () => {
  for (const [k, v] of Object.entries(EN)) assert.ok(!/[぀-ヿ一-鿿]/.test(v), `still Japanese: ${k}`);
});

test('the Japanese page is never touched: the page only watches the words in English', () => {
  const app = fs.readFileSync(new URL('../../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(l === 'en' && !wordsOff\)/);
});
