# Connecting the viewer's own AI: login with OpenRouter, the key, and the cut in tokens (decided 2026-11-09)

Author's order (2026-11-09): "when a viewer logs in, they can connect to their own AI, as a normal feature; and cut the number of tokens with an algorithm." The page is static (GitHub Pages): no server, no database, nothing of the viewer's is kept anywhere but their own browser.

## 1. The method taken: OpenRouter OAuth with PKCE

A viewer presses **OpenRouter でログイン** (top bar button, the row under an event, the 比べる screen, 設定 > 自分の AI). The page leaves for `https://openrouter.ai/auth`, the viewer logs in there and allows the app, OpenRouter sends the viewer back to this page with `?code=…`, and the page trades the code for an API key of the viewer's own. Claude, GPT, Gemini and others are then chosen by model name (default `anthropic/claude-haiku-5.5`; suggestions in `js/provider.js`).

| Step | What is sent | Where |
|---|---|---|
| 1 | `callback_url` (this page's own address, no query, no hash), `code_challenge` (SHA-256 of a random secret, base64url), `code_challenge_method=S256`, `state` (random) | browser → `https://openrouter.ai/auth` (a navigation) |
| 2 | the page keeps `{secret, method, state, time}` in `sessionStorage` (this tab only, `parallax.login.v1`) | this browser |
| 3 | OpenRouter redirects back with `?code=…&state=…` | `js/login.js readReturn` accepts it only if the state matches and the secret is under 10 minutes old; the address is cleaned at once (`history.replaceState`) |
| 4 | `POST https://openrouter.ai/api/v1/auth/keys` with `{code, code_verifier, code_challenge_method}` → `{key}` | browser → OpenRouter; no credentials, no referrer |
| 5 | the key is kept in `localStorage` `parallax.ownai.v1` (`js/settings.js`), apart from the settings file | this browser |

Conditions, from the sources read on 2026-11-09:

- **Terms of the flow** (OpenRouter docs, "OAuth PKCE", `openrouter.ai/docs/guides/overview/auth/oauth`): `code_challenge` is recommended; `S256` or `plain`; `state` is returned unchanged for CSRF protection (not returned on denial); the code is single use and expires 10 minutes after issue; localhost callbacks work on any port (they are not listed in the marketplace); the docs do not say whether `https` is required for the callback; the docs do not give the key's lifetime, rate limits or spending limits. Nothing in the docs sets a limit on the key made by the login, so none is assumed here.
- **CORS** (the docs do not address it; **checked by hand on 2026-11-09** with an `OPTIONS` preflight from `Origin: https://tomnexttech.github.io`): `/api/v1/auth/keys` and `/api/v1/chat/completions` both answer `204` with `Access-Control-Allow-Origin: *`, allowing `Authorization` and `Content-Type`; `/api/v1/models` answers `Access-Control-Allow-Origin: *`. The page therefore calls OpenRouter straight from the browser. If OpenRouter ever changes this, the login shows "network" and the paste-a-key path still works.
- **Price** (public model list `openrouter.ai/api/v1/models`, 2026-11-09, dollars per million tokens, input / output): `anthropic/claude-haiku-5.5` 0.1 / 0.5 (the default), `openai/gpt-6-luna` 0.1 / 0.5, `google/gemini-3.5-flash-lite` 0.3 / 2.5, `anthropic/claude-sonnet-5.5` 2.0 / 10.0, `openrouter/free` 0 / 0. All five support `response_format` and structured outputs. The viewer pays from their own OpenRouter balance; this site is paid nothing and sees nothing.
- **Free models** (OpenRouter docs, "Limits"): `:free` models are 20 requests a minute; 50 a day with fewer than 10 credits ever bought, 1000 a day with 10 or more. The docs do not mention keys made by OAuth.
- **The key**: printable ASCII, 8 to 400 characters (`keyOk`). It is in the browser only: in `localStorage`, in the closed variable of the provider object, and in one `Authorization: Bearer` header to `openrouter.ai`. It is never in a URL, a body, the settings export, the console, an error text or a test output (tests/js/login.test.js holds each of these). "接続を外す" removes it from the browser and clears the cache of answers; the key stays valid at OpenRouter until the viewer revokes it in their OpenRouter settings, and the window says so.
- **Without a key, nothing changes.** A judge who opens the page with no account sees the same board, the same AI summaries from the build, and a quiet button "自分の AI につなぐ". The viewer's own AI is optional.
- **Kept as they were**: pasting a Gemini, Claude or OpenAI key (設定 > 自分の AI). They are the same code path (`makeProvider(kind, key, model)`), one key and one model per provider.
- **Not checked**: whether Google, Anthropic or OpenAI offer a sign-in that hands a browser a key. They were not read for this; the paste-a-key path stays for them.

`index.html` connect-src allows `https://openrouter.ai` (and the three vendors as before). The login navigation is a top-level navigation and needs no CSP entry.

## 2. What the connected AI does

Under an event (詳しく見る, and 比べる): **要約** (what happened, the course, what comes next, three lines), **違いを見る** (how the outlets worded it, three lines), and a question box (**質問** → **聞く**, one to four lines). The material is only what the page shows: the headlines as published and the feed's own description (CONTRACT 14.1). The page's own AI lines, links, times and photos are not sent. The instruction forbids judging true or false and calling an outlet left or right. The answer is shown with the AI mark, the provider, the model, the time and the note that the AI can be wrong. In データと AI, **実行** runs the whole bundling again with the connected AI (any provider), the same code as with a Gemini key.

## 3. The cut in tokens (`js/slim.js`)

Every step only removes or regroups what the page already shows; nothing is added or rewritten.

For one event asked of the viewer's AI (`slimEvent`):

1. **Same headline, once** (`bundleReports`): headlines that fold to the same string (width, case, a bracketed head such as 【速報】, a trailing "- 社説" or "| outlet", marks) or overlap by 86% or more (character pairs, Dice) are one report with every outlet's name: `NHK・TBS | headline`.
2. **A description keeps only what the headline does not say** (`trimDesc`): sentences are scored by TF-IDF over the event (Japanese in character pairs, a pair of hiragana left out; Latin words whole) and, for three sentences or more, by TextRank (PageRank over word overlap). A sentence is dropped when the headline already carries four fifths of its words, when an earlier report already carried them (fewer than two new words, or under a tenth), and the rest is cut to 90 Japanese characters (English counts 0.4).
3. **At most ten reports, the ones that add the most**: the first, then each time the one that brings the most words not yet covered (greedy cover weighted by IDF). The request says how many reports the event has (`reports="14" shown="10"`). The ceiling is the same as before (10); it picks by content instead of taking the first ten by time.
4. **One line per report** instead of five tags per report, a shorter instruction, and a ceiling on the answer for each mode (320 / 380 / 520 tokens, was 600).
5. **An answer already given is not asked again** (`askCache`): the same event, mode, question, provider and model within 6 hours is answered from this browser (`localStorage` `parallax.ownai.cache.v1`, at most 40 answers; answers only, never a key; cleared when the viewer disconnects).
6. **An event that only grew** (four reports or more before, at most half as many new): the new reports and the earlier answer are sent, not the whole event again.

For the bundling request a viewer's key re-runs (`compactDoc`, used by `rerunAI`): the facts of an outlet (name, home or abroad, type) are written once in a table and each item is `[id, outlet index, lang, title]`. `expandDoc` gives back the original document exactly; the tests hold it to that on the fixture and `tools/measure_tokens.mjs` on the real data. The answer ceiling follows the number of items (420 tokens each, at least 8192, never above `prompt.max_output_tokens`) instead of 65536. Validation still runs on the original request, so the answer is read as before. Identical headlines inside a block were 0 and 2 in the two real requests, so no twin merge was written (the rule clustering already merges them).

### Numbers (`node tools/measure_tokens.mjs work/local/pub_latest.json`, the 2026-11-08 04:53 build, 1371 items)

Tokens are `estimateTokens` (Japanese 1 per character, ASCII letters 0.25, other marks 0.5): a rule of thumb for comparing, not a bill. Characters are exact.

| Request | Before | After | Change |
|---|---|---|---|
| One event asked (40 events with the most outlets, 166 reports): tokens | 21 724 | 16 140 | -25.7% |
| the same, characters | 62 668 | 44 473 | -29.0% |
| the same, median per ask (tokens) | 524 | 379 | -27.7% |
| description characters sent | 6 522 | 5 792 | -11.2% |
| answer ceiling for one ask | 600 | 320 / 380 / 520 | |
| Bundling request r1 (45 items): tokens | 3 811 | 3 003 | -21.2% |
| Bundling request r2 (45 items): tokens | 3 766 | 2 945 | -21.8% |
| answer ceiling for a bundling request | 65 536 | 18 900 | |
| a second ask of the same thing | full | 0 (from the cache) | -100% |

The system instruction of the bundling request (3 265 characters, `prompt.system`) is part of the "after" and was not shortened.

### Quality check (no real AI was called)

- **Facts kept** (`tools/measure_tokens.mjs`): of the numbers, Latin words and katakana runs of three characters or more in the request before the cut (1 047), 1 029 are still in what is sent (98.3%); the 18 that are not (8 events) are in descriptions that repeated a headline or an earlier report (for example "グループ", "ブルームバーグ", "1000"). Against the full material of the events (every report, not only the first ten) the mean is 96.4% and the lowest event 71.4%, which are events of more than ten reports; the request before the cut had the same ceiling.
- **Outlets**: every outlet of an event of ten reports or fewer is still named in what is sent (tests/js/slim.test.js); in the 40 events the lowest share is 77%, again events of more than ten reports.
- **Lossless where it is lossless**: `expandDoc(compactDoc(doc))` equals the document for every request of the fixture and of the real data; `rerunAI` with and without the cut returns the same stories and blocks with a fake provider (the two are held equal in the tests).
- **No word the page did not show**: every headline sent is the page's own, every sentence of a description is a sentence of the feed's description (a test).
- **Not done, and why**: nothing was asked of a real model, so the wording of the answers before and after was not compared; only what the model is given was. The build's own Gemini requests (`parallax/`, `data/prompt.json`) were **not changed**: the build runs on the free tier (no bill per token) and the judging period is on, so a change there is left for after it; the same `slim.js` steps would apply to `_summary_item` (descriptions) if it is wanted.
