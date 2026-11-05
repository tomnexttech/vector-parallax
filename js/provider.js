/* provider — 閲覧者ご自身の鍵（BYOK）で AI を呼ぶ層。Gemini は parallax/ai.py の GeminiProvider と同じ約束（docs/CONTRACT-public.md §4.5）。
 * 提供元は Gemini・Claude（Anthropic Messages API）・OpenAI（Chat Completions）の三つ。ブラウザから各社へ直接呼ぶ。
 *
 *   makeProvider(kind, key, model, opts?) -> { name, model, call(system, userText, schema, extra?) -> Promise<{ raw, err }> }
 *   geminiProvider(key, model, opts?)      makeProvider('gemini', …) と同じ（これまでの名）
 *   toJsonSchema(schema)                   Gemini 流の schema（型が大文字）を JSON Schema に直す（Claude・OpenAI に渡す時）
 *
 * - 鍵はこの関数の閉じた変数にだけ置く。返す物にも、URL にも、エラーの文にも、ログにも出さない。送る先は選んだ提供元の見出し一つだけ
 *   （Gemini: x-goog-api-key ／ Claude: x-api-key ／ OpenAI: Authorization: Bearer）。
 * - 失敗は例外にせず { raw: null, err: <符号> } で返す。符号は ai.py と同じ: nokey auth quota blocked truncated http timeout network json shape
 *   （利用者に見せる文は data/prompt.json の error_messages）。
 * - やり直しは HTTP 429・5xx・通信の失敗・時間切れだけ。2 回まで、2 秒 → 4 秒と倍に待つ。401/403・形の崩れ・遮断・途切れは変わらないので直ちに返す。
 * - 出力の上限（Gemini: maxOutputTokens ／ Claude: max_tokens ／ OpenAI: max_completion_tokens）を必ず入れる（既定 16384。
 *   call の 4 つ目の引数 extra.maxOutputTokens で data/prompt.json の値に合わせられる）。
 * - 返答の本文は決して符号に混ぜない（各社の誤りの文が鍵の一部を含むことがあるため）。
 *
 * 試験のために makeProvider の 4 つ目の引数で fetch・sleep・時間切れ・やり直しの回数を差し替えられる（頁は 2 つしか渡さない）。 */

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
export const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const CLAUDE_VERSION = '2023-06-01';
export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const OPENAI_MIN_TOKENS = 1500;   // 推論する型は考える分も同じ枠から引く。短い返答でも枠が足りず空になるのを避ける
export const MODEL_RE = /^[A-Za-z0-9._-]{1,80}$/;
export const DEFAULT_MAX_OUTPUT_TOKENS = 16384;
export const RETRIES = 2;
export const BACKOFF_BASE_MS = 2000;
export const DEFAULT_TIMEOUT_MS = 90000;
const BLOCKED_FINISH = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

export const KINDS = ['gemini', 'claude', 'openai'];
/** 提供元の一覧。model は各社の今の型（見る人が変えられる）。models は候補（入力欄の補助だけ）。 */
export const PROVIDERS = {
  gemini: { ja: 'Gemini', model: 'gemini-3.6-flash', models: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'], host: 'generativelanguage.googleapis.com' },
  claude: { ja: 'Claude', model: 'claude-sonnet-5-5', models: ['claude-sonnet-5-5', 'claude-haiku-4-5'], host: 'api.anthropic.com' },
  openai: { ja: 'OpenAI', model: 'gpt-5-mini', models: ['gpt-5-mini', 'gpt-5-nano', 'gpt-5'], host: 'api.openai.com' },
};

function codedError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

/** Gemini の返答（JSON を読んだ物）から本文を取る。-> { text, err } */
export function replyText(outer) {
  if (outer === null || typeof outer !== 'object' || Array.isArray(outer)) return { text: null, err: 'shape' };
  const pf = outer.promptFeedback;
  if (pf && typeof pf === 'object' && pf.blockReason) return { text: null, err: 'blocked' };
  const cands = outer.candidates;
  if (!Array.isArray(cands) || !cands.length || cands[0] === null || typeof cands[0] !== 'object') return { text: null, err: 'shape' };
  const c = cands[0];
  const fr = typeof c.finishReason === 'string' ? c.finishReason : '';
  if (fr.startsWith('MAX_')) return { text: null, err: 'truncated' };
  if (BLOCKED_FINISH.has(fr)) return { text: null, err: 'blocked' };
  const parts = c.content && typeof c.content === 'object' ? c.content.parts : null;
  if (!Array.isArray(parts)) return { text: null, err: 'shape' };
  const text = parts
    .filter((p) => p && typeof p === 'object' && typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  if (!text.trim()) return { text: null, err: 'shape' };
  return { text, err: '' };
}

/** Gemini 流の schema（type が OBJECT・STRING …）を JSON Schema に直す。nullable・propertyOrdering は落とす。 */
export function toJsonSchema(s) {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (s === null || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'nullable' || k === 'propertyOrdering') continue;
    if (k === 'type' && typeof v === 'string') out.type = v.toLowerCase();
    else if (k === 'properties' && v && typeof v === 'object') out.properties = Object.fromEntries(Object.entries(v).map(([n, x]) => [n, toJsonSchema(x)]));
    else if (k === 'items') out.items = toJsonSchema(v);
    else out[k] = v;
  }
  return out;
}

/** Claude の返答（Messages API）から本文を取る。schema を渡した時は強制した道具 reply の入力（JSON）が本文。-> { text, err } */
export function claudeReplyText(outer) {
  if (outer === null || typeof outer !== 'object' || Array.isArray(outer)) return { text: null, err: 'shape' };
  if (outer.stop_reason === 'max_tokens') return { text: null, err: 'truncated' };
  if (outer.stop_reason === 'refusal') return { text: null, err: 'blocked' };
  if (!Array.isArray(outer.content)) return { text: null, err: 'shape' };
  const use = outer.content.find((b) => b && typeof b === 'object' && b.type === 'tool_use' && b.input !== null && typeof b.input === 'object');
  if (use) return { text: JSON.stringify(use.input), err: '' };
  const text = outer.content.filter((b) => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
  return text.trim() ? { text, err: '' } : { text: null, err: 'shape' };
}

/** OpenAI の返答（Chat Completions）から本文を取る。-> { text, err } */
export function openaiReplyText(outer) {
  if (outer === null || typeof outer !== 'object' || Array.isArray(outer)) return { text: null, err: 'shape' };
  const c = Array.isArray(outer.choices) ? outer.choices[0] : null;
  if (c === null || c === undefined || typeof c !== 'object') return { text: null, err: 'shape' };
  const m = c.message && typeof c.message === 'object' ? c.message : null;
  if (!m) return { text: null, err: 'shape' };
  if (typeof m.refusal === 'string' && m.refusal.trim()) return { text: null, err: 'blocked' };
  if (c.finish_reason === 'length') return { text: null, err: 'truncated' };
  if (c.finish_reason === 'content_filter') return { text: null, err: 'blocked' };
  return typeof m.content === 'string' && m.content.trim() ? { text: m.content, err: '' } : { text: null, err: 'shape' };
}

/** 提供元ごとの要求の形。どれも鍵は headers にだけ入れ、URL にも body にも入れない。 */
const SPECS = {
  gemini: {
    url: (model) => `${GEMINI_ENDPOINT}${encodeURIComponent(model)}:generateContent`,
    headers: (secret) => ({ 'content-type': 'application/json', 'x-goog-api-key': secret }),
    body: (model, system, userText, schema, maxTokens) => ({
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0, maxOutputTokens: maxTokens },
    }),
    read: replyText,
  },
  claude: {
    url: () => CLAUDE_ENDPOINT,
    headers: (secret) => ({
      'content-type': 'application/json', 'x-api-key': secret, 'anthropic-version': CLAUDE_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',   // ブラウザから直接呼ぶ時に Anthropic が求める印
    }),
    body: (model, system, userText, schema, maxTokens) => {
      const b = { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: userText }] };
      if (schema) {
        b.tools = [{ name: 'reply', description: 'Return the answer as this JSON object.', input_schema: toJsonSchema(schema) }];
        b.tool_choice = { type: 'tool', name: 'reply' };
      }
      return b;
    },
    read: claudeReplyText,
  },
  openai: {
    url: () => OPENAI_ENDPOINT,
    headers: (secret) => ({ 'content-type': 'application/json', authorization: `Bearer ${secret}` }),
    body: (model, system, userText, schema, maxTokens) => {
      const b = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: userText }], max_completion_tokens: Math.max(maxTokens, OPENAI_MIN_TOKENS) };
      if (schema) b.response_format = { type: 'json_schema', json_schema: { name: 'reply', schema: toJsonSchema(schema), strict: false } };
      return b;
    },
    read: openaiReplyText,
  },
};

/**
 * kind: 'gemini' | 'claude' | 'openai'。key: 閲覧者の鍵。model: 型の名（英数と . _ - だけ）。
 * opts（試験用）: { fetch, sleep(ms), timeoutMs, retries, maxOutputTokens }
 * 鍵が空・型の名が不正・提供元が不明なら、符号つきの Error（code: 'nokey' | 'badmodel' | 'badkind'）を投げる。
 */
export function makeProvider(kind, key, model, opts) {
  const spec = typeof kind === 'string' && Object.hasOwn(SPECS, kind) ? SPECS[kind] : null;
  if (!spec) throw codedError('badkind');
  const o = opts && typeof opts === 'object' ? opts : {};
  const secret = typeof key === 'string' ? key.trim() : '';
  if (!secret) throw codedError('nokey');
  if (typeof model !== 'string' || !MODEL_RE.test(model)) throw codedError('badmodel');
  const doFetch = typeof o.fetch === 'function' ? o.fetch : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const sleep = typeof o.sleep === 'function' ? o.sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : DEFAULT_TIMEOUT_MS;
  const retries = Number.isInteger(o.retries) && o.retries >= 0 ? Math.min(o.retries, RETRIES) : RETRIES;
  const defaultTokens = Number.isInteger(o.maxOutputTokens) && o.maxOutputTokens > 0 ? o.maxOutputTokens : DEFAULT_MAX_OUTPUT_TOKENS;
  const url = spec.url(model);   // 鍵は URL に入れない

  async function once(system, userText, schema, maxTokens) {
    if (!doFetch) return { raw: null, err: 'network' };
    const body = JSON.stringify(spec.body(model, system, userText, schema, maxTokens));
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
    let res;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: spec.headers(secret),
        body,
        signal: ac ? ac.signal : undefined,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch {
      if (timer) clearTimeout(timer);
      return { raw: null, err: ac && ac.signal.aborted ? 'timeout' : 'network' };
    }
    let status, text;
    try {
      status = res.status;
      text = await res.text();
    } catch {
      return { raw: null, err: ac && ac.signal.aborted ? 'timeout' : 'network' };
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (status === 401 || status === 403) return { raw: null, err: 'auth' };
    if (status === 429) return { raw: null, err: 'quota' };
    if (!(status >= 200 && status < 300)) return { raw: null, err: status >= 500 ? 'http5xx' : 'http' };
    let outer;
    try { outer = JSON.parse(text); } catch { return { raw: null, err: 'json' }; }
    const { text: raw, err } = spec.read(outer);
    return raw !== null ? { raw, err: '' } : { raw: null, err };
  }

  return {
    name: kind,
    model,
    async call(system, userText, schema, extra) {
      const t = extra && Number.isInteger(extra.maxOutputTokens) && extra.maxOutputTokens > 0 ? extra.maxOutputTokens : defaultTokens;
      let r = await once(system, userText, schema, t);
      for (let n = 0; n < retries; n++) {
        // やり直すのは 429（quota）・5xx・通信の失敗・時間切れだけ
        if (!(r.err === 'quota' || r.err === 'http5xx' || r.err === 'network' || r.err === 'timeout')) break;
        await sleep(BACKOFF_BASE_MS * (2 ** n));
        r = await once(system, userText, schema, t);
      }
      if (r.err === 'http5xx') r = { raw: null, err: 'http' };   // 符号は ai.py と同じ 'http' に畳む
      return r;
    },
  };
}

/** これまでの名。Gemini を呼ぶ。 */
export const geminiProvider = (key, model, opts) => makeProvider('gemini', key, model, opts);
