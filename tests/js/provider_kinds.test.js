// js/provider.js の提供元ごとの試験（Gemini・Claude・OpenAI）。偽の fetch で、要求の形・鍵の置き場・誤りの扱いを確かめる。本物の鍵は使わず、網には出ない。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { makeProvider, geminiProvider, toJsonSchema, claudeReplyText, openaiReplyText, PROVIDERS, KINDS, MODEL_RE, OPENAI_MIN_TOKENS } from '../../js/provider.js';
import { ROOT } from './helpers.js';

const KEY = 'test-key-not-real';
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
const claudeOk = (input) => json({ type: 'message', stop_reason: 'tool_use', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'reply', input }] });
const openaiOk = (text) => json({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }] });
const SCHEMA = { type: 'OBJECT', properties: { lines: { type: 'ARRAY', items: { type: 'STRING' }, nullable: true } }, required: ['lines'] };

function rig(kind, model, replies, extra) {
  const seen = [], sleeps = [];
  const doFetch = async (url, init) => {
    seen.push({ url, init });
    const r = replies[Math.min(seen.length - 1, replies.length - 1)];
    if (r instanceof Error) throw r;
    return r instanceof Response ? r.clone() : r;
  };
  const prov = makeProvider(kind, KEY, model, { fetch: doFetch, sleep: async (ms) => { sleeps.push(ms); }, ...extra });
  return { prov, seen, sleeps };
}
const go = (prov, extra) => prov.call('SYSTEM', 'USER TEXT', SCHEMA, extra);
const keyFree = (...xs) => xs.every((x) => !JSON.stringify(x).includes(KEY));

test('the table: three providers, models that pass MODEL_RE, and every host is allowed by the page\'s connect-src', () => {
  assert.deepStrictEqual(KINDS, ['gemini', 'claude', 'openai']);
  const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(readFileSync(path.join(ROOT, 'index.html'), 'utf8'))[1];
  const connect = /connect-src ([^;]+)/.exec(csp)[1].split(/\s+/);
  for (const k of KINDS) {
    const p = PROVIDERS[k];
    assert.ok(p.ja && MODEL_RE.test(p.model) && p.models.includes(p.model) && p.models.every((m) => MODEL_RE.test(m)), k);
    assert.ok(connect.includes(`https://${p.host}`), `connect-src has ${p.host}`);
  }
});

test('claude: the key goes in x-api-key only; anthropic-version and the direct-browser header are sent; a forced tool carries the schema', async () => {
  const { prov, seen } = rig('claude', 'claude-sonnet-5-5', [claudeOk({ lines: ['a', 'b', 'c'] })]);
  const r = await go(prov);
  assert.deepStrictEqual(r, { raw: '{"lines":["a","b","c"]}', err: '' });
  const { url, init } = seen[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-api-key'], KEY);
  assert.equal(init.headers['anthropic-version'], '2023-06-01');
  assert.equal(init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.ok(!('authorization' in init.headers) && !('x-goog-api-key' in init.headers), 'no other provider\'s header');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.ok(!url.includes(KEY) && !init.body.includes(KEY));
  const b = JSON.parse(init.body);
  assert.equal(b.model, 'claude-sonnet-5-5');
  assert.equal(b.max_tokens, 16384);
  assert.equal(b.system, 'SYSTEM');
  assert.deepStrictEqual(b.messages, [{ role: 'user', content: 'USER TEXT' }]);
  assert.deepStrictEqual(b.tool_choice, { type: 'tool', name: 'reply' });
  assert.deepStrictEqual(b.tools[0].input_schema, { type: 'object', properties: { lines: { type: 'array', items: { type: 'string' } } }, required: ['lines'] });
  assert.ok(!('temperature' in b), 'no sampling knobs the newer models may refuse');
});

test('claude: the maximum follows the fourth argument, and a call without a schema sends no tool', async () => {
  const { prov, seen } = rig('claude', 'claude-haiku-4-5', [json({ content: [{ type: 'text', text: 'plain' }], stop_reason: 'end_turn' })]);
  const r = await prov.call('S', 'U', null, { maxOutputTokens: 64 });
  assert.deepStrictEqual(r, { raw: 'plain', err: '' });
  const b = JSON.parse(seen[0].init.body);
  assert.equal(b.max_tokens, 64);
  assert.ok(!('tools' in b) && !('tool_choice' in b));
});

test('claude: replies — a cut answer, a refusal, an empty or odd shape', () => {
  assert.deepStrictEqual(claudeReplyText({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'x' }] }), { text: null, err: 'truncated' });
  assert.deepStrictEqual(claudeReplyText({ stop_reason: 'refusal', content: [] }), { text: null, err: 'blocked' });
  assert.deepStrictEqual(claudeReplyText({ stop_reason: 'end_turn', content: [] }), { text: null, err: 'shape' });
  assert.deepStrictEqual(claudeReplyText({ content: 'x' }), { text: null, err: 'shape' });
  assert.deepStrictEqual(claudeReplyText([]), { text: null, err: 'shape' });
  assert.deepStrictEqual(claudeReplyText(null), { text: null, err: 'shape' });
});

test('openai: Authorization Bearer only; a json_schema answer; no temperature; the output ceiling has a floor for models that think', async () => {
  const { prov, seen } = rig('openai', 'gpt-5-mini', [openaiOk('{"lines":["a"]}')]);
  const r = await go(prov, { maxOutputTokens: 64 });
  assert.deepStrictEqual(r, { raw: '{"lines":["a"]}', err: '' });
  const { url, init } = seen[0];
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(init.headers.authorization, `Bearer ${KEY}`);
  assert.ok(!('x-api-key' in init.headers) && !('x-goog-api-key' in init.headers));
  assert.equal(init.credentials, 'omit');
  assert.ok(!url.includes(KEY) && !init.body.includes(KEY));
  const b = JSON.parse(init.body);
  assert.equal(b.model, 'gpt-5-mini');
  assert.deepStrictEqual(b.messages, [{ role: 'system', content: 'SYSTEM' }, { role: 'user', content: 'USER TEXT' }]);
  assert.equal(b.max_completion_tokens, OPENAI_MIN_TOKENS);
  assert.ok(!('max_tokens' in b) && !('temperature' in b));
  assert.equal(b.response_format.type, 'json_schema');
  assert.deepStrictEqual(b.response_format.json_schema.schema.properties.lines, { type: 'array', items: { type: 'string' } });
  const big = rig('openai', 'gpt-5-mini', [openaiOk('{}')]);
  await go(big.prov, { maxOutputTokens: 9000 });
  assert.equal(JSON.parse(big.seen[0].init.body).max_completion_tokens, 9000);
});

test('openai: replies — length, refusal, content filter, empty', () => {
  const c = (message, finish_reason = 'stop') => ({ choices: [{ finish_reason, message }] });
  assert.deepStrictEqual(openaiReplyText(c({ content: '{"a":1}' })), { text: '{"a":1}', err: '' });
  assert.deepStrictEqual(openaiReplyText(c({ content: '' }, 'length')), { text: null, err: 'truncated' });
  assert.deepStrictEqual(openaiReplyText(c({ content: null, refusal: 'no' })), { text: null, err: 'blocked' });
  assert.deepStrictEqual(openaiReplyText(c({ content: 'x' }, 'content_filter')), { text: null, err: 'blocked' });
  assert.deepStrictEqual(openaiReplyText(c({ content: null })), { text: null, err: 'shape' });
  assert.deepStrictEqual(openaiReplyText({ choices: [] }), { text: null, err: 'shape' });
  assert.deepStrictEqual(openaiReplyText('x'), { text: null, err: 'shape' });
});

test('gemini through makeProvider is the same as geminiProvider (name, key header, schema untouched)', async () => {
  const { prov, seen } = rig('gemini', 'gemini-3.6-flash', [json({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }] })]);
  assert.equal(prov.name, 'gemini');
  await go(prov);
  assert.equal(seen[0].init.headers['x-goog-api-key'], KEY);
  assert.deepStrictEqual(JSON.parse(seen[0].init.body).generationConfig.responseSchema, SCHEMA, 'Gemini keeps its own dialect');
  assert.equal(typeof geminiProvider, 'function');
  assert.equal(geminiProvider(KEY, 'm', { fetch: async () => json({}) }).name, 'gemini');
});

for (const [kind, model] of [['claude', 'claude-sonnet-5-5'], ['openai', 'gpt-5-mini']]) {
  test(`${kind}: errors become codes — 401/403 auth, 400/404 http, 429 quota after two retries (2 s then 4 s), 5xx http, time-out, network, broken JSON`, async () => {
    for (const [st, code] of [[401, 'auth'], [403, 'auth'], [400, 'http'], [404, 'http']]) {
      const { prov, seen, sleeps } = rig(kind, model, [json({ error: { message: `echo ${KEY}` } }, st)]);
      const r = await go(prov);
      assert.deepStrictEqual(r, { raw: null, err: code }, String(st));
      assert.equal(seen.length, 1, 'no retry'); assert.equal(sleeps.length, 0);
      assert.ok(keyFree(r), 'a reply that echoes the key never reaches the result');
    }
    const q = rig(kind, model, [json({}, 429)]);
    assert.deepStrictEqual(await go(q.prov), { raw: null, err: 'quota' });
    assert.equal(q.seen.length, 3); assert.deepStrictEqual(q.sleeps, [2000, 4000]);
    const s = rig(kind, model, [json({}, 529), json({}, 503), json({}, 500)]);
    assert.deepStrictEqual(await go(s.prov), { raw: null, err: 'http' });
    assert.equal(s.seen.length, 3);
    const n = rig(kind, model, [new TypeError(`fetch failed ${KEY}`)], { retries: 0 });
    assert.deepStrictEqual(await go(n.prov), { raw: null, err: 'network' });
    const j = rig(kind, model, [new Response('<html>', { status: 200 })]);
    assert.deepStrictEqual(await go(j.prov), { raw: null, err: 'json' });
    const t = rig(kind, model, [(async () => { const e = new Error('aborted'); e.name = 'AbortError'; return e; })()], { retries: 0 }).prov;
    assert.ok(['network', 'timeout'].includes((await go(t)).err));
  });

  test(`${kind}: the time limit aborts the request and answers timeout`, async () => {
    const doFetch = (url, init) => new Promise((_, rej) => { init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))); });
    const prov = makeProvider(kind, KEY, model, { fetch: doFetch, timeoutMs: 20, retries: 0 });
    assert.deepStrictEqual(await go(prov), { raw: null, err: 'timeout' });
  });

  test(`${kind}: the key is not in the provider object, its call source, the console, or the codes`, async () => {
    const logs = [];
    const keep = {};
    for (const m of ['log', 'info', 'warn', 'error', 'debug']) { keep[m] = console[m]; console[m] = (...a) => logs.push(a); }
    try {
      const { prov } = rig(kind, model, [json({ error: { message: KEY } }, 401), json({}, 500)]);
      await go(prov);
      assert.deepStrictEqual(Object.keys(prov).sort(), ['call', 'model', 'name']);
      assert.equal(prov.name, kind);
      assert.ok(keyFree(prov));
      assert.ok(!String(prov.call).includes(KEY));
    } finally { Object.assign(console, keep); }
    assert.deepStrictEqual(logs, [], 'nothing is written to the console');
  });
}

test('construction errors carry codes, never the key', () => {
  const fail = (f) => { try { f(); } catch (e) { return e; } return null; };
  for (const kind of ['', 'none', 'grok', 'constructor', '__proto__', null, 3]) assert.equal(fail(() => makeProvider(kind, KEY, 'm')).code, 'badkind', String(kind));
  for (const kind of KINDS) {
    assert.equal(fail(() => makeProvider(kind, '   ', 'm')).code, 'nokey');
    assert.equal(fail(() => makeProvider(kind, undefined, 'm')).code, 'nokey');
    const e = fail(() => makeProvider(kind, KEY, 'bad model/../x'));
    assert.equal(e.code, 'badmodel');
    assert.ok(!e.message.includes(KEY));
  }
});

test('toJsonSchema: types lower-cased all the way down, Gemini-only words dropped, the input untouched', () => {
  const src = { type: 'OBJECT', propertyOrdering: ['a'], properties: { a: { type: 'STRING', enum: ['x', 'none'], nullable: true }, b: { type: 'ARRAY', items: { type: 'OBJECT', properties: { c: { type: 'INTEGER' } } } } }, required: ['a'] };
  const before = JSON.stringify(src);
  assert.deepStrictEqual(toJsonSchema(src), { type: 'object', properties: { a: { type: 'string', enum: ['x', 'none'] }, b: { type: 'array', items: { type: 'object', properties: { c: { type: 'integer' } } } } }, required: ['a'] });
  assert.equal(JSON.stringify(src), before);
  assert.equal(toJsonSchema(null), null);
});
