/* login — "log in and your own AI is connected": OpenRouter's OAuth with PKCE, written for a page with no server.
 * No DOM. The page sends the viewer to openrouter.ai, the viewer logs in there and allows the app, and OpenRouter sends the viewer back with a
 * one-time code. The page trades the code (with the secret it made before leaving) for an API key of the viewer's own, straight from the browser.
 * The key is kept in this browser (js/settings.js saveOwnAI) and goes to openrouter.ai only. Nothing goes to any server of this site.
 *
 *   beginLogin({ session, location, crypto, now }) -> Promise<{ url }>       makes the secret and the challenge, keeps the secret for this tab, returns where to go
 *   readReturn(search, session, now) -> null | { code, verifier, method } | { err }     what a page opened with ?code=… carries; err: 'state' | 'expired' | 'none'
 *   finishLogin(ret, fetchFn) -> Promise<{ key, err }>                       the code for the key; err: login | network | json | shape
 *   cleanedUrl(href) -> string                                               the address without code and state (what history.replaceState gets)
 *   clearPending(session)
 *
 * Conditions (docs/own-ai-login.md): the authorization URL takes callback_url, code_challenge, code_challenge_method (S256) and state; the code is
 * single use and expires in 10 minutes; POST https://openrouter.ai/api/v1/auth/keys with {code, code_verifier, code_challenge_method} answers {key};
 * the endpoint answers CORS for any origin (checked 2026-11-09). */

import { keyOk } from './settings.js';

export const AUTH_URL = 'https://openrouter.ai/auth';
export const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
export const PENDING_KEY = 'parallax.login.v1';
export const PENDING_MS = 10 * 60 * 1000;   // a code expires 10 minutes after it is issued; a secret kept longer than that is of no use

const b64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const rand = (c, n) => { const a = new Uint8Array(n); c.getRandomValues(a); return b64url(a); };

/** S256 when the browser can hash (every https page and localhost can); plain otherwise, which OpenRouter also takes */
async function challengeOf(verifier, c) {
  if (c && c.subtle && typeof c.subtle.digest === 'function') {
    const d = await c.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { challenge: b64url(new Uint8Array(d)), method: 'S256' };
  }
  return { challenge: verifier, method: 'plain' };
}

/** the page's own address without the query and the hash: where OpenRouter sends the viewer back */
export const callbackOf = (loc) => `${loc.origin}${loc.pathname}`;

export async function beginLogin({ session, location, crypto: c, now }) {
  if (!c || typeof c.getRandomValues !== 'function') throw Object.assign(new Error('nocrypto'), { code: 'network' });
  const verifier = rand(c, 48), state = rand(c, 18);
  const { challenge, method } = await challengeOf(verifier, c);
  const t = Number.isFinite(now) ? now : Date.now();
  try { session.setItem(PENDING_KEY, JSON.stringify({ v: verifier, m: method, s: state, at: t })); } catch { throw Object.assign(new Error('nostore'), { code: 'network' }); }
  const q = new URLSearchParams({ callback_url: callbackOf(location), code_challenge: challenge, code_challenge_method: method, state });
  return { url: `${AUTH_URL}?${q.toString()}` };
}

export function clearPending(session) { try { session.removeItem(PENDING_KEY); } catch { /* nothing kept */ } }

export function readReturn(search, session, now) {
  let q;
  try { q = new URLSearchParams(search || ''); } catch { return null; }
  const code = q.get('code');
  if (!code) return null;
  let p = null;
  try { p = JSON.parse(session.getItem(PENDING_KEY) || 'null'); } catch { p = null; }
  if (!p || typeof p !== 'object' || typeof p.v !== 'string' || typeof p.s !== 'string') return { err: 'none' };
  const t = Number.isFinite(now) ? now : Date.now();
  if (!(t - p.at <= PENDING_MS)) return { err: 'expired' };
  if (q.get('state') !== p.s) return { err: 'state' };
  if (!/^[\w.~-]{4,512}$/.test(code)) return { err: 'state' };
  return { code, verifier: p.v, method: p.m === 'plain' ? 'plain' : 'S256' };
}

export async function finishLogin(ret, fetchFn) {
  const f = typeof fetchFn === 'function' ? fetchFn : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!f || !ret || !ret.code) return { key: '', err: 'network' };
  let res, text;
  try {
    res = await f(EXCHANGE_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer',
      body: JSON.stringify({ code: ret.code, code_verifier: ret.verifier, code_challenge_method: ret.method }),
    });
    text = await res.text();
  } catch { return { key: '', err: 'network' }; }
  if (!(res.status >= 200 && res.status < 300)) return { key: '', err: res.status >= 500 ? 'network' : 'login' };
  let j;
  try { j = JSON.parse(text); } catch { return { key: '', err: 'json' }; }
  const key = j && typeof j === 'object' && typeof j.key === 'string' ? j.key.trim() : '';
  return keyOk(key) ? { key, err: '' } : { key: '', err: 'shape' };
}

export function cleanedUrl(href) {
  try {
    const u = new URL(href);
    u.searchParams.delete('code'); u.searchParams.delete('state');
    return u.pathname + (u.searchParams.size ? `?${u.searchParams.toString()}` : '') + u.hash;
  } catch { return '/'; }
}
