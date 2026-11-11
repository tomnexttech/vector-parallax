# -*- coding: utf-8 -*-
"""tests/fixtures/{relations,reaction,impact,hero}.sample.json を作る（CONTRACT §24〜§26 の見本。hero・app の枝はこれで作る）。

    python tests/fixtures/make_data_samples.py

材料は全部作り物（架空の国・架空の媒体の見出し）。網には出ない：反応の取得は偽の get で答える。
sample(ai=True) は AI が二つの規則の束を一つにした回、sample(ai=False) は AI の無い回（ai_run.status=off・全部 rule）。
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent))

from parallax import coverage, relations, impact, reaction, hero  # noqa: E402

NOW = 1794380000
H = 3600
OUT = {"東都新聞": ("全国紙", "jp", "ja"), "北日本通信": ("通信社", "jp", "ja"), "南海放送": ("公共放送", "jp", "ja"), "西日本週報": ("週刊誌・タブロイド", "jp", "ja"),
       "ワールド通信": ("海外主流", "intl", "ja"), "グローブ報道": ("海外主流", "intl", "ja"), "World Wire": ("海外主流", "intl", "en"),
       "架空省": ("政府一次", "jp", "ja"), "e-Gov": ("政府一次", "jp", "ja")}


def it(iid, outlet, title, ts, desc=None, source_id=None, link=None):
    typ, home, lang = OUT[outlet]
    d = {"id": iid, "title": title, "link": link or "https://example.test/%s" % iid, "outlet": outlet, "source_id": source_id or ("src-" + iid[:3]),
         "type": typ, "home": home, "lang": lang, "ts": ts, "image": None}
    if desc:
        d["desc"] = desc
    return d


def sample(ai=True):
    t = NOW - 10 * H
    items = [
        # s1: 国内 3 社・海外 2 社。海外が 2 時間早い。人数が違う。罷免と弾劾
        it("a1000000000000a1", "東都新聞", "架空国 国防長官の弾劾決議案を議員が提出 300人が抗議", t, "架空国の下院で国防長官の弾劾決議案が提出された。与党は反発している。"),
        it("a1000000000000a2", "北日本通信", "架空国の国防長官 弾劾決議案提出 与党は反発", t + 600),
        it("a1000000000000a3", "南海放送", "国防長官の弾劾決議案 下院で審議へ", t + 1200),
        it("a1000000000000a4", "ワールド通信", "架空国下院 国防長官の罷免を求める決議案 5000人が抗議", t - 2 * H, "下院議員が国防長官の罷免を求める決議案を出した。今後、委員会で審議する。"),
        it("a1000000000000a5", "グローブ報道", "下院議員が国防長官の罷免決議案を提出", t - 2 * H + 900),
        # s2: 国内 1 社・海外 1 社（両方に見出し）
        it("b2000000000000b1", "東都新聞", "架空電機 新型半導体を発表 量産は来年", t + 2 * H),
        it("b2000000000000b2", "World Wire", "Fictive Electric unveils new semiconductor, mass production next year", t + 2 * H + 300),
        # s3: 国内だけ 2 社。社会保険料（暮らし・税）
        it("c3000000000000c1", "北日本通信", "社会保険料の引き上げ 政府が検討 来年度から", t + 3 * H),
        it("c3000000000000c2", "南海放送", "社会保険料引き上げへ 負担増の家計に影響", t + 3 * H + 600),
        # s4: 官公庁の意見募集と週刊誌 1 誌（主要な媒体の見出しは 0 社 -> quiet）
        it("d4000000000000d1", "e-Gov", "介護報酬の見直し案に関する意見募集について", t + 4 * H, source_id="egov-pc", link="https://example.test/pc/d41"),
        it("d4000000000000d2", "西日本週報", "介護報酬 見直し案 意見募集が始まる", t + 4 * H + 900),
        # s5/s6: AI が一つにした二つの規則の束（AI の無い回では別の出来事のまま）
        it("e5000000000000e1", "東都新聞", "架空港で大型船が座礁 油の流出を確認", t + 5 * H),
        it("e5000000000000e2", "北日本通信", "架空港 座礁した大型船から油が流出", t + 5 * H + 300),
        it("f6000000000000f1", "ワールド通信", "架空港の沖合で油の回収始まる 漁業に影響も", t + 6 * H),
        it("f6000000000000f2", "グローブ報道", "架空港沖 回収作業が続く", t + 6 * H + 600),
        # s8/s9: s1 の続き（同じ語で結ばれる）。s10: s2 と同じ会社
        it("h8000000000000h1", "東都新聞", "国防長官の弾劾決議案 架空国下院が採決を延期", t + 8 * H),
        it("h8000000000000h2", "ワールド通信", "架空国下院 国防長官の弾劾決議案の採決を延期", t + 8 * H + 600),
        it("i9000000000000i1", "北日本通信", "国防長官 弾劾決議案めぐり与党が対応協議", t + 8 * H + 1200),
        it("i9000000000000i2", "南海放送", "国防長官の弾劾決議案 与党内で対応を協議", t + 8 * H + 1800),
        it("j1000000000000j1", "南海放送", "架空電機 半導体の新工場を建設へ", t + 9 * H),
        it("j1000000000000j2", "World Wire", "Fictive Electric to build a new semiconductor plant", t + 9 * H + 600),
        # 一つだけの見出し
        it("g7000000000000g1", "西日本週報", "週末の天気 晴れ間が広がる", t + 7 * H),
    ]
    by = {x["id"]: x for x in items}
    groups = [("c1", ["a1000000000000a1", "a1000000000000a2", "a1000000000000a3", "a1000000000000a4", "a1000000000000a5"]),
              ("c2", ["b2000000000000b1", "b2000000000000b2"]), ("c3", ["c3000000000000c1", "c3000000000000c2"]),
              ("c4", ["d4000000000000d1", "d4000000000000d2"]), ("c5", ["e5000000000000e1", "e5000000000000e2"]),
              ("c6", ["f6000000000000f1", "f6000000000000f2"]), ("c7", ["g7000000000000g1"]),
              ("c8", ["h8000000000000h1", "h8000000000000h2"]), ("c9", ["i9000000000000i1", "i9000000000000i2"]), ("ca", ["j1000000000000j1", "j1000000000000j2"])]
    rule_clusters = [{"cid": "c00000000000" + c[1:], "member_ids": ms} for c, ms in groups]

    def story(sid, cids, origin="rule", headline=None):
        ms = [i for c in cids for r in rule_clusters if r["cid"] == c for i in r["member_ids"]]
        outs = list(dict.fromkeys(by[i]["outlet"] for i in ms))
        ts = [by[i]["ts"] for i in ms]
        s = {"sid": sid, "origin": origin, "bid": "b1" if origin == "ai" else None, "rule_cids": cids, "member_ids": ms, "outlets": outs, "n_outlets": len(outs),
             "homes": sorted({by[i]["home"] for i in ms}), "langs": sorted({by[i]["lang"] for i in ms}), "first_ts": min(ts), "last_ts": max(ts), "ai": None}
        if headline:
            s["ai"] = {"headline_ja": headline, "headline_en": "Oil spill off a port after a ship ran aground", "angles": []}
        return s
    cid = {c: "c00000000000" + c[1:] for c, _ in groups}
    stories = [story("s1000000000a1", [cid["c1"]]), story("s2000000000b2", [cid["c2"]]), story("s3000000000c3", [cid["c3"]]),
               story("s4000000000d4", [cid["c4"]])]
    if ai:
        stories.append(story("s5600000000e5", [cid["c5"], cid["c6"]], "ai", "架空港沖の大型船の座礁と油の流出"))
    else:
        stories += [story("s5000000000e5", [cid["c5"]]), story("s6000000000f6", [cid["c6"]])]
    stories += [story("s7000000000g7", [cid["c7"]]), story("s8000000000h8", [cid["c8"]]), story("s9000000000i9", [cid["c9"]]),
                story("sa000000000j1", [cid["ca"]])]
    run = ({"status": "ok", "provider": "fake", "model": "fake-model-1", "at": NOW - 2 * H} if ai else
           {"status": "off", "provider": None, "model": None, "at": None})
    latest = {"schema": "parallax-latest/test", "generated_at": NOW - H, "items": by, "rule_clusters": rule_clusters, "stories": stories, "ai_run": run}
    cases = {}
    for s in stories:
        if s["n_outlets"] < 2:
            continue
        ms = [by[i] for i in s["member_ids"]]
        c = {"sid": s["sid"], "rule_cids": s["rule_cids"], "rep_id": s["member_ids"][0], "cat": "国際" if "intl" in s["homes"] else "国内",
             "key_terms": [], "lineage": [], "photo": None}
        cov = coverage.of(ms)
        if cov:
            c["coverage"] = cov
        cases[s["sid"]] = c
    board = {"schema": "parallax-board/test", "generated_at": NOW - H, "cases": cases}
    politics = {"schema": "parallax-politics/1", "generated_at": NOW - H,
                "gazette": [{"id": "z1", "outlet": "官報", "title": "〔政令〕架空保険法施行令の一部を改正する政令（年金の受給開始の年齢）", "link": "https://example.test/kanpo/z1", "ts": NOW - 5 * H}],
                "bills": {"recent": {"shugiin": [{"id": "z2", "title": "〔衆議院で審議中〕電気料金の負担の軽減のための法律案", "link": "https://example.test/bill/z2", "ts": NOW - 6 * H}], "sangiin": []}},
                "pubcomment": [{"id": "d4000000000000d1", "title": "介護報酬の見直し案に関する意見募集について", "link": "https://example.test/pc/d41", "ts": t + 4 * H}]}
    return latest, board, politics


def fake_get(fail=False):
    """偽の網：はてなは URL の長さで件数を返し、Wikipedia は「国防長官」だけ記事がある。fail=True は全部落ちる（ネットワークを切った回）"""
    import urllib.error
    import urllib.parse

    def get(url):
        if fail:
            raise urllib.error.URLError("network is down (test)")
        if url.startswith(reaction.HATENA):
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            return json.dumps({u: (len(u) * 7) % 50 for u in q.get("url", [])})
        if "pageviews" in url:
            if urllib.parse.quote("国防長官", safe="") in url:
                return json.dumps({"items": [{"timestamp": "202611%02d00" % d, "views": 100 + d} for d in range(4, 11)]})
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        raise urllib.error.URLError("unexpected url in test: " + url)
    return get


def build_all(ai=True, fail=False):
    latest, board, politics = sample(ai)
    rel = relations.compute(latest, board, NOW)
    imp = impact.compute(latest, politics, NOW)
    rea = reaction.compute(latest, board, rel, NOW, get=fake_get(fail), sleep=lambda s: None, clock=lambda: NOW)
    her = hero.compute(latest, board, rel, rea, NOW)
    return {"latest": latest, "board": board, "politics": politics, "relations": rel, "impact": imp, "reaction": rea, "hero": her}


def main():
    got = build_all(ai=True)
    for name in ("relations", "reaction", "impact", "hero"):
        d = dict(got[name])
        if "counts" in d and "secs" in d["counts"]:
            d["counts"] = dict(d["counts"], secs=0)
        p = HERE / ("%s.sample.json" % name)
        p.write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
        print("wrote", p.name, p.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
