// The arena: plays the same seeds with different bots and compares them, to
// tell whether the rules leave anything to decide (see "How to tell a mechanic
// is working" in SPEC.md). Dev-time only, never loaded by the page.
//   node g-1/arena.mjs            300 seeds
//   node g-1/arena.mjs 50         fewer, for a quick look
// Node built-ins only: no package.json, no install.
//
// A bot gives the same orders a person can (assign a battery to a contact, or
// hold it), sees only what the screen shows, and decides once a game second.

import SIM from './sim.js';

const SEEDS = Number(process.argv[2]) || 300;
const DECIDE = 1;          // bots decide once a game second, never every step
const END = 300;           // seconds a run lasts at most

// The same mulberry32 as sim.js, for the RANDOM bot's own stream
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

// What a bot may know: what the screen shows, nothing more. Rounds in the air
// are counted (the tracers are visible) but never whether they will hit, and
// nothing about the schedule ahead.
function view(sim) {
  return {
    time: sim.time,
    ammo: sim.ammo,
    integrity: sim.integrity,
    contacts: sim.inbound().map(c => ({
      id: c.id, kind: c.kind, objective: c.objective, hp: c.hp, eta: sim.eta(c),
      chance: Object.fromEntries(sim.batteries.map(b => [b.id, sim.chanceOf(b, c)])),
      inFlight: sim.shots.filter(s => s.target === c.id).length,
    })),
    batteries: sim.batteries.map(b => ({ id: b.id, target: b.target, state: sim.stateOf(b) })),
  };
}

// A bot looks at the view and returns orders: { battery: contact id } to
// assign, { battery: null } to hold, and a battery left out keeps its order.
const BOTS = {
  // Every battery on the soonest contact, always
  SPAM: v => {
    const first = v.contacts[0];
    return Object.fromEntries(v.batteries.map(b => [b.id, first ? first.id : null]));
  },

  // One habit, played sensibly: a battery with nothing to do takes the soonest
  // contact and stays on it until it is finished. No retargeting, no holding.
  STICKY: v => {
    const first = v.contacts[0];
    const out = {};
    for (const b of v.batteries) if (!b.target && first) out[b.id] = first.id;
    return out;
  },

  // The same habit, plus one rule of thumb: never fire below a 50% chance.
  // If this does as well as PRIORITY, the game is one habit deep.
  PATIENT: v => {
    const out = {};
    for (const b of v.batteries) {
      if (b.target) continue;
      const c = v.contacts.find(c => c.chance[b.id] !== null && c.chance[b.id] >= 0.5);
      if (c) out[b.id] = c.id;
    }
    return out;
  },

  // A battery with nothing to do takes any contact at random and keeps it
  RANDOM: (v, random) => {
    const out = {};
    for (const b of v.batteries) {
      if (b.target || !v.contacts.length) continue;
      out[b.id] = v.contacts[Math.floor(random() * v.contacts.length)].id;
    }
    return out;
  },

  // Uses what the rules offer: raiders and heavies first by what they would
  // cost, no more batteries on a contact than its hull needs, and no firing
  // below a fair hit chance (holding instead, to save the pool)
  PRIORITY: v => {
    const VALUE = { RAIDER: 30, HEAVY: 40, STANDARD: 15, SCOUT: 5 };
    const MIN_CHANCE = 0.5;
    const urgency = c => VALUE[c.kind] / (c.eta + 5);
    const free = new Set(v.batteries.filter(b => b.state !== 'silenced').map(b => b.id));
    const out = {};
    for (const c of [...v.contacts].sort((a, b) => urgency(b) - urgency(a))) {
      const hits = Math.ceil(c.hp / SIM.SHOT_DAMAGE) - c.inFlight * 0.6;
      let want = Math.min(3, Math.max(0, Math.ceil(hits)));
      // Batteries already on it first (no retarget delay), then the best chance
      const bats = [...free]
        .filter(id => v.contacts.length && c.chance[id] !== null && c.chance[id] >= MIN_CHANCE)
        .sort((a, b) => {
          const on = id => v.batteries.find(x => x.id === id).target === c.id ? 1 : 0;
          return on(b) - on(a) || c.chance[b] - c.chance[a];
        });
      for (const id of bats) {
        if (want <= 0) break;
        out[id] = c.id;
        free.delete(id);
        want--;
      }
    }
    for (const id of free) out[id] = null;
    return out;
  },
};

function play(bot, seed) {
  const sim = SIM.create(seed);
  const botRandom = seeded(seed ^ 0xB07);
  const queue = SIM.schedule(seed);
  let nextDecision = 0, fired = 0;

  while (sim.time < END && !sim.breached) {
    while (queue.length && queue[0].t <= sim.time) {
      const s = queue.shift();
      sim.spawn(s.kind, s.bearing);
    }
    if (sim.time >= nextDecision) {
      nextDecision += DECIDE;
      for (const [b, id] of Object.entries(bot(view(sim), botRandom))) {
        if (id) sim.assign(b, id); else sim.hold(b);
      }
    }
    sim.step(SIM.STEP);
    fired += sim.takeEvents().filter(e => e.type === 'fire').length;
    if (!queue.length && !sim.inbound().length) break;
  }
  return { population: sim.population, breached: sim.breached, integrity: sim.integrity, fired };
}

const pct = (n, of) => `${(100 * n / of).toFixed(1)}%`;
const mean = (runs, k) => runs.reduce((s, r) => s + r[k], 0) / runs.length;
const results = {};
for (const name of Object.keys(BOTS)) {
  const runs = Array.from({ length: SEEDS }, (_, i) => play(BOTS[name], i + 1));
  results[name] = {
    population: mean(runs, 'population'), integrity: mean(runs, 'integrity'),
    fired: mean(runs, 'fired'), breaches: runs.filter(r => r.breached).length,
  };
}

console.log(`${SEEDS} seeds, ${SIM.schedule(1).length} contacts each, bots decide every ${DECIDE} s\n`);
console.log('bot        population left     breached  geofront  rounds fired');
for (const [name, r] of Object.entries(results)) {
  console.log(`${name.padEnd(10)} ${Math.round(r.population).toLocaleString('en').padStart(9)} (${pct(r.population, SIM.START_POPULATION).padStart(6)})   ${pct(r.breaches, SEEDS).padStart(6)}   ${r.integrity.toFixed(0).padStart(6)}   ${r.fired.toFixed(0).padStart(8)}`);
}
const gap = results.PRIORITY.population / results.SPAM.population - 1;
console.log(`\nPRIORITY vs SPAM: ${gap >= 0 ? '+' : ''}${(100 * gap).toFixed(1)}% population (target: +30% or more)`);
// The harder check: against the best single habit, not the worst
const habit = results.PRIORITY.population / results.PATIENT.population - 1;
console.log(`PRIORITY vs PATIENT: ${habit >= 0 ? '+' : ''}${(100 * habit).toFixed(1)}% population`);
