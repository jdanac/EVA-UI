# G-1 spec: NERV operations command

Status: rewritten 2026-10-14 after steps 1 and 2 of the first draft were built
and judged too thin (see "Why this was rewritten"). The foundation is built;
every command mechanic below is a draft, to be refined one at a time. Numbers
are placeholders unless a mechanic says otherwise. The first draft is in the git
history (commit `20fa832` and earlier).

## The concept

You are the duty commander in the NERV operations room. Contacts come in from the
sea toward Tokyo-3. You do not aim anything. You watch the radar, decide what
each contact is and what matters, give orders to the units under your command,
and decide when to escalate: from the surface batteries, to an EVA sortie, to
the last-resort measures that cost the city to save what lies beneath it.

You hold the city, and above all you keep the enemy out of the Geofront. A
breach of the Geofront ends the run. Losing the surface does not, but it costs
population, and population is the score.

It is a game of judgment under time pressure. There is no twitch skill, nothing
to aim, and nothing that rewards pressing one key quickly.

## Why this was rewritten

The first draft was "radar contact, then press fire". Steps 1 and 2 were built
and tested, and a stress run showed the flaw: holding Space on the auto-selected
contact destroyed five contacts at once with no losses. The causes were
structural, not numbers:

- one verb (fire), with the sim choosing the battery too;
- every contact the same problem (a straight line at the city), so "soonest
  first" was always right and selection carried no consequence;
- nothing scarce, nothing uncertain, and nothing competing for attention.

More waves and tighter ammo would only have made spam run out of rounds. The
fix is a different kind of control: orders instead of aim, threats that need
different answers, and an escalation ladder with real costs.

## Design rules

1. **Orders, not aim.** The player directs units; units execute, with delays.
   Nothing the player does depends on speed of reaction, only on judgment.
2. **Every decision costs something.** Ammo, time, readiness, or the city. If a
   choice is free, it is not a choice, and it should be removed.
3. **Certainty costs time.** Contacts start unidentified. Waiting to know is a
   decision, and the contact keeps coming while you wait.
4. **An escalation ladder.** Batteries, then an EVA sortie, then last resort
   measures. Each rung is stronger and costs more, and none can be used twice
   in a row.
5. **Losing is gradual, then sudden.** Surface damage accumulates and shrinks the
   score. The Geofront is a hard line: one breach is the end.
6. **Legible at a glance.** All of it fits the fixed 1280x720 screen, and a
   person can read the situation in a second or two. Orders are one or two
   clicks (and a key) each.

## The stakes

- **Population** starts at 891,285 and is the score. It falls when a contact
  reaches the surface (today: 40,000 / 120,000 / 300,000 by type).
- **Geofront integrity** is the hard fail. Surface impacts push toward it, in
  proportion to the contact's size (draft: a HEAVY takes a large share, a SCOUT
  almost none). At zero the run ends, whatever the population.
- The bulkhead seal (C8) is the way to stop integrity falling, at the price of
  the surface.

## The command loop

One contact's life, which is also what the screen is built to show:

1. **Detect.** It shows on the wide map as an unidentified contact.
2. **Track.** It enters the scope and its course and speed are known.
3. **Identify.** Optional and costly in time: what is it, what does it want?
4. **Allocate.** Decide which units deal with it, and which contacts get nothing.
5. **Escalate.** If the batteries cannot handle it, call up something heavier.
6. **Resolve.** Destroyed, or it reaches the surface. Count the damage.
7. **Recover.** Between contacts: resupply, repair, re-plan.

Several contacts overlap, so the real game is steps 4 and 5 for the whole
picture at once.

## What is built (the foundation)

All of this stays; most of it is the stage the commands will play on.

- **World:** one baked map centered on Tokyo-3 (139.04E, 35.233N), about 49 km
  square (west 138.77, south 35.013, east 139.31, north 35.453), sea to the
  south and east, plus the Kanto outline for the wide map. Sim units are
  kilometers on a flat plane with the city at (0, 0), x east, y north; the sim
  knows nothing about longitude, latitude or pixels.
- `sim.js`: the rules with no DOM, fixed step, and a seeded random generator in
  two separate streams (spawns and hit rolls, so firing never changes where the
  next contact comes from, and `?seed=N` replays comparably). 23 checks in
  `sim.test.mjs` (`node g-1/sim.test.mjs`).
- A circular radar scope (24.5 km, rings every 5 km, a sweep that is Tokyo-3's
  own radar) over the Sagami Bay coast, a wide-area map, a contact list sorted
  by time to impact, a selected-contact panel, a battery readout, an event log
  and a ticker. Tokyo-3 with its Geofront is drawn at the center.
- Contacts: SCOUT, STANDARD and HEAVY flying a straight line at the city from a
  bearing in the sea sector (100 to 230 degrees), spawning 40 km out and
  reaching the scope at 24.5 km.
- Three batteries (north, south, east) with range, a magazine, cooldown and
  reload, rounds with flight time and a hit chance that falls with distance
  (85% close to 35% at the edge of the range), hull damage, destroyed and
  impact states, and population loss.
- **Direct fire (ENGAGE, Space or E) is a placeholder.** Mechanic C1 replaces it.
- **Known gaps:** no OpenStreetMap detail on the scope (Overpass was down on
  2026-10-14; retry with `node tools/geo.mjs detail sagami-detail 138.77 35.013
  139.31 35.453 --out g-1/data --roads "motorway|trunk|primary|secondary"
  --rivers river`, draw it the way T-1's `detail()` does, and credit
  OpenStreetMap contributors); the homepage does not link to G-1.

## Mechanics, one at a time

Each mechanic is a decision to add, with a rule sketch, what it needs first, and
how to tell it is working. They are listed in the order to build them. None is
final: each gets refined here before it is coded.

### C1. Fire orders (replaces direct fire)

*Decision created:* which battery works on which contact, and when to stop.

- A battery is HOLD (does not fire) or ASSIGNED to one contact. An assigned
  battery tracks its target, fires whenever it can and the target is in range,
  and spends ammo while it does. Nothing fires unless ordered to.
- Giving a battery a new target costs a retarget delay (draft 2.5 s) before it
  can fire, so reassigning constantly is not free.
- The player selects a contact and toggles batteries onto it (buttons in the
  panel, keys 1 to 3). HOLD FIRE is the other order.
- Ammo comes from a shared pool (C3), so a wasteful assignment hurts later, and
  the decision to *stop* firing is as real as the decision to fire.

*Needs:* nothing, but on its own it shows nothing, because every contact is
still the same problem. Build it together with C2 and C3 (milestone A).

### C2. Threat types that need different answers

*Decision created:* which contact matters most, which is not always the soonest.

Draft roles, to refine:
- **STANDARD:** heads for the city. The reference case.
- **HEAVY:** slow, a great deal of hull, a large share of Geofront damage. Wants
  several batteries on it for a long time, which leaves less for the rest.
- **RAIDER:** fast and fragile, and it goes for a battery rather than the city:
  a silenced battery stays down for a time. It matters far more than its ETA
  suggests, and it is easy to ignore until too late.
- Possibly later: **SNIPER** (stops at range and hits from there), swarms.

*Needs:* C1 (otherwise there is no way to answer differently).

### C3. Ammunition economy

*Decision created:* how much to spend on this contact, and what to keep for the
next.

- One shared pool the three batteries draw from, with a slow resupply, instead
  of a magazine each. Batteries still have a cooldown and a reload.
- A tighter hit chance at long range, so firing early is wasteful but firing
  late costs the city.

*Needs:* C1.

### Milestone A: the arena check

C1, C2 and C3 together are the first milestone, because none shows a margin
alone. After them, a bot that plays well must beat a bot that just gives all the
batteries the soonest contact, by a clear margin (see "How to tell a mechanic is
working"). Only then do waves and the rest go on.

### C4. Waves, win and lose

Eight to ten escalating contact groups, a short pause between, a win when the
last is cleared, and the lose conditions from "The stakes". A summary screen.

*Needs:* milestone A. Waves on top of a one-answer game would only be longer.

### C5. Geofront integrity and the breach

The hard fail from "The stakes", with its own readout in the city box and a
breach state (the W-1 look, red). Probably built together with C4 so a run can
end.

### C6. Identification

*Decision created:* act now on a guess, or wait to know.

- Contacts show as UNKNOWN. Identification takes time, shown as a bar, and the
  contact keeps closing. Once identified it shows its type, and a **DECOY** (not
  a threat, only worth ignoring) becomes possible.
- Firing at an unknown contact is allowed, at a penalty (more spread), so you
  can choose to gamble.

*Needs:* C2 (types worth identifying).

### C7. EVA sortie

*Decision created:* when to commit the one thing that can stop a HEAVY, and
whether to risk the unit.

Three units with a status each (as on the T-1 strip: EVA-00 and 01 in REPAIR,
EVA-02 on STANDBY). A sortie is a chain of steps, each visible and none instant:
1. **Request authorization.** The MAGI vote (the M-1 screen). It takes several
   seconds and can be denied; the odds rise with the threat. A denial means
   waiting, and resubmitting costs more time.
2. **Launch.** A delay to reach the surface, during which the contact keeps
   coming. Too late and it is wasted.
3. **On the field.** The unit is strong inside a radius, and it runs on its
   umbilical: a countdown (the C-1 screen) after which it must withdraw or is
   lost. It takes damage from a HEAVY.
4. **Recovery.** The unit is in REPAIR for a long time and cannot be used for the
   next waves.

*Needs:* C2, C4, C5 (something worth deploying against, and stakes).

### C8. Bulkhead seal

*Decision created:* give up the surface to save the Geofront.

- When a breach looks likely, seal the Geofront. It takes about 30 seconds (the
  W-1 countdown) and cannot be undone this wave. Once sealed, Geofront integrity
  stops falling, but surface impacts do double population damage: the city is
  on its own.
- It is meant to be a hard, late call, and it should sometimes be the right one.

*Needs:* C5.

### C9. Radar fidelity

*Decision created:* how much to trust what you see.

- Contact positions refresh only as the sweep passes (up to 4 s old), so what
  you see lags and a fast contact is further than it looks.
- The west radar from T-1 returns as a separate site that can be destroyed, so
  losing it blinds part of the scope. (Today the scope has no separate radar:
  the sweep is Tokyo-3's own.)

*Needs:* C2 (a RAIDER that goes for the radar), and a decision about clicking
on a position that lags.

### C10. Between waves

*Decision created:* how to spend a pause.

Repair or resupply, probably with a small budget that carries over. Optional;
it could turn a run into a small campaign.

### C11. Presentation

The layout rebuilt around orders: the selected-contact panel becomes an orders
panel, the bottom bar carries the EVA and seal controls, and the screen gets the
frame detail and kanji labels of the studies, a title and ending screens, maybe
sound, a back link and a homepage card. The circular scope, the contact list,
the log and the styling already built stay.

Command words for the kanji labels: 交戦 ENGAGE, 待機 HOLD, 出撃 SORTIE, 承認
AUTHORIZED, 否決 DENIED, 隔壁閉鎖 BULKHEAD SEAL, 識別 IDENTIFY.

## How to tell a mechanic is working

### The arena (a bot test)

`sim.js` has no DOM, so strategies can be tested without a browser. Plan a
script, `g-1/arena.mjs` (Node built-ins only, like the test file), that plays
the same seeds with different bots and reports population left, breach rate and
win rate:

- **SPAM:** gives every available battery the soonest contact, always. The
  baseline, and the thing the first draft lost to.
- **RANDOM:** assigns at random. A floor.
- **PRIORITY:** a heuristic that uses what the mechanics offer: raiders first,
  focus fire on heavies, hold fire on low hit chances, call the sortie at the
  right moment.

A mechanic earns its place if it widens the gap between PRIORITY and SPAM. A
first target: over 300 seeds, PRIORITY keeps at least 30% more population than
SPAM, and SPAM loses before the last wave. If a mechanic does not move the
numbers, it is cut or reworked, not kept for being clever.

This measures decision depth, not fun. It catches "nothing to decide" early and
cheaply; it cannot say whether the decisions are interesting.

### The human test

After milestone A, and again after waves and after the EVA sortie, play five full
runs and answer:
1. Did you ever have to choose between two contacts, and was it hard?
2. Did you ever regret an assignment, and was it your own fault?
3. Could one habit (the same order every time) win? If yes, the design fails.
4. Could someone new read the situation without being told?

## Open decisions for the owner

These are theirs, with a default if they have no view.

1. **Pause.** Real time with no pause (default: it keeps the tension, and each
   contact takes about 45 seconds), or an order-planning pause as in some
   command games.
2. **How hard is the Geofront line?** Default: a hard fail on a breach.
3. **Fiction.** The studies use "PATTERN BLUE" for the unknown contact. Default:
   contacts are UNKNOWN until identified, and a threat is then classed PATTERN
   BLUE, with no further lore.
4. **Scale.** Default: one run of eight to ten waves, played in a sitting.
   Between-wave repair (C10) is the first step toward anything longer.

## Not in scope

Touch input, accounts or online scores, a map editor, and the T-1 study itself,
which stays as it is.
