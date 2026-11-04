# -*- coding: utf-8 -*-
"""CONTRACT 20: delivery, one source of numbers, asymmetry, traps, photos, robots, withheld list, place names. Synthetic data only."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers import ROOT, build  # noqa: E402
import test_board  # noqa: E402

sys.path.insert(0, str(ROOT))
from parallax import board, counts, og, photo, places, quakeplace, traps, watch, withheld  # noqa: E402
from tools import assemble_site  # noqa: E402

NOW = test_board.NOW


class Traps(unittest.TestCase):
    def test_us_midterms_are_not_us_and_china(self):
        t = "米中間選挙 日本株は下落"
        self.assertEqual(traps.fix(t), "米国中間選挙 日本株は下落")
        self.assertFalse(watch.flags("米中間選挙で共和党が優勢")["security"])       # "米中" was a security word
        self.assertTrue(watch.flags("米中間選挙で共和党が優勢")["law"])             # the election is still an election
        self.assertTrue(watch.flags("米中首脳会談が開かれる")["security"])           # a real US-China summit still is
        self.assertEqual(places.locate(t)["place"], "米国")                          # not Japan, not China

    def test_a_bare_japan_does_not_put_an_event_in_japan(self):
        self.assertIsNone(places.locate("日本代表が勝利"))
        self.assertEqual(places.locate("日本政府が補正予算案を決定")["place"], "日本")
        self.assertEqual(places.locate("東京で日本が議論")["place"], "東京")

    def test_one_table_feeds_the_cluster_traps(self):
        from parallax import cluster
        self.assertEqual(cluster.PLACE_TRAPS, {"CN": ("米中間選",)})


class Asymmetry(unittest.TestCase):
    def test_label_names_the_side_that_carried_it(self):
        self.assertEqual(board.asym_label("periphery_only", ["政党機関紙", "週刊誌・タブロイド"]), "政党機関紙・週刊誌だけ")
        self.assertEqual(board.asym_label("overseas_only", ["海外公共"]), "海外の源だけ")
        for k, v in board.ASYM.items():
            self.assertNotIn("見当たらない", v[0])

    def test_no_label_when_a_mainstream_feed_failed_or_does_not_reach_back(self):
        d = test_board.make_data()
        d["sources"][0]["ok"] = False
        b, _ = board.compose(d, None, NOW, None)
        self.assertEqual(b["asymmetry"], [])
        self.assertEqual(b["asym_status"]["missing"], ["nhk-politics"])
        d = test_board.make_data()
        d["sources"][0]["oldest_ts"] = NOW - H_ // 2        # reaches back only half an hour: the events started earlier
        b, _ = board.compose(d, None, NOW, None)
        self.assertEqual(b["asymmetry"], [])
        self.assertEqual(b["counts"]["asymmetric"]["total"], 0)

    def test_priority_puts_domestic_money_and_law_first(self):
        d = test_board.make_data()
        b, _ = board.compose(d, None, NOW, None)
        first_other = next((i for i, s in enumerate(b["priority"]) if not board.domestic_budget_law(
            {"flags": {k: b["cases"][s]["flags"] and k in b["cases"][s]["flags"] for k in watch.FLAGS},
             "ja": b["cases"][s]["ja"], "rep": {"home": "jp"}})), None)
        self.assertTrue(first_other is None or all(
            ("money" in b["cases"][s]["flags"] or "law" in b["cases"][s]["flags"]) for s in b["priority"][:first_other]))


H_ = 3600


class Counts(unittest.TestCase):
    def test_board_and_stats_carry_the_same_counts(self):
        d = test_board.make_data()
        d["items"] = d["items"]
        b, _ = board.compose(d, None, NOW, None)
        c = b["counts"]
        self.assertEqual(c["incidents"], len(b["events"]))
        self.assertEqual(c["asymmetric"]["shown"], len(b["asymmetry"]))
        self.assertGreaterEqual(c["asymmetric"]["total"], c["asymmetric"]["shown"])
        self.assertEqual(c["bundles"]["events"], len(b["cases"]) and c["bundles"]["events"])
        st_like = counts.merge(counts.base(d, list(d["items"].values())), None)
        self.assertEqual(st_like["headlines"], {"fetched": len(d["items"]), "in_window": len(d["items"]), "clustered": len(d["items"])})
        self.assertEqual(c["sources"], st_like["sources"])
        self.assertEqual(c["bundles"]["stories"], st_like["bundles"]["stories"])


class StatsAgree(unittest.TestCase):
    def test_stats_headlines_and_sources_are_the_counts_objects(self):
        snap = json.loads((ROOT / "tests" / "fixtures" / "items.json").read_text(encoding="utf-8"))
        prompt = build.load_prompt(rights="quote")
        d, _ = build.build(snap["items"], snap["sources"], 1762300000, 36, None, "off", prompt, True)
        st = build.make_stats(d, snap["items"], 1762300000, 36)
        self.assertEqual(st["headlines"], st["counts"]["headlines"])
        self.assertEqual(st["sources"], st["counts"]["sources"])
        self.assertEqual(st["clusters"]["total"], st["counts"]["bundles"]["rule"])
        self.assertEqual(st["clusters"]["multi_outlet"], st["counts"]["multi_outlet"])
        self.assertEqual(st["counts"]["headlines"]["in_window"], d["window_items"])


class Photos(unittest.TestCase):
    def mk(self, outlet, type_, title, img=True):
        return {"id": outlet + title, "outlet": outlet, "type": type_, "title": title, "lang": "ja", "ts": 1,
                "image": {"url": "https://%s.example.org/p.jpg" % outlet, "from": "rss"} if img else None}

    def test_two_outlets_one_photo_never_a_wire_never_an_incident(self):
        ok = [self.mk("A", "全国紙", "試験 出来事X 予算案"), self.mk("B", "通信社", "試験 出来事X 予算案"), self.mk("C", "民放", "試験 出来事X 予算案", img=False)]
        self.assertEqual(photo.pick(ok)["outlet"], "A")                                  # the wire's image is not chosen
        self.assertEqual(photo.eligible([ok[0]])[1], "single_outlet")
        self.assertEqual(photo.eligible([self.mk("A", "全国紙", "x 逮捕"), self.mk("B", "民放", "x 逮捕")])[1], "incident")
        self.assertEqual(photo.eligible([self.mk("A", "通信社", "x 予算"), self.mk("B", "通信社", "x 予算")])[1], "wire_only")
        self.assertIsNone(photo.pick([self.mk("A", "全国紙", "x 墜落"), self.mk("B", "民放", "x 墜落")]))

    def test_board_case_holds_at_most_one_photo(self):
        d = test_board.make_data()
        b, _ = board.compose(d, None, NOW, None)
        for c in b["cases"].values():
            self.assertLessEqual(len(c["images"]), 1)
            self.assertEqual(c["images"], [c["photo"]] if c["photo"] else [])
        self.assertEqual(b["cases"]["sA"]["photo"]["outlet"], b["cases"]["sA"]["images"][0]["outlet"])
        self.assertEqual(b["cases"]["sD"]["photo_skip"], "no_image")                       # two outlets, no image: none


class Robots(unittest.TestCase):
    def test_a_denying_host_is_not_requested_and_the_rules_are_kept(self):
        calls, asked = [], []
        bodies = {"https://ok.example.org": (200, "User-agent: *\nDisallow: /private/\n"),
                  "https://no.example.org": (200, "User-agent: VECTOR-PARALLAX\nDisallow: /\n"),
                  "https://forbidden.example.org": (403, ""), "https://none.example.org": (404, "")}

        def fetch(origin):
            calls.append(origin)
            if origin == "https://down.example.org":
                raise OSError("down")
            return bodies[origin]
        with tempfile.TemporaryDirectory() as t:
            path = str(Path(t) / "og_robots.json")
            r = og.Robots(fetch=fetch, path=path)
            self.assertTrue(r.check("https://ok.example.org/a/1")[0])
            self.assertFalse(r.check("https://ok.example.org/private/x")[0])
            self.assertFalse(r.check("https://no.example.org/a")[0])
            self.assertFalse(r.check("https://forbidden.example.org/a")[0])
            self.assertTrue(r.check("https://none.example.org/a")[0])
            self.assertEqual(r.check("https://down.example.org/a")[1], "unreachable")
            self.assertEqual(sorted(r.stats["denied_hosts"]), ["forbidden.example.org", "no.example.org", "ok.example.org"])      # ok.example.org: one path was denied
            r.save()
            n = len(calls)
            r2 = og.Robots(fetch=fetch, path=path)                                         # kept: no second request for the same host
            self.assertFalse(r2.check("https://no.example.org/b")[0])
            self.assertEqual(len(calls), n)

    def test_fill_does_not_request_a_denied_host(self):
        items = {"i": {"id": "i", "link": "https://no.example.org/a/1", "image": None, "outlet": "A", "type": "全国紙", "title": "t"},
                 "j": {"id": "j", "link": "", "image": None, "outlet": "B", "type": "民放", "title": "t"}}
        asked = []
        r = og.Robots(fetch=lambda o: (200, "User-agent: *\nDisallow: /\n"))
        out = og.fill([{"member_ids": ["i", "j"]}], items, getter=lambda u: asked.append(u) or "", robots=r, sleep=lambda s: None)
        self.assertEqual(asked, [])
        self.assertEqual((out["tried"], out["robots_denied"], out["skipped"]), (0, 1, {"denied": 1}))


class Withheld(unittest.TestCase):
    RULES = {"sources": {"srcX"}, "items": {"i2"}, "photo_items": {"i3"}, "photo_sources": set()}

    def test_apply_removes_and_clears_photos(self):
        items = [{"id": "i1", "source_id": "srcX"}, {"id": "i2", "source_id": "s"}, {"id": "i3", "source_id": "s", "image": {"url": "u", "from": "rss"}},
                 {"id": "i4", "source_id": "s"}]
        kept, removed, c = withheld.apply(items, self.RULES)
        self.assertEqual([i["id"] for i in kept], ["i3", "i4"])
        self.assertIsNone(kept[0]["image"])
        self.assertEqual((removed, c["items_removed"], c["photos_cleared"]), ({"i1", "i2"}, 2, 1))

    def test_scrub_takes_them_out_of_the_kept_previous_version(self):
        prev = {"items": {"i1": {"id": "i1", "source_id": "srcX"}, "i4": {"id": "i4", "source_id": "s", "image": {"url": "u"}}, "i3": {"id": "i3", "source_id": "s", "image": {"url": "u"}}},
                "stories": [{"sid": "s1", "member_ids": ["i1"]}, {"sid": "s2", "member_ids": ["i1", "i4"]}],
                "rule_clusters": [{"cid": "c1", "member_ids": ["i1"]}, {"cid": "c2", "member_ids": ["i4"]}],
                "blocks": [{"bid": "b1", "cids": ["c1", "c2"]}], "ai_requests": [{"doc": "x"}],
                "ai_snapshot": {"stories": [{"sid": "s1", "member_ids": ["i1"]}], "rule_clusters": []}}
        d, n = withheld.scrub(prev, self.RULES)
        self.assertEqual(n, 2)
        self.assertNotIn("i1", d["items"])
        self.assertEqual([s["sid"] for s in d["stories"]], ["s2"])
        self.assertEqual(d["stories"][0]["member_ids"], ["i4"])
        self.assertEqual(d["blocks"][0]["cids"], ["c2"])
        self.assertEqual((d["ai_requests"], d["ai_snapshot"]["stories"]), ([], []))
        self.assertIsNone(d["items"]["i3"]["image"])
        self.assertIn("i1", prev["items"])                                                 # the argument is not changed

    def test_the_committed_file_holds_ids_only(self):
        d = json.loads((ROOT / "data" / "withheld.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(d), ["items", "photos", "schema", "sources"])


class Places(unittest.TestCase):
    def test_usgs_strings_in_japanese_with_kanji_directions(self):
        self.assertEqual(quakeplace.ja("207 km ESE of Hachijo-jima, Japan"), "八丈島の東南東 約207 km")
        self.assertEqual(quakeplace.ja("10 km SW of Nowhereville, Indonesia"), "インドネシア付近")
        self.assertIsNone(quakeplace.ja("off the coast of Nowhere"))
        from parallax import hazards
        q = hazards.parse_usgs({"features": [{"id": "x", "properties": {"mag": 4.5, "time": 1762300000000, "place": "207 km ESE of Hachijo-jima, Japan", "url": "u"},
                                              "geometry": {"coordinates": [140, 32, 10]}}]})[0]
        self.assertEqual((q["place"], q["place_en"]), ("八丈島の東南東 約207 km", "207 km ESE of Hachijo-jima, Japan"))


class Site(unittest.TestCase):
    def test_site_has_no_recorded_answers_and_no_withheld_list(self):
        with tempfile.TemporaryDirectory() as t:
            root, out = Path(t) / "r", Path(t) / "o"
            (root / "data").mkdir(parents=True)
            (root / "css").mkdir()
            (root / "js").mkdir()
            (root / "assets").mkdir()
            (root / "index.html").write_text("<html></html>", encoding="utf-8")
            for f in ("latest.json", "recorded.json", "eval.json", "history.json", "withheld.json", "labels.json", "summary_cache.json"):
                (root / "data" / f).write_text('{"name_gate":1,"x":2}', encoding="utf-8")
            copied, missing = assemble_site.assemble(root, out)
            names = sorted(p.name for p in (out / "data").iterdir())
            self.assertEqual(names, ["labels.json", "latest.json"])
            self.assertNotIn("name_gate", (out / "data" / "latest.json").read_text(encoding="utf-8"))


class Labels(unittest.TestCase):
    def test_flag_names_and_the_stale_word(self):
        lab = {k: v["ja"] for k, v in watch.labels().items()}
        self.assertEqual((lab["power"], lab["money"]), ("政治と人事", "公金"))
        self.assertEqual(json.loads((ROOT / "data" / "labels.json").read_text(encoding="utf-8"))["stale"]["ja"], "更新なし")
        self.assertEqual(board.STALE_LABEL_JA, "更新なし")


if __name__ == "__main__":
    unittest.main()
