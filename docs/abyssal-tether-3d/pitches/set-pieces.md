# ABYSSAL TETHER — Five-Chapter Plan · Pitch: "SET-PIECE DRIVEN"

> Role: lead game designer · Angle: every chapter builds to one unforgettable VR moment, with quiet between them ·
> Date: 2026-10-19 · Status: pitch for owner review · Target: Meta Horizon Store, WebXR PWA, free demo (Chapter I)
> plus a $9.99 in-app unlock · 5 chapters, about 2 h 45 min for a first-time player · full 3D movement, no comfort options,
> three.js, no Unity.

---

## 0. The pitch on one page

**Logline.** You hang from two threads over two and a half kilometres of living cathedral. The building is hunting you,
and the only way out is further down.

**Tagline** (carved on the first plaque of the game): *Trust the ring, not the floor.*

**The promise.** Each chapter is built around a single moment that a player will want to describe to a friend. Each one
uses a new verb, and the chapter teaches that verb safely before the set-piece tests it under pressure. Between the
peaks there is deliberate quiet: wonder, lore and dread. That way the peaks land, and the player's stomach gets a rest.

| # | Chapter | Environment | Signature set-piece | New verbs | Who hunts you | Length (first time) |
|---|---|---|---|---|---|---|
| I | **The Underspire** *(free demo, existing build polished)* | Inverted stone cathedral, iron, amber lamps, cold teal shafts | **The Spiral** (ring-chaining around the inverted spire while the Mason crawls down it), then **The Lid** (the demo hook) | tethers, swing, reel, yank, fragile rings, crumbling ledges, picking up the Still Lamp | The Mason (sighting → stalk → hunt → frenzy → escape) | 22–30 min |
| II | **The Kilnworks** | A foundry that is still burning: firebrick, black iron, slag glass, rising embers | **The Gantry Run**: a 420 m casting bridge collapses behind you while you swing beneath it | moving anchors, moving platforms, updrafts, heat zones, pull-anchors, noise masking | The Mason **and the machine** (hammers, slag, heat) | 30–36 min |
| III | **The Drowned Choir** | A flooded bell-foundry in total darkness: bronze, verdigris, black water | **The Sounding**: a 70 m dive down a drowned bell tower, lit only by your lantern, on one breath at a time | swim, reel-down, breath and air pockets, lantern shutter, bells as noise | The Mason above the water, **the Wicks** below it | 34–40 min |
| IV | **The Hanging City** | A Lanternwright city hung on chains over a gulf, under a sky of glowing lichen | **Beneath the Mason** (ride the predator across the void, hanging from rings on its back), then **Lampfall** (the city falls and you fall with it) | wind, swaying houses, riding the creature, free-fall among debris, the net catch | The Mason, **wind and gravity** | 32–36 min |
| V | **The Heartwell** | Living bone-white stone, crimson dark, a breathing throat | **The Stilling**: climb the First Throat while it breathes, with the Mason climbing after you and the Lamp's stillness climbing after it | growing stone, breath-cycle updrafts, pursuit from below, climbing the petrified creature | The Mason, wounded and desperate, and **the closing stone** | 30–36 min |

**Totals:** 2,470 m of descent, then a 280 m ascent. About 165 minutes for a first-time player at median skill on
Normal, retries included. About 35–45 minutes for a skilled Abyss run of all five chapters.

---

## 1. Rules for every set-piece

1. **Teach, then test, then twist.** A set-piece only ever combines verbs the same chapter has already taught in a safe
   place, at least one section earlier. It never debuts a verb.
2. **Quiet before, release after.** Every set-piece is preceded by at least 2 minutes of low intensity (a vista, a lore
   room, a rest ledge) and followed by a silent recovery space where the player can hang, look around and breathe.
3. **The player keeps control.** No cutscenes, no camera moves, no forced rotation. Spectacle happens around you while
   your hands stay on the triggers. Movers and creatures may **translate** the player (you chose to stand on or hang
   from them). Nothing ever **rotates** the view.
4. **Readable under pressure.** On the main route, the next anchor is always visible from the previous one: phosphor
   markers ignore fog within 18 m and stay lit when the lantern is shuttered. Set-piece anchors use the existing
   `escape` styling (bigger, brighter).
5. **Audio warns before visuals.** Every threat is heard 1–2 s before it arrives: creaking before a collapse, an inhale
   before a downdraft, a bell's hum before the Mason investigates.
6. **More than one line.** Every set-piece has a safe line and a fast line, plus at least one recovery anchor on Normal.
7. **Retry within 10 s.** There is a checkpoint immediately before every set-piece, and its sequence state restores
   exactly (see E11).
8. **Duration: 60–180 s of peak intensity.** Long enough to tell a story, short enough to retry.
9. **Rubber-banded, never scripted to kill.** Chase fronts and pursuers keep pressure relative to the player (§E12) and
   have a mercy floor, but a stalling player always dies.
10. **Every set-piece is also a trailer shot.** Each one has a 6–10 s moment framed for the store video (§7.4).

**The pacing grammar inside a chapter:** *arrive (wonder) → learn the new verb → test it → creature beat → quiet/lore →
combination test → SET-PIECE → silence → descend to the next chapter.*

---

## 2. Story outline (told through environment, never cutscenes)

- **The Lanternwrights** found a flame at the bottom of the world that does not move: **the Still Lamp**. Its light
  makes things *hold still*, including stone, water and flesh. They took it up to the foot of their inverted cathedral,
  **the Underspire**, and used its light to set living stone into architecture. ("THE LAMP DOES NOT RISE TO MEET US. WE GO
  DOWN TO IT.")
- The stone was alive. What they stilled into walls slowly woke and wore their work. Masons went down to repair it;
  "THE WALL MENDED ITSELF." **The Mason** is that stone, which remembers being alive. It hunts by sound, and it has
  always been heading toward the Lamp.
- **Chapter I** ends when you lift the Lamp. The Lamp was holding the chamber's walls still, and the walls were coils of
  the Mason. From then on you carry the thing it wants, and the flame (which never moves) leans toward the place it came
  from.
- **Chapters II–IV** go down through what the Lanternwrights left below the Lamp's mark: the foundry where they cast the
  Underspire's iron, the bell-choir they tuned to calm the Mason's hearing, and the city where they lived while they
  built.
- **Chapter V** is the **Heartwell**, the Lamp's socket. When you return the Lamp, stillness rises up the First Throat,
  and the Mason flees upward ahead of it, toward you. The game ends with the predator turned to stone a metre below your
  boots. Your last climb is up its back, using the rings it wore.

Lore is delivered through **plaques and rubbings** (short carved lines, collectible) and through the architecture. No
voice-over is required.

---

## 3. Chapter by chapter

Coordinates: each chapter is its own `Level3D` with local Y starting near 0. The depth shown to the player adds a
per-chapter `depthOffset`, so the depth readout continues from chapter to chapter.

Intensity runs from 1 (calm) to 5 (peak). Section times are for a median first-time player on Normal, deaths included.

---

### CHAPTER I — THE UNDERSPIRE *(the free demo; the existing 556 m descent, polished)*

*"Where the line is learned."* Depth 0 → 556 m.

**Environment.** Unchanged in identity. Masonry and oxidised iron. Fog runs from `#252b30` to `#120f0e`. Teal shafts
(`#6fa3b5`) light the upper levels and amber lamps (`#e0a050`) the lower. The Outer Dark colossus is visible through the
Threshold's east window. In the hook, the ember glow of the Kilnworks rises from below and previews Chapter II's palette.

**Mechanics (existing):** two tethers, swing pump, reel, yank, jump, fragile rings, crumbling ledges, rebar, spikes and
blades, a creature that listens and lunges, checkpoints. **New in polish:** picking up the Still Lamp (E13) and the Lid
sequence (E1, E11).

| § | Section | Beat | Int. | Min |
|---|---|---|---|---|
| S1 | The Threshold | First swing. The colossus through the window is the **trailer opener**. | 1 | 2 |
| S2 | The Long Swing | Momentum and the first long release over the hall. | 2 | 3 |
| S3 | Broken Gallery | The save-ring recovery (the spec's §29 design test). | 2 | 3 |
| S4 | The Listening Vault | **Wonder beat.** The sighting across 190 m of void. | 1→3 | 3 |
| S5 | The Gullet Stair | It has your scent; the first lethal stalking. | 3 | 3 |
| S6 | The Two Descents | The choice between slow and fast. | 4 | 3 |
| S7 | The Hollow Nave → **THE SPIRAL** | Chapter I's set-piece (below). | 5 | 4 |
| S8 | The Last Throat | The escape, ending with the grate slam. | 5 | 2 |
| S9 | **The Lid** *(new)* | The hook: lift the Lamp, the walls unspool. See §4. | 1→5→1 | 2–3 |

**Set-piece: THE SPIRAL (polishes the existing S7).** The rings already spiral around the inverted spire, and the
creature is already in frenzy. Polish:
- When the player reaches ring `s7-n5`, a `creature-path` beat sends **the Mason down the inverted spire itself**,
  head-first and spiralling, so that while you swing from `n6` to `n7` its crown passes the spire face **6–8 m away at
  your height**. That is outside the kill radius and a guaranteed near-miss. It then rejoins the frenzy hunt.
- Debris rains from the spire as it climbs past. The spire-face shortcut rings (`s7-sp1`/`sp2`) become a "dare" line:
  faster, but on the creature's side.
- Sound: its plates grinding on stone pan around the spire as it spirals. Each lap passes behind you, then in front.

**Creature beats:** dormant (S1–S3) → the sighting across the Vault (S4) → stalk (S5) → hunt (S6) → frenzy and the
spire descent (S7) → escape and the grate slam (S8) → the coil reveal (S9, scripted, non-lethal).

**Collectibles:** 6 **votives** (unlit lamps placed off the main route: the pocket under S1, the far end of the S2 hall
floor, the cage in S3, the Vault catwalk end, behind the S6 divider on the throat side, under the S7 perch) and
8 **rubbings** (the 7 existing plaques plus the Lid plaque).

**Length:** 22–30 min first time. About 4–5 min on Abyss.

---

### CHAPTER II — THE KILNWORKS

*"Where the iron was born."* Depth 556 → 940 m, plus a 420 m horizontal gantry crossing.
**Mood:** heat, industry and noise. A machine that never stopped working. The Mason hates it here.

**Environment and look.**
- **Palette:** smoky umber fog `#2a1712` (near 6, far 110). Ember key light `#ff7a2e`, molten accent `#ffd27a`, cold ash
  fill `#3a4a52` for contrast. Ambient 0.22.
- **Materials:** firebrick (new set), black cast iron with an emissive heat-tint mask (new set), slag glass, soot-stained
  timber patterns.
- **Signature visuals:** embers rising in every updraft (so the player can read the air), slag pours as scrolling
  emissive ribbons, kilns breathing light, and colossal furnace towers in the fog standing in for the "far" silhouettes.

**New mechanics (each taught in isolation first):**
| Verb | What it is | Taught in |
|---|---|---|
| **Moving anchors** | Crane hooks on trolleys, a cradle chain paying out, counterweights. Momentum carries over when you let go. | S1 (the paying-out chain), S3 |
| **Moving platforms** | Ore buckets, hanging crucibles, piston heads. They carry you; leaping off one adds its velocity. | S5, S6 |
| **Updrafts** | Hot air columns that slow a fall or lift you. **The first time the player traverses upward.** | S1 (gentle float), S2 (rising flues) |
| **Heat zones** | Standing in the glow builds heat (gauntlets glow, sizzle, haptics) until it kills. **The Mason refuses to enter an active heat zone.** Shelter costs heat. | S2, S5 |
| **Pull-anchors** | Fire at a counterweight, damper or lever ring and **yank** to drive the machine: lower a drawbridge, tip a crucible, close a kiln. The tether becomes a tool. | S4 |
| **Noise masking** | The drop hammers' strikes cover your noise. Move on the beat. | S5 |

**Sections**
| § | Section | Beat | Int. | Min |
|---|---|---|---|---|
| 1 | The Ember Stair | You arrive still hanging on the Ch. I cradle chain, which pays out in jerks: a moving anchor, taught for free. The first updraft column lets you float, not fall. | 1 | 3 |
| 2 | The Flues | Ride rising flue chimneys **up** and over a collapsed floor. Heat exposure is introduced: take the cool flue or the fast hot one. | 2 | 4 |
| 3 | The Crane Yard | Hooks travel on overhead rails. Catch one as it passes, ride it, release with its speed. Far below, the Mason climbs back up toward the Lamp, then stops: it heard the cranes. | 2 | 5 |
| 4 | The Pattern Hall *(quiet)* | Hundreds of hollow wooden Lanternwright molds. Yank a counterweight to lower the drawbridge. Lore and votives. One mold moves: frond tips probing through it. | 1 | 4 |
| 5 | The Drop Forge | Drop hammers and pistons on cycles, slag pours on schedules, rides on piston heads. **Stalk.** Move on the hammer beat (masking). Shelter beside the kilns: it won't follow, but heat builds. | 3 | 5 |
| 6 | The Crucible Line | A loop of crucibles travels across the gulf. Hop between them. Yank a crucible's tip-ring to pour slag between you and the Mason and **cut it off** (it detours). **Hunt.** | 4 | 5 |
| 7 | **THE GANTRY RUN** | Set-piece (below). | 5 | 4–6 |
| 8 | The Quench | Drop into the quench pool: the first water, and the first fall the water forgives. Lower beside the spillway into the dark. Chapter card. | 1 | 2 |

**SET-PIECE: THE GANTRY RUN** *(collapse chase, 75–100 s)*
- **Setup (quiet before):** a long rest ledge at the gantry head, looking out over a 420 m iron truss spanning the Kiln
  Gulf, 120 m above molten light. Crane hooks and chains hang under the deck. A plaque reads
  "CAST ACROSS IN ONE POUR. DO NOT LINGER ON THE SPAN."
- **Trigger:** halfway along the deck, the Mason hits the gantry's far anchorage **behind you** and tears it free. A
  **collapse front** (E12) starts racing along the route after you, and the Mason rides it, ripping beams.
- **Beats:**
  1. *Run or drop.* Running on the deck (5.5 m/s) is too slow for the front (7 m/s base on Normal). The player has to drop
     **under** the deck and swing hook to hook (10–12 m/s). This is the chapter's "commit" moment.
  2. *Runaway trolleys.* As the gantry sags, crane trolleys come sliding along the rails **toward** you (moving anchors).
     Catching one as it passes gives a burst of speed, but in the wrong direction unless you release at the right moment.
     This is the expert line.
  3. *Deck rain.* Deck sections fall past and through your swing lines, warned by creaks and dust 0.7 s ahead. Ropes to
     anchors on a collapsing section break (`grapple:break`). Hooks **ahead** of the front stay solid, so a player who
     falls can still save themselves by firing forward. This is the recovery design.
  4. *The last span.* The final span drops in stair-steps (−1 m, hold, −2 m, hold, −4 m). It is a falling ramp built from
     translations only. Leap from it to the hook on the far cliff as the whole gantry, with the Mason on it, falls into
     the fire.
- **Release:** you hang on the cliff wall with the gulf glowing below. A long, burning roar. Then a scrape: the Mason
  climbs out, plates hissing, and leaves into the dark. It will be back.
- **Difficulty:** front base speed / target gap: Normal 7 m/s / 22 m, Nightmare 8 / 16, Abyss 9 / 11. Recovery hooks
  under the deck: Normal 4, Nightmare 2, Abyss 0. Trolleys: on every difficulty.
- **Why it works in VR:** the noise and the size of a bridge collapsing *behind your back*. You turn your head to look
  and see the Mason's crown riding a wave of falling iron toward you.

**Creature beats:** absent at the start (relief and dread) → heard climbing far below (S1–2) → sighting, frozen by
machine noise (S3) → frond tips in the molds (S4) → stalk; learns to fear the heat (S5) → hunt; cut off by slag (S6) →
demolition chase (S7) → survives, smoking (S7 release).

**Second danger:** the machine itself (hammers, slag, pistons, heat). Two of the eight sections are lethal without the
Mason involved at all.

**Collectibles:** 6 votives (top of a hot flue, the end of a crane rail, inside a pattern mold, a forge alcove timed to
the hammers, a crucible that never comes back, the gantry's underside). 6 rubbings (casting records that tell the Lamp
story).

**Length:** 30–36 min.

---

### CHAPTER III — THE DROWNED CHOIR

*"Hush, and hold your breath."* Depth 940 → 1,260 m. **Mood:** total darkness, claustrophobia, held breath, stealth.
This is the slow, quiet chapter: the valley between the chases of II and IV.

**Environment and look.**
- **Palette:** in air, fog `#0c1416`. Under water, fog `#031012` with near 1.5 and far 14 (almost nothing visible).
  Light comes only from your lantern (the Still Lamp), the Wicks' glow (`#7fe0d0`) and faint verdigris algae
  (`#3f6b63`). Ambient about 0.04 in dark volumes.
- **Materials:** bronze with verdigris (new set), wet stone (the masonry set with lower roughness), silt.
- **Signature visuals:** bells of every size hanging in the black, the lantern's warm sphere the only colour, bubbles
  rising, the black mirror of the waterline from below.

**New mechanics:**
| Verb | What it is | Taught in |
|---|---|---|
| **Swimming** | Slightly buoyant arcade water: idle means you drift up. Swim along the stick, with vertical direction from head pitch. Any fall into deep water (≥ 2.5 m) is survivable. | S2 |
| **Reel-down** | Underwater, fire at a ring **below** you and reel in. The tether pulls you down against buoyancy. **The grapple verb inverted.** | S2 |
| **Breath** | 30 / 24 / 18 s (Normal / Nightmare / Abyss). Air pockets trapped under sunken bells refill it. Felt rather than read: heartbeat, muffling, the lantern's flame shrinking. A small bubble bead on the wrist HUD. | S2 |
| **Lantern shutter** | Bring the lantern hand to your chest, or click the left stick, to shutter it. Light draws the Wicks; darkness hides you from them, but you only see phosphor markers within about 10 m. | S4 |
| **Bells as noise** | Touching a bell, or swinging one too hard on its own ring, makes it ring. A ring is a beacon for the Mason. | S3 |

**The core tension:** *light against sound.* The Mason hunts by sound and stays above the waterline. The Wicks hunt light
and stay below it. Underwater you are muffled (noise × 0.3) but running out of breath and visible to the Wicks. Above the
water you can breathe and can't be smothered, but you can be heard.

**The Wicks (the second danger).** Pale, drifting colonial filaments that feed on light. The Lanternwrights farmed them
to trim their lamps; in the drowned dark they have grown to the size of a hand, a coat, a bell. They drift toward an open
lantern within 14 m and latch on. Each one dims the light and adds drag. If three or more stay latched (4 / 3 / 2 s by
difficulty) you are **smothered**. To get rid of them: shutter the lantern for 2 s (they lose interest and scatter), yank
hard, or swing faster than 6 m/s. **Feeding Wicks keen**, which is noise, so near the surface they call the Mason.
**Lit votives lure them**, which is an emergent use for a collectible.

**Sections**
| § | Section | Beat | Int. | Min |
|---|---|---|---|---|
| 1 | The Spillway | Lower beside a waterfall into total dark, lit only by the Lamp. Teaches reading phosphor in the dark. | 1 | 3 |
| 2 | The Shallows | First swim, first reel-down, first air pocket. Safe and shallow. | 1–2 | 5 |
| 3 | The Bell Gallery | Swing between hanging bells without touching them. A ring brings the Mason's crown down out of the rafters to **investigate** the spot (E8). Hide and stay still. | 3 | 5 |
| 4 | The Wick Cistern | The Wicks arrive. Learn the shutter. Light a votive to draw them off the route. The Mason is absent: this section belongs to the second danger. | 3 | 6 |
| 5 | The Sunken Nave | **The choice:** under the water (Wicks and breath, but muffled) or over it (rings along the vault: fast, but the Mason hunts there). | 4 | 5 |
| 6 | The Belfry *(quiet)* | An air pocket under the great bell. A Lanternwright skeleton cradles a dead lamp. Rubbings about the Lamp. Then the Mason **knocks on the bell from outside** and the whole bell rings around your head. Harmless and terrifying. | 1→4 | 3 |
| 7 | **THE SOUNDING** | Set-piece (below). | 5 | 7–9 |
| 8 | The Culvert | The flush. You are thrown out of a cliff waterfall into open air over the Gulf of Lamps. Catch a chain. Chapter card while you hang, seeing the Hanging City for the first time. | 5→1 | 1 |

**SET-PIECE: THE SOUNDING** *(the flooded descent in total darkness, about 3 min of peak)*
- **Setup:** the belfry tower has flooded to the brim. It is 16 × 16 m and 70 m deep, the only way down. A rest ledge sits
  at the waterline; the plaque reads "SOUND THE TENOR TO OPEN THE WAY. THEN DO NOT BE HERE."
- **Beats:**
  1. *The dive.* Reel down from ring to ring into the black. Three sunken bells hold air pockets at 18, 38 and 56 m. Each
     leg is about 20 m: 5–8 s of reeling plus navigating, comfortably inside 30 s of breath on Normal. Wicks drift in the
     column; shutter to slip past them, at the cost of seeing only the next marker.
  2. *The plunge.* At about 30 m deep (or at your first loud noise), the Mason's crown **sinks into the shaft beside you**:
     glowing pits in black water, fronds trailing 20 m down. Noise underwater comes from moving faster than 1.5 m/s,
     reeling, impacts and keening Wicks. **Hang still.** Your breath keeps falling. It withdraws after 8 s, or earlier when
     your breath reaches 25 % on Normal (a hidden mercy rule). This is the single scariest beat in the game.
  3. *The Tenor.* At the bottom, the great Tenor bell. Fire at its clapper ring and **yank three times** (a pull-anchor).
     Each ring is louder, and the third cracks the sluice gate. You are deliberately making the loudest noise in the game.
  4. *Frenzy dive.* The Mason dives the full length of the shaft after you. You have about 10 s to reach the cracked
     sluice. The drain current (a force volume) takes you through a 60 m culvert, and the water level in the tower drops
     behind you (an animated surface).
- **Release:** you are thrown out of a cliff face into open air, falling, over the vista of the Hanging City. Any chain
  will do. Silence, wind and violet light.
- **Difficulty:** breath 30 / 24 / 18 s. Air pockets 3 / 3 / 2 (on Abyss the 38 m bell is gone). Plunge window 8 / 10 / 12 s.
  Wick count 6 / 8 / 10.
- **Why it works in VR:** real darkness in a headset is total. The only light is in your own hand, and the predator's
  glow appears *beside your shoulder* in the water.

**Creature beats:** distant knocks only (S1–2) → investigates bell rings (S3) → absent while the Wicks take over (S4) →
hunts the over-water route (S5) → knocks on the bell (S6) → the plunge, then the full dive (S7).

**Collectibles:** 6 votives. Lighting a votive underwater makes it a Wick lure, and every lit votive stays lit
permanently. 6 rubbings, including the Choir's tuning records: "WE TUNED THE BELLS TO ITS HEARING. FOR A TIME IT
LISTENED INSTEAD OF HUNTED."

**Length:** 34–40 min.

---

### CHAPTER IV — THE HANGING CITY

*"Everything here is held up by something."* Depth 1,260 → 2,140 m. **Mood:** vertigo, scale, beauty, then chaos. The
spectacle chapter.

**Environment and look.**
- **Palette:** violet-grey fog `#1d1b22` (near 10, far 220: the biggest space in the game). Pale "sky" light `#c9c2e6`
  from **lamp-lichen** seeded across the gulf's rock ceiling, which reads as a false night sky. Rust-gold accent
  `#c08a3e` from the city's dead lamps. Ambient 0.28.
- **Materials:** timber (new set), slate roofs (new), canvas and cloth (new), chain iron.
- **Signature visuals:** districts hanging at different heights from chains rising into the "stars", wind-blown dust
  streams, the Mason's full silhouette crawling across the lichen sky.

**New mechanics:**
| Verb | What it is | Taught in |
|---|---|---|
| **Wind gusts** | Lateral force volumes on a gust schedule, warned by a rising howl, flapping cloth and swaying chains. Time your releases between gusts, or use a gust to stretch a swing. | S1, S4 |
| **Swaying houses** | Houses hung on parallel chains swing as **pure translations** (a parallel linkage, true to physics and AABB-friendly). Your landing weight and your yanks put energy into them, so you can pump a house like a swing. | S2 |
| **Orbiting rings** | The city's counterweight orrery: rings on arms that orbit an axle. Catch one on the downswing. | S6 |
| **Riding the Mason** | Old Lanternwright rings are riveted into its back plates ("IT WEARS OUR WORK"). Tether to them and let it carry you, as long as it doesn't notice. | S5 |
| **Free-fall among debris** | In the gulf's skydive volume, terminal velocity is 30 m/s and air control is stronger. Falling pieces fall at nearly your speed, so you can steer to them and tether to them. | S8 |
| **Elastic catch** | A rope that catches you at high speed stretches and absorbs the fall instead of stopping you dead. | S8 (and earlier, quietly) |

**Sections**
| § | Section | Beat | Int. | Min |
|---|---|---|---|---|
| 1 | The Falls | You arrive on the chain you caught. The **vista** (a store-page money shot). Wind is introduced. | 2→1 | 3 |
| 2 | The Chain Quarter | Swaying houses: pump one to reach the next. | 2 | 5 |
| 3 | The Lamp Market *(quiet)* | Streets of stalls on chains, dead lamps, lore: the city fled down, not up. Overhead, the Mason crawls the full width of the lichen sky, blotting out the stars as it passes. You see its whole length for the first time. | 1 | 4 |
| 4 | The Wind Bridges | Rope bridges (crumbling chains) between districts, gusts. **Stalk.** | 3 | 5 |
| 5 | **BENEATH THE MASON** | Set-piece 1 (below). | 4 | 5–6 |
| 6 | The Orrery | Orbiting rings and counterweights. **Hunt.** | 3 | 5 |
| 7 | The Keel | The city's top rigging. **Frenzy.** It finds you and tears into the master chains. | 4 | 4 |
| 8 | **LAMPFALL** | Set-piece 2, the chapter climax (below), then the Net (silence). | 5→1 | 4–5 |

**SET-PIECE 1: BENEATH THE MASON** *(stealth ride, about 60 s of riding)*
- **Setup:** the Spine Bridge between the districts is gone, leaving 150 m of void. A rest ledge looks out on the
  **Keel**, the city's great iron truss. The Mason is crawling along its underside, upside down, toward the far district,
  at about 3.5 m/s. Its back faces the void, and the back plates carry old phosphor rings. A rubbing on the ledge: "IT
  WEARS OUR WORK. SOME OF US RODE IT, ONCE."
- **The rules** (taught by the plaque, a hint and its first shudder):
  - Tether to a back-ring as it passes overhead. It carries you, hanging **beneath it**, across the void.
  - It feels the rope through its plates. **Noise** is a yank, reeling for more than 0.5 s, impacts, or swapping rings
    (each attach makes a small tick).
  - Noise produces a **shudder**: the plates heave and your rope jolts, with haptics. Its crown then **sweeps back along
    its own spine**, a glow travelling down the body. **Freeze while the glow passes** (red light / green light).
  - After the third shudder (Normal; Nightmare 2, Abyss 1) it **scrapes** the section of its back you are on against the
    Keel. Rings on those segments are unusable for 3 s. A player holding two rings on different segments survives.
  - Choose your ring: near the head is steadier but closer to the fronds' sweep; near the tail sways wide.
  - Release over the far district's roofs as it passes. Hand-over-hand along its body toward the tail to time the drop.
- **VR moment:** lattice-girder limbs plant hooks in the iron around you, and every step thrums through your rope. Dust
  falls, the plates grind a metre above your hands, and the fronds turn back toward you.
- **Failure:** a fall into the gulf. Normal has 3 dangling catch chains below; Nightmare and Abyss have none. Checkpoint on
  the ledge.

**SET-PIECE 2: LAMPFALL** *(the falling city, about 75 s from first lurch to the net)*
- **Phase A, the Lurch (20–25 s).** The Mason tears the master chains. The city drops in stages: chains snap one by one,
  each warned by a bang overhead, and districts lurch down 2, then 4, then 8 m (step movers). Get off the Keel and into
  open air near the falling quarter. Anchors and platforms jolt under you. Ropes to snapped chains break.
- **Phase B, the Fall (about 20 s, 480 m).** The last chains go. **Everything falls**: houses, bells, market stalls,
  chains and the Mason itself, its limbs flailing for purchase. In the skydive volume you fall at 30 m/s, and so does the
  debris (28–32 m/s), so **relative speeds are small**. You can drift between falling houses, tether to a falling roof's
  ring and reel across, and hide behind a falling bell tower as the Mason's limbs smash through it (its limbs cut ropes,
  E3). Below, the fog brightens.
- **Phase C, the Net (last 4 s).** The Lanternwrights' **Catch-Net** spans the gulf floor: a grid of 40+ big rings, with
  aim assist ×1.5 in the volume. Fire before you pass through it. The elastic catch absorbs 30 m/s over 0.3 s. You swing
  beneath the net as the city tears through its edges, and the Mason falls past you, scrabbling, and is gone.
- **Release:** you hang in the net in silence. Lichen stars far above. Debris settles in the dark below. You think it's
  dead.
- **Difficulty:** Phase B debris count is the same everywhere. Net rings 40 / 28 / 18, net aim assist 1.5 / 1.25 / 1.0,
  terminal speed and air control the same on all difficulties.
- **Why it works in VR:** weightlessness among falling buildings is a sensation only VR can deliver, and the player is
  never out of control.

**Creature beats:** a silhouette across the sky (S3) → stalk in the wind (S4) → **you ride it** (S5) → hunt (S6) →
frenzy (S7) → it destroys the city and falls past you (S8).

**Second danger:** wind and gravity. The wind bridges and the Orrery kill through timing, not teeth.

**Collectibles:** 6 votives (a house you must pump to reach, a market lamp-post, the Orrery hub, the Keel's crow's-nest,
**one on the Mason's back** (light it while riding, a feat in itself), one on a falling house during Lampfall). 6 rubbings.

**Length:** 32–36 min.

---

### CHAPTER V — THE HEARTWELL

*"Where the stone remembers."* Depth 2,140 → 2,470 m, then **up** 280 m. **Mood:** awe, grief, resolve, catharsis.

**Environment and look.**
- **Palette:** crimson-black fog `#140808` (near 5, far 80). Bone-white living stone `#d8d0c0`. A heart-pulse light
  `#f0e6d0` from the socket. In the finale, a rising **stillness light** (warm white `#fff1d6`) climbs the walls.
- **Materials:** living stone (a masonry/flesh blend, mostly reusing existing sets), emissive crystal veins, bone.
- **Signature visuals:** walls that breathe and grow, ribbed throats, the Heartwell (a vast spherical cavity), and the
  stillness wave washing colour out of the world as it rises.

**New mechanics:**
| Verb | What it is | Taught in |
|---|---|---|
| **Growing stone** | Passages that slowly grow shut and breathe open again (moving solids). Wait for the opening or race the closing. Telegraphed, with a crush rule (§E2). | S2 |
| **The breath cycle** | Air in the deep moves in a rhythm: **exhale** (a strong updraft that lifts you), pause, **inhale** (a downdraft that drags at you, so be tethered), pause. Heard 1.5 s ahead. | S3 (horizontal galleries, then one safe vertical ride) |
| **Pursuit from below** | The Mason hunts **upward** for the first time. | S7 |
| **Climbing the creature** | Petrified Mason segments become static solids and their back-rings static anchors. | S8 |

**Sections**
| § | Section | Beat | Int. | Min |
|---|---|---|---|---|
| 1 | The Net and the Floor | Quiet. Lower from the net onto living stone. The city burns in the wreckage. No sign of the Mason. | 1 | 3 |
| 2 | The Mending Fields | Growing stone. Timing without a predator. Fresh drag marks in the stone. | 2 | 5 |
| 3 | The Breathing Galleries | Learn the breath cycle, first horizontally, then one safe vertical exhale ride. | 2 | 5 |
| 4 | The Sepulchre *(quiet / lore)* | The truth, told in the last rubbings: the Lamp, the stilling, the Mason. Statues of Lanternwrights holding up the roof. | 1 | 4 |
| 5 | The Heartwell | The last descent, into a 160 m spherical cavity. **The Mason returns**, wounded and missing limbs. Its gait is now irregular, so its rhythm is hard to predict. **Escape-grade hunt.** | 4 | 6 |
| 6 | The Socket | Hold the Lamp into the socket for 3 s (E13) while its crown rises over the rim. The stillness begins. | 5 | 1 |
| 7 | **THE STILLING** | The finale (below). | 5 | 5–7 |
| 8 | Epilogue: Still | Climb the petrified Mason by its rings, the light rising past you, credits over the climb. | 1 | 3 |

**FINALE: THE STILLING** *(about 2.5 min of peak, ascending 280 m)*
- **Setup:** the socket accepts the Lamp. A pulse of white light spreads across the Heartwell floor and begins to climb.
  The Mason, coiled in the depths below, flees upward ahead of the light. You are directly in its way. The only way out
  is **up the First Throat** (the Lanternwrights named Chapter I's "Last Throat" before they found this one), a ribbed
  vertical shaft that breathes.
- **Three bodies:** you on top, the Mason in the middle, and the stillness front at the bottom. The front rises at 70 % of
  the Mason's speed, so it falls behind it. You have to out-climb the Mason until the stillness catches it.
- **Beats:**
  1. *Ride the exhale.* Release on every exhale (an updraft that sends you up about 30 m per breath). Tether and hold on
     every inhale. The throat ribs contract on the inhale (moving solids, never narrower than 6 m) and expand on the
     exhale. Reel up ring by ring between breaths.
  2. *Below you.* The Mason climbs with the escape profile from below, and its lunges are telegraphed upward. Looking
     down the throat you see its crown, then the light far below it, gaining.
  3. *The last breath.* 40 m from the top, the stillness reaches the throat's "lungs" and **the breathing stops**. No more
     updrafts. The last 40 m is pure tether work: fire, reel, fire, reel, with the Mason right behind you.
  4. *The freeze.* When you reach the top ring, the stillness surges and catches the Mason **mid-lunge**: the crown
     freezes with its fronds a metre below your boots, the pits fading from glow to stone. This is a guaranteed scripted
     near-miss timed to your arrival.
- **Epilogue:** silence. You hang above the petrified predator as the stillness light keeps rising, up past you and
  through the whole Underspire above, lighting it warm white for the first time. The last climb is **up the Mason's own
  back**, ring by ring ("trust the ring"), to a ledge where the final rubbing waits: "HERE THE DESCENT ENDS. THE STONE IS
  STILL." Credits roll while you can still move and look around.
- **Difficulty:** Mason speed and lunge rate follow the escape presets. Exhale lift 30 / 26 / 22 m per breath. Throat
  checkpoints 2 / 1 / 0 (at heights 100 and 200 m).

**Creature beats:** absent (S1–4, signs only) → returns wounded (S5) → at the socket rim (S6) → **upward pursuit** (S7) →
petrified (S8).

**Second danger:** the stone itself (growing passages, the contracting throat, the inhale).

**Collectibles:** 6 votives (the last lights the Heartwell rim) and 6 rubbings, which complete the Codex. Finding all
30 votives adds an epilogue detail: every votive you lit appears as a star in the rising light.

**Length:** 30–36 min.

---

## 4. The demo hook: The Lid (end of Chapter I)

The demo has to end with something nobody wants to stop at. It runs as one unbroken, in-engine sequence of about
2–3 minutes, and the player never loses control.

1. **The slam (existing).** You sprint through the grate and it slams behind you. The Mason's crown hits the bars and its
   fronds reach through, then withdraw. Silence. *Relief.*
2. **The chamber (quiet, 20–60 s).** Warm light. Lanternwright statues. The **Still Lamp** stands in its cradle on a
   plinth in the middle of a round iron floor. A new plaque reads "LEAVE IT. IT HOLDS MORE THAN LIGHT." In the Lamp's
   light, carvings on the walls show five strata, the Underspire being only the first, which quietly advertises
   Chapters II–V. If the player waits longer than 60 s, the flame leans toward them.
3. **The lift.** Grip near the Lamp for 1 s (E13). It replaces your lantern in your left hand. **Its flame does not move**
   when you move your hand (it is locked to world vertical and never flickers), which looks wrong in an unsettling way.
   The chamber's lamps go out one by one.
4. **The knocking.** One knock from inside the wall. Then three. Then all around you, spatialised (HRTF). The wall's
   masonry plates **breathe**: movers of 5 cm. The walls are the Mason's coils, held still by the Lamp until a moment
   ago.
5. **The Lid opens.** The iron floor is an eight-leaf iris. Each leaf drops 0.3 m with a clank (warned), and a single ring
   on the cradle chain above lights up. Hint, first time only: "Hold on to something." The leaves fall away into an
   **ember-lit gulf** with the silhouettes of vast furnaces far below (Chapter II's palette, previewed). If you miss the
   ring: on Normal a catch ring 20 m below saves you; on Nightmare and Abyss you retry from the chamber in under 10 s.
6. **The unspooling.** You hang from the chain. The walls slide **down** past you: the Mason's body pours off the chamber
   into the gulf, the collision walls switching off as its path starts. **Its crown passes you last, 3 m away.** Its
   fronds turn to the Lamp in your hand. It stops for two heartbeats, recognising the Lamp, then drops away into the
   glow. Its tail drags past for 6 s.
7. **The lean.** Silence. **The flame that never moves leans down**, toward where the Mason went. The cradle chain starts
   paying out in jerks (step mover), lowering you toward the fire.
8. **The end card (demo build).** The view fades softly to black around you while you keep lowering. A carved stone panel
   appears: *"I — THE UNDERSPIRE · 556 m."* Your time, deaths and votives. Then: *"The descent continues. II The
   Kilnworks · III The Drowned Choir · IV The Hanging City · V The Heartwell. 2,470 m. About two more hours."* Buttons:
   **[Continue the descent: $9.99]**, [Replay Chapter I: Normal / Nightmare / Abyss], [Menu].
9. **After purchase: seamless.** The black lifts and you are still on the chain, still lowering. Chapter II's data module
   was preloaded during the hook, so there is no loading screen. A carved title card, *"II — THE KILNWORKS"*, drifts up
   out of the dark. Full-game owners never see the end card; they get only the title card.

**Why it sells:** it reframes everything the player just survived (*you were inside it the whole time*), hands them the
thing the predator wants, shows the next environment's colour, and ends on a question the flame itself is pointing at.

**What the demo contains:** all of Chapter I on Normal, Nightmare, Abyss and Sandbox; best times and feats; 6 votives and
8 rubbings. The demo is a complete, replayable product, which matters for store reviews and for speedrunners spreading
the word.

**Chapter I polish list (set-piece lens):** (1) the first 60 s as the trailer opener: the colossus through the window,
the first swing; (2) the Vault sighting tuned as a wonder beat; (3) the Spiral creature-path upgrade; (4) gate-slam
timing (within 1 s of crossing); (5) the Lid sequence; (6) votives and rubbings; (7) a pass on length, checkpoints and
hints to land 22–30 min for a first-time player; (8) the Ch. II preload and the purchase hand-off.

---

## 5. Progression and replay

- **Save and continue.** Continue resumes at the last checkpoint in any chapter. Chapter select unlocks as you go.
  Difficulty is chosen per chapter; the chapter's records are kept separately for each difficulty.
- **Full Descent.** Unlocked after finishing Chapter V: all five chapters as one continuous run with one timer. This is
  the speedrun category, with splits per chapter.
- **Lamp medals.** Each chapter has three time targets per difficulty (bronze, silver and gold lamps). Gold Abyss is for
  experts only.
- **Feats** (3 per chapter, 15 in total), each one a way of playing a set-piece differently. Examples: *Under the Deck*
  (finish the Gantry Run without touching the deck), *Silent Sounding* (never heard by the Mason in III-7), *Featherweight*
  (ride the Mason without a single shudder), *Weightless* (touch three falling houses during Lampfall), *Last Breath*
  (finish the Stilling without riding an exhale), *Lamplighter* (all votives in a chapter).
- **Collectibles.** 30 votives (lit with your lantern; they stay lit forever, across runs) and 32 rubbings (the Codex, a
  lore book in the pause menu). Each sits behind an optional traversal risk, so collecting them is a skill challenge, not
  a scavenger hunt.
- **Ghosts.** Your best run in each chapter replays as a faint phosphor figure with its ropes, so you can race yourself
  (E16).
- **Pilgrim mode** (new game plus, after the credits). No hints, darker lighting, the Mason one difficulty step more
  aggressive, votives already lit as your guide lights. For a second playthrough.
- **Sandbox per chapter.** No predator and no lethal falls, with mover and sequence controls (pause the gantry, replay
  Lampfall). Good for practice and for content creators.
- **Kept out of scope:** combat, inventory, crafting, upgrades, RPG stats. *Optional, low priority:* cosmetic lantern
  cages for chapter feats, local-only.

---

## 6. Engine extensions (precise)

Ground rules carried over from CONTRACT3D: `src/sim/**` and `src/data/**` stay DOM-free and three.js-free, there is no
per-frame allocation in hot loops, physics is fixed-step at 240 Hz, everything stays deterministic so the level agent's
waypoint bot can verify every route, and the Quest budget is ≤ 150 draw calls and ≤ 350k triangles.

**Deliberately not built:** rotating colliders (collision stays AABB, and movers only translate), ropes that wrap around
geometry, fluid simulation, physics-driven debris piles, cutscenes or camera control, combat, any story that depends on
voice-over.

**Owners:** these touch files currently being polished by other agents (`physics3d.js`, `level3d.js`, `creature3d.js`,
`game.js`, render, audio). They are **specifications to schedule after that pass**; this pitch edits no code.

### Summary

| ID | Extension | Size | Needed by |
|---|---|---|---|
| E1 | Kinematic movers (`movers[]`): path, pendulum, orbit, ballistic, steps, pulled, follow | M | I (Lid), II–V |
| E2 | Physics: moving contacts (carry, relative-velocity impacts, momentum inheritance, crush) | M | II–V |
| E3 | Rope: moving anchors, elastic catch, rope-cutting movers | S | I (Lid), II–V |
| E4 | Level3D: dynamic solid, anchor and hazard sets; section-scoped activation | S | II–V |
| E5 | Volumes: water, air, force (with schedules), skydive, heat, dark, quiet/echo | M | II–V |
| E6 | Swimming and mantle; `intent.move.y` | S | III |
| E7 | Light model and lantern shutter input | S | III (and votives everywhere) |
| E8 | Noise system and the creature's INVESTIGATE behaviour | M | II (masking), III, IV |
| E9 | Creature v2: modes `path`, `waterline` and plunge, `carry` (rideable), `fall`, `ascend`, `petrify`; back-ring anchors; per-chapter SEG | L | I (Spiral, Lid), II–V |
| E10 | Wick swarm agents | M | III |
| E11 | Sequences and triggers v2 (conditions, actions, checkpoint snapshots) | M | I (Lid), II–V |
| E12 | Collapse front (rubber-banded destruction wave) | S | II |
| E13 | Interactables: Lamp pickup and socket, votives, rubbings, levers | S | I–V |
| E14 | Chapter framework: registry, lazy load, transitions inside a live XR session, saves | M | all |
| E15 | Entitlement and in-app purchase (demo vs full) | M | release |
| E16 | Ghosts, feats, medals | S–M | replay |
| E17 | Renderer: water, underwater mode, dynamic instancing, Wicks, stillness uniform, lichen sky, chapter themes | L | II–V |
| E18 | Audio: underwater filter, reverb zones, bells, machinery, Wicks, breath, adaptive score stems | L | II–V |
| E19 | Verification harness: movers, volumes, set-piece fairness simulations | M | all |

*S ≈ under a week, M ≈ 1–2 weeks, L ≈ 3+ weeks of focused engineering.*

### E1. Kinematic movers: new `src/sim/movers3d.js`

```js
movers: [{
  id: 'k2-trolley-3',
  parts: ['solid:k2-bucket-3', 'anchor:k2-hook-3', 'hazard:...', 'volume:...', 'decor:...'],
  motion:
      { type: 'path', points: [[x,y,z], ...], legs: [{ dur, hold, ease: 'linear'|'smooth' }], loop: 'once'|'loop'|'pingpong' }
    | { type: 'pendulum', pivot: {x,y,z}, length, axis: 'x'|'z', amplitude, period, phase,
        driven?: { damping, gain } }          // parallel-link: parts TRANSLATE along the arc, never rotate
    | { type: 'orbit', centre: {x,y,z}, radius, plane: 'xy'|'yz'|'xz', omega, phase }   // parts keep orientation
    | { type: 'ballistic', v0: {x,y,z}, drag, terminal, stopAtY? }
    | { type: 'steps', steps: [{ at, dx, dy, dz, dur }] }     // lurches, stair-step drops, tilting spans
    | { type: 'pulled', path: [[x,y,z], ...], pullAnchor: 'id', gain, returnSpeed }   // yank-driven
    | { type: 'follow', mover: 'id' } | { type: 'follow', creatureSeg: i },
  start: 'auto' | 'trigger',
  cutsRopes: false, noCarry: false, wobble: 0,   // wobble = cosmetic render-only rotation (deg), bells ≤ 25
}]
```

- `MoverSystem.step(dt)` runs **first** in each physics step. It translates each part's stored base box or anchor by the
  mover's offset and writes `vx, vy, vz` on the part. **Collision never rotates.**
- Determinism: `path`, `orbit`, `pendulum` (undriven) and `steps` are pure functions of mover time. `driven`, `pulled`
  and `ballistic` integrate at the fixed step. All of them snapshot to `{t, state, s, θ, θ̇, pos, vel}` for checkpoint
  restore.
- Driven pendulum (swaying houses and bells): θ̈ = −(g/L)·θ − c·θ̇ + k·F, where F is the player's weight while grounded
  on the part plus yank force while tethered to it.
- Pulled: when the player yanks a tether attached to `pullAnchor`, the path parameter advances by
  `gain · yank · dt`, and returns at `returnSpeed` when not held (drawbridges, dampers, crucible tips, the Tenor's
  clapper).

### E2. Physics3D: moving contacts

- **Order per step:** movers → forces (gravity and volumes) → integration → ropes → collisions → hazards → bookkeeping.
- **Carry:** if `player.groundSolid` belongs to a mover (and not `noCarry`), add that part's displacement for this step
  to the player before integration. Running and braking target `v_platform + v_run`.
- **Relative velocity:** contact response and lethality use `vn_rel = (v_player − v_solid)·n`. Only the relative normal
  component is removed. Landing on a falling slab at matched speed is gentle, and a hammer moving toward you hits hard.
- **Momentum inheritance:** this falls out of the above. Leaving a moving platform keeps the absolute velocity, which
  already includes the platform's.
- **Crush:** after the three resolution passes, if any active solid still overlaps by more than 0.6 r and opposing
  contact normals dot below −0.5, call `kill(player, tethers, 'crush')`. *Design rule:* on Normal no mover closes a
  player-accessible gap below 2 m without a warning of at least 1.5 s.
- New death causes: `crush`, `drown`, `burn`, `smothered` (each with UI text and audio).

### E3. Rope3D: moving anchors, elastic catch, rope cutting

- Anchors gain `vx, vy, vz` (zero for static ones). `constrain()` projects onto the anchor's **current** position. Radial
  speed is measured relative to the anchor, `vr = (v_p − v_a)·n`, and only outward relative speed is removed. Tension
  uses the relative v². `reel()` uses relative tangential velocity for its angular-momentum gain.
- **Elastic catch** (`CONFIG.rope.catch = { speed: 14, stretch: 0.12, time: 0.25 }`): when `vr` exceeds the catch speed,
  the rope may overstretch by up to 12 % of its length and removes `vr` through a critically damped spring over about
  0.25 s instead of in one step. Emits `rope:catch`. Used by Lampfall's net and every high-speed arrest; it also makes the
  existing S6 east column feel better.
- **Rope cutting:** movers flagged `cutsRopes` (falling gantry decks, the Mason's flailing limbs in Lampfall) run a
  segment-vs-box test against each attached rope every step and sever it with release reason `'cut'`. The test runs only
  for flagged movers, so its cost is bounded.
- If a moving anchor pulls away beyond the rope's length, the rope drags the player. This is the ride, and it needs no
  special case.

### E4. Level3D: dynamic sets

- `dynamicSolids`, `dynamicAnchors`, `dynamicHazards` and `volumes` lists. `querySolids`, `queryHazards`, `anchorsNear`,
  `segmentBlocked` and `raycast` append dynamic objects through a linear AABB test (≤ 64 per list in any active window),
  so targeting, line of sight, lasers and the creature all see movers automatically.
- **Section-scoped activation:** movers, swarms and volumes outside the current section ±1 are frozen and skipped, both
  for performance and for determinism.
- Data: a chapter module exports `LEVEL_DATA_3D`-shaped data plus `movers`, `volumes`, `swarms`, `sequences`, `fronts`
  and `interactables`. `inVariant` filtering applies to all of them.

### E5. Volumes: new `src/sim/volumes3d.js`

`volumes: [{ id, box, kind, ...params, schedule?: { period, phases: [{ dur, scale }] } }]`. They are queried once per
step at the player's position (Y-bucketed like solids).

| Kind | Parameters (Normal defaults) | Effect |
|---|---|---|
| `water` | `surfaceY` (may be animated), `buoyancy` +1.5 m/s² net, `drag` 2.2/s, `swimAccel` 6, `swimMax` 3.0, `reelMul` 0.6, `safeDepth` 2.5, `noiseMul` 0.3 | Replaces gravity with net buoyancy, adds linear drag and swimming. An impact is non-lethal when the water below the entry point is at least `safeDepth` deep. Entry speed × 0.35 (splash). Sets `inWater` and `submerged` (head below the surface; head = body + 0.5 m). |
| `air` | `refill` 25 %/s | An air pocket inside water. Refills breath. Wicks avoid it. |
| `force` | `accel {x,y,z}`, `vMax` along the accel, `schedule` | Updrafts (`accel.y` 18, vMax 6), the breath cycle (exhale +20 / inhale −6 on a 9 s period), wind gusts (lateral, noise-shaped schedule), drain currents. Anchors are unaffected. |
| `skydive` | `terminal` 30, `airAccelMul` 2.0, `aimAssistMul` 1.5 | Quadratic drag gives terminal velocity; stronger lateral control; wider targeting. |
| `heat` | `rate` 1/6 s (Nightmare 1/4.5, Abyss 1/3.5), `decay` 0.5/s, `avoid: true` | Builds `player.heat` from 0 to 1, death `burn` at 1. The creature's steering treats it as blocked while active. |
| `dark` | `ambient`, `fog` overrides | Renderer and audio only. Sets `player.inDark`. |
| `quiet` / `echo` / `mask` | `noiseMul` 0.5 / 2.0 / 0 (`mask` scheduled on the hammer beat) | Multiplies noise events (E8). |

Breath: `player.breath` runs from 1 to 0 at `1/breathTime` per second while submerged, giving death `drown`. Breath time
is per difficulty (30 / 24 / 18 s).

### E6. Swimming, mantle, intent

- **Contract change:** `intent.move = { x, y, z }`. `y` is head pitch × stick magnitude, plus a stroke from A (+1 for
  0.4 s) while in water. On desktop, Space and Ctrl give vertical movement in water. Outside water `y` is ignored.
- **Mantle assist:** at a water surface, or with chest against a ledge whose top is ≤ 0.9 m above the body, A lifts you
  on in 0.35 s, a translation-only climb. It is useful everywhere and required for leaving water.
- Jumping is disabled while submerged. Ropes behave as usual, and the reel uses `reelMul`.

### E7. Light and the lantern shutter

- `player.light` (0–1), damped. States are `open` and `shuttered`.
- XR: the shutter is the lantern hand's grip pose held within 0.22 m of a chest point (0.3 m below and 0.1 m in front of
  the head) for 0.15 s, **or** a click of the left stick. Desktop: hold Q. **Contract change:** `intent.lantern =
  { shutter: bool }`.
- Readers: the renderer (lantern intensity; markers stay readable), Wicks, votives (lit by `light` above 0.5 within
  0.5 m of the wick for 1 s), and the Still Lamp's look (no flicker, world-vertical flame).

### E8. Noise system: new `src/sim/noise3d.js`, plus creature INVESTIGATE

- A ring buffer of the last 16 events `{x, y, z, loudness, t}`, fed from bus events. Loudness: `player:land`
  (impact/lethal ratio), `player:wallhit`, `rope:jolt`, yank (0.25/s while grip > 0.5 on a tethered hand), reel (0.1/s),
  `platform:crumble`, bell rings (0.4–1.0), splash (entry speed / 20), Wick keening (0.35/s each), sequence cues. Each is
  multiplied by the `noiseMul` of the volume the event happened in.
- The creature hears an event if `loudness / (1 + d / hearRange) > threshold[diff]`. A heard event triggers
  **INVESTIGATE**, a variant of OBSERVING: the head travels to the noise point at approach speed and listens for 3–6 s
  with its pits lit (the existing listen and creep logic), then returns to its mode. Bell-gallery stealth, the Sounding
  plunge, ride shudders and noise masking all build on this.

### E9. Creature3D v2

- **SEG per chapter** (default 20; 28 in IV and 36 in V). CreatureView adds an LOD, instancing distant segments.
- **New modes** (section `creature.mode`, or set by sequences):
  - `path`: follows a scripted spline `[{x, y, z, speed, hold, listen, look: 'player'|'lamp'}]`. The head follows the path
    and the body follows the existing breadcrumb trail. Used for the Spiral descent, the Lid unspooling, the gantry ride
    and the Keel crawl. It generalises today's straight-line sighting.
  - `waterline`: hunts with the head kept at or above a water `surfaceY`. The **plunge** action lowers the head down a
    vertical line toward a noise point to depth `d` over `t` seconds, listening, then retracts. The kill radius applies.
  - `carry` (rideable): `path` plus active **back-ring anchors** and the ride rules (noise produces a shudder: a scripted
    heave applied to the back-ring anchors; a frond sweep travels tail-ward along `body.focus`; the third shudder scrapes
    rings on segments i..j, setting them inactive for 3 s). The kill radius applies **only around the head**.
  - `fall`: ballistic body with flailing limbs. Limb boxes are `cutsRopes` movers. No kill radius.
  - `ascend`: pursuit from below. Spawns below the player, and the menace distance is measured upward. Reuses
    `_steerHunt`'s `below` handling with the sign flipped.
  - `petrify`: a front `f` runs 0 → 1 from tail to head, and `body.stone[i]` goes 0 → 1. A segment at stone = 1 freezes,
    emits a static solid (a box around the spine point, half-size `scale[i] × 1.2 m`), and turns its back-ring into a
    static anchor. Frozen segments never kill.
- **Back-ring anchors:** `anchors` with `mount: { creature: 'mason', seg: i, offset }`. Position = a smoothed spine point
  (critically damped spring at 6 Hz, removing gait hitches) plus `up[i] · (scale[i]·0.9 + 0.25)`. Velocity comes from the
  spring. They are targetable only in `carry` and `petrify`.
- **Heat avoidance:** `heat` volumes with `avoid` count as blocked in `_detour` and steering.
- **New `body` outputs:** `stone` (Float32Array), `rings` (positions and active flags), `wet` (0–1, drips after a plunge).

### E10. Wick swarm: new `src/sim/wicks3d.js`

- Data: `swarms: [{ id, volume: 'water-id', count, home: box, senseRange: 14, speed: [1.6, 2.0, 2.4], latchRange: 0.7 }]`.
  At most 24 agents per chapter, using preallocated typed arrays.
- States: drift (wander around home) → seek (`player.light` > 0.35 within range; a lit votive in range takes priority when
  `light` < 0.8) → latched (sticks to the player and dims `light` by ×0.5 each) → scatter (after a 2 s shutter, a yank, or
  speed > 6 m/s for 0.3 s). Three or more latched for `smotherTime` (4 / 3 / 2 s) gives death `smothered`.
- Outputs `agents` (position, glow, state) for one instanced draw, and keening noise events.

### E11. Sequences and triggers v2: new `src/sim/sequences3d.js`

- Today's triggers fire once when the player drops below a Y. New trigger conditions: `{y}` (kept), `{enter: boxOrVolumeId}`,
  `{attach: anchorId}`, `{interact: id}`, `{after: seconds, since: sequenceId}`, `{noise: loudness}`,
  `{creatureNear: metres}`, `{progress: frontId, s}`.
- Actions on a timeline: `mover.start/stop/reverse/set`, `solid.activate/deactivate/fall` (turns a solid into ballistic
  debris), `anchor.break/activate`, `volume.enable/disable/surface(y, dur)`, `creature.mode/path/action`, `swarm.wake`,
  `light.on/off`, `audio.cue`, `hint`, `rumble`, `checkpoint`, `chapterEnd`.
- **Checkpoint snapshots:** on respawn, sequences that started before the checkpoint are fast-forwarded to their end
  state, and those after it are reset. Movers restore from their E1 snapshot. This keeps the 10 s retry rule even after
  the world has been rearranged.

### E12. Collapse front: part of E11

`fronts: [{ id, route: [[x,y,z], ...], speed: { base, gain, targetGap, min, max }, warn: 0.7, tag: 'gantry' }]`.

- Every solid, anchor and hazard tagged `collapse: 'gantry'` has its arc-length `s` along the route precomputed. The
  player's `s_p` is their projection onto the route.
- Each step: `v_f = clamp(base + gain·(gap − targetGap), min, max)`, where `gap = s_p − s_f`. At `s_f + warn·v_f ≥ s_obj`
  it emits `platform:warn` (shake, dust, creak). At `s_f ≥ s_obj`, solids become ballistic `noCarry` debris and anchors
  break.
- The front never kills directly. Players die from the fall, which keeps recovery possible: hooks ahead of the front
  remain.

### E13. Interactables: new `src/sim/interact3d.js`

`interactables: [{ id, kind: 'lamp-pickup'|'socket'|'votive'|'rubbing'|'lever', x, y, z, radius: 0.35, hold: s }]`.

- XR: grip with the hand inside the radius (votives: the lantern inside the radius). Desktop: hold E while looking at it
  within 2 m.
- Emits `interact:start/progress/done`, which drive sequences, the Codex and saves.

### E14. Chapter framework and saves

- A registry `src/data/chapters/index.js`: `{ id, name, load: () => import('./ch2-kilnworks.js'), depthOffset,
  entitlement: 'demo'|'full', theme, creatureConfig }`.
- `Game.loadChapter(id)`: dispose LevelView geometry, keep shared materials, build a new `Level3D` and creature, and
  **keep the XR session and animation loop alive**. Transitions are diegetic (lowering on a chain in darkness), so assets
  stream while the player is still in control.
- Saves (`Storage`, plus IndexedDB for ghosts): `{ chapter, sectionIndex, sequenceSnapshot, collectibles: { votives[],
  rubbings[] }, perChapter: { difficulty → best, medals, feats }, entitlementCache, settings }`.

### E15. Entitlement and in-app purchase: new `src/meta/entitlement.js` (outside sim)

- A store adapter: inside the Horizon Store PWA container, use the store's supported web purchase path for the
  `full_game` SKU (Digital Goods API plus Payment Request, **to be verified for Quest PWAs at M0**). The entitlement is
  cached for offline play. The demo build shows the end card.
- Chapters II–V ship in the same build (the PWA cache), gated by entitlement. A `?unlock=dev` flag works in debug builds
  only.

### E16. Ghosts, feats, medals

- A recorder at 20 Hz: position as Int16 deltas, plus anchor ids and rope lengths per hand. The best run per chapter and
  difficulty goes to IndexedDB (about 150 KB per 10 minutes).
- Ghost playback renders a translucent figure and its ropes in 2 draw calls. Feats are predicates over bus events and are
  evaluated at chapter end.

### E17. Renderer extensions

- **Water:** one surface plane per volume (a scrolling normal map with depth fade through fog, no reflection pass, no
  render targets). **Underwater mode:** when the head is below `surfaceY`, switch fog and colour and add a cheap caustic
  flicker on the lantern light.
- **Movers:** an InstancedMesh per kit with per-frame matrices for moving parts only; static otherwise. Bells may use a
  cosmetic `wobble` rotation.
- **Wicks:** one InstancedMesh, additive emissive, one draw call.
- **Stillness and petrify:** a shared uniform `uStillY` (world height plus band width), injected with
  `onBeforeCompile` into the rock, masonry and creature materials: warm-white emissive and desaturation below the height.
  The creature uses the per-segment `stone` attribute.
- **Lamp-lichen sky:** one large emissive dome with sparse point sprites (one or two draws).
- **Lampfall:** at most 8 instanced kits and at most 300 falling instances, with only 16 of them collidable or rideable.
- **Chapter themes:** fog, palette, light rig and far-structure kit load with each chapter. At most 4 dynamic point lights
  plus the lantern; everything else is emissive.

### E18. Audio extensions

Underwater low-pass (about 600 Hz while submerged) with a pressure bed. Procedural reverb per chapter (`ConvolverNode`
with generated impulse responses: foundry 2.5 s metallic, cistern 6 s, gulf 9 s open air, throat 3 s organic). Modal bell
synthesis (5–7 inharmonic partials, pitch by bell size). Machinery loops. Wick keening (glassy FM tones). A breath-cycle
telegraph 1.5 s ahead. A shared haptic vocabulary (§8). Adaptive score stems (§8).

### E19. Verification harness

The existing waypoint bot (real `Physics3D` plus `TetherSystem`) is extended to wait for mover phases, to swim and ride
volumes, and to run **fairness simulations** for each set-piece on every variant:

- **Gantry Run:** a bot at 75 % of the optimal line survives on Normal; a bot that stalls 3 s dies.
- **The Sounding:** each leg can be completed with at least 30 % breath left on Normal, with the plunge included.
- **Lampfall:** from every Phase B position, at least one net ring is in range and line of sight before the net plane.
- **Beneath the Mason:** a silent ride arrives over the far roofs. A two-ring hold survives a scrape.
- **The Stilling:** a bot that catches every exhale stays at least 12 m above the Mason on Normal. A bot that misses two
  exhales is caught.
- **All chapters:** "the next anchor is visible from the last one" (line of sight plus marker range) along every main
  route, with the lantern shuttered.

### Build order (milestones)

| M | Deliverable | Extensions |
|---|---|---|
| M0 | **Demo-ready Chapter I:** Spiral polish, the Lid, votives and rubbings, chapter framework, the purchase spike on a Quest device | E1 (steps, path), E3, E9 (`path`), E11, E13, E14, E15 |
| M1 | **Chapter II**, starting with a **graybox of the Gantry Run in week 1** | E1 (all), E2, E4, E5 (force, heat, mask, basic `water` for the Quench), E6 (mantle), E8, E12, E19 |
| M2 | **Chapter III**, Sounding graybox first | E5 (water, air, dark), E6, E7, E9 (`waterline`), E10, E17 (water) |
| M3 | **Chapter IV**, Ride and Lampfall prototypes first | E9 (`carry`, `fall`), E5 (skydive), E3 (catch, cut), E17 (instancing, sky) |
| M4 | **Chapter V** and the ending | E9 (`ascend`, `petrify`), E17 (stillness) |
| M5 | Polish, performance, certification, store assets, Pilgrim mode, ghosts | E16, E18 (score), perf gates |

**Cut list, in order, if time runs short:** Pilgrim mode → ghosts → the Orrery section (IV-6) → the Pattern Hall
section (II-4, folded into II-3) → cosmetic rewards. **Never cut:** any set-piece, the Lid, or the second dangers.

---

## 7. Art needs

### 7.1 Global
- **Still Lamp** hero asset: a pale iron cage and a flame shader that is world-locked, never flickers and gives soft
  light. **Votive** (unlit and lit) and **rubbing plate** props.
- **Mason additions:** riveted back plates with phosphor rings (kit variants), a wounded variant (missing limbs, cracked
  plates), a petrified material ramp, a wet sheen with drips, a longer body (SEG up to 36) with LOD.
- **UI:** carved-stone chapter cards, the diegetic end card and store panel, the Codex book, medal and feat glyphs, a
  breath bead and heat glow on the wrist HUD.

### 7.2 Per chapter
| Ch | New texture sets | Kits and props | VFX | Lighting and sky |
|---|---|---|---|---|
| I | none | Lid iris (8 leaves), wall-coil plates, Kilnworks silhouettes for the gulf | ember glow from below | the Still Lamp's light, chamber lamps going out |
| II | firebrick, hot iron (emissive mask), slag glass, sooty timber | gantry truss modules (beam, deck, rail, trolley, hook), crucibles, kilns and flues, drop hammers, pistons, pattern molds (instanced), quench pool, furnace far-towers | rising embers (GPU points), sparks, heat-shimmer cards (no post), slag ribbons | 2 kiln point lights, emissive everywhere else |
| III | bronze/verdigris, wet stone | bells in 5 sizes with yokes and clappers, cistern columns, flooded nave arches, sluice gate, culvert, sunken bells with air pockets | bubbles, silt motes, drips, splashes, Wick filaments (translucent, emissive) | lantern only, Wick glow, algae decals |
| IV | timber, slate, canvas, rope | 6 hanging-house modules with roofs, market stalls, rope bridges, Keel truss, Orrery arms and rings, the Catch-Net, pre-fractured house pieces | wind dust, falling-debris dust trails, cloth sway (vertex shader) | lamp-lichen sky dome, rust-gold dead lamps |
| V | living stone (masonry/flesh blend), crystal veins, bone | Heartwell sphere segments, the socket altar, breathing throat ribs, Sepulchre statues | breath dust streams, the stillness wave (shader), petrification spread | the socket's heart-pulse, the rising warm-white stillness |

### 7.3 Budgets
Every set-piece stays within ≤ 150 draw calls and ≤ 350k triangles **at its worst moment** (gantry mid-collapse,
Lampfall phase B). Textures at most 1024² per chapter set. Performance is gated on a Quest 3 at 72 Hz minimum, 90 Hz
target.

### 7.4 Store assets (studio-level presentation)
A 60 s trailer and a 30 s cut built from the set-piece shots (in order: the first swing and the colossus, the Vault
sighting, the gantry falling behind you, the crown in the black water, hanging beneath the Mason, weightless among
falling houses, the crown freezing below your boots). Plus cover and hero art, at least 6 in-headset screenshots and the
icon set.

---

## 8. Audio needs and haptics

- **Beds per chapter:** foundry roar and machine rhythm (II). Dripping, pressure and distant bells (III). Wind, creaking
  chains and the lichen's faint high hiss (IV). A slow organic heartbeat-breath in the stone (V).
- **Signature sounds:** the gantry's metal groan cascading **behind** you (HRTF). The Tenor bell (the loudest sound in
  the game). The Mason's crown entering water. Its plates grinding overhead while you ride. The Lampfall roar dropping
  away to a hush at the net. The breathing cycle's inhale and exhale (warning 1.5 s ahead). The stillness wave, a rising
  chord that removes the noise floor as it passes.
- **Score:** an **original adaptive score** in stems per chapter: dread (drones), pulse (pursuit), a bespoke cue for each
  set-piece synced to its sequence timeline, and release. Commissioned or made in-house, streamed per chapter (about
  15–25 MB total Opus/AAC). Procedural SFX stay as they are.
- **No voice-over required.** Rubbings are text. Optional whispered readings could come later.
- **Haptic vocabulary:** attach click, tension hum, a mover's rumble through the rope, the Mason's footsteps through the
  rope (IV-5), bell strikes, a breath-low pulse, heat crackle, the net catch (a long squeeze), the freeze (one beat, then
  nothing).

---

## 9. Risks and mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Scope.** Four new chapters is about four times Chapter I's content, plus 19 engine extensions. | High | Milestone order (§6). A graybox of each set-piece in the first week of its milestone. Kit reuse. The cut list. Set-pieces are never cut. |
| 2 | **IAP for a WebXR PWA** on the Horizon Store is unverified (API support, review policy). | High | A purchase spike on a device at M0. Fallbacks: a paid app with a separate free demo listing, or the store's current recommended web-purchase path. Decide before Chapter II production. |
| 3 | **Quest performance** in the heaviest moments (gantry collapse, water, Lampfall). | High | Hard budgets for each set-piece, instancing, LOD, section-scoped simulation, device perf gates every milestone, a pre-fractured debris pool (no runtime fracturing). |
| 4 | **Motion intensity** (riding, free-fall, updrafts) with no comfort options. Refund and review risk. | Med-High | Owner decision respected. Design rules: no forced rotation, stable horizon, motion always player-initiated, short peaks with long valleys. "Intense" comfort rating and clear store copy. Playtest drop-off tracked per set-piece. |
| 5 | **Riding the creature** (anchor jitter, the body intersecting the player, unfair kills). | Med | Smoothed back-ring anchors (E9), head-only kill radius, a prototype at the start of M3, fairness sims. |
| 6 | **Readability in total darkness** (Chapter III). | Med | Phosphor markers exempt from fog, the "next anchor visible" bot check with the lantern shuttered, an Abyss-only darker variant. |
| 7 | **Water feel** (floaty or frustrating). | Med | Simple arcade buoyancy, reel-down as the main descent verb (not swimming), tuning on a device. |
| 8 | **Determinism and checkpoint restore** with a world that rearranges itself. | Med | Movers as pure functions of time where possible, sequence snapshots (E11), bot replays as regression tests. |
| 9 | **Set-piece difficulty spikes** for first-time players. | Med | Rubber-banded fronts, mercy rules (the plunge withdraws early, the Stilling's freeze is guaranteed), checkpoints right before, 10 s retry. Target: a median of 3 or fewer deaths per set-piece on Normal. |
| 10 | **Memory and streaming** inside a live XR session between chapters. | Med | Disposal discipline, per-chapter texture sets, preloading during diegetic lowering transitions, a long-session soak test on device. |
| 11 | **Audio and music budget** for a studio-level bar. | Med | Keep SFX procedural. Spend on score stems and set-piece cues only. |
| 12 | **Originality** of names, creatures and set-pieces. | Low-Med | Original lore and names throughout. An IP review pass against other grappling and horror titles before marketing. |
| 13 | **Piracy** of a web build. | Low | Entitlement gating, chapter data loaded on demand. Acceptable at $9.99. |
| 14 | **VR playtesting throughput.** | Med | Desktop parity for iteration, a scripted playtest plan, local telemetry (deaths per section, time per section) exported from the debug API. |

---

## 10. Open questions for the owner

1. **Purchase path:** if PWA in-app purchase turns out to be unavailable, which do you prefer: a paid app with a separate
   free-demo listing, or a web checkout?
2. **Release cadence:** ship the Chapter I demo early (wishlists and feedback) while II–V are built, or launch them
   together?
3. **Leaderboards:** local only (no backend, which is today's architecture), or add a small leaderboard service for Full
   Descent and Abyss times?
4. **Cosmetic lantern rewards for feats:** yes, or keep rewards strictly to records and lore?
5. **Localisation at launch:** English only, or the top store languages? Text lives in data, so it is cheap to add.
