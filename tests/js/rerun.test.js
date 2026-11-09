// js/rerun.js の試験。Python の build が組んだ stories と同じ物が組めること、偽の provider で壊れ方を突いても全 item が一回ずつ残ること。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rerunAI, sha1hex } from '../../js/rerun.js';
import { geminiProvider } from '../../js/provider.js';
import { PROMPT, readJson, clone, rulesAnswer, fakeProvider } from './helpers.js';

const FIX = readJson('tests', 'fixtures', 'rerun_cases.json');
const NOW = 1793790000;
const noBasis = (s) => { const { basis, ...rest } = s; return rest; };

/** 不変条件（CONTRACT §2 / §10）: どの item も一つの story に一回だけ。sid・並び・札の規則 */
function assertSound(out) {
  const ruleIds = out.rule_clusters.flatMap((r) => r.member_ids);
  const storyIds = out.stories.flatMap((s) => s.member_ids);
  assert.equal(new Set(storyIds).size, storyIds.length, 'no item in two stories');
  assert.deepStrictEqual([...storyIds].sort(), [...ruleIds].sort(), 'every item is in exactly one story');
  for (const s of out.stories) {
    assert.equal(s.sid, 's' + createHash('sha1').update([...s.member_ids].sort().join('|')).digest('hex').slice(0, 12));
    assert.equal(s.origin === 'ai', s.ai !== null);
    assert.equal(s.n_outlets, s.outlets.length);
    if (s.member_ids.length < 2) assert.equal(s.basis, null);
    const its = s.member_ids.map((i) => out.items[i]);
    assert.equal(s.first_ts, Math.min(...its.map((i) => i.ts)));
    assert.equal(s.last_ts, Math.max(...its.map((i) => i.ts)));
    if (s.ai) {
      for (const f of s.ai.flags) {                       // 規則の拒否を独立に確かめ直す
        if (f === 'overseas_only') assert.ok(its.every((i) => i.home !== 'jp'), 'overseas_only with a jp member');
        if (f === 'primary_only') assert.ok(its.every((i) => i.type === '政府一次'), 'primary_only with a non-primary member');
        if (f === 'jp_main_not_found') {
          assert.ok(new Set(its.map((i) => i.outlet)).size >= 2);
          assert.ok(its.every((i) => !(i.home === 'jp' && ['公共放送', '通信社', '全国紙', '民放'].includes(i.type))));
        }
      }
      for (const a of s.ai.angles) assert.ok(s.member_ids.includes(a.item_id), 'angle for a non-member');
    }
  }
  const order = out.stories.map((s) => [-s.n_outlets, -s.last_ts, s.sid]);
  const sorted = [...order].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
  assert.deepStrictEqual(order, sorted, 'stories are ordered');
  assert.ok(!JSON.stringify(out).includes('"n999"'), 'a made-up id never reaches the output');
}

test('sha1hex matches node:crypto (sid)', () => {
  for (const s of ['', 'abc', 'a|b', '試験', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(119), 'あ'.repeat(200)]) {
    assert.equal(sha1hex(s), createHash('sha1').update(s).digest('hex'), s.slice(0, 8));
  }
});

for (const c of FIX.cases) {
  test(`same stories as Python's build: ${c.name}`, async () => {
    const base = clone(FIX.base);
    const frozen = JSON.stringify(base);
    const prov = fakeProvider(c.answers);
    const progress = [];
    const out = await rerunAI(base, prov, { prompt: PROMPT, now: NOW, compact: false, onProgress: (p) => progress.push(p) });   // the whole request as the build writes it (the cut is tested in slim.test.js)

    assert.equal(JSON.stringify(base), frozen, 'the input data is not changed');
    assert.equal(prov.calls.length, base.ai_requests.length, 'one provider call per request, in order');
    prov.calls.forEach((call, i) => {
      assert.equal(call.system, PROMPT.system);
      assert.deepStrictEqual(call.schema, PROMPT.schema);
      assert.equal(call.extra.maxOutputTokens, PROMPT.max_output_tokens);
      assert.equal(call.userText, PROMPT.user_template.replace('{DOC}', () => base.ai_requests[i].doc));
    });
    assert.deepStrictEqual(out.blocks, c.expect.blocks);
    assert.deepStrictEqual(out.stories.map(noBasis), c.expect.stories);
    const { status, calls, calls_failed, errors, blocks_sent, blocks_ok, dropped_ids, dup_ids, unassigned_ids,
      merges, splits, flags_vetoed, quoted_fields, prompt_version } = out.ai_run;
    assert.deepStrictEqual({ status, calls, calls_failed, errors, blocks_sent, blocks_ok, dropped_ids, dup_ids, unassigned_ids,
      merges, splits, flags_vetoed, quoted_fields, prompt_version }, c.expect.ai_run);
    assert.equal(out.ai_run.provider, 'fake-ai');
    assert.equal(out.ai_run.model, 'fake-1');
    assert.equal(out.ai_run.at, NOW);
    assert.equal(out.generated_at, base.generated_at, 'generated_at is the data time, not the AI time');
    for (const k of ['schema', 'window_h', 'sources', 'items', 'edition', 'rule_clusters', 'ai_requests']) assert.deepStrictEqual(out[k], base[k], k);
    // basis: 持つなら Python と同じ。同じ顔ぶれの story が元にあれば必ず持つ
    const baseBySid = new Map(base.stories.map((s) => [s.sid, s]));
    for (const s of out.stories) {
      if (s.basis) assert.deepStrictEqual(s.basis, c.expect.basis[s.sid], 'basis ' + s.sid);
      if (baseBySid.has(s.sid) && baseBySid.get(s.sid).basis) assert.ok(s.basis, 'twin keeps its basis ' + s.sid);
    }
    assertSound(out);
    // onProgress: 要求ごとに start と end。done は終えた数、err は符号か ''
    assert.equal(progress.length, base.ai_requests.length * 2);
    base.ai_requests.forEach((r, i) => {
      assert.deepStrictEqual(progress[2 * i], { rid: r.rid, done: i, total: base.ai_requests.length, err: '', phase: 'start' });
      const end = progress[2 * i + 1];
      assert.deepStrictEqual([end.rid, end.done, end.total, end.phase], [r.rid, i + 1, base.ai_requests.length, 'end']);
      const parses = (() => { try { JSON.parse(c.answers[i].raw); return true; } catch { return false; } })();
      assert.equal(end.err, c.answers[i].err || (parses ? '' : 'json'));
    });
  });
}

// ---------------------------------------------------------------- 突く 6 つ
test('probe 1 (made-up ids): ids outside the block never get in; the real members stay together', async () => {
  const c = FIX.cases.find((x) => x.name === 'dirty_answers');
  const out = await rerunAI(clone(FIX.base), fakeProvider(c.answers), { prompt: PROMPT, now: NOW });
  assert.ok(out.ai_run.dropped_ids > 0, 'the made-up ids were counted');
  assert.equal(out.ai_run.status, 'ok');
  assertSound(out);
});

test('probe 2 (left out): members the answer forgot come back as rule stories, nothing is lost', async () => {
  const c = FIX.cases.find((x) => x.name === 'dirty_answers');
  const out = await rerunAI(clone(FIX.base), fakeProvider(c.answers), { prompt: PROMPT, now: NOW });
  assert.ok(out.ai_run.unassigned_ids > 0);
  assert.ok(out.ai_run.dup_ids > 0, 'ids used twice were counted too');
  assert.ok(out.stories.some((s) => s.origin === 'rule' && s.bid !== null), 'a rule story kept its block id');
  assertSound(out);
});

test('probe 3 (broken JSON): the call fails, its blocks go back to the rule groups (FALLBACK), the others stay', async () => {
  const c = FIX.cases.find((x) => x.name === 'one_call_broken_json');
  const out = await rerunAI(clone(FIX.base), fakeProvider(c.answers), { prompt: PROMPT, now: NOW });
  assert.equal(out.ai_run.status, 'partial');
  assert.deepStrictEqual(out.ai_run.errors, ['json']);
  const fb = out.blocks.filter((b) => b.ai === 'fallback').map((b) => b.bid);
  assert.ok(fb.length > 0 && fb.length < out.blocks.length);
  for (const s of out.stories) if (fb.includes(s.bid)) assert.deepStrictEqual([s.origin, s.ai], ['rule', null]);
  assertSound(out);
});

test('probe 3b (everything fails): status error, every story is a rule story, the data is still complete', async () => {
  const prov = fakeProvider(() => ({ err: 'quota' }));
  const out = await rerunAI(clone(FIX.base), prov, { prompt: PROMPT, now: NOW });
  assert.equal(out.ai_run.status, 'error');
  assert.equal(out.ai_run.calls_failed, out.ai_run.calls);
  assert.ok(out.stories.every((s) => s.origin === 'rule' && s.ai === null));
  assert.ok(out.blocks.every((b) => b.ai === 'fallback'));
  assertSound(out);
});

test('probe 4 (429 and retry): a BYOK call that gets 429 twice then 200 succeeds after waiting 2 s and 4 s', async () => {
  const base = clone(FIX.base);
  base.ai_requests = base.ai_requests.slice(0, 1);
  const sleeps = [], seen = [];
  const answer = (userText) => rulesAnswer(userText);
  const replies = [{ status: 429 }, { status: 429 }, { status: 200 }];
  const doFetch = async (url, init) => {
    seen.push({ url, init });
    const r = replies[seen.length - 1];
    if (r.status === 200) {
      const userText = JSON.parse(init.body).contents[0].parts[0].text;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer(userText) }] }, finishReason: 'STOP' }] }), { status: 200 });
    }
    return new Response('{"error":{"message":"Resource exhausted"}}', { status: r.status });
  };
  const key = 'KEY-' + 'x'.repeat(24);
  const prov = geminiProvider(key, 'gemini-3.6-flash', { fetch: doFetch, sleep: async (ms) => { sleeps.push(ms); } });
  const out = await rerunAI(base, prov, { prompt: PROMPT, now: NOW });
  assert.deepStrictEqual(sleeps, [2000, 4000]);
  assert.equal(seen.length, 3);
  assert.equal(out.ai_run.status, 'ok');
  assert.equal(out.ai_run.calls, 1);
  assert.equal(out.ai_run.provider, 'gemini');
  assert.ok(!JSON.stringify(out).includes(key), 'the key is nowhere in the result');
  for (const s of seen) assert.ok(!s.url.includes(key), 'the key is not in the URL');
  assertSound(out);
});

test('probe 4b (429 every time): status error with the code quota, the recorded view can stay', async () => {
  const base = clone(FIX.base);
  base.ai_requests = base.ai_requests.slice(0, 1);
  const sleeps = [];
  const doFetch = async () => new Response('{}', { status: 429 });
  const prov = geminiProvider('k-123', 'gemini-3.6-flash', { fetch: doFetch, sleep: async (ms) => { sleeps.push(ms); } });
  const out = await rerunAI(base, prov, { prompt: PROMPT, now: NOW });
  assert.deepStrictEqual(sleeps, [2000, 4000], 'at most two retries');
  assert.equal(out.ai_run.status, 'error');
  assert.deepStrictEqual(out.ai_run.errors, ['quota']);
});

test('probe 5 (flag vetoes): the rules have the last word on every flag', async () => {
  const c = FIX.cases.find((x) => x.name === 'dirty_answers');
  const out = await rerunAI(clone(FIX.base), fakeProvider(c.answers), { prompt: PROMPT, now: NOW });
  assert.ok(out.ai_run.flags_vetoed > 0);
  const dropped = out.stories.flatMap((s) => (s.ai ? s.ai.flags_dropped : []));
  assert.equal(dropped.length, out.ai_run.flags_vetoed);
  assert.ok(dropped.every((d) => ['has_jp_outlet', 'has_jp_mainstream', 'single_outlet', 'has_non_primary'].includes(d.why)));
  assert.ok(!out.stories.some((s) => s.ai && s.ai.flags.includes('bogus')), 'a flag outside the list is dropped quietly');
  assertSound(out);
});

test('probe 6 (public edition hides titles): the call carries only titles that may be shown; the output has none of the hidden ones', async () => {
  const pub = clone(FIX.public_base);
  const hidden = Object.values(pub.items).filter((i) => i.title === null).map((i) => FIX.base.items[i.id].title);
  const shown = Object.values(pub.items).filter((i) => typeof i.title === 'string');
  assert.ok(hidden.length >= 5 && shown.length >= 2);
  assert.equal(pub.ai_requests.length, 1);
  // 見出しを出してよい塊だけが要求にある
  const reqIds = new Set(Object.values(pub.ai_requests[0].alias));
  assert.ok([...reqIds].every((id) => typeof pub.items[id].title === 'string'));

  const visible = pub.items[[...reqIds][0]].title;
  const prov = fakeProvider((i, userText) => ({
    raw: rulesAnswer(userText, (ans) => { ans.blocks[0].stories[0].headline_ja = visible; ans.blocks[0].stories[0].headline_en = ''; }),
  }));
  const out = await rerunAI(pub, prov, { prompt: PROMPT, now: NOW });
  for (const call of prov.calls) for (const t of hidden) assert.ok(!call.userText.includes(t), 'a hidden title was sent: ' + t);
  const text = JSON.stringify(out);
  for (const t of hidden) assert.ok(!text.includes(t), 'a hidden title is in the output: ' + t);
  assert.deepStrictEqual(out.items, pub.items, 'no title is added to the items');
  assert.ok(out.ai_run.quoted_fields >= 1, 'a copied (shown) headline was blanked');
  // 送った塊だけが AI。送らなかった束は規則のまま（bid なし）
  const sentBids = new Set(pub.ai_requests[0].bids);
  assert.deepStrictEqual(out.blocks.map((b) => b.bid), [...sentBids]);
  for (const s of out.stories) {
    if (s.bid === null) assert.deepStrictEqual([s.origin, s.ai], ['rule', null]);
    else assert.ok(sentBids.has(s.bid));
  }
  assert.ok(out.stories.some((s) => s.origin === 'ai'));
  assertSound(out);
});

test('input checks: no provider / not parallax/1 / no requests', async () => {
  await assert.rejects(() => rerunAI(clone(FIX.base), null, { prompt: PROMPT }));
  await assert.rejects(() => rerunAI({ items: 1 }, fakeProvider([]), { prompt: PROMPT }));
  const none = clone(FIX.base);
  none.ai_requests = [];
  const prov = fakeProvider([]);
  const out = await rerunAI(none, prov, { prompt: PROMPT, now: NOW });
  assert.equal(out.ai_run.status, 'off');
  assert.equal(prov.calls.length, 0);
  assert.deepStrictEqual(out.blocks, []);
  assertSound(out);
});

test('a provider that throws is a network failure, not a crash', async () => {
  const prov = { name: 'boom', model: 'x', call: async () => { throw new Error('KEY-should-not-appear'); } };
  const out = await rerunAI(clone(FIX.base), prov, { prompt: PROMPT, now: NOW });
  assert.equal(out.ai_run.status, 'error');
  assert.ok(out.ai_run.errors.every((e) => e === 'network'));
  assert.ok(!JSON.stringify(out).includes('KEY-should-not-appear'));
});

// ---------------------------------------------------------------- 前回の AI の見方を保った回（CONTRACT §12）
const KEPT = readJson('tests', 'fixtures', 'kept_case.json');

for (const kind of ['nokey', 'error']) {
  test(`BYOK on a build that kept the earlier AI view (${kind}): the visitor's result starts from this build, the earlier bundles stay out`, async () => {
    const base = clone(KEPT[kind]);
    const frozen = JSON.stringify(base);
    assert.equal(base.ai_run.status, 'kept_previous');
    const prov = fakeProvider((i, userText) => ({ raw: rulesAnswer(userText) }));
    const out = await rerunAI(base, prov, { prompt: PROMPT, now: NOW });
    assert.equal(JSON.stringify(base), frozen, 'the input data is not changed');
    assert.equal(out.ai_run.status, 'ok');
    assert.ok(!('reason' in out.ai_run) && !('ai_snapshot' in out), 'nothing of the earlier view is carried');
    assert.equal(out.ai_run.at, NOW, 'the AI time is the visitor run, not the earlier one');
    assert.ok(out.stories.some((s) => s.origin === 'ai'));
    assert.deepStrictEqual(out.items, base.items);
    assert.deepStrictEqual(out.rule_clusters, base.rule_clusters);
    const onlyOld = Object.keys(KEPT.previous.items).filter((i) => !(i in base.items));
    assert.ok(onlyOld.length > 0);
    const text = JSON.stringify(out);
    for (const id of onlyOld) assert.ok(!text.includes(`"${id}"`), 'an id of the earlier fetch got in');
    assertSound(out);
  });
}

test('BYOK on a kept build that fails every call: error, rule stories, still no earlier bundles', async () => {
  const out = await rerunAI(clone(KEPT.nokey), fakeProvider(() => ({ err: 'quota' })), { prompt: PROMPT, now: NOW });
  assert.equal(out.ai_run.status, 'error');
  assert.ok(!('ai_snapshot' in out));
  assert.ok(out.stories.every((s) => s.origin === 'rule' && s.ai === null));
  assertSound(out);
});

// ---------------------------------------------------------------- 公開版: 利用条件が ok でない源の焦点は、BYOK の結果にも出ない（CONTRACT §7）
test('BYOK on the public edition: an angle can only be about an item whose headline may be shown (never an unknown / nc / no source)', async () => {
  const pub = clone(FIX.public_base);
  const prov = fakeProvider((i, userText) => ({ raw: rulesAnswer(userText) }));        // どの member にも焦点を付けて返す
  const out = await rerunAI(pub, prov, { prompt: PROMPT, now: NOW });
  let n = 0;
  for (const s of out.stories) {
    if (!s.ai) continue;
    for (const a of s.ai.angles) {
      n += 1;
      assert.notEqual(out.items[a.item_id].title, null, 'an angle for a hidden-title item: ' + a.item_id);
    }
  }
  assert.ok(n > 0, 'the case needs angles to be tested');
  // 隠れた見出しの item を angle に入れても、検査が捨てる（送った塊に無い id は取り込まれない）
  const hiddenId = Object.keys(pub.items).find((id) => pub.items[id].title === null);
  const sneaky = fakeProvider((i, userText) => ({
    raw: rulesAnswer(userText, (ans) => { ans.blocks[0].stories[0].angles.push({ item_id: 'n999', focus_ja: 'SNEAKY-FOCUS' }); }),
  }));
  const out2 = await rerunAI(clone(pub), sneaky, { prompt: PROMPT, now: NOW });
  assert.ok(!JSON.stringify(out2).includes('SNEAKY-FOCUS'));
  assert.ok(hiddenId, 'the public base has hidden-title items');
  assert.ok(out2.stories.every((s) => !s.ai || s.ai.angles.every((a) => out2.items[a.item_id].title !== null)));
});
