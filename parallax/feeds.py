# -*- coding: utf-8 -*-
"""feeds — RSS 2.0 / Atom / RSS 1.0 (RDF) を一つの形へ揃える購読層（標準ライブラリだけ）。

返す形（全源共通）:
  {"title", "link", "source", "feed", "cat", "lang", "ts"(epoch 秒 or None), "summary", "image"}

summary と image は読むだけで、公開する data/*.json へは書かない（build.py が落とす）。
desc = 配信が項目に付けた説明の最初の段落（札を外した文）。載せるか・長さ・広告文の除外は sources.make_desc が決める（CONTRACT §14.1）。
壊れた XML でも正規表現で拾えるだけ拾う。取れなかった源は取れなかったと status に残し、件数を作らない。
見出しは原文のまま。読み取りのみで、外へ何も送らない。
"""
import concurrent.futures as cf
import email.utils
import html
import re
import ssl
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

UA = ("Mozilla/5.0 (compatible; VECTOR-PARALLAX/0.1; +https://github.com/tomnexttech/vector-parallax)")

_ctx = ssl.create_default_context()
_lock = threading.Lock()
_cache = {}          # url -> {"at", "items", "ok", "err"}


def _get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout, context=_ctx) as r:
        raw = r.read()
    for enc in ("utf-8", "shift_jis", "euc_jp", "cp932"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


_TAG = re.compile(r"<[^>]+>")


def _clean(s, n=None):
    if not s:
        return ""
    s = html.unescape(_TAG.sub(" ", s))
    s = re.sub(r"\s+", " ", s).strip()
    return s[:n] if n else s


_BREAK = re.compile(r"</p\s*>|</div\s*>|<hr\b[^>]*>|(?:<br\b[^>]*>\s*){2,}|\n[ \t]*\n", re.I)


def first_paragraph(raw, n=600):
    """配信が項目に付けた説明（description・summary・content の生の文字列。HTML でも、実体参照でエスケープした HTML でもよい）の最初の段落を、
    札を外して空白を詰めた文で返す。段落の切れ目は </p>・</div>・<hr>・<br> の二連・空行。空の段落（画像だけの段落など）は飛ばす。
    読めなければ ""。n は返す長さの上限（切り詰めの方針は sources.make_desc）。"""
    if not raw or not isinstance(raw, str):
        return ""
    s = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", raw, flags=re.S)
    if "<" not in s and "&lt;" in s:
        s = html.unescape(s)                      # 実体参照でエスケープされた HTML
    for blk in _BREAK.split(s):
        t = _clean(blk)
        t = _clean(_TAG.sub(" ", t))              # 二重にエスケープされた札の取りこぼし
        if t:
            return t[:n]
    return ""


def _desc_raw(el):
    """項目の説明の生の文字列。description → summary → content → encoded の順で、最初に中身のある物。"""
    for name in ("description", "summary", "content", "encoded"):
        v = _child_text(el, name)
        if v and v.strip():
            return v
    return ""


def _ts(s):
    """RFC822 / ISO8601 の日付を epoch 秒へ。読めなければ None（時刻を作らない）"""
    if not s:
        return None
    s = s.strip()
    try:
        d = email.utils.parsedate_to_datetime(s)
        return d.timestamp()
    except Exception:
        pass
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?", s)
    if m:
        import datetime as dt
        y, mo, d_, h, mi, se, tz = m.groups()
        base = dt.datetime(int(y), int(mo), int(d_), int(h or 0), int(mi or 0), int(se or 0))
        if tz and tz != "Z":
            sign = 1 if tz[0] == "+" else -1
            tz = tz[1:].replace(":", "")
            off = dt.timedelta(hours=int(tz[:2]), minutes=int(tz[2:4] or 0)) * sign
            base = base.replace(tzinfo=dt.timezone(off))
        else:
            base = base.replace(tzinfo=dt.timezone.utc if tz == "Z" else
                                dt.timezone(dt.timedelta(hours=9)))
        return base.timestamp()
    return None


def _local(tag):
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


# ---------------------------------------------------------------- 画像

_IMG_EXT = re.compile(r"\.(?:jpe?g|png|gif|webp|avif)(?:$|[?#&])", re.I)
_IMG_TAG = re.compile(r"<img\b[^>]*>", re.I)
_ATTR = re.compile(r"""([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))""")
# 追跡・計測・飾り。記事の写真ではない物
_TRACKER = re.compile(
    r"(?:feedburner\.com/~|feeds\.feedburner\.com|stats\.wp\.com|doubleclick\.net|"
    r"googleadservices|/b/ss/|[/._-]pixel[./?_-]|/tracking/|/beacon|spacer\.gif|blank\.gif|"
    r"transparent\.(?:gif|png)|[/_.-]1x1[/_.-]|gravatar\.com/avatar|s\.w\.org/images/core/emoji)",
    re.I)
_MIN_SIDE = 60      # 幅か高さの属性がこれ未満なら飾り（アイコン・追跡画像）とみなす


def _attrs(tag):
    return {k.lower(): html.unescape(a or b or c) for k, a, b, c in _ATTR.findall(tag)}


def _int(v):
    try:
        return int(float(str(v).strip().lower().rstrip("px")))
    except (TypeError, ValueError):
        return None


def image_ok(url, w=None, h=None):
    """記事の写真として扱ってよい URL か。http(s) 以外・追跡画像・小さすぎる飾りは False。"""
    if not url or len(url) > 2000 or not url.lower().startswith(("http://", "https://")):
        return False
    if _TRACKER.search(url):
        return False
    for v in (w, h):
        n = _int(v)
        if n is not None and n < _MIN_SIDE:
            return False
    return True


def abs_url(u, base):
    """相対 URL・プロトコル相対（//cdn...）を base で絶対化する。読めなければ ""。"""
    u = html.unescape((u or "").strip())
    if not u or u.lower().startswith(("data:", "javascript:")):
        return ""
    if u.startswith("//"):
        return "https:" + u
    if u.lower().startswith(("http://", "https://")):
        return u
    if not base:
        return ""
    try:
        return urllib.parse.urljoin(base.strip(), u)
    except ValueError:
        return ""


def _img_from_html(s, base):
    """HTML（エスケープされた物も）の最初の使える <img src>。"""
    if not s:
        return ""
    if "<img" not in s.lower() and "&lt;img" in s.lower():
        s = html.unescape(s)
    for m in _IMG_TAG.finditer(s):
        a = _attrs(m.group(0))
        u = abs_url(a.get("src") or a.get("data-src") or "", base)
        if image_ok(u, a.get("width"), a.get("height")):
            return u
    return ""


def _media_cand(kind, a):
    """media:content / media:thumbnail / enclosure / link の属性 → (順位, 幅, url) か None。"""
    url = a.get("url") or a.get("href") or ""
    if not url:
        return None
    typ = (a.get("type") or "").lower()
    med = (a.get("medium") or "").lower()
    if typ.startswith(("video/", "audio/")) or med in ("video", "audio", "document", "executable"):
        return None
    w, h = a.get("width"), a.get("height")
    for v in (w, h):
        n = _int(v)
        if n is not None and n < _MIN_SIDE:
            return None
    if kind == "content":
        if med == "image" or typ.startswith("image/") or (not med and not typ and _IMG_EXT.search(url)):
            return (0, _int(w) or 0, url)
        return None
    if kind in ("enclosure", "link"):
        if kind == "link" and (a.get("rel") or "").lower() != "enclosure":
            return None
        if typ.startswith("image/") or (not typ and _IMG_EXT.search(url)):
            return (1, _int(w) or 0, url)
        return None
    if kind == "thumbnail":
        return (2, _int(w) or 0, url)
    return None


def _choose_image(cands, html_texts, base):
    """順位の小さい物 → 同順位なら幅の大きい物。媒体の印が無ければ HTML の最初の <img>。"""
    best = None
    for c in cands:
        if not c:
            continue
        pri, w, u = c
        u = abs_url(u, base)
        if not image_ok(u):
            continue
        key = (pri, -w)
        if best is None or key < best[0]:
            best = (key, u)
    if best:
        return best[1]
    for t in html_texts:
        u = _img_from_html(t, base)
        if u:
            return u
    return ""


def _image_el(el, link):
    """ElementTree の item/entry から画像 URL（無ければ ""）。media:group の入れ子も見る。"""
    cands, texts = [], []
    for d in el.iter():
        if d is el:
            continue
        n = _local(d.tag)
        if n in ("content", "thumbnail", "enclosure", "link") and (d.get("url") or d.get("href")):
            cands.append(_media_cand(n, {k.lower(): v for k, v in d.attrib.items()}))
        elif n in ("description", "summary", "encoded", "content") and d.text:
            texts.append(d.text)
    return _choose_image(cands, texts, link)


_RX_MEDIA = re.compile(r"<(media:content|media:thumbnail|enclosure|link)\b[^>]*>", re.I)


def _image_rx(blk, link):
    """正規表現で読んだ項目の塊から画像 URL（無ければ ""）。"""
    cands = []
    for m in _RX_MEDIA.finditer(blk):
        kind = m.group(1).lower().split(":")[-1]
        a = _attrs(m.group(0))
        if kind == "link" and not a.get("href"):
            continue
        cands.append(_media_cand(kind, a))
    texts = []
    for t in ("description", "summary", "content:encoded", "content"):
        for mm in re.finditer(r"<%s\b[^>]*>(.*?)</%s>" % (t, t), blk, re.S | re.I):
            texts.append(re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", mm.group(1), flags=re.S))
    return _choose_image(cands, texts, link)


def _child_text(el, *names):
    for c in el:
        if _local(c.tag) in names:
            if _local(c.tag) == "link" and c.get("href"):
                return c.get("href")
            if c.text and c.text.strip():
                return c.text
    return ""


def _parse_xml(text):
    root = ET.fromstring(text.encode("utf-8") if isinstance(text, str) else text)
    out = []
    for el in root.iter():
        name = _local(el.tag)
        if name not in ("item", "entry"):
            continue
        title = _child_text(el, "title")
        link = _child_text(el, "link", "guid")
        src = ""
        for c in el:
            if _local(c.tag) == "source":
                src = (c.text or "").strip()
        pub = _child_text(el, "pubDate", "published", "updated", "date", "issued")
        summ = _child_text(el, "description", "summary", "content", "encoded")
        desc = first_paragraph(_desc_raw(el))
        link = (link or "").strip()
        try:
            img = _image_el(el, link)
        except Exception:           # 画像の拾い損ねで見出しを落とさない
            img = ""
        out.append({"title": _clean(title, 220), "link": link,
                    "source": _clean(src, 40), "ts": _ts(pub),
                    "summary": _clean(summ, 360), "image": img, "desc": desc,
                    # Google News は description に「同じ事件を報じた他媒体の見出し」の HTML を持つ。
                    # summary はタグを消すので、束ねのために生のまま一度だけ残す（fetch で GN 以外は捨てる）
                    "raw_desc": summ or ""})
    return out


_ITEM = re.compile(r"<(item|entry)\b[^>]*>(.*?)</\1>", re.S | re.I)


def _rx(blk, *tags):
    for t in tags:
        m = re.search(r"<%s\b[^>]*>(.*?)</%s>" % (t, t), blk, re.S | re.I)
        if m:
            v = m.group(1)
            v = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", v, flags=re.S)
            if v.strip():
                return v
    m = re.search(r"<link\b[^>]*href=\"([^\"]+)\"", blk, re.I)
    if m and "link" in tags:
        return m.group(1)
    return ""


def _parse_rx(text):
    out = []
    for m in _ITEM.finditer(text):
        blk = m.group(2)
        raw = _rx(blk, "description", "summary", "content:encoded")
        link = _clean(_rx(blk, "link", "guid"))
        try:
            img = _image_rx(blk, link)
        except Exception:           # 画像の拾い損ねで見出しを落とさない
            img = ""
        out.append({"title": _clean(_rx(blk, "title"), 220),
                    "link": link,
                    "source": _clean(_rx(blk, "source"), 40),
                    "ts": _ts(_clean(_rx(blk, "pubDate", "dc:date", "published", "updated"))),
                    "summary": _clean(raw, 360), "image": img, "desc": first_paragraph(raw),
                    "raw_desc": html.unescape(raw) if raw else ""})
    return out


def parse(text):
    try:
        items = _parse_xml(text)
        if items:
            return items
    except ET.ParseError:
        pass
    return _parse_rx(text)


def fetch(feed, ttl=600):
    """feed: {"name","url","cat","lang"}。控えが新しければ取りに行かない。"""
    url = feed["url"]
    now = time.time()
    with _lock:
        c = _cache.get(url)
        if c and now - c["at"] < ttl:
            return c
    try:
        items = parse(_get(url))
        for it in items:
            it["feed"] = feed["name"]
            it["cat"] = feed.get("cat", "")
            it["lang"] = feed.get("lang", "")
            it["tier"] = feed.get("tier", "")
            # Google News は「見出し - 媒体名」。媒体は別欄へ
            if not it["source"] and " - " in it["title"] and "news.google" in url:
                it["title"], it["source"] = it["title"].rsplit(" - ", 1)
            if not it["source"]:
                it["source"] = feed["name"]
            raw = it.pop("raw_desc", "")
            if raw and "news.google" in url:
                it["gn_html"] = raw     # 束ねの骨格（cluster.gn_members が読む）
        rec = {"at": now, "items": items, "ok": bool(items),
               "err": "" if items else "項目なし"}
    except Exception as e:
        rec = {"at": now, "items": [], "ok": False, "err": str(e)[:120]}
    with _lock:
        _cache[url] = rec
    return rec


def fetch_all(feeds, ttl=600, workers=12):
    """全源を並列で取る。返すのは (items, status)。落ちた源は status に理由付きで残る。"""
    items, status = [], []
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(fetch, f, ttl): f for f in feeds}
        for fu in cf.as_completed(futs):
            f = futs[fu]
            try:
                rec = fu.result()
            except Exception as e:
                rec = {"items": [], "ok": False, "err": str(e)[:120], "at": time.time()}
            items.extend(rec["items"])
            status.append({"name": f["name"], "cat": f.get("cat", ""), "ok": rec["ok"],
                           "n": len(rec["items"]), "err": rec.get("err", "")})
    return items, status
