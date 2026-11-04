# -*- coding: utf-8 -*-
"""traps — one table of reading traps for places, concepts and flags (data/traps.json, CONTRACT 20.4). Stdlib only.

  fix(text)        a trap phrase is rewritten to its true reading ("米中間選挙" -> "米国中間選挙"), so that "米中" is not read as US and China
  place_traps()    {concept id: (phrase, ...)}: phrases that must not feed that concept (cluster.PLACE_TRAPS has this form)
  readings(text)   [(place key, position)] for the trap phrases the text holds: the place they really mean
  bare_blocked(key, text, loc)   True when the place key is one bare word ("日本") with no second cue: it must not put an event in Japan
"""
import json
import os
import re

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "traps.json")
_T = json.load(open(PATH, encoding="utf-8"))
PHRASES = _T["phrases"]
_BARE = {}
for _id, _b in _T.get("bare", {}).items():
    _rx = re.compile(_b["needs"])
    for _k in _b["keys"]:
        _BARE[_k] = _rx


def fix(text):
    t = text or ""
    for p in PHRASES:
        if p["text"] in t:
            t = t.replace(p["text"], p["as"])
    return t


def place_traps():
    out = {}
    for p in PHRASES:
        for cid in p.get("not", []):
            out.setdefault(cid, []).append(p["text"])
    return {k: tuple(v) for k, v in out.items()}


def readings(text):
    t = text or ""
    return [(p["reads_key"], t.find(p["text"])) for p in PHRASES if p.get("reads_key") and p["text"] in t]


def bare_blocked(key, text, loc=False):
    rx = _BARE.get(key)
    if rx is None or loc:
        return False
    return not rx.search(text or "")
