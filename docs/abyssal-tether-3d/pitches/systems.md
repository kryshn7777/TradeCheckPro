# ABYSSAL TETHER: Five-Chapter Plan · Pitch: "SYSTEMS DRIVEN"

> Role: lead game designer. Angle: each chapter teaches the tether one new rule, keeps every old rule alive, and the
> last chapter asks for all of them at once. Date: 2026-10-19. Status: pitch for owner review. Target: Meta Horizon
> Store, WebXR PWA, free demo (Chapter I) plus a $9.99 in-app unlock. 5 chapters, about 2 h 40 min for a first-time
> player. Full 3D movement, no comfort options, three.js r170, no Unity. Quality before speed (owner, 2026-10-19).

---

## 0. The pitch on one page

**Logline.** You descend 2.5 km through a living cathedral on two tethers, while the building hunts you by sound. Each
stratum teaches your rope a new trick: ride the machine, breathe through the line, see by its crack, hold the falling
world still. The last stratum asks for all of them at once.

**Tagline:** *The rope learns. So does it.*

**The promise.** This is a systems game: a few verbs with deep interactions. Chapter I's tether is already the best
thing in the build. Each later chapter adds **exactly one rule** to that tether and keeps every earlier rule in play.
By Chapter V the player reads a room the way a climber reads a wall: *what moves, what breathes, what hears, what is
lit.* Because every moving thing runs on a deterministic clock, the same rules that make the game learnable also make
it a speedrun game, and the routes come out of the systems rather than out of a list of authored tricks.

| # | Chapter | Depth | Environment | The one new rule | What the Mason learns | Other danger | Exam (set-piece) | First time |
|---|---|---|---|---|---|---|---|---|
| I | **The Underspire** *(free demo)* | 0–556 m | Inverted stone cathedral, iron, teal shafts, amber lamps | *(baseline)* swing, chain, reel, yank, fragile rings, crumbling ledges. **The hook gives one taste of rule II.** | It hunts by sound and punishes stalling | Falls, rebar, blades | The Hollow Nave → **The Eye of the Plumb** (hook) | 24–28 min |
| II | **The Winding** | 556–1,180 m | A vertical clockwork engine: brass, black iron, verdigris, sodium lamps | **LIVE ANCHORS.** Rings bolted to moving machinery. The rope inherits their motion. | It rides the machine. It is deaf in the din. | The machine: gear teeth, crush pistons, a runaway | **The Stopping** | 30–34 min |
| III | **The Tidehalls** | 1,180–1,640 m | Flooded cisterns: pale limestone, brass diving bells, cyan algae, black water | **THE BREATH LINE.** Water catches falls and steals breath. Underwater the rope is your engine, and on a bellows ring it is your air. | It cannot swim. It hunts the waterline, then breaks the sea-wall. | Drowning, currents, the tide. **Here the Mason is the lesser danger.** | **The Sea-Wall** | 33–37 min |
| IV | **The Lampless Reach** | 1,640–2,150 m | A lightless basalt rift under the "NO LAMPS" mark: wax-pale fungus, colossal listening horns | **SOUNDING.** Crack the rope to see the room for a few seconds. Whatever hears the crack knows where it came from. | It hunts in total darkness, and you feel it through the rope | **The Sallows**: blind gliders that hunt *light* | **The Choir of Horns** | 32–36 min |
| V | **The Stillwell** | 2,150–2,480 m, then 220 m up | A crystal geode where light holds things still: frozen waterfalls, hanging rubble, stilled Lanternwrights | **STILL-LIGHT.** Light freezes stone, water and iron, but never you. In the second half you carry the Lamp and aim it. | It moves only in shadow | The Stillwell falling around you | **The Raising** → the Socket (two endings) | 32–36 min |

**Totals:** 2,480 m of descent, then a 220 m ascent. About **160 minutes** (2 h 25 min to 2 h 55 min) for a median
first-time player on Normal, deaths included. A skilled Abyss *Full Descent* takes about 35–40 minutes.

**Why systems-driven is the right bet for a small WebXR team:**
1. **Content multiplies instead of adding up.** Four systems remixed across four chapters means each later minute of
   play costs less to author and still feels new. A set-piece is used once; a system keeps producing play.
2. **Replay comes from the rules.** Deterministic clocks plus mechanics with real skill ceilings (momentum theft,
   breath routing, crack economy, freeze timing) produce routes that players find for themselves. Speedrunners and
   creators are this genre's marketing.
3. **One through-line.** The Mason hunts by sound in every chapter. Every new rule changes the *price of sound* or adds
   a second currency, so the horror deepens as the toolset grows instead of being solved by it.

---

## 1. Rules for a systems chapter

1. **One new rule per chapter.** It changes the rope or what the rope touches. It is never an inventory item, a stat
   or an upgrade.
2. **The five-beat curriculum.** **TEACH** (safe, no creature, at most one hint), then **TEST** (lethal stakes,
   checkpoint, no creature), then **TWIST** (a new configuration of the rule, or the creature added), then **REMIX**
   (the rule combined with at least two earlier ones), then **EXAM** (the set-piece). Each chapter's section table below
   labels every section with its beat.
3. **Every rule has a price, paid in the Mason's currency.** Sound is the economy of the whole game (§2.2).
4. **Clocks, not dice.** Every moving thing runs on a deterministic section clock that resets to 0 on respawn. RNG is
   used only by the creature (seeded) and by cosmetic effects. The same room has the same timing on every retry, so it
   can be learned, speedrun and compared against a ghost.
5. **Readable under pressure.** Anchor states are shape-coded, never colour-only (§8.1). The next main-route anchor is
   always *knowable* from the previous hang point: visible, or in Chapter IV revealed by one crack. Motion has cues: a
   rail, an approach glint, a tick. Audio leads every threat by 1–2 s.
6. **The player keeps control.** No cutscenes, no camera moves, nothing ever rotates the view. Movers only translate
   the player, and only because the player chose to hold or stand on them. Both endings are actions the player
   performs.
7. **Fair failure.** On Normal, checkpoints are at most about 90 s of median play apart, and there is always one before
   an exam. Respawn to control takes 10 s or less. Movers, water levels and beats restore exactly.
8. **Two lines everywhere.** Every section has a safe line and a fast line. The fast line always uses the chapter's
   rule harder.
9. **Every rule returns.** Each rule reappears in at least two later chapters, or in the finale (§2.1).

---

## 2. The systems ladder

### 2.1 Remix matrix: how each rule comes back

| Rule (where introduced) | II The Winding | III The Tidehalls | IV The Lampless Reach | V The Stillwell |
|---|---|---|---|---|
| **Swing, chain, reel, yank** (I) | Chain from a moving ring to a static one to arrest a counterweight ride | Reel and yank are the fast lane underwater (about 5× swim speed) | The only way to move between revealed anchors | One rope plus a light: yank-climbing up frozen debris |
| **Fragile rings, crumbling ledges** (I) | Machinery shakes fragile rings: their life is ×0.6 while a hammer runs | Waterlogged ledges crumble only when the tide leaves them | Fragile rings you can't see: the creak is the only warning | Light-locked anchors are "fragile by shadow". In the Cradle, *you* break the root rings by yanking them. |
| **Live anchors** (II) | — | Diving bells ride the tide. Bellows rings sit on moving bells. Sluice gates act as lifts. | A pendulum in the dark: you time it by its tick and glimpse it by cracks | Light stops machinery: freeze a pendulum at the top of its arc to make a high anchor. Prism engines steer the beams. |
| **Breath line** (III) | — | — | Black pools: underwater you are silent (the Mason can't hear you) and unlit (the Sallows can't see you), but you can't crack and you are on the breath clock | Waterfalls are solid columns in the light and water in the shadow. The pools below catch your falls. |
| **Sounding** (IV) | — | — | — | Shadows between beams are dark volumes. Crack to find debris anchors there, but the Mason hears every crack. |
| **Still-light** (V) | — | — | — | Swept by prism engines in the first half, aimed from your own hand in the second |

### 2.2 The sense economy

The Mason is blind and hunts by sound, as it does today: landings, yanks, moving while it listens, stalling. Each
chapter changes the price of sound and adds a second currency.

| Currency | Who reads it | I | II | III | IV | V |
|---|---|---|---|---|---|---|
| **Sound** | The Mason | Landings, yanks, stalling | Machinery din masks you. Move on the hammer beat. | Underwater you are almost silent. Splashes are loud. | Every crack is heard. Sallow shrieks summon it. | A focused beam hums |
| **Light** | The Sallows, the Mason | Your lantern is a comfort | — | Sallow larvae drift to your lantern (harmless foreshadowing) | An open lantern wakes the Sallows | Light freezes the Mason |
| **Breath** | The water | — | — | The breath clock | Black pools | Waterfall pools |
| **Time** | The clocks | The stall model | Mover clocks | The tide | Afterimages fade | Beam sweeps |

---

## 3. Story spine

The story is told through the architecture and the Mason's Marks, with no voice-over.

- The Lanternwrights found a light at the bottom of the world that makes things *hold still*: stone, water, anything
  that wears stone. They set it in a **Socket** and raised a shaft of light **1.7 km** straight up from it, **the
  Plumb**, capped with a lens. The "Still Lamp" at the end of Chapter I is that lens. ("THE LAMP DOES NOT RISE TO MEET
  US. WE GO DOWN TO IT.")
- In the Plumb's light they stilled living stone into architecture. The masons who kept mending it slowly became part
  of what they mended ("THE WALL MENDED ITSELF"). **The Mason** is twenty masons and the living stone together: awake,
  blind, hunting by sound, in pain.
- At some point the Mason dragged the Lamp out of its Socket and down into the dark, smothering the light so it could
  never be stilled again. The Plumb dimmed and the Underspire woke.
- You go down because the light is failing. In Chapter V you find the Lamp choked in the Mason's roots, tear it free,
  and carry it **up** the Stillwell to the Socket.
- **Two endings**, both performed by the player and never watched:
  - **Lantern Raised.** You lift the Lamp into the Socket. Stillness pours up the Plumb and holds the Mason mid-lunge.
    It also holds you, hand raised, exactly like every Lanternwright statue you have passed since the Threshold.
  - **The Mended Wall** (secret, needs all 20 Mason's Marks). The Mason stops at the Socket's rim to listen to its own
    names, chiming from your gauntlet. You hold the Lamp out. It takes the light into its crown and stills itself into
    the wall, mended. You climb out alive.
- Chapter I already poses every statue "robed, lantern raised" (the existing `statue` decor). The ending makes that pose
  the player's own. In Pilgrim mode (NG+), the Threshold has one more statue.

---

## 4. Chapter by chapter

**Conventions.**
- Each chapter is its own `Level3D` in chapter-local coordinates, with its spawn near y = 0. A `depthOffset` makes the
  depth readout continue from the previous chapter.
- Section minutes are for a median first-time player on Normal, deaths included.
- **Beat** is the curriculum beat from §1, rule 2. **Int.** is intensity from 1 (calm) to 5 (peak).
- Themes use the existing tuple `theme(fog, light, accent, fogNear, fogFar, ambient)` from `level-data-3d.js`.
- The rule numbers are Normal values. Each rule's numbers for Nightmare and Abyss are in its own variants line, and
  §6.4 collects all of them in one table.

---

### CHAPTER I: THE UNDERSPIRE *(free demo: the existing 556 m, polished)*

*"Where the line is learned."* Depth 0 → 556 m. Theme: unchanged, `#252b30` → `#120f0e` fog, teal `#6fa3b5`, amber
`#e0a050`.

**Rules:** the baseline set: two tethers, swing pump, reel, yank, jump, fragile rings, crumbling ledges, hazards, and a
creature that listens and lunges. Chapter I gets no new rule. It gets **interaction** (touching Mason's Marks), the
replay layer (medals, ghosts, trials), and in the hook one **taste of rule II** (§5).

| § | Section | Beat | Role in the systems curriculum | Mason | Int. | Min |
|---|---|---|---|---|---|---|
| S1 | The Threshold | TEACH | Fire, hold, swing, release, lower | — | 1 | 2.5 |
| S2 | The Long Swing | TEACH | Momentum, two hands, yank | — | 2 | 3 |
| S3 | Broken Gallery | TEST | Recovery: a failed jump saved by a lower ring | — | 2 | 3 |
| S4 | The Listening Vault | WONDER | The sighting across 190 m of void. **The Plumb glows up through the Vault's floor cracks.** | Sighting | 1→3 | 3 |
| S5 | The Gullet Stair | TWIST | Lethal pressure: it hunts by sound | Stalk | 3 | 3 |
| S6 | The Two Descents | REMIX | Fragile rings plus crumbling ledges plus a choice of line | Hunt | 4 | 3.5 |
| S7 | The Hollow Nave | EXAM | Two-hand chaining over 130 m of nothing | Frenzy | 5 | 4 |
| S8 | The Last Throat | ESCAPE | Down. Now. | Escape | 5 | 2 |
| S9 | **The Eye of the Plumb** *(new hook)* | TASTE | The lens reveal, the cage drop and the first moving ring (§5) | Path (scripted) | 1→5 | 2.5 |

**Polish list (systems lens).**
1. **Onboarding check.** S1–S3 teach each verb once, with a single hint each. In playtests, at least 90% of first-time
   VR players should chain with two hands by S7. Sandbox builds log death causes and hint replays.
2. **Mason's Marks (4)** and the **touch** interaction: squeeze the grip with your hand on the mark (XR), or press E
   while looking at it (desktop).
3. **Medals, records, ghosts and section splits.** This is the demo's replay hook. A free, complete, speedrunnable
   chapter is the best wishlist driver the game can have.
4. **Trials (3).** *Untouched*: S7 without the perch or a recovery ring. *The Late*: the Throat in S6 without touching
   the crumbling ledge. *Unheard*: S5 without the Mason bursting.
5. **Foreshadowing.** The Plumb shows as a pale column glowing up through the Vault's floor cracks (S4). The "warm light
   from below" in S8 shifts toward the Plumb's white-gold, so the lens reveal pays off. Raise the lanterns on the S1
   statue pair: they mirror the ending.
6. **The hook (§5).** It ships the first slice of Chapter II's tech (movers, beats, creature paths), which the demo
   needs anyway.
7. **Quality bar.**
   - Steady 90 Hz on Quest 3, never below 72 Hz. No hitches at section boundaries.
   - Anchors readable at full aim range in every section's fog.
   - 10 s or less from death to control.
   - A full audio mix pass and a full haptics pass.
8. **Length tuning** to 24–28 min first time on Normal, mostly by checkpoint and hint pacing, not by adding geometry.

**Creature beats:** as today. Dormant (S1–S3), then the sighting (S4), stalk (S5), hunt (S6), frenzy (S7), escape and
grate slam (S8), then the cage roof (S9, scripted).

**Mason's Marks.**
- **I-1**, the pocket floor under the Threshold. It rewards exploring the safety net.
- **I-2**, on the lone save ring's chain in S3. You can only reach it by catching the save ring, which turns recovery
  into a reward.
- **I-3**, the far end of the Vault catwalk. It rewards lingering during the sighting.
- **I-4**, on the dividing wall halfway down the Throat in S6, only reachable from the risky east line.

---

### CHAPTER II: THE WINDING

*"The machine does not care that you are in it."* Depth 556 → 1,180 m (624 m). Theme:
`theme('#1b211d', '#d08a3c', '#6fbf9a', 6, 95, 0.26)`: green-black fog, sodium-brass light, verdigris phosphor.

**Environment.** This is the Lanternwrights' engine, a vertical clockwork 300 m across that wound the lifts, pumped the
deep dry and turned the lens. Brass and oil-black iron, verdigris copper, sodium work lamps. Great wheels behind great
wheels fade into the fog. The noise *is* the room.

**Mood:** awe, then rhythm, then the dread of being inside something enormous that is indifferent to you.

**NEW RULE: LIVE ANCHORS.** *"Some rings are bolted to moving machinery. The rope follows the ring, so its motion
becomes yours. Catch it as it comes toward you and it carries you. Let go as it moves away and you keep its speed."*

How it plays:
- **Momentum theft.** The rope constraint works on velocity *relative to the anchor* (§7, X4). A ring moving at
  10 m/s drags you to 10 m/s. Releasing keeps your absolute velocity, so a well-timed release is a launch.
- **The five mover kinds, in teaching order:**
  - Pendulum bobs: 20–36 m rods, 8–11 s period, at most 12 m/s.
  - The escapement rail: rings step 1.5 m per 1.2 s tick.
  - The great wheel: 60 m diameter, 40 s period, rim speed 4.7 m/s. It lifts you over obstacles.
  - Counterweights: an eased 80 m drop in 9 s, peaking at about 13 m/s.
  - The governor: rings orbiting a vertical shaft at 8 m radius with a 6 s period (about 8.4 m/s), released
    tangentially.
- **Readability.**
  - Every moving ring runs along a dashed phosphor **rail** that shows its path.
  - Its marker **glints** while it moves *toward your hand*.
  - Every mover *ticks* or *groans* on its phase.
  - Shape code: a ring with a short motion tail.
  - Soft-targeting gives moving rings +0.6 m of ray assist.
- **Noise floor (seeds Chapter IV).** Running machinery masks you. While the din is loud, the Mason cannot hear you,
  but it can see you with its fronds within 10 m.

| § | Section | Beat | What happens | Mason | Int. | Min |
|---|---|---|---|---|---|---|
| II-1 | The Pendulum Hall | TEACH | You arrive on the hook's pendulum. Three more swing in a row with offset phases, with rest ledges between them. Ride one to the next. | Below you, climbing. Heard only. | 2 | 3 |
| II-2 | The Escapement | TEACH | Rings tick along a toothed rail. Read the rhythm by ear. Ride the rail 40 m down tick by tick, or chain across. | Heard | 2 | 3 |
| II-3 | The Great Wheel | TEST | The rim rings carry you **up** and over a 50 m wall of machinery, the only climb before Chapter V. The Mason rides the opposite rim up out of the depths and passes 25 m away, its crown turning toward your sound, then is carried off. | Sighting (path, not lethal) | 3 | 4 |
| II-4 | The Counterweights | TEST | Express drops. Let go early and you keep its 13 m/s, which is lethal, so chain a static ring to arrest the fall (rule I remix). | Stalk | 3 | 3 |
| II-5 | The Mesh | TWIST (other danger) | Meshing gear trains sweep hazard teeth through the gaps between anchors, and crush pistons ride the lifts. Hang in the windows. | Stalk | 3 | 3 |
| II-6 | The Governor | TWIST | Ride the whirl and release on the tangent to cross 30 m | Hunt | 4 | 3.5 |
| II-7 | The Hammer Floor | REMIX (sound + fragile) | Trip-hammers strike every 4 s, and each strike masks you for 1.5 s. Move on the beat and hang still between beats. The strikes shake the fragile rings. | Hunt (deaf in the din, sees within 10 m) | 4 | 3.5 |
| II-8 | **THE STOPPING** | EXAM | Set-piece (below) | Frenzy | 5 | 5 |
| II-9 | The Mainspring | RECOVERY | The engine coasts to a halt. Silence. A snapped spring the size of a tower, plaques and lore. | Recovering, injured, retreats | 1 | 1.5 |
| II-10 | The Spillway Gate | ESCALATION | The runaway shattered the pumps and water bursts from every seam. Ride a dying lift down into the spray. | — | 2 | 2.5 |

**Exam: THE STOPPING (II-8).** A 140 m escapement hall whose main route is a chain of live anchors: pendulums, a wheel
segment and lifts.
1. **The jam.** After a 4 s grinding telegraph, the Mason forces its body into the great escapement. Every mover
   shrieks to a stop over 1.2 s, and the noise floor drops to zero.
2. **The frozen machine.** The stopped machine becomes a still climbing frame of spread-out static anchors. The Mason,
   wedged in the gears, *listens*. It stays trapped for 20 s, or **until you make three loud noises** (landings,
   yanks, breaks). Quiet play buys time, and that is the systems lesson of the chapter.
3. **The runaway.** It tears free and the machine restarts in a **runaway** at 1.6× speed (designed to be fair at 1.6×,
   and playable at 1×). The din is back, so it is deaf again, but it now hunts with frond sight. Ride the runaway lifts
   down the last 40 m.

*Fairness.* There is a checkpoint at the top of the hall and a second one at the start of the runaway, with the runaway
already running when you respawn there. Normal adds recovery rings under the two longest transfers.

**Creature beats.** For the first time the Mason is *below* you: it fell with the cage in the hook. You descend toward a
predator that is climbing up toward you. Then the wheel sighting, stalking through the counterweights, hunting in the
din, the jam and the runaway, and its injured retreat.

**Other danger.** The machine: hazard teeth, crush pistons, the runaway.

**Mason's Marks.**
- **II-1**, a 1 m ledge you can only reach by releasing at the third pendulum's maximum amplitude.
- **II-3**, inside the great wheel's hub. Ride the rim to three o'clock and drop onto the axle.
- **II-4**, on the underside of a counterweight. Touch it *while riding the drop*.
- **II-6**, on the governor's crown. Reel in to it mid-whirl.

**Trials.**
- *Clockwork*: II-1 to II-3 without standing on a static floor.
- *Freewheel*: release from the wheel over the wall and land beyond the walkway.
- *On the Beat*: cross the Hammer Floor unheard.

**Speedrun lines.**
- A wheel release at one o'clock overshoots onto a ledge 30 m lower and skips the first counterweight drop.
- A governor fling straight into the Mesh exit saves three transfers.
- A silent route across the frozen machine keeps the jam for its full 20 s.

**Variants.**
- *Nightmare*: governor period 5 s, fragile rings on the Hammer Floor, runaway 1.8×.
- *Abyss*: governor period 4.5 s, runaway 2.0×, no rest ledges on the wheel.

---

### CHAPTER III: THE TIDEHALLS

*"Hold your breath. Hold the line."* Depth 1,180 → 1,640 m. Above water: `theme('#101b20', '#7fd6d0', '#d8c9a8', 6, 80,
0.22)`. Underwater: fog `#06262b`, near 1 m, far 18 m.

**Environment.** These are the cisterns the Winding's pumps kept dry, now flooding because you watched those pumps
break. Pale limestone and flowstone, brass diving bells hung on chains, bellows air lines snaking down the walls, a
drowned street of Lanternwright lanternhouses, cyan algae phosphor. The water is clear and black.

**Mood:** hush, cold, held breath, melancholy.

**NEW RULE: THE BREATH LINE.** *"Water catches your fall and steals your breath. Underwater your rope is your engine,
and on a bellows ring it is your air."*

- **Deep water catches any fall.** Water at least 3 m deep removes impact death. This inverts the rule the player has
  lived by for 556 m and is the chapter's opening joy. Shallow water does not catch you, and stone **tide-posts** mark
  it.
- **Breath.** 20 s underwater on Normal. The gauge is diegetic: five glass beads on the left gauntlet. At half breath a
  heartbeat starts, and a muffled gasp warns near the end. When breath runs out the world darkens for 3 s, then you
  drown.
- **Underwater movement.**
  - Swimming is slow: 1.8 m/s along your head direction, pitch included.
  - Reel and yank work at full speed, so **the rope is the fast lane** at about 5× swim speed.
  - Aim range is 16 m in the murk. Underwater anchors glow cyan.
- **Bellows rings.** Brass rings on the old air lines. While you are tethered to one, breath refills at 4×: the rope
  carries air, and bubbles stream from your hand. With two hands, *one stays on air and the other makes progress*:
  two-hand chaining becomes breathing.
- **Air pockets** under bells and domes refill your breath, with their own close reverb.
- **Currents.** Sluice flows push at up to 6 m/s. Hold a tether to resist them, or let go to ride them. Current lanes
  show as silt streaks.
- **The tide.** In the Tide Hall the broken pumps make the water rise and fall 8–12 m on a 90 s clock, read from
  tide-marks and the pumps' moan.
- **Sound.** Underwater you are almost silent: sources ×0.25. Splashes are loud, scaled by entry speed.

| § | Section | Beat | What happens | Mason | Int. | Min |
|---|---|---|---|---|---|---|
| III-1 | The Spillway | TEACH | Hint: "Deep water will catch you." A 25 m leap into a lit pool, the first fall that doesn't kill. | — | 1 | 2 |
| III-2 | The Quiet Cisterns | TEACH | Swimming, breath, air pockets, reeling underwater, tide-posts | — | 2 | 3.5 |
| III-3 | Bellows Row | TEST | A 60 m underwater traverse chaining bellows rings, one hand always on air | — | 2 | 4 |
| III-4 | The Tide Hall | TWIST | Choose your tide. At low tide the route is ledges and rings in air, and the waterlogged ledges crumble as the water leaves them. At high tide the route is underwater. | Waterline, lethal. It can't follow you into deep water. | 3 | 4 |
| III-5 | The Sluices | TWIST | Ride a flume through a gate, or fight it on a tether. The Mason prowls the walls above, and any splash makes it burst toward you. | Waterline hunt | 3 | 3.5 |
| III-6 | The Drowned Lanternhouses | RECOVERY | A sunken street of homes, plaques and Marks. Sallow larvae drift to your lantern: harmless, but remember them. | — | 1 | 3 |
| III-7 | The Bells | REMIX (II) | Diving bells rise and sink on chains: moving air pockets, with bellows rings on moving bells | Waterline | 3 | 4 |
| III-8 | **THE SEA-WALL** | EXAM | Set-piece (below) | It causes it | 5 | 5 |
| III-9 | The Silt Stair | ESCALATION | The drained basin: silted ledges, and no water left. The Mason comes down after you, because the refuge is gone. | Hunt, then frenzy | 4 | 3.5 |
| III-10 | The Undertow | EXIT | Dive into the last pool and follow bellows rings down a flooded tunnel. You surface into total darkness, and your lantern gutters to an ember. | — | 2 | 2.5 |

**Exam: THE SEA-WALL (III-8).** A cistern 160 m across and 120 m deep, held back by a curved sea-wall. You cross
underwater from bell to bell.
1. **The knocking.** The Mason cannot reach you, so it climbs the sea-wall's outer face. You hear the knocks through the
   water and feel them in the bellows rope.
2. **The breach.** After a 6 s telegraph of cracks and bubbles, it breaks the wall. The water drains toward the breach:
   a current builds to 9 m/s toward a lethal drain grate, and the surface drops 60 m in 60 s.
3. **The crossing.** You hold on and transfer from anchor to anchor *against* the current toward the far gallery.
4. **The fall of the water.** The falling surface passes you, and suddenly you hang in open air above a newly revealed
   60 m drop. The rings that held you against the current now hold you against gravity.

**The Mason is not the danger here. The water is.**

*Fairness.* There is a checkpoint at the cistern's mouth, and the route is designed for 40 s of the 60. On Normal a
catch ring hangs at the drain lip.

**Creature beats.** Introduced as a waterline hunter: it never enters water deeper than 1.5 m, prowls the rims, and
bursts toward splashes. In III-8 it reshapes the environment to reach you, and in III-9 the hunt resumes on dry silt.

**Other danger.** Drowning, currents and the tide. Underwater, the stall model is replaced by the breath clock.

**Mason's Marks.**
- **III-2**, on the floor of the deepest cistern, 28 m down, with no air. One breath takes about 80% of Normal's
  breath on the efficient reel line.
- **III-4**, in a lanternhouse attic that you can only reach at high tide.
- **III-5**, behind a sluice gate. Ride the current through when the gate opens.
- **III-7**, inside a sinking bell. Ride it to the bottom and get out before its air runs out.

**Trials.**
- *One Breath*: Bellows Row without a bellows ring.
- *Dry Feet*: the Tide Hall without entering water.
- *Against the Drain*: the Sea-Wall without the catch ring.

**Speedrun lines.**
- A 40 m high dive at the Spillway skips the ledges.
- Current-surfing through two gates in III-5.
- In the Sea-Wall, ride the current *toward* the drain and cut across on the last ring.

**Variants.**
- *Nightmare*: 15 s of breath, fewer air pockets, refill 3×.
- *Abyss*: 12 s of breath, one fewer bellows ring on Bellows Row, no catch ring, refill 2.5×.

---

### CHAPTER IV: THE LAMPLESS REACH

*"BELOW THIS MARK NO LAMPS."* Depth 1,640 → 2,150 m. Theme: `theme('#040405', '#8f86b8', '#c8d8b0', 2, 28, 0.02)`.
The echo is violet-white, the Sallows are bone-green, and your lantern is the only amber.

**Environment.** Older than the Underspire: a natural rift of black basalt columns and wax-pale fungus, crossed by
Lanternwright rope-bridges and **listening posts**, colossal carved stone ear-horns the builders used to track the
Mason in the dark. No phosphor paint was ever applied here: the anchors are bare iron.

**Mood:** blind, intimate, paranoid. The most frightening chapter, played by ear.

**NEW RULE: SOUNDING.** *"In the dark, your rope is your eyes. Fire at nothing and it cracks, and the echo shows you the
room for a few seconds. Everything that hears the crack knows where it came from."*

- **Darkness.** Dark volumes have no ambient light and unlit anchors. **Only known anchors can be targeted.**
- **The crack.**
  - A tether fired at no target cracks at the end of its whip: the miss ray's hit point, at most 0.85 × aim range.
  - **How hard you flick the controller sets the loudness**, from 0.4 to 1.0. That is a VR-native gesture. On desktop
    the loudness is fixed at 0.7.
  - The echo sweeps out from the crack point at 60 m/s, out to a radius of 12–30 m depending on loudness. It lights the
    surfaces it passes and leaves **afterimages** of every anchor in its line of sight for 6 s.
- **The trade-off.** You see where you aim, and you are heard where you aim. A crack far away is both a probe and a
  **decoy**. Probing your own path draws the Mason onto it.
- **Chalk.** Every anchor you have attached to keeps a faint chalk mark for the rest of the chapter, so the trail you
  leave behind is readable.
- **Lantern shutter** (X on Quest, L on desktop). Open, it lights a 9 m warm radius in which everything is known, and it
  wakes the Sallows.
- **Rope telegraph.** When the Mason climbs the structure your anchor is bolted to, you **feel it in your hand**: a
  haptic pulse and a creak carried up the rope, stronger as it gets closer.
- **The Sallows.** The second species:
  - Pale, eyeless gliders that roost in clusters.
  - Any light within 12 m wakes them, and they glide at 4–7 m/s toward the brightest light they can see.
  - If they touch you while your lantern is open, they **smother** it (out for 8 s) and **shriek**: a loudness-1.0
    sound at your position, which makes the Mason burst toward you.
  - They also mob the Mason's crown when it glows to listen, blinding it for 4 s. **You can use one predator against
    the other.**

| § | Section | Beat | What happens | Mason | Int. | Min |
|---|---|---|---|---|---|---|
| IV-1 | The Last Lamp | TEACH | Surface into black with your lantern guttering. Learn to crack in a sealed, safe chamber, where anchors bloom as afterimages. | — | 2 | 2.5 |
| IV-2 | The Listening Posts | TEACH | Step into a giant ear-horn and hear the Mason's distant position, amplified. Cross echo-mapped bridges. | Distant | 2 | 3.5 |
| IV-3 | The Chalk Line | TEST | A branching rope-maze over the rift. Chalk shows where you've been, and dead ends mean backtracking. | Stalk (heard) | 3 | 3.5 |
| IV-4 | The Roost | TWIST | A gallery hung with sleeping Sallows. Lantern shut, cracks only. One lit moment wakes a cluster. | Stalk | 3 | 3.5 |
| IV-5 | Two Hunters | REMIX | The Mason hunts by sound and the Sallows by light. Use decoy cracks, and wake a roost onto the Mason to blind it. | Hunt | 4 | 4.5 |
| IV-6 | The Pendulum in the Dark | REMIX (II) | An unlit pendulum crosses a gap. Time it by its tick, glimpse it with cracks. | Hunt | 4 | 3 |
| IV-7 | Black Water | REMIX (III) | Dark pools: underwater you are silent and unlit, but you can't crack and the breath clock runs | Hunt | 3 | 3 |
| IV-8 | **THE CHOIR OF HORNS** | EXAM | Set-piece (below) | Frenzy | 5 | 6 |
| IV-9 | The Bloom | ESCALATION | The Mason smashes the great roost and the rift fills with Sallows. Shutter your lantern and drop blind through them, guided by chalk and cracks. | Escape | 5 | 3 |
| IV-10 | First Light | RELIEF | A white glow below: the Stillwell. The dark ends. | — | 1 | 1.5 |

**Exam: THE CHOIR OF HORNS (IV-8).** A 150 m void, ringed by eight colossal listening horns connected through the stone.
- **The Mason is inside the horn network.** Its sounds come out of every horn mouth at once: eight spatialised sources,
  and true disorientation.
- **The horns carry your cracks too.** A crack fired into one horn's mouth comes out of another across the hall, which
  makes a decoy at range. A crack in the open is heard where you are.
- **The route** is 12 transfers through total darkness, with an unlit pendulum in the middle (rule II).
- **It emerges** from whichever horn is nearest the last loud sound. The rope telegraph tells you which horn it is
  climbing toward, because the horns are what your anchors hang from.

*Fairness.*
- Each horn has a unique pitch and silhouette.
- Checkpoints at the entry and at the middle pendulum (Normal).
- Within 10 m it always telegraphs its lunge with the existing 1.5 s wind-up.

**Creature beats.** A blind hunter in total darkness. You hear it, you feel it through the rope, you can decoy it, and
the Sallows harass it. Its peak is the Choir.

**Other danger.** The Sallows, and the dark itself.

**Mason's Marks.**
- **IV-2**, in the throat of a listening horn. Crawl in and hear your own heartbeat amplified.
- **IV-4**, in the middle of the roost, only visible by lantern light.
- **IV-6**, on the pendulum's bob. Touch it as it passes, timed by ear.
- **IV-7**, at the bottom of a black pool where cracks don't reach. Find it by lantern underwater.

**Trials.**
- *Blindfold*: IV-5 to IV-8 without ever opening the lantern.
- *Ten Words*: the Choir with 10 cracks or fewer.
- *Shepherd*: blind the Mason with Sallows twice in one run.

**Speedrun lines.** A memorised route needs fewer cracks: one loud, well-aimed crack per stretch. Horn decoys buy free
passage.

**Variants.**
- *Nightmare*: afterimages last 4.5 s, echo radius 10–26 m, more roosts.
- *Abyss*: afterimages last 3 s, echo radius 9–22 m, chalk fades after 20 s, and Sallow contact kills.

---

### CHAPTER V: THE STILLWELL

*"Hold still."* Depth 2,150 → 2,480 m, then 220 m up to the Socket. Theme: `theme('#0c0b14', '#fff1cf', '#9fb7ff', 10,
140, 0.3)`: indigo shadow, white-gold beams, a frozen-blue tint on stilled things.

**Environment.** The Lamp's own chamber, a geode cavern of white crystal. Everything the beams touch has been held still
for centuries: waterfalls stopped mid-fall like glass, rubble hanging in the air, Lanternwrights frozen mid-stride. The
statues of Chapter I were never carved. **Prism engines** (Winding craft) turn the remaining light in slow sweeps. At
the bottom is the Cradle, overgrown with the Mason's black masonry roots. At the top of the throat is the Socket, where
the Plumb begins.

**Mood:** sacred awe, then a desperate climb.

**NEW RULE: STILL-LIGHT.** *"The Lamp's light stills stone, water and iron, but never you. In the light, falling things
hang and the Mason stops. In the shadow, everything falls, and it moves."*

- **Beams.** Cones swept by prism engines on 20–40 s clocks, like lighthouse sweeps, readable in the fog.
- **What the light does.**
  - Movers stop, ramping down over 0.2 s.
  - Falling debris hangs in the air.
  - Waterfalls become **solid columns** you can stand and swing on.
  - The Mason **freezes** once its crown has been lit for 0.3 s, and a lunge freezes in mid-air. That is the near miss
    the whole game has been building toward.
- **Light-locked anchors.** Rings on hanging debris hold only while lit. When the beam leaves, the ring's halo drains
  for 0.8 s and then the debris falls, and you fall with it unless you have already moved on.
- **Shadows are dark volumes** (rule IV). Crack to find debris anchors there.
- **Carrying the Lamp** (second half).
  - It sits in your left hand, and its beam (25°, 30 m) points wherever you point. You freeze whatever you aim at.
  - Left trigger **focuses** the beam to 10° and 45 m, but it hums, and the Mason hears it.
  - While you carry it, **your left tether is gone**: one rope and a light.
  - Squeeze the left grip to **holster** it. You get both ropes back, and the Lamp hangs at your hip shining straight
    down (35°, 20 m).

| § | Section | Beat | What happens | Mason | Int. | Min |
|---|---|---|---|---|---|---|
| V-1 | The White Threshold | TEACH | Everything is lit and still. Walk on frozen waterfalls, swing from hanging rubble, pass the stilled Lanternwrights. | — | 1 | 2.5 |
| V-2 | The Sweep | TEACH→TEST | The first sweeping beam. Hop between light-locked anchors as the light passes. | — | 2 | 3.5 |
| V-3 | The Cascades | TWIST (III) | Waterfalls are columns in the light and water in the shadow. Deep pools catch you. | — | 3 | 4 |
| V-4 | Red Light | TWIST (creature) | It freezes in the beams and is fast in the shadows. Keep a beam between you, and crack for anchors in the dark (rule IV). | Hunt | 4 | 4.5 |
| V-5 | The Prism Engine | REMIX (II) | Rotating prism wheels steer three beams. Pendulums freeze at the top of their arcs and become high anchors. | Hunt | 4 | 4 |
| V-6 | The Cradle | REVEAL | The Lamp lies smothered in roots. **Yank** the root rings out one by one: fragile anchors that *you* break. The Lamp blazes free; catch it. | Coming | 2→4 | 3.5 |
| V-7 | **THE RAISING I** | EXAM | Set-piece (below) | Frenzy | 5 | 5 |
| V-8 | **THE RAISING II** | EXAM | Set-piece (below) | Escape | 5 | 5 |
| V-9 | The Socket | ENDING | A ring of statues with raised lanterns, and the two endings | Final climb | 2 | 2 |

**Exam: THE RAISING (V-7, V-8).** The light that held the Stillwell for centuries is now in your hand. The prism engines
go dark, and everything that hung begins to fall: rubble, waterfalls, stilled statues. You climb 220 m up the
Stillwell's throat to the Socket.
- **Climbing.** Your single rope reaches for wall anchors and for debris you freeze with the Lamp: freeze a falling
  slab overhead, attach, yank, freeze the next one.
- **The pursuit.** The Mason climbs after you through the shadow under your feet. Turn the beam down to freeze it, but
  while you look down, the debris above you falls. Holster for a fast two-rope stretch when it is far below.
- **Part I** (110 m): the Stillwell falling, the Mason far below. It ends at a checkpoint on a stilled ledge.
- **Part II** (110 m): the Mason overtakes along the walls and lunges from the side. Freezing it gets harder each time:
  its exposure-to-freeze rises from 0.3 s to 0.6 s on Normal. The last 20 m lead to the Socket's ledge.

**The Socket (V-9): the endings.** The Mason comes over the rim.
- **Lantern Raised.** Lift your left hand above your head inside the Socket's ring for 1.5 s.
- **The Mended Wall.** With all 20 Marks, its names chime from your gauntlet and it stops to listen. Hold the Lamp out
  to its crown for 3 s.
- **Doing nothing** gets you killed. There is no soft-lock: you retry from the Socket checkpoint.

**Creature beats.** It moves only in shadow, desperately, all the way to the last lunge.

**Other danger.** The Stillwell falling apart around you.

**Mason's Marks.**
- **V-1**, on a stilled Lanternwright's lantern ("whose hand this was").
- **V-3**, behind a waterfall. Swim through while it is in shadow.
- **V-5**, on a pendulum, reachable only while a beam holds it at the top of its arc.
- **V-6**, under the last root. Yank the roots in the right order.

**Trials.**
- *One Hand*: the Raising without holstering.
- *Unfallen*: V-2 to V-5 without ever riding a light-locked anchor down.
- *Steady*: the Raising with three freezes of the Mason or fewer.

**Speedrun lines.**
- Freeze a pendulum at its apex to skip the lower half of V-5.
- A freeze-and-yank ladder straight up the debris column in the Raising.
- A two-rope holstered line up the throat wall for the first 60 m.

**Variants.**
- *Nightmare*: 0.6 s warning, 0.45 s exposure-to-freeze, fewer static anchors in the throat.
- *Abyss*: 0.4 s warning, 0.6 s exposure-to-freeze.

---

## 5. The demo hook: THE EYE OF THE PLUMB (end of Chapter I)

The free demo has to end on something nobody wants to stop at, and **it has to sell the system, not just the story.**
The hook is one unbroken in-engine sequence of about 2–3 minutes, and the player never loses control.

1. **The slam (existing).** You sprint through the grate and it slams. The Mason's fronds reach through the bars, then
   withdraw, and you hear it climbing *away*. Relief.
2. **The Lamp is a lens.** The "Still Lamp" is a glass eye set in an iron cradle over a round hole in the floor. Its
   light is coming **up** through it. Lean over (VR: physically) and look down the **Plumb**, a shaft of pale-gold
   light 1.7 km deep. Through its walls you glimpse the next four strata: turning brass wheels, a blue-black waterline,
   a band of total black, and white at the very bottom. The light flickers, *as if something below is choking it*. A
   new plaque reads: *"WE NEVER HELD THE LAMP. WE HELD ITS LIGHT."*
3. **Your weight.** The chamber floor is a **counterweight cage**, the Lanternwrights' lift down to the works. Step onto
   the lens platform, or wait 45 s, and a pawl releases with a clank. The cage begins to lower down the side of the
   Plumb at 2 m/s. It is a moving floor (X5), and you can walk around on it.
4. **The roof.** The Mason drops onto the cage roof down the lift chains (a scripted path). Its fronds reach through the
   roof grille. The grille holds: this phase is not lethal. But it is working the chain, and each time the chain gives,
   the cage drops half a metre with a telegraphed clank.
5. **The first moving ring.** Through the cage's open side lies the Winding. A pendulum bob 40 m long swings past every
   8 s, with a ring on it. Hint, first time only: *"A moving ring carries you. Fire as it comes. Let go as it goes."*
   You fire, and it **rips you out of the cage**. That is momentum theft, the moment that sells rule II.
6. **The fall.** Three seconds later the chain parts. The cage falls into the Winding *with the Mason on it*, crashing
   through machinery far below: spatialised audio, sparks in the fog. **For the first time the predator is below you.**
7. **The swing.** You ride the pendulum over the Winding: wheels behind wheels, sodium lamps, brass.
8. **The end card** (demo build). It appears at the top of the next arc as a carved in-world panel, a pause state rather
   than a camera move. It shows your time, deaths and Marks, then: *"THE DESCENT CONTINUES. 1,900 m below, the light
   is failing."* Five carved tiles name the five rules, one line each. The buttons are **[Continue the descent:
   $9.99]**, [Replay Chapter I: Normal / Nightmare / Abyss] and [Menu].
9. **After purchase: seamless.** The panel lifts and you are still on the pendulum, mid-swing, in Chapter II's first
   room. There is no loading screen and no restart. Full-game owners see only a drifting title card: *"II: THE
   WINDING"*.

*Failure handling.* The Mason's chain-work is the timer: three lurches, about 24 s, which gives you three pendulum
passes. If you are still inside when the cage falls, you die (cause: fall) and retry from the cage checkpoint within
10 s. On Normal the pendulum ring has +0.6 m of assist. In Sandbox the chain never parts.

*Seam engineering.* The hook's geometry (the cage shaft and the first pendulum) lives in one shared module that both
Chapter I and Chapter II load (X15). The demo boundary is the moment you attach to the pendulum. After purchase the game
swaps the chapter under you while you are still swinging, so the player's state carries straight across.

**Why it sells.**
- It reframes the destination: the lamp was only its light.
- It shows four new environments in a single look down.
- It hands the player **one real use** of the next rule at full intensity.
- It puts the predator below you, which reverses Chapter I.
- It ends mid-swing. Nobody puts the controllers down mid-swing.

**What the free demo contains.**
- All of Chapter I on Normal, Nightmare, Abyss and Sandbox.
- 4 Marks, 3 trials, the 9 Chapter I medals, ghosts and splits, and the hook.
- A complete, replayable product. That matters for store reviews and for speedrunners spreading the word.

---

## 6. Progression and replay

### 6.1 Structure
- **Continue** resumes at the last checkpoint. **Chapter select** unlocks as you go, and difficulty is chosen per
  chapter. Saves live in IndexedDB with `navigator.storage.persist()`; settings stay in localStorage.
- **Seams.** Chapters join without loading screens (§5, X15).

### 6.2 Per-chapter medals (the core replay loop)
Each chapter has three medals per difficulty: **Iron** (finish), **Brass** (par time) and **Still** (expert time). That
is 45 in total.
- **Brass** = 0.5 × the median first-time time from playtests.
- **Still** = the best developer ghost × 1.10.
- Targets are set from ghost data during beta, not guessed now. As an order of magnitude, Chapter I Normal is about
  12 min for Brass and about 5 min for Still.
- Medals are shown as carved plaques on the chapter-select **Plumb Line**: a diegetic vertical diorama of the five
  strata that you point at in VR.

### 6.3 Collectibles and trials
- **Mason's Marks (20, four per chapter).** Each is a carved mason's sigil with a name and one line, for example
  *"ODELL, FOURTH COURSE: The mortar is warm."* or *"BRISK TEMPERANCE, NINTH COURSE: It hums back when I sing."*
  - **Every Mark sits behind a mastery use of that chapter's rule**, so collecting them is a skill exam and never a
    scavenger hunt.
  - They fill the **Codex**, the lore of the twenty masons.
  - All 20 unlock **The Mended Wall** ending.
- **Trials (15, three per chapter).** Each is a constraint run that turns the rule inside out (*One Breath*, *Ten
  Words*, *One Hand*…).
  - Rewards are cosmetic: rope tints and lantern cages.
  - Trials also unlock the chapter's **Sandbox toys** (§6.5).

### 6.4 Difficulty per mechanic

| Parameter | Normal | Nightmare | Abyss |
|---|---|---|---|
| Moving-anchor ray assist bonus (II) | +0.6 m | +0.4 m | +0.2 m |
| Governor period / runaway speed (II) | 6 s / 1.6× | 5 s / 1.8× | 4.5 s / 2.0× |
| Breath / bellows refill rate (III) | 20 s / 4× | 15 s / 3× | 12 s / 2.5× |
| Underwater aim range (III) | 16 m | 14 m | 12 m |
| Echo afterimage / echo radius (IV) | 6 s / 12–30 m | 4.5 s / 10–26 m | 3 s / 9–22 m |
| Sallow contact (IV) | Snuff + shriek | Snuff + shriek | Lethal |
| Light-lock warning / Mason exposure-to-freeze (V) | 0.8 s / 0.3 s | 0.6 s / 0.45 s | 0.4 s / 0.6 s |
| Checkpoints (existing rule) | Every section | Alternate sections | Chapter start only |

### 6.5 Modes
- **Ghosts.** The best run per chapter per difficulty replays as a faint phosphor figure with its ropes, so you can
  race yourself.
- **Section splits** on the wrist HUD, with a comparison against your ghost.
- **Full Descent.** Unlocked after Chapter V: all five chapters as one continuous run with one timer and chapter splits.
  Categories are Normal, Nightmare and Abyss, each as *any%* or *Marks%*. This is the headline speedrun category.
- **Pilgrim** (NG+, after either ending).
  - No hints, chalk off, and the Mason one difficulty step more aggressive.
  - Each chapter gets one remix toggle. In II the machine runs at 1.2× from the start. In III the tide clock halves. In
    IV the lantern starts broken. In V the prism engines sweep in reverse.
  - Your statue stands at the Threshold.
- **Sandbox per chapter with system toys.**
  - II: a mover clock you can pause and scrub.
  - III: a tide slider.
  - IV: an "echo always" toggle.
  - V: beams on or off.
  - Debug overlays for volumes, mover paths and noise rings, which double as content-creator tools.
- **Stats page.** Deaths by cause per chapter (fall, impact, creature, crush, drown, sallow) and Marks found. It also
  feeds balancing.
- **Kept out of scope:** combat, inventory, crafting, upgrades, RPG stats, online leaderboards (they need a backend; see
  §12).

---

## 7. Engine extensions (precise)

**Ground rules carried over from CONTRACT3D.**
- `src/sim/**` and `src/data/**` stay DOM-free and three.js-free, with no per-frame allocation in hot loops.
- Physics stays fixed-step at 240 Hz and deterministic, so the level agent's waypoint bot can verify every route.
- The Quest budget stays at most 150 draw calls and 350k triangles.
- This pitch edits no code. These are **specifications to schedule after the current polish pass**, owned by the agents
  who own those files.

**Deliberately not built.**
- **Rotating colliders.** Collision stays sphere-vs-AABB. Wheels, gears and prisms rotate *visually*, and only their
  hubs and their anchors exist in the sim.
- Rope wrapping around geometry.
- Fluid simulation: water is volumes with scripted surfaces.
- Physics debris piles.
- Camera control or cutscenes.
- Combat.
- Any story that depends on voice-over.

### 7.1 Summary

| ID | Extension | Files | Size | First needed |
|---|---|---|---|---|
| X1 | Section clocks and determinism | `game.js`, new `src/sim/clock3d.js` | S | I (hook) |
| X2 | Kinematic movers: pendulum, orbit, lift, path, escapement, ballistic | new `src/sim/movers3d.js` | M | I (hook) |
| X3 | Level3D dynamic sets: unbucketed dynamic solids, anchors and hazards in every query | `level3d.js` | S | I (hook) |
| X4 | Rope on moving anchors: relative-velocity constraint, reel and tension | `physics3d.js` (Rope3D, TetherSystem) | S | I (hook) |
| X5 | Moving contacts: carry, relative impacts, momentum inheritance, crush | `physics3d.js` (Physics3D) | M | I (hook) |
| X6 | Volumes: water, current, air, dark, quiet, still; animated surfaces | new `src/sim/volumes3d.js` | M | III |
| X7 | Medium and breath: swim, buoyancy, splash catch, drowning, bellows anchors | `physics3d.js`, `config3d.js` | M | III |
| X8 | Noise system and the creature's INVESTIGATE state | new `src/sim/noise3d.js`, `creature3d.js` | M | II |
| X9 | Echo and knowledge: cracks, afterimages, chalk, knowledge-gated targeting | new `src/sim/echo3d.js`, TetherSystem | M | IV |
| X10 | Lantern shutter and light registry | `physics3d.js` (player), `renderer3d.js` | S | IV |
| X11 | Sallow swarm agents | new `src/sim/sallows3d.js` | M | IV |
| X12 | Creature v2: path, waterline, mover riding, stillness, blinding | `creature3d.js` (after a module split) | L | I (hook) → V |
| X13 | Still field: swept beams, carried beam, freeze effects, light-locked anchors, the Lamp | new `src/sim/still3d.js`, TetherSystem | M | V |
| X14 | Beats v2: conditions, actions, checkpoint snapshots | new `src/sim/beats3d.js` (replaces the trigger loop in `game.js`) | M | I (hook) |
| X15 | Chapter framework: registry, dynamic import, seams, transitions inside XR, saves | new `src/data/chapters/`, `game.js`, `Storage` | M | I (demo) |
| X16 | Entitlement and the demo gate | `src/platform/entitlement.js` (adopt `docs/abyssal-tether-3d/pwa/entitlement.draft.js`) | S | I (demo) |
| X17 | Interactables: Marks, the Lamp, the Socket, roots | new `src/sim/interact3d.js` | S | I (demo) |
| X18 | Records, medals, ghosts, splits | new `src/meta/records.js` (IndexedDB) | S–M | I (demo) |
| X19 | Input extensions: flick, interact, lantern, swim pitch, beam, raise | `inputManager.js`, `xrInput.js`, `desktopInput.js` | S | I → V |
| X20 | Renderer extensions | `src/render/*` | L | I → V |
| X21 | Audio extensions | `audio3d.js` | L | I → V |
| X22 | Verification harness v2 and authoring tools | `tools/abyssal-tether-3d/` | M | I → V |

*S is under a week, M is 1–2 weeks, L is 3 weeks or more of focused engineering.*

### X1. Section clocks and determinism
- `clock.t` is advanced by `CONFIG.PHYSICS_DT` inside the fixed-step loop and is never driven by frame time. Every mover,
  surface, beam sweep and schedule is a **closed-form function of `t`**.
- **Respawn resets the section clock to 0.** Sections are authored so that t = 0 is a good phase, with the first ride
  arriving 2–3 s after control returns.
- A sleeping mover (more than one section away) costs nothing and is still correct when it wakes, because its pose is
  computed, not integrated.
- Movers have local time scales (`timeScale`, ramped) for the jam, the runaway and still-light: `t_m += dt ×
  timeScale`.

### X2. Kinematic movers (`movers3d.js`)
Data, inside a chapter module:
```js
movers: [
  { id: 'p1', kind: 'pendulum', pivot: { x, y, z }, axis: { x: 0, y: 0, z: 1 }, length: 30, amp: 0.6, period: 9, phase: 0,
    carry: { anchors: ['p1-ring'], solids: ['p1-bob'], hazards: [] }, noise: 0.5, sound: 'pendulum', section: 's1' },
  { id: 'w1', kind: 'orbit', center, axis, radius: 30, period: 40, phase, carry: { anchors: ['w1-r1', 'w1-r2', /* … */] } },
  { id: 'cw', kind: 'lift', from, to, travel: 9, dwell: [3, 4], ease: 'sine', carry: { solids: ['cw-deck'], anchors: ['cw-ring'] } },
  { id: 'esc', kind: 'escapement', path: [p0, p1, /* … */], step: 1.5, tick: 1.2, move: 0.25 },
  { id: 'rail', kind: 'path', path: [/* … */], speed: 4, loop: 'pingpong' },
  { id: 'deb7', kind: 'ballistic', start, gravityScale: 1, floorY, startOn: 'beat:raise-1' },   // falling debris (V)
]
```
- **Children** are existing solids, anchors and hazards, referenced by id. They keep their authored offset from the
  mover point and only **translate**: boxes never rotate.
- **Per step:** `pose(t)` sets `x, y, z` and `vx, vy, vz` (velocity from the analytic derivative) for each mover, and
  writes them onto its children. Children also store their per-step displacement `dx, dy, dz`, for carrying.
- **Outputs:** pose for the renderer (InstancedMesh matrices, plus a render-only rotation angle for wheels and gears),
  `noise` for X8, and phase events (`mover:tick`, `mover:apex`) for audio.
- **Limits:** at most 40 active movers per chapter window, and anchor speed at most 13 m/s (verified by X22).

### X3. Level3D dynamic sets
Today's `YIndex` buckets are static. Mover children are flagged `dynamic: true` at build time, excluded from the
buckets, and kept in `level.dynSolids`, `level.dynAnchors` and `level.dynHazards`. At most 64 items are active per
window.
- **Queries.** `querySolids`, `queryHazards` and `anchorsNear` run the static buckets as now, then append dynamic items
  that pass a cheap box or radius test.
- **Line-of-sight.** `segmentBlocked` and `raycast` also test active dynamic solids. Targeting and laser visuals
  therefore respect moving machinery.
- **Section windows.** Only movers within ±1 section of the player are stepped and queried.

### X4. Rope on moving anchors (`Rope3D` and `TetherSystem` in `physics3d.js`)
- **`constrain(p)`:** use the radial velocity *relative to the anchor*, `vr = (v − vA) · n`, and remove only the
  outward part. Today it is `vr = v · n`. The position projection already uses the anchor's current position, which
  movers update before the player integrates (see X5 for the order).
- **`reel(...)`:** the tangential-gain rule (conserving `v_t · L`) uses the relative tangential velocity.
- **Tension:** the estimate uses the relative speed.
- **Release** keeps absolute velocity. Momentum theft falls out of this with no special code.
- **Catch damper:** the first taut moment on an anchor faster than 6 m/s spreads the radial correction over 60 ms. That
  keeps a 13 m/s catch firm but not a spike, with no haptic or audio blow-out.
- **`findTarget`:** dynamic anchors get the per-difficulty assist bonus. The existing stickiness keeps the highlight on
  a moving ring. Attachment is instant, so no aim lead is needed.
- **`step`:** per-anchor hooks for `air` (X7), `requiresLight` (X13) and `root` (X17).

### X5. Moving contacts (`Physics3D`)
- **Step order:** `movers.step(dt)`, then forces and integration, then rope constraints (against the new anchor
  positions), then collisions.
- **Carry:** if `player.groundSolid.dynamic`, add the solid's displacement for this step to the player before
  integration.
- **Relative impacts:** for dynamic solids, the normal velocity in `resolveCollisions` is `(v − vSolid) · n`. Landing on
  a descending lift is safe, and being hit by a fast piston is not.
- **Momentum inheritance:** leaving a dynamic solid (jump, walk-off, release) adds its velocity once.
- **Crush:** if penetration greater than 0.12 m remains after the 3 collision iterations and at least one dynamic solid
  is involved, call `kill('crush')`. The design rule is that crush zones are telegraphed and leave 1.2 m of clearance
  except where the crush is intended.

### X6. Volumes (`volumes3d.js`)
Data:
```js
volumes: [
  { id: 'w1', kind: 'water', box, surface: { kind: 'tide', base: -40, amp: 5, period: 90, phase: 0 } },   // or 'static' | 'scripted'
  { id: 'c1', kind: 'current', box, force: { x: 0, y: 0, z: -6 }, schedule: { on: 20, off: 10 } },
  { id: 'a1', kind: 'air', box },                     // air pocket (also implied above any water surface)
  { id: 'd1', kind: 'dark', box },                    // IV: knowledge-gated targeting, no ambient
  { id: 'q1', kind: 'quiet', box, mask: 0.6 },        // noise masking (machinery halls, horns)
  { id: 's1', kind: 'still', cone: { apex, dir, angle, length }, sweep: { axis, arc, period, phase }, mover: 'prism2' },
]
```
- `volumes.sample(x, y, z, out)` runs once per physics step for the player's body and head points and fills
  `{ waterDepth, surfaceY, current, air, dark, quiet, still }`.
- Each section has at most 24 volumes, all AABB tests, except still cones, which use a point-in-cone test plus a
  budgeted line-of-sight check.
- A scripted surface moves toward a target set by a beat (`surface(id, targetY, rate)`), which is how the Sea-Wall
  drains.

### X7. Medium and breath (`Physics3D`, `config3d.js`)
**Water physics:**
- Gravity ×0.08 (a slight sink).
- Velocity relaxes toward the local current at 2.4 s⁻¹.
- Swim acceleration of 6 m/s² along `intent.move`, now 3D, up to 1.8 m/s.
- Jumping within 0.4 m of the surface gives a 5.6 m/s exit, with a mantle assist onto a ledge up to 1.2 m above the
  surface.

**Surface entry:**
- Crossing the surface downward resets `fallPeak` and multiplies velocity by 0.35.
- It emits a splash noise of loudness `min(1, speed / 20)`.
- While the water depth at the contact is at least 3 m, impacts can't kill.

**Breath:**
- `player.breath` drains while the head point is in water, outside an air pocket and not tethered to an `air: true`
  anchor.
- It refills at the difficulty's rate otherwise.
- New deaths: `kill('drown')`, plus `'crush'` and `'sallow'` from X5 and X11.

**Rope:**
- Underwater aim range is `diff.aimRange × 0.5`.
- Reel and yank are unchanged, so the rope stays the fast lane.

### X8. Noise system (`noise3d.js`) and creature hearing
- **Emitting:** `noise.emit(x, y, z, loud, kind)`.
  - Sources: landings (scaled by impact), yanks, cracks, splashes, crumbles, breaks, shrieks, mover strikes, and the
    focused beam's hum.
  - Player movement is a continuous low-level source of 0.05–0.3, scaled by speed.
- **Masking:** a floor from `quiet` volumes plus mover `noise` (with distance falloff, summed and capped). Underwater
  sources are ×0.25.
- **Perceived loudness:** `loud × 1/(1 + (d/12)²) − floor`. The threshold is 0.12, 0.09 and 0.06 by difficulty.
- **INVESTIGATE**, a new creature state between OBSERVING and APPROACHING: travel to the strongest heard point, listen
  there for 2–4 s, then resume. The existing "hears you move while it listens" rule maps onto the continuous source.
- **Chapter I keeps its current tuning** through `section.creature.hearing: 'legacy'`.

### X9. Echo and knowledge (`echo3d.js`)
- **`crack(x, y, z, loud)`.** `TetherSystem.fire` already builds a miss whip. On a miss, it now raycasts the aim ray to
  0.85 × aim range and cracks at the hit point. A crack in open air has 0.6× the radius.
- **Echo pulses** (at most 4 live): `{ x, y, z, t0, R }`. Each anchor within R gets `revealAt = t0 + d/60` and
  `revealUntil = revealAt + afterimage`, if it has line of sight to the pulse origin. Those checks are queued, at most
  32 `segmentBlocked` calls per step.
- **`known(anchor, t)`** is true when the anchor is chalked, inside the open lantern's radius with line of sight, or
  inside its reveal window.
- **`findTarget`:** add `if (anchor.inDark && !echo.known(anchor, t)) continue`. `inDark` is precomputed from dark
  volumes at load.
- **Chalk:** attaching sets `anchor.chalked`, reset per chapter.
- **Rope telegraph:** if the solid the Mason clings to is the solid an attached anchor is mounted on, or in the same
  `group`, emit `rope:telegraph { hand, intensity }` from its distance and speed.

### X10. Lantern shutter and light registry
- **The lantern:** `player.lantern` is `'open'` or `'shut'`, toggled by `intent.lanternToggle`. Chapters before IV
  ignore it, apart from the visual.
- **The light registry:** `lights.sources` lists the lantern when open, the Mason's crown glow while it listens, and lit
  set dressing. The Sallows read it, and the renderer sets the lantern PointLight's intensity from it.

### X11. Sallow swarm (`sallows3d.js`)
- **Pool:** 24 agents per active window, placed by `roosts: [{ id, x, y, z, count }]`.
- **States:** ROOST, WAKE (0.6 s), SEEK, SMOTHER and SCATTER.
- **SEEK:** steer toward the brightest light in the registry within 30 m, at 4–7 m/s, with separation between agents.
  They avoid solids with a sphere-vs-AABB push, using `querySolids` every 4th step. Line-of-sight checks are
  round-robin, 4 agents per step.
- **Contact with the player while the lantern is open:** snuff the lantern for 8 s and emit a loudness-1.0 shriek. On
  Abyss, call `kill('sallow')`.
- **Contact with the Mason's glow:** `creature.blind(4)`.
- **Output:** a `Float32Array(24 × 6)` of positions and velocities for one InstancedMesh.

### X12. Creature v2 (`creature3d.js`)
**First, split the 2,900-line file** into `perception` (legacy stall model plus X8), `locomotion` (surface-following,
breadcrumbs, limbs) and `behaviour` (the state machine and modes), with no behaviour change, verified by the existing
seeded runs. Then add:
- **`path` mode:** follow a data spline `{ points, speed, lethal, then: 'hunt' }` for the cage roof, the wheel ride, the
  jam, the sea-wall and the horns. The body follows the breadcrumbs as it does now.
- **Mover riding:** when the solid it clings to is dynamic, add the solid's displacement to the head and the
  breadcrumbs, and re-plant the limbs. In v1 this is limited to lifts and the wheel hub; everything else uses `path`.
- **`waterline` mode:** water deeper than 1.5 m counts as a boundary. It patrols the rims. Splashes within 40 m make it
  BURST to the nearest rim point. A player more than 3 m deep is unreachable, so it LISTENS, and the stall model pauses
  while the breath clock runs.
- **Masked hearing:** in a loud floor it can't hear, but it uses frond sight within 10 m.
- **Stillness:** `stillExposure` integrates while the crown is inside a still volume or a carried beam. At 1, the
  creature is STILLED: velocity zero, state timer frozen, limbs locked, plus the stone shader flag. It thaws 0.5 s
  after the light leaves. In the Raising, its per-freeze exposure requirement rises.
- **`blind(s)`:** interrupts listening and makes it thrash, which emits noise.
- **Per-chapter tuning** in section data.

### X13. Still field (`still3d.js`) and the Lamp
- **Beams:** from `still` volumes, swept by clock or by a prism mover, plus the **carried beam** from `intent.beam` and
  the Lamp state. At most 3 beams are active.
- **`isLit(x, y, z)`:** a cone test plus line of sight from the apex, budgeted at 16 checks per step and cached per
  object for 4 steps.
- **Effects each step.**
  - A mover in light ramps its `timeScale` to 0 over 0.2 s.
  - Ballistic debris in light is suspended.
  - Solids with `activeWhen: 'still'` (frozen waterfalls) are active only while lit. When the light leaves, they hum
    and crack for 0.4 s first. The design rule is that a pool always lies below.
  - Anchors with `requiresLight` can only be targeted or held while lit. Losing light starts the difficulty's warning
    timer, then lets the debris fall (`grapple:lightlost`). The rope follows its anchor, so you fall too unless you
    have released or transferred.
- **The Lamp:**
  - Picked up from the Cradle through X17. While carrying it, `player.carry = 'lamp'`.
  - `tethers.handEnabled.left = false` while it is drawn.
  - Left trigger focuses the beam. The left grip holsters and draws it when not tethered.
  - Holstered, the beam is a fixed downward cone and the left tether is enabled again.

### X14. Beats v2 (`beats3d.js`)
The existing `triggers` (once, when the player falls below `y`) compile into beats unchanged, so Chapter I's data keeps
working.
```js
beats: [
  { id: 'jam', when: { attached: 'esc-ring-4' },
    do: [['creature', 'path', 'jam-path'], ['after', 4, [['moverScale', 'hall8', 0, 1.2], ['quiet', 'hall8-din', 0]]]] },
  { id: 'free', when: { any: [{ after: ['jam', 20] }, { noiseCount: ['hall8', 3, 0.5] }] },
    do: [['moverScale', 'hall8', 1.6, 0.8], ['quiet', 'hall8-din', 0.7], ['creature', 'mode', 'frenzy'], ['checkpoint', 'II-8b']] },
]
```
- **Conditions:** `below`, `inBox`, `attached`, `onSolid`, `flag`, `after`, `timeInSection`, `noiseCount`, `holding`,
  `marks`, plus `any` and `all`.
- **Actions:** `moverScale`, `moverStart`, `surface`, `volume`, `quiet`, `solid`, `anchor`, `creature` (`path`,
  `mode`, `relocate`, `release`), `noise`, `hint`, `checkpoint`, `flag`, `endChapter` and `demoGate`.
- **Snapshots:** `snapshot()` and `restore()` at checkpoints cover fired beats, flags, mover clocks, surfaces, solid and
  anchor states (broken, fallen, chalked) and the creature's mode.

### X15. Chapter framework
- **Registry:** `src/data/chapters/index.js` exports
  `CHAPTERS = [{ id, title, module, depthOffset, entitlement: 'demo' | 'full', next, seam }]`.
- **Chapter modules:** each one exports a `LEVEL_DATA` that extends today's shape with `movers`, `volumes`, `beats`,
  `interactables`, `roosts` and `medals`. Level3D ignores fields it doesn't know.
- **Loading:** `Game3D.loadChapter(id, { carryPlayer })` does a dynamic `import()` (ES modules, no bundler needed),
  builds a new `Level3D`, and calls `renderer.buildLevel`, disposing the old geometry, materials and textures. It then
  swaps the audio theme and resets the creature.
- **Preloading:** the next chapter is preloaded during the current chapter's last section.
- **Seams:** a seam section exists in both chapters' data, authored once in a shared module such as
  `seam-1-2.js`. During a swap the player's position is transformed by the seam offset, and ropes reattach to the same
  anchor ids.
- **XR session:** it stays alive across swaps. Swaps hide behind the existing fade sphere for at most 300 ms, which is
  not a camera move.
- **Storage:** `Storage` gets a v2 schema and moves progress, records and ghosts to IndexedDB.

### X16. Entitlement and the demo gate
- **Adopt** `docs/abyssal-tether-3d/pwa/entitlement.draft.js` as `src/platform/entitlement.js`: the Digital Goods API,
  SKU `abyssal_tether_full_game`, restore through `listPurchases()`, and an offline grace period.
- **Gating:** `Game3D.canEnter(chapterId)` gates chapter select. The `demoGate` beat shows the end card when the player
  is not entitled.
- **The purchase panel** is an in-world VR panel. Whether a controller select counts as user activation is an open
  device question already logged in the draft. If it doesn't, offer a desktop-panel fallback.
- **On success,** resume in place through the seam.

### X17. Interactables (`interact3d.js`)
- **Kinds:** `{ id, kind: 'mark' | 'lamp' | 'socket' | 'root', x, y, z, radius, text }`.
- **Touch:**
  - In XR, touch means a grip squeeze with the hand pose within 0.35 m, on a hand that isn't tethered.
  - On desktop, press E within 2.5 m while looking at it (dot product above 0.95).
- **The Socket's raise:** hold the left hand above head height inside the ring for 1.5 s. On desktop, hold E.
- **Root rings:** fragile anchors whose load counts only yank time, so *you* break them on purpose.
- **Events:** `interact:mark`, `lamp:take` and `socket:raise`.

### X18. Records, medals, ghosts, splits (`src/meta/records.js`)
- **Records:** best time, deaths and medals per `{ chapter, difficulty }`. Full Descent is stored with chapter splits,
  and section splits are stored per chapter.
- **Ghosts:**
  - Body position plus both rope endpoints at 20 Hz, quantised to Int16 relative to the section origin.
  - That is about 290 KB for a 5-minute run, stored best-only in IndexedDB.
  - Ghosts replay *positions*, not inputs, so they stay valid when tuning changes.
- **Ghost rendering:** one translucent figure and two line ropes, for 3 draw calls.

### X19. Input extensions
| Intent field | Quest | Desktop |
|---|---|---|
| `hands[h].flick` (0..1, at trigger press) | Grip-space angular speed over the last 3 frames, normalised over 0–8 rad/s | Fixed 0.7 |
| `hands[h].interact` (edge) | Grip pressed while not tethered | E |
| `lanternToggle` (edge) | **X** (left primary, unused during play today) | L |
| `move.y` (in water) | Stick forward × head pitch | Space up, Shift down |
| `beam` `{ ox, oy, oz, dx, dy, dz, focus }` | Left hand pose plus left trigger (when carrying the Lamp) | View ray plus RMB |
| `raise` | Left hand height relative to the head | Hold E |

### X20. Renderer extensions (`src/render/*`)
- **Movers:**
  - One InstancedMesh per part type, with matrices updated per frame.
  - Render-only rotation for wheels, gears and prisms.
  - Phosphor rails as one line-segments mesh per section.
  - The approach glint as a per-instance emissive attribute.
- **Water** (at most 2 visible):
  - One surface plane per water volume, with a shader of scrolling normals, fresnel and depth tint.
  - **Underwater mode** when the camera is below the surface: swap fog colour, near and far.
  - Optional caustics: one 512 px texture projected in the level material.
- **Echo:**
  - A shared `onBeforeCompile` chunk on the level materials, with uniforms for up to 4 pulses (`vec4 origin+t0`,
    `float R`). It draws a sweep band and a fading wire-edge afterimage, at **zero extra draw calls**.
  - Anchor emissive is driven by the reveal window. Chalk is a decal-like per-instance flag.
- **Darkness:** ambient and hemisphere light go to 0 in dark volumes. The lantern radius follows the shutter.
- **Still-light:**
  - At most 3 additive cone meshes, with dust motes inside.
  - A per-instance `stillness` attribute tints frozen objects frozen-blue and adds a glassy shimmer.
  - A stone-freeze uniform on the Mason.
- **Sallows:** one InstancedMesh of 24 agents, with the wing flap in the vertex shader. Distant flock impostors are one
  points mesh.
- **The Plumb:** one tall additive column, visible through openings in every chapter as the world's spine and an
  orientation landmark.
- **Chapter themes and texture sets:** loaded lazily and disposed on chapter swap. Each new feature costs at most 10
  draw calls, inside the 150 budget.

### X21. Audio extensions (`audio3d.js`)
- **Mover voices:** spatialised loops (tick, groan, chain, gear grind, hammer) with a cap of 8 voices, nearest first.
- **Underwater:** a master low-pass at about 800 Hz, muffled breath, bubbles and splashes scaled by speed.
- **Echo:** the crack plus a procedural convolution reverb, with one generated IR per chapter. Horns route a source out
  of 8 mouths.
- **Creatures:** Sallow chitter, wingbeats and shriek, plus the rope-telegraph creak.
- **Still-light:** a beam hum, a focus hum and thaw cracks.
- **Music:** an adaptive score of 3 stems per chapter (calm, pressure, peak), crossfaded by the ThreatSystem value.

### X22. Verification harness v2 and authoring tools (`tools/abyssal-tether-3d/`)
**Bot upgrades.** The level agent's waypoint bot gets time-aware waypoints, so it waits for a phase window. It only
targets known anchors in the dark, and cracks to reveal them.

**Automated fairness checks**, run per chapter and per variant:
- Every main-route anchor is reachable within aim range from the previous hang point at some phase, and is held for at
  least 1.5 s.
- Every required underwater stretch costs at most 70% of breath on Normal at swim plus reel speeds.
- On Normal, one crack from each hang point in the dark reveals the next main-route anchor.
- On Normal, every light-locked anchor stays lit for at least 2.5 s per pass.
- Checkpoints are at most about 90 s of median play apart.

**Authoring tools:**
- **T1, a Blender blockout exporter.** Box objects with no rotation, empties as anchors and paths, and custom
  properties for kind, tag, mover and volume, exported to chapter data. Authoring 4 chapters by hand-typed coordinates
  is the biggest production risk, and Blender is already in the pipeline.
- **T2, an in-headset debug overlay.** It shows volumes, mover paths, noise rings, echo pulses, still cones and Sallow
  states.

### 7.2 Performance budget (Quest 3)
- **Physics** at 240 Hz is about 3 steps per frame at 90 Hz. The added per-step cost is small:
  - at most 40 closed-form mover poses;
  - at most 24 volume tests;
  - noise events (event-driven only);
  - at most 32 echo line-of-sight checks, only while pulses are live;
  - 24 Sallow agents, each querying solids every 4th step;
  - at most 16 still line-of-sight checks.
- **Sim target:** at most 2.5 ms per frame. Measure it with the harness in Node, then on the device.
- **Rendering** stays within today's contract.

### 7.3 Build order

The demo ships first, carrying the foundations of rule II.

| Milestone | Contents | Est. (3–4-person team) |
|---|---|---|
| **M0 Foundations** | X1, X14, X15, X16, X17, X18 (core), X22 (T1) | 3–4 weeks |
| **M1 Demo** | Chapter I polish, Marks, trials, medals and ghosts. The hook, using X2–X5 and an X12 path subset. Store-quality pass. **Demo release candidate.** | 5–6 weeks |
| **M2 The Winding** | The rest of X2–X5, X8 (masking), X12 (mover riding, path), Chapter II | 8 weeks |
| **M3 The Tidehalls** | X6, X7, X12 (waterline), X20 water, Chapter III | 9 weeks |
| **M4 The Lampless Reach** | X8 (full), X9, X10, X11, X20 echo, Chapter IV | 9 weeks |
| **M5 The Stillwell** | X13, X12 (stillness), endings, Chapter V | 8 weeks |
| **M6 Release** | Full Descent, Pilgrim, store assets, localisation-ready text, performance and certification pass | 5 weeks |

That is about 47–50 weeks in total. Because of the owner's quality-first call, each milestone ends with a playtest gate
of at least 10 first-time VR players per chapter rather than a fixed date.

---

## 8. Art needs

### 8.1 Global
- **Anchor kit v2.** Shape-coded and never colour-only:
  - **Moving:** a ring with a motion tail and a rail.
  - **Bellows:** a ring with a bell-shaped nib and a bubble stream.
  - **Light-locked:** a ring inside a halo that drains clockwise during the warning.
  - **Root:** a thorned hook.
  - **Chalk:** a tick mark beside a ring.
  - The existing ring, hook and fragile cracked diamond stay unchanged.
- **Hero props:** the true Lamp, the lens, the Socket, and the Cradle with its roots.
- **Mason shader states, with no new mesh:** a wet sheen (III), the listening glow and Sallow mobbing (IV),
  stone-freeze and thaw cracks (V), and a jam pose reached through `path` (II).
- **The Plumb** column, and a raised-lantern statue pose. The existing statue decor gets 4 new mid-motion poses for
  Chapter V.
- **UI:** the **Plumb Line** chapter select (a carved vertical diorama), medal plaques, the Codex, the wrist splits,
  and the end-card panel.

### 8.2 Per chapter
Textures are PBR sets at 1024 px, at most 3 new sets per chapter. Each chapter's unique kit stays within about 30k
visible triangles.

| Chapter | Textures | Models | VFX |
|---|---|---|---|
| II | Brass, verdigris copper, oiled iron (a variant of `metal`) | Pendulum rod and bob, great wheel (visual, about 8k tris), counterweight, gear train (instanced), governor, trip-hammer, escapement rail, piston | Sparks, oil mist, runaway steam |
| III | Wet limestone, flowstone, algae-stained bronze; water normal map, caustics | Diving bell, bellows ring and air line, sluice gate, tide-post, lanternhouse kit, flume | Bubbles, splash, silt-streak current lanes, spray |
| IV | Basalt columns, wax fungus, horn-stone | Listening horn (2 sizes), rope-bridge kit, Sallow (600 tris or fewer, instanced), roost cluster | Echo band, afterimages, Sallow smother |
| V | White crystal, indigo stone, stilled-water glass (shader) | Prism engine, hanging rubble kit (8 pieces), frozen waterfall column, Cradle, Socket | Beam cones and dust, freeze shimmer, falling debris |

### 8.3 Store assets
- **Trailer.** Built from the five *rule shots*, one per chapter:
  1. Torn out of the cage by the pendulum.
  2. The first dive into the Spillway.
  3. The first crack in the dark.
  4. Freezing a falling slab and swinging from it.
  5. The Lantern Raised.
- **Formats:** 30 s and 90 s trailers, both captured in-headset.
- **Stills:** key art, capsule images, and screenshots per chapter.

---

## 9. Audio and haptics needs

- **Keep the procedural engine.** Add an **original authored foley pack**: chain, brass, water, stone and rope,
  recorded in-house, about 8 MB in Opus.
- **Per chapter.**
  - II: the tick, the escapement clack, the wheel groan, hammer strikes as rhythmic masking, the runaway whine, the jam
    shriek.
  - III: underwater filtering, breath, splashes, the sluice roar, the drain vortex, bell air.
  - IV: the crack and its tail, the horn choir, Sallow sounds, the telegraph creak.
  - V: the beam hum, thaw cracks, the Lamp's tone, the Socket chord.
- **Music.** An adaptive score of 3 stems per chapter. A five-note **Plumb motif** returns in every chapter. **Silence
  is used as a signal**: when the machine stops, the player should feel the danger before understanding it.
- **Accessibility.** Subtitles for plaques and Marks, and visual cues for every audio-critical beat:
  - the jam: movers visibly stop;
  - the tide: tide-marks;
  - the Mason in the dark: the rope telegraph glow on the wrist.

| Haptic event | Pattern |
|---|---|
| Riding a mover | Low continuous rumble scaled by anchor speed |
| A mover ticks through the rope (II) | A short pulse per tick on the tethered hand |
| Bellows air (III) | A soft buzz on the air hand |
| Breath low (III) | Heartbeat pulses on both hands |
| Rope telegraph (IV) | Pulses scaled by the Mason's proximity on your structure |
| Crack (IV) | A sharp recoil, strength set by the flick |
| Beam and freeze lock (V) | A hum while focused, a click when a target stills |

---

## 10. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Scope:** four new systems and about 2 h of new content | High | High | Build each system before its content and verify it with the harness. T1 Blender blockout. Every chapter has 2 sections marked cuttable without breaking its curriculum (II-9, III-6, IV-2, V-1 can shrink). Ship the demo first. |
| **Motion intensity:** governor flings, express lifts, runaway (no comfort options, by decision) | Medium | High | The view is never rotated and only translation is applied. Anchor speed is capped at 13 m/s and verified. Every motion start is telegraphed. Normal runs the slower clocks. Playtest gates of 10 or more new VR players per chapter. |
| **Drowning frustration** | Medium | Medium | The 70% breath rule (X22), plentiful air pockets, water catching falls as the chapter's positive opener, a diegetic gauge, and a 3 s last-chance darkening. |
| **Getting lost in the dark** | High | High | Chalk trails, one crack from each hang point always reveals the next anchor (verified), the lantern is always available at a cost, the Plumb glow orients you, and IV-1 is a safe teaching room. |
| **Emergent AI unfairness** (Mason × noise × Sallows) | Medium | High | Seeded behaviour, mercy rules (a guaranteed lunge wind-up, checkpoint grace), sandbox overlays (T2), and splitting the creature module before extending it. |
| **Quest browser performance** with more sim and FX | Medium | High | The §7.2 budgets, section windows, closed-form movers, zero-draw-call echo, and device profiling at every milestone. |
| **WebXR IAP unknowns** (activation from a VR select, offline listing) | Medium | High | Already logged in the entitlement draft. Verify on device in M0. A desktop-panel fallback. The demo is complete and good on its own. |
| **Save loss** from PWA storage eviction | Low | High | IndexedDB plus `storage.persist()`. Progress is small and rebuilt from the Marks and medals records. |
| **Gimmick-chapter feel** (one trick per chapter) | Medium | Medium | The remix matrix (§2.1): every rule returns at least twice, and the finale requires all of them. |
| **Seam swap hitch** in XR | Medium | Medium | Preloading during the final section, a swap under the fade sphere in 300 ms or less, and checking dispose with `renderer.info`. |

---

## 11. Mechanics considered and set aside

- **Rope burn / overheat.** A meter that punishes the core verb, plus forced releases that break "the player keeps
  control". It stays as flavour only: ropes smoke on a hard yank, with no gameplay effect.
- **Updraft shafts.** The tech is identical to `current` volumes (X6) and is cheap to add later. Putting it in Chapter
  II or III would make that a two-rule chapter, so it is reserved for a post-launch chapter ("The Flue") or a Pilgrim
  remix.
- **Rope wrapping and swinging around corners.** It needs a real rope simulation, it is unstable at 240 Hz under the
  two-hand constraint, and it is hard to read in VR.
- **Riding the Mason.** Making the predator a vehicle dilutes the dread that the sense economy is built on. The Mended
  Wall gives the player a gentler, earned contact with it instead.
- **Hand-tracking-only play.** There is no trigger, so it is out of scope for 1.0. The optional `hand-tracking` feature
  stays requested for menus.

---

## 12. Open questions for the owner

1. **Choose or merge pitches.** The systems ladder can host strong set-pieces from the set-piece pitch, since its exams
   are set-pieces. The two hooks differ: *The Eye of the Plumb* (sells a rule) and *The Lid* (sells a story beat). One
   must be picked.
2. **Release cadence.** Launch with all five chapters (the recommendation for review scores), or launch the demo first
   as a wishlist builder if the store allows a demo before the unlock is purchasable. That needs checking.
3. **Ending tone.** Is it acceptable that *Lantern Raised* stills the player too? The secret ending is the hopeful one.
4. **Online leaderboards.** Out of scope without a backend. Is Meta platform integration for WebXR PWAs worth
   investigating for 1.1?
5. **Desktop build.** Keep it as a test and creator tool only, or offer it publicly as a web demo funnel?
