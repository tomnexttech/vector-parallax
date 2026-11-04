# -*- coding: utf-8 -*-
"""politics - the Diet, the gazette, the audit board and the parties, from public pages (CONTRACT 18.9). Stdlib only.

compose(items, now, get=None) -> dict for data/politics.json. `items` are the items this run fetched (they already include
the pages read by parallax/primary.py). Added here: the Diet session table and the list of recent committee / plenary meetings
of the National Diet Library's Diet-record API (metadata and links only, no speech text).

Floor: the parties and the Prime Minister's Office are listed side by side in a fixed neutral order (the Office first, the parties
alphabetically by name); no party and no outlet gets a colour or a verdict; nothing here says what a bill "means".
Whatever could not be read is listed under "failed" with the reason, and its section is empty - never filled.

Also here (CONTRACT 18.9): `elections` (the Ministry of Internal Affairs' result lists for governors and designated-city mayors: what was
held in the last 60 days and any row dated today or later) and `polls` (cabinet approval series of the pollsters, read from the wikitext of one
Wikipedia page with its revision id and the pollster's own source URL). Each carries `status` (ok | zero | fail) and `fetched_at`; a number,
date or result that could not be read is left out, never made up. Nothing here says who is right, who is ahead or what a figure means.
"""
import datetime as dt
import html
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request

try:
    from parallax import feeds as _feeds
    from parallax import og as _og
    from parallax import primary
except ImportError:                                       # run from inside parallax/
    import feeds as _feeds  # type: ignore
    import og as _og  # type: ignore
    import primary  # type: ignore

SCHEMA = "parallax-politics/1"
UA = _feeds.UA
KOKKAI = ("https://kokkai.ndl.go.jp/api/meeting_list?recordPacking=json&maximumRecords=30"
          "&from={frm}&until={to}")
STATUS_RX = re.compile(r"^〔([^〕]+)〕")
PER_PARTY = 5
BILLS_MAX = 40
GAZETTE_MAX = 24
AUDIT_MAX = 12


def _row(it):
    return {"id": it["id"], "outlet": it.get("outlet"), "title": it.get("title"), "link": it.get("link"), "ts": it.get("ts")}


def _newest(rows, n):
    return sorted(rows, key=lambda r: (-(r["ts"] or 0), r["id"]))[:n]


def bills_from(items):
    """Bills of both houses from the primary pages: the state is the bracket in front of the title (〔成立〕 etc.), as the page wrote it."""
    out = {"shugiin": [], "sangiin": []}
    counts = {"shugiin": {}, "sangiin": {}}
    for it in items:
        house = {"primary-shugiin": "shugiin", "primary-sangiin": "sangiin"}.get(it.get("source_id"))
        if not house:
            continue
        m = STATUS_RX.match(it.get("title") or "")
        st = m.group(1) if m else "?"
        counts[house][st] = counts[house].get(st, 0) + 1
        r = _row(it)
        r["status"] = st
        out[house].append(r)
    return {"counts": counts, "recent": {h: _newest(rows, BILLS_MAX) for h, rows in out.items()}}


def parties_from(items):
    by = {}
    for it in items:
        if it.get("type") == "政党機関紙":
            by.setdefault(it["outlet"], []).append(_row(it))
    return [{"outlet": o, "n": len(rows), "items": _newest(rows, PER_PARTY)} for o, rows in sorted(by.items())]


def kokkai_recent(now, get):
    frm = time.strftime("%Y-%m-%d", time.gmtime(now - 14 * 86400))
    to = time.strftime("%Y-%m-%d", time.gmtime(now))
    d = json.loads(get(KOKKAI.format(frm=frm, to=to)))
    out = []
    for m in d.get("meetingRecord") or []:
        out.append({"date": m.get("date"), "house": m.get("nameOfHouse"), "meeting": m.get("nameOfMeeting"),
                    "issue": m.get("issue"), "session": m.get("session"), "url": m.get("meetingURL")})
    return {"total": d.get("numberOfRecords"), "meetings": out}


# ---------------------------------------------------------------------------------------------------------------------------------
# Elections (CONTRACT 18.9). Only the Ministry of Internal Affairs and Communications' own pages are read (the private election-news site
# the earlier board also read is not: its terms were not confirmed). The ministry publishes result lists, not a calendar of coming votes:
# `upcoming` therefore holds a row only when one of the two lists carries a date of today or later, and it is usually empty - said, not filled.
# ---------------------------------------------------------------------------------------------------------------------------------
JST = dt.timezone(dt.timedelta(hours=9))
ELECTION_PAGES = (("governor", "都道府県知事選挙", "https://www.soumu.go.jp/senkyo/senkyo_s/data/chiji/index.html"),
                  ("mayor_designated", "指定都市市長選挙", "https://www.soumu.go.jp/senkyo/senkyo_s/data/shityou/index.html"))
ELECTION_RECENT_DAYS = 60
ELECTION_ROWS_MAX = 40
_ELECTION_LABEL = re.compile(r"日執行(.+)$")


def _ws(s):
    return re.sub(r"\s+", " ", s or "").strip()


def _nfkc(s):
    return unicodedata.normalize("NFKC", s or "")


def jst_today(now):
    return dt.datetime.fromtimestamp(now, JST).date()


def parse_soumu_results(text, base, kind):
    """A list page of the ministry -> [{"date","name","kind","url"}], in the page's order. A row is a link whose text reads
    「令和8年10月25日執行　福島県知事選挙」 (spaces and no-break spaces inside the date are dropped). A date that cannot be read drops the row.
    No row at all raises ValueError (the page changed: that is a failure, not an empty answer)."""
    out, seen = [], set()
    for m in re.finditer(r'<a\s+[^>]*href="([^"]+)"[^>]*>(.*?)</a>', text or "", re.S | re.I):
        label = _nfkc(html.unescape(re.sub(r"<[^>]+>", "", m.group(2)))).replace("\xa0", " ")
        label = re.sub(r"\s+", "", label)
        mm = _ELECTION_LABEL.search(label)
        if not mm or not mm.group(1):
            continue
        d = primary.wareki_to_date(label)
        if d is None:
            continue
        url = urllib.parse.urljoin(base, html.unescape(m.group(1)))
        key = (d.isoformat(), mm.group(1))
        if key in seen:
            continue
        seen.add(key)
        out.append({"date": d.isoformat(), "name": mm.group(1), "kind": kind, "url": url})
    if not out:
        raise ValueError("no result row in the list page")
    return out


def compose_elections(rows, today, now, pages):
    """rows: parsed rows of every page that could be read; pages: one status row per page read or tried.
    -> the `elections` object. status: ok = rows were read and at least one is in the window; zero = pages read, none in the window;
    fail = no page could be read."""
    cut = today - dt.timedelta(days=ELECTION_RECENT_DAYS)
    up, rec = [], []
    for r in rows:
        try:
            d = dt.date.fromisoformat(r["date"])
        except ValueError:
            continue
        row = {"date": r["date"], "name": r["name"], "kind": r["kind"], "url": r["url"], "source": "総務省"}
        if d >= today:
            up.append(row)
        elif d >= cut:
            rec.append(row)
    up.sort(key=lambda r: (r["date"], r["name"]))
    rec.sort(key=lambda r: (r["date"], r["name"]), reverse=True)
    read = [p for p in pages if p["ok"]]
    status = "fail" if not read else ("ok" if (up or rec) else "zero")
    return {"status": status, "fetched_at": now, "today": today.isoformat(), "window_days": ELECTION_RECENT_DAYS,
            "source": {"name": "総務省", "pages": pages,
                       "covers_ja": "都道府県知事選挙と指定都市市長選挙の結果の一覧。国政選挙・その他の市町村長選挙・議会の選挙は含まない",
                       "note_ja": "総務省の頁に今後の投票日の予定表は無い。upcoming は一覧に今日以降の日付の行がある時だけ入る"},
            "upcoming": up[:ELECTION_ROWS_MAX], "recent": rec[:ELECTION_ROWS_MAX],
            "counts": {"upcoming": len(up), "recent": len(rec), "rows_on_pages": len(rows)}}


def fetch_elections(now, page):
    """page(url) -> text. Each page is tried on its own: one failing leaves the other (its status row says which)."""
    rows, pages = [], []
    for kind, label, url in ELECTION_PAGES:
        st = {"kind": kind, "label_ja": label, "url": url, "ok": False, "n": 0, "err": ""}
        try:
            got = parse_soumu_results(page(url), url, kind)
            st["ok"], st["n"] = True, len(got)
            rows.extend(got)
        except Exception as e:
            st["err"] = ("%s: %s" % (type(e).__name__, e))[:120]
        pages.append(st)
    return compose_elections(rows, jst_today(now), now, pages)


# ---------------------------------------------------------------------------------------------------------------------------------
# Cabinet approval series (CONTRACT 18.9). One page of the English Wikipedia (CC BY-SA 4.0) is read through its API, once per run, with the
# revision id; every point keeps the pollster's own source URL when the page cites one. The page name changes after the next general
# election: a missing section is a failure, never an empty series. The check of the figures against headlines is not done.
# ---------------------------------------------------------------------------------------------------------------------------------
WIKI_POLL_PAGE = "Opinion polling for the next Japanese general election"
WIKI_API = ("https://en.wikipedia.org/w/api.php?action=parse&page={page}&prop=wikitext%7Crevid&format=json&formatversion=2&redirects=1")
WIKI_PERMA = "https://en.wikipedia.org/w/index.php?title={title}&oldid={revid}"
POLL_POINTS = 24
POLLSTER_JA = {                                          # translation only; a name not in the table is shown as the page wrote it
    "NHK": "NHK", "Jiji Press": "時事通信", "Kyodo News": "共同通信", "Asahi": "朝日新聞",
    "Mainichi/SSRC": "毎日新聞・社会調査研究センター", "Yomiuri/NNN": "読売新聞・NNN",
    "Nikkei/TV Tokyo": "日経・テレビ東京", "Sankei/FNN": "産経新聞・FNN", "ANN": "ANN（テレビ朝日系）",
    "JNN": "JNN（TBS系）", "Senkyo.com/JX": "選挙ドットコム・JX通信社",
}
_MONTHS = {m: i for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1)}
_RX_REF_DEF = re.compile(r"<ref\s+name\s*=\s*\"?([^\">/]+?)\"?\s*>(.*?)</ref>", re.S | re.I)
_RX_REF = re.compile(r"<ref\b([^>]*?)/>|<ref\b([^>]*)>(.*?)</ref>", re.S | re.I)
_RX_URL = re.compile(r"\|\s*url\s*=\s*(https?://[^\s|}<]+)", re.I)
_RX_NAME = re.compile(r"name\s*=\s*\"?([^\">/]+?)\"?\s*$", re.I)


def _num(s):
    """A printed figure -> int or float; anything else (a dash, a note, empty) -> None. Never 0 for 'not there'."""
    t = _nfkc(s).replace(",", "").replace("%", "").strip()
    if not re.fullmatch(r"\d+(?:\.\d+)?", t):
        return None
    f = float(t)
    return int(f) if "." not in t else f


def wiki_ref_urls(wikitext):
    """Named references -> {name: source URL} (a name can be defined anywhere on the page)."""
    out = {}
    for m in _RX_REF_DEF.finditer(wikitext or ""):
        u = _RX_URL.search(m.group(2))
        if u and m.group(1).strip() not in out:
            out[m.group(1).strip()] = u.group(1)
    return out


def _cite_urls(raw, refmap):
    urls = []
    for m in _RX_REF.finditer(raw or ""):
        attrs = (m.group(1) if m.group(1) is not None else m.group(2)) or ""
        u = _RX_URL.search(m.group(3) or "")
        url = u.group(1) if u else None
        if url is None:
            n = _RX_NAME.search(attrs.strip())
            url = refmap.get(n.group(1).strip()) if n else None
        if url and url not in urls:
            urls.append(url)
    for m in re.finditer(r"(?<!\[)\[(https?://[^\s\]]+)\s+[^\]]+\]", _RX_REF.sub("", raw or "")):
        if m.group(1) not in urls:                       # an external link printed in the cell itself
            urls.append(m.group(1))
    return urls


def _templates(s):
    """Top-level {{ ... }} with nesting -> [(start, end, inner)]."""
    out, depth, start, i = [], 0, None, 0
    while i < len(s) - 1:
        two = s[i:i + 2]
        if two == "{{":
            if depth == 0:
                start = i
            depth += 1
            i += 2
            continue
        if two == "}}" and depth:
            depth -= 1
            i += 2
            if depth == 0:
                out.append((start, i, s[start + 2:i - 2]))
            continue
        i += 1
    return out


def _wiki_text(raw):
    """A table cell's wikitext -> the printed text (references, notes and colour templates dropped; abbr keeps the short form)."""
    s = _RX_REF.sub("", raw or "")
    out, last = [], 0
    for a, b, inner in _templates(s):
        out.append(s[last:a])
        parts = inner.split("|")
        if parts[0].strip().lower() == "abbr" and len(parts) > 1:
            out.append(parts[1])
        last = b
    out.append(s[last:])
    s = "".join(out)
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[https?://[^\s\]]+\s+([^\]]+)\]", r"\1", s)
    s = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("'''", "").replace("''", "")
    return _ws(html.unescape(s))


def _split_top(s, sep):
    """Cut at sep ('||' or '!!') outside {{ }} and [[ ]]."""
    parts, depth, cur, i = [], 0, [], 0
    while i < len(s):
        two = s[i:i + 2]
        if two in ("{{", "[["):
            depth += 1
            cur.append(two)
            i += 2
            continue
        if two in ("}}", "]]") and depth:
            depth -= 1
            cur.append(two)
            i += 2
            continue
        if depth == 0 and two == sep:
            parts.append("".join(cur))
            cur = []
            i += 2
            continue
        cur.append(s[i])
        i += 1
    parts.append("".join(cur))
    return parts


def _cell_body(s):
    """'attributes | content' -> content (cut at the first single | outside {{ }} and [[ ]])."""
    depth, i = 0, 0
    while i < len(s):
        two = s[i:i + 2]
        if two in ("{{", "[["):
            depth += 1
            i += 2
            continue
        if two in ("}}", "]]") and depth:
            depth -= 1
            i += 2
            continue
        if depth == 0 and s[i] == "|":
            return s[i + 1:]
        i += 1
    return s


def parse_wikitable(block):
    """{| ... |} -> {"labels": [...], "rows": [[raw cells]]}. Lines are joined while a <ref> or {{ is open, so that a newline inside a
    reference is not taken for a cell boundary. Labels are the head row with the most printed cells among the first two."""
    lines, buf = [], ""
    for ln in block.split("\n"):
        buf = ln if not buf else buf + "\n" + ln
        opened = len(re.findall(r"<ref\b[^>/]*>", buf, re.I)) - len(re.findall(r"</ref>", buf, re.I))
        if opened > 0 or buf.count("{{") - buf.count("}}") > 0:
            continue
        lines.append(buf)
        buf = ""
    if buf:
        lines.append(buf)
    rows, cur = [], None
    for ln in lines[1:]:
        s = ln.strip()
        if s.startswith("|}"):
            break
        if s.startswith("|-"):
            cur = None
            continue
        if s.startswith("|+") or not s:
            continue
        if s[0] in "!|":
            head = s[0] == "!"
            if cur is None:
                cur = {"head": head, "cells": []}
                rows.append(cur)
            for p in _split_top(s[1:], "!!" if head else "||"):
                cur["cells"].append(_cell_body(p))
        elif cur is not None and cur["cells"]:
            cur["cells"][-1] += "\n" + ln
    heads = [r for r in rows if r["head"]]
    labels = []
    if heads:
        first = max(heads[:2], key=lambda r: sum(1 for c in r["cells"] if _wiki_text(c)))
        labels = [_wiki_text(c) for c in first["cells"]]
    return {"labels": labels, "rows": [r["cells"] for r in rows if not r["head"]]}


def parse_opdrts(raw):
    """{{Opdrts|26|27|Sep|2026}} (or the printed '26-27 Sep 2026') -> (first day, last day) as dates; (None, None) when not readable."""
    m = re.search(r"\{\{\s*opdrts\s*\|([^}]*)\}\}", raw or "", re.I)
    if m:
        toks = [t.strip() for t in m.group(1).split("|") if t.strip() and "=" not in t]
        sig, vals = "", []
        for t in toks:
            if re.fullmatch(r"\d{4}", t):
                sig += "Y"
                vals.append(int(t))
            elif re.fullmatch(r"\d{1,2}", t):
                sig += "D"
                vals.append(int(t))
            elif t[:3].lower() in _MONTHS:
                sig += "M"
                vals.append(_MONTHS[t[:3].lower()])
            else:
                return None, None
        try:
            if sig == "DDMY":
                d1, d2, mo, y = vals
                return dt.date(y, mo, d1), dt.date(y, mo, d2)
            if sig == "DMY":
                d, mo, y = vals
                return dt.date(y, mo, d), dt.date(y, mo, d)
            if sig == "DMDMY":
                d1, m1, d2, m2, y = vals
                return dt.date(y, m1, d1), dt.date(y, m2, d2)
            if sig == "DMYDMY":
                d1, m1, y1, d2, m2, y2 = vals
                return dt.date(y1, m1, d1), dt.date(y2, m2, d2)
        except ValueError:
            return None, None
        return None, None
    t = _nfkc(_wiki_text(raw))
    m = re.search(r"(\d{1,2})(?:\s*[–\-]\s*(\d{1,2}))?\s+([A-Za-z]{3,9})\.?\s+(\d{4})", t)
    if m and m.group(3)[:3].lower() in _MONTHS:
        mo, y = _MONTHS[m.group(3)[:3].lower()], int(m.group(4))
        try:
            return dt.date(y, mo, int(m.group(1))), dt.date(y, mo, int(m.group(2) or m.group(1)))
        except ValueError:
            return None, None
    return None, None


def _sections(wikitext):
    """[(level, heading, body)]; a body runs to the next heading of the same or a higher level."""
    heads = [(m.start(), m.end(), len(m.group(1)), _ws(m.group(2)))
             for m in re.finditer(r"^(={2,6})\s*(.*?)\s*\1\s*$", wikitext or "", re.M)]
    out = []
    for i, (a, b, lv, title) in enumerate(heads):
        end = len(wikitext)
        for a2, _b2, lv2, _t2 in heads[i + 1:]:
            if lv2 <= lv:
                end = a2
                break
        out.append((lv, title, wikitext[b:end]))
    return out


def _tables_with_context(text):
    """The tables of a body, each with the level-3 heading above it -> [(heading, wikitext)]."""
    out, ctx = [], None
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        ln = lines[i]
        h = re.match(r"^(={3,6})\s*(.*?)\s*\1\s*$", ln)
        if h and len(h.group(1)) == 3:
            ctx = _ws(h.group(2))
        if ln.lstrip().startswith("{|"):
            j, depth = i, 0
            while j < len(lines):
                s = lines[j].lstrip()
                if s.startswith("{|"):
                    depth += 1
                elif s.startswith("|}"):
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            out.append((ctx, "\n".join(lines[i:j + 1])))
            i = j + 1
            continue
        i += 1
    return out


def _col(labels, *prefixes):
    for i, lab in enumerate(labels):
        if any(lab.lower().startswith(p.lower()) for p in prefixes):
            return i
    return None


def parse_wiki_polls(wikitext):
    """The page's wikitext -> {"cabinet": [row], "skipped": n}; row = {"cabinet","start","end","pollster","sample","approve","disapprove",
    "undecided","cite_urls"}. A row whose cells do not line up with the head, or without a readable date or approval figure, is counted in
    `skipped` and left out. No cabinet-approval section raises ValueError, and so does a section with no readable row."""
    refmap = wiki_ref_urls(wikitext)
    cab, skipped, found = [], 0, False
    for lv, title, body in _sections(wikitext):
        if lv != 2 or "cabinet approval" not in title.lower():
            continue
        found = True
        for ctx, block in _tables_with_context(body):
            t = parse_wikitable(block)
            lab = t["labels"]
            ci = {k: _col(lab, *p) for k, p in (("date", ("Fieldwork",)), ("firm", ("Polling firm", "Pollster")), ("sample", ("Sample",)),
                                                ("app", ("Approve",)), ("dis", ("Disapprove",)), ("und", ("Und",)))}
            if ci["date"] is None or ci["firm"] is None or ci["app"] is None:
                continue
            for cells in t["rows"]:
                if len(cells) != len(lab):
                    skipped += 1
                    continue
                start, end = parse_opdrts(cells[ci["date"]])
                app = _num(_wiki_text(cells[ci["app"]]))
                if end is None or app is None:
                    skipped += 1
                    continue
                cab.append({"cabinet": ctx, "start": start.isoformat(), "end": end.isoformat(), "pollster": _wiki_text(cells[ci["firm"]]),
                            "sample": _num(_wiki_text(cells[ci["sample"]])) if ci["sample"] is not None else None, "approve": app,
                            "disapprove": _num(_wiki_text(cells[ci["dis"]])) if ci["dis"] is not None else None,
                            "undecided": _num(_wiki_text(cells[ci["und"]])) if ci["und"] is not None else None,
                            "cite_urls": _cite_urls(cells[ci["firm"]], refmap)})
    if not found:
        raise ValueError("no cabinet-approval section on the page")
    if not cab:
        raise ValueError("no readable row in the cabinet-approval tables")
    return {"cabinet": cab, "skipped": skipped}


def compose_polls(parsed, title, revid, now):
    """-> the `polls` object: one series per pollster, the newest POLL_POINTS points, each with the pollster's own source URL if cited."""
    slug = urllib.parse.quote((title or WIKI_POLL_PAGE).replace(" ", "_"))
    perma = WIKI_PERMA.format(title=slug, revid=revid) if revid else "https://en.wikipedia.org/wiki/" + slug
    by = {}
    for r in parsed["cabinet"]:
        by.setdefault(r["pollster"], []).append({
            "start": r["start"], "end": r["end"], "approve": r["approve"], "disapprove": r["disapprove"], "undecided": r["undecided"],
            "sample": r["sample"], "cabinet": r["cabinet"], "cite_url": (r["cite_urls"] or [None])[0], "cite_urls": r["cite_urls"][:3]})
    series = []
    for who, pts in by.items():
        pts.sort(key=lambda p: (p["end"], p["start"]))
        series.append({"pollster": who, "pollster_ja": POLLSTER_JA.get(who, who), "points": pts[-POLL_POINTS:]})
    series.sort(key=lambda s: (s["points"][-1]["end"], s["pollster"]), reverse=True)
    return {"status": "ok", "fetched_at": now,
            "source": {"name": "Wikipedia (English)", "title": title, "revid": revid, "url": perma,
                       "license": "CC BY-SA 4.0", "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
                       "note_ja": "英語版 Wikipedia の表から、各社の内閣支持・不支持の数を抜き出して並べた（数のみ・版を固定した頁の URL つき）。各社の原典は cite_url。見出しの数との照合はしていない"},
            "series": series,
            "counts": {"pollsters": len(series), "points": sum(len(s["points"]) for s in series), "skipped": parsed.get("skipped", 0)}}


def fetch_polls(now, get):
    """get(url) -> JSON text of the Wikipedia API."""
    d = json.loads(get(WIKI_API.format(page=urllib.parse.quote(WIKI_POLL_PAGE.replace(" ", "_")))))
    p = (d or {}).get("parse") or {}
    if not p.get("wikitext"):
        raise ValueError(((d or {}).get("error") or {}).get("info") or "page not found")
    return compose_polls(parse_wiki_polls(p["wikitext"]), p.get("title") or WIKI_POLL_PAGE, p.get("revid"), now)


def _failed_section(now, err, **extra):
    d = {"status": "fail", "fetched_at": now, "err": err}
    d.update(extra)
    return d


def _get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def compose(items, now=None, get=None, robots=None):
    """`get` replaces the network in tests (get(url) -> text). Without it the pages are read for real: through primary._get (it decodes
    Shift_JIS) and only where robots.txt of the host allows our agent (`robots` is an og.Robots)."""
    real = get is None
    now = int(time.time() if now is None else now)
    get = get or _get
    robots = robots if robots is not None else (_og.Robots() if real else None)

    def allowed(url):
        if robots is not None:
            ok, why, wait = robots.check(url)
            if not ok:
                raise PermissionError("robots.txt: " + (why or "denied"))
            if wait:
                time.sleep(wait)

    def page(url):                                     # HTML pages; decoding by the page's own declaration
        allowed(url)
        return primary._get(url, 25) if real else get(url)

    def api(url):                                      # JSON
        allowed(url)
        return get(url)

    failed = {}
    out = {"schema": SCHEMA, "generated_at": now, "failed": failed,
           "order_rule": "The Prime Minister's Office first, then the parties alphabetically by name. No colour, no ranking."}
    out["bills"] = bills_from(items)
    out["gazette"] = _newest([_row(i) for i in items if i.get("source_id") == "primary-kanpo"], GAZETTE_MAX)
    out["audit"] = _newest([_row(i) for i in items if i.get("source_id") == "primary-jbaudit"], AUDIT_MAX)
    out["office"] = _newest([_row(i) for i in items if i.get("source_id") in ("kantei",)], 8)
    out["parties"] = parties_from(items)
    for key, sid in (("bills", ("primary-shugiin", "primary-sangiin")), ("gazette", ("primary-kanpo",)), ("audit", ("primary-jbaudit",))):
        if not any(i.get("source_id") in sid for i in items):
            failed[key] = "no items from " + ", ".join(sid) + " in this run"
    try:
        out["kokkai"] = kokkai_recent(now, api)
    except Exception as e:
        out["kokkai"] = None
        failed["kokkai"] = ("%s: %s" % (type(e).__name__, e))[:160]
    try:
        txt = page(primary.SHU_KAIKI)                  # the page is Shift_JIS: primary decodes it
        sessions = primary.parse_shugiin_kaiki(txt)
        state = primary.session_state(sessions)
        out["session"] = json.loads(json.dumps({"sessions": sessions[:4] if isinstance(sessions, list) else sessions, "state": state},
                                               default=str, ensure_ascii=False))
    except Exception as e:
        out["session"] = None
        failed["session"] = ("%s: %s" % (type(e).__name__, e))[:160]
    try:
        out["elections"] = fetch_elections(now, page)
        if out["elections"]["status"] == "fail":
            failed["elections"] = "; ".join("%s %s" % (p["kind"], p["err"]) for p in out["elections"]["source"]["pages"])[:200]
    except Exception as e:
        out["elections"] = _failed_section(now, ("%s: %s" % (type(e).__name__, e))[:160], upcoming=[], recent=[])
        failed["elections"] = out["elections"]["err"]
    try:
        # The wiki's robots.txt keeps crawlers out of /w/; its documented route for programs is the action API (one request per run,
        # serial, with this project's identifying User-Agent: the API etiquette), so robots.check is not asked for this one host.
        out["polls"] = fetch_polls(now, get)
    except Exception as e:
        out["polls"] = _failed_section(now, ("%s: %s" % (type(e).__name__, e))[:160], series=[])
        failed["polls"] = out["polls"]["err"]
    return out
