// js/summary.js の試験。DOM なし。
import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryOf, summaryIndex, memberKey, summaryLabel } from '../../js/summary.js';
import { readJson } from './helpers.js';

const good = { text_ja: ' 沿岸の港が嵐で閉鎖された ', made_at: 1762225200, provider: 'gemini', model: 'gemini-test-model' };

test('summaryOf reads a well-formed summary and trims it', () => {
  assert.deepEqual(summaryOf({ summary: good }),
    { text: '沿岸の港が嵐で閉鎖された', provider: 'gemini', model: 'gemini-test-model', madeAt: 1762225200 });
  assert.equal(summaryLabel(summaryOf({ summary: good })), 'gemini \u00b7 gemini-test-model');
});

test('summaryOf shows nothing when any field is missing or of the wrong type', () => {
  for (const k of ['text_ja', 'made_at', 'provider', 'model']) {
    const bad = { ...good }; delete bad[k];
    assert.equal(summaryOf({ summary: bad }), null, k);
  }
  assert.equal(summaryOf({ summary: { ...good, text_ja: '   ' } }), null);
  assert.equal(summaryOf({ summary: { ...good, made_at: '1762225200' } }), null);
  assert.equal(summaryOf({ summary: [good] }), null);
  assert.equal(summaryOf({}), null);
  assert.equal(summaryOf(null), null);
  assert.equal(summaryLabel(null), '');
});

test('summaryIndex is keyed by the member set (order does not matter) and skips stories that have an AI headline', () => {
  const stories = [
    { member_ids: ['b', 'a'], origin: 'rule', ai: null, summary: good },
    { member_ids: ['c'], origin: 'ai', ai: { headline_ja: 'x' }, summary: good },
    { member_ids: ['d'], origin: 'rule', ai: null },
  ];
  const ix = summaryIndex(stories);
  assert.deepEqual([...ix.keys()], ['a|b']);
  assert.equal(ix.get(memberKey(['a', 'b'])).provider, 'gemini');
  assert.equal(summaryIndex(null).size, 0);
});

test('the committed data: every summary on a story reads back, and one file holds one provider', () => {
  const d = readJson('data', 'latest.json');
  const withSummary = d.stories.filter((s) => s.summary !== undefined);
  for (const s of withSummary) assert.ok(summaryOf(s), s.sid);
  assert.ok(new Set(withSummary.map((s) => s.summary.provider)).size <= 1);
});

// 詳しい要約（story.brief）。無い・古い形・壊れた形では null で、頁は今までの表示のまま
import { briefOf, briefIndex, BRIEF_UNKNOWN } from '../../js/summary.js';
const brief = (o = {}) => ({ what_ja: '港で船が座礁した。', background_ja: BRIEF_UNKNOWN, views_ja: '', next_ja: '', made_at: 5, provider: 'gemini', model: 'm', ...o });

test('briefOf: four rows at most; empty rows and rows that say "not reported" are left out', () => {
  const b = briefOf({ brief: brief() });
  assert.deepEqual(b.rows.map((r) => r.key), ['what_ja']);
  const c = briefOf({ brief: brief({ background_ja: '港は閉鎖された。', views_ja: BRIEF_UNKNOWN, next_ja: '調査が始まる。' }) });
  assert.deepEqual(c.rows.map((r) => r.key), ['what_ja', 'background_ja', 'next_ja']);
  assert.deepEqual([b.provider, b.model, b.madeAt], ['gemini', 'm', 5]);
});

test('briefOf: when every row is empty or "not reported" there is no brief, so no frame', () => {
  assert.equal(briefOf({ brief: brief({ what_ja: BRIEF_UNKNOWN, background_ja: BRIEF_UNKNOWN }) }), null);
});

test('briefOf: no brief, an old story, a brief without what_ja or who wrote it: null', () => {
  for (const st of [null, {}, { brief: null }, { brief: 'x' }, { brief: brief({ what_ja: '  ' }) }, { brief: brief({ made_at: 'x' }) }, { brief: brief({ provider: '' }) }]) {
    assert.equal(briefOf(st), null);
  }
});

test('briefIndex: by the members, so a re-run that regroups keeps the briefs of the groups that stayed', () => {
  const m = briefIndex([{ member_ids: ['b', 'a'], brief: brief() }, { member_ids: ['c'] }]);
  assert.equal(m.size, 1);
  assert.ok(m.get('a|b'));
});
