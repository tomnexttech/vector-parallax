/* Phones held sideways (a low, wide screen). The list of events stays on the left and the right column shows one pane at a time,
 * chosen from the bar of links above it (the same links that jump down the page when the phone is upright). Choosing an event in
 * a list brings the event back to the right. Tablets and desktops never match the query, which is the one the stylesheet uses. */
export const SIDEWAYS = '(orientation: landscape) and (max-height: 500px) and (max-width: 1100px)';

export function initLandscape({ doc = document, win = window } = {}) {
  const app = doc.getElementById('app'), nav = doc.querySelector('.jump');
  if (!app || !nav || !win.matchMedia) return null;
  const mq = win.matchMedia(SIDEWAYS);
  const show = (id) => {
    if (!doc.getElementById(id)) return;
    app.dataset.lp = id;
    for (const a of nav.querySelectorAll('a')) {
      if (a.getAttribute('href') === '#' + id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    }
    if (mq.matches && id === 'p-map') win.dispatchEvent(new Event('resize'));   // the map measures its box again once it shows
  };
  nav.addEventListener('click', (ev) => {
    if (!mq.matches) return;
    const a = ev.target.closest('a[href^="#p-"]');
    if (!a) return;
    ev.preventDefault();
    show(a.getAttribute('href').slice(1));
  });
  for (const id of ['pri-b', 'anom-b']) {
    const box = doc.getElementById(id);
    if (box) box.addEventListener('click', (ev) => { if (mq.matches && ev.target.closest('.r')) show('p-case'); });
  }
  const turned = () => win.dispatchEvent(new Event('resize'));
  if (mq.addEventListener) mq.addEventListener('change', turned);
  show(app.dataset.lp || 'p-case');
  return { show, active: () => mq.matches };
}
