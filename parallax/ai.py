# -*- coding: utf-8 -*-
"""ai — AI を呼ぶ層（標準ライブラリだけ）。docs/CONTRACT-public.md §4.5 のとおり。

provider は `name`・`model`・`call(system, user_text, schema) -> (raw_text | None, err_code)` を持つ。
  GeminiProvider    本物。鍵は `x-goog-api-key` の見出しにだけ置く（URL・ログ・例外の文に出さない）
  RecordedProvider  記録済みの答え（data/recorded.json の形）を sha256(user_text) で引く。無ければ "missing"
  FakeProvider      試験用。渡した関数の答えを返し、呼びを calls に控える

エラー符号: nokey auth quota blocked truncated http timeout network json shape missing budget
"""
import hashlib
import json
import re
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

ERROR_CODES = ("nokey", "auth", "quota", "blocked", "truncated", "http", "timeout", "network",
               "json", "shape", "missing", "budget")

_MODEL_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MAX_OUTPUT_TOKENS = 16384
RETRIES = 2                                   # やり直しは 2 回まで（計 3 回）
BACKOFF_BASE_S = 2.0                          # 429・時間切れ・網の誤りの後: 2 秒、4 秒と倍に待つ
BUSY_STATUSES = (500, 503)                    # 混雑・サーバ側の誤り。数秒では空かないので長く待つ
BUSY_BACKOFF_BASE_S = 10.0                    # その後の待ち: 10 秒、30 秒と 3 倍に
BUSY_BACKOFF_MAX_S = 60.0                     # 1 回の待ちの上限
SWITCH_STATUSES = (429, 500, 503)             # この番号の後のやり直しは、鎖の次の型へ移る
RETRY_CODES = ("quota", "http", "timeout", "network")   # 認証・形・遮断・途切れはやり直しても変わらない
OUT_STATUSES = (404,)                         # この番号の型は、同じ build の間は二度と送らない（名の変更・廃止）
TRAIL_MAX = 40                                # 試行の記録（公開の stats に載る）の上限
_ROOT = Path(__file__).resolve().parent.parent
_messages = None


def error_message(code, lang="ja", prompt=None):
    """エラー符号 -> 利用者に見せる一文（data/prompt.json の error_messages）。無ければ符号をそのまま返す。"""
    global _messages
    table = (prompt or {}).get("error_messages")
    if table is None:
        if _messages is None:
            try:
                with open(_ROOT / "data" / "prompt.json", encoding="utf-8") as f:
                    _messages = json.load(f).get("error_messages", {})
            except (OSError, ValueError):
                _messages = {}
        table = _messages
    row = table.get(code)
    return row.get(lang) or row.get("en") or code if isinstance(row, dict) else code


def sha256_text(text):
    """user_text の指紋（UTF-8 の sha256 を 16 進で）。記録済みの答えの鍵。"""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def render_user_text(prompt, doc):
    """prompt.user_template の {DOC} を doc で置き換える。"""
    return prompt["user_template"].replace("{DOC}", doc)


# ---------------------------------------------------------------- 呼び数の上限（CONTRACT §13）
class CallBudget:
    """1 回の build で、用途ごとに provider が実際に送る呼びの数の上限。やり直し（再送）も 1 呼びと数える。
    take() が False になったら、その呼びは送らない（"budget"）。"""

    def __init__(self, limit):
        self.limit = max(0, int(limit))
        self.used = 0

    def take(self):
        if self.used >= self.limit:
            return False
        self.used += 1
        return True


def gate(provider):
    """provider に budget が付いていれば 1 呼び分を取る。取れなければ False。付いていなければ常に True。"""
    b = getattr(provider, "budget", None)
    return True if b is None else b.take()


# ---------------------------------------------------------------- 本物
def _default_transport(url, headers, body, timeout):
    """-> (status, body_text)。HTTP の 4xx/5xx も (status, text) で返す。接続の失敗・時間切れは例外。"""
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            text = e.read().decode("utf-8", "replace")
        except Exception:
            text = ""
        return e.code, text


HTTP_DETAILS = []   # 2xx でない返答の (型, 番号, 理由)。build が記録に出す（公開の記録に載るので鍵と長い数字は伏せる）


def _error_detail(text, key):
    """Gemini の誤りの本文から status と message の頭だけを取る。"""
    try:
        e = json.loads(text).get("error") or {}
        s = "%s %s" % (e.get("status") or "", e.get("message") or "")
    except Exception:
        s = text or ""
    if key:
        s = s.replace(key, "***")
    return re.sub(r"\d{6,}", "#", s).strip()[:200]


def quota_kind(text):
    """429 の本文から枠の種類を読む。-> ("day" | "minute" | "unknown", retry_delay_s | None)。
    Gemini の 429 は details の QuotaFailure.violations[].quotaId（…PerDay… / …PerMinute…）と RetryInfo.retryDelay（"38s"）を持つ。"""
    kind, delay = "unknown", None
    try:
        details = (json.loads(text).get("error") or {}).get("details") or []
    except Exception:
        details = []
    for d in details if isinstance(details, list) else []:
        if not isinstance(d, dict):
            continue
        for v in d.get("violations") or []:
            q = "%s %s" % ((v or {}).get("quotaId") or "", (v or {}).get("quotaMetric") or "") if isinstance(v, dict) else ""
            if "PerDay" in q or "per_day" in q:
                kind = "day"
            elif kind != "day" and ("PerMinute" in q or "per_minute" in q):
                kind = "minute"
        rd = d.get("retryDelay")
        if isinstance(rd, str):
            m = re.match(r"^(\d+(?:\.\d+)?)s$", rd.strip())
            if m:
                delay = float(m.group(1))
    return kind, delay


def _reply_text(outer):
    """Gemini の返答（JSON を読んだ物）から本文を取る。-> (text | None, err)"""
    if not isinstance(outer, dict):
        return None, "shape"
    pf = outer.get("promptFeedback")
    if isinstance(pf, dict) and pf.get("blockReason"):
        return None, "blocked"
    cands = outer.get("candidates")
    if not isinstance(cands, list) or not cands or not isinstance(cands[0], dict):
        return None, "shape"
    c = cands[0]
    fr = c.get("finishReason") or ""
    if isinstance(fr, str) and fr.startswith("MAX_"):
        return None, "truncated"
    if fr in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"):
        return None, "blocked"
    content = c.get("content")
    parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list):
        return None, "shape"
    text = "".join(p["text"] for p in parts
                   if isinstance(p, dict) and isinstance(p.get("text"), str) and not p.get("thought"))
    if not text.strip():
        return None, "shape"
    return text, ""


class GeminiProvider:
    """鍵は引数で渡す（この層は環境変数を読まない。build.choose_provider が渡す）。

    transport は試験用の差し替え口: transport(url, headers, body_bytes, timeout) -> (status, text)。
    """
    name = "gemini"

    budget = None

    def __init__(self, key, model, timeout=90, transport=None, max_output_tokens=DEFAULT_MAX_OUTPUT_TOKENS,
                 retries=RETRIES, sleep=time.sleep, budget=None, fallback_model=None,
                 fallback_models=None, fallback_budget=None):
        key = (key or "").strip()
        if not key:
            raise ValueError("nokey")
        if not _MODEL_RE.match(model or ""):
            raise ValueError("badmodel")
        chain = [model]                      # 主の型、続けて予備の型（混雑・枠切れの時に順に移る）。同じ名は一度だけ
        for m in ([fallback_model] if fallback_model is not None else []) + list(fallback_models or []):
            if not isinstance(m, str) or not _MODEL_RE.match(m):
                raise ValueError("badmodel")
            if m not in chain:
                chain.append(m)
        self._key = key                      # 外へ出さない（repr にも出さない）
        self.model = model                   # 直近に送った型 = 答えた型
        self._chain = chain
        self._pos = 0                        # 鎖の中の今の位置。1 回の call の中では前へだけ進む
        self._out = set()                    # 同じ build の間は送らない型の位置（日の枠切れの 429・404）
        self._no_return = set()              # 次の call の初めに戻らない型の位置（種類の読めない 429。これまでの「前へだけ」と同じ扱い）。
                                             # 混雑（500・503）・分の枠の 429・時間切れの型には、次の call でまた鎖の前から試す
        self.trail = []                      # 試行ごとの {"model","status","err","quota"}（公開してよい物だけ。本文・鍵は入れない）
        self.answered = []                   # call ごとに答えた型（答えなければ None）
        self.timeout = timeout
        self._transport = transport or _default_transport
        self.max_output_tokens = int(max_output_tokens)
        self.retries = max(0, int(retries))
        self._sleep = sleep
        self.budget = budget                 # CallBudget | None。主の型への試行（やり直しも）だけを数える（CONTRACT §13）
        self.fallback_budget = fallback_budget  # CallBudget | None。予備の型への試行を鎖の全部で数える。None なら予備も budget で数える
        self._last_status = None

    @property
    def chain_models(self):
        return tuple(self._chain)

    @property
    def fallback_models(self):
        return tuple(self._chain[1:])

    def __repr__(self):
        return "GeminiProvider(model=%r)" % self.model

    def build_request(self, system, user_text, schema):
        """-> (url, headers, body_bytes)。鍵は headers にだけ入る。"""
        url = GEMINI_ENDPOINT.format(model=self.model)
        headers = {"Content-Type": "application/json", "x-goog-api-key": self._key}
        body = {
            "contents": [{"role": "user", "parts": [{"text": user_text}]}],
            "systemInstruction": {"parts": [{"text": system}]},
            "generationConfig": {"responseMimeType": "application/json",
                                 "responseSchema": schema, "temperature": 0,
                                 "maxOutputTokens": self.max_output_tokens},
        }
        return url, headers, json.dumps(body, ensure_ascii=False).encode("utf-8")

    def _budget_for(self, i):
        return self.budget if i == 0 or self.fallback_budget is None else self.fallback_budget

    def _first_with_room(self, start):
        """鎖の start 以降で、試行の残りがある最初の型の位置。無ければ None。"""
        for i in range(start, len(self._chain)):
            if i in self._out:
                continue
            b = self._budget_for(i)
            if b is None or b.used < b.limit:
                return i
        return None

    def _wait_s(self, n):
        """n 回目のやり直しの前の待ち。直前の試行の番号で決める: 500・503 は 10 秒・30 秒（上限つき）、それ以外は 2 秒・4 秒。"""
        if self._last_status in BUSY_STATUSES:
            return min(BUSY_BACKOFF_BASE_S * (3 ** n), BUSY_BACKOFF_MAX_S)
        return BACKOFF_BASE_S * (2 ** n)

    def call(self, system, user_text, schema):
        """やり直しは RETRY_CODES の時だけ、最大 RETRIES 回。待ちは _wait_s。429・500・503 の後は鎖の次の型へ移る（末尾なら同じ型）。
        主の型の試行は budget、予備の型の試行は fallback_budget で数え、次に送れる型が無ければそこで止める（最後の本物の誤りを返す）。
        call の初めには、送れる型のうち鎖の一番前（ふつうは主の型）へ戻る。日の枠を使い切った型・404 の型は同じ build の間は飛ばし、
        枠の種類の読めない 429 の型へは戻らない。"""
        start = next((i for i in range(self._pos) if i not in self._no_return and self._first_with_room(i) == i), None)
        if start is not None:
            self._pos = start
        raw, err = self._call_once(system, user_text, schema)
        for n in range(self.retries):
            if err not in RETRY_CODES:
                break
            switch = self._last_status in SWITCH_STATUSES
            i = self._first_with_room(min(self._pos + 1, len(self._chain) - 1) if switch else self._pos)
            if i is None:
                break
            self._sleep(self._wait_s(n))
            self._pos = i
            raw2, err2 = self._call_once(system, user_text, schema)
            if err2 == "budget":
                break
            raw, err = raw2, err2
        self.answered.append(self.model if raw is not None and not err else None)
        return raw, err

    def _call_once(self, system, user_text, schema):
        i = self._first_with_room(self._pos)
        if i is None:
            if len(self.trail) < TRAIL_MAX:
                self.trail.append({"model": None, "status": None, "err": "budget", "quota": None})
            return None, "budget"
        self._pos = i
        self.model = self._chain[i]
        b = self._budget_for(i)
        if b is not None:
            b.take()
        url, headers, body = self.build_request(system, user_text, schema)
        self._last_status = None
        raw, err, quota = self._send(url, headers, body, i)
        if len(self.trail) < TRAIL_MAX:
            self.trail.append({"model": self.model, "status": self._last_status, "err": err or "ok", "quota": quota})
        return raw, err

    def _send(self, url, headers, body, i):
        """-> (raw | None, err, quota_kind | None)。429 の日の枠・種類不明と 404 は、その型を同じ build の間は外す。"""
        try:
            status, text = self._transport(url, headers, body, self.timeout)
        except (socket.timeout, TimeoutError):
            return None, "timeout", None
        except urllib.error.URLError as e:
            return None, "timeout" if isinstance(getattr(e, "reason", None), (socket.timeout, TimeoutError)) else "network", None
        except OSError:
            return None, "network", None
        except Exception:
            return None, "network", None
        self._last_status = status
        if not (200 <= status < 300):
            HTTP_DETAILS.append((self.model, status, _error_detail(text, self._key)))
        if status in (401, 403):
            return None, "auth", None
        if status == 429:
            kind, _ = quota_kind(text)
            if kind == "day":                   # 日の枠は同じ日のうちに戻らない
                self._out.add(i)
            elif kind == "unknown":             # 種類が読めない時は、これまで通り次の call で戻らない側に倒す
                self._no_return.add(i)
            return None, "quota", kind
        if status in OUT_STATUSES:
            self._out.add(i)
        if not (200 <= status < 300):
            return None, "http", None
        try:
            outer = json.loads(text)
        except ValueError:
            return None, "json", None
        raw, err = _reply_text(outer)
        return (raw, "", None) if raw is not None else (None, err, None)


# ---------------------------------------------------------------- 記録済み
class RecordedProvider:
    """記録済みの答え。data は {"version","provider","model","made_at","note_ja","responses":{sha256: raw}}。"""

    def __init__(self, data):
        if not isinstance(data, dict) or not isinstance(data.get("responses"), dict):
            raise ValueError("recorded file has no responses")
        self.data = data
        self.name = data.get("provider") or "claude-recorded"
        self.model = data.get("model") or None
        self.made_at = data.get("made_at") if isinstance(data.get("made_at"), int) else None
        self.note_ja = data.get("note_ja") if isinstance(data.get("note_ja"), str) else ""
        self._responses = data["responses"]
        self.budget = None
        sr = data.get("summary_responses")
        self._summary_responses = sr if isinstance(sr, dict) else {}

    @classmethod
    def from_file(cls, path):
        with open(path, encoding="utf-8") as f:
            return cls(json.load(f))

    def call(self, system, user_text, schema):
        if not gate(self):
            return None, "budget"
        raw = self._responses.get(sha256_text(user_text))
        if not isinstance(raw, str):
            return None, "missing"
        return raw, ""

    @property
    def has_summaries(self):
        return bool(self._summary_responses)

    def summary_view(self):
        """要約の段の provider。`summary_responses`（sha256 -> 答え）を引く。`summary` に provider・model・made_at・note_ja が
        あればそれを、無ければ全体の物を名乗る。要約の記録が無ければ None。"""
        if not self.has_summaries:
            return None
        meta = self.data.get("summary") if isinstance(self.data.get("summary"), dict) else {}
        return RecordedSummaryProvider(self._summary_responses, meta.get("provider") or self.name, meta.get("model") or self.model,
                                       meta.get("made_at") if isinstance(meta.get("made_at"), int) else self.made_at,
                                       meta.get("note_ja") if isinstance(meta.get("note_ja"), str) else self.note_ja)


class RecordedSummaryProvider:
    """記録済みの要約の答え。Claude の要約と Gemini の要約を混ぜないため、名前（provider）は記録の持ち主のまま出す。"""

    def __init__(self, responses, name, model, made_at, note_ja):
        self._responses = responses
        self.name, self.model, self.made_at, self.note_ja = name, model, made_at, note_ja
        self.budget = None

    def call(self, system, user_text, schema):
        if not gate(self):
            return None, "budget"
        raw = self._responses.get(sha256_text(user_text))
        if not isinstance(raw, str):
            return None, "missing"
        return raw, ""


# ---------------------------------------------------------------- 偽（試験用）
class FakeProvider:
    """responder(system, user_text, schema) の返り値を答えにする。
    str -> その文字列、dict/list -> json.dumps、(raw, err) -> そのまま、None -> (None, "network")。
    responder が例外 FakeError(code) を投げれば (None, code)。呼びは calls に控える。"""
    name = "fake"
    model = "fake"

    def __init__(self, responder, budget=None):
        self.responder = responder
        self.calls = []
        self.budget = budget

    def call(self, system, user_text, schema):
        if not gate(self):
            return None, "budget"
        self.calls.append({"system": system, "user_text": user_text, "schema": schema})
        try:
            r = self.responder(system, user_text, schema) if callable(self.responder) else self.responder
        except FakeError as e:
            return None, e.code
        if r is None:
            return None, "network"
        if isinstance(r, tuple):
            return r
        if isinstance(r, str):
            return r, ""
        return json.dumps(r, ensure_ascii=False), ""


class FakeError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code
