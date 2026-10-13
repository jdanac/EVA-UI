// Bakes map data into a static .js file the page can load with a <script> tag.
// Dev-time only: the pages never run this, and it uses only Node built-ins.
//
//   node tools/geo.mjs land   <name> <west> <south> <east> <north> [tolerance]
//       Land outline from Natural Earth (public domain). For overview regions.
//   node tools/geo.mjs detail <name> <west> <south> <east> <north>
//       Roads, rivers, water and peaks from OpenStreetMap through Overpass
//       (ODbL: the page must credit "OpenStreetMap contributors").
//
// Writes t-1/data/<name>.js containing:  GEO.<name> = { bbox, ... }
// Coordinates are [lon, lat], rounded to keep the files small.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 't-1', 'data');
const UA = 'eva-ui-study/0.1 (personal UI study; github jdanac/EVA-UI)';   // Overpass refuses requests without one

const [mode, name, ...rest] = process.argv.slice(2);
const [west, south, east, north] = rest.slice(0, 4).map(Number);
if (!mode || !name || [west, south, east, north].some(Number.isNaN)) {
  console.error('usage: node tools/geo.mjs land|detail <name> <west> <south> <east> <north> [tolerance]');
  process.exit(1);
}
const bbox = [west, south, east, north];

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
const touches = ring => ring.some(([x, y]) => x >= west - 1 && x <= east + 1 && y >= south - 1 && y <= north + 1);

// Douglas-Peucker: drop points that sit within `tol` degrees of the straight line
function simplify(points, tol) {
  if (points.length < 3) return points;
  const [ax, ay] = points[0], [bx, by] = points[points.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
  let far = 0, at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs(dy * (points[i][0] - ax) - dx * (points[i][1] - ay)) / len;
    if (d > far) { far = d; at = i; }
  }
  if (far <= tol) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, at + 1), tol).slice(0, -1), ...simplify(points.slice(at), tol)];
}

// Sutherland-Hodgman: cut a ring to the box (with a margin, so edges are never visible)
function clipRing(ring, [x0, y0, x1, y1]) {
  const edges = [
    [p => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
    [p => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [p => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]],
    [p => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]],
  ];
  let pts = ring;
  for (const [inside, cut] of edges) {
    const next = [];
    pts.forEach((cur, i) => {
      const prev = pts[(i + pts.length - 1) % pts.length];
      if (inside(cur)) { if (!inside(prev)) next.push(cut(prev, cur)); next.push(cur); }
      else if (inside(prev)) next.push(cut(prev, cur));
    });
    pts = next;
    if (!pts.length) break;
  }
  return pts;
}

async function land() {
  const tol = Number(rest[4]) || 0.002;
  const url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson';
  const geo = await (await fetch(url, { headers: { 'User-Agent': UA } })).json();
  const rings = [];
  for (const f of geo.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        if (!touches(ring)) continue;
        const cut = clipRing(ring, [west - 1, south - 1, east + 1, north + 1]);
        if (cut.length < 4) continue;
        // A ring ends where it starts, so a straight start-to-end line has no
        // length to measure against. Simplify the two halves separately.
        const mid = cut.length >> 1;
        const s = [...simplify(cut.slice(0, mid + 1), tol).slice(0, -1), ...simplify(cut.slice(mid), tol)];
        if (s.length >= 4) rings.push(s.map(([x, y]) => [round(x, 3), round(y, 3)]));
      }
    }
  }
  return { bbox, land: rings };
}

async function detail() {
  const b = `(${south},${west},${north},${east})`;
  const query = `[out:json][timeout:90];(
    way["highway"~"motorway|trunk|primary|secondary|tertiary"]${b};
    way["waterway"~"river|stream"]${b};
    way["natural"="water"]${b};
    relation["natural"="water"]${b};
    way["railway"="rail"]${b};
  );out geom;node["natural"="peak"]["name"]${b};out;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass answered ${res.status}`);
  const { elements } = await res.json();

  // Rounded to 4 places (about 10 m) and thinned, which is plenty at this scale
  const pts = g => simplify(g.map(p => [round(p.lon, 4), round(p.lat, 4)]), 0.00004);
  const out = { bbox, roads: [], rivers: [], rails: [], water: [], peaks: [] };
  for (const e of elements) {
    const t = e.tags || {};
    if (e.type === 'node') {
      out.peaks.push({ lon: round(e.lon, 5), lat: round(e.lat, 5), ele: Number(t.ele) || null, ja: t['name:ja'] || t.name, en: t['name:en'] || null });
    } else if (e.type === 'way' && t.highway) {
      out.roads.push({ c: t.highway, p: pts(e.geometry) });
    } else if (e.type === 'way' && t.waterway) {
      out.rivers.push({ c: t.waterway, p: pts(e.geometry) });
    } else if (e.type === 'way' && t.railway) {
      out.rails.push({ p: pts(e.geometry) });
    } else if (t.natural === 'water') {
      // A lake is a closed way, or a relation whose outline is split over several ways
      // (stitched into rings by the page, since only the page knows how it draws them)
      if (e.type === 'way') out.water.push({ ways: [pts(e.geometry)] });
      else out.water.push({ ways: e.members.filter(m => m.role === 'outer' && m.geometry).map(m => pts(m.geometry)) });
    }
  }
  return out;
}

const data = mode === 'land' ? await land() : await detail();
mkdirSync(OUT, { recursive: true });
const file = join(OUT, `${name}.js`);
writeFileSync(file, `// Generated by tools/geo.mjs ${mode} ${name} ${bbox.join(' ')}. Do not edit by hand.\n` +
  `${mode === 'detail' ? '// Contains OpenStreetMap data (c) OpenStreetMap contributors, ODbL.\n' : '// Natural Earth, public domain.\n'}` +
  `window.GEO = window.GEO || {};\nGEO[${JSON.stringify(name)}] = ${JSON.stringify(data)};\n`);
const counts = Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k} ${v.length}`).join(', ');
console.log(`${file}\n  ${counts}`);
