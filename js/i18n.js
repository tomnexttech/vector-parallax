/* i18n — the page's own words in Japanese or English. Only the words of the page change: headlines, descriptions, outlet names,
 * place names, the words found in headlines and the AI's lines stay as published. The Japanese page is never touched: with Japanese
 * nothing here runs. One table (EN), keyed by the Japanese as the page writes it, and a few patterns for words with numbers.
 *
 *   UI_LANGS                                  'auto' (the browser's language), 'ja', 'en'
 *   uiLang(pref, langs) -> 'ja' | 'en'        'auto': Japanese when the browser's first language is Japanese, else English
 *   tr(text) -> text                          one string in English: exact, else a pattern, else as it was
 *   localize(root)                            every text node and title / aria-label / placeholder under root (not under SKIP)
 *   watch(root) -> stop()                     localize now and whatever the page draws later */

export const UI_LANGS = ['auto', 'ja', 'en'];

export function uiLang(pref, langs) {
  if (pref === 'ja' || pref === 'en') return pref;
  const first = (Array.isArray(langs) ? langs : [langs]).map((x) => String(x || '').toLowerCase()).find(Boolean) || 'ja';
  return first === 'ja' || first.startsWith('ja-') ? 'ja' : 'en';
}

// the words of headlines, outlets, places and the AI: never translated, even when a word is also a key of the table
export const SKIP = '[data-i18n-skip],.en-w,.en-ws,.hits,.terms,.tl-hl,.mh,.en-at,.en-q,.ch-ai,.en-ai-t,h1,.en-st,.en-h,.en-ost,.pp-t,.mf,.en-vh,.en-mo,.mo,.en-o,.st-src .en-mo,.r .t,.rel,.near,.en-firsts .o,.facts dd,.kv dd,.op-lk,script,style,textarea,input,select option[data-raw]';

export const EN = {
  '今日のニュース': "Today's news", 'ホーム': 'Home',
  // the figures' heads and the news site's own parts (rankings, breaking line, local news, the narrowed search)
  '件数の比': 'Share of reports', 'メディアの種類': 'Types of outlet', '国内と海外の語': 'Words in Japan and abroad', '媒体と語の重なり': 'Outlets and shared words', '時間の流れ': 'Over time', '0〜100': '0-100', '着目した語': 'Words in focus',
  '速報': 'Breaking', '報道が急増': 'Reports rising fast', '速報を閉じる': 'Close the breaking line', '災害の画面を開く': 'Open the disaster screen', 'このニュースを開く': 'Open this news',
  '注目度ランキング': 'Attention ranking', '注目度': 'Attention', '比べる': 'Compare', '画面': 'Screens', '急上昇': 'Rising fast', '新着': 'New in 6 h', '6 時間': '6 h', '24 時間': '24 h',
  '全部': 'All', '期間': 'Period', '側': 'Side', '並べ替え': 'Order', '報道が多い順': 'Most outlets', '新しい順': 'Newest', 'すべてのメディア': 'All outlets',
  '地元のニュース': 'Local news', '選ばない': 'None', '都道府県': 'Prefectures', '国': 'Countries',
  'ホームと「比べる」に、選んだ地名のニュースを出します。選択はこのブラウザにだけ保存します': 'Shows the news that name the chosen place on the home screen and in the simple view. The choice stays in this browser',
  '報道の多い順です。': 'Ordered by the number of collected headlines.', '6 時間の新着はありません。': 'Nothing new in the last 6 hours.',
  '6 時間より前のニュースなので、急上昇は出せません。': 'These headlines were collected more than 6 hours ago, so there is no rising order.',
  // the band, the screens and the tabs
  'ニュース': 'News', '地図': 'Map', '市場': 'Markets', '政治': 'Politics', '災害': 'Disasters', '映像': 'Video', '保存': 'Saved',
  'その他': 'More', '検索': 'Search', '設定': 'Settings', '表示': 'View', '自動': 'Rules', 'メディア': 'Outlets', '更新': 'Updated', '前回から': 'Since last visit',
  'データと AI': 'Data and AI', '使い方': 'How to use', '区画': 'Screens', '検索と操作（Ctrl+K）': 'Search and actions (Ctrl+K)',
  '声で操作（v）': 'Voice control (v)', '声で操作': 'Voice control', 'データと AI（i）': 'Data and AI (i)', '外観 ダーク': 'Appearance: dark', '外観 ライト': 'Appearance: light',
  '外観': 'Appearance', '設定（,）': 'Settings (,)', '欄へ移る': 'Go to a pane', '言語': 'Language', '閉じる': 'Close', '検索と操作': 'Search and actions', '結果': 'Results',
  '↑ ↓ で選ぶ　Enter で開く　Esc で閉じる': '↑ ↓ to choose, Enter to open, Esc to close',
  'AI のまとめ': 'AI summaries', '国内と海外の両方': 'Both Japan and abroad', '一覧': 'List', '件数': 'Count', '多い': 'Many', '並べ方': 'Layout', '標準': 'Standard', '主役': 'Lead',
  // the panes of the board
  '出来事': 'News', '注目': 'Top news', '注目ニュース': 'Top news', '関連': 'Related', '出典': 'Sources', '片側だけのニュース': 'Only some outlets', '時間': 'Hours', '分野': 'Fields',
  '時間別の件数': 'Headlines by hour', '見出しの件数': 'Collected headlines', '期間内の見出し': 'Headlines in the window', '関連ニュース': 'Related headlines',
  '出典とまとめ方': 'Basis and sources', '種類': 'Type', '直近 1 時間': 'Last hour', '最多': 'Peak', '注目の初報': 'First reports of top news', '各 6 件まで': 'Up to 6 each',
  '届かない・更新なし': 'Unreachable or not updated', '地名なし': 'No place', '地点なし': 'No place', '押すと拡大': 'Press to enlarge', '記事掲載の停止を依頼する': 'Ask to remove an article',
  '掲載の停止': 'Removal', '論点で絞る': 'Narrow by topic', 'AI が書いた題': 'Title written by the AI', '報じ方の種類で絞る': 'Narrow by type of outlet',
  'すべての報道を見る': 'See all reports', 'この出来事の全報道を見る': 'See all reports of this news', 'バイアス度の内訳を見る': 'See the parts of the bias score',
  '注目を拡大': 'Enlarge top news', '媒体を拡大': 'Enlarge outlets', '災害を拡大': 'Enlarge disasters', '市場を拡大': 'Enlarge markets', '政治を拡大': 'Enlarge politics',
  '一部の媒体だけを拡大': 'Enlarge only some outlets', '時間ごとの見出しを拡大': 'Enlarge headlines by hour', '時間ごとの見出しを開く': 'Open headlines by hour',
  '媒体の一覧を開く': 'Open the list of outlets', 'AI について': 'About the AI', 'すべての分野': 'All fields', '今回多い地名': 'Places seen most this time',
  '自動のラベル・真偽は判定していない': 'Automatic labels; nothing is judged true or false', '真偽は判定していない': 'Nothing is judged true or false',
  // fields and types of outlets
  'すべて': 'All', '全て': 'All', '国際': 'World', '経済': 'Economy', '安全保障': 'Security', '技術': 'Technology', '国内政治': 'Japanese politics',
  'お金・税金': 'Money and tax', '法': 'Law', '政治・人事': 'Politics and appointments', '国内と海外': 'Japan and abroad',
  '政府一次': 'Government primary', '通信社': 'News agency', '公共放送': 'Public broadcaster', '全国紙': 'National paper', '民放': 'Commercial TV',
  '経済紙': 'Business paper', '地方紙': 'Regional paper', '専門': 'Specialist', '海外公共': 'Public, abroad', '海外主流': 'Mainstream, abroad',
  '国家メディア': 'State media', '政党機関紙': 'Party paper', '週刊誌・タブロイド': 'Weekly or tabloid', 'シンクタンク': 'Think tank', '集約': 'Aggregator',
  // the sides
  '国内': 'Japan', '海外': 'Abroad', '官公庁': 'Ministries', '国内の報道': 'Japanese outlets', '海外の報道': 'Outlets abroad', '官公庁の発表': 'Ministries\' papers',
  '国内だけ': 'Japan only', '海外だけ': 'Abroad only', '官公庁だけ': 'Ministries only', '国内・官公庁だけ': 'Japan and ministries only', '国内版': 'Japan', '海外版': 'Abroad',
  '国内だけ': 'Japanese outlets only', '海外だけ': 'Outlets abroad only', '官公庁だけ': 'Ministries\' papers only', '片側だけのニュース': 'News of one side only',
  'ほかの側に見出しが無くても、扱っていないとは限りません。言い回しの違う見出しは拾えないことがあります。': 'Not being in the other sides\' headlines does not mean they did not cover it. Headlines worded differently can escape the grouping rules.',
  // the simple view
  '今日の注目ニュース': 'Today\'s big news', '詳しく見る': 'Detailed screen', '詳しく': 'Details', '表示中': 'Showing',
  'ニュースを選ぶと、下に見出しが並びます': 'Press a news to see below how it was told', 'ニュースを選ぶ': 'Choose a news', '選んだニュースの伝え方': 'How the chosen news was told',
  '伝え方の違い': 'How it was told', '件数の割合': 'Share of reports', '件': '', 'バイアス度': 'Bias score', 'バイアス度の内訳を見る': 'See the parts of the bias score on the detailed screen',
  '最初に報じた時刻': 'First reports', '国内と海外の差': 'Gap between Japan and abroad', '海外が先': 'abroad first', '国内が先': 'Japan first', '同じ時刻': 'same time',
  '1分未満': 'under 1 min', '件数の積み上がり': 'Reports adding up', '使った言葉の違い': 'Words used', '見出しの言葉': 'Words in the headlines', '共通する言葉': 'Shared words',
  'よく出た言葉': 'Frequent words', '各メディアの見出し': 'Each outlet\'s headline', 'は、集めたニュースには見当たりません': 'not found in the collected news',
  '見当たらない媒体へ': 'Outlets not seen', 'ほかのニュースを選ぶ': 'Choose another news', '画像で共有': 'Share as image', '詳しく見る': 'Show details',
  '記事を開く': 'Open article', 'このメディアが扱ったニュース': 'News this outlet carried', 'このメディアのページ': 'This outlet\'s page', 'AI の文は間違うことがあります': 'AI text can be wrong',
  'AI の文は間違うことがあります。元の記事で確かめてください': 'AI text can be wrong; check the original article', '読み上げる': 'Read aloud', '止める': 'Stop',
  // the board's news
  '共有': 'Share', '保存済み': 'Saved', '最初の報道から': 'Since the first report', '最初に報じた': 'First reported', '最新': 'Latest', '事件': 'Case',
  '要点': 'Key points', '経過': 'Timeline', '各側の見出し': 'Headlines by side', '出典の一覧': 'Sources', 'このニュースの節': 'Sections of this news',
  '内訳を開く': 'Show parts', '内訳を閉じる': 'Hide parts', '国内で最初の報道': 'First report in Japan', '海外で最初の報道': 'First report abroad', '差': 'Gap',
  '着目した語': 'Words noted', '全報道': 'All reports', '原文を開く': 'Open original', '元の記事を開く': 'Open the original article', 'もう一つの見出し': 'Another headline',
  'ラベル': 'Labels', 'ラベルは話題の分類です。重要度や責任の有無は示しません': 'Labels classify the topic; they say nothing of importance, wrongdoing or blame', 'ブラウザに合わせる': 'Follow the browser', 'まとめた理由': 'Why grouped', 'まとめた手': 'Grouped by', '共通の語': 'Shared words', '地名': 'Places', '時刻の幅': 'Time span', '鍵語': 'Key terms',
  '系譜': 'Lineage', '他の出来事': 'Other news', '地震': 'Earthquakes', '台風': 'Typhoons', '規則（語の重なり）': 'Rules (shared words)', '一つの報道': 'A single report',
  'この話題が見つからなかった媒体': 'Outlets where this was not found', '最初の報道より後から': 'Starting after the first report', '読めず': 'Could not read',
  '官公庁の一次資料': 'Ministries\' primary papers', '全報道の出典': 'Sources of all reports', '国内の報道を一覧で見る': 'List the Japanese reports', '海外の報道を一覧で見る': 'List the reports abroad',
  'この出来事の映像': 'Video of this news', '地図の下のニュース': 'News under the map', '種類ごとの報道の時刻': 'Report times by type', '一次資料': 'Primary paper',
  '次の写真': 'Next photo', 'キーの一覧': 'Keys',
  // disasters, markets, politics (labels only)
  '最大の地震': 'Largest earthquake', '台風の中心気圧': 'Typhoon central pressure', '強い': 'Strong', '津波': 'Tsunami', '金利': 'Rates', '為替': 'Currencies', '商品': 'Commodities',
  '議案': 'Bills', '官邸': 'Prime Minister\'s Office', '各党の発信': 'From the parties', '会議録': 'Diet records', '選挙': 'Elections', '直近の結果（投票日）': 'Latest results (voting day)',
  '内閣支持': 'Cabinet approval', '支持': 'Approve', '不支持': 'Disapprove', '各社の最新': 'Latest of each pollster', '最終日': 'Last day', '調査報道・国会・学術・NGO': 'Investigations, Diet, academia, NGOs',
  '調査報道': 'Investigative', '国会 質問': 'Diet questions', '国会 答弁': 'Diet answers', '学術': 'Academia', '参議院で審議中': 'In the House of Councillors', '半径': 'Radius',
  '点＝各社の調査（最終日）・線＝同じ社の点を結ぶ': 'Dots = each poll (last day) · lines join one pollster\'s dots', '並びは官邸が先、各党は名前の順。色・順位なし': 'The Prime Minister\'s Office first, the parties by name. No colours, no ranks',
  // the map
  '出来事・地震・台風・災害の地図': 'Map of news, earthquakes, typhoons and disasters', '地図の層': 'Map layers', '地図の表示（m）': 'Map view (m)', '地図を大きく表示（M）': 'Larger map (M)',
  'テーマで地図を塗り分ける': 'Colour the map by theme', '地図を傾けて、記事の数の柱を立てる': 'Tilt the map and raise columns of the number of articles', '左へ回す': 'Turn left', '右へ回す': 'Turn right', '寄せる': 'Zoom in', '引く': 'Zoom out',
  // the video pane
  'ニュースのライブ': 'Live news', 'ニュースのライブ・公式・消音': 'Live news · official · muted', '自動で再生': 'Play automatically', '最初の音': 'Sound at first', '消音': 'Muted', '出す': 'On', '局': 'Channels',
  'ライブ · 国内': 'Live · Japan', '最新の動画 · 国内': 'Latest videos · Japan', 'ライブ · 海外': 'Live · abroad', '最新の動画 · 海外': 'Latest videos · abroad',
  // saved, settings
  '保存したニュース': 'Saved news', 'このブラウザだけに保存します': 'Kept in this browser only', 'フォローする言葉': 'Words to follow', '足す': 'Add', 'フォローに当たるニュース': 'News matching what you follow',
  '自分の読み方': 'My reading', '記録を消す': 'Clear the record', 'このブラウザだけに保存・送信しない': 'Kept in this browser only, never sent', 'ミュート': 'Mute', '動き': 'Motion',
  'ボードのパネル': 'Board panes', '自分の AI': 'My own AI', '保存と復元': 'Back up and restore', '映像の欄': 'Video pane', 'まとめ方': 'Grouping', '設定の区分': 'Settings sections',
  '自分の AI につなぐ': 'Connect my AI', 'OpenRouter でログイン': 'Log in with OpenRouter', '鍵を貼る': 'Paste a key', '接続を試す': 'Test connection', '接続を外す': 'Disconnect', '違いを見る': 'See the differences', '聞く': 'Ask', '要約': 'Summary', '質問': 'Ask', '自分の AI で実行（任意）': 'Run with my AI (optional)',
  'ダーク': 'Dark', 'ライト': 'Light', '字の大きさ': 'Type size', '大きい': 'Large', 'ダイヤル（内は論点、外は注目の出来事）': 'Dial (inside: topics, outside: top news)', 'ダイヤルを開く': 'Open the dial',
  '今の順': 'Current order', '紙面': 'Front page', '時間ごと': 'By hour', '今日の注目': 'Today\'s top news', '注目のニュース': 'Top news', 'この地点': 'This place', '詳しく見る': 'See details',
  'ニュースの並べ方': 'Ways to read the news', '下の段に出すニュース': 'News in the lower row', 'この出来事を開く': 'Open this news',
  // the tour
  'はじめに': 'Welcome', '画面の切り替え': 'Switch screens', '見当たらないメディア': 'Outlets not found', '検索と設定': 'Search and settings', '次へ': 'Next', '戻る': 'Back', 'はじめる': 'Start', '終わる': 'Done', 'スキップ': 'Skip',
  'ニュースごとに、国内、海外、官公庁の見出しを並べて見られます。': 'Parallax puts side by side how outlets in Japan and abroad, and the ministries, tell the same news.',
  'ニュース、地図、市場、政治、災害、映像、保存はこの列で切り替えます。': 'Switch between news, map, markets, politics, disasters, video and saved here. Home shows everything at once.',
  'ニュースを一つ選ぶと、国内と海外の件数、最初の報道の時刻、見出しの違いが並びます。': 'Press a news to see the share of reports, the first reports, the words used and each outlet\'s headline.',
  '集めた記事の中に、このニュースが見当たらなかったメディアです。': 'Outlets where this news was not found among the collected articles. Only within what was collected.',
  'AI が、言語の違う見出しを同じニュースにまとめています。AI の文には「AI」の印が付きます。': 'The AI groups the headlines of one news across languages. Text the AI wrote carries the AI mark. Nothing is judged true or false.',
  'Ctrl+K でニュースも操作も探せます。字の大きさとダーク・ライトは設定で変えられます。': 'Find news and actions from this box (Ctrl+K). Type size and dark or light are in the settings.',
};

const map = (x) => (Object.prototype.hasOwnProperty.call(EN, x) ? EN[x] : null);
const sub = (x) => { const t = map(x); return t == null ? x : t; };
const SIDE = { 国内: 'Japan', 海外: 'Abroad', 官公庁: 'Ministries' };
const PAT = [
  [/^地元のニュース（(.+)）$/, (m) => `Local news (${m[1]})`],
  [/^(.+)のニュースは今はありません。$/, (m) => `No news on ${m[1]} now.`],
  [/^震度(\d)([強弱]?) (.+)$/, (m) => `Shindo ${m[1]}${m[2] === '強' ? '+' : m[2] === '弱' ? '-' : ''} ${m[3]}`],
  [/^(.+)・6 時間で (\d+) 件・(\d+)社$/, (m) => `${m[1]} · ${m[2]} in 6 h · ${m[3]} outlets`],
  [/^(\d+) 種類$/, (m) => `${m[1]} types`],
  [/^(\d+)社 × (\d+) 語$/, (m) => `${m[1]} outlets × ${m[2]} words`],
  [/^(\d+) 件$/, (m) => `${m[1]} ${m[1] === '1' ? 'report' : 'reports'}`],
  [/^(\d[\d,.]*) 件$/, (m) => m[1]],
  [/^(\d[\d,.]*) ?社$/, (m) => `${m[1]} outlets`],
  [/^(\d[\d,.]*)社・(\d[\d,.]*) 件$/, (m) => `${m[1]} outlets · ${m[2]} reports`],
  [/^(\d[\d,.]*) 件を一覧で見る$/, (m) => `List all ${m[1]}`],
  [/^残り (\d+) 件を一覧で見る$/, (m) => `The other ${m[1]} in the list`],
  [/^残り (\d+) 件を見る$/, (m) => `Show the other ${m[1]}`],
  [/^残り (\d+) 件$/, (m) => `${m[1]} more`],
  [/^(\d+(?:\.\d+)?) ?分前$/, (m) => `${m[1]} min ago`],
  [/^(\d+(?:\.\d+)?) ?時間前$/, (m) => `${m[1]} h ago`],
  [/^(\d+(?:\.\d+)?) ?日前$/, (m) => `${m[1]} d ago`],
  [/^最新 (\d+(?:\.\d+)?) 時間前$/, (m) => `Latest ${m[1]} h ago`],
  [/^\+(\d+(?:\.\d+)?)分$/, (m) => `+${m[1]} min`],
  [/^\+(\d+(?:\.\d+)?)時間$/, (m) => `+${m[1]} h`],
  [/^\+?(\d+)時間(\d+)分$/, (m, x) => `${x.startsWith('+') ? '+' : ''}${m[1]} h ${m[2]} min`],
  [/^(\d+)日(\d+)時間$/, (m) => `${m[1]} d ${m[2]} h`],
  [/^(\d+)分$/, (m) => `${m[1]} min`],
  [/^(-?\d+)時間$/, (m) => `${m[1]} h`],
  [/^(\d+)\/時$/, (m) => `${m[1]}/h`],
  [/^最初 (.+)$/, (m) => `First ${m[1]}`],
  [/^(国内|海外)・(.+)$/, (m) => `${SIDE[m[1]]} · ${trOne(m[2])}`],
  [/^(.+)・(国内|海外)$/, (m) => `${trOne(m[1])} · ${SIDE[m[2]]}`],
  [/^(\d+) 件（この出来事の中）$/, (m) => `${m[1]} (in this news)`],
  [/^(\d+) 社以上$/, (m) => `${m[1]} outlets or more`],
  [/^地震 (\d+) · 台風 (\d+) · 災害 (\d+)$/, (m) => `Quakes ${m[1]} · Typhoons ${m[2]} · ${m[3]} more`],
  [/^震度(\d)([強弱]?)$/, (m) => `Shindo ${m[1]}${m[2] === '強' ? '+' : m[2] === '弱' ? '-' : ''}`],
  [/^気象庁 地震 (\d+)$/, (m) => `JMA earthquakes ${m[1]}`],
  [/^(.+)・(\d+)媒体$/, (m) => `${trOne(m[1])} · ${m[2]} outlets`],
  [/^写真：(.+)$/, (m) => `Photo: ${m[1]}`],
  [/^映像：(.+)$/, (m) => `Video: ${m[1]}`],
  [/^半径 (\d+) km$/, (m) => `Radius ${m[1]} km`],
  [/^判定できない (\d+) 媒体$/, (m) => `${m[1]} outlets undecided`],
  [/^届かない・更新なし (\d+)$/, (m) => `Unreachable or not updated ${m[1]}`],
  [/^注目ニュース (\d+)\/(\d+)$/, (m) => `Top news ${m[1]}/${m[2]}`],
  [/^バイアス度 (\d+)$/, (m) => `Bias score ${m[1]}`],
  [/^(国内|海外|官公庁) (\d+)(?:・(国内|海外|官公庁) (\d+))?(?:・(国内|海外|官公庁) (\d+))?$/, (m) => [[m[1], m[2]], [m[3], m[4]], [m[5], m[6]]].filter((x) => x[0]).map(([k, n]) => `${SIDE[k]} ${n}`).join(' · ')],
  [/^(.+) の出来事だけ見る$/, (m) => `Only ${trOne(m[1])}`],
  [/^(.+) の記事を開く$/, (m) => `Open ${m[1]}'s article`],
  [/^(.+) の最初の記事を開く$/, (m) => `Open ${m[1]}'s first article`],
  [/^(.+) をフォロー$/, (m) => `Follow ${m[1]}`],
  [/^(.+) を開く$/, (m) => `Open ${trOne(m[1])}`],
  [/^(.+)・(\d+) 件$/, (m) => `${trOne(m[1])} · ${m[2]}`],
  [/^(.+) (\d+) 件$/, (m) => `${trOne(m[1])} ${m[2]}`],
  [/^最初に報じた (.+)$/, (m) => `First reported ${m[1].replace(/国内|海外/g, (k) => SIDE[k]).replace(/（差 (\d+) 分）/, ' ($1 min apart)')}`],
  [/^(\d+(?:\.\d+)?)時間(\d+)分・(\d+)媒体$/, (m) => `${m[1]} h ${m[2]} min · ${m[3]} outlets`],
];

function trOne(x) {
  const t = map(x);
  if (t != null) return t;
  for (const [re, fn] of PAT) { const m = x.match(re); if (m) return fn(m, x); }
  return x;
}

export function tr(text) {
  const s = String(text == null ? '' : text);
  const core = s.trim();
  if (!core || !/[぀-ヿ一-鿿]/.test(core)) return s;
  const t = trOne(core);
  return t === core ? s : s.replace(core, t);
}

const ATTRS = ['title', 'aria-label', 'placeholder'];
const GL_SHORT = { 技術: 'Tech', 安全保障: 'Security', 経済: 'Economy', 国内政治: 'Politics', 政治: 'Politics' };
const FIELD = '[data-genre],.gn,.en-g,.fd,.en-osm,.tp';
function doText(n) {
  const p = n.parentElement;
  if (!p || p.closest(SKIP)) return;
  const v = n.nodeValue;
  if (v.trim() === 'その他' && p.closest(FIELD)) { n.nodeValue = v.replace('その他', 'Other'); return; }
  // the labels under the round field buttons are 34 px wide: the long words take their short forms
  if (GL_SHORT[v.trim()] && p.closest('.gl')) { n.nodeValue = v.replace(v.trim(), GL_SHORT[v.trim()]); return; }
  const t = tr(v);
  if (t !== v) n.nodeValue = t;
}
function doEl(el) {
  if (el.closest(SKIP)) return;
  for (const a of ATTRS) { const v = el.getAttribute(a); if (v) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } }
}

export function localize(root) {
  if (!root) return;
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1) return;
  doEl(root);
  for (const el of root.querySelectorAll('[title],[aria-label],[placeholder]')) doEl(el);
  const w = root.ownerDocument.createTreeWalker(root, 4);
  for (let n = w.nextNode(); n; n = w.nextNode()) doText(n);
}

export function watch(root) {
  localize(root);
  const Obs = root.ownerDocument.defaultView.MutationObserver;
  const mo = new Obs((list) => {
    for (const r of list) {
      if (r.type === 'characterData') doText(r.target);
      else if (r.type === 'attributes') { if (r.target.nodeType === 1) doEl(r.target); }
      else for (const n of r.addedNodes) localize(n);
    }
  });
  mo.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  return () => mo.disconnect();
}
