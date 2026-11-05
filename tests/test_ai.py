# -*- coding: utf-8 -*-
"""ai.py の試験。網には出ない: GeminiProvider は transport を差し替える。鍵は合成の値（実在しない）。"""
import json
import socket
import unittest
import urllib.error

from helpers import ai, build, load_prompt

PROMPT = load_prompt()
FAKE_KEY = "TEST-KEY-NOT-REAL-0000"


def gem(transport, **kw):
    kw.setdefault("sleep", lambda s: None)                  # 試験は待たない
    return ai.GeminiProvider(FAKE_KEY, "gemini-test-model", transport=transport, **kw)


def ok_body(text):
    return json.dumps({"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}]})


class Gemini(unittest.TestCase):
    def test_request_shape_and_key_placement(self):
        seen = {}

        def tr(url, headers, body, timeout):
            seen.update(url=url, headers=headers, body=json.loads(body.decode("utf-8")), timeout=timeout)
            return 200, ok_body('{"blocks":[]}')

        p = gem(tr)
        raw, err = p.call("SYS", "USER 試験", PROMPT["schema"])
        self.assertEqual((raw, err), ('{"blocks":[]}', ""))
        self.assertEqual(seen["url"], "https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent")
        self.assertNotIn(FAKE_KEY, seen["url"])
        self.assertEqual(seen["headers"]["x-goog-api-key"], FAKE_KEY)
        b = seen["body"]
        self.assertEqual(b["contents"], [{"role": "user", "parts": [{"text": "USER 試験"}]}])
        self.assertEqual(b["systemInstruction"], {"parts": [{"text": "SYS"}]})
        g = b["generationConfig"]
        self.assertEqual((g["responseMimeType"], g["temperature"]), ("application/json", 0))
        self.assertEqual(g["maxOutputTokens"], ai.DEFAULT_MAX_OUTPUT_TOKENS)
        self.assertEqual(json.loads(gem(tr, max_output_tokens=1234).build_request("s", "u", {})[2].decode())
                         ["generationConfig"]["maxOutputTokens"], 1234)
        self.assertEqual(g["responseSchema"], PROMPT["schema"])
        self.assertNotIn(FAKE_KEY, json.dumps(b))
        self.assertNotIn(FAKE_KEY, repr(p))

    def test_key_required_and_model_checked(self):
        with self.assertRaises(ValueError):
            ai.GeminiProvider("  ", "m")
        with self.assertRaises(ValueError):
            ai.GeminiProvider(FAKE_KEY, "bad model/../x")

    def test_error_codes(self):
        def status(code, text="{}"):
            return lambda *a: (code, text)

        cases = [
            (status(401), "auth"), (status(403), "auth"), (status(429), "quota"), (status(500), "http"),
            (status(404), "http"), (status(200, "not json"), "json"),
            (status(200, json.dumps({"promptFeedback": {"blockReason": "SAFETY"}})), "blocked"),
            (status(200, json.dumps({"candidates": [{"finishReason": "SAFETY", "content": {"parts": [{"text": "x"}]}}]})), "blocked"),
            (status(200, json.dumps({"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": "{"}]}}]})), "truncated"),
            (status(200, json.dumps({"candidates": []})), "shape"),
            (status(200, json.dumps([1])), "shape"),
            (status(200, json.dumps({"candidates": [{"content": {"parts": [{"text": "   "}]}}]})), "shape"),
            (status(200, json.dumps({"candidates": [{"content": {}}]})), "shape"),
        ]
        for tr, want in cases:
            with self.subTest(want=want):
                raw, err = gem(tr).call("s", "u", {})
                self.assertIsNone(raw)
                self.assertEqual(err, want)

    def test_exceptions_become_codes(self):
        def raiser(exc):
            def tr(*a):
                raise exc
            return tr

        self.assertEqual(gem(raiser(socket.timeout())).call("s", "u", {}), (None, "timeout"))
        self.assertEqual(gem(raiser(TimeoutError())).call("s", "u", {}), (None, "timeout"))
        self.assertEqual(gem(raiser(urllib.error.URLError(socket.timeout()))).call("s", "u", {}), (None, "timeout"))
        self.assertEqual(gem(raiser(urllib.error.URLError("dns"))).call("s", "u", {}), (None, "network"))
        self.assertEqual(gem(raiser(ConnectionResetError())).call("s", "u", {}), (None, "network"))
        self.assertEqual(gem(raiser(RuntimeError("boom"))).call("s", "u", {}), (None, "network"))

    def test_thought_parts_are_skipped_and_text_joined(self):
        body = json.dumps({"candidates": [{"content": {"parts": [
            {"text": "考え中", "thought": True}, {"text": '{"blocks"'}, {"text": ":[]}"}]}}]})
        self.assertEqual(gem(lambda *a: (200, body)).call("s", "u", {}), ('{"blocks":[]}', ""))

    def test_error_text_never_contains_key(self):
        def tr(url, headers, body, timeout):
            raise urllib.error.URLError("failed " + url)
        raw, err = gem(tr).call("s", "u", {})
        self.assertNotIn(FAKE_KEY, str(err))


class Recorded(unittest.TestCase):
    def test_lookup_by_sha256_of_user_text(self):
        ut = ai.render_user_text(PROMPT, '{"blocks":[]}')
        self.assertEqual(ut, "<doc>\n{\"blocks\":[]}\n</doc>")
        rec = ai.RecordedProvider({"version": "x", "provider": "claude-recorded", "model": "claude-test",
                                   "made_at": 1762225200, "note_ja": "試験の記録",
                                   "responses": {ai.sha256_text(ut): "RAW"}})
        self.assertEqual((rec.name, rec.model, rec.made_at, rec.note_ja), ("claude-recorded", "claude-test", 1762225200, "試験の記録"))
        self.assertEqual(rec.call("s", ut, {}), ("RAW", ""))
        self.assertEqual(rec.call("s", ut + " ", {}), (None, "missing"))

    def test_bad_file_rejected(self):
        with self.assertRaises(ValueError):
            ai.RecordedProvider({"responses": []})

    def test_sha256_known_value(self):
        self.assertEqual(ai.sha256_text("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        self.assertEqual(ai.sha256_text("日本"), __import__("hashlib").sha256("日本".encode("utf-8")).hexdigest())


class Fake(unittest.TestCase):
    def test_return_shapes_and_calls_recorded(self):
        p = ai.FakeProvider(lambda s, u, sc: {"blocks": []})
        self.assertEqual(p.call("s", "u", {"x": 1}), ('{"blocks": []}', ""))
        self.assertEqual(p.calls, [{"system": "s", "user_text": "u", "schema": {"x": 1}}])
        self.assertEqual(ai.FakeProvider(lambda *a: "RAW").call("s", "u", {}), ("RAW", ""))
        self.assertEqual(ai.FakeProvider(lambda *a: (None, "quota")).call("s", "u", {}), (None, "quota"))
        self.assertEqual(ai.FakeProvider(lambda *a: None).call("s", "u", {}), (None, "network"))

        def boom(*a):
            raise ai.FakeError("timeout")
        self.assertEqual(ai.FakeProvider(boom).call("s", "u", {}), (None, "timeout"))
        self.assertEqual((p.name, p.model), ("fake", "fake"))

    def test_error_codes_listed(self):
        self.assertEqual(set(ai.ERROR_CODES),
                         {"nokey", "auth", "quota", "blocked", "truncated", "http", "timeout", "network", "json", "shape", "missing", "budget"})


class Retry(unittest.TestCase):
    def counting(self, statuses):
        calls = []

        def tr(url, headers, body, timeout):
            calls.append(1)
            st = statuses[min(len(calls) - 1, len(statuses) - 1)]
            return (st, ok_body('{"blocks":[]}')) if st == 200 else (st, "{}")
        return tr, calls

    def test_429_then_success(self):
        tr, calls = self.counting([429, 200])
        sleeps = []
        p = gem(tr, sleep=sleeps.append)
        self.assertEqual(p.call("s", "u", {}), ('{"blocks":[]}', ""))
        self.assertEqual((len(calls), sleeps), (2, [2.0]))

    def test_at_most_two_retries_with_exponential_wait(self):
        for code, err, waits in ((429, "quota", [2.0, 4.0]), (500, "http", [10.0, 30.0]), (503, "http", [10.0, 30.0])):
            tr, calls = self.counting([code])
            sleeps = []
            self.assertEqual(gem(tr, sleep=sleeps.append).call("s", "u", {}), (None, err))
            self.assertEqual((len(calls), sleeps), (3, waits), code)

    def test_network_and_timeout_are_retried(self):
        for exc, err in ((TimeoutError(), "timeout"), (urllib.error.URLError("dns"), "network")):
            calls = []

            def tr(*a, exc=exc):
                calls.append(1)
                raise exc
            self.assertEqual(gem(tr).call("s", "u", {}), (None, err))
            self.assertEqual(len(calls), 3)

    def test_not_retried(self):
        for body, err in ((None, "auth"),):
            tr, calls = self.counting([401])
            self.assertEqual(gem(tr).call("s", "u", {}), (None, err))
            self.assertEqual(len(calls), 1)
        for text, err in (("not json", "json"), (json.dumps({"candidates": []}), "shape"),
                          (json.dumps({"promptFeedback": {"blockReason": "SAFETY"}}), "blocked"),
                          (json.dumps({"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": "{"}]}}]}), "truncated")):
            calls = []

            def tr(*a, text=text):
                calls.append(1)
                return 200, text
            self.assertEqual(gem(tr).call("s", "u", {}), (None, err))
            self.assertEqual(len(calls), 1, err)

    def test_busy_model_falls_back_on_the_retry(self):
        seen = []

        def tr(url, headers, body, timeout):
            seen.append(url.split("/models/")[1].split(":")[0])
            return (503, "{}") if len(seen) == 1 else (200, ok_body('{"blocks":[]}'))
        p = gem(tr, fallback_model="lite-model")
        self.assertEqual(p.call("s", "u", {}), ('{"blocks":[]}', ""))
        self.assertEqual((seen, p.model), (["gemini-test-model", "lite-model"], "lite-model"))

    def test_quota_falls_back_too_but_auth_does_not(self):
        for code, want in ((429, ["gemini-test-model", "lite-model"]), (401, ["gemini-test-model"])):
            seen = []

            def tr(url, headers, body, timeout, code=code):
                seen.append(url.split("/models/")[1].split(":")[0])
                return (code, "{}") if len(seen) == 1 else (200, ok_body('{"blocks":[]}'))
            gem(tr, fallback_model="lite-model").call("s", "u", {})
            self.assertEqual(seen, want, code)

    def test_retries_can_be_turned_off(self):
        tr, calls = self.counting([429])
        self.assertEqual(gem(tr, retries=0).call("s", "u", {}), (None, "quota"))
        self.assertEqual(len(calls), 1)


class FallbackChain(unittest.TestCase):
    """主の型 -> 予備の型の鎖。混雑（503・500）の待ちは長く、429 は短いまま。主の型と予備の型は別の上限で数える。"""

    def make(self, status_of, **kw):
        seen, sleeps = [], []

        def tr(url, headers, body, timeout):
            m = url.split("/models/")[1].split(":")[0]
            seen.append(m)
            st = status_of(m)
            return (200, ok_body('{"blocks":[]}')) if st == 200 else (st, "{}")
        kw.setdefault("fallback_models", ["step-1", "step-2"])
        return ai.GeminiProvider(FAKE_KEY, "main-m", transport=tr, sleep=sleeps.append, **kw), seen, sleeps

    def test_busy_waits_are_long_and_a_429_keeps_the_short_wait(self):
        for code, want in ((503, [10.0, 30.0]), (500, [10.0, 30.0]), (429, [2.0, 4.0])):
            p, seen, sleeps = self.make(lambda m, code=code: code)
            p.call("s", "u", {})
            self.assertEqual(sleeps, want, code)
        p, seen, sleeps = self.make(lambda m: 503, retries=4)             # 1 回の待ちには上限がある
        p.call("s", "u", {})
        self.assertEqual(sleeps, [10.0, 30.0, 60.0, 60.0])
        self.assertEqual(ai.BUSY_BACKOFF_MAX_S, 60.0)

    def test_a_503_walks_down_the_chain_and_the_answering_model_is_named(self):
        p, seen, sleeps = self.make(lambda m: 200 if m == "step-1" else 503)
        self.assertEqual(p.call("s", "u", {}), ('{"blocks":[]}', ""))
        self.assertEqual((seen, sleeps, p.model), (["main-m", "step-1"], [10.0], "step-1"))
        p.call("s", "u", {})                                              # 混んでいた主の型へは戻らない
        self.assertEqual(seen, ["main-m", "step-1", "step-1"])
        self.assertEqual(p.chain_models, ("main-m", "step-1", "step-2"))
        self.assertEqual(p.fallback_models, ("step-1", "step-2"))

    def test_the_http_record_names_the_model_and_status_of_every_attempt(self):
        ai.HTTP_DETAILS.clear()
        p, seen, sleeps = self.make(lambda m: 503)
        p.call("s", "u", {})
        self.assertEqual([(m, s) for m, s, _ in ai.HTTP_DETAILS], [("main-m", 503), ("step-1", 503), ("step-2", 503)])

    def test_the_main_budget_counts_only_the_main_model(self):
        main, fb = ai.CallBudget(2), ai.CallBudget(4)
        p, seen, sleeps = self.make(lambda m: 503 if m == "main-m" else 200, budget=main, fallback_budget=fb)
        for _ in range(3):
            self.assertEqual(p.call("s", "u", {})[1], "")
        self.assertEqual(seen, ["main-m", "step-1", "step-1", "step-1"])
        self.assertEqual((main.used, fb.used), (1, 3))                    # 主の型は 1 回だけ。予備の 3 回は予備の上限に数える

    def test_the_fallback_has_a_limit_of_its_own_and_all_503_ends_as_http_then_budget(self):
        main, fb = ai.CallBudget(2), ai.CallBudget(4)
        p, seen, sleeps = self.make(lambda m: 503, budget=main, fallback_budget=fb)
        self.assertEqual(p.call("s", "u", {}), (None, "http"))
        self.assertEqual(seen, ["main-m", "step-1", "step-2"])
        self.assertEqual(p.call("s", "u", {}), (None, "http"))
        self.assertEqual(seen[3:], ["step-2", "step-2"])                  # 末尾の型では同じ型にとどまる。予備の 4 回目で止まる
        self.assertEqual((main.used, fb.used), (1, 4))
        self.assertEqual(p.call("s", "u", {}), (None, "budget"))
        self.assertEqual(len(seen), 5)
        self.assertTrue(sleeps and all(s >= 10.0 for s in sleeps))

    def test_a_timeout_stays_on_the_model_and_a_spent_main_budget_hands_over(self):
        seen, sleeps = [], []

        def tr(url, headers, body, timeout):
            seen.append(url.split("/models/")[1].split(":")[0])
            raise TimeoutError()
        main, fb = ai.CallBudget(2), ai.CallBudget(4)
        p = ai.GeminiProvider(FAKE_KEY, "main-m", transport=tr, sleep=sleeps.append, fallback_models=["step-1"],
                              budget=main, fallback_budget=fb)
        self.assertEqual(p.call("s", "u", {}), (None, "timeout"))
        self.assertEqual((seen, sleeps), (["main-m", "main-m", "step-1"], [2.0, 4.0]))
        self.assertEqual((main.used, fb.used), (2, 1))

    def test_names_are_checked_and_the_old_single_argument_still_works(self):
        with self.assertRaises(ValueError):
            ai.GeminiProvider(FAKE_KEY, "m", fallback_models=["bad/../x"])
        p = ai.GeminiProvider(FAKE_KEY, "main-m", fallback_models=["main-m", "step-1", "step-1"])
        self.assertEqual(p.chain_models, ("main-m", "step-1"))            # 同じ名は一度だけ
        self.assertEqual(gem(lambda *a: (200, "{}"), fallback_model="lite").chain_models, ("gemini-test-model", "lite"))


class ChainInPrompt(unittest.TestCase):
    ENV = {"GEMINI_API_KEY": FAKE_KEY}

    def test_prompt_json_names_the_chains_and_the_providers_carry_them(self):
        self.assertEqual(PROMPT["merge_fallback_models"], ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"])
        self.assertEqual(PROMPT["summary_fallback_models"], ["gemini-3.1-flash-lite"])
        for name in PROMPT["merge_fallback_models"] + PROMPT["summary_fallback_models"]:
            self.assertTrue(ai._MODEL_RE.match(name), name)
            self.assertNotIn(name, ("gemini-2.5-flash", "gemini-2.5-pro"))        # 一覧で Deprecated の型は入れない
        self.assertNotIn(PROMPT["merge_model"], PROMPT["merge_fallback_models"])
        self.assertNotIn(PROMPT["summary_model"], PROMPT["summary_fallback_models"])
        p, _ = build.choose_provider({}, self.ENV, None, PROMPT)
        self.assertEqual(p.chain_models, (PROMPT["merge_model"],) + tuple(PROMPT["merge_fallback_models"]))
        self.assertEqual((p.budget.limit, p.fallback_budget.limit), (build.MERGE_CALL_LIMIT, build.MERGE_FALLBACK_LIMIT))
        on = dict(PROMPT, summary=dict(PROMPT["summary"], enabled=True))
        sp, _ = build.choose_summary_provider({}, self.ENV, on)
        self.assertEqual(sp.chain_models, (PROMPT["summary_model"],) + tuple(PROMPT["summary_fallback_models"]))
        self.assertEqual((sp.budget.limit, sp.fallback_budget.limit), (build.SUMMARY_CALL_LIMIT, build.SUMMARY_FALLBACK_LIMIT))
        p2, _ = build.choose_provider({}, self.ENV, "gemini-other", PROMPT)       # --model で名指しした時は鎖を付けない
        self.assertEqual(p2.chain_models, ("gemini-other",))
        old = {k: v for k, v in PROMPT.items() if k != "merge_fallback_models"}
        old["merge_fallback_model"] = "gemini-3.5-flash-lite"                     # 古い単数の鍵も読む
        p3, _ = build.choose_provider({}, self.ENV, None, old)
        self.assertEqual(p3.chain_models, (PROMPT["merge_model"], "gemini-3.5-flash-lite"))

    def test_every_model_503_sends_the_build_back_to_the_rules(self):
        p, _ = build.choose_provider({}, self.ENV, None, PROMPT)
        sleeps = []
        p._transport = lambda url, headers, body, timeout: (503, "{}")
        p._sleep = sleeps.append
        reqs = [{"doc": "{}", "bids": ["b01"]}, {"doc": "{}", "bids": ["b02"]}]
        results, run = build.run_ai(reqs, p, PROMPT, {}, 0)
        self.assertEqual(results, {})                                              # 塊は規則のまま
        self.assertEqual(run["errors"], ["http", "http"])
        self.assertEqual(build.ai_status(p, run), "error")
        ar = build.make_ai_run("error", p, PROMPT, 0, run)
        self.assertEqual((ar["attempts"], ar["call_limit"], ar["fallback_attempts"], ar["fallback_limit"]), (1, 2, 4, 4))
        self.assertTrue(sleeps and all(s >= 10.0 for s in sleeps))


class Messages(unittest.TestCase):
    def test_every_code_has_a_plain_sentence_in_both_languages(self):
        for code in ai.ERROR_CODES:
            for lang in ("ja", "en"):
                m = ai.error_message(code, lang, PROMPT)
                self.assertTrue(m and m != code, (code, lang))
        self.assertIn("429", ai.error_message("quota", "ja", PROMPT))
        self.assertIn("429", ai.error_message("quota", "en", PROMPT))
        self.assertEqual(ai.error_message("quota", "ja"), ai.error_message("quota", "ja", PROMPT))   # prompt.json から読む
        self.assertEqual(ai.error_message("unknown-code", "ja", PROMPT), "unknown-code")
        self.assertNotIn("TEST-KEY", "".join(m["ja"] + m["en"] for m in PROMPT["error_messages"].values()))


if __name__ == "__main__":
    unittest.main()
