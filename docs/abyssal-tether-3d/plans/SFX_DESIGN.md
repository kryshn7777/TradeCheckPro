# THE LANTERN · Designed SFX (SFX_DESIGN.md)

Owner's brief: "Also add detailed sfx. No random ones."

Reading of the brief (the rules this document and the code follow):

1. **Every sound effect is designed for one event.** It has a name (`hook.metal`, `land.wet`, `ui.back`), a design note saying what physically makes it, and it is built from named layers: a transient, a body and a tail. No generic noise burst stands in for several things.
2. **Detailed.** The layers carry numbers: oscillator and partial frequencies, noise bands and Q, attack / hold / decay time-constants, tick trains. The event's data scales them (k = 0..1: impact speed, rope tension, damage, arrival speed). Material (surface, hold, item kind) picks the recipe. World sounds sit where they happen, with distance, air absorption, occlusion and the speed of sound.
3. **No random ones.** Variation is deterministic: a round-robin counter, a left / right alternation, or a hash of the event's data (surface patch, anchor position, item id). `Math.random` is gone from every audio module (a seeded `SeqRng` stream replaced it), so the same inputs always give the same sound, and the tests can check that.
4. **Mixed to a hierarchy.** Danger > important feedback > actions > texture, by priority (voice stealing) and by level, with a voice budget for Quest.

Code: `public/abyssal-tether-3d/src/audio/sfxDesign.js` (the engine), `public/abyssal-tether-3d/src/audio/sfxBank.js` (the recipes, the routing, the captions). Tests: `tools/abyssal-tether-3d/tests/audio/sfx.mjs` with the offline renderer `tools/abyssal-tether-3d/tests/audio/sfxRender.mjs`.

---

## 1. (a) Audit: every bus event and continuous system

"Before" is the state at commit `4cc6500` (this week's jetpack, death beats, wind whoosh, water bed and remains included). "After" is this change. *Legacy* = the hand-written synth function in `audio3d.js` / a module, kept. *Designed* = an `sfxBank.js` recipe. Events marked *not a sound event* are lifecycle, settings, telemetry or render plumbing and are silent by design.

### The player's body and the rope

| event / system | before | after |
|---|---|---|
| footsteps (`_control` stride, every 1.5 m) | legacy `Movement.footstep`: stone / iron / wet by solid kind + hashed puddle patch; `rand()` jitter | **designed** `step.{stone,metal,grate,wet,debris}`: 5 surfaces (grate and bone-and-gravel debris are new), k = run speed, 6-variant round robin, feet alternate L/R pan ±0.1 |
| `player:land` | legacy `_sfxLand` + `landColor` (iron, wet only); random-free but surface-thin | **designed** `land.<surface>`: body thump + floor + surface layer; k = lethal ratio adds debris (k ≥ 0.4) and a formant grunt (k ≥ 0.55); `lantern.chain` jingle above k 0.25 |
| `player:jump` | legacy push-off | legacy + **designed layer** `lantern.chain` (the lantern swinging on its chain) |
| `player:wallhit` | legacy body + grit (`rand`) | legacy, now deterministic |
| `rope:fire` / `grapple:fire` | legacy chuff + zip + flight ticks | legacy, now deterministic |
| `rope:hit` | none (the bite sounds on `grapple:attach`, the arrival) | unchanged: the arrival is the sound |
| `grapple:attach` | legacy `_sfxAttach`: one iron clank for every anchor (ring / hook / fragile pitch only), world | **designed** `hook.{stone,metal,grate,wet,debris,ring}` by the material behind the anchor (free-attach surface anchors carry the solid), world + floor 0.6, hash of the anchor position; the legacy body-catch thunk still plays |
| `grapple:miss` | legacy swish + reel ticks, same for both kinds of miss | **designed** `miss.short` (nothing in reach, hand-panned) / `miss.fall` (the hook skated off: a clack and bounces at the far point, world) |
| `grapple:release`, `rope:cancel`, `rope:slip` | legacy | legacy, deterministic |
| `rope:jolt` | legacy creak + thwack + thump; tension only scaled the level | **designed** `rope.jolt`: tremolo-chopped band noise (fibre creak 48→70 Hz) + thwack + thump; k ≥ 0.45 adds the twang, k ≥ 0.6 the singing line (harmonic partials) |
| `grapple:break` | legacy crack + chips, same for a snapped and a sawn line | **designed** `rope.snap` (fibre crack, whip-back, thud, 14 chips over 1.2 s) / `rope.cut` (the Dresser: 7 strands parting, then the whip) |
| `platform:crumble` | legacy | legacy, deterministic |
| `rope:dry` (launcher still recharging) | **none** | **designed** `launcher.dry`: a pawl click, a spring buzz, no shot; captioned |
| rope friction / taut hum (`ropeFx3d.js`, continuous) | legacy, per hand, tension-driven | unchanged (already data-driven, no randomness) |
| fall wind / air rush (`movement3d.js` rush + `kFall` roar, continuous) | legacy, speed-scaled filtering | unchanged (already speed-scaled) |
| wall scrape, cloth / leather rustle (continuous) | legacy | unchanged |
| breathing / exertion (continuous) | legacy | unchanged, deterministic jitter |

### Climbing

| event | before | after |
|---|---|---|
| `climb:grab` | legacy `_sfxGrip`: masonry / chain / sinew only | **designed** `hold.{stone,ledge,chain,metal,sinew,wet}` (rebar and ledge lips and wet stone are new), hand-panned, hash of the hold position |
| `climb:release`, `climb:hop`, `climb:scrape`, `climb:strain`, `climb:slip` | legacy | legacy, deterministic |
| `climb:mantle` | **none** | **designed** `climb.mantle`: jacket dragging on stone, knee thump, grit, a strained exhale (two formants) |

### The bag, the lantern, the goggles, the jetpack

| event | before | after |
|---|---|---|
| `pickup:collect` | legacy: one chime shape, base note per kind | **designed** `pickup.{kit,bandage,adrenaline,cell}`: the object itself (tin latch, cloth, glass injector, metal cell) + an arpeggio in its own key |
| `pickup:full`, `bag:refuse`, `bag:cancel` | legacy fumble | legacy |
| `bag:apply` (the channel) | legacy per kind (ratchet, rustle, hiss, click-clack) | legacy (already per kind) |
| `bag:done` | legacy chord / heart kicks | **designed** `bag.done.{kit,bandage,adrenaline}` + `lantern.refill` for a cell (contacts snap, filament hum rising, a warm third) |
| `bag:effect` (adrenaline wears off) | legacy | legacy |
| `lantern:low` | legacy: two sine beeps | **designed** `lantern.low`: the filament stutters (120 Hz buzz chopped at 9 Hz), then two falling pips |
| `lantern:empty` | legacy: one falling beep | **designed** `lantern.empty`: falling hum, crackle, the element's last tick; captioned |
| lantern flicker while the cell is low (continuous) | **none** | **designed** `lantern.flutter` from the per-frame hook: interval 1.4 + 7·(charge / 0.15) s × the VAR table, k = how drained |
| `holster:draw` / `holster:stow` | legacy | legacy |
| `nv:on` / `nv:off` / `nv:refuse` | legacy | legacy |
| `nv:low`, `nv:flat`, `nv:ready` | **none** | **designed** `nv.low` (the whine sagging twice), `nv.flat` (collapsing + relay click, captioned), `nv.ready` (two rising chirps) |
| `jetpack:ignite` | legacy whump + held roar (static) | legacy + **designed layer** `jet.flutter`: combustion chugging (brown band chopped at 24 Hz), stopped at the cut |
| `jetpack:cut` | legacy: the roar fades; a dry tank coughs | legacy + **designed** `jet.valve` on a release cut (valve clack, gas hissing out, the nozzle ticking as it cools); the cough stays for a dry tank |
| `jetpack:empty`, `jetpack:can`, `jetpack:low` | legacy | legacy (already specific) |

### Health

| event / system | before | after |
|---|---|---|
| `health:damage` | legacy `_sfxHurt`: thump + crack, no grunt, one cause | **designed** `hurt.blunt` (fall / wall / rockfall: body thump, crack, a two-formant grunt from k ≥ 0.3) / `hurt.cut` (hazard / bite: a tremolo rasp, a sharp intake); the legacy ear ring above 25 % stays |
| heartbeat (continuous, `_scheduleHeart`) | legacy, threat + health driven | unchanged (already data-driven) |
| `health:heal` | **none** | **designed** `heal`: an easing breath out over a warm low fifth; captioned |
| `health:low` | **none** (the heartbeat and the vignette only) | **designed** `health.low`: a cold falling minor second and the blood loud in the ears (brown noise pulsing at 1.6 Hz) |
| `health:recover` | **none** | **designed** `health.recover`: one deep breath in and out (not on topping up to full) |
| `player:death`, `death:beat` (15 beats) | legacy, detailed per beat | legacy, now deterministic (the beats' `rand()` jitter comes from the seeded stream); `player:death` also stops the jet flutter |

### Progress and the world

| event | before | after |
|---|---|---|
| `checkpoint` | legacy: two sine partials | **designed** `checkpoint`: two struck bells with real bell partials (G3, D4) and a breath of relief; captioned |
| `section:enter` (first entry) | legacy tonal swell in the section's key | legacy (already data-driven) |
| `objective:progress` (haul / winch / lamp / bell) | legacy | legacy |
| `objective:done` | **none** | **designed** `objective.done`: bolt clunk, iron ring, chains paying out, an open fifth; captioned |
| `split` (a section played whole: medal) | **none** (a toast only) | **designed** `medal.gold` (A E A bells) / `medal.silver` (A E) / `medal.brass` (one low bell); not when the time is not recorded |
| `seal:open` / `seal:land` | `seal:open` legacy; `seal:land` **none** | `seal:land` **designed** `seal.land`: world, a low boom, the plate ringing, grit off the walls |
| `bell:ring`, `breach:hit` / `breach:break`, `lane:warn` / `lane:on`, `platform:strain`, `nook:*`, `trigger:rumble` / `debris` / `call` | legacy | legacy, deterministic |
| `detail:drip` (scene-detail drips) | **none** (the ambience has its own random drips) | **designed** `drip`: world, ambient bus, hash of the position (the same drip always sounds the same) |
| `prop:impact` (dropped consumables bouncing) | **none** (the payload was documented as "the impact-sound hook") | **designed** `prop.{case,bandage,syringe,cell}`: world, k = normal speed 0.9..7 m/s, ≤ 3 voices |
| `wind:whoosh` | legacy (this week) | legacy |
| `squall:warn` / `squall:on` / `squall:off` | legacy reads the squall state | legacy |
| ambience beds, drones, water bed, creaks, chains (`ambience3d.js`, continuous) | legacy, `Math.random` scheduling | legacy, scheduling now from a seeded stream |
| `game:goal` (the gate drop), `game:victory`, `game:respawn` | legacy | legacy |

### The creatures

| event | before | after |
|---|---|---|
| `creature:clip`, `mason:anim`, `creature:step / call / burst / attack / strike / retreat / sighting`, creature beds (continuous) | legacy (`creatureSync3d.js` + `audio3d.js`) | legacy, deterministic |
| `creature:stare` (the Mason sees you) | **none** | **designed** `creature.stare`: world (bed preset), a sub swell (41 + 43.5 Hz beating), plates settling, held; captioned, severity 2 |
| `creature:annoyed` (a hook hit its body) | **none** | **designed** `creature.annoyed`: a stone clack and a 16-tick chitter burst; captioned |
| `creature:state`, `creature:freeze / unfreeze / linger / hide`, `mason:plant` | state flags (silence signal) | unchanged |
| `dresser:tick / hum / measure / saw / stagger / step / spoiled` | legacy | legacy |
| `dresser:appear` | **none** | **designed** `dresser.appear`: far, three measured chalk taps, a breath of cloth; captioned |
| `dresser:cut` | (the snap plays on `grapple:break` cut:true) | `rope.cut` |
| `dresser:whole`, `dresser:dress`, `dresser:cancel` | none | silent by design (the hum / tick already carry the Dresser; `dress` is the death, the death beats own it) |
| `holdfast:*` (twitch, grip, inhale, breath, close, squeeze, tear, crush, knock, retract, stagger, flinch, release) | legacy | legacy |
| `holdfast:aware` | **none** | **designed** `holdfast.aware`: stone shifting, two wet knuckle settles; captioned |
| `holdfast:outpull` | **none** | **designed** `holdfast.outpull`: stone fingers torn open, the line twanging free; captioned |
| `holdfast:answer` | none | silent by design (the S4 knock answer is the `holdfast:knock` sound) |
| Chapter II: `usher:*`, `evening:stroke`, `c2:*`, `toll:emit`, `hook:*`, `lamp:snuff` | `lampholdSfx.js` (18 events) | legacy, deterministic; `usher:seat / park / collar / relocate`, `c2:answer / name / tenor / pawl / lamp / phase` stay with the Chapter II director (out of this pass) |
| `roach:*` (new critters, another agent) | n/a | not touched; contract in §6 |
| skitterlings (`creature:*` with `skit: true`) | legacy | legacy |

### The menus and the platform

| event | before | after |
|---|---|---|
| `ui:click` | legacy: ONE generic click for every button | **designed** by action: `ui.select`, `ui.back`, `ui.toggle` (tabs, difficulty, chapter), `ui.slide` (slider detents), `ui.start` (start / continue / next chapter: the wick taking), `ui.error` |
| `ui:move` (new: focus / VR hover moved) | **none** | **designed** `ui.move`: a tiny glass tick |
| `intro:page / dark / cut / end` | legacy | legacy (the opening cinematic's sound is being rewritten in its own file by another agent: untouched) |
| `comms:line` / `comms:end` | the radio (`radio3d.js`) | unchanged |
| `game:start / restart / pause / resume / menu`, `settings:changed`, `quality:level`, `xr:start` | mix / lifecycle | unchanged |
| `app:*`, `assets:*`, `gl:*`, `input:*`, `save:*`, `quality:rate`, `gfx:level`, `chapter:set`, `continue:changed`, `game:boot / state / xr / warp / continue / deathpanel / first-xr-frame`, `hint`, `toast`, `trigger`, `arena:pause`, `bag:change`, `xr:recentered / visibility / error / end`, `comfort:snap` | none | not sound events: silent by design (`comfort:snap`, the snap turn, is left silent on purpose: a sound on every turn would tire in VR) |

### Counts

* Sound-producing events before: about 97 in `audio3d.js` (111 subscriptions, 14 of them lifecycle / state flags) + 18 in `lampholdSfx.js`, about 115; 14 of them were generic or material-blind (listed in (b)); none was deterministic.
* After: **19 previously silent events voiced** (`ui:move`, `prop:impact`, `detail:drip`, `rope:dry`, `climb:mantle`, `seal:land`, `objective:done`, `split`, `health:heal`, `health:low`, `health:recover`, `nv:low`, `nv:flat`, `nv:ready`, `creature:stare`, `creature:annoyed`, `holdfast:aware`, `holdfast:outpull`, `dresser:appear`), **14 rebuilt** (footsteps, `player:land`, `grapple:attach`, `grapple:miss`, `grapple:break`, `rope:jolt`, `climb:grab`, `pickup:collect`, `bag:done`, `lantern:low`, `lantern:empty`, `health:damage`, `checkpoint`, `ui:click`), **3 layered** (`player:jump`, `jetpack:ignite`, `jetpack:cut`), **1 new continuous** (the lantern flicker). 74 named recipes. About 134 sound-producing events in all, every one deterministic.

## 2. (b) Gaps and weak spots found

1. **Randomness everywhere.** 22 `Math.random()` calls across `audio3d.js`, `ambience3d.js`, `movement3d.js`, `creatureSync3d.js`, `lampholdSfx.js` (and the `rand()` helpers built on them, used ~90 times): every jitter, every tick train, the noise buffers and their start offsets. Replaced by one seeded `SeqRng` per module (the noise buffers are now identical every run).
2. **One UI click for everything.** Select, back, tabs, sliders, starting a run all made the same 80 ms blip.
3. **Material-blind contact.** The hook clank ignored what it bit (since FREE ATTACH most anchors are surfaces: stone, girders, seal grates, crumbling ledges); grates and the bone-littered deep floors had no footfall of their own; rebar, ledge lips and wet stone holds sounded like masonry; landings had colour for iron and puddles only.
4. **Tension as volume only.** The rope jolt got louder with tension but never changed character.
5. **Silent feedback.** Healing, low health crossing, recovering, the goggles' battery, the launcher's dry trigger, mantling, objectives completing, medals, a seal plate landing, dropped items bouncing (the hook existed with no listener), scene-detail drips, and three creature notice moments (the Mason's stare, its annoyance, the Holdfast becoming aware, the Dresser arriving) had no sound or no caption.
6. **Thin lantern.** The game is THE LANTERN; its cell warning was two sine beeps and its death one falling beep; nothing told you by ear that it was failing between those.
7. **Jetpack.** The roar was a static held noise; the cut just faded.
8. **A miss was a miss.** "Nothing in reach" and "it hit and fell off" sounded the same.
9. **The pickup chime** was the same shape for a tin case, a bandage, a glass injector and a metal cell.

## 3. (c) The design

### c.1 Recipe format (the engine: `sfxDesign.js`)

A recipe is plain data (authored in `sfxBank.js`, compiled once at registration):

```
'hook.metal': {
  bus: 'player', prio: 2, gap: 0.03, level: [0.5, 0.74], send: [0.12, 0.24],
  space: 'world', floor: 0.6, vary: { rule: 'hash', n: 6, pitch: 0.04, level: 0.06 },
  note: 'a struck-iron clang (inharmonic partials, longer at speed) + tick + thunk + line creak',
  layers: [
    { t: 'modal', f: [455, 355], r: [1, 2.32, 3.86, 5.41], m: [0.5, 0.3, 0.2, 0.12], dk: [1, 0.64, 0.45, 0.31], d: [0.11, 0.2], g: 1 },
    { t: 'noise', src: 'white', ft: 'highpass', f: 3000, q: 0, a: 0.001, d: 0.012, g: 0.3 },
    { t: 'tone', w: 'sine', f: 118, f2: 58, sw: 0.035, a: 0.002, d: 0.07, g: 0.4 },
    { t: 'noise', src: 'brown', rate: 1.1, ft: 'bandpass', f: 330, f2: 190, sw: 0.15, q: 5, at: 0.02, a: 0.05, h: 0.12, d: 0.1, g: [0.2, 0.4] },
  ],
}
```

Layer types: `tone` (oscillator, optional sweep f → f2 with time-constant sw, optional tremolo `lfo: [rate, depth]`), `noise` (one of the three shared looping buffers → one biquad, optional sweep and tremolo), `modal` (up to 6 sine partials with their own amplitude and decay multiplier: struck iron, bells, bone, glass), `ticks` (up to 24 band-passed noise clicks over a span: grit, gravel, rattles, droplets, chitter). Envelope for every layer: 0 → peak linear over `a`, hold `h`, exponential decay with time-constant `d` (scheduled to 6 time-constants, −52 dB). Any number can be `[atK0, atK1]` (interpolated by k); `minK` / `maxK` gate a layer by intensity.

`resolveRecipe(recipe, k, variant, plan)` turns that into a preallocated `Plan` of plain numbers (every tick's time, band and gain included). It is pure: the WebAudio scheduler (`SfxEngine._schedule`) and the offline test renderer read the same plan, so what the tests measure is what the game plays.

### c.2 Deterministic variation

| rule | used for | how |
|---|---|---|
| `cycle` | footfalls (6), landings (4), jolts, hurts, the flicker (8) | a per-recipe counter (slot made at registration), variant = count mod n |
| `alt` | the menu toggle | the counter's parity: on and off sit a whole tone apart |
| `hash` | the hook bite, hand holds, props, drips, the miss clatter, the Holdfast | `hashMix(recipe id, key)`, key = the event's position quantised (0.25 to 1 m) xor the anchor id: the same anchor always bites the same way |
| `fixed` | stingers, UI, warnings | one designed sound, no variation (a warning must be recognised instantly) |

A variant does not draw anything: it indexes the designed offset table `VAR = [0, .62, −.48, .31, −.85, .94, −.2, .55]`: pitch × (1 + pitch·VAR[v]), level × (1 − level·|VAR[v+3]|), inner timing × (1 + time·VAR[v+5]). Tick positions, bands and gains come from a 24-bit integer hash of (recipe, layer, variant, tick index). Footfalls also alternate the feet (pan ±0.1).

Surfaces are data too (`surfaceAt`): the solid's kind first (`metal` / `bridge` → metal, `grate` → grate, `crumble` / `breach` → debris), else stone that is wet on `wetness × 0.85` of the hashed 2.2 m patches of the section, and from section 4 down 12 % of the patches are bone and gravel (the remains). The same patch always sounds the same.

The legacy synth functions keep their small envelope jitter, but it now comes from one seeded `SeqRng` per module (seeds in the code), so a replay of the same inputs plays the same sounds.

### c.3 Spatial rules

* `space: 'head'`: head-locked (UI, stingers, body sounds, the lantern), optional pan.
* `space: 'hand'`: head-locked, panned ±0.35 to the hand that did it (holds, misses, the dry trigger).
* `space: 'world'`: an HRTF panner at the event's position (HRTF while the host's budget of 10 / 5 reduced allows, else equal-power), the host's distance curve per preset (`near`, `bed` for the creature's far cues), plus:
  * `floor`: a minimum loudness after distance for the cues that must read (the hook bite 0.6, the rope snap 0.7, the Mason's stare 0.4);
  * air absorption: beyond 10 m a lowpass at 260 + 12000·e^(−d/35) Hz;
  * occlusion: beyond 2.5 m, if `level.segmentBlocked(listener → source)` (the sim's own line of sight, last 0.6 m ignored), −5 dB and a 1.1 kHz lowpass;
  * reverb send grows with distance: send + 0.35·(1 − e^(−d/45));
  * the speed of sound: beyond 28 m the sound starts d / 343 s late (≤ 0.6 s).

### c.4 Loudness hierarchy, priority and ducking

| tier | prio | examples | level at full intensity (offline, loudest 50 ms) |
|---|---|---|---|
| danger | 3 | `hurt.*`, `rope.snap`, `rope.cut`, `creature.stare`, `creature.annoyed`, `holdfast.outpull` | median −11 dBFS, peaks −0.4 .. −8 |
| important | 2 | `hook.*`, `land.*`, `rope.jolt`, `lantern.low / empty / refill`, `health.low`, `objective.done`, `seal.land`, `jet.*`, `ui.start` | median −15 dBFS |
| action | 1 | `hold.*`, `pickup.*`, `miss.*`, `ui.select / back / toggle`, `checkpoint`, medals, `heal` | −19 .. −27 dBFS |
| texture | 0 | `step.*`, `prop.*`, `drip`, `lantern.flutter / chain`, `ui.move / slide` | median −28 dBFS |

Priority drives voice stealing in the host's one-shot pool (a texture voice is stolen first; a danger cue can never be refused for texture). Buses keep the existing ducking: player / creature / ambient / psych go under the death muffle and duck in menus; UI and stingers do not. A hit reads 15 dB over a footstep (tested).

### c.5 Voice and CPU budget (Quest)

* All designed sounds play through the host's pooled voice records: cap 24 (14 in the reduced tier / governor ≥ 3), HRTF ≤ 10 (5), priority stealing. A burst of 216 events stays at 23 / 24 (tested).
* Per-recipe instance caps: footfalls ≤ 2, props ≤ 3, drips ≤ 2, the lantern chain 1, the jet flutter 1; per-recipe minimum gaps (`gap`) rate-limit repeats (UI 25-30 ms, footfalls 90 ms, stingers 1 s, the Mason's stare 4 s).
* Node budget per designed voice ≤ 34 nodes (validated); the largest are the landings and the hook bites (~20). Noise comes from the host's three shared looping buffers (white 2 s, pink 3 s, brown 4 s): no buffer is ever generated per play. Filters run at k-rate.
* No JS allocation per play in `resolveRecipe` (the Plan, its layers and tick arrays are preallocated; real numbers live in Float64Arrays; 1.6 M plans → 3 young collections in the test, versus 136 before the fix) and none per frame in the bank's update (2 M frames → 0). The only per-play allocations are the WebAudio nodes a one-shot needs (unavoidable; the host disconnects them when the voice ends).

### c.6 Captions

Newly voiced gameplay sounds that carry information get a caption (merged into `captions.js` from `SFX_CAPTIONS`): `[Hook clatters, no bite]`, `[Lantern dies]` (sev 2), `[Launcher clicks, still charging]`, `[A mechanism unlocks]`, `[A low bell: checkpoint]`, `[You breathe easier]`, `[Goggles die]`, `[Something is watching you]` (sev 2), `[Angry chittering]` (sev 2), `[Stone shifts in the wall]`, `[Stone fingers torn open]`, `[Chalk tapping, far off]`. Texture (steps, props, drips, UI) is not captioned.

### c.7 The recipes

Generated from `sfxBank.js` (the source of truth; numbers in Hz, seconds, linear gain; `a` attack, `h` hold, `d` decay time-constant, `@` start offset, `x→y` = at k 0 → k 1, `⇢` = a sweep, `k≥` = layer gate):

| recipe | bus / prio | space | level | variation | layers (transient → body → tail) |
|---|---|---|---|---|---|
| `step.stone` | player / 0 | head, ≤2 | 0.22→0.4 | cycle ×6 | brown bandpass 230 Hz q1 g0.8 a0.002 d0.03; tone sine 110⇢62 Hz g0.2→0.4 a0.002 d0.04; white bandpass 3100 Hz q1.2 g0.16 @0.012 a0.002 d0.02; 1→3 ticks/0.05 s 2600–5200 Hz g0.1 @0.025 a0.002 d0.006 k≥0.55 |
| `step.metal` | player / 0 | head, ≤2 | 0.2→0.36 | cycle ×6 | brown lowpass 320 Hz q0 g0.5 a0.002 d0.025; modal 210 Hz ×[1,2.43,3.9] g1 a0.002 d0.06→0.09; white bandpass 4200 Hz q12 g0.3 a0.002 d0.035 |
| `step.grate` | player / 0 | head, ≤2 | 0.2→0.36 | cycle ×6 | brown bandpass 260 Hz q1 g0.6 a0.002 d0.03; modal 520 Hz ×[1,2.76,5.4] g1 a0.002 d0.05; 3→5 ticks/0.07 s 1800–4200 Hz g0.22 @0.01 a0.002 d0.006 |
| `step.wet` | player / 0 | head, ≤2 | 0.22→0.38 | cycle ×6 | pink bandpass 380⇢1400 Hz q3 g0.7 a0.004 d0.06; tone sine 600⇢1700 Hz g0.25 @0.03 a0.002 d0.03; brown lowpass 260 Hz q0 g0.5 a0.002 d0.04; 2→4 ticks/0.12 s 1200–3000 Hz g0.14 @0.05 a0.002 d0.01 |
| `step.debris` | player / 0 | head, ≤2 | 0.22→0.38 | cycle ×6 | brown bandpass 240 Hz q1 g0.55 a0.002 d0.03; 4→7 ticks/0.06 s 1600–5200 Hz g0.3 a0.002 d0.005; modal 1450 Hz ×[1,2.9,4.7] g1 @0.02 a0.002 d0.03 |
| `land.stone` | player / 2 | head | 0.42→0.74 | cycle ×4 | tone sine 90⇢42 Hz g0.3→0.75 a0.002 d0.06→0.16; brown lowpass 300→1200 Hz q0 g0.35→0.7 a0.002 d0.05→0.11; white bandpass 2500 Hz q0.8 g0.08→0.18 a0.002 d0.03; 3→8 ticks/0.15→0.35 s 1200–3600 Hz g0.22 @0.04 a0.002 d0.01 k≥0.4; pink bandpass 560 Hz q4 g0.55 @0.03 a0.02 h0.08 d0.05 k≥0.55; tone triangle 115⇢84 Hz g0.07 @0.03 a0.02 h0.06 d0.05 k≥0.55 |
| `land.metal` | player / 2 | head | 0.42→0.74 | cycle ×4 | tone sine 90⇢42 Hz g0.3→0.7 a0.002 d0.06→0.15; brown lowpass 300→900 Hz q0 g0.3→0.6 a0.002 d0.04→0.09; modal 175→140 Hz ×[1,2.32,3.86,5.41] g0.5→0.9 a0.002 d0.12→0.24; pink bandpass 560 Hz q4 g0.5 @0.03 a0.02 h0.08 d0.05 k≥0.55 |
| `land.grate` | player / 2 | head | 0.42→0.74 | cycle ×4 | tone sine 95⇢45 Hz g0.3→0.7 a0.002 d0.06→0.14; modal 480→400 Hz ×[1,2.76,5.4] g1 a0.002 d0.08→0.14; 5→12 ticks/0.15→0.4 s 1500–4200 Hz g0.3 @0.02 a0.002 d0.008; pink bandpass 560 Hz q4 g0.5 @0.03 a0.02 h0.08 d0.05 k≥0.55 |
| `land.wet` | player / 2 | head | 0.42→0.74 | cycle ×4 | tone sine 85⇢42 Hz g0.3→0.7 a0.002 d0.06→0.15; white highpass 1700 Hz q0 g0.2→0.4 a0.012 h0.03 d0.06→0.12; pink bandpass 420⇢1300 Hz q2 g0.45 a0.002 d0.08; 3→9 ticks/0.2→0.45 s 900–2600 Hz g0.25 @0.06 a0.002 d0.012; pink bandpass 560 Hz q4 g0.5 @0.03 a0.02 h0.08 d0.05 k≥0.55 |
| `land.debris` | player / 2 | head | 0.42→0.74 | cycle ×4 | tone sine 90⇢42 Hz g0.3→0.72 a0.002 d0.06→0.15; brown lowpass 300→1000 Hz q0 g0.3→0.6 a0.002 d0.05→0.1; 6→14 ticks/0.12→0.4 s 1400–5200 Hz g0.3 a0.002 d0.006; modal 1250 Hz ×[1,2.9,4.7] g1 @0.05 a0.002 d0.035; pink bandpass 560 Hz q4 g0.5 @0.03 a0.02 h0.08 d0.05 k≥0.55 |
| `hook.stone` | player / 2 | world (floor 0.6) | 0.5→0.8 | hash ×6 | white highpass 2600 Hz q0 g0.35 a0.001 d0.012; tone sine 118⇢58 Hz g0.55 a0.002 d0.07; 3→6 ticks/0.12 s 1400–4800 Hz g0.25 @0.015 a0.002 d0.007; modal 480→400 Hz ×[1,2.32,3.86,5.41] g1 a0.002 d0.08; brown bandpass 330⇢190 Hz q5 g0.2→0.4 @0.02 a0.05 h0.12 d0.1 |
| `hook.metal` | player / 2 | world (floor 0.6) | 0.5→0.74 | hash ×6 | modal 455→355 Hz ×[1,2.32,3.86,5.41] g1 a0.002 d0.11→0.2; white highpass 3000 Hz q0 g0.3 a0.001 d0.012; tone sine 118⇢58 Hz g0.4 a0.002 d0.07; brown bandpass 330⇢190 Hz q5 g0.2→0.4 @0.02 a0.05 h0.12 d0.1 |
| `hook.grate` | player / 2 | world (floor 0.6) | 0.5→0.8 | hash ×6 | modal 610 Hz ×[1,2.76,5.4] g1 a0.002 d0.08→0.14; 5→9 ticks/0.18→0.3 s 1600–4400 Hz g0.28 @0.01 a0.002 d0.007; tone sine 118⇢58 Hz g0.4 a0.002 d0.06; brown bandpass 330⇢190 Hz q5 g0.2→0.4 @0.02 a0.05 h0.12 d0.1 |
| `hook.wet` | player / 2 | world (floor 0.6) | 0.5→0.8 | hash ×6 | white highpass 2400 Hz q0 g0.3 a0.001 d0.012; tone sine 112⇢56 Hz g0.55 a0.002 d0.07; pink bandpass 900⇢2400 Hz q2 g0.35 a0.003 d0.05; 2→4 ticks/0.25 s 1000–2800 Hz g0.18 @0.05 a0.002 d0.012; brown bandpass 330⇢190 Hz q5 g0.2→0.4 @0.02 a0.05 h0.12 d0.1 |
| `hook.debris` | player / 2 | world (floor 0.6) | 0.55→0.85 | hash ×6 | tone sine 105⇢52 Hz g0.45 a0.002 d0.07; brown bandpass 760 Hz q1.4 g0.45 a0.004 d0.09; 8→14 ticks/0.6 s 900–4200 Hz g0.3 @0.03 a0.002 d0.012; brown bandpass 300⇢170 Hz q5 g0.2→0.35 @0.02 a0.05 h0.12 d0.1 |
| `hook.ring` | player / 2 | world (floor 0.6) | 0.5→0.74 | hash ×6 | modal 400→312 Hz ×[1,2.32,3.86,5.41] g1 a0.002 d0.13→0.24; white highpass 2600 Hz q0 g0.3 a0.001 d0.012; tone sine 118⇢58 Hz g0.5 a0.002 d0.07; 2→5 ticks/0.2 s 2400–5200 Hz g0.2 @0.06 a0.002 d0.01; brown bandpass 330⇢190 Hz q5 g0.2→0.4 @0.02 a0.05 h0.12 d0.1 |
| `miss.short` | player / 1 | hand | 1.2 | cycle ×4 | white bandpass 2600⇢500 Hz q1.2 g0.3 a0.02 h0.05 d0.05; tone triangle 900⇢300 Hz g0.08 @0.12 a0.003 d0.03; 5 ticks/0.2 s 2400–4200 Hz g0.35 @0.13 a0.002 d0.008 |
| `miss.fall` | player / 1 | world (floor 0.35) | 0.7 | hash ×6 | modal 700 Hz ×[1,2.32,3.86,5.41] g1 a0.002 d0.04; 6 ticks/0.4 s 1800–4200 Hz g0.3 @0.06 a0.002 d0.012; white highpass 3000 Hz q0 g0.25 a0.001 d0.01 |
| `rope.jolt` | player / 2 | head | 0.45→0.8 | cycle ×4 | brown bandpass 640 Hz q8 g0.6→0.9 a0.012 h0.06 d0.08 trem 48→70 Hz; brown bandpass 1500 Hz q10 g0.4 a0.012 h0.05 d0.07 trem 48→70 Hz; white lowpass 1800 Hz q0 g0.3→0.5 a0.002 d0.03; tone sine 72⇢44 Hz g0.35→0.6 a0.002 d0.07; tone triangle 180→260⇢140→200 Hz g0.2 a0.003 d0.15→0.3 k≥0.45; modal 380→520 Hz ×[1,2.01,3.03] g1 a0.002 d0.18 k≥0.6 |
| `rope.snap` | player / 3 | world (floor 0.7) | 0.8 | hash ×4 | white highpass 1800 Hz q0 g0.6 a0.001 d0.015; tone triangle 1400⇢120 Hz g0.22 a0.002 d0.08; white bandpass 3200⇢600 Hz q1.5 g0.3 a0.005 h0.06 d0.06; tone sine 90⇢40 Hz g0.5 a0.002 d0.09; 14 ticks/1.2 s 900–4200 Hz g0.4 @0.05 a0.002 d0.014; brown lowpass 600 Hz q0 g0.4 @0.02 a0.01 d0.2 |
| `rope.cut` | player / 3 | world (floor 0.7) | 0.8 | cycle ×4 | 7 ticks/0.16 s 2000–5200 Hz g0.4 a0.002 d0.006; white highpass 2000 Hz q0 g0.55 @0.17 a0.001 d0.015; tone triangle 1200⇢110 Hz g0.22 @0.17 a0.002 d0.09; white bandpass 3000⇢600 Hz q1.5 g0.3 @0.17 a0.005 h0.06 d0.06 |
| `launcher.dry` | player / 1 | hand | 0.45 | cycle ×3 | white bandpass 2800 Hz q5 g0.5 a0.001 d0.006; modal 1900 Hz ×[1,2.3] g1 a0.002 d0.02; white bandpass 1500 Hz q3 g0.3 @0.07 a0.001 d0.008; tone sawtooth 160⇢120 Hz g0.04 @0.012 a0.003 d0.03 |
| `hold.stone` | player / 1 | hand | 0.5 | hash ×6 | pink bandpass 1400 Hz q0.9 g0.45 a0.002 d0.02; tone sine 130⇢70 Hz g0.35 a0.002 d0.035; 2→3 ticks/0.05 s 2200–5000 Hz g0.15 @0.01 a0.002 d0.005 |
| `hold.ledge` | player / 1 | hand | 0.55 | hash ×6 | pink bandpass 1200 Hz q0.9 g0.45 a0.002 d0.025; tone sine 110⇢55 Hz g0.45 a0.002 d0.05; 4 ticks/0.09 s 1800–4600 Hz g0.18 @0.015 a0.002 d0.006 |
| `hold.chain` | player / 1 | hand | 0.5 | hash ×6 | modal 1900 Hz ×[1,1.47,2.31] g1 a0.002 d0.05; white bandpass 3400 Hz q5 g0.3 a0.002 d0.06; 3 ticks/0.1 s 2600–5200 Hz g0.25 @0.01 a0.002 d0.01; tone sine 190⇢70 Hz g0.3 a0.002 d0.03 |
| `hold.metal` | player / 1 | hand | 0.5 | hash ×6 | modal 760 Hz ×[1,2.4,4.1] g1 a0.002 d0.06; pink bandpass 1500 Hz q1 g0.35 a0.002 d0.02; tone sine 150⇢70 Hz g0.3 a0.002 d0.03 |
| `hold.sinew` | player / 1 | hand | 0.8 | hash ×6 | pink bandpass 700⇢420 Hz q2 g0.4 a0.01 h0.05 d0.06; tone sine 240⇢160 Hz g0.12 a0.008 d0.05; 2 ticks/0.12 s 500–1100 Hz g0.2 @0.04 a0.002 d0.012 |
| `hold.wet` | player / 1 | hand | 0.5 | hash ×6 | pink bandpass 1100 Hz q0.9 g0.4 a0.002 d0.025; tone sine 125⇢68 Hz g0.3 a0.002 d0.035; pink bandpass 1800 Hz q1.4 g0.25 @0.005 a0.002 d0.04; tone sine 900⇢1800 Hz g0.1 @0.05 a0.002 d0.02 |
| `climb.mantle` | player / 1 | head | 0.5 | cycle ×3 | pink bandpass 1600⇢900 Hz q0.8 g0.25 a0.08 h0.2 d0.12; tone sine 100⇢50 Hz g0.4 a0.002 d0.05; 5 ticks/0.35 s 2000–4800 Hz g0.12 @0.05 a0.002 d0.006; pink bandpass 620 Hz q3 g0.35 @0.25 a0.04 h0.12 d0.12; pink bandpass 1250 Hz q4 g0.2 @0.25 a0.04 h0.12 d0.1 |
| `prop.case` | player / 0 | world, ≤3 | 0.15→0.5 | hash ×8 | modal 340 Hz ×[1,1.58,2.37] g1 a0.002 d0.03→0.06; 1→3 ticks/0.06 s 2600–4800 Hz g0.2 @0.01 a0.002 d0.006; brown lowpass 500 Hz q0 g0.4 a0.002 d0.02 |
| `prop.bandage` | player / 0 | world, ≤3 | 0.12→0.35 | hash ×8 | brown lowpass 420 Hz q0 g0.7 a0.003 d0.03; pink bandpass 2200 Hz q0.8 g0.15 @0.005 a0.002 d0.03 |
| `prop.syringe` | player / 0 | world, ≤3 | 0.12→0.4 | hash ×8 | modal 2300 Hz ×[1,2.71,5.12,7.9] g1 a0.002 d0.03→0.05; white highpass 4000 Hz q0 g0.3 a0.002 d0.004 |
| `prop.cell` | player / 0 | world, ≤3 | 0.15→0.45 | hash ×8 | modal 1250 Hz ×[1,2.32,3.86,5.41] g1 a0.002 d0.04→0.07; 1→4 ticks/0.25 s 3000–5000 Hz g0.12 @0.04 a0.002 d0.006 |
| `drip` | ambient / 0 | world, ≤2 | 0.32 | hash ×8 | tone sine 1200⇢2600 Hz g0.3 a0.001 d0.025; tone sine 900 Hz g0.08 @0.002 a0.002 d0.05; white bandpass 3800 Hz q6 g0.1 a0.002 d0.008 |
| `seal.land` | ambient / 2 | world (floor 0.45) | 0.8 | hash ×4 | tone sine 62⇢30 Hz g0.8 a0.002 d0.18; brown lowpass 700 Hz q0 g0.6 a0.002 d0.16; modal 120 Hz ×[1,2.32,3.86,5.41] g0.6 a0.002 d0.4; 12 ticks/1.4 s 900–3600 Hz g0.25 @0.15 a0.002 d0.014 |
| `lantern.low` | stinger / 2 | head | 0.3 | fixed | white bandpass 120 Hz q6 g0.45 a0.01 h0.35 d0.08 trem 9 Hz; tone sine 880 Hz g0.4 @0.45 a0.01 h0.1 d0.04; tone sine 660 Hz g0.4 @0.73 a0.01 h0.1 d0.04 |
| `lantern.empty` | stinger / 2 | head | 0.32 | fixed | tone sine 330⇢110 Hz g0.45 a0.015 h0.5 d0.2; white bandpass 120 Hz q6 g0.35 a0.01 h0.4 d0.1 trem 14 Hz; 6 ticks/0.6 s 2400–5200 Hz g0.2 @0.1 a0.002 d0.005; white bandpass 3500 Hz q4 g0.3 @1.05 a0.001 d0.006 |
| `lantern.flutter` | player / 0 | head | 0.12→0.26 | cycle ×8 | white bandpass 120 Hz q7 g0.6 a0.004 h0.08→0.2 d0.03 trem 11→17 Hz; tone sine 240 Hz g0.12 a0.004 h0.06→0.15 d0.02 |
| `lantern.chain` | player / 0 | head, ≤1 | 0.08→0.2 | cycle ×6 | 2→5 ticks/0.08→0.18 s 3200–6400 Hz g0.4 a0.002 d0.01; modal 2900 Hz ×[1,1.53] g1 @0.02 a0.002 d0.03 |
| `lantern.refill` | stinger / 2 | head | 0.4 | fixed | white bandpass 2600 Hz q4 g0.5 a0.001 d0.006; white bandpass 1800 Hz q4 g0.35 @0.06 a0.001 d0.008; tone sine 110⇢240 Hz g0.25 @0.1 a0.12 h0.3 d0.25; tone sine 329.63 Hz g0.3 @0.35 a0.012 d0.35; tone sine 493.88 Hz g0.22 @0.44 a0.012 d0.35 |
| `nv.low` | ui / 1 | head | 0.35 | fixed | tone sine 6200⇢4800 Hz g0.12 a0.01 h0.08 d0.05; tone sine 6000⇢4400 Hz g0.12 @0.28 a0.01 h0.08 d0.05 |
| `nv.flat` | ui / 2 | head | 0.4 | fixed | tone sine 6000⇢700 Hz g0.14 a0.005 h0.1 d0.12; white bandpass 2200 Hz q4 g0.4 @0.4 a0.001 d0.006 |
| `nv.ready` | ui / 1 | head | 0.3 | fixed | tone sine 3000⇢4200 Hz g0.18 a0.004 d0.03; tone sine 3600⇢5000 Hz g0.18 @0.12 a0.004 d0.04 |
| `pickup.kit` | player / 1 | head | 0.5 | fixed | white bandpass 2400 Hz q5 g0.4 a0.001 d0.006; modal 340 Hz ×[1,1.58] g1 a0.002 d0.04; tone sine 392 Hz g0.32 @0.03 a0.006 d0.26; tone sine 588 Hz g0.2 @0.075 a0.006 d0.22; tone sine 784 Hz g0.1 @0.12 a0.006 d0.16 |
| `pickup.bandage` | player / 1 | head | 0.5 | fixed | pink bandpass 3200 Hz q1.2 g0.15 a0.01 h0.04 d0.05; tone sine 523.25 Hz g0.3 @0.02 a0.006 d0.26; tone sine 784.9 Hz g0.18 @0.065 a0.006 d0.22; tone sine 1051.7 Hz g0.09 @0.11 a0.006 d0.16 |
| `pickup.adrenaline` | player / 1 | head | 0.5 | fixed | modal 2300 Hz ×[1,2.71,5.12,7.9] g1 a0.002 d0.05; tone triangle 784 Hz g0.3 @0.03 a0.006 d0.26; tone triangle 1176 Hz g0.18 @0.075 a0.006 d0.22; tone triangle 1576 Hz g0.08 @0.12 a0.006 d0.16 |
| `pickup.cell` | player / 1 | head | 0.5 | fixed | white bandpass 5200 Hz q1.2 g0.3 a0.001 d0.012; modal 1250 Hz ×[1,2.32] g1 a0.002 d0.04; tone sine 440 Hz g0.32 @0.02 a0.006 d0.26; tone sine 660 Hz g0.2 @0.065 a0.006 d0.22; tone sine 884 Hz g0.1 @0.11 a0.006 d0.16 |
| `bag.done.kit` | stinger / 2 | head | 0.36 | fixed | white bandpass 2400 Hz q5 g0.4 a0.001 d0.006; white bandpass 2100 Hz q5 g0.35 @0.07 a0.001 d0.006; tone sine 196 Hz g0.4 @0.12 a0.012 d0.6; tone sine 246.94 Hz g0.4 @0.21 a0.012 d0.6; tone sine 392 Hz g0.4 @0.3 a0.012 d0.6 |
| `bag.done.bandage` | stinger / 2 | head | 0.36 | fixed | white bandpass 2600⇢4200 Hz q1.5 g0.3 a0.01 h0.12 d0.03 trem 38 Hz; pink bandpass 900 Hz q1.5 g0.3 @0.2 a0.02 h0.04 d0.04; tone sine 261.63 Hz g0.3 @0.26 a0.012 d0.35; tone sine 392 Hz g0.3 @0.35 a0.012 d0.35 |
| `bag.done.adrenaline` | stinger / 2 | head | 0.36 | fixed | tone sine 70⇢38 Hz g0.8 a0.002 d0.1; tone sine 70⇢38 Hz g0.55 @0.2 a0.002 d0.1; pink bandpass 600⇢3200 Hz q0.6 g0.3 a0.3 h0.2 d0.3 |
| `hurt.blunt` | player / 3 | head | 0.5→0.66 | cycle ×4 | tone sine 78⇢32 Hz g0.55→1 a0.002 d0.12→0.26; brown lowpass 220→720 Hz q0 g0.5→0.9 a0.003 d0.08→0.18; pink bandpass 700 Hz q0.9 g0.16→0.36 a0.002 d0.03; pink bandpass 540 Hz q4 g0.5 @0.04 a0.015 h0.07 d0.06 k≥0.3; pink bandpass 1150 Hz q5 g0.3 @0.04 a0.015 h0.06 d0.05 k≥0.3; tone triangle 120⇢82 Hz g0.08 @0.04 a0.015 h0.05 d0.05 k≥0.3 |
| `hurt.cut` | player / 3 | head | 0.5→0.78 | cycle ×4 | tone sine 80⇢36 Hz g0.45→0.85 a0.002 d0.1→0.2; white bandpass 1800⇢900 Hz q1.4 g0.25→0.45 a0.003 h0.04 d0.05 trem 60 Hz; brown lowpass 260→640 Hz q0 g0.4→0.7 a0.002 d0.07→0.14; pink bandpass 2400⇢1600 Hz q3 g0.3 @0.08 a0.04 h0.05 d0.06 k≥0.3 |
| `heal` | stinger / 1 | head | 0.22 | fixed | pink bandpass 900⇢500 Hz q1.2 g0.35 a0.15 h0.3 d0.3; tone sine 130.81 Hz g0.35 a0.3 h0.4 d0.5; tone sine 196 Hz g0.25 @0.15 a0.3 h0.3 d0.5 |
| `health.low` | psych / 2 | head | 0.4 | fixed | tone sine 233.08⇢220 Hz g0.3 a0.05 h0.5 d0.4; tone sine 246.94⇢233.08 Hz g0.2 a0.05 h0.5 d0.4; brown lowpass 180 Hz q0 g0.6 a0.3 h0.5 d0.5 trem 1.6 Hz |
| `health.recover` | psych / 1 | head | 0.6 | fixed | pink bandpass 700⇢1300 Hz q1 g0.3 a0.4 h0.2 d0.15; pink bandpass 1100⇢500 Hz q1 g0.35 @0.9 a0.1 h0.4 d0.3 |
| `checkpoint` | stinger / 1 | head | 0.24 | cycle ×2 | modal 196 Hz ×[1,2.76,5.4,8.93] g0.45 a0.004 d0.6; modal 293.66 Hz ×[1,2.76,5.4,8.93] g0.28 @0.12 a0.004 d0.55; pink bandpass 800⇢500 Hz q1.2 g0.12 @0.2 a0.2 h0.2 d0.3 |
| `objective.done` | stinger / 2 | head | 0.42 | fixed | tone sine 70⇢36 Hz g0.7 a0.002 d0.12; modal 160 Hz ×[1,2.32,3.86,5.41] g0.5 a0.002 d0.25; 10 ticks/0.7 s 1800–4000 Hz g0.18 @0.12 a0.002 d0.012; tone sine 110 Hz g0.3 @0.5 a0.15 h0.4 d0.6; tone sine 164.81 Hz g0.22 @0.6 a0.15 h0.35 d0.6 |
| `medal.gold` | ui / 1 | head | 0.42 | fixed | modal 440 Hz ×[1,2.76,5.4,8.93] g0.3 a0.002 d0.35; modal 659.26 Hz ×[1,2.76,5.4,8.93] g0.28 @0.14 a0.002 d0.35; modal 880 Hz ×[1,2.76,5.4,8.93] g0.3 @0.28 a0.002 d0.5 |
| `medal.silver` | ui / 1 | head | 0.38 | fixed | modal 440 Hz ×[1,2.76,5.4,8.93] g0.3 a0.002 d0.35; modal 659.26 Hz ×[1,2.76,5.4,8.93] g0.28 @0.14 a0.002 d0.45 |
| `medal.brass` | ui / 1 | head | 0.36 | fixed | modal 220 Hz ×[1,2.76,5.4,8.93] g0.4 a0.002 d0.5 |
| `jet.flutter` | player / 2 | head, ≤1 | 0.4 | cycle ×4 | brown bandpass 180 Hz q1.6 g0.7 a0.06 h2.4 d0.08 trem 24 Hz; white highpass 5200 Hz q0 g0.06 a0.1 h2.3 d0.08 |
| `jet.valve` | player / 2 | head | 0.45 | cycle ×4 | white bandpass 2200 Hz q4 g0.45 a0.001 d0.008; tone sine 140⇢70 Hz g0.3 a0.002 d0.03; white bandpass 4200⇢1800 Hz q0.9 g0.25 @0.01 a0.005 d0.2; 5 ticks/1.4 s 3600–6200 Hz g0.14 @0.35 a0.002 d0.004 |
| `creature.stare` | creature / 3 | world (floor 0.4) | 0.45 | fixed | tone sine 41 Hz g0.6 a0.8 h0.8 d0.5; tone sine 43.5 Hz g0.45 a0.8 h0.8 d0.5; 5 ticks/1.4 s 300–900 Hz g0.5 @0.3 a0.002 d0.03; brown lowpass 240 Hz q2 g0.35 a0.6 h0.6 d0.6 |
| `creature.annoyed` | creature / 3 | world (floor 0.5) | 0.7 | cycle ×4 | modal 820 Hz ×[1,2.9,4.7] g1 a0.002 d0.03; 16 ticks/0.5 s 1200–3400 Hz g0.45 @0.05 a0.002 d0.006; brown bandpass 220 Hz q2 g0.5 @0.05 a0.05 h0.2 d0.15 trem 31 Hz |
| `holdfast.aware` | creature / 2 | world (floor 0.3) | 0.45 | hash ×4 | brown bandpass 260⇢180 Hz q2 g0.5 a0.1 h0.3 d0.2; modal 1100 Hz ×[1,2.9,4.7] g1 @0.35 a0.002 d0.025; modal 980 Hz ×[1,2.9,4.7] g1 @0.62 a0.002 d0.025; pink bandpass 600 Hz q3 g0.2 @0.35 a0.01 d0.06 |
| `holdfast.outpull` | creature / 3 | world (floor 0.55) | 0.75 | cycle ×3 | brown bandpass 500⇢1400 Hz q1.5 g0.6 a0.01 h0.15 d0.08 trem 40 Hz; 10 ticks/0.4 s 1200–4200 Hz g0.35 a0.002 d0.008; tone triangle 240⇢180 Hz g0.18 @0.18 a0.003 d0.2; tone sine 80⇢40 Hz g0.5 a0.002 d0.08 |
| `dresser.appear` | creature / 2 | world (floor 0.25) | 0.4 | fixed | modal 1700 Hz ×[1,2.9,4.7] g1 a0.002 d0.02; modal 1700 Hz ×[1,2.9,4.7] g1 @0.42 a0.002 d0.02; modal 1700 Hz ×[1,2.9,4.7] g1 @0.84 a0.002 d0.02; pink bandpass 2600 Hz q0.8 g0.12 @1 a0.15 h0.1 d0.15 |
| `ui.move` | ui / 0 | head | 0.22 | cycle ×2 | tone sine 2300 Hz g0.25 a0.001 d0.008; white highpass 6000 Hz q0 g0.06 a0.001 d0.003 |
| `ui.select` | ui / 1 | head | 0.45 | fixed | white bandpass 3500 Hz q2 g0.2 a0.001 d0.004; tone triangle 880 Hz g0.3 a0.002 d0.03; tone sine 1320 Hz g0.25 @0.04 a0.002 d0.06 |
| `ui.back` | ui / 1 | head | 0.4 | fixed | white bandpass 3000 Hz q2 g0.18 a0.001 d0.004; tone sine 1320 Hz g0.25 a0.002 d0.03; tone triangle 880 Hz g0.28 @0.045 a0.002 d0.05 |
| `ui.toggle` | ui / 1 | head | 0.6 | alt ×2 | white bandpass 2400 Hz q4 g0.35 a0.001 d0.005; white bandpass 1700 Hz q4 g0.25 @0.028 a0.001 d0.005; tone sine 600 Hz g0.1 a0.002 d0.02 |
| `ui.slide` | ui / 0 | head | 0.2 | cycle ×8 | tone sine 1800 Hz g0.25 a0.001 d0.005 |
| `ui.start` | ui / 2 | head | 0.5 | fixed | brown lowpass 400 Hz q0 g0.5 a0.01 d0.2; pink bandpass 1200⇢600 Hz q1 g0.2 a0.01 d0.08; tone sine 110 Hz g0.4 a0.02 h0.1 d0.3; tone sine 165 Hz g0.3 @0.05 a0.02 h0.1 d0.3 |
| `ui.error` | ui / 1 | head | 0.35 | fixed | tone square 180 Hz g0.12 a0.002 h0.04 d0.03; tone square 151 Hz g0.12 @0.09 a0.002 h0.05 d0.04 |


## 4. Determinism, in one place

* `sfxDesign.js` exports `SeqRng` (mulberry32), `hash32`, `hashPos`, `hashStr`, `hashMix`, `SfxCounters` and the `VAR` table. Nothing in `sfxDesign.js` / `sfxBank.js` reads a clock or a random source; the engine's counters advance only when a sound plays.
* Every `Math.random()` in `src/audio/` is now `SEQ.next()` on a module-level seeded stream (`audio3d.js` 0x1a7e, `ambience3d.js` 0xa3b1, `creatureSync3d.js` 0xc5e7, `lampholdSfx.js` 0x1a3f, `movement3d.js` 0x30e5). The test greps every audio module (comments stripped) and also runs the real manager with `Math.random` replaced by a function that throws.

## 5. How the engine plugs into AudioManager3D

The engine (`SfxEngine`) is created in the manager's constructor (it needs no AudioContext until it plays) and:

* subscribes its own **routes** on the bus: the 19 new events and the 3 layers (it plays only once the context is built);
* answers the legacy handlers' **hooks**: a legacy handler calls `this._sfxTake(type, payload)` first; true means the designed recipe handled it (played, or deliberately chose silence, e.g. a landing too soft to hear) and the legacy synth is skipped; false (the engine failed once and marked itself broken, or no hook) falls back to the legacy synth. The handlers' side effects (exertion, the death muffle, the catch thunk, the ear ring) are untouched;
* runs `update(dt, game)` each audio frame (the lantern flicker).

Every hook line in the shared files:

`src/audio/audio3d.js`
1. `import { SfxEngine, SeqRng } from './sfxDesign.js';` and `import { SFX_BANK } from './sfxBank.js';`, plus `const SEQ = new SeqRng(0x1a7e);`
2. the 13 `Math.random()` → `SEQ.next()` (including `rand()`, `makeNoise`, `_vNoise`'s start offset, the loop start offsets, `_around`)
3. constructor: `this._sfx = new SfxEngine(this, SFX_BANK); this._sfx.attach(bus); this._steps = 0;`
4. `_update`: `this._sfx.update(dt, game);`
5. footsteps in `_control`: `if (this._sfx.takeK('step', stepK)) this._steps++; else if (…legacy…)`
6. `_onUiClick(p)`, `_onCheckpoint(p)`, `_onAttach` (`_sfxAttach`), `_onMiss`, `_onBreak`, `_onJolt`, `_onLand`, `_onClimbGrab`, `_onPickup`, `_onBagDone`, `_onLanternLow(p)`, `_onLanternEmpty(p)`, `_onHealthDamage` (`_sfxHurt`): `if (!this._sfxTake('<event>', p)) this._sfx<Legacy>(…);`
7. new small methods: `_sfxTake(type, p)`, `registerSfx(id, recipe)`, `registerSfxRoute(type, fn)`
8. `debugState()`: `sfx: this._sfx ? this._sfx.debug() : null`

`src/ui/captions.js`
1. `import { SFX_CAPTIONS, SFX_CAPTION_EVENTS } from '../audio/sfxBank.js';`
2. `captionForEvent`: `default: return SFX_CAPTIONS[type] || null;`
3. `CAPTION_EVENTS`: `...SFX_CAPTION_EVENTS,`

`src/ui/ui3d.js`
1. `_emitClick(kind)` emits `ui:click { kind }` (was `{}`); a new `_emitMove()` emits `ui:move`
2. `_onClick`: `this._emitClick(btn.dataset.action)`; `_activateRegion`: `this._emitClick(r.act)`; the two back paths: `this._emitClick('back')`
3. `_setHover` (VR ray reaches a new control): `this._emitMove()`; keyboard arrow focus: `if (next && next !== active) this._emitMove();`

`ambience3d.js`, `creatureSync3d.js`, `lampholdSfx.js`, `movement3d.js`: one import + one seeded stream each, `Math.random()` → `SEQ.next()`.

## 6. Extension points and the `roach:*` contract

* `audio.registerSfx(id, recipe)`: adds (or replaces) a recipe at runtime; returns the compiled recipe (throws on an invalid one).
* `audio.registerSfxRoute(type, fn)`: routes one more bus event; `fn(payload, engine)` builds options with `engine.opts()` (the reused scratch: `x, y, z` for a world sound, `hand`, `pan`, `key` for the hash rule, `gain`, `delay`, `dist`) and calls `engine.play(id, k, opts)`.
* The red cockroach critters belong to another agent: nothing here plays them. Suggested bus contract (payloads are plain objects, positions in world metres):

| event | payload | suggested sound |
|---|---|---|
| `roach:spawn` | `{ id, x, y, z }` | a dry carapace click as one drops in |
| `roach:skitter` | `{ id, x, y, z, speed }` (m/s) | a tick train, k = speed / 3, `hash` rule keyed by id, world, prio 0, ≤ 2 voices |
| `roach:flee` | `{ id, x, y, z }` | a faster, brighter skitter burst |
| `roach:squash` | `{ id, x, y, z }` | a wet crunch (prio 1) |

The test registers a `roach.skitter` recipe and a `roach:skitter` route through these two calls and hears it play.

## 7. Verification

`node tools/abyssal-tether-3d/tests/audio/sfx.mjs [--table] [--wav DIR]` (in the suite: `npm run test:at3d`):

* the table: every recipe compiles; finite numbers; ≤ 34 nodes; 0 < duration < 12 s; prio-2+ world sounds keep a distance floor;
* coverage: every hook and route plays a recipe that exists; every recipe is reachable from an event (74 / 74); the required list (27 events) is covered; the hook bite, the holds, the steps and landings, the pickups / uses / props and the menu actions are all distinct;
* determinism: no `Math.random` in any audio module; identical plans for identical inputs (every layer, every tick); the 6-step round robin; hash stability; L/R alternation; two engines agree; surfaces stable per patch;
* the real `AudioManager3D` on the strict mock Web Audio: the hooks replace the legacy synth (hook bite, UI, footfalls on a girder), the prop cap, the flicker, the jet flutter killed at the cut, a 216-event burst within the voice cap, every voice released after its tail, no warnings, the extension point, no `Math.random` call while it ran;
* no allocation per play / per frame (young-generation collection count);
* captions: the 12 new captions are tracked once each, bracketed, with known kinds; the warnings have severity ≥ 1;
* the offline render of every recipe at k = 0, 0.5, 1 through a pure-JS mirror of the scheduler (`sfxRender.mjs`: the same noise shaping, WebAudio-spec biquads at k-rate, the same envelopes and tick automation): no NaN, peak < 0.98 before the master limiter, audible (loudest 50 ms > −50 dBFS), the hierarchy holds (danger −11.2 dB ≥ important −14.6 dB > texture −27.6 dB median), a hit 15 dB over a step. `--wav DIR` writes every recipe as a 48 kHz mono WAV for listening.

Not verified here: how the sounds actually sound to an ear (the offline mirror measures levels, not taste); the HRTF / reverb / master compressor stages (the mirror stops at the voice); CPU on a Quest headset (only the node / voice counts and the allocation behaviour are measured).
