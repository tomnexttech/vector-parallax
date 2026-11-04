# -*- coding: utf-8 -*-
"""keyterms — the big words of a headline (kanji / katakana / digit / Latin runs; no dates, counts or boilerplate), CONTRACT 18.5.

This is the key-word routine of the same maker's earlier board, ported as it stands, so that the words on an event's card and the
lineage lookups are the same words the original board uses. Rules that were written after a real look at headlines of 2026-09-29:
a run is cut before okurigana, the leading date and ordinal are dropped, counts with a unit and boilerplate words (速報・告示・掲載 ...) are not words,
English names are read from capitalised runs (Title Case headlines cut at verbs). It returns an empty list when a headline has no big word
(a fragment of the head of the headline is never used instead). Stdlib only; no network.
"""
import re

try:
    from parallax.places import _cut_tail
except ImportError:                                   # run from inside parallax/
    from places import _cut_tail  # type: ignore

# ── 見出しの鍵語（場面の札・放送の照会・系譜の検索）──────────────────────────
# 2026-09-29 検証の指摘: 仮名と数字の境で切っていたため「準備疑（テロ準備疑い）」「人逮捕（５人逮捕）」「他告示（その他告示）」
# 「令和」＋「年度一般会計…」の欠片が札に出ていた。語は切らずに取る:
#   漢字・片仮名・数字・英字の続き（仮名・記号・空白で区切る）を一語とし、送り仮名の付く最後の漢字（疑い・近く・受け）は外す。
#   頭の日付（令和8年度・9月29日）は外し、数と単位だけの語（28年・5人）と定型の語（速報・告示・掲載…）は採らない
_KT_STOP = {"について", "政府", "日本", "発表", "明らか", "方針", "検討", "開始",
            "速報", "独自", "詳報", "続報", "動画", "写真", "画像", "更新", "解説", "社説", "告示", "件", "公表", "掲載",
            "実施", "決定", "一部", "改正", "公示", "通知", "開催", "記事", "概況", "まとめ", "全文", "要旨", "ニュース",
            "法規的告示", "官庁報告", "人事異動", "国会事項", "政府調達", "省令", "政令", "お知らせ", "結果",
            "今日", "以来", "来月", "今月", "今年", "昨年", "前年", "最後", "一方", "全力", "報道"}
_KT_STOP_EN = {"The", "A", "An", "And", "Or", "But", "As", "In", "On", "Of", "For", "To", "With", "By", "At", "From",
               "Is", "Are", "Was", "Were", "Be", "Been", "After", "Over", "Amid", "Into", "Its", "It", "This", "That",
               "These", "Those", "Why", "How", "What", "Who", "When", "Where", "Will", "Would", "Could", "Should", "May",
               "Can", "Says", "Say", "Said", "New", "Not", "If", "Than", "Up", "Out", "Off", "Here", "There", "Just",
               "More", "Most", "Some", "All", "Now", "Our", "Your", "Their", "His", "Her", "We", "You", "They", "He",
               "She", "I", "Mr", "Ms", "Mrs", "Dr", "Gov", "Sen", "Rep", "Jr", "Sr", "Report", "Reports", "Exclusive",
               "Opinion", "Analysis", "Live", "Update", "Updates", "Breaking", "Watch", "Video", "Photos", "News",
               "Every", "Each"}
# 語頭を全て大文字にする見出し（Title Case）では、動詞と一般の語も大文字で来る。名の続きをここで切る
_KT_TC_STOP = {"Against", "About", "Before", "Between", "Despite", "During", "Under", "Without", "Through", "Toward",
               "Towards", "Including", "Near", "Ahead", "Behind", "Across", "Among", "Until", "Since", "While", "Via",
               "Allows", "Allow", "Releases", "Shows", "Calls", "Hits", "Hit", "Adds", "Add",
               "Backs", "Blocks", "Takes", "Take", "Makes", "Make", "Gets", "Get", "Sets",
               "Faces", "Seeks", "Seek", "Plans", "Warns", "Warn", "Urges", "Urge", "Wins",
               "Loses", "Lose", "Falls", "Rises", "Jumps", "Drops", "Slams", "Denies", "Agrees", "Agree",
               "Signs", "Pushes", "Moves", "Launches", "Unveils", "Announces", "Reveals",
               "Boosts", "Boost", "Keeps", "Keep", "Holds", "Tells", "Tell", "Gives", "Give", "Wants", "Want",
               "Is", "Isn’t", "Isn't", "Wrong", "Right", "Wider", "Bigger", "Higher", "Lower", "Billion", "Million",
               "Trillion", "Percent", "First", "Last", "Next", "Top", "Big", "Key", "Major", "Details", "Intensifying",
               "Running", "Looking", "Getting", "Making", "Taking", "Coming", "Going", "Heres", "Here’s", "Here's"}
_KT_RUN = re.compile(r"[0-9０-９A-Za-zＡ-Ｚａ-ｚ一-龥々〆ヶァ-ヴー]+")
_KT_KEEP_NEXT = set("のがをにへとでやもはかなしすさせだらよほあおご")   # 語の切れ目（助詞・する・だ・ある・お〜）
_KT_NUM = "0-9０-９一二三四五六七八九十〇元"
# 頭の日付（令和8年度・9月29日・10月末）。語の中ほどの日付（臨時国会10月5日召集）は語を分ける
_KT_DATE_HEAD = re.compile(r"^(?:(?:令和|平成|昭和)[" + _KT_NUM + r"]+年度?|[0-9０-９]{2,4}年度?)?"
                           r"(?:[0-9０-９]{1,2}月|[一二三四五六七八九十]{1,3}月)?"
                           r"(?:[0-9０-９]{1,2}日|[一二三四五六七八九十]{1,3}日|末|初め|上旬|中旬|下旬)?")
_KT_DATE_MID = re.compile(r"(?:(?:令和|平成|昭和)[" + _KT_NUM + r"]+年度?)?[0-9０-９]{1,2}月[0-9０-９]{1,2}日")
_KT_ORD_HEAD = re.compile(r"^第[" + _KT_NUM + r"]+[号回条項次期]")
_KT_COUNT = re.compile(r"^[0-9０-９]+(?:年度?|月|日|時|分|号|回|期|次|人|件|倍|歳|本|個|社|点|位|割|%|％)?(?:以上|以下|未満|超|程度|前後)?$")
# 送り仮名の前で切った後にまだ残る動詞の頭（見送り→見送・見直し→見直・利回り→利回）
_KT_VERB2 = {"利回", "見送", "取組", "引上", "引下", "見通", "見直", "打切", "繰上", "繰下", "受入", "申込", "取消", "立上",
             "呼掛", "差押", "売出", "買戻", "割引", "割当", "払戻", "積立", "据置", "先送", "持越", "締切", "貸出", "引揚",
             "値上", "値下", "切替", "入替", "言渡", "取調", "取扱", "手続", "問合", "話合", "見込", "見合", "乗換", "引継", "打合"}
# 「し」が送り仮名になる漢字（直し・示し・出し…）。それ以外の「し」は「する」（逮捕し）
_KT_SHI = set("直示出渡話残越通探返押貸落回流消移増減戻伸延崩冷起生燃刺殺表指隠試"
              "乏著厳詳険珍久悲楽苦怪惜寂貧忙")          # 形容詞の「しい」（乏しく・厳しい）。修正し・非難し の「し」は する
_KT_SU = {"目指", "手出", "見出", "乗出", "打出", "持出", "引出", "差出", "繰出"}   # 「す」が送り仮名の動詞（目指す・手出すな）
_KT_MEDIA = re.compile(r"新聞|通信|テレビ|放送|ニュース|日報|新報|タイムス|オンライン|ドットコム|ジャーナル|プレス|系$|"
                       r"BIZ|Biz|ONLINE|Online|News|NEWS|Times|Post|Press|Journal|\.jp|\.com")


def _tail_group(t):
    """末尾の括弧（入れ子可）→ (開き括弧の位置, 中身)。無ければ (-1, "")"""
    t2 = (t or "").rstrip()
    if not t2 or t2[-1] not in "）)":
        return -1, ""
    depth = 0
    for i in range(len(t2) - 1, max(-1, len(t2) - 64), -1):
        ch = t2[i]
        if ch in "）)":
            depth += 1
        elif ch in "（(":
            depth -= 1
            if depth == 0:
                return i, t2[i + 1:-1]
    return -1, ""


def _kt_body(title):
    """鍵語を取る本文: 末尾の媒体名（ - 媒体・：時事ドットコム・（共同通信）・（テレビ朝日系（ANN））・| 東洋経済オンライン）と
    末尾の括弧書き（（令和8年9月29日閣議決定分）（同一一六九～一一七一））を落とす"""
    t = _cut_tail(title or "")
    t = re.sub(r"(?:\s*[|｜]\s*[^|｜]{1,24})+\s*$", "", t) if re.search(r"\s[|｜]\s", t) else t
    t = re.sub(r"[：:]\s*[^：:]{2,16}$", lambda m: "" if _KT_MEDIA.search(m.group(0)) else m.group(0), t)
    for _ in range(2):
        i, inner = _tail_group(t)
        if i > 3:
            t = t[:i]
    t = re.sub(r"(?<=.{4})【[^】]{1,16}】\s*$", "", t)          # 末尾の欄の名（【やわらかゼミ】）
    return re.sub(r"その(?:他|後|際|上|中)", " ", t)


def _kt_word(w, nxt):
    """一続きの語 → 札に載せる語（送り仮名の前で切る・頭の日付と序数を外す）。載せない時は ""。"""
    if nxt and "ぁ" <= nxt[0] <= "ゖ" and re.match(r"[一-龥々]", w[-1]):
        c0, c1 = nxt[0], nxt[1:2]
        cut = c0 not in _KT_KEEP_NEXT
        if c0 == "し" and w[-1] in _KT_SHI and len(w) >= 2:
            cut = True                                  # 見直し・示し（する の し ではない）
        if c0 == "な" and c1 in ("る", "っ", "り", "れ", "ら"):
            cut = True                                  # 重なる・連なり
        if c0 == "ま" and c1 != "で":
            cut = True                                  # 始まる・決まり（まで は助詞）
        if w[-2:] in _KT_SU and c0 in "すさしそせ":
            cut = True                                  # 反映目指す → 反映
        if cut:
            if w[-2:] in _KT_VERB2 or w[-2:] in _KT_SU:
                w = w[:-2]
            else:
                w = w[:-1]
                if len(w) > 2 and w[-1] in "見取引打繰立受申差買売払切組締貸借乗呼持追押書読話":
                    w = w[:-1]                          # 同伴見送り → 同伴
    for _ in range(2):
        head = _KT_DATE_HEAD.match(w).group(0) or (_KT_ORD_HEAD.match(w).group(0) if _KT_ORD_HEAD.match(w) else "")
        if not head:
            break
        if len(w) - len(head) < 2:
            return ""                                   # 日付・序数に一字（令和九年産・30年前）は語にならない
        w = w[len(head):]
    if len(w) < 2 or _KT_COUNT.match(w) or w in _KT_STOP or (re.fullmatch(r"[0-9０-９A-Za-z]+", w) and len(w) < 3):
        return ""
    return w


def key_terms(title):
    body = _kt_body(title)
    if re.search(r"[ぁ-んァ-ヴ一-龥]", body):
        cands = []
        for m in _KT_RUN.finditer(body):
            run, nxt = m.group(0), body[m.end():m.end() + 2]
            # 語の中ほどの日付で分ける（臨時国会10月5日召集 → 臨時国会・召集）
            parts, last = [], 0
            for d in _KT_DATE_MID.finditer(run):
                parts.append((run[last:d.start()], ""))
                last = d.end()
            parts.append((run[last:], nxt))
            for piece, nx in parts:
                w = _kt_word(piece, nx) if piece else ""
                if not w:
                    continue
                kanji = bool(re.search(r"[一-龥々]", w))
                mixed = kanji and bool(re.search(r"[ァ-ヴA-Za-zＡ-Ｚａ-ｚ]", w))
                score = min(len(w), 5) + (2 if kanji else 0) + (1 if mixed else 0)     # 同じ重さなら見出しの先の語
                cands.append((-score, m.start(), w))
        terms = [w for _s, _p, w in sorted(cands)]
    else:
        toks = list(re.finditer(r"[A-Za-z][A-Za-z'’.&-]*[A-Za-z.]|[A-Z]", body))
        long_ = [t.group(0) for t in toks if len(t.group(0)) >= 4]
        title_case = bool(long_) and sum(1 for w in long_ if w[0].isupper()) >= 0.7 * len(long_)
        seqs, cur, prev_end = [], [], None
        for i, t in enumerate(toks):
            w = t.group(0)
            poss = bool(re.search(r"(?:'s|’s)$", w))
            w0 = re.sub(r"(?:'s|’s)$", "", w)
            w0 = w0 if re.fullmatch(r"(?:[A-Z]\.){2,}", w0) else w0.rstrip(".")      # U.S. はそのまま
            cap = w0[:1].isupper() and w0.rstrip(".") not in _KT_STOP_EN
            gap = body[prev_end:t.start()] if prev_end is not None else ""
            prev_end = t.end()
            # 句読点・所有格で名の続きを切る（ICC, EU・Myanmar’s Rakhine）
            if cur and (gap.strip() or cur[-1][2]):
                seqs.append(cur)
                cur = []
            if cap and title_case and w0 in _KT_TC_STOP:
                cap = False                      # Title Case の動詞・一般の語で名の続きを切る（Bill Gates | Says | Trump）
            if cap:
                cur.append((i, w0, poss))
                continue
            if cur:
                seqs.append(cur)
                cur = []
        if cur:
            seqs.append(cur)
        terms = []
        for sq in seqs:
            name = " ".join(w for _i, w, _p in sq)
            w1 = sq[0][1]
            if len(sq) == 1 and title_case and not (len(w1) >= 4 or w1.isupper() and len(w1) >= 2):
                continue                         # Title Case の短い一語（Use・War）は名でない
            if len(sq) == 1 and sq[0][0] == 0 and not title_case and not sq[0][1].isupper():
                terms.append((1, name))          # 文頭の大文字だけの語（Airstrike・Judge）は後へ
            elif len(name) >= 2:
                terms.append((0, name))
        terms = [w for _o, w in sorted(terms, key=lambda x: x[0])]
    out, seen = [], set()
    for w in terms:
        k = w.casefold()
        if k not in seen:
            seen.add(k)
            out.append(w)
    return out                              # 無ければ空（見出しの頭を切った欠片で埋めない）
