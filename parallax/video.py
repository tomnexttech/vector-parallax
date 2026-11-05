# -*- coding: utf-8 -*-
"""video — the broadcasters' own YouTube channels, matched to the events (CONTRACT §18.14; standard library only).

The page used to ask YouTube for "what this channel is streaming now", and a channel may stream anything (a 24-hour nature camera came up in
the news pane). Here the build reads the public feed of each channel (https://www.youtube.com/feeds/videos.xml?channel_id=..., the newest 15
uploads, no key), compares each video's title with the headlines of each event by the same word-overlap rule that puts headlines together
(cluster._sim_feat), and writes the videos that fit into `stories[].videos` (at most 3, newest first). What is written is a quotation of the
channel's own title: the station, the time and the video id (the page makes the link and the youtube-nocookie embed). No video is downloaded.

The channel table is the one in js/tv.js (read from it, so the page and the build never disagree). A channel that cannot be read is skipped;
nothing here raises into the build.
"""
import concurrent.futures as cf
import datetime
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from parallax import cluster, feeds

ROOT = Path(__file__).resolve().parent.parent
FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=%s"
MATCH_T = 0.42            # least similarity of a video title and one headline of the event; fixed on the live pairs of 2026-11-05 (a video of the same broad topic, another angle of one election, scored 0.40 or less)
MAX_VIDEOS = 3            # per event
MAX_TEXTS = 14            # headlines of one event that are compared
BEFORE_S = 12 * 3600      # a video may come this long before the first report of the event ...
AFTER_S = 36 * 3600       # ... and this long after the last one
TITLE_MAX = 120
VID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}
_ROW = re.compile(r"\{\s*id:\s*'(\w+)',\s*short:\s*'([^']+)',\s*name:\s*'([^']+)',\s*ch:\s*'(UC[\w-]{22})',\s*mode:\s*'(\w+)'")


def stations(path=None):
    """-> [{id, short, name, ch, mode}] read from the table in js/tv.js (the one place the channels are written)."""
    p = Path(path) if path else ROOT / "js" / "tv.js"
    text = p.read_text(encoding="utf-8")
    return [dict(zip(("id", "short", "name", "ch", "mode"), m)) for m in _ROW.findall(text)]


def _epoch(s):
    try:
        d = datetime.datetime.fromisoformat((s or "").strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=datetime.timezone.utc)
    return int(d.timestamp())


def _title(s):
    return re.sub(r"\s+", " ", s or "").strip()[:TITLE_MAX]


def parse_feed(text, st):
    """A channel feed (Atom) -> [{id, title, ts, station}], newest first. A broken feed gives []; a row with a bad id, no time or no title is dropped."""
    try:
        root = ET.fromstring(text)
    except (ET.ParseError, TypeError, ValueError):
        return []
    out = []
    for en in root.findall("a:entry", _NS):
        vid = (en.findtext("yt:videoId", "", _NS) or "").strip()
        title = _title(en.findtext("a:title", "", _NS))
        ts = _epoch(en.findtext("a:published", "", _NS))
        if VID_RE.match(vid) and title and ts:
            out.append({"id": vid, "title": title, "ts": ts, "station": st["id"]})
    out.sort(key=lambda v: -v["ts"])
    return out


def fetch(sts, get=None, workers=11):
    """-> (videos, failed station ids). `get(url) -> text` replaces the network in tests."""
    get = get or feeds._get
    videos, failed = [], []

    def one(st):
        return st, parse_feed(get(FEED_URL % st["ch"]), st)

    with cf.ThreadPoolExecutor(max_workers=max(1, min(workers, len(sts) or 1))) as ex:
        futs = [ex.submit(one, st) for st in sts]
        for st, fu in zip(sts, futs):
            try:
                _st, vs = fu.result()
            except Exception:
                vs = []
            if vs:
                videos += vs
            else:
                failed.append(st["id"])
    return videos, failed


def _texts(story, by_id):
    """The headlines of an event: its members' titles, then the AI headlines (all quotations or the project's own neutral line)."""
    out, seen = [], set()
    cand = [(by_id.get(i) or {}).get("title") for i in story.get("member_ids") or []]
    ai = story.get("ai") if isinstance(story.get("ai"), dict) else {}
    cand += [ai.get("headline_ja"), ai.get("headline_en")]
    for t in cand:
        if isinstance(t, str) and t.strip() and t not in seen:
            seen.add(t)
            out.append(t)
    return out[:MAX_TEXTS]


def match(stories, items, videos, now=None, names=None):
    """-> {sid: [video, ...]} (newest first, at most MAX_VIDEOS). A video fits an event when its title is similar enough to one headline of the
    event (the clustering rule: rare words and numbers count, a conflict of numbers or places vetoes) and it was published near the event's time."""
    by_id = {it["id"]: it for it in items or [] if isinstance(it, dict) and isinstance(it.get("id"), str)}
    vids = [v for v in videos or [] if isinstance(v, dict) and v.get("title") and isinstance(v.get("ts"), int) and (now is None or v["ts"] <= now + 3600)]
    if not vids:
        return {}
    feats, vf = {}, []

    def feat(t, src=""):
        k = (t, src)
        if k not in feats:
            feats[k] = cluster.Feat(t, src)
        return feats[k]

    names = names or {}
    for v in vids:
        vf.append(feat(v["title"], names.get(v["station"], "")))
    per_story = [(s, _texts(s, by_id)) for s in stories or [] if isinstance(s, dict) and s.get("sid")]
    allf = list(vf) + [feat(t) for _s, ts in per_story for t in ts]
    df, cdf = {}, {}
    for f in dict.fromkeys(allf):
        for e in f.ents | f.grams:
            df[e] = df.get(e, 0) + 1
        for c in f.concepts:
            cdf[c] = cdf.get(c, 0) + 1
    ctx = cluster._Ctx(df, len(set(allf)), cdf)
    index = {}
    for i, f in enumerate(vf):
        for k in f.ents | f.concepts:
            index.setdefault(k, []).append(i)
    out = {}
    for s, texts in per_story:
        lo, hi = (s.get("first_ts") or 0) - BEFORE_S, (s.get("last_ts") or 0) + AFTER_S
        got = {}
        for t in texts:
            f = feat(t)
            cand = set()
            for k in f.ents | f.concepts:
                cand.update(index.get(k, ()))
            for i in cand:
                v = vids[i]
                if v["id"] in got or not (lo <= v["ts"] <= hi):
                    continue
                sc, veto, _ = cluster._sim_feat(f, vf[i], ctx=ctx, why=False)
                if not veto and sc >= MATCH_T:
                    got[v["id"]] = v
        if got:
            out[s["sid"]] = sorted(got.values(), key=lambda v: (-v["ts"], v["id"]))[:MAX_VIDEOS]
    return out


def attach(data, items, now, get=None, blocked=None, sts=None):
    """Read the channels, match, and write `videos` into each event of data["stories"] that has any. Returns a report {stations, ok, failed, fetched, events, videos}.
    `blocked(text) -> bool` drops a station or a title that must not appear (the name gate, a withheld outlet)."""
    blocked = blocked or (lambda _t: False)
    sts = [st for st in (sts if sts is not None else stations()) if not blocked(st["name"])]
    videos, failed = fetch(sts, get)
    names = {st["id"]: st["name"] for st in sts}
    videos = [v for v in videos if not blocked(v["title"])]
    for s in data.get("stories", []):
        s.pop("videos", None)
    hit = match(data.get("stories", []), items, videos, now, names)
    by_sid = {s.get("sid"): s for s in data.get("stories", [])}
    for sid, vs in hit.items():
        by_sid[sid]["videos"] = [dict(v) for v in vs]
    return {"stations": len(sts), "ok": len(sts) - len(failed), "failed": failed, "fetched": len(videos),
            "events": len(hit), "videos": len({v["id"] for vs in hit.values() for v in vs}), "names": names}
