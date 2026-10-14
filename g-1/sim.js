/* =========================================================
   G-1 RADAR DEFENSE: THE RULES
   Everything that decides what happens, and nothing that draws it. There is no
   DOM here and no clock of its own: script.js calls step(dt) with a small fixed
   dt and reads the result, so the same seed plays out the same way every time
   (which is also what lets sim.test.mjs check it without a browser).

   Units: kilometers on a flat plane with Tokyo-3 at (0, 0), x east, y north.
   The sim knows nothing about longitude, latitude or pixels; script.js converts.
   A bearing is degrees clockwise from north, as on a compass.

   Step 1 of the spec: contacts spawn, cross the scope and reach the city.
   Firing, ammo and waves come in the next steps.
   ========================================================= */

const SIM = (() => {
  const STEP = 1 / 30;        // seconds per sim step; script.js runs the sim in whole steps of this
  const SPAWN_KM = 40;        // contacts appear this far from the city
  const SCOPE_KM = 24.5;      // radius of the main radar scope
  const CITY_KM = 2;          // a contact this close to the city has hit it
  const SECTOR = [100, 230];  // bearings the sea is on (east, round to south-west)

  // Placeholder numbers, to be tuned. speed is km per second.
  const KINDS = {
    SCOUT:    { ja: '小型', speed: 1.2, hp: 50 },
    STANDARD: { ja: '標準', speed: 0.8, hp: 100 },
    HEAVY:    { ja: '大型', speed: 0.5, hp: 200 },
  };

  // A small seeded random generator (mulberry32): the same seed gives the same
  // sequence, unlike Math.random
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function create(seed = 1) {
    const random = seeded(seed);
    const contacts = [];      // every contact so far, including finished ones
    let events = [];          // what happened since the UI last asked
    let time = 0;
    let serial = 0;

    const dist = c => Math.hypot(c.x, c.y);
    const eta = c => c.state === 'inbound' ? Math.max(0, (dist(c) - CITY_KM) / c.speed) : 0;

    function spawn(kind, bearing) {
      const k = KINDS[kind];
      if (!k) throw new Error(`unknown contact kind: ${kind}`);
      const th = bearing * Math.PI / 180;
      const sin = Math.sin(th), cos = Math.cos(th);
      const c = {
        id: `C-${String(++serial).padStart(2, '0')}`,
        kind, bearing, speed: k.speed, hp: k.hp,
        x: sin * SPAWN_KM, y: cos * SPAWN_KM,
        vx: -sin * k.speed, vy: -cos * k.speed,    // straight at the city
        state: 'inbound',
        onScope: false,
        born: time,
      };
      contacts.push(c);
      events.push({ type: 'spawn', id: c.id, t: time });
      return c;
    }

    // A random bearing inside the sea sector
    const spawnRandom = kind => spawn(kind, SECTOR[0] + random() * (SECTOR[1] - SECTOR[0]));

    function step(dt) {
      time += dt;
      for (const c of contacts) {
        if (c.state !== 'inbound') continue;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        const d = dist(c);
        if (!c.onScope && d <= SCOPE_KM) {
          c.onScope = true;
          events.push({ type: 'scope', id: c.id, t: time });
        }
        if (d <= CITY_KM) {
          // Stop at the edge of the city rather than the point the step overshot to
          c.x *= CITY_KM / d;
          c.y *= CITY_KM / d;
          c.state = 'impact';
          events.push({ type: 'impact', id: c.id, t: time });
        }
      }
    }

    // The events since the last call, oldest first; the list starts again empty
    function takeEvents() {
      const out = events;
      events = [];
      return out;
    }

    return {
      spawn, spawnRandom, step, takeEvents, dist, eta,
      contacts,
      get time() { return time; },
      inbound: () => contacts.filter(c => c.state === 'inbound').sort((a, b) => eta(a) - eta(b)),
    };
  }

  return { create, KINDS, STEP, SPAWN_KM, SCOPE_KM, CITY_KM, SECTOR };
})();

// Node (the test file) loads this through require; a browser has no `module`
if (typeof module !== 'undefined') module.exports = SIM;
