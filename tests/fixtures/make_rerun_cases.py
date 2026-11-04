# -*- coding: utf-8 -*-
"""tests/fixtures/rerun_cases.json を作る。js/rerun.js（頁の BYOK）が Python の build と同じ stories を組むことを試験する表。

    python tests/fixtures/make_rerun_cases.py

base = 合成の取得を AI なしで組んだ local 版（要求は 1 回に 5 件までに詰め直して複数回にする）。public_base = 同じ取得の公開版。
各 case = その base に、同じ答えを順に返す偽の provider を当てた時の Python の結果（expect）。
expect には見出しを含めない（合成の見出し「試験」だけだが、公開版の試験は別に行う）。basis は JS が写すか null なので別に突き合わせる。
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent.parent))

from helpers import NOW, build, load_items, load_prompt, rules_answer, doc_of  # noqa: E402
from parallax import ai  # noqa: E402

PROMPT = load_prompt()
build.pack.__defaults__ = (5, 8)               # 詰める上限を小さくして、要求が複数回になるようにする


def fixture_build(provider, public=False):
    snap = load_items()
    data, _ = build.build(snap["items"], snap["sources"], NOW, 36, provider, "off", PROMPT, public)
    return data


def title_of(dblk, alias):
    for it in dblk["items"]:
        if it["id"] == alias:
            return it["title"]
    return ""


def edit_echo(ans, doc):
    pass


def edit_merge_split(ans, doc):
    for blk, dblk in zip(ans["blocks"], doc["blocks"]):
        groups = dblk["rule_groups"]
        s0 = blk["stories"][0]

        def one(ids, tag):
            return dict(s0, member_ids=list(ids), headline_ja="試験 %s %s" % (tag, blk["bid"]),
                        angles=[{"item_id": a, "focus_ja": "試験の焦点"} for a in ids])
        if len(groups) >= 2:
            blk["stories"] = [one([a for g in groups for a in g], "併合")]
        elif len(groups[0]) >= 2:
            blk["stories"] = [one([a], "分割") for a in groups[0]]


def edit_dirty(ans, doc):
    for blk, dblk in zip(ans["blocks"], doc["blocks"]):
        k = int(blk["bid"][1:]) - 1                       # 塊の番号で振る（要求の中の位置では偏る）
        stories = blk["stories"]
        if k % 4 == 0:                                    # id の捏造
            stories[0]["member_ids"] = stories[0]["member_ids"] + ["n999", "zzz"]
        elif k % 4 == 1:                                  # 重複
            stories.append(dict(stories[0]))
        elif k % 4 == 2:                                  # 取りこぼし
            stories[0]["member_ids"] = stories[0]["member_ids"][1:]
        else:                                             # 見出しの丸写し（両方 -> 規則へ）と、対比文の丸写し
            first = stories[0]["member_ids"][0]
            t = title_of(dblk, first)
            stories[0]["headline_ja"] = t
            stories[0]["headline_en"] = t
            if len(stories) > 1:
                stories[1]["contrast_ja"] = "報じ方: " + title_of(dblk, stories[1]["member_ids"][0])
        for st in stories:                                # 札は全部付けて、規則の拒否を起こさせる
            st["flags"] = ["overseas_only", "jp_main_not_found", "primary_only", "bogus"]
            st["flag_note_ja"] = "試験の注記"


def edit_garbage(ans, doc):
    ans["blocks"].append({"bid": "b99", "stories": []})              # 頼んでいない塊
    ans["blocks"] = ans["blocks"][1:]                                # 先頭の塊を答えから落とす（規則へ戻る）


def make_case(name, edit, fail=None, broken=None):
    """fail: {call index: error code}、broken: {call index: 壊れた生の文字列}"""
    fail, broken = fail or {}, broken or {}
    answers, n = [], [0]

    def responder(system, user_text, schema):
        i = n[0]
        n[0] += 1
        if i in fail:
            answers.append({"err": fail[i]})
            raise ai.FakeError(fail[i])
        raw = broken[i] if i in broken else rules_answer(user_text, edit)
        answers.append({"raw": raw})
        return raw

    data = fixture_build(ai.FakeProvider(responder))
    run = data["ai_run"]
    keys = ("status", "calls", "calls_failed", "errors", "blocks_sent", "blocks_ok", "dropped_ids", "dup_ids",
            "unassigned_ids", "merges", "splits", "flags_vetoed", "quoted_fields", "prompt_version")
    return {"name": name, "answers": answers,
            "expect": {"blocks": data["blocks"],
                       "stories": [{k: v for k, v in s.items() if k != "basis"} for s in data["stories"]],
                       "basis": {s["sid"]: s["basis"] for s in data["stories"] if s["basis"]},
                       "ai_run": {k: run[k] for k in keys}}}


def main():
    base = fixture_build(None)
    assert len(base["ai_requests"]) >= 3, "the fixture should be split into several calls"
    cases = [
        make_case("rules_echo", edit_echo),
        make_case("merge_and_split", edit_merge_split),
        make_case("dirty_answers", edit_dirty),
        make_case("one_call_quota", edit_echo, fail={0: "quota"}),
        make_case("one_call_broken_json", edit_merge_split, broken={1: '{"blocks": [ {"bid": "b0'}),
        make_case("answer_without_first_block_and_unknown_block", edit_garbage),
        make_case("every_call_fails", edit_echo, fail={0: "network", 1: "http", 2: "timeout", 3: "auth", 4: "blocked"}),
    ]
    for c in cases:
        c["answers"] = c["answers"] or []
    p = HERE / "rerun_cases.json"
    public_base = fixture_build(None, public=True)
    p.write_text(json.dumps({"base": base, "public_base": public_base, "cases": cases}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("wrote", p, len(cases), "cases,", len(base["ai_requests"]), "calls per run")


if __name__ == "__main__":
    main()
