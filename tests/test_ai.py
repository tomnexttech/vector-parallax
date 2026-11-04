# -*- coding: utf-8 -*-
"""ai.py の試験。網には出ない: GeminiProvider は transport を差し替える。鍵は合成の値（実在しない）。"""
import json
import socket
import unittest
import urllib.error

from helpers import ai, load_prompt

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
        for code, err in ((429, "quota"), (500, "http"), (503, "http")):
            tr, calls = self.counting([code])
            sleeps = []
            self.assertEqual(gem(tr, sleep=sleeps.append).call("s", "u", {}), (None, err))
            self.assertEqual((len(calls), sleeps), (3, [2.0, 4.0]), code)

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

    def test_no_fallback_for_quota(self):
        seen = []

        def tr(url, headers, body, timeout):
            seen.append(url.split("/models/")[1].split(":")[0])
            return 429, "{}"
        gem(tr, fallback_model="lite-model").call("s", "u", {})
        self.assertEqual(set(seen), {"gemini-test-model"})

    def test_retries_can_be_turned_off(self):
        tr, calls = self.counting([429])
        self.assertEqual(gem(tr, retries=0).call("s", "u", {}), (None, "quota"))
        self.assertEqual(len(calls), 1)


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
