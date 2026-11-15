// One story split in two bundles is counted once (js/samestory.js); stories that only share a place or a person stay apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, wordsOf, sameStory, foldSame } from '../../js/samestory.js';

const ev = (key, title, n, home = 'jp') => ({ key, title, members: Array.from({ length: n }, (_, i) => ({ id: `${key}-${i}`, home })) });
const fold = (es) => foldSame(es, { titlesOf: (e) => [e.title], idOf: (it) => it.id });

test('the outlet after a headline and the 【】 label are not words of the story', () => {
  assert.equal(clean('県高校総合文化祭 - 沖縄タイムス紙面掲載記事'), '県高校総合文化祭');
  assert.equal(clean('同点ゴールを決められた日本 サッカー：時事ドットコム'), '同点ゴールを決められた日本 サッカー');
  assert.equal(clean('ヤッホイ・永井が語る理由 | オリジナル記事 | AERA'), 'ヤッホイ・永井が語る理由');
  assert.deepEqual([...wordsOf('【速報】米国の大統領が会見')], []);
});

test('the two halves of one story become one: the smaller folds into the larger and its reports join it', () => {
  const a = ev('st-a', 'ゼレンスキー大統領は、ドンバス地域の譲渡と引き換えにNATO加盟を認める案を米国が打診してきたと明かした。', 4);
  const b = ev('st-b', 'ウクライナのゼレンスキー大統領は、米国から北大西洋条約機構（NATO）への加盟を条件に東部ドンバス地域からの撤退を求められた', 6, 'intl');
  assert.equal(fold([a, b]), 1);
  assert.equal(a.foldedInto, 'st-b');
  assert.equal(b.members.length, 10);
  assert.deepEqual(b.sameAs, ['st-a']);
});

test('a report in both bundles is counted once', () => {
  const a = ev('st-a', 'ネタニヤフ首相が挙国一致内閣を訴え、アイゼンコット氏が批判', 3);
  const b = ev('st-b', 'アイゼンコット氏、ネタニヤフ暫定首相を批判', 2);
  b.members.push(a.members[0]);
  fold([a, b]);
  assert.equal(b.foldedInto, 'st-a');
  assert.equal(a.members.length, 5);
});

test('stories that share a place or two words stay apart', () => {
  const a = ev('st-a', 'イスラエル軍によるガザ地区への空爆により、ハマスの幹部司令官が死亡した。', 5);
  const b = ev('st-b', 'ガザ地区でやけどを負った6歳の子供が支援をめぐるイスラエルの争いに巻き込まれている。', 3);
  const c = ev('st-c', '米国の大統領が日本の首相と会見', 2);
  const d = ev('st-d', '米国の大統領が中国の首相と会見', 2);
  assert.equal(fold([a, b, c, d]), 0);
  assert.ok(![a, b, c, d].some((e) => e.foldedInto));
  assert.equal(sameStory(new Set(), new Set(['x'])), false);
});

test('a bundle already folded elsewhere is left alone, and nothing happens without the titles', () => {
  const a = ev('st-a', 'ゼレンスキー大統領がドンバス地域とNATO加盟について語った', 3);
  const b = ev('st-b', 'ゼレンスキー大統領、ドンバス地域の扱いとNATO加盟の条件', 2);
  b.foldedInto = 'st-x';
  assert.equal(fold([a, b]), 0);
  assert.equal(foldSame([a, ev('st-c', 'x', 1)]), 0);
});
