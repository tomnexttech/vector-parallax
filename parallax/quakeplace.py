# -*- coding: utf-8 -*-
"""quakeplace — USGS place strings in Japanese (CONTRACT 20.8). Stdlib only.

"207 km ESE of Hachijo-jima, Japan" -> "八丈島の東南東 約207 km". The direction is in kanji, the names come from the tables below.
A town that is not in the table but a country that is -> "日本付近". Nothing known -> None (the caller keeps the original English string in `place_en`).
"""
import re

DIRS = {"N": "北", "NNE": "北北東", "NE": "北東", "ENE": "東北東", "E": "東", "ESE": "東南東", "SE": "南東", "SSE": "南南東",
        "S": "南", "SSW": "南南西", "SW": "南西", "WSW": "西南西", "W": "西", "WNW": "西北西", "NW": "北西", "NNW": "北北西"}

COUNTRIES = {
    "Japan": "日本", "Indonesia": "インドネシア", "Philippines": "フィリピン", "Papua New Guinea": "パプアニューギニア", "Fiji": "フィジー",
    "Tonga": "トンガ", "Vanuatu": "バヌアツ", "Solomon Islands": "ソロモン諸島", "New Zealand": "ニュージーランド", "Australia": "オーストラリア",
    "Chile": "チリ", "Peru": "ペルー", "Ecuador": "エクアドル", "Colombia": "コロンビア", "Mexico": "メキシコ", "Guatemala": "グアテマラ",
    "El Salvador": "エルサルバドル", "Nicaragua": "ニカラグア", "Costa Rica": "コスタリカ", "Panama": "パナマ", "Argentina": "アルゼンチン",
    "Bolivia": "ボリビア", "Venezuela": "ベネズエラ", "Haiti": "ハイチ", "Dominican Republic": "ドミニカ共和国", "Cuba": "キューバ",
    "Turkey": "トルコ", "Greece": "ギリシャ", "Italy": "イタリア", "Iran": "イラン", "Iraq": "イラク", "Afghanistan": "アフガニスタン",
    "Pakistan": "パキスタン", "India": "インド", "Nepal": "ネパール", "China": "中国", "Taiwan": "台湾", "Myanmar": "ミャンマー",
    "Russia": "ロシア", "Tajikistan": "タジキスタン", "Kyrgyzstan": "キルギス", "Kazakhstan": "カザフスタン", "Algeria": "アルジェリア",
    "Morocco": "モロッコ", "Ethiopia": "エチオピア", "Kenya": "ケニア", "Tanzania": "タンザニア", "Iceland": "アイスランド",
    "Canada": "カナダ", "South Korea": "韓国", "North Korea": "北朝鮮", "Vietnam": "ベトナム", "Thailand": "タイ", "Malaysia": "マレーシア",
    "Samoa": "サモア", "American Samoa": "米領サモア", "Guam": "グアム", "Northern Mariana Islands": "北マリアナ諸島", "Puerto Rico": "プエルトリコ",
    "Alaska": "アラスカ", "California": "カリフォルニア", "Hawaii": "ハワイ", "Nevada": "ネバダ", "Oklahoma": "オクラホマ", "Texas": "テキサス",
    "Oregon": "オレゴン", "Washington": "ワシントン", "Idaho": "アイダホ", "Montana": "モンタナ", "Utah": "ユタ", "Wyoming": "ワイオミング",
    "Kuril Islands": "千島列島", "Albania": "アルバニア", "Romania": "ルーマニア", "Georgia": "ジョージア", "Armenia": "アルメニア",
    "Azerbaijan": "アゼルバイジャン", "Syria": "シリア", "Israel": "イスラエル", "Saudi Arabia": "サウジアラビア", "Yemen": "イエメン",
    "Honduras": "ホンジュラス", "Jamaica": "ジャマイカ", "Brazil": "ブラジル", "New Caledonia": "ニューカレドニア", "Mongolia": "モンゴル",
}

TOWNS = {
    "Hachijo-jima": "八丈島", "Chichi-shima": "父島", "Miyako": "宮古", "Miyakojima": "宮古島", "Ishigaki": "石垣", "Naze": "名瀬",
    "Kushiro": "釧路", "Hachinohe": "八戸", "Katsuura": "勝浦", "Namie": "浪江", "Futtsu": "富津", "Tomakomai": "苫小牧", "Nemuro": "根室",
    "Shizunai-furukawacho": "静内", "Hirara": "平良", "Kamaishi": "釜石", "Ofunato": "大船渡", "Iwaki": "いわき", "Ishinomaki": "石巻",
    "Sendai": "仙台", "Tokyo": "東京", "Shimoda": "下田", "Tateyama": "館山", "Choshi": "銚子", "Hitachi": "日立", "Mito": "水戸",
    "Aomori": "青森", "Hakodate": "函館", "Muroran": "室蘭", "Obihiro": "帯広", "Abashiri": "網走", "Wakkanai": "稚内", "Kanoya": "鹿屋",
    "Nago": "名護", "Naha": "那覇", "Hasaki": "波崎", "Kuji": "久慈", "Akita": "秋田", "Niigata": "新潟", "Sado": "佐渡", "Toyama": "富山",
    "Kanazawa": "金沢", "Shingu": "新宮", "Muroto": "室戸", "Kochi": "高知", "Uwajima": "宇和島", "Miyazaki": "宮崎", "Kagoshima": "鹿児島",
    "Nishinoomote": "西之表", "Amami": "奄美", "Toyohashi": "豊橋", "Omaezaki": "御前崎", "Ito": "伊東", "Atami": "熱海", "Oshima": "大島",
    "Taitung City": "台東", "Hualien City": "花蓮", "Yilan": "宜蘭", "Ambunti": "アンブンティ", "Kokopo": "ココポ", "Kimbe": "キンベ",
    "Port-Vila": "ポートビラ", "Lata": "ラタ", "Honiara": "ホニアラ", "Neiafu": "ネイアフ", "Pangai": "パンガイ", "Suva": "スバ",
    "Anchorage": "アンカレッジ", "Adak": "アダック", "Unalaska": "ウナラスカ", "Sand Point": "サンドポイント", "Hilo": "ヒロ", "Pahala": "パハラ",
    "Istanbul": "イスタンブール", "Athens": "アテネ", "Kathmandu": "カトマンズ", "Jakarta": "ジャカルタ", "Manila": "マニラ",
    "Santiago": "サンティアゴ", "Lima": "リマ", "Valparaiso": "バルパライソ", "Antofagasta": "アントファガスタ", "Iquique": "イキケ",
}

REGIONS = {
    "Northern Mid-Atlantic Ridge": "北大西洋中央海嶺", "Southern Mid-Atlantic Ridge": "南大西洋中央海嶺", "Mid-Atlantic Ridge": "大西洋中央海嶺",
    "Pacific-Antarctic Ridge": "太平洋南極海嶺", "East Pacific Rise": "東太平洋海膨", "Central Mid-Atlantic Ridge": "大西洋中央海嶺",
    "Fiji region": "フィジー付近", "Kermadec Islands region": "ケルマデック諸島付近", "Izu Islands, Japan region": "伊豆諸島付近",
    "Kuril Islands": "千島列島付近", "Volcano Islands, Japan region": "火山列島付近", "Bonin Islands, Japan region": "小笠原諸島付近",
    "Ryukyu Islands, Japan": "琉球諸島付近", "Mariana Islands region": "マリアナ諸島付近", "Banda Sea": "バンダ海", "Molucca Sea": "モルッカ海",
    "Celebes Sea": "セレベス海", "Philippine Sea": "フィリピン海", "Drake Passage": "ドレーク海峡", "Scotia Sea": "スコシア海",
}

_KM = re.compile(r"^(\d+(?:\.\d+)?)\s*km\s+([NSEW]{1,3})\s+of\s+(.+)$", re.I)


def _num(x):
    f = float(x)
    return ("%d" % f) if f == int(f) else ("%.1f" % f)


def ja(place):
    """-> a Japanese place string, or None when nothing in the string is known (keep the English one)."""
    s = (place or "").strip()
    if not s:
        return None
    if s in REGIONS:
        return REGIONS[s]
    m = _KM.match(s)
    if m:
        km, d, rest = m.group(1), m.group(2).upper(), m.group(3).strip()
        if d not in DIRS:
            return None
        town, _, country = rest.rpartition(",")
        town, country = (town.strip(), country.strip()) if town else (rest, "")
        if town in TOWNS:
            return "%sの%s 約%s km" % (TOWNS[town], DIRS[d], _num(km))
        if country in COUNTRIES:
            return "%s付近" % COUNTRIES[country]
        return None
    last = re.sub(r"\s+region$", "", s.rsplit(",", 1)[-1].strip(), flags=re.I)
    return ("%s付近" % COUNTRIES[last]) if last in COUNTRIES else None
