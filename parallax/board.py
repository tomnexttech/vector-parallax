# -*- coding: utf-8 -*-
"""board — the data behind the one-screen board: PRIORITY, outline, outside-your-interest, asymmetry, hourly volume,
source health and the anatomy of each event (CONTRACT 18). Stdlib only; no network.

compose(data, raw_items, now, history) -> (board, new_history)
  data       the dict that build() produced (data/latest.json): stories, items, rule_clusters, sources
  raw_items  every item fetched in this run (list), also those outside the story window; used for volume and activity
  history    the previous data/history.json (dict) or None; used for the lineage ("earlier bundles of the same matter")

Rules (all deterministic, all published in board["rules"]):
  weight    flags set + 0.5 if a primary source is among the members + 0.5 if a Japanese-language report exists
            + 0.1 per type of outlet (up to 5). The number of outlets is NOT used: a matter is not heavier because
            more outlets copied it.
  fresh     exp(-hours since the newest member / 24)
  stale     no new member for 24 h: shown nowhere. PRIORITY also drops a story whose first report is older than 24 h
            and whose newest member is older than 18 h.
  rank      weight * fresh, then newest member, then sid
  event     (CONTRACT 18.11) stories that name the same titled person are folded into one event on the board (the author's earlier board's event layer)
  asymmetry decided by the TYPES of outlets only: primary_only / periphery_only / overseas_only / mainstream_only.
            It never uses an outlet's politics and never says that an outlet "did not report": the words are
            "not found in the N feeds fetched".
"""
import collections
import math
import re
import unicodedata

try:
    from parallax import cluster as cluster_mod
    from parallax import counts as counts_mod
    from parallax import coverage as coverage_mod
    from parallax import keyterms
    from parallax import photo as photo_mod
    from parallax import places as places_mod
    from parallax import sources as sources_mod
    from parallax import watch
except ImportError:                                   # run from inside parallax/
    import cluster as cluster_mod  # type: ignore
    import counts as counts_mod  # type: ignore
    import coverage as coverage_mod  # type: ignore
    import keyterms  # type: ignore
    import photo as photo_mod  # type: ignore
    import places as places_mod  # type: ignore
    import sources as sources_mod  # type: ignore
    import watch  # type: ignore

SCHEMA = "parallax-board/1"
HISTORY_SCHEMA = "parallax-history/1"

OUTLINE_CATS = ["国内政治", "国際", "経済", "安全保障", "技術", "市場"]
GENERAL_CATS = ("横断", "社会")
FRESH_TAU_H = 24.0
PRIORITY_FIRST_H = 24.0
PRIORITY_QUIET_H = 18.0
STALE_QUIET_H = 24.0
FOLLOW_H = 6.0
JA_BONUS = 0.5
PRIORITY_MAX = 80
OUTLINE_PER_CAT = 6
OUTSIDE_MAX = 8
ASYM_MAX = 24
PILLARS_MAX = 16
SLAB_H = 48
CASES_MAX = 260
HISTORY_DAYS = 30
HISTORY_MAX = 4000
LINEAGE_GAP_H = 6.0

MAINSTREAM = {"公共放送", "全国紙", "通信社", "経済紙"}
PERIPHERY = {"政党機関紙", "週刊誌・タブロイド", "地方紙"}
FOREIGN = {"海外公共", "海外主流", "国家メディア", "シンクタンク"}
OUTSIDE_WIRE_TYPES = {"公共放送", "海外公共", "通信社", "国家メディア"}
OUTSIDE_MIN_WIRE = 2
_MAJOR = {"公共放送", "全国紙", "通信社", "経済紙", "民放", "地方紙", "海外公共"}
JP_WORDS = ("日本", "政府", "首相", "国会", "自民", "立憲", "維新", "公明", "国民民主", "共産",
            "内閣", "官房", "防衛省", "財務省", "Japan", "Tokyo")

ASYM = {   # kind -> (ja label, en label, the rule in words)
    "primary_only": ("官公庁の資料だけ", "Government documents only",
                     "Every outlet of this matter is a government or central-bank body, and money or law is flagged."),
    "periphery_only": ("周辺の型だけ", "Party, weekly or regional outlets only",
                       "Only party, tabloid or regional outlets (with at most primary, foreign or specialist ones) carry it; money, law or security is flagged. "
                       "The label of an entry names the types that carry it (label_ja)."),
    "overseas_only": ("海外の源だけ", "Overseas sources only",
                      "Only overseas outlets carry it, and the headlines mention Japan."),
    "mainstream_only": ("国内主流の型だけ", "Domestic mainstream types only",
                        "Only mainstream and primary outlets carry it, four or more of them, and money, law or security is flagged."),
}
ASYM_MIN_OUTLETS = 2                                   # CONTRACT 20.3: one definition for every kind
SHORT_TYPE = {"政党機関紙": "政党機関紙", "週刊誌・タブロイド": "週刊誌", "地方紙": "地方紙"}
STALE_LABEL_JA = "更新なし"                           # CONTRACT 20.8 (the id stale_72h stays)


def mainstream_cover(rows):
    """CONTRACT 20.3: were the Japanese mainstream feeds all fetched, and how far back does each reach?"""
    jp = [r for r in rows or [] if r.get("home") == "jp" and r.get("type") in sources_mod.MAINSTREAM_TYPES]
    missing = [r.get("id") for r in jp if not r.get("ok")]
    oldest = {r.get("id"): r.get("oldest_ts") for r in jp if r.get("ok")}
    return {"complete": bool(jp) and not missing, "missing": missing, "checked": len(jp), "oldest": oldest}


def covers(cover, first_ts):
    """The mainstream feeds were all fetched and each reaches back to the start of the event."""
    return bool(cover and cover["complete"] and _num(first_ts)
                and all(_num(o) and o <= first_ts for o in cover["oldest"].values()))


def asym_label(kind, types):
    """The label names the side that carried it, by type (CONTRACT 20.3)."""
    if kind == "periphery_only":
        names = [SHORT_TYPE[t] for t in sorted(set(types)) if t in SHORT_TYPE]
        return "・".join(names) + "だけ" if names else ASYM[kind][0]
    return ASYM[kind][0]


def domestic_budget_law(c):
    """CONTRACT 20.4: money or law, reported in Japanese by a jp outlet. PRIORITY lists these first."""
    fl = c["flags"]
    rep = c.get("rep") or {}
    return bool((fl.get("money") or fl.get("law")) and c.get("ja") and rep.get("home") == "jp")

_KANA = re.compile(r"[ぁ-んァ-ヴ]")
REP_TYPES = _MAJOR                                     # types picked first for the representative headline (the author's earlier board's REP_TYPES)


def key_terms(title, n=4):
    """The big words of a headline: the earlier board's rules (parallax/keyterms.py), the first n."""
    return keyterms.key_terms(title)[:n]


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x and not math.isinf(x)


def _age_h(ts, now):
    return max(0.0, (now - ts) / 3600.0) if _num(ts) else None


def weight(c):
    nflag = sum(1 for k in watch.FLAGS if c["flags"].get(k))
    return nflag + (0.5 if c["gov"] else 0.0) + (JA_BONUS if c["ja"] else 0.0) + 0.1 * min(len(c["types"]), 5)


def fresh(c, now):
    a = _age_h(c["last_ts"], now)
    return 0.0 if a is None else math.exp(-a / FRESH_TAU_H)


def is_stale(c, now):
    a = _age_h(c["last_ts"], now)
    return a is not None and a > STALE_QUIET_H


def is_stale_priority(c, now):
    if is_stale(c, now):
        return True
    first, last = _age_h(c["first_ts"], now), _age_h(c["last_ts"], now)
    return first is not None and last is not None and first > PRIORITY_FIRST_H and last > PRIORITY_QUIET_H


def rank_key(now):
    return lambda c: (-round(weight(c) * fresh(c, now), 9), -(c["last_ts"] or 0), c["sid"])


def _order(m):
    return (0 if m.get("lang") == "ja" else 1, 0 if m.get("type") in _MAJOR else 1, -(m.get("ts") or 0))


def _is_ja_m(m):
    """A Japanese-language member: the feed's language, or kana in the headline (a kanji-only Chinese headline is not Japanese)."""
    return (m.get("lang") == "ja") or bool(_KANA.search(m.get("title") or ""))


def _original_rep(members):
    """The representative the rule clusterer would take (type order, then the earliest time): the anchor for pick_rep."""
    named = [m for m in members if m.get("title")]
    if not named:
        return None
    return min(named, key=lambda m: (cluster_mod.type_rank(m.get("type")), m["ts"] if _num(m.get("ts")) else float("inf")))


def pick_rep(members, rep=None, flags_of=None):
    """The representative headline of an event (ported from the author's earlier board, 2026-10-04 rule). A Japanese-language member if there is one,
    among them the newest of a major type (REP_TYPES); no major type -> the newest with a time; no time at all -> the original rep (or the
    first Japanese member). When the original rep raises flags of its own, only candidates that raise all of them are used (else those that
    share one, else all): a member that joined by a wrong merge never becomes the face of the event."""
    named = [m for m in members or [] if m.get("title")]
    if not named:
        return rep
    pool = [m for m in named if _is_ja_m(m)] or named
    timed = [m for m in pool if _num(m.get("ts"))]
    main = [m for m in timed if (m.get("type") or "") in REP_TYPES]
    cand = main or timed
    if not cand:
        if rep and (_is_ja_m(rep) or pool is named):
            return rep
        return pool[0]
    flags_of = flags_of or (lambda m: watch.flags(m.get("title")))

    def own(m):
        f = flags_of(m)
        return {k for k in watch.FLAGS if f.get(k)}
    if rep and rep.get("title") and len(cand) > 1:
        anchor = own(rep)
        if anchor:
            sets = [(m, own(m)) for m in cand]
            full = [m for m, st in sets if anchor <= st]
            part = [m for m, st in sets if anchor & st]
            cand = full or part or cand
    return max(cand, key=lambda m: (m["ts"], m.get("title", "")))


def _cat(members, fl, rep):
    votes = collections.Counter()
    for m in members:
        s = sources_mod.by_id(m.get("source_id"))
        if s and s.get("cat"):
            votes[s["cat"]] += 1
    cat = votes.most_common(1)[0][0] if votes else "横断"
    if cat in GENERAL_CATS:                         # a general desk: decide by flags (tech, money, law, security)
        if fl.get("tech"):
            return "技術"
        if fl.get("money"):
            return "経済"
        if fl.get("law"):
            return "国内政治" if rep and rep.get("home") == "jp" else "国際"
        if fl.get("security"):
            return "安全保障"
        return "その他"
    return cat


def _stories(data, now):
    items = data["items"]
    fl_cache = {}

    def fl_of(m):
        if m["id"] not in fl_cache:
            fl_cache[m["id"]] = watch.flags(m.get("title"))
        return fl_cache[m["id"]]

    out = []
    for s in data["stories"]:
        members = [items[i] for i in s["member_ids"] if i in items]
        if not members:
            continue
        rep = pick_rep(members, _original_rep(members), fl_of)
        fl = fl_of(rep) if rep else watch.flags(None)
        types = sorted({m["type"] for m in members if m.get("type")})
        c = {"sid": s["sid"], "story": s, "members": members, "rep": rep, "flags": fl,
             "hits": fl["hits"][:12], "types": types,
             "n_outlets": s.get("n_outlets") or len({m["outlet"] for m in members}),
             "first_ts": s.get("first_ts"), "last_ts": s.get("last_ts"),
             "ja": any(m.get("lang") == "ja" for m in members),
             "gov": "政府一次" in types, "cids": s.get("rule_cids") or []}
        c["cat"] = _cat(members, fl, rep)
        out.append(c)
    return out


def _outside_ok(c):
    if c["ja"]:
        return True
    wire = {m["outlet"] for m in c["members"] if m.get("type") in OUTSIDE_WIRE_TYPES}
    return len(wire) >= OUTSIDE_MIN_WIRE


def asymmetry_of(c, cover=False):
    """-> kind or None. Types only; money/law/security are the "civic" flags (a disaster-only flag is not a signal).
    CONTRACT 20.3: two or more outlets, and (when `cover` is given) the mainstream feeds were all fetched and reach back to the start of the event.
    cover=False (default) skips the coverage test (used by the unit tests of the kinds)."""
    if c["n_outlets"] < ASYM_MIN_OUTLETS:
        return None
    if cover is not False and not covers(cover, c["first_ts"]):
        return None
    t = set(c["types"])
    fl = c["flags"]
    civic = fl.get("money") or fl.get("law") or fl.get("security")
    text = " ".join(m.get("title") or "" for m in c["members"])
    is_jp = any(w in text for w in JP_WORDS)
    if t == {"政府一次"} and (fl.get("money") or fl.get("law")):
        return "primary_only"
    if t and t <= (PERIPHERY | FOREIGN | {"政府一次", "専門"}) and not (t & MAINSTREAM) and civic and (t & PERIPHERY):
        return "periphery_only"
    if t and t <= FOREIGN and is_jp:
        return "overseas_only"
    if t and t <= (MAINSTREAM | {"政府一次"}) and c["n_outlets"] >= 4 and civic:
        return "mainstream_only"
    return None


# ---------------------------------------------------------------- the event layer (CONTRACT 18.11)
# The rule clusterer (and the AI) split one matter into several small stories on purpose: a wrong member is worse than a missing one.
# The author's earlier board folds, on top of that, the stories whose headlines name the same person with a title (簗農水相, 古謝知事, 岩屋前外相, ○○氏) into one
# event; the members of each story are trusted as they are. Only a titled person's name is a key (never a place, an organisation or a common
# word); a name that appears in more than EVENT_MAX_DF stories of the window is a topic, not an event (a prime minister's name), and is no key;
# the headlines of the story must contain the name at EVENT_SHARE or more; and two stories are joined only if the best pair of their headlines
# is as similar as EVENT_SIM (single link). The event takes the sid of its best-ranked story; the other sids are listed in board["events"].
EVENT_MAX_DF = 40        # a key name that appears in more stories than this is a topic
EVENT_SHARE = 0.34       # share of a story's headlines that must contain the key name
EVENT_MEMBERS = 30       # members kept for an event (newest first)
EVENT_SIM = 0.2          # headline similarity (cluster.similarity) needed to join two stories with the same name
EVENT_TITLES = 4         # headlines per story compared
_EV_TITLE = (r"(?:前首相|元首相|首相|総理|前外相|元外相|外相|農水相|農相|防衛相|財務相|経産相|厚労相|文科相|法相|総務相|"
             r"国交相|環境相|経済再生相|デジタル相|復興相|官房長官|副大臣|大臣|新知事|前知事|元知事|知事|"
             r"議員|幹事長|政調会長|総務会長|国対委員長|委員長|総裁|副総裁|党首|代表|大統領|副大統領|長官|議長|氏|"
             r"県政|政権|陣営|内閣)")
# 市長・区長・町長・村長 are not keys: the word before them is usually a place (横浜市長)
_EV_KANJI = re.compile(r"([一-龥々]{1,6})" + _EV_TITLE)
_EV_LEAD = re.compile(r"^(?:自民党?|立憲|維新|公明|共産|国民民主|国民|社民|参政|保守|自公|与党|野党|政府|官邸|"
                      r"沖縄県|沖縄|東京都|大阪府|県|市|米国|米|中国|中|露|英|仏|独|韓|朝|豪|印|日|新|前|元|現|同|両|旧|故)+")
_EV_TRAIL = re.compile(r"(?:防衛|財務|外務|総務|法務|文科|文部科学|厚労|厚生労働|農水|農林水産|経産|経済産業|国交|国土交通|"
                       r"環境|復興|担当|経済|官房|デジタル|地方創生|少子化|前|元|新|現|副|代|同)+$")
_EV_ORG_END = re.compile(r"[党省庁府県都道市町村区国会院局軍社団部課協連署所会議庁塾校銀行盟]$")
_EV_STOP = {"首相", "総理", "大臣", "知事", "政府", "政権", "国会", "議員", "政党", "閣僚", "長官", "代表", "幹部", "候補",
            "元首", "党首", "首脳", "当局", "同氏", "両氏", "各氏", "故人", "容疑", "被告", "本人", "大統領", "副", "米", "中",
            "露", "英", "仏", "独", "韓", "朝", "日", "前", "元", "新", "現", "同", "両", "各", "旧", "故", "全", "本",
            "トランプ大統領", "プーチン大統領", "民主", "立憲", "自民", "維新", "公明", "共産", "国民", "社民", "民間",
            "有識者", "関係者", "専門家", "地元", "住民"}
_SPORT = re.compile(r"(?i)\b(NFL|NBA|MLB|NHL|NCAA|UFC|F1|football|soccer|baseball|basketball|tennis|golf|cricket|"
                    r"wrestl\w*|boxing|quarterback|touchdown|playoffs?|quarterfinals?|semifinals?|innings|wickets?|"
                    r"Grand Prix|MotoGP|Asian Games|World Cup|Olympics?|Premier League|Division Series|World Series|"
                    r"Yankees|Dodgers|Steelers|Chiefs|Eagles|Cowboys|Patriots|Packers|49ers|Lakers|Celtics|Warriors|"
                    r"Knicks|Vols|Longhorns)\b|阪神|巨人|ヤクルト|ＤｅＮＡ|DeNA|ロッテ|オリックス|ソフトバンク|日本ハム|"
                    r"ドジャース|大谷|地区シリーズ|ワールドシリーズ|"
                    r"野球|サッカー|ゴルフ|競馬|大相撲|ラグビー|五輪|パラ|陸上|マラソン|選手|監督|優勝|投手|打者|球団|試合|"
                    r"レスリング|柔道|卓球|テニス|フィギュア|ボクシング|プロレス|アジア大会|決勝|W杯|Ｗ杯|"
                    r"本塁打|ホームラン|ポストシーズン|奪三振|登板|白星|黒星|プレーオフ|日本シリーズ|クライマックスシリーズ|"
                    r"勝ち点|ホワイトソックス|メジャーリーグ|大リーグ")


def _ev_clean(name):
    n = _EV_LEAD.sub("", name or "")
    n = _EV_TRAIL.sub("", n)
    if not n or n in _EV_STOP or _EV_ORG_END.search(n) or n in places_mod.GEO or n.endswith("州"):
        return ""                        # an organisation, a country or a place (カタール首相, 州知事) is not a person
    return n


def ev_names(title):
    """The titled persons named in a headline (nothing is guessed: a name without a title is not taken)."""
    t = places_mod._cut_tail(unicodedata.normalize("NFKC", title or ""))
    out = []
    for m in _EV_KANJI.finditer(t):
        n = _ev_clean(m.group(1).strip("・"))
        if n and n not in out:
            out.append(n)
    return out


def _ev_canon(names):
    """Spelling variants (簗 / 簗和生) are folded to the shorter one, only if the short name is 2+ characters and the rest is 1+, or the short
    name is 1 character and the rest is 2+ (林 and 林田 are different people and are not folded)."""
    ns = sorted(set(names), key=lambda x: (len(x), x))
    canon = {}
    for n in ns:
        key = n
        for sh in ns:
            if len(sh) >= len(n):
                break
            rest = len(n) - len(sh)
            if n.startswith(sh) and ((len(sh) >= 2 and rest >= 1) or (len(sh) == 1 and rest >= 2)):
                key = canon.get(sh, sh)
                break
        canon[n] = key
    return canon


def _ev_titles(c):
    return [c["rep"]["title"] if c.get("rep") else ""] + [m.get("title") or "" for m in c["members"]]


def _ev_components(grp):
    """Stories with the same key name, joined by single link where the best pair of headlines is as similar as EVENT_SIM."""
    grp = sorted(grp, key=lambda c: c["sid"])
    tl = []
    for c in grp:
        uniq = []
        for t in _ev_titles(c):
            if t and t not in uniq:
                uniq.append(t)
        tl.append(uniq[:EVENT_TITLES])
    par = list(range(len(grp)))

    def find(i):
        while par[i] != i:
            par[i] = par[par[i]]
            i = par[i]
        return i
    for i in range(len(grp)):
        for j in range(i + 1, len(grp)):
            if find(i) == find(j):
                continue
            best = 0.0
            for a in tl[i]:
                for b in tl[j]:
                    try:
                        sim, veto, _why = cluster_mod.similarity(a, b)
                    except Exception:                           # one odd headline never stops the board
                        continue
                    if not veto and sim > best:
                        best = sim
                if best >= EVENT_SIM:
                    break
            if best >= EVENT_SIM:
                par[find(j)] = find(i)
    comps = {}
    for i in range(len(grp)):
        comps.setdefault(find(i), []).append(grp[i])
    return list(comps.values())


def _merge_event(key, grp, now):
    lead = grp[0]
    seen, members = set(), []
    for c in grp:
        for m in c["members"]:
            k = m.get("id") or m.get("link") or m.get("title")
            if not k or k in seen:
                continue
            seen.add(k)
            members.append(m)
    members.sort(key=lambda m: -(m["ts"] if _num(m.get("ts")) else 0))
    members = members[:EVENT_MEMBERS]
    flags = {k: any((c["flags"] or {}).get(k) for c in grp) for k in watch.FLAGS}
    hits, hseen = [], set()
    for c in grp:
        for h in c["hits"]:
            if h not in hseen:
                hseen.add(h)
                hits.append(h)
    flags["hits"] = hits
    types = sorted({t for c in grp for t in c["types"]})
    firsts = [c["first_ts"] for c in grp if _num(c["first_ts"])]
    lasts = [c["last_ts"] for c in grp if _num(c["last_ts"])]
    rep = pick_rep(members, lead["rep"])
    ev = dict(lead)
    ev.update({
        "members": members, "rep": rep, "flags": flags, "hits": hits[:12], "types": types, "gov": "政府一次" in types,
        "n_outlets": len({m["outlet"] for m in members}) or lead["n_outlets"],
        "first_ts": min(firsts) if firsts else lead["first_ts"], "last_ts": max(lasts) if lasts else lead["last_ts"],
        "ja": any(c["ja"] for c in grp), "cids": sorted({x for c in grp for x in c["cids"]}),
        "event": {"key": key, "n_stories": len(grp), "sids": [c["sid"] for c in grp]},
    })
    return ev


def events(cs, now):
    """-> (stories for the board with each folded event in place of its stories, [the folded events])."""
    names_of = {}
    for c in cs:
        if c.get("rep") is None or _SPORT.search(c["rep"]["title"] or ""):
            continue
        titles = _ev_titles(c)
        per = {}
        for t in titles:
            for n in ev_names(t):
                per[n] = per.get(n, 0) + 1
        if per:
            names_of[c["sid"]] = (per, len(titles))
    canon = _ev_canon([n for per, _ in names_of.values() for n in per])
    df, keys_of = {}, {}
    for sid, (per, nt) in names_of.items():
        kc = {}
        for n, k in per.items():
            kk = canon.get(n, n)
            kc[kk] = max(kc.get(kk, 0), k)
        keys_of[sid] = (kc, nt)
        for kk in kc:
            df[kk] = df.get(kk, 0) + 1
    # a common name is judged on all headlines of the window, with or without a title (a president's name is a topic)
    texts = ["\n".join(_ev_titles(c)) for c in cs]
    df_any = {k: sum(1 for t in texts if k in t) for k, v in df.items() if v >= 2}
    full = {canon.get(n, n) for n in canon if len(n) >= 3}      # a one-character name needs a full name in the window
    groups = {}
    for sid, (kc, nt) in keys_of.items():
        ok = [(k, n) for k, n in kc.items()
              if df[k] >= 2 and df_any.get(k, 0) <= EVENT_MAX_DF and n / float(nt) >= EVENT_SHARE
              and (len(k) >= 2 or k in full)]
        if not ok:
            continue
        key = max(ok, key=lambda kn: (kn[1], df[kn[0]], kn[0]))[0]       # the name that most of the story's headlines contain
        groups.setdefault(key, []).append(sid)
    by_sid = {c["sid"]: c for c in cs}
    rk = rank_key(now)
    merged, absorbed = [], set()
    for key, sids in sorted(groups.items()):
        if len(sids) < 2:
            continue
        for comp in _ev_components([by_sid[x] for x in sids]):
            if len(comp) < 2:
                continue
            grp = sorted(comp, key=rk)
            ev = _merge_event(key, grp, now)
            merged.append(ev)
            absorbed.update(x["sid"] for x in grp[1:])
            by_sid[grp[0]["sid"]] = ev
    return [by_sid[c["sid"]] for c in cs if c["sid"] not in absorbed], merged


def _case(c, now, kind, history_entries):
    ms = sorted(c["members"], key=lambda m: (m.get("ts") or 1 << 60, m["id"]))
    first = c["first_ts"] if _num(c["first_ts"]) else (ms[0].get("ts") if ms else None)
    last = c["last_ts"] if _num(c["last_ts"]) else (ms[-1].get("ts") if ms else None)
    w, f = weight(c), fresh(c, now)

    def off(m):
        return int(round((m["ts"] - first) / 60.0)) if _num(m.get("ts")) and _num(first) else None

    timeline = [{"id": m["id"], "ts": m.get("ts"), "off_min": off(m), "type": m.get("type"), "outlet": m.get("outlet")}
                for m in ms][:60]
    by_type = collections.OrderedDict()
    for m in ms:
        e = by_type.setdefault(m.get("type") or "", {"type": m.get("type") or "", "n": 0, "outlets": []})
        e["n"] += 1
        if m.get("outlet") not in [o["outlet"] for o in e["outlets"]]:
            e["outlets"].append({"outlet": m.get("outlet"), "off_min": off(m)})
    fingerprint = []
    for e in by_type.values():
        offs = [off(m) for m in ms if m.get("type") == e["type"] and off(m) is not None]
        fingerprint.append({"type": e["type"], "n": e["n"], "first_off_min": min(offs) if offs else None,
                            "last_off_min": max(offs) if offs else None,
                            "outlets": [o["outlet"] for o in e["outlets"]]})
    fingerprint.sort(key=lambda e: (e["first_off_min"] is None, e["first_off_min"] or 0))
    span_h = ((last - first) / 3600.0) if _num(first) and _num(last) else 0.0
    bin_h = max(1, int(math.ceil((span_h + 1) / 48.0)))
    nbins = int(span_h // bin_h) + 1
    rows = {}
    for m in ms:
        if not (_num(m.get("ts")) and _num(first)):
            continue
        b = min(nbins - 1, int((m["ts"] - first) // (3600 * bin_h)))
        rows.setdefault(m.get("type") or "", [0] * nbins)[b] += 1
    place = None
    if c["rep"]:
        titles = [m["title"] for m in ms if m.get("title") and m is not c["rep"] and m["title"] != c["rep"]["title"]]
        place = places_mod.locate(c["rep"]["title"], titles)
        if place:
            place = {"name": place["place"], "lat": place["lat"], "lon": place["lon"], "prec": place["prec"], "via": place["via"]}
    terms = key_terms(c["rep"]["title"]) if c["rep"] else []
    lineage = []
    if len(terms) >= 2 and _num(first):
        for e in history_entries:
            shared = [t for t in terms if t in e.get("terms", [])]
            if len(shared) >= 2 and e.get("last_ts") is not None and e["last_ts"] <= first - LINEAGE_GAP_H * 3600 \
                    and e.get("key") != ms[0]["id"]:
                lineage.append({"key": e["key"], "first_ts": e.get("first_ts"), "last_ts": e["last_ts"],
                                "n_outlets": e.get("n_outlets"), "terms": e.get("terms", [])[:4], "shared": shared})
        lineage.sort(key=lambda e: -e["last_ts"])
        lineage = lineage[:8]
    rep_title = c["rep"]["title"] if c["rep"] else None
    pm = photo_mod.pick(ms, rep_title)
    ph = {"id": pm["id"], "url": pm["image"]["url"], "outlet": pm.get("outlet"), "type": pm.get("type"), "from": pm["image"].get("from")} if pm else None
    ph_skip = None if ph else (photo_mod.eligible(ms, rep_title)[1] or "no_image")
    cov = coverage_mod.of(ms)                           # 媒体の比べ（CONTRACT §21）。作れない出来事には欄を付けない
    return {
        "sid": c["sid"], "rule_cids": c["cids"], "rep_id": c["rep"]["id"] if c["rep"] else None,
        "event": c.get("event"),
        "cat": c["cat"], "flags": [k for k in watch.FLAGS if c["flags"].get(k)], "hits": c["hits"],
        "weight": round(w, 3), "fresh": round(f, 3), "score": round(w * f, 3),
        "n_outlets": c["n_outlets"], "n_items": len(ms), "types": c["types"], "ja": c["ja"], "gov": c["gov"],
        "first_ts": first, "last_ts": last, "since_first_h": round(_age_h(first, now), 1) if _num(first) else None,
        "n_new6h": sum(1 for m in ms if _num(m.get("ts")) and now - m["ts"] <= FOLLOW_H * 3600),
        "place": place, "timeline": timeline,
        "heat": {"t0": first, "bin_h": bin_h, "bins": nbins, "rows": rows},
        "fingerprint": fingerprint, "by_type": list(by_type.values()),
        "asym": kind, "key_terms": terms, "lineage": lineage, "photo": ph, "photo_skip": ph_skip, "images": [ph] if ph else [],
        **({"coverage": cov} if cov else {}),
    }


def activity(raw_items, status, now):
    """48 h of REAL headline counts (not members of bundles): per hour (total and by type) and per source (h1/h6/h48)."""
    total = [0] * SLAB_H
    by_type = {}
    act = {}
    future, nodate = collections.Counter(), collections.Counter()
    for it in raw_items:
        sid = it.get("source_id") or ""
        ts = it.get("ts")
        if not _num(ts):
            nodate[sid] += 1
            continue
        age = now - ts
        if age < -3600:
            future[sid] += 1
            continue
        a = act.setdefault(sid, {"h1": 0, "h6": 0, "h48": 0, "last_ts": 0})
        if age < 3600:
            a["h1"] += 1
        if age < 6 * 3600:
            a["h6"] += 1
        a["last_ts"] = max(a["last_ts"], int(ts))
        hr = int(max(0, age) // 3600)
        if 0 <= hr < SLAB_H:
            a["h48"] += 1
            total[hr] += 1
            by_type.setdefault(it.get("type") or "", [0] * SLAB_H)[hr] += 1
    rows, types = [], {}
    for r in status or []:
        sid = r.get("id")
        a = act.get(sid, {"h1": 0, "h6": 0, "h48": 0, "last_ts": 0})
        newest = r.get("newest_ts")
        age = _age_h(newest, now)
        rows.append({"id": sid, "name": r.get("name"), "type": r.get("type"), "home": r.get("home"), "ok": bool(r.get("ok")),
                     "n": r.get("n"), "age_h": round(age, 1) if age is not None else None,
                     "h1": a["h1"], "h6": a["h6"], "h48": a["h48"], "future_n": future.get(sid, 0),
                     "nodate_n": nodate.get(sid, 0), "err": r.get("err") or ""})
        t = types.setdefault(r.get("type") or "", {"type": r.get("type") or "", "sources": 0, "ok": 0, "h48": 0, "newest_ts": None})
        t["sources"] += 1
        t["ok"] += 1 if r.get("ok") else 0
        t["h48"] += a["h48"]
        if _num(newest) and (t["newest_ts"] is None or newest > t["newest_ts"]):
            t["newest_ts"] = int(newest)
    for t in types.values():
        age = _age_h(t["newest_ts"], now)
        t["age_h"] = round(age, 1) if age is not None else None
    stale = [r["id"] for r in rows if r["ok"] and (r["age_h"] or 0) > 72]
    return {"volume": {"hours": SLAB_H, "total": total, "by_type": by_type},
            "sources": rows, "types": sorted(types.values(), key=lambda t: -t["h48"]),
            "health": {"sources": len(rows), "ok": sum(1 for r in rows if r["ok"]), "stale_72h": stale, "stale_label_ja": STALE_LABEL_JA,
                       "future_dated": sum(future.values()), "no_date": sum(nodate.values())}}


def update_history(cs, now, history):
    entries = {e["key"]: e for e in (history or {}).get("entries", []) if isinstance(e, dict) and e.get("key")}
    for c in cs:
        if not c["rep"] or not (c["n_outlets"] >= 2 or any(c["flags"].get(k) for k in watch.FLAGS)):
            continue
        ms = sorted(c["members"], key=lambda m: (m.get("ts") or 1 << 60, m["id"]))
        key = ms[0]["id"]
        old = entries.get(key, {})
        terms = key_terms(c["rep"]["title"])
        entries[key] = {"key": key, "first_ts": min(x for x in (old.get("first_ts"), c["first_ts"]) if x is not None)
                        if (old.get("first_ts") is not None or c["first_ts"] is not None) else None,
                        "last_ts": c["last_ts"], "n_outlets": max(old.get("n_outlets", 0), c["n_outlets"]),
                        "terms": terms, "cat": c["cat"]}
    cut = now - HISTORY_DAYS * 86400
    kept = [e for e in entries.values() if e.get("last_ts") is not None and e["last_ts"] >= cut]
    kept.sort(key=lambda e: -e["last_ts"])
    return {"schema": HISTORY_SCHEMA, "updated_at": int(now), "days": HISTORY_DAYS, "entries": kept[:HISTORY_MAX]}


def compose(data, raw_items=None, now=None, history=None):
    now = int(now if now is not None else data.get("generated_at"))
    raw = list(raw_items) if raw_items is not None else list(data["items"].values())
    cs_all = _stories(data, now)
    cs, evs = events(cs_all, now)
    live = [c for c in cs if not is_stale(c, now)]
    rk = rank_key(now)
    flagged = [c for c in live if any(c["flags"].get(k) for k in watch.FLAGS)]
    pri = sorted([c for c in flagged if not is_stale_priority(c, now)],
                 key=lambda c: (0 if domestic_budget_law(c) else 1,) + tuple(rk(c)))[:PRIORITY_MAX]      # CONTRACT 20.4: domestic money and law first
    outline = {}
    for cat in OUTLINE_CATS:
        sec = sorted([c for c in live if c["cat"] == cat], key=rk)[:OUTLINE_PER_CAT]
        if sec:
            outline[cat] = sec

    def light(c):
        return watch.is_light([c["rep"]["title"] if c["rep"] else ""] + [m.get("title") or "" for m in c["members"]])

    outside = sorted([c for c in live if c["cat"] not in OUTLINE_CATS and c["n_outlets"] >= 3
                      and not any(c["flags"].get(k) for k in watch.FLAGS) and c["rep"] and not light(c) and _outside_ok(c)],
                     key=lambda c: (-round((len(c["types"]) + (0.5 if c["ja"] else 0.0)) * fresh(c, now), 9),
                                    -c["n_outlets"], -(c["last_ts"] or 0), c["sid"]))[:OUTSIDE_MAX]
    asym = []
    cover = mainstream_cover(data.get("sources"))
    for c in live:
        k = asymmetry_of(c, cover)
        if k:
            asym.append((k, c))
    order = {"primary_only": 0, "periphery_only": 1, "overseas_only": 2, "mainstream_only": 3}
    asym.sort(key=lambda kc: (order[kc[0]], -(kc[1]["last_ts"] or 0), kc[1]["sid"]))
    asym_all = asym
    asym = asym[:ASYM_MAX]
    asym_kind = {c["sid"]: k for k, c in asym}

    shown, seen = [], set()
    for c in pri + [x for sec in outline.values() for x in sec] + [c for _, c in asym] + outside \
            + sorted([c for c in live if c["n_outlets"] >= 2], key=rk):
        if c["sid"] not in seen and len(shown) < CASES_MAX:
            seen.add(c["sid"])
            shown.append(c)
    hist = (history or {}).get("entries", []) if isinstance(history, dict) else []
    cases = {c["sid"]: _case(c, now, asym_kind.get(c["sid"]), hist) for c in shown}

    # the slab: hours x category grid of story members, and the PRIORITY pillars
    cats = OUTLINE_CATS + ["その他"]
    grid = [[0] * SLAB_H for _ in cats]
    for c in cs:
        a = _age_h(c["last_ts"], now)
        if a is None or int(a) >= SLAB_H:
            continue
        ci = cats.index(c["cat"]) if c["cat"] in OUTLINE_CATS else len(cats) - 1
        grid[ci][int(a)] += max(1, len(c["members"]))
    pillars = []
    for c in pri[:PILLARS_MAX]:
        a = _age_h(c["last_ts"], now)
        if a is None or int(a) >= SLAB_H:
            continue
        pillars.append({"sid": c["sid"], "cat": cats.index(c["cat"]) if c["cat"] in OUTLINE_CATS else len(cats) - 1,
                        "h": int(a), "n": c["n_outlets"], "flags": [k for k in watch.FLAGS if c["flags"].get(k)]})
    act = activity(raw, data.get("sources", []), now)
    n_place = sum(1 for k in cases.values() if k["place"])
    flag_counts = {k: sum(1 for c in live if c["flags"].get(k)) for k in watch.FLAGS}
    board = {
        "schema": SCHEMA, "generated_at": now, "edition": data.get("edition"), "window_h": data.get("window_h"),
        "latest_generated_at": data.get("generated_at"),
        "flag_labels": {k: {"ja": v.get("ja"), "en": v.get("en"), "scope": v.get("scope")} for k, v in watch.labels().items()},
        "asym_labels": {k: {"ja": v[0], "en": v[1], "rule": v[2]} for k, v in ASYM.items()},
        "rules": {"fresh_tau_h": FRESH_TAU_H, "priority_first_h": PRIORITY_FIRST_H, "priority_quiet_h": PRIORITY_QUIET_H,
                  "stale_quiet_h": STALE_QUIET_H, "follow_h": FOLLOW_H, "ja_bonus": JA_BONUS,
                  "weight": "flags set + 0.5 primary source among members + 0.5 Japanese-language report + 0.1 per outlet type (max 5); the number of outlets is not used",
                  "rank": "weight * exp(-hours since the newest member / 24h), then newest member, then sid",
                  "priority_max": PRIORITY_MAX, "outline_per_cat": OUTLINE_PER_CAT, "outside_max": OUTSIDE_MAX,
                  "asym_max": ASYM_MAX, "cases_max": CASES_MAX, "event_max_df": EVENT_MAX_DF, "event_share": EVENT_SHARE,
                  "event_sim": EVENT_SIM, "threshold": watch.load()["threshold"],
                  "priority_order": "domestic money and law first (money or law flag, Japanese-language report, jp outlet), then the rest; inside each group weight x freshness",
                  "asym_rule": "two or more outlets, and the Japanese mainstream feeds were all fetched and reach back to the start of the event (CONTRACT 20.3)"},
        "priority": [c["sid"] for c in pri],
        "outline": {cat: [c["sid"] for c in sec] for cat, sec in outline.items()},
        "outside": [c["sid"] for c in outside],
        "asymmetry": [{"sid": c["sid"], "kind": k, "label_ja": asym_label(k, c["types"])} for k, c in asym],
        "asym_status": {"complete": cover["complete"], "missing": cover["missing"], "checked": cover["checked"]},
        "slab": {"cats": cats, "hours": SLAB_H, "grid": grid, "pillars": pillars},
        "volume": act["volume"], "sources": act["sources"], "types": act["types"], "health": act["health"],
        "examined": {"fetched_items": len(raw), "in_window": len(data["items"]), "rule_clusters": len(data.get("rule_clusters", [])),
                     "stories": len(data["stories"]), "events": len(evs),
                     "stories_folded": sum(e["event"]["n_stories"] for e in evs) - len(evs),
                     "multi_outlet": sum(1 for c in cs if c["n_outlets"] >= 2),
                     "live": len(live), "stale_dropped": len(cs) - len(live), "flagged": len(flagged),
                     "priority": len(pri), "priority_dropped": sum(1 for c in flagged if is_stale_priority(c, now)),
                     "flag_counts": flag_counts, "asymmetric": len(asym), "cases": len(cases), "with_place": n_place,
                     "primary_items": sum(1 for it in raw if str(it.get("source_id", "")).startswith("primary-"))},
        "events": [{"key": e["event"]["key"], "lead": e["sid"], "sids": e["event"]["sids"], "n_stories": e["event"]["n_stories"],
                    "n_items": len(e["members"]), "n_outlets": e["n_outlets"]} for e in evs],
        "cases": cases,
    }
    kinds = collections.Counter(k for k, _ in asym_all)
    board["counts"] = counts_mod.merge(
        counts_mod.base(data, raw),
        counts_mod.board_part(flag_counts, len(flagged), len(pri), len(asym_all), len(asym),
                              {k: kinds.get(k, 0) for k in ASYM}, len(evs), len(cs)))
    return board, update_history(cs, now, history)
