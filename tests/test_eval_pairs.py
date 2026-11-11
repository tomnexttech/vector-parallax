# -*- coding: utf-8 -*-
"""tools/eval_pairs.py の試験。合成の構築 1 回分で、組の種類・種の固定・率の数え方・人と AI の印の分離を確かめる。"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

from helpers import ROOT

sys.path.insert(0, str(ROOT / "tools"))
import eval_pairs as ep  # noqa: E402


def it(i, outlet, title):
    return {"id": i, "outlet": outlet, "title": title, "link": "https://example.org/" + i, "ts": 1794390000, "lang": "ja"}


def doc():
    items = {k: it(k, o, t) for k, o, t in [
        ("a1", "A", "東京で大雨 交通に乱れ"), ("a2", "B", "東京の大雨で電車が止まる"),
        ("b1", "C", "東京 大雨で鉄道運休"), ("b2", "D", "大雨 東京の鉄道に影響"),
        ("c1", "E", "大阪で地震 震度4"), ("c2", "F", "大阪府で震度4の地震"),
        ("d1", "G", "大阪 地震で新幹線遅れ")]}
    rcs = [{"cid": "ca", "member_ids": ["a1", "a2"]}, {"cid": "cb", "member_ids": ["b1", "b2"]},
           {"cid": "cc", "member_ids": ["c1", "c2"]}, {"cid": "cd", "member_ids": ["d1"]}]
    stories = [{"sid": "s1", "origin": "ai", "bid": "b01", "rule_cids": ["ca", "cb"], "member_ids": ["a1", "a2", "b1", "b2"]},
               {"sid": "s2", "origin": "ai", "bid": "b02", "rule_cids": ["cc"], "member_ids": ["c1", "c2"]},
               {"sid": "s3", "origin": "ai", "bid": "b02", "rule_cids": ["cd"], "member_ids": ["d1"]}]
    blocks = [{"bid": "b01", "cids": ["ca", "cb"], "ai": "answered"}, {"bid": "b02", "cids": ["cc", "cd"], "ai": "answered"}]
    return {"generated_at": 1794393061, "items": items, "rule_clusters": rcs, "stories": stories, "blocks": blocks,
            "ai_run": {"provider": "gemini", "model": "m-main + m-lite", "block_models": {"b01": "m-lite", "b02": "m-main"}}}


Q = {"ai_joined": 10, "rule_joined": 10, "ai_split": 10, "near_apart": 10}


class Sample(unittest.TestCase):
    def test_groups_models_and_a_fixed_seed(self):
        a = ep.sample([("x.json", doc())], Q, seed=7)
        b = ep.sample([("x.json", doc())], Q, seed=7)
        self.assertEqual([p["pid"] for p in a["pairs"]], [p["pid"] for p in b["pairs"]])
        self.assertEqual(a["counts"], {"ai_joined": 4, "rule_joined": 3, "ai_split": 0, "near_apart": 2})
        aj = [p for p in a["pairs"] if p["group"] == "ai_joined"]
        self.assertTrue(all(p["model"] == "m-lite" for p in aj))
        self.assertTrue(all(p["model"] == "m-main" for p in a["pairs"] if p["group"] == "near_apart"))
        self.assertEqual(len({p["pid"] for p in a["pairs"]}), len(a["pairs"]))

    def test_the_html_hides_the_group_and_the_model(self):
        a = ep.sample([("x.json", doc())], Q, seed=7)
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "s.html"
            ep.write_html(a, out, {"labels": {a["pairs"][0]["pid"]: "same"}})
            t = out.read_text(encoding="utf-8")
        self.assertNotIn("ai_joined", t)
        self.assertNotIn("m-lite", t)
        self.assertNotIn("/*__DATA__*/null", t)


class Score(unittest.TestCase):
    def test_rates_count_only_the_human_marks(self):
        a = ep.sample([("x.json", doc())], Q, seed=7)
        human = {}
        for p in a["pairs"]:
            human[p["pid"]] = {"v": "diff" if p["group"] == "ai_joined" else "same"}
        first_aj = next(p["pid"] for p in a["pairs"] if p["group"] == "ai_joined")
        human[first_aj] = {"v": "unsure"}
        pre = {"labels": {p["pid"]: "same" for p in a["pairs"]}}
        res = ep.score(a, {"human": human}, pre)
        row = {r["name"]: r for r in res["human"]}
        aj = row["誤って結んだ率・AI が結んだ組"]
        self.assertEqual((aj["wrong"], aj["decided"], aj["unsure"], aj["rate"]), (3, 3, 1, 1.0))
        self.assertEqual(row["誤って結んだ率・規則が結んだ組"]["rate"], 0.0)
        self.assertEqual(row["誤って分けた率（分けた組 全体）"]["rate"], 1.0)
        self.assertIn("誤って結んだ率・AI が結んだ組・m-lite", row)
        pre_aj = {r["name"]: r for r in res["ai_prelabel"]}["誤って結んだ率・AI が結んだ組"]
        self.assertEqual(pre_aj["wrong"], 0)                       # 下読みは別の行。人の数は変わらない
        self.assertIn("AI による下読み（人の数には入れない）", ep.md_table(res))

    def test_nothing_scored_gives_no_rate(self):
        a = ep.sample([("x.json", doc())], Q, seed=7)
        res = ep.score(a, {"human": {}})
        self.assertTrue(all(r["rate"] is None for r in res["human"]))
        self.assertEqual(ep.wilson(0, 0), None)
        self.assertEqual(ep.wilson(0, 10)[0], 0.0)


if __name__ == "__main__":
    unittest.main()
