# -*- coding: utf-8 -*-
"""公開版の漏れ止め（CONTRACT §7・§4.6）: 名の照合ではなく構成で落とすこと、題が報じ方の語を含まないこと。合成の fixture と偽の provider だけ。"""
import copy
import unittest

from helpers import NOW, build, fake, load_prompt, validate
from test_summary import run_build, sfake

PROMPT = load_prompt()
# 名を挙げず、言い換えただけの対比文: 名の照合では素通りする（それが構成で落とす理由）
PARAPHRASE = "一方は種類まで、他方は件数だけを前に出している"


def contrast_fake(text, note="一部の配信だけが扱っている", head=None):
    def edit(ans, doc):
        for b in ans["blocks"]:
            for st in b["stories"]:
                st["contrast_ja"] = text
                st["flag_note_ja"] = note
                if head:
                    st["headline_ja"] = head
    return fake(edit)


class ByConstruction(unittest.TestCase):
    def test_a_paraphrase_with_no_outlet_name_passes_the_name_check(self):
        self.assertFalse(build.names_withheld_outlet(PARAPHRASE))
        self.assertFalse(build.names_withheld_outlet("一部の配信だけが扱っている"))

    def test_event_text_of_a_story_with_a_no_or_nc_source_is_emptied_whatever_it_says(self):
        pub, _ = run_build(contrast_fake(PARAPHRASE), sfake(), build.empty_cache(), public=True)
        loc, _ = run_build(contrast_fake(PARAPHRASE), sfake(), build.empty_cache(), public=False)
        ai_stories = [s for s in pub["stories"] if s["ai"]]
        withheld = [s for s in ai_stories if build._has_withheld_member(s, pub["items"])]
        open_ = [s for s in ai_stories if not build._has_withheld_member(s, pub["items"])]
        self.assertTrue(withheld, "the fixture has AI stories that include a no / nc source")
        for s in withheld:
            self.assertEqual((s["ai"]["contrast_ja"], s["ai"]["flag_note_ja"]), ("", ""))
        for s in open_:                                                    # ok / unknown の源だけの出来事は、そのまま
            self.assertEqual(s["ai"]["contrast_ja"], PARAPHRASE)
        self.assertEqual(build.event_text_problems(pub["stories"], pub["items"]), 0)
        self.assertEqual(build.check_output(pub), [])
        self.assertTrue(all(s["ai"]["contrast_ja"] == PARAPHRASE for s in loc["stories"] if s["ai"]))   # local 版は今のまま
        w = pub["ai_run"]["withheld_text"]                                 # ai_run.withheld_text は落とした文の数
        self.assertEqual(w["contrast_ja"], len(withheld))
        self.assertEqual(loc["ai_run"]["withheld_text"], {"contrast_ja": 0, "flag_note_ja": 0})

    def test_check_output_refuses_event_text_left_on_a_withheld_story(self):
        pub, _ = run_build(contrast_fake(PARAPHRASE), sfake(), build.empty_cache(), public=True)
        bad = copy.deepcopy(pub)
        s = next(x for x in bad["stories"] if x["ai"] and build._has_withheld_member(x, bad["items"]))
        s["ai"]["contrast_ja"] = PARAPHRASE
        self.assertTrue(any("withheld source" in p for p in build.check_output(bad)))
        loc = copy.deepcopy(bad)
        loc["edition"] = "local"
        self.assertFalse(any("withheld source" in p for p in build.check_output(loc)))

    def test_the_kept_snapshot_is_cleaned_by_construction_too(self):
        old, _ = run_build(contrast_fake(PARAPHRASE), sfake(), build.empty_cache(), public=False)
        d, _ = run_build(None, None, build.empty_cache(), public=True, now=NOW + 60, previous=copy.deepcopy(old),
                         status="nokey", sstatus="nokey")
        self.assertEqual(d["ai_run"]["status"], "kept_previous")
        sn = d["ai_snapshot"]
        self.assertEqual(build.event_text_problems(sn["stories"], sn["items"]), 0)
        self.assertEqual(build.check_output(d), [])
        bad = copy.deepcopy(d)
        s = next(x for x in bad["ai_snapshot"]["stories"] if x.get("ai") and build._has_withheld_member(x, bad["ai_snapshot"]["items"]))
        s["ai"]["flag_note_ja"] = "何かの注記"
        self.assertTrue(any("snapshot keeps contrast / flag text" in p for p in build.check_output(bad)))


class ReportingWords(unittest.TestCase):
    def test_the_table_is_in_the_prompt_and_the_allowed_form_is_listed(self):
        rw = PROMPT["report_words"]
        for w in ("報道", "見出し", "強調", "触れ", "伝え"):
            self.assertIn(w, rw["ja"])
        for w in ("reports", "cites", "headlines"):
            self.assertIn(w, rw["en"])
        self.assertEqual(rw["allowed_ja"], ["と報じられている"])
        self.assertIn("と報じられている", PROMPT["system"])
        self.assertIn("reportedly", PROMPT["system"])

    def test_report_hit(self):
        h = lambda t: validate.report_hit(t, PROMPT)
        for t in ("決定が報道された", "見出しは予算に触れた", "Some reports cite the plan", "Headlines stress it", "ＲＥＰＯＲＴＳ say",
                  "Officials, according to the paper", "試験案が可決されたと報じられている。強調された点は予算"):
            self.assertTrue(h(t), t)
        for t in ("試験案が可決されたと報じられている", "The plan was reportedly approved", "Headliner wins a prize", "首相が謝意を表明した", ""):
            self.assertFalse(h(t), t)

    def test_a_headline_with_a_reporting_word_is_blanked_and_both_blank_goes_to_the_rules(self):
        pub, _ = run_build(contrast_fake("", head="下院の見出しが報道された"), sfake(), build.empty_cache(), public=True)
        self.assertGreater(pub["ai_run"]["report_words"], 0)
        for s in (x for x in pub["stories"] if x["ai"]):
            self.assertEqual(s["ai"]["headline_ja"], "")
            self.assertTrue(s["ai"]["headline_en"])                        # 英語の題が残るので AI の story のまま
        self.assertEqual(build.report_headline_count(pub["stories"], PROMPT), 0)

        def both(ans, doc):
            for b in ans["blocks"]:
                for st in b["stories"]:
                    st["headline_ja"], st["headline_en"] = "見出しは報道に触れた", "Reports cite it"
        p2, _ = run_build(fake(both), sfake(), build.empty_cache(), public=True)
        self.assertEqual(sum(1 for s in p2["stories"] if s["origin"] == "ai"), 0)    # 題が無い story は信用せず、規則の表示へ
        self.assertGreater(p2["ai_run"]["unassigned_ids"], 0)

    def test_check_output_refuses_a_reporting_headline(self):
        pub, _ = run_build(contrast_fake(""), sfake(), build.empty_cache(), public=True)
        bad = copy.deepcopy(pub)
        next(s for s in bad["stories"] if s["ai"])["ai"]["headline_en"] = "Reports say it passed"
        self.assertTrue(any("reporting word" in p for p in build.check_output(bad)))

    def test_a_kept_snapshot_loses_a_reporting_headline_or_is_not_kept(self):
        old, _ = run_build(contrast_fake(""), sfake(), build.empty_cache(), public=False)
        one = copy.deepcopy(old)
        for s in one["stories"]:
            if s["ai"]:
                s["ai"]["headline_ja"] = "下院の結果が報道された"
        d, _ = run_build(None, None, build.empty_cache(), public=True, now=NOW + 60, previous=one, status="nokey", sstatus="nokey")
        self.assertEqual(d["ai_run"]["status"], "kept_previous")
        self.assertTrue(all(s["ai"]["headline_ja"] == "" and s["ai"]["headline_en"] for s in d["ai_snapshot"]["stories"] if s["ai"]))
        both = copy.deepcopy(old)
        for s in both["stories"]:
            if s["ai"]:
                s["ai"]["headline_ja"], s["ai"]["headline_en"] = "結果が報道された", "Reports say so"
        d2, _ = run_build(None, None, build.empty_cache(), public=True, now=NOW + 60, previous=both, status="nokey", sstatus="nokey")
        self.assertEqual(d2["ai_run"]["status"], "nokey")                  # 題が両方消える物は保たない
        self.assertNotIn("ai_snapshot", d2)


if __name__ == "__main__":
    unittest.main()
