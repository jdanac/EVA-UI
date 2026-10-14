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
   ASSIGNED to a contact, and fires by itself when it can), rounds come from one
   shared pool, a RAIDER goes for a battery instead of the city, and the
   Geofront has an integrity that surface impacts wear down. At zero it is
   breached and the run is over.
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
    SCOUT:    { ja: '小型', speed: 1.2, hp: 50,  damage: 40000,  integrity: 5 },
    STANDARD: { ja: '標準', speed: 0.8, hp: 100, damage: 120000, integrity: 15 },
    HEAVY:    { ja: '大型', speed: 0.5, hp: 200, damage: 300000, integrity: 40 },
    RAIDER:   { ja: '襲撃', speed: 1.4, hp: 50,  damage: 0,      integrity: 0, raider: true },
  };

  // The three batteries, in km from the city: the positions of T-1's north,
  // south and east batteries, converted once.
  const BATTERIES = [
    { id: 'north', x: -4.55, y: 1.66 },
    { id: 'south', x: 2.27,  y: -3.65 },
    { id: 'east',  x: 4.55,  y: -2.32 },
  ];
  const RANGE_KM = 12;        // how far a battery can fire
  const COOLDOWN = 1.5;       // seconds between one battery's shots
  const RETARGET = 2.5;       // seconds from a new assignment to the first shot
  const SILENCED = 20;        // seconds a battery is out after a raider reaches it
  const POOL = 36;            // rounds in the shared pool when full
  const RESUPPLY = 5;         // seconds per round back into the pool
  const SHOT_KMS = 6;         // how fast a round flies, so it lands after d / 6 seconds
  const SHOT_DAMAGE = 50;     // hull points a hit takes off

  // Chance a round hits: 85% at 4 km or closer, falling in a straight line to
  // 20% at the edge of the range, so firing early wastes rounds. null beyond.
  function hitChance(d) {
    if (d > RANGE_KM) return null;
    if (d <= 4) return 0.85;
    return 0.85 - (0.85 - 0.20) * (d - 4) / (RANGE_KM - 4);
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
    let ammo = POOL;
    let supply = 0;           // seconds toward the next round back into the pool
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
    //   dry       on target and in reach, but the pool is empty
    //   cooling   just fired
    //   ready     will fire this step
    function stateOf(b) {
      if (b.silenced > 0) return 'silenced';
      if (!b.target) return 'hold';
      if (b.retarget > 0) return 'retarget';
      const c = find(b.target);
      if (reach(b, c) > RANGE_KM) return 'range';
      if (ammo < 1) return 'dry';
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
    const chanceOf = (b, c) => hitChance(reach(b, c));

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

    function fire(b, c) {
      const d = reach(b, c);
      const chance = hitChance(d);
      ammo--;
      b.cooldown = COOLDOWN;
      shots.push({
        id: ++shotSerial, battery: b.id, target: c.id,
        t0: time, t1: time + d / SHOT_KMS,
        hit: hitRandom() < chance,       // rolled now, shown when the round lands
      });
      events.push({ type: 'fire', id: c.id, battery: b.id, chance, ammo, t: time });
    }

    function land(s) {
      const c = find(s.target);
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

      supply += dt;
      while (supply >= RESUPPLY) {
        supply -= RESUPPLY;
        if (ammo < POOL) ammo++;
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
      get ammo() { return ammo; },
      get breached() { return breached; },
      inbound: () => contacts.filter(c => c.state === 'inbound').sort((a, b) => eta(a) - eta(b)),
    };
  }

  return {
    create, hitChance, KINDS, BATTERIES, STEP, SPAWN_KM, SCOPE_KM, CITY_KM, RAID_KM, SECTOR,
    RANGE_KM, COOLDOWN, RETARGET, SILENCED, POOL, RESUPPLY, SHOT_KMS, SHOT_DAMAGE,
    START_POPULATION, INTEGRITY,
  };
})();

// Node (the test file) loads this through require; a browser has no `module`
if (typeof module !== 'undefined') module.exports = SIM;
