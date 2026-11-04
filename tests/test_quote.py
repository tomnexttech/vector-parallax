# -*- coding: utf-8 -*-
"""quote（既定）の動き、札の名・母数、国内外の数、検索の範囲、地名の表、塊の選び方、1 媒体の出来事に要約を付けない守り、画像（RSS・og:image）。
合成の fixture と偽の provider・偽の getter だけ。網には出ない。"""
import copy
import json
import unittest
from pathlib import Path

from helpers import NOW, ROOT, build, fake, load_items, load_prompt, validate
from test_leakguard import PARAPHRASE, contrast_fake
from test_summary import PROMPT_ON, run_build, sfake, synth
from parallax import cluster, og, sources

QUOTE = build.load_prompt(rights="quote")
QUOTE["summary"]["enabled"] = True
LABELS = json.loads((ROOT / "data" / "labels.json").read_text(encoding="utf-8"))


class QuoteDefault(unittest.TestCase):
    def setUp(self):
        build.set_rights("quote")
        self.addCleanup(build.set_rights, "strict")

    def test_the_committed_default_is_quote(self):
        self.assertEqual(json.loads((ROOT / "data" / "prompt.json").read_text(encoding="utf-8"))["rights_mode"], "quote")
        self.assertEqual(build.load_prompt()["rights_mode"], "quote")
        self.assertEqual(build.load_prompt(rights="strict")["rights_mode"], "strict")
        self.assertIn("strict_addendum", build.load_prompt())

    def test_public_shows_every_title_focus_and_contrast_and_asks_the_visitors_key_for_every_block(self):
        pub, full = run_build(contrast_fake(PARAPHRASE), sfake(), build.empty_cache(), public=True, prompt=QUOTE)
        self.assertEqual(pub["rights_mode"], "quote")
        self.assertTrue(all(it["title"] for it in pub["items"].values()))
        withheld = [s for s in pub["stories"] if s["ai"] and build._has_withheld_member(s, pub["items"])]
        self.assertEqual(build._event_text_stories(pub["stories"], pub["items"]), [])      # quote では「外す対象」が無い（構成で落とす処理は strict だけ）
        ai = [s["ai"] for s in pub["stories"] if s["ai"]]
        self.assertTrue(ai and all(a["contrast_ja"] == PARAPHRASE for a in ai))
        no_nc = [a for s in pub["stories"] if s["ai"] for a in s["ai"]["angles"]
                 if build.terms_status(pub["items"][a["item_id"]]) in ("no", "nc")]
        self.assertGreater(len(no_nc), 0)                                  # no / nc の源の焦点が戻る
        self.assertEqual([r["bids"] for r in pub["ai_requests"]], [r["bids"] for r in full])      # BYOK の要求は全部の塊
        self.assertEqual(build.check_output(pub), [])
        self.assertEqual(pub["ai_run"]["withheld_text"], {"contrast_ja": 0, "flag_note_ja": 0})
        self.assertEqual(pub["ai_run"]["named_outlets"], 0)

    def test_named_outlets_are_not_dropped_in_quote_but_are_in_strict(self):
        named = "NHK は巡航ミサイルと種類を示し、他は数発とする"
        pub, _ = run_build(contrast_fake(named, note=""), sfake(), build.empty_cache(), public=True, prompt=QUOTE)
        self.assertTrue(all(s["ai"]["contrast_ja"] == named for s in pub["stories"] if s["ai"]))
        self.assertEqual(build.check_output(pub), [])
        strict_pub, _ = run_build(contrast_fake(named, note=""), sfake(), build.empty_cache(), public=True, prompt=PROMPT_ON)
        self.assertEqual(strict_pub["rights_mode"], "strict")
        self.assertTrue(all(s["ai"]["contrast_ja"] == "" for s in strict_pub["stories"] if s["ai"]))
        self.assertTrue(any(it["title"] is None for it in strict_pub["items"].values()))

    def test_the_reporting_word_check_is_strict_only_and_the_silence_check_is_always_on(self):
        q, st = build.load_prompt(rights="quote"), build.load_prompt(rights="strict")
        self.assertFalse(validate.report_hit("決定が報道された", q))
        self.assertTrue(validate.report_hit("決定が報道された", st))
        for p in (q, st):
            for t in ("NHK は報じなかった", "この件は報じていない", "The paper did not report it", "Failed to report the plan"):
                self.assertTrue(validate.silence_hit(t, p), t)
            for t in ("取得した国内の主要 11 配信に見当たらない", "海外の源だけ", "官公庁の資料だけ", "A silenced speech"):
                self.assertFalse(validate.silence_hit(t, p), t)

    def test_silence_words_in_ai_text_are_dropped_in_quote_too(self):
        pub, _ = run_build(contrast_fake("海外の媒体が報じなかった点", note="報道していない"), sfake(), build.empty_cache(), public=True, prompt=QUOTE)
        self.assertGreater(pub["ai_run"]["silence_words"], 0)
        self.assertTrue(all(s["ai"]["contrast_ja"] == "" and s["ai"]["flag_note_ja"] == "" for s in pub["stories"] if s["ai"]))
        bad = copy.deepcopy(pub)
        next(s for s in bad["stories"] if s["ai"])["ai"]["contrast_ja"] = "ある媒体は報じなかった"
        self.assertTrue(any("did not report" in p for p in build.check_output(bad)))


class Labels(unittest.TestCase):
    def test_flag_labels_cover_the_prompt_and_say_it_in_japanese_first(self):
        prompt = json.loads((ROOT / "data" / "prompt.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(LABELS["flags"]), sorted(prompt["flags"]))
        self.assertEqual(LABELS["flags"]["overseas_only"]["ja"], "海外の源だけ")
        self.assertEqual(LABELS["flags"]["primary_only"]["ja"], "官公庁の資料だけ")
        self.assertEqual(LABELS["flags"]["jp_main_not_found"]["ja"], "取得した国内の主要 {n} 配信に見当たらない")
        self.assertEqual(LABELS["flags"]["jp_main_not_found"]["n_from"], "scope.jp_main.fetched")
        self.assertEqual(LABELS["note_ja"], "真偽は判定していない")
        for f in LABELS["flags"].values():
            for k in ("ja", "en", "tip_ja"):
                self.assertTrue(f[k])
                self.assertFalse(validate.silence_hit(f[k], prompt), f[k])
                self.assertNotIn("SILENT", f[k].upper())

    def test_the_old_names_are_gone_from_every_output(self):
        old = "mainstream_" + "silent"
        for rel in ("data/prompt.json", "data/labels.json", "data/recorded.json", "data/latest.json", "data/stats.json",
                    "parallax/validate.py", "parallax/build.py", "js/validate.js", "js/rerun.js"):
            if (ROOT / rel).exists():                       # build products are not tracked (CONTRACT 20.1): check them when present
                self.assertNotIn(old, (ROOT / rel).read_text(encoding="utf-8"), rel)
        schema_flags = json.dumps(json.loads((ROOT / "data" / "prompt.json").read_text(encoding="utf-8"))["schema"])
        self.assertIn("jp_main_not_found", schema_flags)
        self.assertNotIn("報じなかった", json.dumps(LABELS, ensure_ascii=False))

    def test_places_have_a_japanese_name(self):
        for code in cluster._GEO:
            self.assertTrue(LABELS["places_ja"].get(code), code)
        self.assertEqual(LABELS["places_ja"]["NK"], "北朝鮮")
        self.assertEqual(LABELS["places_ja"]["CN"], "中国")
        self.assertEqual(LABELS["places_ja"]["US"], "米国")


class ScopeAndCrossHome(unittest.TestCase):
    def test_scope_counts_feeds_and_the_jp_main_base(self):
        d, _ = run_build(None, None, build.empty_cache(), public=False, status="off", sstatus="off", prompt=PROMPT_ON)
        sc, rows = d["scope"], d["sources"]
        self.assertEqual(sc["feeds"], {"total": len(rows), "fetched": sum(r["ok"] for r in rows), "failed": sum(not r["ok"] for r in rows)})
        jp = [r for r in rows if r["home"] == "jp" and r["type"] in sources.MAINSTREAM_TYPES]
        self.assertEqual(sc["jp_main"], {"total": len(jp), "fetched": sum(r["ok"] for r in jp)})
        self.assertEqual(sc["window"], {"hours": 36, "from": NOW - 36 * 3600, "to": NOW})
        ok_old = [r["oldest_ts"] for r in rows if r["ok"] and r["oldest_ts"] is not None]
        self.assertEqual(sc["oldest_ts"], min(ok_old))
        for r in rows:                                                      # 各配信の最古の時刻 <= 最新の時刻
            if r["oldest_ts"] is not None and r["newest_ts"] is not None:
                self.assertLessEqual(r["oldest_ts"], r["newest_ts"])

    def test_cross_home_counts_rules_and_ai_both(self):
        both = lambda xs: sum(1 for x in xs if "jp" in x["homes"] and "intl" in x["homes"])
        d, _ = run_build(fake(), None, build.empty_cache(), public=False, prompt=PROMPT_ON)
        self.assertEqual(d["cross_home"], {"rules": both(d["rule_clusters"]), "ai": both(d["stories"]), "of": "build"})
        off, _ = run_build(None, None, build.empty_cache(), public=False, status="off", sstatus="off", prompt=PROMPT_ON)
        self.assertEqual(off["cross_home"], {"rules": both(off["rule_clusters"]), "ai": None, "of": None})
        kept, _ = run_build(None, None, build.empty_cache(), public=False, now=NOW + 60, previous=copy.deepcopy(d), status="nokey",
                            sstatus="nokey", prompt=PROMPT_ON)
        sn = kept["ai_snapshot"]
        self.assertEqual(kept["cross_home"], {"rules": both(sn["rule_clusters"]), "ai": both(sn["stories"]), "of": "snapshot"})
        st = build.make_stats(d, load_items()["items"], NOW, 36)
        self.assertEqual(st["cross_home"], d["cross_home"])
        self.assertEqual(st["scope"], d["scope"])

    def test_an_ai_merge_moves_the_cross_home_count(self):
        ids = {"a": ("jp", "ja"), "b": ("intl", "en"), "c": ("jp", "ja"), "d": ("intl", "en")}
        rcs = [{"cid": "c1", "homes": ["jp"]}, {"cid": "c2", "homes": ["intl"]}, {"cid": "c3", "homes": ["intl", "jp"]}]
        data = {"rule_clusters": rcs, "ai_run": {"status": "recorded"},
                "stories": [{"homes": ["intl", "jp"]}, {"homes": ["intl", "jp"]}, {"homes": ["jp"]}]}
        self.assertEqual(build.make_cross_home(data), {"rules": 1, "ai": 2, "of": "build"})


class ChoosingBlocks(unittest.TestCase):
    def test_loose_pairs_come_first_and_the_old_top_follows(self):
        def item(i, outlet, home, ts):
            return {"id": i, "outlet": outlet, "home": home, "ts": ts, "title": "試験 %s" % i, "type": "全国紙" if home == "jp" else "海外主流"}
        items = {i["id"]: i for i in (item("j1", "A", "jp", 10), item("e1", "B", "intl", 11), item("j2", "C", "jp", 12),
                                      item("e2", "D", "intl", 13), item("j3", "E", "jp", 14), item("m1", "F", "jp", 15), item("m2", "G", "intl", 16))}
        rcs = [{"cid": "cp", "member_ids": ["j1"], "homes": ["jp"], "n_outlets": 1, "last_ts": 10},
               {"cid": "cq", "member_ids": ["e1"], "homes": ["intl"], "n_outlets": 1, "last_ts": 11},
               {"cid": "cr", "member_ids": ["j2"], "homes": ["jp"], "n_outlets": 1, "last_ts": 12},
               {"cid": "cs", "member_ids": ["e2"], "homes": ["intl"], "n_outlets": 1, "last_ts": 13},
               {"cid": "ct", "member_ids": ["j3"], "homes": ["jp"], "n_outlets": 1, "last_ts": 14},
               {"cid": "cm", "member_ids": ["m1", "m2"], "homes": ["intl", "jp"], "n_outlets": 2, "last_ts": 16}]
        blocks = [["cp", "cq"], ["cr", "cs"], ["ct"], ["cm"]]
        picks = build.pick_blocks(blocks, rcs, items)
        self.assertEqual([(p["why"], p["cids"]) for p in picks[:2]], [("loose_pair", ["cr", "cs"]), ("loose_pair", ["cp", "cq"])])   # 新しい組が先
        self.assertEqual([p["why"] for p in picks[2:]], ["top"])
        self.assertEqual(picks[2]["cids"], ["cm"])                         # 混じった束は「規則で既に結ばれている」ので先頭には来ない
        self.assertNotIn(["ct"], [p["cids"] for p in picks])

    def test_the_call_limit_is_still_two(self):
        self.assertEqual(build.MERGE_CALL_LIMIT, 2)
        self.assertEqual(build.MAX_CALLS, 2)


class SingleOutletSummary(unittest.TestCase):
    def test_no_summary_for_an_event_with_one_outlet(self):
        stories, items = synth(4)
        stories[0]["n_outlets"] = 1
        stories[1]["n_outlets"] = 1
        run, reqs = build.summary_stage(stories, items, NOW, PROMPT_ON, sfake(), "off", build.empty_cache())
        self.assertEqual((run["targets"], run["summarized"]), (2, 2))
        self.assertNotIn("summary", stories[0])
        self.assertNotIn("summary", stories[1])
        self.assertIn("summary", stories[2])
        bad = {"schema": build.SCHEMA, "edition": "local", "rights_mode": "quote", "items": {}, "rule_clusters": [],
               "stories": [{"sid": "s", "n_outlets": 1, "member_ids": [], "ai": None,
                            "summary": {"text_ja": "x", "made_at": NOW, "provider": "p", "model": "m"}}]}
        self.assertIn("a summary sits on an event with a single outlet", build.summary_problems(bad["stories"]))


class Images(unittest.TestCase):
    HTML = ('<html><head><meta charset="utf-8"><meta property="og:title" content="t">'
            "<meta content='/img/a&amp;b.jpg' property='og:image'></head><body></body></html>")

    def test_find_og_image(self):
        self.assertEqual(og.find_og_image(self.HTML, "https://news.example.org/a/1"), "https://news.example.org/img/a&b.jpg")
        self.assertEqual(og.find_og_image('<meta name="twitter:image" content="https://cdn.example.org/x.jpg">', "https://e.org/"),
                         "https://cdn.example.org/x.jpg")
        self.assertEqual(og.find_og_image("<meta property='og:image' content='data:image/png;base64,AAAA'>", "https://e.org/"), "")
        self.assertEqual(og.find_og_image("", "https://e.org/"), "")
        self.assertEqual(og.find_og_image("<html></html>", "https://e.org/"), "")

    def stories_items(self, n):
        items = {"i%d" % k: {"id": "i%d" % k, "link": "https://h%d.example.org/a/%d" % (k % 2, k), "image": None,
                             "outlet": "O%d" % k, "type": "全国紙", "title": "試験 出来事%d" % k} for k in range(n)}
        for k in range(n):                                  # a second outlet without a link: an event must have two outlets to be given a photo (CONTRACT 20.5)
            items["p%d" % k] = {"id": "p%d" % k, "link": "", "image": None, "outlet": "P%d" % k, "type": "民放", "title": "試験 出来事%d" % k}
        return [{"member_ids": ["i%d" % k, "p%d" % k]} for k in range(n)], items

    def test_fill_caps_spaces_requests_per_host_and_leaves_failures_null(self):
        stories, items = self.stories_items(6)
        items["i0"]["image"] = {"url": "https://x.example.org/rss.jpg", "from": "rss"}      # RSS の画像がある出来事は読まない
        asked, sleeps, clock = [], [], [0.0]

        def getter(url):
            asked.append(url)
            if url.endswith("/3"):
                raise OSError("boom")
            return '<meta property="og:image" content="https://img.example.org/%s.jpg">' % url.rsplit("/", 1)[1]
        out = og.fill(stories, items, getter=getter, max_fetch=4, gap_s=1.0, sleep=lambda s: (sleeps.append(s), clock.__setitem__(0, clock[0] + s)),
                      clock=lambda: clock[0])
        self.assertEqual(len(asked), 4)                                         # 上限
        self.assertNotIn("https://h0.example.org/a/0", asked)
        self.assertEqual({k: out[k] for k in ("stories", "tried", "found", "failed", "capped")}, {"stories": 5, "tried": 4, "found": 3, "failed": 1, "capped": 1})
        self.assertEqual(items["i1"]["image"], {"url": "https://img.example.org/1.jpg", "from": "og"})
        self.assertIsNone(items["i3"]["image"])                                 # 失敗は null
        self.assertIsNone(items["i5"]["image"])
        self.assertTrue(sleeps and all(abs(x - 1.0) < 1e-9 for x in sleeps))     # 同じ host へは 1 秒の間
        self.assertEqual(items["i0"]["image"]["from"], "rss")

    def test_fill_looks_at_the_first_stories_only_and_a_few_members_each(self):
        stories, items = self.stories_items(5)
        got = []
        og.fill(stories, items, getter=lambda u: (got.append(u), "")[1], max_stories=2, per_story=3, gap_s=0, sleep=lambda s: None)
        self.assertEqual(len(got), 2)
        stories2 = [{"member_ids": list(items)}]
        got.clear()
        og.fill(stories2, items, getter=lambda u: (got.append(u), "")[1], per_story=3, gap_s=0, sleep=lambda s: None)
        self.assertEqual(len(got), 3)

    def test_rss_image_reaches_the_item_and_a_malformed_image_is_refused(self):
        src = dict(sources.SOURCES[0])
        a = sources._finish({"title": "試験 出来事A", "link": "https://t.example.org/a", "ts": NOW, "image": "https://img.example.org/a.jpg"}, src)
        b = sources._finish({"title": "試験 出来事B", "link": "https://t.example.org/b", "ts": NOW, "image": ""}, src)
        self.assertEqual(a["image"], {"url": "https://img.example.org/a.jpg", "from": "rss"})
        self.assertIsNone(b["image"])
        snap = load_items()
        its = copy.deepcopy(snap["items"])
        its[0]["image"] = {"url": "https://img.example.org/x.jpg", "from": "rss"}
        d = build.build(its, snap["sources"], NOW, 36, None, "off", PROMPT_ON, True)[0]
        self.assertEqual(d["items"][its[0]["id"]]["image"], {"url": "https://img.example.org/x.jpg", "from": "rss"}) if its[0]["id"] in d["items"] else None
        self.assertEqual(d["images"]["items"], len(d["items"]))
        self.assertEqual(d["images"]["rss"] + d["images"]["og"] + d["images"]["none"], len(d["items"]))
        bad = copy.deepcopy(d)
        next(iter(bad["items"].values()))["image"] = {"url": "javascript:alert(1)", "from": "rss"}
        self.assertIn("an item has a malformed image", build.check_output(bad))

    def test_build_runs_the_og_stage_on_the_first_stories(self):
        calls = []
        d = build.build(load_items()["items"], load_items()["sources"], NOW, 36, None, "off", PROMPT_ON, False, og=lambda stories, items: (calls.append(len(stories)), {"tried": 0})[1])[0]
        self.assertEqual(calls, [len(d["stories"])])
        self.assertEqual(d["images"]["og_run"], {"tried": 0})


if __name__ == "__main__":
    unittest.main()
