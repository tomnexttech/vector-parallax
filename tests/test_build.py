# -*- coding: utf-8 -*-
"""build.py の試験。合成の fixture（tests/fixtures/items.json）と偽の provider だけで回す。網には出ない。"""
import contextlib
import copy
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from helpers import (FIX, NOW, ROOT, ai, build, check_invariants, doc_of, fake, load_items, load_prompt,
                     rules_answer, validate)
from parallax import sources

PROMPT = load_prompt()
PROMPT_ON = copy.deepcopy(PROMPT)
PROMPT_ON["summary"]["enabled"] = True


def pipeline(window_h=36):
    snap = load_items()
    pool = build.prepare_items(snap["items"], NOW, window_h)
    rc, by_id = build.make_rule_clusters(pool)
    blocks_cids = build.loose_blocks(rc, by_id)
    picks = build.pick_blocks(blocks_cids, rc, by_id)
    blocks, call_bids = build.assign_bids(picks)
    return rc, by_id, blocks, call_bids


def stories_of(data, outlets):
    return [s for s in data["stories"] if set(s["outlets"]) == set(outlets)]


class Prepare(unittest.TestCase):
    def test_window_duplicates_and_order(self):
        snap = load_items()
        pool = build.prepare_items(snap["items"], NOW, 36)
        links = [it["link"] for it in pool]
        for gone in ("/z1", "/z2", "/z3"):                       # 期間外・時刻なし・未来
            self.assertFalse(any(l.endswith(gone) for l in links), gone)
        self.assertEqual(len(pool), len({it["id"] for it in pool}))
        self.assertEqual(len(pool), 17)                          # 21 件 - 期間外・時刻なし・未来・重複 の 4 件
        order = {s["id"]: i for i, s in enumerate(sources.SOURCES)}
        idx = [order[it["source_id"]] for it in pool]
        self.assertEqual(idx, sorted(idx))
        self.assertTrue(all(isinstance(it["ts"], int) for it in pool))

    def test_first_wins_on_duplicate_id(self):
        a = {"id": "x", "title": "試験 出来事A 一つ目", "ts": NOW, "source_id": "bbc-world"}
        b = {"id": "x", "title": "試験 出来事A 二つ目", "ts": NOW, "source_id": "bbc-world"}
        self.assertEqual(build.prepare_items([a, b], NOW, 36)[0]["title"], "試験 出来事A 一つ目")

    def test_window_edges(self):
        mk = lambda i, ts: {"id": i, "title": "試験 出来事A " + i, "ts": ts, "source_id": "mof"}
        pool = build.prepare_items([mk("a", NOW - 36 * 3600), mk("b", NOW - 36 * 3600 - 1),
                                    mk("c", NOW + 3600), mk("d", NOW + 3601), mk("e", True), mk("f", "1")], NOW, 36)
        self.assertEqual([it["id"] for it in pool], ["a", "c"])

    def test_bad_rows_skipped(self):
        rows = [None, 5, {"id": "", "title": "試験 出来事A", "ts": NOW}, {"id": "q", "title": "  ", "ts": NOW},
                {"id": "r", "title": 3, "ts": NOW}]
        self.assertEqual(build.prepare_items(rows, NOW, 36), [])


class PackAndPick(unittest.TestCase):
    def test_pack_first_fit(self):
        self.assertEqual(build.pack([10, 40, 5]), ([[0, 2], [1]], []))
        self.assertEqual(build.pack([45, 1]), ([[0], [1]], []))
        self.assertEqual(build.pack([]), ([], []))

    def test_pack_caps(self):
        self.assertEqual(build.MAX_CALLS, build.MERGE_CALL_LIMIT)  # 束ね直しの呼びは 1 回の build で 2 本まで（CONTRACT §13）
        self.assertEqual(build.MERGE_CALL_LIMIT, 2)
        calls, left = build.pack([40] * 9, max_calls=8)            # pack 自体の仕組みは本数を引数で変えて確かめる
        self.assertEqual((len(calls), left), (8, [8]))
        calls, left = build.pack([40] * 3)
        self.assertEqual((len(calls), left), (2, [2]))             # 既定は 2 本
        self.assertEqual(build.pack([46]), ([], [0]))
        calls, left = build.pack([40] * 8 + [5], max_calls=8)      # 8 本が埋まっていても 5 件は先の呼びの余りに入る
        self.assertEqual((len(calls), left), (8, []))
        self.assertEqual(calls[0], [0, 8])

    def _world(self, specs):
        """specs: [(cid, [(outlet, home, type, title, ts)])] -> rc, items"""
        items, rc = {}, []
        for cid, mem in specs:
            ids = []
            for n, (outlet, home, ty, title, ts) in enumerate(mem):
                iid = "%s-%d" % (cid, n)
                items[iid] = {"id": iid, "outlet": outlet, "home": home, "type": ty, "title": title, "ts": ts,
                              "lang": "en", "source_id": "x"}
                ids.append(iid)
            rc.append({"cid": cid, "member_ids": ids})
        return rc, items

    def test_top_order_and_limit(self):
        specs = []
        for n in range(25):
            specs.append(("c%02d" % n, [("O%d" % n, "jp", "全国紙", "試験 出来事A", 1000 + n),
                                        ("P%d" % n, "jp", "全国紙", "試験 出来事A", 1000 + n)]))
        specs.append(("big", [("A", "jp", "全国紙", "t", 1), ("B", "jp", "全国紙", "t", 1), ("C", "jp", "全国紙", "t", 1)]))
        specs.append(("both", [("A", "jp", "全国紙", "t", 1), ("B", "intl", "海外公共", "t", 1)]))
        rc, items = self._world(specs)
        blocks = [[r["cid"]] for r in rc]
        picks = build.pick_blocks(blocks, rc, items)
        tops = [p for p in picks if p["why"] == "top"]
        self.assertEqual(len(tops), 18)
        self.assertEqual(tops[0]["cids"], ["big"])                # 3 媒体が先
        self.assertEqual(tops[1]["cids"], ["both"])               # 2 媒体で両方の拠点が次（時刻が古くても）
        self.assertEqual([p["cids"] for p in tops[2:5]], [["c24"], ["c23"], ["c22"]])   # 新しい順

    def test_intl_japan_and_gov_only(self):
        specs = [("t1", [("A", "jp", "全国紙", "t", 5), ("B", "jp", "全国紙", "t", 5)])]
        for n in range(8):                                        # Japan を含む海外の単独 8 件 -> 6 件だけ
            specs.append(("j%d" % n, [("X%d" % n, "intl", "海外主流", "Test Japan item %d" % n, 100 + n)]))
        specs.append(("tokyo-jp", [("Y", "jp", "全国紙", "Tokyo test", 999)]))          # 拠点が jp: 対象外
        specs.append(("nojp", [("Z", "intl", "海外主流", "Test item without the word", 999)]))
        specs.append(("jp-ja", [("W", "intl", "海外主流", "試験 日本 出来事", 50)]))     # 日本語の語も拾う
        for n in range(12):                                       # 政府一次・jp の単独 12 件 -> 10 件
            specs.append(("g%02d" % n, [("省%d" % n, "jp", "政府一次", "試験 出来事", 200 + n)]))
        specs.append(("g-intl", [("Fed", "intl", "政府一次", "Test", 9999)]))             # intl: 対象外
        rc, items = self._world(specs)
        picks = build.pick_blocks([[r["cid"]] for r in rc], rc, items)
        by = {}
        for p in picks:
            by.setdefault(p["why"], []).append(p["cids"][0])
        self.assertEqual(by["top"], ["t1"])
        self.assertEqual(by["intl_japan"], ["j7", "j6", "j5", "j4", "j3", "j2"])
        self.assertEqual(by["gov_only"], ["g11", "g10", "g09", "g08", "g07", "g06", "g05", "g04", "g03", "g02"])
        self.assertNotIn("jp-ja", by["intl_japan"])               # 6 件の枠から溢れた
        self.assertEqual(len([p for p in picks]), len({p["cids"][0] for p in picks}), "重複して選んだ")

    def test_japan_pattern(self):
        for t in ("Japan to test", "tokyo", "BOJ holds", "Bank of Japan", "yen slides", "Nikkei falls",
                  "日本の試験", "円安が進む", "福島で試験"):
            self.assertTrue(build.JAPAN_RE.search(t), t)
        for t in ("Japanologist meets", "Tokyoite test", "yenta", "Test Event A", "Trump visits"):
            self.assertFalse(build.JAPAN_RE.search(t), t)


class FixtureNoAI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data, cls.requests = build.build(load_items()["items"], load_items()["sources"], NOW, 36,
                                             None, "off", PROMPT, False)

    def test_invariants(self):
        check_invariants(self, self.data)

    def test_shape_and_run(self):
        d = self.data
        self.assertEqual((d["schema"], d["edition"], d["generated_at"], d["window_h"]), ("parallax/1", "local", NOW, 36))
        self.assertEqual(list(d), ["schema", "generated_at", "window_h", "rights_mode", "sources", "scope", "items", "edition",
                                   "rule_clusters", "blocks", "ai_requests", "stories", "ai_run", "window_items", "cross_home", "images", "name_gate"])
        self.assertEqual(d["ai_run"]["status"], "off")
        self.assertIsNone(d["ai_run"]["provider"])
        self.assertTrue(all(s["origin"] == "rule" and s["ai"] is None for s in d["stories"]))
        self.assertEqual(len(d["sources"]), len(load_items()["sources"]))        # the fixture was taken when the table was smaller

    def test_dropped_and_collapsed_items_are_absent(self):
        links = {it["link"] for it in self.data["items"].values()}
        for gone in ("z1", "z2", "z3", "a8"):          # 期間外・時刻なし・未来・NHK の二本目（束は媒体ごとに 1 本）
            self.assertFalse(any(l.endswith("/" + gone) for l in links), gone)
        self.assertTrue(any(l.endswith("/a7") for l in links))

    def test_rule_clusters(self):
        ja = stories_of(self.data, ["NHK", "毎日新聞", "東洋経済", "TBS"])
        self.assertEqual(len(ja), 1)
        s = ja[0]
        self.assertEqual(s["n_outlets"], 4)
        self.assertEqual(s["homes"], ["jp"])
        self.assertEqual(s["langs"], ["ja"])
        types = [self.data["items"][i]["type"] for i in s["member_ids"]]
        from parallax import cluster
        ranks = [cluster.type_rank(t) for t in types]
        self.assertEqual(ranks, sorted(ranks))                      # 型の順（公共放送 < 全国紙 < 経済紙 < 民放）
        self.assertEqual(s["outlets"][0], "NHK")

    def test_blocks_and_picks(self):
        d = self.data
        why = {b["bid"]: b["why"] for b in d["blocks"]}
        self.assertEqual([why[k] for k in sorted(why)], ["top"] * 4 + ["intl_japan", "gov_only"])
        multi = [b for b in d["blocks"] if len(b["cids"]) > 1]
        self.assertEqual(len(multi), 1)                              # C・D・E が緩い結びで一つの塊
        self.assertEqual(len(multi[0]["cids"]), 3)
        singles = {b["cids"][0] for b in d["blocks"] if b["why"] in ("intl_japan", "gov_only")}
        outlets = {tuple(r["outlets"]) for r in d["rule_clusters"] if r["cid"] in singles}
        self.assertEqual(outlets, {("DW",), ("農林水産省",)})
        # F（Federal Reserve の単独）はどの規則にも当たらず、塊にならない
        fed = [r for r in d["rule_clusters"] if r["outlets"] == ["Federal Reserve"]][0]
        self.assertNotIn(fed["cid"], {c for b in d["blocks"] for c in b["cids"]})
        self.assertIsNone([s for s in d["stories"] if s["rule_cids"] == [fed["cid"]]][0]["bid"])

    def test_requests_document(self):
        reqs = self.data["ai_requests"]
        self.assertEqual(len(reqs), 1)
        r = reqs[0]
        self.assertEqual((r["rid"], r["bids"]), ("r1", ["b01", "b02", "b03", "b04", "b05", "b06"]))
        doc = json.loads(r["doc"])
        self.assertNotIn(" ", r["doc"].split('"title"')[0].replace("rule_groups", ""))   # compact（余白なし）
        self.assertIn("試験", r["doc"])                                                    # ensure_ascii=False
        n = 0
        for b in doc["blocks"]:
            self.assertEqual(sorted(b), ["bid", "items", "rule_groups"])
            flat = [a for g in b["rule_groups"] for a in g]
            self.assertEqual(flat, [it["id"] for it in b["items"]])
            for it in b["items"]:
                n += 1
                self.assertEqual(it["id"], "n%d" % n)
                self.assertEqual(sorted(it), ["home", "id", "lang", "outlet", "title", "type"])
                real = self.data["items"][r["alias"][it["id"]]]
                self.assertEqual((it["title"], it["outlet"], it["home"]), (real["title"], real["outlet"], real["home"]))
        self.assertNotIn("test.invalid", r["doc"])                                        # リンクは載せない
        self.assertEqual(len(r["alias"]), n)

    def test_deterministic(self):
        again, _ = build.build(load_items()["items"], load_items()["sources"], NOW, 36, None, "off", PROMPT, False)
        self.assertEqual(json.dumps(self.data, ensure_ascii=False), json.dumps(again, ensure_ascii=False))

    def test_sources_rows(self):
        rows = {r["id"]: r for r in self.data["sources"]}
        self.assertEqual(rows["mof"]["terms_status"], "ok")
        self.assertEqual(rows["nhk-main"]["terms_status"], "no")
        self.assertFalse(rows["npr-world"]["ok"])
        self.assertTrue(rows["npr-world"]["err"])
        self.assertEqual(rows["bbc-world"]["terms"], "")
        for r in rows.values():
            self.assertEqual(sorted(r), ["err", "fetched_at", "home", "id", "lang", "n", "name", "newest_ts", "ok",
                                         "oldest_ts", "outlet", "terms", "terms_status", "type"])

    def test_empty_input(self):
        data, reqs = build.build([], [], NOW, 36, None, "off", PROMPT, False)
        check_invariants(self, data)
        self.assertEqual((data["stories"], data["rule_clusters"], data["blocks"], data["ai_requests"], reqs), ([], [], [], [], []))


class FakeAI(unittest.TestCase):
    def run_build(self, edit=None, public=False):
        p = fake(edit)
        data, reqs = build.build(load_items()["items"], load_items()["sources"], NOW, 36, p, "off", PROMPT, public)
        return data, p

    def test_good_answer(self):
        data, p = self.run_build()
        check_invariants(self, data)
        run = data["ai_run"]
        self.assertEqual((run["status"], run["provider"], run["model"], run["at"]), ("ok", "fake", "fake", NOW))
        self.assertEqual((run["calls"], run["calls_failed"], run["errors"]), (1, 0, []))
        self.assertEqual((run["blocks_sent"], run["blocks_ok"]), (6, 6))
        self.assertEqual([run[k] for k in ("dropped_ids", "dup_ids", "unassigned_ids", "flags_vetoed")], [0, 0, 0, 0])
        self.assertEqual(len(p.calls), 1)
        self.assertEqual(p.calls[0]["system"], PROMPT["system"])
        self.assertEqual(p.calls[0]["schema"], PROMPT["schema"])
        sent = {c for b in data["blocks"] for c in b["cids"]}
        for s in data["stories"]:
            self.assertEqual(s["origin"], "ai" if s["bid"] else "rule")
        ai_story = [s for s in data["stories"] if s["origin"] == "ai"][0]
        self.assertTrue(ai_story["ai"]["headline_ja"].startswith("試験 題"))
        self.assertTrue(all(a["item_id"] in ai_story["member_ids"] for a in ai_story["ai"]["angles"]))
        self.assertTrue(sent)

    def test_fabricated_ids(self):
        def edit(ans, doc):
            for b in ans["blocks"]:
                b["stories"][0]["member_ids"] += ["n999", "zzz"]
                b["stories"].append({"member_ids": ["n998"], "headline_ja": "試験", "headline_en": "Test", "angles": [],
                                     "contrast_ja": "", "flags": [], "flag_note_ja": ""})
        data, _ = self.run_build(edit)
        check_invariants(self, data)
        self.assertEqual(data["ai_run"]["dropped_ids"], 3 * 6)
        self.assertEqual(data["ai_run"]["status"], "ok")
        ids = {i for s in data["stories"] for i in s["member_ids"]}
        self.assertTrue(all(i in data["items"] for i in ids))
        self.assertNotIn("n999", json.dumps(data["stories"]))

    def test_duplicate_ids(self):
        def edit(ans, doc):
            for b in ans["blocks"]:
                first = b["stories"][0]["member_ids"][0]
                b["stories"].append({"member_ids": [first], "headline_ja": "試験 二重", "headline_en": "Test dup",
                                     "angles": [], "contrast_ja": "", "flags": [], "flag_note_ja": ""})
        data, _ = self.run_build(edit)
        check_invariants(self, data)                              # どの item も二つの story に入らない
        self.assertEqual(data["ai_run"]["dup_ids"], 6)
        self.assertFalse(any(s["ai"] and s["ai"]["headline_ja"] == "試験 二重" for s in data["stories"]))

    def test_unassigned_ids_stay_with_their_rules(self):
        left = []

        def edit(ans, doc):
            for b, db in zip(ans["blocks"], doc["blocks"]):
                left.append(len(b["stories"][0]["member_ids"]))
                del b["stories"][0]
        data, _ = self.run_build(edit)
        check_invariants(self, data)                              # 取りこぼした item も story に残る
        self.assertEqual(data["ai_run"]["unassigned_ids"], sum(left))
        rule_in_blocks = [s for s in data["stories"] if s["bid"] and s["origin"] == "rule"]
        self.assertEqual(len(rule_in_blocks), 6)

    def test_json_broken_falls_back_to_rules(self):
        p = ai.FakeProvider(lambda *a: '{"blocks": [ {"bid": "b01", "stories": [')
        data, _ = build.build(load_items()["items"], load_items()["sources"], NOW, 36, p, "off", PROMPT, False)
        check_invariants(self, data)
        run = data["ai_run"]
        self.assertEqual((run["status"], run["calls"], run["calls_failed"], run["errors"]), ("error", 1, 1, ["json"]))
        self.assertEqual(run["blocks_ok"], 0)
        self.assertTrue(all(s["origin"] == "rule" and s["ai"] is None for s in data["stories"]))
        self.assertEqual(len([s for s in data["stories"] if s["bid"]]), len([r for r in data["rule_clusters"]
                         if r["cid"] in {c for b in data["blocks"] for c in b["cids"]}]))   # 送った塊は bid 付きの規則の story

    def test_provider_errors(self):
        for code in ("quota", "auth", "timeout", "network", "blocked", "truncated", "http", "shape"):
            p = ai.FakeProvider(lambda *a, code=code: (None, code))
            data, _ = build.build(load_items()["items"], load_items()["sources"], NOW, 36, p, "off", PROMPT, False)
            self.assertEqual((data["ai_run"]["status"], data["ai_run"]["errors"]), ("error", [code]))
            check_invariants(self, data)

    def test_partial_when_some_calls_fail(self):
        rc, by_id, blocks, call_bids = pipeline()
        reqs = build.build_requests([call_bids[0][:3], call_bids[0][3:]], blocks, rc, by_id)
        p = ai.FakeProvider(lambda s, u, sc: rules_answer(u) if "b01" in u else (None, "quota"))
        results, run = build.run_ai(reqs, p, PROMPT, by_id, NOW)
        self.assertEqual((run["calls"], run["calls_failed"], run["errors"]), (2, 1, ["quota"]))
        self.assertEqual(build.ai_status(p, run), "partial")
        self.assertEqual(sorted(results), ["b01", "b02", "b03"])
        st = build.assemble_stories(rc, blocks, results, by_id)["stories"]
        self.assertEqual({s["bid"] for s in st if s["origin"] == "ai"}, {"b01", "b02", "b03"})
        self.assertEqual({s["bid"] for s in st if s["origin"] == "rule" and s["bid"]}, {"b04", "b05", "b06"})

    def test_missing_bid_in_answer_falls_back(self):
        def edit(ans, doc):
            ans["blocks"] = [b for b in ans["blocks"] if b["bid"] != "b04"]
        data, _ = self.run_build(edit)
        check_invariants(self, data)
        self.assertEqual((data["ai_run"]["blocks_sent"], data["ai_run"]["blocks_ok"], data["ai_run"]["status"]), (6, 5, "ok"))
        b4 = [s for s in data["stories"] if s["bid"] == "b04"]
        self.assertTrue(b4 and all(s["origin"] == "rule" for s in b4))

    def test_flags_are_vetoed_by_the_rules(self):
        def edit(ans, doc):
            for b in ans["blocks"]:
                for s in b["stories"]:
                    s["flags"] = ["overseas_only", "jp_main_not_found", "primary_only", "overseas_only", "bogus"]
                    s["flag_note_ja"] = "試験の注記"
        data, _ = self.run_build(edit)
        check_invariants(self, data)
        total = 0
        for s in data["stories"]:
            if not s["ai"]:
                continue
            its = [data["items"][i] for i in s["member_ids"]]
            want = []
            if not any(i["home"] == "jp" for i in its):
                want.append("overseas_only")
            if len({i["outlet"] for i in its}) >= 2 and not any(
                    i["home"] == "jp" and i["type"] in ("公共放送", "通信社", "全国紙", "民放") for i in its):
                want.append("jp_main_not_found")
            if all(i["type"] == "政府一次" for i in its):
                want.append("primary_only")
            self.assertEqual(s["ai"]["flags"], want, s["outlets"])
            self.assertEqual(len(s["ai"]["flags"]) + len(s["ai"]["flags_dropped"]), 3)
            self.assertEqual(s["ai"]["flag_note_ja"], "試験の注記" if want else "")
            total += len(s["ai"]["flags_dropped"])
        self.assertEqual(data["ai_run"]["flags_vetoed"], total)
        ja = stories_of(data, ["NHK", "毎日新聞", "東洋経済", "TBS"])[0]
        self.assertEqual(ja["ai"]["flags"], [])
        self.assertIn({"flag": "overseas_only", "why": "has_jp_outlet"}, ja["ai"]["flags_dropped"])
        en = stories_of(data, ["BBC", "SCMP"])[0]
        self.assertEqual(en["ai"]["flags"], ["overseas_only", "jp_main_not_found"])
        gov = stories_of(data, ["財務省", "総務省"])[0]
        self.assertEqual(gov["ai"]["flags"], ["jp_main_not_found", "primary_only"])   # 政府一次は日本の主流の型ではない

    def test_merges_and_splits(self):
        rc, by_id, blocks, call_bids = pipeline()
        multi = [b for b in blocks if len(b["cids"]) == 3][0]

        def merge_all(ans, doc):
            for b in ans["blocks"]:
                if b["bid"] == multi["bid"]:
                    ids = [a for s in b["stories"] for a in s["member_ids"]]
                    b["stories"] = [dict(b["stories"][0], member_ids=ids)]
        data, _ = self.run_build(merge_all)
        check_invariants(self, data)
        self.assertEqual((data["ai_run"]["merges"], data["ai_run"]["splits"]), (1, 0))
        merged = [s for s in data["stories"] if len(s["rule_cids"]) == 3]
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["origin"], "ai")

        def split_first(ans, doc):
            for b in ans["blocks"]:
                if b["bid"] == multi["bid"]:
                    for s in list(b["stories"]):
                        if len(s["member_ids"]) == 2:
                            b["stories"].remove(s)
                            b["stories"] += [dict(s, member_ids=[s["member_ids"][0]]), dict(s, member_ids=[s["member_ids"][1]])]
        data, _ = self.run_build(split_first)
        check_invariants(self, data)
        self.assertEqual((data["ai_run"]["merges"], data["ai_run"]["splits"]), (0, 1))

    def test_nokey_and_off(self):
        d, _ = build.build(load_items()["items"], load_items()["sources"], NOW, 36, None, "nokey", PROMPT, False)
        self.assertEqual((d["ai_run"]["status"], d["ai_run"]["provider"], d["ai_run"]["at"], d["ai_run"]["calls"]),
                         ("nokey", None, None, 0))
        self.assertEqual(len(d["ai_requests"]), 1)                    # 鍵が無くても要求は組む（頁が BYOK で送れる）


class Public(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        snap = load_items()
        cls.local, _ = build.build(snap["items"], snap["sources"], NOW, 36, None, "off", PROMPT, False)
        cls.provider = fake()
        cls.public, cls.full_requests = build.build(snap["items"], snap["sources"], NOW, 36, cls.provider, "off", PROMPT, True)

    def test_titles_hidden_unless_terms_ok(self):
        d = self.public
        check_invariants(self, d)
        self.assertEqual(d["edition"], "public")
        n_ok = n_null = 0
        for it in d["items"].values():
            ok = sources.by_id(it["source_id"])["terms_status"] == "ok"
            if ok:
                n_ok += 1
                self.assertEqual(it["title"], self.local["items"][it["id"]]["title"])
            else:
                n_null += 1
                self.assertIsNone(it["title"])
                self.assertEqual(it["link"], self.local["items"][it["id"]]["link"])    # リンク・媒体名・時刻は残る
                self.assertEqual((it["outlet"], it["ts"]), (self.local["items"][it["id"]]["outlet"], self.local["items"][it["id"]]["ts"]))
        self.assertGreater(n_ok, 0)
        self.assertGreater(n_null, 0)

    def test_hidden_titles_appear_nowhere_in_the_output(self):
        text = json.dumps(self.public, ensure_ascii=False)
        hidden = [it["title"] for it in self.local["items"].values() if self.public["items"][it["id"]]["title"] is None]
        self.assertGreaterEqual(len(hidden), 10)
        for t in hidden:
            self.assertNotIn(t, text)
        shown = [it["title"] for it in self.public["items"].values() if it["title"]]
        self.assertTrue(all(t in text for t in shown))

    def test_ai_requests_only_from_all_ok_blocks(self):
        d = self.public
        ok_titles = {it["title"] for it in d["items"].values() if it["title"]}
        rc = {r["cid"]: r for r in d["rule_clusters"]}
        sent = set()
        for r in d["ai_requests"]:
            doc = json.loads(r["doc"])
            for b in doc["blocks"]:
                sent.add(b["bid"])
                for it in b["items"]:
                    self.assertIn(it["title"], ok_titles)
                    self.assertIsNotNone(d["items"][r["alias"][it["id"]]]["title"])
        self.assertTrue(sent)
        self.assertLess(len(sent), len(d["blocks"]))
        for b in d["blocks"]:
            all_ok = all(sources.by_id(d["items"][i]["source_id"])["terms_status"] == "ok"
                         for c in b["cids"] for i in rc[c]["member_ids"])
            self.assertEqual(b["bid"] in sent, all_ok, b["bid"])
        for r in d["ai_requests"]:
            self.assertTrue(set(r["bids"]) <= sent)

    def test_ai_still_reads_every_title_inside_the_build(self):
        sent_text = "".join(c["user_text"] for c in self.provider.calls)
        in_requests = {it["title"] for r in self.full_requests for b in json.loads(r["doc"])["blocks"] for it in b["items"]}
        hidden = [it["title"] for it in self.local["items"].values() if self.public["items"][it["id"]]["title"] is None]
        self.assertTrue(any(t in sent_text for t in hidden))
        self.assertTrue(set(hidden) & in_requests)

    def test_public_and_local_agree_on_everything_but_titles_and_requests(self):
        a, b = json.loads(json.dumps(self.local)), json.loads(json.dumps(self.public))      # 深い写し（元を壊さない）
        for k in ("items", "edition", "ai_requests", "stories", "ai_run", "cross_home", "name_gate"):
            a.pop(k), b.pop(k)
        for blocks in (a["blocks"], b["blocks"]):                       # 塊の ai 状態は走らせ方で違う（none / answered）
            for x in blocks:
                x.pop("ai")
        self.assertEqual(a, b)

    def test_unknown_source_is_hidden(self):
        it = {"id": "u1", "title": "試験 出来事A", "link": "https://test.invalid/u", "outlet": "O", "source_id": "no-such-source",
              "type": "全国紙", "home": "jp", "lang": "ja", "ts": NOW}
        self.assertIsNone(build.public_item(it)["title"])


class RecordedRoundTrip(unittest.TestCase):
    def test_dump_then_replay(self):
        snap = load_items()
        data0, reqs = build.build(snap["items"], snap["sources"], NOW, 36, None, "off", PROMPT, False)
        dump = build.dump_requests(reqs, PROMPT)
        self.assertEqual(dump["version"], "parallax-requests/2")
        self.assertEqual([sorted(r) for r in dump["requests"]], [["bids", "purpose", "rid", "sha256", "user_text"]])
        self.assertEqual(dump["requests"][0]["purpose"], "merge")
        r = dump["requests"][0]
        self.assertEqual(r["sha256"], ai.sha256_text(r["user_text"]))
        self.assertTrue(r["user_text"].startswith("<doc>\n{") and r["user_text"].endswith("}\n</doc>"))
        rec = {"version": "parallax-recorded/1", "provider": "claude-recorded", "model": "claude-test", "made_at": NOW - 50,
               "note_ja": "試験用: 偽の答え", "responses": {x["sha256"]: rules_answer(x["user_text"]) for x in dump["requests"]}}
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "rec.json"
            path.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
            prov = ai.RecordedProvider.from_file(path)
        data, _ = build.build(snap["items"], snap["sources"], NOW, 36, prov, "off", PROMPT, True)
        check_invariants(self, data)
        run = data["ai_run"]
        self.assertEqual((run["status"], run["provider"], run["model"], run["at"], run["note_ja"]),
                         ("recorded", "claude-recorded", "claude-test", NOW - 50, "試験用: 偽の答え"))
        self.assertEqual(run["calls_failed"], 0)
        fake_data, _ = build.build(snap["items"], snap["sources"], NOW, 36, fake(), "off", PROMPT, True)
        self.assertEqual(data["stories"], fake_data["stories"])        # 同じ答えなら同じ story（provider に依らない）

    def test_unrecorded_request_is_missing(self):
        prov = ai.RecordedProvider({"provider": "claude-recorded", "model": "m", "made_at": 1, "note_ja": "", "responses": {}})
        data, _ = build.build(load_items()["items"], load_items()["sources"], NOW, 36, prov, "off", PROMPT, False)
        self.assertEqual((data["ai_run"]["status"], data["ai_run"]["errors"]), ("error", ["missing"]))
        check_invariants(self, data)


class ChooseProvider(unittest.TestCase):
    def test_flags_decide_before_the_key(self):
        env = {"GEMINI_API_KEY": "TEST-KEY-NOT-REAL"}
        self.assertEqual(build.choose_provider({"no_ai": True}, env, None, PROMPT), (None, "off"))
        self.assertEqual(build.choose_provider({"dump_requests": "x.json"}, env, None, PROMPT), (None, "off"))
        self.assertEqual(build.choose_summary_provider({"no_ai": True}, env, PROMPT_ON), (None, "off"))
        self.assertEqual(build.choose_summary_provider({"dump_requests": "x.json"}, env, PROMPT_ON), (None, "off"))
        self.assertEqual(build.choose_summary_provider({}, {}, PROMPT_ON), (None, "nokey"))
        self.assertEqual(build.choose_provider({}, {}, None, PROMPT), (None, "nokey"))
        self.assertEqual(build.choose_provider({}, {"GEMINI_API_KEY": "  "}, None, PROMPT), (None, "nokey"))
        p, st = build.choose_provider({}, env, None, PROMPT)
        self.assertIsInstance(p, ai.GeminiProvider)
        self.assertEqual((p.model, st), (PROMPT["merge_model"], ""))
        self.assertEqual(p.max_output_tokens, PROMPT["max_output_tokens"])
        self.assertEqual((p.budget.limit, p.budget.used), (build.MERGE_CALL_LIMIT, 0))
        sp, sst = build.choose_summary_provider({}, env, PROMPT_ON)        # 用途ごとに別のモデル。名前は prompt.json にだけある
        self.assertEqual((sp.model, sst, sp.budget.limit), (PROMPT["summary_model"], "", build.SUMMARY_CALL_LIMIT))
        self.assertNotEqual(sp.model, p.model)
        self.assertEqual(sp.max_output_tokens, PROMPT["summary"]["max_output_tokens"])
        self.assertNotIn("TEST-KEY", repr(sp))
        p, _ = build.choose_provider({}, env, "gemini-other", PROMPT)
        self.assertEqual(p.model, "gemini-other")
        self.assertNotIn("TEST-KEY", repr(p))

    def test_responses_wins_over_key(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "rec.json"
            path.write_text(json.dumps({"provider": "claude-recorded", "model": "m", "responses": {}}), encoding="utf-8")
            p, st = build.choose_provider({"responses": str(path)}, {"GEMINI_API_KEY": "TEST-KEY-NOT-REAL"}, None, PROMPT)
        self.assertIsInstance(p, ai.RecordedProvider)


class Cli(unittest.TestCase):
    def run_main(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = build.main(list(argv))
        return rc, out.getvalue()

    def test_no_ai_writes_compact_utf8_json(self):
        with tempfile.TemporaryDirectory() as d:
            o = Path(d) / "sub" / "latest.json"
            rc, out = self.run_main("--items", str(FIX / "items.json"), "--no-ai", "--now", str(NOW), "--out", str(o))
            self.assertEqual(rc, 0)
            text = o.read_text(encoding="utf-8")
        self.assertNotIn("\n", text)
        self.assertNotIn('": ', text)
        self.assertNotIn('", "', text)
        self.assertIn("試験 出来事A", text)                               # ensure_ascii=False
        data = json.loads(text)
        check_invariants(self, data)
        self.assertEqual((data["edition"], data["ai_run"]["status"]), ("local", "off"))
        self.assertIn("edition=local", out)
        self.assertNotIn("試験", out)                                     # 標準出力に見出しを出さない

    def test_public_and_default_now_from_file(self):
        with tempfile.TemporaryDirectory() as d:
            o = Path(d) / "latest.json"
            self.run_main("--items", str(FIX / "items.json"), "--no-ai", "--public", "--out", str(o))
            data = json.loads(o.read_text(encoding="utf-8"))
        self.assertEqual((data["edition"], data["generated_at"]), ("public", NOW))
        self.assertTrue(any(it["title"] is None for it in data["items"].values()))

    def test_dump_requests_does_not_send_and_save_items_roundtrips(self):
        with tempfile.TemporaryDirectory() as d:
            o, dump, saved = Path(d) / "o.json", Path(d) / "dump.json", Path(d) / "items.json"
            with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "TEST-KEY-NOT-REAL"}):
                with mock.patch.object(ai.GeminiProvider, "call", side_effect=AssertionError("送ってはいけない")):
                    self.run_main("--items", str(FIX / "items.json"), "--dump-requests", str(dump), "--save-items", str(saved),
                                  "--now", str(NOW), "--out", str(o))
            d1 = json.loads(dump.read_text(encoding="utf-8"))
            s1 = json.loads(saved.read_text(encoding="utf-8"))
            data = json.loads(o.read_text(encoding="utf-8"))
        self.assertEqual(d1["version"], "parallax-requests/2")
        self.assertEqual(data["ai_run"]["status"], "off")
        self.assertEqual(sorted(s1), ["fetched_at", "items", "sources"])
        self.assertEqual(s1["fetched_at"], NOW)

    def test_nokey_when_nothing_given(self):
        with tempfile.TemporaryDirectory() as d:
            o = Path(d) / "o.json"
            with mock.patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
                self.run_main("--items", str(FIX / "items.json"), "--now", str(NOW), "--out", str(o))
            self.assertEqual(json.loads(o.read_text(encoding="utf-8"))["ai_run"]["status"], "nokey")

    def test_default_out_is_repo_data(self):
        self.assertEqual(Path(build.ROOT), ROOT)


class Assemble(unittest.TestCase):
    def test_story_from_orders_members_and_rule_cids(self):
        rc, by_id, blocks, _ = pipeline()
        cid_of = {i: r["cid"] for r in rc for i in r["member_ids"]}
        r = [x for x in rc if x["n_outlets"] == 4][0]
        s = build.story_from(list(reversed(r["member_ids"])), "rule", "b01", None, by_id, cid_of)
        self.assertEqual(s["member_ids"], r["member_ids"])
        self.assertEqual(s["rule_cids"], [r["cid"]])
        self.assertEqual(s["sid"], "s" + build.sha1_12(sorted(r["member_ids"])))


class Basis(unittest.TestCase):
    """束ねた理由（CONTRACT §8）。公開版では、隠した見出しの語を一つも出さない。"""

    @classmethod
    def setUpClass(cls):
        snap = load_items()
        cls.local, _ = build.build(snap["items"], snap["sources"], NOW, 36, fake(), "off", PROMPT, False)
        cls.public, _ = build.build(snap["items"], snap["sources"], NOW, 36, fake(), "off", PROMPT, True)

    def test_local_basis_has_shared_words_and_span(self):
        ja = stories_of(self.local, ["NHK", "毎日新聞", "東洋経済", "TBS"])[0]
        self.assertEqual(ja["basis"]["by"], "ai")
        self.assertIn("試験委員会", ja["basis"]["words"])
        self.assertEqual(ja["basis"]["time_span"], ja["last_ts"] - ja["first_ts"])
        single = [s for s in self.local["stories"] if len(s["member_ids"]) == 1]
        self.assertTrue(single and all(s["basis"] is None for s in single))

    def test_places_come_from_two_headlines(self):
        its = [{"id": "a", "title": "試験 群馬県で出来事A 試験の発表", "outlet": "O1"},
               {"id": "b", "title": "試験 群馬県の出来事A 試験を公表", "outlet": "O2"},
               {"id": "c", "title": "試験 栃木県で出来事B", "outlet": "O3"}]
        b = build.make_basis(its, "rule", 60)
        self.assertEqual(b["places"], ["群馬"])
        self.assertEqual(b["time_span"], 60)
        self.assertIsNone(build.make_basis(its[:1], "rule", 0))

    def test_midterm_election_is_not_china(self):
        """「米中間選挙」の「米中」は米国の中間選挙。中国の札を付けない。「米中露」の「米中」は米国と中国のまま。"""
        t1, t2 = "試験 米中間選挙 試験委員会が試験案を決定", "試験 米中間選挙 試験委員会 試験案を決定した"
        its = [{"id": "a", "title": t1, "outlet": "O1"}, {"id": "b", "title": t2, "outlet": "O2"}]
        self.assertEqual(build.make_basis(its, "rule", 60)["places"], ["US"])
        its = [{"id": "a", "title": t1.replace("米中間選挙", "米中露の試験会談"), "outlet": "O1"},
               {"id": "b", "title": t2.replace("米中間選挙", "米中露の試験会談"), "outlet": "O2"}]
        self.assertEqual(build.make_basis(its, "rule", 60)["places"], ["CN", "US"])
        its = [{"id": "a", "title": "試験 米中間の試験協議 試験委員会が試験案を決定", "outlet": "O1"},
               {"id": "b", "title": "試験 米中間の試験協議 試験委員会 試験案を決定した", "outlet": "O2"}]
        self.assertEqual(build.make_basis(its, "rule", 60)["places"], ["CN", "US"])      # 「米国と中国の間」は別の語
        from parallax import cluster
        self.assertEqual(cluster._concepts("試験 米中間選挙", set()) & cluster._GEO, {"US"})

    def test_public_words_only_from_shown_headlines(self):
        its = [{"id": "a", "title": "試験 秘密機関が試験計画を決定", "outlet": "O1"},
               {"id": "b", "title": "試験 秘密機関の試験計画を発表", "outlet": "O2"},
               {"id": "c", "title": "試験 秘密機関の試験計画を報道", "outlet": "O3"}]
        self.assertIn("秘密機関", build.make_basis(its, "rule", 0)["words"])
        self.assertEqual(build.make_basis(its, "rule", 0, word_ids=set())["words"], [])
        self.assertEqual(build.make_basis(its, "rule", 0, word_ids={"a"})["words"], [])           # 一本だけでは共通にならない
        self.assertIn("秘密機関", build.make_basis(its, "rule", 0, word_ids={"a", "b"})["words"])

    def test_public_basis_never_carries_a_hidden_word(self):
        d, local = self.public, self.local
        import unicodedata
        low = lambda t: unicodedata.normalize("NFKC", t).lower()
        shown = {i: low(it["title"]) for i, it in d["items"].items() if it["title"]}
        from parallax import cluster
        for s in d["stories"]:
            if not s["basis"]:
                continue
            ok_members = [i for i in s["member_ids"] if i in shown]
            for w in s["basis"]["words"]:
                if w in cluster._CONCEPTS:
                    continue
                self.assertGreaterEqual(sum(1 for i in ok_members if w in shown[i]), 2, (s["outlets"], w))
        ja = stories_of(d, ["NHK", "毎日新聞", "東洋経済", "TBS"])[0]          # 四本とも隠した見出し
        self.assertEqual(ja["basis"]["words"], [])
        self.assertEqual(ja["basis"]["time_span"], stories_of(local, ["NHK", "毎日新聞", "東洋経済", "TBS"])[0]["basis"]["time_span"])
        en = stories_of(d, ["BBC", "The Guardian", "Al Jazeera"])[0]
        self.assertEqual(en["basis"]["words"], [])
        gov = stories_of(d, ["財務省", "総務省"])[0]                          # 二本とも載せてよい見出し: 語が出る
        self.assertTrue(gov["basis"]["words"])
        # 隠した側にだけある語（例: 委員会）が、公開の basis のどこにも無い
        hidden_only = {"試験委員会", "委員会", "committee", "plan", "試験案"}
        for s in d["stories"]:
            if s["basis"]:
                self.assertFalse(hidden_only & {w.lower() for w in s["basis"]["words"]}, s["outlets"])
        self.assertNotIn("委員会", json.dumps([s["basis"] for s in d["stories"]], ensure_ascii=False))


class BlockStateAndStats(unittest.TestCase):
    def build_with(self, provider, status="off"):
        snap = load_items()
        data, _ = build.build(snap["items"], snap["sources"], NOW, 36, provider, status, PROMPT, False)
        return data, snap

    def test_block_ai_state(self):
        d, _ = self.build_with(None)
        self.assertEqual({b["ai"] for b in d["blocks"]}, {"none"})
        d, _ = self.build_with(fake())
        self.assertEqual({b["ai"] for b in d["blocks"]}, {"answered"})
        d, _ = self.build_with(ai.FakeProvider(lambda *a: "{broken"))
        self.assertEqual({b["ai"] for b in d["blocks"]}, {"fallback"})

        def edit(ans, doc):
            ans["blocks"] = [b for b in ans["blocks"] if b["bid"] != "b04"]
        d, _ = self.build_with(fake(edit))
        self.assertEqual({b["bid"] for b in d["blocks"] if b["ai"] == "fallback"}, {"b04"})

    def test_stats_counts(self):
        d, snap = self.build_with(fake(), "off")
        st = build.make_stats(d, snap["items"], NOW, 36)
        self.assertEqual(st["schema"], "parallax-stats/1")
        self.assertEqual((st["edition"], st["generated_at"]), ("local", NOW))
        self.assertEqual(st["window"]["hours"], 36)
        self.assertEqual((st["window"]["from"], st["window"]["to"]), (NOW - 36 * 3600, NOW))
        pool = build.prepare_items(snap["items"], NOW, 36)                  # 窓の中の見出し全部（束に残らなかった物も）
        self.assertEqual(st["window"]["newest_ts"], max(it["ts"] for it in pool))
        self.assertEqual(st["window"]["oldest_ts"], min(it["ts"] for it in pool))
        ok = sum(1 for r in snap["sources"] if r["ok"])
        self.assertEqual(st["sources"], {"total": len(snap["sources"]), "ok": ok, "failed": len(snap["sources"]) - ok})
        self.assertEqual(st["headlines"], {"fetched": 21, "in_window": 17, "clustered": 16})
        c = st["clusters"]
        self.assertEqual((c["total"], c["multi_outlet"]), (9, 4))
        rcs, its = d["rule_clusters"], d["items"]
        self.assertEqual(c["jp_only"], sum(1 for r in rcs if r["homes"] == ["jp"]))
        self.assertEqual(c["intl_only"], sum(1 for r in rcs if r["homes"] == ["intl"]))
        self.assertEqual(c["gov_primary_only"], sum(1 for r in rcs if all(its[i]["type"] == "政府一次" for i in r["member_ids"])))
        self.assertEqual(c["multi_outlet_jp_only"], sum(1 for r in rcs if r["n_outlets"] > 1 and r["homes"] == ["jp"]))
        self.assertEqual((c["jp_only"], c["intl_only"]), (5, 4))
        a = st["ai"]
        self.assertEqual((a["blocks_chosen"], a["blocks_sent"], a["blocks_ok"], a["blocks_failed"]), (6, 6, 6, 0))
        self.assertEqual((a["clusters_sent"], a["clusters_fallen"], a["calls"], a["calls_failed"]), (8, 0, 1, 0))
        self.assertEqual((a["stories"], a["ai_stories"]), (len(d["stories"]), sum(1 for s in d["stories"] if s["origin"] == "ai")))

    def test_stats_for_failed_and_off_runs(self):
        d, snap = self.build_with(ai.FakeProvider(lambda *a: "{broken"))
        a = build.make_stats(d, snap["items"], NOW, 36)["ai"]
        self.assertEqual((a["status"], a["blocks_sent"], a["blocks_ok"], a["blocks_failed"], a["clusters_sent"], a["clusters_fallen"]),
                         ("error", 6, 0, 6, 8, 8))
        d, snap = self.build_with(None)
        a = build.make_stats(d, snap["items"], NOW, 36)["ai"]
        self.assertEqual((a["status"], a["blocks_chosen"], a["blocks_sent"], a["clusters_sent"], a["clusters_fallen"], a["calls"]),
                         ("off", 6, 0, 0, 0, 0))


class Guard(unittest.TestCase):
    def good(self, public=False):
        snap = load_items()
        d, _ = build.build(snap["items"], snap["sources"], NOW, 36, fake(), "off", PROMPT, public)
        return d

    def test_good_data_passes(self):
        self.assertEqual(build.check_output(self.good()), [])
        self.assertEqual(build.check_output(self.good(True)), [])

    def test_threshold(self):
        d = self.good()
        n = len(d["stories"])
        self.assertEqual(build.check_output(d, n), [])
        self.assertTrue(any("below the threshold" in p for p in build.check_output(d, n + 1)))

    def test_broken_data_is_refused(self):
        d = self.good()
        d["schema"] = "x"
        self.assertIn("schema", build.check_output(d))
        d = self.good()
        d["stories"][0]["member_ids"] = d["stories"][0]["member_ids"] + d["stories"][1]["member_ids"][:1]
        self.assertIn("item in two stories", build.check_output(d))
        d = self.good()
        d["stories"].pop()
        self.assertIn("stories do not cover every item", build.check_output(d))
        d = self.good()
        d["items"].pop(next(iter(d["items"])))
        self.assertIn("items do not match rule clusters", build.check_output(d))

    def test_public_leak_is_refused(self):
        d = self.good(True)
        hidden = [i for i, it in d["items"].items() if it["title"] is None][0]
        d["items"][hidden]["title"] = "試験 出来事A 漏れた見出し"
        self.assertTrue(any("public edition carries" in p for p in build.check_output(d)))
        d = self.good(True)
        hidden = [i for i, it in d["items"].items() if it["title"] is None][0]
        d["ai_requests"][0]["alias"]["n1"] = hidden
        self.assertTrue(any("ai_requests" in p for p in build.check_output(d)))
        for p in build.check_output(d):
            self.assertNotIn("試験", p)                              # 問題文に見出しを入れない

    def test_cli_keeps_the_previous_good_file(self):
        with tempfile.TemporaryDirectory() as t:
            out = Path(t) / "data" / "latest.json"
            out.parent.mkdir()
            out.write_text("PREVIOUS", encoding="utf-8")
            err = io.StringIO()
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                rc = build.main(["--items", str(FIX / "items.json"), "--no-ai", "--now", str(NOW), "--out", str(out),
                                 "--min-stories", "999"])
            self.assertEqual(rc, 2)
            self.assertEqual(out.read_text(encoding="utf-8"), "PREVIOUS")
            self.assertEqual(sorted(p.name for p in out.parent.iterdir()), ["latest.json"])     # stats も .tmp も残さない
            self.assertIn("REFUSED", err.getvalue())
            self.assertNotIn("試験", err.getvalue())
            with contextlib.redirect_stdout(io.StringIO()):
                rc = build.main(["--items", str(FIX / "items.json"), "--no-ai", "--now", str(NOW), "--out", str(out),
                                 "--min-stories", "9"])
            self.assertEqual(rc, 0)
            names = sorted(p.name for p in out.parent.iterdir())
            self.assertEqual(names, ["latest.json", "stats.json"])
            self.assertEqual(json.loads((out.parent / "stats.json").read_text(encoding="utf-8"))["schema"], "parallax-stats/1")
            self.assertEqual(json.loads(out.read_text(encoding="utf-8"))["schema"], "parallax/1")



def bare(d):
    """ai_snapshot を除いた、この回自身の部分。"""
    return {k: v for k, v in d.items() if k != "ai_snapshot"}


class KeepPrevious(unittest.TestCase):
    """CONTRACT §12。鍵なし・全呼び失敗の回に、前回の AI の見方を一揃いで保つ。この回の規則の束には混ぜない。"""

    @classmethod
    def setUpClass(cls):
        snap = load_items()
        cls.items, cls.sources = snap["items"], snap["sources"]
        cls.later = NOW + 3600
        cls.prev, _ = build.build(cls.items, cls.sources, NOW, 36, fake(), "off", PROMPT, False)
        cls.fewer = [it for it in cls.items if it.get("source_id") != "bbc-world"]

    def go(self, previous, provider=None, status="nokey", public=False, items=None, now=None):
        d, _ = build.build(self.items if items is None else items, self.sources, now or self.later, 36, provider,
                           status, PROMPT, public, copy.deepcopy(previous))
        return d

    def failing(self, code="quota"):
        return ai.FakeProvider(lambda *a, code=code: (None, code))

    # -- 鍵が無い回でも AI の見方が消えない
    def test_nokey_keeps_the_ai_view_as_a_snapshot(self):
        d = self.go(self.prev)
        run, sn = d["ai_run"], d["ai_snapshot"]
        self.assertEqual((run["status"], run["reason"]), ("kept_previous", "nokey"))
        self.assertEqual((run["provider"], run["model"], run["at"], run["calls"], run["calls_failed"], run["errors"]),
                         (None, None, None, 0, 0, []))
        self.assertEqual((sn["ai_at"], sn["source_fetched_at"], d["generated_at"]), (NOW, NOW, self.later))
        self.assertEqual(sn["ai_run"]["status"], "ok")
        self.assertGreater(sum(1 for s in sn["stories"] if s["origin"] == "ai"), 0)
        self.assertEqual(build.check_output(d), [])
        check_invariants(self, bare(d))
        check_invariants(self, dict(sn, ai_requests=[]))                      # 自分の items だけで閉じている

    def test_nokey_keeps_the_recorded_kind_too(self):
        prev = copy.deepcopy(self.prev)
        prev["ai_run"].update(status="recorded", provider="claude-recorded", at=NOW - 500)
        d = self.go(prev)
        self.assertEqual(d["ai_run"]["status"], "kept_previous")
        self.assertEqual((d["ai_snapshot"]["ai_at"], d["ai_snapshot"]["ai_run"]["provider"]), (NOW - 500, "claude-recorded"))

    # -- Gemini が失敗した回
    def test_failed_gemini_keeps_it_and_says_why(self):
        for code in ("quota", "http", "json"):
            d = self.go(self.prev, self.failing(code), "off")
            run = d["ai_run"]
            self.assertEqual((run["status"], run["reason"], run["errors"]), ("kept_previous", "error", [code]))
            self.assertEqual((run["calls"], run["calls_failed"], run["provider"], run["at"]), (1, 1, "fake", None))
            self.assertEqual(d["ai_snapshot"]["ai_at"], NOW)
            self.assertEqual({b["ai"] for b in d["blocks"]}, {"fallback"})
            self.assertEqual(build.check_output(d), [])

    # -- 古い AI の束と新しい規則の束が混ざらない
    def test_old_ai_bundles_never_mix_into_the_new_rule_bundles(self):
        d = self.go(self.prev, items=self.fewer)
        plain, _ = build.build(self.fewer, self.sources, self.later, 36, None, "nokey", PROMPT, False)
        self.assertEqual(bare(d)["stories"], plain["stories"])                # この回の stories は AI の無い回と同じ
        self.assertEqual(d["rule_clusters"], plain["rule_clusters"])
        self.assertEqual(d["items"], plain["items"])
        self.assertTrue(all(s["origin"] == "rule" and s["ai"] is None for s in d["stories"]))
        only_old = set(d["ai_snapshot"]["items"]) - set(d["items"])
        self.assertGreater(len(only_old), 0)                                  # 前回にだけある item がある
        text = json.dumps(bare(d), ensure_ascii=False)
        self.assertNotIn("試験 題", text)                                   # AI の文は本体のどこにも無い
        self.assertTrue(all(i not in text for i in only_old))
        self.assertEqual(d["ai_snapshot"]["stories"], self.prev["stories"])    # 前回の見方は一揃いのまま
        self.assertEqual(d["ai_snapshot"]["items"], self.prev["items"])
        self.assertEqual(d["ai_snapshot"]["rule_clusters"], self.prev["rule_clusters"])
        self.assertEqual(d["ai_snapshot"]["blocks"], self.prev["blocks"])
        for s in d["ai_snapshot"]["stories"]:
            self.assertTrue(set(s["member_ids"]) <= set(d["ai_snapshot"]["items"]))

    def test_kept_through_many_builds_the_times_stay_the_original(self):
        d1 = self.go(self.prev)
        d2 = self.go(d1, now=self.later + 3 * 3600)
        d3 = self.go(d2, self.failing(), "off", now=self.later + 6 * 3600)
        for d in (d2, d3):
            self.assertEqual((d["ai_snapshot"]["ai_at"], d["ai_snapshot"]["source_fetched_at"]), (NOW, NOW))
            self.assertEqual(d["ai_snapshot"]["stories"], self.prev["stories"])
            self.assertEqual(d["ai_snapshot"]["ai_run"]["status"], "ok")      # kept_previous を入れ子にしない
            self.assertEqual(build.check_output(d), [])
        self.assertEqual((d2["generated_at"], d3["generated_at"]), (self.later + 3 * 3600, self.later + 6 * 3600))
        self.assertEqual((d2["ai_run"]["reason"], d3["ai_run"]["reason"]), ("nokey", "error"))
        self.assertEqual(d3["ai_snapshot"], d2["ai_snapshot"])

    # -- 前回が無い・壊れている時は今までどおり AI OFF
    def test_no_usable_previous_falls_back_to_the_ai_off_state(self):
        broken = copy.deepcopy(self.prev)
        broken["stories"] = broken["stories"][:-1]                            # 全 item を覆わない
        no_ai_story = copy.deepcopy(self.prev)
        no_ai_story["stories"] = [dict(s, origin="rule", ai=None) for s in no_ai_story["stories"]]
        kept_no_snap = copy.deepcopy(self.prev)
        kept_no_snap["ai_run"]["status"] = "kept_previous"
        kept_bad_snap = copy.deepcopy(self.go(self.prev))
        kept_bad_snap["ai_snapshot"]["ai_at"] = "yesterday"
        bad_shape = copy.deepcopy(self.prev)
        bad_shape["rule_clusters"] = [{"cid": "c1"}]
        bad_run = copy.deepcopy(self.prev)
        bad_run["ai_run"] = "ok"
        no_time = copy.deepcopy(self.prev)
        no_time["generated_at"] = None
        cases = {"none": None, "empty": {}, "list": [], "wrong schema": dict(self.prev, schema="parallax/0"),
                 "ai off": self.go(None), "a build without AI stories": no_ai_story, "stories do not cover": broken,
                 "kept_previous without a snapshot": kept_no_snap, "snapshot with a bad time": kept_bad_snap,
                 "wrong shape": bad_shape, "ai_run is not an object": bad_run, "no fetch time": no_time}
        for name, prev in cases.items():
            d = self.go(prev)
            self.assertEqual((d["ai_run"]["status"], "ai_snapshot" in d, "reason" in d["ai_run"]), ("nokey", False, False), name)
            self.assertTrue(all(s["ai"] is None for s in d["stories"]), name)
            d = self.go(prev, self.failing(), "off")
            self.assertEqual((d["ai_run"]["status"], "ai_snapshot" in d), ("error", False), name)
            self.assertEqual(build.check_output(d), [], name)

    def test_only_nokey_and_error_builds_keep(self):
        d = self.go(self.prev, None, "off")                                    # --no-ai は意図した off
        self.assertEqual((d["ai_run"]["status"], "ai_snapshot" in d), ("off", False))
        kept = self.go(self.prev)
        d = self.go(kept, fake(), "off")                                       # 自分の答えがあれば、前の snapshot は捨てる
        self.assertEqual((d["ai_run"]["status"], "ai_snapshot" in d), ("ok", False))
        self.assertEqual(d["ai_run"]["at"], self.later)
        self.assertEqual(build.check_output(d), [])
        rc, by_id, blocks, call_bids = pipeline()
        reqs = build.build_requests([call_bids[0][:3], call_bids[0][3:]], blocks, rc, by_id)
        p = ai.FakeProvider(lambda s, u, sc: rules_answer(u) if "b01" in u else (None, "quota"))
        _, run = build.run_ai(reqs, p, PROMPT, by_id, NOW)
        self.assertEqual(build.ai_status(p, run), "partial")                   # partial は保つ対象ではない
        self.assertEqual(build.KEEP_WHEN, ("nokey", "error"))

    # -- 公開版の見出しの隠しは snapshot の中でも守る
    def test_public_gate_applies_inside_the_snapshot(self):
        d = self.go(self.prev, public=True)                                    # 前回は local（全見出し）。この回は public
        self.assertEqual((d["edition"], d["ai_snapshot"]["edition"]), ("public", "public"))
        its = d["ai_snapshot"]["items"]
        hidden = [i for i, it in its.items() if sources.by_id(it["source_id"])["terms_status"] != "ok"]
        self.assertGreaterEqual(len(hidden), 5)
        self.assertTrue(all(its[i]["title"] is None for i in hidden))
        self.assertTrue(all(its[i]["title"] for i in its if i not in hidden))
        text = json.dumps(d, ensure_ascii=False)
        for i in hidden:
            self.assertNotIn(self.prev["items"][i]["title"], text)
        self.assertEqual(build.check_output(d), [])
        for s in d["ai_snapshot"]["stories"]:                                  # 隠れた見出しから取った語は残さない
            shown = [i for i in s["member_ids"] if its[i]["title"] is not None]
            if s["basis"] and len(shown) < 2:
                self.assertEqual(s["basis"]["words"], [])
            if s["basis"] and set(s["member_ids"]) & set(hidden):
                self.assertEqual(s["basis"]["words"], [])
        lost_any = [s for s in self.prev["stories"] if s["basis"] and s["basis"]["words"] and set(s["member_ids"]) & set(hidden)]
        self.assertTrue(lost_any, "the case under test must exist in the fixture")

    def test_public_previous_stays_public_and_unchanged(self):
        pub, _ = build.build(self.items, self.sources, NOW, 36, fake(), "off", PROMPT, True)
        d = self.go(pub, public=True)
        self.assertEqual(d["ai_snapshot"]["items"], pub["items"])
        self.assertEqual(d["ai_snapshot"]["stories"], pub["stories"])
        self.assertEqual(build.check_output(d), [])
        loc = self.go(pub)                                                      # public の前回を local の回が保っても、隠れたまま
        self.assertEqual(loc["ai_snapshot"]["edition"], "public")
        self.assertTrue(any(it["title"] is None for it in loc["ai_snapshot"]["items"].values()))

    # -- 書く前の検査
    def test_check_output_refuses_a_bad_snapshot(self):
        good = self.go(self.prev, public=True)
        self.assertEqual(build.check_output(good), [])
        d = copy.deepcopy(good)
        del d["ai_snapshot"]
        self.assertTrue(any("ai_snapshot must be present" in p for p in build.check_output(d)))
        d = copy.deepcopy(good)
        d["ai_run"]["status"] = "nokey"
        self.assertTrue(any("ai_snapshot must be present" in p for p in build.check_output(d)))
        d = copy.deepcopy(good)
        d["ai_run"]["reason"] = "ok"
        self.assertIn("kept_previous without a reason", build.check_output(d))
        d = copy.deepcopy(good)
        d["stories"][0] = dict(d["stories"][0], origin="ai", ai={"headline_ja": "x"})
        self.assertTrue(any("carries AI text" in p for p in build.check_output(d)))
        d = copy.deepcopy(good)
        hidden = [i for i, it in d["ai_snapshot"]["items"].items() if it["title"] is None][0]
        d["ai_snapshot"]["items"][hidden]["title"] = "試験 出来事A 漏れた見出し"
        probs = build.check_output(d)
        self.assertTrue(any("public snapshot carries" in p for p in probs))
        self.assertFalse(any("試験" in p for p in probs))
        d = copy.deepcopy(good)
        d["ai_snapshot"]["stories"] = [dict(s, origin="rule", ai=None) for s in d["ai_snapshot"]["stories"]]
        self.assertIn("snapshot has no AI story", build.check_output(d))
        d = copy.deepcopy(good)
        d["ai_snapshot"]["stories"].pop()
        self.assertIn("snapshot: stories do not cover every item", build.check_output(d))
        d = copy.deepcopy(good)
        d["ai_snapshot"]["ai_at"] = None
        self.assertTrue(any("ai_at" in p for p in build.check_output(d)))
        d = copy.deepcopy(good)
        d["ai_snapshot"] = "x"
        self.assertEqual(build.check_output(d), ["snapshot is not an object"])

    # -- stats.json
    def test_stats_tell_the_three_cases_apart(self):
        def stats(d):
            return build.make_stats(d, self.items, d["generated_at"], 36)["ai"]
        kept = stats(self.go(self.prev))
        self.assertEqual((kept["status"], kept["reason"]), ("kept_previous", "nokey"))
        self.assertEqual(kept["kept"], {"ai_at": NOW, "source_fetched_at": NOW, "stories": len(self.prev["stories"]),
                                        "ai_stories": sum(1 for s in self.prev["stories"] if s["origin"] == "ai")})
        self.assertEqual((kept["calls"], kept["calls_failed"], kept["ai_stories"]), (0, 0, 0))   # この回の数だけ
        failed = stats(self.go(self.prev, self.failing(), "off"))
        self.assertEqual((failed["status"], failed["reason"], failed["calls"], failed["calls_failed"]),
                         ("kept_previous", "error", 1, 1))
        nokey = stats(self.go(None))
        self.assertEqual((nokey["status"], nokey["reason"], nokey["kept"]), ("nokey", None, None))
        error = stats(self.go(None, self.failing(), "off"))
        self.assertEqual((error["status"], error["reason"], error["kept"], error["calls_failed"]), ("error", None, None, 1))
        ok = stats(self.go(None, fake(), "off"))
        self.assertEqual((ok["status"], ok["reason"], ok["kept"]), ("ok", None, None))

    # -- コマンドから
    def run_main(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = build.main(list(argv))
        return rc, out.getvalue()

    def test_cli_reads_the_existing_out_file_and_keeps_its_ai_view(self):
        with tempfile.TemporaryDirectory() as t:
            o = Path(t) / "latest.json"
            build.write_json(o, self.prev)
            with mock.patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
                rc, out = self.run_main("--items", str(FIX / "items.json"), "--now", str(self.later), "--out", str(o))
            self.assertEqual(rc, 0)
            data = json.loads(o.read_text(encoding="utf-8"))
            stats = json.loads((Path(t) / "stats.json").read_text(encoding="utf-8"))
        self.assertEqual((data["ai_run"]["status"], data["ai_snapshot"]["ai_at"], data["generated_at"]), ("kept_previous", NOW, self.later))
        self.assertEqual((stats["ai"]["status"], stats["ai"]["reason"], stats["ai"]["kept"]["ai_at"]), ("kept_previous", "nokey", NOW))
        self.assertIn("ai status=kept_previous reason=nokey ai_calls=0 ai_calls_failed=0 ai_stories=0", out)
        self.assertIn("ai kept: answers made at", out)
        self.assertNotIn("試験", out)

    def test_cli_with_a_corrupt_or_missing_out_file_is_the_old_ai_off(self):
        for body in ("PREVIOUS", "", "{\"schema\": \"parallax/1\"", "[1, 2]", None):
            with tempfile.TemporaryDirectory() as t:
                o = Path(t) / "latest.json"
                if body is not None:
                    o.write_text(body, encoding="utf-8")
                with mock.patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
                    rc, out = self.run_main("--items", str(FIX / "items.json"), "--now", str(NOW), "--out", str(o))
                data = json.loads(o.read_text(encoding="utf-8"))
            self.assertEqual((rc, data["ai_run"]["status"], "ai_snapshot" in data), (0, "nokey", False), repr(body))
            self.assertIn("ai status=nokey reason=- ", out)

    def test_cli_refused_build_leaves_the_previous_file_and_its_snapshot(self):
        with tempfile.TemporaryDirectory() as t:
            o = Path(t) / "latest.json"
            build.write_json(o, self.prev)
            before = o.read_text(encoding="utf-8")
            with mock.patch.dict(os.environ, {"GEMINI_API_KEY": ""}), contextlib.redirect_stderr(io.StringIO()):
                rc, _ = self.run_main("--items", str(FIX / "items.json"), "--now", str(self.later), "--out", str(o), "--min-stories", "999")
            self.assertEqual(rc, 2)
            self.assertEqual(o.read_text(encoding="utf-8"), before)

    def test_a_failed_call_with_a_fake_key_keeps_and_the_key_is_never_printed(self):
        with tempfile.TemporaryDirectory() as t:
            o = Path(t) / "latest.json"
            build.write_json(o, self.prev)
            with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "TEST-KEY-NOT-REAL"}):
                with mock.patch.object(ai.GeminiProvider, "call", return_value=(None, "quota")):
                    rc, out = self.run_main("--items", str(FIX / "items.json"), "--now", str(self.later), "--out", str(o))
            data = json.loads(o.read_text(encoding="utf-8"))
        self.assertEqual((rc, data["ai_run"]["status"], data["ai_run"]["reason"]), (0, "kept_previous", "error"))
        self.assertEqual(set(data["ai_run"]["errors"]), {"quota"})
        self.assertIn("ai error quota:", out)
        self.assertNotIn("TEST-KEY", out + json.dumps(data))



def unique_focus(ans, doc):
    """どの angle の focus_ja も別の文字列にする（誰の焦点かを後で突き止められるように）。"""
    outlet = {it["id"]: it["outlet"] for b in doc["blocks"] for it in b["items"]}
    for b in ans["blocks"]:
        for s in b["stories"]:
            for a in s["angles"]:
                a["focus_ja"] = "焦点 %s %s" % (outlet[a["item_id"]], a["item_id"])


class WithholdFocus(unittest.TestCase):
    """CONTRACT §7。公開版は、利用条件が no の源の item に付く媒体ごとの焦点を出力から外す。束ねる処理には見出しを使い続ける。"""

    @classmethod
    def setUpClass(cls):
        snap = load_items()
        cls.items, cls.sources = snap["items"], snap["sources"]
        cls.local, _ = build.build(cls.items, cls.sources, NOW, 36, fake(unique_focus), "off", PROMPT, False)
        cls.public, _ = build.build(cls.items, cls.sources, NOW, 36, fake(unique_focus), "off", PROMPT, True)

    @staticmethod
    def focus_by_status(data):
        out = {}
        for s in data["stories"]:
            for a in (s["ai"] or {}).get("angles", []):
                out.setdefault(build.terms_status(data["items"][a["item_id"]]), set()).add(a["focus_ja"])
        return out

    def test_public_output_has_no_focus_of_a_no_source(self):
        loc, pub = self.focus_by_status(self.local), self.focus_by_status(self.public)
        self.assertGreaterEqual(len(loc.get("no", ())), 1)                    # 外す対象が fixture にある
        self.assertGreaterEqual(len(loc.get("nc", ())), 1)                    # nc（非商用のみ可）も外す対象（CONTRACT §7）
        self.assertNotIn("no", pub)
        self.assertNotIn("nc", pub)
        text = json.dumps(self.public, ensure_ascii=False)
        localtext = json.dumps(self.local, ensure_ascii=False)
        for f in loc["no"] | loc["nc"]:
            self.assertIn(f, localtext)                                        # local 版は今のまま
            self.assertNotIn(f, text, "公開版の出力に no / nc の源の焦点が残っている")
        for status in ("ok", "unknown"):                                        # no / nc 以外の源の焦点は今のまま
            self.assertEqual(pub.get(status), loc.get(status), status)
        self.assertGreaterEqual(len(pub.get("unknown", ())), 1)
        self.assertEqual(build.check_output(self.public), [])

    def test_the_event_level_text_stays_and_still_does_not_quote(self):
        by_sid = {s["sid"]: s for s in self.local["stories"]}
        hit = 0
        for s in self.public["stories"]:
            statuses = [build.terms_status(self.public["items"][i]) for i in s["member_ids"]]
            if s["ai"] and ("no" in statuses or "nc" in statuses):
                hit += 1
                mine, theirs = s["ai"], by_sid[s["sid"]]["ai"]
                for k in ("headline_ja", "headline_en", "contrast_ja", "flags", "flag_note_ja"):
                    self.assertEqual(mine[k], theirs[k], k)
                self.assertTrue(mine["headline_ja"])
                gone = [a["item_id"] for a in theirs["angles"] if build.terms_status(self.public["items"][a["item_id"]]) in ("no", "nc")]
                self.assertGreaterEqual(len(gone), 1)
                self.assertEqual([a["item_id"] for a in mine["angles"]],
                                 [a["item_id"] for a in theirs["angles"] if a["item_id"] not in gone])
                # 隠した item は媒体名・時刻・リンクだけ
                for i in gone:
                    self.assertIsNone(self.public["items"][i]["title"])
                    self.assertTrue(self.public["items"][i]["link"])
        self.assertGreaterEqual(hit, 1)
        self.assertEqual(self.public["ai_run"]["quoted_fields"], 0)

    def test_a_quote_of_a_no_source_headline_is_still_blanked(self):
        title = next(it["title"] for it in self.items if it.get("source_id") == "nhk-main")

        def edit(ans, doc):
            unique_focus(ans, doc)
            ans["blocks"][0]["stories"][0]["contrast_ja"] = "要点: " + title
            for b in ans["blocks"]:
                for s in b["stories"]:
                    if any(it["title"] == title for blk in doc["blocks"] if blk["bid"] == b["bid"] for it in blk["items"]
                           if it["id"] in s["member_ids"]):
                        s["headline_ja"] = title
        d, _ = build.build(self.items, self.sources, NOW, 36, fake(edit), "off", PROMPT, True)
        self.assertGreaterEqual(d["ai_run"]["quoted_fields"], 1)
        self.assertNotIn(title, json.dumps(d, ensure_ascii=False))

    def test_the_function_on_hand_made_stories(self):
        def it(src):
            return {"source_id": src}
        items = {"a": it("nhk-main"), "b": it("toyokeizai"), "c": it("mof"), "d": it("mainichi-flash"), "e": it("no-such-source")}
        mk = lambda ids: {"ai": {"angles": [{"item_id": i, "focus_ja": "焦点" + i} for i in ids], "contrast_ja": "全体"}}
        stories = [mk(["a"]), mk(["a", "b", "c", "d", "e"]), {"ai": None}, mk([])]
        self.assertEqual(build.withhold_no_source_focus(stories, items), 3)      # a（no）が 2 回、d（nc）が 1 回
        self.assertEqual([[a["item_id"] for a in s["ai"]["angles"]] for s in (stories[0], stories[1], stories[3])],
                         [[], ["b", "c", "e"], []])
        self.assertEqual(stories[0]["ai"]["contrast_ja"], "全体")               # 出来事全体の要約は残す
        self.assertEqual(build.withhold_no_source_focus(stories, items), 0)      # 二度掛けても同じ

    def test_check_output_refuses_a_public_file_that_carries_one(self):
        d = copy.deepcopy(self.public)
        for status in ("no", "nc"):
            dd = copy.deepcopy(d)
            no_item = next(i for i, it in dd["items"].items() if build.terms_status(it) == status
                           and any(i in s["member_ids"] and s["ai"] for s in dd["stories"]))
            st = next(s for s in dd["stories"] if no_item in s["member_ids"] and s["ai"])
            st["ai"]["angles"].append({"item_id": no_item, "focus_ja": "焦点 漏れ"})
            probs = build.check_output(dd)
            self.assertTrue(any("focus text" in p for p in probs), (status, probs))
            self.assertFalse(any("漏れ" in p for p in probs))
        loc = copy.deepcopy(self.local)                                        # local 版は対象外
        self.assertEqual(build.check_output(loc), [])

    # -- スナップショットの中でも
    def test_the_snapshot_is_cleaned_too(self):
        later = NOW + 3600
        with mock.patch.object(build, "withhold_no_source_focus", lambda *a: 0):
            old_public, _ = build.build(self.items, self.sources, NOW, 36, fake(unique_focus), "off", PROMPT, True)
        self.assertIn("no", self.focus_by_status(old_public))                   # 規則を入れる前の公開版を作った
        for prev, label in ((old_public, "old public file"), (self.local, "local file")):
            d, _ = build.build(self.items, self.sources, later, 36, None, "nokey", PROMPT, True, copy.deepcopy(prev))
            self.assertEqual(d["ai_run"]["status"], "kept_previous", label)
            kept = self.focus_by_status(d["ai_snapshot"])
            self.assertNotIn("no", kept, label)
            self.assertNotIn("nc", kept, label)
            self.assertGreaterEqual(len(kept.get("unknown", ())), 1, label)
            self.assertEqual(build.check_output(d), [], label)
            text = json.dumps(d, ensure_ascii=False)
            for f in self.focus_by_status(old_public)["no"]:
                self.assertNotIn(f, text, label)
        # 公開版を local の回が保っても、既に公開版の物は同じ規則で外す
        d, _ = build.build(self.items, self.sources, later, 36, None, "nokey", PROMPT, False, copy.deepcopy(old_public))
        self.assertNotIn("no", self.focus_by_status(d["ai_snapshot"]))
        self.assertNotIn("nc", self.focus_by_status(d["ai_snapshot"]))
        # 外し忘れたスナップショットは書く前の検査が止める（no も nc も）
        for status in ("no", "nc"):
            bad = copy.deepcopy(d)
            sn_no = next(i for i, it in bad["ai_snapshot"]["items"].items() if build.terms_status(it) == status)
            bad["ai_snapshot"]["stories"][0]["ai"]["angles"].append({"item_id": sn_no, "focus_ja": "焦点 漏れ"})
            self.assertTrue(any("snapshot carries" in p and "focus" in p for p in build.check_output(bad)), status)


if __name__ == "__main__":
    unittest.main()
