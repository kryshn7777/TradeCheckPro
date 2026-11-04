# Level 2 (Chapter II, LAMPHOLD): 1,250 m, long, and it ends on a hook for the full version

> "The level 2 must be long and end with a hook for the full version." (owner, 2026-11-04; the same message sent the video the Usher is made from)
> "Make it 1250 instead of 580." (owner, the depth: the bible's Lamphold is 600 -> 1,180 m = 580 m; it is now **600 -> 1,850 m = 1,250 m**.)

This page connects the owner's request to what is already designed (CHAPTERS.md §6 Chapter II · LAMPHOLD, DARK_STORY_BIBLE.md) and to what exists in
code today, and says what is left. It is a plan; nothing in it is built yet except the Usher model (USHER.md).

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
