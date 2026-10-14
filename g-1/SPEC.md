# G-1 spec: radar defense, steps 1 to 3

Status: steps 1 and 2 built (see the end of this file). Every number here is a
starting value to tune, not a decision. This covers roadmap steps 1 to 3 only (moving
contact, engage, pressure). Steps 4 to 7 are listed at the end so they are not
forgotten and not built early.

## The game in one paragraph

Contacts approach Tokyo-3 from the sea. You watch them on the radar, pick which
one to fire at and when, and spend limited ammo from three batteries. A contact
that reaches the city costs population. Survive eight waves with at least 40%
of the population left. Score is the population remaining.

The decision is the whole game: fire early and the shots miss, fire late and
the city takes the hit. Ammo is short enough that you cannot fire at everything.

## Setup and scale

- **Region:** one new baked map, centered on Tokyo-3 (139.04E, 35.233N), about
  49 km square: west 138.77, south 35.013, east 139.31, north 35.453. Sea to the
  south and east (Sagami Bay), mountains to the north. Baked with
  `tools/geo.mjs`, which needs a small option for the output folder (it writes
  to `t-1/data` today). Budget: under about 500 KB, so keep roads to primary and
  up and drop minor detail.
- **Overview:** the existing Kanto data (28 KB) as a small inset, for early
  warning. It is only a display; contacts exist in the sim before they reach
  the main map.
- **Sim units:** kilometers on a flat plane, city at (0, 0), x east, y north.
  The sim knows nothing about longitude, latitude or pixels. One function
  converts km to lon/lat for drawing, then the existing projection takes over.
- **Contact spawn:** 40 km from the city, on a bearing inside the sea sector
  (100 to 230 degrees clockwise from north). A contact enters the main map at
  about 24 km. So a normal contact gives roughly 20 s of tracking on the
  overview and 25 to 30 s of engagement on the main map.

## Entities

| Thing | Fields | Notes |
|---|---|---|
| Contact | id, kind, x, y, hp, state | state: `inbound`, `destroyed`, `impact` |
| Battery | id, x, y, rounds, cooldown, reload | three, taken from the T-1 `SITES` |
| City | population | starts at 891,285, same as the T-1 strip |

Contact kinds (placeholders):

| Kind | Speed km/s | HP | City damage on impact |
|---|---|---|---|
| SCOUT | 1.2 | 50 | 40,000 |
| STANDARD | 0.8 | 100 | 120,000 |
| HEAVY | 0.5 | 200 | 300,000 |

Contacts fly a straight line at the city and impact inside 2 km of it.

## Rules

- **Batteries:** range 12 km, 6 rounds, 1.5 s between shots. At zero rounds a
  battery reloads for 10 s and cannot fire.
- **Engage:** one press fires one round at the selected contact from the best
  available battery (in range, has a round, off cooldown, highest hit chance).
  No battery available means the press does nothing and the log says why.
- **Hit chance:** 85% at 4 km or closer, falling in a line to 35% at 12 km. The
  roll is made when the round is fired, with the sim's seeded random generator.
- **Shot flight:** 6 km/s, so up to 2 s. Damage is 50 if it hits. If the
  contact is already destroyed when the round lands, the round is wasted.
- **Between waves:** 6 s pause, and each battery gets 3 rounds back (cap 6).
  This is the ammo economy and the number most likely to need tuning.
- **Lose:** population below 40% of the start. **Win:** wave 8 cleared.

### Waves

| Wave | Contacts |
|---|---|
| 1 | 1 standard |
| 2 | 2 standard |
| 3 | 2 standard, 1 scout |
| 4 | 3 standard, 1 scout |
| 5 | 1 heavy, 2 scout |
| 6 | 3 standard, 2 scout |
| 7 | 2 heavy, 2 standard |
| 8 | 2 heavy, 3 standard, 2 scout |

Contacts in a wave spawn staggered over 10 s so they arrive spread out.

## Controls and layout

Placeholder layout, existing palette, no ornament (see the sketch in the
conversation: one large main map, overview inset, contact list and selected
panel on the right, thin bar along the bottom). Fixed 1280x720, scaled by the
same `fit()` as the studies.

- **Contact list:** sorted by time to impact, soonest first, with the ETA in
  seconds. It is the main way to choose a target.
- **Selecting:** click a blip, click a list row, or Tab and the arrow keys to
  step through the list. A new contact is auto-selected only if nothing is.
- **Engage:** the ENGAGE button, or Space.
- **Bottom bar:** population, rounds per battery with reload state, wave.
- **Event log:** a one-line ticker, not the T-1 box.
- **Radar sweep:** cosmetic in these steps (a rotating line and range rings
  every 5 km). It does not affect the sim.

## Code layout

New self-contained folder, `g-1/`, copied from `t-1/`:

- `index.html`, `style.css`, `script.js`: layout, drawing, input.
- `sim.js`: the rules only. No DOM, no clock of its own. `step(dt)` advances
  it, `engage(id)` is the player's one action, a snapshot is readable, and it
  queues events (spawn, shot, hit, miss, impact, wave start) for the UI to log
  and animate. Fixed timestep of 1/30 s, driven by an accumulator in
  `script.js`. Seeded random generator, so a run can be replayed.
- `data/<region>.js`: the new map, plus the Kanto data for the inset.
- `sim.test.mjs` (only if approved, see below): plain Node, built-ins only.

The same rule as the studies applies: CSS owns the look and JS sets
attributes (`data-state`, `data-kind`, `data-selected`, `data-status`). Positions
go on SVG elements as attributes. `data-state` on `.screen` is `idle`, `running`,
`paused` or `gameover`.

## Steps and what proves each one

**Step 1: moving contact.** The new region is baked and drawn. A contact spawns,
shows on the overview, crosses onto the main map and reaches the city, with the
list, ETA and radar sweep in place. No firing yet.
- Done when: a contact crosses the whole path in the expected 45 to 50 s, its
  position matches on both maps, and a replay with the same seed repeats it
  exactly.

**Step 2: engage.** Batteries, ammo, hit rolls, shot animation, damage,
destroyed and impact states, population drops on impact.
- Done when: you can lose by letting one through, win by stopping one, and the
  numbers in the bottom bar always agree with the log.

**Step 3: pressure.** Waves, resupply, win and lose, game-over screen, restart,
pause.
- Done when: eight waves can be played start to finish. The fun test below
  passes.

### The fun test (end of step 3)

Play five full runs and answer:
1. Did you ever have to choose between two contacts, and was it hard?
2. Did you ever run out of ammo and feel it was your own fault?
3. Can spamming ENGAGE at the nearest contact win? If yes, the design fails.
4. Is wave 1 clear without reading anything?

If 1 or 2 is no, or 3 is yes, change the rules (numbers first, then
mechanics) before building anything from the list below.

## Not in these steps

Radar identification and decoys (the sweep starts affecting what you see), the
EVA sortie with the C-1 countdown and REPAIR cooldown, the M-1 authorization
vote, the W-1 failure screen, sound, a tutorial, kanji and frame detail on the
new layout, touch input, high score saved in the browser, more regions.

## Open items to confirm before step 1

- DECIDED: a small Node test file for `sim.js`, run with
  `node g-1/sim.test.mjs`. One file, built-ins only (`node:assert`), no
  package.json, same standing as `tools/geo.mjs`. Dev-time only; the page never
  loads it. This is the one exception to the repo's "no tests" rule.
- Approve the `geo.mjs` output-folder option.
- Add a "game" section to `CLAUDE.md` and a game card on the homepage (the
  homepage says "studies").

## Step 1 as built, and where it differs from the draft

Built: `sim.js` (spawn, straight-line flight, scope and impact events, seeded
random, 10 checks in `sim.test.mjs`), the screen, and the new region.

- **The scope is a circle, not a square map.** The sim says a contact is on the
  scope at 24.5 km, so the map is clipped to a circle of that radius and the
  contact appears at the same distance in every direction. The layout is
  therefore three columns (wide map and scope facts, scope, contacts and
  selected contact) instead of the sketch with a large map and a side column.
- **Sim and map share one flat conversion** (km to lon/lat around the city), not
  Web Mercator, so they cannot disagree. At 50 km the difference is invisible.
- **Land only.** Two files are baked: `sagami-land` (Natural Earth, 6.6 KB, the
  main scope) and a copy of the Kanto outline for the wide map. The OpenStreetMap
  detail bake (roads, rivers, water, peaks) failed with Overpass 504 errors on
  2026-10-14, even for a tiny query, so the scope shows coast, sea and the
  sites but no roads. Retry with:
  `node tools/geo.mjs detail sagami-detail 138.77 35.013 139.31 35.453 --out g-1/data --roads "motorway|trunk|primary|secondary" --rivers river`
  Then draw it in `drawMaps` (the `detail()` function in T-1 is the model) and
  credit OpenStreetMap contributors in the SCOPE box.
- **Bottom bar** has test controls (type, DETECT, RESET) in place of nothing,
  plus the ticker and the population (still static: it changes in step 2).
- **ENGAGE** is on screen, disabled.
- `?seed=N` in the URL replays a run; RESET without it picks a new seed.
- The homepage card is not added yet, so the game is not linked from the
  dashboard until it is worth showing.

## Step 2 as built

Built: three batteries with rounds, cooldown and reload; a round with a flight
time, a hit roll made when it is fired, and damage when it lands; destroyed and
impact states; population that drops on impact; the ENGAGE button and Space or
E; a battery readout, an event log and a live population. 22 checks in
`sim.test.mjs`.

- **Rules as written in this spec**, with these choices where it was silent: the
  nearest ready battery fires; a refused press (no target, out of range, all
  batteries cycling) is an event, so the log says why; a round whose target is
  already destroyed or has hit the city is "wasted"; the hit roll uses the
  distance at the moment of firing, and the contact is not led.
- **Batteries are in `sim.js`** (km from the city, converted once from T-1's
  north, south and east batteries), since the rules need them.
- **The west radar is gone from the scope.** The sweep is Tokyo-3's own radar,
  at the center. Idea for step 4: make a separate radar site a vulnerable
  asset, so losing it makes the scope go blind.
- **Layout:** the left box is now BATTERIES plus a seven-line EVENT LOG (the
  SCOPE facts moved to the corners of the scope: range and rings top left,
  clock and seed top right). The selected panel gained HULL, HIT (the chance of
  the shot that would be fired right now) and BATTERY (which one, or CYCLING).
  The ticker stays as the latest event in its level's color.
- **A destroyed contact** turns teal and stays for 2.5 s, as an impact does.

### First read on the balance (placeholder numbers, to be tuned in step 3)

A stress run held Space on the selected contact against five contacts at once
(standard, scout, heavy, standard, scout, about 500 hull in all). All five were
destroyed and no population was lost, with 5 of 18 rounds left. So the guard
rail in the fun test below, "spamming ENGAGE wins", is already close to failing
before waves, resupply and decoys exist. Likely levers, in order: fewer rounds
per magazine or a longer reload, a lower hit chance at long range, tighter
spacing of the wave so ammo runs out, then hull values. Tune with a script
against `sim.js` before judging by feel.
