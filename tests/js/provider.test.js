// js/provider.js の試験。偽の fetch で、要求の形・鍵の扱い・やり直し（429/5xx/通信/時間切れだけ・2 回まで・2 秒→4 秒）・符号を確かめる。外へは何も送らない。
import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiProvider, replyText } from '../../js/provider.js';
import { PROMPT } from './helpers.js';

const KEY = 'AIza-TEST-KEY-' + 'k'.repeat(20);
const ok = (text) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200 });
const status = (n, body) => new Response(body === undefined ? '{}' : body, { status: n });

/** replies: Response か、投げる Error か、関数。呼びを seen に控える。 */
function rig(replies, extra) {
  const seen = [], sleeps = [];
  const doFetch = async (url, init) => {
    seen.push({ url, init });
    const r = replies[Math.min(seen.length - 1, replies.length - 1)];
    const v = typeof r === 'function' ? r(init) : r;
    if (v instanceof Error) throw v;
    return v instanceof Response ? v.clone() : v;                                  // 同じ返答を繰り返し返すので、本文は毎回新しい物にする
  };
  const prov = geminiProvider(KEY, 'gemini-3.6-flash', { fetch: doFetch, sleep: async (ms) => { sleeps.push(ms); }, ...extra });
  return { prov, seen, sleeps };
}
const go = (prov, extra) => prov.call('SYSTEM', 'USER TEXT', { type: 'OBJECT' }, extra);

test('the request: key in the x-goog-api-key header only, maxOutputTokens, systemInstruction, schema, temperature 0', async () => {
  const { prov, seen } = rig([ok('{"blocks":[]}')]);
  const r = await go(prov);
  assert.deepStrictEqual(r, { raw: '{"blocks":[]}', err: '' });
  assert.equal(seen.length, 1);
  const { url, init } = seen[0];
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-goog-api-key'], KEY);
  assert.equal(init.credentials, 'omit');
  assert.ok(!url.includes(KEY) && !init.body.includes(KEY), 'the key is not in the URL or the body');
  const body = JSON.parse(init.body);
  assert.deepStrictEqual(body.contents, [{ role: 'user', parts: [{ text: 'USER TEXT' }] }]);
  assert.deepStrictEqual(body.systemInstruction, { parts: [{ text: 'SYSTEM' }] });
  assert.deepStrictEqual(body.generationConfig, { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT' }, temperature: 0, maxOutputTokens: 16384 });
});

test('maxOutputTokens can follow data/prompt.json through the fourth argument', async () => {
  const { prov, seen } = rig([ok('{}')]);
  await go(prov, { maxOutputTokens: PROMPT.max_output_tokens });
  assert.equal(JSON.parse(seen[0].init.body).generationConfig.maxOutputTokens, PROMPT.max_output_tokens);
  const { prov: p2, seen: s2 } = rig([ok('{}')]);
  await go(p2, { maxOutputTokens: -5 });
  assert.equal(JSON.parse(s2[0].init.body).generationConfig.maxOutputTokens, 16384, 'a bad value falls back to the default');
});

test('the provider object holds no key: only name, model and call', async () => {
  const { prov } = rig([ok('{}')]);
  assert.deepStrictEqual(Object.keys(prov).sort(), ['call', 'model', 'name']);
  assert.equal(prov.name, 'gemini');
  assert.equal(prov.model, 'gemini-3.6-flash');
  assert.ok(!JSON.stringify(prov).includes(KEY));
  assert.ok(!String(prov.call).includes(KEY));
});

test('429 twice then 200: succeeds after waiting 2 s then 4 s', async () => {
  const { prov, seen, sleeps } = rig([status(429), status(429), ok('{"blocks":[]}')]);
  const r = await go(prov);
  assert.deepStrictEqual(r, { raw: '{"blocks":[]}', err: '' });
  assert.equal(seen.length, 3);
  assert.deepStrictEqual(sleeps, [2000, 4000]);
});

test('429 every time: stops after two retries with the code quota', async () => {
  const { prov, seen, sleeps } = rig([status(429)]);
  const r = await go(prov);
  assert.deepStrictEqual(r, { raw: null, err: 'quota' });
  assert.equal(seen.length, 3, 'one try and two retries');
  assert.deepStrictEqual(sleeps, [2000, 4000]);
});

test('5xx is retried and then reported as http', async () => {
  const a = rig([status(503), ok('{}')]);
  assert.deepStrictEqual(await go(a.prov), { raw: '{}', err: '' });
  assert.deepStrictEqual(a.sleeps, [2000]);
  const b = rig([status(500)]);
  assert.deepStrictEqual(await go(b.prov), { raw: null, err: 'http' });
  assert.equal(b.seen.length, 3);
});

test('not retried: 401/403 (auth), 400/404 (http)', async () => {
  for (const [code, err] of [[401, 'auth'], [403, 'auth'], [400, 'http'], [404, 'http']]) {
    const { prov, seen, sleeps } = rig([status(code)]);
    assert.deepStrictEqual(await go(prov), { raw: null, err }, String(code));
    assert.equal(seen.length, 1, 'one try only for ' + code);
    assert.deepStrictEqual(sleeps, []);
  }
});

test('a network failure is retried, then reported as network', async () => {
  const a = rig([new TypeError('fetch failed'), ok('{}')]);
  assert.deepStrictEqual(await go(a.prov), { raw: '{}', err: '' });
  const b = rig([new TypeError('fetch failed')]);
  assert.deepStrictEqual(await go(b.prov), { raw: null, err: 'network' });
  assert.equal(b.seen.length, 3);
  assert.deepStrictEqual(b.sleeps, [2000, 4000]);
});

test('a call that never answers is cut at timeoutMs and reported as timeout (retried like a network failure)', async () => {
  const hang = (init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const { prov, seen, sleeps } = rig([hang], { timeoutMs: 15 });
  assert.deepStrictEqual(await go(prov), { raw: null, err: 'timeout' });
  assert.equal(seen.length, 3);
  assert.deepStrictEqual(sleeps, [2000, 4000]);
});

test('replies that will not change are not retried: truncated, blocked, shape, json', async () => {
  const env = (o) => new Response(JSON.stringify(o), { status: 200 });
  const cases = [
    ['truncated', env({ candidates: [{ content: { parts: [{ text: '{"bl' }] }, finishReason: 'MAX_TOKENS' }] })],
    ['blocked', env({ candidates: [{ finishReason: 'SAFETY' }] })],
    ['blocked', env({ promptFeedback: { blockReason: 'OTHER' } })],
    ['shape', env({ candidates: [] })],
    ['shape', env({ candidates: [{ content: { parts: [{ text: '   ' }] }, finishReason: 'STOP' }] })],
    ['shape', env([])],
    ['json', new Response('<html>not json</html>', { status: 200 })],
  ];
  for (const [err, res] of cases) {
    const { prov, seen, sleeps } = rig([res]);
    assert.deepStrictEqual(await go(prov), { raw: null, err }, err);
    assert.equal(seen.length, 1);
    assert.deepStrictEqual(sleeps, []);
  }
});

test('thought parts are skipped; text parts are joined', () => {
  const r = replyText({ candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: '{"a":' }, { text: '1}' }] }, finishReason: 'STOP' }] });
  assert.deepStrictEqual(r, { text: '{"a":1}', err: '' });
});

test("the server's error text, even one that echoes the key, never reaches the result", async () => {
  const { prov } = rig([status(400, JSON.stringify({ error: { message: 'API key not valid: ' + KEY } }))]);
  const r = await go(prov);
  assert.deepStrictEqual(r, { raw: null, err: 'http' });
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test('no key / bad model name throw a coded error before anything is sent', () => {
  for (const k of ['', '   ', undefined, null, 5]) assert.throws(() => geminiProvider(k, 'gemini-3.6-flash'), { code: 'nokey' });
  for (const m of ['', 'a/b', 'models/x:generate', '../x', 'a b', 'x'.repeat(81), undefined]) {
    assert.throws(() => geminiProvider(KEY, m), { code: 'badmodel' }, String(m));
  }
  assert.doesNotThrow(() => geminiProvider(KEY, 'gemini-3.6-flash'));
  try { geminiProvider('', 'x'); } catch (e) { assert.ok(!String(e.message).includes(KEY)); }
});

test('the error codes the provider can return are the ones data/prompt.json has messages for', async () => {
  const codes = new Set(['auth', 'quota', 'http', 'network', 'timeout', 'json', 'shape', 'blocked', 'truncated']);
  for (const c of codes) assert.ok(PROMPT.error_messages[c] && PROMPT.error_messages[c].ja && PROMPT.error_messages[c].en, c);
});
