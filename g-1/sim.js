/* =========================================================
   G-1 RADAR DEFENSE: THE RULES
   Everything that decides what happens, and nothing that draws it. There is no
   DOM here and no clock of its own: script.js calls step(dt) with a small fixed
   dt and reads the result, so the same seed plays out the same way every time
   (which is also what lets sim.test.mjs and arena.mjs run it without a browser).

   Units: kilometers on a flat plane with Tokyo-3 at (0, 0), x east, y north.
   The sim knows nothing about longitude, latitude or pixels; script.js converts.
   A bearing is degrees clockwise from north, as on a compass.

   Milestone A of SPEC.md: the player gives fire orders (a battery is on HOLD or
   ASSIGNED to a contact, and fires by itself when it can), a RAIDER goes for a
   battery instead of the city, and the Geofront has an integrity that surface
   impacts wear down. At zero it is breached and the run is over. There are two
   weapons: GUNs (long range, slow heavy shells) and AA (short range, quick
   light bursts), each with its own ammunition pool. Rounds are aimed at where
   the contact will be, not where it is.
   ========================================================= */

const SIM = (() => {
  const STEP = 1 / 30;        // seconds per sim step; script.js runs the sim in whole steps of this
  const SPAWN_KM = 40;        // contacts appear this far from the city
  const SCOPE_KM = 24.5;      // radius of the main radar scope
  const CITY_KM = 2;          // a contact this close to the city has hit it
  const RAID_KM = 0.5;        // a raider this close to its battery has hit it
  const SECTOR = [100, 230];  // bearings the sea is on (east, round to south-west)
  const START_POPULATION = 891285;
  const INTEGRITY = 100;      // the Geofront's, at the start; zero is a breach

  // Placeholder numbers, to be tuned in the arena. speed is km per second;
  // damage is the population lost if the contact reaches the city, and
  // integrity what it costs the Geofront. A raider flies at a battery instead.
  // SCOUT sits out milestone A (SPEC.md) but is kept so it can come back.
  const KINDS = {
    SCOUT:    { ja: '小型', speed: 0.9,   hp: 50,  armor: 0,  damage: 40000,  integrity: 5 },
    STANDARD: { ja: '標準', speed: 0.6,   hp: 100, armor: 0,  damage: 120000, integrity: 15 },
    HEAVY:    { ja: '大型', speed: 0.375, hp: 270, armor: 10, damage: 300000, integrity: 40 },
    RAIDER:   { ja: '襲撃', speed: 1.05,  hp: 50,  armor: 0,  damage: 0,      integrity: 0, raider: true },
  };
  // A hit takes its weapon's damage minus the contact's armor (at least 1), so a
  // light round is nearly useless against a HEAVY

  // The two weapons. range in km; cooldown in seconds between one battery's
  // shots; damage per hit; round speed in km/s; each type draws on a pool of
  // its own (size, and seconds per round back). Placeholders, tuned in the arena.
  const WEAPONS = {
    GUN: { ja: '砲台', range: 12, cooldown: 1.5, damage: 50, roundKms: 6,  pool: 36,  resupply: 5 },
    AA:  { ja: '対空', range: 6,  cooldown: 0.4, damage: 8,  roundKms: 15, pool: 150, resupply: 0.25 },
  };

  // The batteries, in km from the city. The three guns are the positions of
  // T-1's north, south and east batteries, converted once. name is what the
  // screen calls the site.
  const BATTERIES = [
    { id: 'north', type: 'GUN', name: 'NORTH', ja: '北部砲台', x: -4.55, y: 1.66 },
    { id: 'south', type: 'GUN', name: 'SOUTH', ja: '南部砲台', x: 2.27,  y: -3.65 },
    { id: 'east',  type: 'GUN', name: 'EAST',  ja: '東部砲台', x: 4.55,  y: -2.32 },
    // Three AA sites out on the approaches. Short range, so each guards its own
    // patch of the approach, and each is also a raider's target.
    { id: 'aa1', type: 'AA', name: 'AA-1', ja: '第一対空', x: 7.0,  y: -4.9 },
    { id: 'aa2', type: 'AA', name: 'AA-2', ja: '第二対空', x: 1.6,  y: -8.4 },
    { id: 'aa3', type: 'AA', name: 'AA-3', ja: '第三対空', x: -5.4, y: -7.0 },
  ];
  const RETARGET = 2.5;       // seconds from a new assignment to the first shot
  const SILENCED = 20;        // seconds a battery is out after a raider reaches it

  // Chance a round hits, from the distance to the contact when it is fired and
  // that contact's speed; null beyond the weapon's range.
  //   GUN  85% at 4 km or closer, falling in a straight line to 20% at its 12 km
  //        range, so firing early wastes shells. Fast contacts dodge: the chance
  //        is x1 up to 0.6 km/s, falling to x0.5 at 1.2 km/s. That is a rule,
  //        not physics: the round is aimed correctly, the contact evades.
  //   AA   80% to 3 km, falling to 50% at 6 km. Quick rounds, so no dodging.
  function hitChance(weapon, d, speed = 0) {
    const w = WEAPONS[weapon];
    if (d > w.range) return null;
    if (weapon === 'AA') return d <= 3 ? 0.80 : 0.80 - 0.30 * (d - 3) / (w.range - 3);
    const base = d <= 4 ? 0.85 : 0.85 - 0.65 * (d - 4) / (w.range - 4);
    return base * (1 - 0.5 * Math.min(1, Math.max(0, (speed - 0.6) / 0.6)));
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

  // The run: [time in seconds, kind], escalating. Until waves (C4) exist this
  // is the whole game, and the arena plays the same one, so a person's run of
  // ?seed=N can be set against the bots' run of seed N.
  const SCHEDULE = [
    [0, 'STANDARD'],
    [15, 'STANDARD'], [18, 'RAIDER'],
    [35, 'HEAVY'], [40, 'STANDARD'],
    [60, 'STANDARD'], [62, 'STANDARD'], [65, 'RAIDER'],
    [85, 'HEAVY'], [88, 'STANDARD'], [90, 'RAIDER'], [92, 'STANDARD'],
    [115, 'HEAVY'], [116, 'HEAVY'], [120, 'STANDARD'], [122, 'RAIDER'], [124, 'STANDARD'],
    [145, 'HEAVY'], [146, 'STANDARD'], [147, 'STANDARD'], [149, 'RAIDER'], [150, 'RAIDER'], [152, 'HEAVY'],
  ];

  // The schedule for one seed, with a bearing in the sea sector for each entry,
  // from a stream of its own: { t, kind, bearing }, in time order. Whoever runs
  // the sim spawns each entry when sim.time reaches its t.
  function schedule(seed) {
    const random = seeded(seed ^ 0x51ED);
    return SCHEDULE.map(([t, kind]) => ({ t, kind, bearing: SECTOR[0] + random() * (SECTOR[1] - SECTOR[0]) }));
  }

  function create(seed = 1) {
    // Two random streams from one seed: one for where contacts come from (and
    // which battery a raider picks), one for whether rounds hit. Kept apart so
    // the player's firing can never change what comes next, which would make
    // two runs of one seed incomparable.
    const spawnStream = seeded(seed);
    const hitRandom = seeded(seed ^ 0x9E3779B9);
    const contacts = [];      // every contact so far, including finished ones
    const shots = [];         // rounds in the air
    const batteries = BATTERIES.map(b => ({ ...b, target: null, retarget: 0, cooldown: 0, silenced: 0 }));
    let events = [];          // what happened since the UI last asked
    let time = 0;
    let serial = 0;
    let shotSerial = 0;
    let population = START_POPULATION;
    let integrity = INTEGRITY;
    // One pool of rounds per weapon type, and the seconds toward the next round back
    const ammo = Object.fromEntries(Object.entries(WEAPONS).map(([k, w]) => [k, w.pool]));
    const supply = Object.fromEntries(Object.keys(WEAPONS).map(k => [k, 0]));
    let breached = false;

    const find = id => contacts.find(c => c.id === id);
    const battery = id => batteries.find(b => b.id === id);
    const dist = c => Math.hypot(c.x, c.y);
    const reach = (b, c) => Math.hypot(c.x - b.x, c.y - b.y);
    // How far a contact is from what it is flying at, and how close counts as there
    const toGoal = c => Math.hypot(c.x - c.gx, c.y - c.gy);
    const stopAt = c => c.objective === 'city' ? CITY_KM : RAID_KM;
    const eta = c => c.state === 'inbound' ? Math.max(0, (toGoal(c) - stopAt(c)) / c.speed) : 0;

    // What a battery is doing, for the screen and the bots:
    //   silenced  a raider reached it; it cannot fire or take orders
    //   hold      no target
    //   retarget  a new target, still swinging onto it
    //   range     on target, but the target is out of its reach
    //   dry       on target and in reach, but its pool is empty
    //   cooling   just fired
    //   ready     will fire this step
    function stateOf(b) {
      if (b.silenced > 0) return 'silenced';
      if (!b.target) return 'hold';
      if (b.retarget > 0) return 'retarget';
      const c = find(b.target);
      if (reach(b, c) > WEAPONS[b.type].range) return 'range';
      if (ammo[b.type] < 1) return 'dry';
      if (b.cooldown > 0) return 'cooling';
      return 'ready';
    }

    // A contact flies from a bearing at its objective: the city, or for a
    // raider one of the batteries (given, or picked from the spawn stream)
    function spawn(kind, bearing, objective) {
      const k = KINDS[kind];
      if (!k) throw new Error(`unknown contact kind: ${kind}`);
      if (k.raider && !objective) objective = BATTERIES[Math.floor(spawnStream() * BATTERIES.length)].id;
      if (!k.raider) objective = 'city';
      const goal = objective === 'city' ? { x: 0, y: 0 } : battery(objective);
      if (!goal) throw new Error(`unknown objective: ${objective}`);
      const th = bearing * Math.PI / 180;
      const x = Math.sin(th) * SPAWN_KM, y = Math.cos(th) * SPAWN_KM;
      const d = Math.hypot(goal.x - x, goal.y - y);
      const c = {
        id: `C-${String(++serial).padStart(2, '0')}`,
        kind, bearing, objective, speed: k.speed, hp: k.hp, maxHp: k.hp,
        x, y, gx: goal.x, gy: goal.y,
        vx: (goal.x - x) / d * k.speed, vy: (goal.y - y) / d * k.speed,
        state: 'inbound',      // inbound, destroyed or impact
        onScope: false,
        born: time,
      };
      contacts.push(c);
      events.push({ type: 'spawn', id: c.id, t: time });
      return c;
    }

    // A random bearing inside the sea sector
    const spawnRandom = kind => spawn(kind, SECTOR[0] + spawnStream() * (SECTOR[1] - SECTOR[0]));

    // The hit chance a battery would have on a contact right now, or null out of range
    const chanceOf = (b, c) => hitChance(b.type, reach(b, c), c.speed);

    // Where a round fired now meets a contact that keeps its course: the point
    // P on its path, and the time t, such that the round (speed s from the
    // battery) and the contact both reach P at t. Always solvable, since every
    // round is faster than every contact: |r + v t| = s t is a quadratic in t.
    function intercept(b, c, s) {
      const rx = c.x - b.x, ry = c.y - b.y;
      const rv = rx * c.vx + ry * c.vy, rr = rx * rx + ry * ry, vv = c.vx * c.vx + c.vy * c.vy;
      const t = (rv + Math.sqrt(rv * rv + (s * s - vv) * rr)) / (s * s - vv);
      return { t, x: c.x + c.vx * t, y: c.y + c.vy * t };
    }

    // An order: put a battery on a contact. A new target starts the retarget
    // delay; giving the same target again changes nothing. Returns { ok: true }
    // or { ok: false, reason } ('battery' unknown, 'silenced', 'target' gone),
    // and a refusal is an event too, so the log can say why.
    function assign(batteryId, contactId) {
      const b = battery(batteryId), c = find(contactId);
      const refuse = reason => {
        events.push({ type: 'refused', battery: batteryId, id: contactId, reason, t: time });
        return { ok: false, reason };
      };
      if (!b) return refuse('battery');
      if (b.silenced > 0) return refuse('silenced');
      if (!c || c.state !== 'inbound') return refuse('target');
      if (b.target === c.id) return { ok: true };
      b.target = c.id;
      b.retarget = RETARGET;
      events.push({ type: 'assign', battery: b.id, id: c.id, t: time });
      return { ok: true };
    }

    // The other order: stop. Holding a battery that is already holding does nothing.
    function hold(batteryId) {
      const b = battery(batteryId);
      if (!b || !b.target) return;
      events.push({ type: 'hold', battery: b.id, id: b.target, t: time });
      b.target = null;
      b.retarget = 0;
    }

    // A round flies a straight line from the battery to where the contact will
    // be (from -> to), arriving at t1. Whether it hits is rolled now and shown then.
    function fire(b, c) {
      const w = WEAPONS[b.type];
      const chance = chanceOf(b, c);
      const aim = intercept(b, c, w.roundKms);
      ammo[b.type]--;
      b.cooldown = w.cooldown;
      shots.push({
        id: ++shotSerial, battery: b.id, weapon: b.type, target: c.id,
        t0: time, t1: time + aim.t,
        from: { x: b.x, y: b.y }, to: { x: aim.x, y: aim.y },
        damage: w.damage,
        hit: hitRandom() < chance,
      });
      events.push({ type: 'fire', id: c.id, battery: b.id, weapon: b.type, chance, ammo: ammo[b.type], t: time });
    }

    // Where a round that missed lands: a little to one side of the contact (the
    // side and distance come from the shot's number, so no random draw is used)
    function missPoint(s, c) {
      const dx = s.to.x - s.from.x, dy = s.to.y - s.from.y, len = Math.hypot(dx, dy) || 1;
      const side = s.id % 2 ? 1 : -1, off = 0.4 + 0.1 * (s.id % 5);
      return { x: c.x - dy / len * side * off, y: c.y + dx / len * side * off };
    }

    function land(s) {
      const c = find(s.target);
      if (c.state !== 'inbound') {
        events.push({ type: 'wasted', id: c.id, battery: s.battery, t: time });
      } else if (!s.hit) {
        const m = missPoint(s, c);
        events.push({ type: 'miss', id: c.id, battery: s.battery, x: m.x, y: m.y, t: time });
      } else {
        c.hp = Math.max(0, c.hp - Math.max(1, s.damage - KINDS[c.kind].armor));
        events.push({ type: 'hit', id: c.id, battery: s.battery, hp: c.hp, maxHp: c.maxHp, x: c.x, y: c.y, t: time });
        if (c.hp === 0) {
          c.state = 'destroyed';
          events.push({ type: 'destroyed', id: c.id, x: c.x, y: c.y, t: time });
        }
      }
    }

    // A contact reached what it was flying at
    function arrive(c) {
      c.state = 'impact';
      if (c.objective !== 'city') {
        const b = battery(c.objective);
        b.silenced = SILENCED;
        b.target = null;
        b.retarget = 0;
        events.push({ type: 'silenced', id: c.id, battery: b.id, t: time });
        return;
      }
      const k = KINDS[c.kind];
      const lost = Math.min(population, k.damage);
      population -= lost;
      integrity = Math.max(0, integrity - k.integrity);
      events.push({ type: 'impact', id: c.id, damage: lost, population, integrity, t: time });
      if (integrity === 0) {
        breached = true;
        events.push({ type: 'breach', id: c.id, t: time });
      }
    }

    function step(dt) {
      if (breached) return;      // the run is over
      time += dt;

      for (const b of batteries) {
        b.cooldown = Math.max(0, b.cooldown - dt);
        b.retarget = Math.max(0, b.retarget - dt);
        if (b.silenced > 0) {
          b.silenced = Math.max(0, b.silenced - dt);
          if (b.silenced === 0) events.push({ type: 'restored', battery: b.id, t: time });
        }
      }

      for (const [type, w] of Object.entries(WEAPONS)) {
        supply[type] += dt;
        while (supply[type] >= w.resupply) {
          supply[type] -= w.resupply;
          if (ammo[type] < w.pool) ammo[type]++;
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
        if (!c.onScope && dist(c) <= SCOPE_KM) {
          c.onScope = true;
          events.push({ type: 'scope', id: c.id, t: time });
        }
        const d = toGoal(c), stop = stopAt(c);
        if (d <= stop) {
          // Stop at the edge of the objective rather than the point the step overshot to
          c.x = c.gx + (c.x - c.gx) * stop / d;
          c.y = c.gy + (c.y - c.gy) * stop / d;
          arrive(c);
          if (breached) return;
        }
      }

      // Assigned batteries whose target is finished go back to HOLD by
      // themselves (never to a new target: that is the player's call), and the
      // rest fire when they can, in a fixed order so a seed repeats
      for (const b of batteries) {
        if (!b.target) continue;
        const c = find(b.target);
        if (c.state !== 'inbound') {
          events.push({ type: 'released', battery: b.id, id: c.id, t: time });
          b.target = null;
          b.retarget = 0;
          continue;
        }
        if (stateOf(b) === 'ready') fire(b, c);
      }
    }

    // The events since the last call, oldest first; the list starts again empty
    function takeEvents() {
      const out = events;
      events = [];
      return out;
    }

    return {
      spawn, spawnRandom, step, takeEvents, assign, hold, dist, eta, chanceOf,
      contacts, shots, batteries,
      stateOf, reach,
      get time() { return time; },
      get population() { return population; },
      get integrity() { return integrity; },
      get ammo() { return { ...ammo }; },
      get breached() { return breached; },
      inbound: () => contacts.filter(c => c.state === 'inbound').sort((a, b) => eta(a) - eta(b)),
    };
  }

  return {
    create, schedule, hitChance, KINDS, WEAPONS, BATTERIES, STEP, SPAWN_KM, SCOPE_KM, CITY_KM, RAID_KM, SECTOR,
    RETARGET, SILENCED,
    START_POPULATION, INTEGRITY,
  };
})();

// Node (the test file) loads this through require; a browser has no `module`
if (typeof module !== 'undefined') module.exports = SIM;
