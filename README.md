# VECTOR PARALLAX

**Put the same event, as reported by Japanese and overseas outlets, side by side — and see who did not report it.**
同じ出来事を、日本と海外の媒体がどう報じたか（報じなかったか）を並べて見比べる。

Live page (GitHub Pages): <https://tomnexttech.github.io/vector-parallax/>

Entry to the Tokyo AI Hackathon 2026. Author: **VECTOR**. Licence: MIT.

---

## What it does / 何をするもの

Every 3 hours a GitHub Actions job reads the public RSS/Atom feeds of 52 feeds from 39 outlets (Japanese
public broadcasters, wire services, national and regional papers, government and central-bank bodies, and
overseas public and mainstream outlets), groups the headlines that are about the same event, and writes
`data/latest.json` (a build product: it is shipped in the Pages artifact together with the page and **never committed**, see "How it is delivered" below). The page (static HTML + ES modules, no build step, no external scripts) shows that file in
two ways, and **the difference between them is the point**:

* **RULES** — headlines grouped by word overlap only (deterministic Python, standard library only).
* **AI** — the same headlines regrouped by a language model: it can join a Japanese and an English headline
  about one event that the rules left apart, and split a group that only shares a topic. Where the AI call
  fails, the page falls back to the rules for those groups and says so (red `FALLBACK` mark). Text written by the
  AI carries an `AI` mark. In the public edition the AI still reads every headline to decide what belongs together,
  but its per-outlet focus line is not published for an outlet whose terms forbid redistribution (`no`) or allow only non-commercial use (`nc`;
  the page shows that outlet's name, time and link only), while the neutral one-line summary of the whole event is kept and is
  checked never to quote a headline. A second, cheaper model can add a neutral one-line summary to events without an AI headline (marked `AI`, with the model and the time); that stage is **switched off by default** (`summary.enabled` in `data/prompt.json`).

Each story lists which outlets covered it, when, with a link to each original item, and **why these headlines
were grouped** (shared words, shared place names, the time span). Filters show stories covered by `BOTH`
Japanese and overseas outlets, by `JP ONLY` or by `INTL ONLY`, and the AI's three flags (only overseas outlets
reported it / no Japanese mainstream outlet reported it / only government primary sources reported it). The
rules have the last word on those flags: a flag the data contradicts is removed and counted.

毎 3 時間、GitHub Actions が 52 の配信（39 媒体）の RSS を読み、同じ出来事の見出しを束ねて `data/latest.json` を
書きます。頁は同じデータを **RULES（語の重なりだけの規則）** と **AI（言語モデルが組み直した結果）** の二通りで
見せ、その違いが見せ所です。AI が通らなかった所は規則のまま赤で明示し、AI が書いた文には「AI」の札を付けます。

## Try it (for reviewers) / 触り方

1. Open the live page. The `GENERATED` stamp at the top is when the data was built; it turns **red** once it is
   older than 6 hours, so an old snapshot is never shown as current.
2. Switch `RULES` / `AI` and watch the story count and the groups change.
3. Use the chips (`BOTH`, `JP ONLY`, `INTL ONLY`, the flags) to see where Japanese and overseas coverage
   diverge, and `CHANGED` to see only the groups where RULES and AI disagree (`MERGED` / `SPLIT`). Open a story for
   the per-outlet view, the reason for the grouping, and the links.
4. `EVAL` shows how often the recorded AI run made a machine-countable mistake (invented ids, dropped items,
   duplicates, broken JSON, rejected flags, suspicious merges, place labels that match a known misreading such as
   the "米中" of "米中間選挙" read as China). Numbers come only from `data/eval.json`; if that file cannot be read
   it says "not measured". The rows for a human's verdict are left empty on purpose.
5. `SOURCES` lists every feed, whether it was fetched, when, and the link to the outlet's own terms page.
6. On a phone: the layout is for a 390 px wide screen and does not scroll sideways.

## What it does not do / しないこと

* It does not judge whether any report is true or false, and does not describe itself as a fact-check.
* It puts **no left/right (or any other) label on outlets**. The `type` of an outlet (public broadcaster, wire
  service, national paper, government source…) describes its form, not its stance.
* It does not publish article text or images: only headlines (where allowed, see below), links, outlet names,
  times, and short descriptions written by the AI or by the rules.
* It never shows an old value as a current one: every stamp carries the time the value was taken.

## Editions: public and local / 版

Headlines belong to their outlets. Parallax shows them **as quotations**: every headline is always shown with
the outlet's name, the time it was published and a link to the original article (CONTRACT §14, `rights_mode`
`quote`, the default). Article images are loaded from the outlet's own URL (`og:image` or the feed's media
field); nothing is copied into this repository. Article bodies are never included.

* **public** (what GitHub Pages serves, built with `--public`) and **local** show the same headlines in the
  default `quote` mode. The AI's per-outlet notes and its comparison are shown for every outlet.
* Each source still carries a `terms_status` (`ok` / `nc` / `no` / `unknown`, read from the outlet's own terms
  page) as information. The older restrictive behaviour is kept as `rights_mode` `strict` and can be switched on
  with `--rights strict`.
* What does not change in any mode: Parallax does not judge whether a report is true, puts no left/right labels
  on outlets, never says an outlet "did not report" something (it says the story was not found in the N feeds it
  fetched), and marks AI-written text as fallible.
* To ask for an item to be removed, open an issue: https://github.com/tomnexttech/vector-parallax/issues

見出しは引用の形で出します（媒体名・掲載の時刻・元の記事へのリンクを必ず添える・既定の `rights_mode` は `quote`）。
記事の画像は媒体の元の URL から読み込み、このリポジトリには複製しません。記事の本文は載せません。
公開版と手元の版の見出しは、既定では同じです。真偽を判定しない・媒体に左右の札を付けない・「報じなかった」と書かず
「取得した N 配信に見当たらない」と書く、は全ての版で変わりません。掲載の停止の依頼は GitHub の Issues へ。

## The AI, keys, and BYOK / AI と鍵

* **The site owner's key** exists only as the GitHub Actions secret `GEMINI_API_KEY`. It is read from the
  environment by the build, goes in a request header only, and appears in no file, page, URL or log. Without
  it, or when every Gemini call fails (HTTP 429, a refused schema, ...), the build **keeps the AI view of the last
  build that had one** instead of switching the AI off (`ai_run.status` `kept_previous`, with the reason `nokey` or
  `error`): that view is shown as a snapshot, labelled "AI の束ねは <time of that fetch> の取得による" with the time
  of its own answers (`ai_at`, red once older than 6 hours, independent of the rule data's `GENERATED` stamp), and it is
  never mixed into the current rule groups. With nothing to keep (no earlier file, or a damaged one) the status is
  plain `nokey` / `error` and the AI view is off, as before. `data/stats.json` carries the same `ai.status`, `ai.reason`
  and `ai.kept`; `docs/CONTRACT-public.md` section 12 has the table.
* **BYOK (optional)**: a visitor may paste their own Gemini API key into the `BYOK` panel to re-run the AI in
  their own browser. The key stays in the memory of that tab only, is never stored or put in a URL, and the only
  place it is sent to is Google's Gemini API (the page's Content-Security-Policy allows no other external destination).
  閲覧者ご自身の鍵・このタブのメモリだけ・送り先は Google だけ。
  Use a key from a project with no billing attached (free tier). In the public edition only groups whose
  headlines are all publishable can be re-sent, so that a hidden headline never leaves the build.
* **The recorded AI output is not Gemini's.** `data/recorded.json` holds the answers that **Claude** (Anthropic,
  model `claude-sonnet-5-5`) wrote by hand on the evening of 2026-11-04 (JST), acting as the model's part: it
  followed the same instructions and schema as the Gemini call (`data/prompt.json`) and its answers went through
  the same validator. The provider label is `claude-recorded`, and the page's AI RUN panel shows
  `RECORDED claude-sonnet-5-5` with the time it was written, which turns red after 6 hours. This run exists on the author's machine only
  (`data/recorded.json` quotes headline strings, so it is not in the repository; the author's own screens and the A4 sheet use it). **The public build never uses it:** with the
  `GEMINI_API_KEY` secret the AI view shows Gemini's answers; without it there is no AI view and the page shows the rules view only (a previous Gemini view, if the
  Actions cache holds one, is kept as a snapshot with its own time in red). `data/eval.json` is computed from the recorded run by
  `python -m parallax.eval`.
* **Not yet run against the live API (as of 2026-11-04):** the Gemini call code (`parallax/ai.py` for the build,
  `js/provider.js` for BYOK) is tested with fake transports only. Whether the two model names in `data/prompt.json`
  (`merge_model`, `summary_model`) and the response schemas are accepted by the live API, and whether the output limits (`maxOutputTokens` 16384 for the bundling,
  8192 for the summary) are enough for a full run, are unconfirmed until the first real run. After the first manual run, `data/stats.json` -> `ai.merge` and `ai.summary`
  (`calls_failed` 0, `provider` `gemini`, `model` the name in the prompt file) show that both were accepted.
* If the free quota or rate limit is hit (HTTP 429), the page says so in plain words. Both the build
  (`parallax/ai.py`) and the BYOK re-run in the browser (`js/provider.js`) retry a failed call at most twice
  (waiting 2 s, then 4 s), and only for 429, 5xx, timeouts and network errors; then the groups that did not
  get an answer fall back to the rules and are marked.

## AI cost / AI の費用

The build calls Gemini for the bundling (2 calls per build, fixed in code, a retry counts as a call; 8 builds a day = 16 of the 20 requests a day) and, when switched on, for a second job. Each job has its own model named in `data/prompt.json`
(`merge_model` and `summary_model`; no model name is written in code). Nothing in this repository sets up billing: use a key from a
project with no billing attached (free tier).

| job | model | free-tier RPM | RPD | TPM | what the build uses |
|---|---|---|---|---|---|
| bundling (the core: join and split events) | `gemini-3.6-flash` | 5 | 20 | 250K | at most 2 calls per build, one build every 3 hours: 2 x 8 = 16 a day |
| one neutral line per event (summary; **switched off by default**) | `gemini-3.5-flash-lite` | 15 | 500 | 250K | when switched on: at most 15 calls per build (45 events each), cached: 120 a day at the very most, far fewer once the cache is warm |

* **Source and date.** The numbers are what Google AI Studio's rate-limit page (https://aistudio.google.com/rate-limit, the page that
  https://ai.google.dev/gemini-api/docs/rate-limits points to for per-model values) showed for the default project, with the "free tier" badge,
  on 2026-11-04 (JST). The documentation page itself gives no per-model numbers, only that requests per day (RPD) reset at midnight Pacific
  time and that the stated limits are not guaranteed and actual capacity may vary. The model names were checked against the model list at
  https://ai.google.dev/gemini-api/docs/models on the same day (`gemini-3.6-flash` is listed as the previous-generation Flash model).
  Whether a model accepts `responseSchema` was not read from those pages; the first real run settles it (below).
* **Assumption.** The daily count is taken to be kept per model, so the summary job does not use up the bundling job's 20. If it is shared, the
  summary job's calls would crowd out the bundling: `ai.merge` and `ai.summary` in `data/stats.json` show it (a 429 on the bundling call ends in `kept_previous`).
* **Margin.** 16 of 20 leaves 4 requests a day, which is two manual runs. A third manual run on the same Pacific day can hit HTTP 429; the page then keeps the previous AI view
  and says so (`kept_previous`, reason `error`). The limit on calls per build is enforced by the build, not by hope: a retry after a 429 counts as a call
  (`CallBudget`), and the workflow runs one build at a time (`concurrency`), so a manual run cannot overlap a scheduled one.
* **The summary cache** (`data/summary_cache.json`, kept between runs by the Actions cache) means an event whose set of headlines has not changed is not asked for again. A new run asks only for
  events that are new or changed since the last run; with a 36-hour window and a 3-hour step that is a small part of the window (an estimate from the window arithmetic, not a
  measurement). If the cache is lost, one build asks for everything: 14 calls for the 600 events seen on 2026-11-04.
* **Requests per minute.** 14 summary calls in a row may touch RPM 15; the one spare call and the waiting before a retry (2 s, then 4 s) are the margin. Not yet measured against the live API.

## Run it locally / 手元で回す

Python 3.11+, standard library only. Nothing to install.

```bash
# local edition, rules only (no key needed). Writes outside data/ so nothing can be committed by accident.
python -m parallax.build --no-ai --out work/local/latest.json

# with the AI (your own key in the environment)
GEMINI_API_KEY=... python -m parallax.build --out work/local/latest.json     # PowerShell: $env:GEMINI_API_KEY="..."

# the public edition, as Actions builds it (then: python tools/assemble_site.py --out _site)
python -m parallax.build --public --og --extras --min-stories 300

python -m http.server 8000     # then open http://localhost:8000/?data=work/local/latest.json
```

`--min-stories N` makes the build refuse to overwrite the output (exit status 2) when a result fails its safety
check or has fewer than N stories, so the previous good file stays in place.

Tests: `python -m unittest discover -s tests` (Python) and `node --test tests/js/*.test.js` (the browser-side
validator, the BYOK caller and the re-run; needs Node.js 22 or newer). Before every push run `python tools/leakcheck.py`, which searches every file and every commit for
personal names and for `Co-Authored-By` lines.

## Layout / 構成

```
index.html  css/app.css  js/        the app (static; served from the Pages artifact that tools/assemble_site.py builds; installable as a PWA)
            js/app.js  provider.js (BYOK Gemini caller)  rerun.js (re-run the AI in the browser)  validate.js
            js/snapshot.js (reads a kept AI view)  js/summary.js (reads the one-line summaries)
            js/places.js (place names in Japanese, map view)  js/prefs.js (the visitor's watch list, kept in that browser only)
manifest.webmanifest  sw.js         PWA: the service worker is network-first (data and code are never served old while online)
assets/     icons/ (drawn by a short script, no image generator)  map/ne2/ (Natural Earth II tiles, public domain)
data/       prompt.json labels.json watchwords.json places.json traps.json withheld.json (settings, tracked)   latest.json board.json stats.json ... (build products, ignored)
parallax/   sources.py feeds.py cluster.py   fetch and rule grouping
            build.py ai.py validate.py eval.py   pipeline, Gemini caller, validator, evaluation
            board.py watch.py places.py   the board: the six-flag net, PRIORITY rules, places, per-event anatomy (CONTRACT 18)
            primary.py                    government pages without a feed: audit board, gazette, bills of both houses
            hazards.py markets.py politics.py extras.py   typhoons / disasters / earthquakes, public market data, Diet data
data/       board.json history.json politics.json hazards.json markets.json   the board, map, market and politics files
            watchwords.json places.json   the vocabulary of the six flags, the place table (428 names)
tests/      Python and Node tests (synthetic headlines only)
tools/      leakcheck.py
docs/       CONTRACT-public.md   the data contract (code comments cite it by this path or as "CONTRACT §n")
.github/workflows/update.yml     every 3 hours: build, check, deploy the Pages artifact (no data is committed)
```

## PROVENANCE: what was built when / 何がいつ作られたか

The hackathon work started on 2026-11-04. Part of the grouping and fetching code was moved from an earlier
private tool of the same author (a personal news-comparison tool that is not published and not under version
control). That is stated here so that the new work and the moved work can be told apart.

**Moved from the earlier private tool** (dates are file-system "last modified" times of the original files, read on
2026-11-04, JST; they are not a version-control history, so they bound when each file existed in that form
rather than prove when it was first written):

| file here | origin | the origin's time | what was changed here (line diff, measured 2026-11-04) |
|---|---|---|---|
| `parallax/cluster.py` | earlier `cluster.py` | oldest surviving backup of it last written 2026-09-27 08:36; version moved last written 2026-10-04 13:05 | 1446 of the 1491 lines are identical to the origin; 45 lines are new or changed, 79 origin lines were not carried over (includes the 2026-11-04 fix that stops the "米中" of "米中間選挙" being read as China) |
| `parallax/feeds.py` | earlier `feeds.py` | oldest surviving backup last written 2026-09-27 08:43; version moved last written 2026-09-27 18:25 | 361 of 367 lines identical; 6 new or changed |
| `parallax/sources.py` (part) | earlier `sources.py` | oldest surviving backup last written 2026-09-27 08:17; version used last written 2026-10-04 03:51 | all 52 feed addresses are taken from the earlier list; 131 of the 359 lines are identical, the rest is new (the terms table `TERMS`, `terms_status`, the fetch status fields, the public edition) |

The earlier tool's package folder was created on 2026-09-27 at 08:05 (file-system creation time); its first file is dated 08:06. Its other parts
(mail, market, media and other modules) were **not** moved into this repository.

**Moved from the earlier private tool on the night of 2026-11-04** (file-system "last modified" times of the originals, read the same night):

| file here | origin | the origin's time | what was done |
|---|---|---|---|
| `parallax/primary.py` | earlier `primary.py` (pages without a feed) | 2026-09-28 14:30 | moved whole: only the User-Agent, the environment variable name and comments were changed |
| `parallax/hazards.py` | earlier `hazards.py` (map hazard layers) | 2026-09-29 17:16 | the parsers and the typhoon / disaster / earthquake / tsunami rules moved as they were; the cache, the threads and the server part were replaced by one `fetch_all`; USGS was added |
| `parallax/places.py`, `data/places.json` | earlier `board.py`, the place table and the rules for weak mentions | 2026-10-04 13:06 | table (428 keys) and rules moved; the table became a data file; the entry point `locate` is new |
| `data/watchwords.json` | earlier word list of the six flags | 2026-11-04 11:44 | vocabulary moved (notes rewritten); the matching in `parallax/watch.py` is written new to the same scoring rules |
| `parallax/board.py` | rules of the earlier `board.py` (weight, freshness, outside-interest, asymmetry, volume, anatomy) | 2026-10-04 13:06 | written new from the rules; the constants are the earlier ones; lineage (history.json) and the event anatomy are new |
| `parallax/markets.py` | earlier `markets_ta.py` and `market.py` (indicators, JGB CSV) | 2026-09-29 17:13 / 2026-09-27 18:04 | indicators re-implemented to the same rules and the JGB CSV reading moved; the unofficial Yahoo endpoints were **not** moved; the sources are new |

**Written new from 2026-11-04**: `parallax/build.py`, `ai.py`, `validate.py`, `eval.py`, the rest of
`sources.py`; `data/prompt.json`; `index.html`, `css/app.css`, everything in `js/`, `sw.js`, `manifest.webmanifest`, the icons; the tests; `tools/`;
`docs/`; `.github/workflows/update.yml`; this README. `data/latest.json`, `stats.json`, `summary_cache.json`, `recorded.json` and
`eval.json` are generated outputs. The one-line summary stage (second model, cache, call budget) was added on 2026-11-04 (evening) to the same files. The commit history of this repository starts with this work: the moved files
appear in it as already-written files.

<!-- RESERVED (author's decision pending): one line on whether AI assistance was used to write the code goes here. -->

## Credits / data / 出典

Headlines and links belong to their outlets; each source row on the page links to that outlet's own terms page.
This project is not affiliated with any outlet. The test data in `tests/` is synthetic (headlines such as
"Test event A") and uses `example.org` links.

Data publishers (all read from their public endpoints, no key, one request at a time):
Japan Meteorological Agency (typhoons, earthquakes, tsunami; https://www.jma.go.jp/bosai/), GDACS (EC-JRC / UN OCHA; https://www.gdacs.org/),
USGS Earthquake Hazards Program (https://earthquake.usgs.gov/), Ministry of Finance Japan (JGB yields; CSV), U.S. Department of the Treasury
(par yield curve), European Central Bank (euro reference rates; source acknowledged as the ECB's terms ask), U.S. Energy Information Administration
via FRED (WTI and Brent spot), National Diet Library (Diet-record meeting list), and the Board of Audit, the Official Gazette, the House of
Representatives and the House of Councillors (their public pages). Stock indices and anything from unofficial endpoints are not included.
Market values are daily, carry the date of the observation, and are "material for judgement, not a recommendation to buy or sell".

How the sources are quoted: every headline appears as a quotation with the outlet's name, the time and a link to the article; article text is
never stored. The feeds added on 2026-11-04 (party announcements, weekly magazines, think tanks, specialist outlets) have `terms_status: unknown`
because their terms pages were not read; they are quoted the same way. The author accepts the risk of quoting and removes any item on request
(the Issues link below).

**Google News.** Where an outlet publishes no feed of its own (national papers, wire services, several regional papers, Reuters, AP and others), 36 of the 121 sources read Google News' public RSS (`kind: gn`, `parallax/gnews.py`; at most 30 newest headlines per source, two requests at a time). It is a reading of an aggregator's feed, not of the outlets' own feeds, and the project's author has decided to accept that (it is not a licence from the outlets or from Google): the headline is shown with the outlet's name, the time and a link; the link is Google News' redirect to the article; the outlet's name is the one at the end of the headline, matched against a table of exact names (`parallax/gnews.py`), and a headline whose outlet is not in the table, a re-distribution portal (Yahoo! News and similar), or an outlet whose own feed is already read, is dropped and counted (`sources[].dropped` in `latest.json`). The terms of Google News were not read for this version (`terms_status: unknown` on all 36 rows). Yahoo! News and unofficial mirrors are not used.

Article images are shown from the outlet's own server (the URL in the feed item or the article's `og:image`), with the outlet's
name and a link to the article; no image is copied into this repository. No image on the page is generated by an AI.

The place maps use **Natural Earth II** raster tiles (`assets/map/ne2/2/`, level 2 of 8 x 4 tiles, 256 px). Natural Earth states:
"All versions of Natural Earth raster + vector map data found on this website are in the public domain"
(https://www.naturalearthdata.com/about/terms-of-use/, read 2026-11-04). Made with Natural Earth.
The place names on the map come from the event's own text (AI headline, published titles, `basis.places`), not from a geocoder.

To ask for an item to be taken down: https://github.com/tomnexttech/vector-parallax/issues

## Licence and author

MIT — see `LICENSE`. Author: VECTOR.

## How it is delivered (CONTRACT 20.1)

Because every headline is shown as a quotation, a headline must not become an irrevocable entry in the public git history. So **nothing that holds a headline, an image URL
or the contents of a fetch is committed**: `data/latest.json`, `board.json`, `history.json`, `stats.json`, `eval.json`, `politics.json`, `hazards.json`, `markets.json`,
`summary_cache.json`, `recorded.json` and `og_robots.json` are build products (listed in `.gitignore`, not in the index). The repository keeps code, rules, the contract, tests and the
settings that hold no headline (`prompt.json`, `labels.json`, `watchwords.json`, `places.json`, `traps.json`, `withheld.json`).

The workflow `.github/workflows/update.yml` builds every 3 hours, assembles the page and the data into one folder (`tools/assemble_site.py`), uploads it with
`actions/upload-pages-artifact` and publishes it with `actions/deploy-pages`. What the next run needs (the kept previous AI view, the summary cache, the lineage history, the
robots.txt cache) is passed on through `actions/cache`. **Settings -> Pages -> Source must be "GitHub Actions".** A manual run ("Run workflow") rebuilds and redeploys at once.

**Withholding.** A source, an article id or a photo listed in `data/withheld.json` (`{"sources": [], "items": [], "photos": {"items": [], "sources": []}}`: ids only, no requester, no reason, no headline) is
removed before anything else at the next build, and also from the previous good version that is kept (so it cannot come back from there). To apply it without waiting 3 hours, run the workflow by hand
(Actions -> update-data -> Run workflow). Requests are taken through GitHub Issues. Withholding here **does not reach copies or caches held by third parties**. A person concerned, or a bereaved family, need only write the article's URL.
The workflow log prints counts and ids, never a headline.
