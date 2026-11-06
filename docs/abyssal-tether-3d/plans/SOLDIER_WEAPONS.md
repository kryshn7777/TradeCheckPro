# THE SOLDIERS' WEAPONS: grenades and a service revolver off the dead

Owner (2026-11-06): *"you can find random grenades or weapons of previous dead soldiers. You can use that to hurt the mason. You can use
that to hurt the skitterlings. The grenade instantly damages it and makes it frightened and goes away for some time. The guns do the same
as well."*

How that was read (redirect here if it was meant differently):

1. **Found, not given.** Two new bag kinds lie beside the fallen of an earlier expedition: a fused iron **grenade** (`ITEM.GRENADE = 5`, 3 at
   most) and an old **service revolver** (`ITEM.SIDEARM = 6`: its bag count is its ROUNDS, found with 6, 12 at most). None at the start of
   a run. Seeded per run like the supplies and the knockers (no `Math.random`).
2. **Hurt and frightened, never killed.** The Mason is a level fixture: a hit **hurts** it (a wound stat, a pained screech) and
   **frightens** it: it recoils, WITHDRAWS up the masonry out of sight and stays out of play (no hunt, no prowl pass) for a while. Repeated
   hits diminish; it always comes back. In a scripted beat it only staggers.
3. **The hunters die.** A hunter skitterling in the blast or in the line of a round is killed (a gory splat) and stays out of the group in
   that section. The swarm scatters.
4. **A risk, not a free win.** A grenade at your own feet kills you; a round that misses is LOUD and wakes the Mason to you.

Lore (STORY.md voice; no canon clash: the Lanternwrights' story is untouched, the Perennial expeditions are canon, COMMS.md): an earlier
expedition's security detail went down armed and never came back. Iron does not kill what the walls are made of, but it HURTS it, and the
Mason flees what hurts it. The first pickup of each says so (a toast):

- *A grenade off a dead soldier of an earlier expedition. He never threw it. Iron will not kill it, but it hurts.*
- *His service revolver, still loaded. The walls took him before he fired. Loud: it hears every shot.*

Code: `src/sim/weapons3d.js` (the weapons, pure), `src/sim/creature3d.js` (`hurt` / `frighten` / `frightFor` / `hearShot` / `rayHit` /
`nearestPoint` / `setScripted`, the `FRIGHT` numbers), `src/sim/skitter3d.js` (`kill` / `rayHit`), `src/sim/pickups3d.js` (`pickWeapons`,
`checkWeaponFairness`, `WEAPON_SPAWN`), `src/sim/inventory3d.js` (kinds 5 / 6, `migrateCounts`), `src/weaponGlue.js` (input, the run frame,
the bus, the debug API), `src/render/weaponView.js`, `src/audio/weaponSfx.js`. Tests: `tests/creature/weapons.mjs`,
`tests/sim/test-weapon-pickups.mjs`.

## Where they lie (pickWeapons)

| | grenades | revolver |
|---|---|---|
| Normal / Sandbox | 4: S2 S4 S6 S8 (every 2nd section from S2) | 1 (6 rounds) in a seeded middle section (S3-S6) |
| Nightmare | 3: S2 S5 S8 (every 3rd) | 1 (6 rounds) |
| Abyss | 2: S3 S7 (every 4th from S3) | 1 (**4** rounds) |

On a supply spot left free by the supplies and the knockers, with the knockers' rules (never a 'slow' safe-line spot, never within 4 m of
the spawn / a checkpoint, never in a Masons' rest) plus: never inside or within 1 m of a hazard box, never within 1.5 m of another pick
(no stacking). Risky perches weigh 3, alcoves 2, ledges 1, and a spot with a **fallen body** (sim/remainsPlan.js, the same plan the
skeletons are drawn from; not a hanging one) within 6 m weighs x4: about half of them lie right by a body (65 of 120 in the test's 30
runs). The supplies and knockers are exactly what they are without the weapons (they only add; `checkFairness` holds). The pickup is the
supplies' own mechanic (walk / swing through it, or a hand with the grip in VR); a revolver gives its rounds (`amount`). A full grenade
pouch leaves one lying. **A respawn keeps them**: a weapon taken stays taken and the bag keeps its grenades / rounds as the death left them
(a thrown grenade, a fired round is gone): nothing to farm. A new run resets everything. The route bots never see any (`weaponDiff` is
empty unless the game sets it).

## The grenade

- **Throw**: exactly the knocker's input (select it, then: desktop G held = charge, an aim arc, the release throws; touch: GREN lobs it;
  VR: pull it up out of the bag, swing and let go). The fuse is lit on the throw: **2.2 s**, a sizzle that follows it (`grenade:fizz`
  every 0.3 s), an ember on the fuse flickering faster as it burns down. It bounces and settles like the knocker (heavier: restitution
  0.3, friction 0.55). A hard hit (>= 2.5 m/s) within 1.1 m of the Mason's body or 0.7 m of a skitterling sets it off at once. 1 s
  between throws, at most 3 in the world.
- **The blast** (radius **6.5 m**): an effect per target, 1 within 2.5 m falling to 0.55 at the edge, x0.35 when masonry stands between
  (`level.segmentBlocked`); 0.3 or more counts.
  - **The Mason** (its nearest body block): `frighten(withdraw x (0.6 + 0.4 effect))` + `hurt(2 x effect)`.
  - **Hunter skitterlings**: killed.
  - **The swarm**: `roaches.burstAt` (they scatter from the crack).
  - **You**: within **2 m** with a clear line: **lethal** (1.0 of health, a 'hazard' death, no devour scene); out to 6.5 m up to 0.45 of
    health falling to 0 (at 4 m about 0.25), x0.35 through masonry. Through `Health3D.damage(cause 'blast')`, so the no-healing rule and
    the regen clock treat it like any other wound.

## The service revolver

- **Fire**: select it, then desktop G (a tap) along the crosshair; touch GUN along the view; VR: pull it up out of the bag (it is in that
  hand), aim with the hand and release the grip: one round along that hand's aim ray (the rope's own aim). **The rope triggers are never
  used.** One round per shot, `fireCooldown` **0.45 s**, an empty cylinder clicks (`revolver:dry`, a toast "Out of rounds").
- **Hitscan** to 45 m: the first solid stops it (`level.raycast`). Generous hit volumes: every spine block's annoy radius x1.15, the crown
  and the two front blocks x1.6 (`Creature3D.rayHit`; a round 1 m over the crown still hits, 4.5 m clear misses); skitterlings x1.6 on
  their own (smaller) blocks.
- **A Mason hit**: `frighten(withdraw x 0.7)` + `hurt(1)`. **A skitterling hit**: killed.
- **It is loud.** Unless it hit the Mason, `Creature3D.hearShot(x, y, z)`: in play within 55 m it wakes to the shooter (sound, not sight:
  a live knocker decoy ends, it stops listening / creeping, it hears you as moving, pursues, annoyed: faster for a moment, once per its
  20 s annoy cooldown); out of play in a hunting section under the hunt gate it brings the next prowl pass to within 4 s. Shooting blindly
  costs you.
- **Muzzle flash**: the lantern's flare (`game.flow.flare` = 1: the swing-chain path in `_updateLantern`, x1.5, gone in ~0.4 s) and a few
  sparks of the existing FX points. No light, no draw call.

## The Mason: hurt, frightened, withdrawn (creature3d.js)

`frighten(duration, source, fromX, fromZ)`:

| | Normal | Nightmare | Abyss |
|---|---|---|---|
| withdraw after a full grenade hit (s) | **40** | **32** | **24** |
| after a revolver round (x0.7) | 28 | 22.4 | 16.8 |

- **Diminishing**: frights closer together than **90 s** (the run clock) get x0.6 for every earlier one in that streak, at least x0.3 and
  never under 5 s: on Normal 40, 24, 14.4, 12, 12 s ... Never 0 and never a free removal; 90 s of quiet and it is 40 again. A hit while
  it is already frightened extends the fright only when the new length is longer.
- **What it does**: the event `creature:frighten {withdraw, stagger, count}` (the pained screech, the withdrawing rumble, the caption
  [It screams and flees up the shaft]); at once harmless (not lethal), its strike / surge / chase / decoy broken off, RECOVERING (its own
  recoil); the hunt gate's withdraw climb (up the masonry, out of sight; out of play once 60 m away or after 9 s); then out of play: every
  hunting mode is the unseen dormant one until the fright runs out (`_cfgOf`), no prowl pass starts, the gate armed by a wound does not
  bring it back, a knocker is refused. When it ends (`creature:frighten:end`): the section's behaviour again: it arrives from above with
  the entry grace (a hunt) or the prowl waits its `first` s (well, gated); its next notice is a warning again.
- **Scripted beats only stagger** (`scriptedNow`): an objective override (the S7 escape), `setScripted` (the glue sets it while the S5
  keystone or the S7 arena objective of the player's section is open), the S4 sighting, an `escape` section (S8), the S5 lure niche
  (refuge 2), the victory. A 1.2 s recoil (RECOVERING), a broken-off strike; it never leaves play, the scripted flow is untouched.
- **The rests**: a Masons' rest is not a scripted beat: the fright works there as anywhere, and the rest's rules (no attack starts,
  listening at the mouth) hold through it and after it.
- **A respawn** forgets the fright (the diminishing memory stays). A new run forgets everything.
- `hurt(amount, source)`: `stats.hurts`, `wounds`, `creature:hurt {x,y,z,source,withdraw,amount,stagger}`. It never dies.
- **Untouched when never called**: nothing here draws a random number or runs on its own. The pacing sim is byte-for-byte the same
  (`pacing.mjs 12`, plain and `GATE=1`, compared with the tree before this work); the bots never use weapons.

## Counterplay and balance

The Mason is still the level: a weapon buys **time**, not safety.

- **Scarcity**: 4 grenades and 6 rounds on a whole Normal Chapter I (fewer deeper difficulties), none at the start. Used well, a grenade buys
  40 s; all 4, each thrown as the last fright runs out, buy 40 + 24 + 14.4 + 12 = 90 s, not a free section (thrown back to back they buy
  40 s: a shorter fright never cuts into a longer one running).
- **The blast is yours too**: 2 m is a death, 4 m a quarter of your health. Throwing it at a Mason that is ON you means a blast at your feet:
  you must throw early (it commits from 20 m at 5.2 m/s on Normal: ~3 s from the notice to the bite) or after breaking the line.
- **The revolver is loud**: a miss calls it (55 m) and is no cheaper than being seen; 0.45 s between rounds and a short cylinder.
- **Line of sight**: a grenade round a corner is damped to x0.35 (most of a blast through stone does not count).
- **The scripted beats keep their teeth**: S5's keystone, S7's arena and S8's escape cannot be skipped with a grenade.
- Compared with the knocker (a 9 s lure, never a hurt): the knocker moves it; the weapons remove it for a while. They stack: a knocker
  draws it to a spot, a grenade on that spot sends it away.

What to tune (all in code, one place each): `WEAPONS.withdraw` (40 / 32 / 24 s), `WEAPONS.revolver.shotMul` (0.7), `FRIGHT.window` /
`decay` / `dimFloor` (90 s, x0.6, x0.3), `WEAPONS.grenade.radius` / `full` / `edge` / `losDamp`, `WEAPONS.self` (2 m lethal, 0.45), the fuse
(2.2 s), `FRIGHT.hearRange` / `rouse` (55 m, 4 s), the counts (`WEAPON_SPAWN`: `every`, `first`, `rounds`), the caps (`CONFIG.bag.caps`).

## Input, UI and feedback

- **The gadget**: the one item G (and the VR pull-up) uses: the knocker (default), a grenade, the revolver. Desktop **5 / 6 / 7** pick one,
  **T** cycles; touch: the bag's **KNOCK / GREN / GUN** buttons pick and use at once; VR: tap **X** while the bag ring is open to cycle (the
  ring says *X: SWITCH* and *PULL UP: GRENADE x2*). Picking up a weapon while the gadget's own count is 0 selects it. A new run: the knocker.
- **The bag strip** (wrist screen, desktop HUD copy) shows the gadget's glyph and count at the lamp row's end (new grenade and revolver
  silhouettes); the radial its draw hint. Toasts: the lore lines on the first pickups, "No grenade left", "Out of rounds", "Rounds taken: n".
- **Tutorial** (appended): after the first weapon pickup, how to choose and use it per platform; learned on the first throw / shot.
- **Captions**: [A fuse hissing], [A blast], [It screams and flees up the shaft], [It recoils, screaming], [A wet crunch].
- **Sounds** (`audio/weaponSfx.js`, designed recipes through `registerSfx` / `registerSfxRoute`): the spoon ping + throw, the fuse hiss,
  the iron clunk, the blast (crack, sub thump, stone boom, grit, and three slap-backs falling away down the shaft), the revolver (hammer
  tick, crack, chest thump, two slap-backs), the dry click, the hit confirm, the Mason's pained screech and its withdrawing rumble, the
  skitterling's wet crunch.
- **Picture** (`render/weaponView.js`): ONE InstancedMesh (+1 draw call, 4 instances at most: the grenades in the world and the VR
  revolver in the hand; both models in one geometry, the instance picks one in the vertex shader), the engine's shared lit material (no
  texture, no light, no sampler of its own). The blast, the muzzle sparks, the stone chips on the Mason and the gore are the existing FX
  points / rubble (`fx.burst`, now with an optional `tint`), the flash is the lantern's flare: +0 draw calls. The grenade's aim arc is the
  knocker view's line. The pickups are two more silhouettes in the pickups' merged mesh. The models are placeholders behind
  `weaponTemplate(kind)`: the SEAM for `render/itemModels.js` `buildGrenade()` / `buildSidearm()`.
- **Settings**: Rope > **Soldiers' weapons** (`weapons`, default on; off = none found, G is the knocker's); `?weapons=off` (the e2e and the
  free-attach bot pass it).
- **Debug**: `AT3D.debug.weapons.state()`, `give(grenades, rounds)`, `select('grenade' | 'revolver' | 'knocker')`, `throw({charge, dx, dy,
  dz, x, y, z, vx, vy, vz, free})`, `fire({dx, dy, dz, free})`, `blast(x, y, z)` (a grenade going off there now).

## Cost

Deterministic (no Math.random, no clock but dt), Node-safe. No allocation per frame in `Weapons3D.update` / `fire`, the creature's hit
tests and the glue's frame paths (checked statically; 200 k frames of throws, fuses, blasts and shots cost no young collection beyond the
noise). Event payloads are reused. +1 draw call, ~150-250 triangles per shown instance, no texture, no light, no new asset (the precache
core is unchanged).
