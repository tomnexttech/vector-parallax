/* install — the page as an app on the home screen, and the page when the network is gone. No DOM.
 *
 *   standalone(win) -> bool               opened from the home screen (display-mode standalone, or iOS navigator.standalone)
 *   iosSafari(ua) -> bool                 an iPhone or iPad Safari, where the share menu is the only way to add a page
 *                                         (no beforeinstallprompt). An iPad that says it is a Mac counts when it has touch
 *   wantIosSheet({ ua, touch, isStandalone, store }) -> bool    once on this device, never again after it was closed
 *   closeIosSheet(store)                  remembers the close (this browser only, one key: parallax.install.v1)
 *   offlineLine({ online, generatedAt, now, clock }) -> { text, bad } | null   while offline: the time of the data in hand, in red
 *
 * Nothing leaves the browser. A server push or a timed message cannot be made: the site has no server (docs/app.md). */

export const KEY = 'parallax.install.v1';

export function standalone(win) {
  try {
    if (win && win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) return true;
    return !!(win && win.navigator && win.navigator.standalone === true);
  } catch { return false; }
}

export function iosSafari(ua, touch = 0) {
  const u = String(ua || '');
  const ios = /iPhone|iPad|iPod/.test(u) || (/Macintosh/.test(u) && touch > 1);
  // other browsers on iOS name themselves; only Safari's own share menu has 「ホーム画面に追加」 for every version
  return ios && /Safari\//.test(u) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(u);
}

function seen(store) { try { return !!(store && store.getItem(KEY)); } catch { return false; } }
export function wantIosSheet({ ua, touch = 0, isStandalone = false, store } = {}) {
  return !isStandalone && iosSafari(ua, touch) && !seen(store);
}
export function closeIosSheet(store) { try { if (store) store.setItem(KEY, JSON.stringify({ closed: true })); } catch { /* private window: shown again next time */ } }

export function offlineLine({ online = true, generatedAt = null, now = Date.now() / 1000, clock = (t) => String(t) } = {}) {
  if (online) return null;
  if (typeof generatedAt !== 'number' || !Number.isFinite(generatedAt)) return { text: 'オフライン　手元にデータがありません', bad: true };
  const h = Math.max(0, (now - generatedAt) / 3600);
  return { text: `オフライン　${clock(generatedAt)} のデータ（${h < 1 ? '1 時間未満' : Math.floor(h) + ' 時間'}前）`, bad: true };
}
