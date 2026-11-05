/* feel — the board answers a touch. A tile grows a little under the pointer and sinks when pressed (css/app.css, "touch"),
 * and a short, quiet sound is made here with Web Audio (no sound files): a press and a switch (a control with aria-pressed)
 * by default, a hover only when it is turned on in the settings. Nothing sounds before the visitor's first press or key (the
 * browser's rule). Phones also get a short vibration on a press, where the device has one, with the press sound's setting.
 *
 *   createFeel({ press: () => bool, hover: () => bool }) -> { play(kind) -> bool }
 *   TONES -> { hover, press, on, off }: { f, f2, d, g, type } = start and end pitch (Hz), length (s), peak gain, wave
 */
export const TONES = {
  hover: { f: 2200, f2: 1900, d: 0.03, g: 0.006, type: 'sine' },
  press: { f: 600, f2: 380, d: 0.05, g: 0.02, type: 'triangle' },
  on: { f: 700, f2: 1050, d: 0.07, g: 0.016, type: 'sine' },
  off: { f: 820, f2: 560, d: 0.07, g: 0.014, type: 'sine' },
};
const TILE = '.rows .r, .gn, .tab, .chip, .ak, .haz li, .mk li, .pol li, .srcs li, .en-card, .lyr';
const PRESS = 'button, a[href], [role="button"], .rows .r, .haz li, .en-card';
const HOVER_GAP = 90;   // ms between two hover sounds at the most

export function createFeel({ press, hover }) {
  let ctx = null, armed = false, lastHover = 0, hoverEl = null;
  function arm() {
    armed = true;
    try {
      if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); }
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch { ctx = null; }
  }
  function play(kind) {
    const t = TONES[kind];
    if (!t || !armed || !ctx || ctx.state !== 'running') return false;
    if (kind === 'hover' ? !hover() : !press()) return false;
    try {
      const now = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = t.type;
      o.frequency.setValueAtTime(t.f, now);
      o.frequency.exponentialRampToValueAtTime(t.f2, now + t.d);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(t.g, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t.d);
      o.connect(g); g.connect(ctx.destination);
      o.start(now); o.stop(now + t.d + 0.02);
      return true;
    } catch { return false; }
  }
  const closest = (ev, sel) => (ev.target && ev.target.closest ? ev.target.closest(sel) : null);
  document.addEventListener('pointerdown', (ev) => {
    arm();
    const el = closest(ev, PRESS);
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    if (ev.pointerType === 'touch' && press() && navigator.vibrate) { try { navigator.vibrate(8); } catch { /* not allowed here */ } }
    if (!el.hasAttribute('aria-pressed')) play('press');   // a switch sounds on its click, by the way it turns
  }, { capture: true, passive: true });
  document.addEventListener('click', (ev) => {
    const el = closest(ev, '[aria-pressed]');
    if (el && !el.disabled) play(el.getAttribute('aria-pressed') === 'true' ? 'off' : 'on');
  }, { capture: true, passive: true });
  document.addEventListener('keydown', (ev) => { if (!ev.repeat) arm(); }, { capture: true, passive: true });
  document.addEventListener('pointerover', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    const el = closest(ev, TILE);
    if (el === hoverEl) return;
    hoverEl = el;
    if (!el) return;
    const t = performance.now();
    if (t - lastHover < HOVER_GAP) return;
    lastHover = t;
    play('hover');
  }, { passive: true });
  return { play };
}
