/* heads — every heading, way in, tab and pane title of the page in one table (docs/copy-canon.md). A heading is a short noun:
 * 2 to 8 characters, no particle (の・と・を・が・は・に・で) tying it into a sentence, no 〜の話, no 〜について, no 〜を見る.
 * The code takes its headings from here; i18n takes the English from here; tests/js/heads.test.js holds every entry to the rule
 * and keeps the retired sentence-like headings out of the code.
 *
 *   HEAD[id] -> the Japanese heading           HEAD_EN -> { ja: en }        headRule(ja) -> '' | why it breaks the rule */

export const HEADS = {
  // the home's ways in and the panel beside the card
  'home.title': ['トップニュース', 'Top stories'],
  'front.gap': ['国内外比較', 'Japan vs abroad'],
  'front.jp': ['日本独自', 'Japan only'],
  'front.intl': ['海外独自', 'Abroad only'],
  'front.bias': ['偏り度', 'Bias index'],
  'panel.fields': ['分野別', 'By field'],
  'panel.events': ['話題別', 'By story'],
  'panel.topic': ['話題', 'Story'],
  'panel.score': ['偏り度', 'Bias index'],
  // 比べる: the rows of the newspapers side by side
  'paper.words': ['注目語', 'Key words'],
  'paper.nums': ['数字', 'Figures'],
  'paper.tone': ['反応語', 'Reaction words'],
  'paper.first': ['初報', 'First report'],
  'paper.heads': ['見出し', 'Headlines'],
  'paper.jp': ['国内報道', 'Japan'],
  'paper.intl': ['海外報道', 'Abroad'],
  'paper.gov': ['官公庁', 'Ministries'],
  // 比べる: the scenes and the figures
  'cmp.paper': ['紙面比較', 'Side by side'],
  'cmp.figs': ['伝え方', 'How it was told'],
  'cmp.heads': ['各社見出し', 'Each outlet'],
  'cmp.local': ['地元', 'Local'],
  'cmp.verdict': ['比べた結論', 'Comparison summary'],
  'fig.share': ['件数比', 'Share of reports'],
  'fig.outlets': ['社数比', 'Share of outlets'],
  'fig.first': ['初報時刻', 'First reports'],
  'fig.gap': ['国内外差', 'Gap'],
  'fig.cum': ['累計件数', 'Reports adding up'],
  'fig.words': ['用語比較', 'Words used'],
  'fig.hwords': ['見出し語', 'Headline words'],
  'fig.shared': ['共通語', 'Shared words'],
  'fig.freq': ['頻出語', 'Frequent words'],
  // 媒体比較 (js/coverage.js) and the story's sections (js/story.js)
  'cov.title': ['媒体比較', 'Outlets compared'],
  'cov.words': ['言い回し', 'Wording'],
  'story.sides': ['各側見出し', 'Headlines by side'],
  'story.src': ['出典一覧', 'Sources'],
  'absent.title': ['未検出媒体', 'Outlets not found'],
  // 詳しく見る: panes, tabs and sheets
  'pane.anom': ['独自報道', 'One side only'],
  'pane.basis': ['出典・手法', 'Basis and sources'],
  'pane.hours': ['時間別', 'By hour'],
  'pane.count': ['件数', 'Counts'],
  'pane.local': ['地元', 'Local'],
  'pane.rel': ['関連', 'Related'],
  'pane.diff': ['前回以降', 'Since last visit'],
  'saved.list': ['保存一覧', 'Saved'],
  'case.reps': ['各側初報', 'First of each side'],
  'pane.counth': ['見出し数', 'Headlines'],
  'saved.words': ['フォロー語', 'Followed words'],
  'saved.hits': ['フォロー一致', 'Matches'],
  'case.gov': ['官公庁資料', 'Ministries\' papers'],
  'case.src': ['全出典', 'All sources'],
  'case.why': ['集約理由', 'Why grouped'],
  'case.mix': ['見出し比率', 'Share of headlines'],
  'case.video': ['映像付き', 'With video'],
  'case.pairs': ['類似見出し', 'Similar headlines'],
  'case.ai': ['AI 連結', 'AI links'],
  // 媒体の特徴 (js/traits.js): the sheet of one outlet
  'outlet.sheet': ['媒体の特徴', 'Outlet profile'],
  'outlet.note': ['考察', 'Reading'],
  'outlet.fields': ['分野配分', 'Field mix'],
  'outlet.alone': ['独自率', 'Own-side stories'],
  'outlet.agree': ['他社一致', 'Shared with others'],
  'outlet.words': ['特徴語', 'Distinctive words'],
  'outlet.tone': ['反応語', 'Reaction words'],
  'outlet.bias': ['偏り度分布', 'Bias index spread'],
  'outlet.ext': ['外部評価', 'Outside ratings'],
  'outlet.list': ['掲載ニュース', 'News carried'],
  'outlet.multi': ['複数社報道', 'Stories of 2+ outlets'],
  'outlet.firsts': ['初報回数', 'First reports'],
  'outlet.lag': ['初報遅れ', 'Lag behind first'],
  'outlet.with': ['同報社数', 'Outlets alongside'],
  'outlet.solo': ['単独報道', 'Carried alone'],
  // the tiles of the news (js/dossier.js)
  'tile.share': ['国内外件数', 'Reports by side'],
  'tile.types': ['媒体種別', 'Outlet types'],
  'tile.words': ['国内外用語', 'Words by side'],
  'tile.matrix': ['媒体別用語', 'Words by outlet'],
  'tile.time': ['時系列', 'Over time'],
  // 媒体比較: where the outlets differ (js/coverage.js FIND_JA)
  'find.title': ['違い', 'Differences'],
  'find.only': ['片側掲載', 'One side carried'],
  'find.word': ['用語選択', 'Choice of words'],
  'find.num': ['数値差', 'Figures differ'],
  'find.lead': ['冒頭語', 'Opening word'],
  'find.first': ['初報差', 'First reports apart'],
  // ニュース詳細 and the sheets of the page
  'case.span': ['時間幅', 'Time span'],
  'case.near': ['周辺ニュース', 'News nearby'],
  'case.sides': ['国内外', 'Japan and abroad'],
  'about.title': ['データ・AI', 'Data and AI'],
  'me.title': ['閲覧記録', 'My reading'],
  'own.title': ['マイ AI', 'My AI'],
  'src.title': ['媒体一覧', 'Outlets'],
  'absent.unknown': ['判定不能', 'Undecided'],
  // the trend of a place under the map (js/trendui.js, js/mapnews.js; 11-22)
  'trend.place': ['地点別動向', 'Place trend'],
  'trend.top': ['話題上位', 'Top stories'],
  'trend.up': ['増加中', 'Rising'],
  'trend.fields': ['分野別', 'By field'],
  'trend.outlets': ['媒体別', 'By outlet'],
  'trend.days': ['日別件数', 'By day'],
  'trend.social': ['SNS 動向', 'Social media'],
  'trend.words': ['上昇語', 'Rising words'],
  'trend.tone': ['肯定否定', 'Positive and negative'],
};

/** the exceptions: 媒体の特徴 is the sheet's name Sir used (11-15); ホーム画面に追加 is the name of Safari's own menu item, quoted as the
 *  phone shows it. They stay */
export const HEAD_KEEP = new Set(['媒体の特徴', 'ホーム画面に追加']);
export const HEAD_MAX = 8;
/** the labels parallax/coverage.py still starts its sentences with: js/coverage.js cuts them off, the page never shows them as heads */
export const FIND_BOARD = { only_side: '載せた点', word_choice: '言葉の選び方', num_diff: '数', lead_differs: '見出しの最初の語', first_gap: '最初の時刻' };

export const HEAD = Object.fromEntries(Object.entries(HEADS).map(([k, [ja]]) => [k, ja]));
export const HEAD_EN = Object.fromEntries(Object.values(HEADS).map(([ja, en]) => [ja, en]));

/** the headings that read as sentences and were replaced (docs/copy-canon.md): none of them is written in the code again */
export const RETIRED = ['日本と海外の差', '片側だけの話', '偏りの大きい話', '分野ごとの記事の数', '片側だけが報じた話', 'バイアス度の大きい順',
  '注目した語', '出てきた数字', '反応の語', '並べて比べる', '伝え方の違い', '各メディアの見出し', '使った言葉の違い', '件数の積み上がり', '社の割合',
  '件数の割合', '最初に報じた時刻', '媒体の比べ', '言い方の違い', '各側の見出し', '出典の一覧', 'この話題が見つからなかった媒体', '出典とまとめ方',
  '時間別の件数', '保存したニュース', 'フォローする言葉', 'フォローに当たるニュース', '官公庁の一次資料', '全報道の出典', 'まとめた理由',
  '国内・海外・官公庁の見出しの割合', '映像のあるニュース', '似ている見出しの対', 'AI が足したつながり', '前回からの新着',
  '見出しの言葉', '共通する言葉', 'よく出た言葉', '国内と海外の差', '各側の最初の見出し', '地元のニュース', '関連ニュース', '見出しの件数',
  '国内と海外', 'メディアの種類', '国内と海外の語', '媒体と語の重なり', '時間の流れ', '見出しの最初の語', '最初の時刻', '載せた点', '言葉の選び方',
  'この社だけの話', '最初の報道からの遅れ（中央値）', '共通の語', '時刻の幅', '他の出来事', '自分の読み方', 'データと AI'];

const LEN = (s) => [...String(s).replace(/\s/g, '')].length;
export function headRule(ja) {
  const s = String(ja || '');
  if (HEAD_KEEP.has(s)) return '';
  const n = LEN(s);
  if (n < 2) return '短すぎる';
  if (n > HEAD_MAX) return `長すぎる（${n} 字）`;
  // a particle beside a kanji, katakana or latin word ties words into a sentence; inside a word of kana only (つながり) it is no particle
  if (/(?<![ぁ-ゖ])[のとをがはにで]|[のとをがはにで](?![ぁ-ゖ])/.test(s)) return '助詞でつないでいる';
  if (/話$|について$|を見る$|する$|します$|ません$/.test(s)) return '文の形';
  return '';
}
