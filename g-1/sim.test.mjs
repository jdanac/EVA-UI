// Checks for sim.js. Dev-time only, never loaded by the page.
//   node g-1/sim.test.mjs
// Node built-ins only: no package.json, no install.

import assert from 'node:assert/strict';
import SIM from './sim.js';

const { STEP, SPAWN_KM, SCOPE_KM, CITY_KM, SECTOR, KINDS } = SIM;
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

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
