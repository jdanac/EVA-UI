// Checks for sim.js. Dev-time only, never loaded by the page.
//   node g-1/sim.test.mjs
// Node built-ins only: no package.json, no install.

import assert from 'node:assert/strict';
import SIM from './sim.js';

const { STEP, SPAWN_KM, SCOPE_KM, CITY_KM, SECTOR, KINDS, RANGE_KM, MAGAZINE, COOLDOWN, RELOAD, SHOT_KMS, SHOT_DAMAGE, START_POPULATION } = SIM;
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

test('a standard contact crosses the whole path in 45 to 50 s', () => {
  const sim = SIM.create();
  const c = sim.spawn('STANDARD', 180);
  runUntil(sim, () => c.state === 'impact');
  assert.equal(c.state, 'impact');
  near(sim.time, (SPAWN_KM - CITY_KM) / KINDS.STANDARD.speed, STEP * 2, 'time to impact');
  assert.ok(sim.time >= 45 && sim.time <= 50, `took ${sim.time} s`);
});

test('it reaches the scope after about 20 s, which leaves 25 to 30 s on it', () => {
  const sim = SIM.create();
  const c = sim.spawn('STANDARD', 180);
  runUntil(sim, () => c.onScope);
  near(sim.time, (SPAWN_KM - SCOPE_KM) / KINDS.STANDARD.speed, STEP * 2, 'time to reach the scope');
  const onScopeAt = sim.time;
  runUntil(sim, () => c.state === 'impact');
  const left = sim.time - onScopeAt;
  assert.ok(left >= 25 && left <= 30, `${left} s left on the scope`);
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

/* ---------- step 2: batteries, rounds, damage, population ---------- */

// A contact flown in toward the south-east until it is within `km` of the city,
// where the east and south batteries reach it and the north one does not
function inRangeContact(sim, km = 9, kind = 'STANDARD') {
  const c = sim.spawn(kind, 135);
  runUntil(sim, () => sim.dist(c) <= km);
  sim.takeEvents();
  return c;
}
const types = events => events.map(e => e.type);

test('hit chance is 85% close in, 35% at the edge of the range, a straight line between, none beyond', () => {
  near(SIM.hitChance(0), 0.85, 1e-9, 'at 0 km');
  near(SIM.hitChance(4), 0.85, 1e-9, 'at 4 km');
  near(SIM.hitChance(8), 0.60, 1e-9, 'at 8 km');
  near(SIM.hitChance(RANGE_KM), 0.35, 1e-9, 'at the range');
  assert.equal(SIM.hitChance(RANGE_KM + 0.01), null);
});

test('firing at a contact nothing reaches is refused, says why, and costs nothing', () => {
  const sim = SIM.create();
  const c = sim.spawn('STANDARD', 135);                 // 40 km out
  assert.deepEqual(sim.engage(c.id), { ok: false, reason: 'range' });
  assert.deepEqual(sim.takeEvents().filter(e => e.type === 'refused').map(e => e.reason), ['range']);
  assert.ok(sim.batteries.every(b => b.rounds === MAGAZINE && b.cooldown === 0));
  assert.equal(sim.shots.length, 0);
});

test('the nearest ready battery fires, spends a round and cools down', () => {
  const sim = SIM.create(1);
  const c = inRangeContact(sim);
  const r = sim.engage(c.id);
  assert.deepEqual(r, { ok: true, battery: 'east' });
  const east = sim.batteries.find(b => b.id === 'east');
  assert.equal(east.rounds, MAGAZINE - 1);
  assert.equal(east.cooldown, COOLDOWN);
  assert.equal(sim.stateOf(east), 'cooling');
  assert.deepEqual(types(sim.takeEvents()), ['fire']);
});

test('while one battery cools another fires, and with none ready it is "busy" until they have cooled', () => {
  const sim = SIM.create(1);
  const c = inRangeContact(sim);
  c.hp = c.maxHp = 1e9;                                 // so lucky hits cannot end the test early
  assert.equal(sim.engage(c.id).battery, 'east');
  assert.equal(sim.engage(c.id).battery, 'south');      // the north battery is out of range
  assert.deepEqual(sim.engage(c.id), { ok: false, reason: 'busy' });
  for (let i = 0; i < COOLDOWN / STEP + 2; i++) sim.step(STEP);
  c.vx = c.vy = 0;                                      // hold it in range while the test waits
  assert.equal(sim.engage(c.id).ok, true);
});

test('a round lands after distance / speed and then hits or misses as it was rolled', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const sim = SIM.create(seed);
    const c = inRangeContact(sim);
    c.vx = c.vy = 0;
    const before = c.hp;
    sim.engage(c.id);
    const s = sim.shots[0];
    near(s.t1 - s.t0, sim.reach(sim.batteries.find(b => b.id === s.battery), c) / SHOT_KMS, 1e-9, 'flight time');
    runUntil(sim, () => sim.shots.length === 0);
    assert.ok(sim.time >= s.t1 && sim.time < s.t1 + STEP * 2, 'lands on time');
    assert.equal(c.hp, s.hit ? before - SHOT_DAMAGE : before);
    assert.deepEqual(types(sim.takeEvents()), ['fire', s.hit ? 'hit' : 'miss']);
  }
});

test('over many rounds the share that hit matches the hit chance', () => {
  const sim = SIM.create(99);
  const c = inRangeContact(sim, 2.5);                    // the east battery is 4.5 km away: 85%
  c.vx = c.vy = 0;
  c.hp = c.maxHp = 1e9;
  let hits = 0, fired = 0;
  for (let i = 0; i < 400; i++) {
    for (const b of sim.batteries) { b.rounds = MAGAZINE; b.cooldown = 0; b.reload = 0; }
    if (sim.engage(c.id).ok) fired++;
    runUntil(sim, () => sim.shots.length === 0);
    hits += sim.takeEvents().filter(e => e.type === 'hit').length;
  }
  assert.equal(fired, 400);
  assert.ok(hits / fired > 0.75 && hits / fired < 0.95, `${hits} of ${fired} hit`);
});

test('enough hits destroy a contact once, and a round still in the air is wasted', () => {
  const sim = SIM.create(1);
  const c = inRangeContact(sim, 9, 'STANDARD');          // 100 hp: two hits
  c.vx = c.vy = 0;
  sim.engage(c.id);
  for (let i = 0; i < COOLDOWN / STEP + 2; i++) sim.step(STEP);   // the first round has landed or is about to
  sim.takeEvents();
  sim.engage(c.id);
  sim.engage(c.id);                                      // a third from the other battery, in the air together
  for (const s of sim.shots) s.hit = true;               // make every round in the air a hit
  c.hp = SIM.SHOT_DAMAGE;                                // one more hit kills it
  runUntil(sim, () => sim.shots.length === 0);
  const seen = types(sim.takeEvents());
  assert.equal(c.state, 'destroyed');
  assert.equal(seen.filter(t => t === 'destroyed').length, 1);
  assert.ok(seen.includes('wasted'), seen.join(','));
  assert.deepEqual(sim.engage(c.id), { ok: false, reason: 'target' });
});

test('a battery that empties reloads for RELOAD seconds and comes back full', () => {
  const sim = SIM.create(1);
  const c = sim.spawn('HEAVY', 135);
  c.x = 3; c.y = -3; c.vx = c.vy = 0;                    // sits right by the south battery
  c.hp = c.maxHp = 1e9;
  const south = sim.batteries.find(b => b.id === 'south');
  for (let i = 0; i < MAGAZINE; i++) {
    assert.equal(sim.engage(c.id).battery, 'south');
    for (let k = 0; k < COOLDOWN / STEP + 2; k++) sim.step(STEP);
  }
  assert.equal(south.rounds, 0);
  assert.equal(sim.stateOf(south), 'reloading');
  assert.notEqual(sim.engage(c.id).battery, 'south');   // the others take over
  const left = south.reload;
  assert.ok(left > 0 && left <= RELOAD);
  for (let k = 0; k < Math.ceil(left / STEP) + 1; k++) sim.step(STEP);
  assert.equal(south.rounds, MAGAZINE);
  assert.equal(sim.stateOf(south), 'ready');
});

test('a contact that gets through costs the city its damage; one that is destroyed costs nothing', () => {
  const through = SIM.create(1);
  const a = through.spawn('STANDARD', 150);
  runUntil(through, () => a.state === 'impact');
  assert.equal(through.population, START_POPULATION - KINDS.STANDARD.damage);
  const impact = through.takeEvents().find(e => e.type === 'impact');
  assert.equal(impact.damage, KINDS.STANDARD.damage);
  assert.equal(impact.population, through.population);

  const stopped = SIM.create(1);
  const b = inRangeContact(stopped);
  b.hp = SIM.SHOT_DAMAGE;
  stopped.engage(b.id);
  stopped.shots[0].hit = true;
  runUntil(stopped, () => b.state !== 'inbound');
  assert.equal(b.state, 'destroyed');
  for (let i = 0; i < 600; i++) stopped.step(STEP);
  assert.equal(stopped.population, START_POPULATION);
  assert.ok(!types(stopped.takeEvents()).includes('impact'));
});

test('population never goes below zero', () => {
  const sim = SIM.create(1);
  const heavies = [sim.spawn('HEAVY', 150), sim.spawn('HEAVY', 160), sim.spawn('HEAVY', 170), sim.spawn('HEAVY', 180)];
  runUntil(sim, () => heavies.every(h => h.state === 'impact'));
  assert.equal(sim.population, 0);
  const lost = sim.takeEvents().filter(e => e.type === 'impact').reduce((n, e) => n + e.damage, 0);
  assert.equal(lost, START_POPULATION);
});

test('a scripted run with the same seed repeats exactly, down to the events', () => {
  const play = seed => {
    const sim = SIM.create(seed);
    const log = [];
    sim.spawnRandom('STANDARD'); sim.spawnRandom('SCOUT'); sim.spawnRandom('HEAVY');
    for (let i = 0; i < 90 * 30; i++) {
      sim.step(STEP);
      if (i % 20 === 0) for (const c of sim.inbound()) sim.engage(c.id);
      log.push(...sim.takeEvents());
    }
    return JSON.stringify({ log, population: sim.population });
  };
  assert.equal(play(5), play(5));
  assert.notEqual(play(5), play(6));
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
