# MASON SIGHT: it sees your light, it chases; no recovery close to it; the knocker decoy

The owner (2026-11-05): *"When mason sees player it chases. No more health stuff if player is kinda near to it."* and *"there must be a
gadget to distract the mason temporarily"*.

How that was read (redirect here if it was meant differently):

1. **Sight -> chase.** The Mason was blind and hunted by sound only. Now it also **sees the lantern-bearer**: when it sees you it commits
   to a chase. Sight is an ADDITIONAL trigger over the sound hunt (listening, stall lunges, the stall clock, annoyed by shots, refuges,
   the stamina waves of CREATURE_PACING.md all still work).
2. **Near = health no longer protects you.** While it chases you and you are within `lethalNear` of its crown / front blocks, **nothing
   heals**: no regeneration, the regen clock stops, bandages and the first-aid kit are refused (a heal being applied is cancelled, the
   item kept). A Mason connect was already a kill from any hp (`creature3d.js` `caughtPlayer` -> `physics.kill(..., 'creature')`, the
   devour scene); it still is, and every regular strike now lands inside the `lethalNear` radius by construction (table below). Also:
   **while it chases you, the hunt gate's 14 s scent window is held full**: healing up past 50 % no longer sends a Mason that is looking
   at you away (the old "it hunts only while you are hurt" rule now ends only once it has lost you).
3. **The knocker** (another agent builds the gadget): `Creature3D.distract(x, y, z, {duration, strength})` lures it away for a while.

Code: `src/sim/masonSight.js` (the sense: sight, near, decoy), hooked into `src/sim/creature3d.js`; tests:
`tools/abyssal-tether-3d/tests/creature/sight.mjs`.

## The rules

**Seen** = all of:

- the crown is within `sightRange` of the player (body centre);
- a clear line (level.segmentBlocked, active solids, the last 0.3 m at your end ignored) from the crown or the 2nd front block to your
  head (eye height) or your torso, sampled every 0.1 s;
- your **lantern shows**: charge > 0 and you are alive. An empty lantern (the floor glow only) is invisible to it;
- nothing rules sight out: a Masons' rest (refuge 1) or the S5 lure niche (refuge 2: the keystone rules stay exactly as they were), the
  S4 staged sighting, an objective override (the S7 escape is already a chase), the hunt gate keeping it out of play, its own
  RECOVERING rest or entry / respawn grace (the pacing waves: each wave needs a fresh notice), a live decoy (below), the game saying the
  view is blocked (not `playing`, cutscenes), `?sight=off`, the Settings > Rope > **Mason sight** = Off, Sandbox (no creature at all).

**The notice beat** (fairness: heard before seen). The first sample that sees you fires `creature:notice {x,y,z,distance,commit}`: a
designed cue (`creature.notice`: three hard stone knocks of its crown on the wall, a low roar swelling under them, a dry chitter; world
placed, `audio/masonSightSfx.js` through the SFX engine's `registerSfx` / `registerSfxRoute`), the caption **[It sees your light]**, and
its red eyes flare (`body.glow` up to 1, the crown unfurls, fading over 0.9 s). It needs **0.5 s of continuous sight** to commit; break
the line (a pillar, a ledge lip, drop below a floor, let the lantern die) and the count starts over. A broken notice does not roar again
for 3 s (glimpses do not spam the cue).

**The chase** (`creature:sight {on:true}`). It pursues along the crawl nav at **pursue x `pursueMul`**, does not stop to listen, creep or
stalk at its menace distance, and attacks by the existing rules: the telegraphed wind-up (0.75 / 0.65 / 0.5 s), never through masonry,
never into a rest; bursts and stamina as before (out of stamina it rests: the chase ends there). A still player no longer counts as
silent to a Mason that sees him (a contact attack starts on a still player too: cause `'sight'`). Losing sight, it keeps the chase for
`memory` s (`creature:sight {on:false, reason:'lost'}`), then it is back to the sound hunt.

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
| notice commit (s of continuous sight) | 0.5 | 0.5 | 0.5 |
| `pursueMul` (x the pursue speed) | 1.12 | 1.15 | 1.2 |
| chase speed in `hunt` mode (m/s) | 5.2 x 1.12 = **5.8** | 6.4 x 1.15 = **7.4** | 8.2 x 1.2 = **9.8** |
| `memory` after sight is lost (s) | 4 | 5 | 6 |
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
- **Douse your light**: an empty lantern is invisible to it (the lantern burns down by itself; the game has no off switch for it).
- **Out-move it**: the chase is 5.8 / 7.4 / 9.8 m/s; you run 5.5 m/s (11 with adrenaline), reel at up to 12 m/s (a yank 17), swing
  and fall far faster. On Normal a reel or a swing out-runs it; on Abyss only a swing, a fall or a yank does.
- **Out-wait it**: break the line and it holds the chase only 4 / 5 / 6 s, then it is back to hunting by sound (go still to be silent).
- **The knocker** (below).
- The stamina waves: after a strike, or out of stamina, it RESTS and sees nothing; every new wave needs a fresh notice (a new cue).

**Worked example (Normal).** You stand on a ledge, lantern lit; the Mason rounds a buttress 20 m away. Next 0.1 s sample: the knocks, the
roar, the caption, its eyes flare. 0.5 s later it commits: 20 -> 10 m (where the wind-up starts) at 5.8 m/s takes about 1.7 s, the
wind-up 0.75 s, the strike reaches 7.66 m. Doing nothing, you are bitten about 3 s after the cue (the Node sim: 2.6-5 s from 18-26 m).
At about 8 m the wrist reads NO RECOVERY: a bandage would do nothing now. Answers: inside the first 0.5 s step behind the buttress
(no chase); after it commits, reel up and away at 12 m/s (the gap grows 6 m/s: in 1 s you are out of its reach, in ~2 s out of the near
radius), or break the line for 4 s.

## The knocker decoy (contract for the gadget)

`Creature3D.distract(x, y, z, opts = { duration: 9, strength: 1 })` -> `true` when accepted.

- **Accepted** only when it is the Mason (skitterlings ignore it), active, IN PLAY (not dormant / out of play by the hunt gate / the S4
  sighting / an override / the victory / the hunt gate's withdraw), not mid-strike (`ATTACK`: call again a moment later), not in the S5
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

## Switches and debug

- `?sight=off` (game.js `sightOff()`): no sight-chase, no near rule (the e2e `e2e.cjs` and `free-attach.cjs` pass it; the Node route bots
  in `verify/` run the creature with its defaults: sight on, the lantern always lit).
- Settings > Rope > **Mason sight** (`masonSight`: `'on'` default | `'off'`).
- `new Creature3D(level, diff, bus, { sight: false })` for tools; `creature.setSight(on, lit, blocked)` per frame (game.js);
  `creature.sight` / `creature.decoy` read-outs.
- `AT3D.debug.creature.sight(force?)`: the state (sees, noticing, chasing, lost, near, nearDist, noRecovery, the numbers, the decoy, the
  stats); `force` `'see'` (always seen when eligible) | `'blind'` | `''`. `AT3D.debug.creature.distract(x, y, z, opts)`.

## Balance note (measured, for the owner)

The pacing sim (`tests/creature/pacing.mjs`, scripted human-pattern players who never hide or break the line, the hunt gate OFF, 20
runs on the REAL level) before -> after, deaths per Chapter I run (lethal sections):

| | careful | hesitant |
|---|---|---|
| Normal | 0.25 -> 0.95 | 2.95 -> 27.6 |
| Nightmare | 0.95 -> 4.6 | 16.7 -> 53.3 |

Expert players (short pauses, fast moves) are unchanged (0 deaths). A player who stands in its view for seconds is now caught, which is
what was asked; the bots do not use the counterplay above, and in the game the Mason is only out when you are hurt (the hunt gate), so
the real numbers will be lower. Knobs if it is too harsh: the notice (0.5 s; 0.8 s gives a reaction window like the Normal wind-up),
`pursueMul` (1.0 = the old pursue speed), `sightRange`.
