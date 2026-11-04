# -*- coding: utf-8 -*-
"""primary — RSS を持たない一次資料を頁（HTML）から項目にする。会計検査院・官報・衆参の議案。

存在意義:
  報道のフィルタを通らない一次情報を報道と並置する。官邸・省庁の RSS は the source table にあるが、
  会計検査院・官報・国会の議案は RSS を持たない（検査院 RSS は survey で ok=false、GN の
  site:jbaudit.go.jp は索引日が公表日と食い違うため sources.EXCLUDED）。ここで頁を読んで埋める。

取得器（2026-09-27 に各頁を GET して構造を確かめた）:
  会計検査院 新着 … トップ頁「新着情報」(div.content-row) ＋「注目の検査結果」の表(table.table3)
  官報 目次       … トップ頁の直近 KANPO_DAYS 日 → 日ごとの「全体目次」(dl.allIndexBox)。
                     発行時刻は issueDateTime.html（「本紙、号外、政府調達 8：30 発行」等）から
  衆議院 議案     … 議案の一覧 menu.htm（審議状況の列あり）＋ 経過頁（日付）＋ 会期の一覧 kaiki.htm
  参議院 議案     … current/gian.htm → 回次の gian.htm ＋ 明細頁（状況と日付）＋ トップ頁「会議の案内」

公開関数:
  fetch_primary(ttl=600, budget=None) -> (items, status)
    items: feeds の形 {"title","link","source","feed","cat","lang","ts","summary"}
           ＋ "type"="政府一次", "outlet", "tier"="一次"。id は付けない
           （sources.fetch_everything と board が link から store と同じ規則で付ける）
    status: 取得器ごとに {"name","cat","ok","n","err","url","note","elapsed_s","stale_s","timed_out"}（議案は "n_pending" も）。
           name は items の feed と同じ。elapsed_s はその取得に掛かった秒（時間切れで終わっていなければ None）。
           stale_s は時間切れで前回の成功を出した時だけ、その成功からの秒（それ以外は None）。
           timed_out は上限内に終わらなかった行だけ True
    budget: 全体の時間の上限（秒）。None・0 以下は上限なし（全取得器の終わりまで待つ）。規則は normalize_budget。
           上限内に終わらない取得器は、前回成功した結果を出し note に「時間切れ・前回 N 分前の結果」と書く。
           前回の成功が無ければ ok=False・n=0・理由つき。取得は背景の糸で続け、成功すれば次回のために控える
           （同じ取得器を重ねて走らせない）。sources.fetch_everything は budget_from_env() を渡す
  recheck_timed_out(items, status) -> (items, status)   時間切れの行のうち、今は終わった取得の結果へ差し替える
  normalize_budget(v, default=BUDGET) -> float | None   上限の読み方（数の文字列も読む・NaN と読めない値は default）
  budget_from_env(default=BUDGET) -> float | None   環境変数 PARALLAX_PRIMARY_BUDGET（秒）。0 以下は None（上限なし）
  wareki_to_date(s, default_era=None) -> datetime.date | None
  all_dates(s, default_era=None) -> [datetime.date]
  date_ts(d, hour=0, minute=0) -> int（JST の epoch 秒）
  parse_*（網を使わない純関数。試験と再解析用）

作法:
  ・読み取り（GET）のみ。外へ何も送らない
  ・見出しは頁の文言のまま。頭に目次の区分（〔省令〕等）か審議状況（〔成立〕等）を付けるだけ
  ・日付は頁に書かれた物だけ。和暦は wareki_to_date で変換。日付しか無い頁は JST 0:00 とし
    （官報だけは頁にある発行時刻まで）、読めなければ ts=None。時刻を作らない
  ・議案は ts を経過頁・明細頁の最新日付から取る。まだ読めていない議案は出さず n_pending に数える
    （ts=None で出すと store が first_seen=今 で並べ、3月の成立が今日の報道に見えるため）
  ・link の末尾の印（?toc= / ?upd= / ?OpenDocument&st= / ?st=）は、卓の中で別の項目にするための物。
    頁は同じ（2026-09-27 実測: 印あり・なしで本文が同一の 200。衆議院の Domino は素の ?x= に 400 を
    返すため ?OpenDocument を前に置く）。id は store と同じ make_id(link) の規則のまま、
    目次の各行・審議状況の変化がそれぞれ新しい項目になる（store は既存 id の見出しを書き換えない）
  ・取れなかった取得器は ok=False と理由を残す。件数を作らない。一部の失敗は note に残す
  ・失敗は控えへ焼かない（成功した頁だけ控える。時間切れの時に出す「前回の結果」も成功だけ）
  ・時間切れで前回の結果を出した後、背景の取得が失敗で終わっていれば、次の時間切れは ok=False
    （前回の成功の items は出すが、生きているとは言わない）。前後は壁時計でなく終わった順の通し番号で比べる
  ・頁の取得（_get）の timeout は一回の要求の全体の締切。明細頁の働き手は daemon の糸（プロセスの終了を止めない）
  ・会計検査院・官報も日付の読めない項目は出さない（議案と同じ。数は note に残す）
  ・会期欄が読めない時は会期中とも閉会中とも書かず「不明」。官報の発行日時の頁が取れなかった時は
    「頁に無い」と書かず「取得できず」と書く
  ・選んだ物（事実ではない。変えてよい）: 官報の公告のうち KANPO_SKIP の小見出し、
    検査院の「採用情報」は落とす（落とした件数は note に残す）。政府調達は号ごとに1件へ畳む
    （目次が「入札公告」等の定型語だけで、行ごとでは中身を持たないため）。分野（cat）の割り当て
    （_kanpo_cat・_bill_cat）
"""
import datetime as dt
import gzip
import http.client
import math
import os
import queue
import re
import socket
import ssl
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
from html.parser import HTMLParser

try:
    from parallax import feeds as _feeds
except ImportError:                       # run from inside parallax/
    import feeds as _feeds  # type: ignore
UA = _feeds.UA
JST = dt.timezone(dt.timedelta(hours=9))

JB_TOP = "https://www.jbaudit.go.jp/"
JB_ATT = "https://www.jbaudit.go.jp/report/about/attention.html"
KANPO_TOP = "https://www.kanpo.go.jp/"
KANPO_TIMES = "https://www.kanpo.go.jp/issueDateTime.html"
SHU_MENU = "https://www.shugiin.go.jp/internet/itdb_gian.nsf/html/gian/menu.htm"
SHU_KAIKI = "https://www.shugiin.go.jp/internet/itdb_annai.nsf/html/statics/shiryo/kaiki.htm"
SAN_CURRENT = "https://www.sangiin.go.jp/japanese/joho1/kousei/gian/current/gian.htm"
SAN_TOP = "https://www.sangiin.go.jp/"

KANPO_DAYS = 3                 # 官報は直近この日数（発行日）の全体目次を読む
DETAIL_TTL = 24 * 3600         # 議案の経過・明細頁の控え（閉会中）
DETAIL_TTL_OPEN = 3 * 3600     # 参議院の明細頁の控え（会期中。一覧に状況の列が無く、明細を読み直すしかない）
MAX_DETAIL = 200               # 一度に取り直す経過・明細頁の上限（院ごと）
DETAIL_WORKERS = 4
MAX_BYTES = 8 * 1024 * 1024
BUDGET = 12.0                  # fetch_everything から呼ぶ時の全体の時間の上限（秒）の既定。環境変数で変える
BUDGET_ENV = "PARALLAX_PRIMARY_BUDGET"

# 官報の公告のうち落とす小見出し（相続・破産・決算公告など個人と会社の定型公告。監視の対象外）
KANPO_SKIP = ("裁判所", "地方公共団体", "会社その他", "会社決算公告")


# ============================================================ 和暦
_ERAS = {
    "明治": (1867, dt.date(1868, 1, 1), dt.date(1912, 7, 29)),
    "大正": (1911, dt.date(1912, 7, 30), dt.date(1926, 12, 24)),
    "昭和": (1925, dt.date(1926, 12, 25), dt.date(1989, 1, 7)),
    "平成": (1988, dt.date(1989, 1, 8), dt.date(2019, 4, 30)),
    "令和": (2018, dt.date(2019, 5, 1), None),
}
_ABBR = {"M": "明治", "T": "大正", "S": "昭和", "H": "平成", "R": "令和"}
_RX_ERA = re.compile(r"(明治|大正|昭和|平成|令和)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日")
_RX_AD = re.compile(r"(?<!\d)(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日")
_RX_ABBR = re.compile(r"(?<![A-Za-z])([MTSHR])\s*(\d{1,2})\.(\d{1,2})\.(\d{1,2})(?!\d)")
_RX_NOERA = re.compile(r"(?<!\d)(元|\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日")


def _era_date(era, y, m, d):
    base, start, end = _ERAS[era]
    try:
        n = 1 if y == "元" else int(y)
        out = dt.date(base + n, int(m), int(d))
    except (ValueError, OverflowError):
        return None
    if n < 1 or out < start or (end is not None and out > end):
        return None      # 「平成31年5月1日」のような元号の範囲外は作らない
    return out


def _iter_dates(s, default_era=None):
    """文字列中の日付を位置順に（重なりなし）。-> [(pos, date)]"""
    if not isinstance(s, str) or not s:
        return []
    t = unicodedata.normalize("NFKC", s)      # 全角数字・「㋿」「㍻」も揃う
    found, taken = [], []

    def free(a, b):
        return all(b <= x or a >= y for x, y in taken)

    for m in _RX_ERA.finditer(t):
        d = _era_date(m.group(1), m.group(2), m.group(3), m.group(4))
        taken.append(m.span())
        if d:
            found.append((m.start(), d))
    for m in _RX_ABBR.finditer(t):
        if free(*m.span()):
            d = _era_date(_ABBR[m.group(1)], m.group(2), m.group(3), m.group(4))
            taken.append(m.span())
            if d:
                found.append((m.start(), d))
    for m in _RX_AD.finditer(t):
        if free(*m.span()):
            taken.append(m.span())
            try:
                found.append((m.start(), dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))))
            except ValueError:
                pass
    if default_era in _ERAS:
        for m in _RX_NOERA.finditer(t):
            if free(*m.span()):
                d = _era_date(default_era, m.group(1), m.group(2), m.group(3))
                taken.append(m.span())
                if d:
                    found.append((m.start(), d))
    found.sort(key=lambda x: x[0])
    return found


def wareki_to_date(s, default_era=None):
    """「令和 8年9月25日」「令和元年5月1日」「平成31年4月30日」「R8.9.24」「2026年9月18日」→ date。

    元号の無い「8年9月18日」は default_era を渡した時だけ読む（頁が元号を省く時）。
    元号の範囲外・存在しない日付・読めない物は None。文字列中の最初の日付を返す。
    """
    f = _iter_dates(s, default_era)
    return f[0][1] if f else None


def all_dates(s, default_era=None):
    return [d for _, d in _iter_dates(s, default_era)]


def date_ts(d, hour=0, minute=0):
    """JST の日付（と時刻）→ epoch 秒。"""
    return int(dt.datetime(d.year, d.month, d.day, hour, minute, tzinfo=JST).timestamp())


def _today():
    return dt.datetime.now(JST).date()


def _jp(d):
    """date → 「令和8年9月25日」（要約の表示用）。"""
    if d is None:
        return ""
    for era in ("令和", "平成", "昭和"):
        base, start, end = _ERAS[era]
        if d >= start and (end is None or d <= end):
            n = d.year - base
            return "%s%s年%d月%d日" % (era, "元" if n == 1 else n, d.month, d.day)
    return d.isoformat()


# ============================================================ 小さな DOM（html.parser）
_VOID = frozenset("area base br col embed hr img input link meta param source track wbr".split())
# 閉じ忘れの多い要素: 同じ種類が始まったら、境界（stop）までの間にある開いた物を閉じる
_AUTOCLOSE = {
    "li": ({"li"}, {"ul", "ol"}),
    "dt": ({"dt", "dd"}, {"dl"}),
    "dd": ({"dt", "dd"}, {"dl"}),
    "tr": ({"tr", "td", "th"}, {"table", "tbody", "thead", "tfoot"}),
    "td": ({"td", "th"}, {"tr", "table"}),
    "th": ({"td", "th"}, {"tr", "table"}),
    "option": ({"option"}, {"select"}),
}


class _N:
    __slots__ = ("tag", "attrs", "kids", "parent")

    def __init__(self, tag, attrs=(), parent=None):
        self.tag = tag
        self.attrs = {k: (v or "") for k, v in attrs}
        self.kids = []
        self.parent = parent

    def has_class(self, c):
        return c in self.attrs.get("class", "").split()

    def walk(self):
        """子孫を文書順に（再帰しない。壊れた頁の深い入れ子でも落ちない）。"""
        stack = [iter(self.kids)]
        while stack:
            for k in stack[-1]:
                if isinstance(k, _N):
                    yield k
                    stack.append(iter(k.kids))
                    break
            else:
                stack.pop()

    def find_all(self, tag=None, cls=None):
        return [n for n in self.walk() if (tag is None or n.tag == tag) and (cls is None or n.has_class(cls))]

    def find(self, tag=None, cls=None):
        for n in self.walk():
            if (tag is None or n.tag == tag) and (cls is None or n.has_class(cls)):
                return n
        return None

    def raw_text(self, skip=None):
        out = []
        stack = [iter(self.kids)]
        while stack:
            for k in stack[-1]:
                if isinstance(k, str):
                    out.append(k)
                elif k.tag == "br":
                    out.append(" ")
                elif skip is None or k.tag not in skip:
                    stack.append(iter(k.kids))
                    break
            else:
                stack.pop()
        return "".join(out)

    def text(self, skip=None):
        return _ws(self.raw_text(skip))

    def inside(self, tags, stop=None):
        p = self.parent
        while p is not None and p is not stop:
            if p.tag in tags:
                return True
            p = p.parent
        return False


def _ws(s):
    return re.sub(r"\s+", " ", s or "").strip()


class _Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = _N("#root")
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        rule = _AUTOCLOSE.get(tag)
        if rule:
            closes, stop = rule
            n, hit = self.cur, None
            while n is not self.root and n.tag not in stop:
                if n.tag in closes:
                    hit = n
                n = n.parent
            if hit is not None:
                self.cur = hit.parent
        n = _N(tag, attrs, self.cur)
        self.cur.kids.append(n)
        if tag not in _VOID:
            self.cur = n

    def handle_startendtag(self, tag, attrs):
        self.cur.kids.append(_N(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:             # 開いていない閉じタグは無視する
            self.cur = n.parent

    def handle_data(self, data):
        if self.cur.tag not in ("script", "style"):
            self.cur.kids.append(data)
    # コメントは拾わない（参議院トップの「召集されました」はコメントアウトされた旧文）


def _dom(text):
    b = _Builder()
    try:
        b.feed(text if isinstance(text, str) else "")
        b.close()
    except Exception:          # noqa: BLE001  壊れた頁でも、そこまでに組めた木で続ける
        pass
    return b.root


def _abs(base, href):
    href = (href or "").strip()
    if not href or href.startswith(("javascript:", "#", "mailto:")):
        return ""
    u = urllib.parse.urljoin(base, href)
    return u if urllib.parse.urlsplit(u).scheme in ("http", "https") else ""


def _mark(link, key, val):
    """頁は同じまま別の項目にする印を link の末尾へ（本文は同一。作法を参照）。"""
    sep = "&" if "?" in link else "?"
    return "%s%s%s=%s" % (link, sep, key, urllib.parse.quote(str(val), safe=""))


# ============================================================ 取得（控えは成功だけ）
_ctx = ssl.create_default_context()
_lock = threading.Lock()
_pages = {}     # url -> (at, text)
_detail = {}    # url -> {"at", "key", "parsed"}（議案の経過・明細頁）
_CHARSET = re.compile(rb"charset\s*=\s*[\"']?([A-Za-z0-9_\-]+)", re.I)
_ENC = {"shift_jis": "cp932", "shift-jis": "cp932", "sjis": "cp932", "x-sjis": "cp932",
        "windows-31j": "cp932", "ms932": "cp932"}


def _decode(raw, ctype=""):
    cands = []
    for src in ((ctype or "").encode("latin-1", "ignore"), raw[:4096]):
        m = _CHARSET.search(src)
        if m:
            cands.append(m.group(1).decode("ascii", "ignore").lower())
            break
    for enc in cands + ["utf-8", "cp932", "euc_jp"]:
        try:
            return raw.decode(_ENC.get(enc, enc))
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", "replace")


_tl = threading.local()     # この糸で進行中の _get の締切（接続した socket を渡すため）


class _Deadline:
    """一回の要求の全体の締切。時が来たら、その時点の socket を shutdown して止まっている読みを解く。"""

    def __init__(self, sec):
        self.lk = threading.Lock()
        self.sock, self.fired, self.over = None, False, False
        self.timer = threading.Timer(sec, self._fire)
        self.timer.daemon = True            # 締切の糸でプロセスの終了を止めない

    @staticmethod
    def _cut(s):
        try:
            # SSLSocket.shutdown は _sslobj を捨てるので、素の socket の shutdown を呼ぶ（fd だけを閉じる向きに）
            socket.socket.shutdown(s, socket.SHUT_RDWR)
        except (OSError, ValueError, TypeError):
            pass

    def _fire(self):
        with self.lk:
            if self.over:
                return
            self.fired = True
            s = self.sock
        if s is not None:
            self._cut(s)

    def attach(self, s):
        with self.lk:
            self.sock = s
            fired = self.fired
        if fired:                            # 名前解決・接続・握手の間に締切が来ていた
            self._cut(s)
            raise TimeoutError("全体の締切を過ぎた（接続まで）")

    def finish(self):
        """読み終わりの印。-> 締切が先に来ていたか（来ていれば読めた物は途中までの恐れ）"""
        with self.lk:
            self.over = True
            fired = self.fired
        self.timer.cancel()
        return fired


def _attach_sock(sock):
    dl = getattr(_tl, "deadline", None)
    if dl is not None and sock is not None:
        dl.attach(sock)


class _HTTPConn(http.client.HTTPConnection):
    def connect(self):
        super().connect()
        _attach_sock(self.sock)


class _HTTPSConn(http.client.HTTPSConnection):
    def connect(self):
        super().connect()                    # TLS の握手までは一操作ごとの timeout だけ
        _attach_sock(self.sock)


class _HTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(_HTTPConn, req)


class _HTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_HTTPSConn, req, context=self._context)


# urlopen(context=_ctx) と同じ既定の組（proxy・転送・誤りの扱い）で、接続だけを差し替えた物
_opener = urllib.request.build_opener(_HTTPHandler(), _HTTPSHandler(context=_ctx))


def _get(url, timeout=20):
    """GET → 本文（str）。timeout（秒）は一回の要求の全体の締切（接続した後、応答の頭と本文を読み終わるまで）。
    締切が来たら socket を shutdown して読みを止め、TimeoutError にする（途中までの頁を成功として返さない）。
    2026-09-28 r2: 以前は socket の一操作ごとの timeout だけで、少しずつ送り続ける相手には終わらなかった。
    名前解決と、接続・TLS の握手そのものは一操作ごとの timeout だけ（締切の糸からは解けない）。"""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
    dl = _Deadline(timeout)
    prev, _tl.deadline = getattr(_tl, "deadline", None), dl
    dl.timer.start()
    try:
        with _opener.open(req, timeout=timeout) as r:
            raw = r.read(MAX_BYTES + 1)
            ctype = r.headers.get("Content-Type", "")
    except Exception as e:
        if dl.finish():
            raise TimeoutError("全体の締切 %g 秒を過ぎた（%s: %s）" % (timeout, type(e).__name__, str(e)[:60])) from e
        raise
    finally:
        _tl.deadline = prev
    if dl.finish():
        raise TimeoutError("全体の締切 %g 秒を過ぎた（%d バイトで打ち切り）" % (timeout, len(raw)))
    if len(raw) > MAX_BYTES:
        raise ValueError("頁が大きすぎる（%d バイト超）" % MAX_BYTES)
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return _decode(raw, ctype)


def _page(url, ttl):
    now = time.time()
    with _lock:
        c = _pages.get(url)
        if c and ttl and now - c[0] < ttl:
            return c[1]
    text = _get(url)                      # 失敗は例外のまま呼び手へ（控えへ焼かない）
    with _lock:
        _pages[url] = (now, text)
    return text


def _details(pairs, parse, ttl_detail, max_new=MAX_DETAIL):
    """pairs: [(url, key)]。控えの key が同じで ttl_detail 以内なら控えを使い、それ以外を取り直す
    （上限 max_new 本）。key が変わった物の古い控えは使わない（状況と日付が食い違うため）。
    -> ({url: parsed}, n_fetched, [err])"""
    now = time.time()
    got, todo = {}, []
    with _lock:
        for url, key in pairs:
            c = _detail.get(url)
            if c and c["key"] == key:
                got[url] = c["parsed"]
                if now - c["at"] < ttl_detail:
                    continue
            todo.append((url, key))
    todo = todo[:max(0, int(max_new))]
    errs = []
    for (url, key), text, exc in _pool(lambda uk: _get(uk[0]), todo, DETAIL_WORKERS):
        try:
            if exc is not None:
                raise exc
            parsed = parse(text)
        except Exception as e:  # noqa: BLE001
            errs.append("%s: %s" % (url.rsplit("/", 1)[-1], str(e)[:60]))
            continue
        with _lock:
            _detail[url] = {"at": now, "key": key, "parsed": parsed}
        got[url] = parsed
    return got, len(todo), errs


def _pool(fn, args, workers):
    """fn(a) を daemon の糸 workers 本で回す -> 終わった順に (a, 結果, 例外) を出す生成子（args の数だけ必ず出す）。
    2026-09-28 r2: concurrent.futures の働き手は daemon でなく、プロセスの終了時に待ち行列の残りまで回してから
    join される。上限で返った後も、背景の明細の取得が一回きりのプロセスや卓の終了を止めていた。"""
    args = list(args)
    if not args:
        return
    todo, done = queue.Queue(), queue.Queue()
    for a in args:
        todo.put(a)

    def work():
        while True:
            try:
                a = todo.get_nowait()
            except queue.Empty:
                return
            try:
                done.put((a, fn(a), None))
            except BaseException as e:  # noqa: BLE001  一件ごとに必ず一つ返す（受け手を待たせたままにしない）
                done.put((a, None, e))

    for _ in range(max(1, min(int(workers), len(args)))):
        threading.Thread(target=work, name="ow-primary-detail", daemon=True).start()
    for _ in range(len(args)):
        yield done.get()


# ============================================================ 会計検査院
def parse_jbaudit_top(text, base=JB_TOP):
    """トップ頁「新着情報」。-> (entries, n_skipped)
    entries: [{"title","link","date","kind","lead"}]。タブ（すべて/検査結果/…）の重複は一つに。
    「採用情報」は落として数える。"""
    root = _dom(text)
    out, seen, skipped = [], set(), 0
    for row in root.find_all("div", cls="content-row"):
        tnode, body = row.find("p", cls="time"), row.find("p", cls="content-row-2")
        if tnode is None or body is None:
            continue
        tag = row.find("p", cls="tag")
        kind = tag.text() if tag else ""
        d = wareki_to_date(tnode.text())
        lead = body.text(skip={"a"}).strip("・ ")
        for a in body.find_all("a"):
            link = _abs(base, a.attrs.get("href"))
            title = a.text().strip("・ ")
            if not (link and title):
                continue
            key = (link, title, d)
            if key in seen:
                continue
            seen.add(key)
            if kind == "採用情報":
                skipped += 1
                continue
            out.append({"title": title, "link": link, "date": d, "kind": kind, "lead": lead})
    return out, skipped


def parse_jbaudit_attention(text, base=JB_ATT):
    """「注目の検査結果」の表（公表年月日・件名）。表の年は元号を省く（「8年9月18日」）ので、
    頁が令和で書かれている時だけ令和として読む。-> entries"""
    root = _dom(text)
    era = "令和" if "令和" in root.text() else None
    tables = root.find_all("table", cls="table3") or root.find_all("table")
    out = []
    for tb in tables:
        for tr in tb.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 2:
                continue
            a = tds[1].find("a")
            link = _abs(base, a.attrs.get("href")) if a else ""
            title = a.text() if a else ""
            if link and title:
                out.append({"title": title, "link": link, "date": wareki_to_date(tds[0].text(), era),
                             "kind": "検査結果", "lead": ""})
    return out


def _fetch_jbaudit(ttl):
    errs, top, att, skipped = [], [], [], 0
    try:
        top, skipped = parse_jbaudit_top(_page(JB_TOP, ttl))
    except Exception as e:  # noqa: BLE001
        errs.append("トップ: %s" % str(e)[:80])
    try:
        att = parse_jbaudit_attention(_page(JB_ATT, ttl))
    except Exception as e:  # noqa: BLE001
        errs.append("注目の検査結果: %s" % str(e)[:80])
    by_link = {}
    for e in top:                                   # 新着（西暦の日付）を先に
        by_link.setdefault(e["link"], dict(e))
    for e in att:                                   # 件名は表の方が詳しい（「（処置済）」等の区分付き）
        cur = by_link.get(e["link"])
        if cur is None:
            by_link[e["link"]] = dict(e)
        else:
            cur["title"] = e["title"]
            if cur["date"] is None:
                cur["date"] = e["date"]
    items, nodate = [], 0
    for e in by_link.values():
        d = e["date"]
        if d is None:
            # 日付の読めない項目は出さない（議案と同じ。ts=None だと store が first_seen=今 で並べ、古い公表が今日に見える）
            nodate += 1
            continue
        link = e["link"]
        if e["kind"] not in ("検査結果", ""):
            link = _mark(link, "upd", d.strftime("%Y%m%d"))   # 同じ頁の「更新しました」は日ごとに別の知らせ
        summ = "｜".join(x for x in ("会計検査院 " + (e["kind"] or "新着"), e["lead"], "公表 " + _jp(d)) if x)
        items.append({"title": e["title"], "link": link, "cat": "公金監視", "ts": date_ts(d), "summary": summ})
    note = "新着 %d 件・注目の検査結果 %d 件（link で重ね %d 件）・日付なし %d 件（出さない）・採用情報 %d 件を落とした" % (
        len(top), len(att), len(items) + nodate, nodate, skipped)
    if errs:
        note += "｜一部失敗: " + " / ".join(errs)
    ok = bool(items)
    if ok:
        err = ""
    elif nodate:
        err = "日付の読める項目が無い（%d 件は日付が読めず出さない）" % nodate
        if errs:
            err += " / " + " / ".join(errs)
    else:
        err = " / ".join(errs) or "項目なし（頁の構造が変わった恐れ）"
    return items, {"ok": ok, "err": err, "note": note}


# ============================================================ 官報
def parse_kanpo_index(text, base=KANPO_TOP):
    """トップ頁 → [(date, 全体目次 url)]（頁の順＝新しい順）。日付は dt の和暦、読めなければ URL の yyyymmdd。"""
    root = _dom(text)
    out, seen = [], set()
    for dl in root.find_all("dl"):
        dtn = dl.find("dt")
        if dtn is None:
            continue
        for a in dtn.find_all("a"):
            url = _abs(base, a.attrs.get("href"))
            if not url.endswith(".fullcontents.html") or url in seen:
                continue
            d = wareki_to_date(dtn.text())
            if d is None:
                m = re.search(r"/(\d{4})(\d{2})(\d{2})\.fullcontents\.html$", url)
                try:
                    d = dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None
                except ValueError:
                    d = None
            seen.add(url)
            out.append((d, url))
    return out


_RX_TIME = re.compile(r"^(.+?)\s*(\d{1,2}):(\d{2})\s*発行")
_RX_ISSUE = re.compile(r"(本紙|号外|特別号外|政府調達|官報目録)\s*(?:\(?第\s*(\d+)\s*号\)?)?")


def _lines(root):
    """ブロック要素の境で改行した本文の行。"""
    out, buf = [], []
    block = {"p", "div", "li", "dt", "dd", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "table", "ul", "dl"}

    def flush():
        s = _ws("".join(buf))
        if s:
            out.append(s)
        buf.clear()
    stack = [iter(root.kids)]
    while stack:
        for k in stack[-1]:
            if isinstance(k, str):
                buf.append(k)
            elif k.tag == "br":
                flush()
            else:
                if k.tag in block:
                    flush()
                stack.append(iter(k.kids))
                break
        else:
            stack.pop()
    flush()
    return out


def parse_kanpo_times(text):
    """issueDateTime.html → {(date, 種類, 号 or None): (時, 分)}。
    「本紙、号外、政府調達、特別号外（第50号） 8：30 発行」を種類ごとに割る。"""
    out, cur = {}, None
    for line in _lines(_dom(text)):
        t = unicodedata.normalize("NFKC", line)
        m = _RX_TIME.match(t)
        if m and cur is not None:
            hm = (int(m.group(2)), int(m.group(3)))
            if hm[0] > 23 or hm[1] > 59:
                continue
            for lab in re.split(r"[、,]", m.group(1)):
                im = _RX_ISSUE.search(lab)
                if im:
                    out[(cur, im.group(1), int(im.group(2)) if im.group(2) else None)] = hm
            continue
        d = wareki_to_date(t)
        if d is not None and len(t) <= 20:
            cur = d
    return out


def parse_kanpo_contents(text, base=None, date=None):
    """日ごとの全体目次 → (entries, date)。
    entries: [{"issue","kind","no","h2","h3","h4","text","page","href","ord","in_heading"}]
    ord は号の中の目次の通し番号（落とす前の生の順。印 ?toc= に使う）。"""
    root = _dom(text)
    # 頁自身の見出し（section#operation の h2「令和 8年9月25日」）が読めればそれを、読めなければ渡された日付
    op = next((n for n in root.find_all("section") if n.attrs.get("id") == "operation"), None)
    h = op.find("h2") if op is not None else None
    own = wareki_to_date(h.text()) if h is not None else None
    date = own or date
    out = []
    for dl in root.find_all("dl", cls="allIndexBox"):
        dtn, dd = dl.find("dt"), dl.find("dd")
        if dtn is None or dd is None:
            continue
        label = dtn.text()
        im = _RX_ISSUE.search(unicodedata.normalize("NFKC", label))
        kind = im.group(1) if im else label
        no = int(im.group(2)) if im and im.group(2) else None
        h2 = h3 = h4 = ""
        ordn = 0
        for n in dd.walk():
            if n.tag in ("h2", "h3", "h4"):
                sp = n.find("span", cls="text")
                lab = sp.text() if sp else n.text()
                if n.tag == "h2":
                    h2, h3, h4 = lab, "", ""
                elif n.tag == "h3":
                    h3, h4 = lab, ""
                else:
                    h4 = lab
            elif n.tag == "a":
                href = _abs(base or KANPO_TOP, n.attrs.get("href"))
                if not href:
                    continue
                sp, pg = n.find("span", cls="text"), n.find("span", cls="date")
                t = sp.text() if sp else n.text()
                if not t:
                    continue
                ordn += 1
                out.append({"issue": label, "kind": kind, "no": no, "h2": h2, "h3": h3, "h4": h4,
                            "text": t, "page": pg.text() if pg else "", "href": href, "ord": ordn,
                            "in_heading": n.inside(("h2", "h3", "h4"), stop=dd)})
    return out, date


_KNUM = "〇一二三四五六七八九十百千0123456789"
_ISSUER_CAT = (("防衛", "安全保障"), ("警察", "安全保障"), ("国家公安", "安全保障"), ("公安調査", "安全保障"),
               ("会計検査", "公金監視"), ("財務", "公金監視"), ("国税", "公金監視"),
               ("外務", "国際"), ("金融庁", "市場"), ("日本銀行", "市場"), ("経済産業", "経済"))


def _issuer(text):
    """見出し末尾の（発出者＋番号）の発出者。「（同三五七）」は「同」を返す。"""
    m = re.search(r"（([^（）]*)）\s*$", text or "")
    if not m:
        return ""
    return re.sub("[%s、，\\s]+$" % _KNUM, "", m.group(1))


def _kanpo_cat(kind, h2, issuer):
    if kind == "政府調達":
        return "公金監視"
    if h2 == "人事異動":
        return "国内政治"
    for key, cat in _ISSUER_CAT:
        if key in (issuer or ""):
            return cat
    return "国内政治"


def kanpo_items(entries, date, times=None):
    """目次の行 → items（KANPO_SKIP を落とし、政府調達は号ごとに1件へ畳む）。-> (items, n_skipped)
    times: parse_kanpo_times の結果。None は「発行日時の頁が取れなかった」（要約に「頁に無い」と書かない）。"""
    got_times = times is not None
    times = times or {}
    items, skipped = [], 0
    proc = {}                                   # 政府調達: (issue, kind, no) -> [entries]
    last_issuer = {}                            # 号ごとの直前の発出者（「同」の解決）
    for e in entries:
        if e["kind"] == "政府調達":
            proc.setdefault((e["issue"], e["kind"], e["no"]), []).append(e)
            continue
        sub = e["h4"] or e["h3"]
        if e["h2"] == "公告" and (sub in KANPO_SKIP or (e["in_heading"] and e["text"] in KANPO_SKIP)):
            skipped += 1
            continue
        iss = _issuer(e["text"])
        key = (e["issue"], e["no"])
        if iss == "同":
            iss = last_issuer.get(key, "")
        elif iss:
            last_issuer[key] = iss
        if e["in_heading"]:
            title = "〔%s〕官報 %s" % (e["text"], e["issue"])
        else:
            title = "〔%s〕%s" % (e["h2"] or e["h3"] or e["h4"] or "目次", e["text"])
        items.append(_kanpo_item(title, _mark(e["href"], "toc", e["ord"]), e, date, times,
                                 _kanpo_cat(e["kind"], e["h2"], iss), got_times))
    for (issue, kind, no), es in proc.items():
        labels = []
        for e in es:
            if e["text"] not in labels:
                labels.append(e["text"])
        title = "〔政府調達〕官報 %s：%s" % (issue, "・".join(labels))
        items.append(_kanpo_item(title, es[0]["href"], es[0], date, times, "公金監視", got_times))
    return items, skipped


def _kanpo_item(title, link, e, date, times, cat, got_times=True):
    hm = times.get((date, e["kind"], e["no"])) or times.get((date, e["kind"], None))
    path = " ＞ ".join(x for x in (e["h2"], e["h3"], e["h4"]) if x)
    summ = "官報 %s（%s）" % (e["issue"], _jp(date) if date else "発行日 読めず")
    if path:
        summ += "｜" + path
    if e["page"] and e["kind"] != "政府調達":
        summ += "｜%s頁" % e["page"]
    if date is not None and hm is None:
        # 頁を読めて該当が無い時と、頁そのものが取れなかった時を分ける（取れなかった物を「無い」と言わない）
        summ += "｜発行時刻は頁に無く日付のみ" if got_times else "｜発行時刻は取得できず日付のみ"
    ts = date_ts(date, *hm) if (date is not None and hm) else (date_ts(date) if date is not None else None)
    return {"title": title, "link": link, "cat": cat, "ts": ts, "summary": summ}


def _fetch_kanpo(ttl, days=None):
    days = KANPO_DAYS if days is None else days
    idx = parse_kanpo_index(_page(KANPO_TOP, ttl))
    if not idx:
        return [], {"ok": False, "err": "トップ頁に全体目次の link が無い（頁の構造が変わった恐れ）"}
    errs = []
    try:
        times = parse_kanpo_times(_page(KANPO_TIMES, ttl))
    except Exception as e:  # noqa: BLE001
        times = None                              # 取れなかった（「頁に無い」とは書かない）
        errs.append("発行日時: %s" % str(e)[:80])
    today = _today()
    items, skipped, read, nodate = [], 0, [], 0
    for d, url in idx[:days]:
        # 過ぎた日の目次は動かない（その日の特別号外は当日中に足される）ので長く控える
        t_ttl = ttl if (d is None or d >= today) else max(ttl or 0, 6 * 3600)
        try:
            entries, d2 = parse_kanpo_contents(_page(url, t_ttl), base=url, date=d)
        except Exception as e:  # noqa: BLE001
            errs.append("%s: %s" % (url.rsplit("/", 1)[-1], str(e)[:80]))
            continue
        its, sk = kanpo_items(entries, d2, times)
        if d2 is None:
            # 発行日が頁の見出しからも URL からも読めない日は出さない（議案と同じ。ts=None は今日に見える）
            nodate += len(its)
            read.append("%s 発行日読めず %d件を出さない" % (url.rsplit("/", 1)[-1], len(its)))
            continue
        items += its
        skipped += sk
        read.append("%s %d件" % (_jp(d2), len(its)))
    note = "直近 %d 日: %s・公告の %s を %d 件落とした・日付なし %d 件（出さない）・発行時刻 %s" % (
        len(read), "、".join(read), "/".join(KANPO_SKIP), skipped, nodate,
        ("%d 組" % len(times)) if times is not None else "取得失敗")
    if errs:
        note += "｜一部失敗: " + " / ".join(errs)
    ok = bool(items)
    if ok:
        err = ""
    elif nodate:
        err = "発行日の読める目次が無い（%d 件は発行日が読めず出さない）" % nodate
        if errs:
            err += " / " + " / ".join(errs)
    else:
        err = " / ".join(errs) or "目次の行が無い（頁の構造が変わった恐れ）"
    return items, {"ok": ok, "err": err, "note": note}


# ============================================================ 国会（会期）
def parse_shugiin_kaiki(text):
    """衆議院「会期の一覧」→ [{"kaiji","kind","start","end","dissolved"}]（頁の順）。"""
    out = []
    for tr in _dom(text).find_all("tr"):
        cells = [c.text() for c in tr.walk() if c.tag in ("td", "th")]
        if not cells:
            continue
        m = re.search(r"第\s*(\d+)\s*回\s*[（(]([^）)]+)[）)]", unicodedata.normalize("NFKC", cells[0]))
        if not m or len(cells) < 3:
            continue
        start, end = wareki_to_date(cells[1]), wareki_to_date(cells[2])
        if start is None:
            continue
        out.append({"kaiji": int(m.group(1)), "kind": m.group(2), "start": start, "end": end,
                    "dissolved": "解散" in cells[2]})
    return out


def session_state(sessions, today=None):
    """最新の回次の会期と、今日が会期中か閉会中か。-> dict or None"""
    if not sessions:
        return None
    today = today or _today()
    s = max(sessions, key=lambda x: x["kaiji"])
    is_open = s["start"] <= today and (s["end"] is None or today <= s["end"])
    text = "第%d回国会（%s）%s〜%s%s：%s（%s 時点）" % (
        s["kaiji"], s["kind"], _jp(s["start"]), _jp(s["end"]) if s["end"] else "会期終了日 空欄",
        "（解散）" if s["dissolved"] else "", "会期中" if is_open else "閉会中", today.isoformat())
    return dict(s, open=is_open, text=text)


def _bill_cat(kind, name):
    k = unicodedata.normalize("NFKC", kind or "")
    if any(w in k for w in ("予算", "決算", "承諾", "国有財産", "予備費", "NHK")):
        return "公金監視"
    if "条約" in k:
        return "国際"
    if re.search(r"防衛|自衛隊|安全保障|武力攻撃|インテリジェンス|経済安全|サイバー", name or ""):
        return "安全保障"
    return "国内政治"


def _bill_label(kind, kaiji, no):
    s = kind or ""
    if kaiji:
        s += " 第%s回" % kaiji
    if no:
        s += " %s号" % no
    return s.strip()


# ============================================================ 衆議院
def parse_shugiin_list(text, base=SHU_MENU):
    """議案の一覧 → (見出し, bills)。bills: [{"kind","sub","kaiji","no","name","status","keika","honbun"}]
    列は見出し行（提出回次・番号・議案件名・審議状況・経過情報…）の名前で引く（表ごとに列が違う）。"""
    root = _dom(text)
    h = root.find("h2") or root.find("title")
    heading = h.text() if h else ""
    bills = []
    for tb in root.find_all("table"):
        cap = tb.find("caption")
        if cap is None:
            continue
        kind = re.sub(r"の一覧$", "", cap.text())
        # 見出しは最初の td より前の th（予算・条約の表は th が <tr> の外に置かれている。2026-09-27 実物）
        head = []
        for n in tb.walk():
            if n.tag == "td":
                break
            if n.tag == "th":
                head.append(n.text())
        col = {name: i for i, name in enumerate(head)}
        if "議案件名" not in col or "審議状況" not in col:
            continue
        for tr in tb.find_all("tr"):
            tds = tr.find_all("td")
            if not tds:
                continue

            def cell(name, tds=tds):
                i = col.get(name)
                return tds[i] if i is not None and i < len(tds) else None

            def txt(name):
                c = cell(name)
                return c.text() if c is not None else ""

            def href(name):
                c = cell(name)
                a = c.find("a") if c is not None else None
                return _abs(base, a.attrs.get("href")) if a else ""

            name = txt("議案件名")
            if not name:
                continue
            bills.append({"kind": kind, "sub": txt("種類"), "kaiji": txt("提出回次"), "no": txt("番号"),
                          "name": name, "status": txt("審議状況"), "keika": href("経過情報"),
                          "honbun": href("本文情報")})
    return heading, bills


def parse_shugiin_keika(text):
    """経過頁 → {"fields": {項目: 内容}, "dates": [date]}（日付は内容の欄だけから）。"""
    fields = {}
    for tr in _dom(text).find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) >= 2:
            k = tds[0].text()
            if k:
                fields[k] = tds[1].text()
    if not fields:
        raise ValueError("経過の表が無い")
    return {"fields": fields, "dates": [d for v in fields.values() for d in all_dates(v)]}


def _slash(v):
    """「令和 8年 3月13日 ／ 可決」→「令和 8年 3月13日 可決」。中身の無い「／」は空。"""
    parts = [p.strip() for p in (v or "").split("／")]
    return " ".join(p for p in parts if p)


def _shugiin_summary(b, f):
    bits = ["衆議院 %s" % _bill_label(b["sub"] or b["kind"], b["kaiji"], b["no"]),
            "審議状況 %s" % (b["status"] or "空欄")]
    for k, lab in (("議案提出者", "提出者"),
                   ("衆議院審議終了年月日／衆議院審議結果", "衆議院 審議終了"),
                   ("衆議院審議時会派態度", "衆議院 会派態度"),
                   ("参議院審議終了年月日／参議院審議結果", "参議院 審議終了"),
                   ("公布年月日／法律番号", "公布／法律番号")):
        v = _slash(f.get(k, ""))
        if v:
            bits.append("%s %s" % (lab, v))
    return "｜".join(bits)


def _fetch_shugiin(ttl, max_detail=MAX_DETAIL):
    heading, bills = parse_shugiin_list(_page(SHU_MENU, ttl))
    if not bills:
        return [], {"ok": False, "err": "議案の表が読めない（頁の構造が変わった恐れ）"}
    notes = [heading]
    try:
        st = session_state(parse_shugiin_kaiki(_page(SHU_KAIKI, max(ttl or 0, 6 * 3600))))
        notes.append(st["text"] if st else "会期の一覧が読めない")
    except Exception as e:  # noqa: BLE001
        notes.append("会期の一覧: 取得失敗 %s" % str(e)[:60])
    pairs = [(b["keika"], b["status"]) for b in bills if b["keika"]]
    got, n_fetch, errs = _details(pairs, parse_shugiin_keika, DETAIL_TTL, max_detail)
    today = _today()
    items, pending, nodate = [], 0, 0
    counts = {}
    for b in bills:
        counts[b["status"] or "空欄"] = counts.get(b["status"] or "空欄", 0) + 1
        k = got.get(b["keika"]) if b["keika"] else None
        if k is None:
            pending += 1
            continue
        past = [d for d in k["dates"] if d <= today]
        if not past:
            nodate += 1
            continue
        status = b["status"] or "審議状況 空欄"
        items.append({
            "title": "〔%s〕%s（%s）" % (status, b["name"], _bill_label(b["sub"] or b["kind"], b["kaiji"], b["no"])),
            "link": _mark(b["keika"] + "?OpenDocument", "st", status),
            "cat": _bill_cat(b["sub"] or b["kind"], b["name"]),
            "ts": date_ts(max(past)),
            "summary": _shugiin_summary(b, k["fields"]),
        })
    notes.append("一覧 %d 件（%s）・経過頁 今回取得 %d・未読 %d・日付なし %d" % (
        len(bills), "・".join("%s %d" % kv for kv in sorted(counts.items(), key=lambda x: -x[1])),
        n_fetch, pending, nodate))
    if errs:
        notes.append("経過頁の失敗 %d: %s" % (len(errs), " / ".join(errs[:3])))
    ok = bool(items)
    return items, {"ok": ok, "err": "" if ok else ("経過頁が一つも読めない: " + " / ".join(errs[:3])),
                   "note": "｜".join(notes), "n_pending": pending}


# ============================================================ 参議院
_SAN_KIND = {"法律案（内閣提出）": "閣法", "法律案（衆法）": "衆法", "法律案（参法）": "参法"}


def parse_sangiin_current(text, base=SAN_CURRENT):
    """current/gian.htm（JS の転送頁）→ 回次の gian.htm の url。"""
    m = re.search(r"location\.replace\(\s*[\"']([^\"']+)[\"']", text or "")
    if m:
        return _abs(base, m.group(1))
    for a in _dom(text).find_all("a"):
        u = _abs(base, a.attrs.get("href"))
        if re.search(r"/gian/\d+/gian\.htm$", u):
            return u
    return ""


def parse_sangiin_list(text, base):
    """回次の議案情報 → {"period","start","end","asof","bills":[{"kind","kaiji","no","name","meisai"}]}"""
    root = _dom(text)
    period, start, end, asof = "", None, None, None
    for p in root.find_all("p"):
        t = p.text()
        if not period and re.search(r"第\s*\d+\s*回国会", unicodedata.normalize("NFKC", t)) and "～" in t:
            period = t
            ds = all_dates(t)
            if len(ds) >= 2:
                start, end = ds[0], ds[1]
        if asof is None and t.endswith("現在"):
            asof = wareki_to_date(t)
    bills = []
    for tb in root.find_all("table"):
        sec = tb.attrs.get("summary", "")
        if not sec.endswith("一覧"):
            continue
        kind = sec[:-2]
        kind = _SAN_KIND.get(kind, kind)
        for tr in tb.find_all("tr"):
            a = next((x for x in tr.find_all("a") if "/meisai/" in _abs(base, x.attrs.get("href"))), None)
            if a is None:
                continue
            nums = [td.text() for td in tr.find_all("td") if re.fullmatch(r"\d+", td.text())]
            name = a.text()
            if name:
                bills.append({"kind": kind, "kaiji": nums[0] if nums else "", "no": nums[1] if len(nums) > 1 else "",
                              "name": name, "meisai": _abs(base, a.attrs.get("href"))})
    return {"period": period, "start": start, "end": end, "asof": asof, "bills": bills}


# 同じ日の出来事の強さ（公布 > 本会議 > 委員会の議決 > 受領・送付 > 付託 > 提出）
_RANK = {"公布": 7, "本会議": 6, "委員会": 5, "受領": 4, "送付": 4, "付託": 3, "提出": 1}


def parse_sangiin_meisai(text):
    """明細頁 → {"name","kind","asof","sections":{区分:{項目:内容}},"events":[(date,rank,label)],"status","dates"}
    status は日付の最も新しい出来事（同じ日は _RANK の強い方）を頁の語で書いた物。"""
    root = _dom(text)
    sections = {}
    for tb in root.find_all("table"):
        sec = tb.attrs.get("summary", "")
        rows = {}
        for tr in tb.find_all("tr"):
            cells = [c for c in tr.walk() if c.tag in ("th", "td")]
            if len(cells) == 1 and cells[0].tag == "th":
                sec = cells[0].text() or sec          # 「参議院委員会等経過」等の見出し行
                continue
            for i in range(len(cells) - 1):
                if cells[i].tag == "th" and cells[i + 1].tag == "td":
                    rows[cells[i].text()] = cells[i + 1].text()
        if rows:
            sections.setdefault(sec, {}).update(rows)
    if not sections:
        raise ValueError("明細の表が無い")
    base = {}
    for sec, rows in sections.items():
        if "議案審議情報" in sec:
            base.update(rows)
    events = []

    def ev(v, rank, label):
        d = wareki_to_date(v)
        if d is not None:
            events.append((d, rank, label))
    ev(base.get("提出日"), _RANK["提出"], "提出")
    ev(base.get("衆議院から受領／提出日"), _RANK["受領"], "衆議院から受領")
    ev(base.get("衆議院へ送付／提出日"), _RANK["送付"], "衆議院へ送付")
    for sec, rows in sections.items():
        house = "参議院" if sec.startswith("参議院") else ("衆議院" if sec.startswith("衆議院") else "")
        if not house:
            continue
        if "委員会" in sec:
            ev(rows.get("本付託日"), _RANK["付託"], "%s %s付託" % (house, rows.get("付託委員会等", "")))
            ev(rows.get("議決日"), _RANK["委員会"], "%s委員会 %s" % (house, rows.get("議決", "")))
        elif "本会議" in sec:
            ev(rows.get("議決日"), _RANK["本会議"], "%s本会議 %s" % (house, rows.get("議決", "")))
    other = next((rows for sec, rows in sections.items() if sec.startswith("その他")), {})
    no = other.get("法律番号", "")
    ev(other.get("公布年月日"), _RANK["公布"], "公布（法律第%s号）" % no if no else "公布")
    events = [(d, r, _ws(lab)) for d, r, lab in events]
    status = max(events, key=lambda x: (x[0], x[1]))[2] if events else ""
    asof = None
    for p in root.find_all("p"):
        if p.text().endswith("現在"):
            asof = wareki_to_date(p.text())
            break
    return {"name": base.get("件名", ""), "kind": base.get("種別", ""), "asof": asof, "sections": sections,
            "events": sorted(events), "status": status, "dates": [e[0] for e in events],
            "keizoku": base.get("継続区分", ""), "shokan": other.get("所管官庁", "")}


def parse_sangiin_top(text):
    """トップ頁「会議の案内」の文（コメントアウトされた旧文は拾わない）。"""
    for p in _dom(text).find_all("p"):
        t = p.text()
        if re.search(r"第\s*\d+\s*回国会", unicodedata.normalize("NFKC", t)):
            return t
    return ""


def _fetch_sangiin(ttl, max_detail=MAX_DETAIL):
    url = parse_sangiin_current(_page(SAN_CURRENT, ttl))
    if not url:
        return [], {"ok": False, "err": "current/gian.htm から回次の頁を引けない（頁の構造が変わった恐れ）"}
    lst = parse_sangiin_list(_page(url, ttl), url)
    if not lst["bills"]:
        return [], {"ok": False, "err": "議案の表が読めない（頁の構造が変わった恐れ）: %s" % url}
    today = _today()
    if lst["start"] is not None and lst["end"] is not None:
        is_open = lst["start"] <= today <= lst["end"]
        state = "会期中" if is_open else "閉会中"
    else:
        is_open = None                  # 読めない物を会期中とも閉会中とも言わない
        state = "不明（会期欄から召集日・会期終了日が読めない）"
    notes = [(lst["period"] or "会期欄 読めず") + "：" + state + "（%s 時点・議案情報の会期欄より）" % today.isoformat()]
    try:
        top = parse_sangiin_top(_page(SAN_TOP, ttl))
        if top:
            notes.append("トップ頁「会議の案内」: " + top)
    except Exception as e:  # noqa: BLE001
        notes.append("トップ頁: 取得失敗 %s" % str(e)[:60])
    if lst["asof"]:
        notes.append("議案情報 %s現在" % _jp(lst["asof"]))
    pairs = [(b["meisai"], "") for b in lst["bills"]]
    # 会期が不明な時は会期中と同じ短い控え（読み直しを減らす側へ倒さない）
    got, n_fetch, errs = _details(pairs, parse_sangiin_meisai, DETAIL_TTL if is_open is False else DETAIL_TTL_OPEN,
                                  max_detail)
    items, pending, nodate, counts = [], 0, 0, {}
    for b in lst["bills"]:
        m = got.get(b["meisai"])
        if m is None:
            pending += 1
            continue
        past = [d for d in m["dates"] if d <= today]
        if not past or not m["status"]:
            nodate += 1
            continue
        status = m["status"]
        head = status.split(" ")[0].split("（")[0]
        counts[head] = counts.get(head, 0) + 1
        bits = ["参議院 %s" % _bill_label(b["kind"], b["kaiji"], b["no"])]
        bits += ["%s %s" % (lab, _jp(d)) for d, _, lab in m["events"] if d <= today]
        if m["keizoku"]:
            bits.append("継続区分 %s" % m["keizoku"])
        if m["shokan"]:
            bits.append("所管 %s" % m["shokan"])
        if m["asof"]:
            bits.append("明細 %s現在" % _jp(m["asof"]))
        items.append({
            "title": "〔%s〕%s（%s）" % (status, b["name"], _bill_label(b["kind"], b["kaiji"], b["no"])),
            "link": _mark(b["meisai"], "st", status),
            "cat": _bill_cat(b["kind"], b["name"]),
            "ts": date_ts(max(past)),
            "summary": "｜".join(bits),
        })
    notes.append("一覧 %d 件・明細 今回取得 %d・未読 %d・日付なし %d・最新の出来事 %s" % (
        len(lst["bills"]), n_fetch, pending, nodate,
        "・".join("%s %d" % kv for kv in sorted(counts.items(), key=lambda x: -x[1]))))
    if errs:
        notes.append("明細頁の失敗 %d: %s" % (len(errs), " / ".join(errs[:3])))
    ok = bool(items)
    return items, {"ok": ok, "err": "" if ok else ("明細頁が一つも読めない: " + " / ".join(errs[:3])),
                   "note": "｜".join(notes), "n_pending": pending}


# ============================================================ 公開関数
# (feed 名, 媒体名, 既定の分野, 入口 url, 取得器)
FETCHERS = (
    ("会計検査院 新着", "会計検査院", "公金監視", JB_TOP, _fetch_jbaudit),
    ("官報 目次", "官報", "国内政治", KANPO_TOP, _fetch_kanpo),
    ("衆議院 議案", "衆議院", "国内政治", SHU_MENU, _fetch_shugiin),
    ("参議院 議案", "参議院", "国内政治", SAN_CURRENT, _fetch_sangiin),
)


_BAD = object()     # 上限として読めない値の印


def _read_budget(v):
    """-> float（上限の秒）| None（上限なし）| _BAD（読めない）"""
    if v is None or isinstance(v, bool):
        return _BAD
    try:
        b = float(v.strip()) if isinstance(v, str) else float(v)
    except OverflowError:
        return None                     # float に入らないほど大きい＝上限なし
    except (TypeError, ValueError):
        return _BAD
    if math.isnan(b):
        return _BAD
    if b <= 0 or math.isinf(b) or b >= threading.TIMEOUT_MAX:
        return None
    return b


def normalize_budget(v, default=BUDGET):
    """時間の上限（秒）を一つの規則で解く。budget_from_env・fetch_primary・sources._primary_budget が同じ物を使う。
    数と数の文字列（"12"）→ float。0 以下・無限大・threading.TIMEOUT_MAX 以上 → None（上限なし）。
    読めない値（None・空・数でない・NaN・真偽値）→ default を同じ規則で解いた物（default も読めなければ None）。"""
    b = _read_budget(v)
    if b is _BAD:
        b = _read_budget(default)
        if b is _BAD:
            return None
    return b


def budget_from_env(default=BUDGET):
    """fetch_everything が primary に渡す全体の時間の上限（秒）。環境変数 PARALLAX_PRIMARY_BUDGET で変える。
    規則は normalize_budget: 空・数でない・NaN は default。0 以下・無限大は None（上限なし＝全取得器の終わりまで待つ）。"""
    return normalize_budget(os.environ.get(BUDGET_ENV), default)


# 時間の上限つきで回すための控え（_lock で守る）
# 時刻の比べ合いに壁時計（time.time）は使わない: この機では分解能 0.015625 秒で、時計は戻りうる（2026-09-28 r2）。
# 「どちらが後に終わったか」は feed ごとの通し番号 seq で、秒（締切・何秒前か）は time.perf_counter で数える
# （単調で分解能 1e-7 秒。time.monotonic はこの機で 0.015625 秒刻みで、Event.wait(0.3) を 40 回中 12 回 0.3 秒未満と読んだ）
_runs = {}        # feed -> {"done": Event, "result": (good, st) | None, "started": perf_counter, "gave_up": 待ちきれず返った呼び出しの数}
_last_good = {}   # feed -> {"seq", "at": 壁時計, "pc", "items": [...], "st": {...}}。成功（ok）だけ
_last_end = {}    # feed -> {"seq", "at", "pc", "ok", "err"}。最後に終わった取得の成否（失敗を隠さないため。items は持たない）
_end_seq = {}     # feed -> 終わった取得の通し番号（単調に増える。_clear_cache でも戻さない）


def _ago(sec):
    sec = max(0, int(sec))
    return ("%d 秒" % sec) if sec < 60 else ("%d 分" % (sec // 60))


def _run_one(feed, outlet, cat, url, fn, ttl):
    """取得器一つ -> (good, st)。例外を外へ出さない。成功（ok）だけ _last_good へ控える。"""
    t0 = time.perf_counter()
    try:
        its, rec = fn(ttl)
        if not isinstance(rec, dict):
            raise TypeError("取得器の返り値が (items, dict) でない")
    except Exception as e:  # noqa: BLE001
        its, rec = [], {"ok": False, "err": "%s: %s" % (type(e).__name__, str(e)[:120])}
    good = []
    for it in its or []:
        if not (isinstance(it, dict) and it.get("title") and it.get("link")):
            continue
        good.append({"title": it["title"], "link": it["link"], "source": outlet, "feed": feed,
                     "cat": it.get("cat") or cat, "lang": "ja", "ts": it.get("ts"),
                     "summary": it.get("summary", ""), "type": "政府一次", "outlet": outlet,
                     "tier": "一次"})
    ok = bool(rec.get("ok")) and bool(good)
    end, end_m = time.time(), time.perf_counter()
    st = {"name": feed, "cat": cat, "ok": ok, "n": len(good),
          "err": "" if ok else (rec.get("err") or "項目なし"), "url": url, "note": rec.get("note", ""),
          "elapsed_s": round(end_m - t0, 1), "stale_s": None, "timed_out": False}
    if "n_pending" in rec:
        st["n_pending"] = rec["n_pending"]
    with _lock:
        seq = _end_seq.get(feed, 0) + 1          # 終わった順（壁時計が同じ刻み・逆戻りでも前後を取り違えない）
        _end_seq[feed] = seq
        _last_end[feed] = {"seq": seq, "at": end, "pc": end_m, "ok": ok, "err": st["err"]}
        if ok:
            _last_good[feed] = {"seq": seq, "at": end, "pc": end_m, "items": [dict(i) for i in good], "st": dict(st)}
    return good, st


def _start(feed, outlet, cat, url, fn, ttl):
    """取得器を背景の糸で走らせる -> (run, missed)。同じ feed の取得がまだ走っていれば、重ねずその run を返す。
    missed: この呼び出しで始めた run なら None。走っている run を使う時は、この呼び出しが始まった時点で
    その run を待ちきれず返っていた前の呼び出しの数（0 なら、同じ頃に並んで呼ばれただけ）。
    run の欄はこの呼び出しの始まりに一度だけ写す。後から来た呼び出しで、この呼び出しの判定は変わらない。"""
    with _lock:
        run = _runs.get(feed)
        if run is not None and not run["done"].is_set():
            return run, run["gave_up"]
        run = {"done": threading.Event(), "result": None, "started": time.perf_counter(), "gave_up": 0}
        _runs[feed] = run

    def body():
        try:
            run["result"] = _run_one(feed, outlet, cat, url, fn, ttl)
        finally:
            run["done"].set()
    # daemon: 卓の終了を背景の取得で止めない（控えは成功した時だけ入る）
    threading.Thread(target=body, name="ow-primary-%s" % feed, daemon=True).start()
    return run, None


def _timed_out(feed, cat, url, budget, run, missed=None):
    """上限内に終わらなかった取得器の (good, st)。前回の成功があればそれを、無ければ ok=False。
    missed は _start がこの呼び出しに返した物。判定に run の共有の欄 gave_up は使わない（一つ足して返るだけ）。"""
    now = time.perf_counter()
    with _lock:
        prev = _last_good.get(feed)
        last = _last_end.get(feed)
        run["gave_up"] += 1                 # この呼び出しは待ちきれず返る（次に来る呼び出しが _start で写す）
    head = "時間切れ（上限 %g 秒で終わらず。取得は背景で継続・開始から %s）" % (budget, _ago(now - run["started"]))
    failed_after = last is not None and not last["ok"] and (prev is None or last["seq"] > prev["seq"])
    if prev is None:
        err = head + "・前回の成功なし"
        if failed_after:
            err += "・直近の取得（%s前）も失敗: %s" % (_ago(now - last["pc"]), last["err"][:100])
        return [], {"name": feed, "cat": cat, "ok": False, "n": 0, "err": err, "url": url, "note": "",
                    "elapsed_s": None, "stale_s": None, "timed_out": True}
    items = [dict(i) for i in prev["items"]]
    st = dict(prev["st"])
    age = now - prev["pc"]
    msg = head + "・前回 %s前の結果" % _ago(age)
    if failed_after:
        # 前回の成功の後に失敗で終わった取得がある。items は出すが、生きているとは言わない
        st["ok"] = False
        st["err"] = msg + "・その後の取得（%s前）は失敗: %s" % (_ago(now - last["pc"]), last["err"][:100])
    elif missed:
        # この取得は前の呼び出しで始まり、その呼び出しは待ちきれず返った。まだ終わらない＝少なくとも一回を丸ごと取りこぼした。
        # 固まった取得器が ok=True のまま「生きている」と数えられ続けないように（閾値は置かない）
        st["ok"] = False
        st["err"] = msg + "・取得が%s前から終わらない（この取得を待ちきれず返った前の呼び出し %d 回）" % (
            _ago(now - run["started"]), missed)
    else:
        st["ok"], st["err"] = True, ""
    st.update(n=len(items), url=url, note=msg + ("｜" + prev["st"]["note"] if prev["st"].get("note") else ""),
              elapsed_s=None, stale_s=round(age), timed_out=True)
    return items, st


def fetch_primary(ttl=600, budget=None):
    """四つの取得器を並列に走らせる -> (items, status)。一つが落ちても他は返す。

    ttl は入口頁（一覧・目次・トップ）の控えの秒数。議案の経過・明細頁は DETAIL_TTL（閉会中）/
    DETAIL_TTL_OPEN（会期中の参議院）で別に控え、衆議院は一覧の審議状況が変わった議案だけ取り直す。
    budget（秒）: 全体の時間の上限。None は上限なし。それ以外は normalize_budget の規則（0 以下は上限なし・
    "12" も読む・読めない値は budget_from_env()）。上限内に終わらない取得器は _timed_out の形
    （前回の成功の結果か ok=False・timed_out=True）。その取得は背景で続き、成功すれば次回のために _last_good へ入る。
    """
    lim = None if budget is None else normalize_budget(budget, default=budget_from_env())
    deadline = None if lim is None else time.perf_counter() + lim
    runs = [(feed, cat, url) + _start(feed, outlet, cat, url, fn, ttl) for feed, outlet, cat, url, fn in FETCHERS]
    items, status = [], []
    for feed, cat, url, run, missed in runs:
        left = None if deadline is None else max(0.0, deadline - time.perf_counter())
        finished = run["done"].wait(left)
        res = run["result"] if run["done"].is_set() else None   # 上限の直後に終わった物もそのまま使う
        if res is not None:
            good, st = [dict(i) for i in res[0]], dict(res[1])
        elif finished:                      # _run_one は投げない作りだが、糸が result を置かずに終わった時
            good, st = [], {"name": feed, "cat": cat, "ok": False, "n": 0, "url": url, "note": "",
                            "err": "取得の糸が結果を残さず終わった", "elapsed_s": None, "stale_s": None,
                            "timed_out": False}
        else:
            good, st = _timed_out(feed, cat, url, lim, run, missed)
        status.append(st)
        items.extend(good)
    return items, status


def recheck_timed_out(items, status):
    """fetch_primary の (items, status) の時間切れの行（timed_out=True）を、返す直前にもう一度見る -> (items, status)。
    その feed の取得がもう終わっていれば、上限内に終わった時と同じ形（その取得の結果・timed_out=False）に差し替え、
    note の頭に「上限の後・返る前に終わった取得を拾い直した」と書く。まだ走っていれば行はそのまま。
    控えを見るだけで網には出ない。sources.fetch_everything が RSS を待ち終えた後に呼ぶ（2026-09-28 r2）。
    渡された物は書き換えない。"""
    status = [dict(s) if isinstance(s, dict) else s for s in (status or [])]
    by_feed = {}
    for it in items or []:
        by_feed.setdefault(it.get("feed") if isinstance(it, dict) else None, []).append(it)
    swapped = {}
    for i, st in enumerate(status):
        if not (isinstance(st, dict) and st.get("timed_out")):
            continue
        feed = st.get("name")
        with _lock:
            run = _runs.get(feed)
        # _runs[feed] は待った run か、その後に始まった新しい run（古い物に戻ることは無い）
        res = run["result"] if (run is not None and run["done"].is_set()) else None
        if res is None:
            continue
        good, new = [dict(x) for x in res[0]], dict(res[1])
        new["note"] = "上限の後・返る前に終わった取得を拾い直した" + ("｜" + new["note"] if new.get("note") else "")
        swapped[feed] = good
        status[i] = new
    if not swapped:
        return list(items or []), status
    out, used = [], set()
    for st in status:
        feed = st.get("name") if isinstance(st, dict) else None
        if feed in used:
            continue
        used.add(feed)
        out.extend(swapped[feed] if feed in swapped else by_feed.get(feed, []))
    for feed, its in by_feed.items():          # status に行の無い items（作りの上は無い）も落とさない
        if feed not in used:
            out.extend(its)
    return out, status


def _clear_cache():
    """試験用: 控えを全て捨てる（走行中の取得は止められないので、終わった物の記録だけ捨てる）。
    _end_seq（終わった順の通し番号）は戻さない（走行中の取得が後から書く記録と前後を取り違えないため）。"""
    with _lock:
        _pages.clear()
        _detail.clear()
        _last_good.clear()
        _last_end.clear()
        for k in [k for k, r in _runs.items() if r["done"].is_set()]:
            del _runs[k]


def _wait_runs(timeout=None):
    """試験用: 走行中の取得が全て終わるまで待つ。-> 全て終わったか"""
    with _lock:
        evs = [r["done"] for r in _runs.values()]
    end = None if timeout is None else time.time() + timeout
    for ev in evs:
        if not ev.wait(None if end is None else max(0.0, end - time.time())):
            return False
    return True
