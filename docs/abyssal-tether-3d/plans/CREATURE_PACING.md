# CREATURE PACING (Chapter I, S1-S8): who hunts whom, and when

The owner's rules: the story is very dark; **the Mason hunts only when you are hurt**; **the Dresser hunts only when you are whole**;
**the skitterlings always hunt**. This page adds the fourth threat, **THE HOLDFAST** (the climb surface itself), checks what each
section does to a player at each health, and lists what was wrong and what changed (2026-10-29).

## The four rules (Normal / Nightmare / Abyss)

| Threat | Hunts when | Sense | What it costs you | Counterplay | Code |
|---|---|---|---|---|---|
| **The Mason** | hp **≤ 35 %**, and for a **14 s** scent window after (off again from 50 %); a scripted override (S7 after the iris) is never gated | sound | death (lunge / strike) | lure it to the keystone (S5), the Masons' rests, move quietly, heal | `sim/creature3d.js` `setHuntGate` |
| **The Dresser** | hp **≥ 75 / 70 / 65 %** (spoiled 5 points below); yields to the Mason | sight of the *whole* you | cuts the ring you hang from (3 s measure + 1 s saw); dresses you within 1.6 m | a second rope, a calculated hit, break its sight, hook it (2.5 s stagger) | `sim/dresser3d.js` |
| **Skitterlings** | always | proximity | a bite: 26 / 32 / 40 % hp and 0.2 / 0.3 / 0.4 grip | the harpoon (hook shot), rests | `sim/skitter3d.js` |
| **The Holdfast** (new) | when you take hold of it (a climb patch whose studs are knuckles) | touch | locks the hand **2.0 / 2.5 / 3.0 s** (**x1.3** and harder squeezes when LOW), drawn to the wall at 0.3 m/s; tear free **-10 %** hp **-0.3** grip, or waited out **-15 %** (never lethal alone: floor 5 %) | let go within 0.5 s; tear free (VR: a real arm pull >= 1.2 m/s away from the wall for 0.15 s; desktop: Back + Jump, or let go of F for 0.4 s); reel your other tether (the rope out-pulls it after 1 s, free); hook-shoot its forearm (it lets go, free); shoot a suspicious patch first (it flinches: safe for 10 s) | `sim/holdfast3d.js` |

**The corridor.** Between 35 % (50 % on the way up) and 75 % neither the Mason nor the Dresser hunts. Regeneration (Normal 6 s, then
5 % a second) walks you up into the Dresser's sight; a fall, a cut ring, **a skitterling bite (26-40 %) or a Holdfast squeeze
(10-15 %)** drops you toward the Mason. The two "always" threats are the pressure that keeps the corridor from being a safe room: the
bites and the squeezes are what push you out of it, and the Holdfast squeezes **harder and longer when you are already low**, so it
pins you exactly when the Mason is coming (one rule from each side, meeting on your hand).

## Per section (what threatens you, by health)

Mason modes: S1-S3 dormant (never), S4 a staged sighting (Normal) / stalk (Nightmare, Abyss), S5 stalk, S6 hunt, S7 frenzy, S8 escape.
Skitterlings per difficulty from the data `skit(n, nm, ab)`.

| Section (par s) | Whole (>= 75 %) | Corridor (35-75 %) | Hurt (<= 35 %) | The surface | Intended player state |
|---|---|---|---|---|---|
| **S1** The Threshold (14) | nothing | nothing | nothing | studs teach the climb (no Holdfast: never on the first two climb patches) | whole; learning: the swing, the bell, studded stone can be climbed |
| **S2** The Long Swing (18) | nothing but falls, the crumbling span | same | same (the Mason is dormant here) | **Holdfast `hf-s2-east`**: the climb back up from the hall floor (everyone who misses the swing climbs it) | whole; **rule 1: the wall can hold you** (one rule, met alone, with nothing else around) |
| **S3** Broken Gallery (17) | **the Dresser** (meets you: slower, 14 m sight on Normal), rockfall lane | rockfall | rockfall (the Mason is dormant) | **Holdfast `hf-s3-shelf`** (the shelf wall under the rings: a held hand is a still body the Dresser measures) | whole -> knocked into the corridor; **rule 2: whole bodies are measured** |
| **S4** The Listening Vault (30) | **the Dresser** (learn it), the Mason's staged pass | nothing | NM / Abyss: the Mason stalks | **`hf-s4-answer`: knock and a hand answers** (three knocks in the wall, an open hand palm up, never locks: lore, no cost) | the corridor; rule 3 foreshadowed: something vast passes |
| **S5** The Gullet Stair (26) | **the Dresser (new here)**, Abyss: a skitterling | Abyss: a skitterling | **the Mason** (stalk) + the keystone lure | **Holdfast `hf-s5-sinew`** on the wet sinew wall | **rule 3: hurt bodies are hunted**, and the keystone needs it: get measured, get cut, get hurt, let it knock |
| **S6** The Two Descents (11) | **the Dresser** (1.1x) + skitterling + squalls | skitterling + squalls | **the Mason** (hunt) + skitterling | none (the dividing wall is the safe line's climb) | **THE CORRIDOR**: everything at once, the set piece |
| **S7** The Hollow Nave (50) | skitterlings (1 / 2 / 2); after the iris the Mason's escape override (ungated) | skitterlings | **the Mason** (frenzy) + skitterlings | **Holdfast `hf-s7-spire`** on the spire's south face | survive the nave (45 / 60 / 60 s): bites push you down, the spire holds a hand |
| **S8** The Last Throat (23) | skitterlings (1 / 1 / 2) | skitterlings | **the Mason** (escape) + skitterlings | **Holdfast `hf-s8-wake` (new)**: "before the walls wake", on the converging west wall | the flight down: whatever you are, something wants you |

## The learning order (one rule at a time, then combine)

1. **S1** climb, swing, ring: no creature.
2. **S2** the Holdfast alone: the wall's studs are a promise the dead break once. A first-timer who misses the long swing falls to the
   hall floor and climbs c-s2-east back up: about 4 m up the wall a patch has no chalk and is wet; within 1.2 m a wet breath and a
   knuckle crack; a hold kept for half a second is answered. The first time, a hint says how to get the hand back (game.js, once a
   session: pull the arm back hard / Back + Space or let go of F, reel the other tether, or hook its arm).
3. **S3** the Dresser alone, plus the rockfall (the first corridor push), and a Holdfast under its gaze.
4. **S4** the Dresser learned; the Mason seen, not fought; the Holdfast answers (nothing hurts: the breath before S5).
5. **S5** the Mason's rule, with the Dresser driving you into it (the first combination) and the keystone using it.
6. **S6** the corridor: the Dresser + a skitterling + the Mason + the squalls.
7. **S7-S8** skitterlings doubled, the Mason's frenzy and escape, a Holdfast each: every rule on the same wall.

## First-time player minutes (Normal, about 22-30 minutes for Chapter I)

| Minutes | Where | What a new player feels |
|---|---|---|
| 0-3 | S1 | the climb, the swing, the bell; nothing hunts |
| 3-7 | S2 | the long swing; most first tries fall to the hall floor -> the climb back up -> **the Holdfast** (the first scare: a hand closes on yours) |
| 7-11 | S3 | ticking on the walls, the chalk outline: the Dresser; rocks |
| 11-15 | S4 | the lamps, the knock that is answered, the vast thing passing |
| 15-19 | S5 | measured, cut, bitten (Abyss), hurt: the Mason; the keystone |
| 19-22 | S6 | the corridor |
| 22-28 | S7-S8 | the nave, the bites, the escape |

## What was wrong (before this pass) and what changed

| Finding | Status |
|---|---|
| **S2: nothing threatened a healthy player** (the Mason is dormant in S1-S3; no Dresser, no skitterlings). | **Fixed**: the Holdfast's first site (`hf-s2-east`) on the climb that every fallen first-timer takes back up. |
| **S5: nothing threatened a healthy player on Normal / Nightmare** (the Mason's stalk is gated; the skitterling is Abyss only), and the keystone's 8 s haul ("loud: it usually comes first") no longer drew the Mason for a whole player, so S5 was an empty corridor. | **Fixed (data)**: the Dresser now also walks S5 (`walkMul 0.9`, 14 m sight on Normal; Nightmare / Abyss 1.0x, 16 m) and a Holdfast on the sinew wall. A whole player is measured, a cut or a bite drops them toward the Mason, which then comes for the scent: the lure works as designed. `tests/creature/dresser.mjs` passes with it. |
| **S8: a healthy player met only skitterlings in the finale** (the Mason's `escape` is gated; the S7 escape override applies to S7 only). | **Partly fixed**: a Holdfast (`hf-s8-wake`, "before the walls wake"). **Recommended, not applied**: let the S7 escape override carry into S8 (one line in `objectives3d.creatureOverrideFor`, behaviour code: not touched here), or a Dresser in S8 after a budget pass (S8 + two skitterlings + the Dresser has not been measured). |
| S7: a healthy player meets skitterlings only until the iris opens. | Acceptable: two skitterlings on Nightmare / Abyss bite you into the corridor within a minute; the Holdfast on the spire adds the surface. |
| S3 / S4: the Mason is dormant in S3 even when hurt (only the rockfall and the Dresser). | By design (the Mason is introduced in S4-S5). |
| The skitterlings' S5 Abyss slot and the S6-S8 counts. | Unchanged. |

Not changed: the Mason / Dresser / skitterling behaviour code (no bug found), the level geometry, decor, anchors, lightmaps and GI
(`npm run verify:at3d` baseline 3167 and the hashes are identical: creature config and Holdfast sites are not in them).

## Fairness rules of the Holdfast (enforced by `resolveHoldfastSites`, tested in `tests/creature/holdfast.mjs`)

- At most **1 hold in 4** of a climb zone (the zone's stud cells / 4 patches; patches >= 2 m apart); never the only route (climb
  zones are never a way round a swing or a drop: the route bots never need them).
- Never in S1 and never on the first two climb patches of the descent (the tutorial's "studded stone can be climbed").
- Never within 3 m of an objective fixture, its ring, the keystone or a Masons' rest (an unfinished seal's critical path).
- The telegraph: no chalk (ClimbView leaves the patch's studs out; the knuckles are the studs), a wet sheen, a knuckle crack and a wet
  inhale within 1.2 m, a wet breath within 0.3 m; 0.5 s to let go after taking hold.
- Never lethal alone (its damage stops at 5 % hp); other damage on top of it can kill (a bite while it holds you).
- Deterministic by level data (no randomness in the sim; the twitch timing is seeded by the site's id).
