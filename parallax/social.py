# -*- coding: utf-8 -*-
"""social - what is said about a place on Bluesky (data/social.json, docs/trend-sources.md). Public search, no key, stdlib only, no AI.

    python -m parallax.social [--out data/social.json] [--places data/social_places.json] [--now EPOCH]

Source: Bluesky's public AppView search `app.bsky.feed.searchPosts` at https://api.bsky.app (no login). It is asked from the build (every 3 hours),
never from the visitor's browser. For each place of data/social_places.json, two windows are asked (the same cut as the news: the recent third of
the hours held by latest.json and the part before it): `hitsTotal` is the count of posts the search found, and the newest 100 posts of each third of each window are the sample (the public search refuses a second page). From the sample only these numbers are kept:
  - n: posts found (hitsTotal; the search stops counting at 10000, then `capped` is true and n is "at least")
  - terms: words (katakana, kanji, latin, #tags) that are more common in the recent sample than in the earlier one (>= MIN_POSTS posts by >= MIN_AUTHORS people)
  - tone: how many sampled posts hold a word of the positive list, of the negative list (data/sentiment_ja.json), or of neither. It counts words; it does not read irony or negation
No post text, handle or link is stored. A place that could not be read is a row with the reason; the whole file is not written when nothing could be read
(the previous file stays). The file says what the sample is (`bias_ja`): Bluesky's users are few and not the nation.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = "parallax-social/1"
HOST = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts"
UA = "VECTOR-PARALLAX/0.1 (+https://tomnexttech.github.io/vector-parallax/; tomnexttech@users.noreply.github.com)"
PAGE = 100
SLICES = 3                # each window is asked in this many equal parts of time (a sample of up to 100 posts from each part)
WORKERS = 3              # places asked at the same time
GAP_S = 0.4               # between requests
TOTAL_S = 600
FAILS = 6                 # this many failed places in a row: stop (the other side is down or has closed the door)
MIN_POSTS = 5
MIN_AUTHORS = 3
MAX_SHARE = 0.4           # a word in more than this share of the posts is the search word's own company, not a topic
TERMS_N = 8
RECENT_SHARE = 1 / 3      # the same cut as js/trend.js
BIAS_JA = "Bluesky の日本語の投稿だけの標本です。世論の縮図ではありません。"
TONE_JA = "肯定・否定は、投稿に決めた語が含まれるかを数えた物です。皮肉や文脈は読めません。"
_TERM = re.compile(r"#[^\s#]{2,30}|[ァ-ヶー]{2,}|[一-龥々]{2,6}|[A-Za-z][A-Za-z0-9]{2,}")
_STRIP = re.compile(r"https?://\S+|@[A-Za-z0-9_.\-]+")


def _iso(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def http_get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def search(q, since, until, cursor=None, get=http_get):
    p = {"q": q, "limit": PAGE, "sort": "latest", "lang": "ja", "since": _iso(since), "until": _iso(until)}
    if cursor:
        p["cursor"] = cursor
    return get(HOST + "?" + urllib.parse.urlencode(p))


def window(q, since, until, slices, get=http_get, sleep=time.sleep):
    """-> (hits, capped, [(author, text)]) for one window. The public search refuses a second page (a cursor gets 403 "administrative rules", 2026-11-22),
    so the window is cut into `slices` equal parts in time and the newest PAGE posts of each part are the sample: the hits add up to the window's count,
    and the sample reaches all through the window and not only its newest hour."""
    posts, hits, capped = [], 0, False
    step = (until - since) / slices
    for i in range(slices):
        d = search(q, since + i * step, since + (i + 1) * step, None, get)
        h = d.get("hitsTotal") if isinstance(d.get("hitsTotal"), int) else len(d.get("posts") or [])
        hits += h
        capped = capped or h >= 10000
        for p in d.get("posts") or []:
            rec = p.get("record") or {}
            a = (p.get("author") or {}).get("did") or ""
            t = rec.get("text") if isinstance(rec.get("text"), str) else ""
            if t:
                posts.append((a, t))
        sleep(GAP_S)
    return hits, capped, posts


def terms_of(text, skip=()):
    t = _STRIP.sub(" ", unicodedata.normalize("NFKC", text))
    return {w for w in _TERM.findall(t) if w not in skip and not any(s and s in w for s in skip)}


def rising_terms(recent, prior, skip=(), stop=()):
    """words more common in the recent sample than in the earlier one: [{term, recent, prior, authors}] (counts of posts)"""
    stop = set(stop)
    nr, np_ = max(1, len(recent)), max(1, len(prior))
    cr, ca, cp = {}, {}, {}
    for a, t in recent:
        for w in terms_of(t, skip):
            if w in stop:
                continue
            cr[w] = cr.get(w, 0) + 1
            ca.setdefault(w, set()).add(a)
    for a, t in prior:
        for w in terms_of(t, skip):
            cp[w] = cp.get(w, 0) + 1
    out = []
    for w, r in cr.items():
        if r < MIN_POSTS or len(ca[w]) < MIN_AUTHORS or r / nr > MAX_SHARE:
            continue
        p = cp.get(w, 0)
        d = r / nr - p / np_
        if d <= 0 or (p and (r / nr) < 1.5 * (p / np_)):
            continue
        out.append((d, r, w, p, len(ca[w])))
    out.sort(key=lambda x: (-x[0], -x[1], x[2]))
    return [{"term": w, "recent": r, "prior": p, "authors": au} for _, r, w, p, au in out[:TERMS_N]]


def tone_of(posts, lex):
    pos, neg = lex.get("pos") or [], lex.get("neg") or []
    n_pos = n_neg = n_none = 0
    for _, t in posts:
        p = sum(1 for w in pos if w in t)
        g = sum(1 for w in neg if w in t)
        if p > g:
            n_pos += 1
        elif g > p:
            n_neg += 1
        else:
            n_none += 1
    return {"n": len(posts), "pos": n_pos, "neg": n_neg, "none": n_none}


def precision(posts, key):
    """the share of sampled posts that really hold the word (東京都 holds 京都, which a search may find)"""
    if not posts:
        return None
    k = key
    ok = sum(1 for _, t in posts if k in (t.replace("東京都", "東京") if key == "京都" else t))
    return round(ok / len(posts), 2)


def one_place(pl, lex, now, recent_h, prior_h, get, sleep):
    key, q = pl["key"], pl.get("q") or pl["key"]
    t_recent, t_prior = now - recent_h * 3600, now - (recent_h + prior_h) * 3600
    hr, cr, pr = window(q, t_recent, now, SLICES, get, sleep)
    hp, cp, pp = window(q, t_prior, t_recent, SLICES, get, sleep)
    return {
        "ok": True, "q": q,
        "recent": {"n": hr, "capped": cr, "hours": recent_h, "sample": len(pr), "authors": len({a for a, _ in pr})},
        "prior": {"n": hp, "capped": cp, "hours": prior_h, "sample": len(pp)},
        "terms": rising_terms(pr, pp, skip=(key, q), stop=lex.get("stop") or []),
        "tone": tone_of(pr, lex),
        "precision": precision(pr, key),
    }


def collect(places, lex, now, recent_h, prior_h, get=http_get, sleep=time.sleep, log=lambda s: None, workers=WORKERS):
    """a few places at a time. A place is a row (with its reason when it failed); FAILS failures in a row stop the rest"""
    t0 = time.time()
    state = {"fails": 0}
    lock = threading.Lock()

    def job(pl):
        key = pl["key"]
        with lock:
            stop = state["fails"] >= FAILS
        if stop or time.time() - t0 > TOTAL_S:
            return key, {"ok": False, "err": "stopped after %d failures" % FAILS if stop else "time"}
        try:
            r = one_place(pl, lex, now, recent_h, prior_h, get, sleep)
            with lock:
                state["fails"] = 0
            return key, r
        except Exception as e:                       # a place is a row with its reason; the others go on
            with lock:
                state["fails"] += 1
            log("%s: %s: %s" % (key, type(e).__name__, str(e)[:80]))
            return key, {"ok": False, "err": "%s: %s" % (type(e).__name__, str(e)[:80])}

    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        done = dict(ex.map(job, places))
    return {pl["key"]: done[pl["key"]] for pl in places}


def compute(latest, places_doc, lex, now, get=http_get, sleep=time.sleep, log=lambda s: None):
    wh = latest.get("window_h") if isinstance(latest, dict) and isinstance(latest.get("window_h"), (int, float)) else 36
    recent_h = max(1, round(wh * RECENT_SHARE))
    prior_h = max(1, int(wh) - recent_h)
    rows = collect(places_doc.get("places") or [], lex, now, recent_h, prior_h, get, sleep, log)
    ok = sum(1 for r in rows.values() if r.get("ok"))
    return {"schema": SCHEMA, "ok": ok > 0, "generated_at": now, "source": {"name": "Bluesky", "api": "app.bsky.feed.searchPosts", "host": "api.bsky.app", "auth": "none",
            "terms_url": "https://bsky.social/about/support/tos", "docs": "docs/trend-sources.md"},
            "recent_h": recent_h, "prior_h": prior_h, "bias_ja": BIAS_JA, "tone_ja": TONE_JA, "counts": {"places": len(rows), "ok": ok}, "places": rows}


def _read(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m parallax.social")
    ap.add_argument("--out", default=str(ROOT / "data" / "social.json"))
    ap.add_argument("--places", default=str(ROOT / "data" / "social_places.json"))
    ap.add_argument("--lexicon", default=str(ROOT / "data" / "sentiment_ja.json"))
    ap.add_argument("--latest", default=str(ROOT / "data" / "latest.json"))
    ap.add_argument("--now", type=int)
    a = ap.parse_args(argv)
    now = a.now if a.now is not None else int(time.time())
    places, lex = _read(a.places), _read(a.lexicon)
    if not places or not lex:
        print("social: places or lexicon missing (previous file kept)", file=sys.stderr)
        return 0
    d = compute(_read(a.latest) or {}, places, lex, now, log=lambda s: print("social " + s, file=sys.stderr))
    if not d["ok"]:
        print("social: nothing could be read (previous file kept)", file=sys.stderr)
        return 0
    tmp = Path(a.out + ".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
    os.replace(tmp, a.out)
    print("social places=%d ok=%d (%d bytes)" % (d["counts"]["places"], d["counts"]["ok"], Path(a.out).stat().st_size))
    return 0


if __name__ == "__main__":
    sys.exit(main())
