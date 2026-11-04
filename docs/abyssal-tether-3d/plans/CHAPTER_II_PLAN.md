# Level 2 (Chapter II, LAMPHOLD): 1,250 m, long, and it ends on a hook for the full version

> "The level 2 must be long and end with a hook for the full version." (owner, 2026-11-04; the same message sent the video the Usher is made from)
> "Make it 1250 instead of 580." (owner, the depth: the bible's Lamphold is 600 -> 1,180 m = 580 m; it is now **600 -> 1,850 m = 1,250 m**.)

This page connects the owner's request to what is already designed (CHAPTERS.md §6 Chapter II · LAMPHOLD, DARK_STORY_BIBLE.md) and to what exists in
code today, and says what is left. It is a plan, plus two built pieces: the Usher model (USHER.md) and a **graybox of the whole 1,250 m chapter** (section 6).

## 1. What the request means here

* "Level 2" is Chapter II. Today the game IS Chapter I (8 sections, 556 m, the free release: FREE_RELEASE_PLAN.md). The engine has one `Level3D`
  (`data/level-data-3d.js`); the chapter framework (CHAPTERS.md E04: a `Level3D` per chapter, a depth offset, a chapter swap on a chain, per-chapter
  saves, `entitlement.isChapterPlayable(n)`) is dormant: `Game.isChapterPlayable(n)` answers `n === 1`.
* "Long" and "1,250 m": the bible's Lamphold is 580 m (nine beats, 30-34 min first time on Normal). At 1,250 m it is **2.15x as deep**: about **60-70 minutes** first time on Normal (the same pace as the bible: ~2.2 min per 100 m, set-pieces longer), 13-15 minutes skilled on Abyss. That is longer than the whole of Chapter I (556 m, ~25-28 min). Coordinates are chapter-local (spawn near y = 0, the chapter is 1,250 m tall); `depthOffset` 600 keeps the readout continuous, and **Chapters III-V move down by 670 m** (their depth ranges in CHAPTERS.md shift; nothing else about them changes).
* "A hook for the full version": today the plan sells Chapters II-V ($9.99 add-on) after Chapter I. The owner's wording reads as: Chapter II is part of
  what a player gets first (free, or the first step beyond the demo), and its ending is what makes them want Chapters III-V. **Assumption to confirm:
  Chapters I and II are free, III-V are the full version.** The entitlement code does not care which; it is one number (`FREE_CHAPTERS`).

## 2. The shape: 13 beats, 1,250 m (the bible's nine, stretched, plus four new ones that remix the rule)

Times are first-time, Normal, deaths included. **New** = not in the bible. Depths are real (readout) metres.

| # | Beat | Depth (m) | Rule / purpose | Min |
| --- | --- | --- | --- | --- |
| II-1 | The Lowering (seam) | 600-640 | TEACH live anchors: a chandelier ring comes to you | 2.5 |
| II-2 | The Street of Doors | 640-720 | TEACH yank (a counterweight lift); "KNOCK, AND BE KNOWN." | 4.5 |
| II-3 | The Chandeliers | 720-830 | TEST: five swinging rings across a 60 m gap, then a second span with two chains | 5 |
| II-4 | The Waking Hall | 830-890 | REST / TRUTH: thousands of beds under their own lamps | 3 |
| II-5 | **The Stone Yards** (new) | 890-1,010 | TEACH 2: crane hooks on rails (3-6 m/s loops), a rail you can ride between yards | 5 |
| II-6 | The Dressing Yards | 1,010-1,130 | TWIST + CREATURE: `safeLight` (lit clusters the Mason cannot enter) | 6 |
| II-7 | **The Counterweight Shafts** (new) | 1,130-1,260 | SPEED: express drops (80 m in 9 s, peak 13 m/s), three shafts in a row, one you must time against the Mason's sound | 5.5 |
| II-8 | The Hung Quarter | 1,260-1,360 | REMIX (I + II): the governor, driven pendulum houses [cuttable] | 4.5 |
| II-9 | **The Tolling Gallery** (new) | 1,360-1,460 | REST / TRUTH 3: a bell-ringing gallery (the bell verb from Chapter I), the Usher's first sighting (see section 3) | 4 |
| II-10 | The Winding Floor / The Stopping | 1,460-1,560 | CREATURE BEAT: the engine stops, the Mason jams in the gears, the runaway | 5.5 |
| II-11 | **The Cinder Stairs** (new) | 1,560-1,640 | RECOVERY with dread: the burnt stairs, falling debris, the first lamps failing | 3.5 |
| II-12 | THE SNUFFING (exam) | 1,640-1,790 | EXAM: the lamps go out tier by tier; the Span (150 m, up from 100) | 8 |
| II-13 | The Soot Throat | 1,790-1,850 | RECOVERY, then THE HOOK | 3 |

Depth check: 40 + 80 + 110 + 60 + 120 + 120 + 130 + 100 + 100 + 100 + 80 + 150 + 60 = **1,250 m**. Minutes: 60 (the bible's way of adding it up; with deaths a
median first-time player lands near 65). The [cuttable] beats (II-4 shrinks to 1.5 min, II-8 drops its houses) are worth about 5 minutes if the chapter has to be shortened.

Already in the engine from Chapter I (so not new work): movers (pendulum / orbit) and dynamic anchors with the rope taking the anchor's velocity
(P4), pull-anchors and haul rings, the Mason's hearing / lure / stopping hooks (P5), the wind squalls (P6), the Dresser, the Holdfast, checkpoints
as waking lamps, the medals / splits, the bots that verify routes. Chapter II needs: a **second level data file**, **its theme and kit art**, the
**safeLight** volumes and **noise masking** (E18, E11), the **crush** rule telegraphs (E16), the **Snuffing** director (spreading dark by tier), and the
**chapter swap**.

## 3. The Usher and the hook (II-9 first sighting, II-13 the hook)

First sighting (II-9, the Tolling Gallery, a rest beat): when you ring the gallery's bell, the sound goes down the pit and something answers from far below: a pale ring of light turns in the dark a hundred metres under you, then is gone. No chase, no damage: the Usher is seen, never fought, in this chapter.

The hook (II-13, the last two minutes):

The bible ends the last beat on a silver glint and the chapter card "III . THE MERE". With the Usher (USHER.md) it becomes the owner's "nightmares can
be beautiful too":

1. The Soot Throat (II-13) is silent and safe (the "true rest, never betrayed" rule stays: it is the last place the game is kind).
2. You lower on a chain. Below, black water, perfectly still, and the first light that is not a lamp: a cold pale ring, then many, in rows, under the
   surface: the Ushers, headless, standing in the Mere in ranks, throats rising to the surface like stems, each ending in a glowing ring that turns
   as you pass (the `Listen` clip). One, close to the chain, rears its throat to your height and stops (a held `Lunge` pose, ring opening): it does
   not strike. The chain stops.
3. Title card, no voice: **III . THE MERE** and, under it, one line (proposal): *"They have been waiting since the first lamp."* Then the end card:
   the chapter's time, deaths and Names, and the call to action for the full game (Chapters III-V: the Mere, the Keeping, the Still Flame).
4. Why it hooks: it answers a question the player has carried since the first Mason glimpse (what is the Mason made of: "everyone the light ever left
   behind") by showing a second, unexplained species, and it is the strongest image in the game, shown once, unfought, at the exact moment the player's
   guard is down.

## 4. Work packages (in order; each ends with the harness green)

| WP | What | Size | Gate |
| --- | --- | --- | --- |
| C2-0 | **Chapter framework** (E04 slice): `Game` loads `Level3D(chapterData[n])`, depth offset, the chapter swap at the end of I (the chain from THE MARK), per-chapter save keys, `FREE_CHAPTERS`, a chapter picker on the menu, bots / verify take `--chapter ch2` | M (the biggest risk: saves, menus, splits, medals all assume one level) | Chapter I unchanged (all suites + verify green); a stub Chapter II loads, plays, saves, resumes |
| C2-1 | **Graybox of II-1..II-13 as data** (1,250 m: about 2.2x the data of the bible's 580 m; Chapter I's whole level file is 1,400 lines for 556 m): solids, rings, movers on rails, lamps (checkpoints), hazards, the creature config per difficulty, the Snuffing beats | L | bots clear every beat on safe and fast lines, on all three difficulties; the movers' speed cap (13 m/s) verified |
| C2-2 | Lamphold kit art (honey stone, doors, beds, chandeliers, lamps, the engine) and the three themes | L | the Quest budget harness (<= 150 calls, <= 350 k stereo triangles) per beat |
| C2-3 | The Usher in the game: `render/usherView.js` (the contract is in USHER.md), a sight-only sim entity for the hook and for II-2 / II-4 sightings (no kill), the ring's light in the lighting rig, audio (the knock, the breath through the throat) | M | seen, never touching; Quest budget |
| C2-4 | The hook sequence (II-9), the end card and the full-version call to action (`entitlement` wiring, store link) | S-M | played by hand on a headset |
| C2-5 | Music / ambience for the chapter; polish; playtest gate (10 first-time VR players, median 30-34 min, <= 3 median deaths per set-piece) | M | the bible's chapter gate |

The bible puts the 580 m chapter at about **8 weeks for a small team** (CHAPTERS.md §13, M2); at 1,250 m it is closer to **16-18 weeks** unless the four new beats are cut. A single working session can do C2-0 and a graybox slice
of C2-1; it cannot honestly do the rest to the "polished" bar the project holds itself to.

## 5. What is decided and what is not

Decided (by the existing bible and the owner): nine of the thirteen beats, the rule (live anchors), the Mason's behaviour in the chapter, the palettes, the depth (1,250 m).
Proposed here (needs the owner): the four new beats and their rules, free vs paid line (Chapters I-II free), the Usher's role and the hook sequence above, the name "Usher" (a placeholder).

Engine risks of 1,250 m in one `Level3D` (to measure in C2-0): the baked lightmap atlas and light volume (sized for 556 m), the chunk / band culling (`BAND_H`, per-section packs), the save / split tables (8 sections today), the bots' route verification time, and the memory cache (`levelCache`) for the dressed level.

## 6. Status (2026-11-04, end of the build session): what exists

CHAPTER II is **playable end to end** (menu: *Choose your descent* › **II · Lamphold**, or the **Chapter II · Lamphold** button on Chapter I's end card, or `?chapter=2`).
It is a **vertical slice of the direction** (CHAPTER_II_DIRECTION.md), not the finished chapter. Tests: `tests/level/chapter2*.mjs`, `tests/render/test-mere.mjs`,
`tests/creature/usher3d.mjs`, `tests/render/test-usher-view.mjs`, the save / entitlement / captions / audio suites (the whole suite is green).

**Framework (C2-0, done).** `Game.setChapter / playNextChapter / chapter`; per-chapter saves (`meta/save.js` `activeChapter`: records, splits, the Continue slot are
`ch1` / `ch2`, never mixed; Continue switches chapter); Chapters I and II are the free game (`FREE_CHAPTER = 2`); section numerals `II·n`; the chapter picker in the flat
menu and the VR menu; the end card of Chapter I points on to Lamphold, the end card of Chapter II to the full version.

**The chapter (C2-1, done as a skeleton with its machinery).** 13 beats, 1,250 m (+36 m of the hook's chain), a spiral stair (the always-open way) with live anchors on it:
pendulum chandeliers (II-1 36 m chain at 7.5 m/s; II-3 five at 5.5 .. 10.9 m/s; II-8 two houses), the counterweight lift (II-2), two crane hooks and a monorail trolley
(II-5, 4.5 .. 6 m/s), three express cages (II-7, 80 m in 9 s, peak 13 m/s), the governor (II-8, 8.4 m/s), the wheel (II-10). New mover kinds `lift` (trapezoid profile, one-trip
`once` for scripted lifts) and `path` (loop / pingpong) in `sim/movers3d.js`. **Carriers** (`sim/lampholdDirector.js`): a lift flagged `carrier` carries the player who stands
on it (the floor is not a collision solid: the player's height follows it after the physics step). The story writer's text (`data/chapter2-text.js`): 11 hints, 16 plaques, the
Names, the lamp labels, the Usher's captions, the boss's and the hook's lines. 2,600 wall lamps + the stalls (`render/lampField.js`, one draw call), put out from the top
down from the Winding Floor on; lights have a `gain` the Evening sets (`render/renderer3d.js`).

**The Usher (C2-3, done).** `sim/usher3d.js` (the toll bus with masking, the states of §3.7 on three difficulties, 538 checks), `render/usherView.js` (the model, LODs, the long
throat, the torch spheres), captions and sounds (`audio/lampholdSfx.js`), **II-9 THE TOLLING GALLERY** (eight bells; five open a seal across the pit; the Usher answers from 100 m
below, climbs a station per toll, strikes the Tenor and breaks its stand, never while you are near: the strike waits).

**The exam (C2-boss, done in a reduced form).** II-12 THE SNUFFING as the Quiet (150 s), **A the Round** (a lead Usher walks the stair behind you snuffing a cluster at a time, torch
first, 1.6 s; four companions walk with it; a staller is answered), **B the Well** (the Doorman on the pulpit: collar, the sweep over the stalls, the Great Bell's stroke every 6 s,
the pawl broken by his whip or your body at 3.5 m/s, the clappers W and N as haul rings, the Great Bell held back while his answer is pending), **C1 the Span** (50 plates, 150 m,
falling behind you: front 7 m/s rubber-banded to a 22 / 16 / 11 m gap, a creak 0.7 s ahead, a crash toll each), **C2 the Lift** (a lever haul ring, the cage 33 m down, a gong every
5 m, whips led to the cage's predicted position at 4.5 s (NM 3.9, AB 3.5), the last whip snuffs the master lamp, the shutter shuts 6 / 5 / 3.75 s later, he sits). Waking lamps L2-17 / 18
/ 19 are checkpoints. Nothing hunts you in II-13. 49 director checks, the arena walked end to end in the real physics.

**The hook (C2-4, done).** The Soot Throat's stair ends at a lip; the chain platform (a carrier, one trip) lowers 36 m, a pawl click every 3 m; the pit's walls end 14 m under the lip
and the Mere opens (`render/mereView.js`: black water, 1,400 dark lanterns, 103 throats that turn to the clicks, the near one rises to your eye, all bow into an aisle, one warm
light at 180 m; 4 draw calls); `III · THE MERE` and its line as the chapter card; then Chapter II's end card. A jump into the water plays the card at once (the first fall that does not kill).

**Finished after the first push (the cut list).** The five **Names** (N2-1 .. N2-5: slabs with the name carved, on the stair, off it, and where only a release at the third
chandelier's full swing lands; found by standing at them; "Names n / 5" on the end card); the Span's **trolleys** (two iron rings on the under-rail, 7 and 9 m/s); **lit clusters** in
the Dressing Yards (three rests the Mason cannot enter, a budget that never runs out); the **hammer floor** and **THE STOPPING** of II-10 (the escapement's last ring: 4 s of
grinding, then the wheel and the hammers stand still for 14 s and the wheel runs on where it stood: `stopAt` / `stopFor` in `sim/movers3d.js`, `off` on lanes); the **burnt stair** of II-11
(every third tread crumbles; three lanes of embers); the chapter's **radio** (the writer's six lines on the shipped radio director, `chapter2Glue.js`); the end card's **full-version
button** (the store's own price through `platform/entitlement.js`; outside a store install it says where the game is and does nothing). Tests: `tests/level/chapter2-beats.mjs`,
`tests/comms/chapter2-radio.mjs`.

**Still not built (honest list).** The knock doors (II-2) and the Holdfast "handshake"; the Waking Hall's hands and tally plates; the stone yards' crane crush telegraph; the Mason's breach and its hidden path
in the walls, noise masking in the din, the Dresser's measurement in II-6; the crushing counterweights and the Mason in the shafts (II-7); the rope telegraph (the buzzing hand); driven pendulum houses; the
lamp you cannot keep (II-11); the Round's five tier galleries, their bells and clapper rings (the Round walks the stair instead); a real moving cage *floor* for the Doorman's lift (by design you hang
from outrigger rings); the Lamphold art kit and its lightmaps (Chapter I's baked lighting does not apply); the in-world chain at the end of Chapter I (the end card's button starts Lamphold).
**Nothing has been played on a headset.** The numbers (the Round's pace, the Span's gap, the whips' lead, the cage rings' distance from the sphere, the hammers' damage) are closed-form-checked and
tuned for Normal; the boss has not been beaten by a bot on a rope route, only its pieces checked (CHAPTER_II_DIRECTION.md section 5.2 asks for the bot proof).
