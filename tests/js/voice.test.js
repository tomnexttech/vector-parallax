// node --test tests/js/voice.test.js — the voice step: rules on the case set (the share is measured and printed), and the AI step kept to the list
import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from './helpers.js';
import { matchRule, checkPick, pickAi, route, candidates, normalize } from '../../js/voice.js';
import { CATALOG } from '../../js/actions.js';

const SET = readJson('tests', 'js', 'voice_cases.json');
const GROUPS = Object.keys(SET).filter((k) => Array.isArray(SET[k]));
/** ok = right (or rightly nothing) · miss = a rule did not catch what was wanted (safe: it falls through to the AI or the candidates)
 *  · fire = an operation ran that was not asked for (the id is not wanted, or the argument is wrong). Fires are what must stay at 0. */
const verdict = (c, r) => {
  const okIds = [c.want, ...(c.alt || [])];
  if (!r) return okIds.includes('none') ? 'ok' : 'miss';
  if (!okIds.includes(r.id)) return 'fire';
  if (r.id === c.want) {
    if (c.arg != null && r.arg !== c.arg) return 'fire';
    if (c.argHas != null && !String(r.arg).includes(c.argHas)) return 'fire';
  }
  return 'ok';
};
const describe = (c, r) => `${c.say} -> ${r ? r.id + ':' + r.arg : 'none'} (want ${c.want}${c.arg ? ':' + c.arg : c.argHas ? ':~' + c.argHas : ''})`;
function share(cases) {
  const miss = [], fire = [], kinds = {};
  let n = 0;
  for (const c of cases) {
    const r = matchRule(c.say), v = verdict(c, r);
    if (v === 'ok') n++; else (v === 'fire' ? fire : miss).push(describe(c, r));
    if (c.kind) { const k = kinds[c.kind] || (kinds[c.kind] = { n: 0, of: 0 }); k.of++; if (v === 'ok') k.n++; }
  }
  return { n, of: cases.length, rate: n / cases.length, miss, fire, kinds };
}
const pct = (s) => `${s.n}/${s.of} = ${(s.rate * 100).toFixed(1)}%`;

test('every wanted id is on the closed list', () => {
  const ids = new Set(CATALOG.map((c) => c.id));
  for (const g of GROUPS) for (const c of SET[g]) for (const w of [c.want, ...(c.alt || [])]) assert.ok(w === 'none' || ids.has(w), w);
});

test('rules: share of every set (all optimistic: written by the author, not heard) and no operation fires unasked', () => {
  const S = Object.fromEntries(GROUPS.map((g) => [g, share(SET[g])]));
  console.log('voice rules: ' + GROUPS.map((g) => `${g} ${pct(S[g])}`).join(' · '));
  for (const g of GROUPS) {
    if (S[g].miss.length) console.log(`  ${g} misses:`, S[g].miss.join(' | '));
    if (S[g].fire.length) console.log(`  ${g} FIRES (unasked):`, S[g].fire.join(' | '));
    if (Object.keys(S[g].kinds).length) console.log(`  ${g} by kind:`, Object.entries(S[g].kinds).map(([k, v]) => `${k} ${v.n}/${v.of}`).join(' · '));
  }
  assert.ok(S.main.rate >= 0.9, `main ${S.main.rate}`);
  assert.ok(S.holdout.rate >= 0.7, `holdout ${S.holdout.rate}`);
  for (const g of GROUPS) assert.deepEqual(S[g].fire, [], `${g}: an operation fired that was not asked for`);
  if (S.follow) assert.equal(S.follow.rate, 1, 'follow: ' + S.follow.miss.join(' | '));
});

test('chat is not turned into an operation', () => {
  for (const say of ['今日はいい天気だね', 'ありがとう', 'うーん', 'お腹すいた']) assert.equal(matchRule(say), null, say);
});

test('normalize drops fillers and polite endings but keeps the verb', () => {
  assert.equal(normalize('ねえ、地図を拡大してくれる？'), '地図を拡大して');
  assert.equal(normalize('北朝鮮を見張ってください'), '北朝鮮を見張って');
});

test('the AI step: an id off the list, a bad argument or words not heard are dropped', () => {
  assert.equal(checkPick({ id: 'delete_everything' }, '全部消して', CATALOG).id, 'none');
  assert.equal(checkPick({ id: 'topic', arg: 'sports' }, 'スポーツで絞って', CATALOG).id, 'none');
  assert.deepEqual(checkPick({ id: 'topic', arg: 'money' }, 'お金の話にして', CATALOG), { id: 'topic', arg: 'money', why: 'ai' });
  assert.equal(checkPick({ id: 'case_find', arg: '金正恩' }, '北の指導者の話', CATALOG).id, 'none');
  assert.deepEqual(checkPick({ id: 'case_find', arg: '指導者' }, '北の指導者の話', CATALOG), { id: 'case_find', arg: '指導者', why: 'ai' });
  assert.equal(checkPick({ id: 'case_next' }, 'つぎつぎ', CATALOG).id, 'case_next');
  assert.equal(checkPick(null, 'x', CATALOG).id, 'none');
});

test('route: rules first and without a call; the AI only when no rule matched; candidates without a key', async () => {
  let calls = 0;
  const provider = { call: async () => { calls++; return { raw: JSON.stringify({ id: 'sheet', arg: 'mkt' }), err: '' }; } };
  const r1 = await route(['地図を拡大して'], { provider, catalog: CATALOG });
  assert.equal(r1.by, 'rule'); assert.equal(calls, 0);
  const r2 = await route(['お金の動きの板'], { provider, catalog: CATALOG });
  assert.deepEqual([r2.id, r2.arg, r2.by], ['sheet', 'mkt', 'ai']); assert.equal(calls, 1);
  const bad = { call: async () => ({ raw: '{"id":"rm -rf"}', err: '' }) };
  const r3 = await route(['なにか変なこと'], { provider: bad, catalog: CATALOG });
  assert.equal(r3.id, 'none');
  const r4 = await route(['地図の様子が見たい感じ'], { catalog: CATALOG });
  assert.equal(r4.by, 'none'); assert.ok(r4.cands.length >= 1);
  assert.ok(candidates('地図', CATALOG).some((c) => c.id.startsWith('map')));
  const r5 = await pickAi('x', { call: async () => { throw new Error('net'); } }, CATALOG);
  assert.equal(r5.id, 'none');
});

test('the button is called 追う now: 追う / 追って / 追いかけて reach watch_add, watch_remove and topic watch (見張る still works), without a call', async () => {
  const want = [
    ['北朝鮮を追って', 'watch_add', '北朝鮮'], ['北朝鮮を追いかけて', 'watch_add', '北朝鮮'], ['北朝鮮を追う', 'watch_add', '北朝鮮'], ['北朝鮮を見張って', 'watch_add', '北朝鮮'],
    ['北朝鮮を追うのをやめて', 'watch_remove', '北朝鮮'], ['北朝鮮を見張るのをやめて', 'watch_remove', '北朝鮮'],
    ['追う語だけ見せて', 'topic', 'watch'], ['見張る語だけにして', 'topic', 'watch'],
  ];
  let calls = 0;
  const provider = { call: async () => { calls++; return { raw: '{"id":"none"}', err: '' }; } };
  for (const [say, id, arg] of want) { const r = await route([say], { provider, catalog: CATALOG }); assert.deepEqual([r.id, r.arg, r.by], [id, arg, 'rule'], say); }
  assert.equal(calls, 0);
  assert.equal(matchRule('追加して'), null);
  assert.equal(matchRule('追って連絡します'), null);
  assert.deepEqual(checkPick({ id: 'topic', arg: 'watch' }, '追っているものだけ', CATALOG), { id: 'topic', arg: 'watch', why: 'ai' });
  assert.deepEqual(checkPick({ id: 'watch_add', arg: '北朝鮮' }, '北朝鮮を追っていって', CATALOG), { id: 'watch_add', arg: '北朝鮮', why: 'ai' });
});

test('a word to search or follow must be a news topic: screens, devices, question words and bare time words are not', () => {
  for (const say of ['株の画面出して', 'ニュースの動画見せて', '地図のレイヤー何がある', '今日のニュースある', 'オーバーウォッチを追って', 'スピーカーを見張って']) assert.equal(matchRule(say), null, say);
  assert.deepEqual(matchRule('イスラエルの選挙についてニュース教えて'), { id: 'case_find', arg: 'イスラエルの選挙' });
  assert.deepEqual(matchRule('中東情勢を調査して'), { id: 'case_find', arg: '中東情勢' });
});

test('地震 and 台風 answer only when asked for, not when the word merely appears', () => {
  for (const say of ['地震って怖いよね', '地震の備えって何がいる？', '台風が来るから出かけたくない', '昨日の揺れ、すごかったよね']) assert.equal(matchRule(say), null, say);
  for (const say of ['地震あった？', '台湾で地震あった？', '地震の情報教えて', '揺れた？', '台風どうなってる', '台風は今どこ']) assert.ok(matchRule(say), say);
});
