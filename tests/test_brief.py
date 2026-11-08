# -*- coding: utf-8 -*-
"""詳しい要約 brief（CONTRACT §13.1）の試験。偽の provider と合成の fixture だけ。網には出ない。
新しい欄がある時・無い時（古い形の答え）・AI が失敗した時・AI が材料に無い事を書いた時を確かめる。"""
import copy
import json
import unittest
from pathlib import Path

from helpers import NOW, ai, build, doc_of, fake, load_prompt, validate
import test_summary as ts

PROMPT = load_prompt()
setUpModule = ts.setUpModule
tearDownModule = ts.tearDownModule

DOC = {"events": [{"eid": "e1", "items": [
    {"outlet": "甲新聞", "lang": "ja", "title": "港で貨物船が座礁した", "side": "国内", "at": "2026-11-08 03:05",
     "desc": "8日未明、沿岸の港で貨物船が座礁し、乗組員12人が救助された。"},
    {"outlet": "Harbour Times", "lang": "en", "title": "Cargo ship runs aground at port", "side": "海外", "at": "2026-11-08 04:10"}]}]}
REQ = {"doc": json.dumps(DOC, ensure_ascii=False), "eids": {"e1": "sA"}}


def answer(**brief):
    b = {"what_ja": "貨物船が港で座礁し、12人が助け出された。", "background_ja": "伝えられていない",
         "views_ja": "国内は救助の人数を、海外は座礁の場所を先に伝えている。", "next_ja": "伝えられていない"}
    b.update(brief)
    return json.dumps({"summaries": [{"eid": "e1", "summary_ja": "港で船が座礁した", "brief": b}]}, ensure_ascii=False)


class Validator(unittest.TestCase):
    def test_a_good_brief_is_kept_field_by_field(self):
        out = validate.validate_summaries(REQ, answer(), PROMPT)
        b = out["briefs"]["sA"]
        self.assertEqual(b["background_ja"], "伝えられていない")
        self.assertTrue(b["what_ja"].startswith("貨物船が港で"))
        self.assertEqual(out["counts"]["brief_fields_dropped"], 0)

    def test_an_old_answer_without_brief_still_gives_the_summary(self):
        raw = json.dumps({"summaries": [{"eid": "e1", "summary_ja": "港で船が座礁した"}]}, ensure_ascii=False)
        out = validate.validate_summaries(REQ, raw, PROMPT)
        self.assertEqual((out["summaries"], out["briefs"], out["errors"]), ({"sA": "港で船が座礁した"}, {}, []))

    def test_a_number_that_is_not_in_the_material_is_dropped(self):
        out = validate.validate_summaries(REQ, answer(what_ja="貨物船が港で座礁し、30人が助け出された。"), PROMPT)
        self.assertEqual(out["briefs"], {})                       # what_ja が残らなければ brief は付かない
        self.assertEqual((out["counts"]["ungrounded"], out["counts"]["brief_fields_dropped"]), (1, 1))
        out = validate.validate_summaries(REQ, answer(views_ja="国内は27人の救助を先に伝えている。"), PROMPT)
        self.assertEqual(out["briefs"]["sA"]["views_ja"], "")      # 材料に無い数の欄だけが落ちる
        self.assertTrue(out["briefs"]["sA"]["what_ja"])

    def test_a_name_that_is_not_in_the_material_is_dropped(self):
        for text in ("沿岸の港で貨物船が座礁した。船長はジョンソン氏。", "沿岸の港で貨物船が座礁した。NATO が声明を出した。"):
            out = validate.validate_summaries(REQ, answer(what_ja=text), PROMPT)
            self.assertEqual(out["briefs"], {}, text)

    def test_the_counts_of_the_material_may_be_written(self):
        out = validate.validate_summaries(REQ, answer(views_ja="国内と海外の2件で、救助の人数と場所の伝え方が分かれる。"), PROMPT)
        self.assertNotEqual(out["briefs"]["sA"]["views_ja"], "")

    def test_a_field_that_copies_a_description_or_names_an_outlet_is_dropped(self):
        copy_desc = "8日未明、沿岸の港で貨物船が座礁し、乗組員12人が救助された。"
        out = validate.validate_summaries(REQ, answer(background_ja=copy_desc), PROMPT)
        self.assertEqual(out["briefs"]["sA"]["background_ja"], "")
        out = validate.validate_summaries(REQ, answer(views_ja="甲新聞は救助の人数を先に伝えている。"), PROMPT)
        self.assertEqual((out["briefs"]["sA"]["views_ja"], out["counts"]["named_outlets"]), ("", 1))

    def test_the_silence_words_are_refused(self):
        out = validate.validate_summaries(REQ, answer(views_ja="海外は救助の人数を報じていない。"), PROMPT)
        self.assertEqual(out["briefs"]["sA"]["views_ja"], "")

    def test_what_ja_cannot_be_the_unknown_phrase(self):
        out = validate.validate_summaries(REQ, answer(what_ja="伝えられていない"), PROMPT)
        self.assertEqual(out["briefs"], {})


def brief_answer(user_text, edit=None):
    doc = doc_of(user_text)
    rows = []
    for ev in doc["events"]:
        t = ev["items"][0]["title"]
        rows.append({"eid": ev["eid"], "summary_ja": "試験の一行 %s" % ev["eid"],
                     "brief": {"what_ja": "試験の詳しい要約", "background_ja": "伝えられていない",
                               "views_ja": "", "next_ja": "伝えられていない"}})
    if edit:
        edit(rows, doc)
    return json.dumps({"summaries": rows}, ensure_ascii=False)


def bfake(edit=None, name="gemini", model="gemini-brief-test"):
    p = ai.FakeProvider(lambda system, user_text, schema: brief_answer(user_text, edit))
    p.name, p.model = name, model
    return p


class Stage(unittest.TestCase):
    def test_every_multi_outlet_event_gets_a_brief_and_only_headlineless_ones_a_summary(self):
        d, _ = ts.run_build(fake(), bfake(), build.empty_cache())
        multi = [s for s in d["stories"] if s["n_outlets"] >= 2]
        self.assertGreater(len(multi), 0)
        self.assertTrue(all("brief" in s for s in multi))
        self.assertFalse(any("brief" in s for s in d["stories"] if s["n_outlets"] < 2))
        self.assertFalse(any("summary" in s and s.get("ai") for s in d["stories"]))
        self.assertTrue(any(s.get("ai") and "brief" in s for s in d["stories"]), "an event with an AI headline also gets a brief")
        b = multi[0]["brief"]
        self.assertEqual((b["provider"], b["model"], b["made_at"]), ("gemini", "gemini-brief-test", NOW))
        self.assertEqual(build.check_output(d), [])
        self.assertEqual(d["ai_run"]["summary"]["briefed"], len(multi))

    def test_the_request_carries_side_time_and_the_feed_description_but_no_body(self):
        sp = bfake()
        ts.run_build(fake(), sp, build.empty_cache())
        events = [e for c in sp.calls for e in doc_of(c["user_text"])["events"]]
        items = [i for e in events for i in e["items"]]
        self.assertTrue(all(i.get("side") in ("国内", "海外", "官公庁") and "at" in i for i in items))
        self.assertTrue(all(set(i) <= {"outlet", "lang", "title", "side", "at", "desc"} for i in items))
        was = build.RIGHTS["mode"]
        build.set_rights("quote")
        self.addCleanup(build.set_rights, was)
        row = build._summary_item({"outlet": "甲", "lang": "ja", "title": "題", "type": "全国紙", "home": "jp", "ts": 1794000000, "desc": "配信の説明です。本文ではない。", "body": "記事の本文"})
        self.assertEqual((row["side"], row["at"], row["desc"]), ("国内", "2026-11-07 06:20", "配信の説明です。本文ではない。"))
        self.assertNotIn("body", row)
        self.assertEqual(build._summary_item({"outlet": "乙", "lang": "en", "title": "t", "type": "政府一次", "home": "intl", "ts": 1794000000})["side"], "官公庁")

    def test_a_cached_brief_is_not_asked_again_but_an_old_entry_without_one_is(self):
        cache = build.empty_cache()
        d1, _ = ts.run_build(fake(), bfake(), cache)
        n = sum(1 for s in d1["stories"] if "brief" in s)
        sp = bfake()
        d2, _ = ts.run_build(fake(), sp, cache, now=NOW + 60)
        self.assertEqual(sp.calls, [])
        self.assertEqual(sum(1 for s in d2["stories"] if "brief" in s), n)
        self.assertEqual({s["brief"]["made_at"] for s in d2["stories"] if "brief" in s}, {NOW})
        old = copy.deepcopy(cache)
        for rows in old["partitions"].values():
            for e in rows.values():
                e.pop("brief_v", None)
                e.pop("brief", None)
        sp3 = bfake()
        d3, _ = ts.run_build(fake(), sp3, old, now=NOW + 120)
        self.assertGreater(len(sp3.calls), 0)
        self.assertEqual(sum(1 for s in d3["stories"] if "brief" in s), n)

    def test_an_old_form_answer_leaves_the_page_as_it_was(self):
        d, _ = ts.run_build(fake(), ts.sfake(name="gemini", model="m"), build.empty_cache())
        self.assertFalse(any("brief" in s for s in d["stories"]))
        self.assertTrue(any("summary" in s for s in d["stories"]))
        self.assertEqual(build.check_output(d), [])

    def test_when_the_ai_fails_there_is_no_brief_and_the_build_is_still_valid(self):
        bad = ai.FakeProvider(lambda *a: None)
        bad.name, bad.model = "gemini", "m"
        d, _ = ts.run_build(fake(), bad, build.empty_cache())
        self.assertFalse(any("brief" in s or "summary" in s for s in d["stories"]))
        self.assertEqual(build.check_output(d), [])

    def test_a_brief_the_ai_made_up_is_not_published(self):
        def edit(rows, doc):
            for r in rows:
                r["brief"]["what_ja"] = "架空の9999人が集まった。"
        d, _ = ts.run_build(fake(), bfake(edit), build.empty_cache())
        self.assertFalse(any("brief" in s for s in d["stories"]))
        self.assertGreater(d["ai_run"]["summary"]["ungrounded"], 0)
        self.assertEqual(build.check_output(d), [])

    def test_check_output_refuses_a_broken_brief(self):
        d, _ = ts.run_build(fake(), bfake(), build.empty_cache())
        bad = copy.deepcopy(d)
        next(s for s in bad["stories"] if "brief" in s)["brief"]["what_ja"] = ""
        self.assertTrue(any("brief has the wrong shape" in p for p in build.check_output(bad)))
        bad = copy.deepcopy(d)
        single = next(s for s in bad["stories"] if s["n_outlets"] < 2)
        single["brief"] = copy.deepcopy(next(s for s in bad["stories"] if "brief" in s)["brief"])
        self.assertTrue(any("single outlet" in p for p in build.check_output(bad)))


class Page(unittest.TestCase):
    """固有の頁 s/<sid>.html（CONTRACT §21.1）: 詳しい要約があれば頁の中で読み切れ、無くても今までの頁が出る。"""

    def event(self, brief):
        from parallax import site
        ev = {"sid": "s0123456789ab", "title": "港で貨物船が座礁した", "title_none": False, "outlet": "甲新聞", "title_id": "x1", "cat": "国際",
              "n_items": 2, "n_outlets": 2, "sides": {"jp": 1, "intl": 1, "gov": 0}, "side_outlets": {"jp": 1, "intl": 1, "gov": 0},
              "first": {"jp": 1794000000, "intl": 1794000600, "gov": None}, "first_ts": 1794000000, "last_ts": 1794000600, "first_id": "x1", "photo": None,
              "score": 1, "brief": site._brief(brief),
              "heads": [{"id": "x1", "src": "a", "side": "jp", "outlet": "甲新聞", "type": "全国紙", "ts": 1794000000, "title": "港で貨物船が座礁した",
                         "link": "https://a.example/1", "desc": "沿岸の港で貨物船が座礁した。"},
                        {"id": "x2", "src": "b", "side": "intl", "outlet": "Harbour Times", "type": "海外主流", "ts": 1794000600, "title": "Cargo ship aground",
                         "link": "https://b.example/2"}]}
        return site, ev

    def test_the_brief_the_quotes_the_time_line_and_the_original_links_are_on_the_page(self):
        site, ev = self.event({"what_ja": "沿岸の港で貨物船が座礁した。", "background_ja": "伝えられていない", "views_ja": "", "next_ja": "伝えられていない",
                               "model": "gemini-x", "made_at": 1794003600})
        page = site.story_page(ev, "https://example.test/p/", 1794003600)
        for want in ("要点", "何が起きたか", "沿岸の港で貨物船が座礁した。", 'class="mark">AI', "gemini-x", "<q>沿岸の港で貨物船が座礁した。</q>", ">元の記事</a>", "時系列", "https://b.example/2"):
            self.assertIn(want, page)
        self.assertNotIn("伝え方の違い", page)                 # 空の欄は行ごと出さない
        self.assertNotIn("伝えられていない", page)          # a row that says "not reported" is not shown (CONTRACT 13.1, 2026-11-09)
        self.assertNotIn("<dt>経緯</dt>", page)

    def test_without_a_brief_the_page_is_the_page_it_was(self):
        site, ev = self.event(None)
        page = site.story_page(ev, "https://example.test/p/", 1794003600)
        self.assertNotIn("要点", page)
        self.assertNotIn('class="mark"', page)
        self.assertIn("国内の報道 1件", page)

    def test_events_carry_the_brief_of_their_story_and_old_data_carries_none(self):
        import test_site
        from parallax import site
        latest, board, sid = test_site.dataset()
        st = next(s for s in latest["stories"] if s["sid"] == sid)
        self.assertIsNone(site.events(latest, board)[sid]["brief"])          # data from before 13.1
        st["brief"] = {"what_ja": "港で船が座礁した。", "background_ja": "伝えられていない", "views_ja": "", "next_ja": "", "made_at": 5, "provider": "gemini", "model": "m"}
        ev = site.events(latest, board)[sid]
        self.assertEqual((ev["brief"]["what_ja"], ev["brief"]["model"]), ("港で船が座礁した。", "m"))
        self.assertIn("要点", site.story_page(ev, "https://example.test/p/", 1794003600))

    def test_a_brief_read_back_from_the_archive_is_cleaned_and_a_scrub_removes_it(self):
        site, ev = self.event({"what_ja": "x" * 900, "model": "m", "made_at": 5})
        entry = site.entry_of(ev, 1)
        clean = site._clean_entry(json.loads(json.dumps(entry)))
        self.assertEqual(len(clean["brief"]["what_ja"]), 300)
        gone = site.scrub(clean, {"items": ["x2"]})
        self.assertIsNone(gone["brief"])
        self.assertIsNone(site._clean_entry(dict(entry, brief="not a dict"))["brief"])


if __name__ == "__main__":
    unittest.main()
