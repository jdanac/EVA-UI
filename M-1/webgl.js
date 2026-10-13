/* =========================================================
   NGE MAGI DELIBERATION STUDY: WEBGL BACKDROP
   A single fullscreen fragment shader drawn on a canvas behind the DOM. It
   draws a hex grid that lights up around busy computers, and data lines from
   each plate to the MAGI core with pulses travelling along them.

   It only decorates. All text, state and meaning stay in the HTML, and this
   file never changes the page: it reads the attributes script.js already
   sets (data-status and data-vote on each plate) and draws from them. If WebGL is
   unavailable or the shader fails, the canvas is removed and the page looks
   as it did before.
   Read top to bottom: shader, setup, reading the page, drawing.
   ========================================================= */

// Wrapped in a function so its names do not clash with script.js, which shares
// the page's global scope (both declare stage and verdictBox).
(function () {

const VERTEX = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/* The shader works in stage pixels (the 1280x720 box, y down), so the numbers
   below are the same ones style.css uses. The three anchors are the centers of
   the vote stamps; CORE is the center of the MAGI hexagon. */
const FRAGMENT = `
precision highp float;

uniform vec2  u_res;        // drawing buffer size in pixels
uniform float u_scale;      // buffer pixels per stage pixel
uniform float u_time;       // seconds
uniform float u_motion;     // 1 normally, 0 for reduced motion
uniform vec3  u_status;     // per plate: 0 standby, 1 processing, 2 voted
uniform vec3  u_vote;       // per plate: +1 approve, -1 deny, 0 none
uniform vec3  u_age;        // per plate: seconds since its status last changed

const vec3  TEAL = vec3(0.498, 0.941, 0.847);
const vec3  RED  = vec3(1.0, 0.231, 0.122);
const vec2  CORE = vec2(719.0, 380.0);
const float CELL = 36.0;    // hex grid size in stage pixels

// Plates are ordered as in the HTML: Balthasar, Casper, Melchior
vec2 anchor(int i) {
  if (i == 0) return vec2(720.0, 227.0);
  if (i == 1) return vec2(557.0, 475.0);
  return vec2(882.0, 475.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Distance from p to the segment a-b, and how far along it p projects (0 to 1)
float seg(vec2 p, vec2 a, vec2 b, out float t) {
  vec2 pa = p - a, ba = b - a;
  t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}

// Hex grid: local position inside a cell (xy) and the cell id (zw)
vec4 hexCell(vec2 uv) {
  const vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return vec4(gv, uv - gv);
}
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_scale;
  vec3 col = vec3(0.0);

  // How busy the area is: a soft blob around every plate that is processing
  float act = 0.0;
  for (int i = 0; i < 3; i++) {
    float d = length(p - anchor(i));
    act += (u_status[i] == 1.0 ? 1.0 : 0.0) * exp(-d * d / (2.0 * 140.0 * 140.0));
  }
  act = min(act, 1.4);

  // Hex grid. Faint everywhere, brighter and sparkling where it is busy.
  vec4 hc = hexCell(p / CELL);
  float edge = 0.5 - hexDist(hc.xy);
  float aa = 1.0 / (CELL * u_scale);
  float line = 1.0 - smoothstep(0.014, 0.014 + aa * 1.2, edge);
  float spark = step(0.93, hash(hc.zw + floor(u_time * 3.0) * 0.37)) * u_motion;
  col += TEAL * line * (0.07 + 0.30 * act);
  col += TEAL * spark * act * 0.12;

  // A data line from each plate to the core, and the glow inside each plate
  for (int i = 0; i < 3; i++) {
    vec2 A = anchor(i);
    vec2 B = CORE + normalize(A - CORE) * 70.0;
    float t;
    float d = seg(p, A, B, t);

    float status = u_status[i];
    float vote = u_vote[i];
    float age = u_age[i];
    vec3 c = vote < 0.0 ? RED : TEAL;

    float level = status == 2.0 ? 0.7 : (status == 1.0 ? 0.45 : 0.2);
    float body = (1.0 - smoothstep(0.8, 1.8, d)) + exp(-d / 6.0) * 0.35;

    // Packets stream toward the core while this plate is processing
    float packet = status == 1.0 ? smoothstep(0.55, 1.0, fract(t * 2.5 - u_time * 0.8 * u_motion)) : 0.0;
    // One flash runs down the line the moment the plate votes
    float wave = (status == 2.0 && age < 0.8) ? exp(-abs(t - age * 1.5) * 12.0) : 0.0;

    col += c * body * (level + packet * 0.9 + wave * 1.0);

    // Glow inside the plate itself
    float dp = length(p - A);
    float soft = exp(-dp * dp / (2.0 * 75.0 * 75.0));
    float pulse = 0.08 + 0.06 * sin(u_time * 6.0 + float(i) * 2.0) * u_motion;
    col += TEAL * soft * (status == 1.0 ? pulse : 0.0);
    col += c * soft * (status == 2.0 ? 0.04 + 0.28 * exp(-age * 2.5) : 0.0);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;


/* ---------- SETUP ----------
   The canvas is made here, not written in the HTML, so a page without script
   or without WebGL has nothing extra in it. */
const stage = document.querySelector('.screen');
const plates = [...document.querySelectorAll('.node')];   // Balthasar, Casper, Melchior
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const canvas = document.createElement('canvas');
canvas.className = 'fx';
canvas.setAttribute('aria-hidden', 'true');
stage.prepend(canvas);

const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
const program = gl && build(gl, VERTEX, FRAGMENT);

if (!program) {
  canvas.remove();               // fall back to the plain page
} else {
  start(gl, program);
}

function build(gl, vertexSource, fragmentSource) {
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, vertexSource);
  const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn(gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

function start(gl, prog) {
  gl.useProgram(prog);

  // One rectangle covering the whole canvas: two triangles
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = {};
  ['u_res', 'u_scale', 'u_time', 'u_motion', 'u_status', 'u_vote', 'u_age']
    .forEach(name => { u[name] = gl.getUniformLocation(prog, name); });


  /* ---------- READING THE PAGE ----------
     The shader wants to know how long ago each thing changed, which the page
     does not record, so this notices changes and keeps the timestamps. */
  const STATUS = { standby: 0, processing: 1, voted: 2 };
  const VOTE = { approve: 1, deny: -1 };

  let lastStatus = [];
  let since = [];           // when each plate's status last changed

  function read(now) {
    const status = [], vote = [], age = [];
    plates.forEach((el, i) => {
      if (el.dataset.status !== lastStatus[i]) {
        lastStatus[i] = el.dataset.status;
        since[i] = now;
      }
      status.push(STATUS[el.dataset.status] || 0);
      vote.push(VOTE[el.dataset.vote] || 0);
      age.push(now - since[i]);
    });

    return { status, vote, age };
  }


  /* ---------- DRAWING ----------
     The canvas is 1280x720 in stage pixels, which style.css zooms along with
     the rest of the stage. The drawing buffer is sized to what is actually on
     screen (stage scale times pixel density, capped at 2) so it stays sharp
     without wasting work. */
  function resize() {
    const scale = parseFloat(document.documentElement.style.getPropertyValue('--scale')) || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(1280 * scale * dpr));
    const h = Math.max(1, Math.round(720 * scale * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  const t0 = performance.now();
  let frame = 0;

  function draw() {
    const moving = !reduceMotion.matches;
    const now = (performance.now() - t0) / 1000;
    const s = read(now);
    resize();

    gl.uniform2f(u.u_res, canvas.width, canvas.height);
    gl.uniform1f(u.u_scale, canvas.width / 1280);
    gl.uniform1f(u.u_time, moving ? now : 0);
    gl.uniform1f(u.u_motion, moving ? 1 : 0);
    gl.uniform3fv(u.u_status, s.status);
    gl.uniform3fv(u.u_vote, s.vote);
    gl.uniform3fv(u.u_age, s.age);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function loop() {
    draw();
    frame = requestAnimationFrame(loop);
  }

  // Run the loop only while it is seen. Under reduced motion nothing animates, so
  // draw once and again whenever the page changes, instead of every frame.
  const changes = new MutationObserver(() => { if (reduceMotion.matches) draw(); });
  changes.observe(stage, { attributes: true, subtree: true, attributeFilter: ['data-status', 'data-vote'] });

  function run() {
    cancelAnimationFrame(frame);
    if (reduceMotion.matches || document.hidden) draw();
    else frame = requestAnimationFrame(loop);
  }
  reduceMotion.addEventListener('change', run);
  document.addEventListener('visibilitychange', run);
  window.addEventListener('resize', () => { resize(); if (reduceMotion.matches) draw(); });

  run();
}

})();
