# -*- coding: utf-8 -*-
"""答えた型の記録（stats.json の ai.merge.tier・fallback_reason・trail と ai_history）。網には出ない。鍵は合成の値。"""
import json
import unittest

from helpers import ai, build, load_prompt

PROMPT = load_prompt()
FAKE_KEY = "TEST-KEY-NOT-REAL-0000"


def ok_body():
    return json.dumps({"candidates": [{"content": {"parts": [{"text": '{"blocks":[]}'}]}, "finishReason": "STOP"}]})


def provider(answer):
    seen = []

    def tr(url, headers, body, timeout):
        m = url.split("/models/")[1].split(":")[0]
        seen.append(m)
        st = answer(m, len(seen))
        return (200, ok_body()) if st == 200 else (st, "{}")
    p, _ = build.choose_provider({}, {"GEMINI_API_KEY": FAKE_KEY}, None, PROMPT)
    p._transport, p._sleep = tr, lambda s: None
    return p, seen


MAIN = PROMPT["merge_model"]
LAST = PROMPT["merge_fallback_models"][-1]


class AnswerRecord(unittest.TestCase):
    def test_primary(self):
        p, _ = provider(lambda m, n: 200)
        p.call("s", "u", {}); p.call("s", "u", {})
        r = build.answer_record(p)
        self.assertEqual((r["tier"], r["fallback_reason"]), ("primary", None))
        self.assertEqual(build.answered_model_name(p), MAIN)

    def test_the_1931_build_reads_as_fallback_with_503_and_is_named_by_the_answering_model(self):
        p, seen = provider(lambda m, n: 503 if m != LAST else 200)
        p.call("s", "u", {}); p.call("s", "u", {})       # 主と一つ目の予備が混み続けると、二つ目の call も主から試してから予備へ
        r = build.answer_record(p)
        self.assertEqual(seen, [MAIN, PROMPT["merge_fallback_models"][0], LAST] * 2)
        self.assertEqual((p.budget.used, p.fallback_budget.used), (2, 4))
        self.assertEqual((r["tier"], r["fallback_reason"]), ("fallback", "503"))
        self.assertEqual(build.answered_model_name(p), LAST)
        self.assertEqual(r["answered_models"], [{"model": LAST, "calls": 2}])

    def test_mixed_names_both_models_in_chain_order(self):
        p, _ = provider(lambda m, n: 503 if n == 1 else 200)
        p.call("s", "u", {}); p.call("s", "u", {})
        r = build.answer_record(p)
        self.assertEqual(r["tier"], "mixed")
        name = build.answered_model_name(p)
        self.assertEqual(name, "%s + %s" % (MAIN, PROMPT["merge_fallback_models"][0]))
        ar = build.make_ai_run("ok", p, PROMPT, 0, None)
        self.assertEqual((ar["model"], ar["tier"], ar["fallback_reason"]), (name, "mixed", "503"))
        self.assertNotIn(FAKE_KEY, json.dumps(ar))

    def test_none_when_nothing_answered_and_empty_for_recorded_providers(self):
        p, _ = provider(lambda m, n: 503)
        p.call("s", "u", {})
        self.assertEqual(build.answer_record(p)["tier"], "none")
        self.assertEqual(build.answer_record(None), {})


class History(unittest.TestCase):
    def stats(self, at, tier, model="m", reason=None):
        return {"generated_at": at, "ai": {"status": "ok", "merge": {"tier": tier, "model": model, "fallback_reason": reason},
                                           "summary": {"tier": "primary"}}}

    def test_rows_carry_over_newest_first_with_totals_and_a_limit(self):
        h = None
        for n, tier in enumerate(["primary", "fallback", "fallback", "mixed"]):
            st = self.stats(100 + n, tier, reason=None if tier == "primary" else "503")
            st["ai_history"] = build.ai_history({"ai_history": h} if h else None, st, limit=3)
            h = st["ai_history"]
        self.assertEqual([r["at"] for r in h["builds"]], [103, 102, 101])
        self.assertEqual(h["totals"], {"mixed": 1, "fallback": 2})
        self.assertEqual(h["builds"][0], {"at": 103, "tier": "mixed", "model": "m", "reason": "503", "summary_tier": "primary"})

    def test_the_same_build_is_not_counted_twice_and_bad_previous_files_are_ignored(self):
        st = self.stats(5, "primary")
        h1 = build.ai_history(None, st)
        self.assertEqual(len(build.ai_history({"ai_history": h1}, st)["builds"]), 1)
        self.assertEqual(len(build.ai_history({"ai_history": "x"}, st)["builds"]), 1)
        self.assertEqual(build.ai_history(None, {"generated_at": 1, "ai": {"status": "nokey"}})["builds"][0]["tier"], "rules_only")


if __name__ == "__main__":
    unittest.main()


class HistoryThroughMain(unittest.TestCase):
    def test_two_builds_leave_two_rows_in_stats_json(self):
        import contextlib, io, tempfile
        from pathlib import Path
        from helpers import FIX, NOW
        with tempfile.TemporaryDirectory() as d:
            o = Path(d) / "latest.json"
            for now in (NOW, NOW + 3600):
                with contextlib.redirect_stdout(io.StringIO()) as out:
                    rc = build.main(["--items", str(FIX / "items.json"), "--no-ai", "--now", str(now), "--out", str(o)])
                self.assertEqual(rc, 0)
            st = json.loads((Path(d) / "stats.json").read_text(encoding="utf-8"))
            self.assertIn("ai history builds=2", out.getvalue())
        self.assertEqual(len(st["ai_history"]["builds"]), 2)
        self.assertTrue(all(set(r) == {"at", "tier", "model", "reason", "summary_tier"} for r in st["ai_history"]["builds"]))


class BlockModels(unittest.TestCase):
    def test_each_answered_block_names_the_model_that_answered_it(self):
        p, _ = provider(lambda m, n: 503 if n == 1 else 200)
        reqs = [{"doc": "{}", "bids": ["b01"]}, {"doc": "{}", "bids": ["b02"]}]
        from unittest import mock
        fake = lambda req, raw, prompt, items: {"errors": [], "counts": {}, "blocks": {b: [] for b in req["bids"]}}
        with mock.patch.object(build.validate_mod, "validate", fake):
            _, run = build.run_ai(reqs, p, PROMPT, {}, 0)
        self.assertEqual(run["block_models"], {"b01": PROMPT["merge_fallback_models"][0], "b02": MAIN})
