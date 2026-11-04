# -*- coding: utf-8 -*-
"""tests/fixtures/validate_cases.json を作る。Python の validate と js/validate.js が同じ表を読む。

    python tests/fixtures/make_validate_cases.py

各 case = {name, request, raw, items, expect}。expect は手で書いた期待値（validate の出力を写していない）。
見出しは合成（「試験」「Test」）。prompt は data/prompt.json をそのまま使う（limits・flags）。"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

ITEMS = {
    "i1": {"id": "i1", "title": 'Test Event A: the test committee decides the test plan', "outlet": "BBC", "home": "intl", "type": "海外公共", "lang": "en"},
    "i2": {"id": "i2", "title": 'The test committee has decided a test plan for Test Event A', "outlet": "The Guardian", "home": "intl", "type": "海外主流", "lang": "en"},
    "i3": {"id": "i3", "title": '試験 出来事A 試験委員会が試験案を決定した', "outlet": "NHK", "home": "jp", "type": "公共放送", "lang": "ja"},
    "i4": {"id": "i4", "title": '試験 出来事C 財務省が試験の公表を行った', "outlet": "財務省", "home": "jp", "type": "政府一次", "lang": "ja"},
    "i5": {"id": "i5", "title": '試験 出来事C 総務省が試験の公表を行った', "outlet": "総務省", "home": "jp", "type": "政府一次", "lang": "ja"},
    "i6": {"id": "i6", "title": 'Test Event C: Federal Reserve test statement released', "outlet": "Federal Reserve", "home": "intl", "type": "政府一次", "lang": "en"},
    "i7": {"id": "i7", "title": 'Test Event A: test committee approves the test plan, Al Jazeera', "outlet": "Al Jazeera", "home": "intl", "type": "国家メディア", "lang": "en"},
}


def req(blocks):
    """blocks: [(bid, [(alias, item_id)], rule_groups)] -> ai_requests の一件"""
    alias, doc_blocks = {}, []
    for bid, pairs, groups in blocks:
        its = []
        for a, iid in pairs:
            alias[a] = iid
            it = ITEMS[iid]
            its.append({"id": a, "outlet": it["outlet"], "home": it["home"], "lang": it["lang"], "type": it["type"],
                        "title": ITEMS[iid]["title"]})
        doc_blocks.append({"bid": bid, "rule_groups": groups, "items": its})
    return {"rid": "r1", "bids": [b[0] for b in blocks], "alias": alias,
            "doc": json.dumps({"blocks": doc_blocks}, ensure_ascii=False, separators=(",", ":"))}


# 基本の要求: b01 = BBC, Guardian, NHK / b02 = 財務省, 総務省
BASE = req([("b01", [("n1", "i1"), ("n2", "i2"), ("n3", "i3")], [["n1", "n2"], ["n3"]]),
            ("b02", [("n4", "i4"), ("n5", "i5")], [["n4", "n5"]])])
# 一本だけの要求: b01 = BBC, Guardian, Al Jazeera（海外のみ）
INTL = req([("b01", [("n1", "i1"), ("n2", "i2"), ("n3", "i7")], [["n1", "n2", "n3"]])])
# 海外の政府一次 + 日本の政府一次
GOV = req([("b01", [("n1", "i4"), ("n2", "i6")], [["n1"], ["n2"]])])


def st(ids, hja="試験 題JA", hen="Test event line", angles=None, contrast="", flags=None, note=""):
    return {"member_ids": ids, "headline_ja": hja, "headline_en": hen,
            "angles": [{"item_id": a, "focus_ja": f} for a, f in (angles or [])],
            "contrast_ja": contrast, "flags": flags or [], "flag_note_ja": note}


def ans(*blocks):
    return json.dumps({"blocks": [{"bid": b, "stories": s} for b, s in blocks]}, ensure_ascii=True)


def ex_ai(hja="試験 題JA", hen="Test event line", angles=None, contrast="", flags=None, dropped=None, note=""):
    return {"headline_ja": hja, "headline_en": hen,
            "angles": [{"item_id": a, "focus_ja": f} for a, f in (angles or [])],
            "contrast_ja": contrast, "flags": flags or [], "flags_dropped": dropped or [], "flag_note_ja": note}


def ex(blocks, dropped=0, dup=0, unassigned=0, vetoed=0, quoted=0, errors=None, report=0, silence=0):
    return {"blocks": blocks, "counts": {"dropped_ids": dropped, "dup_ids": dup, "unassigned_ids": unassigned,
                                         "flags_vetoed": vetoed, "quoted_fields": quoted, "report_words": report, "silence_words": silence},
            "errors": errors or []}


def ai_story(ids, ai):
    return {"member_ids": ids, "origin": "ai", "ai": ai}


def rule_story(ids):
    return {"member_ids": ids, "origin": "rule", "ai": None}


CASES = []


def case(name, request, raw, expect, items=None):
    CASES.append({"name": name, "request": request, "raw": raw, "items": items or ITEMS, "expect": expect})


# 1. 基本
case("ok_basic", BASE,
     ans(("b01", [st(["n1", "n2"], angles=[("n1", "焦点1"), ("n2", "焦点2")], contrast="試験の対比"), st(["n3"])]),
         ("b02", [st(["n4", "n5"], flags=["primary_only"], note="全て政府一次")])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(angles=[("i1", "焦点1"), ("i2", "焦点2")], contrast="試験の対比")),
                 ai_story(["i3"], ex_ai())],
         "b02": [ai_story(["i4", "i5"], ex_ai(flags=["primary_only"], note="全て政府一次"))]}))

# 2. id の捏造（別の塊の別名・存在しない別名・文字列でない値）
case("fabricated_ids", BASE,
     ans(("b01", [st(["n1", "n99", "n4", 5, None, "n2"]), st(["zzz", "n5"])]), ("b02", [st(["n4"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai()), rule_story(["i3"])],
         "b02": [ai_story(["i4"], ex_ai()), rule_story(["i5"])]},
        dropped=6, unassigned=2))

# 3. 重複（先勝ち）
case("duplicate_ids", BASE,
     ans(("b01", [st(["n1", "n2"]), st(["n2", "n3"]), st(["n1"])]), ("b02", [st(["n4", "n4", "n5"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai()), ai_story(["i3"], ex_ai())],
         "b02": [ai_story(["i4", "i5"], ex_ai())]},
        dup=3))

# 4. 取りこぼし（規則の束ごとに残る）
case("unassigned_ids", BASE,
     ans(("b01", [st(["n1"])]), ("b02", [st(["n5"])])),
     ex({"b01": [ai_story(["i1"], ex_ai()), rule_story(["i2"]), rule_story(["i3"])],
         "b02": [ai_story(["i5"], ex_ai()), rule_story(["i4"])]},
        unassigned=3))

case("unassigned_group_stays_together", BASE,
     ans(("b01", [st(["n3"])]), ("b02", [st(["n4", "n5"])])),
     ex({"b01": [ai_story(["i3"], ex_ai()), rule_story(["i1", "i2"])],
         "b02": [ai_story(["i4", "i5"], ex_ai())]},
        unassigned=2))

# 5. JSON 崩れ・形の崩れ
case("json_broken", BASE, '{"blocks": [ {"bid": "b01", "stories": [', ex({}, errors=["json"]))
case("json_empty", BASE, "", ex({}, errors=["json"]))
case("shape_no_blocks", BASE, '{"foo": 1}', ex({}, errors=["shape"]))
case("shape_array", BASE, "[]", ex({}, errors=["shape"]))
case("shape_blocks_not_list", BASE, '{"blocks": {"bid": "b01"}}', ex({}, errors=["shape"]))
case("fence_stripped", BASE, "```json\n" + ans(("b02", [st(["n4", "n5"])])) + "\n```",
     ex({"b02": [ai_story(["i4", "i5"], ex_ai())]}))

# 6. bid
case("unknown_bid_ignored_and_missing_falls_back", BASE,
     ans(("b99", [st(["n1"])]), ("b02", [st(["n4", "n5"])])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai())]}))
case("duplicate_bid_first_wins", BASE,
     ans(("b02", [st(["n4", "n5"], hja="試験 一つ目")]), ("b02", [st(["n4"], hja="試験 二つ目"), st(["n5"])])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(hja="試験 一つ目"))]}))

# 7. 札の拒否（規則が最後に決める）
case("flag_vetoes", BASE,
     ans(("b01", [st(["n1", "n2", "n3"], flags=["overseas_only", "jp_main_not_found", "primary_only"], note="試験の注記")]),
         ("b02", [st(["n4"], flags=["primary_only", "primary_only", "bogus"], note="政府一次のみ"), st(["n5"])])),
     ex({"b01": [ai_story(["i1", "i2", "i3"], ex_ai(dropped=[
                     {"flag": "overseas_only", "why": "has_jp_outlet"},
                     {"flag": "jp_main_not_found", "why": "has_jp_mainstream"},
                     {"flag": "primary_only", "why": "has_non_primary"}]))],
         "b02": [ai_story(["i4"], ex_ai(flags=["primary_only"], note="政府一次のみ")), ai_story(["i5"], ex_ai())]},
        vetoed=3))
case("flag_overseas_only_and_silent_kept", INTL,
     ans(("b01", [st(["n1", "n2", "n3"], flags=["overseas_only", "jp_main_not_found"], note="海外の三媒体のみ")])),
     ex({"b01": [ai_story(["i1", "i2", "i7"], ex_ai(flags=["overseas_only", "jp_main_not_found"], note="海外の三媒体のみ"))]}))
case("flag_jp_main_not_found_single_outlet", INTL,
     ans(("b01", [st(["n1"], flags=["jp_main_not_found"], note="試験"), st(["n2", "n3"])])),
     ex({"b01": [ai_story(["i1"], ex_ai(dropped=[{"flag": "jp_main_not_found", "why": "single_outlet"}])),
                 ai_story(["i2", "i7"], ex_ai())]},
        vetoed=1))
case("flag_primary_only_mixed_home", GOV,
     ans(("b01", [st(["n1", "n2"], flags=["primary_only", "overseas_only"], note="試験の注記")])),
     ex({"b01": [ai_story(["i4", "i6"], ex_ai(flags=["primary_only"], note="試験の注記",
                                              dropped=[{"flag": "overseas_only", "why": "has_jp_outlet"}]))]},
        vetoed=1))

# 8. 見出し（空の headline_ja は見出しで埋めない）
case("headline_ja_empty_keeps_english", BASE,
     ans(("b02", [st(["n4", "n5"], hja="  ", hen="Test event line only")])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(hja="", hen="Test event line only"))]}))
case("headline_both_empty_goes_to_rules", BASE,
     ans(("b01", [st(["n1", "n2"], hja="", hen=""), st(["n3"])]), ("b02", [st(["n4", "n5"], hja=None, hen=7)])),
     ex({"b01": [ai_story(["i3"], ex_ai()), rule_story(["i1", "i2"])],
         "b02": [rule_story(["i4", "i5"])]},
        unassigned=4))

# 9. 文字列の掃除・長さ（コードポイント）
case("strings_cleaned_and_cut", BASE,
     ans(("b02", [st(["n4", "n5"], hja="あ" * 61, hen="e" * 91, contrast="対" * 121,
                     angles=[("n4", "焦" * 41), ("n5", "試験\u0000見出し​‮  末尾\n\t続き")],
                     flags=["primary_only"], note="注" * 81)])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(
         hja="あ" * 59 + "…", hen="e" * 89 + "…", contrast="対" * 119 + "…",
         angles=[("i4", "焦" * 39 + "…"), ("i5", "試験見出し 末尾 続き")],
         flags=["primary_only"], note="注" * 79 + "…"))]}))
case("strings_non_bmp_counted_in_code_points", BASE,
     ans(("b02", [st(["n4", "n5"], hja="\U00020bb7" * 61)])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(hja="\U00020bb7" * 59 + "…"))]}))
case("strings_not_strings_become_empty", BASE,
     json.dumps({"blocks": [{"bid": "b02", "stories": [{
         "member_ids": ["n4", "n5"], "headline_ja": 5, "headline_en": "Test event line", "angles": [
             {"item_id": "n4", "focus_ja": None}, {"item_id": "n5", "focus_ja": ["x"]}],
         "contrast_ja": {"a": 1}, "flags": "primary_only", "flag_note_ja": 3}]}]}),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(hja="", hen="Test event line"))]}))
case("strings_space_around_removed_chars", BASE,
     ans(("b02", [st(["n4", "n5"], hja="試験 ​ 題 \ud800 末尾")])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(hja="試験 題 末尾"))]}))

# 10. angles
case("angles_rules", BASE,
     ans(("b01", [st(["n1", "n2"], angles=[("n3", "別の話の焦点"), ("n1", "焦点A"), ("n1", "焦点B"), ("n2", "   ")]),
                  st(["n3"], angles=[("n2", "他の話の焦点")])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(angles=[("i1", "焦点A")])), ai_story(["i3"], ex_ai())]}))
case("empty_first_angle_still_counts_as_first", BASE,
     ans(("b02", [st(["n4", "n5"], angles=[("n4", ""), ("n4", "二つ目は採らない"), ("n5", "焦点5")])])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(angles=[("i5", "焦点5")]))]}))

# 11. 構造の崩れに耐える
case("garbage_entries_survive", BASE,
     json.dumps({"blocks": [1, None, "x", {"bid": 5}, {"bid": "b02", "stories": "no"},
                            {"bid": "b01", "stories": [7, {"member_ids": "n1"}, {"member_ids": ["n3"],
                                                                                     "headline_ja": "試験 題JA"}]}]}),
     ex({"b02": [rule_story(["i4", "i5"])],
         "b01": [ai_story(["i3"], ex_ai(hen="")), rule_story(["i1", "i2"])]},
        unassigned=4))

# 12. 引用検査（見出しの丸写しは空にする）
case("quote_headline_blanked", BASE,
     ans(("b02", [st(["n4", "n5"], hja=ITEMS["i4"]["title"], hen="Test event line")])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(hja="", hen="Test event line"))]}, quoted=1))
case("quote_both_headlines_goes_to_rules", BASE,
     ans(("b02", [st(["n4", "n5"], hja=ITEMS["i4"]["title"], hen=ITEMS["i5"]["title"])])),
     ex({"b02": [rule_story(["i4", "i5"])]}, unassigned=2, quoted=2))
case("quote_inside_longer_text", BASE,
     ans(("b01", [st(["n1", "n2"], contrast="報道: " + ITEMS["i1"]["title"] + " と伝えた"), st(["n3"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(contrast="")), ai_story(["i3"], ex_ai())]}, quoted=1))
case("quote_truncated_copy", BASE,
     ans(("b01", [st(["n1", "n2"], hen=ITEMS["i1"]["title"][:30]), st(["n3"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(hen="")), ai_story(["i3"], ex_ai())]}, quoted=1))
case("quote_case_width_and_punctuation_folded", BASE,
     ans(("b01", [st(["n1", "n2"], hen=ITEMS["i1"]["title"].upper().replace(":", " -")), st(["n3"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(hen="")), ai_story(["i3"], ex_ai())]}, quoted=1))
case("quote_only_the_block_is_checked", BASE,
     ans(("b01", [st(["n1", "n2"], hja=ITEMS["i4"]["title"]), st(["n3"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(hja=ITEMS["i4"]["title"])), ai_story(["i3"], ex_ai())]}))
case("quote_angle_dropped", BASE,
     ans(("b02", [st(["n4", "n5"], angles=[("n4", ITEMS["i4"]["title"]), ("n5", "焦点5")])])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(angles=[("i5", "焦点5")]))]}, quoted=1))
case("quote_flag_note_blanked", BASE,
     ans(("b02", [st(["n4", "n5"], flags=["primary_only"], note=ITEMS["i5"]["title"])])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(flags=["primary_only"], note=""))]}, quoted=1))
case("quote_paraphrase_passes", BASE,
     ans(("b01", [st(["n1", "n2"]), st(["n3"], hja="試験委員会が試験案を決めた")])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai()), ai_story(["i3"], ex_ai(hja="試験委員会が試験案を決めた"))]}))
_null = {k: dict(v) for k, v in ITEMS.items()}
_null["i4"]["title"] = None                               # 公開版で隠した見出し: 丸写しは見分けられない（引用検査は載っている見出しだけ）
case("quote_null_titles_are_skipped", BASE,
     ans(("b02", [st(["n4", "n5"], hja=ITEMS["i4"]["title"])])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(hja=ITEMS["i4"]["title"]))]}), items=_null)
_short = {k: dict(v) for k, v in ITEMS.items()}
_short["i4"]["title"] = "試験速報"                          # 折り畳み後 10 字未満の見出しは検査しない
case("quote_short_fields_are_not_copies", BASE,
     ans(("b02", [st(["n4", "n5"], hja="試験", hen="Test event line", note="試験")])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(hja="試験"))]}))
case("quote_short_titles_are_skipped", BASE,
     ans(("b02", [st(["n4", "n5"], hja="試験速報")])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(hja="試験速報"))]}), items=_short)

# 境界: 折り畳み後ちょうど 10 字の見出しの丸写しは空にし、9 字なら残す
_ten = {k: dict(v) for k, v in ITEMS.items()}
_ten["i4"]["title"] = "試験速報一二三四五六"
case("quote_boundary_ten_characters_is_a_copy", BASE,
     ans(("b02", [st(["n4", "n5"], hja=_ten["i4"]["title"], hen="Test event line")])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(hja="", hen="Test event line"))]}, quoted=1), items=_ten)
_nine = {k: dict(v) for k, v in ITEMS.items()}
_nine["i4"]["title"] = "試験速報一二三四五"
case("quote_boundary_nine_characters_is_not", BASE,
     ans(("b02", [st(["n4", "n5"], hja=_nine["i4"]["title"], hen="Test event line")])),
     ex({"b02": [ai_story(["i4", "i5"], ex_ai(hja=_nine["i4"]["title"], hen="Test event line"))]}), items=_nine)

# 題は事実の叙述に限る（CONTRACT §4.6）: 報じ方の語を含む題は空にし、両方空なら規則の表示へ
case("report_word_ja_blanks_the_japanese_headline", BASE,
     ans(("b01", [st(["n1", "n2"], hja="試験委員会の決定が報道された"), st(["n3"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(hja="")), ai_story(["i3"], ex_ai())]}, report=1))
case("report_word_en_blanks_the_english_headline", BASE,
     ans(("b01", [st(["n1", "n2"], hen="Some reports cite only the test plan"), st(["n3"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(hen="")), ai_story(["i3"], ex_ai())]}, report=1))
case("report_words_in_both_headlines_go_to_rules", BASE,
     ans(("b01", [st(["n1", "n2"], hja="見出しは試験案に触れている", hen="Headlines stress the plan"), st(["n3"])])),
     ex({"b01": [ai_story(["i3"], ex_ai()), rule_story(["i1", "i2"])]}, unassigned=2, report=2))
case("report_allowed_form_is_kept", BASE,
     ans(("b01", [st(["n1", "n2"], hja="試験案が可決されたと報じられている", hen="The test plan was reportedly approved"), st(["n3"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(hja="試験案が可決されたと報じられている", hen="The test plan was reportedly approved")),
                 ai_story(["i3"], ex_ai())]}))
case("report_allowed_form_does_not_excuse_another_word", BASE,
     ans(("b01", [st(["n1", "n2"], hja="試験案が可決されたと報じられている。強調された点は予算", hen="Test event line"), st(["n3"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(hja="")), ai_story(["i3"], ex_ai())]}, report=1))
case("report_word_is_found_after_nfkc_and_case_folding", BASE,
     ans(("b01", [st(["n1", "n2"], hen="ＲＥＰＯＲＴＳ say the plan passed"), st(["n3"], hen="Headliner wins a test prize")])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(hen="")), ai_story(["i3"], ex_ai(hen="Headliner wins a test prize"))]}, report=1))
case("report_words_are_not_checked_in_other_fields", BASE,
     ans(("b01", [st(["n1", "n2"], contrast="一方は報道の量を、他方は数を前に出している", angles=[("n1", "見出しの順序を重視")]), st(["n3"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(contrast="一方は報道の量を、他方は数を前に出している", angles=[("i1", "見出しの順序を重視")])),
                 ai_story(["i3"], ex_ai())]}))


# 「報じなかった」系の語は mode に関わらず落とす（CONTRACT §4.7）
case("silence_word_blanks_the_contrast", BASE,
     ans(("b01", [st(["n1", "n2"], contrast="一方は報じなかった点を挙げている"), st(["n3"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai()), ai_story(["i3"], ex_ai())]}, silence=1))
case("silence_word_blanks_the_english_headline", BASE,
     ans(("b01", [st(["n1", "n2"], hen="The paper did not report the test plan"), st(["n3"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(hen="")), ai_story(["i3"], ex_ai())]}, silence=1))
case("silence_words_in_both_headlines_go_to_rules", BASE,
     ans(("b01", [st(["n1", "n2"], hja="試験案は報じられなかった", hen="Failed to report the plan"), st(["n3"])])),
     ex({"b01": [ai_story(["i3"], ex_ai()), rule_story(["i1", "i2"])]}, unassigned=2, silence=2))
case("silence_word_drops_the_angle_and_the_flag_note", BASE,
     ans(("b01", [st(["n1", "n2"], angles=[("n1", "報じていない点が焦点"), ("n2", "焦点B")], flags=["overseas_only"], note="報道せず"), st(["n3"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(angles=[("i2", "焦点B")], flags=["overseas_only"], note="")), ai_story(["i3"], ex_ai())]}, silence=2))
case("silence_words_are_not_matched_inside_other_words", BASE,
     ans(("b01", [st(["n1", "n2"], contrast="Speech was silenced; the report said no coverages were found"), st(["n3"])])),
     ex({"b01": [ai_story(["i1", "i2"], ex_ai(contrast="Speech was silenced; the report said no coverages were found")), ai_story(["i3"], ex_ai())]}))

if __name__ == "__main__":
    p = HERE / "validate_cases.json"
    p.write_text(json.dumps(CASES, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("wrote", p, len(CASES), "cases")
