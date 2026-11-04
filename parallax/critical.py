# -*- coding: utf-8 -*-
"""critical - the "scrutiny" file: investigative reporting, the Diet's questions and the government's answers, academic and NGO texts,
read straight from their own sites (CONTRACT 18.12). Stdlib only.

compose(now, prev=None, get=None, robots=None) -> dict for data/critical.json.

Floor (the same as everywhere else in this project):
  * It is a weight added beside the main reports, not a replacement. It never says which side is right, never gives a source a verdict
    or a left/right label, and never says that anyone "did not report" something.
  * Every item carries the KIND of its source (investigative / primary / academic / ngo) - a structural fact (what sort of body publishes it,
    or the position the speaker holds) - and nothing about its stance.
  * Headline, outlet, date and link only. No body text, no quotation of a speech. A figure, a date or a name that is not on the page is
    left out, never made up; a date that is only a year stays a year.
  * Reading only. Each host is asked at most once per 1.2 s, only where robots.txt allows our agent, and with this project's own
    User-Agent. What cannot be read becomes a status row with the reason; the previous items of that source are carried over for at most
    3 days and are marked as carried.
  * Not read here (so not in the file): sources that only a news aggregator could give, the Ministry of Finance budget documents (PDF),
    and the press-freedom index (its terms for re-use were not confirmed).
"""
import datetime as dt
import hashlib
import html
import json
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET

try:
    from parallax import feeds as _feeds
    from parallax import og as _og
    from parallax import primary
except ImportError:                                       # run from inside parallax/
    import feeds as _feeds  # type: ignore
    import og as _og  # type: ignore
    import primary  # type: ignore

SCHEMA = "parallax-critical/1"
JST = dt.timezone(dt.timedelta(hours=9))
HOST_GAP_S = 1.2
KEEP_PER_SOURCE = 8
KEEP_INTL = 5
ITEMS_MAX = 240
STALE_MAX_S = 3 * 86400
KOKKAI_DAYS = 200

KINDS = ("investigative", "primary", "academic", "ngo")
KIND_JA = {"investigative": "調査報道", "primary": "一次資料", "academic": "学術", "ngo": "NGO・国際団体"}
KIND_TAG = {"investigative": "調査", "primary": "一次", "academic": "学術", "ngo": "NGO"}

# The Diet-record themes: a fixed list, written into the file (`themes`) so that the words used are public. It is a choice of what to look
# for, not a measure of anything. (theme, search words, regular expressions that must occur in the speech for it to count)
KOKKAI_THEMES = (
    ("憲法違反", "憲法違反", ("憲法違反",)),
    ("防衛費", "防衛費", ("防衛費",)),
    ("防災予算", "防災 予算", (r"防災[^。]{0,15}予算", r"予算[^。]{0,15}防災")),
    ("裏金", "裏金", ("裏金",)),
    ("学術会議", "学術会議", ("学術会議",)),
    ("報道の自由", "報道の自由", ("報道の自由",)),
    ("公文書", "公文書", ("公文書",)),
)
JSTAGE_THEMES = ("立憲主義", "防衛費", "防災政策", "政治資金", "報道の自由", "学問の自由")
KOKKAI_URL = "https://kokkai.ndl.go.jp/api/speech?any=%s&recordPacking=json&maximumRecords=40&from=%s"
JSTAGE_URL = "https://api.jstage.jst.go.jp/searchapi/do?service=3&keyword=%s&count=12"

SOURCES = (
    {"id": "ourplanet", "name": "OurPlanet-TV", "kind": "investigative", "how": "feed", "scope": "JP", "url": "https://www.ourplanet-tv.org/?feed=rss2"},
    {"id": "iwj", "name": "Independent Web Journal", "kind": "investigative", "how": "feed", "scope": "JP", "url": "https://iwj.co.jp/wj/open/feed"},
    {"id": "propublica", "name": "ProPublica", "kind": "investigative", "how": "feed", "scope": "INT", "url": "https://www.propublica.org/feeds/propublica/main"},
    {"id": "intercept", "name": "The Intercept", "kind": "investigative", "how": "feed", "scope": "INT", "url": "https://theintercept.com/feed/?rss"},
    {"id": "icij", "name": "ICIJ", "kind": "investigative", "how": "feed", "scope": "INT", "url": "https://www.icij.org/feed/"},
    {"id": "kokkai", "name": "国会会議録", "kind": "primary", "how": "kokkai", "scope": "JP", "url": "https://kokkai.ndl.go.jp/"},
    {"id": "scj", "name": "日本学術会議", "kind": "academic", "how": "scj", "scope": "JP", "url": "https://www.scj.go.jp/"},
    {"id": "jstage", "name": "J-STAGE", "kind": "academic", "how": "jstage", "scope": "JP", "url": "https://api.jstage.jst.go.jp/searchapi/do"},
    {"id": "nichiben", "name": "日本弁護士連合会", "kind": "ngo", "how": "nichiben", "scope": "JP", "url": "https://www.nichibenren.or.jp/document/statement/year/%d.html"},
    {"id": "amnesty", "name": "アムネスティ日本", "kind": "ngo", "how": "amnesty", "scope": "JP", "url": "https://www.amnesty.or.jp/news/"},
)
_BY_ID = {s["id"]: s for s in SOURCES}
_GOV_ROLE = re.compile(r"大臣|副大臣|政務官|政府参考人|政府特別補佐人|長官|院長|総裁|局長|審議官|事務総長")


# ---------------------------------------------------------------------------------------------------------------------------------
def _strip(s):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _date_ts(date_s):
    """'YYYY-MM-DD' or 'YYYY' -> the epoch second of that day at noon JST, for ordering only (never printed as a time)."""
    m = re.match(r"^(\d{4})(?:-(\d{2})-(\d{2}))?", date_s or "")
    if not m:
        return 0
    try:
        return int(dt.datetime(int(m.group(1)), int(m.group(2) or 1), int(m.group(3) or 1), 12, tzinfo=JST).timestamp())
    except ValueError:
        return 0


def _date_of(ts):
    return dt.datetime.fromtimestamp(ts, JST).strftime("%Y-%m-%d") if ts else ""


def when(it):
    """Ordering key of an item: its time if it has one, else its date at noon."""
    return it.get("ts") or _date_ts(it.get("date"))


def _item(src, title, url, date="", ts=None, **extra):
    title = re.sub(r"\s+", " ", title or "").strip()
    ts = int(ts) if ts else None
    d = {"id": hashlib.sha1(("%s|%s" % (src["id"], url or title)).encode("utf-8")).hexdigest()[:12], "src": src["id"], "kind": src["kind"],
         "tag": KIND_TAG[src["kind"]], "source": src["name"], "title": title, "url": url or "", "date": date or _date_of(ts), "ts": ts,
         "scope": extra.pop("scope", src.get("scope", "JP"))}
    d.update(extra)
    return d


# --- pure parsers (no network) ---------------------------------------------------------------------------------------------------
def parse_feed(src, text, limit=KEEP_PER_SOURCE):
    out = []
    for it in _feeds.parse(text)[:60]:
        t, u = (it.get("title") or "").strip(), (it.get("link") or "").strip()
        if not t or not u.startswith("http"):
            continue
        out.append(_item(src, t, u, ts=it.get("ts")))
    out.sort(key=lambda x: (-when(x), x["id"]))
    return out[:limit]


_NICHIBEN = re.compile(r'href="(/document/statement/year/(\d{4})/(\d{2})(\d{2})(\d{2})(?:_\d+)?\.html)"[^>]*>(.*?)</a>', re.S)


def parse_nichiben(src, text, limit=KEEP_PER_SOURCE):
    """The year list of the Bar Association's statements. The date is the YYMMDD of the address, as the page prints it."""
    seen, out = set(), []
    for path, year, yy, mm, dd, inner in _NICHIBEN.findall(text or ""):
        t = _strip(inner)
        if not t or path in seen or not (1 <= int(mm) <= 12 and 1 <= int(dd) <= 31):
            continue
        seen.add(path)
        out.append(_item(src, t, "https://www.nichibenren.or.jp" + path, date="%s-%s-%s" % (year, mm, dd)))
    out.sort(key=lambda x: (-when(x), x["id"]))
    return out[:limit]


_AMN = re.compile(r'<a\b[^>]*href="(https://www\.amnesty\.or\.jp/news/(\d{4})/(\d{2})(\d{2})_\d+\.html)"[^>]*>(.*?)</a>', re.S)


def parse_amnesty(src, text, limit=12):
    """The news list. The link text runs 'kind title date country topic'; the title is what comes before the date."""
    seen, out = set(), []
    for url, year, mm, dd, inner in _AMN.findall(text or ""):
        if url in seen:
            continue
        seen.add(url)
        s = _strip(inner)
        m = re.search(r"\s(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日", s)
        title = s[: m.start()].strip() if m else s
        title = re.sub(r"^(?:国際事務局発表ニュース|国内ニュース|ニュース|声明|アクション|アムネスティ日本発表)\s*", "", title).strip()
        mc = re.search(r"国・地域：\s*(\S*)", s)
        country = mc.group(1) if mc else ""
        if not title:
            continue
        out.append(_item(src, title, url, date="%s-%s-%s" % (year, mm, dd), scope="JP" if country == "日本" else "INT", country=country))
    out.sort(key=lambda x: (-when(x), x["id"]))
    return out[:limit]


_SCJ = re.compile(r'href="(/ja/info/kohyo/(\d{4})(\d{2})(\d{2})_[^"]+\.html)"[^>]*>(.*?)</a>', re.S)


def parse_scj(src, text, limit=KEEP_PER_SOURCE):
    """The new items on the Science Council's top page (proposals, reports, statements). The date is the YYYYMMDD of the address."""
    seen, out = set(), []
    for path, y, m, d, inner in _SCJ.findall(text or ""):
        t = _strip(inner)
        if not t or path in seen:
            continue
        seen.add(path)
        out.append(_item(src, t, "https://www.scj.go.jp" + path, date="%s-%s-%s" % (y, m, d)))
    out.sort(key=lambda x: (-when(x), x["id"]))
    return out[:limit]


_ATOM = "{http://www.w3.org/2005/Atom}"


def _lang_text(el, name):
    """An element with a child per language (<article_title><ja>..</ja><en>..</en>) -> the Japanese text, else the English."""
    node = el.find(name)
    if node is None:
        node = el.find(_ATOM + name)
    if node is None:
        return ""
    vals = {c.tag.split("}")[-1]: (c.text or "").strip() for c in node}
    return vals.get("ja") or vals.get("en") or (node.text or "").strip()


def parse_jstage(src, text, theme="", per=3):
    """The J-STAGE search API (service 3). An entry without a title or a link is dropped. The date is the year of issue only (a month or a
    day is never invented)."""
    try:
        root = ET.fromstring((text or "").encode("utf-8"))
    except ET.ParseError:
        return []
    out = []
    for e in root.findall(_ATOM + "entry"):
        title, link = _lang_text(e, "article_title"), _lang_text(e, "article_link")
        if not title or not link.startswith("http"):
            continue
        year = (e.findtext("pubyear") or e.findtext(_ATOM + "pubyear") or "").strip()
        out.append(_item(src, title, link, date=year if re.match(r"^\d{4}$", year) else "", theme=theme,
                         journal=_lang_text(e, "material_title")))
    out.sort(key=lambda x: (-when(x), x["id"]))
    return out[:per]


def parse_kokkai(src, text, theme, words, per=3):
    """The Diet-record API (speech). The header row (speaker 会議録情報) is dropped; a speech counts only if one of `words` occurs in it.
    side = 'gov' when the speaker's position is a government one (minister, vice-minister, parliamentary secretary, government witness,
    director-general ...), else 'member'. Nothing of the speech text is kept: meeting, speaker, position and link only."""
    try:
        d = json.loads(text)
    except ValueError:
        return []
    gov, mem = [], []
    for r in d.get("speechRecord") or []:
        sp = r.get("speaker") or ""
        if not sp or sp == "会議録情報":
            continue
        body = re.sub(r"\s+", " ", r.get("speech") or "")
        if not any(re.search(w, body) for w in words):
            continue
        role = ((r.get("speakerPosition") or "") + " " + (r.get("speakerRole") or "")).strip()
        side = "gov" if _GOV_ROLE.search(role) else "member"
        group = r.get("speakerGroup") or ""
        who = sp + (("（" + group + "）") if group and side == "member" else (("（" + role + "）") if role else ""))
        title = " ".join(x for x in (r.get("nameOfHouse"), r.get("nameOfMeeting"), r.get("issue")) if x)
        url = r.get("speechURL") or r.get("meetingURL") or ""
        if not url.startswith("http"):
            continue
        (gov if side == "gov" else mem).append(_item(src, title, url, date=r.get("date") or "", theme=theme, side=side, who=who))
    gov.sort(key=lambda x: (-when(x), x["id"]))
    mem.sort(key=lambda x: (-when(x), x["id"]))
    # the questioner and the answerer get the same weight; if one side is absent from the hits it is left absent, not filled by the other
    k = max(1, per // 2 + per % 2)
    return (mem[:k] + gov[: per - min(k, len(mem))]) if gov else mem[:per]


# --- the network ----------------------------------------------------------------------------------------------------------------
class _Reader:
    """GET with a robots.txt check and a gap per host. `get` replaces the network in tests (then nothing sleeps and robots is not asked)."""

    def __init__(self, get=None, robots=None):
        self.get, self.last = get, {}
        self.robots = robots if robots is not None else (None if get else _og.Robots())

    def __call__(self, url):
        if self.get:
            return self.get(url)
        ok, why, wait = self.robots.check(url)
        if not ok:
            raise PermissionError("robots.txt: " + (why or "denied"))
        host = urllib.parse.urlsplit(url).netloc.lower()
        gap = max(HOST_GAP_S, wait or 0)
        left = gap - (time.monotonic() - self.last.get(host, -1e9))
        if left > 0:
            time.sleep(left)
        try:
            return primary._get(url, 25)
        finally:
            self.last[host] = time.monotonic()


def fetch_source(src, read, now):
    """One source -> {"items": [...], "extra": {...}}. A failure is an exception (the reason goes in the status row)."""
    how = src["how"]
    if how == "feed":
        return {"items": parse_feed(src, read(src["url"]), limit=KEEP_PER_SOURCE if src["scope"] == "JP" else KEEP_INTL)}
    if how == "nichiben":
        y = dt.datetime.fromtimestamp(now, JST).year
        items = parse_nichiben(src, read(src["url"] % y))
        if len(items) < KEEP_PER_SOURCE:                    # early in the year the last year's list fills up
            items += parse_nichiben(src, read(src["url"] % (y - 1)))
            items.sort(key=lambda x: (-when(x), x["id"]))
        return {"items": items[:KEEP_PER_SOURCE]}
    if how == "amnesty":
        return {"items": parse_amnesty(src, read(src["url"]))}
    if how == "scj":
        return {"items": parse_scj(src, read(src["url"]))}
    if how == "jstage":
        items, errs, why = [], [], ""
        for th in JSTAGE_THEMES:
            try:
                items += parse_jstage(src, read(JSTAGE_URL % urllib.parse.quote(th)), theme=th, per=3)
            except Exception as e:                           # one theme failing does not stop the others
                errs.append("%s:%s" % (th, type(e).__name__))
                why = why or str(e)[:60]
        if not items and errs:
            raise RuntimeError("J-STAGE API: %s (%d of %d themes failed)" % (why or errs[0], len(errs), len(JSTAGE_THEMES)))
        return {"items": _dedupe(items), "extra": {"theme_errors": errs}}
    if how == "kokkai":
        frm = _date_of(now - KOKKAI_DAYS * 86400)
        items, errs, why = [], [], ""
        for th, q, words in KOKKAI_THEMES:
            try:
                items += parse_kokkai(src, read(KOKKAI_URL % (urllib.parse.quote(q), frm)), th, words, per=3)
            except Exception as e:
                errs.append("%s:%s" % (th, type(e).__name__))
                why = why or str(e)[:60]
        if not items and errs:
            raise RuntimeError("Diet-record API: %s (%d of %d themes failed)" % (why or errs[0], len(errs), len(KOKKAI_THEMES)))
        return {"items": _dedupe(items), "extra": {"theme_errors": errs}}
    raise RuntimeError("unknown way of reading: " + how)


def _dedupe(items):
    seen, out = set(), []
    for it in sorted(items, key=lambda x: (-when(x), x["id"])):
        if it["url"] and it["url"] not in seen:
            seen.add(it["url"])
            out.append(it)
    return out


def featured(items):
    """The newest item of each class, in a fixed order - a rule, not a ranking of importance."""
    def newest(pred):
        c = [i for i in items if pred(i)]
        return max(c, key=lambda i: (when(i), i["id"]))["id"] if c else None
    return {"investigative": newest(lambda i: i["kind"] == "investigative"),
            "diet_question": newest(lambda i: i["src"] == "kokkai" and i.get("side") == "member"),
            "diet_answer": newest(lambda i: i["src"] == "kokkai" and i.get("side") == "gov"),
            "academic": newest(lambda i: i["kind"] == "academic"),
            "ngo": newest(lambda i: i["kind"] == "ngo")}


def compose(now=None, prev=None, get=None, robots=None):
    now = int(time.time() if now is None else now)
    read = _Reader(get, robots)
    prev_items = {}
    prev_rows = {}
    if isinstance(prev, dict):
        for r in prev.get("sources") or []:
            if isinstance(r, dict) and r.get("id"):
                prev_rows[r["id"]] = r
        for it in prev.get("items") or []:
            if isinstance(it, dict) and it.get("src") in _BY_ID:
                prev_items.setdefault(it["src"], []).append(it)
    rows, items = [], []
    for src in SOURCES:
        row = {"id": src["id"], "name": src["name"], "kind": src["kind"], "scope": src["scope"], "url": src["url"].replace("%d", "<year>"),
               "ok": False, "n": 0, "fetched_at": now, "err": "", "terms_status": "unknown", "carried": 0}
        try:
            got = fetch_source(src, read, now)
            row["ok"], row["n"] = True, len(got["items"])
            if got.get("extra", {}).get("theme_errors"):
                row["err"] = "themes failed: " + ",".join(got["extra"]["theme_errors"])
            items += got["items"]
        except Exception as e:
            row["err"] = ("%s: %s" % (type(e).__name__, e))[:140]
            old = prev_rows.get(src["id"], {})
            at = old.get("fetched_at") if not old.get("carried") else old.get("carried_from")
            at = at or old.get("fetched_at")
            if prev_items.get(src["id"]) and isinstance(at, (int, float)) and now - at <= STALE_MAX_S:
                kept = [dict(i, carried=True) for i in prev_items[src["id"]]]
                items += kept
                row["carried"], row["carried_from"] = len(kept), int(at)
        rows.append(row)
    items = _dedupe(items)[:ITEMS_MAX]
    ok = [r for r in rows if r["ok"]]
    status = "fail" if not ok and not items else ("ok" if items else "zero")
    return {"schema": SCHEMA, "generated_at": now, "status": status,
            "note_ja": "調査報道・国会の質問と答弁・学術・NGO の各自の公開の頁から取った見出しと原典の URL。本文は載せない。主要報道に足す重りであり、置き換えではない。出どころの種類は源の性質で付けた札で、内容の評価ではない",
            "kinds": {k: {"ja": KIND_JA[k], "tag": KIND_TAG[k]} for k in KINDS},
            "sources": rows,
            "themes": {"kokkai": [{"theme": t, "query": q} for t, q, _w in KOKKAI_THEMES], "jstage": list(JSTAGE_THEMES),
                       "note_ja": "検索に使った語の一覧。何を探すかの選び方であって、何かを測った物ではない"},
            "credit": {"jstage": "J-STAGE", "kokkai": "国立国会図書館 国会会議録検索システム"},
            "featured": featured(items),
            "items": items,
            "counts": {"sources": len(rows), "ok": len(ok), "items": len(items), "carried": sum(r["carried"] for r in rows)}}
