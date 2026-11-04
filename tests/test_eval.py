# -*- coding: utf-8 -*-
"""eval.py の試験。偽の答え（失敗を仕込んだ物）を数え直して、数が仕込んだ数と合うことを確かめる。"""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from helpers import FIX, NOW, ai, build, fake, load_items, load_prompt, rules_answer
from parallax import eval as ev

PROMPT = load_prompt()
MADE = NOW + 100


def run(provider):
    snap = load_items()
    return ev.run_eval(snap["items"], snap["sources"], NOW, 36, provider, PROMPT, MADE)


def recorded(edit=None, drop=False):
    """build の要求に対する答えを記録済みの形にして返す（RecordedProvider）。"""
    snap = load_items()
    _, reqs = build.build(snap["items"], snap["sources"], NOW, 36, None, "off", PROMPT, False)
    dump = build.dump_requests(reqs, PROMPT)
    resp = {} if drop else {r["sha256"]: rules_answer(r["user_text"], edit) for r in dump["requests"]}
    return ai.RecordedProvider({"provider": "claude-recorded", "model": "claude-test", "made_at": NOW - 5,
                                "note_ja": "試験用の偽の答え", "responses": resp})


class Eval(unittest.TestCase):
    def test_clean_run(self):
        r = run(recorded())
        self.assertEqual(r["schema"], "parallax-eval/1")
        self.assertEqual(r["made_at"], MADE)
        self.assertEqual(r["run"], {"provider": "claude-recorded", "model": "claude-test", "recorded_at": NOW - 5,
                                    "note_ja": "試験用の偽の答え"})
        c = r["counts"]
        for k in ("fabricated_ids", "dup_ids", "unassigned_ids", "json_broken", "shape_broken", "answers_missing",
                  "flags_vetoed", "quoted_fields", "suspect_merges_veto", "suspect_merges_no_shared", "calls_failed",
                  "merged_stories", "place_misread_known"):
            self.assertEqual(c[k], 0, k)
        self.assertEqual((c["calls"], c["blocks_sent"], c["blocks_answered"]), (1, 6, 6))
        self.assertEqual(r["input"], {"items_in_window": 16, "rule_clusters": 9, "blocks_sent": 6, "calls": 1})
        self.assertEqual(r["human"], {"reviewed": None, "wrong_merges": None, "wrong_splits": None,
                                       "wrong_places": None, "note_ja": ""})
        self.assertEqual(r["suspect_merges"], [])
        self.assertEqual(r["place_misreads"], [])

    def test_injected_failures_are_counted(self):
        def edit(ans, doc):
            for b in ans["blocks"]:
                st = b["stories"]
                st[0]["member_ids"] += ["n999"]                        # 捏造 1
                st.append(dict(st[0], member_ids=[st[0]["member_ids"][0]]))   # 重複 1
                st[0]["flags"] = ["overseas_only", "primary_only"]
                st[0]["flag_note_ja"] = "試験"
                if len(st) > 2:
                    del st[1]                                           # 取りこぼし（その束の分）
            ans["blocks"][0]["stories"][0]["headline_ja"] = doc["blocks"][0]["items"][0]["title"]   # 丸写し 1
        r = run(recorded(edit))
        c = r["counts"]
        self.assertEqual(c["fabricated_ids"], 6)
        self.assertEqual(c["dup_ids"], 6)
        self.assertEqual(c["quoted_fields"], 1)
        self.assertGreater(c["unassigned_ids"], 0)
        self.assertEqual(c["flags_proposed"], 12)
        self.assertGreater(c["flags_vetoed"], 0)
        self.assertLessEqual(c["flags_vetoed"], c["flags_proposed"])
        self.assertEqual((c["json_broken"], c["answers_missing"]), (0, 0))

    def test_json_broken_and_missing_are_counted_and_unjudged_counts_are_null(self):
        r = run(ai.FakeProvider(lambda *a: "{broken"))
        c = r["counts"]
        self.assertEqual((c["json_broken"], c["calls_failed"], c["blocks_answered"]), (1, 1, 0))
        for k in ("fabricated_ids", "dup_ids", "unassigned_ids", "flags_proposed", "flags_vetoed", "quoted_fields",
                  "suspect_merges_veto", "suspect_merges_no_shared", "place_misread_known", "ai_stories",
                  "merged_stories"):
            self.assertIsNone(c[k], k)                                  # 判定していない物は 0 でなく null
        r = run(ai.FakeProvider(lambda *a: '{"x": 1}'))
        self.assertEqual((r["counts"]["shape_broken"], r["counts"]["json_broken"]), (1, 0))
        r = run(recorded(drop=True))
        self.assertEqual((r["counts"]["answers_missing"], r["counts"]["calls_failed"]), (1, 1))
        self.assertIsNone(r["counts"]["fabricated_ids"])
        self.assertEqual(r["human"]["reviewed"], None)

    def test_merged_story_is_listed_as_a_suspect_for_a_person_to_check(self):
        def edit(ans, doc):
            for b in ans["blocks"]:
                if len(b["stories"]) == 3:
                    ids = [a for s in b["stories"] for a in s["member_ids"]]
                    b["stories"] = [dict(b["stories"][0], member_ids=ids)]
        r = run(recorded(edit))
        self.assertEqual(r["counts"]["merged_stories"], 1)
        self.assertEqual(r["counts"]["ai_stories"], 6)                 # 8 本のうち b02 の三束が一つになる
        for s in r["suspect_merges"]:
            self.assertEqual(s["rule_cids"], 3)
            self.assertTrue(s["veto"] or s["no_shared"])
        self.assertEqual(r["counts"]["suspect_merges_veto"], sum(1 for s in r["suspect_merges"] if s["veto"]))

    def test_suspect_merges_unit(self):
        mk = lambda i, t, o: {"id": i, "title": t, "outlet": o, "ts": NOW}
        items = {"a": mk("a", "試験 群馬県で出来事A 試験の発表", "O1"), "b": mk("b", "試験 栃木県で出来事A 試験の発表", "O2"),
                 "c": mk("c", "試験 群馬県で出来事B 試験の発表", "O3"), "d": mk("d", "試験 群馬県で出来事B 試験の公表", "O4")}
        rcs = [{"cid": "c1", "member_ids": ["a"]}, {"cid": "c2", "member_ids": ["b"]}, {"cid": "c3", "member_ids": ["c", "d"]}]
        story = lambda sid, ids, cids, basis: {"sid": sid, "bid": "b01", "origin": "ai", "member_ids": ids, "rule_cids": cids,
                                              "basis": basis}
        stories = [story("s1", ["a", "b"], ["c1", "c2"], {"words": ["試験"], "places": []}),     # 群馬と栃木: 拒否
                   story("s2", ["a", "c"], ["c1", "c3"], {"words": ["試験"], "places": ["群馬"]}),    # 同じ県: 疑いなし
                   story("s3", ["a", "c"], ["c1", "c3"], {"words": [], "places": []}),                # 共通の語が無い
                   {"sid": "s4", "bid": None, "origin": "rule", "member_ids": ["a"], "rule_cids": ["c1"], "basis": None}]
        out = ev.suspect_merges(stories, rcs, items)
        by = {x["sid"]: x for x in out}
        self.assertEqual(set(by), {"s1", "s3"})
        self.assertTrue(by["s1"]["veto"] and not by["s1"]["no_shared"])
        self.assertTrue(by["s3"]["no_shared"])
        self.assertTrue(all(len(v) <= 80 for x in out for v in x["veto"]))

    def test_place_misread_known_counts_only_the_listed_trap(self):
        """既知の誤りの型（「米中間選挙」の「米中」を中国に当てる）が札として残っていれば数える。一覧に無い物は数えない。"""
        from unittest import mock
        from parallax import cluster, sources

        def mk(sid, title, minutes_ago, key):
            s = sources.by_id(sid)
            it = {"title": title, "link": "https://test.invalid/%s/%s" % (sid, key), "outlet": s["outlet"], "source_id": sid,
                  "type": s["type"], "home": s["home"], "lang": s["lang"], "ts": NOW - minutes_ago * 60}
            it["id"] = sources.item_id(it)
            return it

        def stories_for(topic, traps=None):
            its = [mk("tbs", "試験 %s 試験委員会が試験案を決定" % topic, 50, "m1"),
                   mk("mainichi-flash", "試験 %s 試験委員会 試験案を決定した" % topic, 40, "m2")]
            ctx = mock.patch.object(cluster, "PLACE_TRAPS", traps) if traps is not None else mock.patch.object(cluster, "GATE_ON", True)
            with ctx:                                                     # 直す前の取り出しを再現する時だけ一覧を空にする
                d, _ = build.build(its, [], NOW, 36, fake(), "off", PROMPT, False)
            return d

        d = stories_for("米中間選挙")
        self.assertEqual(ev.place_misreads(d["stories"], d["items"]), [])
        old = stories_for("米中間選挙", {})                                  # 直す前: 中国の札が付く
        self.assertEqual(old["stories"][0]["basis"]["places"], ["CN", "US"])
        found = ev.place_misreads(old["stories"], old["items"])
        self.assertEqual(found, [{"sid": old["stories"][0]["sid"], "label": "CN"}])
        d = stories_for("米中露の試験会談", {})                              # 本当に米国と中国の話は誤りに数えない
        self.assertEqual(d["stories"][0]["basis"]["places"], ["CN", "US"])
        self.assertEqual(ev.place_misreads(d["stories"], d["items"]), [])

    def test_cli_writes_counts_without_headlines(self):
        rec = recorded()
        with tempfile.TemporaryDirectory() as t:
            rp, op = Path(t) / "rec.json", Path(t) / "eval.json"
            rp.write_text(json.dumps({"provider": "claude-recorded", "model": "claude-test", "made_at": NOW - 5, "note_ja": "n",
                                      "responses": rec._responses}, ensure_ascii=False), encoding="utf-8")
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(ev.main(["--items", str(FIX / "items.json"), "--responses", str(rp), "--out", str(op),
                                          "--made-at", str(MADE)]), 0)
            text = op.read_text(encoding="utf-8")
        d = json.loads(text)
        self.assertEqual((d["made_at"], d["counts"]["blocks_answered"]), (MADE, 6))
        for it in load_items()["items"]:
            self.assertNotIn(it["title"], text)                         # 見出しは書かない
        self.assertIn("eval:", out.getvalue())


if __name__ == "__main__":
    unittest.main()
