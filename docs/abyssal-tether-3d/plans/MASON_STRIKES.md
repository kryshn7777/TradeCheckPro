# MASON STRIKES: survivable, dodgeable hits (SIM side)

Owner decision (verbatim): "when the mason hits us, we won't die immediately, but we will lose like 30% of our health per every
hit. The skittlings cause 10% damage, the mason does 30% damage, and every hit the player camera goes like red and a high pitched
sound and then he falls down for a moment and slowly gets up. The mason attacks once every 3 to 5 seconds. The player must, if he
stays in there when it attacks, he will get damage. If he starts moving something like that, he might be able to avoid the damage.
This system must be implemented properly."

Two owners: **SIM** (this plan: the rules, the numbers, the state, the bots, the tests) and **FEEDBACK** (the red flash, the
whine, the camera/body fall and rise, haptics, captions). FEEDBACK only reads the contract below; it never edits the SIM files.

## 1. The contract (fixed, both sides)

- Bus event **`player:hit`** `{source: 'mason'|'skitter', amount, hp, x, y, z, dx, dz, down}`: `amount` the hp fraction taken,
  `hp` after the hit, `x, y, z` the attacker's head, `dx, dz` the unit horizontal direction attacker -> player (0, 0 when directly
  above), `down` true when a knockdown follows. Emitted AFTER the usual `health:damage` (cause `'creature'` for the Mason,
  `'skitter'` for a skitterling bite). A lethal hit also emits it (`down: false`), then the existing death (`physics.kill(...,
  'creature')`: the Mason's devour scene, the skitterling's bitten scene: unchanged).
- **`game.knock`**: an instance of `Knockdown` (`src/sim/knockdown.js`, pure, Node-safe):
  - `phase` `'none' | 'down' | 'rise'`, `t` (s in the phase), `dur` (the phase's total s), `active` (phase !== 'none')
  - `k` 0 standing .. 1 flat: down = cubic ease-out to 1 over the first **0.25 s**, then held; rise = smoothstep from the value
    it had back to 0 over the rise (slow get-up)
  - `moveMul` 0..1 on walk / air steer / jump / reel: **0** while down, **0.35 -> 1** linearly across the rise, 1 standing;
    during a stagger (below) **0.4 -> 1** across the stagger
  - `stagger` (s left of a stagger; `phase` stays `'none'`, `k` stays 0)
  - `start(strength, floorOk)`: `strength >= 1 && floorOk` = the full knockdown (**1.1 s down + 2.4 s rise**, 3.5 s); otherwise a
    stagger of **0.6 s** (strength >= 1: a Mason hit while gripping / hanging / airborne) or **0.35 s** (a skitterling bite)
  - `update(dt)`, `cancel()` (immediately standing, no events but `player:up` when it was active), `abort()` (a fast 0.4 s rise
    from where it is: the body left the floor, e.g. grabbed a wall)
  - events: `player:down {dur}`, `player:rise {dur}`, `player:up {}`
- Bites and strikes never rotate the headset camera: SIM only provides state; FEEDBACK decides the view (VR comfort).

## 2. Damage (single-sourced)

`config3d.js` gains `STRIKE_DAMAGE = { mason: 0.30, skitter: 0.10 }` (fractions of full hp, every difficulty; Sandbox has no
creature). The skitterling table `CREATURE_VARIANTS.skitterling.hitDamage` reads it (0.10 on Normal / Nightmare / Abyss; it was
0.26 / 0.32 / 0.40). `health3d.damage` snaps hp below 1e-6 to 0 so ten 0.10 bites (and four 0.30 strikes) are exactly lethal.

- A Mason connect: `health.damage(0.30, 'creature', 0)`. hp > 0: knockdown (grounded) or stagger (not), NO `physics.kill`.
  hp <= 0: the existing Mason death (`'creature'`, devour). From full: 1.00 -> 0.70 -> 0.40 -> 0.10 -> dead (**4 hits**).
- A skitterling bite: `health.damage(0.10, 'skitter', 0)` (the existing path), stumble 0.35 s, its grip cost unchanged.
- Out of scope, unchanged: the Dresser (`'dressed'`), the Usher, the Holdfast, falls, hazards, regen, heals; the no-heal radius
  of a chasing Mason (`health.noRecovery`, MASON_SIGHT.md) stays.

## 3. Cadence (the Mason only)

- `STRIKE_TUNE[diff].cadence = [lo, hi]`: the interval from one attack START to the next, drawn uniformly from a dedicated seeded
  stream (`U.rng(seed ^ 0x57c1ade)`, so the creature's main random stream and every older seeded test stays as it was):
  Normal **[3.6, 5.0]**, Nightmare **[3.3, 4.6]**, Abyss **[3.0, 4.2]**; always inside [3, 5].
- Gate: `_startAttack` refuses (returns false, no side effects) while the cadence clock `_atkCd > 0`. Every existing trigger
  (contact / sight / creep / committed lunge / stall lunge) goes through it, so no two Mason attacks ever start < 3 s apart.
- Driver: while **engaged** (lethal, the player alive and not in a rest, and it chases you OR you are within engage + 4 m) a
  refused attack holds (no extra surges), stamina does not drain, and after a MISS the recoil goes back to PURSUING (not
  RECOVERING): in reach it strikes again the moment the clock allows, so the start-to-start interval is the drawn [lo, hi].
  Not engaged: the old wave pacing (stamina, bursts, listening, RECOVERING withdraws) is unchanged.
- After a HIT: `_atkCd = max(_atkCd, afterHit)` with **afterHit = 3.5 + 1.5 = 5.0 s** from the impact (knockdown total + 1.5),
  and it goes to PURSUING holding off (the attack is gated) while you are down. A frozen player in reach is hit every
  windup + 5.0 = ~6 s: dead in 4 hits about **18 s** after the first.
- Every existing safety lever is kept in front of the cadence: spawn / section grace, the first-sighting warning and the
  post-chase cooldown (masonSight), the rests (refuge 1: no attack starts, nothing hits), the lure niche (refuge 2: it attacks,
  the keystone takes it), the knocker decoy, the hood, the S4 sighting, prowl passes until it sees you, overrides.
- Max one Mason hit per 3 s for any player state: enforced by the gate and again in `_strike` (`_lastHitT`).

## 4. The dodgeable telegraph

`STRIKE_TUNE` (Mason; the skitterlings keep their own wind-up and reach):

| | Normal | Nightmare | Abyss |
|---|---|---|---|
| windup (s) | 1.0 | 0.9 | 0.85 |
| strike radius R (m) | 2.0 | 2.0 | 1.9 |
| lead (s of player velocity, capped 0.5 m) | 0.08 | 0.1 | 0.12 |
| cadence (s) | 3.6-5.0 | 3.3-4.6 | 3.0-4.2 |

- Windup start: the strike point **L** = the player's position + lead (capped 0.5 m), locked. The `creature:attack` event carries
  `{windup, lx, ly, lz, radius}` in addition to the old fields. During the windup the head draws back and advances toward L (not
  toward the player) at windupAdv, stopping 3.5 m short of L.
- Impact (windup end): the lunge runs from the head S toward L, at most `reach` long (killRadius x 1.6 + nav.stretch: unchanged)
  to E. **Hit** iff: lethal, alive, no grace, not immune, refuge 0, the line head -> player not occluded (`_occlusion`), and the
  player is within **R** of the segment S-E (the locked point and the swept line). Standing still or hanging still = hit; running,
  reeling, swinging, dropping or strafing more than R off the line = a miss (`creature:strike {hit:false, distance}`: near
  misses, hunger, run highlights and the chase arc's near misses unchanged).
- Dodge reachable on foot from standing (walk 5.5 m/s, 4.4 m/s with a gun out, runAccel 40 m/s^2: 0.07 s to speed): leaving R
  takes R / v + 0.06 s = 0.42 s (5.5) / 0.51 s (4.4) on Normal, leaving a reaction budget of 0.58 / 0.49 s in the 1.0 s windup;
  Nightmare 0.48 / 0.39 s; Abyss 0.44 / 0.36 s. Expert (0.2 s) always escapes; careful (0.4 s) escapes on Normal, sometimes not on
  Nightmare / Abyss with a gun out; hesitant (0.9 s) is hit.

## 5. After a hit (the game glue: `sim/playerHits.js`, `PlayerHits`)

Owns `knock` (the Knockdown), the immunity clock and the application of hits. game.js: `game.knock = game.hits.knock`.

- `mason(src, player, ctx)` / `skitter(amount, src, player, ctx)`; ctx = `{health, kill(cause), level, gripping, tethers}`.
- Immunity: a Mason hit makes the player immune to creature strikes and bites until the knockdown (or stagger) ends **+ 1.0 s**
  (4.5 s for a knockdown, 1.6 s for a stagger). `creature.immune` is set from it every frame, so the Mason's own decision (and its
  `creature:strike hit`) already sees it; a bite while immune is dropped.
- **Never a deadly fall**: the knockdown only when `floorOk`: grounded, not climbing / gripping, a floor under the body (a 0.9 m
  ray down hits a solid). Otherwise a 0.6 s stagger: holds, ropes and reel stay (no release, nothing pushes you). Knockback: up to
  **0.8 m** (cap 1.5) along (dx, dz) over the first 0.25 s, applied kinematically in 0.1 m slices, each slice only if the path is
  clear (`segmentBlocked`) and there is floor under the new point (ray down): it stops at an edge, never off it.
- Lethal: `player:hit {down:false}`, then `kill('creature')` (devour) / the bite's existing death.
- Controls (game.js `_stepPhysics`): `move.x/z *= moveMul`, `reel *= moveMul` (down / rise only), `jumpPressed` dropped (not
  buffered) while moveMul < 0.5. The intent is rebuilt every frame from the raw input, so nothing latches: at `player:up` the
  controls are exactly the raw input again. The knockdown aborts (fast rise) when the body leaves the floor or starts climbing,
  and is cancelled on death, respawn, restart, menu (`game:*` bus events) and when not playing.

## 6. Scripted sections and other consumers

- S4 sighting, S5 lure niche + keystone breach (`Objectives3D.onStrike` on `creature:strike {hit:false, stop}`: strikes at stone
  still come with the cadence), the S7 survive arena and escape override, lure / hidden flags, the rests: unchanged rules.
- chaseArc: a hit no longer ends the chase (the Mason keeps chasing a survivor); a lethal hit ends it through `player:death`.
- Run highlights (near misses), trials (Untouched = no `health:damage`), dread, hood, knocker, tutorial: unchanged.

## 7. Bots and balance targets

`tests/creature/pacing.mjs` gets real health (Health3D, `noRecovery` from the creature), the real PlayerHits / Knockdown (a knocked
bot stays put while down, moves at moveMul while rising), and a DODGE: on a Mason `creature:attack`, after the profile's reaction
time (**expert 0.2 s, careful 0.4 s, hesitant 0.9 s**; a frozen bot / a stalled bot never), a grounded bot runs out of the zone at
5 m/s (a hanging bot swings away). `STRIKES=1` prints the table (20 runs per cell, LEVEL=real): Normal / Nightmare / Abyss x
expert / careful / hesitant x blind / hunting / healthy gate: hits/run, HP lost/run, deaths/run, plus the frozen camper's hits to
death and seconds from the first hit to death.

Targets: expert ~0 deaths and < 1 hit/run; careful <= 0.5 deaths/run on Normal and <= 2 on Nightmare; frozen in reach dies in 4
hits (12-20 s); no run is a guaranteed death. Tuning knobs: cadence bias, R, windup, immunity only (not 30 % / 10 % / 3-5 s).
The route bots (`verify/`) never face the creature (they count catches, not applied): they need no dodge; the verify must stay green.

## 8. Tests (registered in run-tests.mjs)

- `tests/creature/strikes.mjs` (the real Creature3D on the stub shaft): cadence in [3, 5] over many seeds and difficulties; the
  windup locks L; stand still = hit, run off = miss, a swing = miss; one `creature:strike hit:true` per hit and never a kill at
  full hp; 4 hits kill from full (with PlayerHits + Health3D); nooks safe; occlusion; grace / immunity; no chained hit
  (>= 5 s after a hit); deterministic with a seed.
- `tests/health/strike-damage.mjs`: 0.30 / 0.10 single-sourced, the `player:hit` payload, the devour death at hp 0, no kill on a
  survivable hit, ten bites kill.
- `tests/physics/test-knockdown.mjs`: phases, k curve, moveMul ramp, events, cancel / abort, staggers, no knockdown while gripping
  or airborne, edge-safe knockback on a real ledge, no stuck input through the game's step mapping.
- Existing tests that asserted lethality are adjusted only there.

## 9. Edge cases

- A hit during the rest / lure niche: impossible (refuge rules). A hit through a solid: impossible (occlusion).
- A hit while the S7 survive clock runs: damage only; the arena is not reset.
- God mode / victory: `health.god` = no damage, no knockdown (PlayerHits checks it).
- Death during a knockdown (a fall, another creature): cancelled on `player:death`.
- Respawn / restart / menu / pause: knockdown cancelled, immunity cleared.
- Allocation: Knockdown and PlayerHits preallocate; event payloads only on the rare hit events.
