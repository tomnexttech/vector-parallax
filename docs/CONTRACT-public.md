# VECTOR PARALLAX — data contract (parallax/1)

The pipeline, the page and the tests all follow this contract. Change it first, then the code.

This is the public copy. Comments in the code cite it as `CONTRACT §n`; the section numbers below (0 to 12) are
the ones those comments use. The README says what the project is; this file says what the data looks like and
which rules every stage obeys. Terms used throughout: *outlet* = a news organisation or public body that
publishes a feed; *item* = one headline with its link and time; *rule cluster* = items grouped by word
overlap only; *story* = the final grouping shown on the page (made by the AI where it succeeded, by the rules
elsewhere); *edition* = `public` or `local` (section 7).

## 0. Layout

```
index.html  css/app.css  js/app.js            page (static, GitHub Pages from the repo root)
js/validate.js  js/provider.js                AI output validator and Gemini caller for the browser (BYOK)
js/rerun.js  js/snapshot.js  js/summary.js    BYOK re-run; reading a kept AI view (12); reading story.summary (13)
data/latest.json                              written by GitHub Actions every 3 h
data/summary_cache.json                       the summary cache (13), committed with latest.json
data/recorded.json                            frozen snapshot whose AI part was recorded once (see 5)
data/prompt.json                              the one prompt + schema + word tables + rights_mode, read by Python and the page
data/labels.json                              flag labels, the label note, Japanese names of places (16)
data/board.json history.json politics.json    the board, lineage keys, Diet / gazette / parties (18.1, 18.9, 18.10)
data/hazards.json markets.json                 map hazards and public market data (18.7, 18.8)
data/critical.json scenes.json                 the scrutiny file (18.12); the scene types of the page (18.13)
data/watchwords.json places.json               the six-flag vocabulary and the place table (18.2, 18.6)
parallax/sources.py feeds.py cluster.py       fetch and rule clustering (stdlib only)
parallax/og.py                                og:image of an article, with limits (15)
parallax/gnews.py keyterms.py                Google News rows (19.2); the big words of a headline (18.5, 18.11)
parallax/politics.py critical.py             Diet, elections, approval series (18.9); scrutiny (18.12)
parallax/build.py ai.py validate.py           pipeline, Gemini caller, validator (stdlib only)
tests/                                        python -m unittest; node tests/js/*.test.js
.github/workflows/update.yml                  schedule + commit data/latest.json
```

The public repository also holds README.md, LICENSE, docs/ (this file) and tools/leakcheck.py (a pre-push
check that no personal name is in a file or a commit).

Python: stdlib only, 3.11+. No secrets in files. The Gemini key comes from the env var
`GEMINI_API_KEY` (Actions secret) or, in the page, from the visitor's own input (kept in memory only,
never written to storage, never put in a URL).

## 1. Times

Every time is epoch seconds (int, UTC) or `null`. The page formats them.

## 2. data/latest.json

```jsonc
{
  "schema": "parallax/1",
  "generated_at": 1762225200,           // when the build ran (build --now overrides it; with --items it defaults to that file's fetched_at)
  "window_h": 36,                       // items older than generated_at - window_h*3600, newer than generated_at + 3600, or without a ts are dropped
  "sources": [ {                        // one row per feed, in sources.py order
      "id": "bbc-world", "name": "BBC World", "outlet": "BBC",
      "type": "海外公共", "home": "intl", "lang": "en",
      "ok": true, "n": 31, "fetched_at": 1762225190, "newest_ts": 1762224000, "oldest_ts": 1762150000,
      "err": "",                       // short code/text when ok=false
      "terms": "https://...",          // page where the outlet states its RSS terms ("" if none found)
      "terms_status": "ok"             // ok | nc | no | unknown (sources.TERMS, see 7)
  } ],
  "items": {                            // only items referenced by rule_clusters
    "<id>": { "id": "<id>", "title": "..." | null, "link": "https://...", "outlet": "BBC",
              "source_id": "bbc-world", "type": "海外公共", "home": "intl", "lang": "en", "ts": 1762224000,
              "image": null | { "url": "https://...", "from": "rss" | "og" },          // 15
              "desc": "..." }                       // optional, absent when not carried: the feed's own description, quoted, first 140 characters at most (14.1)
  },                                    // title is null only in rights_mode strict + public, unless terms_status == "ok" (14)
  "rights_mode": "quote" | "strict",    // 14
  "scope": { },                         // 16: how far the search went (feeds, Japanese mainstream base, window, oldest / newest time)
  "cross_home": { },                    // 16: events that appeared both at home and abroad, by the rules and after the AI
  "images": { },                        // 15: how many items have an image (rss / og / none) and the og stage's own numbers
  "edition": "public" | "local",
  "rule_clusters": [ {                  // the rule-only result, n_outlets desc then last_ts desc
      "cid": "c1a2b3c4d5e6", "member_ids": ["<id>", ...],
      "outlets": ["BBC", "TBS"], "n_outlets": 2, "homes": ["intl", "jp"], "langs": ["en", "ja"],
      "first_ts": 1762200000, "last_ts": 1762224000
  } ],
  "blocks": [ {                         // candidate groups handed to the AI (rules choose them, see 3)
      "bid": "b01", "cids": ["c...", "c..."], "why": "loose_pair" | "top" | "intl_japan" | "gov_only",
      "ai": "answered" | "fallback" | "none"   // none = no AI ran (off, nokey); fallback = the call failed or the
                                               // answer left this bid out, so its stories are the rule groups
  } ],
  "ai_requests": [ {                    // the exact text sent for each call; the page re-sends these (BYOK)
      "rid": "r1", "bids": ["b01", "b02"],
      "alias": { "n1": "<item id>", "n2": "<item id>" },
      "doc": "{\"blocks\":[...]}"       // JSON string, see 4.1
  } ],
  "stories": [ Story ],                 // the final view (AI where it succeeded, rules elsewhere)
  "ai_run": AiRun,
  "ai_snapshot": Snapshot               // only when ai_run.status == "kept_previous" (12)
}
```

`home`: `jp` = a Japanese outlet or Japanese government body, `intl` = everything else.
`type` is one of sources.TYPES. Japanese mainstream = `home == "jp"` and `type` in
sources.MAINSTREAM_TYPES (公共放送, 通信社, 全国紙, 民放), among the sources actually collected.

### Story

```jsonc
{
  "sid": "s" + sha1("|".join(sorted(member_ids)))[:12],
  "origin": "ai" | "rule",
  "bid": "b01" | null,                  // null when the story never went to the AI
  "rule_cids": ["c..."],                // rule clusters its members came from
  "member_ids": ["<id>", ...],          // ordered: cluster.type_rank(type), then ts
  "outlets": [...], "n_outlets": 2, "homes": [...], "langs": [...],
  "first_ts": ..., "last_ts": ...,
  "ai": null | {
    "headline_ja": "...",               // <= 60 chars, neutral description of the event; "" is allowed when headline_en is given (4.3)
    "headline_en": "...",               // <= 90 chars; may be ""
    "angles": [ { "item_id": "<id>", "focus_ja": "..." } ],   // <= 40 chars each
    "contrast_ja": "...",               // <= 120 chars or ""
    "flags": ["overseas_only" | "jp_main_not_found" | "primary_only"],
    "flags_dropped": [ { "flag": "...", "why": "has_jp_outlet" | "has_jp_mainstream"
                                         | "single_outlet" | "has_non_primary" } ],
    "flag_note_ja": "..."               // <= 80 chars or ""
  },
  "summary": absent | {                 // 13: one neutral line for an event that has no AI headline (never together with `ai`)
    "text_ja": "...",                   // <= prompt.summary.limits.summary_ja chars; copies no headline (quoted_fields)
    "made_at": 1762225200,              // when this line was made
    "provider": "gemini" | "claude-recorded", "model": "..."   // who wrote it
  },
  "basis": null | {                     // why these headlines were put together (8); null for a single member
    "by": "rule" | "ai",                // rule = word overlap of one rule cluster; ai = the AI grouped it
    "words": ["委員会", "committee"],   // <= 6 names/phrases (and concept labels) found in >= 2 member headlines
    "places": ["群馬", "US"],           // prefectures and country codes found in >= 2 member headlines
    "time_span": 3600                   // seconds between the first and the last member (last_ts - first_ts)
  }                                     // a page that rebuilds stories after a BYOK call may set basis to null
}
```

`stories` order: n_outlets desc, then last_ts desc. Every rule cluster's members appear in exactly
one story or are split across AI stories; no item appears in two stories.

### AiRun

```jsonc
{
  "status": "ok" | "partial" | "error" | "nokey" | "off" | "recorded" | "kept_previous",
  "reason": "nokey" | "error",       // only with "kept_previous" (12): the status this build itself would have had
  "provider": "gemini" | "claude-recorded" | "fake" | null,   // null for "off" and "nokey"
  "model": "gemini-3.6-flash" | null,
  "at": 1762225200 | null,           // when the answers were made: the build time for a live call, `made_at` of the file for "recorded"
  "prompt_version": "parallax-prompt/5",
  "calls": 4, "calls_failed": 0, "errors": ["quota", ...],   // codes from 4.3
  "attempts": 2, "call_limit": 2, "calls_skipped": 0,        // 13: calls actually sent (retries included), the per-build limit, requests not sent because of it
  "blocks_sent": 30,       // blocks in the calls (a call that failed still counts)
  "blocks_ok": 30,         // blocks present in an answer that parsed (a requested bid the answer left out is not ok)
  "dropped_ids": 0,        // ids in the answer that were not in that block
  "dup_ids": 0,            // ids the answer used twice (first use wins)
  "unassigned_ids": 0,     // ids the answer left out, plus ids of stories dropped to rules by 4.3 (they stay in their rule group)
  "named_outlets": 0,      // public edition: event-level sentences dropped because they named a `no` / `nc` outlet (7); 0 for local
  "merges": 3,             // AI stories built from >= 2 rule clusters
  "splits": 1,             // rule clusters whose members ended in >= 2 AI stories
  "flags_vetoed": 2,       // flags removed by the rules in 4.4
  "quoted_fields": 0,      // AI text fields blanked because they copied a member headline (4.3)
  "report_words": 0,       // headlines blanked for a reporting word (4.6, strict only)
  "silence_words": 0,      // AI texts blanked for a silence word (4.7, always)
  "withheld_text": { "contrast_ja": 0, "flag_note_ja": 0 },   // strict + public: sentences emptied because the event includes a no / nc source (7)
  "note_ja": "",           // for "recorded": who generated it and when
  "summary": { ... }       // the summary stage's own run (13)
}
```

`nokey`: no key, AI skipped, stories = rule clusters. `partial`: some calls failed, their blocks
fall back to rule stories. `error`: every call failed. `kept_previous`: this build had no answers of its own
(`nokey` or `error`, see `reason`) and carries the AI view of an earlier build as `ai_snapshot` (12); this `ai_run`
then describes only this build's own attempt.

## 3. Choosing blocks (rules, deterministic)

0. Prepare: sort the fetched items by source order (stable), drop duplicate `id` (first wins), then apply the
   window (see `window_h` in 2). Set `source = outlet` on each item before clustering.
1. `rule_clusters` = `cluster.cluster(items)` at the default threshold. One member per outlet (the cluster keeps
   the best-ranked, then earliest item of each outlet; the others are not referenced anywhere).
   `member_ids` are ordered by (`cluster.type_rank(type)`, `ts`, `id`); `outlets` follow that order, unique;
   `homes` and `langs` are sorted; clusters are ordered by (-n_outlets, -last_ts, cid).
2. Loose links: `cluster.cluster(items, threshold=0.18)` with `cluster.GATE_ON = False` (restored afterwards),
   run over the items referenced by `rule_clusters` only. Rule clusters that have an item in the same loose
   cluster are joined (union-find) into one block. A block with more than 40 items is broken back into its rule
   clusters (one block each). Blocks keep rule-cluster order.
3. Pick, without duplicates, in this order (ties are broken by the first `cid` of the block):
   - `loose_pair` (first): up to 20 (`PICK_LOOSE_PAIR`; `--pick-loose-pair N`, 0 = off) blocks of >= 2 rule clusters in which some rule cluster is all `jp` and some is all
     `intl` - the rules did not join them, only the loose link (2) puts a Japanese and an overseas group side by side - smallest block first, then newest `last_ts`. This is
     what moves `cross_home` (16) when the AI joins them.
   - `top`: up to 18 blocks with >= 2 outlets that are not already picked, by (n_outlets, both homes present, last_ts) desc.
   - `intl_japan`: up to 6 blocks whose items are all `home == "intl"` and some title matches the Japan pattern
     (build.JAPAN_RE: the case-insensitive English words `japan japanese tokyo osaka kyoto okinawa hokkaido
     fukushima hiroshima nagasaki yen "bank of japan" boj nikkei` plus the Japanese words 日本 日銀 円相場 円安 円高
     東京 大阪 京都 沖縄 北海道 福島 広島 長崎; no personal names), newest `last_ts` first.
   - `gov_only`: up to 10 blocks whose items are all `政府一次` and `home == "jp"`, newest first.
4. Pack into calls of at most 45 items, at most 2 calls (`MERGE_CALL_LIMIT`, fixed in code), first-fit in pick order. Free tier of the bundling model: 20 requests a day; one build every 3 hours is 8 builds x 2 calls = 16.
   A retry counts as a call, so a build never sends a third; blocks that do not fit stay rule stories. A block that fits no call
   (and no new call may be opened) is left to the rules. The blocks that were packed get `bid` `b01`, `b02`, ...
   in pick order; `blocks` lists exactly those.

## 4. One AI call

### 4.1 Input

`data/prompt.json` holds `system`, `user_template` (contains `{DOC}`), `schema` (Gemini dialect),
`limits`, `flags`, `merge_model`, `summary_model`, `summary` (13), `version`. `doc` is compact JSON:

```json
{"blocks":[{"bid":"b01","rule_groups":[["n1","n2"],["n3"]],
  "items":[{"id":"n1","outlet":"BBC","home":"intl","lang":"en","type":"海外公共","title":"..."}]}]}
```

Ids are per-call aliases `n1..nN` (short, hard to mistype); `alias` maps them back. Only titles go
to the model: no links, no article text, no feed descriptions (14.1).

### 4.2 Output (enforced by `schema`, then by the validator)

```json
{"blocks":[{"bid":"b01","stories":[{"member_ids":["n1","n3"],"headline_ja":"...","headline_en":"...",
  "angles":[{"item_id":"n1","focus_ja":"..."}],"contrast_ja":"...","flags":[],"flag_note_ja":""}]}]}
```

### 4.3 Validator (parallax/validate.py and js/validate.js do the same thing)

`validate(request, raw_text, prompt, items)` -> `{blocks: {bid: [{member_ids, origin, ai}]}, counts, errors}`

`request` is one `ai_requests` entry (its `doc` gives the block aliases and rule groups, its `alias` maps back);
`items` maps item id -> item (home, type, outlet are read for 4.4, title for the quote check). `counts` =
`{dropped_ids, dup_ids, unassigned_ids, flags_vetoed, quoted_fields}`. The result's `member_ids` are real item ids; aliases never leave the validator.

- A single surrounding ``` fence (with or without a language tag) is stripped before parsing.
- Not JSON -> error `json`. No `blocks` array -> `shape`. Every block of the call then falls back (`blocks` is `{}`).
- A returned `bid` that was not requested is ignored; if a requested `bid` appears twice the first entry wins.
  A requested `bid` missing from the answer is absent from `blocks` and falls back to its rule groups.
- `member_ids`: keep only aliases that belong to that block (others -> `dropped_ids`); an alias already
  used in this block -> `dup_ids`, first use wins. A story left with no members is dropped.
- Strings: must be strings (else ""). Whitespace (U+0009-000D, U+0020, U+0085, U+00A0, U+2028, U+2029, U+3000)
  runs become one space; then every character of category Cc, Cf or Cs is removed; then whitespace runs are
  collapsed again and the ends trimmed.
  Length is counted in Unicode code points; over `limits` it is cut to `limit - 1` characters plus the single
  character U+2026, so the result never exceeds the limit.
- Empty `headline_ja` (after cleaning): if `headline_en` is not empty the story is kept with `headline_ja: ""`
  and the page shows `headline_en`. A member headline is never copied into an AI field (a hidden title in the
  public edition would leak). If both headlines are empty the story is not trusted: it is dropped and its
  members are treated as unassigned (below).
- Quote check: a text field (`headline_ja`, `headline_en`, `contrast_ja`, `flag_note_ja`, `focus_ja`) that copies a
  headline of the block is blanked (`counts.quoted_fields` += 1) before the empty-headline rule above is applied;
  a blanked `focus_ja` drops its angle. "Copies" = after folding both strings (NFKC, lower case, keep only
  characters of Unicode category L* or N*) either the headline has >= 10 characters and the field contains it, or the
  field has >= 10 characters and is contained in the headline. The check covers every item of the block whose title is not null. Paraphrases pass.
- `angles`: `item_id` must be a member of that story, one per item, first wins (an earlier angle for the same
  item counts as the first even when its `focus_ja` ends up empty); an angle whose `focus_ja` is empty after
  cleaning is dropped. `item_id` is mapped back to the real item id.
- `flags`: only values in `prompt.flags`, no repeats; then 4.4. `flag_note_ja` is set to "" when no flag is left.
- Members the answer never used (and members of stories dropped for empty headlines) -> `unassigned_ids`;
  they stay together per rule group and come back as `origin: "rule"`, `ai: null` entries.
  The unassigned test runs after every story of the block was read, so `dup_ids` does not depend on it.

Error codes (provider + validator): `nokey auth quota blocked truncated http timeout network json shape missing budget`
(`missing` = a recorded answer for this exact request does not exist; `budget` = the per-build call limit of 13 was reached, nothing was sent).

### 4.4 Rule vetoes on flags (the rules have the last word)

Checked per flag in the order given; the first reason that applies is recorded in `flags_dropped`
(`{flag, why}`) and `counts.flags_vetoed` is incremented.

- `overseas_only`: dropped if any member is `home == "jp"` -> `has_jp_outlet`.
- `jp_main_not_found`: dropped if fewer than 2 distinct outlets -> `single_outlet`; dropped if any member
  is Japanese mainstream (`home == "jp"` and type in 公共放送 / 通信社 / 全国紙 / 民放) -> `has_jp_mainstream`.
- `primary_only`: dropped if any member's type is not `政府一次` -> `has_non_primary`.

### 4.5 Providers (parallax/ai.py)

A provider has `name`, `model` and `call(system, user_text, schema) -> (raw_text | None, err_code)`.
`user_text` is `prompt.user_template` with `{DOC}` replaced by the request's `doc`; `schema` is `prompt.schema`.
- `GeminiProvider`: the key goes in the `x-goog-api-key` header only (never in a URL, a log or an error message).
  `generationConfig.maxOutputTokens` = `prompt.max_output_tokens`. A failed call is retried at most 2 times
  (3 attempts), waiting 2 s then 4 s, for HTTP 429, HTTP 5xx, timeout and network errors only.
  HTTP 401/403 -> `auth`, 429 -> `quota`, other non-2xx -> `http`. The key comes from the environment
  (`GEMINI_API_KEY`, an Actions secret) and nowhere else. With a `CallBudget` (13) every attempt, retries included, takes one call;
  at the limit nothing is sent (`budget`).
- `prompt.error_messages[code]` = `{ja, en}`: the plain sentence a page or the CLI shows for each error code
  (`quota` says the free quota or rate limit was reached and to wait).
- `RecordedProvider`: looks up `sha256(user_text as UTF-8)` (hex) in a recorded file (5); no entry -> `(None, "missing")`.
- `FakeProvider`: tests only.

### 4.6 Headlines state facts: reporting words (`strict` only)

In `strict` mode (section 14) the validator blanks a `headline_ja` / `headline_en` that contains a word about how a thing was reported or worded
(`counts.report_words`). The table is `prompt.report_words`, read by `validate.py` and `js/validate.js`; the same table is the reference here.

| language | words (matched after NFKC and lower-casing; English at word boundaries) |
|---|---|
| ja | 報道, 報じ, 見出し, 強調, 触れ, 伝え, 記事, 論調 |
| en | reports, reported, cites, cited, headline, headlines, emphasizes, emphasises, emphasized, emphasised, according to |

Exception: the form `と報じられている` (`prompt.report_words.allowed_ja`) is removed before the check, and `reportedly` is not matched. The strict prompt
(`prompt.strict_addendum`, appended to `system` by `build.load_prompt(rights="strict")`) tells the model to write an unconfirmed outcome (an election result, a
count of casualties, a cause) in that form. A blanked headline goes through the existing rule: if both headlines are empty the story is not trusted and its members
come back as rule groups (4.3). `build.check_output` refuses a `strict` file that still has such a headline (`snapshot_problems` too). In `quote` mode nothing is checked.

### 4.7 Silence words (always on)

The page never says that an outlet "did not report" something: what the data can say is "not found among the N feeds that were fetched". So in every mode the
validator blanks a text field (`headline_ja`, `headline_en`, `contrast_ja`, `flag_note_ja`, an angle's `focus_ja`) that contains a silence word
(`counts.silence_words`; a blanked `focus_ja` drops its angle). The table is `prompt.silence_words`:

| language | words |
|---|---|
| ja | 報じなかった, 報じていない, 報じず, 報じられなかった, 報道しなかった, 報道していない, 報道せず, 伝えなかった, 伝えていない, 黙殺 |
| en | did not report, didn't report, has not reported, hasn't reported, not reported by, failed to report, did not cover, no coverage, silent about, stayed silent |

`build.check_output` refuses any file (and any kept snapshot) with such a word in an AI text. No label in `data/labels.json` contains one (tested).

## 5. Recorded AI output

`python -m parallax.build --items FILE --dump-requests FILE` writes the calls without sending them, as
`{"version": "parallax-requests/2", "requests": [{"purpose": "merge", "rid", "bids", "sha256", "user_text"}], "summary_requests": [{"purpose": "summary", "rid", "events", "sha256", "user_text"}]}`
(`summary_requests` is described in 13)
(`sha256` = hex digest of `user_text` as UTF-8). The file holds every title: keep it out of the repo (`work/`).
Answers written for those calls are stored as `{"version", "provider", "model", "made_at", "note_ja",
"responses": {sha256(user_text): raw_text}}` (`made_at` is epoch seconds) and replayed with `--responses FILE`, through the same
validator. The result is written to `data/recorded.json` with `ai_run.status = "recorded"` and a
`note_ja` that says who produced the answers. It is a frozen snapshot: the page always shows its
`generated_at`, in red once it is older than 6 hours, and never presents it as current.

## 6. Page rules

- Two views of the same data: RULES (`rule_clusters`) and AI (`stories`). The difference is the point.
- Text from feeds and from the AI goes in with `textContent` only.
- Staleness in red: `generated_at` older than 6 h; a source with `ok=false` or `fetched_at` older than
  `generated_at - 6 h`.
- A kept AI view (`ai_run.status == "kept_previous"`, section 12): the AI view shows the snapshot (its own items and
  stories) and the RULES view shows this build. The page says in words "AI の束ねは <source_fetched_at> の取得による"
  (JST, to the minute), shows `ai_at` as the AI's own time, and turns `ai_at` red once it is older than 6 h whatever
  `generated_at` says. A card of the snapshot has no link to this build's rule clusters. A BYOK re-run starts from this
  build's data and replaces the snapshot with the visitor's own result. If the snapshot cannot be read, the page shows
  the AI view as off and says so.
- Colours: white, cyan, red only. No yellow, no green. Width 390 px must not scroll sideways.
- No left/right labels on outlets. Never call anything a fact-check or say a headline is true or false.
- Credits: headlines and links belong to their outlets; each source row links to its `terms`.
- A null `title` is shown as the outlet name, the time and the link only, never as an empty line.
- The one-line summary of an event (13) is shown under the heading with the AI mark, the model that wrote it (`provider · model`) and the time it was made. It is
  never shown without those. A BYOK re-run puts the original line back on a story that stayed a rule story.

### 6.1 The visitor's settings (decided 2026-11-05)

- One window (`,` or the 設定 button; Esc closes), sections on the left: 映像, ニュース, ミュート, 動き, 盤の欄, 保存と復元. Every change takes
  effect at once. `js/settings.js` keeps the rules (no DOM), `js/settings_panel.js` draws the window.
- Kept only in the visitor's browser (`localStorage` `parallax.settings.v1`), never sent anywhere; the window says so in its first line.
  Storage that cannot be read or written (a private window) leaves the board on the defaults; a change then works until the page closes,
  and the window says it was not kept. A damaged value falls back field by field.
- Defaults: everything shown; video plays by itself without sound; the start view follows the data; the system's reduced-motion setting
  decides motion (the visitor may also ask for less motion always).
- Hiding is the visitor's choice and is never silent: muted words (in any headline, NFKC and case folded, at most 20 of 40 characters),
  muted outlets (at most 60), source types and fields turned off, home or abroad only. An outlet or a type hides an event only when every
  report of it is from a muted outlet or a type turned off; an event reported at home and abroad is never hidden by the home/abroad choice.
  The count of hidden events and its reasons stay in a bar under the top bar while any is hidden, and one press shows them all for this
  visit. A priority row that is hidden stays in the list as a folded tag (reason, outlets, time); a press opens that row. Other lists,
  the map and the ticker leave hidden events out.
- No true/false and no left/right labels are added by the settings, and nothing is called unreported.
- Export and import: one JSON file (`parallax-settings/1`: `settings` and the watched words); reset to the defaults keeps the watched words.

## 7. Editions

**Since the rights decision of 2026-11-04 the default `rights_mode` is `quote` (section 14): everything below that withholds a title, a focus or a sentence applies in `strict` only.**

- `local` (default for `python -m parallax.build`): every title is kept. Meant for one person running it on
  their own machine.
- `public` (`--public`, used by Actions for GitHub Pages): an item keeps its `title` only when its source's
  `terms_status` is `ok`; otherwise `title` is `null`. Links, outlet names and times stay. The AI still reads
  every title inside the build (processing, not publishing), and only the AI's own short text is written.
  `ai_requests` is rebuilt from the blocks whose items are all `ok`, so a visitor's BYOK call never carries a
  hidden title.
- A source is `ok` only when its own terms page was read and allows it. Never upgrade a status by guess.
- **What the AI may say about an outlet (public edition).** The AI still reads the headlines of every source, including those
  whose `terms_status` is `no` or `nc`, to decide which items belong together; for those outlets only the outlet name, the time and the
  link are published. So in the public edition every entry of a story's `ai.angles` whose `item_id` is an item of a `no` or `nc`
  source is removed from the output (after validation, before anything is written), and the page shows such an item with
  its outlet name, time and link only. Angles of items of `ok` and `unknown` sources are kept. `nc` (free for non-commercial use only) is withheld exactly like `no`: the name
  behind this publication also sells things, so a non-commercial use cannot be claimed. `nc` headlines are still used to bundle, and the outlet name,
  time and link are still shown. The story-level text
  (`headline_ja`, `headline_en`, `contrast_ja`, `flag_note_ja`) is a neutral description of the event as a whole and is kept;
  it must still not quote any member headline (4.3, `counts.quoted_fields`). The same removal is applied inside a kept
  snapshot (12). The `local` edition is unchanged. A BYOK re-run only ever sends blocks whose items are all `ok`, so it
  cannot produce an angle for a `no` or `nc` source.
- **Outlet names in event-level text (public edition).** The sentences about the event as a whole may not say how a `no` or `nc` outlet worded or
  stressed it. The prompts tell the model to describe a difference without naming an outlet ("one headline gives the type, another only the number"), and
  the build checks it: in the public edition any `contrast_ja`, `flag_note_ja` or `summary.text_ja` that names a `no` or `nc` outlet is dropped (`contrast_ja` and
  `flag_note_ja` become `""`, the `summary` is removed and not cached) and counted in `ai_run.named_outlets` (bundling) and `ai_run.summary.named_outlets`. The names come from the
  `outlet` of the `no` and `nc` entries of `sources.py` plus short aliases (`OUTLET_ALIASES`: for example 日本放送協会, ブルームバーグ, 日経, 日銀), in kanji and Latin letters, matched after NFKC
  and ignoring case. Two words that are also ordinary Japanese words (朝日, 毎日) count only in the form of a reporting subject (`…の報道`, `…によると`). The names of government
  and central-bank sources (`政府一次`) count only inside a reporting frame (`…によると`, `…と報じ`, `…の見出し`, ...), because naming them as the actor of an event ("日銀が据え置いた") says
  nothing about how an outlet wrote; `NAMED_GOV_ALWAYS = True` makes them count everywhere. The same removal runs inside a kept snapshot (12). The `local` edition is unchanged.

## 8. Basis (Story.basis)

Computed in the build from `cluster.Feat` of each member headline. `words` = `Feat.ents` found in >= 2 members
(longest first, then alphabetical) followed by the non-country `Feat.concepts` found in >= 2 members, at most 6 in
all. `places` = prefectures (`Feat.prefs`) and country-like concepts (`cluster._GEO`) found in >= 2 members.
`time_span` = `last_ts - first_ts` in seconds. A story with one member has `basis: null`. An AI story that joins
JA and EN headlines may have empty `words`, which is itself information (the grouping rests on the AI, not on
shared words). Only shared words are written, never a headline.

**Public edition.** `words` are taken only from members whose `title` is published (source `terms_status == "ok"`);
with fewer than two such members `words` is `[]`. A word that exists only in a hidden headline never reaches the
file. `places` and `time_span` are still computed from every member (a place name or a time span is not a
headline); the page may show them for hidden-title stories.

## 9. data/stats.json (parallax-stats/1)

Written next to `--out` by every successful build. Every number is counted from the build's own data.

```jsonc
{ "schema": "parallax-stats/1", "generated_at": 1762225200, "edition": "public",
  "window": { "hours": 36, "from": ..., "to": ..., "oldest_ts": ..., "newest_ts": ... },  // from/to = the window; oldest/newest = items kept
  "sources": { "total": 52, "ok": 38, "failed": 14 },
  "headlines": { "fetched": 1500, "in_window": 900, "clustered": 700 },      // clustered = items in rule clusters (one per outlet per cluster)
  "clusters": { "total": 600, "multi_outlet": 80, "jp_only": 400, "intl_only": 150, "gov_primary_only": 30,
                "multi_outlet_jp_only": 30, "multi_outlet_intl_only": 20, "multi_outlet_gov_primary_only": 2 },
  "ai": { "status": "recorded", "blocks_chosen": 30, "blocks_sent": 30, "blocks_ok": 29, "blocks_failed": 1,
          "clusters_sent": 40, "clusters_fallen": 2, "calls": 4, "calls_failed": 0, "stories": 560, "ai_stories": 30,
          "reason": null, "kept": null,
          "merge": { "provider": "gemini", "model": "...", "calls": 2, "attempts": 2, "calls_failed": 0, "limit": 2 },
          "summary": { "status": "ok", "provider": "gemini", "model": "...", "calls": 14, "attempts": 14, "calls_failed": 0, "limit": 15,
                       "targets": 600, "cache_hits": 0, "left_out": 0, "shown_provider": "gemini", "at": 1762225200 },
          "summarized": 600 } }
```
`jp_only` = all members `home == "jp"`; `intl_only` = all `intl`; `gov_primary_only` = all members of type 政府一次.
`blocks_failed = blocks_sent - blocks_ok`; `clusters_fallen` = rule clusters of those blocks.
`ai.status` is the `ai_run.status` of the build (the values and their meaning are in the table at the end of section 12).
`ai.reason` is `"nokey"` or `"error"` when the status is `kept_previous`, otherwise null. `ai.kept` is null unless the
status is `kept_previous`; then it is `{"ai_at", "source_fetched_at", "ai_stories", "stories"}` counted from `ai_snapshot`.
The other `ai` numbers (`calls`, `calls_failed`, `stories`, `ai_stories`, ...) always describe this build only: with a kept
snapshot `ai_stories` is 0, because this build has no AI story of its own.
`ai.merge` and `ai.summary` give, per job, the provider, the model, the requests made (`calls`), the calls actually sent including retries (`attempts`), the failures
and the per-build limit (13); `ai.summary` also has `targets` (stories without an AI headline), `cache_hits`, `left_out` and `shown_provider`. `ai.summarized` is the number of
stories of this build that carry a `summary`.

## 10. Safety check before writing (build.check_output)

`data/latest.json` (and `stats.json`) are replaced only when `check_output(data, min_stories)` returns no problems;
otherwise the build prints the problems, exits with status 2 and leaves the previous good file untouched.
Checks: schema string; every rule-cluster member is in `items` and in exactly one story; no item in two stories;
`stories` >= `--min-stories` (default 0; Actions passes a real threshold); for `edition == "public"` no item
whose source `terms_status` is not `ok` carries a title, and no `ai_requests` doc contains such a title.
A kept AI view is checked too (section 12): `ai_snapshot` must be present exactly when `ai_run.status == "kept_previous"`, none
of this build's stories may carry AI text then, the snapshot must pass the same coverage checks as the main data (every
rule-cluster member is in its `items` and in exactly one of its stories), it must hold at least one AI story, `ai_at` and
`source_fetched_at` must be epoch seconds, and for `edition == "public"` no title of a source that does not allow it.
For `edition == "public"` no angle of an item of a `no` or `nc` source may be left in any story, of this build or of the snapshot (7), and no `contrast_ja`, `flag_note_ja` or
`summary.text_ja` may name a `no` or `nc` outlet (7).
A `summary` must have a non-empty `text_ja`, an epoch `made_at` and non-empty `provider` and `model`, may not sit on a story that has `ai`, and one file (the snapshot included) may name only
one provider (13).
Files are written via a temporary file and `os.replace`, so a crash never leaves a half-written file.

## 11. data/eval.json (parallax-eval/1)

Written by `python -m parallax.eval` for a recorded run. Machine-countable failures only, counted by running the
recorded answers through the same validator; no title is written. The page reads `counts`, `human` and `made_at`;
if the file cannot be read it shows "not measured".

```jsonc
{ "schema": "parallax-eval/1",
  "made_at": 1762225200,                  // epoch seconds: when this file was computed
  "run": { "provider": "claude-recorded", "model": "...", "recorded_at": 1762220000, "note_ja": "..." },
  "input": { "items_in_window": 900, "rule_clusters": 600, "blocks_sent": 30, "calls": 4 },
  "counts": {                             // one number per kind of failure; null = not judged (nothing to judge)
    "fabricated_ids": 0,                  // ids in an answer that were not in the block
    "dup_ids": 0,                         // ids used twice
    "unassigned_ids": 0,                  // ids left out
    "json_broken": 0,                     // calls whose answer was not JSON
    "shape_broken": 0,                    // calls whose answer was JSON of the wrong shape
    "answers_missing": 0,                 // calls with no recorded answer
    "flags_proposed": 0, "flags_vetoed": 0,   // flags the AI wrote / removed by the rules (4.4)
    "quoted_fields": 0,                   // AI text fields that copied a headline (4.3)
    "suspect_merges_veto": 0,             // merged AI stories where the rules veto some cross-cluster pair
    "suspect_merges_no_shared": 0,        // merged AI stories whose basis has no words and no places
    "place_misread_known": 0,             // place labels that rest only on a listed trap phrase (cluster.PLACE_TRAPS)
    "calls": 4, "calls_failed": 0, "blocks_sent": 30, "blocks_answered": 30, "ai_stories": 30, "merged_stories": 3 },
  "suspect_merges": [ { "sid": "s...", "bid": "b01", "rule_cids": 2, "veto": ["都道府県:..."], "no_shared": false } ],
  "place_misreads": [ { "sid": "s...", "label": "CN" } ],
  "human": { "reviewed": null, "wrong_merges": null, "wrong_splits": null, "wrong_places": null, "note_ja": "" } }   // left empty for a person
```
The counts that come from validating answers (`fabricated_ids`, `dup_ids`, `unassigned_ids`, `flags_*`,
`quoted_fields`, `suspect_*`) are `null` when no block was answered at all (there was nothing to judge); the
counts of failed calls stay numbers. `suspect_merges_veto` = AI stories built from >= 2 rule clusters where
`cluster.similarity` vetoes some pair of headlines taken from two different rule clusters (different prefecture,
number, date or opposite outcome). Both suspect counts are for a person to check, not verdicts.
`place_misread_known` counts place labels (`basis.places`) that the rules attached because of a phrase on the known-trap
list `cluster.PLACE_TRAPS` (an abbreviation of a place that is only part of another word: the "米中" in "米中間選挙",
a US midterm election, is not China). A label is counted when a headline of the story contains a listed phrase and no
headline yields that label once the phrase is removed. It counts only what is on that list: a wrong place that is
not listed is not counted, and judging it is left to `human.wrong_places`. The `human` block is never filled by the
script and no number is produced for it.

## 12. Keeping the previous AI view (ai_snapshot)

A build with no AI answers of its own would turn the AI view off, and the page would lose its main feature.
In two cases only, no key (`nokey`) or every call failed (`error`), the build keeps the AI view of an earlier build
as a snapshot, labels it as such, and never mixes it into this build's data.

- **Source.** The file at `--out`, read before it is replaced (the previous `data/latest.json`). No such file,
  unreadable JSON, a wrong `schema`, or a snapshot that fails the checks in section 10: nothing is kept, and the status stays
  `nokey` or `error` (the AI view is off, as before).
- **When.** Only when this build's own status would be `nokey` or `error`. `off` (the build was told not to call the AI),
  `partial`, `ok` and `recorded` never keep a snapshot, and a build with answers of its own writes no `ai_snapshot`.
- **What is kept.** If the previous file has an `ai_snapshot`, that one, unchanged: `ai_at` and `source_fetched_at` are never
  moved forward, so a snapshot kept through ten builds still carries the time of its own answers. Otherwise the previous
  file's `items`, `rule_clusters`, `blocks`, `stories` and `ai_run`, provided its `ai_run.status` is `ok`, `partial` or `recorded`
  and at least one of its stories has `origin == "ai"`.
- **Shape.**

```jsonc
"ai_snapshot": {
  "ai_at": 1762220000,              // when those answers were made: the `at` of the run that made them (`made_at` for a recorded run)
  "source_fetched_at": 1762215600,  // the `generated_at` of that build: the fetch whose headlines the AI grouped
  "edition": "public" | "local", "window_h": 36,
  "items": { },  "rule_clusters": [ ],  "blocks": [ ],  "stories": [ Story ],   // the earlier build's, as they were
  "ai_run": AiRun                   // the earlier run: status ok | partial | recorded, never kept_previous
}
```

  `ai_at` and `source_fetched_at` differ and the page shows both. The snapshot is self-contained: its stories, rule clusters
  and blocks refer only to its own `items`.
- **No mixing.** The top-level `items`, `rule_clusters`, `blocks`, `ai_requests` and `stories` are this build's own. Every story
  is `origin: "rule"` and none carries AI text. Nothing in the snapshot is matched to, merged into or ranked against this build's
  stories, and no id, item or AI text of the snapshot is copied into them.
- **This build's `ai_run`.** `status: "kept_previous"` and `reason: "nokey"` or `"error"` (the status this build would have had).
  `at` is null; `provider`, `model`, `calls`, `calls_failed` and `errors` are this build's own attempt (without a key: null and 0),
  so the error codes of a failed Gemini call stay readable. The answers' own provider, model and counts are in `ai_snapshot.ai_run`.
- **Public edition.** The title rule of section 7 is applied again inside the snapshot, with the source table of this build:
  a title stays only when its source's `terms_status` is `ok` now, and `basis.words` of a story that loses a visible title
  is emptied (section 8), and the angle removal of section 7 is applied again. The rest of the snapshot's AI text was
  written by the AI and is kept as it was.
- **Statistics.** `data/stats.json` reports `ai.status: "kept_previous"` with `ai.reason` and `ai.kept` (section 9).

Reading the status of a run (`ai_run.status`, and `ai.status` in `data/stats.json`):

| status | what happened | AI view of the page |
|---|---|---|
| `ok` | every call was answered | this build's own AI stories |
| `partial` | some calls failed | this build's AI stories; the blocks of the failed calls are rule stories (`FALLBACK`) |
| `error` | every call failed (`errors`: 429 `quota`, a refused schema `http` / `shape` / `json`, ...) and nothing could be kept | off: rule stories only |
| `nokey` | no key and nothing could be kept | off: rule stories only |
| `kept_previous` | `nokey` or `error` (`reason`), and an earlier AI view was kept | the snapshot, with `ai_at` and the fetch time it rests on |
| `off` | the build was told not to call the AI | off |
| `recorded` | answers replayed from a file (section 5) | the recorded stories |

## 13. Summaries (one neutral line per event), the two models and the call budget

**Status: on since 2026-11-05 (`summary.enabled` is `true` in `data/prompt.json`; `false` switches the stage off).** While it is off the build calls nothing for summaries, leaves the cache content as it is, adds no `summary` to any story, and `ai_run.summary.status` is `disabled`.

Two jobs, two models. Both names live only in `data/prompt.json`: `merge_model` (the bundling of section 4, the core of the
product) and `summary_model` (this section). No model name is written in code. `--model` and `--summary-model` override
them for one run. The free-tier limits of each model are in the README ("AI cost"); the two models have separate daily counts.

**What it does.** After the bundling, every story with at least two outlets (`n_outlets >= 2`) and without an AI headline (`ai == null`) gets `summary`; an event with one outlet never gets one (it would only paraphrase a single headline; `check_output` refuses it): one Japanese line
(at most `prompt.summary.limits.summary_ja` characters) that says what happened in the event as a whole. A story that has an AI
headline gets none: its `headline_ja` is already that line. The order is the order of `stories` (the page order). Events go out in
batches of 45 (`SUMMARY_BATCH`), at most 15 batches (`SUMMARY_CALL_LIMIT`): at most 675 events per build, counted from the top.
Events that do not fit are left without a line (`ai_run.summary.left_out`). The bundling itself is unchanged (2 calls). **Free-tier check (2026-11-05).** `gemini-3.5-flash-lite` allows 500 requests a day (README, "AI cost"): 8 builds x 15 calls = 120 at the very most, and the bundling's fallback to the same model (`merge_fallback_model`, only on 429 / 500 / 503) adds at most 8 x 2 = 16: 136 of 500. The limit of 15 per build is therefore kept. `gemini-3.6-flash` has its own count (8 x 2 = 16 of 20).

```jsonc
"summary": { "text_ja": "...", "made_at": 1762225200, "provider": "gemini" | "claude-recorded", "model": "..." }
```
`made_at` is when THIS line was made (a line taken from the cache keeps the time it was made, not the build time). The page labels the
line with `provider`, `model` and `made_at`, and with the AI mark. A story may not carry both `ai` and `summary`.

**Request and answer.** `doc` = `{"events":[{"eid":"e1","items":[{"outlet","lang","title"}]}]}` (at most 8 items per event; eids are
per-call aliases; `request.eids` maps them to story ids). Answer = `{"summaries":[{"eid","summary_ja"}]}`. `prompt.summary` holds `system`,
`user_template` (`{DOC}`), `schema`, `limits`, `max_output_tokens`. The prompt asks for one neutral line from the member headlines only, in
the model's own words, with no outlet named and no per-outlet emphasis; the text between `<doc>` and `</doc>` is data and any instruction inside it
is ignored.

**Validation (`validate.validate_summaries`).** The same fold as 4.3: a line that copies a headline of the call is discarded
(`quoted_fields`; the event gets no line). An unknown or repeated eid is ignored, an empty line counts as `empty`, an event with no
answer as `missing`. A broken answer is `json` / `shape` and fails the call. In the public edition the summary is event-level text only: no
per-outlet text is produced in this stage, so the focus rule of section 7 has nothing to remove here, and the tests assert that none appears.

**Cache `data/summary_cache.json` (committed, so it survives between Actions runs).**
```jsonc
{ "schema": "parallax-summary-cache/1", "active": "gemini" | null,
  "partitions": { "<provider>": { "<sha256 of the sorted member ids joined by \n>":
      { "text_ja": "...", "made_at": 1762225200, "model": "...", "prompt_version": "parallax-prompt/5", "sid": "s..." } } } }
```
- Key = the members' sha256 plus `prompt.version`, and the same `model`. A change in any of the three means a new call. A hit is never called again.
- Entries whose member set is no longer one of this build's stories (out of the window, regrouped) are dropped at every write. The whole file holds at
  most 2000 entries (oldest `made_at` dropped first).
- Providers are never mixed. There is one partition per provider. A build reads and writes the partition of its own provider. When it has no provider
  (no key, `--no-ai`, no recorded summaries) or its provider made and hit nothing, the page shows only the partition that was `active` (the one shown last),
  under that provider's own name. `active` moves only when a build's own provider made or hit at least one line. `check_output` refuses a file whose
  summaries name more than one provider (the snapshot of section 12 included).
- Written only by a build that passed `check_output`, and never by `--no-ai` or `--dump-requests`.
- Kept AI view (12): the summaries of this build come from the cache and sit in this build's stories; the snapshot keeps the summaries it had. Neither
  is a story with `ai`, so "this build carries no AI text" still holds.

**Recorded summaries.** A recorded file (5) may hold `"summary_responses": {sha256(user_text): raw_text}` and `"summary": {"provider", "model", "made_at", "note_ja"}`
next to `responses`. `--dump-requests` together with `--responses` replays the bundling first and then writes, besides `requests`,
`summary_requests`: `{"purpose": "summary", "rid", "events", "sha256", "user_text"}` for exactly the lines the build would ask for (system and schema:
`prompt.summary`). A recorded file without `summary_responses` leaves the summary stage at status `none`. Who wrote the lines is in `summary.provider`
and `summary.model`, never `gemini` unless Gemini wrote them.

**Call budget.** Per build: bundling 2 calls (`MERGE_CALL_LIMIT`, also the most requests the bundling packs: `MAX_CALLS`), summary 15 calls
(`SUMMARY_CALL_LIMIT`). A retry counts as a call: `GeminiProvider` carries a `CallBudget`, each attempt takes one, and at the limit nothing is sent
(error `budget`; the retry loop stops with the last real error). The requests left over are skipped (`calls_skipped`), their blocks or events stay as rules and the
status is `partial`. The workflow runs one build at a time (`concurrency`), so a manual run cannot add to a scheduled one.

**ai_run additions.** `attempts` (calls actually sent, retries included), `call_limit`, `calls_skipped`, and `summary`:
`{status: ok|partial|error|recorded|off|nokey|none, provider, model, at, prompt_version, targets, cache_hits, summarized, calls, calls_failed,
calls_skipped, attempts, call_limit, left_out, errors, quoted_fields, empty, missing, shown_provider, note_ja}`. `at` is the newest `made_at` shown.

## 14. Rights mode (`prompt.rights_mode`, decided 2026-11-04)

`data/prompt.json` has `"rights_mode": "quote"` (default) or `"strict"`; `--rights quote|strict` (or the environment variable `PARALLAX_RIGHTS`) overrides
it for one run. The mode is written to `latest.json` and `stats.json` as `rights_mode`. `check_output` reads the mode from the data it checks (a file without the
field is checked as `strict`). The code of both modes is kept; the committed data uses `quote`.

| | `quote` (default) | `strict` (the earlier behaviour) |
|---|---|---|
| titles in `items` | every source's headline is shown, as a quotation: outlet name, time and a link to the article always go with it | only a source whose `terms_status` is `ok`; the others have `title: null` |
| `public` and `local` | the same data (only the `edition` label differs) | `public` hides titles as above |
| per-outlet `angles` and `contrast_ja` | kept for every source | angles of `no` / `nc` sources removed; `contrast_ja` / `flag_note_ja` emptied for an event that includes a `no` / `nc` source; a sentence that names a `no` / `nc` outlet is dropped (7) |
| BYOK `ai_requests` | every block (the same blocks as the build's own calls) | only blocks whose items are all `ok` |
| headline reporting words (4.6) | not checked | checked |
| silence words (4.7), quoted fields (4.3), id checks (4.3) | **checked** | **checked** |

What both modes keep: no judgement of truth, no left/right label on an outlet, no "did not report" (the label says "not found in the N feeds that were fetched", 16),
no article body: the body of an article is never carried. What is carried is the headline, an image URL, a link, and, as a quotation with the outlet's name and the link beside it, the description the feed itself attached to the item, its first 140 characters at most (`items[].desc`, 14.1). The `CallBudget` limit of 2 bundling calls (3).
Section 7 describes the `strict` behaviour in detail; where it says an item, angle or sentence is withheld, that holds in `strict` only.

### 14.1 Feed descriptions (`items[].desc`, decided 2026-11-05)

The body of an article is never read or carried. What is carried is the description the feed itself attached to an item, as a quotation: `items[].desc`, with the outlet's name, the time and the link of the same item beside it (`outlet`, `ts`, `link`). The field is absent when nothing is carried.

- **What.** The first paragraph of the item's `description`, else its `summary`, else its `content` (`content:encoded`): tags removed, entities decoded, white space collapsed (`feeds.first_paragraph`; paragraphs end at `</p>`, `</div>`, `<hr>`, two `<br>` or a blank line; an empty paragraph, such as an image only, is skipped). At most 140 characters (`sources.DESC_MAX`, the ellipsis counts). A shorter text is carried as it is. A longer text is cut at the last full stop (`。` `！` `？` `!` `?` or a full stop followed by a space) inside the 140 characters if that stop comes after the 20th character; otherwise at a word boundary, or after 139 characters, followed by `…`. The words are never changed, added or paraphrased (`sources.make_desc`).
- **Not carried** (the field is absent): empty; shorter than 10 characters; the same as the headline, or the headline with only the outlet's name or a date added; a line that only invites the reader to go on or is an advertisement or a feed's boilerplate (`続きを読む`, `Read more`, `Sponsored`, `The post ... appeared first on ...`, `Article URL: ...`); a bare link. A trailing `続きを読む` / `Read more` / `[...]` is taken off and the rest is kept.
- **Not read.** A feed read through Google News (`via`): its description is the relay's text, not the outlet's. The government pages that have no feed (19). `desc` is never sent to the model (4.1), and the model never writes it.
- **Rights (14).** `quote`: every source. `strict`: in the public edition only for a source whose `terms_status` is `ok` (the same rule as `title`); the local edition carries it.
- **Name gate (17).** A description that carries a fixed word is not carried (a title cannot be left out, a description can). `name_gate.desc_carried` and `name_gate.desc_blanked` count them.
- **Withheld list (20.9).** A withheld source or article is removed from the fetch as a whole, so its description goes with it. The previous good version that is kept loses it the same way, and a kept public snapshot drops the description of an item the rules no longer allow.
- **`check_output` refuses** a `desc` that is not a non-empty string of at most 140 characters, that sits on a Google News item, that belongs to a source the strict public edition does not allow, or that carries a fixed word.

## 15. Images (item.image)

```jsonc
"image": null | { "url": "https://...", "from": "rss" | "og" }     // on every item row of latest.json
```
- `url` is an `http(s)` URL of the image on the outlet's own server. The image is never copied into `data/` or the repository; the page loads it from the source.
- `from: "rss"`: the feed item carried it (`media:content`, `media:thumbnail`, `enclosure`, or the first `<img>` of the item's HTML; `feeds.py` picks, `sources._finish` writes it).
- `from: "og"`: the feed had none, so `parallax/og.py` read the `og:image` (`og:image:url`, `og:image:secure_url`, `twitter:image` as fallbacks) of the article's HTML. Only for the
  first `OG_MAX_STORIES` (30) events of `stories` that have no RSS image on any member, at most `OG_PER_STORY` (3) members each until one is found, at most `OG_MAX_FETCH` (40)
  requests in a build, at least `OG_GAP_S` (1.0 s) between two requests to the same host, the first `OG_MAX_BYTES` (262144) bytes of the page, the existing `feeds.UA`. Run only with
  `python -m parallax.build --og`. A failure leaves `image: null`.
- `null`: no image. The page shows the outlet name, time and link only.
- `latest.json.images` = `{"items", "rss", "og", "none", "og_run": null | {"stories", "tried", "found", "failed", "capped"}}`, also copied into `stats.json`.
- `check_output` refuses an item whose `image` is neither `null` nor that shape with an `http(s)` URL.

## 16. Labels, scope, cross-home counts, places

**`data/labels.json` (parallax-labels/1)** is read by the page next to `latest.json`; the texts live only there.

| flag id (`prompt.flags`) | label (ja, main) | label (en, secondary) | note |
|---|---|---|---|
| `overseas_only` | 海外の源だけ | OVERSEAS SOURCES ONLY | |
| `jp_main_not_found` | 取得した国内の主要 {n} 配信に見当たらない | NOT FOUND IN {n} JP MAJOR FEEDS | `{n}` = `scope.jp_main.fetched` (`labels.flags.jp_main_not_found.n_from`) |
| `primary_only` | 官公庁の資料だけ | GOVERNMENT DOCUMENTS ONLY | |

`labels.note_ja` = 「真偽は判定していない」 (shown next to a label). `labels.flags[id].tip_ja` is the tooltip. The former id `mainstream_silent` and the words
SILENT / 報じなかった are gone from the data, the prompt, the labels and the code (tested). `jp_main_not_found` means: at least two outlets are in the collected feeds
for the event and none of them is a Japanese outlet of type 公共放送 / 通信社 / 全国紙 / 民放 (4.4); it says nothing about what an outlet did.
`labels.places_ja` maps the country codes of `basis.places` (US, CN, JP, KR, NK, RU, UA, IR, IL, TW, FR, UK, DE, IN, EU, OKINAWA) to Japanese names (NK -> 北朝鮮,
CN -> 中国, US -> 米国, ...); prefectures in `basis.places` are already Japanese.

**`latest.json.scope` (how far the search went)**, also in `stats.json`:
```jsonc
"scope": { "feeds": { "total": 52, "fetched": 52, "failed": 0 },          // feeds in sources.py / fetched with items / failed
           "jp_main": { "total": 15, "fetched": 15 },                      // Japanese mainstream feeds (home jp, type in MAINSTREAM_TYPES): the base {n} of the label
           "window": { "hours": 36, "from": 1762200000, "to": 1762225200 },
           "oldest_ts": 1762100000, "newest_ts": 1762225100 }              // over the feeds that were fetched
```
and every `sources[]` row has `oldest_ts` (the oldest item time that feed returned, future times excluded; `null` when none) next to `newest_ts`. A kept snapshot
(12) carries the `scope` of its own build as `ai_snapshot.scope` when the earlier file had one; the page reads `{n}` of a snapshot's flags from it.

**`latest.json.cross_home` (events that appeared both at home and abroad)**, also in `stats.json`:
```jsonc
"cross_home": { "rules": 16, "ai": 19, "of": "build" | "snapshot" | null }
```
`rules` = rule clusters whose `homes` contain both `jp` and `intl`; `ai` = stories of the AI view with both. `of: "build"` = this build's own answers (status ok, partial or
recorded); `of: "snapshot"` = a kept AI view: both numbers come from `ai_snapshot` (its rule clusters and stories, one fetch); `of: null` = no AI view (`ai: null`, `rules` from this build).
The difference `ai - rules` is what the AI changed.


## 17. Name gate: the text this project writes, and the text it quotes (decided 2026-11-04)

`tools/leakcheck.py` keeps a list of fixed words that must never reach the public repository (stored encoded, so that no file of the repository spells them; the list is not repeated here). The words include single place names that also occur in ordinary news. Two kinds of text are therefore treated differently.

**Written by this project: strict.** A hit is refused. These are the code, the README, the guides, the contract and every data file except `data/latest.json`, and inside `data/latest.json` the AI-written fields: any string stored under the key `headline_ja`, `headline_en`, `focus_ja`, `contrast_ja`, `flag_note_ja`, `note_ja`, `text_ja` or `summary_ja` (the story headlines, the focus lines, the contrast and flag texts, the summaries, and the run notes `ai_run.note_ja` / `ai_run.summary.note_ja`), in the file itself and in `ai_snapshot`. The list is `STRICT_KEYS` in `tools/leakcheck.py`; the build reads the same list.

**Quoted from the feeds: counted, not refused.** Every other string in `data/latest.json` is something an outlet published or a value derived from it: `items[].title`, `items[].link`, `items[].image` (the image URL), `items[].desc` (the quoted description; unlike a title it is optional, so a description that carries a word is not carried and is counted in `name_gate.desc_blanked`, 14.1), `basis.words` and `basis.places` (words taken from the titles), `ai_requests[].doc` (the request text, which holds the titles), `sources[]` (names and terms links). The project does not choose that wording, so a hit is counted and never stops anything: a scheduled build must not stop committing, and the page must not go stale, because a headline contains a place name.

**In the build** (`parallax/build.py`, uses `gate_counts` from `tools/leakcheck.py`; only the fixed words, never values read from the machine):
- `run_ai`: after the validator, every AI text of a story that carries a word is emptied (`headline_ja`, `headline_en`, `contrast_ja`, `flag_note_ja`; an `angles` row is dropped; a summary is dropped). A story whose two headlines are both empty is not trusted and goes back to its rule groups (the same as the validator does for a story without a headline). The number of emptied texts is `ai_run.name_words` (also `stats.json` → `ai.merge.name_words`). A place-name compound that `tools/leakcheck.py` allows (a railway line, a region, a cape) passes; the bare word does not.
- `ai_run.note_ja` and the summary stage (`summary` lines are rejected before they reach a story or the cache) are gated the same way.
- `snapshot_from`: the kept previous AI view is gated again with today's rule; the count is `ai_snapshot.name_blanked` (absent when 0). `snapshot_problems` refuses a snapshot that still carries a hit.
- `check_output` refuses the file when any strict field still carries a word (`"N AI text field(s) carry a word that must not appear"`). It never refuses because of a quoted field.

**What is recorded** (`data/latest.json` → `name_gate`, copied to `data/stats.json` → `name_gate`), all counted from the data that is written:

```
"name_gate": { "words": 9,                    // fixed words searched
               "ai_fields_checked": 312,      // AI-written strings examined (0 hits is only a result when this is above 0)
               "ai_hits": 0,                  // strict fields still carrying a word; check_output refuses the file when this is above 0
               "ai_blanked": 0,               // texts emptied in this build (ai_run.name_words + ai_snapshot.name_blanked)
               "quoted_hits": 2,              // quoted string fields (the list below) that carry a word: counted, never a reason to stop
               "quoted_fields": ["items[].title", "items[].link", "items[].image", "basis.words", "basis.places", "ai_requests[].doc", "sources[]"] }
```

`python tools/leakcheck.py` applies the same split to the working tree and to every version of `data/latest.json` in the history: a strict hit is a finding (exit 1), a quoted hit is printed on its own line (`counted, not findings: ...`) and the exit status is not affected. `--fixed-only` searches only the fixed words (for a CI runner, where the user name of the machine is not a secret and could collide with a word in the news); `.github/workflows/update.yml` does not call `leakcheck`, because `check_output` already runs the same gate before `data/latest.json` is written.

## 18. Board, map, markets and politics files (decided 2026-11-04 night)

`data/latest.json` stays as it is (sections 2 to 17). The data the one-screen board, the map and the market panel draw is in
**separate files**, so that a failure in one of them can never damage the news data, and so that `latest.json` does not grow.
Every file has `schema`, `generated_at` (epoch s, the time of its own fetch) and, where it fetches from several publishers, a
`sources` object with one row per publisher: `{ "ok": bool, "err": "", "n": int, "fetched_at": int }`.
A page reads each file on its own and shows **when that file was made**; an old file is shown as old (red after 6 h for
board/hazards/markets/politics), never as current. A file is only replaced when its fetch produced something; otherwise the
previous file stays (and its `generated_at` says so). `null` and `[]` mean "could not be fetched" or "none"; the `sources` row
says which. Nothing is filled in.

| file | schema | written by | holds |
|---|---|---|---|
| `data/board.json` | `parallax-board/1` | `python -m parallax.build --extras` | PRIORITY, outline, asymmetry, volume, source health, per-event anatomy (18.1, 18.3 to 18.5) |
| `data/history.json` | `parallax-history/1` | same | 30 days of event keys and big words, for the lineage (18.10) |
| `data/politics.json` | `parallax-politics/1` | same | bills, gazette, audit board, parties, Diet records (18.9) |
| `data/hazards.json` | `parallax-hazards/1` | `python -m parallax.extras` | typhoons, disasters, earthquakes, tsunami (18.7) |
| `data/markets.json` | `parallax-markets/1` | `python -m parallax.extras` | yields, exchange rates, oil (18.8) |
| `data/watchwords.json` | `parallax-watch/1` | by hand | the vocabulary of the six flags (18.2) |
| `data/places.json` | `parallax-places/1` | by hand | place name to point (18.6) |

Code: `parallax/watch.py`, `board.py`, `places.py`, `primary.py`, `hazards.py`, `markets.py`, `politics.py`, `extras.py`.
Times are epoch seconds. A `sid` is the sid of a story in `latest.json`; a page that rebuilds stories after a BYOK call looks an
event up by `sid` first and by `rule_cids` second (a rule cluster's `cid` is stable between the two).

### 18.1 data/board.json

```jsonc
{
  "schema": "parallax-board/1", "generated_at": 1762225200, "latest_generated_at": 1762225200, "edition": "public", "window_h": 36,
  "flag_labels": { "money": {"ja": "公金", "en": "Public money", "scope": "..."}, "law": {"ja": "法"}, "security": {"ja": "安保"},
                   "disaster": {"ja": "災害"}, "power": {"ja": "政治と人事"}, "tech": {"ja": "技術"} },
  "asym_labels": { "primary_only": {"ja": "...", "en": "...", "rule": "the rule in words"}, "periphery_only": {}, "overseas_only": {}, "mainstream_only": {} },
  "rules": { "fresh_tau_h": 24, "priority_first_h": 24, "priority_quiet_h": 18, "stale_quiet_h": 24, "follow_h": 6, "ja_bonus": 0.5,
             "weight": "...", "rank": "...", "priority_max": 80, "outline_per_cat": 6, "outside_max": 8, "asym_max": 24, "cases_max": 260, "threshold": 2 },
  "priority":  ["<sid>", ...],                         // flagged, not stale, ordered by weight x freshness (80 at most)
  "outline":   { "国内政治": ["<sid>", ...], "国際": [], "経済": [], "安全保障": [], "技術": [], "市場": [] },   // 6 each, same order
  "outside":   ["<sid>", ...],                         // important matters outside the six categories (18.3), 8 at most
  "asymmetry": [ { "sid": "<sid>", "kind": "primary_only" | "periphery_only" | "overseas_only" | "mainstream_only" } ],   // 24 at most
  "slab":   { "cats": ["国内政治","国際","経済","安全保障","技術","市場","その他"], "hours": 48,
              "grid": [[48 counts per category]], "pillars": [ { "sid": "...", "cat": 0, "h": 3, "n": 4, "flags": ["law"] } ] },
  "volume": { "hours": 48, "total": [48 counts, index 0 = the last hour], "by_type": { "<type>": [48 counts] } },
  "sources": [ { "id": "nhk-main", "name": "...", "type": "...", "home": "jp", "ok": true, "n": 31, "age_h": 0.4,
                 "h1": 3, "h6": 12, "h48": 80, "future_n": 0, "nodate_n": 0, "err": "" } ],
  "types":   [ { "type": "公共放送", "sources": 6, "ok": 6, "h48": 410, "newest_ts": 1762225000, "age_h": 0.1 } ],
  "health":  { "sources": 85, "ok": 79, "stale_72h": ["<id>"], "future_dated": 0, "no_date": 0 },
  "examined": { "fetched_items": 0, "in_window": 0, "rule_clusters": 0, "stories": 0, "multi_outlet": 0, "live": 0, "stale_dropped": 0,
                "flagged": 0, "priority": 0, "priority_dropped": 0, "flag_counts": {"money": 0}, "asymmetric": 0, "cases": 0,
                "with_place": 0, "primary_items": 0 },
  "events":  [ { "key": "簗", "lead": "<sid>", "sids": ["<sid>", ...], "n_stories": 3, "n_items": 7, "n_outlets": 5 } ],   // 18.11
  "cases": { "<sid>": Case }                           // 18.5; for every sid above and every event with two or more outlets (260 at most)
}
```

`volume`, `sources[].h1/h6/h48` and `types[].h48` count **real headlines** of the last 48 h (all items fetched, also those outside
the 36 h story window), not members of bundles. `examined` is the set of numbers the page may print as "examined": every number is
a count of something this run did, and `fetched_items` is the number of headlines fetched.

### 18.2 data/watchwords.json (the six flags)

`{ "schema", "how", "caveat", "threshold": 2, "weights": {"strong": 2, "weak": 1}, "fields": ["title"], "labels": {flag: {ja, en, scope}},
"mask": [words], "exclude": [words], "flags": { flag: { "strong": [], "weak": [], "strong_re": [], "weak_re": [] } }, "light": {"sport": regex, "entertain": regex} }`.
The six flags are `money` (public money, tax, budget), `law` (law, office, election, Diet), `security`, `disaster`, `power`
(accountability: refusing to answer, deleting or hiding records, pressure) and `tech` (governance of AI and semiconductors).
A headline scores 2 per strong word and 1 per weak word and the flag is set at 2 (one strong word, or two weak ones). The matched words
come back as `hits`. The flags are **subject tags**: they decide what PRIORITY shows and in what order, and the vocabulary is published
so that this choice can be read and argued with. `caveat`: the words were written after looking at a small set of known cases, so any
rate measured on that set is optimistic; no accuracy figure is claimed.

### 18.3 PRIORITY, outline, outside, asymmetry (rules in `board.py`, constants in `rules`)

- The representative headline of an event is a Japanese-language one from a major outlet type if there is one, the newest; among the
  members it is narrowed to those that raise every flag the first pick raised. The flags and `hits` are those of that headline (`rep_id`).
- weight = number of flags set + 0.5 if a primary source is among the members + 0.5 if a Japanese-language report exists + 0.1 per outlet
  type (up to 5). **The number of outlets is not used.**
- fresh = exp(-hours since the newest member / 24). rank = weight x fresh, then newest member, then sid.
- stale: no new member for 24 h; shown nowhere. PRIORITY also drops an event whose first report is older than 24 h and whose newest
  member is older than 18 h. `examined.stale_dropped` and `priority_dropped` count them.
- category: the majority category of the member feeds; for a general desk (横断, 社会) it follows the flags (tech to 技術, money to 経済,
  law to 国内政治 or 国際 by the home of the representative, security to 安全保障) or is その他.
- outside: category not among the six, three or more outlets, no flag, not sport/entertainment/games (`light`), and either a Japanese-language
  report or two or more outlets of the types 公共放送, 海外公共, 通信社, 国家メディア; ordered by (types + 0.5 if Japanese) x fresh.
- asymmetry is decided by the **types** of the outlets only and uses the flags money/law/security (disaster alone is not a signal):
  `primary_only` (all members are primary sources; money or law), `periphery_only` (only party/tabloid/regional types, with at most
  primary, foreign or specialist; no mainstream type among the feeds fetched), `overseas_only` (only overseas types; the headlines mention Japan),
  `mainstream_only` (only mainstream and primary types, four or more outlets). The labels say "not found in the feeds fetched";
  **nothing says that an outlet did not report**, and no outlet gets a political label.

### 18.4 Types

`sources.TYPES` gained 政党機関紙 (a party's own announcements), 週刊誌・タブロイド and シンクタンク (section 19). A type is a
form of outlet, not a stance. `MAINSTREAM` (for the asymmetry rules) = 公共放送, 全国紙, 通信社, 経済紙. `PERIPHERY` = 政党機関紙,
週刊誌・タブロイド, 地方紙. `FOREIGN` = 海外公共, 海外主流, 国家メディア, シンクタンク.

### 18.5 Case (the anatomy of one event), `board.cases[sid]`

```jsonc
{ "sid": "...", "rule_cids": ["c..."], "event": null | { "key": "簗", "n_stories": 3, "sids": ["<sid>", ...] }, "rep_id": "<item id>", "cat": "国内政治", "flags": ["law"], "hits": ["法案", "可決"],
  "weight": 2.6, "fresh": 0.91, "score": 2.37, "n_outlets": 4, "n_items": 6, "types": ["公共放送", "全国紙"], "ja": true, "gov": false,
  "first_ts": 0, "last_ts": 0, "since_first_h": 3.2, "n_new6h": 2,
  "place": null | { "name": "東京", "lat": 35.68, "lon": 139.76, "prec": "local" | "country", "via": "東京" },   // 18.6
  "timeline": [ { "id": "<item id>", "ts": 0, "off_min": 0, "type": "...", "outlet": "..." } ],        // by time, 60 at most
  "heat": { "t0": 0, "bin_h": 1, "bins": 5, "rows": { "<type>": [counts per bin] } },                   // type x time dots
  "fingerprint": [ { "type": "公共放送", "n": 2, "first_off_min": 0, "last_off_min": 40, "outlets": ["NHK"] } ],   // in order of first appearance
  "by_type": [ { "type": "...", "n": 2, "outlets": [ { "outlet": "NHK", "off_min": 0 } ] } ],           // DATA SOURCE: counts per type, who and how late
  "asym": null | "primary_only" | ...,
  "key_terms": ["消費税減税法案", "委員会"], "lineage": [ { "key": "<item id>", "first_ts": 0, "last_ts": 0, "n_outlets": 3, "terms": [], "shared": [] } ],
  "images": [ { "id": "<item id>", "url": "https://...", "outlet": "...", "from": "rss" | "og" } ] }        // 6 at most
```

`off_min` is minutes after the first report. Items without a time are not placed in `timeline`/`heat` (a missing time is never turned
into "+0"). `images` are the URLs of the item images of the members (several outlets), to be loaded from the outlet, never copied.
People (the Wikipedia/Wikidata card): not in this version (see HANDOFF). `key_terms` are the big words of the representative headline (18.11).

### 18.6 data/places.json and the place of an event

`geo` maps a place name (Japanese and English, 428 keys: countries, cities, 47 prefectures and main cities, US states) to `[lat, lon]`,
`local` lists the keys with city/region precision (126), `label` the display names of one-letter abbreviations, `context` the
spellings that mean another place when their context appears (Georgia). Public coordinates, rounded.
Rules (`parallax/places.py`): a place mentioned only as a topic is **weak and not used** (English on/over/about/amid/with, 対〜, 〜情勢,
〜産, 〜籍, places in an enumeration); a place that stands as a location (in/at/near, で, 西部) is strong; cities and regions go before
countries; when the representative headline has none, the place named by at least 20 % of the related member headlines is used;
**a person's name never gives a place**; no place is better than a guessed one. `via` is the key the place came from, so the page can say
"placed by: 東京". `prec` `country` means a country's representative point: the page must not draw a radius around it as if it were exact.

### 18.7 data/hazards.json

```jsonc
{ "schema": "parallax-hazards/1", "generated_at": 0, "ok": true, "attribution": "...", "rules": { "typhoons": "...", "disasters": "..." },
  "sources": { "jma_typhoon": {"ok": true, "n": 1, "err": "", "note": "", "fetched_at": 0}, "gdacs_tc": {}, "gdacs_events": {}, "jma_quake": {}, "jma_tsunami": {}, "usgs": {} },
  "typhoons": [ { "id": "jma:TC2637", "label": "台風第31号（インファ）", "name_jp": "", "name_en": "", "number": 31, "src": "JMA" | "GDACS/JTWC",
                  "time": 0, "issued": 0, "lat": 25.8, "lon": 138.6, "pressure": 970, "wind": 35, "gust": 50, "wind_unit": "m/s ...",
                  "class": "TY", "class_jp": "台風", "intensity_jp": "強い", "strength": "強い・970 hPa・35 m/s", "speed_kmh": 20, "course_jp": "北",
                  "storm": {"lat": 0, "lon": 0, "r_km": 130} | null, "storm_r_km": 130, "storm_dirs": [{"dir": "全域", "km": 130}],
                  "gale": {"lat": 0, "lon": 0, "r_km": 330} | null, "gale_r_km": 330, "gale_dirs": [],
                  "track": [ {"t": 0 | null, "lat": 0, "lon": 0, "pressure": null, "wind": null, "stage": "pre" | "ty"} ],       // past positions
                  "forecast": [ {"t": 0, "hours": 12, "lat": 0, "lon": 0, "r_km": 90, "pressure": 0, "wind": 0, "class_jp": "", "storm_r_km": 0} ],   // forecast circles
                  "storm_area": { "arcs": [], "lines": [], "angle": "..." } | null,  "cone": null | [[[lat, lon], ...]],     // GDACS storms carry a cone, JMA ones the circles
                  "alert": null | "Green" | "Orange" | "Red", "also": [ { "id": "gdacs:TC:...", "src": "...", "alert": "..." } ], "url": "https://..." } ],
  "disasters": [ { "id": "gdacs:FL:1", "type": "FL", "type_jp": "洪水", "label": "洪水 India", "lat": 0, "lon": 0, "alert": "Orange", "severity": "...",
                   "strength": "..." | null, "place": "India +2", "country": "...", "from": 0, "to": 0, "current": true, "url": "https://...", "same_as": null } ],
  "quakes_jp": [ { "id": "jma:quake:...", "t": 0, "place": "千葉県東方沖", "lat": 0, "lon": 0, "depth_km": 40, "mag": 3.4, "maxint": "2", "maxint_jp": "震度2", "distant": false, "tsunami": null | "text", "url": "https://..." } ],
  "quakes_world": [ { "id": "usgs:...", "t": 0, "lat": 0, "lon": 0, "depth_km": 10, "mag": 4.6, "place": "...", "url": "https://..." } ],
  "tsunami": [ { "id": "jma:tsunami:...", "level": "major_warning" | "warning" | "advisory" | "forecast", "issued": 0, "title": "", "areas": [ { "name": "", "level": "", "max_height": "", "arrival": 0 } ], "observed": [] } ] }
```

Alert levels are the publisher's (GDACS Green/Orange/Red; JMA warning kinds). The storm and gale areas are the **real radii** the agency
publishes (`storm_r_km` = the 暴風域 radius, `gale_r_km` = the 強風域 radius, per direction in `*_dirs`). `typhoons: []` means none in force.
Earthquake times for Japan are the origin time of the JMA report; `maxint` is the largest seismic intensity (JMA scale) over all reports of that earthquake.

### 18.8 data/markets.json

```jsonc
{ "schema": "parallax-markets/1", "generated_at": 0, "ok": true,
  "note_ja": "判断材料の表示であり、売買の推奨ではありません", "note_en": "Material for your own judgement. This is not a recommendation to buy or sell.",
  "not_included": "...", "sources": { "jgb": {"ok": true, "n": 13331, "err": "", "fetched_at": 0}, "ust": {}, "ecb": {}, "eia-DCOILWTICO": {} },
  "jgb": { "date": "2026-11-02", "prev_date": "2026-10-30", "unit": "%", "gap_days": 3, "tenors": [ {"tenor": "10年", "yield": 2.817, "prev": 2.817, "chg_bp": 0.0, "ok": true} ] },
  "series": [ { "id": "jgb-10y", "group": "rates" | "fx" | "commodity", "name_ja": "日本国債 10年", "name_en": "JGB 10-year", "unit": "%",
                "source": { "name": "...", "url": "...", "terms": "..." }, "ok": true, "err": "", "as_of": "2026-11-02", "age_days": 2,
                "last": 2.817, "prev": 2.817, "chg": 0.0, "chg_pct": 0.0, "chg_bp": 0.0,
                "spark": [ [epoch, value] ],                      // the last 30 observations
                "ta": { "ok": true, "bars": 200, "chg": {"d1": 0, "d5": 0, "m1": 0, "m3": 0}, "chg_bp": {},
                        "sma": {"s5": 0, "s20": 0, "s60": 0, "d20": 0, "d60": 0, "slope20": 0}, "rsi": 41.6, "vol20": 0, "z1": 0, "bb_z": 0,
                        "range3m": {"pos": 40, "lo": 0, "hi": 0}, "crosses": [ {"kind": "p20", "dir": "up", "ago": 2, "label": "..."} ],
                        "streak": 0, "trend": "上昇基調" | "下降基調" | "横ばい" | null, "trend_basis": "...", "trend_rule": "...", "signals": ["..."] } } ] }
```

Series: Japan 2/10/30-year yields (Ministry of Finance, with the 2/5/10/20/30-year table in `jgb`), US Treasury 2/10/30-year (U.S. Treasury),
USD/JPY, EUR/JPY, EUR/USD, CNY/JPY (crosses of the ECB euro reference rates), WTI and Brent spot (EIA via FRED). These are **daily** values with the
date of the observation (`as_of`, `age_days`); nothing is shown as real-time. A series that could not be fetched has `ok: false` and the reason.
Not included: stock indices and crypto (no publisher terms that allow display were found) and anything from unofficial endpoints.
`trend` follows `trend_rule` literally; `signals` are statements of what happened (crossings, RSI zones, streaks), in no case advice.

### 18.9 data/politics.json

`{ "schema", "generated_at", "failed": {section: reason}, "order_rule": "...", "bills": { "counts": {"shugiin": {"〔成立〕": 3}, "sangiin": {}}, "recent": {"shugiin": [Row + "status"], "sangiin": []} },
"gazette": [Row], "audit": [Row], "office": [Row], "parties": [ {"outlet": "...", "n": 3, "items": [Row]} ], "kokkai": { "total": 0, "meetings": [ {"date", "house", "meeting", "issue", "session", "url"} ] } | null, "session": {...} | null, "elections": {...}, "polls": {...} }`
with `Row = { "id", "outlet", "title", "link", "ts" }` (an `id` is an item id of `latest.json`). The bill status is the bracket the house's page put in front of
the bill name, as written. The Diet-record data are meeting metadata and links only. The Prime Minister's Office comes first and the parties follow alphabetically by
name; no colour, no ranking, and no sentence about what a bill means. Not in this version: the budget-document GAP, press-freedom indicators, party seats by group, the check of the approval figures against headlines.

**elections** (`politics.elections`; the Ministry of Internal Affairs and Communications' pages only - private election-information sites are not read, their terms were not confirmed).

```jsonc
{ "status": "ok" | "zero" | "fail", "fetched_at": 0, "today": "2026-11-05", "window_days": 60,
  "source": { "name": "総務省", "pages": [ { "kind": "governor" | "mayor_designated", "label_ja": "都道府県知事選挙", "url": "https://...", "ok": true, "n": 161, "err": "" } ],
              "covers_ja": "...", "note_ja": "..." },
  "upcoming": [ { "date": "2026-11-15", "name": "...", "kind": "governor", "url": "https://...", "source": "総務省" } ],
  "recent":   [ { "date": "2026-10-25", "name": "...", "kind": "governor", "url": "https://...pdf", "source": "総務省" } ],      // newest first, at most 40
  "counts": { "upcoming": 0, "recent": 3, "rows_on_pages": 221 } }
```

The two pages are the ministry's lists of results for governors' and designated-city mayors' elections (a row is a link such as 「令和8年10月25日執行　福島県知事選挙」 to the
results sheet). `date` is the Japanese calendar date of the vote converted to ISO, `url` the ministry's own link, `name` as the page wrote it. `recent` = rows dated in the last
60 days before `today` (the JST date of `fetched_at`); `upcoming` = rows dated `today` or later. **The ministry publishes no calendar of coming votes**, so `upcoming` has a row only
when a list carries a date of today or later (a vote is listed on its own day once the sheet is out) and is usually `[]`: nothing is added from any other source and no date is
computed. Not covered: national elections, other mayors, assemblies. `status`: `ok` = rows read and at least one in the window; `zero` = pages read, none in the window; `fail` = no page
could be read or parsed (a page with no readable row is a failure, not an empty answer; one page failing leaves the other, its `err` says which). A failure also adds `failed.elections`.

**polls** (`politics.polls`; the series of cabinet approval).

```jsonc
{ "status": "ok" | "fail", "fetched_at": 0, "err": "...",                                    // err only on fail; series is [] then
  "source": { "name": "Wikipedia (English)", "title": "...", "revid": 1383347005, "url": "https://en.wikipedia.org/w/index.php?title=...&oldid=1383347005",
              "license": "CC BY-SA 4.0", "license_url": "https://creativecommons.org/licenses/by-sa/4.0/", "note_ja": "..." },
  "series": [ { "pollster": "NHK", "pollster_ja": "NHK", "points": [ { "start": "2026-10-09", "end": "2026-10-12", "approve": 50.8, "disapprove": 32, "undecided": 17.1,
                 "sample": 1184, "cabinet": "...", "cite_url": "https://..." | null, "cite_urls": [] } ] } ],                // oldest first, the newest 24 points
  "counts": { "pollsters": 12, "points": 101, "skipped": 1 } }
```

Read once per run from the wikitext of one page of the English Wikipedia through its API (`action=parse`, the revision id kept, this project's identifying User-Agent, one request).
The wiki's `robots.txt` keeps crawlers out of `/w/`; the action API is the route it documents for programs, so `robots.txt` is not asked for this one host (every other host in 18.9 and
18.12 is). The figures are the pollsters' own numbers as the page prints them (a dash or a note is not a number: that row is left out and counted in `skipped`, never read as 0);
`cite_url` is the first source the page cites for that pollster's row. The page is licensed CC BY-SA 4.0: the file says so, links the exact revision and says what was changed (numbers
taken from the table); a page that shows these series shows the same credit. The page's name changes after the next general election: a missing section is `fail`, not an empty series.
Pollster names are shown as the page writes them; `pollster_ja` only translates the names in a fixed table. The check of the figures against headlines is not done.

### 18.10 data/history.json

`{ "schema": "parallax-history/1", "updated_at": 0, "days": 30, "entries": [ { "key": "<id of the earliest item>", "first_ts": 0, "last_ts": 0, "n_outlets": 3, "terms": ["..."], "cat": "..." } ] }`.
Only keys, times, counts and big words are kept (no headline, no link). An event's `lineage` is the entries that share two or more big words with it and ended at
least 6 hours before it began.

### 18.11 Event layer, representative headline, key words (decided 2026-11-04 night; from the author's earlier board)

**Representative headline** (`board.pick_rep`; used for the story's `rep_id`, its flags and its place). A member is Japanese if the feed's language is `ja` or its
headline has kana. Among the Japanese members (all members if there is none) with a time, the newest of a major type (公共放送, 全国紙, 通信社, 経済紙, 民放, 地方紙,
海外公共) is taken; if there is no major type, the newest; if no member has a time, the "original rep" (the one the rule clusterer would take: type order, then the earliest time)
or the first Japanese member. If the original rep raises flags of its own, only members that raise all of them are candidates (else those that share one, else all), so that a
member that joined by a wrong merge never becomes the face of the event. Headlines are never rewritten.

**Event layer** (`board.events`). On top of the stories (which the rule clusterer and the AI keep small on purpose), stories whose headlines name the **same titled person**
(簗農水相, 古謝知事, 岩屋前外相, ○○氏; a name without a title is not taken; places, organisations and countries are not names; 市長・区長・町長・村長 are not titles) are folded into one
event on the board. A name is a key only if it appears in 2 to 40 stories of the window (more is a topic, such as a prime minister's name, judged on all headlines with or without a title),
at least 34 % of the story's headlines contain it, and a one-character name has its full name somewhere in the window; spelling variants (簗 / 簗和生) are folded to the shorter one.
Stories with the same key are joined by single link only where the best pair of their headlines has `cluster.similarity` of 0.2 or more and no veto (two different matters of one
person stay apart). Sport stories are never folded. The event takes the `sid` of its best-ranked story (weight x freshness); `members` are the union (newest first, 30 at most), flags are
the OR, times the min/max, `rule_cids` the union. `board.events` lists `{key, lead, sids, n_stories, n_items, n_outlets}` and `cases[lead].event` has `{key, n_stories, sids}`; **the other
sids appear nowhere else on the board**, so a page that is given one of them (a link, a search) maps it to `lead` through `board.events`. `latest.json` is not changed: its stories stay as they are.
`examined.events` and `examined.stories_folded` count them. The thresholds are in `board.rules` (`event_max_df`, `event_share`, `event_sim`).

**Key words** (`keyterms.key_terms`, from the author's earlier board). From the headline without its trailing outlet name or bracket: runs of kanji, katakana, digits and Latin letters, cut before okurigana;
the leading date and ordinal, counts with a unit and boilerplate words (速報・告示・掲載 ...) are not words; English names are read from capitalised runs (Title Case headlines are cut at verbs).
Longer words first. An empty list is a valid answer (a fragment of the head of the headline is never used instead). `board.key_terms` returns the first 4, as before; the history file keeps them, so the
lineage of the first run after this change matches old entries only by words both rules produce.


### 18.12 data/critical.json (`parallax-critical/1`, decided 2026-11-05)

A weight added beside the main reports, not a replacement: investigative reporting, the Diet's questions and the government's answers, academic and NGO texts, each read from its own
site. It says nothing about who is right: no true/false, left/right or good/bad label, and nothing is called unreported. Headline, outlet, date and link only (no body text and no
quotation of a speech).

```jsonc
{ "schema": "parallax-critical/1", "generated_at": 0, "status": "ok" | "zero" | "fail", "note_ja": "...",
  "kinds": { "investigative": {"ja": "調査報道", "tag": "調査"}, "primary": {"ja": "一次資料", "tag": "一次"}, "academic": {"ja": "学術", "tag": "学術"}, "ngo": {"ja": "NGO・国際団体", "tag": "NGO"} },
  "sources": [ { "id": "ourplanet", "name": "...", "kind": "investigative", "scope": "JP" | "INT", "url": "https://...", "ok": true, "n": 8, "fetched_at": 0,
                 "err": "", "terms_status": "unknown", "carried": 0, "carried_from": 0 } ],                       // carried_from only when items were carried over
  "themes": { "kokkai": [ {"theme": "...", "query": "..."} ], "jstage": ["..."], "note_ja": "..." },
  "credit": { "jstage": "J-STAGE", "kokkai": "国立国会図書館 国会会議録検索システム" },
  "featured": { "investigative": "<id>" | null, "diet_question": null, "diet_answer": null, "academic": null, "ngo": null },
  "items": [ { "id": "<12 hex>", "src": "ourplanet", "kind": "investigative", "tag": "調査", "source": "OurPlanet-TV", "title": "...", "url": "https://...",
               "date": "2026-11-04" | "2024", "ts": 0 | null, "scope": "JP" | "INT", "carried": true,
               "theme": "防衛費", "side": "member" | "gov", "who": "name（group or position）",                    // Diet-record items
               "journal": "...", "country": "..." } ],                                                           // J-STAGE / Amnesty items
  "counts": { "sources": 10, "ok": 10, "items": 93, "carried": 0 } }
```

- Sources (ten, each read from the body's own site): OurPlanet-TV, Independent Web Journal (RSS); ProPublica, The Intercept, ICIJ (RSS, abroad, at most 5 each); the Diet-record search API
  of the National Diet Library (speeches on the themes in `themes.kokkai`, 200 days back, 3 per theme); the Science Council of Japan (new items on its top page); the J-STAGE search API
  (themes in `themes.jstage`); the Japan Federation of Bar Associations (statements of the year); Amnesty International Japan (news list). Not read: anything that only a news aggregator
  could give, the Ministry of Finance budget documents (PDF), the press-freedom index (re-use terms not confirmed). `terms_status` is `unknown` on every row (the terms pages were not read);
  headline, outlet, date and link are shown as a quotation, as for every feed (14).
- `kind` is a structural fact about the source (what sort of body publishes it), never a view of its content. `side` of a Diet-record item is `gov` when the speaker's position is a government
  one (minister, vice-minister, parliamentary secretary, government witness, director-general and the like), else `member`; both sides get the same weight (3 per theme, a side absent from the
  hits stays absent). The themes are a fixed list written into the file: a choice of what to look for, not a measure.
- `date` is the date the source printed (a J-STAGE item has the year only and stays a year); `ts` is set only when the feed gave a time. Items are ordered newest first by `ts` or, lacking it, the
  date at noon (JST); at most 240; the same link appears once. `featured` is the newest item of each class by that order (a rule, not a ranking of importance).
- Reading rules: only where the host's `robots.txt` allows the agent (20.6), at most one request per host per 1.2 s, this project's own User-Agent, one source failing never stops the others.
  A source that fails is a row with `ok: false` and the reason in `err`; its items from the previous file (carried over by the cache, 20.1) are kept for at most 3 days, marked `carried: true`,
  and `carried_from` keeps the time of the last real fetch (a carried item does not renew its own age). `status`: `ok` items exist; `zero` all sources read but no item; `fail` nothing read and nothing carried.

### 18.13 data/scenes.json (`parallax-scenes/1`, decided 2026-11-05)

A tracked setting (no headline): the scene types of the page, their thresholds and the words used for counting. `js/scenes.js` reads it; nothing else writes it. The thresholds are provisional
(`"provisional": true`; the measured values they were set from are in the file with their date) and change here only.

- `rules`: the priority `disaster > election > world > live > calm`; a scene changes **arrangement only** (what is large, what is folded, the map, the video), never the order, the filtering or the
  wording of the headlines; "fold" means the pane is folded with its head and count kept, and the visitor's `panes.off` always wins; map layers get a scene's default only if the visitor has not touched
  that layer; a change is never silent (a band under the top bar says the scene, auto or pinned, the reason and the time, with controls for calm, auto and pin); promotion at once, demotion after
  30 minutes from the last trigger (180 for `disaster`); held while the sheet or the settings window is open and for 25 s after an input; key `s`.
- `quake_scale.rank`: the order of `hazards.quakes_jp[].maxint`. `scenes[]`: `id`, `label_ja`, `tier`, `big` / `fold` (pane ids of the page), `map`, `video` (station ids of `js/tv.js`), `auto`
  (the conditions, written over fields that exist in the data files: `switch` / `banner_only` for `disaster`, `any` for `election` - a burst of election words in the headlines of 6 h, or a vote dated
  today in `politics.elections.upcoming` - and `all` for `world` and `live`), `banner_ja`. `vocab` holds the words for counting headlines (they only count; they never judge; an opinion poll is not an
  election word).

## 19. Sources added and pages without a feed (decided 2026-11-04 night)

`sources.SOURCES` rows have a `kind`: `feed` (RSS/Atom, as before) or `html` (a page read by `parallax/primary.py`: audit board new items, official gazette
table of contents, bills of the House of Representatives and the House of Councillors; ids `primary-jbaudit`, `primary-kanpo`, `primary-shugiin`, `primary-sangiin`).
`fetch_everything` reads the feeds only; `fetch_primary_sources` reads the pages (budget `PARALLAX_PRIMARY_BUDGET`, default 150 s) and returns items and status rows in
the same shape. A page that fails is a status row with `ok: false` and the reason; dates that cannot be read are dropped, never replaced by the fetch time.
Added feeds: ten party announcement feeds (政党機関紙), weekly and business magazines with their own feeds (週刊誌・タブロイド, 経済紙), think tanks (シンクタンク),
specialist security and technology outlets (専門), and the exchange group's news. Their terms pages were not read, so `terms_status` is `unknown`; in `rights_mode` quote
the headline is shown as a quotation with outlet, time and link, as for every source. Google News is read as a fallback where an outlet has no feed of its own (19.2); Yahoo! News and similar re-distribution portals and unofficial mirrors are not used.

### 19.2 Google News rows (decided 2026-11-04 night)

`sources.SOURCES` rows with `kind: "gn"` (36 of 121) read a Google News RSS: `https://news.google.com/rss/search?q=site:<host>...` (`fixed: true`; the outlet and type come from the row; 31 rows) or a section
of the Japanese edition (`fixed: false`; top, domestic, world, business, technology; the row's type is `集約`, an aggregation row, and **no item carries it**). Code: `parallax/gnews.py`.
Headline: the trailing " - outlet" is cut only if it is the `<source>` name. Outlet of a `fixed: false` row: looked up by the `<source>` name in `gnews.ALIASES` (exact match after NFKC and case
folding; the table comes from the author's earlier board, types renamed to this project's); `home` from the outlet (the source table if it is already there, else overseas types and a short list, else `jp`).
Dropped and counted in `sources[].dropped` (with `via: "google-news"`): `unknown_outlet` (not in the table; no type is guessed), `portal` (Yahoo! News, au, d menu ... : the original outlet is not known),
`direct_feed` (an outlet whose own feed is read), `no_date` (a date is never replaced by the fetch time), `no_title`. At most 30 newest headlines per row. The link is Google News' redirect URL (it opens the article);
there is no image. `terms_status` is `unknown` on every row (the terms were not read), so `rights_mode: strict` withholds them; `quote` shows them as for every source. Two requests at a time (`GN_WORKERS`).
Effect on the other files: the national papers (読売, 産経, 日経), the wires (共同, 時事, Reuters, AP) and several regional papers now exist in the feeds fetched, so `scope.jp_main.fetched` is 20 and
the label "Japanese mainstream not found" is measured against a wider set than before.

## 20. Delivery, one source of numbers, asymmetry, flags, photos, withheld list (decided 2026-11-04 night, third critics' round)

### 20.1 Delivery: headlines are not committed (supersedes the "commit data/" lines of 0 and 12)

The public repository's history keeps **code, rules, contract, tests and settings that hold no headline**. Everything that holds a headline, an image URL or the
contents of a fetch is a **build product**: it is made by the workflow, shipped as the **Pages artifact** (`actions/upload-pages-artifact` +
`actions/deploy-pages`) together with the page, and never committed.

| tracked (settings, no headline) | build products (ignored, removed from the index with `git rm --cached`) |
|---|---|
| `prompt.json`, `labels.json`, `watchwords.json`, `places.json`, `traps.json`, `withheld.json`, `scenes.json` | `latest.json`, `board.json`, `history.json`, `stats.json`, `eval.json`, `politics.json`, `critical.json`, `hazards.json`, `markets.json`, `summary_cache.json`, `recorded.json`, `og_robots.json` |

- `recorded.json` (the answers an AI role-played by Claude wrote for the author's own fetch) quotes headline strings in its fields, so it is not published. The public
  edition's AI view is: **Gemini when `GEMINI_API_KEY` is set, otherwise no AI view and the rules view only** (`ai_run.status` is `nokey`; the previous Gemini view is
  kept as `kept_previous` when the cache has one). The recorded answers stay on the author's machine for screens and the A4 sheet
  (`python -m parallax.build --responses data/recorded.json` still works there).
- What the next run needs from the last one (`latest.json` for `kept_previous`, `summary_cache.json`, `history.json` for the lineage, `og_robots.json`, and the last
  `hazards.json` / `markets.json` / `critical.json` for "the previous file stays") is passed on through **`actions/cache`** (rolling key), not through git.
- The site artifact is assembled by `tools/assemble_site.py` from a whitelist (page files + the generated data + the tracked settings). `recorded.json`, `eval.json`
  (no recorded run exists in Actions, so the page shows "not measured"), `summary_cache.json`, `og_robots.json` and `withheld.json` are not in it.
- Pages must be set to **Source: GitHub Actions**. A manual run (`workflow_dispatch`) rebuilds and redeploys at once; this is how a withheld item (20.9) is applied without waiting for the next 3 hours.
- The history that already exists is **not rewritten** here (no rebase, no filter-repo, no force). How a clean public history is made is the owner's decision.
- Tests run on synthetic fixtures (`tests/fixtures/`), never on a tracked `data/latest.json`.

### 20.2 One source of numbers (`counts`)

`parallax/counts.py` is the only place that defines a count. `board.json` -> `counts` and `stats.json` -> `counts` are **the same object** (written from the same call; if the board
could not be built, `stats.counts` has the base part and `null` for the board part). A page and the A4 sheet print these and no other number for these things. Unit of each:

| key | meaning | unit |
|---|---|---|
| `sources.total / ok / failed` | feeds in `sources.py` / fetched with items / failed | feed |
| `headlines.fetched` | every item the fetch returned (also outside the window; after the withheld list) | headline |
| `headlines.in_window` | items inside the story window | headline |
| `bundles.rule` | rule clusters (one per outlet per cluster) | rule cluster |
| `bundles.stories` | stories of the AI-or-rules view of `latest.json` | story |
| `bundles.events` | units on the board (stories, with the person-named ones folded: 18.11) | board unit |
| `multi_outlet` | rule clusters with two or more outlets | rule cluster |
| `home.jp_only / intl_only / both` | rule clusters whose members are all `jp` / all `intl` / both (`both` = `cross_home.rules`) | rule cluster |
| `flagged.any` and `flagged.<flag>` | live board units raising a flag (18.2) | board unit |
| `priority` | length of `board.priority` | board unit |
| `asymmetric.total / shown / by_kind` | live board units that satisfy 20.3 / how many `board.asymmetry` lists (cap `asym_max`) / per kind | board unit |
| `incidents` | person-named events folded on the board (`board.events`, 18.11) | event |

`headlines.in_window` is the headlines inside the window (`latest.json.window_items`), `headlines.clustered` the ones that entered a rule cluster; `stats.json` `sources` and `headlines` are these same objects. `cross_home` (16) compares the AI view with the rules of **one fetch**; when its `of` is `snapshot` it describes the earlier fetch, so a page prints `counts.home.both` for the current fetch and `cross_home` only with its `of`.

`asymmetric.total` and `asymmetric.shown` are never printed as one number: the page says "shown of total" when they differ.

### 20.3 Asymmetry: one definition

An event gets an asymmetry label only if **both** hold: (1) **two or more outlets** (distinct `outlet`) are among its members, and (2) in the event's time band the mainstream
feeds were **all fetched**: every source with `home == "jp"` and a type in `MAINSTREAM_TYPES` has `ok` and an `oldest_ts` that is not later than the event's first member (the feed
reaches back to the start of the event). A single regional paper's article never gets a label. If a mainstream feed failed, no event gets a label in that run (`counts.asymmetric.total` is 0 and
`board.asym_status` says why: `{"complete": false, "missing": [source ids]}`). The label names **the side that did carry it**, by type, and never says what the mainstream "did not
find": `官公庁の資料だけ`, `政党機関紙だけ` / `週刊誌だけ` / `地方紙だけ` (the types actually present, joined with ・), `海外の源だけ`, `国内主流の型だけ`. `asymmetry[].label_ja` carries the text;
`labels.json` -> `asym` has the generic names and `types` the short names.

### 20.4 Flag names, traps, order

- The flags keep their internal ids (`money`, `law`, `security`, `disaster`, `power`, `tech`); the **displayed name of `power` is a topic name: 政治と人事** (the voice aliases 権力 and 説明責任 stay); `money` keeps 公金
  (`law` 法, `security` 安保, `disaster` 災害, `tech` 技術 as before). `watchwords.json` `labels`, `board.flag_labels` and `labels.json` agree.
- `data/traps.json` (`parallax-traps/1`) is one table of reading traps applied to **place words, concept words and flag words alike**: a listed phrase is removed before the word is looked up
  (`米中間選挙` is a US election, not "米中" = US and China), and the phrase may name what it does mean (`reads: "US"`). A **bare word** is not enough for a place or for "domestic":
  `日本` / `Japan` alone does not put an event in Japan (domestic); it needs a second cue (a city or prefecture, 政府・首相・国会 ..., or a location marker). `cluster.PLACE_TRAPS`, `places.py` and `watch.py` read this table.
- PRIORITY order: **domestic money and law first** (an event with the `money` or `law` flag whose representative headline is Japanese-language and from a `jp` outlet), then the rest; inside each group by
  `weight x freshness` as before (`rules.priority_order`).
- `items[].type` is the kind of the outlet; `labels.json` -> `types[type]` = `{"short", "lead"}`: the page puts `short` before the headline when `lead` is true (weekly magazines, party papers, state media, think tanks, specialist).

### 20.5 One photo per event

`board.cases[sid].photo` = `{ "id", "url", "outlet", "type", "from" }` or `null`; `photo_skip` says why not (`single_outlet`, `incident`, `wire_only`, `no_image`).
Only an event with **two or more outlets** has one; one image per event; images of wire-service items (`通信社`) are never chosen, and an event about a crime or an accident is not given one
(`photo.INCIDENT_RE`, on the representative headline or a third of the member headlines). The image is loaded from the outlet's own server by the page; it is never copied. `images` (the old list) now holds at most this one photo.
`og:image` lookups (15) run only for events that could get a photo, and **obey robots.txt** (20.6).

### 20.6 robots.txt for og:image

Before an article page is requested, `/robots.txt` of its host is read once (kept in `data/og_robots.json`, 24 h, passed on by the cache) and the page is requested only if the rules allow the agent
`VECTOR-PARALLAX` for that path. A host whose robots.txt answers 401/403/5xx or cannot be reached is **not requested at all** in that run; one that answers 404 allows everything. `Crawl-delay` is
honoured (up to 10 s). `images.og_run` also counts `robots_hosts`, `robots_denied`, `robots_unreachable`, `skipped` (by reason) and lists `denied_hosts`.

### 20.7 Google News rows

An item read through Google News carries `via: "gnews"` and `media` (the outlet name Google gave); its `link` is still Google's redirect, but **no source display uses a `news.google.com` URL**: the page names the outlet and says
"Google ニュース経由". `sources[]` rows of Google News get `via: "google-news"` and `query` (the search words, e.g. `site:yomiuri.co.jp when:2d`, or the section name) so that the words used can be published.

### 20.8 Words and place names

- The label for a source with no new headline for 72 hours is **更新なし** (`labels.json` -> `stale`; the id `stale_72h` stays).
- USGS place strings (`207 km ESE of Hachijo-jima, Japan`) are written in Japanese in `quakes_world[].place` (`八丈島の東南東 約207 km`; an unknown town with a known country: `日本付近`; unknown: the original), directions in kanji,
  names from a table; the original is kept in `place_en`.

### 20.9 Withheld list (`data/withheld.json`, `parallax-withheld/1`)

`{ "sources": ["<source id>"], "items": ["<article (item) id>"], "photos": { "items": ["<article id>"], "sources": ["<source id>"] } }`: source ids, article ids and photo permissions only.
**No requester, no reason, no headline** is written in it. The build applies it before anything else: every item of a listed source or with a listed id is removed from the fetch, and the image of an item
(or of every item of a source) listed under `photos` is cleared. The description of an item (14.1) is a field of the item and goes with it. It is applied again to **the previous good version that is kept** (the `kept_previous` AI view and the file left in place when a build is refused),
so that what was withheld cannot come back from an earlier version (`withheld.scrub`). `latest.json.withheld` = `{ "sources", "items", "photos", "items_removed", "photos_cleared" }` (counts only).
The list is a tracked setting; a change is applied by a manual run of the workflow (20.1). Requests are received by GitHub Issues; the notice says that withholding here **does not reach copies or caches held by third parties**, and that a person concerned or a bereaved family
need only write the article's URL. **The workflow log never prints a headline** (only counts and ids).

### 20.10 AI and the rule flags: remove only

**Status: decided; the code does part of it.** Today the AI can only keep a flag the rules raise or leave it out (its `flags` are checked against the rules, 4.4: it can never add one). The explicit removal field with a reason and the `flags_removed` record below are not implemented yet.

The rules decide which flags an event has. The AI may **remove** a rule flag (it leaves it out of `flags` while the rules raise it) and may never add one. `ai.flags_removed` = `[{ "flag", "why": "ai_left_out" }]` is kept so the removal can be read; a
flag the AI proposes that the rules do not raise is vetoed as before (`flags_dropped`, 4.4). The page shows the rule flags; an AI removal is shown as removed, with its reason, not silently.
