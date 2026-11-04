# -*- coding: utf-8 -*-
"""validate.py の試験。tests/fixtures/validate_cases.json（JS と共有する表）を全部通し、足りない所を足す。"""
import json
import unittest

from helpers import FIX, load_prompt, validate, build

PROMPT = load_prompt()


class Cases(unittest.TestCase):
    def test_all_shared_cases(self):
        with open(FIX / "validate_cases.json", encoding="utf-8") as f:
            cases = json.load(f)
        self.assertGreaterEqual(len(cases), 20)
        names = [c["name"] for c in cases]
        self.assertEqual(len(names), len(set(names)))
        for c in cases:
            with self.subTest(case=c["name"]):
                got = validate.validate(c["request"], c["raw"], PROMPT, c["items"])
                self.assertEqual(got, c["expect"])

    def test_required_failure_modes_are_covered(self):
        with open(FIX / "validate_cases.json", encoding="utf-8") as f:
            names = {c["name"] for c in json.load(f)}
        for need in ("fabricated_ids", "duplicate_ids", "unassigned_ids", "json_broken", "flag_vetoes",
                     "headline_both_empty_goes_to_rules"):
            self.assertIn(need, names)


class Clean(unittest.TestCase):
    def test_clean(self):
        c = validate.clean
        self.assertEqual(c(None, 10), "")
        self.assertEqual(c(5, 10), "")
        self.assertEqual(c("  a \n\t b  ", 10), "a b")
        self.assertEqual(c("a​b", 10), "ab")
        self.assertEqual(c("abcdef", 6), "abcdef")
        self.assertEqual(c("abcdefg", 6), "abcde…")
        self.assertEqual(len(c("あ" * 100, 60)), 60)

    def test_mainstream_types_match_sources(self):
        from parallax import sources
        self.assertEqual(validate.MAINSTREAM_TYPES, sources.MAINSTREAM_TYPES)
        self.assertEqual(validate.PRIMARY_TYPE, sources.TYPES[0])


class NoTitleLeak(unittest.TestCase):
    def test_member_titles_never_copied_into_ai_fields(self):
        """headline_ja が空でも、メンバーの見出しで埋めない（公開版で隠した見出しが漏れるため）。"""
        with open(FIX / "validate_cases.json", encoding="utf-8") as f:
            cases = json.load(f)
        for c in cases:
            got = validate.validate(c["request"], c["raw"], PROMPT, c["items"])
            for stories in got["blocks"].values():
                for s in stories:
                    if s["ai"]:
                        for k in ("headline_ja", "headline_en", "contrast_ja", "flag_note_ja"):
                            self.assertNotIn("試験 題 i", s["ai"][k], c["name"])


if __name__ == "__main__":
    unittest.main()
