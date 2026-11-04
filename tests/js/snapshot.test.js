// js/snapshot.js の試験。前回の AI の見方を保った回（CONTRACT §12）を、頁が読める形に直すこと、読めない形は null にすること。
import test from 'node:test';
import assert from 'node:assert/strict';
import { keptView, noticeParts, isOld, defaultView, SIX_H } from '../../js/snapshot.js';
import { readJson, clone } from './helpers.js';

const CASE = readJson('tests', 'fixtures', 'kept_case.json');
const fmt = (ts) => `T${ts}`;
const explain = (codes) => (codes || []).map((c) => `EXPLAIN(${c})`).join(' ');

test('a kept build becomes a separate, whole view: the snapshot itself, with the fetch time as its clock', () => {
  const data = clone(CASE.nokey);
  const frozen = JSON.stringify(data);
  const k = keptView(data);
  assert.ok(k);
  assert.equal(JSON.stringify(data), frozen, 'the data is not changed');
  assert.equal(k.aiAt, CASE.ai_at);
  assert.equal(k.fetchedAt, CASE.previous.generated_at);
  assert.equal(k.reason, 'nokey');
  assert.equal(k.view.generated_at, k.fetchedAt, 'the strips and the axis follow the earlier fetch');
  assert.notEqual(k.view.generated_at, data.generated_at);
  assert.deepStrictEqual(k.view.stories, CASE.previous.stories);
  assert.deepStrictEqual(k.view.items, CASE.previous.items);
  assert.deepStrictEqual(k.view.rule_clusters, CASE.previous.rule_clusters);
  assert.equal(k.snapRun.status, 'ok');
  assert.ok(k.view.stories.some((s) => s.origin === 'ai'));
});

test('the earlier AI bundles are not in the current data, and the view is not built from it', () => {
  const data = clone(CASE.error);
  const k = keptView(data);
  const { ai_snapshot, ...own } = data;                      // この回自身の部分
  const ownText = JSON.stringify(own);
  const onlyOld = Object.keys(k.view.items).filter((i) => !(i in data.items));
  assert.ok(onlyOld.length > 0, 'the fixture has items that exist only in the earlier fetch');
  for (const id of onlyOld) assert.ok(!ownText.includes(`"${id}"`), 'an id of the earlier fetch is not in this build');
  assert.ok(!ownText.includes('試験 題'), 'no AI text in this build');
  assert.ok(data.stories.every((s) => s.origin === 'rule' && s.ai === null), 'the current stories carry no AI text');
  assert.ok(k.view.stories.some((s) => s.origin === 'ai' && s.member_ids.some((i) => onlyOld.includes(i))), 'the view keeps the earlier AI stories whole');
  assert.equal(k.reason, 'error');
  assert.deepStrictEqual(data.ai_run.errors, ['quota']);
});

test('the notice says which fetch the AI bundles come from, and why this build has none of its own', () => {
  const nokey = noticeParts(keptView(clone(CASE.nokey)), fmt, explain, []);
  assert.deepStrictEqual(nokey.lead, ['AI の束ね', `T${CASE.previous.generated_at} の取得`]);
  assert.deepStrictEqual(nokey.why, ['今回', '鍵なし']);
  assert.deepStrictEqual(nokey.rules, ['規則の束', '今回の取得']);
  const error = noticeParts(keptView(clone(CASE.error)), fmt, explain, ['quota']);
  assert.deepStrictEqual(error.why, ['今回', '失敗・EXPLAIN(quota)']);
  assert.deepStrictEqual(error.lead, nokey.lead, 'the AI time is the same however often it was kept');
});

test('ai_at is its own clock: red after 6 hours whatever generated_at says', () => {
  const data = clone(CASE.nokey);
  data.ai_snapshot.ai_at = data.generated_at - 8 * 3600;
  const k = keptView(data);
  assert.equal(isOld(data.generated_at, data.generated_at), false, 'the rule fetch is fresh');
  assert.equal(isOld(k.aiAt, data.generated_at), true, 'the AI answers are not');
  assert.equal(isOld(1000, 1000 + SIX_H), false);
  assert.equal(isOld(1000, 1000 + SIX_H + 1), true);
  assert.equal(isOld(null, 5), false);
  assert.equal(isOld(5, undefined), false);
});

test('anything that is not a readable kept view gives null (the page then says the AI view is off)', () => {
  const bad = [];
  const mk = (f) => { const d = clone(CASE.nokey); f(d); bad.push(d); };
  mk((d) => { d.ai_run.status = 'nokey'; });
  mk((d) => { d.ai_run.status = 'ok'; });
  mk((d) => { delete d.ai_snapshot; });
  mk((d) => { d.ai_snapshot = 'x'; });
  mk((d) => { d.ai_snapshot = null; });
  mk((d) => { d.ai_snapshot.ai_at = '2026-11-04'; });
  mk((d) => { d.ai_snapshot.ai_at = null; });
  mk((d) => { d.ai_snapshot.source_fetched_at = NaN; });
  mk((d) => { delete d.ai_snapshot.items; });
  mk((d) => { d.ai_snapshot.rule_clusters = {}; });
  mk((d) => { d.ai_snapshot.stories = null; });
  for (const d of bad) assert.equal(keptView(d), null);
  for (const d of [null, undefined, 5, 'x', [], {}, { ai_run: null }, { ai_run: { status: 'kept_previous' } }]) assert.equal(keptView(d), null);
  const ok = clone(CASE.nokey);
  ok.ai_run.reason = 'weird';
  assert.equal(keptView(ok).reason, '', 'an unknown reason is not shown as one');
  const noRun = clone(CASE.nokey);
  delete noRun.ai_snapshot.ai_run;
  delete noRun.ai_snapshot.blocks;
  delete noRun.ai_snapshot.window_h;
  const k = keptView(noRun);
  assert.deepStrictEqual([k.snapRun, k.view.blocks, k.view.window_h], [{}, [], 36]);
});

test('defaultView: AI when there are AI results (ok / partial / recorded / a readable kept_previous), rules only when there are none', () => {
  const ai = { stories: [{ origin: 'ai' }] };
  for (const status of ['ok', 'partial', 'recorded']) assert.equal(defaultView({ ai_run: { status }, ...ai }), 'ai', status);
  for (const status of ['off', 'nokey', 'error']) assert.equal(defaultView({ ai_run: { status }, ...ai }), 'rules', status);
  assert.equal(defaultView({ ai_run: { status: 'ok' }, stories: [{ origin: 'rule' }] }), 'rules');
  const kept = clone(CASE.nokey);
  assert.equal(kept.ai_run.status, 'kept_previous');
  assert.equal(defaultView(kept), 'ai');
  const broken = clone(kept); delete broken.ai_snapshot;
  assert.equal(defaultView(broken), 'rules');
  assert.equal(defaultView(null), 'rules');
  assert.equal(defaultView(readJson('data', 'latest.json')), 'ai');   // 公開しているデータ（記録済み）
});
