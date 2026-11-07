/* map3d — the map as a floor of points, with a pillar on each place. WebGL 1, written here (nothing fetched, no library, the page's CSP is enough).
 *
 *   webglAvailable()                 -> boolean
 *   createMap3d(host, { onPress, onFrame, onSlow, calm }) -> { enter(cam, ground), leave(), setData({ marks, focus, tint }), project(lat, lon, top),
 *                                                               camera(), rotate(rad), zoom(k), active() }
 *     cam     { lon, lat, span }: where the flat map is looking; the floor starts level with it and tips back, so that the two are one place
 *     ground  map.sample(w, h): land and relief, the same ground as the flat map
 *     marks   (pxPerDegree) -> [{ key, name, lat, lon, n, m }]: folded at the scale on the screen by the flat map's own rule (marksAt)
 *     tint    null, or (lon, lat) -> 0..1, the theme's colouring of the floor
 *
 * A pillar's height is in proportion to the number of articles at the place, the heaviest in sight the full height; the top third of the pillars
 * red, the others orange. Same equirectangular degrees as the flat map; longitudes wrap in the vertex shader, so there is no edge of the world.
 * Frames are drawn only when something changes. A machine that cannot keep up drops the finer floor, then the floor gets coarser, then
 * onSlow says to leave (js/mapui.js goes back to the flat map and does not offer this again in this browser). */

const FOV = 0.62, PITCH = 1.02;
const INTRO_MS = 900, GLIDE_MS = 85;
const REGION_MAX = 70;             // a finer floor round the view below this span
const SLOW_MS = 72, STOP_MS = 150; // the mean frame that drops a level, and the one that gives up
const wrap = (d) => ((d + 540) % 360 + 360) % 360 - 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function webglAvailable() {
  try {
    if (typeof document !== 'object') return false;
    const c = document.createElement('canvas'), gl = c.getContext('webgl');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch { return false; }
}

/** the camera: position and basis for a floor seen from pitch (0 = straight down) and yaw */
export function cameraOf(cam, W, H) {
  const asp = W / H, d = cam.span / 2 / Math.tan(FOV / 2) / asp;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const eye = [d * sp * sy, d * cp, d * sp * cy], f = [-sp * sy, -cp, -sp * cy], r = [cy, 0, -sy];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const V = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1];
  const n = d * 0.05, far = d * 9, t = 1 / Math.tan(FOV / 2);
  const P = [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + n) / (n - far), -1, 0, 0, (2 * far * n) / (n - far), 0];
  const M = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let i = 0; i < 4; i++) { let s = 0; for (let k = 0; k < 4; k++) s += P[i + k * 4] * V[k + c * 4]; M[i + c * 4] = s; }
  return { M, eye, f, r, u, d, asp, far };
}
/** a point on the floor (dl = degrees east of the centre, z = degrees south of it, h = height) -> css px, or null behind the camera */
export function toScreen(C, dl, h, z, W, H) {
  const m = C.M, x = m[0] * dl + m[4] * h + m[8] * z + m[12], y = m[1] * dl + m[5] * h + m[9] * z + m[13], w = m[3] * dl + m[7] * h + m[11] * z + m[15];
  if (w <= 0) return null;
  return [((x / w + 1) / 2) * W, ((1 - y / w) / 2) * H, w];
}
/** css px -> the point of the floor under it [dl, z], or null at the sky */
export function toGround(C, x, y, W, H) {
  const nx = (x / W) * 2 - 1, ny = 1 - (y / H) * 2, t = Math.tan(FOV / 2);
  const d = [0, 1, 2].map((i) => C.f[i] + C.r[i] * nx * t * C.asp + C.u[i] * ny * t);
  if (d[1] >= -1e-4) return null;
  const k = -C.eye[1] / d[1];
  return [C.eye[0] + d[0] * k, C.eye[2] + d[2] * k];
}

const VS_POINT = `attribute vec2 a_ll; attribute vec2 a_hb; attribute float a_t;
uniform mat4 u_m; uniform vec2 u_c; uniform float u_hs, u_size, u_far, u_a, u_theme;
varying vec3 v_c;
void main() {
  float dl = mod(a_ll.x - u_c.x + 180.0, 360.0) - 180.0;
  vec4 q = u_m * vec4(dl, a_hb.x * u_hs, u_c.y - a_ll.y, 1.0);
  gl_Position = q;
  gl_PointSize = clamp(u_size / q.w, 1.0, 16.0);
  float b = a_hb.y;
  vec3 c = b < 0.0 ? vec3(0.03, 0.10, 0.20) : mix(vec3(0.05, 0.27, 0.62), vec3(0.42, 0.86, 1.0), min(b, 1.0));
  if (b > 1.0) c = mix(c, vec3(1.0), b - 1.0);
  if (u_theme > 0.5) c = a_t > 0.0 ? mix(vec3(0.16, 0.62, 0.92), vec3(0.95, 1.0, 1.0), a_t) : c * (b < 0.0 ? 0.8 : 0.34);
  v_c = c * u_a * smoothstep(u_far, u_far * 0.4, q.w);
}`;
const FS_POINT = `precision mediump float; varying vec3 v_c; void main() { gl_FragColor = vec4(v_c, 1.0); }`;
const VS_PILLAR = `attribute vec2 a_ll; attribute vec3 a_o; attribute float a_h; attribute vec3 a_col; attribute float a_s;
uniform mat4 u_m; uniform vec2 u_c; uniform float u_w, u_seg;
varying vec3 v_col; varying float v_y; varying float v_s;
void main() {
  float dl = mod(a_ll.x - u_c.x + 180.0, 360.0) - 180.0;
  float h = a_o.y * a_h;
  gl_Position = u_m * vec4(dl + a_o.x * u_w, h, u_c.y - a_ll.y + a_o.z * u_w, 1.0);
  v_col = a_col; v_y = h / u_seg; v_s = a_s;
}`;
const FS_PILLAR = `precision mediump float; varying vec3 v_col; varying float v_y; varying float v_s;
void main() { float k = step(0.26, fract(v_y)); gl_FragColor = vec4(v_col * v_s * (0.62 + 0.38 * k), 0.62 + 0.38 * k); }`;
const VS_GLOW = `attribute vec2 a_ll; attribute float a_r; attribute vec3 a_col; attribute float a_k;
uniform mat4 u_m; uniform vec2 u_c; uniform float u_px;
varying vec3 v_col; varying float v_k;
void main() {
  float dl = mod(a_ll.x - u_c.x + 180.0, 360.0) - 180.0;
  vec4 q = u_m * vec4(dl, 0.0, u_c.y - a_ll.y, 1.0);
  gl_Position = q; gl_PointSize = clamp(a_r * u_px / q.w, 2.0, 180.0); v_col = a_col; v_k = a_k;
}`;
const FS_GLOW = `precision mediump float; varying vec3 v_col; varying float v_k;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float a = v_k > 0.5 ? smoothstep(0.78, 0.86, r) * smoothstep(1.0, 0.92, r) : exp(-r * r * 3.6) * (1.0 - r);
  gl_FragColor = vec4(v_col * a, 1.0);
}`;

const BOX = (() => {
  // the faces of a pillar: x, y (0 base, 1 top), z, and a shade; four sides and the top
  const q = (a, b, c, d, s) => [...a, s, ...b, s, ...c, s, ...a, s, ...c, s, ...d, s];
  const p = (x, y, z) => [x, y, z];
  return [
    ...q(p(-1, 0, 1), p(1, 0, 1), p(1, 1, 1), p(-1, 1, 1), 1.0), ...q(p(1, 0, 1), p(1, 0, -1), p(1, 1, -1), p(1, 1, 1), 0.72),
    ...q(p(1, 0, -1), p(-1, 0, -1), p(-1, 1, -1), p(1, 1, -1), 0.6), ...q(p(-1, 0, -1), p(-1, 0, 1), p(-1, 1, 1), p(-1, 1, -1), 0.78),
    ...q(p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), 1.5),
  ];
})();
const RED = [1.0, 0.27, 0.2], ORANGE = [1.0, 0.56, 0.16];

export function createMap3d(host, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'm3-gl'; canvas.setAttribute('aria-label', '地図の立体表示。柱の高さが記事の数です'); canvas.setAttribute('role', 'img');
  const tagsEl = document.createElement('div'); tagsEl.className = 'm3-tags';
  host.append(canvas, tagsEl);
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'low-power' });
  if (!gl) return null;

  const compile = (vs, fs) => {
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const a = {}, u = {};
    for (let i = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES) - 1; i >= 0; i--) { const n = gl.getActiveAttrib(p, i).name; a[n] = gl.getAttribLocation(p, n); }
    for (let i = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) - 1; i >= 0; i--) { const n = gl.getActiveUniform(p, i).name; u[n] = gl.getUniformLocation(p, n); }
    return { p, a, u };
  };
  const Pp = compile(VS_POINT, FS_POINT), Pb = compile(VS_PILLAR, FS_PILLAR), Pg = compile(VS_GLOW, FS_GLOW);
  const bufBox = gl.createBuffer(), bufGlow = gl.createBuffer();

  let W = 1, H = 1, dpr = 1, on = false, raf = 0, ground = null, marksFn = null, focus = null, tintFn = null, tintVer = 0;
  let intro = null, glide = null, spin = null, lastMove = 0, level = 0, lost = false;
  const cam = { lon: 135, lat: 30, span: 120, yaw: 0, pitch: PITCH };
  const pillars = new Map();
  const grids = [];
  const perf = { frames: 0, sum: 0, last: 0 };
  const calm = () => !!(opts.calm && opts.calm());
  let tags = new Map();

  function size() {
    const r = host.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    gl.viewport(0, 0, cw, ch);
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (on) { size(); wake(); } }) : null;
  if (ro) ro.observe(host);

  // ---------------------------------------------------------------- the floor
  function makeGrid(lon0, lon1, lat0, lat1, cell, kind) {
    const G = ground, cols = Math.max(1, Math.round((lon1 - lon0) / cell)), rows = Math.max(1, Math.round((lat1 - lat0) / cell));
    const out = new Float32Array(cols * rows * 4), tintPts = [];
    let n = 0;
    const at = (lon, lat) => {
      const ix = Math.floor((((wrap(lon) + 180) / 360) * G.w)) % G.w, iy = clamp(Math.floor(((90 - lat) / 180) * G.h), 0, G.h - 1);
      return iy * G.w + ix;
    };
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const lon = lon0 + (i + 0.5) * cell, lat = lat0 + (j + 0.5) * cell, px = at(lon, lat);
      if (!G.land[px]) {
        if ((i + j) % 2) continue;       // the sea is a sparser mat of the same squares
        out[n++] = lon; out[n++] = lat; out[n++] = 0; out[n++] = -1;
        continue;
      }
      const rel = G.relief[px];
      let b = 0.2 + 0.8 * clamp((rel - 96) / 70, 0, 1);
      if (!G.land[at(lon + cell, lat)] || !G.land[at(lon - cell, lat)] || !G.land[at(lon, lat + cell)] || !G.land[at(lon, lat - cell)]) b = Math.min(1, b + 0.42);   // the coast
      if (kind === 'world') { const a = Math.round(lon), c = Math.round(lat); if (a % 30 === 0 || c % 30 === 0) b = Math.min(1, b + 0.2); }
      const sp = Math.sin(lon * 12.9898 + lat * 78.233) * 43758.5453;
      if (sp - Math.floor(sp) > 0.985) b = 1.6;   // a few bright grains
      out[n++] = lon; out[n++] = lat; out[n++] = clamp((rel - 128) / 80, -0.3, 1); out[n++] = b;
    }
    const data = out.subarray(0, n), count = n / 4, buf = gl.createBuffer(), tint = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { kind, buf, tint, n: count, data, cell, a: 0, target: 1, lon: (lon0 + lon1) / 2, lat: (lat0 + lat1) / 2, span: lon1 - lon0, tintVer: -1, tintPts };
  }
  function freeGrid(g) { gl.deleteBuffer(g.buf); gl.deleteBuffer(g.tint); }
  function tintGrid(g) {
    if (g.tintVer === tintVer) return;
    g.tintVer = tintVer;
    const t = new Float32Array(g.n);
    if (tintFn) for (let i = 0; i < g.n; i++) { if (g.data[i * 4 + 3] < 0) continue; t[i] = tintFn(wrap(g.data[i * 4]), g.data[i * 4 + 1]) || 0; }
    gl.bindBuffer(gl.ARRAY_BUFFER, g.tint); gl.bufferData(gl.ARRAY_BUFFER, t, gl.STATIC_DRAW);
  }
  function worldGrid() {
    const cell = level >= 2 ? 3 : level === 1 ? 1.5 : 1;
    const old = grids.find((g) => g.kind === 'world');
    if (old && old.cell === cell) return;
    if (old) old.target = 0;
    const g = makeGrid(-180, 180, -58, 84, cell, 'world');
    g.a = old ? 0 : 1; g.target = 1;
    grids.push(g);
  }
  function regionGrid(now) {
    const live = grids.find((g) => g.kind === 'region' && g.target > 0);
    if (level >= 1 || cam.span > REGION_MAX) { if (live) live.target = 0; return; }
    if (now - lastMove < 180) return;
    if (live && Math.abs(Math.log(cam.span / live.span * 1.8)) < 0.42 && Math.abs(wrap(cam.lon - live.lon)) < live.span * 0.22 && Math.abs(cam.lat - live.lat) < live.span * 0.22) return;
    if (live) live.target = 0;
    const w = cam.span * 1.8, cell = Math.max(360 / ground.w, cam.span / 150);
    grids.push(makeGrid(cam.lon - w / 2, cam.lon + w / 2, clamp(cam.lat - w * 0.46, -84, 84), clamp(cam.lat + w * 0.46, -84, 84), cell, 'region'));
  }

  // ---------------------------------------------------------------- the pillars
  const pxPerDegree = () => W / cam.span;
  function refreshMarks() {
    const list = marksFn ? marksFn(pxPerDegree()) : [];
    // the heaviest pillar in sight is the full height, so that a heavier one out of sight does not flatten the rest; a move changes it, gently
    const sight = list.filter((m) => Math.abs(wrap(m.lon - cam.lon)) < cam.span * 0.72 && Math.abs(m.lat - cam.lat) < cam.span * 0.62);
    const top = Math.max(1, ...(sight.length ? sight : list).map((m) => m.n));
    const order = [...list].sort((a, b) => b.n - a.n), hotN = Math.ceil(order.length / 3), hot = new Set(order.slice(0, hotN).map((m) => m.key));
    const seen = new Set();
    for (const m of list) {
      seen.add(m.key);
      let p = pillars.get(m.key);
      if (!p) { p = { key: m.key, h: 0 }; pillars.set(m.key, p); }
      p.name = m.name; p.lat = m.lat; p.lon = m.lon; p.n = m.n; p.m = m; p.hot = hot.has(m.key);
      p.target = Math.min(1, Math.max(0.04, m.n / top));
    }
    for (const [k, p] of pillars) if (!seen.has(k)) { p.target = 0; if (p.h < 0.004) pillars.delete(k); }
  }
  const HMAX = () => cam.span * 0.25 * Math.min(1, W / H / 1.1);   // a narrow view has less height to stand in
  const WID = () => Math.max(cam.span * 0.0048, 0.02);

  function draw(C) {
    gl.clearColor(0.012, 0.024, 0.043, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    const ppu = (canvas.height / 2) / Math.tan(FOV / 2);
    // the floor
    gl.useProgram(Pp.p);
    gl.uniformMatrix4fv(Pp.u.u_m, false, C.M); gl.uniform2f(Pp.u.u_c, cam.lon, cam.lat); gl.uniform1f(Pp.u.u_far, C.d * 3.4);
    gl.uniform1f(Pp.u.u_theme, tintFn ? 1 : 0);
    const region = grids.some((g) => g.kind === 'region' && g.a > 0.5);
    for (const g of grids) {
      tintGrid(g);
      const worldDim = g.kind === 'world' && region ? 0.3 : 1;
      gl.uniform1f(Pp.u.u_a, g.a * worldDim);
      gl.uniform1f(Pp.u.u_hs, cam.span * 0.016);
      gl.uniform1f(Pp.u.u_size, g.cell * 0.62 * ppu);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
      gl.enableVertexAttribArray(Pp.a.a_ll); gl.vertexAttribPointer(Pp.a.a_ll, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(Pp.a.a_hb); gl.vertexAttribPointer(Pp.a.a_hb, 2, gl.FLOAT, false, 16, 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.tint);
      gl.enableVertexAttribArray(Pp.a.a_t); gl.vertexAttribPointer(Pp.a.a_t, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, g.n);
    }
    gl.disableVertexAttribArray(Pp.a.a_t); gl.disableVertexAttribArray(Pp.a.a_hb);
    // the glow under the pillars, and a ring on the event in focus
    const ps = [...pillars.values()].filter((p) => p.h > 0.002);
    const gl2 = new Float32Array((ps.length + (focus ? 1 : 0)) * 7);
    let n = 0;
    const glowR = cam.span * 0.036;
    for (const p of ps) { const c = p.hot ? RED : ORANGE; gl2.set([p.lon, p.lat, glowR * (0.6 + 0.9 * Math.sqrt(p.h)), c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 0], n); n += 7; }
    if (focus) { gl2.set([focus.lon, focus.lat, cam.span * 0.03, 0.55, 0.93, 1, 1], n); n += 7; }
    if (n) {
      gl.useProgram(Pg.p);
      gl.uniformMatrix4fv(Pg.u.u_m, false, C.M); gl.uniform2f(Pg.u.u_c, cam.lon, cam.lat); gl.uniform1f(Pg.u.u_px, ppu);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufGlow); gl.bufferData(gl.ARRAY_BUFFER, gl2, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(Pg.a.a_ll); gl.vertexAttribPointer(Pg.a.a_ll, 2, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(Pg.a.a_r); gl.vertexAttribPointer(Pg.a.a_r, 1, gl.FLOAT, false, 28, 8);
      gl.enableVertexAttribArray(Pg.a.a_col); gl.vertexAttribPointer(Pg.a.a_col, 3, gl.FLOAT, false, 28, 12);
      gl.enableVertexAttribArray(Pg.a.a_k); gl.vertexAttribPointer(Pg.a.a_k, 1, gl.FLOAT, false, 28, 24);
      gl.drawArrays(gl.POINTS, 0, n / 7);
      for (const k of ['a_r', 'a_col', 'a_k']) gl.disableVertexAttribArray(Pg.a[k]);
    }
    // the pillars, the far ones first
    if (ps.length) {
      const depth = (p) => C.f[0] * wrap(p.lon - cam.lon) + C.f[2] * (cam.lat - p.lat);
      ps.sort((a, b) => depth(b) - depth(a));
      const nv = BOX.length / 4, data = new Float32Array(ps.length * nv * 10), H0 = HMAX();
      let i = 0;
      for (const p of ps) {
        const c = p.hot ? RED : ORANGE, h = p.h * H0;
        for (let v = 0; v < nv; v++) {
          data[i++] = p.lon; data[i++] = p.lat;
          data[i++] = BOX[v * 4]; data[i++] = BOX[v * 4 + 1]; data[i++] = BOX[v * 4 + 2];
          data[i++] = h; data[i++] = c[0]; data[i++] = c[1]; data[i++] = c[2]; data[i++] = BOX[v * 4 + 3];
        }
      }
      gl.useProgram(Pb.p);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniformMatrix4fv(Pb.u.u_m, false, C.M); gl.uniform2f(Pb.u.u_c, cam.lon, cam.lat); gl.uniform1f(Pb.u.u_w, WID()); gl.uniform1f(Pb.u.u_seg, cam.span * 0.011);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufBox); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      const S = 40;
      gl.enableVertexAttribArray(Pb.a.a_ll); gl.vertexAttribPointer(Pb.a.a_ll, 2, gl.FLOAT, false, S, 0);
      gl.enableVertexAttribArray(Pb.a.a_o); gl.vertexAttribPointer(Pb.a.a_o, 3, gl.FLOAT, false, S, 8);
      gl.enableVertexAttribArray(Pb.a.a_h); gl.vertexAttribPointer(Pb.a.a_h, 1, gl.FLOAT, false, S, 20);
      gl.enableVertexAttribArray(Pb.a.a_col); gl.vertexAttribPointer(Pb.a.a_col, 3, gl.FLOAT, false, S, 24);
      gl.enableVertexAttribArray(Pb.a.a_s); gl.vertexAttribPointer(Pb.a.a_s, 1, gl.FLOAT, false, S, 36);
      gl.drawArrays(gl.TRIANGLES, 0, ps.length * nv);
      for (const k of ['a_o', 'a_h', 'a_col', 'a_s']) gl.disableVertexAttribArray(Pb.a[k]);
    }
    gl.disableVertexAttribArray(0);
  }

  // ---------------------------------------------------------------- the tags over the heaviest pillars: a red head with the place and its number
  function layoutTags(C) {
    const list = [...pillars.values()].filter((p) => p.target > 0).sort((a, b) => b.n - a.n).slice(0, Math.max(5, Math.min(14, Math.round(W / 70))));
    const keep = new Set(list.map((p) => p.key));
    for (const [k, el] of tags) if (!keep.has(k)) { el.remove(); tags.delete(k); }
    const taken = opts.avoid ? [opts.avoid()].filter(Boolean) : [], H0 = HMAX();
    for (const p of list) {
      let el = tags.get(p.key);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button'; el.className = 'm3-tag';
        el.append(document.createElement('b'), document.createElement('span'));
        el.addEventListener('click', () => { const q = pillars.get(p.key); if (q && opts.onPress) opts.onPress({ kind: 'pillar', m: q.m, lat: q.lat, lon: q.lon }); });
        tagsEl.append(el); tags.set(p.key, el);
      }
      if (el.firstChild.textContent !== p.name) el.firstChild.textContent = p.name;
      if (el.lastChild.textContent !== String(p.n)) { el.lastChild.textContent = String(p.n); }
      el.setAttribute('aria-label', `${p.name} ${p.n} 本の記事`);
      el.dataset.hot = p.hot ? '1' : '0';
      const s = toScreen(C, wrap(p.lon - cam.lon), p.h * H0, cam.lat - p.lat, W, H);
      const w = el.offsetWidth || 70, h = el.offsetHeight || 22;
      const x = s ? s[0] - w / 2 : -999, y = s ? Math.max(96, s[1] - h - 12) : -999;    // the top of a tall pillar may leave the view: its name stays in it
      const out = !s || x < 2 || x + w > W - 2 || y + h > H - 4 || p.h < 0.02;
      const hit = out || taken.some((o) => x < o[2] + 3 && x + w > o[0] - 3 && y < o[3] + 2 && y + h > o[1] - 2);
      el.style.visibility = hit ? 'hidden' : '';
      if (!hit) { taken.push([x, y, x + w, y + h]); el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`; }
    }
  }

  // ---------------------------------------------------------------- the frame
  function wake() { if (on && !raf) raf = requestAnimationFrame(step); }
  let last = 0;
  function step(now) {
    raf = 0;
    if (!on || lost) return;
    const dt = Math.min(80, Math.max(1, now - last));
    const gap = now - last;
    last = now;
    let more = false;
    if (intro) {
      const k = calm() ? 1 : Math.min(1, (now - intro.t0) / INTRO_MS), e = ease(k);
      cam.pitch = intro.from + (PITCH - intro.from) * e;
      cam.span = intro.s0 * Math.pow(intro.s1 / intro.s0, e);
      if (k >= 1) { intro = null; refreshMarks(); } else more = true;
    }
    if (glide) {
      const r = Math.log(glide.span / cam.span);
      const span = Math.abs(r) < 0.003 ? glide.span : cam.span * Math.exp(r * (1 - Math.exp(-dt / GLIDE_MS)));
      const q = span / cam.span;
      cam.lon = wrap(glide.lon + wrap(cam.lon - glide.lon) * q); cam.lat = glide.lat + (cam.lat - glide.lat) * q;
      cam.span = span; lastMove = now;
      if (span === glide.span) glide = null; else more = true;
      refreshMarks();
    }
    if (spin) {
      const r = spin.yaw - cam.yaw;
      if (Math.abs(r) < 0.002) { cam.yaw = spin.yaw; spin = null; } else { cam.yaw += r * (1 - Math.exp(-dt / 110)); more = true; }
      lastMove = now;
    }
    for (const [k, p] of pillars) {
      const r = (intro ? p.target * (1 - Math.pow(1 - (now - intro.t0) / INTRO_MS, 2)) : p.target) - p.h;
      if (Math.abs(r) < 0.002) { p.h = p.target; if (!p.target) pillars.delete(k); } else { p.h = calm() ? p.target : p.h + r * (1 - Math.exp(-dt / 110)); more = true; }
    }
    // the floor's layers come up and go
    if (!intro && ground) regionGrid(now);
    if (cam.span <= REGION_MAX && level === 0 && !grids.some((g) => g.kind === 'region' && g.target > 0)) more = true;
    for (let i = grids.length - 1; i >= 0; i--) {
      const g = grids[i], r = g.target - g.a;
      if (Math.abs(r) < 0.01) { g.a = g.target; if (!g.target) { freeGrid(g); grids.splice(i, 1); } } else { g.a = calm() ? g.target : g.a + r * (1 - Math.exp(-dt / 140)); more = true; }
    }
    const C = cameraOf(cam, W, H);
    draw(C);
    layoutTags(C);
    if (opts.onFrame) opts.onFrame();
    // a machine that cannot keep up: only frames that follow each other are counted
    if (more && gap < 400 && !document.hidden) {
      perf.frames++; perf.sum += gap;
      if (perf.frames >= 24) {
        const mean = perf.sum / perf.frames;
        perf.frames = 0; perf.sum = 0; perf.mean = Math.round(mean);
        if (mean > STOP_MS && level >= 1) { if (opts.onSlow) opts.onSlow(); return; }
        if (mean > SLOW_MS && level < 2) { level++; for (const g of grids) if (g.kind === 'region') g.target = 0; worldGrid(); more = true; }
      }
    }
    if (more) wake();
  }

  // ---------------------------------------------------------------- the hand
  const pts = new Map();
  let press = null;
  const at = (ev) => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  const geoUnder = (C, x, y) => { const q = toGround(C, x, y, W, H); return q ? { lon: wrap(cam.lon + q[0]), lat: cam.lat - q[1] } : null; };
  function pickAt(x, y) {
    const C = cameraOf(cam, W, H), H0 = HMAX();
    let best = null, bd = 13;
    for (const p of pillars.values()) {
      if (p.target <= 0) continue;
      const dl = wrap(p.lon - cam.lon), z = cam.lat - p.lat, a = toScreen(C, dl, 0, z, W, H), b = toScreen(C, dl, p.h * H0, z, W, H);
      if (!a || !b) continue;
      const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy, t = L ? clamp(((x - a[0]) * vx + (y - a[1]) * vy) / L, 0, 1) : 0, d = Math.hypot(x - a[0] - vx * t, y - a[1] - vy * t);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  canvas.addEventListener('pointerdown', (ev) => {
    const [x, y] = at(ev);
    pts.set(ev.pointerId, { x, y });
    glide = null; spin = null;
    press = { x, y, moved: false, turn: ev.shiftKey || ev.button === 2 };
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* */ }
  });
  canvas.addEventListener('pointermove', (ev) => {
    const [x, y] = at(ev), q = pts.get(ev.pointerId);
    if (!q) { canvas.style.cursor = pickAt(x, y) ? 'pointer' : 'grab'; return; }
    if (pts.size === 2) {
      // two fingers: the distance is the zoom, the turn of the line between them the yaw
      const [o] = [...pts.entries()].filter(([k]) => k !== ev.pointerId).map(([, v]) => v);
      const d0 = Math.hypot(q.x - o.x, q.y - o.y), d1 = Math.hypot(x - o.x, y - o.y);
      if (d0 > 8 && d1 > 8) cam.span = clamp(cam.span * (d0 / d1), 5, 330);
      cam.yaw += Math.atan2(y - o.y, x - o.x) - Math.atan2(q.y - o.y, q.x - o.x);
      press = null; refreshMarks();
    } else if (press) {
      if (!press.moved && Math.hypot(x - press.x, y - press.y) < 5) return;
      press.moved = true;
      if (press.turn) {
        cam.yaw += (x - q.x) * 0.006; cam.pitch = clamp(cam.pitch + (y - q.y) * 0.004, 0.3, 1.28);
      } else {
        const C = cameraOf(cam, W, H), a = toGround(C, q.x, q.y, W, H), b = toGround(C, x, y, W, H);
        if (a && b) { cam.lon = wrap(cam.lon + a[0] - b[0]); cam.lat = clamp(cam.lat - (a[1] - b[1]), -60, 78); }
      }
    }
    q.x = x; q.y = y; lastMove = performance.now();
    wake();
  });
  let refreshT = 0;
  const refreshSoon = () => { clearTimeout(refreshT); refreshT = setTimeout(() => { if (on) { refreshMarks(); wake(); } }, 120); };
  const up = (ev) => {
    const was = press;
    pts.delete(ev.pointerId);
    if (pts.size === 0) press = null;
    if (!was || was.moved || ev.type === 'pointercancel') { refreshSoon(); wake(); return; }
    const [x, y] = at(ev), p = pickAt(x, y);
    if (!opts.onPress) return;
    if (p) opts.onPress({ kind: 'pillar', m: p.m, lat: p.lat, lon: p.lon });
    else { const g = geoUnder(cameraOf(cam, W, H), x, y); opts.onPress(g ? { kind: 'ground', ...g } : { kind: 'none' }); }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    const [x, y] = at(ev), g = geoUnder(cameraOf(cam, W, H), x, y) || { lon: cam.lon, lat: cam.lat };
    const span = clamp((glide ? glide.span : cam.span) * Math.pow(1.0018, ev.deltaY), 5, 330);
    if (calm()) { cam.span = span; refreshMarks(); lastMove = performance.now(); wake(); return; }
    glide = { span, lon: g.lon, lat: g.lat };
    wake();
  }, { passive: false });
  canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); lost = true; if (opts.onSlow) opts.onSlow(); });

  return {
    enter(c0, sample) {
      ground = sample;
      Object.assign(cam, { lon: c0.lon, lat: clamp(c0.lat, -60, 78), span: clamp(c0.span, 5, 330), yaw: 0 });
      host.hidden = false;
      on = true; lost = false; level = 0; perf.frames = 0; perf.sum = 0;
      size();
      if (!grids.length) worldGrid();
      const s1 = clamp(cam.span * 0.72, 5, 110);
      intro = calm() ? null : { t0: performance.now(), from: 0.04, s0: cam.span, s1 };
      cam.pitch = intro ? intro.from : PITCH;
      if (!intro) cam.span = s1;
      refreshMarks();
      last = performance.now();
      wake();
    },
    leave() { on = false; if (raf) cancelAnimationFrame(raf); raf = 0; intro = null; glide = null; spin = null; host.hidden = true; pts.clear(); press = null; },
    /** marks: (px per degree) -> marks; focus: { lat, lon } | null; tint: (lon, lat) -> 0..1 | null, tintKey says when it changed */
    setData(d) {
      if ('marks' in d) marksFn = d.marks;
      if ('focus' in d) focus = d.focus;
      if ('tint' in d && d.tintKey !== tintKeyNow) { tintFn = d.tint; tintVer++; tintKeyNow = d.tintKey; }
      if (on) { refreshMarks(); wake(); }
    },
    project(lat, lon, top) {
      const C = cameraOf(cam, W, H), p = pillars.get(top), s = toScreen(C, wrap(lon - cam.lon), p ? p.h * HMAX() : 0, cam.lat - lat, W, H);
      return s ? [s[0], s[1]] : null;
    },
    camera: () => ({ lon: cam.lon, lat: cam.lat, span: cam.span }),
    rotate(rad) { spin = { yaw: (spin ? spin.yaw : cam.yaw) + rad }; lastMove = performance.now(); wake(); },
    zoom(k) { const c = { lon: cam.lon, lat: cam.lat }; glide = { span: clamp((glide ? glide.span : cam.span) / k, 5, 330), ...c }; wake(); },
    flyTo(lat, lon, span) { glide = { span: clamp(span, 5, 330), lon, lat }; wake(); },
    active: () => on,
    stats: () => ({ theme: !!tintFn, tintVer, level, grids: grids.map((g) => [g.kind, g.n, +g.a.toFixed(2)]), pillars: pillars.size, mean: perf.mean || null, cam: { ...cam } }),
  };
}
let tintKeyNow = null;
