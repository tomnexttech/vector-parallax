# -*- coding: utf-8 -*-
"""要約の段（CONTRACT §13）の試験。合成の fixture と偽の provider だけ。網には出ない。"""
import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from helpers import FIX, NOW, ROOT, ai, build, doc_of, fake, load_items, load_prompt, rules_answer, validate

PROMPT = load_prompt()


def setUpModule():                                    # 要約の試験は、束ね直しが多媒体の出来事を全部は取らない状態で回す（1 媒体だけの出来事には要約を付けない: §13）
    global _KEEP
    _KEEP = (build.PICK_TOP, build.PICK_LOOSE_PAIR)
    build.PICK_TOP = build.PICK_LOOSE_PAIR = 0


def tearDownModule():
    build.PICK_TOP, build.PICK_LOOSE_PAIR = _KEEP
PROMPT_ON = copy.deepcopy(PROMPT)
PROMPT_ON["summary"]["enabled"] = True        # 2026-11-05 から既定で入れてある。切った時の試験は PROMPT_OFF で回す
PROMPT_OFF = copy.deepcopy(PROMPT)
PROMPT_OFF["summary"]["enabled"] = False
ROOT_DATA = ROOT / "data"
KEY = "TEST-KEY-NOT-REAL-0000"


def summary_answer(user_text, edit=None):
    doc = doc_of(user_text)
    rows = [{"eid": ev["eid"], "summary_ja": "試験の一行 %s" % ev["eid"]} for ev in doc["events"]]
    if edit:
        edit(rows, doc)
    return json.dumps({"summaries": rows}, ensure_ascii=False)


def sfake(edit=None, name="fake", model="fake", budget=None):
    p = ai.FakeProvider(lambda system, user_text, schema: summary_answer(user_text, edit), budget=budget)
    p.name, p.model = name, model
    return p


def synth(n):
    items, stories = {}, []
    for k in range(n):
        iid = "i%04d" % k
        items[iid] = {"id": iid, "outlet": "O%d" % (k % 7), "lang": "ja", "title": "合成の見出し %04d について" % k}
        stories.append({"sid": "s%04d" % k, "member_ids": [iid], "n_outlets": 2, "ai": None})
    return stories, items


def stage(stories, items, provider, cache, prompt=PROMPT, status="off", now=NOW):
    return build.summary_stage(stories, items, now, prompt, provider, status, cache)


def run_build(merge=None, summ=None, cache=None, public=True, now=NOW, previous=None, status="off", sstatus="off",
              prompt=None, extras=None):
    snap = load_items()
    return build.build(snap["items"], snap["sources"], now, 36, merge, status, prompt or PROMPT_ON, public, previous,
                       summ, sstatus, cache, extras)


class Validator(unittest.TestCase):
    def req(self):
        doc = {"events": [{"eid": "e1", "items": [{"outlet": "A", "lang": "ja", "title": "首相が来週アジア三か国を訪問する方針を固めた"}]},
                          {"eid": "e2", "items": [{"outlet": "B", "lang": "en", "title": "Storm closes ports along the coast"}]}]}
        return {"doc": json.dumps(doc, ensure_ascii=False), "eids": {"e1": "sA", "e2": "sB"}}

    def test_quote_unknown_duplicate_and_missing(self):
        raw = json.dumps({"summaries": [
            {"eid": "e1", "summary_ja": "首相が来週アジア三か国を訪問する方針を固めた"},        # 丸写し
            {"eid": "e9", "summary_ja": "頼んでいない"},
            {"eid": "e2", "summary_ja": "沿岸の港が嵐で閉鎖された"},
            {"eid": "e2", "summary_ja": "二つ目は採らない"}]}, ensure_ascii=False)
        out = validate.validate_summaries(self.req(), raw, PROMPT)
        self.assertEqual(out["summaries"], {"sB": "沿岸の港が嵐で閉鎖された"})
        self.assertEqual(out["counts"], {"quoted_fields": 1, "empty": 0, "unknown_eid": 1, "missing": 0})
        out = validate.validate_summaries(self.req(), json.dumps({"summaries": []}), PROMPT)
        self.assertEqual((out["summaries"], out["counts"]["missing"]), ({}, 2))

    def test_broken_answers(self):
        self.assertEqual(validate.validate_summaries(self.req(), "not json", PROMPT)["errors"], ["json"])
        self.assertEqual(validate.validate_summaries(self.req(), '{"blocks": []}', PROMPT)["errors"], ["shape"])
        out = validate.validate_summaries(self.req(), '{"summaries":[{"eid":"e1","summary_ja":"  "}]}', PROMPT)
        self.assertEqual((out["summaries"], out["counts"]["empty"], out["counts"]["missing"]), ({}, 1, 1))


class PublicSafety(unittest.TestCase):
    def test_no_quote_of_a_headline_and_no_focus_of_no_or_nc(self):
        snap = load_items()
        titles = [it["title"] for it in snap["items"] if len(it["title"]) >= 10]

        def echo(rows, doc):                                          # わざと見出しを丸写しにする答え
            for r, ev in zip(rows, doc["events"]):
                r["summary_ja"] = "要点: " + ev["items"][0]["title"]
        sp = sfake(echo)
        d, _ = run_build(fake(), sp, build.empty_cache())
        sm = d["ai_run"]["summary"]
        self.assertGreaterEqual(sm["quoted_fields"], 1)
        self.assertEqual(sm["summarized"], sum(1 for s in d["stories"] if "summary" in s))
        text = json.dumps(d, ensure_ascii=False)
        for t in titles:
            hidden = any(it["title"] == t and not build.terms_ok(it) for it in snap["items"])
            if hidden:
                self.assertNotIn(t, text, "公開版の出力に見出しの丸写しが残っている")
        self.assertEqual(build.focus_of_no_sources(d["stories"], d["items"]), [])    # no / nc の源の焦点 0 件
        self.assertEqual(build.check_output(d), [])

    def test_summaries_are_event_level_labelled_and_checked(self):
        sp = sfake(name="gemini", model="gemini-summary-test")
        d, _ = run_build(fake(), sp, build.empty_cache())
        with_sum = [s for s in d["stories"] if "summary" in s]
        self.assertGreaterEqual(len(with_sum), 1)
        for s in with_sum:
            self.assertIsNone(s["ai"])                                # AI の見出しを持つ story には付けない
            self.assertEqual(s["summary"]["provider"], "gemini")
            self.assertEqual(s["summary"]["model"], "gemini-summary-test")
            self.assertEqual(s["summary"]["made_at"], NOW)
            self.assertTrue(s["summary"]["text_ja"].startswith("試験の一行"))
        self.assertEqual(sum(1 for s in d["stories"] if s["ai"] is None and s["n_outlets"] >= 2), len(with_sum))
        run = d["ai_run"]["summary"]
        self.assertEqual((run["status"], run["model"], run["summarized"]), ("ok", "gemini-summary-test", len(with_sum)))
        self.assertLessEqual(len(sp.calls), build.SUMMARY_CALL_LIMIT)
        self.assertEqual(build.check_output(d), [])
        bad = copy.deepcopy(d)
        extra = copy.deepcopy(next(s for s in bad["stories"] if "summary" in s))
        extra["summary"]["provider"] = "someone-else"
        bad["stories"].append(extra)
        self.assertTrue(any("more than one provider" in p for p in build.check_output(bad)))
        bad = copy.deepcopy(d)
        del next(s for s in bad["stories"] if "summary" in s)["summary"]["made_at"]
        self.assertTrue(any("summary has the wrong shape" in p for p in build.check_output(bad)))

    def test_stats_ai_has_a_field_per_purpose(self):
        snap = load_items()
        sp = sfake(name="gemini", model="gemini-summary-test")
        d, _ = run_build(fake(), sp, build.empty_cache())
        st = build.make_stats(d, snap["items"], NOW, 36)["ai"]
        self.assertEqual(st["summarized"], sum(1 for s in d["stories"] if "summary" in s))
        self.assertEqual((st["summary"]["provider"], st["summary"]["model"], st["summary"]["limit"]),
                         ("gemini", "gemini-summary-test", build.SUMMARY_CALL_LIMIT))
        self.assertEqual((st["summary"]["calls"], st["summary"]["calls_failed"], st["summary"]["cache_hits"]), (len(sp.calls), 0, 0))
        self.assertEqual((st["merge"]["calls"], st["merge"]["limit"]), (d["ai_run"]["calls"], build.MERGE_CALL_LIMIT))


class CallLimits(unittest.TestCase):
    def test_batches_of_45_and_at_most_15_calls(self):
        stories, items = synth(800)
        sp = sfake(budget=ai.CallBudget(build.SUMMARY_CALL_LIMIT))
        run, reqs = stage(stories, items, sp, build.empty_cache())
        self.assertEqual((len(sp.calls), len(reqs)), (15, 15))
        self.assertTrue(all(len(r["eids"]) == 45 for r in reqs))
        self.assertEqual((run["summarized"], run["left_out"]), (15 * 45, 800 - 15 * 45))   # 上位から数で決める
        self.assertEqual([s["sid"] for s in stories if "summary" in s], [s["sid"] for s in stories[:675]])

    def test_a_retry_counts_as_a_call(self):
        stories, items = synth(800)
        seen = []

        def always_429(url, headers, body, timeout):
            seen.append(1)
            return 429, ""
        prov = ai.GeminiProvider(KEY, "m-test", transport=always_429, sleep=lambda s: None,
                                 budget=ai.CallBudget(build.SUMMARY_CALL_LIMIT))
        run, _ = stage(stories, items, prov, build.empty_cache())
        self.assertEqual(len(seen), 15)                               # やり直しを含めて 15 本で止まる
        self.assertEqual((run["attempts"], run["calls"], run["calls_skipped"], run["status"]), (15, 5, 10, "error"))
        self.assertIn("budget", run["errors"])
        self.assertEqual(run["summarized"], 0)

    def test_merge_budget_stops_the_retry(self):
        seen = []

        def always_429(url, headers, body, timeout):
            seen.append(1)
            return 429, ""
        prov = ai.GeminiProvider(KEY, "m-test", transport=always_429, sleep=lambda s: None, budget=ai.CallBudget(2))
        self.assertEqual(prov.call("s", "u", {}), (None, "quota"))
        self.assertEqual(len(seen), 2)                                # 2 回のうち 1 回はやり直し。3 回目は送らない
        self.assertEqual(prov.call("s", "u", {}), (None, "budget"))
        self.assertEqual(len(seen), 2)

    def test_the_bundling_never_goes_past_its_two_limits(self):
        seen = []

        def always_429(url, headers, body, timeout):
            seen.append(url.split("/models/")[1].split(":")[0])
            return 429, ""
        prov, _ = build.choose_provider({}, {"GEMINI_API_KEY": KEY}, None, PROMPT)
        prov._transport, prov._sleep = always_429, lambda s: None
        d, reqs = run_build(prov, None, prompt=PROMPT)
        main = sum(1 for m in seen if m == PROMPT["merge_model"])
        self.assertLessEqual(main, build.MERGE_CALL_LIMIT)                 # 主の型へは、やり直しを含めて 2 呼びまで
        self.assertLessEqual(len(seen) - main, build.MERGE_FALLBACK_LIMIT)  # 予備の型へは別に 4 試行まで
        self.assertLessEqual(len(reqs), build.MERGE_CALL_LIMIT)
        self.assertEqual((d["ai_run"]["attempts"], d["ai_run"]["fallback_attempts"]), (main, len(seen) - main))
        self.assertEqual((d["ai_run"]["call_limit"], d["ai_run"]["fallback_limit"]), (2, 4))
        self.assertTrue(all(b["ai"] == "fallback" for b in d["blocks"]))
        self.assertEqual(build.check_output(d), [])                     # 超える塊は規則のまま残る

    def test_merge_run_reports_the_limit(self):
        p = fake()
        p.budget = ai.CallBudget(1)                                    # 2 本目は送らない
        d, reqs = run_build(p, None)
        if len(reqs) >= 2:
            self.assertEqual(d["ai_run"]["calls_skipped"], len(reqs) - 1)
            self.assertEqual(d["ai_run"]["status"], "partial")
            self.assertIn("budget", d["ai_run"]["errors"])
        self.assertLessEqual(len(p.calls), 1)


class Cache(unittest.TestCase):
    def test_a_hit_is_not_called_again_and_keeps_its_time(self):
        cache = build.empty_cache()
        sp = sfake()
        d1, _ = run_build(fake(), sp, cache)
        n = sum(1 for s in d1["stories"] if "summary" in s)
        self.assertGreater(n, 0)
        sp2 = sfake()
        d2, _ = run_build(fake(), sp2, cache, now=NOW + 60)
        self.assertEqual(sp2.calls, [])
        self.assertEqual(d2["ai_run"]["summary"]["cache_hits"], n)
        for s in d2["stories"]:
            if "summary" in s:
                self.assertEqual(s["summary"]["made_at"], NOW)           # 頁の「AI の時刻」は作った時刻

    def test_a_changed_key_is_called_again(self):
        stories, items = synth(10)
        cache = build.empty_cache()
        stage(stories, items, sfake(), cache)
        fresh = lambda sts: [{k: v for k, v in x.items() if k != "summary"} for x in sts]   # 新しい build の story は要約を持たない
        again = lambda st, it, **kw: stage(fresh(st), it, kw.get("prov") or sfake(), cache, kw.get("prompt", PROMPT))
        run, _ = again(stories, items)
        self.assertEqual((run["cache_hits"], run["calls"]), (10, 0))
        changed = fresh(copy.deepcopy(stories))                         # 顔ぶれが変わった 1 件だけ呼び直す
        items["i0099"] = {"id": "i0099", "outlet": "O1", "lang": "ja", "title": "別の見出しがここに入ります"}
        changed[3]["member_ids"] = changed[3]["member_ids"] + ["i0099"]
        sp = sfake()
        run, _ = again(changed, items, prov=sp)
        self.assertEqual((run["cache_hits"], len(sp.calls)), (9, 1))
        self.assertEqual(len(doc_of(sp.calls[0]["user_text"])["events"]), 1)
        p2 = copy.deepcopy(PROMPT)                                     # prompt の版が変われば全部
        p2["version"] = "parallax-prompt/99"
        sp = sfake()
        run, _ = again(stories, items, prov=sp, prompt=p2)
        self.assertEqual((run["cache_hits"], len(sp.calls)), (0, 1))
        sp = sfake(model="another-model")                              # モデルが変われば全部
        run, _ = again(stories, items, prov=sp)
        self.assertEqual((run["cache_hits"], len(sp.calls)), (0, 1))

    def test_digest_is_the_sorted_member_ids(self):
        self.assertEqual(build.members_digest(["b", "a"]), build.members_digest(["a", "b"]))
        self.assertNotEqual(build.members_digest(["a"]), build.members_digest(["a", "b"]))
        self.assertEqual(len(build.members_digest(["a"])), 64)

    def test_the_window_prunes_and_the_size_is_bounded(self):
        stories, items = synth(6)
        cache = build.empty_cache()
        stage(stories, items, sfake(), cache)
        cache["partitions"]["fake"]["f" * 64] = {"text_ja": "窓の外", "made_at": NOW - 99999, "model": "fake",
                                                 "prompt_version": PROMPT["version"], "sid": "sGone"}
        stage(stories, items, None, cache)
        self.assertNotIn("f" * 64, cache["partitions"]["fake"])        # 窓の外へ出た束は落とす
        self.assertEqual(len(cache["partitions"]["fake"]), 6)
        with mock.patch.object(build, "CACHE_MAX_ENTRIES", 4):
            stage(stories, items, None, cache)
        self.assertEqual(sum(len(r) for r in cache["partitions"].values()), 4)

    def test_providers_are_never_mixed(self):
        stories, items = synth(8)
        cache = build.empty_cache()
        pending = [dict(s) for s in stories]
        reqs = build.build_summary_requests(pending, items)
        resp = {ai.sha256_text(ai.render_user_text(PROMPT["summary"], r["doc"])): summary_answer(
            ai.render_user_text(PROMPT["summary"], r["doc"])).replace("試験の一行", "クロードの一行") for r in reqs}
        claude = ai.RecordedSummaryProvider(resp, "claude-recorded", "claude-test", NOW - 500, "試験")
        st1 = copy.deepcopy(stories)
        stage(st1, items, claude, cache)
        self.assertEqual({s["summary"]["provider"] for s in st1}, {"claude-recorded"})
        st2 = copy.deepcopy(stories)                                    # Gemini の回: Claude の区画は引かない
        sp = sfake(name="gemini", model="gemini-x")
        run, _ = stage(st2, items, sp, cache)
        self.assertEqual((run["cache_hits"], len(sp.calls)), (0, 1))
        self.assertEqual({s["summary"]["provider"] for s in st2}, {"gemini"})
        self.assertTrue(all(s["summary"]["text_ja"].startswith("試験の一行") for s in st2))
        self.assertEqual(set(cache["partitions"]), {"claude-recorded", "gemini"})
        self.assertEqual(cache["active"], "gemini")
        st3 = copy.deepcopy(stories)                                    # 鍵が無い回: 前回表示していた区画だけ
        stage(st3, items, None, cache, status="nokey")
        self.assertEqual({s["summary"]["provider"] for s in st3}, {"gemini"})
        for part in cache["partitions"]:                                # 区画の中は、その provider の物だけ
            self.assertTrue(all(x["text_ja"].startswith("クロード" if part == "claude-recorded" else "試験の一行")
                                for x in cache["partitions"][part].values()))
        down = build.empty_cache()                                      # Gemini が全滅した回: Claude の物を Claude の名で残す
        down["partitions"]["claude-recorded"] = copy.deepcopy(cache["partitions"]["claude-recorded"])
        down["active"] = "claude-recorded"
        st4 = copy.deepcopy(stories)
        bad = ai.FakeProvider(lambda *a: None)
        bad.name, bad.model = "gemini", "gemini-x"
        run, _ = stage(st4, items, bad, down)
        self.assertEqual(run["status"], "error")
        self.assertEqual({s["summary"]["provider"] for s in st4}, {"claude-recorded"})
        self.assertEqual(down["active"], "claude-recorded")

    def test_load_cache_survives_garbage(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.json"
            self.assertEqual(build.load_cache(p), build.empty_cache())
            p.write_text("{oops", encoding="utf-8")
            self.assertEqual(build.load_cache(p), build.empty_cache())
            good = {"text_ja": "x", "made_at": 1, "model": "m", "prompt_version": "v"}
            p.write_text(json.dumps({"schema": build.CACHE_SCHEMA, "active": "zzz",
                                     "partitions": {"a": {"k": good, "bad": {"text_ja": 3}}}}), encoding="utf-8")
            c = build.load_cache(p)
            self.assertEqual((list(c["partitions"]["a"]), c["active"]), (["k"], None))


class KeylessRun(unittest.TestCase):
    def test_a_run_without_a_key_keeps_the_summaries_and_the_ai_view(self):
        cache = build.empty_cache()
        d1, _ = run_build(fake(), sfake(), cache)
        self.assertEqual(d1["ai_run"]["status"], "ok")
        d2, _ = run_build(None, None, cache, now=NOW + 60, previous=copy.deepcopy(d1), status="nokey", sstatus="nokey")
        self.assertEqual(d2["ai_run"]["status"], "kept_previous")
        self.assertEqual(build.check_output(d2), [])
        self.assertEqual(d2["ai_run"]["summary"]["status"], "nokey")
        mine = {s["sid"]: s["summary"] for s in d2["stories"] if "summary" in s}
        snap = {s["sid"]: s["summary"] for s in d2["ai_snapshot"]["stories"] if "summary" in s}
        self.assertGreater(len(mine), 0)
        self.assertEqual(snap, {s["sid"]: s["summary"] for s in d1["stories"] if "summary" in s})
        self.assertEqual({v["provider"] for v in list(mine.values()) + list(snap.values())}, {"fake"})   # 新旧が混ざらない
        self.assertTrue(all(s["ai"] is None and s["origin"] == "rule" for s in d2["stories"]))


class Disabled(unittest.TestCase):
    """既定は入れてある（prompt.summary.enabled = true、2026-11-05）。切った時（false）に、何も呼ばず・何も出さず・何も壊さない。"""

    def test_the_committed_prompt_has_the_stage_on(self):
        self.assertIs(PROMPT["summary"]["enabled"], True)

    def test_off_nothing_called_nothing_shown(self):
        PROMPT = PROMPT_OFF
        self.assertIs(PROMPT["summary"]["enabled"], False)
        self.assertEqual(build.choose_summary_provider({}, {"GEMINI_API_KEY": KEY}, PROMPT), (None, "disabled"))
        cache = build.empty_cache()
        stories, items = synth(3)
        stage(stories, items, sfake(), cache)                           # 控えに物があっても
        before = copy.deepcopy(cache)
        sp, extras = sfake(), {}
        d, _ = run_build(fake(), sp, cache, prompt=PROMPT, extras=extras)
        self.assertEqual(sp.calls, [])
        self.assertEqual(extras["summary_requests"], [])
        self.assertFalse(any("summary" in s for s in d["stories"]))
        self.assertEqual(cache, before)                                 # 控えには触れない
        self.assertEqual(d["ai_run"]["summary"]["status"], "disabled")
        self.assertEqual(build.check_output(d), [])
        st = build.make_stats(d, load_items()["items"], NOW, 36)["ai"]
        self.assertEqual((st["summarized"], st["summary"]["status"], st["summary"]["calls"]), (0, "disabled", 0))
        self.assertEqual(build.dump_requests([], PROMPT, extras["summary_requests"])["summary_requests"], [])

    def test_a_build_without_a_key_carries_no_summary(self):
        # latest.json is a build product (CONTRACT 20.1), not tracked: build from the synthetic fixture with the committed prompt and no key
        d, _ = run_build(None, None, build.empty_cache(), public=True, status="off", sstatus="off", prompt=PROMPT)
        self.assertFalse(any("summary" in s for s in d["stories"]))
        self.assertEqual(d["ai_run"]["summary"]["status"], "off")
        d, _ = run_build(None, None, build.empty_cache(), public=True, status="off", sstatus="off", prompt=PROMPT_OFF)
        self.assertFalse(any("summary" in s for s in d["stories"]))
        self.assertEqual(d["ai_run"]["summary"]["status"], "disabled")


class RecordedPath(unittest.TestCase):
    def test_summary_view_and_choose(self):
        no_sum = ai.RecordedProvider({"provider": "claude-recorded", "model": "m", "made_at": NOW, "responses": {}})
        self.assertIsNone(no_sum.summary_view())
        self.assertEqual(build.choose_summary_provider({"responses": "x"}, {}, PROMPT_ON, no_sum), (None, "none"))
        with_sum = ai.RecordedProvider({"provider": "claude-recorded", "model": "m", "made_at": NOW, "responses": {},
                                        "summary_responses": {"k": "v"},
                                        "summary": {"provider": "claude-recorded", "model": "m2", "made_at": NOW + 5}})
        v = with_sum.summary_view()
        self.assertEqual((v.name, v.model, v.made_at), ("claude-recorded", "m2", NOW + 5))
        self.assertEqual(build.choose_summary_provider({"responses": "x"}, {"GEMINI_API_KEY": KEY}, PROMPT_ON, with_sum)[1], "")

    def test_cli_dump_then_replay(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            base = ["--items", str(FIX / "items.json"), "--now", str(NOW), "--public", "--out", str(td / "latest.json")]

            def main(extra):
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()), \
                        mock.patch.object(build, "load_prompt", lambda path=None, rights=None: PROMPT_ON):
                    return build.main(base + extra)
            self.assertEqual(main(["--dump-requests", str(td / "d0.json")]), 0)
            d0 = json.loads((td / "d0.json").read_text(encoding="utf-8"))
            rec = {"version": "parallax-recorded/1", "provider": "claude-recorded", "model": "claude-test", "made_at": NOW - 50,
                   "note_ja": "試験", "responses": {x["sha256"]: rules_answer(x["user_text"]) for x in d0["requests"]}}
            (td / "rec.json").write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(main(["--responses", str(td / "rec.json"), "--dump-requests", str(td / "d1.json")]), 0)
            self.assertFalse((td / "summary_cache.json").exists())      # --dump-requests は控えを書かない
            d1 = json.loads((td / "d1.json").read_text(encoding="utf-8"))
            self.assertGreater(len(d1["summary_requests"]), 0)
            self.assertLessEqual(len(d1["summary_requests"]), build.SUMMARY_CALL_LIMIT)
            for r in d1["summary_requests"]:
                self.assertEqual((r["purpose"], r["sha256"]), ("summary", ai.sha256_text(r["user_text"])))
            rec["summary_responses"] = {x["sha256"]: summary_answer(x["user_text"]) for x in d1["summary_requests"]}
            rec["summary"] = {"provider": "claude-recorded", "model": "claude-test", "made_at": NOW - 10, "note_ja": "試験の要約"}
            (td / "rec.json").write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(main(["--responses", str(td / "rec.json")]), 0)
            latest = json.loads((td / "latest.json").read_text(encoding="utf-8"))
            stats = json.loads((td / "stats.json").read_text(encoding="utf-8"))
            cache = json.loads((td / "summary_cache.json").read_text(encoding="utf-8"))
            n = sum(len(r["eids"]) for r in d1["summary_requests"] and [{"eids": {e["eid"]: 1 for e in doc_of(x["user_text"])["events"]}}
                                                                        for x in d1["summary_requests"]])
            self.assertEqual(stats["ai"]["summarized"], n)
            self.assertEqual((stats["ai"]["summary"]["provider"], stats["ai"]["summary"]["status"]), ("claude-recorded", "recorded"))
            self.assertEqual({s["summary"]["provider"] for s in latest["stories"] if "summary" in s}, {"claude-recorded"})
            self.assertEqual({s["summary"]["made_at"] for s in latest["stories"] if "summary" in s}, {NOW - 10})
            self.assertEqual(cache["active"], "claude-recorded")
            self.assertEqual(len(cache["partitions"]["claude-recorded"]), n)
            self.assertEqual(main(["--no-ai"]), 0)                       # --no-ai も控えを書き換えない
            self.assertEqual(json.loads((td / "summary_cache.json").read_text(encoding="utf-8")), cache)


class OutletNames(unittest.TestCase):
    """CONTRACT §7: 公開版では、出来事全体の文に no / nc の媒体名を挙げさせない。local 版は今のまま。"""

    NAMED = "NHK は巡航ミサイルと種類を示し、他は数発のミサイルとする"
    PLAIN = "種類まで示す見出しと、数だけの見出しがある"

    def test_the_matcher(self):
        n = build.names_withheld_outlet
        for t in ("NHKは巡航ミサイルと示し", "ＮＨＫが先に伝えた", "朝日新聞は数発とする", "毎日新聞の見出しは", "Bloomberg highlights the rate",
                  "bloomberg は", "ブルームバーグは数字を先に出す", "朝日の報道では数発", "朝日は数発とする", "日経が伝えた", "AFPBB の記事では"):
            self.assertTrue(n(t), t)
        for t in (self.PLAIN, "毎日のように更新される", "朝日が昇る時刻", "日銀が政策金利を据え置いた", "厚生労働省が新しい指針を公表した", "", None):
            self.assertFalse(n(t), t)
        self.assertTrue(n("日銀によると据え置き"))                          # 政府一次は報道の枠のとき
        self.assertTrue(n("厚生労働省の発表によると"))
        with mock.patch.object(build, "NAMED_GOV_ALWAYS", True):          # 厳格にすれば、出来事の主体として書いても落とす
            self.assertTrue(n("日銀が政策金利を据え置いた"))
            self.assertTrue(n("厚労省が指針を公表した"))
            self.assertFalse(n(self.PLAIN))

    def contrast_fake(self, text):
        def edit(ans, doc):
            for b in ans["blocks"]:
                for st in b["stories"]:
                    st["contrast_ja"] = text
                    st["flags"], st["flag_note_ja"] = [], "朝日新聞は一社だけが伝えた"
        return fake(edit)

    def test_public_drops_the_sentence_and_counts_it(self):
        sp = sfake(lambda rows, doc: [r.update(summary_ja="Bloomberg は数字を先に出す") for r in rows[:1]])
        pub, _ = run_build(self.contrast_fake(self.NAMED), sp, build.empty_cache(), public=True)
        loc, _ = run_build(self.contrast_fake(self.NAMED), sfake(), build.empty_cache(), public=False)
        self.assertEqual(build.count_named_outlets(pub["stories"]), 0)           # 公開版の contrast_ja・要約に媒体名 0 件
        self.assertGreaterEqual(pub["ai_run"]["named_outlets"], 1)
        self.assertEqual(pub["ai_run"]["summary"]["named_outlets"], 1)
        self.assertEqual(build.make_stats(pub, load_items()["items"], NOW, 36)["ai"]["merge"]["named_outlets"],
                         pub["ai_run"]["named_outlets"])
        ai_pub = [s["ai"] for s in pub["stories"] if s["ai"]]
        self.assertTrue(ai_pub and all(a["contrast_ja"] == "" and a["flag_note_ja"] == "" for a in ai_pub))
        ai_loc = [s["ai"] for s in loc["stories"] if s["ai"]]
        self.assertTrue(all(a["contrast_ja"] == self.NAMED for a in ai_loc))      # local 版は今のまま
        self.assertEqual(loc["ai_run"]["named_outlets"], 0)
        self.assertEqual(build.check_output(pub), [])
        self.assertNotIn("NHK は巡航", json.dumps(pub, ensure_ascii=False))

    def test_a_sentence_without_a_name_is_kept_and_a_named_summary_is_not_cached(self):
        pub, _ = run_build(self.contrast_fake(self.PLAIN), sfake(), build.empty_cache(), public=True)
        for s in (x for x in pub["stories"] if x["ai"]):               # 名の無い文は名の照合では落とさない。no / nc を含む出来事だけ、構成で空（§7）
            self.assertEqual(s["ai"]["contrast_ja"], "" if build._has_withheld_member(s, pub["items"]) else self.PLAIN)
        self.assertEqual(pub["ai_run"]["named_outlets"], 0)
        cache = build.empty_cache()
        stories, items = synth(3)
        sp = sfake(lambda rows, doc: [r.update(summary_ja="朝日新聞は数発とする") for r in rows[:1]])
        run, _ = build.summary_stage(stories, items, NOW, PROMPT, sp, "off", cache, reject=build.names_withheld_outlet)
        self.assertEqual((run["named_outlets"], run["summarized"]), (1, 2))
        self.assertEqual(len(cache["partitions"]["fake"]), 2)                    # 媒体名を挙げた文は控えにも入らない
        cache["partitions"]["fake"][build.members_digest(["i0000"])] = {          # 古い控えにあった物は、使う時に落とす
            "text_ja": "毎日新聞の見出しは数だけ", "made_at": NOW, "model": "fake", "prompt_version": PROMPT["version"], "sid": "s0000"}
        fresh = [{k: v for k, v in x.items() if k != "summary"} for x in synth(3)[0]]
        run, _ = build.summary_stage(fresh, items, NOW, PROMPT, None, "nokey", cache, reject=build.names_withheld_outlet)
        self.assertEqual(run["named_outlets"], 1)
        self.assertNotIn("summary", fresh[0])

    def test_the_kept_snapshot_is_cleaned_and_a_leak_is_refused(self):
        old, _ = run_build(self.contrast_fake(self.NAMED), sfake(), build.empty_cache(), public=False)
        d, _ = run_build(None, None, build.empty_cache(), public=True, now=NOW + 60, previous=copy.deepcopy(old),
                         status="nokey", sstatus="nokey")
        self.assertEqual(d["ai_run"]["status"], "kept_previous")
        self.assertEqual(build.count_named_outlets(d["ai_snapshot"]["stories"]), 0)
        self.assertEqual(build.check_output(d), [])
        pub, _ = run_build(self.contrast_fake(self.PLAIN), sfake(), build.empty_cache(), public=True)
        bad = copy.deepcopy(pub)
        next(s for s in bad["stories"] if s["ai"])["ai"]["contrast_ja"] = self.NAMED
        self.assertTrue(any("names a withheld outlet" in p for p in build.check_output(bad)))
        loc = copy.deepcopy(bad)
        loc["edition"] = "local"                                               # local 版は対象外
        self.assertFalse(any("names a withheld outlet" in p for p in build.check_output(loc)))

    def test_the_prompts_tell_the_model_not_to_name_outlets(self):
        self.assertIn("without naming any outlet", PROMPT["system"])
        self.assertIn("Never name an outlet", PROMPT["summary"]["system"])
        self.assertEqual(PROMPT["version"], "parallax-prompt/5")

    def test_recorded_answers_of_an_older_prompt_lose_only_the_named_sentences(self):
        d, _ = run_build(None, None, build.empty_cache(), public=True, status="off", sstatus="off",
                         prompt=build.load_prompt(rights="quote"))      # synthetic fixture (CONTRACT 20.1)
        self.assertEqual((d["edition"], d["rights_mode"]), ("public", "quote"))       # 既定は quote: 全部の源の見出しと焦点が戻っている
        self.assertEqual(sum(1 for it in d["items"].values() if it["title"] is None), 0)
        self.assertEqual(build.check_output(d), [])
        self.assertEqual(build.silence_text_count(d["stories"], PROMPT), 0)


if __name__ == "__main__":
    unittest.main()
