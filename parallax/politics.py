# -*- coding: utf-8 -*-
"""politics - the Diet, the gazette, the audit board and the parties, from public pages (CONTRACT 18.9). Stdlib only.

compose(items, now, get=None) -> dict for data/politics.json. `items` are the items this run fetched (they already include
the pages read by parallax/primary.py). Added here: the Diet session table and the list of recent committee / plenary meetings
of the National Diet Library's Diet-record API (metadata and links only, no speech text).

Floor: the parties and the Prime Minister's Office are listed side by side in a fixed neutral order (the Office first, the parties
alphabetically by name); no party and no outlet gets a colour or a verdict; nothing here says what a bill "means".
Whatever could not be read is listed under "failed" with the reason, and its section is empty - never filled.
"""
import json
import re
import time
import urllib.parse
import urllib.request

try:
    from parallax import feeds as _feeds
    from parallax import primary
except ImportError:                                       # run from inside parallax/
    import feeds as _feeds  # type: ignore
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


def _get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def compose(items, now=None, get=None):
    now = int(time.time() if now is None else now)
    get = get or _get
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
        out["kokkai"] = kokkai_recent(now, get)
    except Exception as e:
        out["kokkai"] = None
        failed["kokkai"] = ("%s: %s" % (type(e).__name__, e))[:160]
    try:
        txt = get(primary.SHU_KAIKI) if get is not _get else primary._page(primary.SHU_KAIKI, 600)   # the page is Shift_JIS: primary decodes it
        sessions = primary.parse_shugiin_kaiki(txt)
        state = primary.session_state(sessions)
        out["session"] = json.loads(json.dumps({"sessions": sessions[:4] if isinstance(sessions, list) else sessions, "state": state},
                                               default=str, ensure_ascii=False))
    except Exception as e:
        out["session"] = None
        failed["session"] = ("%s: %s" % (type(e).__name__, e))[:160]
    return out
