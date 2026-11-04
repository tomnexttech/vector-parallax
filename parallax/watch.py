# -*- coding: utf-8 -*-
"""watch — the "need to know" net: which of six topics a headline touches, and which words made it so (CONTRACT 18.2).

The six flags are money (予算・公費), law (法), security (安保), disaster (災害), power (政治・人事: accountability) and tech (技術).
Their ids are internal; the displayed names are the topic names in data/watchwords.json (CONTRACT 20.4). A trap phrase (data/traps.json) is rewritten to its true reading first ("米中間選挙" is not "米中").
The vocabulary is a table (data/watchwords.json) so that it can be read, argued with and changed without touching code.

  score  a strong word counts 2, a weak word 1; a flag is set at >= threshold (2): one strong word or two weak ones
  words  Japanese words match as substrings after NFKC; ASCII words match on word boundaries, case-insensitively,
         with a plural s/es; a word inside a longer matched word is not counted twice
  mask   words blanked before matching ("防衛戦" must not raise security through "防衛")
  exclude  sport, entertainment and weather words clear a flag - except a strong word of money/law/security and a strong
         pattern of disaster (seismic intensity, magnitude, special warnings), which a "weather" headline must not hide

The flags are subject tags. They decide what is shown in PRIORITY and in what order, so the list of words is part of the
editorial choice and is published as data. `hits` returns the matched words: the page can say why a story is there.
Stdlib only. A headline of None is "unknown" (all flags False, error set), never "no".
"""
import json
import os
import re
import unicodedata

try:
    from parallax import traps
except ImportError:                                   # run from inside parallax/
    import traps  # type: ignore

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "data", "watchwords.json")
FLAGS = ("money", "law", "security", "disaster", "power", "tech")
_PROTECTED = ("money", "law", "security")          # a strong word survives an exclude word

_state = {}


def _norm(s):
    return unicodedata.normalize("NFKC", s or "")


def _is_ascii_word(w):
    return bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 .&'\-]*", w))


def _en_rx(w):
    return re.compile(r"(?<![A-Za-z0-9])" + re.escape(w) + r"(?:s|es)?(?![A-Za-z0-9])", re.I)


def _split(words):
    ja = [_norm(w) for w in words if not _is_ascii_word(w)]
    en = [(w, _en_rx(_norm(w))) for w in words if _is_ascii_word(w)]
    return ja, en


def load(path=None):
    """Read the table (cached by path and mtime). Raises when the file is unreadable."""
    p = path or PATH
    mtime = os.path.getmtime(p)
    st = _state.get(p)
    if st and st["mtime"] == mtime:
        return st
    with open(p, encoding="utf-8") as f:
        d = json.load(f)
    flags = {}
    for k in FLAGS:
        s = d["flags"].get(k) or {}
        sj, se = _split(s.get("strong", []))
        wj, we = _split(s.get("weak", []))
        flags[k] = {"strong_ja": sj, "strong_en": se, "weak_ja": wj, "weak_en": we,
                    "strong_re": [(x, re.compile(x)) for x in s.get("strong_re", [])],
                    "weak_re": [(x, re.compile(x)) for x in s.get("weak_re", [])]}
    exj, exe = _split(d.get("exclude", []))
    st = {"path": p, "mtime": mtime, "threshold": d["threshold"], "w_strong": d["weights"]["strong"],
          "w_weak": d["weights"]["weak"], "mask": [_norm(m) for m in d.get("mask", [])], "flags": flags,
          "ex_ja": exj, "ex_en": exe, "labels": d.get("labels", {}),
          "light": {k: re.compile(v) for k, v in (d.get("light") or {}).items()}}
    _state[p] = st
    return st


def labels():
    return load()["labels"]


def _find(text, ja, en):
    hits = [w for w in ja if w in text]
    hits += [w for w, rx in en if rx.search(text)]
    return hits


def _find_re(text, pats):
    out = []
    for _, rx in pats:
        m = rx.search(text)
        if m:
            out.append(m.group(0))
    return out


def flags(title):
    """-> {flag: bool, ..., "hits": [words in the order flags are listed], "score": {flag: n}, "excluded": [words]}.
    title None/"" -> all False with "error" set (unknown is not "no")."""
    st = load()
    res = {f: False for f in FLAGS}
    if not title:
        res.update(hits=[], score={f: 0 for f in FLAGS}, excluded=[], error="no headline")
        return res
    text = traps.fix(_norm(title))
    masked = text
    for m in st["mask"]:
        masked = masked.replace(m, " ")
    hits, score, strong_by, re_strong_by = [], {}, {}, {}
    for f in FLAGS:
        s = st["flags"][f]
        hs = _find(masked, s["strong_ja"], s["strong_en"])
        hw = _find(masked, s["weak_ja"], s["weak_en"])
        rs = _find_re(text, s["strong_re"])
        rw = _find_re(text, s["weak_re"])
        strong_all = hs + rs
        hw = [w for w in hw if not any(w != x and w.lower() in x.lower() for x in strong_all + hw)]
        hs = [w for w in hs if not any(w != x and w.lower() in x.lower() for x in hs)]
        pts = st["w_strong"] * (len(hs) + len(rs)) + st["w_weak"] * (len(hw) + len(rw))
        score[f] = pts
        strong_by[f], re_strong_by[f] = bool(hs), bool(rs)
        res[f] = pts >= st["threshold"]
        for w in hs + rs + hw + rw:
            if w not in hits:
                hits.append(w)
    excluded = _find(text, st["ex_ja"], st["ex_en"])
    if excluded:
        for f in FLAGS:
            keep = (f in _PROTECTED and strong_by[f]) or (f == "disaster" and re_strong_by[f])
            if not keep:
                res[f] = False
    res["hits"], res["score"], res["excluded"] = hits, score, excluded
    return res


def is_light(titles, share=0.3, max_titles=12):
    """Is the story sport / entertainment / games? True when the representative headline (titles[0]) matches, or when
    `share` of up to `max_titles` distinct member headlines match. Used to keep such stories out of "outside your interest"."""
    st = load()
    sp, en = st["light"].get("sport"), st["light"].get("entertain")
    if not (sp and en):
        return False
    titles = [t for t in titles if t]
    if not titles:
        return False
    if sp.search(titles[0]) or en.search(titles[0]):
        return True
    uniq = []
    for t in titles:
        if t not in uniq:
            uniq.append(t)
    uniq = uniq[:max_titles]
    hit = sum(1 for t in uniq if sp.search(t) or en.search(t))
    return hit / float(len(uniq)) >= share
