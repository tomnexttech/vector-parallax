// js/validate.js の試験。Python と共有する tests/fixtures/validate_cases.json の全例を通す。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, clean, fold, copies, vetoFlags, MAINSTREAM_TYPES, PRIMARY_TYPE } from '../../js/validate.js';
import { CASES, PROMPT } from './helpers.js';

test('shared cases: every case gives exactly the expected result', () => {
  assert.ok(CASES.length >= 38, 'the shared table has at least 38 cases');
  const names = CASES.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, 'case names are unique');
  for (const c of CASES) {
    const got = validate(c.request, c.raw, PROMPT, c.items);
    assert.deepStrictEqual(got, c.expect, `case ${c.name}`);
  }
});

test('the required failure modes are in the shared table', () => {
  const names = new Set(CASES.map((c) => c.name));
  for (const need of ['fabricated_ids', 'duplicate_ids', 'unassigned_ids', 'json_broken', 'flag_vetoes', 'headline_both_empty_goes_to_rules']) {
    assert.ok(names.has(need), need);
  }
});

test('clean: same rules as validate.clean in Python', () => {
  assert.equal(clean(null, 10), '');
  assert.equal(clean(5, 10), '');
  assert.equal(clean('  a \n\t b  ', 10), 'a b');
  assert.equal(clean('a\u200bb', 10), 'ab');
  assert.equal(clean('abcdef', 6), 'abcdef');
  assert.equal(clean('abcdefg', 6), 'abcde…');
  assert.equal(Array.from(clean('あ'.repeat(100), 60)).length, 60);
  assert.equal(Array.from(clean('\u{20bb7}'.repeat(61), 60)).length, 60);   // 非 BMP もコードポイントで数える
  assert.equal(clean('試験 \ud800 末尾', 20), '試験 末尾');                  // 孤立サロゲートは除く
});

test('fold and copies', () => {
  assert.equal(fold('Ａｂｃ-１２３ 、。'), 'abc123');
  assert.equal(copies('これは十文字を超える見出しの丸写し', [fold('十文字を超える見出しの丸写し')]), true);
  assert.equal(copies('短い', [fold('短い')]), false);                         // 10 字未満は検査しない
  assert.equal(copies('全く別の言い換えの文章です', [fold('十文字を超える見出しの丸写し')]), false);
});

test('flag vetoes (4.4)', () => {
  const jp = { outlet: 'NHK', home: 'jp', type: '公共放送' };
  const intl = { outlet: 'BBC', home: 'intl', type: '海外公共' };
  const gov = { outlet: '財務省', home: 'jp', type: PRIMARY_TYPE };
  assert.deepStrictEqual(vetoFlags(['overseas_only'], [intl, jp]), { kept: [], dropped: [{ flag: 'overseas_only', why: 'has_jp_outlet' }] });
  assert.deepStrictEqual(vetoFlags(['jp_main_not_found'], [intl]), { kept: [], dropped: [{ flag: 'jp_main_not_found', why: 'single_outlet' }] });
  assert.deepStrictEqual(vetoFlags(['jp_main_not_found'], [intl, jp]).dropped, [{ flag: 'jp_main_not_found', why: 'has_jp_mainstream' }]);
  assert.deepStrictEqual(vetoFlags(['primary_only'], [gov, intl]).dropped, [{ flag: 'primary_only', why: 'has_non_primary' }]);
  assert.deepStrictEqual(vetoFlags(['primary_only'], [gov]).kept, ['primary_only']);
  assert.deepStrictEqual(MAINSTREAM_TYPES, ['公共放送', '通信社', '全国紙', '民放']);
});

test('a hidden title (null) is never copied into an AI field', () => {
  for (const c of CASES) {
    const got = validate(c.request, c.raw, PROMPT, c.items);
    for (const stories of Object.values(got.blocks)) {
      for (const s of stories) {
        if (!s.ai) continue;
        for (const k of ['headline_ja', 'headline_en', 'contrast_ja', 'flag_note_ja']) assert.ok(!s.ai[k].includes('試験 題 i'), c.name);
      }
    }
  }
});

test('malformed requests and answers do not throw', () => {
  const base = CASES[0];
  assert.deepStrictEqual(validate(base.request, undefined, PROMPT, base.items).errors, ['json']);
  assert.deepStrictEqual(validate(base.request, null, PROMPT, base.items).errors, ['json']);
  assert.deepStrictEqual(validate({ ...base.request, doc: 'not json' }, '{"blocks":[]}', PROMPT, base.items).errors, ['shape']);
  assert.deepStrictEqual(validate({ ...base.request, alias: {} }, '{"blocks":[]}', PROMPT, base.items).errors, ['shape']);
  const proto = validate(base.request, '{"blocks":[{"bid":"__proto__","stories":[]}]}', PROMPT, base.items);
  assert.deepStrictEqual(proto.blocks, {});
});
