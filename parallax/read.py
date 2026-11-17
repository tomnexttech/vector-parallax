# -*- coding: utf-8 -*-
"""read - read the bodies of the articles of the top events and write how each outlet wrote it (CONTRACT 27). Standard library only.

    python -m parallax.read [--data-dir data]           after the news build, hero and the rest: reads latest.json (+ hero.json), writes story["read"] into latest.json
    python -m parallax.read --sources                   which sources can be read and which refuse, with the evidence (robots.txt reads only, no article)

One line, drawn once: a source that has said no to machine reading is not read; every other source is read.
  said no = robots.txt disallows the path (for VECTOR-PARALLAX or *) or disallows Google-Extended (the AI use of this build is Gemini),
            the page itself says noai, the terms of the outlet forbid it (sources.TERMS "no"), the withheld list (CONTRACT 20.9) names it.
  Nothing is left out "to be safe". The evidence of every refusal (the robots line, the terms address) is kept in read.unread.
The body lives in memory for one build. It is never written (not to latest.json, not to the cache, not to a log): what is kept is the
comparison and quotations of at most QUOTE_MAX characters. Every sentence of the AI is checked against the body it was given.
"""
import argparse
import difflib
import hashlib
import html as htmlmod
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

try:
    from parallax import ai as ai_mod
    from parallax import feeds
    from parallax import og as og_mod
    from parallax import sources as sources_mod
    from parallax import validate as validate_mod
    from parallax import withheld as withheld_mod
except ImportError:                                   # run from inside parallax/
    import ai as ai_mod  # type: ignore
    import feeds  # type: ignore
    import og as og_mod  # type: ignore
    import sources as sources_mod  # type: ignore
    import validate as validate_mod  # type: ignore
    import withheld as withheld_mod  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = "parallax-read/1"
CACHE_SCHEMA = "parallax-read-cache/1"
READ_EVENTS = 10               # events compared per build = AI calls (one call per event)
READ_CALL_LIMIT = 10           # calls on the main model per build (a retry counts)
READ_FALLBACK_LIMIT = 10       # attempts on the fallback chain per build, counted apart
PER_EVENT_OUTLETS = 8          # bodies given to the AI for one event (the readable outlets, both sides, earliest first)
MAX_FETCH = 100                # article pages fetched per build
GAP_S = 1.5                    # between two requests to the same host
TIMEOUT_S = 12
DEADLINE_S = 780               # after this the build stops fetching and keeps what it has
MAX_HTML = 1500000
SENT_CHARS = 3500              # body characters given to the AI per outlet
KEEP_CHARS = 20000             # body characters kept in memory for the "does not write it" check
MIN_BODY = 200
QUOTE_MAX = 24                 # longest quotation kept (characters)
COPY_RUN = 18                  # a run of this many folded characters copied from a body drops the sentence
CACHE_TTL_S = 36 * 3600
CACHE_MAX = 80
AI_AGENT = "Google-Extended"   # the robots.txt name that refuses the AI use of this build (Gemini)
SIDE_ORDER = ("国内", "海外", "官公庁")
WHY_JA = {
    "robots": "サイトが機械による取得を断っている",
    "ai_refused": "サイトが AI による利用を断っている",
    "terms": "媒体の利用条件が機械による取得を認めていない",
    "relay": "Google ニュース経由で、元の記事のアドレスに辿れない",
    "unreachable": "サイトの取得ルール（robots.txt）を確かめられなかったので、この回は読んでいない",
    "fetch_failed": "取りに行ったが取れなかった",
    "paywall": "有料の壁があり、本文が読めない",
    "no_body": "ページから本文を取り出せなかった",
    "unusable": "AI の答えが検査に通らなかった",
    "cap": "1 回の構築の取得の上限で、この回は読んでいない",
}
REFUSALS = ("robots", "ai_refused", "terms")
VAGUE = ("に違いがある", "違いが見られる", "異なる視点", "を伝えている", "という点を書いている")


# ---------------------------------------------------------------- small tools
def fold(t):
    return validate_mod.fold(t)


def norm(t):
    return unicodedata.normalize("NFKC", t or "").lower()


def side_of(it):
    if it.get("type") == "政府一次":
        return "官公庁"
    return "海外" if it.get("home") == "intl" else "国内"


def original_url(link):
    """An item's article address. A Google News relay is followed only when the address is inside it (the old base64 form); else None."""
    if not isinstance(link, str) or not link.lower().startswith(("http://", "https://")):
        return None
    host = urllib.parse.urlsplit(link).netloc.lower()
    if host != "news.google.com":
        return link
    import base64
    m = re.search(r"/articles/([A-Za-z0-9_-]+)", link)
    if not m:
        return None
    t = m.group(1)
    try:
        raw = base64.urlsafe_b64decode(t + "=" * (-len(t) % 4))
    except Exception:
        return None
    u = re.search(rb"https?://[\x21-\x7e]+", raw)
    if not u:
        return None
    try:
        url = u.group(0).decode("ascii")
    except UnicodeDecodeError:
        return None
    return None if "news.google.com" in url else url


# ---------------------------------------------------------------- robots evidence
def rule_evidence(body, agents, path):
    """The robots.txt line that refuses path to the first of agents that has a group, as 'User-agent: X / Disallow: /y'. '' if none matches."""
    groups, cur, started = [], None, False
    for line in (body or "").splitlines():
        line = line.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        k, v = [x.strip() for x in line.split(":", 1)]
        k = k.lower()
        if k == "user-agent":
            if cur is None or started:
                cur, started = {"agents": [], "rules": []}, False
                groups.append(cur)
            cur["agents"].append(v)
        elif k in ("disallow", "allow") and cur is not None:
            started = True
            cur["rules"].append((k, v))
    for ag in agents:
        for g in groups:
            if any(a.lower() == ag.lower() for a in g["agents"]):
                best = None
                for k, v in g["rules"]:
                    if v and path.startswith(v.rstrip("*")) and (best is None or len(v) >= len(best[1])):
                        best = (k, v)
                if best and best[0] == "disallow":
                    return "User-agent: %s / Disallow: %s" % (ag, best[1])
                return ""
    return ""


def path_of(url):
    u = urllib.parse.urlsplit(url)
    return (u.path or "/") + (("?" + u.query) if u.query else "")


# ---------------------------------------------------------------- the page and its body
_BLOCK = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "blockquote", "section", "tr", "dd", "dt", "ul", "ol"}
_SKIP = {"script", "style", "noscript", "nav", "header", "footer", "aside", "form", "iframe", "svg", "button", "select", "template", "figure", "figcaption"}
_VOID = {"br", "img", "hr", "meta", "link", "input", "source", "wbr", "area", "base", "col", "embed", "param", "track"}
_BAD_CLASS = re.compile(r"comment|related|recommend|ranking|share|social|sns|breadcrumb|advert|(^|[-_ ])ad([-_ ]|$)|banner|newsletter|sidebar|pagination|taglist|tag-list|bookmark", re.I)
_BOILER = re.compile(r"^(copyright|©|\(c\)|photo\b|写真|関連記事|関連リンク|advertisement|広告|share\b|シェア|続きを読む|あわせて読みたい|最新ニュース|ランキング|sign up|subscribe|follow us|read more|related)", re.I)
_PAYWALL = re.compile(r"有料会員(限定|に登録)|会員限定|会員登録(を)?(して|すると)?(続き|全文)|続きは(有料|会員)|この記事は(有料|会員)|subscribers? only|subscribe to (continue|read)|sign in to (continue|read)|to continue reading|already a subscriber", re.I)


class _Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.blocks, self.cur = [], [], []
        self.ld, self._ld_on, self.meta = [], False, {}

    def _flush(self):
        t = re.sub(r"\s+", " ", "".join(self.cur)).strip()
        self.cur = []
        if t and not any(s[1] for s in self.stack):
            tags = {s[0] for s in self.stack}
            self.blocks.append((t, "article" in tags, "main" in tags))

    def handle_starttag(self, tag, attrs):
        a = dict((k, v or "") for k, v in attrs)
        if tag == "meta":
            n = (a.get("name") or a.get("property") or "").lower()
            if n:
                self.meta[n] = a.get("content", "")
            return
        if tag == "script" and "ld+json" in a.get("type", "").lower():
            self._ld_on = True
            self.ld.append("")
        if tag in _BLOCK:
            self._flush()
        if tag in _VOID:
            return
        bad = tag in _SKIP or bool(_BAD_CLASS.search(a.get("class", "") + " " + a.get("id", "")))
        self.stack.append((tag, bad))

    def handle_endtag(self, tag):
        if tag == "script":
            self._ld_on = False
        if tag in _BLOCK:
            self._flush()
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self._ld_on and self.ld:
            self.ld[-1] += data
        elif not any(s[1] for s in self.stack):
            self.cur.append(data)


def _ld_nodes(o):
    if isinstance(o, list):
        for x in o:
            yield from _ld_nodes(x)
    elif isinstance(o, dict):
        yield o
        for v in o.values():
            if isinstance(v, (list, dict)):
                yield from _ld_nodes(v)


def _boiler(t):
    return bool(_BOILER.match(t))


def _cjk(t):
    return sum(1 for ch in t if ord(ch) > 0x2e80)


def extract(html_text):
    """-> {"text", "paywall": bool, "noai": bool}. text = the article's paragraphs (JSON-LD articleBody when it is longer)."""
    p = _Page()
    try:
        p.feed(html_text or "")
        p._flush()
    except Exception:
        pass
    noai = "noai" in (p.meta.get("robots", "") + "," + p.meta.get("googlebot", "")).lower()
    body_ld, free = "", None
    for raw in p.ld:
        try:
            doc = json.loads(raw)
        except ValueError:
            continue
        for n in _ld_nodes(doc):
            ab = n.get("articleBody")
            if isinstance(ab, str) and len(ab) > len(body_ld):
                body_ld = htmlmod.unescape(re.sub(r"<[^>]+>", " ", ab))
            f = n.get("isAccessibleForFree")
            if f is not None and ("articleBody" in n or n.get("@type") in ("NewsArticle", "Article", "ReportageNewsArticle")):
                free = str(f).lower() not in ("false", "0")
    def usable(blocks):
        out, last = [], None
        for t, _a, _m in blocks:
            if t == last or _boiler(t):
                continue
            if len(t) >= (10 if _cjk(t) > len(t) // 4 else 25):
                out.append(t)
                last = t
        return out
    cands = [usable([b for b in p.blocks if b[1]]), usable([b for b in p.blocks if b[2]]), usable(p.blocks)]
    text = ""
    for c in cands:
        s = "\n".join(c)
        if len(s) >= MIN_BODY:
            text = s
            break
    if not text:
        text = "\n".join(max(cands, key=lambda c: len("".join(c)))) if any(cands) else ""
    body_ld = re.sub(r"\s+", " ", body_ld).strip()
    if len(body_ld) > len(text):
        text = body_ld
    wall = (free is False) or (bool(_PAYWALL.search(html_text or "")) and len(text) < 900)
    return {"text": text[:KEEP_CHARS], "paywall": bool(wall), "noai": noai}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


class Refused(Exception):
    def __init__(self, reason, evidence=""):
        super().__init__(reason)
        self.reason, self.evidence = reason, evidence


def _decode(raw, headers):
    ct = (headers.get("Content-Type") or "") if headers else ""
    m = re.search(r"charset=([\w-]+)", ct, re.I) or re.search(rb"<meta[^>]+charset=[\"']?([\w-]+)", raw[:4096], re.I)
    encs = []
    if m:
        c = m.group(1)
        encs.append(c.decode("ascii", "ignore") if isinstance(c, bytes) else c)
    for enc in encs + ["utf-8", "shift_jis", "euc_jp", "cp932"]:
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", "replace")


def fetch_page(url, allow, timeout=TIMEOUT_S, max_hops=3):
    """-> (html, headers). A redirect is followed by hand: the address it leads to is checked by allow(url) -> (ok, reason, evidence) first."""
    opener = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(context=feeds._ctx))
    for _ in range(max_hops + 1):
        req = urllib.request.Request(url, headers={"User-Agent": feeds.UA, "Accept": "text/html,*/*", "Accept-Language": "ja,en;q=0.8"})
        try:
            with opener.open(req, timeout=timeout) as r:
                ct = r.headers.get("Content-Type", "")
                if ct and "html" not in ct.lower() and "xml" not in ct.lower():
                    raise OSError("not html")
                return _decode(r.read(MAX_HTML), r.headers), r.headers
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
                url = urllib.parse.urljoin(url, e.headers["Location"])
                ok, why, ev = allow(url)
                if not ok:
                    raise Refused(why, ev)
                continue
            raise
    raise OSError("too many redirects")


# ---------------------------------------------------------------- who is read
class Reader:
    """gate(it) says whether an item's source has refused; read(it) fetches and extracts. getter(url) -> html | (html, headers) is for tests."""

    def __init__(self, robots, rules=None, getter=None, sleep=time.sleep, clock=time.monotonic, max_fetch=MAX_FETCH, gap_s=GAP_S, deadline_s=DEADLINE_S):
        self.robots, self.rules = robots, rules if rules is not None else withheld_mod.load()
        self.getter, self.sleep, self.clock = getter, sleep, clock
        self.max_fetch, self.gap_s = max_fetch, gap_s
        self.t0, self.last, self.fetched, self.denied = clock(), {}, 0, {}
        self.deadline_s = deadline_s

    def url_gate(self, url):
        """robots.txt only. -> (ok, reason, evidence, wait seconds). A host whose robots.txt cannot be read now is 'unreachable' (not a refusal)."""
        r = self.robots
        e = r._entry(urllib.parse.urlsplit(url).scheme + "://" + urllib.parse.urlsplit(url).netloc.lower())
        st = e.get("status", 0)
        if e.get("volatile") or st == 0 or st >= 500:
            return False, "unreachable", "robots.txt: HTTP %s" % (st or "no answer"), 0.0
        path = path_of(url)
        if st < 400:                                   # 401 / 403 / 404 ...: no rules in force (RFC 9309), the page decides
            ok, why, delay = r.check(url)
            if not ok:
                return False, "robots", rule_evidence(e.get("body", ""), [og_mod.ROBOTS_TOKEN, "*"], path) or "robots.txt", 0.0
            if not r.allows_agent(url, AI_AGENT):
                return False, "ai_refused", rule_evidence(e.get("body", ""), [AI_AGENT], path) or "User-agent: %s" % AI_AGENT, 0.0
            return True, "", "", delay
        return True, "", "", 0.0

    def gate(self, it):
        """-> (url | None, reason, evidence). reason "" = may be read."""
        if withheld_mod.gone(it, self.rules):
            return None, "robots", "withheld list"
        url = original_url(it.get("link"))
        if not url:
            return None, "relay", "news.google.com"
        src = sources_mod.by_id(it.get("source_id")) or {}
        if src.get("terms_status") == "no":
            return url, "terms", src.get("terms") or "terms of the outlet"
        ok, why, ev, _d = self.url_gate(url)
        if not ok:
            return url, why, ev
        return url, "", ""

    def read(self, it, url):
        """-> (text, reason). reason "" = text is the body."""
        if self.fetched >= self.max_fetch:
            return "", "cap"
        if self.clock() - self.t0 > self.deadline_s:
            return "", "cap"
        host = urllib.parse.urlsplit(url).netloc.lower()
        ok, why, ev, delay = self.url_gate(url)
        if not ok:
            return "", why
        if host in self.last:
            wait = max(self.gap_s, delay) - (self.clock() - self.last[host])
            if wait > 0:
                self.sleep(wait)
        self.fetched += 1
        try:
            if self.getter:
                got = self.getter(url)
                page, hdr = got if isinstance(got, tuple) else (got, {})
            else:
                def allow(u):
                    o, w, e, _ = self.url_gate(u)
                    return o, w, e
                page, hdr = fetch_page(url, allow)
        except Refused as e:
            self.last[host] = self.clock()
            self.denied[url] = e.evidence
            return "", e.reason
        except Exception:
            self.last[host] = self.clock()
            return "", "fetch_failed"
        self.last[host] = self.clock()
        if "noai" in ((hdr or {}).get("X-Robots-Tag", "") or "").lower():
            return "", "ai_refused"
        x = extract(page)
        if x["noai"]:
            return "", "ai_refused"
        if x["paywall"] and len(x["text"]) < 900:
            return "", "paywall"
        if len(x["text"]) < MIN_BODY:
            return "", "no_body"
        return x["text"], ""


# ---------------------------------------------------------------- choosing the events and the outlets
def members_digest(ids):
    return hashlib.sha256("\n".join(sorted(ids)).encode("utf-8")).hexdigest()


def pick_events(latest, hero, n=READ_EVENTS):
    """The first picks of hero.json (what the home shows), then the rest in the order of hero.candidates, up to n stories with two or more outlets."""
    stories = {s.get("sid"): s for s in latest.get("stories") or [] if isinstance(s, dict)}
    out, seen = [], set()
    for p in (hero or {}).get("picks") or []:
        sid = p.get("sid") if isinstance(p, dict) else None
        if sid in stories and sid not in seen:
            out.append(stories[sid])
            seen.add(sid)
    if len(out) < n:
        try:
            from parallax import hero as hero_mod
            for _t, s, _m, _c in hero_mod.candidates(latest, None):
                if s["sid"] not in seen:
                    out.append(s)
                    seen.add(s["sid"])
        except Exception:
            pass
    return [s for s in out if (s.get("n_outlets") or 0) >= 2][:n]


def one_per_outlet(members):
    """One item per outlet (the earliest), earliest first."""
    seen, out = set(), []
    for m in sorted(members, key=lambda m: (m.get("ts") or 0, m.get("id") or "")):
        if m.get("outlet") and m["outlet"] not in seen:
            seen.add(m["outlet"])
            out.append(m)
    return out


def balance(items, n):
    """Up to n items, alternating between the sides so both are read."""
    by = {k: [i for i in items if side_of(i) == k] for k in SIDE_ORDER}
    out = []
    while len(out) < n and any(by.values()):
        for k in SIDE_ORDER:
            if by[k] and len(out) < n:
                out.append(by[k].pop(0))
    return out


# ---------------------------------------------------------------- the question
def build_doc(rows):
    """rows = [{"ref","outlet","lang","side","at","title","text"}] -> JSON for <doc>. The body is cut at SENT_CHARS."""
    items = []
    for r in rows:
        d = {"ref": r["ref"], "outlet": r["outlet"], "lang": r["lang"], "side": r["side"], "at": r["at"], "body": r["text"][:SENT_CHARS]}
        if r.get("title"):
            d["title"] = r["title"]
        items.append(d)
    return json.dumps({"event": {"items": items}}, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------- the check
def _longest_run(a, b):
    if not a or not b:
        return 0
    return difflib.SequenceMatcher(None, a, b, autojunk=False).find_longest_match(0, len(a), 0, len(b)).size


def check_read(raw_text, rows, prompt, counts):
    """Check the AI's answer against the bodies it was given. rows: {ref: {"outlet","side","lang","sent","full","item"}}.
    Every sentence is dropped when: an anchor or a quotation is not in the body; a number or Latin word is not in the body (and for a Japanese
    body a katakana word too); a run of COPY_RUN characters is copied; it names the owner (CONTRACT 17); it judges; it says an outlet did not report.
    -> {"outlets":[...], "contrast","contrast_refs","domestic_vs_abroad","dva_refs"} | None."""
    lim = prompt["read"]["limits"]
    generic = prompt["summary"].get("generic_katakana") or []
    from parallax import build as build_mod
    try:
        ans = validate_mod._parse(raw_text)
    except ValueError:
        counts["json"] = counts.get("json", 0) + 1
        return None
    if not isinstance(ans, dict):
        counts["shape"] = counts.get("shape", 0) + 1
        return None
    names = " ".join(r["outlet"] for r in rows.values())
    folded = {ref: fold(r["sent"]) for ref, r in rows.items()}
    folded_full = {ref: fold(r["full"]) for ref, r in rows.items()}

    def bump(k):
        counts[k] = counts.get(k, 0) + 1

    def sentence(value, limit, refs, own_only=False):
        """a sentence grounded in the bodies of refs -> text | None"""
        t = validate_mod.clean(value, limit)
        if not t or t.endswith(validate_mod.ELLIPSIS):
            if t:
                bump("too_long")
            return None
        if build_mod.has_gate_name(t):
            bump("name_gate")
            return None
        mats = [rows[r]["sent"] for r in refs if r in rows]
        if validate_mod.judgement_hit(t, mats, prompt) or any(w in t for w in prompt["read"].get("judgement_ja", []) if w not in " ".join(mats)):
            bump("judgement")
            return None
        if validate_mod.silence_hit(t, prompt) or any(v in t for v in VAGUE):
            bump("vague_or_silence")
            return None
        f = fold(t)
        if any(_longest_run(f, folded[r]) >= COPY_RUN for r in refs if r in folded):
            bump("copied")
            return None
        material = norm("\n".join(mats) + "\n" + names)
        bad = validate_mod.ungrounded(t, material, set(), generic)
        if rows and all(rows[r]["lang"] != "ja" for r in refs if r in rows):
            bad = [b for b in bad if b.isascii()]       # a Japanese rendering of an English body: names in katakana cannot be matched
        if bad:
            bump("ungrounded")
            return None
        return t

    outs, seen_ref = [], set()
    for o in (ans.get("outlets") if isinstance(ans.get("outlets"), list) else []):
        if not isinstance(o, dict) or o.get("ref") not in rows or o["ref"] in seen_ref:
            continue
        ref = o["ref"]
        seen_ref.add(ref)
        row = rows[ref]
        focus = sentence(o.get("focus_ja"), lim["focus_ja"], [ref])
        facts = []
        for f in (o.get("facts") if isinstance(o.get("facts"), list) else []):
            if len(facts) >= lim["facts"] or not isinstance(f, dict):
                continue
            a = fold(validate_mod.clean(f.get("anchor"), 60))
            if len(a) < 3 or a not in folded[ref]:
                bump("anchor_missing")
                continue
            t = sentence(f.get("text_ja"), lim["fact_ja"], [ref])
            if t:
                facts.append(t)
        wording = []
        for w in (o.get("wording") if isinstance(o.get("wording"), list) else []):
            if len(wording) >= lim["wording"] or not isinstance(w, dict):
                continue
            q = validate_mod.clean(w.get("quote"), 200)
            if len(q) > QUOTE_MAX:
                bump("quote_long")
                continue
            if len(fold(q)) < 2 or fold(q) not in folded[ref] or build_mod.has_gate_name(q):
                bump("quote_missing")
                continue
            note = sentence(w.get("note_ja"), lim["note_ja"], [ref])
            if note:
                wording.append({"quote": q, "note": note})
        omits = []
        for m in (o.get("omits") if isinstance(o.get("omits"), list) else []):
            if len(omits) >= lim["omits"] or not isinstance(m, dict):
                continue
            src = m.get("from_ref")
            a = validate_mod.clean(m.get("anchor"), 60)
            if src not in rows or src == ref or len(fold(a)) < 3 or fold(a) not in folded[src]:
                bump("omit_unsupported")
                continue
            nums = {x.replace(",", "") for x in validate_mod._NUM_RE.findall(norm(a))}
            own_full = norm(rows[ref]["full"]).replace(",", "")
            if rows[ref]["lang"] == rows[src]["lang"]:
                absent = fold(a) not in folded_full[ref] and not any(n in own_full for n in nums)
            else:
                absent = bool(nums) and not any(n in own_full for n in nums)
            if not absent:
                bump("omit_unverifiable")
                continue
            t = sentence(m.get("text_ja"), lim["omit_ja"], [src, ref])
            if t:
                omits.append({"text": t, "from": rows[src]["item"]})
        if focus and facts:
            outs.append({"item": row["item"], "outlet": row["outlet"], "side": row["side"], "lang": row["lang"], "ref": ref,
                         "focus": focus, "facts": facts, "wording": wording, "omits": omits})
        else:
            bump("outlet_empty")
    if len(outs) < 2:
        return None
    live = {o["ref"] for o in outs}

    def comparison(key, rkey, limit, need_sides):
        refs = [r for r in (ans.get(rkey) if isinstance(ans.get(rkey), list) else []) if r in live]
        refs = list(dict.fromkeys(refs))
        if len(refs) < 2:
            if ans.get(key):
                bump("compare_refs")
            return "", []
        if need_sides and not ({"国内", "海外"} <= {rows[r]["side"] for r in refs}):
            bump("compare_sides")
            return "", []
        t = sentence(ans.get(key), limit, refs)
        return (t, [rows[r]["item"] for r in refs]) if t else ("", [])

    contrast, c_refs = comparison("contrast_ja", "contrast_refs", lim["contrast_ja"], False)
    dva, d_refs = comparison("domestic_vs_abroad_ja", "dva_refs", lim["dva_ja"], True)
    for o in outs:
        o.pop("ref", None)
    return {"outlets": outs, "contrast": contrast, "contrast_items": c_refs, "domestic_vs_abroad": dva, "dva_items": d_refs}


# ---------------------------------------------------------------- one build
def _read_cache(path):
    try:
        d = json.loads(Path(path).read_text(encoding="utf-8"))
        if isinstance(d, dict) and d.get("schema") == CACHE_SCHEMA and isinstance(d.get("entries"), dict):
            return d
    except (OSError, ValueError):
        pass
    return {"schema": CACHE_SCHEMA, "entries": {}}


def _why(code):
    return WHY_JA.get(code, code)


def compare_event(story, items, reader, provider, prompt, now, counts):
    """-> read dict (status ok|unread) or None when nothing was tried. Fetches the bodies, asks the AI once, checks the answer."""
    members = [items[i] for i in story.get("member_ids", []) if i in items]
    unread, rows, readable = [], {}, []
    for it in one_per_outlet(members):
        url, why, ev = reader.gate(it)
        if why:
            unread.append({"outlet": it["outlet"], "side": side_of(it), "item": it["id"], "why": why, "why_ja": _why(why), "evidence": ev})
        else:
            readable.append((it, url))
    chosen = sorted(balance([it for it, _u in readable], PER_EVENT_OUTLETS), key=lambda m: (m.get("ts") or 0, m.get("id") or ""))
    urls = {it["id"]: u for it, u in readable}
    for it in readable:
        if it[0] not in chosen:
            unread.append({"outlet": it[0]["outlet"], "side": side_of(it[0]), "item": it[0]["id"], "why": "cap", "why_ja": _why("cap"), "evidence": ""})
    docrows = []
    for it in chosen:
        text, why = reader.read(it, urls[it["id"]])
        if why:
            unread.append({"outlet": it["outlet"], "side": side_of(it), "item": it["id"], "why": why, "why_ja": _why(why),
                           "evidence": reader.denied.get(urls[it["id"]], "") if why in REFUSALS else ""})
            continue
        ts = it.get("ts")
        at = time.strftime("%Y-%m-%d %H:%M", time.gmtime((ts or 0) + 9 * 3600)) if isinstance(ts, (int, float)) else ""
        ref = "i%d" % (len(docrows) + 1)
        docrows.append({"ref": ref, "outlet": it["outlet"], "lang": it.get("lang") or "ja", "side": side_of(it), "at": at,
                        "title": it.get("title") or "", "text": text, "item": it["id"]})
    counts["bodies"] = counts.get("bodies", 0) + len(docrows)
    base = {"unread": unread[:16], "model": None, "at": int(now)}
    if len(docrows) < 2:
        counts["events_unread"] = counts.get("events_unread", 0) + 1
        return dict(base, status="unread", outlets=[], contrast="", contrast_items=[], domestic_vs_abroad="", dva_items=[])
    rp = prompt["read"]
    raw, err = provider.call(rp["system"], ai_mod.render_user_text(rp, build_doc(docrows)), rp["schema"])
    if err == "budget":
        counts["calls_skipped"] = counts.get("calls_skipped", 0) + 1
        return None
    counts["calls"] = counts.get("calls", 0) + 1
    if err or raw is None:
        counts["calls_failed"] = counts.get("calls_failed", 0) + 1
        counts.setdefault("errors", []).append(err or "shape")
        return None
    rmap = {r["ref"]: {"outlet": r["outlet"], "side": r["side"], "lang": r["lang"], "sent": r["text"][:SENT_CHARS], "full": r["text"], "item": r["item"]} for r in docrows}
    res = check_read(raw, rmap, prompt, counts.setdefault("dropped", {}))
    if not res:
        counts["events_failed"] = counts.get("events_failed", 0) + 1
        return None
    kept = {o["item"] for o in res["outlets"]}
    for r in docrows:
        if r["item"] not in kept:
            unread.append({"outlet": r["outlet"], "side": r["side"], "item": r["item"], "why": "unusable", "why_ja": _why("unusable"), "evidence": ""})
    base["unread"] = unread[:16]
    base["model"] = getattr(provider, "model", None)
    counts["events_read"] = counts.get("events_read", 0) + 1
    return dict(base, status="ok", **res)


def run_read(latest, hero, cache, prompt, provider, reader, now):
    """Puts story["read"] into latest (in place). cache is changed in place. -> run dict (counts only)."""
    items = latest.get("items") or {}
    stories = [s for s in latest.get("stories") or [] if isinstance(s, dict)]
    ver = prompt["read"].get("version")
    ents = cache["entries"]
    for k in [k for k, e in ents.items() if now - e.get("made_at", 0) > CACHE_TTL_S or e.get("version") != ver]:
        del ents[k]
    run = {"status": "off", "events": 0, "cache_hits": 0, "events_read": 0, "events_unread": 0, "events_failed": 0, "bodies": 0,
           "calls": 0, "calls_failed": 0, "calls_skipped": 0, "fetched": 0, "call_limit": READ_CALL_LIMIT, "fetch_limit": MAX_FETCH, "dropped": {}, "errors": []}
    dig = {s["sid"]: members_digest(s.get("member_ids", [])) for s in stories}
    for s in stories:
        s.pop("read", None)
        e = ents.get(dig[s["sid"]])
        if e:
            s["read"] = e["read"]
            run["cache_hits"] += 1
    if provider is None:
        run["status"] = "nokey"
        return run
    todo = [s for s in pick_events(latest, hero) if "read" not in s]
    run["events"] = len(todo)
    for s in todo:
        r = compare_event(s, items, reader, provider, prompt, now, run)
        if r is None:
            if run["calls_skipped"]:
                break
            continue
        s["read"] = r
        if r["status"] == "ok":
            ents[dig[s["sid"]]] = {"version": ver, "made_at": int(now), "read": r}
    live = set(dig.values())
    for k in [k for k in ents if k not in live]:
        del ents[k]
    if len(ents) > CACHE_MAX:
        for k in sorted(ents, key=lambda k: ents[k]["made_at"])[:len(ents) - CACHE_MAX]:
            del ents[k]
    run["fetched"] = reader.fetched
    run["status"] = "ok" if run["events_read"] or run["cache_hits"] else ("error" if run["calls_failed"] else "none")
    return run


def choose_provider(env, prompt):
    from parallax import build as build_mod
    key = (env.get("GEMINI_API_KEY") or "").strip()
    if not key or prompt["read"].get("enabled") is not True:
        return None
    rp = prompt["read"]
    name = rp.get("model") or prompt.get("summary_model")
    return ai_mod.GeminiProvider(key, name, timeout=180, max_output_tokens=rp.get("max_output_tokens") or ai_mod.DEFAULT_MAX_OUTPUT_TOKENS,
                                 budget=ai_mod.CallBudget(READ_CALL_LIMIT),
                                 fallback_models=build_mod.fallback_chain(prompt, "summary_fallback_model"),
                                 fallback_budget=ai_mod.CallBudget(READ_FALLBACK_LIMIT))


def _json(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write(path, obj):
    from parallax.extras import write_json
    write_json(path, obj)


def sources_report(latest, robots, rules=None):
    """-> rows [{"source","outlet","terms","status": "read"|reason,"evidence"}]. Robots.txt reads only, no article."""
    rules = rules if rules is not None else withheld_mod.load()
    r = Reader(robots, rules)
    seen, rows = {}, []
    for it in (latest.get("items") or {}).values():
        seen.setdefault(it.get("source_id"), it)
    for s in sources_mod.SOURCES:
        it = seen.get(s["id"])
        if s["id"] in rules["sources"]:
            rows.append({"source": s["id"], "outlet": s.get("outlet") or s["id"], "status": "robots", "evidence": "withheld list"})
            continue
        if not it:
            rows.append({"source": s["id"], "outlet": s.get("outlet") or s["id"], "status": "no_item", "evidence": ""})
            continue
        url, why, ev = r.gate(it)
        rows.append({"source": s["id"], "outlet": it.get("outlet"), "status": why or "read", "evidence": ev})
    return rows


def main(argv=None, env=None, getter=None, provider=None):
    ap = argparse.ArgumentParser(prog="python -m parallax.read")
    ap.add_argument("--data-dir", default=str(ROOT / "data"))
    ap.add_argument("--sources", action="store_true")
    a = ap.parse_args(argv)
    d = Path(a.data_dir)
    env = os.environ if env is None else env
    from parallax import build as build_mod
    latest = _json(d / "latest.json")
    if not latest:
        print("read: no latest.json (nothing done)", file=sys.stderr)
        return 0
    robots = og_mod.Robots(path=str(d / "og_robots.json"))
    if a.sources:
        rows = sources_report(latest, robots)
        by = {}
        for r in rows:
            by.setdefault(r["status"], []).append(r)
        for k, v in sorted(by.items()):
            print("%s %d" % (k, len(v)))
            for r in v:
                print("  %s (%s) %s" % (r["source"], r["outlet"], r["evidence"]))
        return 0
    prompt = build_mod.load_prompt()
    if "read" not in prompt:
        print("read: no read section in data/prompt.json", file=sys.stderr)
        return 0
    provider = provider if provider is not None else choose_provider(env, prompt)
    now = int(time.time())
    cache = _read_cache(d / "read_cache.json")
    reader = Reader(robots, getter=getter)
    try:
        run = run_read(latest, _json(d / "hero.json"), cache, prompt, provider, reader, now)
    except Exception as e:                                    # the previous files stay; the deploy goes on
        print("read FAILED (previous files kept): %s: %s" % (type(e).__name__, e), file=sys.stderr)
        return 0
    robots.save()
    latest["read_run"] = dict(run, at=now, model=getattr(provider, "model", None))
    _write(d / "latest.json", latest)
    _write(d / "read_cache.json", cache)
    print("read status=%s events=%d cache_hits=%d read=%d unread=%d failed=%d bodies=%d fetched=%d calls=%d/%d dropped=%s"
          % (run["status"], run["events"], run["cache_hits"], run["events_read"], run["events_unread"], run["events_failed"],
             run["bodies"], run["fetched"], run["calls"], READ_CALL_LIMIT, json.dumps(run["dropped"], sort_keys=True)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
