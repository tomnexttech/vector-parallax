# -*- coding: utf-8 -*-
"""reaction — 世論の反応（data/reaction.json、CONTRACT §25.1）。公開の値だけ・鍵なし・stdlib だけ・AI は使わない。

    python -m parallax.reaction [--latest data/latest.json] [--board data/board.json] [--relations data/relations.json] [--out data/reaction.json]

反応は「関心の量」で、賛否ではない。値はその値の時刻と一緒に出し、取れない源は sources[...].ok=false と理由で残す（値を埋めない）。

  はてなブックマークの件数  https://bookmark.hatenaapis.com/count/entries?url=...（一度に 50 件まで・鍵なし。間に 3 秒）
                             2 社以上の出来事の見出しの URL だけ。ユーザーの名前・コメントは取らない。
  YouTube の視聴回数        parallax/video.py が既に読む放送局の公開フィードの media:statistics views（stories[].videos[].views）
  Wikipedia の閲覧数        Wikimedia の閲覧数の API（鍵なし・User-Agent に連絡先）。出来事の大きな語と記事の題が完全に一致した物だけ。

規約の一次情報の URL は docs/CONTRACT-public.md §25.3 に置く。どの源が失敗しても例外は外へ出さず、ほかの源の値は出す。
"""
import argparse
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from parallax import keyterms as _kt
    from parallax import relations as _rel
except ImportError:                                       # parallax/ の中から直に走らせた時
    import keyterms as _kt  # type: ignore
    import relations as _rel  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = "parallax-reaction/1"
UA = "VECTOR-PARALLAX/0.1 (+https://tomnexttech.github.io/vector-parallax/; tomnexttech@users.noreply.github.com)"
HATENA = "https://bookmark.hatenaapis.com/count/entries?"
HATENA_BATCH = 50
HATENA_GAP_S = 3.0
HATENA_QUERY_MAX = 6000  # 一回の問い合わせの長さ（字）
TOTAL_S = 600            # 全体で 10 分を超えない
MAX_EVENTS = 400
MAX_URLS = 1200
WIKI = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/%s.wikipedia/all-access/user/%s/daily/%s/%s"
WIKI_GAP_S = 1.0
WIKI_EVENTS = 15         # 閲覧数を見る出来事（媒体の多い順）
WIKI_TERMS = 3           # 一つの出来事で試す語
WIKI_MAX = 3             # 一つの出来事に載せる記事
WIKI_BUDGET_S = 120      # Wikipedia に使う時間の上限
WIKI_FAILS = 2           # 続けてこれだけ失敗したら Wikipedia はそこでやめる（相手が遅い・止めている時に 10 分を使い切らない）
WIKI_MIN_DAY = 20        # 7 日のうち一番多い日がこれ未満の題は載せない（転送の頁・人の来ない題）
GOV = "政府一次"
NOT_USED = [
    {"name": "Yahoo!ニュースのコメント", "why": "robots.txt（news.yahoo.co.jp/robots.txt）がコメントの頁と /api/ を禁じている。コメントを外へ出す公開の API は無い。",
     "url": "https://news.yahoo.co.jp/robots.txt"},
    {"name": "X", "why": "公式の料金の頁で、投稿の読み取りは 1 件ごとに費用がかかり、無料の読み取りの枠は書かれていない。費用 0 円で毎日動かす形と合わない。",
     "url": "https://docs.x.com/x-api/getting-started/pricing"},
    {"name": "Bluesky の検索", "why": "公開の口の検索（app.bsky.feed.searchPosts）が認証を求める（2026-11-11 に 403）。今回は使わない。",
     "url": "https://docs.bsky.app/docs/api/app-bsky-feed-search-posts"},
]


def _get(url, timeout=12):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


class NotFound(Exception):
    pass


def _get_json(get, url):
    try:
        return json.loads(get(url))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise NotFound(url)
        raise


def _side(it):
    return "gov" if it.get("type") == GOV else "intl" if it.get("home") == "intl" else "jp"


def _src(ok, n, at, err=""):
    return {"ok": bool(ok), "err": (err or "")[:200], "n": n, "fetched_at": at}


def events_of(latest, board=None):
    items = latest.get("items") or {}
    if isinstance(items, list):
        items = {it.get("id"): it for it in items if isinstance(it, dict)}
    cases = ((board or {}).get("cases") or {}) if isinstance((board or {}).get("cases"), dict) else {}
    ev = [s for s in latest.get("stories") or [] if isinstance(s, dict) and s.get("sid") and ((s.get("n_outlets") or 0) >= 2 or s["sid"] in cases)]
    ev.sort(key=lambda s: (-(s.get("n_outlets") or 0), -(s.get("last_ts") or 0), s["sid"]))
    return ev[:MAX_EVENTS], items


def _chunks(urls):
    """50 件まで・問い合わせの長さ HATENA_QUERY_MAX 字までの組に分ける（長い URL が続くと 414 になる）"""
    out, cur, n = [], [], 0
    for u in urls:
        k = len(urllib.parse.urlencode([("url", u)])) + 1
        if cur and (len(cur) >= HATENA_BATCH or n + k > HATENA_QUERY_MAX):
            out.append(cur)
            cur, n = [], 0
        if k > HATENA_QUERY_MAX:                       # 一つで長すぎる URL は問い合わせない
            continue
        cur.append(u)
        n += k
    if cur:
        out.append(cur)
    return out


def hatena(urls, get, sleep, deadline):
    """-> ({url: 件数}, err)。50 件ずつ・間に 3 秒。時間切れはそこまで"""
    got, err = {}, ""
    urls = list(dict.fromkeys(u for u in urls if isinstance(u, str) and u.startswith(("http://", "https://"))))[:MAX_URLS]
    for k, chunk in enumerate(_chunks(urls)):
        if time.time() > deadline:
            err = err or "time limit"
            break
        if k:
            sleep(HATENA_GAP_S)
        try:
            d = _get_json(get, HATENA + urllib.parse.urlencode([("url", u) for u in chunk]))
            for u in chunk:
                v = d.get(u) if isinstance(d, dict) else None
                if isinstance(v, int) and not isinstance(v, bool) and v >= 0:
                    got[u] = v
        except Exception as e:
            err = err or ("%s: %s" % (type(e).__name__, e))
    return got, err


def _days(now):
    end = dt.datetime.fromtimestamp(now, dt.timezone.utc).date() - dt.timedelta(days=1)       # 昨日まで（今日の分はまだ揃っていない）
    return [end - dt.timedelta(days=i) for i in range(6, -1, -1)]


def wiki(term, now, get):
    """-> {"title", "lang", "views": [7 日分。無い日は None]} | None（記事が無い）。ネットワークの失敗は例外"""
    lang = "en" if term.isascii() else "ja"
    days = _days(now)
    title = term.replace(" ", "_")
    url = WIKI % (lang, urllib.parse.quote(title, safe=""), days[0].strftime("%Y%m%d"), days[-1].strftime("%Y%m%d"))
    try:
        d = _get_json(get, url)
    except NotFound:
        return None
    by = {}
    for x in d.get("items") or [] if isinstance(d, dict) else []:
        ts, v = str(x.get("timestamp") or "")[:8], x.get("views")
        if isinstance(v, int) and not isinstance(v, bool):
            by[ts] = v
    if not by or max(by.values()) < WIKI_MIN_DAY:
        return None
    return {"title": term, "lang": lang, "views": [by.get(day.strftime("%Y%m%d")) for day in days],
            "from": days[0].isoformat(), "to": days[-1].isoformat()}


def _terms(s, items, rel_terms):
    t = rel_terms.get(s["sid"])
    if t:
        return t
    ms = [items[i] for i in s.get("member_ids") or [] if i in items]
    out = []
    for m in ms[:4]:
        try:
            for x in _kt.key_terms(m.get("title") or ""):
                if x not in out:
                    out.append(x)
        except Exception:
            pass
    return out


def compute(latest, board=None, relations=None, now=None, get=None, sleep=None, budget_s=TOTAL_S, clock=None):
    """clock() は取得の時刻（試験では固定）。時間の上限は本物の時計で数える"""
    clock = clock or time.time
    now = int(now if now is not None else clock())
    get = get or _get
    sleep = sleep or time.sleep
    deadline = time.time() + budget_s
    evs, items = events_of(latest, board)
    out_items, events = {}, {}
    # はてなブックマーク
    urls, by_url = [], {}
    for s in evs:
        for i in s.get("member_ids") or []:
            it = items.get(i)
            if it and isinstance(it.get("link"), str):
                urls.append(it["link"])
                by_url.setdefault(it["link"], []).append(i)
    hb, hb_err = ({}, "no headline links") if not urls else hatena(urls, get, sleep, deadline)
    hb_at = int(clock()) if hb else None
    for u, n in hb.items():
        for i in by_url.get(u, []):
            out_items[i] = {"hb": n}
    # YouTube（latest.json の stories[].videos[].views）
    yt_n, yt_at = 0, None
    for s in evs:
        e = {}
        got = [(i, out_items[i]["hb"]) for i in s.get("member_ids") or [] if i in out_items]
        if got:
            sides = {"jp": 0, "intl": 0, "gov": 0}
            for i, n in got:
                sides[_side(items[i])] += n
            e["hb"] = {"sum": sum(n for _i, n in got), "max": max(n for _i, n in got), "n": len(got), "by_side": sides, "at": hb_at}
        vs = [v for v in s.get("videos") or [] if isinstance(v, dict) and isinstance(v.get("views"), int) and not isinstance(v.get("views"), bool)]
        if vs:
            at = max((v.get("views_at") for v in vs if isinstance(v.get("views_at"), int)), default=None)
            e["yt"] = {"views": sum(v["views"] for v in vs), "n": len(vs), "at": at}
            yt_n += len(vs)
            yt_at = max(x for x in (yt_at, at) if x is not None) if at is not None else yt_at
        if e:
            events[s["sid"]] = e
    any_videos = any(isinstance(s.get("videos"), list) and s["videos"] for s in latest.get("stories") or [] if isinstance(s, dict))
    if yt_n or not any_videos:                        # 放送局の動画が一つも出来事に合わなかった時は「無い」（取れなかったのではない）
        yt_src = _src(True, yt_n, yt_at if yt_n else latest.get("generated_at"))
    else:
        yt_src = _src(False, 0, None, "no view count in the channel feeds")
    # Wikipedia
    rel_terms = {n.get("sid"): n.get("terms") or [] for n in (relations or {}).get("nodes") or [] if isinstance(n, dict)}
    wk_n, wk_err, wk_ok_calls, wk_at, fails = 0, "", 0, None, 0
    wk_deadline = min(deadline, time.time() + WIKI_BUDGET_S)
    for s in evs[:WIKI_EVENTS]:
        found = []
        if fails >= WIKI_FAILS:
            break
        for term in _terms(s, items, rel_terms)[:WIKI_TERMS]:
            if time.time() > wk_deadline or fails >= WIKI_FAILS:
                wk_err = wk_err or ("time limit" if fails < WIKI_FAILS else "stopped after %d failures in a row" % fails)
                break
            if not isinstance(term, str) or len(term) < 2 or term in _rel._RUN_STOP or term.lower() in _rel._EN_STOP or term.endswith(("氏", "さん")):
                continue
            try:
                sleep(WIKI_GAP_S)
                r = wiki(term, now, get)
                wk_ok_calls += 1
                fails = 0
            except Exception as e:
                wk_err = wk_err or ("%s: %s" % (type(e).__name__, e))
                fails += 1
                continue
            if r:
                found.append(r)
            if len(found) >= WIKI_MAX:
                break
        if found:
            events.setdefault(s["sid"], {})["wiki"] = found
            wk_n += len(found)
            wk_at = int(clock())
    return {"schema": SCHEMA, "generated_at": now, "latest_generated_at": latest.get("generated_at"),
            "sources": {"hatena": _src(bool(hb), len(hb), hb_at, hb_err),
                        "youtube": yt_src,
                        "wikipedia": _src(wk_ok_calls > 0, wk_n, wk_at if wk_ok_calls else None, wk_err)},
            "items": out_items, "events": events, "not_used": NOT_USED,
            "note": "関心の量（件数・回数）で、賛成か反対かではありません。値はその値を取った時刻と一緒に出します。"}


def _read(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m parallax.reaction")
    ap.add_argument("--latest", default=str(ROOT / "data" / "latest.json"))
    ap.add_argument("--board", default=str(ROOT / "data" / "board.json"))
    ap.add_argument("--relations", default=str(ROOT / "data" / "relations.json"))
    ap.add_argument("--out", default=str(ROOT / "data" / "reaction.json"))
    a = ap.parse_args(argv)
    latest = _read(a.latest)
    if not latest:
        print("reaction: no latest.json (previous file kept)", file=sys.stderr)
        return 0
    d = compute(latest, _read(a.board), _read(a.relations))
    from parallax.extras import write_json
    write_json(a.out, d)
    print("reaction events=%d %s" % (len(d["events"]), {k: (v["ok"], v["n"]) for k, v in d["sources"].items()}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
