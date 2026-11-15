// Which country's politics: 国内政治 is Japan's own; another country's election or office is 国際 (docs/design-1115b.md §5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldOf, placeField, foreignPolitics } from '../../js/topics.js';

test('a foreign election from a desk of Japanese politics is 国際; Japan\'s own elections stay 国内政治', () => {
  // the two the list of the home showed under 国内政治 on 11-15
  for (const t of ['中間選挙の注目州・ミシガン', '米中間選挙、民主党が下院を奪還', '米アラスカ州知事選で民主党の37歳新人が勝利']) {
    assert.equal(placeField('国内政治', t), '国際', t);
    assert.equal(fieldOf(t, ['jp']), '国際', t);
    assert.ok(foreignPolitics(t), t);
  }
  // the other way: Japan's elections and its Diet never go to 国際
  for (const t of ['衆院選の投票率が過去最低', '首相が国会で答弁', '東京都知事選の告示', "Japan's LDP wins the upper house election"]) {
    assert.equal(placeField('国内政治', t), '国内政治', t);
    assert.ok(!foreignPolitics(t), t);
  }
  assert.equal(fieldOf('衆院選の投票率が過去最低', ['jp']), '国内政治');
  // 九州 and 本州 are not a state abroad; 米 as rice is not America
  assert.ok(!foreignPolitics('九州の知事が会談'));
  assert.ok(!foreignPolitics('米価の高騰で知事が要望'));
  // a field other than 国内政治 is left as it is
  assert.equal(placeField('経済', '米中間選挙と関税'), '経済');
});
