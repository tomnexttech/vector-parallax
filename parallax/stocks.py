# -*- coding: utf-8 -*-
"""stocks - the contract for a stock-price file the site could one day show (data/stocks.json). Stdlib only. No source is enabled.

The site shows no stock price today: no provider was found whose terms let a free public page show or pass on daily closes
(docs/market-view.md has the ones that were read and what they cost). This module is the gate for the day one is licensed: a file is
valid only when every series names its source, the page of the terms that were read, the date they were read, and says in so many
words that display on a public page is allowed. A file that does not say so is refused, not shown.

    validate(doc) -> [reasons]      empty when the file may be shown
    empty_doc(reason, now)          the file that says there is nothing to show, and why (what the site writes until a source is licensed)
"""
import datetime as dt
import re

SCHEMA = "parallax-stocks/1"
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MIN_BARS = 60


def empty_doc(reason, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    return {"schema": SCHEMA, "generated_at": int(now.timestamp()), "ok": False, "reason": str(reason), "series": []}


def validate(doc):
    out = []
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA:
        return ["schema is not " + SCHEMA]
    if not doc.get("ok"):
        return ["the file says it has nothing to show: " + str(doc.get("reason", ""))]
    series = doc.get("series")
    if not isinstance(series, list) or not series:
        return ["no series"]
    for i, s in enumerate(series):
        tag = "series %d" % i
        if not isinstance(s, dict):
            out.append(tag + ": not an object")
            continue
        src = s.get("source") if isinstance(s.get("source"), dict) else {}
        if not src.get("name") or not str(src.get("terms_url", "")).startswith("https://"):
            out.append(tag + ": the source and the page of its terms are not named")
        if not DATE.match(str(src.get("terms_read", ""))):
            out.append(tag + ": the date the terms were read is missing")
        if src.get("public_display_allowed") is not True:
            out.append(tag + ": the terms are not recorded as allowing display on a public page")
        bars = s.get("bars")
        if not isinstance(bars, list) or len(bars) < MIN_BARS:
            out.append(tag + ": fewer than %d daily bars" % MIN_BARS)
            continue
        last = ""
        for b in bars:
            ok = isinstance(b, (list, tuple)) and len(b) == 2 and DATE.match(str(b[0])) and isinstance(b[1], (int, float)) and not isinstance(b[1], bool) and b[1] > 0
            if not ok or str(b[0]) <= last:
                out.append(tag + ": a bar is not [date, close] in rising date order with a close over zero")
                break
            last = str(b[0])
    return out
