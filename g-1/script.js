/* =========================================================
   G-1 RADAR DEFENSE: THE SCREEN
   Draws the two maps from the data baked by tools/geo.mjs, then shows what the
   rules in sim.js are doing: this file never decides anything about the game,
   it only reads the sim and writes shapes, text and attributes. CSS owns every
   color and line width (data-state, data-kind, data-selected and the rest).
   Read top to bottom: geography, drawing, the live layer, the list and panels,
   shots and bursts, the loop, orders and controls, fit, start up.
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

// The batteries are the sim's (positions, weapon and names); this file only draws them.
// T-1's west radar is left out: the sweep is Tokyo-3's own radar, at the center of the scope.
const NAME = Object.fromEntries(SIM.BATTERIES.map(b => [b.id, b.name]));
const TYPE = Object.fromEntries(SIM.BATTERIES.map(b => [b.id, b.type]));

// A view maps km to pixels: a square panel with the city in the middle that
// shows `radius` km out to its edge
function makeView(svg, radius) {
  const size = Number(svg.getAttribute('viewBox').split(' ')[2]);
  const half = size / 2, ppk = half / radius;       // ppk: pixels per km
  return { size, half, ppk, px: (x, y) => [half + x * ppk, half - y * ppk] };
}
const scope = makeView(scopeSvg, SIM.SCOPE_KM);
const wide = makeView(wideSvg, 56);                  // wide map: the 25 km spawn ring with room for the coast around it


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

// Each site: a diamond for a gun, a triangle for AA (its color follows data-state,
// which place() sets) inside a faint ring showing how far it reaches
function sites(view) {
  return SIM.BATTERIES.map(b => {
    const [px, py] = view.px(b.x, b.y);
    const mark = b.type === 'AA' ? 'M0 -6L6.5 5L-6.5 5Z' : 'M0 -6L6 0L0 6L-6 0Z';
    return `<g class="site" data-battery="${b.id}" data-type="${b.type}" data-state="hold" transform="translate(${f(px)} ${f(py)})">`
      + `<circle class="site__range" r="${f(SIM.WEAPONS[b.type].range * view.ppk)}"/>`
      + `<path class="site__mark" d="${mark}"/><text class="site__ja" x="9" y="3">${b.ja}</text></g>`;
  }).join('');
}

// One faint line per battery, from it to whatever it is ordered onto, so the
// orders can be read off the scope. place() moves them and turns them on.
function links() {
  return SIM.BATTERIES.map(b => `<line class="link" data-battery="${b.id}" data-on="false"/>`).join('');
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
    + `<g clip-path="url(#live-clip)"><g id="trails"></g><line class="route" id="route" data-on="false"/><g id="links">${links()}</g><g id="shots"></g><g id="contacts"></g><g id="bursts"></g></g>`;
  wideLive.innerHTML = '<g id="wide-dots"></g>';
}


/* ---------- THE SIM AND WHAT IS SHOWN FOR EACH CONTACT ---------- */
const params = new URLSearchParams(location.search);
let seed = 0;
let sim = null;
let shown = new Map();       // contact id -> the elements that show it
let gone = new Set();        // ids already faded out (the sim still lists them, so they must not be drawn again)
let selected = null;         // id of the selected contact
let paused = false;          // the sim stands still; orders can still be given
let rate = 1;                // game seconds per real second (1, 2 or 4): time compression, nothing else changes
const RATES = [1, 2, 4];
let queue = [];              // the run's contacts still to come (SIM.schedule), soonest first

const SIZE = { SCOUT: 3.5, STANDARD: 5, HEAVY: 7, RAIDER: 3.5 };   // dot radius by type, in scope pixels
const FADE = 2.5;            // seconds a finished contact stays before it is removed

const list = document.querySelector('#list');
const empty = document.querySelector('#empty');
const ticker = document.querySelector('#ticker');
const clockEl = document.querySelector('#clock');
const logEl = document.querySelector('#log');
const popBox = document.querySelector('.pop');
const popEl = document.querySelector('#pop');
const gfBox = document.querySelector('.gf');
const gfEl = document.querySelector('#gf');
const ammoRows = {};         // weapon type -> its pool bar in the BATTERIES box
for (const box of document.querySelectorAll('.ammo')) {
  ammoRows[box.dataset.pool] = { box, num: box.querySelector('.ammo__num'), fill: box.querySelector('i') };
}
const aarEl = document.querySelector('#aar');
const pauseBtn = document.querySelector('#pause');
const speedBtn = document.querySelector('#speed');

// The six rows in the BATTERIES box and the six order buttons come from the
// sim's list of sites, so a site added there shows up here with no markup
const holdBtn = document.querySelector('#hold-all');
for (const [i, b] of SIM.BATTERIES.entries()) {
  const li = document.createElement('li');
  li.dataset.battery = b.id;
  li.dataset.type = b.type;
  li.dataset.state = 'hold';
  li.innerHTML = `<span class="bat__name">${i + 1} ${b.name}</span><span class="bat__target">-</span><span class="bat__state">HOLD</span>`
    + `<button class="bat__auto" type="button" aria-pressed="false" title="Standing order: this site picks its own targets (Shift+${i + 1}, A for all)">AUTO</button>`;
  li.dataset.auto = 'false';
  document.querySelector('#bats').append(li);

  const btn = document.createElement('button');
  btn.className = 'order';
  btn.type = 'button';
  btn.disabled = true;
  btn.dataset.battery = b.id;
  btn.dataset.type = b.type;
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = `<span class="order__name">${i + 1} ${b.name}</span><span class="order__hit">-</span>`;
  holdBtn.before(btn);
}
const orderBtns = [...document.querySelectorAll('.order[data-battery]')];
const sites$ = {};           // battery id -> its group on the scope
const links$ = {};           // battery id -> its line to its target

const STATE = { inbound: ['接近中', 'INBOUND'], impact: ['着弾', 'IMPACT'], destroyed: ['撃破', 'DESTROYED'] };
// The forecast (sim.forecast) in words: short for a row, longer for the panel,
// where a leak or a close call is followed by the share of its hull the fire is expected to take
const OUTLOOK = { open: ['NONE', 'NO SITE'], leaks: ['LEAK', 'LEAKS'], close: ['CLOSE', 'CLOSE'], holds: ['STOP', 'STOPPED'] };
const mmss = t => `T+${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// What happened this run, counted from the events and, for idle time, the
// sites' states each step. Read only by the after-action report.
let aar = null;
const freshAar = () => ({
  fired: { GUN: 0, AA: 0 }, hit: { GUN: 0, AA: 0 }, longShots: 0, wasted: 0,
  kills: 0, silenced: 0, impacts: [], idle: 0,
});

function begin() {
  aar = freshAar();
  seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e9);
  sim = SIM.create(seed);
  queue = SIM.schedule(seed);
  document.querySelector('#seed').textContent = seed;
  for (const v of shown.values()) v.remove();
  shown.clear();
  gone.clear();
  selected = null;
  setPaused(false);
  setRate(1);
  for (const el of shotEls.values()) el.remove();
  shotEls.clear();
  document.querySelector('#bursts').replaceChildren();
  logEl.replaceChildren();
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
    + `<span class="row__kind"><span lang="ja">${SIM.KINDS[c.kind].ja}</span> ${c.kind}</span><span class="row__out"></span><span class="row__eta"></span></button>`;

  const v = {
    c, trail, g, wideDot, li,
    pts: [],
    nextPt: 0,
    endAt: null,
    hull: 100,
    label: g.querySelector('.contact__label'),
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

    // A damaged contact shows what is left of its hull next to its name
    const hull = Math.round(100 * c.hp / c.maxHp);
    if (hull !== v.hull || v.state !== c.state) {
      v.state = c.state;
      v.hull = hull;
      v.label.textContent = hull < 100 && c.state === 'inbound' ? `${c.id} ${hull}%` : c.id;
    }

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

  // Each battery's state, and a line to what it is ordered onto
  for (const b of sim.batteries) {
    sites$[b.id].dataset.state = sim.stateOf(b);
    const link = links$[b.id], t = b.target && sim.contacts.find(c => c.id === b.target);
    if (t && t.onScope) {
      const [x1, y1] = scope.px(b.x, b.y), [x2, y2] = scope.px(t.x, t.y);
      link.setAttribute('x1', f(x1)); link.setAttribute('y1', f(y1));
      link.setAttribute('x2', f(x2)); link.setAttribute('y2', f(y2));
      link.dataset.on = 'true';
    } else {
      link.dataset.on = 'false';
    }
  }
  drawShots();

  // The route: a dashed line from the selected contact to what it is flying
  // at, the city or (for a raider) a battery
  const route = document.querySelector('#route');
  const sel = selected && sim.contacts.find(c => c.id === selected);
  if (sel && sel.state === 'inbound') {
    const [px, py] = scope.px(sel.x, sel.y);
    const [gx, gy] = scope.px(sel.gx, sel.gy);
    route.setAttribute('x1', f(px)); route.setAttribute('y1', f(py));
    route.setAttribute('x2', f(gx)); route.setAttribute('y2', f(gy));
    route.dataset.on = 'true';
  } else {
    route.dataset.on = 'false';
  }
}


/* ---------- THE LIST, THE PANELS AND THE BATTERIES ----------
   Redrawn ten times a second rather than every frame: rebuilding what a person
   is trying to click in the middle of a press loses the click. The rows are made
   once and only their text changes. */
const els = {
  target: document.querySelector('#target'),
  id: document.querySelector('#t-id'), kind: document.querySelector('#t-kind'),
  range: document.querySelector('#t-range'),
  eta: document.querySelector('#t-eta'), hull: document.querySelector('#t-hull'),
  goal: document.querySelector('#t-goal'), outlook: document.querySelector('#t-outlook'),
};
const bats = {};             // battery id -> { target, state } elements in the BATTERIES box
for (const li of document.querySelectorAll('#bats li')) {
  bats[li.dataset.battery] = { li, target: li.querySelector('.bat__target'), state: li.querySelector('.bat__state'), auto: li.querySelector('.bat__auto') };
}

// What a battery's state reads as in the box, with its timer where it has one
const BAT_WORDS = {
  silenced: b => `SILENCED ${Math.ceil(b.silenced)}S`,
  hold:     b => b.auto ? 'WATCHING' : 'HOLD',
  retarget: b => `AIMING ${b.retarget.toFixed(1)}S`,
  range:    () => 'OUT OF RANGE',
  dry:      () => 'NO AMMO',
  cooling:  () => 'FIRING',
  ready:    () => 'FIRING',
};
const goalOf = c => c.objective === 'city' ? 'TOKYO-3' : `${NAME[c.objective]} SITE`;

function refresh(force) {
  const inbound = sim.inbound();

  // Nothing selected, or the selection is finished: take the soonest, if there is one
  const cur = sim.contacts.find(c => c.id === selected);
  if (!cur || cur.state !== 'inbound') selected = inbound.length ? inbound[0].id : null;

  const was = stage.dataset.state;
  stage.dataset.state = sim.breached ? 'breached' : !queue.length && !inbound.length ? 'held' : 'running';
  if (stage.dataset.state !== was && stage.dataset.state !== 'running') renderAar();
  clockEl.textContent = mmss(sim.time);
  popEl.textContent = sim.population.toLocaleString('en-US');
  gfEl.textContent = `${Math.round(100 * sim.integrity / SIM.INTEGRITY)}%`;
  gfBox.dataset.level = sim.integrity === 0 ? 'breach' : sim.integrity <= SIM.INTEGRITY * 0.4 ? 'alert' : 'ok';
  const ammo = sim.ammo;
  for (const [type, row] of Object.entries(ammoRows)) {
    const left = Math.floor(ammo[type]), full = SIM.WEAPONS[type].pool;
    row.num.textContent = left;
    row.fill.style.setProperty('--fill', (ammo[type] / full).toFixed(3));
    row.box.dataset.low = String(left <= full / 6);
  }

  // Rows: soonest first, finished contacts below. Only move a row that is out of place.
  const order = [...shown.values()].sort((a, b) => {
    const ia = a.c.state === 'inbound', ib = b.c.state === 'inbound';
    return ia !== ib ? (ia ? -1 : 1) : sim.eta(a.c) - sim.eta(b.c) || a.c.born - b.c.born;
  });
  const want = order.map(v => v.li);
  if (force || want.some((li, i) => list.children[i] !== li) || list.children.length !== want.length) list.replaceChildren(...want);
  for (const v of order) {
    const c = v.c;
    const row = v.li.firstChild, out = row.querySelector('.row__out'), fc = sim.forecast(c);
    row.querySelector('.row__eta').textContent = c.state === 'inbound' ? `${sim.eta(c).toFixed(1)}S` : STATE[c.state][1];
    out.dataset.outlook = fc ? fc.verdict : 'none';
    out.textContent = fc ? OUTLOOK[fc.verdict][0] : '';
  }
  empty.hidden = order.length > 0;

  // The selected panel, and the order buttons under it: each says whether that
  // battery is on this contact and the hit chance it would have from where it is
  const c = selected && sim.contacts.find(x => x.id === selected);
  const live = !!(c && c.state === 'inbound') && !sim.breached;
  els.target.dataset.empty = String(!c);
  for (const btn of orderBtns) {
    const b = sim.batteries.find(x => x.id === btn.dataset.battery);
    const chance = live ? sim.chanceOf(b, c) : null;
    btn.disabled = !live || b.silenced > 0;
    btn.setAttribute('aria-pressed', String(live && b.target === c.id));
    btn.querySelector('.order__hit').textContent = !live ? '-' : b.silenced > 0 ? 'SILENCED' : chance === null ? 'OUT' : `${Math.round(chance * 100)}%`;
  }
  if (c) {
    els.id.textContent = c.id;
    els.kind.textContent = c.kind;
    els.range.textContent = `${sim.dist(c).toFixed(1)} KM`;
    els.eta.textContent = `${sim.eta(c).toFixed(1)} S`;
    els.hull.textContent = `${Math.round(100 * c.hp / c.maxHp)}%`;
    els.goal.textContent = goalOf(c);
    const fc = sim.forecast(c);
    els.outlook.dataset.outlook = fc ? fc.verdict : 'none';
    els.outlook.textContent = !fc ? STATE[c.state][1] : fc.verdict === 'open' ? 'NO SITE ON IT' : fc.verdict === 'holds' ? OUTLOOK.holds[1] : `${OUTLOOK[fc.verdict][1]} ${Math.round(100 * fc.ratio)}%`;
  } else {
    delete els.outlook.dataset.outlook;
    for (const k of ['id', 'kind', 'range', 'eta', 'hull', 'goal', 'outlook']) els[k].textContent = '-';
  }

  // The batteries: what each is on, and what it is doing
  for (const b of sim.batteries) {
    const el = bats[b.id], state = sim.stateOf(b);
    el.li.dataset.state = state;
    el.li.dataset.auto = String(b.auto);
    el.auto.setAttribute('aria-pressed', String(b.auto));
    el.target.textContent = b.target || '-';
    el.state.textContent = BAT_WORDS[state](b);
  }
}


/* ---------- SHOTS AND BURSTS ----------
   A round in the air is a short tracer flying a straight line from its site to
   where the sim aimed it (the point the contact will have reached), arriving
   when the sim says it lands. A burst is a ring where a round landed. Both are
   for show: the sim has already decided. */
const TRACER_PX = { GUN: 26, AA: 11 };    // tracer length
const SVG = 'http://www.w3.org/2000/svg';
const shotEls = new Map();    // shot id -> its line

function drawShots() {
  const layer = document.querySelector('#shots');
  const live = new Set();
  for (const s of sim.shots) {
    live.add(s.id);
    let el = shotEls.get(s.id);
    if (!el) {
      el = document.createElementNS(SVG, 'line');
      el.setAttribute('class', `shot shot--${s.weapon.toLowerCase()}`);
      layer.append(el);
      shotEls.set(s.id, el);
    }
    // The path never changes: from the site to the aim point, head at k, tail a
    // fixed number of pixels behind it
    const [fx, fy] = scope.px(s.from.x, s.from.y), [tx, ty] = scope.px(s.to.x, s.to.y);
    const k = Math.min(1, (sim.time - s.t0) / (s.t1 - s.t0));
    const k0 = Math.max(0, k - TRACER_PX[s.weapon] / (Math.hypot(tx - fx, ty - fy) || 1));
    const at = n => [fx + (tx - fx) * n, fy + (ty - fy) * n];
    const [x1, y1] = at(k0), [x2, y2] = at(k);
    el.setAttribute('x1', f(x1)); el.setAttribute('y1', f(y1));
    el.setAttribute('x2', f(x2)); el.setAttribute('y2', f(y2));
  }
  for (const [id, el] of shotEls) {
    if (!live.has(id)) { el.remove(); shotEls.delete(id); }
  }
}

function burst(kind, x, y, small) {
  const [px, py] = scope.px(x, y);
  const ring = document.createElementNS(SVG, 'circle');
  ring.setAttribute('class', `burst burst--${kind}`);
  if (small) ring.dataset.small = 'true';
  ring.setAttribute('cx', f(px));
  ring.setAttribute('cy', f(py));
  ring.setAttribute('r', kind === 'kill' ? 14 : small ? 4 : 9);
  document.querySelector('#bursts').append(ring);
  setTimeout(() => ring.remove(), 700);
}


/* ---------- THE TICKER AND THE LOG ----------
   Every event goes to both: the ticker shows the latest in its level's color,
   the log keeps the last few. Levels: teal information, amber alert, red breach. */
const LOG_LINES = 7;

function say(level, ja, en) {
  const time = sim ? mmss(sim.time) : 'T+00:00';
  ticker.dataset.level = level;
  ticker.innerHTML = `<span class="ticker__time">${time}</span> <span class="ticker__ja" lang="ja">${ja}</span> <span class="ticker__en">${en}</span>`;

  const li = document.createElement('li');
  li.dataset.level = level;
  li.innerHTML = `<time>${time}</time> <span class="log__ja" lang="ja">${ja}</span> <span class="log__en">${en}</span>`;
  logEl.prepend(li);
  while (logEl.children.length > LOG_LINES) logEl.lastChild.remove();
}

const REFUSED = { target: ['交戦不能', 'NO TARGET'], silenced: ['沈黙中', 'BATTERY SILENCED'], battery: ['交戦不能', 'NO SUCH BATTERY'] };
const WORDS = {
  spawn:     e => ['info',   '未確認目標接近', `${e.id} UNIDENTIFIED CONTACT`],
  scope:     e => ['alert',  '防衛圏侵入',     `${e.id} ENTERS SCOPE`],
  assign:    e => ['info',   '交戦',           `${NAME[e.battery]} ON ${e.id}`],
  hold:      e => ['info',   '待機',           `${NAME[e.battery]} HOLDS FIRE`],
  auto:      e => ['info',   e.on ? '自動' : '手動', `${NAME[e.battery]} STANDING ORDER ${e.on ? 'ON' : 'OFF'}`],
  released:  e => ['info',   '待機',           `${NAME[e.battery]} STANDS DOWN, ${e.id} DONE`],
  fire:      e => ['info',   '砲撃',           `${NAME[e.battery]} FIRES AT ${e.id}, ${Math.round(e.chance * 100)}%`],
  hit:       e => ['info',   '命中',           `${e.id} HIT, HULL ${Math.round(100 * e.hp / e.maxHp)}%`],
  miss:      e => ['alert',  '外れ',           `${e.id} MISSED`],
  wasted:    e => ['alert',  '無効',           `${e.id} ROUND WASTED`],
  destroyed: e => ['info',   '撃破',           `${e.id} DESTROYED`],
  impact:    e => ['breach', '着弾',           `${e.id} IMPACT, POPULATION -${e.damage.toLocaleString('en-US')}`],
  silenced:  e => ['breach', '砲台沈黙',       `${e.id} SILENCES ${NAME[e.battery]} SITE`],
  restored:  e => ['info',   '砲台復旧',       `${NAME[e.battery]} SITE BACK`],
  breach:    e => ['breach', 'ジオフロント侵入', `GEOFRONT BREACHED BY ${e.id}`],
  refused:   e => ['alert',  ...REFUSED[e.reason].map((w, i) => i ? `${w}${e.battery ? ' ' + NAME[e.battery] : ''}` : w)],
};

function count(e) {
  const type = TYPE[e.battery];
  if (e.type === 'fire') { aar.fired[type]++; if (e.chance < 0.3) aar.longShots++; }
  if (e.type === 'hit') aar.hit[type]++;
  if (e.type === 'wasted') aar.wasted++;
  if (e.type === 'destroyed') aar.kills++;
  if (e.type === 'silenced') aar.silenced++;
  if (e.type === 'impact') aar.impacts.push({ id: e.id, kind: sim.contacts.find(c => c.id === e.id).kind, damage: e.damage });
}

// A site that is on HOLD while a contact is inside its reach is idle
function sampleIdle() {
  const live = sim.inbound();
  for (const b of sim.batteries) {
    if (sim.stateOf(b) === 'hold' && live.some(c => sim.reach(b, c) <= SIM.WEAPONS[b.type].range)) aar.idle += SIM.STEP;
  }
}

// S to D from what is left of the city; a breach is never better than D
const GRADES = [[0.9, 'S'], [0.7, 'A'], [0.5, 'B'], [0.3, 'C'], [0, 'D']];
const gradeOf = () => sim.breached ? 'D' : GRADES.find(([min]) => sim.population / SIM.START_POPULATION >= min)[1];

function renderAar() {
  const w = type => aar.fired[type] ? `${aar.fired[type]} FIRED ${Math.round(100 * aar.hit[type] / aar.fired[type])}% HIT` : 'NOT USED';
  const worst = [...aar.impacts].sort((a, b) => b.damage - a.damage)[0];
  const rows = [
    ['GUNS', w('GUN')],
    ['AA', w('AA')],
    ['LONG SHOTS', `${aar.longShots} UNDER 30%`],
    ['WASTED', `${aar.wasted} ON DEAD`],
    ['IDLE SITES', `${Math.round(aar.idle)} SITE-S`],
    ['SILENCED', `${aar.silenced} TIMES`],
    ['HIT THE CITY', worst ? `${worst.id} ${worst.kind} -${worst.damage.toLocaleString('en-US')}` : 'NOTHING'],
  ];
  aarEl.innerHTML = `<p class="aar__head"><b class="aar__grade">${gradeOf()}</b><span><span lang="ja">戦闘報告</span> AFTER ACTION<br>${mmss(sim.time)} · ${sim.population.toLocaleString('en-US')} LEFT · GEOFRONT ${Math.round(100 * sim.integrity / SIM.INTEGRITY)}%</span></p>`
    + `<dl class="aar__rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

function report(events) {
  for (const e of events) {
    count(e);
    // AA fires several rounds a second per site: show the tracers and small
    // bursts, but keep them out of the log and the ticker
    const aa = TYPE[e.battery] === 'AA' && ['fire', 'hit', 'miss', 'wasted'].includes(e.type);
    if (!aa) {
      const [level, ja, en] = WORDS[e.type](e);
      say(level, ja, en);
    }
    if (e.type === 'hit') burst('hit', e.x, e.y, aa);
    if (e.type === 'miss') burst('miss', e.x, e.y, aa);
    if (e.type === 'destroyed') burst('kill', e.x, e.y);
    if (e.type === 'impact') {
      for (const box of [popBox, gfBox]) {
        box.dataset.hit = 'true';
        setTimeout(() => { box.dataset.hit = 'false'; }, 1200);
      }
    }
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
   rather than catching up in one go. While paused no time is owed at all.
   Speed x2 and x4 only owe more time per real second: the steps, and so every
   result, are the same as at x1, and a frame never owes more than 1 s (30 steps). */
let last = 0, owed = 0, hud = 0;

function tick(now) {
  if (last && !paused) owed += Math.min(0.25, (now - last) / 1000) * rate;
  last = now;
  while (owed >= SIM.STEP) {
    // The run's contacts come in on the schedule, as they do in the arena
    while (queue.length && queue[0].t <= sim.time) {
      const q = queue.shift();
      sim.spawn(q.kind, q.bearing);
    }
    sim.step(SIM.STEP);
    sampleIdle();
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


/* ---------- ORDERS AND CONTROLS ----------
   The player never fires: they put batteries on contacts and take them off,
   and the sim's batteries do the rest. */
const bar = document.querySelector('.bar');
const ORDER_KEYS = Object.fromEntries(SIM.BATTERIES.map((b, i) => [i + 1, b.id]));

function after() {
  report(sim.takeEvents());
  place();
  refresh();
}

// A battery button: on this contact if it is not, off (HOLD) if it already is
function toggle(batteryId) {
  const c = selected && sim.contacts.find(x => x.id === selected);
  if (!c || c.state !== 'inbound' || sim.breached) return;
  const b = sim.batteries.find(x => x.id === batteryId);
  if (b.target === c.id) sim.hold(b.id); else sim.assign(b.id, c.id);
  after();
}
// A standing order on one site, or on all of them: all go on unless all already are
function toggleAuto(batteryId) {
  const b = sim.batteries.find(x => x.id === batteryId);
  sim.setAuto(b.id, !b.auto);
  after();
}
function autoAll() {
  const on = !sim.batteries.every(b => b.auto);
  for (const b of sim.batteries) sim.setAuto(b.id, on);
  after();
}
function holdAll() {
  for (const b of sim.batteries) sim.hold(b.id);
  after();
}
for (const btn of orderBtns) btn.addEventListener('click', () => toggle(btn.dataset.battery));
document.querySelector('#hold-all').addEventListener('click', holdAll);
for (const el of Object.values(bats)) el.auto.addEventListener('click', () => toggleAuto(el.li.dataset.battery));

function setPaused(on) {
  paused = on;
  stage.dataset.paused = String(on);
  pauseBtn.setAttribute('aria-pressed', String(on));
  pauseBtn.textContent = on ? 'RESUME' : 'PAUSE';
}
pauseBtn.addEventListener('click', () => setPaused(!paused));

function setRate(r) {
  rate = r;
  stage.dataset.rate = String(r);
  speedBtn.dataset.rate = String(r);
  speedBtn.textContent = `SPEED x${r}`;
}
const nextRate = () => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length]);
speedBtn.addEventListener('click', nextRate);

bar.addEventListener('submit', e => {
  e.preventDefault();
  if (sim.breached) return;
  const c = sim.spawnRandom(document.querySelector('#pick-kind').value);
  after();
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

// 1 to 6 toggle a site on the selected contact, Shift+1 to 6 a site's standing
// order (AUTO), A all of them, H holds them all (and ends every standing order),
// T steps the game speed, Space pauses, and the arrow keys step through the list, soonest first. None of it
// applies while a menu is open. Space is taken from buttons too (Enter still
// presses them), so pausing never also presses whatever happens to have focus.
const typing = e => e.target.closest?.('select, input, textarea');
document.addEventListener('keydown', e => {
  if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') {
    e.preventDefault();
    if (!e.repeat) setPaused(!paused);
    return;
  }
  const digit = /^Digit([1-6])$/.exec(e.code);
  if (e.shiftKey && digit) {
    e.preventDefault();
    if (!e.repeat) toggleAuto(ORDER_KEYS[digit[1]]);
    return;
  }
  if (e.key.toLowerCase() === 'a') {
    e.preventDefault();
    if (!e.repeat) autoAll();
    return;
  }
  if (e.key.toLowerCase() === 't') {
    e.preventDefault();
    if (!e.repeat) nextRate();
    return;
  }
  if (ORDER_KEYS[e.key] || e.key.toLowerCase() === 'h') {
    e.preventDefault();
    if (!e.repeat) ORDER_KEYS[e.key] ? toggle(ORDER_KEYS[e.key]) : holdAll();
    return;
  }
  const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
  if (!dir) return;
  const ids = sim.inbound().map(c => c.id);
  if (!ids.length) return;
  e.preventDefault();
  const i = ids.indexOf(selected);
  select(ids[(i + dir + ids.length) % ids.length]);
});
document.addEventListener('keyup', e => {
  if (e.key === ' ' && !typing(e)) e.preventDefault();   // a button would otherwise be pressed on key release
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
for (const el of document.querySelectorAll('.site')) sites$[el.dataset.battery] = el;
for (const el of document.querySelectorAll('.link')) links$[el.dataset.battery] = el;
begin();
bar.hidden = false;
requestAnimationFrame(tick);
