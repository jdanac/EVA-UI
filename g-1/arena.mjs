// The arena: plays the same seeds with different bots and compares them, to
// tell whether the rules leave anything to decide (see "How to tell a mechanic
// is working" in SPEC.md). Dev-time only, never loaded by the page.
//   node g-1/arena.mjs            300 seeds
//   node g-1/arena.mjs 50         fewer, for a quick look
// Node built-ins only: no package.json, no install.
//
// Today this runs against the step-2 rules (direct fire through engage()), as
// the baseline: with one verb and identical threats the bots should come out
// about equal. When C1 lands, the bots give assign/hold orders instead.

import SIM from './sim.js';

const SEEDS = Number(process.argv[2]) || 300;
const DECIDE = 1;          // bots decide once a game second, never every step
const END = 240;           // seconds a run lasts at most

// Geofront integrity is not in the sim yet (minimal C5 is part of milestone A),
// so the arena keeps it from the impact events with the spec's draft numbers
const INTEGRITY = 100;
const INTEGRITY_COST = { SCOUT: 5, STANDARD: 15, HEAVY: 40, RAIDER: 0 };

// The scripted schedule: [time in seconds, kind], escalating. The seed varies
// only the bearings (and, inside the sim, the hit rolls).
const SCHEDULE = [
  [0, 'STANDARD'],
  [15, 'STANDARD'], [18, 'SCOUT'],
  [35, 'HEAVY'], [40, 'STANDARD'],
  [60, 'STANDARD'], [62, 'STANDARD'], [65, 'SCOUT'],
  [85, 'HEAVY'], [88, 'STANDARD'], [90, 'SCOUT'], [92, 'STANDARD'],
  [115, 'HEAVY'], [116, 'HEAVY'], [120, 'STANDARD'], [122, 'SCOUT'], [124, 'STANDARD'],
  [145, 'HEAVY'], [146, 'STANDARD'], [147, 'STANDARD'], [149, 'SCOUT'], [150, 'SCOUT'], [152, 'HEAVY'],
];

// The same mulberry32 as sim.js, for the arena's own stream of bearings
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

// What a bot may know: what the screen shows, nothing more. No rounds in the
// air (they carry their pre-rolled hit), no future schedule.
function view(sim) {
  return {
    time: sim.time,
    contacts: sim.inbound().map(c => ({
      id: c.id, kind: c.kind, x: c.x, y: c.y, hp: c.hp, maxHp: c.maxHp,
      eta: sim.eta(c), chance: sim.aim(c).chance, ready: !!sim.aim(c).battery,
    })),
    batteries: sim.batteries.map(b => ({ id: b.id, rounds: b.rounds, state: sim.stateOf(b) })),
  };
}

// A bot looks at the view and returns contact ids to fire at, in order. With
// direct fire each id is one round from the nearest ready battery.
const BOTS = {
  // Everything at the soonest contact, every time
  SPAM: v => {
    const c = v.contacts.find(c => c.ready);
    return c ? v.batteries.map(() => c.id) : [];
  },
  // A random contact each time
  RANDOM: (v, random) => {
    const ok = v.contacts.filter(c => c.ready);
    return ok.length ? v.batteries.map(() => ok[Math.floor(random() * ok.length)].id) : [];
  },
  // The best the step-2 rules allow: the contact that would cost the Geofront
  // most first, among those due soon, and nothing below a 50% chance
  PRIORITY: v => {
    const ok = v.contacts.filter(c => c.ready && c.chance >= 0.5)
      .sort((a, b) => (INTEGRITY_COST[b.kind] / (b.eta + 5)) - (INTEGRITY_COST[a.kind] / (a.eta + 5)));
    return ok.length ? v.batteries.map(() => ok[0].id) : [];
  },
};

function play(bot, seed) {
  const sim = SIM.create(seed);
  const bearings = seeded(seed ^ 0x51ED);
  const botRandom = seeded(seed ^ 0xB07);
  const queue = SCHEDULE.map(([t, kind]) => ({ t, kind, bearing: SIM.SECTOR[0] + bearings() * (SIM.SECTOR[1] - SIM.SECTOR[0]) }));
  let integrity = INTEGRITY;
  let nextDecision = 0;

  while (sim.time < END) {
    while (queue.length && queue[0].t <= sim.time) {
      const s = queue.shift();
      sim.spawn(s.kind, s.bearing);
    }
    if (sim.time >= nextDecision) {
      nextDecision += DECIDE;
      for (const id of bot(view(sim), botRandom)) sim.engage(id);
    }
    sim.step(SIM.STEP);
    for (const e of sim.takeEvents()) {
      if (e.type !== 'impact') continue;
      const kind = sim.contacts.find(c => c.id === e.id).kind;
      integrity -= INTEGRITY_COST[kind];
      if (integrity <= 0) return { population: sim.population, breached: true, time: sim.time };
    }
    if (!queue.length && !sim.inbound().length) break;
  }
  return { population: sim.population, breached: false, time: sim.time };
}

const pct = (n, of) => `${(100 * n / of).toFixed(1)}%`;
const results = {};
for (const name of Object.keys(BOTS)) {
  const runs = Array.from({ length: SEEDS }, (_, i) => play(BOTS[name], i + 1));
  const mean = runs.reduce((s, r) => s + r.population, 0) / SEEDS;
  results[name] = { mean, breaches: runs.filter(r => r.breached).length };
}

console.log(`${SEEDS} seeds, ${SCHEDULE.length} contacts each, bots decide every ${DECIDE} s\n`);
console.log('bot        population left     breached');
for (const [name, r] of Object.entries(results)) {
  console.log(`${name.padEnd(10)} ${Math.round(r.mean).toLocaleString('en').padStart(9)} (${pct(r.mean, SIM.START_POPULATION).padStart(6)})   ${pct(r.breaches, SEEDS).padStart(6)}`);
}
const gap = results.PRIORITY.mean / results.SPAM.mean - 1;
console.log(`\nPRIORITY vs SPAM: ${gap >= 0 ? '+' : ''}${(100 * gap).toFixed(1)}% population (target: +30% or more)`);
