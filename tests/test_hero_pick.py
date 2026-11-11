# -*- coding: utf-8 -*-
"""CONTRACT 26: data/hero.json — ホームの最初の一枚の候補の選び方（split -> both -> one_side）と大きさ。AI の無い回でも全部出る（§4.6）。"""
import json
import sys
import unittest

from helpers import ROOT, FIX
sys.path.insert(0, str(FIX))
from parallax import hero, coverage, extras  # noqa: E402
import make_data_samples as S  # noqa: E402


class PickTests(unittest.TestCase):
    def test_tiers_in_order_and_the_first_is_the_split(self):
        d = S.build_all(ai=True)["hero"]
        tiers = [p["tier"] for p in d["picks"]]
        self.assertEqual(tiers[0], "split")
        self.assertEqual(tiers, sorted(tiers, key=["split", "both", "one_side"].index))
        self.assertLessEqual(len(d["picks"]), hero.MAX_PICKS)
        p = d["picks"][0]
        self.assertEqual(p["sid"], "s1000000000a1")
        self.assertEqual((p["sides"]["jp"]["outlets"], p["sides"]["intl"]["outlets"]), (3, 2))
        self.assertTrue(1 <= len(p["findings"]) <= 3)
        self.assertLessEqual(len([h for h in p["heads"] if h["side"] == "jp"]), 2)
        self.assertEqual(p["same"]["by"], "rule")
        self.assertIsNotNone(p["reaction"]["hb"])

    def test_the_ai_headline_is_marked_with_its_model_and_time(self):
        d = S.build_all(ai=True)["hero"]
        p = next(x for x in d["picks"] if x["sid"] == "s5600000000e5")
        self.assertTrue(p["title"]["ai"])
        self.assertEqual(p["title"]["model"], "fake-model-1")
        self.assertEqual(p["same"]["by"], "ai")

    def test_without_a_split_the_both_tier_comes_first(self):
        latest, board, _p = S.sample(ai=True)
        board["cases"]["s1000000000a1"].pop("coverage")
        d = hero.compute(latest, board, None, None, S.NOW)
        self.assertEqual(d["picks"][0]["tier"], "both")
        self.assertNotIn("split", [p["tier"] for p in d["picks"]])

    def test_one_side_only_and_then_nothing(self):
        latest, board, _p = S.sample(ai=True)
        keep = {"s3000000000c3"}
        latest["stories"] = [s for s in latest["stories"] if s["sid"] in keep]
        d = hero.compute(latest, board, None, None, S.NOW)
        self.assertEqual([(p["tier"], p["sid"]) for p in d["picks"]], [("one_side", "s3000000000c3")])
        latest["stories"] = []
        self.assertEqual(hero.compute(latest, board, None, None, S.NOW)["picks"], [])   # 作らない

    def test_small_enough_to_load_first(self):
        d = S.build_all(ai=True)["hero"]
        self.assertLessEqual(len(json.dumps(d, ensure_ascii=False, separators=(",", ":")).encode("utf-8")), hero.MAX_BYTES)
        latest, board, _p = S.sample(ai=True)
        for s in latest["stories"]:
            for i in s["member_ids"]:
                latest["items"][i]["title"] = latest["items"][i]["title"] + "あ" * 3000
        big = hero.compute(latest, board, None, None, S.NOW)
        self.assertLessEqual(len(json.dumps(big, ensure_ascii=False, separators=(",", ":")).encode("utf-8")), hero.MAX_BYTES)


class NoAITests(unittest.TestCase):
    """§4.6: ai_run.status が off の回でも、relations・findings・impact・reaction・hero が全部出る"""

    def test_everything_without_ai(self):
        got = S.build_all(ai=False)
        self.assertEqual(got["latest"]["ai_run"]["status"], "off")
        self.assertTrue(all(s["origin"] == "rule" for s in got["latest"]["stories"]))
        self.assertTrue(got["relations"]["edges"])
        self.assertTrue(any(c.get("coverage", {}).get("findings") for c in got["board"]["cases"].values()))
        self.assertTrue(got["impact"]["events"])
        self.assertTrue(got["reaction"]["events"])
        self.assertTrue(got["hero"]["picks"])
        self.assertFalse(any(p["title"]["ai"] for p in got["hero"]["picks"]))
        self.assertEqual(got["hero"]["ai"], "off")

    def test_the_build_step_writes_the_four_files_and_keeps_the_old_on_failure(self):
        import tempfile
        from pathlib import Path
        latest, board, politics = S.sample(ai=False)
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)
            for n, d in (("latest", latest), ("board", board), ("politics", politics)):
                (out / (n + ".json")).write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
            from parallax import reaction
            real = reaction._get
            reaction._get = S.fake_get(fail=True)
            orig_sleep = reaction.time.sleep
            try:
                reaction.time.sleep = lambda s: None
                extras.run_derived(out, {"relations", "impact", "reaction", "hero"}, S.NOW)
            finally:
                reaction._get = real
                reaction.time.sleep = orig_sleep
            for n in ("relations", "impact", "reaction", "hero"):
                self.assertTrue((out / (n + ".json")).is_file(), n)
            self.assertFalse(json.loads((out / "reaction.json").read_text(encoding="utf-8"))["sources"]["hatena"]["ok"])
            (out / "hero.json").write_text('{"schema":"parallax-hero/1","picks":["old"]}', encoding="utf-8")
            (out / "latest.json").write_text("broken", encoding="utf-8")
            extras.run_derived(out, {"hero"}, S.NOW)                       # 読めない時は前の物を残す
            self.assertIn("old", (out / "hero.json").read_text(encoding="utf-8"))

    def test_the_committed_sample_is_what_the_code_makes(self):
        got = S.build_all(ai=True)["hero"]
        want = json.loads((FIX / "hero.sample.json").read_text(encoding="utf-8"))
        self.assertEqual(json.loads(json.dumps(got, ensure_ascii=False)), want)


class FindingTests(unittest.TestCase):
    """§23.1: board.cases[sid].coverage.findings — 決まった型の文だけ"""

    def setUp(self):
        latest, board, _p = S.sample(ai=True)
        self.f = board["cases"]["s1000000000a1"]["coverage"]["findings"]
        self.cov = board["cases"]["s1000000000a1"]["coverage"]

    def test_kinds_in_order_and_at_most_five(self):
        kinds = [f["kind"] for f in self.f]
        self.assertLessEqual(len(self.f), coverage.FIND_MAX)
        self.assertEqual(kinds, sorted(kinds, key=coverage.FIND_KINDS.index))
        self.assertIn("only_side", kinds)
        self.assertIn("first_gap", kinds)
        n = len(self.cov["outlets"])
        for f in self.f:
            self.assertTrue(all(0 <= i < n for i in f["outlets"] + f["others"]))
            self.assertFalse(set(f["outlets"]) & set(f["others"]))

    def test_fixed_sentence_forms(self):
        import re
        forms = {"only_side": r"^.+は(国内|海外|官公庁) \d+ 社(・(国内|海外|官公庁) \d+ 社)*が載せ、(国内|海外|官公庁) \d+ 社(・(国内|海外|官公庁) \d+ 社)*の見出しと要旨には出ていない$",
                 "word_choice": r"^.+：「.+」\d+ 社(・「.+」\d+ 社)+$",
                 "num_diff": r"^.+が違う：.+（.+）(・.+（.+）)+$",
                 "lead_differs": r"^見出しの最初の語：(国内|海外|官公庁)は「.+」・(国内|海外|官公庁)は「.+」$",
                 "first_gap": r"^(国内|海外|官公庁)が(国内|海外|官公庁)より (\d+ 時間)?( ?\d+ 分)? 早く報じた$"}
        for f in self.f:
            self.assertRegex(f["text"], forms[f["kind"]])
        gap = next(f for f in self.f if f["kind"] == "first_gap")
        self.assertEqual(gap["text"], "海外が国内より 2 時間 早く報じた")

    def test_numbers_differ_only_in_value_not_in_notation(self):
        self.assertEqual(coverage._num_key("$10 billion"), coverage._num_key("$10bn"))
        self.assertEqual(coverage._num_key("約300人"), coverage._num_key("300人"))
        self.assertNotEqual(coverage._num_key("300人"), coverage._num_key("5000人"))

    def test_no_silence_words_and_the_reader_drops_them(self):
        txt = json.dumps(self.f, ensure_ascii=False)
        for w in ("報じなかった", "報じていない", "隠", "意図"):
            self.assertNotIn(w, txt)
        bad = [dict(self.f[0], text="国内 3 社は報じなかった"), {"kind": "other", "text": "x"}, dict(self.f[0], outlets=[0, 99, -1, True])]
        got = coverage.clean_findings(bad, len(self.cov["outlets"]))
        self.assertEqual(len(got), 1)
        self.assertTrue(all(0 <= i < len(self.cov["outlets"]) for i in got[0]["outlets"]))

    def test_the_static_page_shows_the_lines(self):
        html = coverage.html_block(coverage.clean(self.cov))
        self.assertIn('class="cv-w cv-f"', html)
        self.assertIn(self.f[0]["text"], html)


if __name__ == "__main__":
    unittest.main()
