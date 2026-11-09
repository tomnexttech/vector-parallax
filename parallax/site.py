# -*- coding: utf-8 -*-
"""site — the pages, feeds and the seven-day archive made from one build (CONTRACT 21). Stdlib only.

    events(latest, board) -> {sid: Event}          one event per board case (the same sid as the page's ?sid=), with the folded stories' reports
    big_news(evs, board) / one_side(evs) / by_field(evs)      the lists the feeds carry (the page's own rules, js/entry.js and js/sections.js)
    counts_line(ev) -> str                          "国内 4・海外 2・最初に報じたのは海外 1時間27分先"
    story_page(ev, base, ...) -> str                s/<sid>.html: OGP, Twitter card, canonical, the way into the page, the headlines without JS
    rss(...) -> str                                 RSS 2.0 (with atom:link self)
    merge_archive(prev, today_entries, ...)         the seven days, carried from the last deploy through the public URL
    write_site(out, latest, board, ...)             writes all of it into the Pages folder

Neutral by rule: no label of true or false and none of left or right; a side without a report is not named (the feeds never say an outlet did
not report); headlines and descriptions are quoted as published, never an article's text. The log prints counts, never a headline.
"""
import html
import json
import re
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from urllib.parse import quote

try:
    from parallax import coverage as coverage_mod
except ImportError:                                   # run from inside parallax/
    import coverage as coverage_mod  # type: ignore

BASE_URL = "https://tomnexttech.github.io/vector-parallax/"
SITE = "Parallax"
JST = timezone(timedelta(hours=9))
GOV = "政府一次"
SIDES = (("jp", "国内", "国内の報道"), ("intl", "海外", "海外の報道"), ("gov", "官公庁", "官公庁の発表"))
BRIEF_KEYS = ("what_ja", "background_ja", "views_ja", "next_ja")
BRIEF_LABELS = (("what_ja", "何が起きたか"), ("background_ja", "経緯"), ("views_ja", "伝え方の違い"), ("next_ja", "今後の焦点"))
UNKNOWN = "伝えられていない"
FIELDS = (("国内政治", "politics"), ("国際", "world"), ("経済", "economy"), ("安全保障", "security"),
          ("技術", "tech"), ("市場", "markets"), ("その他", "other"))
ONE_SIDE = {"jp": "国内だけ", "intl": "海外だけ", "gov": "官公庁だけ"}
ONE_SIDE_NOTE = "片側にしか見出しがないニュース。ほかの側に報道がないとは限りません。"
FEED_COUNTS = "国内、海外、官公庁の件数つき。"
FEED_MAX = 30          # items in one feed
HEADS_MAX = 40         # headlines on one page
TIMELINE_MAX = 16      # rows of the time line on one page
ARCHIVE_DAYS = 7
ARCHIVE_TOP = 30       # big news kept per day (ranked)
ARCHIVE_HEADS = 12     # headlines kept per archived event (so its page can be made again)
ARCHIVE_EVENTS = 200   # events kept per day (the big news and every other event a feed linked that day)
FETCH_TIMEOUT = 10
SID_RE = re.compile(r"^s[0-9a-f]{12}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ITEM_RE = re.compile(r"^[0-9A-Za-z_.:-]{1,64}$")
SCHEMA_INDEX = "parallax-archive/1"
SCHEMA_DAY = "parallax-archive-day/1"


def _s(v, n=300):
    return v.strip()[:n] if isinstance(v, str) else ""


def _int(v):
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def _brief(b):
    """story.brief (CONTRACT 13.1) as the page of an event keeps it: four strings, who wrote it and when. None when what_ja is empty or the shape is wrong"""
    if not isinstance(b, dict) or not _s(b.get("what_ja"), 300):
        return None
    out = {k: _s(b.get(k), 300) for k in BRIEF_KEYS}
    if not any(v and v != UNKNOWN for v in out.values()):    # nothing left to show: no frame (a row that says "not reported" is not shown)
        return None
    out["model"] = _s(b.get("model"), 80)
    out["made_at"] = _int(b.get("made_at"))
    return out


def _http(u):
    return u if isinstance(u, str) and re.match(r"^https?://", u) and len(u) <= 2000 and not re.search(r"[\s<>\"]", u) else None


def side_of(it):
    if it.get("type") == GOV:
        return "gov"
    return "intl" if it.get("home") == "intl" else "jp"


def outlet_of(it):
    return _s(it.get("media"), 80) or _s(it.get("outlet"), 80)


def _by_time(m):
    t = _int(m.get("ts"))
    return (t if t is not None else 1 << 62)


# ---------------------------------------------------------------- events

def _head(m, with_desc=True):
    h = {"id": _s(m.get("id"), 64), "src": _s(m.get("source_id"), 64), "side": m.get("side") or side_of(m), "outlet": outlet_of(m),
         "type": _s(m.get("type"), 30), "ts": _int(m.get("ts")), "title": _s(m.get("title"), 300) or None, "link": _http(m.get("link"))}
    if m.get("via") in ("gnews", "google-news"):
        h["via"] = "gnews"
    if with_desc and _s(m.get("desc"), 200):
        h["desc"] = _s(m.get("desc"), 200)
    return h


def make_event(sid, members, case=None, cat=None, brief=None):
    """one event from its member items (dicts of latest.items); case = board.cases[sid] or None"""
    case = case if isinstance(case, dict) else {}
    ms = sorted([m for m in members if isinstance(m, dict)], key=_by_time)
    heads = [_head(m) for m in ms]
    sides = {k: [h for h in heads if h["side"] == k] for k, _, _ in SIDES}
    rep = next((h for h in heads if h["id"] and h["id"] == case.get("rep_id") and h["title"]), None)
    rep = rep or next((h for h in heads if h["title"]), None)
    outlets = []
    for h in heads:
        if h["outlet"] and h["outlet"] not in outlets:
            outlets.append(h["outlet"])
    times = [h["ts"] for h in heads if h["ts"] is not None]
    photo = case.get("photo") if isinstance(case.get("photo"), dict) else None
    ph = {"url": _http(photo.get("url")), "outlet": _s(photo.get("outlet"), 80), "id": _s(photo.get("id"), 64)} if photo else None
    return {
        "sid": sid,
        "title": rep["title"] if rep else "・".join(outlets[:3]),
        "title_none": rep is None,
        "outlet": rep["outlet"] if rep else "",
        "title_id": rep["id"] if rep else "",
        "cat": _s(cat or case.get("cat"), 20) or "その他",
        "n_items": len(heads),
        "n_outlets": len(outlets),
        "sides": {k: len(v) for k, v in sides.items()},
        "side_outlets": {k: len({h["outlet"] for h in v if h["outlet"]}) for k, v in sides.items()},
        "first": {k: next((h["ts"] for h in v if h["ts"] is not None), None) for k, v in sides.items()},
        "first_ts": min(times) if times else None,
        "last_ts": max(times) if times else None,
        "first_id": heads[0]["id"] if heads else "",
        "photo": ph if ph and ph["url"] else None,
        "heads": heads[:HEADS_MAX],
        "score": case.get("score") if isinstance(case.get("score"), (int, float)) else 0,
        "brief": _brief(brief),
        "coverage": coverage_mod.clean(case.get("coverage")),      # CONTRACT 23: the table of the outlets (absent in an old board, or when it could not be made)
    }


def events(latest, board):
    """{sid: Event} for every board case whose story is in latest (CONTRACT 18.5): the lead of an event carries the reports of the stories it folded (18.11)"""
    items = latest.get("items") if isinstance(latest.get("items"), dict) else {}
    stories = {s["sid"]: s for s in latest.get("stories") or [] if isinstance(s, dict) and isinstance(s.get("sid"), str)}
    cases = (board or {}).get("cases") if isinstance((board or {}).get("cases"), dict) else {}
    out = {}
    for sid, c in cases.items():
        st = stories.get(sid)
        if not st or not SID_RE.match(sid):
            continue
        ids = [i for i in st.get("member_ids") or [] if isinstance(i, str)]
        ev = c.get("event") if isinstance(c, dict) else None
        if isinstance(ev, dict):
            for x in ev.get("sids") or []:
                if x != sid and x in stories:
                    ids += [i for i in stories[x].get("member_ids") or [] if isinstance(i, str) and i not in ids]
        members = [dict(items[i], id=i) for i in ids if isinstance(items.get(i), dict)]
        if members:
            out[sid] = make_event(sid, members, c, brief=st.get("brief"))
    return out


def _multi_side(ev):
    return sum(1 for k, _, _ in SIDES if ev["sides"][k]) >= 2


def big_news(evs, board, n=FEED_MAX):
    """today's big news: the board's priority order (18.3), events from two sides or three outlets and more (js/entry.js entryEvents)"""
    pri = [s for s in (board or {}).get("priority") or [] if s in evs]
    return [evs[s] for s in pri if _multi_side(evs[s]) or evs[s]["n_outlets"] >= 3][:n]


def one_side(evs, n=FEED_MAX, min_outlets=2):
    """the news of one side only (js/sections.js oneSideOf): reports from one of Japan, abroad and the ministries, two outlets or more there"""
    got = []
    for ev in evs.values():
        on = [k for k, _, _ in SIDES if ev["sides"][k]]
        if len(on) == 1 and ev["side_outlets"][on[0]] >= min_outlets:
            got.append((ev["side_outlets"][on[0]], ev["last_ts"] or 0, ev["sid"], on[0], ev))
    got.sort(key=lambda x: (-x[0], -x[1], x[2]))
    return [(side, ev) for _, _, _, side, ev in got[:n]]


def by_field(evs, n=FEED_MAX):
    """{field: [Event]} by the board's category (18.3), score (weight x freshness) then the newest report"""
    out = {f: [] for f, _ in FIELDS}
    for ev in evs.values():
        out.setdefault(ev["cat"] if ev["cat"] in out else "その他", []).append(ev)
    for f in out:
        out[f] = sorted(out[f], key=lambda e: (-(e["score"] or 0), -(e["last_ts"] or 0), e["sid"]))[:n]
    return out


# ---------------------------------------------------------------- words

def gap_text(sec):
    m = max(0, int(round(sec / 60)))
    d, rem = divmod(m, 1440)
    h, mi = divmod(rem, 60)
    if d:
        return "%d日%d時間" % (d, h) if h else "%d日" % d
    if h:
        return "%d時間%d分" % (h, mi) if mi else "%d時間" % h
    return "%d分" % mi


def clock(ts, date=True):
    if ts is None:
        return "—"
    t = datetime.fromtimestamp(ts, JST)
    return ("%d月%d日 %d:%02d" % (t.month, t.day, t.hour, t.minute)) if date else ("%d:%02d" % (t.hour, t.minute))


def counts_line(ev):
    """the counts of each side that has reports, and who came first: "国内4件、海外2件。海外が国内より1時間27分早く報じた" """
    parts = ["%s%d件" % (ja, ev["sides"][k]) for k, ja, _ in SIDES if ev["sides"][k]]
    out = "、".join(parts)
    firsts = sorted([(ev["first"][k], ja) for k, ja, _ in SIDES if ev["first"].get(k) is not None])
    if len(firsts) >= 2:
        (t0, ja0), (t1, ja1) = firsts[0], firsts[1]
        out += "。" + ("最初の報道は同じ分" if t1 - t0 < 60 else "%sが%sより%s早く報じた" % (ja0, ja1, gap_text(t1 - t0)))
    elif firsts:
        out += "。最初の報道 %s" % clock(firsts[0][0])
    return out


# ---------------------------------------------------------------- the page of one event

def _e(s):
    return html.escape(s or "", quote=True)


def app_link(ev):
    """the same event in the page: ?sid= (js/app.js), with ?t= as the page's own fallback when the sid is gone from the data"""
    q = "?sid=" + ev["sid"]
    if not ev.get("title_none") and ev.get("title"):
        q += "&t=" + quote(ev["title"][:60], safe="")
    return "../" + q


CSS = """:root{--bg:#f5f5f7;--fg:#1d1d1f;--mut:#6e6e73;--card:#fff;--line:#d2d2d7;--acc:#0066cc;--btn:#0066cc}
@media (prefers-color-scheme:dark){:root{--bg:#161617;--fg:#f5f5f7;--mut:#a1a1a6;--card:#1d1d1f;--line:#38383a;--acc:#4da3ff;--btn:#0071e3}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:16px 16px 48px}a{color:var(--acc)}header.top{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:14px;color:var(--mut)}
header.top a.site{color:var(--fg);font-weight:600;text-decoration:none;letter-spacing:.04em}h1{font-size:26px;line-height:1.35;margin:18px 0 4px}
.src{color:var(--mut);font-size:14px}.line{font-size:17px;margin:12px 0;font-variant-numeric:tabular-nums}.field{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:0 10px;font-size:13px;color:var(--mut)}
.open{display:inline-block;margin:8px 0 4px;padding:10px 18px;border-radius:999px;background:var(--btn);color:#fff;text-decoration:none;font-weight:600}
figure{margin:16px 0}figure img{max-width:100%;height:auto;display:block;border-radius:10px;background:var(--card)}figcaption{font-size:12px;color:var(--mut);margin-top:4px}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:4px 16px;margin:16px 0}h2{font-size:16px;margin:12px 0 4px}
ol{list-style:none;margin:0;padding:0}li{padding:10px 0;border-top:1px solid var(--line)}li:first-child{border-top:0}.meta{font-size:13px;color:var(--mut);font-variant-numeric:tabular-nums}
q{display:block;font-size:14px;color:var(--mut);margin-top:4px}q::before,q::after{content:none}.note{font-size:13px;color:var(--mut);margin-top:24px}
footer{font-size:13px;color:var(--mut);margin-top:16px}footer a{margin-right:12px}
.mark{display:inline-block;border:1px solid var(--line);border-radius:6px;padding:0 6px;font-size:12px;font-weight:400;color:var(--mut);margin-left:6px;vertical-align:1px}
.brief dl{margin:0 0 8px}.brief dt{font-size:13px;color:var(--mut);margin-top:12px}.brief dd{margin:2px 0 0}.brief dd.none{color:var(--mut)}
.hl{font-size:16px}a.orig{font-size:13px;margin-left:8px}.tl li{padding:6px 0}.tl .hl{font-size:14px}
.cov h2{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px}.lg{margin-left:auto;display:inline-flex;flex-wrap:wrap;gap:2px 12px;font-size:12px;font-weight:400;color:var(--mut)}
.lg>span{display:inline-flex;align-items:center;gap:5px}.lg>span::before{content:"";width:12px;height:10px;border-radius:3px}.lg .on::before{background:color-mix(in srgb,var(--mut) 34%,transparent)}
.lg .off::before{background:repeating-linear-gradient(135deg,transparent 0 2px,color-mix(in srgb,var(--mut) 60%,transparent) 2px 3px);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--mut) 28%,transparent)}.lg .na::before{content:"·";width:auto;height:auto;line-height:1}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
.cv-sc{overflow-x:auto;margin:0 -8px;padding:0 8px 8px}.cv-sc:focus-visible{outline:2px solid var(--acc);outline-offset:2px;border-radius:8px}
.cv-t{border-collapse:separate;border-spacing:3px;width:100%;font-size:13px;line-height:1.45}.cv-t th,.cv-t td{padding:0;text-align:left;font-weight:400;vertical-align:top}
.cv-t thead th{min-width:96px;padding:0 2px 5px;vertical-align:bottom}.cv-t thead b{position:relative;display:block;padding-top:6px}.cv-t thead b::before{content:"";position:absolute;left:0;top:0;width:100%;height:3px;border-radius:2px;background:var(--sd)}
.cv-t thead small,.cv-t tbody th small{display:block;font-size:11px;font-weight:400;color:var(--mut);font-variant-numeric:tabular-nums}
.cv-t tbody th{position:sticky;left:0;z-index:1;min-width:84px;max-width:132px;padding:7px 8px 6px 2px;background:var(--card)}.cv-l{display:block;font-weight:700;overflow-wrap:anywhere}
.cv-t td{min-width:96px;border-radius:8px}.cv-t td.on{padding:6px 8px;background:color-mix(in srgb,var(--sd) 14%,transparent);box-shadow:inset 3px 0 0 var(--sd)}.cv-t td.on mark{background:none;color:inherit;font-weight:700;box-shadow:inset 0 -2px 0 color-mix(in srgb,var(--sd) 80%,transparent)}
.cv-t td.off{padding:6px 8px;text-align:center;color:var(--mut);background:repeating-linear-gradient(135deg,transparent 0 5px,color-mix(in srgb,var(--mut) 16%,transparent) 5px 6px)}.cv-t td.na{padding:6px 8px;text-align:center;color:var(--mut)}
[data-side="jp"]{--sd:#b5235f}[data-side="intl"]{--sd:#0068a8}[data-side="gov"]{--sd:#7a5a12}
@media (prefers-color-scheme:dark){[data-side="jp"]{--sd:#ff8fb8}[data-side="intl"]{--sd:#64c4ff}[data-side="gov"]{--sd:#d9b77a}}
.cv-w{margin-top:12px;padding:12px 0 10px;border-top:1px solid var(--line)}.cv-w h3{font-size:15px;margin:0 0 8px}.cv-w ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}.cv-w li{display:grid;gap:5px;padding:0;border:0}.cv-w li>b{font-size:13px;font-weight:600;color:var(--mut)}
.cv-v{display:flex;flex-wrap:wrap;gap:6px}.cv-x{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:2px 7px;padding:5px 11px 6px;border:1px solid var(--line);border-radius:14px}.cv-wd{font-weight:700;font-size:16px}
.cv-d{display:inline-flex;gap:2px}.cv-d i{width:7px;height:7px;border-radius:50%;background:var(--sd)}.cv-x small{flex-basis:100%;font-size:12px;color:var(--mut)}"""


def story_page(ev, base=BASE_URL, generated_at=None, canonical_sid=None, kept_from=None, newer_sid=None):
    """s/<sid>.html. canonical_sid: the page this one stands for (an older sid of an event that goes on); kept_from: the day of the archive it was made from"""
    base = base if base.endswith("/") else base + "/"
    sid = ev["sid"]
    url = base + "s/%s.html" % (canonical_sid or sid)
    title = ev["title"] or SITE
    desc = counts_line(ev)
    img = ev["photo"]["url"] if ev.get("photo") else None
    head = ['<meta charset="utf-8">', '<meta name="viewport" content="width=device-width,initial-scale=1">',
            "<title>%s｜%s</title>" % (_e(title), SITE), '<meta name="description" content="%s">' % _e(desc),
            '<link rel="canonical" href="%s">' % _e(url),
            '<meta property="og:type" content="article">', '<meta property="og:site_name" content="%s">' % SITE,
            '<meta property="og:locale" content="ja_JP">', '<meta property="og:title" content="%s">' % _e(title),
            '<meta property="og:description" content="%s">' % _e(desc), '<meta property="og:url" content="%s">' % _e(url),
            '<meta name="twitter:card" content="%s">' % ("summary_large_image" if img else "summary"),
            '<meta name="twitter:title" content="%s">' % _e(title), '<meta name="twitter:description" content="%s">' % _e(desc)]
    if img:
        head += ['<meta property="og:image" content="%s">' % _e(img), '<meta name="twitter:image" content="%s">' % _e(img)]
    else:
        head += ['<meta property="og:image" content="%s">' % _e(base + "assets/icons/icon-512.png")]
    if ev.get("first_ts") is not None:
        head.append('<meta property="article:published_time" content="%s">' % datetime.fromtimestamp(ev["first_ts"], timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    head += ['<link rel="icon" href="../assets/icons/icon-192.png" type="image/png">',
             '<link rel="alternate" type="application/rss+xml" title="%s 今日の注目ニュース" href="../feed.xml">' % SITE,
             "<style>%s</style>" % CSS]
    body = ['<header class="top"><a class="site" href="../">%s</a><a href="../">ホームへ</a></header>' % SITE]
    body.append("<h1>%s</h1>" % _e(title))
    if ev.get("outlet"):
        body.append('<p class="src">%s</p>' % _e(ev["outlet"]))
    body.append('<p class="meta"><span class="field">%s</span> %d社が報道・%d件・最初の報道 %s・最新の報道 %s</p>'
                % (_e(ev["cat"]), ev["n_outlets"], ev["n_items"], clock(ev.get("first_ts")), clock(ev.get("last_ts"))))
    body.append('<p class="line">%s</p>' % _e(desc))
    body.append('<a class="open" href="%s">比べて見る</a>' % _e(app_link(dict(ev, sid=canonical_sid or sid))))
    if newer_sid:
        body.append('<p class="meta"><a href="%s.html">新しい頁へ</a></p>' % _e(newer_sid))
    if img:
        body.append('<figure><img src="%s" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"><figcaption>写真：%s</figcaption></figure>'
                    % (_e(img), _e(ev["photo"].get("outlet") or "—")))
    br = ev.get("brief")
    if br:
        rows = []
        for k, label in BRIEF_LABELS:
            v = br.get(k)
            if not v or v == UNKNOWN:
                continue
            rows.append('<dt>%s</dt><dd>%s</dd>' % (label, _e(v)))
        by = "・".join(x for x in (br.get("model"), clock(br["made_at"]) if br.get("made_at") else "") if x)
        body.append('<section class="brief"><h2>要点<span class="mark">AI</span></h2><dl>%s</dl><p class="meta">AI が書きました（%s）。元の記事で確かめてください。</p></section>'
                    % ("".join(rows), _e(by or "—")))
    if ev.get("coverage"):
        body.append(coverage_mod.html_block(ev["coverage"]))
    for k, _, ja in SIDES:
        hs = [h for h in ev["heads"] if h["side"] == k]
        if not hs:
            continue           # a side without a report is not named
        rows = []
        for h in hs:
            t = _e(h["title"]) if h["title"] else "見出しなし"
            orig = '<a class="orig" href="%s" rel="noopener nofollow" referrerpolicy="no-referrer">元の記事</a>' % _e(h["link"]) if h["link"] else ""
            via = "・Google ニュース経由" if h.get("via") else ""
            q = "<q>%s</q>" % _e(h["desc"]) if h.get("desc") else ""
            rows.append('<li><div class="meta">%s・%s・%s%s</div><div class="hl">%s%s</div>%s</li>'
                        % (_e(clock(h["ts"])), _e(h["outlet"] or "—"), _e(h["type"]), via, t, orig, q))
        body.append('<section><h2>%s %d件</h2><ol>%s</ol></section>' % (ja, ev["sides"][k], "".join(rows)))
    timed = [h for h in ev["heads"] if h["ts"] is not None]
    if len(timed) >= 2:
        names = {k: short for k, short, _ in SIDES}
        rows = ['<li><span class="meta">%s・%s・%s</span> <span class="hl">%s</span></li>'
                % (_e(clock(h["ts"])), names.get(h["side"], ""), _e(h["outlet"] or "—"), _e(h["title"] or "見出しなし")) for h in timed[:TIMELINE_MAX]]
        body.append('<section class="tl"><h2>時系列</h2><ol>%s</ol></section>' % "".join(rows))
    if ev["n_items"] > len(ev["heads"]):
        body.append('<p class="meta">ほか %d 件はホームで見られます。</p>' % (ev["n_items"] - len(ev["heads"])))
    when = clock(generated_at) if generated_at else "—"
    note = ("%s時点の控え" % _e(kept_from)) if kept_from else ("%s時点" % when)
    body.append('<p class="note">%s。見出しと要旨は各メディアの配信の引用で、記事の本文は載せていません。</p>' % note)
    body.append('<footer><a href="../">%s</a><a href="../feed.xml">RSS</a><a href="../feed-oneside.xml">片側だけのニュース（RSS）</a></footer>' % SITE)
    return '<!doctype html>\n<html lang="ja">\n<head>\n%s\n</head>\n<body>\n<main>\n%s\n</main>\n</body>\n</html>\n' % ("\n".join(head), "\n".join(body))


# ---------------------------------------------------------------- feeds

def _x(s):
    s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", s or "")
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _rfc822(ts):
    return format_datetime(datetime.fromtimestamp(ts, timezone.utc), usegmt=True)


def guid(ev):
    """the same event keeps its guid while new reports join (its sid changes with its members): its first report"""
    return "parallax:" + (ev.get("first_id") or ev["sid"])


def rss(name, title, desc, rows, base=BASE_URL, generated_at=None):
    """rows = [(Event, prefix)]; RSS 2.0 with atom:link self; the item's title is the headline as published"""
    base = base if base.endswith("/") else base + "/"
    out = ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">', "<channel>",
           "<title>%s</title>" % _x("%s｜%s" % (SITE, title)), "<link>%s</link>" % _x(base), "<description>%s</description>" % _x(desc),
           "<language>ja</language>", '<atom:link href="%s" rel="self" type="application/rss+xml"/>' % _x(base + name)]
    if generated_at:
        out.append("<lastBuildDate>%s</lastBuildDate>" % _rfc822(generated_at))
    for ev, prefix in rows:
        link = base + "s/%s.html" % ev["sid"]
        line = counts_line(ev)
        out.append("<item>")
        out.append("<title>%s</title>" % _x(ev["title"]))
        out.append("<link>%s</link>" % _x(link))
        out.append('<guid isPermaLink="false">%s</guid>' % _x(guid(ev)))
        out.append("<description>%s</description>" % _x((prefix + "。" if prefix else "") + line))
        out.append("<category>%s</category>" % _x(ev["cat"]))
        if ev.get("first_ts") is not None:
            out.append("<pubDate>%s</pubDate>" % _rfc822(ev["first_ts"]))
        out.append("</item>")
    out += ["</channel>", "</rss>", ""]
    return "\n".join(out)


# ---------------------------------------------------------------- the archive (seven days)

def day_of(ts):
    return datetime.fromtimestamp(ts, JST).strftime("%Y-%m-%d")


def entry_of(ev, rank=None):
    """an event as the archive keeps it: no description, at most ARCHIVE_HEADS headlines"""
    e = {k: ev[k] for k in ("sid", "title", "title_none", "outlet", "title_id", "cat", "n_items", "n_outlets", "sides", "side_outlets", "first",
                            "first_ts", "last_ts", "first_id", "photo", "brief")}
    e["heads"] = [{k: v for k, v in h.items() if k != "desc"} for h in ev["heads"][:ARCHIVE_HEADS]]
    e["rank"] = rank
    return e


def _clean_entry(e):
    """an entry read back from the public URL: data, not instructions. Wrong shapes are dropped, strings are cut, links must be http(s)"""
    if not isinstance(e, dict) or not isinstance(e.get("sid"), str) or not SID_RE.match(e["sid"]):
        return None
    heads = []
    for h in e.get("heads") or []:
        if not isinstance(h, dict) or h.get("side") not in ("jp", "intl", "gov"):
            continue
        hh = {"id": _s(h.get("id"), 64), "src": _s(h.get("src"), 64), "side": h["side"], "outlet": _s(h.get("outlet"), 80), "type": _s(h.get("type"), 30),
              "ts": _int(h.get("ts")), "title": _s(h.get("title"), 300) or None, "link": _http(h.get("link"))}
        if h.get("via") == "gnews":
            hh["via"] = "gnews"
        heads.append(hh)
    if not heads:
        return None
    num = lambda d: {k: (_int((d or {}).get(k)) or 0) for k, _, _ in SIDES} if isinstance(d, dict) else {k: 0 for k, _, _ in SIDES}
    first = e.get("first") if isinstance(e.get("first"), dict) else {}
    ph = e.get("photo") if isinstance(e.get("photo"), dict) else None
    ph = {"url": _http(ph.get("url")), "outlet": _s(ph.get("outlet"), 80), "id": _s(ph.get("id"), 64)} if ph else None
    return {"sid": e["sid"], "title": _s(e.get("title"), 300) or "—", "title_none": bool(e.get("title_none")), "outlet": _s(e.get("outlet"), 80),
            "title_id": _s(e.get("title_id"), 64), "cat": _s(e.get("cat"), 20) or "その他", "n_items": _int(e.get("n_items")) or len(heads),
            "n_outlets": _int(e.get("n_outlets")) or 1, "sides": num(e.get("sides")), "side_outlets": num(e.get("side_outlets")),
            "first": {k: _int(first.get(k)) for k, _, _ in SIDES}, "first_ts": _int(e.get("first_ts")), "last_ts": _int(e.get("last_ts")),
            "first_id": _s(e.get("first_id"), 64), "photo": ph if ph and ph["url"] else None, "heads": heads, "rank": _int(e.get("rank")),
            "brief": _brief(e.get("brief"))}


def scrub(entry, withheld):
    """data/withheld.json (CONTRACT 20.9) applied to an archived entry: a withheld source or article goes, a withheld photo is cleared"""
    if not entry:
        return None
    w = withheld if isinstance(withheld, dict) else {}
    srcs, ids = set(w.get("sources") or []), set(w.get("items") or [])
    ph = w.get("photos") if isinstance(w.get("photos"), dict) else {}
    psrc, pids = set(ph.get("sources") or []), set(ph.get("items") or [])
    heads = [h for h in entry["heads"] if h["src"] not in srcs and h["id"] not in ids]
    if not heads:
        return None
    e = dict(entry, heads=heads)
    if len(heads) != len(entry["heads"]):
        e["brief"] = None                # a summary made from headlines that are now withheld goes with them
        if e["title_id"] and e["title_id"] not in {h["id"] for h in heads}:
            t = next((h for h in heads if h["title"]), None)
            e.update(title=t["title"] if t else "・".join(sorted({h["outlet"] for h in heads if h["outlet"]})[:3]), title_none=t is None,
                     outlet=t["outlet"] if t else "", title_id=t["id"] if t else "")
        e["n_items"] = max(len(heads), e["n_items"] - (len(entry["heads"]) - len(heads)))
        sides = {}
        for k, _, _ in SIDES:
            kept = sum(1 for h in heads if h["side"] == k)
            sides[k] = max(kept, e["sides"].get(k, 0) - (sum(1 for h in entry["heads"] if h["side"] == k) - kept))
        e["sides"] = sides
        e["first"] = {k: next((h["ts"] for h in sorted(heads, key=_by_time) if h["side"] == k and h["ts"] is not None), None) for k, _, _ in SIDES}
        e["first_id"] = sorted(heads, key=_by_time)[0]["id"]
    if e.get("photo") and (e["photo"].get("id") in pids or e["photo"].get("id") in ids
                           or any(h["id"] == e["photo"].get("id") and h["src"] in psrc | srcs for h in entry["heads"])):
        e["photo"] = None
    return e


def same_event(a, b):
    """two entries of one day are the same event when they share the first report, or half the headlines kept of the smaller"""
    if a["first_id"] and a["first_id"] == b["first_id"]:
        return True
    ia, ib = {h["id"] for h in a["heads"] if h["id"]}, {h["id"] for h in b["heads"] if h["id"]}
    return bool(ia and ib) and len(ia & ib) * 2 >= min(len(ia), len(ib))


def merge_day(prev_day, today):
    """prev_day: the cleaned entries of today's file from the last deploy (or []); today: this build's entries (big news first, ranked).
    Returns (entries in order, {old sid: new sid})."""
    alias, out = {}, list(today)
    for p in prev_day:
        hit = next((t for t in today if t["sid"] == p["sid"] or same_event(p, t)), None)
        if hit:
            if hit["sid"] != p["sid"]:
                alias[p["sid"]] = hit["sid"]
            if p["rank"] is not None and (hit["rank"] is None or p["rank"] < hit["rank"]):
                hit["rank"] = p["rank"]      # the day's best rank: big news earlier in the day stays big news of that day
            continue
        out.append(p)
    return out, alias


def _top_of(entries):
    ranked = [e for e in entries if e.get("rank") is not None]
    ranked.sort(key=lambda e: (e["rank"], -(e["last_ts"] or 0)))
    return [e["sid"] for e in ranked[:ARCHIVE_TOP]]


def fetch_json(url, timeout=FETCH_TIMEOUT):
    req = urllib.request.Request(url, headers={"User-Agent": "VECTOR-PARALLAX", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        if r.status != 200:
            raise OSError("status %s" % r.status)
        return json.loads(r.read(4 * 1024 * 1024).decode("utf-8"))


def read_previous(base, fetch=fetch_json, days=None):
    """the last deploy's archive through the public URL: {date: [entry]} and the reason when it could not be read (first run, network, shape)"""
    base = base if base.endswith("/") else base + "/"
    try:
        idx = fetch(base + "data/archive/index.json")
    except Exception as ex:        # noqa: BLE001 — anything: the build goes on with today only
        return {}, "index: %s" % type(ex).__name__
    if not isinstance(idx, dict) or idx.get("schema") != SCHEMA_INDEX or not isinstance(idx.get("days"), list):
        return {}, "index: shape"
    got, bad = {"#updated": {}}, 0
    for d in idx["days"][:ARCHIVE_DAYS + 1]:
        date = d.get("date") if isinstance(d, dict) else None
        if not isinstance(date, str) or not DATE_RE.match(date) or (days is not None and date not in days):
            continue
        try:
            doc = fetch(base + "data/archive/%s.json" % date)
        except Exception:          # noqa: BLE001
            bad += 1
            continue
        if not isinstance(doc, dict) or doc.get("schema") != SCHEMA_DAY or doc.get("date") != date:
            bad += 1
            continue
        evs = doc.get("events") if isinstance(doc.get("events"), list) else []
        got[date] = [x for x in (_clean_entry(e) for e in evs[:ARCHIVE_EVENTS]) if x]
        got["#updated"][date] = _int(doc.get("updated_at"))
        got[date + "#alias"] = {k: v for k, v in (doc.get("alias") or {}).items()
                                if isinstance(k, str) and isinstance(v, str) and SID_RE.match(k) and SID_RE.match(v)} if isinstance(doc.get("alias"), dict) else {}
    return got, ("days unreadable: %d" % bad) if bad else ""


def window_days(today):
    t = datetime.strptime(today, "%Y-%m-%d")
    return [(t - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(ARCHIVE_DAYS)]


def merge_archive(prev, today_entries, today, generated_at, withheld=None):
    """prev = read_previous()[0]; today_entries = this build's entries (big news ranked first). Returns {date: day doc}, newest first, seven days at most"""
    days = window_days(today)
    out = {}
    for d in days:
        prev_d = [x for x in (scrub(e, withheld) for e in prev.get(d) or []) if x]
        alias = dict(prev.get(d + "#alias") or {})
        if d == today:
            ents, new_alias = merge_day(prev_d, [x for x in (scrub(dict(e), withheld) for e in today_entries) if x])
            alias = {k: new_alias.get(v, v) for k, v in alias.items()}
            alias.update(new_alias)
            updated = generated_at
        else:
            if not prev_d:
                continue
            ents, updated = prev_d, None
        top = _top_of(ents)
        keep = set(top)
        ents = [e for e in ents if e["sid"] in keep] + [e for e in ents if e["sid"] not in keep]
        ents = ents[:ARCHIVE_EVENTS]
        live = {e["sid"] for e in ents}
        out[d] = {"schema": SCHEMA_DAY, "date": d, "updated_at": updated if updated is not None else (prev.get("#updated") or {}).get(d), "top": top, "events": ents,
                  "alias": {k: v for k, v in alias.items() if v in live and k not in live}}
    return out


def archive_index(docs, generated_at):
    days = [{"date": d, "n_top": len(docs[d]["top"]), "n_events": len(docs[d]["events"]), "updated_at": docs[d]["updated_at"]}
            for d in sorted(docs, reverse=True)]
    return {"schema": SCHEMA_INDEX, "updated_at": generated_at, "days": days[:ARCHIVE_DAYS]}


# ---------------------------------------------------------------- writing

def _dump(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def write_site(out, latest, board, base=BASE_URL, fetch=fetch_json, withheld=None):
    """writes s/<sid>.html, the feeds and data/archive/ into the Pages folder `out`. Returns counts (never a headline)"""
    out = Path(out)
    base = base if base.endswith("/") else base + "/"
    gen = _int(latest.get("generated_at")) or _int((board or {}).get("generated_at")) or 0
    evs = events(latest, board)
    big = big_news(evs, board)
    ones = one_side(evs)
    fields = by_field(evs)
    feeds = {"feed.xml": ("今日の注目ニュース", "報道の多かったニュース。" + FEED_COUNTS, [(e, "") for e in big])}
    feeds["feed-oneside.xml"] = ("片側だけのニュース", ONE_SIDE_NOTE, [(e, ONE_SIDE[s]) for s, e in ones])
    for f, slug in FIELDS:
        feeds["feed-%s.xml" % slug] = ("%sのニュース" % f, "%sのニュース。" % f + FEED_COUNTS, [(e, "") for e in fields.get(f, [])])
    for name, (title, desc, rows) in feeds.items():
        (out / name).write_text(rss(name, title, desc, rows, base, gen), encoding="utf-8")
    # the archive: today's entries are every event a feed links (so a feed's link stays alive for seven days), the big news ranked first
    linked, seen = [], set()
    for i, e in enumerate(big):
        linked.append(entry_of(e, rank=i + 1)); seen.add(e["sid"])
    for _, (_, _, rows) in feeds.items():
        for e, _ in rows:
            if e["sid"] not in seen:
                linked.append(entry_of(e)); seen.add(e["sid"])
    today = day_of(gen) if gen else datetime.now(JST).strftime("%Y-%m-%d")
    prev, why = read_previous(base, fetch, set(window_days(today))) if fetch else ({}, "not asked")
    docs = merge_archive(prev, linked, today, gen, withheld)
    idx = archive_index(docs, gen)
    for d, doc in docs.items():
        _dump(out / "data" / "archive" / ("%s.json" % d), doc)
    _dump(out / "data" / "archive" / "index.json", idx)
    # the pages: every event of this build, then every archived event this build does not have (an older sid of an event that goes on stands for its new page)
    sdir = out / "s"
    sdir.mkdir(parents=True, exist_ok=True)
    n_now = n_kept = n_alias = 0
    for sid, ev in evs.items():
        (sdir / ("%s.html" % sid)).write_text(story_page(ev, base, gen), encoding="utf-8")
        n_now += 1
    for d in sorted(docs, reverse=True):
        doc = docs[d]
        for e in doc["events"]:
            if (sdir / ("%s.html" % e["sid"])).exists():
                continue
            newer = next((x for x in evs.values() if same_event(e, x)), None)
            if newer:
                (sdir / ("%s.html" % e["sid"])).write_text(story_page(newer, base, gen, canonical_sid=newer["sid"]), encoding="utf-8")
                n_alias += 1
            else:
                (sdir / ("%s.html" % e["sid"])).write_text(story_page(dict(e, score=0), base, None, kept_from=_day_ja(d)), encoding="utf-8")
                n_kept += 1
        for old, new in doc["alias"].items():
            if not (sdir / ("%s.html" % old)).exists() and (sdir / ("%s.html" % new)).exists():
                src = evs.get(new) or next((x for x in doc["events"] if x["sid"] == new), None)
                if src:
                    page = story_page(src, base, gen if new in evs else None, canonical_sid=new, kept_from=None if new in evs else _day_ja(d))
                    (sdir / ("%s.html" % old)).write_text(page, encoding="utf-8")
                    n_alias += 1
    return {"pages": n_now + n_kept + n_alias, "pages_now": n_now, "pages_kept": n_kept, "pages_alias": n_alias,
            "feeds": len(feeds), "feed_items": {k: len(v[2]) for k, v in feeds.items()},
            "archive_days": len(docs), "archive_today": len(docs.get(today, {}).get("events", [])), "archive_from_previous": sorted(d for d in prev if not d.startswith("#") and "#" not in d),
            "archive_note": why}


def _day_ja(d):
    t = datetime.strptime(d, "%Y-%m-%d")
    return "%d月%d日" % (t.month, t.day)

