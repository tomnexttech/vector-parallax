/* actions — every operation of the board as a closed list (id -> function), for the keys and for the voice (js/voice.js).
 *
 *   createActions(api) -> { list: [{ id, ja, param }], run(id, arg) -> { ok, say } , has(id) }
 *
 * `api` is supplied by js/app.js. A voice layer may only choose an id of this list (and fill `param`); it never runs free text.
 * The descriptions are what a matcher compares a spoken request with. */

export const CATALOG = [
  { id: 'case_next', ja: '次の注目の出来事を出す', param: '' },
  { id: 'case_prev', ja: '前の注目の出来事に戻る', param: '' },
  { id: 'case_find', ja: '語や地名で出来事を探して出す', param: 'q' },
  { id: 'view_ai', ja: 'AI が組み直した束で見る', param: '' },
  { id: 'view_rules', ja: '規則だけで束ねた結果で見る', param: '' },
  { id: 'topic', ja: '注目の一覧を論点で絞る（公金・法・人事・安保・災害・説明責任・AI統治・追う）', param: 'topic' },
  { id: 'topic_all', ja: '注目の一覧の絞りを外す', param: '' },
  { id: 'field', ja: '分野の札を切り替える（国内政治・国際・経済・安全保障・技術・市場・その他）', param: 'field' },
  { id: 'map_case', ja: '地図を表示中の出来事の地域へ戻す', param: '' },
  { id: 'map_world', ja: '地図を世界の全体にする', param: '' },
  { id: 'map_mode', ja: '地図を欄いっぱいに広げる・出来事の表示に戻す', param: '' },
  { id: 'view_count', ja: '一度に見るニュースの数を替える', param: '1・2・4・6・9・多い・次' },
  { id: 'view_layout', ja: 'ニュースの並べ方を替える', param: '標準・主役・一覧・次' },
  { id: 'view_page', ja: '次の・前のニュースへ送る', param: '1 か -1' },
  { id: 'map_in', ja: '地図を拡大する', param: '' },
  { id: 'map_out', ja: '地図を縮小する', param: '' },
  { id: 'layer', ja: '地図の層を出す・消す（出来事・注目・半径・地震・台風・災害）', param: 'layer' },
  { id: 'quakes', ja: '24 時間の地震の件数と最大の一件を答える', param: '' },
  { id: 'typhoons', ja: '今の台風の位置と強さを答える', param: '' },
  { id: 'watch_add', ja: '追う語・地名を足す', param: 'term' },
  { id: 'watch_remove', ja: '追う語・地名を外す', param: 'term' },
  { id: 'open_article', ja: '表示中の出来事の最初の記事を開く', param: '' },
  { id: 'about', ja: 'データと AI についての板を開く', param: '' },
  { id: 'settings', ja: '設定の画面を開く（映像・ニュース・ミュート・動き・盤の欄）', param: '' },
  { id: 'close', ja: '開いている板を閉じる', param: '' },
  { id: 'sheet', ja: '欄の詳細の板を開く（源・時間ごと・注目・非対称・市場・政治・災害）', param: 'kind' },
  { id: 'task_add', ja: '表示中の出来事を調べるタスクに足す', param: '' },
  { id: 'tasks', ja: '自分のタスクの一覧を開く', param: '' },
  { id: 'auto_stop', ja: '注目の出来事の自動の送りを止める', param: '' },
  { id: 'auto_start', ja: '注目の出来事の自動の送りを再び始める', param: '' },
];

export function createActions(api) {
  const fns = {
    case_next: () => api.step(1), case_prev: () => api.step(-1), case_find: (q) => api.find(q),
    view_ai: () => api.setView('ai'), view_rules: () => api.setView('rules'),
    topic: (t) => api.setTopic(t), topic_all: () => api.setTopic('all'), field: (f) => api.setField(f),
    map_case: () => api.mapCase(), map_world: () => api.mapWorld(), map_mode: () => api.mapMode(), map_in: () => api.mapZoom(1.6), map_out: () => api.mapZoom(1 / 1.6), layer: (l) => api.toggleLayer(l),
    quakes: () => api.sayQuakes(), typhoons: () => api.sayTyphoons(),
    watch_add: (t) => api.watchAdd(t), watch_remove: (t) => api.watchRemove(t),
    open_article: () => api.openArticle(), about: () => api.openAbout(), settings: () => api.openSettings(), close: () => api.close(),
    view_count: (c) => api.setCount(c), view_layout: (l) => api.setLayout(l), view_page: (d) => api.turnPage(d),
    sheet: (k) => api.openSheet(k), task_add: () => api.taskAdd(), tasks: () => api.openTasks(),
    auto_stop: () => api.autoStop(), auto_start: () => api.autoStart(),
  };
  const ids = new Set(CATALOG.map((c) => c.id));
  return {
    list: CATALOG.map((c) => ({ ...c })),
    has: (id) => ids.has(id),
    run(id, arg) {
      if (!ids.has(id) || typeof fns[id] !== 'function') return { ok: false, say: '' };
      const c = CATALOG.find((x) => x.id === id);
      if (c.param && (typeof arg !== 'string' || !arg.trim())) return { ok: false, say: '' };
      const r = fns[id](typeof arg === 'string' ? arg.trim() : undefined);
      return { ok: r !== false, say: typeof r === 'string' ? r : '' };
    },
  };
}
