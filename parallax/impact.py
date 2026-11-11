# -*- coding: utf-8 -*-
"""impact — 暮らしへの影響が大きい政策のラベル（data/impact.json、CONTRACT §25.2）。stdlib だけ・AI は使わない。

    python -m parallax.impact [--latest data/latest.json] [--politics data/politics.json] [--out data/impact.json]

語の表は data/lifewords.json（手で書いて公開する）。分野ごとに強い語 2・弱い語 1 を足し、閾値以上の分野だけを付ける。
政策の語（policy）か官公庁の一次資料が一つも無い出来事には付けない。画面は当たった語（hits）をそのまま根拠として出す。

  quiet  測れる事だけ：一次資料（官公庁・官報・法案・意見募集）があり、かつ主要な型（sources.MAINSTREAM_TYPES）の見出しが 1 社以下。
         画面の言葉は「主要な媒体の見出し n 社」で、「隠されている」「報じない」とは言わない。
  docs   ニュースに結ばれない一次資料も載せる（官報・法案・意見募集。DOCS_MAX まで）
"""
import argparse
import datetime as dt
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

try:
    from parallax import sources as sources_mod
except ImportError:                                       # parallax/ の中から直に走らせた時
    import sources as sources_mod  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = "parallax-impact/1"
GOV = "政府一次"
PRIMARY_SOURCES = ("primary-kanpo", "primary-shugiin", "primary-sangiin", "primary-jbaudit", "egov-pc")
DOCS_MAX = 30
HITS_MAX = 5
JST = dt.timezone(dt.timedelta(hours=9))


def load_vocab(path=None):
    p = Path(path) if path else ROOT / "data" / "lifewords.json"
    return json.loads(p.read_text(encoding="utf-8"))


def _n(t):
    return unicodedata.normalize("NFKC", t or "")


def score(text, vocab):
    """-> (areas, hits, stage)。areas は閾値以上の分野（点の高い順）、hits は当たった語（強い語を先に）"""
    t = _n(text)
    got = []
    for a in vocab["areas"]:
        strong = [w for w in a["strong"] if _n(w) in t]
        weak = [w for w in a["weak"] if _n(w) in t and not any(_n(w) in _n(s) for s in strong)]
        sc = vocab["strong"] * len(strong) + vocab["weak"] * len(weak)
        if sc >= vocab["threshold"]:
            got.append((sc, a["id"], strong + weak))
    got.sort(key=lambda x: (-x[0], x[1]))
    hits = []
    for _sc, _id, ws in got:
        for w in ws:
            if w not in hits:
                hits.append(w)
    stage = None
    for st in vocab.get("stages") or []:
        if any(_n(w) in t for w in st["words"]):
            stage = st["id"]
            break
    return [x[1] for x in got], hits[:HITS_MAX], stage


def is_policy(text, vocab):
    t = _n(text)
    return any(_n(w) in t for w in vocab.get("policy") or [])


def _primary(it):
    return it.get("type") == GOV or it.get("source_id") in PRIMARY_SOURCES


def _date(ts):
    try:
        return dt.datetime.fromtimestamp(int(ts), JST).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _docs(politics, items, owner, vocab):
    rows = []
    pol = politics if isinstance(politics, dict) else {}
    for r in pol.get("gazette") or []:
        rows.append(("gazette", r))
    for house in ("shugiin", "sangiin"):
        for r in ((pol.get("bills") or {}).get("recent") or {}).get(house) or []:
            rows.append(("bill", r))
    pcs = list(pol.get("pubcomment") or [])
    known = {r.get("id") for r in pcs if isinstance(r, dict)}
    pcs += [{"id": it.get("id"), "title": it.get("title"), "link": it.get("link"), "ts": it.get("ts")}
            for it in items.values() if it.get("source_id") == "egov-pc" and it.get("id") not in known]
    rows += [("pubcomment", r) for r in pcs]
    out, seen = [], set()
    for kind, r in rows:
        if not isinstance(r, dict) or not isinstance(r.get("title"), str) or r.get("id") in seen:
            continue
        link = r.get("link") if isinstance(r.get("link"), str) and r["link"].startswith("https://") else None
        areas, hits, _st = score(r["title"], vocab)
        if not areas or not link:
            continue
        seen.add(r.get("id"))
        sid = owner.get(r.get("id"))
        out.append({"kind": kind, "title": r["title"][:160], "url": link, "date": _date(r.get("ts")), "ts": r.get("ts"), "areas": areas, "hits": hits,
                    "sid": sid[0] if sid else None, "mainstream_n": sid[1] if sid else 0})
    out.sort(key=lambda d: (-(d["ts"] or 0), d["url"]))
    for d in out:
        d.pop("ts", None)
    return out[:DOCS_MAX]


def compute(latest, politics=None, now=None, vocab=None):
    vocab = vocab or load_vocab()
    items = latest.get("items") or {}
    if isinstance(items, list):
        items = {it.get("id"): it for it in items if isinstance(it, dict)}
    mainstream = set(getattr(sources_mod, "MAINSTREAM_TYPES", ()))
    events, owner = {}, {}
    for s in latest.get("stories") or []:
        if not isinstance(s, dict) or not s.get("sid"):
            continue
        ms = [items[i] for i in s.get("member_ids") or [] if i in items]
        main_n = len({m.get("outlet") for m in ms if m.get("type") in mainstream and m.get("home") == "jp"})
        for m in ms:
            owner[m.get("id")] = (s["sid"], main_n)
        ai = s.get("ai") if isinstance(s.get("ai"), dict) else {}
        text = " ".join([m.get("title") or "" for m in ms] + [m.get("desc") or "" for m in ms if isinstance(m.get("desc"), str)]
                        + [ai.get("headline_ja") or ""])
        primary = any(_primary(m) for m in ms)
        if not (primary or is_policy(text, vocab)):
            continue
        areas, hits, stage = score(text, vocab)
        if not areas:
            continue
        events[s["sid"]] = {"areas": areas, "hits": hits, "stage": stage, "primary": primary, "mainstream_n": main_n,
                            "quiet": bool(primary and main_n <= 1), "n_outlets": s.get("n_outlets") or len({m.get("outlet") for m in ms})}
    return {"schema": SCHEMA, "generated_at": int(now if now is not None else time.time()), "latest_generated_at": latest.get("generated_at"),
            "vocab": vocab.get("schema"), "caveat": vocab.get("caveat"), "rule": {"strong": vocab["strong"], "weak": vocab["weak"], "threshold": vocab["threshold"]},
            "areas": [{"id": a["id"], "ja": a["ja"]} for a in vocab["areas"]],
            "events": events, "docs": _docs(politics, items, owner, vocab),
            "counts": {"events": len(events), "quiet": sum(1 for e in events.values() if e["quiet"])}}


def _read(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m parallax.impact")
    ap.add_argument("--latest", default=str(ROOT / "data" / "latest.json"))
    ap.add_argument("--politics", default=str(ROOT / "data" / "politics.json"))
    ap.add_argument("--out", default=str(ROOT / "data" / "impact.json"))
    a = ap.parse_args(argv)
    latest = _read(a.latest)
    if not latest:
        print("impact: no latest.json (previous file kept)", file=sys.stderr)
        return 0
    d = compute(latest, _read(a.politics))
    from parallax.extras import write_json
    write_json(a.out, d)
    print("impact events=%d quiet=%d docs=%d" % (d["counts"]["events"], d["counts"]["quiet"], len(d["docs"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
