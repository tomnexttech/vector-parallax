# -*- coding: utf-8 -*-
"""withheld — a hidden list (data/withheld.json) of what is not shown any more, applied before anything else (CONTRACT 20.9). Stdlib only.

The file holds source ids, article ids and photo permissions only: no requester, no reason, no headline.
  {"schema": "parallax-withheld/1", "sources": ["<source id>"], "items": ["<article (item) id>"],
   "photos": {"items": ["<article id whose photo is not used>"], "sources": ["<source id whose photos are not used>"]}}
  apply(items, rules)   -> (kept items, removed item ids, counts)          the fetch, before the build
  scrub(latest, rules)  -> (latest without them, number of things removed)  the previous good version that is kept (kept_previous, a refused build)
"""
import copy
import json
import os

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "withheld.json")
SCHEMA = "parallax-withheld/1"


def load(path=None):
    """-> {"sources": set, "items": set, "photo_items": set, "photo_sources": set}. A missing or unreadable file is an empty list."""
    try:
        with open(path or PATH, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    d = d if isinstance(d, dict) else {}
    ph = d.get("photos") if isinstance(d.get("photos"), dict) else {}
    s = lambda v: {x.strip() for x in v if isinstance(x, str) and x.strip()} if isinstance(v, list) else set()
    return {"sources": s(d.get("sources")), "items": s(d.get("items")),
            "photo_items": s(ph.get("items")), "photo_sources": s(ph.get("sources"))}


def empty(r):
    return not (r["sources"] or r["items"] or r["photo_items"] or r["photo_sources"])


def gone(it, r):
    return isinstance(it, dict) and (it.get("source_id") in r["sources"] or it.get("id") in r["items"])


def photo_off(it, r):
    return isinstance(it, dict) and (it.get("id") in r["photo_items"] or it.get("source_id") in r["photo_sources"])


def apply(items, rules=None):
    """items: the fetched list. -> (kept list, set of removed item ids, counts)."""
    r = rules if rules is not None else load()
    counts = {"sources": len(r["sources"]), "items": len(r["items"]), "photos": len(r["photo_items"]) + len(r["photo_sources"]),
              "items_removed": 0, "photos_cleared": 0}
    if empty(r):
        return list(items), set(), counts
    kept, removed = [], set()
    for it in items:
        if gone(it, r):
            removed.add(it.get("id"))
            counts["items_removed"] += 1
            continue
        if photo_off(it, r) and it.get("image"):
            it = dict(it, image=None)
            counts["photos_cleared"] += 1
        kept.append(it)
    return kept, removed, counts


def _prune(rows, dead):
    out = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        ids = [i for i in row.get("member_ids") or [] if i not in dead]
        if ids:
            out.append(dict(row, member_ids=ids))
    return out


def scrub(latest, rules=None):
    """The previous good version, kept when a build is refused or only the AI view is kept: take the withheld things out of it so that they cannot come back.
    -> (latest, n) with n = items removed + photos cleared (0 = the object is returned unchanged)."""
    r = rules if rules is not None else load()
    if not isinstance(latest, dict) or empty(r):
        return latest, 0
    items = latest.get("items") or {}
    dead = {i for i, it in items.items() if gone(it, r)}
    photos = [i for i, it in items.items() if i not in dead and photo_off(it, r) and it.get("image")]
    if not dead and not photos:
        return latest, 0
    d = copy.deepcopy(latest)
    for i in dead:
        d["items"].pop(i, None)
    for i in photos:
        d["items"][i]["image"] = None
    if dead:
        d["stories"] = _prune(d.get("stories"), dead)
        d["rule_clusters"] = _prune(d.get("rule_clusters"), dead)
        live_c = {c.get("cid") for c in d["rule_clusters"]}
        d["blocks"] = [dict(b, cids=[c for c in b.get("cids", []) if c in live_c]) for b in d.get("blocks") or []]
        d["blocks"] = [b for b in d["blocks"] if b["cids"]]
        d["ai_requests"] = []                           # the requests quote the headlines of what was removed
        sn = d.get("ai_snapshot")
        if isinstance(sn, dict):
            sn["stories"] = _prune(sn.get("stories"), dead)
            sn["rule_clusters"] = _prune(sn.get("rule_clusters"), dead)
    d["withheld_scrubbed"] = len(dead) + len(photos)
    return d, len(dead) + len(photos)
