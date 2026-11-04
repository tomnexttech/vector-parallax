/* topics — which watched issue and which field a piece of public text belongs to. Rules only (no AI), no DOM.
 *
 *   topicsOf(text)          -> ids of TOPICS found in the text, in TOPICS order ([] for sport and entertainment, except disasters)
 *   fieldOf(text, homes)    -> one of FIELDS, or '' when no rule matches (an overseas-only event without a match is 国際)
 *   TOPICS, FIELDS          -> the lists the page shows
 *
 * The text is what the page already shows: the AI headline and the outlets' own headlines. Nothing here judges
 * whether a headline is true, and nothing gives an outlet a side. */

const norm = (s) => (typeof s === 'string' ? s.normalize('NFKC') : '');

// words that contain a watched word but mean something else; removed before matching
const MASK = /中核|核心|結核|核家族|核融合|防衛戦|王座防衛|タイトル防衛|連覇|基地局|秘密基地|人材派遣|派遣社員|株価指数|審議会/g;
const EXCLUDE = /スポーツ|芸能|天気予報|週間天気|競馬|プロ野球|サッカー|ラグビー|大相撲|ゴルフ|テニス|甲子園|Jリーグ|将棋|囲碁|映画|ドラマ|アイドル|熱愛|結婚|占い|紅白|\b(NFL|NBA|MLB|NHL|Premier League|box office|celebrity|horoscope|Super Bowl|World Series)\b/i;

export const TOPICS = [
  { id: 'money', ja: '公金', re: /補正予算|予備費|予算案|当初予算|概算要求|予算委|政治資金|裏金|パーティー券|検査院|補助金|交付金|給付金|税制|増税|減税|消費税|所得税|法人税|防衛費|公金|公費|血税|広報費|政府広報|随意契約|随契|中抜き|談合|国債|財政|歳出|基金|関税|\b(tariffs?|subsid(y|ies)|budget|appropriations?|spending bill|tax (cut|hike|increase)s?|bailout|stimulus)\b/i },
  { id: 'law', ja: '法・人事', re: /法案|改正案|法改正|改正法|閣議決定|成立|可決|否決|施行|逮捕|起訴|判決|最高裁|地裁|高裁|任命|人事|辞任|更迭|就任|解任|規制|条例|違憲|\b(bill|legislation|court|ruling|indict(ed|ment)?|arrest(ed|s)?|appoint(s|ed)?|resign(s|ed)?|nominee|regulat(e|es|ion|ions|or|ors))\b/i },
  { id: 'security', ja: '安保', re: /防衛|自衛隊|安保|安全保障|ミサイル|核(兵器|実験|開発|ミサイル|保有|合意|施設|の傘|武装|弾頭)|非核|軍事|米軍|海軍|空軍|陸軍|軍艦|派兵|同盟|基地|弾道|攻撃|停戦|戦闘|侵攻|領海|領空|\b(military|missiles?|nuclear|defen[cs]e|troops|NATO|war|airstrikes?|strikes?|ceasefire|army|navy|invasion)\b/i },
  { id: 'disaster', ja: '災害', re: /地震|震度|津波|台風|豪雨|大雨|洪水|土砂|噴火|避難|災害|猛暑|熱中症|大雪|竜巻|\b(earthquakes?|quakes?|tsunami|typhoons?|floods?|flooding|hurricanes?|wildfires?|eruptions?|disasters?|landslides?)\b/i },
  { id: 'power', ja: '説明責任', re: /記者クラブ|情報公開|公文書|黒塗り|改ざん|隠蔽|説明責任|検閲|報道の自由|不祥事|第三者委|調査委|不正|虚偽|疑惑|\b(transparency|accountability|press freedom|censor(ship)?|cover-?up|whistle-?blowers?|scandals?|probes?|inquiry|misconduct)\b/i },
  { id: 'tech', ja: 'AI統治', re: /生成AI|AI規制|AI法|人工知能|個人情報|サイバー|データセンター|半導体|顔認証|\bAI\b|\b(artificial intelligence|cyber(attacks?|security)?|privacy|data protection|semiconductors?|OpenAI|Anthropic|deepfakes?)\b/i },
];

export const FIELDS = ['国内政治', '国際', '経済', '安全保障', '技術', '市場'];

// order is priority: the first field that matches wins
const FIELD_RULES = [
  ['技術', /生成AI|人工知能|半導体|サイバー|量子|宇宙|ロケット|衛星|ソフトウェア|データセンター|\bAI\b|\b(OpenAI|Anthropic|Nvidia|semiconductors?|chips?|software|cyber|quantum|SpaceX|satellites?|artificial intelligence)\b/i],
  ['安全保障', TOPICS[2].re],
  ['市場', /株価|株安|株高|日経平均|TOPIX|東証|為替|円安|円高|ドル円|長期金利|利回り|債券|原油|\b(stocks?|shares|Nasdaq|Dow|S&P|yen|dollar|yields?|bonds?|oil prices?|Wall Street)\b/i],
  ['経済', /財務相|財務長官|日銀|金利|関税|GDP|物価|インフレ|賃上げ|賃金|決算|財政|増税|減税|貿易|景気|雇用|失業|予算|\b(tariffs?|inflation|Fed|earnings|economy|economic|GDP|recession|trade|jobs|wages|central bank)\b/i],
  ['国内政治', /首相|官房長官|国会|閣議|自民|立憲|維新|公明|国民民主|共産党|れいわ|参政党|与党|野党|大臣|知事|衆院|参院|衆議院|参議院|内閣|総裁|議員/],
  ['国際', /大統領|外相|国連|首脳|外交|大使|中間選挙|\b(president|minister|UN|NATO|EU|sanctions?|summit|embassy|election|diplomat(s|ic)?)\b/i],
];

export function topicsOf(text) {
  const t = norm(text).replace(MASK, ' ');
  if (!t) return [];
  const out = TOPICS.filter((x) => x.re.test(t)).map((x) => x.id);
  return EXCLUDE.test(t) ? out.filter((x) => x === 'disaster') : out;
}

export function fieldOf(text, homes) {
  const t = norm(text).replace(MASK, ' ');
  if (t && !EXCLUDE.test(t)) for (const [f, re] of FIELD_RULES) if (re.test(t)) return f;
  const hs = Array.isArray(homes) ? homes : [];
  return hs.length && !hs.includes('jp') ? '国際' : '';
}

export const topicJa = (id) => (TOPICS.find((x) => x.id === id) || {}).ja || '';
