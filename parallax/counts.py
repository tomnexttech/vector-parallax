# -*- coding: utf-8 -*-
"""counts — the one place that defines the numbers a page and the A4 sheet print (CONTRACT 20.2). Stdlib only; no network.

  base(data, raw_items, now, window_h)   numbers that depend only on the fetch and the rule clusters (the same in stats.json and board.json)
  board_part(...)                        numbers of the board (flags, priority, asymmetry, events); added by board.compose
  merge(base, part)                      -> the one `counts` object. board.json and stats.json carry the same object.

A count has a unit (feed / headline / rule cluster / story / board unit / event); the unit is part of the key's meaning, never mixed.
"""


def _is_item(x):
    return isinstance(x, dict)


def _homes_kind(r):
    h = list(r.get("homes") or [])
    if "jp" in h and "intl" in h:
        return "both"
    return "jp_only" if h == ["jp"] else "intl_only" if h == ["intl"] else "other"


def base(data, raw_items, pool_len=None):
    """data: latest.json dict; raw_items: every item the fetch returned (after the withheld list); pool_len: items inside the story window."""
    pool_len = len(data.get("items") or {}) if pool_len is None else pool_len
    rows = data.get("sources") or []
    rcs = data.get("rule_clusters") or []
    home = {"jp_only": 0, "intl_only": 0, "both": 0}
    multi = 0
    for r in rcs:
        k = _homes_kind(r)
        if k in home:
            home[k] += 1
        if (r.get("n_outlets") or 0) >= 2:
            multi += 1
    return {
        "sources": {"total": len(rows), "ok": sum(1 for r in rows if r.get("ok")), "failed": sum(1 for r in rows if not r.get("ok"))},
        "headlines": {"fetched": sum(1 for x in raw_items if _is_item(x)), "in_window": data.get("window_items", pool_len), "clustered": pool_len},
        "bundles": {"rule": len(rcs), "stories": len(data.get("stories") or []), "events": None},
        "multi_outlet": multi,
        "home": home,
        "flagged": None, "priority": None, "asymmetric": None, "incidents": None,
    }


def board_part(flag_counts, flagged_any, n_priority, asym_total, asym_shown, asym_by_kind, n_events, n_units):
    return {"events_units": n_units,
            "flagged": dict(flag_counts, any=flagged_any), "priority": n_priority,
            "asymmetric": {"total": asym_total, "shown": asym_shown, "by_kind": asym_by_kind},
            "incidents": n_events}


def merge(b, part=None):
    out = dict(b)
    out["bundles"] = dict(b["bundles"])
    if part:
        out["bundles"]["events"] = part["events_units"]
        for k in ("flagged", "priority", "asymmetric", "incidents"):
            out[k] = part[k]
    return out
