/* =========================================================
   G-1 RADAR DEFENSE: THE RULES
   Everything that decides what happens, and nothing that draws it. There is no
   DOM here and no clock of its own: script.js calls step(dt) with a small fixed
   dt and reads the result, so the same seed plays out the same way every time
   (which is also what lets sim.test.mjs check it without a browser).

   Units: kilometers on a flat plane with Tokyo-3 at (0, 0), x east, y north.
   The sim knows nothing about longitude, latitude or pixels; script.js converts.
   A bearing is degrees clockwise from north, as on a compass.

   Steps 1 and 2 of the spec: contacts spawn and fly at the city; the player
   engages them from three batteries with limited ammo; a contact that reaches
   the city costs population. Waves, resupply and winning come in step 3.
   ========================================================= */

const SIM = (() => {
  const STEP = 1 / 30;        // seconds per sim step; script.js runs the sim in whole steps of this
  const SPAWN_KM = 40;        // contacts appear this far from the city
  const SCOPE_KM = 24.5;      // radius of the main radar scope
  const CITY_KM = 2;          // a contact this close to the city has hit it
  const SECTOR = [100, 230];  // bearings the sea is on (east, round to south-west)
  const START_POPULATION = 891285;

  // Placeholder numbers, to be tuned. speed is km per second; damage is the
  // population lost if the contact reaches the city.
  const KINDS = {
    SCOUT:    { ja: '小型', speed: 1.2, hp: 50,  damage: 40000 },
    STANDARD: { ja: '標準', speed: 0.8, hp: 100, damage: 120000 },
    HEAVY:    { ja: '大型', speed: 0.5, hp: 200, damage: 300000 },
  };

  // The three batteries, in km from the city: the positions of T-1's north,
  // south and east batteries, converted once.
  const BATTERIES = [
    { id: 'north', x: -4.55, y: 1.66 },
    { id: 'south', x: 2.27,  y: -3.65 },
    { id: 'east',  x: 4.55,  y: -2.32 },
  ];
  const RANGE_KM = 12;        // how far a battery can fire
  const MAGAZINE = 6;         // rounds before a reload
  const COOLDOWN = 1.5;       // seconds between one battery's shots
  const RELOAD = 10;          // seconds to reload an empty battery
  const SHOT_KMS = 6;         // how fast a round flies, so it lands after d / 6 seconds
  const SHOT_DAMAGE = 50;     // hull points a hit takes off

  // Chance a round hits: 85% at 4 km or closer, falling in a straight line to
  // 35% at the edge of the range. null beyond the range.
  function hitChance(d) {
    if (d > RANGE_KM) return null;
    if (d <= 4) return 0.85;
    return 0.85 - (0.85 - 0.35) * (d - 4) / (RANGE_KM - 4);
  }

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
    const shots = [];         // rounds in the air
    const batteries = BATTERIES.map(b => ({ ...b, rounds: MAGAZINE, cooldown: 0, reload: 0 }));
    let events = [];          // what happened since the UI last asked
    let time = 0;
    let serial = 0;
    let shotSerial = 0;
    let population = START_POPULATION;

    const dist = c => Math.hypot(c.x, c.y);
    const eta = c => c.state === 'inbound' ? Math.max(0, (dist(c) - CITY_KM) / c.speed) : 0;
    const reach = (b, c) => Math.hypot(c.x - b.x, c.y - b.y);
    const ready = b => b.rounds > 0 && b.cooldown <= 0 && b.reload <= 0;
    const stateOf = b => b.reload > 0 ? 'reloading' : b.cooldown > 0 ? 'cooling' : 'ready';

    function spawn(kind, bearing) {
      const k = KINDS[kind];
      if (!k) throw new Error(`unknown contact kind: ${kind}`);
      const th = bearing * Math.PI / 180;
      const sin = Math.sin(th), cos = Math.cos(th);
      const c = {
        id: `C-${String(++serial).padStart(2, '0')}`,
        kind, bearing, speed: k.speed, hp: k.hp, maxHp: k.hp,
        x: sin * SPAWN_KM, y: cos * SPAWN_KM,
        vx: -sin * k.speed, vy: -cos * k.speed,    // straight at the city
        state: 'inbound',      // inbound, destroyed or impact
        onScope: false,
        born: time,
      };
      contacts.push(c);
      events.push({ type: 'spawn', id: c.id, t: time });
      return c;
    }

    // A random bearing inside the sea sector
    const spawnRandom = kind => spawn(kind, SECTOR[0] + random() * (SECTOR[1] - SECTOR[0]));

    // What firing at a contact would do right now, without firing:
    //   inRange  batteries within range, whether or not they can fire this moment
    //   battery  the one that would fire (nearest of those ready), or null
    //   chance   its hit chance; with none ready, the best chance among those in range
    function aim(c) {
      if (!c || c.state !== 'inbound') return { inRange: [], battery: null, chance: null };
      const inRange = batteries.filter(b => reach(b, c) <= RANGE_KM);
      const usable = inRange.filter(ready).sort((a, b) => reach(a, c) - reach(b, c));
      const best = usable[0] || inRange.slice().sort((a, b) => reach(a, c) - reach(b, c))[0] || null;
      return { inRange, battery: usable[0] || null, chance: best ? hitChance(reach(best, c)) : null };
    }

    // The player's one action: fire a round at a contact. Returns { ok: true,
    // battery } or { ok: false, reason } ('target': nothing to fire at, 'range':
    // no battery reaches it, 'busy': some do but none can fire yet). A refusal is
    // also an event, so the log can say why nothing happened.
    function engage(id) {
      const c = contacts.find(x => x.id === id);
      const refuse = reason => {
        events.push({ type: 'refused', id, reason, t: time });
        return { ok: false, reason };
      };
      if (!c || c.state !== 'inbound') return refuse('target');
      const { inRange, battery } = aim(c);
      if (!inRange.length) return refuse('range');
      if (!battery) return refuse('busy');

      const d = reach(battery, c);
      const chance = hitChance(d);
      battery.rounds--;
      battery.cooldown = COOLDOWN;
      if (battery.rounds === 0) battery.reload = RELOAD;
      shots.push({
        id: ++shotSerial, battery: battery.id, target: c.id,
        t0: time, t1: time + d / SHOT_KMS,
        hit: random() < chance,       // rolled now, shown when the round lands
      });
      events.push({ type: 'fire', id: c.id, battery: battery.id, chance, t: time });
      return { ok: true, battery: battery.id };
    }

    function land(s) {
      const c = contacts.find(x => x.id === s.target);
      if (c.state !== 'inbound') {
        events.push({ type: 'wasted', id: c.id, battery: s.battery, t: time });
      } else if (!s.hit) {
        events.push({ type: 'miss', id: c.id, battery: s.battery, x: c.x, y: c.y, t: time });
      } else {
        c.hp = Math.max(0, c.hp - SHOT_DAMAGE);
        events.push({ type: 'hit', id: c.id, battery: s.battery, hp: c.hp, maxHp: c.maxHp, x: c.x, y: c.y, t: time });
        if (c.hp === 0) {
          c.state = 'destroyed';
          events.push({ type: 'destroyed', id: c.id, x: c.x, y: c.y, t: time });
        }
      }
    }

    function step(dt) {
      time += dt;

      for (const b of batteries) {
        b.cooldown = Math.max(0, b.cooldown - dt);
        if (b.reload > 0) {
          b.reload = Math.max(0, b.reload - dt);
          if (b.reload === 0) b.rounds = MAGAZINE;
        }
      }

      // Rounds that land this step do so before the contacts move, so a round
      // due at the instant of impact still counts
      for (let i = shots.length - 1; i >= 0; i--) {
        if (shots[i].t1 <= time) land(shots.splice(i, 1)[0]);
      }

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
          const lost = Math.min(population, KINDS[c.kind].damage);
          population -= lost;
          events.push({ type: 'impact', id: c.id, damage: lost, population, t: time });
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
      spawn, spawnRandom, step, takeEvents, engage, aim, dist, eta,
      contacts, shots, batteries,
      stateOf, reach,
      get time() { return time; },
      get population() { return population; },
      inbound: () => contacts.filter(c => c.state === 'inbound').sort((a, b) => eta(a) - eta(b)),
    };
  }

  return {
    create, hitChance, KINDS, BATTERIES, STEP, SPAWN_KM, SCOPE_KM, CITY_KM, SECTOR,
    RANGE_KM, MAGAZINE, COOLDOWN, RELOAD, SHOT_KMS, SHOT_DAMAGE, START_POPULATION,
  };
})();

// Node (the test file) loads this through require; a browser has no `module`
if (typeof module !== 'undefined') module.exports = SIM;
