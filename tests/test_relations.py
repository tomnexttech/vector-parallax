# -*- coding: utf-8 -*-
"""CONTRACT 24: data/relations.json — ニュース同士の結び付きと、束ねた根拠。規則だけ・AI なし・網なし。"""
import json
import random
import sys
import time
import unittest

from helpers import ROOT, FIX
sys.path.insert(0, str(FIX))
from parallax import relations  # noqa: E402
import make_data_samples as S  # noqa: E402


class RelationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.latest, cls.board, _p = S.sample(ai=True)
        cls.rel = relations.compute(cls.latest, cls.board, S.NOW)

    def test_shape_and_method(self):
        r = self.rel
        self.assertEqual(r["schema"], "parallax-relations/1")
        self.assertEqual(r["method"]["ai"], False)
        self.assertEqual(r["latest_generated_at"], self.latest["generated_at"])
        sids = {n["sid"] for n in r["nodes"]}
        self.assertNotIn("s7000000000g7", sids)                      # 1 社だけの出来事は node にしない
        for e in r["edges"]:
            self.assertLess(e["a"], e["b"])
            self.assertIn(e["a"], sids)
            self.assertIn(e["b"], sids)
            self.assertGreaterEqual(e["w"], relations.MIN_W)
            self.assertLessEqual(e["w"], 1.0)
            self.assertTrue(e["why"]["words"] or e["why"]["aliases"] or (e["why"]["places"] and e["why"]["nums"]))

    def test_related_events_are_joined_by_the_words_they_share(self):
        pairs = {(e["a"], e["b"]): e for e in self.rel["edges"]}
        e = pairs[("s1000000000a1", "s8000000000h8")]
        self.assertIn("国防長官", e["why"]["words"])
        self.assertIn(("s2000000000b2", "sa000000000j1"), pairs)
        self.assertNotIn(("s1000000000a1", "s2000000000b2"), pairs)     # 共通の語の無い物は結ばない
        g = self.rel["groups"]
        self.assertEqual(len(g), 1)
        self.assertEqual(set(g[0]["sids"]), {"s1000000000a1", "s8000000000h8", "s9000000000i9"})

    def test_each_node_has_at_most_k_edges_of_its_own(self):
        src = {}
        for e in self.rel["edges"]:
            src[e["a"]] = src.get(e["a"], 0) + 1
            src[e["b"]] = src.get(e["b"], 0) + 1
        self.assertTrue(all(v <= 2 * relations.K for v in src.values()))

    def test_same_for_the_ai_merge_measures_the_join_by_rule(self):
        s = self.rel["same"]["s5600000000e5"]
        self.assertEqual(s["by"], "ai")
        self.assertEqual(s["rule_groups"], 2)
        self.assertEqual(s["ai"]["model"], "fake-model-1")
        j = s["ai_joined"][0]
        self.assertEqual(len(j["cids"]), 2)
        self.assertIn("架空港", j["best"]["words"])
        r = self.rel["same"]["s1000000000a1"]
        self.assertEqual(r["by"], "rule")
        self.assertLessEqual(len(r["links"]), relations.MAX_LINKS)
        self.assertTrue(all(l["a"] != l["b"] for l in r["links"]))
        self.assertTrue(all(isinstance(l["dt_min"], int) for l in r["links"]))

    def test_an_ai_join_with_no_rule_match_keeps_its_words_empty(self):
        latest, board, _p = S.sample(ai=True)
        for i in ("f6000000000000f1", "f6000000000000f2"):
            latest["items"][i]["title"] = "まったく別の題 %s" % i[-2:]
        s = relations.compute(latest, board, S.NOW)["same"]["s5600000000e5"]
        self.assertEqual(s["ai_joined"][0]["best"]["words"], [])          # 一致を補って作らない

    def test_no_ai_run_still_gives_every_part(self):
        latest, board, _p = S.sample(ai=False)
        r = relations.compute(latest, board, S.NOW)
        self.assertTrue(r["nodes"] and r["edges"] and r["same"])
        self.assertTrue(all(v["by"] == "rule" for v in r["same"].values()))

    def test_cross_language_needs_an_alias_place_or_number(self):
        a = relations._doc("s1", ["半導体の新工場 架空県に"], ["半導体の新工場 架空県に"], 0)
        b = relations._doc("s2", ["Fictive builds semiconductor plant"], ["Fictive builds semiconductor plant"], 0)
        relations._vectors([a, b])
        w, why = relations.why_of(a, b)
        self.assertIsNone(why)                                          # 別名が一つだけでは結ばない
        c = relations._doc("s3", ["Nvidia chips: semiconductor sales 120 billion"], ["Nvidia chips: semiconductor sales 120 billion"], 0)
        d = relations._doc("s4", ["エヌビディア 半導体の売上 120 billion"], ["エヌビディア 半導体の売上 120 billion"], 0)
        relations._vectors([c, d])
        w, why = relations.why_of(c, d)
        self.assertIsNotNone(why)
        self.assertIn(["Nvidia", "エヌビディア"], [sorted(p, key=lambda s: not s.isascii()) for p in why["aliases"]])

    def test_katakana_alias_does_not_match_inside_a_longer_word(self):
        table = relations._alias_table()
        self.assertNotIn("Meta", "".join(relations.aliases_of("メタンガスの濃度", table).values()))
        self.assertTrue(any(w == "テスラ" for w in relations.aliases_of("テスラが新車", table).values()))

    def test_four_hundred_nodes_in_a_few_seconds(self):
        rnd = random.Random(7)
        words = ["国防", "長官", "弾劾", "半導体", "工場", "選挙", "議会", "物価", "保険料", "地震", "台風", "関税", "会談", "首脳", "原油", "株価", "円安", "空港", "港湾", "漁業"]
        items, stories = {}, []
        for k in range(400):
            ids = []
            for j in range(3):
                iid = "%014x%02d" % (k, j)
                items[iid] = {"id": iid, "title": "".join(rnd.sample(words, 4)) + " 第%d報" % k, "outlet": "社%d" % j, "type": "全国紙", "home": "jp", "lang": "ja", "ts": k * 60}
                ids.append(iid)
            stories.append({"sid": "s%012x" % k, "member_ids": ids, "n_outlets": 3, "first_ts": k * 60, "last_ts": k * 60 + 60, "rule_cids": ["c%012x" % k], "origin": "rule"})
        relations.tokens.cache_clear()
        t0 = time.process_time()                                    # この process の CPU の時間（ほかの仕事に混まれても揺れない）
        r = relations.compute({"items": items, "stories": stories, "generated_at": 0}, None, 0)
        self.assertEqual(len(r["nodes"]), 400)
        self.assertLess(time.process_time() - t0, 5.0)

    def test_the_committed_sample_is_what_the_code_makes(self):
        got = S.build_all(ai=True)["relations"]
        got["counts"] = dict(got["counts"], secs=0)
        want = json.loads((FIX / "relations.sample.json").read_text(encoding="utf-8"))
        self.assertEqual(json.loads(json.dumps(got, ensure_ascii=False)), want)


if __name__ == "__main__":
    unittest.main()
