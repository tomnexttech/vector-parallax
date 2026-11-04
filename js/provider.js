/* provider — 閲覧者ご自身の鍵（BYOK）で Gemini を呼ぶ層。parallax/ai.py の GeminiProvider と同じ約束（docs/CONTRACT-public.md §4.5）。
 *
 *   geminiProvider(key, model) -> { name, model, call(system, userText, schema, extra?) -> Promise<{ raw, err }> }
 *
 * - 鍵はこの関数の閉じた変数にだけ置く。返す物にも、URL にも、エラーの文にも、ログにも出さない。送るのは見出し x-goog-api-key だけ。
 * - 失敗は例外にせず { raw: null, err: <符号> } で返す。符号は ai.py と同じ: nokey auth quota blocked truncated http timeout network json shape
 *   （利用者に見せる文は data/prompt.json の error_messages）。
 * - やり直しは HTTP 429・5xx・通信の失敗・時間切れだけ。2 回まで、2 秒 → 4 秒と倍に待つ。401/403・形の崩れ・遮断・途切れは変わらないので直ちに返す。
 * - generationConfig.maxOutputTokens を必ず入れる（既定 16384。call の 4 つ目の引数 extra.maxOutputTokens で data/prompt.json の値に合わせられる）。
 * - 返答の本文は決して符号に混ぜない（Google の誤りの文が鍵の一部を含むことがあるため）。
 *
 * 試験のために geminiProvider の 3 つ目の引数で fetch・sleep・時間切れ・やり直しの回数を差し替えられる（頁は 2 つしか渡さない）。 */

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
export const MODEL_RE = /^[A-Za-z0-9._-]{1,80}$/;
export const DEFAULT_MAX_OUTPUT_TOKENS = 16384;
export const RETRIES = 2;
export const BACKOFF_BASE_MS = 2000;
export const DEFAULT_TIMEOUT_MS = 90000;
const BLOCKED_FINISH = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

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

/**
 * key: 閲覧者の鍵。model: 模型名（英数と . _ - だけ）。
 * opts（試験用）: { fetch, sleep(ms), timeoutMs, retries, maxOutputTokens }
 * 鍵が空・模型名が不正なら、符号つきの Error（code: 'nokey' | 'badmodel'）を投げる。
 */
export function geminiProvider(key, model, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const secret = typeof key === 'string' ? key.trim() : '';
  if (!secret) throw codedError('nokey');
  if (typeof model !== 'string' || !MODEL_RE.test(model)) throw codedError('badmodel');
  const doFetch = typeof o.fetch === 'function' ? o.fetch : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const sleep = typeof o.sleep === 'function' ? o.sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : DEFAULT_TIMEOUT_MS;
  const retries = Number.isInteger(o.retries) && o.retries >= 0 ? Math.min(o.retries, RETRIES) : RETRIES;
  const defaultTokens = Number.isInteger(o.maxOutputTokens) && o.maxOutputTokens > 0 ? o.maxOutputTokens : DEFAULT_MAX_OUTPUT_TOKENS;
  const url = `${GEMINI_ENDPOINT}${encodeURIComponent(model)}:generateContent`;   // 鍵は URL に入れない

  async function once(system, userText, schema, maxTokens) {
    if (!doFetch) return { raw: null, err: 'network' };
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0, maxOutputTokens: maxTokens },
    });
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
    let res;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': secret },
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
    const { text: raw, err } = replyText(outer);
    return raw !== null ? { raw, err: '' } : { raw: null, err };
  }

  return {
    name: 'gemini',
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
