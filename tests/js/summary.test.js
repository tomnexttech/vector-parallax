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
