# MASON BODY SIGHT + THE LEASH WOUND: it sees YOU up close; outrun it and it tears itself on the stone, then comes back

Owner (2026-11-06): *"The mason should see things; if it sees the player directly, it comes and attacks. If the player moves too far,
it might escape, but it takes damage and comes back."* Clarified:

1. **Sight**: *"Also see the body up close"*: keep the lantern sighting (MASON_SIGHT.md) and ADD direct sight of the player's BODY
   within about 12 m in a clear line, even with the lantern covered (LANTERN_HOOD.md) or empty.
2. **Escape**: *"The Mason is hurt, then returns"*: a player who gets far enough away makes the Mason lose him; it falls back HURT (a
   wound that heals), then comes back to hunt again.

Code: `src/sim/masonSight.js` (`SIGHT_TUNE` grows `bodyRange`, `leashFar`, `leashLost`, `heal`; the body sense; the leash test),
`src/sim/creature3d.js` (`_leashWound`, the heal timer `_woundT`, the return), `src/audio/weaponSfx.js` (one route: the existing
pained screech + withdrawing rumble), `src/ui/captions.js` (two captions), `src/ui/tutorial.js` (the `sight` hint text), `src/game.js`
(the debug read-out only). Tests: `tests/creature/body-sight.mjs`, `tests/creature/leash.mjs` (new); `sight.mjs`, `hood.mjs`, the
tutorial text check updated.

## 1. Body sight (the rules)

**Seen** (each 0.1 s line-of-sight sample) = everything MASON_SIGHT.md already requires to be able to see at all (`canSee`: sight on,
not blocked, alive, in play, not a rest / the lure niche / the S4 sighting / an override / a live knocker beyond `decoyOverride` /
frightened / wounded) AND a clear line (the SAME `_los`: crown or 2nd front block to head or torso, `level.segmentBlocked`, the last
0.3 m ignored) AND one of:

- **light**: the lantern shows (`lit`: charge > 0, not hooded) and the player is within `sightRange` (30 / 38 / 46 m) of the crown;
- **body**: the player is within `bodyRange` (**12 / 14 / 16 m**) of the crown, whatever the lantern does (lit, hooded, empty).

`sight.by` reads which sense saw you at the last sample: `'light'` when the lantern did (it outshines the body; within bodyRange a lit
lantern still reads 'light'), `'body'` when only the body did, `''` unseen. The `creature:notice` payload carries `by`; the caption is
**[It sees you]** for a body notice and the old **[It sees your light]** otherwise.

Everything downstream is unchanged and shared by both senses: the 0.5 s continuous notice beat, the knocks + roar cue (same cue), the
eye flare, the first-sighting warning (`firstHold`), the chase `memory`, the `cooldown`, the near / NO RECOVERY rule, the hunt gate's
scent hold, the prowl arming only through a committed chase. Not seen inside a rest (refuge 1: `canSee` false), not in the spawn /
entry grace or its RECOVERING rest (`eligible` false), the knocker override wins beyond `decoyOverride` (5 / 6 / 7 m, inside bodyRange:
walk up to it and the old rule takes you).

**Why 12 / 14 / 16 m.** Asked: about 12 m. It must be larger than the strike reach (7.7 / 8.1 / 8.5 m) and the near radius
(8 / 9.5 / 11 m), so a hooded player cannot stand inside its reach unseen; and well under the lantern range (30 / 38 / 46 m) so the
hood keeps its job: hiding you FROM AFAR. The deeper difficulties see a little farther (+2 m per step, like `lethalNear`).

**The hood, re-read.** "A covered lantern is invisible to it" becomes "**a covered lantern hides you beyond bodyRange**". Covered at
20 m inside a notice beat: the count breaks as before. Covered with the Mason at 8 m: it still sees you (and commits after 0.5 s).
Hood-camping a ledge while the sound hunt brings it closer: once it is within bodyRange in a clear line it sees you. The tutorial
`sight` hint: *It sees your LIGHT, and up close it sees YOU. Break the line, or [cover] the lantern to hide from afar.*

## 2. The leash wound (the rules)

A committed chase (`sight.chasing`, including its `memory` phase after it lost sight) **ends in a LEASH ESCAPE** when either:

- **far**: the crown is more than `leashFar` from the player (**39 / 49 / 60 m = 1.3 x sightRange**) at any frame of the chase; or
- **lost far**: the chase memory runs out while the player is farther than `leashLost` (**= sightRange: 30 / 38 / 46 m**).

Why these: `leashFar` is past the lantern range by a clear margin (a chase that drifts to 31 m and back is not an escape; 1.3 x keeps
it short of the creature's own `maxGap` rubber band of 75 / 72 / 68 m). `leashLost` = sightRange (not the suggested 0.8 x) because
then a memory run-out counts as a leash escape ONLY when the player is beyond the range of every sense it has (body 12-16 m, light
30-46 m): it lost you to DISTANCE, not to a wall, a ledge lip or the hood. At 0.8 x (24 m on Normal) a player who broke the line of
sight behind a pillar at 25 m would wound it, which the owner's rule ("a chase that ends by a line-of-sight break costs nothing") forbids.

What a leash escape does (`Creature3D._leashWound(distance)`, called by the sense):

1. The chase drops: `creature:sight {on:false, reason:'leash'}` (the chase arc reads an unknown reason as 'lost'), **no cooldown**
   (the wound is the cost; on its return it can commit after a fresh 0.5 s notice), `sense.stats.leashes++`.
2. **Scripted beat** (`scriptedNow`: setScripted (S5 keystone / S7 arena open), an override (S7 escape), the S4 sighting, an `escape`
   section, the lure niche, the victory): nothing more: a plain 'lost' drop with its cooldown, `stats.leashSkips++`. (In practice the
   override / sighting / lure already rule sight out, so no chase exists there; setScripted is the live case.)
3. Otherwise: **the wound.** `creature:leash {x,y,z,distance,heal}` (the caption **[It strains after you, then falls back]**; the
   pained screech `mason.pain` + the withdrawing rumble `mason.flee` of the weapons' SFX, a route in `audio/weaponSfx.js`), then
   `hurt(LEASH.amount = 1, 'leash')` through the existing API (`creature:hurt {source:'leash', ...}`, `stats.hurts`, `wounds`),
   `stats.leashWounds++`. It recoils (RECOVERING) and runs the existing withdraw climb (up the masonry, harmless: not lethal, its
   strike / surge / decoy broken off; out of play once 60 m away or after 9 s).
4. **The heal timer** `_woundT` = `heal` (**12 / 10 / 8 s**), a timer of its own: it does NOT touch `_frightN` / `_frightLast` (the
   weapons' 90 s diminishing window) and is not `frightened`. While it runs: out of play like a fright (every hunting mode is the unseen
   dormant one, `_cfgOf`), no sight (`canSee`), no prowl pass, the knocker refused (it is withdrawing / out of play).
5. **The return** when `_woundT` runs out (`creature:leash:end`): gate OFF (a hurt player, the tests, the bots): `setSection` brings it
   back from above as a section entry does (the entry grace, the intro approach), hunting. Gate ON (a well player): the next prowl pass
   starts at once (`_prowlT = 0`), not after the 50-80 s gap; the gate's scent hold is cleared at the wound (it lost you), so the pass
   is harmless until it sees you again. Either way it needs a **fresh notice** (0.5 s, the cue) to chase, and **no second free
   first-sighting warning** (`sense._first` is left as it is: the section's warning was already spent on this chase; a new section
   still gets one).
6. **Never kills it, never weakens it**: `hurt` never kills; nothing scales with `wounds`. A **respawn** forgets the wound timer (as it
   forgets a fright); the stats stay. A new run resets all.
7. **Not a leash escape** (cost the Mason nothing, unchanged rules): a line-of-sight break, the hood, an empty lantern inside
   `leashLost` (memory runs out near: 'lost' + cooldown); a rest / the knocker / the switches / a fright / its own RECOVERING rest
   ('blocked' drops); a death.
8. **Interplay with the weapons**: a grenade / round during the wound frightens it as ever (its own timer, its own diminishing; the
   longer of the two keeps it out). A wound while frightened cannot happen (no sight, no chase while frightened).

### State machine (additions in bold)

```
PROWL (gated, harmless) --notice 0.5 s--> CHASE --LOS break / hood / memory near--> SOUND HUNT (+cooldown)
                                            |--rest / knocker / fright----------> (unchanged)
                                            |--**far > leashFar, or memory out beyond leashLost**--> **WOUNDED**
**WOUNDED** = withdraw climb (RECOVERING, harmless) -> out of play (dormant) until heal runs out
            -> **RETURN**: gate off: setSection (from above, entry grace, hunting) | gate on: a prowl pass at once
            -> needs a fresh notice to chase again
scripted beat: the leash test only drops the chase ('lost'), no wound
```

## 3. Numbers (one table: `SIGHT_TUNE` in `sim/masonSight.js`, + `LEASH` shared)

| | Normal | Nightmare | Abyss |
|---|---|---|---|
| `sightRange` (m, the lantern; unchanged) | 30 | 38 | 46 |
| **`bodyRange`** (m, the body, any lantern) | **12** | **14** | **16** |
| **`leashFar`** (m, 1.3 x sightRange) | **39** | **49** | **60** |
| **`leashLost`** (m, memory runs out beyond) | **30** | **38** | **46** |
| **`heal`** (s the wound keeps it away) | **12** | **10** | **8** |
| `LEASH.amount` (wounds per escape) | 1 | 1 | 1 |

Unchanged: the 30 % strike, the 3-5 s cadence, every MASON_SIGHT / MASON_STRIKES number.

## 4. Balance targets and method

`tests/creature/pacing.mjs` on the REAL level, 20 runs per cell, BEFORE (the tree at the start of this work, `--root` a snapshot) and
AFTER: `LEVEL=real node pacing.mjs 20`, `STRIKES=1`, `HOOD=1`, `GATE=1`. The STRIKES table gets a `leash/run` column (wounds per run).

- expert ~0 deaths and < 1 hit per run on every difficulty;
- careful <= 0.5 deaths per run on Normal, <= 2 on Nightmare;
- hood camping not a free win, and now weaker up close: the hood camper is caught at least as often as before;
- nothing gets unplayable (hesitant not much worse than before).

Knobs if a target is missed: `bodyRange`, `leashFar` / `leashLost`, `heal`. Not the 30 % / 10 % damage, not the cadence.

### Measured (2026-11-06, REAL level, 20 runs per cell): every target met with the numbers above, nothing tuned

`STRIKES=1` (hits / HP lost / deaths per run; **hunting** = the Mason hunting all the time (gate off: what a hurt player meets),
**gate** = a player who stays well (the prowl passes); BEFORE -> AFTER; `leash` = leash wounds per run after):

| diff | player | hunting: hits | HP lost | deaths | gate: hits | HP lost | deaths | leash (hunt / gate) |
|---|---|---|---|---|---|---|---|---|
| Normal | expert | 0.00 -> 0.00 | 0 -> 0 % | 0.00 -> 0.00 | 0.00 -> 0.00 | 0 -> 0 % | 0.00 -> 0.00 | 0.00 / 0.00 |
| Normal | careful | 0.65 -> 0.60 | 20 -> 18 % | 0.00 -> 0.00 | 0.40 -> 0.45 | 12 -> 14 % | 0.00 -> 0.00 | 0.70 / 0.15 |
| Normal | hesitant | 34.25 -> 27.85 | 902 -> 736 % | 6.80 -> 5.35 | 3.65 -> 4.90 | 97 -> 131 % | 0.70 -> 0.90 | 2.35 / 1.00 |
| Nightmare | expert | 0.00 -> 0.00 | 0 -> 0 % | 0.00 -> 0.00 | 0.00 -> 0.00 | 0 -> 0 % | 0.00 -> 0.00 | 0.00 / 0.00 |
| Nightmare | careful | 1.05 -> 1.15 | 32 -> 35 % | 0.00 -> 0.00 | 0.45 -> 0.45 | 14 -> 14 % | 0.00 -> 0.00 | 0.85 / 0.30 |
| Nightmare | hesitant | 113.55 -> 107.60 | 2900 -> 2750 % | 26.40 -> 24.95 | 35.75 -> 35.15 | 919 -> 903 % | 7.95 -> 7.95 | 2.60 / 2.35 |
| Abyss | expert | 0.15 -> 0.15 | 5 -> 5 % | 0.00 -> 0.00 | 0.00 -> 0.00 | 0 -> 0 % | 0.00 -> 0.00 | 0.05 / 0.15 |
| Abyss | careful | 1.75 -> 1.65 | 53 -> 50 % | 0.00 -> 0.00 | 2.00 -> 1.95 | 58 -> 55 % | 0.10 -> 0.15 | 0.60 / 0.90 |
| Abyss | hesitant | 42.65 -> 42.90 | 1080 -> 1087 % | 10.30 -> 10.35 | 39.65 -> 39.25 | 1006 -> 994 % | 9.70 -> 9.65 | 0.20 / 0.20 |

(The blind column is byte-for-byte unchanged: no sight, no chase, no leash.) The plain descent table (hunting) and `GATE=1` give the
same deaths as the STRIKES hunting / gate columns.

`HOOD=1`, hood at every pause (deaths per run, lit -> covered): Normal careful 0.00 -> 0.00 (before 0.00 -> 0.00), Normal hesitant
5.35 -> 3.25 (before 6.80 -> 2.50), Nightmare careful 0.00 -> 0.05 (before 0.00 -> 0.00), Nightmare hesitant 24.95 -> 20.00 (before
26.40 -> 12.45): covering at every pause now takes back about 40 % / 20 % of the deaths instead of 63 % / 53 %: **the hood is weaker up
close**, as asked. The covered staller is caught as often as the lit one (Normal 13 / 13 of 20, Nightmare 14 / 12, Abyss 13 / 13 of 19).

Read: the targets hold (expert 0 deaths, < 1 hit; careful 0 deaths on Normal and Nightmare). The leash is a small RELIEF for players
who flee (Normal hesitant hunting 6.80 -> 5.35 deaths), not a free escape: it fires 0.15-2.6 times a run, and the Mason is back 8-12 s
later. A well hesitant player on Normal meets it a little more (gate 0.70 -> 0.90 deaths, 3.65 -> 4.90 hits): after a leash wound the
next prowl pass comes at the heal instead of 50-80 s later (the owner's "comes back"). The cell-to-cell noise of 20 runs is about
+-0.3 deaths for hesitant players.

## 5. Test plan

`tests/creature/body-sight.mjs` (the REAL Creature3D + MasonSense, the stub shaft, 60 Hz, seeded):
- the numbers (bodyRange 12 / 14 / 16 < sightRange; > strike reach and >= lethalNear);
- a hooded player and an empty-lantern player, the Mason placed (crown + front blocks) at bodyRange - 2 m in a clear line: noticed
  (`by` 'body'), commits exactly 0.5 s later; at bodyRange + 3 m: never noticed over 3 s; a lit player at the same far spot is
  ('light');
- a wall between (the shaft wall) blocks the body sight;
- inside a Masons' rest (refuge 1): never seen;
- a live knocker decoy: a hooded player at 6-10 m (beyond decoyOverride, inside bodyRange) is not seen; walking within
  decoyOverride ends the decoy;
- the notice caption picks [It sees you] for `by:'body'`;
- determinism (two runs, the same event stream); no allocation in the per-frame paths (static check incl. the new code).

`tests/creature/leash.mjs`:
- the numbers (leashFar 1.3 x, leashLost = sightRange, heal 12 / 10 / 8);
- a chase, the player teleported/run beyond leashFar: `creature:leash`, `creature:hurt {source:'leash'}`, `stats.leashWounds` 1, the
  chase off ('leash'), it withdraws (not lethal, RECOVERING) and leaves play; the heal timer counts down from `heal`; it is back in
  play within heal + 1 s (gate off) and must notice again; never `frightened`, `_frightN` / `_frightLast` untouched (a grenade after
  it gets the full 40 s);
- memory runs out with the player beyond leashLost (lantern lit, out of range) -> wound; memory runs out near (hood at ~20 m,
  LOS break behind the wall) -> no wound, a 'lost' drop;
- a rest, a knocker decoy -> no wound;
- the gate on (well player): the return is a prowl pass at once after the heal, not after the 50-80 s gap;
- scripted (`setScripted(true)`): no wound, `stats.leashSkips`;
- a respawn forgets the wound; the wound never kills (wounds only count);
- determinism (seeded, two runs identical).

Updated: `hood.mjs` ("covered = never seen" -> "never seen beyond bodyRange"; the mid-chase cover check measured beyond bodyRange),
`sight.mjs` (the empty-lantern and the lantern-dies checks hold the Mason beyond bodyRange or expect body sight inside it), the
tutorial / caption text checks. All other suites unchanged and passing; the route-bot verify (`verify.mjs --chapter ch1 --variant all`).
