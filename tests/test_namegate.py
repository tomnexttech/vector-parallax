# -*- coding: utf-8 -*-
"""名の関門（CONTRACT §17）: 作り手が書く欄は固定語で落とし、取得した見出しの欄は数えるだけで止めない。
語は tools/leakcheck.py に符号化して置いてあるので、この試験でも実行時に取り出す（試験の本文には書かない）。合成の fixture と偽の provider だけ。"""
import base64
import copy
import importlib.util
import json
import unittest

from helpers import NOW, ROOT, build, fake, load_items, load_prompt

_spec = importlib.util.spec_from_file_location("leakcheck_for_test", ROOT / "tools" / "leakcheck.py")
LC = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(LC)
WORD = base64.b64decode(LC._WORDS_B64).decode("utf-8").split("\n")[1]         # 単独で出れば当たる地名
PAT = LC.fixed_patterns()


def run(provider=None, status="off", title_word=False, previous=None, now=NOW):
    snap = load_items()
    items = copy.deepcopy(snap["items"])
    if title_word:                                                            # 取得した見出しの一つに、単独の地名を入れる
        items[0]["title"] = "試験 地方の運転見合わせ " + WORD + " 沖で強風"
    return build.build(items, snap["sources"], now, 36, provider, status, load_prompt(), False, previous)[0], items


def ai_edit(**fields):
    def edit(ans, doc):
        for b in ans["blocks"]:
            for st in b["stories"]:
                st.update(fields)
                if "focus" in fields:
                    for a in st["angles"]:
                        a["focus_ja"] = fields["focus"]
                    del st["focus"]
    return fake(edit)


class QuotedFieldsAreCountedNotRefused(unittest.TestCase):
    def test_a_bare_place_name_in_a_fetched_title_passes_and_is_counted(self):
        d, items = run(fake(), title_word=True)
        self.assertEqual(build.check_output(d), [])                           # build は止まらない
        ng = d["name_gate"]
        self.assertGreaterEqual(ng["quoted_hits"], 1)
        self.assertEqual(ng["ai_hits"], 0)
        self.assertEqual(ng["words"], len(PAT))
        self.assertGreater(ng["ai_fields_checked"], 0)                        # 走った証拠: 調べた AI の欄の数
        self.assertIn("items[].title", ng["quoted_fields"])
        st = build.make_stats(d, items, NOW, 36)
        self.assertEqual(st["name_gate"], ng)                                 # stats.json にも同じ数

    def test_no_word_means_zero_and_the_gate_still_shows_it_ran(self):
        d, _ = run(fake())
        self.assertEqual((d["name_gate"]["quoted_hits"], d["name_gate"]["ai_hits"], d["name_gate"]["ai_blanked"]), (0, 0, 0))
        self.assertGreater(d["name_gate"]["ai_fields_checked"], 0)

    def test_the_same_word_in_an_ai_field_of_that_file_is_refused(self):
        d, _ = run(fake(), title_word=True)
        bad = copy.deepcopy(d)
        next(s for s in bad["stories"] if s["ai"])["ai"]["headline_en"] = "x " + WORD + " y"
        self.assertTrue(any("must not appear" in p for p in build.check_output(bad)))
        bad = copy.deepcopy(d)
        bad["ai_run"]["note_ja"] = WORD
        self.assertTrue(any("must not appear" in p for p in build.check_output(bad)))


class AiFieldsAreStrict(unittest.TestCase):
    def test_a_word_in_contrast_note_and_focus_is_blanked_and_counted_and_the_build_passes(self):
        prov = ai_edit(contrast_ja="一方は " + WORD + " を挙げる", flag_note_ja="注 " + WORD, focus="焦点 " + WORD)
        d, _ = run(prov)
        self.assertGreater(d["ai_run"]["name_words"], 0)
        self.assertEqual(d["name_gate"]["ai_blanked"], d["ai_run"]["name_words"])
        self.assertEqual(d["name_gate"]["ai_hits"], 0)
        self.assertEqual(build.name_gate_counts(d)[0], [])
        self.assertEqual(build.check_output(d), [])
        for s in (x for x in d["stories"] if x["ai"]):
            self.assertNotIn(WORD, s["ai"]["contrast_ja"] + s["ai"]["flag_note_ja"])
            self.assertTrue(all(WORD not in a["focus_ja"] for a in s["ai"]["angles"]))

    def test_a_story_whose_headlines_both_carry_a_word_goes_back_to_the_rules(self):
        d, _ = run(ai_edit(headline_ja="題 " + WORD, headline_en="Line " + WORD))
        self.assertEqual(sum(1 for s in d["stories"] if s["origin"] == "ai"), 0)
        self.assertGreater(d["ai_run"]["name_words"], 0)
        ids = [i for s in d["stories"] for i in s["member_ids"]]
        self.assertEqual(sorted(ids), sorted(d["items"]))                      # どの item も落ちず、重ならない
        self.assertEqual(build.check_output(d), [])

    def test_one_headline_with_a_word_keeps_the_other(self):
        d, _ = run(ai_edit(headline_en="Line " + WORD))
        ai_stories = [s for s in d["stories"] if s["origin"] == "ai"]
        self.assertTrue(ai_stories)
        self.assertTrue(all(s["ai"]["headline_en"] == "" and s["ai"]["headline_ja"] for s in ai_stories))

    def test_a_place_name_compound_passes(self):
        d, _ = run(ai_edit(headline_ja=WORD + "本線の運転再開"))
        self.assertEqual(d["ai_run"]["name_words"], 0)
        self.assertTrue(any(s["ai"] and s["ai"]["headline_ja"].endswith("運転再開") for s in d["stories"]))
        self.assertEqual(build.check_output(d), [])

    def test_the_kept_previous_ai_view_is_gated_too(self):
        old, _ = run(fake())
        for s in old["stories"]:
            if s["ai"]:
                s["ai"]["contrast_ja"] = "対比 " + WORD
        d, _ = run(None, status="nokey", previous=old, now=NOW + 60)
        self.assertEqual(d["ai_run"]["status"], "kept_previous")
        self.assertEqual(build.name_gate_counts(d["ai_snapshot"])[0], [])
        self.assertGreater(d["ai_snapshot"].get("name_blanked", 0), 0)
        self.assertEqual(d["name_gate"]["ai_blanked"], d["ai_snapshot"]["name_blanked"])
        self.assertEqual(build.check_output(d), [])
        bad = copy.deepcopy(d)
        next(s for s in bad["ai_snapshot"]["stories"] if s["ai"])["ai"]["contrast_ja"] = WORD
        self.assertTrue(any("must not appear" in p for p in build.check_output(bad)))


class LeakcheckSplit(unittest.TestCase):
    def test_gate_counts_splits_by_field_name(self):
        quoted = {"items": {"a": {"title": "x " + WORD + " y", "link": "https://example.org/a"}}}
        ai = {"stories": [{"ai": {"headline_en": "x " + WORD + " y", "angles": [{"focus_ja": "平穏"}]}}]}
        self.assertEqual(LC.gate_counts(quoted, PAT), ([], 1))
        strict, q = LC.gate_counts(ai, PAT)
        self.assertEqual((len(strict), q), (1, 0))
        self.assertEqual(strict[0][0], "stories[0].ai.headline_en")             # 場所だけ。中身は返さない

    def test_scan_blob_splits_only_data_latest_and_scans_every_other_file_strictly(self):
        text = json.dumps({"items": {"a": {"title": WORD + " 沖"}}, "stories": []}, ensure_ascii=False)
        self.assertEqual(LC.scan_blob("data/latest.json", text, PAT), ([], 1))
        hits, q = LC.scan_blob("data/other.json", text, PAT)
        self.assertEqual(q, 0)
        self.assertTrue(hits)
        hits, q = LC.scan_blob("data/latest.json", "{not json " + WORD, PAT)      # 読めない latest.json は全部を厳しく
        self.assertTrue(hits)

    def test_selftest_passes(self):
        self.assertEqual(LC.main(["--selftest"]), 0)


if __name__ == "__main__":
    unittest.main()
