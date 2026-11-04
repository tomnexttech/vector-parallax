// node --test tests/js/voice.test.js — the voice step: rules on the case set (the share is measured and printed), and the AI step kept to the list
import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from './helpers.js';
import { matchRule, checkPick, pickAi, route, candidates, normalize } from '../../js/voice.js';
import { CATALOG } from '../../js/actions.js';

const SET = readJson('tests', 'js', 'voice_cases.json');
const hit = (c, r) => {
  const okIds = [c.want, ...(c.alt || [])];
  if (!r) return okIds.includes('none');
  if (!okIds.includes(r.id)) return false;
  return r.id !== c.want || c.arg == null || r.arg === c.arg;
};
function share(cases) {
  const miss = [];
  let n = 0;
  for (const c of cases) { const r = matchRule(c.say); if (hit(c, r)) n++; else miss.push(`${c.say} -> ${r ? r.id + ':' + r.arg : 'none'} (want ${c.want})`); }
  return { n, of: cases.length, rate: n / cases.length, miss };
}

test('every wanted id is on the closed list', () => {
  const ids = new Set(CATALOG.map((c) => c.id));
  for (const c of [...SET.main, ...SET.holdout]) for (const w of [c.want, ...(c.alt || [])]) assert.ok(w === 'none' || ids.has(w), w);
});

test('rules: share of the main set and of the held-out set', () => {
  const m = share(SET.main), h = share(SET.holdout);
  console.log(`voice rules: main ${m.n}/${m.of} = ${(m.rate * 100).toFixed(1)}% · holdout ${h.n}/${h.of} = ${(h.rate * 100).toFixed(1)}%`);
  if (m.miss.length) console.log('  main misses:', m.miss.join(' | '));
  if (h.miss.length) console.log('  holdout misses:', h.miss.join(' | '));
  assert.ok(m.rate >= 0.9, `main ${m.rate}`);
  assert.ok(h.rate >= 0.7, `holdout ${h.rate}`);
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
