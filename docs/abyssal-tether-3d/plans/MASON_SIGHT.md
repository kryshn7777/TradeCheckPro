# MASON SIGHT: it sees your light, it chases; no recovery close to it; the knocker decoy

The owner (2026-11-05): *"When mason sees player it chases. No more health stuff if player is kinda near to it."* and *"there must be a
gadget to distract the mason temporarily"*.

How that was read (redirect here if it was meant differently):

1. **Sight -> chase.** The Mason was blind and hunted by sound only. Now it also **sees the lantern-bearer**: when it sees you it commits
   to a chase. Sight is an ADDITIONAL trigger over the sound hunt (listening, stall lunges, the stall clock, annoyed by shots, refuges,
   the stamina waves of CREATURE_PACING.md all still work).
2. **Near = health no longer protects you.** While it chases you and you are within `lethalNear` of its crown / front blocks, **nothing
   heals**: no regeneration, the regen clock stops, bandages and the first-aid kit are refused (a heal being applied is cancelled, the
   item kept). **MASON_STRIKES.md (2026-11-06) replaced the one-hit kill:** a Mason connect now takes **30 %** of the health and knocks
   you down (`caughtPlayer` -> `PlayerHits.mason`); four from full kill (the devour scene at hp 0). The no-heal radius is what makes a
   chase deadly: inside it the hits add up and nothing comes back. Every regular strike lands inside `lethalNear` by construction. Also:
   **while it chases you, the hunt gate's 14 s scent window is held full**: healing up past 50 % no longer sends a Mason that is looking
   at you away (the old "it hunts only while you are hurt" rule now ends only once it has lost you).
3. **The knocker** (another agent builds the gadget): `Creature3D.distract(x, y, z, {duration, strength})` lures it away for a while.

**Owner decision (2026-11-06): it chases a WELL player too.** *"When the Mason sees the player it chases even if the player is at full
health."* The hunt gate ("it hunts only while you are hurt", the scent window) no longer keeps it away from, or sends it away from, a
player it can see:

- **Prowl passes.** While you are well (the gate closed) it no longer simply waits far below: in every hunting section (a lethal mode,
  lethal in the data for this difficulty) it makes **passes**: the first `prowl.first` s after a section entry / a respawn, then every
  `gapMin`..`gapMax` s, for `dur` s. A pass comes in from above like a hunt (out of sight, the entry grace), crawls and listens, but is
  **harmless** (not lethal: it looms and holds off) **until it sees you**: a committed chase fills the scent window, the gate arms and the
  section's lethal hunt takes over. A pass that sees nobody (or only notices you) withdraws up the masonry and leaves play. The Dresser
  yields during a pass (one big creature at a time; game.js `setRival`).
- **Seen = kept.** While it chases you, or (already hunting) still sees you, the scent window is held full: healing does not send it away.
  Seeing alone never arms a pass: only a committed chase does (the notice beat always comes first).
- **The fairness levers kept and added**: the 0.5 s notice + roar, a line-of-sight break, the rests (fully safe), the knocker and its 20 s
  wise rule, the S4 sighting / S5 lure / S7 escape rules, the entry grace, and two new ones: **the first notice of a section (and the
  first after a respawn) is only a warning, no chase for `firstHold` s**, and **after a chase ends (lost, a rest, a refuge) it cannot
  commit again for `cooldown` s** (it searches by sound). Sandbox: no creature. `?sight=off` / the setting Off: the old gate (no passes).

**Owner decision (2026-11-06): body sight + the leash wound (MASON_BODY_SIGHT_LEASH.md).** *"If it sees the player directly, it comes
and attacks. If the player moves too far, it might escape, but it takes damage and comes back."* Within **`bodyRange` 12 / 14 / 16 m**
in a clear line it sees your BODY whatever the lantern does (lit, hooded, empty): the hood and an empty lantern hide you only beyond
it. A chase that ends up beyond **`leashFar` 39 / 49 / 60 m**, or whose memory runs out beyond **`leashLost` = sightRange**, is a
leash escape: it is wounded (`hurt(1, 'leash')`, [It strains after you, then falls back]), withdraws and stays out of play for **12 /
10 / 8 s**, then comes back hunting (gate on: a prowl pass at once) and needs a fresh notice. A line-of-sight break, the hood, a rest,
a knocker still cost it nothing. The rules below read "the lantern shows" as "the lantern shows, or the body is within bodyRange".

Code: `src/sim/masonSight.js` (the sense: sight, near, decoy), hooked into `src/sim/creature3d.js`; tests:
`tools/abyssal-tether-3d/tests/creature/sight.mjs`.

## The rules

**Seen** = all of:

- the crown is within `sightRange` of the player (body centre);
- a clear line (level.segmentBlocked, active solids, the last 0.3 m at your end ignored) from the crown or the 2nd front block to your
  head (eye height) or your torso, sampled every 0.1 s;
- your **lantern shows**: charge > 0 and you are alive. An empty lantern (the floor glow only) is invisible to it; **or your body is
  within `bodyRange` (12 / 14 / 16 m), any lantern** (MASON_BODY_SIGHT_LEASH.md; `sight.by` 'light' | 'body', the caption
  [It sees you] for a body notice);
- nothing rules sight out: a Masons' rest (refuge 1) or the S5 lure niche (refuge 2: the keystone rules stay exactly as they were), the
  S4 staged sighting, an objective override (the S7 escape is already a chase), being out of play (between prowl passes), a live decoy
  (below), the game saying the view is blocked (not `playing`, cutscenes), `?sight=off`, the Settings > Rope > **Mason sight** = Off,
  Sandbox (no creature at all);
- and to NOTICE / COMMIT (it still sees you for the scent window): not its own RECOVERING rest, not an entry / respawn grace, not the
  `cooldown` after a chase (the pacing waves: each wave needs a fresh notice).

**The notice beat** (fairness: heard before seen). The first sample that sees you fires `creature:notice {x,y,z,distance,commit}`: a
designed cue (`creature.notice`: three hard stone knocks of its crown on the wall, a low roar swelling under them, a dry chitter; world
placed, `audio/masonSightSfx.js` through the SFX engine's `registerSfx` / `registerSfxRoute`), the caption **[It sees your light]**, and
its red eyes flare (`body.glow` up to 1, the crown unfurls, fading over 0.9 s). It needs **0.5 s of continuous sight** to commit; break
the line (a pillar, a ledge lip, drop below a floor, let the lantern die) and the count starts over. A broken notice does not roar again
for 3 s (glimpses do not spam the cue). **The first notice of a section** (and the first after a respawn) is only a warning: the cue
plays, the eyes flare, but it cannot commit for `firstHold` s (if it still sees you then, it commits at once).

**The chase** (`creature:sight {on:true}`). It pursues along the crawl nav at **pursue x `pursueMul`**, does not stop to listen, creep or
stalk at its menace distance, and attacks by the SNAKE of MASON_STRIKES.md: it DASHES in (a surge, 2.5 s at most), holds a 5.5 m
stand-off, rises (0.8 / 0.7 / 0.6 s), locks on where you stand (0.3 s), lunges (0.2 s), recoils and stares, striking again every
3-5 s while you stay in its reach; never through masonry, never into a rest. While it is engaged with you the stamina does not drain
(the cadence paces it); out of reach the old stamina waves apply (out of stamina it rests: the chase ends there). A still player no longer counts as
silent to a Mason that sees him (a contact attack starts on a still player too: cause `'sight'`). Losing sight, it keeps the chase for
`memory` s (`creature:sight {on:false, reason:'lost'}`), then it is back to the sound hunt and cannot commit again for `cooldown` s
(the same after a rest or a refuge; not after a knocker drew it off: walk up to it and it takes you).

**Near** (`creature:near {on:true}` when it starts, for the caption **[No recovery this close]**). `sight.near` = chasing AND the hunt is
lethal AND the nearest of crown / front blocks is within `lethalNear`. game.js sets `health.noRecovery` from it every frame:
`Health3D.step` does not regenerate and does not run `sinceHurt`; `heal()` restores nothing (a checkpoint patch-up passes `force` and
still heals); `Inventory3D.refusal` answers `'norecovery'` for the first-aid kit and bandages (toast *No recovery this close*), a heal
being applied is cancelled and the item kept; the adrenaline shot still works (its speed; its +10 hp does not land). The ECG's status
word and the VR wrist badge read **NO RECOVERY** in red. Falls, walls, hazards, skitterling bites, the Usher, the Dresser and the Holdfast
(never lethal alone) are unchanged. Sandbox: no creature, nothing changes.

## Numbers

| | Normal | Nightmare | Abyss |
|---|---|---|---|
| `sightRange` (m) | 30 | 38 | 46 |
| `bodyRange` (m, the body, any lantern; MASON_BODY_SIGHT_LEASH.md) | 12 | 14 | 16 |
| `leashFar` / `leashLost` (m) / `heal` (s) | 39 / 30 / 12 | 49 / 38 / 10 | 60 / 46 / 8 |
| notice commit (s of continuous sight) | 0.5 | 0.5 | 0.5 |
| `firstHold`: the section's first notice is a warning only (s) | 8 | 8 | 6 |
| `pursueMul` (x the pursue speed) | 1.0 | 1.0 | 1.05 |
| chase speed in `hunt` mode (m/s) | **5.2** | **6.4** | 8.2 x 1.05 = **8.6** |
| `memory` after sight is lost (s) | 3 | 3 | 4 |
| `cooldown` after a chase ends (s) | 20 | 18 | 14 |
| prowl: first pass after an entry / respawn (s) | 20 | 16 | 12 |
| prowl: gap between passes (s) | 50-80 | 40-65 | 30-50 |
| prowl: pass length (s) | 30 | 35 | 40 |
| `lethalNear` (m, to crown / front blocks) | **8** | **9.5** | **11** |
| its regular strike reach (killRadius x 1.6 + 3.5 nav stretch) | 7.66 | 8.14 | 8.46 |
| `decoyOverride` (m) | 5 | 6 | 7 |
| `hearRange` for the knocker (m) | 60 | 66 | 72 |

The brief asked for about 7 / 9 / 11 m. Normal is 8 and Nightmare 9.5 so that **every regular strike reach is inside lethalNear**
(7.66 and 8.14 m): you can never be killed by a strike that the read-out did not warn of with NO RECOVERY. A stall lunge (x1.25 on the
kill radius) reaches 8.7 m on Normal, just past it. Shared: line of sight sampled every 0.1 s, notice cue cooldown 3 s, eye flare 0.9 s.

## Fairness: how you get away

- **Break the line within 0.5 s** of the knock / roar / [It sees your light]: step behind a pillar or a buttress, drop under a ledge
  lip or a floor, swing round the shaft's corner. It does not commit.
- **A Masons' rest** (refuge 1): it cannot see you there; the chase drops at once; it holds at its stalking distance and listens.
- **Douse your light**: an empty lantern is invisible to it beyond `bodyRange` (the lantern burns down by itself; the game has no off
  switch for it). Up close (12 / 14 / 16 m) it sees your body anyway.
- **Hood your light** (LANTERN_HOOD.md): a covered lantern hides you too, from afar (beyond `bodyRange`; it still hears you).
- **Outrun it** past the leash (39 / 49 / 60 m, or out of every sense when its memory runs out): it tears itself on the stone, falls
  back for 12 / 10 / 8 s, then comes back (MASON_BODY_SIGHT_LEASH.md).
- **Out-move it**: the slow chase is 5.2 / 6.4 / 8.6 m/s; you run 5.5 m/s (11 with adrenaline), reel at up to 12 m/s (a yank 17),
  swing and fall far faster. But once it has seen you it DASHES (14 / 16 / 18.5 m/s for up to 2.5 s): the dash is meant to catch you.
  What saves you then is the **dodge** (MASON_STRIKES.md): it rears up, the aim locks where you stand, and anything that moves you more
  than 2.0 / 1.85 / 1.75 m off that line by the impact (a run, a reel, a swing, a drop) makes it miss. Standing still is a hit (30 %).
- **Out-wait it**: break the line and it holds the chase only 3 / 3 / 4 s, then it hunts by sound (go still to be silent) and cannot
  commit again for 20 / 18 / 14 s.
- **The knocker** (below): it drops a chase, and while it lives sight is off for anyone beyond 5 / 6 / 7 m.
- **The grace**: arriving in a section (or after a respawn) you get the entry grace, the first pass waits 20 / 16 / 12 s, and the first
  notice there is only a warning for 8 / 8 / 6 s.
- The stamina waves (out of its reach): out of stamina it RESTS and cannot commit; every new wave needs a fresh notice (a new cue).
- **Survive a hit**: a strike is 30 %, a knockdown (1.1 s down, 2.4 s getting up) and then 1 s of immunity; it holds its coil and
  stares while you are down (the next strike is at least 5 s after the hit). Four strikes from full kill.

**Worked example (Normal, full health).** You arrive in S6 whole. About 20 s later a pass comes down the far wall, harmless. It rounds a
buttress 20 m away with your lantern in view: the knocks, the roar, [It sees your light], its eyes flare. It is the section's first
notice: a warning, no chase for 8 s; you step behind the buttress. Later, a second sighting: 0.5 s after the cue it commits (the gate
arms: now it can strike): it dashes 20 -> 10 m in about a second, coils 5.5 m away, rises 0.8 s, locks 0.3 s, lunges 0.2 s. Doing
nothing you are struck (30 %, knocked down) about 2.5 s after the cue, then every ~6 s: dead in about 18 s. At about 8 m the wrist
reads NO RECOVERY. Answers: inside the first 0.5 s step out of its line (no chase); at each rise move (walk, reel, swing, drop) so
that you are off the line at the impact; break the line for 3 s: then it is 20 s before it can commit to you again; or throw the
knocker (it is accepted while the Mason stares from its coil, not during a lock / strike / recoil).

## The knocker decoy (contract for the gadget)

`Creature3D.distract(x, y, z, opts = { duration: 9, strength: 1 })` -> `true` when accepted.

- **Accepted** only when it is the Mason (skitterlings ignore it), active, IN PLAY (a hunt or a prowl pass; not dormant / out of play / the S4
  sighting / an override / the victory / the hunt gate's withdraw), not mid-strike (`ATTACK` lock / strike / recoil or a striking rise:
  call again a moment later; MASON_STRIKES: while it only stares from its coil it is accepted and it leaves the coil), not in the S5
  lure niche rule (refuge 2), the point within `hearRange x strength` (strength 0.25..2) of its crown, the player not already within
  `decoyOverride`, and not a knocker it inspected less than 20 s ago (within 4 m of it). A rest (refuge 1) does not refuse it.
- **A call while live** refreshes it: the point moves (if it moved more than 3 m while it was inspecting, it walks there again) and the
  decoy lives until the LATEST end asked (`left = max(left, duration)`). The gadget should pass the knocker's REMAINING clack time.
- **What it does**: `creature:distracted {x,y,z,duration}`; a listen turn (OBSERVING, pits lit, crown toward the sound) of 0.8 s; a crawl
  over the nav to the point (APPROACHING speed, no menace hold); within 3 m (or within 10 m with no progress for 2 s: a knocker off the
  masonry) it inspects for 3 s in the listening posture; then `creature:decoy:end {reason:'inspected'}` and back to the sound hunt.
  Ends early with `'timeout'` when its time runs out, `'overridden'` when the player comes within `decoyOverride` (or it leaves play).
- **Sight vs decoy**: while a decoy is live, sight is suppressed for a player farther than `decoyOverride`; a chase in progress is
  dropped when the decoy is accepted. Within `decoyOverride` the decoy is dropped and the sight / near rules apply (it catches someone
  who walks up to it).
- **Diminishing returns**: for 20 s after a decoy ends it is WISE: a decoy started then lasts half as long (x0.5, also on refreshes)
  and its listen turn is 0.35 s; the knocker it inspected is ignored.
- `?sight=off` / the setting Off: the knocker still works (it is a sound); sight and the near rule stay off.

## Weapons (SOLDIER_WEAPONS.md)

The dead soldiers' grenade and service revolver (`src/sim/weapons3d.js`) hurt and frighten the Mason through two public methods here,
built on the hunt gate's withdraw (shared with the parallel Flare work): `Creature3D.frighten(duration, source, fromX, fromZ)` and
`hurt(amount, source)`.

- **Frightened** = it recoils (RECOVERING), climbs away like the gate's withdraw and stays out of play (every hunting mode dormant, no prowl
  pass, a wound does not re-arm it) for 40 / 32 / 24 s after a grenade (x0.7 after a round); frights within 90 s diminish (x0.6 each, at
  least x0.3, never under 5 s). Sight is off while frightened (`canSee` checks `_frightT`), a chase and a knocker decoy end, the knocker
  is refused (the `_withdraw` rule). When the fright ends its next notice is a first-notice warning again, and the prowl waits `first` s.
- **Scripted beats only stagger** (`scriptedNow`): the override (S7 escape), the glue's `setScripted` (the S5 keystone / S7 arena
  objective open), the S4 sighting, an `escape` section, the lure niche (refuge 2), the victory: a 1.2 s recoil, nothing else.
- **A miss is loud**: `hearShot(x, y, z)` wakes it to the shooter within 55 m (sound, not sight: no notice, no chase commit), or brings a
  gated prowl pass to within 4 s.
- **The rests** keep their rules through a fright. A respawn forgets the fright. Never called, nothing changes (the pacing sim is byte for
  byte the same).

## Switches and debug

- `?sight=off` (game.js `sightOff()`): no sight-chase, no near rule (the e2e `e2e.cjs` and `free-attach.cjs` pass it; the Node route bots
  in `verify/` run the creature with its defaults: sight on, the lantern always lit).
- Settings > Rope > **Mason sight** (`masonSight`: `'on'` default | `'off'`).
- `new Creature3D(level, diff, bus, { sight: false })` for tools; `creature.setSight(on, lit, blocked)` per frame (game.js);
  `creature.sight` / `creature.decoy` read-outs.
- `AT3D.debug.creature.sight(force?)`: the state (sees, by ('light' | 'body'), noticing, chasing, lost, near, nearDist, noRecovery,
  wound (the leash wound's heal s left), leashWounds, the numbers, the decoy, the stats); `force` `'see'` (always seen when eligible) | `'blind'` | `''`. `AT3D.debug.creature.distract(x, y, z, opts)`.

## Cost

Deterministic (no Math.random, no clock but dt), Node-safe. The per-frame paths (`update`, `_los`, `decoyStep`) build no object, array,
closure or string (checked statically by sight.mjs); event payloads are built only on the rare events. Lines of sight: 3 segment tests
every 0.1 s at most. V8's sampling heap profiler still sees short-lived boxed doubles (about 0.5 KB per update in the sense; the whole
creature samples about 16 KB per update before this change in `tests/creature/allocprof.mjs`, about 21 KB after, the rest from the
chase keeping the body close and busy).

## Balance (measured with the pacing sim, 2026-11-06)

`tests/creature/pacing.mjs` on the REAL level, 20 runs per cell (`LEVEL=real NOSTALL=1 node pacing.mjs 20`): scripted human-pattern
players that never hide, never break the line on purpose and never throw a knocker. Deaths per Chapter I run (the lethal sections).
**Hunting** = the Mason hunting all the time (the gate off: the worst case, what a hurt player meets); **Well** = `GATE=1`, the hunt gate
on and a player who stays well (only the prowl passes and what they see can kill); **Blind** = `SIGHT=off` (the Mason before this work);
**First cut** = the first sight build (2026-11-05, before the owner's decision and the rebalance).

| | Blind | First cut (hunting) | **Final, hunting** | **Final, well (prowl)** | target |
|---|---|---|---|---|---|
| Normal expert | 0.00 | 0.00 | **0.00** | **0.00** | ~0 |
| Normal careful | 0.25 | 0.95 | **0.45** | **0.15** | <= 1.5 |
| Normal hesitant | 2.95 | 27.6 | **9.20** | **1.45** | worse than careful, not absurd |
| Nightmare expert | 0.00 | 0.00 | **0.00** | **0.00** | ~0 |
| Nightmare careful | 0.95 | 4.6 | **1.55** | **0.40** | <= 4 |
| Nightmare hesitant | 16.7 | 53.3 | **27.7** | **12.25** | worse than careful, not absurd |
| Abyss expert | 0.10 | - | **0.05** | **0.00** | |
| Abyss careful | 3.55 | - | **5.35** | **2.60** | |
| Abyss hesitant | 9.40 | - | **10.30** | **10.40** | |

How it got there (Normal / Nightmare hesitant, hunting): the first cut 27.6 / 53.3; + the first-sighting warning (6 s) and a 7-8 s
cooldown: 17.7 / 41.6; pursueMul 1.0 / 1.05, cooldown 12 / 10, memory 3 / 4: 15.0 / 36.7; cooldown 16 / 12: 10.9 / 31.3 (a shorter sight
range, 24 / 30 m, changed nothing: 11.1 / 34.4); **final** (pursueMul 1.0, cooldown 20 / 18, memory 3, warning 8 s): 9.2 / 27.7. The
hesitant bot stands still in view for 3-12 s at a time (1100-1300 s in the lethal sections per run against ~250 s for careful); most
of its remaining deaths are the sound hunt's own creeps and stall lunges plus a chase lunge on a frozen player (`CAUSES=1`). Nightmare
hesitant was already 16.7 blind. Knobs left: `cooldown`, `firstHold`, the prowl `gapMin`/`gapMax`/`dur` (how often a well player meets
it), `notice` (0.5 s).
