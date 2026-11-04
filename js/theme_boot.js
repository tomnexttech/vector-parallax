/* The appearance, decided before the first paint (a classic script in <head>, so the page never flashes the other one).
 * The visitor's choice is settings.look.theme ('system' | 'light' | 'dark', kept by js/settings.js in this browser only);
 * 'system' follows prefers-color-scheme and keeps following it. Writes <html data-theme="light|dark"> and the theme colour.
 * js/app.js calls window.parallaxTheme.apply(choice) when the settings change; a change fires the 'parallax-theme' event. */
(function () {
  var KEY = 'parallax.settings.v1';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  var pref = 'system';
  function resolve() { return pref === 'light' || pref === 'dark' ? pref : mq && mq.matches ? 'light' : 'dark'; }
  function apply(p) {
    if (p !== undefined) pref = p === 'light' || p === 'dark' ? p : 'system';
    var t = resolve(), root = document.documentElement;
    if (root.getAttribute('data-theme') === t) return t;
    root.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#efeff1' : '#222325');
    try { window.dispatchEvent(new CustomEvent('parallax-theme', { detail: t })); } catch (e) { /* old browser: the page still turns */ }
    return t;
  }
  try {
    var s = JSON.parse(window.localStorage.getItem(KEY) || 'null');
    if (s && s.look && typeof s.look.theme === 'string') pref = s.look.theme;
  } catch (e) { /* private window or broken JSON: follow the system */ }
  apply();
  if (mq) {
    var on = function () { if (pref === 'system') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
  }
  window.parallaxTheme = { apply: apply, get: function () { return document.documentElement.getAttribute('data-theme'); } };
})();
