// 11-15g: the AI may not add a word that praises or blames; a word the headlines carry is a reported word and stays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { judged, JUDGE_WORDS } from '../../js/summary.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.js';

test('a praising or blaming word that no headline carries is judged; the same word in a headline is not', () => {
  assert.equal(judged('キャッチ成功という偉業を中心に評価する', ['スペースX、ロケット宇宙船のキャッチ成功']), true);
  assert.equal(judged('完璧には至らなかった側面がある', ['回収失敗']), true);
  assert.equal(judged('偉業を成し遂げた', ['日本人初の偉業達成']), false, 'the headline says it: a reported word');
  assert.equal(judged('回収に成功した', ['回収に成功']), false, 'an outcome word of the headline is plain');
  assert.equal(judged('', []), false);
});

test('the page list is the list of data/prompt.json', () => {
  const p = JSON.parse(readFileSync(path.join(ROOT, 'data', 'prompt.json'), 'utf8'));
  assert.deepEqual([...JUDGE_WORDS].sort(), [...p.summary.judgement_ja].sort());
});
