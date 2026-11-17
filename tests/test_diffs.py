# -*- coding: utf-8 -*-
"""中身の違い diffs（CONTRACT §13.2）の試験。偽の答えと合成の doc だけ。網には出ない。
説明（desc）を持つ媒体が 2 つ以上ある時だけ。材料に在る事だけ。全員が書く事は違いではない。どの item の説明から読めたかが残る。"""
import json
import unittest

from helpers import build, load_prompt, validate

PROMPT = load_prompt()
DOC = {"events": [{"eid": "e1", "items": [
    {"outlet": "甲新聞", "lang": "ja", "title": "港で貨物船が座礁した", "side": "国内", "at": "2026-11-08 03:05", "ref": "i1",
     "desc": "8日未明、沿岸の港で貨物船が座礁し、乗組員12人が救助された。"},
    {"outlet": "乙通信", "lang": "ja", "title": "貨物船の座礁で港が閉鎖", "side": "国内", "at": "2026-11-08 04:00", "ref": "i2",
     "desc": "座礁した貨物船は燃料を積んでおり、港は午前中閉鎖された。"},
    {"outlet": "Harbour Times", "lang": "en", "title": "Cargo ship runs aground at port", "side": "海外", "at": "2026-11-08 04:10"}]}]}
REFS = {"e1": {"i1": "id-a", "i2": "id-b"}}
REQ = {"doc": json.dumps(DOC, ensure_ascii=False), "eids": {"e1": "sA"}, "refs": REFS}
BRIEF = {"what_ja": "貨物船が港で座礁し、12人が助け出された。", "background_ja": "伝えられていない",
         "views_ja": "", "next_ja": "伝えられていない"}


def answer(diffs):
    return json.dumps({"summaries": [{"eid": "e1", "summary_ja": "港で船が座礁した", "brief": BRIEF, "diffs": diffs}]}, ensure_ascii=False)


def run(diffs, req=REQ):
    return validate.validate_summaries(req, answer(diffs), PROMPT)


class Validator(unittest.TestCase):
    def test_a_difference_keeps_the_items_whose_description_gave_it(self):
        out = run([{"text_ja": "救助された乗組員の数は12人と書かれている。", "refs": ["i1"]},
                   {"text_ja": "港は午前中閉鎖されたとある。", "refs": ["i2"]}])
        self.assertEqual(out["briefs"]["sA"]["diffs"], [
            {"text_ja": "救助された乗組員の数は12人と書かれている。", "refs": ["id-a"]},
            {"text_ja": "港は午前中閉鎖されたとある。", "refs": ["id-b"]}])

    def test_what_every_description_gives_is_not_a_difference(self):
        out = run([{"text_ja": "貨物船が座礁した事は両方に在る。", "refs": ["i1", "i2"]}])
        self.assertNotIn("diffs", out["briefs"]["sA"])

    def test_a_ref_that_is_not_a_description_is_ignored(self):
        out = run([{"text_ja": "貨物船が座礁した。", "refs": ["i3", "x9"]}])
        self.assertNotIn("diffs", out["briefs"]["sA"])

    def test_a_number_or_name_that_is_not_in_the_cited_descriptions_is_dropped(self):
        out = run([{"text_ja": "救助された乗組員は30人とある。", "refs": ["i1"]},
                   {"text_ja": "港の閉鎖は12人に影響したとある。", "refs": ["i2"]},     # 12 is in the other description, not in the cited one
                   {"text_ja": "NATO が港を閉鎖したとある。", "refs": ["i2"]}])
        self.assertNotIn("diffs", out["briefs"]["sA"])
        self.assertEqual(out["counts"]["ungrounded"], 3)

    def test_an_outlet_name_a_judgement_or_a_copy_is_dropped(self):
        out = run([{"text_ja": "甲新聞だけが救助の人数を書いている。", "refs": ["i1"]},
                   {"text_ja": "港が午前中閉鎖された衝撃の事態。", "refs": ["i2"]},
                   {"text_ja": "座礁した貨物船は燃料を積んでおり、港は午前中閉鎖された。", "refs": ["i2"]}])
        self.assertNotIn("diffs", out["briefs"]["sA"])

    def test_one_outlet_with_a_description_gives_no_difference(self):
        doc = json.loads(REQ["doc"])
        del doc["events"][0]["items"][1]["desc"]
        req = {**REQ, "doc": json.dumps(doc, ensure_ascii=False)}
        out = run([{"text_ja": "救助された乗組員の数は12人と書かれている。", "refs": ["i1"]}], req)
        self.assertNotIn("diffs", out["briefs"]["sA"])

    def test_an_answer_without_diffs_is_as_before(self):
        raw = json.dumps({"summaries": [{"eid": "e1", "summary_ja": "港で船が座礁した", "brief": BRIEF}]}, ensure_ascii=False)
        out = validate.validate_summaries(REQ, raw, PROMPT)
        self.assertEqual(out["errors"], [])
        self.assertNotIn("diffs", out["briefs"]["sA"])

    def test_at_most_three(self):
        out = run([{"text_ja": "港は午前中閉鎖されたとある。", "refs": ["i2"]}] + [{"text_ja": "救助は%d人とある。" % n, "refs": ["i1"]} for n in (12,)])
        self.assertLessEqual(len(out["briefs"]["sA"]["diffs"]), validate.DIFF_MAX)


class Build(unittest.TestCase):
    ITEMS = {"a": {"outlet": "甲", "lang": "ja", "title": "題一", "desc": "一つ目の説明です。"},
             "b": {"outlet": "乙", "lang": "ja", "title": "題二"},
             "c": {"outlet": "丙", "lang": "ja", "title": "題三", "desc": "三つ目の説明です。"}}

    def setUp(self):
        was = build.RIGHTS["mode"]
        build.set_rights("quote")
        self.addCleanup(build.set_rights, was)

    def test_the_request_names_the_items_that_carry_a_description(self):
        req = build.build_summary_requests([{"sid": "s1", "member_ids": ["a", "b", "c"]}], self.ITEMS)[0]
        rows = json.loads(req["doc"])["events"][0]["items"]
        self.assertEqual([r.get("ref") for r in rows], ["i1", None, "i3"])
        self.assertEqual(req["refs"], {"e1": {"i1": "a", "i3": "c"}})

    def test_the_brief_on_the_story_carries_the_differences_and_check_output_wants_real_members(self):
        story = {"sid": "s1", "n_outlets": 3, "member_ids": ["a", "b", "c"]}
        e = {"text_ja": "x", "made_at": 1762300000, "model": "m", "brief": {**BRIEF, "diffs": [{"text_ja": "違い", "refs": ["a"]}]}}
        build._put_brief(story, e, "gemini")
        self.assertEqual(story["brief"]["diffs"], [{"text_ja": "違い", "refs": ["a"]}])
        self.assertEqual(build.summary_problems([story]), [])
        story["brief"]["diffs"][0]["refs"] = ["zz"]
        self.assertTrue(build.summary_problems([story]))


if __name__ == "__main__":
    unittest.main()
