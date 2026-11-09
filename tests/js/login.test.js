// js/login.js (OpenRouter's login with PKCE, on a page with no server) and the OpenRouter provider. A fake fetch and a fake storage only: no real login, no key, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beginLogin, readReturn, finishLogin, cleanedUrl, clearPending, callbackOf, AUTH_URL, EXCHANGE_URL, PENDING_KEY, PENDING_MS } from '../../js/login.js';
import { makeProvider, PROVIDERS, OPENROUTER_ENDPOINT, modelRe, openrouterReplyText } from '../../js/provider.js';
import { cleanOwnAI, activeOwnAI, saveOwnAI, loadOwnAI, OWN_AI_KEY, modelOk, keyOk } from '../../js/settings.js';
import { askOwnAI, errJa } from '../../js/ownai.js';
import { ROOT } from './helpers.js';

const KEY = 'sk-or-v1-test-not-real-0123456789abcdef';
const mem = (init) => { const m = new Map(Object.entries(init || {})); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, dump: () => Object.fromEntries(m) }; };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
const LOC = { origin: 'https://tomnexttech.github.io', pathname: '/vector-parallax/' };
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('beginLogin: the address goes to openrouter.ai with this page as the way back, an S256 challenge of the secret kept for this tab, and a state', async () => {
  const ss = mem();
  const { url } = await beginLogin({ session: ss, location: LOC, crypto: webcrypto, now: 5000 });
  const u = new URL(url);
  assert.equal(`${u.origin}${u.pathname}`, AUTH_URL);
  assert.equal(u.searchParams.get('callback_url'), 'https://tomnexttech.github.io/vector-parallax/');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  const p = JSON.parse(ss.getItem(PENDING_KEY));
  assert.equal(u.searchParams.get('code_challenge'), b64url(createHash('sha256').update(p.v).digest()));
  assert.equal(u.searchParams.get('state'), p.s);
  assert.ok(p.v.length >= 43 && !url.includes(p.v), 'the secret never goes in the address');
  assert.equal(callbackOf({ origin: 'http://127.0.0.1:8997', pathname: '/index.html' }), 'http://127.0.0.1:8997/index.html');
  // no hashing in this browser: plain, which OpenRouter also takes
  const plain = mem();
  const r = await beginLogin({ session: plain, location: LOC, crypto: { getRandomValues: (a) => webcrypto.getRandomValues(a) }, now: 1 });
  assert.equal(new URL(r.url).searchParams.get('code_challenge_method'), 'plain');
  await assert.rejects(() => beginLogin({ session: mem(), location: LOC, crypto: null }), (e) => e.code === 'network');
  const full = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  await assert.rejects(() => beginLogin({ session: full, location: LOC, crypto: webcrypto }), (e) => e.code === 'network');
});

test('readReturn: a code with the right state in time is accepted; a wrong state, an old secret, no secret and no code are told apart', async () => {
  const ss = mem();
  await beginLogin({ session: ss, location: LOC, crypto: webcrypto, now: 1000 });
  const p = JSON.parse(ss.getItem(PENDING_KEY));
  const ok = readReturn(`?code=abc123XYZ&state=${p.s}`, ss, 1000 + 60000);
  assert.deepStrictEqual(ok, { code: 'abc123XYZ', verifier: p.v, method: 'S256' });
  assert.deepStrictEqual(readReturn(`?code=abc123XYZ&state=other`, ss, 2000), { err: 'state' });
  assert.deepStrictEqual(readReturn(`?code=abc123XYZ`, ss, 2000), { err: 'state' });
  assert.deepStrictEqual(readReturn(`?code=abc123XYZ&state=${p.s}`, ss, 1000 + PENDING_MS + 1), { err: 'expired' });
  assert.deepStrictEqual(readReturn(`?code=bad code&state=${p.s}`, ss, 2000), { err: 'state' });
  assert.equal(readReturn('?data=x', ss, 2000), null);
  assert.equal(readReturn('', ss, 2000), null);
  clearPending(ss);
  assert.deepStrictEqual(readReturn(`?code=abc123XYZ&state=${p.s}`, ss, 2000), { err: 'none' });
  assert.deepStrictEqual(readReturn('?code=abc123XYZ', mem({ [PENDING_KEY]: 'not json' }), 2000), { err: 'none' });
});

test('finishLogin: the code and the secret go to the key endpoint by POST, not in the address; the key comes back; every failure has a code and none carries a key', async () => {
  const seen = [];
  const f = (res) => async (url, init) => { seen.push({ url, init }); if (res instanceof Error) throw res; return res.clone(); };
  const ret = { code: 'abc123XYZ', verifier: 'v'.repeat(60), method: 'S256' };
  const r = await finishLogin(ret, f(json({ key: KEY })));
  assert.deepStrictEqual(r, { key: KEY, err: '' });
  assert.equal(seen[0].url, EXCHANGE_URL);
  assert.equal(seen[0].init.method, 'POST');
  assert.deepStrictEqual(JSON.parse(seen[0].init.body), { code: 'abc123XYZ', code_verifier: 'v'.repeat(60), code_challenge_method: 'S256' });
  assert.ok(!seen[0].url.includes('abc123XYZ') && seen[0].init.credentials === 'omit' && seen[0].init.referrerPolicy === 'no-referrer');
  assert.deepStrictEqual(await finishLogin(ret, f(json({ error: { message: `no ${KEY}` } }, 403))), { key: '', err: 'login' });
  assert.deepStrictEqual(await finishLogin(ret, f(json({}, 500))), { key: '', err: 'network' });
  assert.deepStrictEqual(await finishLogin(ret, f(new Error('offline'))), { key: '', err: 'network' });
  assert.deepStrictEqual(await finishLogin(ret, f(new Response('<html>', { status: 200 }))), { key: '', err: 'json' });
  assert.deepStrictEqual(await finishLogin(ret, f(json({ key: 'has space in it' }))), { key: '', err: 'shape' });
  assert.deepStrictEqual(await finishLogin(ret, f(json({ nokey: 1 }))), { key: '', err: 'shape' });
  assert.deepStrictEqual(await finishLogin(null, f(json({ key: KEY }))), { key: '', err: 'network' });
  for (const c of ['login', 'state', 'expired', 'none']) assert.ok(errJa(c) && errJa(c) !== errJa('zzz'), c);
});

test('cleanedUrl: the code and the state go, the rest of the address stays', () => {
  assert.equal(cleanedUrl('https://x.io/p/?code=abc&state=zz'), '/p/');
  assert.equal(cleanedUrl('https://x.io/p/index.html?data=work/a.json&code=abc&state=zz#home'), '/p/index.html?data=work%2Fa.json#home');
  assert.equal(cleanedUrl('nonsense'), '/');
});

test('the whole way, with a fake OpenRouter: log in, come back, trade the code, keep the key in this browser, ask — the key is only ever in the Authorization header to openrouter.ai', async () => {
  const session = mem(), local = mem();
  const { url } = await beginLogin({ session, location: LOC, crypto: webcrypto, now: 1000 });
  const state = new URL(url).searchParams.get('state');
  const ret = readReturn(`?code=onetimecode1&state=${state}`, session, 2000);
  const exchange = await finishLogin(ret, async () => json({ key: KEY }));
  const c = cleanOwnAI(null); c.kind = 'openrouter'; c.keys.openrouter = exchange.key;
  assert.equal(saveOwnAI(local, c), true);
  const a = activeOwnAI(loadOwnAI(local));
  assert.deepStrictEqual([a.kind, a.ja, a.model], ['openrouter', 'OpenRouter', PROVIDERS.openrouter.model]);
  const seen = [];
  const prov = makeProvider(a.kind, a.key, a.model, { fetch: async (u, init) => { seen.push({ u, init }); return json({ choices: [{ finish_reason: 'stop', message: { content: '{"lines":["a","b","c"]}' } }] }); }, sleep: async () => {} });
  const r = await askOwnAI(prov, { heading: '見出し', items: [{ outlet: 'X', title: 'T のとても長い見出し', desc: '' }] }, { mode: 'brief' });
  assert.deepStrictEqual(r.lines, ['a', 'b', 'c']);
  assert.equal(seen[0].u, OPENROUTER_ENDPOINT);
  assert.equal(seen[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.ok(!seen[0].u.includes(KEY) && !seen[0].init.body.includes(KEY) && !JSON.stringify(r).includes(KEY));
  assert.ok(!JSON.stringify(Object.keys(prov)).includes(KEY) && !prov.call.toString().includes(KEY));
  // the key is not in the settings file, and a copy of the page's session has none either
  assert.ok(!Object.values(session.dump()).some((v) => v.includes(KEY)));
  assert.ok(Object.keys(local.dump()).every((k) => k === OWN_AI_KEY));
});

test('the OpenRouter provider: Bearer in the header only, the model in the body (a "/" name is fine there), a floor on the ceiling, a schema for the answer, 402 is quota', async () => {
  const seen = [];
  const mk = (res) => makeProvider('openrouter', KEY, 'anthropic/claude-haiku-5.5', { fetch: async (u, init) => { seen.push({ u, init }); return res.clone(); }, sleep: async () => {}, retries: 0 });
  const ok = json({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] });
  const p = mk(ok);
  assert.deepStrictEqual(await p.call('SYS', 'USER', { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } } }, { maxOutputTokens: 32 }), { raw: '{"ok":true}', err: '' });
  const body = JSON.parse(seen[0].init.body);
  assert.equal(seen[0].u, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(body.model, 'anthropic/claude-haiku-5.5');
  assert.ok(body.max_tokens >= 600);
  assert.deepStrictEqual(body.messages.map((m) => m.role), ['system', 'user']);
  assert.equal(body.response_format.json_schema.schema.type, 'object');
  assert.ok(!('temperature' in body));
  assert.ok(!seen[0].u.includes(KEY) && !seen[0].init.body.includes(KEY));
  assert.equal(seen[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.deepStrictEqual((await mk(json({}, 402)).call('s', 'u', null)), { raw: null, err: 'quota' });
  assert.deepStrictEqual((await mk(json({}, 401)).call('s', 'u', null)), { raw: null, err: 'auth' });
  // OpenRouter may answer 200 with an error inside
  assert.deepStrictEqual(openrouterReplyText({ error: { code: 402, message: 'credits' } }), { text: null, err: 'quota' });
  assert.deepStrictEqual(openrouterReplyText({ error: { code: 401 } }), { text: null, err: 'auth' });
  assert.deepStrictEqual(openrouterReplyText({ error: { code: 429 } }), { text: null, err: 'quota' });
  assert.deepStrictEqual(openrouterReplyText({ error: { code: 500 } }), { text: null, err: 'shape' });
  assert.equal(openrouterReplyText({ choices: [{ finish_reason: 'stop', message: { content: 'x' } }] }).text, 'x');
});

test('model names: OpenRouter may use "/" and ":"; the other providers may not; the key shape is the same for all', () => {
  for (const m of ['anthropic/claude-haiku-5.5', 'meta-llama/x:free', 'openrouter/free']) assert.ok(modelRe('openrouter').test(m) && modelOk(m, 'openrouter'), m);
  for (const m of ['a b', 'x<y', '', 'a'.repeat(101)]) assert.ok(!modelRe('openrouter').test(m), m);
  assert.ok(!modelOk('a/b', 'claude') && !modelOk('a/b') && !modelOk('x:y', 'openai'));
  const c = cleanOwnAI({ kind: 'openrouter', keys: { openrouter: KEY, claude: KEY }, models: { openrouter: 'anthropic/claude-sonnet-5.5', claude: 'a/b' } });
  assert.equal(c.kind, 'openrouter'); assert.equal(c.models.openrouter, 'anthropic/claude-sonnet-5.5'); assert.equal(c.models.claude, '');
  assert.ok(keyOk(KEY));
  assert.equal(activeOwnAI({ ...c, keys: { ...c.keys, openrouter: '' } }), null, 'chosen but no key: nothing is active');
});

test('the page: the connect-src allows openrouter.ai, the top bar has the entry and the window, the service worker keeps the new files', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)[1];
  assert.ok(/connect-src [^;]*https:\/\/openrouter\.ai(\s|;|$)/.test(csp));
  assert.ok(html.includes('id="own-btn"') && html.includes('id="own-layer"') && html.includes('aria-labelledby="own-title"'));
  const sw = readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  for (const f of ['js/slim.js', 'js/login.js', 'js/connect.js']) assert.ok(sw.includes(`'${f}'`), f);
  // the page imports what it needs and calls nothing else on the network for the login
  const app = readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  for (const f of ['./login.js', './connect.js', './slim.js']) assert.ok(app.includes(f), f);
  assert.ok(!/localStorage\.setItem\([^)]*code/.test(app));
});
