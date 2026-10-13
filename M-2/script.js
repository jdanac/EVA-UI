/* =========================================================
   NGE TACTICAL MAP STUDY: BEHAVIOR
   Draws three nested maps as SVG from the data baked by tools/geo.mjs
   (data/*.js define GEO.japan, GEO.kanto and GEO.hakone). CSS owns every color
   and line width; this file only writes shapes and gives them class names.

   The drawing code knows nothing about any one place. A region is just a
   center and a width in degrees, so showing somewhere else means adding an
   entry to REGIONS and baking its data.
   Read top to bottom: regions, projection, drawing, Tokyo-3, strip, fit.
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
  return `<g class="city"><path class="city__ground" d="${ground.join('')}"/>`
    + `<g class="glow"><path d="${blocks.join('')}"/>`
    + `<circle cx="${f(gx)}" cy="${f(gy)}" r="${f(c * 0.8)}"/><circle cx="${f(gx)}" cy="${f(gy)}" r="${f(c * 0.42)}"/></g>`
    + `<text class="city__name" x="${f(cx + 5.2 * c)}" y="${f(cy - 2.2 * c)}">${CITY.ja}</text>`
    + `<text class="city__en" x="${f(cx + 5.2 * c)}" y="${f(cy - 2.2 * c + 12)}">${CITY.en}</text></g>`;
}


/* ---------- DRAW EVERYTHING ---------- */
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
    if (!geo.land) body += detail(view, geo) + city(view) + peaks(view, geo);
    body += places(view, key);
    if (region.next) body += marker(view, region.next);
    svg.innerHTML = body;
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
