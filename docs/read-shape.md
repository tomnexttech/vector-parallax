# story.read: how each outlet wrote an event (CONTRACT 27)

Where: `data/latest.json` -> `stories[i].read`. It is added after the news build by `python -m parallax.read`, so a story has it only for the events that were read
(the first picks of `data/hero.json`, then the next events in the order of the first card, at most 10 per build) and for events kept from the last 36 hours.
A story without `read` was not read in this build. `stories[i].brief.diffs` (the differences found in the feed descriptions) stays; use it when `read` is missing or `read.status` is `"unread"`.
`latest.json -> read_run` holds the counts of the run (events, calls, pages fetched, what the check dropped), for the status line only.

```jsonc
"read": {
  "status": "ok",                      // "ok": two or more outlets were read and compared. "unread": fewer than two bodies could be read (see unread). Show the cards only when "ok".
  "at": 1793800000,                    // epoch seconds, when the AI answered. Show it. A read older than 36 h is dropped by the build
  "model": "gemini-3.5-flash-lite",
  "outlets": [                         // only the outlets whose body was read, earliest article first. 2 to 8.
    {
      "item": "347a59c786d34a28",      // id in latest.items: the link, the title and the time of the article this was read from
      "outlet": "The Japan Times",
      "side": "海外",                  // 国内 | 海外 | 官公庁
      "lang": "en",
      "focus": "政府の物価対策と電気料金の補助の延長",          // what the article is about at its centre (<= 60 characters)
      "facts": ["電気料金への補助が来年3月まで延ばされる。"],      // 1 to 4 things the body states: numbers, parties, who spoke (<= 70 characters each)
      "wording": [                      // 0 to 3. quote is copied from the body, 24 characters at most; note says what that wording does
        {"quote": "ease the burden", "note": "大臣の言葉をそのまま引き、負担の軽減を前に出す"}
      ],
      "omits": [                        // 0 to 2. Something another outlet's body states and this body does not mention at all ("本文には〜の記述がない")
        {"text": "本文にはガソリンへの補助の記述がない。", "from": "5d0c9a5620ac4159"}   // from = item id of the outlet that states it
      ]
    }
  ],
  "contrast": "総額は4兆2000億円と書く社と、約4兆円とぼかす社に分かれる。",   // "" when no real difference shows. The one sharpest difference, one sentence, outlets named
  "contrast_items": ["347a59c786d34a28", "5d0c9a5620ac4159"],           // the articles it compares (2 or more)
  "domestic_vs_abroad": "国内の社は大臣の発言を引き、海外の社は総額を円で示す。",   // "" when one side was not read or no difference shows
  "dva_items": ["347a59c786d34a28", "712515b6b3cfaba8"],
  "unread": [                           // the outlets of the event that were NOT read, with the reason. Show them as "本文は読めていません".
    {"outlet": "NHK", "side": "国内", "item": "9edd1862d08dc204",
     "why": "terms",                    // robots | ai_refused | terms | relay | unreachable | fetch_failed | paywall | no_body | unusable | cap
     "why_ja": "媒体の利用条件が機械による取得を認めていない",     // ready to show
     "evidence": "https://www.nhk.or.jp/toppage/rss/index.html"}   // the robots.txt line or the terms address that says no; "" when there is none
  ]
}
```

Reasons. A refusal (the source has said no, so it is not read): `robots` (robots.txt disallows the path), `ai_refused` (robots.txt refuses Google-Extended, or the page says noai),
`terms` (the outlet's terms forbid it). Not a refusal, the outlet was simply not read this time: `relay` (a Google News link that does not lead to the article address),
`unreachable` (robots.txt could not be read now), `fetch_failed`, `paywall`, `no_body` (no article text in the page), `unusable` (the AI's answer for this outlet did not pass the check),
`cap` (the build's fetch limit).

Rules of the data. Every sentence in `focus`, `facts`, `note`, `omits`, `contrast` and `domestic_vs_abroad` passed a check against the body it came from: numbers and Latin words are in the body,
no run of 18 characters is copied, no judgement words, no "did not report". Every `quote` is in the body and at most 24 characters. The body itself is never in the data. `unread` is cut at 16 rows.
Outlet names may appear inside `contrast` and `domestic_vs_abroad` (they compare outlets); they are the outlets of this event only.

Order of the cards for the home: `contrast` first as the one line, `domestic_vs_abroad` under it, then `read.outlets` as they are (earliest first), and `unread` last in small type.
