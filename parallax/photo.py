# -*- coding: utf-8 -*-
"""photo — which single image an event may show (CONTRACT 20.5). Stdlib only; no network.

  eligible(members)   (True, "") or (False, why): two or more outlets; not an incident or accident; at least one image from a non-wire member
  pick(members)       the member whose image is shown (one per event), or None

Reasons: single_outlet / incident / wire_only / no_image. A wire-service photo (type 通信社) is never chosen (people in the frame, weight of rights),
and an event about a crime or an accident is given none by default. The image is loaded from the outlet's own server by the page; nothing is copied.
"""
import re

SKIP_TYPES = {"通信社"}
INCIDENT_SHARE = 0.34
_MAJOR = {"公共放送", "全国紙", "通信社", "経済紙", "民放", "地方紙", "海外公共"}
INCIDENT_RE = re.compile(
    r"逮捕|容疑|送検|起訴|書類送検|殺害|殺人|強盗|窃盗|詐欺|強制わいせつ|不同意|暴行|傷害|誘拐|放火|ひき逃げ|轢|立てこもり|刺さ|刺し|襲撃|銃撃|発砲|拳銃|"
    r"遺体|死亡|死傷|重軽傷|負傷|けが人|不明|事故|火災|爆発|墜落|衝突|転落|転覆|脱線|遭難|被害者|犠牲|"
    r"(?i:\b(?:killed|dead|dies|death|shooting|shot|stabbing|stabbed|arrested|crash|collision|explosion|murder|injured|wounded|hostage|attack(?:ed)?)\b)")


def incident(titles, rep_title=None):
    ts = [t for t in titles if t]
    if rep_title and INCIDENT_RE.search(rep_title):
        return True
    if not ts:
        return False
    return sum(1 for t in ts if INCIDENT_RE.search(t)) / float(len(ts)) >= INCIDENT_SHARE


def _has_image(m):
    im = m.get("image")
    return isinstance(im, dict) and bool(im.get("url"))


def eligible(members, rep_title=None, check_image=True):
    members = [m for m in members if m]
    if len({m.get("outlet") for m in members if m.get("outlet")}) < 2:
        return False, "single_outlet"
    if incident([m.get("title") or "" for m in members], rep_title):
        return False, "incident"
    if check_image:
        imgs = [m for m in members if _has_image(m)]
        if not imgs:
            return False, "no_image"
        if not [m for m in imgs if m.get("type") not in SKIP_TYPES]:
            return False, "wire_only"
    return True, ""


def _order(m):
    ja = 0 if (m.get("lang") == "ja") else 1
    major = 0 if (m.get("type") in _MAJOR) else 1
    return (ja, major, -(m.get("ts") or 0), m.get("id") or "")


def pick(members, rep_title=None):
    ok, _ = eligible(members, rep_title)
    if not ok:
        return None
    cands = [m for m in members if _has_image(m) and m.get("type") not in SKIP_TYPES]
    return sorted(cands, key=_order)[0]
