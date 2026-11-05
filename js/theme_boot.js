/* The appearance, decided before the first paint (a classic script in <head>, so the page never flashes the other one).
 * Dark unless the visitor chose light: settings.look.theme ('dark' | 'light', kept by js/settings.js in this browser only).
 * The system setting is not followed. Writes <html data-theme="light|dark"> and the theme colour.
 * js/app.js calls window.parallaxTheme.apply(choice) when the settings change; a change fires the 'parallax-theme' event. */
(function () {
  var KEY = 'parallax.settings.v1';
  var pref = 'dark';
  function apply(p) {
    if (p !== undefined) pref = p === 'light' ? 'light' : 'dark';
    var t = pref, root = document.documentElement;
    if (root.getAttribute('data-theme') === t) return t;
    root.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#efeff1' : '#222325');
    try { window.dispatchEvent(new CustomEvent('parallax-theme', { detail: t })); } catch (e) { /* old browser: the page still turns */ }
    return t;
  }
  try {
    var s = JSON.parse(window.localStorage.getItem(KEY) || 'null');
    if (s && s.look && s.look.theme === 'light') pref = 'light';
  } catch (e) { /* private window or broken JSON: dark */ }
  apply();
  window.parallaxTheme = { apply: apply, get: function () { return document.documentElement.getAttribute('data-theme'); } };
})();
