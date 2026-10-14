/* =========================================================
   G-1 RADAR DEFENSE: THE SCREEN
   Draws the two maps from the data baked by tools/geo.mjs, then shows what the
   rules in sim.js are doing: this file never decides anything about the game,
   it only reads the sim and writes shapes, text and attributes. CSS owns every
   color and line width (data-state, data-kind, data-selected and the rest).
   Read top to bottom: geography, drawing, the live layer, the list and panel,
   the loop, controls, fit, start up.
   ========================================================= */

const wideSvg = document.querySelector('#wide');
const wideLive = document.querySelector('#wide-live');
const scopeSvg = document.querySelector('#scope');
const scopeLive = document.querySelector('#scope-live');
const stage = document.querySelector('.screen');


/* ---------- GEOGRAPHY ----------
   The sim works in kilometers from the city; the baked data is longitude and
   latitude. At this size (about 50 km) a flat conversion around the city is as
   good as any projection, and it means the sim and the map can never disagree
   about where something is. */
const CITY = { at: [139.04, 35.233], cell: 0.36 };   // cell: one city block, in km
const KM_PER_LON = 111.32 * Math.cos(CITY.at[1] * Math.PI / 180);
const KM_PER_LAT = 110.57;
const toKm = ([lon, lat]) => [(lon - CITY.at[0]) * KM_PER_LON, (lat - CITY.at[1]) * KM_PER_LAT];

// The sites around Tokyo-3, as in T-1. Drawn only; firing comes later.
const SITES = [
  { kind: 'battery', ja: '北部砲台',     at: [138.99, 35.248] },
  { kind: 'battery', ja: '南部砲台',     at: [139.065, 35.2] },
  { kind: 'battery', ja: '東部砲台',     at: [139.09, 35.212] },
  { kind: 'radar',   ja: '西部レーダー', at: [138.975, 35.232] },
];

// A view maps km to pixels: a square panel with the city in the middle that
// shows `radius` km out to its edge
function makeView(svg, radius) {
  const size = Number(svg.getAttribute('viewBox').split(' ')[2]);
  const half = size / 2, ppk = half / radius;       // ppk: pixels per km
  return { size, half, ppk, px: (x, y) => [half + x * ppk, half - y * ppk] };
}
const scope = makeView(scopeSvg, SIM.SCOPE_KM);
const wide = makeView(wideSvg, 56);                  // 40 km spawn ring plus margin


/* ---------- DRAWING ---------- */
const f = n => n.toFixed(1);
const ringPath = (view, ring) => 'M' + ring.map(p => {
  const [x, y] = toKm(p);
  const [px, py] = view.px(x, y);
  return `${f(px)} ${f(py)}`;
}).join('L') + 'Z';

// Hatched sea with the land on top
function terrain(view, geo) {
  const d = geo.land.map(r => ringPath(view, r)).join('');
  return `<rect class="sea" width="${view.size}" height="${view.size}"/><g class="glow"><path class="land" d="${d}"/></g>`;
}

// Range rings every 5 km, labeled up the north line, with the crosshair
function rings(view) {
  const c = view.half;
  let out = '';
  for (let km = 5; km < SIM.SCOPE_KM; km += 5) {
    const r = km * view.ppk;
    out += `<circle class="ring" cx="${c}" cy="${c}" r="${f(r)}"/><text class="ring__label" x="${c + 4}" y="${f(c - r - 3)}">${km} KM</text>`;
  }
  out += `<line class="axis" x1="${c}" y1="0" x2="${c}" y2="${view.size}"/><line class="axis" x1="0" y1="${c}" x2="${view.size}" y2="${c}"/>`;
  return `<g class="rings">${out}</g>`;
}

// The bezel: a tick every 10 degrees (longer every 30) with the bearing beside it
function bezel(view) {
  const c = view.half, r = c - 3;
  let ticks = '', labels = '';
  for (let deg = 0; deg < 360; deg += 10) {
    const major = deg % 30 === 0;
    const th = deg * Math.PI / 180, sin = Math.sin(th), cos = Math.cos(th);
    const len = major ? 12 : 6;
    ticks += `<line x1="${f(c + r * sin)}" y1="${f(c - r * cos)}" x2="${f(c + (r - len) * sin)}" y2="${f(c - (r - len) * cos)}"/>`;
    if (major) {
      const name = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg] || String(deg).padStart(3, '0');
      labels += `<text x="${f(c + (r - 22) * sin)}" y="${f(c - (r - 22) * cos)}" text-anchor="middle" dominant-baseline="central">${name}</text>`;
    }
  }
  return `<g class="bezel"><circle cx="${c}" cy="${c}" r="${r}"/><g class="bezel__ticks">${ticks}</g><g class="bezel__labels">${labels}</g></g>`;
}

// The sweep: a line turning clockwise with a fading wedge behind it. CSS turns
// the whole group; it is only for show and decides nothing.
function sweep(view) {
  const c = view.half, r = c - 3;
  const at = deg => `${f(c + r * Math.sin(deg * Math.PI / 180))} ${f(c - r * Math.cos(deg * Math.PI / 180))}`;
  let wedge = '';
  const slices = 16, width = 2.5;
  for (let i = 0; i < slices; i++) {
    wedge += `<path d="M${c} ${c}L${at(-(i + 1) * width)}A${r} ${r} 0 0 1 ${at(-i * width)}Z" opacity="${(0.2 * (1 - i / slices)).toFixed(3)}"/>`;
  }
  return `<g class="sweep">${wedge}<line x1="${c}" y1="${c}" x2="${c}" y2="${c - r}"/></g>`;
}

// Tokyo-3: blocks with a street between, a diamond in each, cut to an octagon
// that narrows toward the south. Hand drawn, not from data. It is built from
// the same block size T-1 uses but sized in km, so it stays inside the 2 km
// impact circle.
function city(view) {
  const [cx, cy] = view.px(0, 0);
  const c = CITY.cell * view.ppk, g = c * 0.06;
  const ground = [], blocks = [];
  for (let j = -5; j <= 5; j++) {
    for (let i = -5; i <= 5; i++) {
      const ai = Math.abs(i), aj = Math.abs(j);
      const half = j > 1 ? 4.4 - (j - 1) * 1.3 : 4.4;
      if (aj > 4 || ai > half || ai + aj > 6.4) continue;
      const x = cx + (i - 0.5) * c, y = cy + (j - 0.5) * c, s = c - 2 * g;
      ground.push(`M${f(x)} ${f(y)}h${f(c)}v${f(c)}h${f(-c)}Z`);
      blocks.push(`M${f(x + g)} ${f(y + g)}h${f(s)}v${f(s)}h${f(-s)}Z`);
    }
  }
  return `<g class="city"><path class="city__ground" d="${ground.join('')}"/><circle class="city__ring" cx="${f(cx)}" cy="${f(cy)}" r="${f(SIM.CITY_KM * view.ppk)}"/>`
    + `<g class="glow"><path d="${blocks.join('')}"/></g></g>`;
}

function sites(view) {
  return SITES.map(s => {
    const [x, y] = toKm(s.at);
    const [px, py] = view.px(x, y);
    const mark = s.kind === 'battery' ? '<path class="site__mark" d="M0 -6L6 0L0 6L-6 0Z"/>' : '<circle class="site__mark" r="4.5"/>';
    // The radar is west of the city, so its name goes on the far side from the city blocks
    const label = s.kind === 'radar' ? 'x="-9" y="3" text-anchor="end"' : 'x="9" y="3"';
    return `<g class="site" transform="translate(${f(px)} ${f(py)})">${mark}<text class="site__ja" ${label}>${s.ja}</text></g>`;
  }).join('');
}

function drawMaps() {
  // The scope is clipped to a circle: the sim says a contact is "on the scope"
  // at 24.5 km, so the map ends at the same distance in every direction
  const r = scope.half - 3;
  scopeSvg.innerHTML = `<defs><clipPath id="scope-clip"><circle cx="${scope.half}" cy="${scope.half}" r="${r}"/></clipPath></defs>`
    + `<g clip-path="url(#scope-clip)">${terrain(scope, GEO['sagami-land'])}${rings(scope)}${city(scope)}${sites(scope)}${sweep(scope)}</g>`
    + bezel(scope);

  // The wide map: land, the scope and spawn circles, the city
  const [wx, wy] = wide.px(0, 0);
  wideSvg.innerHTML = terrain(wide, GEO.kanto)
    + `<circle class="ring ring--dash" cx="${wx}" cy="${wy}" r="${f(SIM.SPAWN_KM * wide.ppk)}"/>`
    + `<circle class="ring ring--scope" cx="${wx}" cy="${wy}" r="${f(SIM.SCOPE_KM * wide.ppk)}"/>`
    + `<circle class="wide__city" cx="${wx}" cy="${wy}" r="2.5"/>`;

  // The live layers: trails and the route under, contacts on top. Clipped
  // to the scope so a contact outside 24.5 km is only on the wide map.
  scopeLive.innerHTML = `<defs><clipPath id="live-clip"><circle cx="${scope.half}" cy="${scope.half}" r="${r}"/></clipPath></defs>`
    + `<g clip-path="url(#live-clip)"><g id="trails"></g><line class="route" id="route" data-on="false"/><g id="contacts"></g></g>`;
  wideLive.innerHTML = '<g id="wide-dots"></g>';
}


/* ---------- THE SIM AND WHAT IS SHOWN FOR EACH CONTACT ---------- */
const params = new URLSearchParams(location.search);
let seed = 0;
let sim = null;
let shown = new Map();       // contact id -> the elements that show it
let gone = new Set();        // ids already faded out (the sim still lists them, so they must not be drawn again)
let selected = null;         // id of the selected contact
let nextTrail = 0;

const SIZE = { SCOUT: 3.5, STANDARD: 5, HEAVY: 7 };   // dot radius by type, in scope pixels
const FADE = 2.5;            // seconds a finished contact stays before it is removed

const list = document.querySelector('#list');
const empty = document.querySelector('#empty');
const ticker = document.querySelector('#ticker');
const clockEl = document.querySelector('#clock');

const bearingOf = c => (Math.atan2(c.x, c.y) * 180 / Math.PI + 360) % 360;
const STATE = { inbound: ['接近中', 'INBOUND'], impact: ['着弾', 'IMPACT'] };
const mmss = t => `T+${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function begin() {
  seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e9);
  sim = SIM.create(seed);
  document.querySelector('#seed').textContent = seed;
  for (const v of shown.values()) v.remove();
  shown.clear();
  gone.clear();
  selected = null;
  nextTrail = 0;
  say('idle', '待機中', 'STANDBY');
  refresh(true);
}

// Everything that shows one contact, made when it first appears
function show(c) {
  const dot = SIZE[c.kind];
  const trail = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  trail.setAttribute('class', 'trail');
  document.querySelector('#trails').append(trail);

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'contact');
  g.dataset.id = c.id;
  g.dataset.kind = c.kind;
  g.innerHTML = `<circle class="contact__hit" r="16"/><circle class="contact__ring" r="${dot * 2}"/><circle class="contact__dot" r="${dot}"/>`
    + `<text class="contact__label" x="${dot + 9}" y="3">${c.id}</text>`;
  document.querySelector('#contacts').append(g);

  const wideDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  wideDot.setAttribute('class', 'wide__contact');
  wideDot.setAttribute('r', '3');
  document.querySelector('#wide-dots').append(wideDot);

  const li = document.createElement('li');
  li.innerHTML = `<button class="row" type="button" data-id="${c.id}"><b class="row__id">${c.id}</b>`
    + `<span class="row__kind"><span lang="ja">${SIM.KINDS[c.kind].ja}</span> ${c.kind}</span><span class="row__eta"></span></button>`;

  const v = {
    c, trail, g, wideDot, li,
    pts: [],
    nextPt: 0,
    endAt: null,
    remove() { trail.remove(); g.remove(); wideDot.remove(); li.remove(); },
  };
  shown.set(c.id, v);
  return v;
}

// Positions and states, every frame
function place() {
  for (const c of sim.contacts) {
    if (gone.has(c.id)) continue;
    const v = shown.get(c.id) || show(c);
    const [px, py] = scope.px(c.x, c.y);
    const [wx, wy] = wide.px(c.x, c.y);
    v.g.setAttribute('transform', `translate(${f(px)} ${f(py)})`);
    v.wideDot.setAttribute('cx', f(wx));
    v.wideDot.setAttribute('cy', f(wy));
    for (const el of [v.g, v.wideDot, v.li.firstChild]) {
      el.dataset.state = c.state;
      el.dataset.selected = String(c.id === selected);
    }
    v.g.dataset.scope = String(c.onScope);

    // A short trail of where it has been, one point every half second
    if (c.state === 'inbound' && sim.time >= v.nextPt) {
      v.pts.push([px, py]);
      v.nextPt = sim.time + 0.5;
    }
    if (v.pts.length > 14) v.pts.shift();
    v.trail.setAttribute('d', v.pts.length > 1 ? 'M' + v.pts.map(p => `${f(p[0])} ${f(p[1])}`).join('L') : '');
    v.trail.dataset.scope = String(c.onScope);

    if (c.state !== 'inbound' && v.endAt === null) v.endAt = sim.time + FADE;
    if (v.endAt !== null && sim.time >= v.endAt) {
      v.remove();
      shown.delete(c.id);
      gone.add(c.id);
    }
  }

  // The route: a dashed line from the selected contact to the city
  const route = document.querySelector('#route');
  const sel = selected && sim.contacts.find(c => c.id === selected);
  if (sel && sel.state === 'inbound') {
    const [px, py] = scope.px(sel.x, sel.y);
    route.setAttribute('x1', f(px)); route.setAttribute('y1', f(py));
    route.setAttribute('x2', scope.half); route.setAttribute('y2', scope.half);
    route.dataset.on = 'true';
  } else {
    route.dataset.on = 'false';
  }
}


/* ---------- THE LIST, THE SELECTED PANEL AND THE TICKER ----------
   Redrawn ten times a second rather than every frame: rebuilding what a person
   is trying to click in the middle of a press loses the click. The rows are made
   once and only their text changes. */
const els = {
  target: document.querySelector('#target'),
  id: document.querySelector('#t-id'), kind: document.querySelector('#t-kind'),
  bearing: document.querySelector('#t-bearing'), range: document.querySelector('#t-range'),
  speed: document.querySelector('#t-speed'), eta: document.querySelector('#t-eta'),
  state: document.querySelector('#t-state'),
};

function refresh(force) {
  const inbound = sim.inbound();

  // Nothing selected, or the selection is finished: take the soonest, if there is one
  const cur = sim.contacts.find(c => c.id === selected);
  if (!cur || cur.state !== 'inbound') selected = inbound.length ? inbound[0].id : null;

  stage.dataset.state = inbound.length ? 'running' : 'idle';
  clockEl.textContent = mmss(sim.time);

  // Rows: soonest first, finished contacts below. Only move a row that is out of place.
  const order = [...shown.values()].sort((a, b) => {
    const ia = a.c.state === 'inbound', ib = b.c.state === 'inbound';
    return ia !== ib ? (ia ? -1 : 1) : sim.eta(a.c) - sim.eta(b.c) || a.c.born - b.c.born;
  });
  const want = order.map(v => v.li);
  if (force || want.some((li, i) => list.children[i] !== li) || list.children.length !== want.length) list.replaceChildren(...want);
  for (const v of order) {
    const c = v.c;
    v.li.firstChild.querySelector('.row__eta').textContent = c.state === 'inbound' ? `${sim.eta(c).toFixed(1)}S` : STATE[c.state][1];
  }
  empty.hidden = order.length > 0;

  // The selected panel
  const c = selected && sim.contacts.find(x => x.id === selected);
  els.target.dataset.empty = String(!c);
  if (c) {
    els.id.textContent = c.id;
    els.kind.textContent = c.kind;
    els.bearing.textContent = `${String(Math.round(bearingOf(c)) % 360).padStart(3, '0')}°`;
    els.range.textContent = `${sim.dist(c).toFixed(1)} KM`;
    els.speed.textContent = `${c.speed.toFixed(1)} KM/S`;
    els.eta.textContent = `${sim.eta(c).toFixed(1)} S`;
    els.state.textContent = STATE[c.state][1];
  } else {
    for (const k of ['id', 'kind', 'bearing', 'range', 'speed', 'eta', 'state']) els[k].textContent = '-';
  }
}

// One line at the bottom: the latest thing that happened, in the color of its level
function say(level, ja, en) {
  ticker.dataset.level = level;
  ticker.innerHTML = `<span class="ticker__time">${sim ? mmss(sim.time) : 'T+00:00'}</span> <span class="ticker__ja" lang="ja">${ja}</span> <span class="ticker__en">${en}</span>`;
}

const WORDS = {
  spawn: ['info', '未確認目標接近', 'UNIDENTIFIED CONTACT'],
  scope: ['alert', '防衛圏侵入', 'ENTERS SCOPE'],
  impact: ['breach', '着弾', 'IMPACT'],
};
function report(events) {
  for (const e of events) {
    const [level, ja, en] = WORDS[e.type];
    say(level, ja, `${e.id} ${en}`);
  }
}

function select(id) {
  selected = id;
  place();
  refresh();
}


/* ---------- THE LOOP ----------
   The sim runs in fixed steps of SIM.STEP whatever the frame rate, so a slow
   frame never changes what happens. A long pause (a hidden tab) is clipped,
   rather than catching up in one go. */
let last = 0, owed = 0, hud = 0;

function tick(now) {
  if (last) owed += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (owed >= SIM.STEP) {
    sim.step(SIM.STEP);
    owed -= SIM.STEP;
  }
  report(sim.takeEvents());
  place();
  if (now - hud > 100) {
    hud = now;
    refresh();
  }
  requestAnimationFrame(tick);
}


/* ---------- CONTROLS ---------- */
const bar = document.querySelector('.bar');

bar.addEventListener('submit', e => {
  e.preventDefault();
  const c = sim.spawnRandom(document.querySelector('#pick-kind').value);
  report(sim.takeEvents());
  place();
  refresh();
  if (!selected) select(c.id);
});
document.querySelector('#reset').addEventListener('click', () => {
  begin();
  document.querySelector('#detect').focus();
});

// Click a row or a blip to select it
document.addEventListener('click', e => {
  const hit = e.target.closest('[data-id]');
  if (hit) select(hit.dataset.id);
});

// Arrow keys step through the list, soonest first (not while a menu is open)
document.addEventListener('keydown', e => {
  if (e.target.closest?.('select, input, textarea')) return;
  const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
  if (!dir) return;
  const ids = sim.inbound().map(c => c.id);
  if (!ids.length) return;
  e.preventDefault();
  const i = ids.indexOf(selected);
  select(ids[(i + dir + ids.length) % ids.length]);
});


/* ---------- FIT TO THE WINDOW ----------
   Publishes the scale that fits the 1280x720 stage; style.css applies it with
   zoom. It measures clientWidth/clientHeight, not innerWidth, which a mobile
   browser can inflate to the stage width. The gutter leaves room for the
   registration marks on the body. */
const root = document.documentElement;

function fit() {
  const gutter = root.clientWidth >= 900 ? 48 : 12;
  const scale = Math.min((root.clientWidth - gutter * 2) / 1280, (root.clientHeight - gutter * 2) / 720);
  root.style.setProperty('--scale', scale.toFixed(4));
}

window.addEventListener('resize', fit);
fit();


/* ---------- START UP ---------- */
drawMaps();
begin();
bar.hidden = false;
requestAnimationFrame(tick);
