/* =========================================================
   NGE TACTICAL MAP STUDY: BEHAVIOR
   Draws three nested maps as SVG from the data baked by tools/geo.mjs
   (data/*.js define GEO.japan, GEO.kanto and GEO.hakone). CSS owns every color
   and line width; this file only writes shapes and gives them class names.

   The drawing code knows nothing about any one place. A region is just a
   center and a width in degrees, so showing somewhere else means adding an
   entry to REGIONS and baking its data.
   Then a scenario runs on top of the finished maps: an unknown contact
   approaches Tokyo-3 and the sites around it change status. As in M-1, the
   script only sets attributes (data-state and data-level on .screen,
   data-status on each site) and CSS does the rest.
   Read top to bottom: regions, projection, drawing, Tokyo-3, strip, scenario,
   fit.
   ========================================================= */

/* ---------- REGIONS ----------
   center is [longitude, latitude]; span is the width of the view in degrees of
   longitude (the height follows from the panel's shape). grid is the spacing
   of the lat/long lines. Each region's map is drawn into the panel with the
   same data-region, and marks the region listed in next. */
const REGIONS = {
  japan:  { center: [137.7, 38.4],    span: 22,   grid: 5,    next: 'kanto' },
  kanto:  { center: [139.7, 35.5],    span: 4.6,  grid: 1,    next: 'hakone' },
  hakone: { center: [139.04, 35.225], span: 0.15, grid: 0.02, next: null },
};

// Named places, drawn on the maps listed in "on". sea places are tinted cyan.
const PLACES = [
  { ja: '東京',     en: 'TOKYO',          at: [139.69, 35.69],  on: ['japan', 'kanto'] },
  { ja: '富士山',   en: 'MOUNT FUJI',     at: [138.55, 35.5],   on: ['kanto'] },
  { ja: '大阪',     en: 'OSAKA',          at: [135.5, 34.69],   on: ['japan'] },
  { ja: '札幌',     en: 'SAPPORO',        at: [141.35, 43.06],  on: ['japan'] },
  { ja: '日本海',   en: 'SEA OF JAPAN',   at: [134.5, 40.5],    on: ['japan'], sea: true },
  { ja: '太平洋',   en: 'PACIFIC OCEAN',  at: [143.5, 35.5],    on: ['japan'], sea: true },
  { ja: '相模湾',   en: 'SAGAMI BAY',     at: [139.5, 34.98],   on: ['kanto'], sea: true },
  { ja: '伊豆半島', en: 'IZU PENINSULA',  at: [138.8, 34.78],   on: ['kanto'] },
  { ja: '房総半島', en: 'BOSO PENINSULA', at: [140.25, 35.2],   on: ['kanto'] },
  { ja: '芦ノ湖',   en: 'LAKE ASHI',      at: [139.025, 35.2],  on: ['hakone'], sea: true },
];

// Tokyo-3 is fictional, so it is placed here rather than read from any data.
// cell is the size of one city block in degrees of longitude.
const CITY = { at: [139.04, 35.233], cell: 0.0064, ja: '第参新東京市', en: 'TOKYO-3' };


// The sites around Tokyo-3, drawn on the Hakone map only. Batteries fire at the
// contact; the radar only watches.
const SITES = [
  { id: 'north',  kind: 'battery', ja: '北部砲台',     en: 'NORTH BATTERY', at: [138.99, 35.248] },
  { id: 'south',  kind: 'battery', ja: '南部砲台',     en: 'SOUTH BATTERY', at: [139.065, 35.2] },
  { id: 'east',   kind: 'battery', ja: '東部砲台',     en: 'EAST BATTERY',  at: [139.09, 35.212] },
  { id: 'radar',  kind: 'radar',   ja: '西部レーダー', en: 'WEST RADAR',    at: [138.975, 35.232] },
];

// Where the contact can come from. The two bays are hand-drawn routes along the
// coast. Any other direction is worked out by routeFrom: a straight line to the
// city from that bearing. Each point has the second at which it passes it, so
// the long crossing goes quickly and the last stretch, the part the Hakone map
// shows, goes slowly.
const BAYS = {
  sagami: { ja: '相模湾', en: 'SAGAMI BAY', path: [
    { at: [139.55, 34.35], t: 0.5 }, { at: [139.3, 34.85], t: 4 }, { at: [139.17, 35.1], t: 6.5 },
    { at: [139.11, 35.19], t: 9 },   { at: [139.05, 35.228], t: 15 } ] },
  suruga: { ja: '駿河湾', en: 'SURUGA BAY', path: [
    { at: [138.65, 34.55], t: 0.5 }, { at: [138.85, 34.95], t: 4 }, { at: [138.97, 35.12], t: 6.5 },
    { at: [139.0, 35.19], t: 9 },    { at: [139.035, 35.228], t: 15 } ] },
};
const COMPASS = [
  { id: 'n',  deg: 0,   ja: '北',   en: 'NORTH' },     { id: 'ne', deg: 45,  ja: '北東', en: 'NORTHEAST' },
  { id: 'e',  deg: 90,  ja: '東',   en: 'EAST' },      { id: 'se', deg: 135, ja: '南東', en: 'SOUTHEAST' },
  { id: 's',  deg: 180, ja: '南',   en: 'SOUTH' },     { id: 'sw', deg: 225, ja: '南西', en: 'SOUTHWEST' },
  { id: 'w',  deg: 270, ja: '西',   en: 'WEST' },      { id: 'nw', deg: 315, ja: '北西', en: 'NORTHWEST' },
];

/* ---------- PROJECTION ----------
   Web Mercator, the same projection every web map uses. It works in degrees
   throughout, so a view is just "pixels per degree" plus where the center is. */
const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI;
const unmerc = m => (2 * Math.atan(Math.exp(m * Math.PI / 180)) - Math.PI / 2) * 180 / Math.PI;

// The panel size comes from the svg's viewBox, so the markup stays the one place it is set
function sizeOf(svg) {
  const [, , w, h] = svg.getAttribute('viewBox').split(' ').map(Number);
  return { w, h };
}

function makeView(region, w, h) {
  const [lon0, lat0] = region.center;
  const scale = w / region.span;               // pixels per degree
  const m0 = merc(lat0);
  return {
    w, h, scale,
    x: lon => w / 2 + (lon - lon0) * scale,
    y: lat => h / 2 - (merc(lat) - m0) * scale,
    bbox: {
      west: lon0 - region.span / 2,
      east: lon0 + region.span / 2,
      south: unmerc(m0 - h / 2 / scale),
      north: unmerc(m0 + h / 2 / scale),
    },
  };
}

const f = n => n.toFixed(1);
const path = (v, pts) => 'M' + pts.map(([lon, lat]) => `${f(v.x(lon))} ${f(v.y(lat))}`).join('L');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// OpenStreetMap lakes arrive as loose pieces of outline. Join the pieces that
// share an end point until each one closes into a ring.
function toRings(ways) {
  const key = p => p.join(',');
  const pool = ways.map(w => w.slice());
  const rings = [];
  while (pool.length) {
    let ring = pool.pop();
    let grew = true;
    while (grew && key(ring[0]) !== key(ring[ring.length - 1])) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i], head = key(ring[0]), tail = key(ring[ring.length - 1]);
        if (key(w[0]) === tail) ring = ring.concat(w.slice(1));
        else if (key(w[w.length - 1]) === tail) ring = ring.concat(w.slice(0, -1).reverse());
        else if (key(w[w.length - 1]) === head) ring = w.concat(ring.slice(1));
        else if (key(w[0]) === head) ring = w.slice().reverse().concat(ring.slice(1));
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}


/* A straight route to the city from a compass bearing, as [seconds, degrees away]
   pairs. Distances are in Mercator degrees, so they look the same on screen in
   every direction. The city is not in the middle of the Hakone map (it sits near
   the top), so how far away the map's edge is depends on the bearing. The route
   is timed to cross that edge at 8.5 seconds whichever way it comes, so the
   contact is always on the main map for the last stretch. */
function routeFrom(bearing) {
  const th = bearing * Math.PI / 180;
  const sin = Math.sin(th), cos = Math.cos(th);
  const [lon0, lat0] = CITY.at;
  const m0 = merc(lat0);

  const { view } = live.hakone;
  const cx = view.x(lon0), cy = view.y(lat0);
  const toEdge = Math.min(
    sin > 1e-6 ? (view.w - cx) / view.scale / sin : sin < -1e-6 ? cx / view.scale / -sin : Infinity,
    cos > 1e-6 ? cy / view.scale / cos : cos < -1e-6 ? (view.h - cy) / view.scale / -cos : Infinity,
  );

  const steps = [[0.5, 1.6], [4, 0.8], [6.5, toEdge * 2.5], [8.5, toEdge], [15, 0]];
  return steps.map(([t, d]) => ({ at: [lon0 + d * sin, unmerc(m0 + d * cos)], t }));
}

// RANDOM is any bearing at all; a compass choice is that bearing, a little off
function chooseOrigin(value) {
  if (BAYS[value]) return BAYS[value];
  let bearing, sector;
  if (value === 'auto') {
    bearing = Math.random() * 360;
    sector = COMPASS[Math.round(bearing / 45) % 8];
  } else {
    sector = COMPASS.find(c => c.id === value);
    bearing = sector.deg + (Math.random() * 24 - 12);
  }
  return { ja: `${sector.ja}方面`, en: sector.en, path: routeFrom(bearing) };
}


/* ---------- DRAWING ----------
   One function per layer, each returning svg markup for one view. */
function graticule(view, region) {
  const { west, east, south, north } = view.bbox;
  const step = region.grid;
  const places = Math.max(0, -Math.floor(Math.log10(step)));
  const lines = [], labels = [];
  for (let lon = Math.ceil(west / step) * step; lon <= east; lon += step) {
    const x = view.x(lon);
    lines.push(`<line x1="${f(x)}" y1="0" x2="${f(x)}" y2="${view.h}"/>`);
    labels.push(`<text x="${f(x + 3)}" y="15">${lon.toFixed(places)}E</text>`);
  }
  for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
    const y = view.y(lat);
    lines.push(`<line x1="0" y1="${f(y)}" x2="${view.w}" y2="${f(y)}"/>`);
    labels.push(`<text x="8" y="${f(y - 3)}">${lat.toFixed(places)}N</text>`);
  }
  return `<g class="grid">${lines.join('')}${labels.join('')}</g>`;
}

function coast(view, geo) {
  const d = geo.land.map(ring => path(view, ring) + 'Z').join('');
  return `<rect class="sea" width="${view.w}" height="${view.h}"/><g class="glow"><path class="land" d="${d}"/></g>`;
}

function detail(view, geo) {
  const major = /^(motorway|trunk|primary)/;
  const roads = (test, cls) => geo.roads.filter(r => test(r.c))
    .map(r => `<path class="road ${cls}" d="${path(view, r.p)}"/>`).join('');
  const lakes = geo.water.map(w => toRings(w.ways).map(r => path(view, r) + 'Z').join('')).join('');
  return `<g class="glow--cyan glow"><path class="lake" d="${lakes}"/></g>`
    + `<g class="glow--cyan glow">${geo.rivers.map(r => `<path class="river" d="${path(view, r.p)}"/>`).join('')}</g>`
    + `<g class="glow">${geo.rails.map(r => `<path class="rail" d="${path(view, r.p)}"/>`).join('')}`
    + `${roads(c => !major.test(c), '')}${roads(c => major.test(c), 'road--major')}</g>`;
}

function peaks(view, geo) {
  const cityX = view.x(CITY.at[0]), cityY = view.y(CITY.at[1]), cell = CITY.cell * view.scale;
  return geo.peaks.filter(p => p.ja).map(p => {
    const x = view.x(p.lon), y = view.y(p.lat);
    if (x < 8 || x > view.w - 90 || y < 24 || y > view.h - 30) return '';   // would be cut off by the frame
    if (Math.hypot(x - cityX, y - cityY) < 5.4 * cell) return '';           // would sit under the city
    const en = p.en ? `${esc(p.en.toUpperCase())}${p.ele ? ' ' + Math.round(p.ele) + 'M' : ''}` : (p.ele ? Math.round(p.ele) + 'M' : '');
    return `<g class="peak"><path class="peak__tri" d="M${f(x)} ${f(y - 5)}L${f(x + 4.5)} ${f(y + 3)}L${f(x - 4.5)} ${f(y + 3)}Z"/>`
      + `<text class="peak__ja" x="${f(x + 8)}" y="${f(y)}">${esc(p.ja)}</text>`
      + `<text class="peak__en" x="${f(x + 8)}" y="${f(y + 10)}">${en}</text></g>`;
  }).join('');
}

function places(view, key) {
  return PLACES.filter(p => p.on.includes(key)).map(p => {
    const x = view.x(p.at[0]), y = view.y(p.at[1]);
    return `<g class="place${p.sea ? ' place--sea' : ''}">`
      + `<text class="place__ja" x="${f(x)}" y="${f(y)}" text-anchor="middle">${p.ja}</text>`
      + `<text class="place__en" x="${f(x)}" y="${f(y + 10)}" text-anchor="middle">${p.en}</text></g>`;
  }).join('');
}

// A small box showing where the next map zooms in
function marker(view, next) {
  const nv = makeView(REGIONS[next], ...Object.values(sizeOf(document.querySelector(`[data-region="${next}"] svg`))));
  const x0 = view.x(nv.bbox.west), x1 = view.x(nv.bbox.east);
  const y0 = view.y(nv.bbox.north), y1 = view.y(nv.bbox.south);
  return `<rect class="marker" x="${f(x0)}" y="${f(y0)}" width="${f(x1 - x0)}" height="${f(y1 - y0)}"/>`;
}


/* ---------- TOKYO-3 ----------
   A city of square blocks with a street between them, each block holding a
   diamond, cut to an octagon that narrows to a neck, with the Geofront circles
   at its southern tip. A black layer under the blocks hides the real roads beneath, since the
   city is not on any real map. It is drawn in screen pixels around the city's
   position, so it stays the same shape at any zoom. */
function city(view) {
  const cx = view.x(CITY.at[0]), cy = view.y(CITY.at[1]);
  const c = CITY.cell * view.scale;
  const g = c * 0.04;                 // half the width of a street
  const ground = [], blocks = [];
  for (let j = -5; j <= 5; j++) {
    for (let i = -5; i <= 5; i++) {
      // An octagon-like body (corners cut off) that narrows to a neck toward
      // the south (positive j), where the Geofront sits
      const ai = Math.abs(i), aj = Math.abs(j);
      const half = j > 1 ? 4.4 - (j - 1) * 1.3 : 4.4;
      if (aj > 4 || ai > half || ai + aj > 6.4) continue;
      const x = cx + (i - 0.5) * c, y = cy + (j - 0.5) * c;
      const s = c - 2 * g;
      ground.push(`M${f(x)} ${f(y)}h${f(c)}v${f(c)}h${f(-c)}Z`);
      blocks.push(`M${f(x + g)} ${f(y + g)}h${f(s)}v${f(s)}h${f(-s)}Z`);
      blocks.push(`M${f(x + c / 2)} ${f(y + g)}L${f(x + c - g)} ${f(y + c / 2)}L${f(x + c / 2)} ${f(y + c - g)}L${f(x + g)} ${f(y + c / 2)}Z`);
    }
  }
  const gx = cx, gy = cy + 5.3 * c;
  return `<g class="city" data-site="tokyo3" data-status="idle"><path class="city__ground" d="${ground.join('')}"/>`
    + `<circle class="city__ring" cx="${f(cx)}" cy="${f(cy)}" r="${f(5.4 * c)}"/>`
    + `<g class="glow"><path d="${blocks.join('')}"/>`
    + `<g class="geofront" data-site="geofront" data-status="idle">`
    + `<circle cx="${f(gx)}" cy="${f(gy)}" r="${f(c * 0.8)}"/><circle cx="${f(gx)}" cy="${f(gy)}" r="${f(c * 0.42)}"/></g></g>`
    + `<text class="city__name" x="${f(cx - 4 * c)}" y="${f(cy + 3.4 * c)}" text-anchor="end">${CITY.ja}</text>`
    + `<text class="city__en" x="${f(cx - 4 * c)}" y="${f(cy + 3.4 * c + 12)}" text-anchor="end">${CITY.en}</text></g>`;
}


/* ---------- SITES AND THE LIVE LAYER ----------
   Sites are drawn once, as groups that carry data-status. The live layer holds
   the parts that move: the route, the trail, the contact and the shots. It is
   drawn into every map, and script.js moves it each frame. */
function sites(view) {
  return SITES.map(s => {
    const mark = s.kind === 'battery'
      ? '<path class="site__mark" d="M0 -7L7 0L0 7L-7 0Z"/>'
      : '<circle class="site__mark" r="5.5"/>';
    return `<g class="site" data-site="${s.id}" data-kind="${s.kind}" data-status="idle" transform="translate(${f(view.x(s.at[0]))} ${f(view.y(s.at[1]))})">`
      + `<circle class="site__ring" r="14"/>${mark}`
      + `<text class="site__ja" x="12" y="-2">${s.ja}</text><text class="site__en" x="12" y="9">${s.en}</text></g>`;
  }).join('');
}

function liveLayer(key) {
  const big = key === 'hakone';
  const r = big ? 6 : 3.5;
  const shots = big ? SITES.filter(s => s.kind === 'battery').map(s => `<line class="shot" data-for="${s.id}"/>`).join('') : '';
  const label = big ? `<text class="contact__label" x="${r * 2 + 6}" y="3"><tspan lang="ja">未確認</tspan> UNKNOWN</text>` : '';
  return `<g class="live"><path class="route"/><path class="trail"/>${shots}`
    + `<g class="contact" data-active="false"><circle class="contact__ring" r="${r * 2}"/><circle class="contact__dot" r="${r}"/>${label}</g></g>`;
}


/* ---------- DRAW EVERYTHING ---------- */
const live = {};    // per map: its view and the live elements to move
function drawMaps() {
  document.querySelectorAll('.panel').forEach(panel => {
    const key = panel.dataset.region;
    const region = REGIONS[key];
    const svg = panel.querySelector('svg');
    const { w, h } = sizeOf(svg);
    const view = makeView(region, w, h);
    const geo = GEO[key];

    // Land maps get the hatched sea; the detailed map gets roads, rivers and peaks
    let body = geo.land ? coast(view, geo) : '';
    body += graticule(view, region);
    if (!geo.land) body += detail(view, geo) + city(view) + peaks(view, geo) + sites(view);
    body += places(view, key);
    if (region.next) body += marker(view, region.next);
    svg.innerHTML = body;

    // The moving parts get their own svg on top of the panel, so the contact
    // stays visible when it passes under the event log
    const top = svg.cloneNode(false);
    top.classList.add('live');
    top.innerHTML = liveLayer(key);
    panel.append(top);
    live[key] = {
      view,
      route: top.querySelector('.route'),
      trail: top.querySelector('.trail'),
      contact: top.querySelector('.contact'),
      shots: [...top.querySelectorAll('.shot')],
    };
  });
}


/* ---------- STRIP ----------
   The Tokyo-3 bars: up (green) and down (red) columns. A fixed formula rather
   than random numbers, so the picture is the same every load. */
function drawBars() {
  const svg = document.querySelector('#bars');
  const n = 40, mid = 28;
  const rnd = i => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
  let out = '';
  for (let i = 0; i < n; i++) {
    const up = 4 + rnd(i) * 22, down = 2 + rnd(i + 91) * 20;
    out += `<rect class="up" x="${i * 3}" y="${f(mid - up)}" width="2" height="${f(up)}"/>`
      + `<rect class="down" x="${i * 3}" y="${mid + 1}" width="2" height="${f(down)}"/>`;
  }
  svg.innerHTML = out;
}


/* ---------- SCENARIO ----------
   DETECT starts a run: an unknown contact appears at sea and crosses toward
   Tokyo-3 on a route from the bays or any compass bearing (see routeFrom). A list of timed events (the log
   lines) changes the sites as it goes: alert first, then the batteries fire,
   then it is either contained at the perimeter or breaches the city. The
   events are fixed in advance and fired by the clock each frame, as in the
   countdown studies, so a slow tab cannot make them drift.
   States, as in M-1: idle, running, resolved. */
const stage = document.querySelector('.screen');
const controls = document.querySelector('.controls');   // also the form
const originPick = document.querySelector('#pick-origin');
const outcomePick = document.querySelector('#pick-outcome');
const startBtn = document.querySelector('#start');
const resetBtn = document.querySelector('#reset');
const logEl = document.querySelector('#log');
const safeEl = document.querySelector('#safe');
const hqEl = document.querySelector('#hq');

// The EVA rows in the strip, with their starting words so reset can restore them
const units = {};
document.querySelectorAll('[data-unit]').forEach(el => {
  const word = el.querySelector('b');
  units[el.dataset.unit] = { el, word, status: el.dataset.status, text: word.textContent };
});

const SAFE = { idle: ['安全', 'SAFE'], alert: ['警戒', 'ALERT'], breach: ['危険', 'DANGER'] };
const RANK = { idle: 0, alert: 1, breach: 2 };

let state = 'idle';       // idle, running or resolved
let run = null;           // the scenario in progress
let frame = 0;


/* Sites and words */
function setSite(id, status) {
  document.querySelectorAll(`[data-site="${id}"]`).forEach(el => { el.dataset.status = status; });

  // The highest status anywhere is the level of the whole screen
  let top = 'idle';
  document.querySelectorAll('[data-site]').forEach(el => {
    if (RANK[el.dataset.status] > RANK[top]) top = el.dataset.status;
  });
  stage.dataset.level = top;

  if (id === 'tokyo3') {
    const ja = safeEl.querySelector('[lang="ja"]');
    safeEl.dataset.status = status;
    ja.textContent = SAFE[status][0];
    ja.nextSibling.textContent = ` ${SAFE[status][1]}`;
  }
}

function setUnit(id, status, text) {
  units[id].el.dataset.status = status;
  units[id].word.textContent = text;
}

function log(level, ja, en, t) {
  const li = document.createElement('li');
  li.dataset.level = level;
  li.innerHTML = `<time>T+00:${String(Math.floor(t)).padStart(2, '0')}</time>`
    + `<span class="log__ja" lang="ja">${ja}</span><span class="log__en">${en}</span>`;
  logEl.prepend(li);
  while (logEl.children.length > 8) logEl.lastElementChild.remove();
}


/* The contact. positionAt finds where it is at second t by walking its route. */
function positionAt(route, t) {
  if (t <= route[0].t) return route[0].at;
  for (let i = 1; i < route.length; i++) {
    if (t <= route[i].t) {
      const a = route[i - 1], b = route[i];
      const k = (t - a.t) / (b.t - a.t);
      return [a.at[0] + (b.at[0] - a.at[0]) * k, a.at[1] + (b.at[1] - a.at[1]) * k];
    }
  }
  return route[route.length - 1].at;
}

// Show or hide the contact, its expected route and its trail on every map
function showContact(on) {
  run.contactOn = on;
  for (const l of Object.values(live)) {
    l.contact.dataset.active = String(on);
    l.route.setAttribute('d', on ? path(l.view, run.origin.path.map(p => p.at)) : '');
    if (!on) {
      l.trail.setAttribute('d', '');
      l.shots.forEach(line => { line.dataset.on = 'false'; });
    }
  }
}

// Move the contact and the shots to where they are at second t
function draw(t) {
  const route = run.origin.path;
  const tm = Math.min(t, run.moveEnd);
  const here = positionAt(route, tm);
  const covered = route.filter(p => p.t < tm).map(p => p.at).concat([here]);

  for (const l of Object.values(live)) {
    const x = l.view.x(here[0]), y = l.view.y(here[1]);
    l.contact.setAttribute('transform', `translate(${f(x)} ${f(y)})`);
    l.trail.setAttribute('d', path(l.view, covered));

    // A battery fires while the contact is within range, which is in screen
    // pixels and so only means something on the Hakone map
    l.shots.forEach(line => {
      const site = SITES.find(s => s.id === line.dataset.for);
      const sx = l.view.x(site.at[0]), sy = l.view.y(site.at[1]);
      const on = run.firing && Math.hypot(sx - x, sy - y) < 360;
      line.dataset.on = String(on);
      if (on) {
        line.setAttribute('x1', f(sx)); line.setAttribute('y1', f(sy));
        line.setAttribute('x2', f(x));  line.setAttribute('y2', f(y));
      }
    });
  }
}


/* The timed events. t is the second each one happens; last ends the run. */
function buildEvents(origin, outcome) {
  const everyone = () => SITES.forEach(s => setSite(s.id, 'alert'));
  const events = [
    { t: 0,   level: 'alert', ja: '青パターン検出', en: 'PATTERN BLUE DETECTED',
      run: () => { showContact(true); setSite('tokyo3', 'alert'); } },
    { t: 1.2, level: 'alert', ja: '警報発令', en: 'ALERT ISSUED', run: everyone },
    { t: 3.5, level: 'alert', ja: `目標接近 ${origin.ja}`, en: `CONTACT APPROACHING FROM ${origin.en}`, run: () => {} },
    { t: 6.5, level: 'alert', ja: '目標防衛圏侵入', en: 'CONTACT ENTERS DEFENSE ZONE', run: () => {} },
    { t: 9,   level: 'alert', ja: '迎撃開始', en: 'DEFENSE BATTERIES FIRING',
      run: () => { run.firing = true; setUnit('eva02', 'sortie', 'SORTIE'); } },
  ];

  if (outcome === 'contained') {
    events.push(
      { t: 13,   level: 'idle', ja: '目標沈黙', en: 'CONTACT NEUTRALIZED',
        run: () => { run.firing = false; showContact(false); } },
      { t: 14.5, level: 'idle', ja: '警報解除', en: 'ALERT CLEARED', last: true,
        run: () => { SITES.forEach(s => setSite(s.id, 'idle')); setSite('tokyo3', 'idle'); setUnit('eva02', 'standby', 'STANDBY'); } },
    );
  } else {
    events.push(
      { t: 15,   level: 'breach', ja: '防衛線突破', en: 'PERIMETER BREACHED', run: () => setSite('tokyo3', 'breach') },
      { t: 16.5, level: 'breach', ja: 'ジオフロント封鎖', en: 'GEOFRONT SEALED',
        run: () => { setSite('geofront', 'breach'); hqEl.textContent = 'SEALED'; } },
      { t: 18.5, level: 'breach', ja: '初号機出撃', en: 'EVA-01 SORTIE', run: () => setUnit('eva01', 'sortie', 'SORTIE') },
      { t: 21,   level: 'alert',  ja: '目標沈黙', en: 'CONTACT NEUTRALIZED', last: true,
        run: () => { run.firing = false; showContact(false); } },
    );
  }
  return events;
}


/* Running it */
function setState(next) {
  state = next;
  stage.dataset.state = next;
  const busy = next === 'running';
  originPick.disabled = busy;
  outcomePick.disabled = busy;
  startBtn.disabled = busy;
  resetBtn.disabled = next === 'idle';
}

// Back to a quiet map: every site idle, the strip as it started, the log reset
function clearWorld() {
  cancelAnimationFrame(frame);
  for (const l of Object.values(live)) {
    l.contact.dataset.active = 'false';
    l.route.setAttribute('d', '');
    l.trail.setAttribute('d', '');
    l.shots.forEach(line => { line.dataset.on = 'false'; });
  }
  SITES.forEach(s => setSite(s.id, 'idle'));
  setSite('tokyo3', 'idle');
  setSite('geofront', 'idle');
  Object.values(units).forEach(u => { u.el.dataset.status = u.status; u.word.textContent = u.text; });
  hqEl.textContent = 'ONLINE';
  logEl.replaceChildren();
  run = null;
}

function start() {
  if (state === 'running') return;
  clearWorld();

  const origin = chooseOrigin(originPick.value);
  const outcome = outcomePick.value === 'auto' ? (Math.random() < 0.5 ? 'contained' : 'breach') : outcomePick.value;

  run = {
    origin, outcome, next: 0, firing: false, contactOn: false,
    moveEnd: outcome === 'breach' ? 15 : 13,     // the second the contact stops moving
    events: buildEvents(origin, outcome),
    t0: performance.now(),
  };
  setState('running');
  resetBtn.focus();                  // DETECT and the menus are now disabled
  frame = requestAnimationFrame(tick);
}

function tick(now) {
  // The first frame's timestamp can be a hair older than the start
  const t = Math.max(0, (now - run.t0) / 1000);

  while (run.next < run.events.length && run.events[run.next].t <= t) {
    const e = run.events[run.next++];
    log(e.level, e.ja, e.en, e.t);
    e.run();
    if (e.last) { setState('resolved'); return; }
  }
  if (run.contactOn) draw(t);
  frame = requestAnimationFrame(tick);
}

function reset(refocus = true) {
  clearWorld();
  log('idle', '待機中', 'SYSTEM STANDBY', 0);
  setState('idle');
  if (refocus) startBtn.focus();
}

controls.addEventListener('submit', e => {
  e.preventDefault();
  start();
});
resetBtn.addEventListener('click', () => reset());


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
drawBars();
reset(false);
controls.hidden = false;
