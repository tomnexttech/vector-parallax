# -*- coding: utf-8 -*-
"""試験の共通部品。repo の根を sys.path に入れ、fixture を読み、偽の AI の答えを作る。網には出ない。"""
import os
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
FIX = ROOT / "tests" / "fixtures"
NOW = 1762300000                      # tests/fixtures/make_fixture.py の NOW と同じ

from parallax import build, ai, validate  # noqa: E402


def load_items():
    with open(FIX / "items.json", encoding="utf-8") as f:
        return json.load(f)


os.environ["PARALLAX_RIGHTS"] = "strict"          # build.main を通す試験も strict で
build.set_rights("strict")


def load_prompt():
    return build.load_prompt(rights="strict")      # 既存の試験は strict（今までの動き）。quote の試験は tests/test_quote.py


def build_fixture(provider=None, status_if_none="off", public=False, window_h=36):
    snap = load_items()
    return build.build(snap["items"], snap["sources"], NOW, window_h, provider, status_if_none,
                       load_prompt(), public)


def doc_of(user_text):
    m = re.search(r"<doc>\n(.*)\n</doc>", user_text, re.S)
    return json.loads(m.group(1))


def rules_answer(user_text, edit=None):
    """要求の rule_groups をそのまま story にした答え（行儀のよい AI）。edit(answer, doc) で壊せる。"""
    doc = doc_of(user_text)
    blocks = []
    for b in doc["blocks"]:
        stories = []
        for g in b["rule_groups"]:
            stories.append({"member_ids": list(g), "headline_ja": "試験 題 %s" % b["bid"],
                            "headline_en": "Test event line %s" % b["bid"],
                            "angles": [{"item_id": a, "focus_ja": "試験の焦点"} for a in g],
                            "contrast_ja": "", "flags": [], "flag_note_ja": ""})
        blocks.append({"bid": b["bid"], "stories": stories})
    ans = {"blocks": blocks}
    if edit:
        edit(ans, doc)
    return json.dumps(ans, ensure_ascii=False)


def fake(edit=None):
    return ai.FakeProvider(lambda system, user_text, schema: rules_answer(user_text, edit))


def check_invariants(tc, data):
    """CONTRACT §2 の不変条件。"""
    rc = data["rule_clusters"]
    ids_rule = [i for r in rc for i in r["member_ids"]]
    tc.assertEqual(len(ids_rule), len(set(ids_rule)), "規則の束の間で item が重複している")
    tc.assertEqual(set(data["items"]), set(ids_rule), "items は規則の束が指す物だけ")
    tc.assertEqual([(-r["n_outlets"], -r["last_ts"], r["cid"]) for r in rc],
                   sorted((-r["n_outlets"], -r["last_ts"], r["cid"]) for r in rc))
    ids_story = [i for s in data["stories"] for i in s["member_ids"]]
    tc.assertEqual(len(ids_story), len(set(ids_story)), "item が二つの story に入っている")
    tc.assertEqual(set(ids_story), set(ids_rule), "全ての item がどれかの story に入る")
    tc.assertEqual([(-s["n_outlets"], -s["last_ts"], s["sid"]) for s in data["stories"]],
                   sorted((-s["n_outlets"], -s["last_ts"], s["sid"]) for s in data["stories"]))
    for s in data["stories"]:
        tc.assertEqual(s["sid"], "s" + hashlib.sha1("|".join(sorted(s["member_ids"])).encode()).hexdigest()[:12])
        tc.assertEqual(s["n_outlets"], len(s["outlets"]))
        tc.assertEqual(len(s["outlets"]), len(set(s["outlets"])))
        tc.assertIn(s["origin"], ("ai", "rule"))
        tc.assertEqual(s["origin"] == "ai", s["ai"] is not None)
        tc.assertIn("basis", s)
        if len(s["member_ids"]) < 2:
            tc.assertIsNone(s["basis"])
        else:
            tc.assertEqual(sorted(s["basis"]), ["by", "places", "time_span", "words"])
            tc.assertEqual(s["basis"]["by"], s["origin"])
            tc.assertEqual(s["basis"]["time_span"], s["last_ts"] - s["first_ts"])
            tc.assertLessEqual(len(s["basis"]["words"]), 6)
        for i in s["member_ids"]:
            tc.assertIn(i, data["items"])
        tc.assertEqual(s["first_ts"], min(data["items"][i]["ts"] for i in s["member_ids"]))
        tc.assertEqual(s["last_ts"], max(data["items"][i]["ts"] for i in s["member_ids"]))
        tc.assertTrue(set(s["rule_cids"]) <= {r["cid"] for r in rc})
    for b in data["blocks"]:
        tc.assertIn(b["ai"], ("answered", "fallback", "none"))
    cids = [c for b in data["blocks"] for c in b["cids"]]
    tc.assertEqual(len(cids), len(set(cids)), "塊の間で束が重複している")
    tc.assertEqual([b["bid"] for b in data["blocks"]], ["b%02d" % (n + 1) for n in range(len(data["blocks"]))])
    for r in data["ai_requests"]:
        for a, i in r["alias"].items():
            tc.assertRegex(a, r"^n\d+$")
            tc.assertIn(i, data["items"])
