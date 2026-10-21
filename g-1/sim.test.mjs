// Checks for sim.js. Dev-time only, never loaded by the page.
//   node g-1/sim.test.mjs
// Node built-ins only: no package.json, no install.

import assert from 'node:assert/strict';
import SIM from './sim.js';

const { STEP, SPAWN_KM, SCOPE_KM, CITY_KM, RAID_KM, SECTOR, KINDS, WEAPONS, RETARGET, SILENCED, START_POPULATION, INTEGRITY } = SIM;
const GUN = WEAPONS.GUN, AA = WEAPONS.AA;
const RANGE_KM = GUN.range, COOLDOWN = GUN.cooldown, SHOT_DAMAGE = GUN.damage, POOL = GUN.pool, RESUPPLY = GUN.resupply;
let failed = 0;

function test(name, fn) {
  try { fn(); console.log(`ok    ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);

// Runs the sim in whole steps until the callback says stop (or 5 minutes pass)
function runUntil(sim, done) {
  while (!done() && sim.time < 300) sim.step(STEP);
}

test('a contact spawns SPAWN_KM from the city on the bearing given', () => {
  for (const [bearing, x, y] of [[90, 1, 0], [180, 0, -1], [270, -1, 0], [0, 0, 1]]) {
    const c = SIM.create().spawn('STANDARD', bearing);
    near(c.x, x * SPAWN_KM, 1e-9, `x at ${bearing}`);
    near(c.y, y * SPAWN_KM, 1e-9, `y at ${bearing}`);
  }
});

test('it flies a straight line at constant speed', () => {
  const sim = SIM.create();
  const c = sim.spawn('STANDARD', 135);
  const bearing = Math.atan2(c.x, c.y);
  for (let i = 0; i < 300; i++) {
    sim.step(STEP);
    near(Math.atan2(c.x, c.y), bearing, 1e-9, 'bearing from the city');
  }
  near(sim.dist(c), SPAWN_KM - KINDS.STANDARD.speed * 300 * STEP, 1e-6, 'distance after 10 s');
});

test('a standard contact crosses the whole path in 36 to 40 s', () => {
  const sim = SIM.create();
  const c = sim.spawn('STANDARD', 180);
  runUntil(sim, () => c.state === 'impact');
  assert.equal(c.state, 'impact');
  near(sim.time, (SPAWN_KM - CITY_KM) / KINDS.STANDARD.speed, STEP * 2, 'time to impact');
  assert.ok(sim.time >= 36 && sim.time <= 40, `took ${sim.time} s`);
});

test('it reaches the scope after about 26 s, which leaves 35 to 40 s on it', () => {
  const sim = SIM.create();
  const c = sim.spawn('STANDARD', 180);
  runUntil(sim, () => c.onScope);
  near(sim.time, (SPAWN_KM - SCOPE_KM) / KINDS.STANDARD.speed, STEP * 2, 'time to reach the scope');
  const onScopeAt = sim.time;
  runUntil(sim, () => c.state === 'impact');
  const left = sim.time - onScopeAt;
  assert.ok(left >= 35 && left <= 40, `${left} s left on the scope`);
});

test('it stops at the edge of the city and impacts exactly once', () => {
  const sim = SIM.create();
  const c = sim.spawn('SCOUT', 100);
  runUntil(sim, () => c.state === 'impact');
  near(sim.dist(c), CITY_KM, 1e-9, 'distance at impact');
  for (let i = 0; i < 300; i++) sim.step(STEP);         // keep running well past it
  near(sim.dist(c), CITY_KM, 1e-9, 'distance later');
  const impacts = sim.takeEvents().filter(e => e.type === 'impact');
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].id, c.id);
});

test('events come out in order, once each, and the list empties when taken', () => {
  const sim = SIM.create();
  const c = sim.spawn('SCOUT', 150);
  runUntil(sim, () => c.state === 'impact');
  assert.deepEqual(sim.takeEvents().map(e => e.type), ['spawn', 'scope', 'impact']);
  assert.deepEqual(sim.takeEvents(), []);
});

test('eta counts down to zero and ranks the soonest contact first', () => {
  const sim = SIM.create();
  const slow = sim.spawn('HEAVY', 120);
  const fast = sim.spawn('SCOUT', 200);
  assert.deepEqual(sim.inbound().map(c => c.id), [fast.id, slow.id]);
  const before = sim.eta(fast);
  sim.step(1);
  near(sim.eta(fast), before - 1, 1e-9, 'eta after 1 s');
  runUntil(sim, () => fast.state === 'impact');
  assert.equal(sim.eta(fast), 0);
  assert.deepEqual(sim.inbound().map(c => c.id), [slow.id]);
});

test('random spawns stay inside the sea sector', () => {
  const sim = SIM.create(7);
  for (let i = 0; i < 200; i++) {
    const c = sim.spawnRandom('STANDARD');
    assert.ok(c.bearing >= SECTOR[0] && c.bearing < SECTOR[1], `bearing ${c.bearing}`);
  }
});

test('the same seed repeats exactly, a different seed does not', () => {
  const run = seed => {
    const sim = SIM.create(seed);
    const c = sim.spawnRandom('STANDARD');
    for (let i = 0; i < 600; i++) sim.step(STEP);
    return [c.bearing, c.x, c.y];
  };
  assert.deepEqual(run(42), run(42));
  assert.notDeepEqual(run(42), run(43));
});

test('an unknown kind is refused', () => {
  assert.throws(() => SIM.create().spawn('BATTLESHIP', 0), /unknown contact kind/);
});

/* ---------- milestone A: fire orders, the pool, the Geofront, raiders ---------- */

// A contact flown in toward the south-east until it is within `km` of the city,
// where the east and south batteries reach it and the north one does not.
// Held still there, so a test can wait on it.
function parked(sim, km = 9, kind = 'STANDARD') {
  const c = sim.spawn(kind, 135);
  runUntil(sim, () => sim.dist(c) <= km);
  c.vx = c.vy = 0;
  sim.takeEvents();
  return c;
}
const types = events => events.map(e => e.type);
const bat = (sim, id) => sim.batteries.find(b => b.id === id);
const seconds = (sim, s) => { for (let i = 0; i < Math.round(s / STEP); i++) sim.step(STEP); };

test('gun hit chance is 85% close in, 20% at the edge of the range, a straight line between, none beyond', () => {
  near(SIM.hitChance('GUN', 0), 0.85, 1e-9, 'at 0 km');
  near(SIM.hitChance('GUN', 4), 0.85, 1e-9, 'at 4 km');
  near(SIM.hitChance('GUN', 8), 0.525, 1e-9, 'at 8 km');
  near(SIM.hitChance('GUN', RANGE_KM), 0.20, 1e-9, 'at the range');
  assert.equal(SIM.hitChance('GUN', RANGE_KM + 0.01), null);
});

test('guns lose accuracy against fast contacts, AA does not', () => {
  near(SIM.hitChance('GUN', 4, 0.6), 0.85, 1e-9, 'at 0.6 km/s');
  near(SIM.hitChance('GUN', 4, 0.9), 0.85 * 0.75, 1e-9, 'at 0.9 km/s');
  near(SIM.hitChance('GUN', 4, 1.2), 0.85 * 0.5, 1e-9, 'at 1.2 km/s');
  near(SIM.hitChance('GUN', 4, 3), 0.85 * 0.5, 1e-9, 'floor');
  near(SIM.hitChance('AA', 2, 1.05), 0.80, 1e-9, 'AA close in');
  near(SIM.hitChance('AA', 6, 1.05), 0.50, 1e-9, 'AA at its range');
  assert.equal(SIM.hitChance('AA', 6.01), null);
});

test('nothing fires without an order', () => {
  const sim = SIM.create(1);
  parked(sim);
  seconds(sim, 20);
  assert.ok(!types(sim.takeEvents()).includes('fire'));
  assert.equal(sim.ammo.GUN, POOL);
  assert.ok(sim.batteries.every(b => sim.stateOf(b) === 'hold'));
});

test('an assigned battery waits out the retarget delay, then fires every cooldown from the pool', () => {
  const sim = SIM.create(1);
  const c = parked(sim);
  c.hp = c.maxHp = 1e9;
  assert.deepEqual(sim.assign('east', c.id), { ok: true });
  assert.equal(sim.stateOf(bat(sim, 'east')), 'retarget');
  seconds(sim, RETARGET - 0.1);
  assert.ok(!types(sim.takeEvents()).includes('fire'), 'fired during the retarget delay');
  seconds(sim, 0.2);
  assert.deepEqual(types(sim.takeEvents()).filter(t => t === 'fire'), ['fire']);
  seconds(sim, COOLDOWN * 3 + 0.05);
  const fired = sim.takeEvents().filter(e => e.type === 'fire');
  assert.equal(fired.length, 3);
  assert.ok(fired.every(e => e.battery === 'east' && e.id === c.id));
  assert.ok(sim.ammo.GUN <= POOL - 4 + 1, `pool ${sim.ammo.GUN}`);   // four rounds out, at most one back
});

test('the same order again changes nothing; a new target costs the delay again', () => {
  const sim = SIM.create(1);
  const a = parked(sim), b = parked(sim, 9.5);
  a.hp = a.maxHp = b.hp = b.maxHp = 1e9;
  sim.assign('east', a.id);
  seconds(sim, 1);
  sim.assign('east', a.id);
  near(bat(sim, 'east').retarget, RETARGET - 1, STEP, 'retarget left');
  seconds(sim, RETARGET);
  sim.assign('east', b.id);
  assert.equal(bat(sim, 'east').retarget, RETARGET);
  assert.equal(sim.takeEvents().filter(e => e.type === 'assign').length, 2);
});

test('assigned out of range costs nothing and fires once the target comes in', () => {
  const sim = SIM.create(1);
  const c = sim.spawn('STANDARD', 135);           // at the scope edge, far outside gun range
  sim.assign('north', c.id);
  seconds(sim, RETARGET + 1);
  assert.equal(sim.stateOf(bat(sim, 'north')), 'range');
  assert.equal(sim.ammo.GUN, POOL);
  runUntil(sim, () => sim.reach(bat(sim, 'north'), c) <= RANGE_KM - 0.5);
  assert.ok(sim.takeEvents().some(e => e.type === 'fire' && e.battery === 'north'));
});

test('several batteries can work one contact', () => {
  const sim = SIM.create(1);
  const c = parked(sim);
  c.hp = c.maxHp = 1e9;
  sim.assign('east', c.id);
  sim.assign('south', c.id);
  seconds(sim, RETARGET + 0.1);
  assert.deepEqual(sim.takeEvents().filter(e => e.type === 'fire').map(e => e.battery).sort(), ['east', 'south']);
});

test('hold stops a battery, and holding an idle one does nothing', () => {
  const sim = SIM.create(1);
  const c = parked(sim);
  c.hp = c.maxHp = 1e9;
  sim.assign('east', c.id);
  seconds(sim, RETARGET + 0.1);
  sim.hold('east');
  sim.hold('north');
  sim.takeEvents();
  seconds(sim, 10);
  assert.ok(!types(sim.takeEvents()).includes('fire'));
  assert.equal(bat(sim, 'east').target, null);
});

test('when its target is finished a battery goes back to hold, never to another target', () => {
  const sim = SIM.create(1);
  const c = parked(sim);
  const other = parked(sim, 9.5);
  sim.assign('east', c.id);
  seconds(sim, RETARGET + 0.1);
  for (const s of sim.shots) s.hit = true;
  c.hp = SHOT_DAMAGE;
  runUntil(sim, () => c.state !== 'inbound');
  seconds(sim, 1);
  assert.equal(c.state, 'destroyed');
  assert.equal(bat(sim, 'east').target, null);
  assert.ok(sim.takeEvents().some(e => e.type === 'released' && e.battery === 'east'));
  seconds(sim, 10);
  assert.ok(!sim.takeEvents().some(e => e.type === 'fire'), `fired at ${other.id} unordered`);
});

test('an empty pool stops every battery, and it refills one round per RESUPPLY up to POOL', () => {
  const sim = SIM.create(1);
  const c = parked(sim, 4);
  c.hp = c.maxHp = 1e9;
  for (const id of ['north', 'south', 'east']) sim.assign(id, c.id);
  runUntil(sim, () => sim.ammo.GUN === 0);
  assert.ok(sim.batteries.some(b => sim.stateOf(b) === 'dry'));
  for (const id of ['north', 'south', 'east']) sim.hold(id);
  seconds(sim, RESUPPLY * 3 + 0.05);
  assert.equal(sim.ammo.GUN, 3);
  seconds(sim, RESUPPLY * (POOL + 5));
  assert.equal(sim.ammo.GUN, POOL);
});

test('a round is aimed at where the contact will be, and the contact is there when it lands', () => {
  for (const seed of [1, 2, 3]) {
    const sim = SIM.create(seed);
    const c = sim.spawn('STANDARD', 135);
    runUntil(sim, () => sim.dist(c) <= 9);
    c.hp = c.maxHp = 1e9;
    sim.assign('east', c.id);
    runUntil(sim, () => sim.shots.length === 1);
    const s = sim.shots[0], b = bat(sim, 'east');
    sim.hold('east');
    const flight = s.t1 - s.t0;
    near(Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y), GUN.roundKms * flight, 1e-9, 'round path length');
    assert.deepEqual(s.from, { x: b.x, y: b.y });
    // the contact is moving, so the aim point is ahead of it, not on it
    const ahead = Math.hypot(s.to.x - c.x, s.to.y - c.y);
    near(ahead, KINDS.STANDARD.speed * flight, KINDS.STANDARD.speed * STEP * 2, 'lead length');
    assert.ok(ahead > 0.2, `lead ${ahead} km`);
    runUntil(sim, () => sim.shots.length === 0);
    near(c.x, s.to.x, 0.05, 'contact x at landing');
    near(c.y, s.to.y, 0.05, 'contact y at landing');
  }
});

test('a parked contact is aimed at directly, and a faster one is led further than a slower one', () => {
  const sim = SIM.create(1);
  const c = parked(sim);
  sim.assign('east', c.id);
  runUntil(sim, () => sim.shots.length === 1);
  near(sim.shots[0].to.x, c.x, 1e-9, 'x');
  near(sim.shots[0].to.y, c.y, 1e-9, 'y');

  const lead = kind => {
    const s2 = SIM.create(1);
    const k = s2.spawn(kind, 135, 'north');
    k.x = 3; k.y = -9; k.vx = -KINDS[kind].speed; k.vy = 0;       // crossing the east and south batteries' field
    k.hp = k.maxHp = 1e9;
    s2.assign('south', k.id);
    runUntil(s2, () => s2.shots.length === 1);
    return Math.hypot(s2.shots[0].to.x - k.x, s2.shots[0].to.y - k.y);
  };
  assert.ok(lead('RAIDER') > lead('STANDARD') * 1.5, `${lead('RAIDER')} vs ${lead('STANDARD')}`);
});

test('a miss lands beside the contact, not on it, and uses no random numbers', () => {
  const sim = SIM.create(2);
  const c = parked(sim, 11);                         // far out: many misses
  c.hp = c.maxHp = 1e9;
  for (const id of ['north', 'south', 'east']) sim.assign(id, c.id);
  seconds(sim, 40);
  const misses = sim.takeEvents().filter(e => e.type === 'miss');
  assert.ok(misses.length >= 5, `${misses.length} misses`);
  for (const m of misses) {
    const off = Math.hypot(m.x - c.x, m.y - c.y);
    assert.ok(off >= 0.39 && off <= 0.81, `miss ${off} km from the contact`);
  }
});

test('a round lands after distance / speed and then hits or misses as it was rolled', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sim = SIM.create(seed);
    const c = parked(sim);
    sim.assign('east', c.id);
    runUntil(sim, () => sim.shots.length === 1);
    sim.hold('east');
    const s = sim.shots[0], before = c.hp;
    near(s.t1 - s.t0, sim.reach(bat(sim, 'east'), c) / GUN.roundKms, 1e-9, 'flight time at a parked contact');
    sim.takeEvents();
    runUntil(sim, () => sim.shots.length === 0);
    assert.ok(sim.time >= s.t1 && sim.time < s.t1 + STEP * 2, 'lands on time');
    assert.equal(c.hp, s.hit ? before - SHOT_DAMAGE : before);
    assert.deepEqual(types(sim.takeEvents()).filter(t => t === 'hit' || t === 'miss'), [s.hit ? 'hit' : 'miss']);
  }
});

test('over many rounds the share that hit matches the hit chance', () => {
  let hits = 0, fired = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const sim = SIM.create(seed);
    const c = parked(sim, 2.5);                     // the east battery is 4.5 km away: about 84%
    c.hp = c.maxHp = 1e9;
    const chance = sim.chanceOf(bat(sim, 'east'), c);
    sim.assign('east', c.id);
    seconds(sim, 20);
    const ev = sim.takeEvents();
    fired += ev.filter(e => e.type === 'fire').length;
    hits += ev.filter(e => e.type === 'hit').length;
    assert.ok(chance > 0.8);
  }
  assert.ok(fired > 400, `${fired} fired`);
  assert.ok(hits / fired > 0.75 && hits / fired < 0.92, `${hits} of ${fired} hit`);
});

test('a round still in the air when its target dies is wasted', () => {
  const sim = SIM.create(1);
  const c = parked(sim);
  sim.assign('east', c.id);
  sim.assign('south', c.id);
  runUntil(sim, () => sim.shots.length === 2);
  for (const s of sim.shots) s.hit = true;
  c.hp = SHOT_DAMAGE;
  runUntil(sim, () => sim.shots.length === 0);
  const seen = types(sim.takeEvents());
  assert.equal(c.state, 'destroyed');
  assert.equal(seen.filter(t => t === 'destroyed').length, 1);
  assert.ok(seen.includes('wasted'), seen.join(','));
  assert.deepEqual(sim.assign('east', c.id), { ok: false, reason: 'target' });
});

test('a surface impact costs population and Geofront integrity; a destroyed contact costs nothing', () => {
  const sim = SIM.create(1);
  const a = sim.spawn('STANDARD', 150);
  runUntil(sim, () => a.state === 'impact');
  assert.equal(sim.population, START_POPULATION - KINDS.STANDARD.damage);
  assert.equal(sim.integrity, INTEGRITY - KINDS.STANDARD.integrity);
  const impact = sim.takeEvents().find(e => e.type === 'impact');
  assert.equal(impact.damage, KINDS.STANDARD.damage);
  assert.equal(impact.integrity, sim.integrity);

  const quiet = SIM.create(1);
  const b = parked(quiet);
  b.hp = SHOT_DAMAGE;
  quiet.assign('east', b.id);
  runUntil(quiet, () => quiet.shots.length === 1);
  quiet.shots[0].hit = true;
  runUntil(quiet, () => b.state !== 'inbound');
  assert.equal(b.state, 'destroyed');
  assert.equal(quiet.population, START_POPULATION);
  assert.equal(quiet.integrity, INTEGRITY);
});

test('at zero integrity the Geofront is breached and the run stops', () => {
  const sim = SIM.create(1);
  const heavies = [150, 160, 170, 180].map(b => sim.spawn('HEAVY', b));
  runUntil(sim, () => sim.breached);
  assert.equal(sim.integrity, 0);
  assert.equal(heavies.filter(h => h.state === 'impact').length, Math.ceil(INTEGRITY / KINDS.HEAVY.integrity));
  assert.ok(sim.population >= 0);
  const ev = sim.takeEvents();
  assert.equal(ev.filter(e => e.type === 'breach').length, 1);
  const t = sim.time;
  seconds(sim, 30);
  assert.equal(sim.time, t, 'time moved after the breach');
  assert.deepEqual(sim.takeEvents(), []);
});

test('a raider flies at its battery, silences it, and costs the city nothing', () => {
  const sim = SIM.create(1);
  const c = parked(sim);
  const r = sim.spawn('RAIDER', 135, 'south');
  c.hp = c.maxHp = 1e9;
  sim.assign('south', c.id);
  near(sim.eta(r), (Math.hypot(r.x - 2.27, r.y + 3.65) - RAID_KM) / KINDS.RAIDER.speed, 1e-9, 'eta to its battery');
  runUntil(sim, () => r.state !== 'inbound');
  const south = bat(sim, 'south');
  assert.equal(r.state, 'impact');
  near(sim.reach(south, r), RAID_KM, 1e-9, 'stops at the battery');
  assert.equal(sim.stateOf(south), 'silenced');
  assert.equal(south.target, null);
  assert.ok(sim.takeEvents().some(e => e.type === 'silenced' && e.battery === 'south'));
  assert.deepEqual(sim.assign('south', c.id), { ok: false, reason: 'silenced' });
  assert.equal(sim.population, START_POPULATION);
  assert.equal(sim.integrity, INTEGRITY);
  seconds(sim, SILENCED + 0.1);
  assert.equal(sim.stateOf(south), 'hold');
  assert.ok(sim.takeEvents().some(e => e.type === 'restored' && e.battery === 'south'));
});

test('a raider with no battery given picks one from the spawn stream, the same for a seed', () => {
  const pick = seed => { const sim = SIM.create(seed); return [1, 2, 3, 4, 5, 6].map(() => sim.spawnRandom('RAIDER').objective); };
  assert.deepEqual(pick(3), pick(3));
  const all = new Set();
  for (let seed = 3; seed < 15; seed++) for (const id of pick(seed)) all.add(id);
  assert.deepEqual([...all].sort(), SIM.BATTERIES.map(b => b.id).sort());
  assert.equal(SIM.create(1).spawn('STANDARD', 150, 'north').objective, 'city');
});

test('the schedule is in time order, in the sea sector, and the same for a seed', () => {
  const a = SIM.schedule(9), b = SIM.schedule(9), c = SIM.schedule(10);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.map(x => x.bearing), c.map(x => x.bearing));
  assert.deepEqual(a.map(x => [x.t, x.kind]), c.map(x => [x.t, x.kind]));
  for (let i = 0; i < a.length; i++) {
    assert.ok(a[i].bearing >= SECTOR[0] && a[i].bearing < SECTOR[1]);
    if (i) assert.ok(a[i].t >= a[i - 1].t);
  }
});

test('a scripted run with the same seed repeats exactly, down to the events', () => {
  const play = seed => {
    const sim = SIM.create(seed);
    const log = [];
    sim.spawnRandom('STANDARD'); sim.spawnRandom('RAIDER'); sim.spawnRandom('HEAVY');
    for (let i = 0; i < 90 * 30; i++) {
      sim.step(STEP);
      if (i % 30 === 0) {
        const first = sim.inbound()[0];
        if (first) for (const b of sim.batteries) sim.assign(b.id, first.id);
      }
      log.push(...sim.takeEvents());
    }
    return JSON.stringify({ log, population: sim.population, integrity: sim.integrity });
  };
  assert.equal(play(5), play(5));
  assert.notEqual(play(5), play(6));
});

test('firing never changes where the next contact comes from', () => {
  const next = fire => {
    const sim = SIM.create(11);
    const out = [];
    const first = sim.spawnRandom('STANDARD');
    out.push(first.bearing);
    runUntil(sim, () => sim.dist(first) <= 9);
    if (fire) { sim.assign('east', first.id); sim.assign('south', first.id); seconds(sim, 5); }
    for (const kind of ['RAIDER', 'HEAVY', 'STANDARD']) {
      const c = sim.spawnRandom(kind);
      out.push(c.bearing, c.objective);
    }
    return out;
  };
  assert.deepEqual(next(true), next(false));
});

test('forecast: a contact nobody is on is open, and one finished has none', () => {
  const sim = SIM.create(1);
  const c = sim.spawn('STANDARD', 135);
  assert.equal(sim.forecast(c).verdict, 'open');
  assert.equal(sim.forecast(c).expected, 0);
  c.state = 'destroyed';
  assert.equal(sim.forecast(c), null);
});

test('forecast: sites on a contact raise it, and the right ones hold a standard', () => {
  const sim = SIM.create(1);
  const c = sim.spawn('STANDARD', 150);
  sim.assign('east', c.id);
  const one = sim.forecast(c);
  sim.assign('south', c.id); sim.assign('north', c.id);
  const three = sim.forecast(c);
  assert.ok(three.expected > one.expected, 'more sites, more expected damage');
  assert.notEqual(three.verdict, 'open');
  assert.ok(sim.forecast(c).ratio === three.ratio, 'asking twice changes nothing');
});

test('forecast: AA does next to nothing to a HEAVY, so a heavy covered only by AA leaks', () => {
  const sim = SIM.create(1);
  const c = sim.spawn('HEAVY', 150);
  for (const id of ['aa1', 'aa2', 'aa3']) sim.assign(id, c.id);
  assert.equal(sim.forecast(c).verdict, 'leaks');
});

test('forecast never reads whether a round in the air will hit', () => {
  // Same run twice, with every round in the air forced to hit, then to miss:
  // the forecast must come out the same
  const run = hit => {
    const sim = SIM.create(4);
    const c = sim.spawn('STANDARD', 150);
    sim.assign('east', c.id); sim.assign('south', c.id);
    runUntil(sim, () => sim.shots.length >= 2);
    for (const s of sim.shots) s.hit = hit;
    return sim.forecast(c).expected;
  };
  assert.equal(run(true), run(false));
});

test('forecast: a round in the air counts by its chance, a silenced site not at all', () => {
  const sim = SIM.create(1);
  const c = sim.spawn('STANDARD', 150);
  sim.assign('east', c.id);
  runUntil(sim, () => sim.shots.length >= 1);
  const s = sim.shots[0];
  assert.ok(s.chance > 0 && s.chance <= 1, 'a shot carries its chance');
  bat(sim, 'east').silenced = 10;
  near(sim.forecast(c).expected, s.chance * s.damage, 1e-9, 'only the round in the air');
});

test('standing orders: off by default, so a site does nothing until it is ordered', () => {
  const sim = SIM.create(1);
  const c = sim.spawn('STANDARD', 150);
  runUntil(sim, () => sim.reach(bat(sim, 'east'), c) <= 6);
  assert.equal(bat(sim, 'east').target, null);
  assert.equal(bat(sim, 'east').auto, false);
});

test('standing orders: a site on AUTO takes the soonest contact it would hit at 50% or better', () => {
  const sim = SIM.create(1);
  const far = sim.spawn('STANDARD', 150), near = sim.spawn('STANDARD', 150);
  near.x *= 0.5; near.y *= 0.5;                    // closer, so sooner
  sim.setAuto('east', true);
  runUntil(sim, () => bat(sim, 'east').target);
  assert.equal(bat(sim, 'east').target, near.id);
  assert.ok(sim.chanceOf(bat(sim, 'east'), near) >= SIM.AUTO_MIN_CHANCE);
  assert.notEqual(bat(sim, 'east').target, far.id);
});

test('standing orders: nothing below the chance is taken, and a finished target is replaced by itself', () => {
  const sim = SIM.create(1);
  const c = sim.spawn('STANDARD', 150);
  sim.setAuto('east', true);
  seconds(sim, 1);
  assert.equal(bat(sim, 'east').target, null, 'out of range: nothing taken');
  const d = sim.spawn('STANDARD', 150);
  runUntil(sim, () => bat(sim, 'east').target === c.id);
  c.state = 'destroyed';
  seconds(sim, 1);
  assert.equal(bat(sim, 'east').target, d.id, 'a new target without an order');
  assert.equal(bat(sim, 'east').auto, true);
});

test('standing orders: HOLD ends them, and a silenced site does not pick', () => {
  const sim = SIM.create(1);
  const c = sim.spawn('STANDARD', 150);
  sim.setAuto('east', true); sim.setAuto('south', true);
  runUntil(sim, () => bat(sim, 'east').target && bat(sim, 'south').target);
  sim.hold('east');
  assert.equal(bat(sim, 'east').auto, false);
  assert.equal(bat(sim, 'east').target, null);
  seconds(sim, 1);
  assert.equal(bat(sim, 'east').target, null, 'held for good');
  bat(sim, 'south').target = null; bat(sim, 'south').silenced = 5;
  seconds(sim, 1);
  assert.equal(bat(sim, 'south').target, null, 'silenced: no pick');
  assert.ok(sim.takeEvents().some(e => e.type === 'auto' && e.on === false));
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
