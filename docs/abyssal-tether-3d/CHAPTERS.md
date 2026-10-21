# ABYSSAL TETHER: Production Bible (five chapters)

> Owner: creative director. Status: **approved design for production**, synthesised from the three pitches in
> `pitches/` (set-pieces, systems, narrative) and the three judges' reviews. Date: 2026-10-19.
> Product: Meta Horizon Store, immersive WebXR PWA, three.js r170, no Unity. **Chapter I is a free demo; one $9.99
> durable add-on (`abyssal_tether_full_game`) unlocks Chapters II–V.** Full 3D movement, smooth turning, no comfort
> options (owner decision). Quality before speed (owner decision).
>
> Companion documents: [ENGINE_EXTENSIONS.md](ENGINE_EXTENSIONS.md) (every engine addition as a contract, numbered
> **E01–E29**; this file cites them by number), [ART_AUDIO_PLAN.md](ART_AUDIO_PLAN.md) (kits, materials, creature
> variants, VFX, lighting, audio and sourcing rules), [RELEASE.md](RELEASE.md) (store, PWA, IAP, VRCs; its task IDs
> **T1–T18** are referenced here), [vrc-checklist.md](vrc-checklist.md).
>
> Coordinates and units follow CONTRACT3D: metres, seconds, +Y up. Each chapter is its own `Level3D` in chapter-local
> coordinates with spawn near y = 0; a per-chapter `depthOffset` keeps the depth readout continuous (E04). Section
> minutes are for a **median first-time player on Normal, deaths included**. Intensity (Int.) runs 1 (calm) to 5
> (peak).

---

## 0. Decisions taken in this synthesis

The three pitches agreed on more than they disagreed. Where they conflicted, this is what we chose and why.

| Question | Decision | Source and reason |
|---|---|---|
| Spine of the game | **Systems ladder** (one new tether rule per chapter, every rule returns) carrying the **narrative canon** (respawn is a waking; the dead are the building; the Mason is made of them) and the **set-piece rules** | Judges 1 and 2 ranked the systems ladder first; judge 3 ranked the narrative first; all three adopted the set-piece rules. The ladder keeps scope finite, the canon gives a reason to finish, the rules keep every peak fair. |
| Chapter line-up | I The Underspire · II **Lamphold** · III **The Mere** · IV **The Keeping** · V **The Still Flame** | Narrative environments (strongest identity per chapter) re-ordered so the rule ladder reads tether → motion → breath → held light → stillness. |
| New rule per chapter | II LIVE ANCHORS · III THE BREATH LINE · IV HELD LIGHT · V STILLNESS | Each is the best-reviewed mechanic for that slot. One rule per chapter (judge 2's scope discipline). |
| Demo hook | **THE MARK**: the Lid's skeleton (lift the Lamp, the walls are its coils, the floor opens, the crown passes 3 m away, the flame that never moves leans) + the Kneeling One (your gauntlets, your Name through your own controller, it stands when your light leaves it) + the first moving ring. The paywall lands **mid-swing on the first moving ring** as a pause state; the chapter swap itself happens later, at a grounded, rope-free moment. | Judge 1: the paywall must land while the hands do something new. Judge 2: the swap must be low-risk. Judge 3: the Kneeling One is the clip people share. This satisfies all three. |
| Best set-pieces kept | The Spiral (I), THE MARK (I), The Stopping and THE SNUFFING with The Span (II), The Belfry, The Plunge and THE DRAIN (III), The Gathering and THE LAST SHELF (IV), THE HALO and THE STILLING (V) | Every set-piece named by two or more judges, plus the Gantry Run folded into the Snuffing as its final leg (The Span) and the Sea-Wall folded into the Drain. |
| Riding the Mason ("Beneath the Mason") | **Cut from 1.0** | Judges 2 and 3 against (dilutes dread; rideable creature mode is a large, risky system). Judge 1's reasons for it (contact horror felt in the hands) are delivered by the Belfry knock, the Plunge, the rope telegraph and the Stilling's overtake. |
| Lampfall (falling city), Wicks / Sallows swarms, echolocation crack, heat zones, updraft chapter | **Set aside** (see §12) | Scope, overlap with the Kept as the "second species", and originality risk (falling-city and echolocation beats). The elastic rope catch from Lampfall is kept for every high-speed arrest (E15). |
| Music | **Original adaptive score** (stems per chapter, set-piece cues, a recurring five-note motif, silence as a designed signal) | Judge 1 rejected "no music during play" for a studio-level product; the narrative pitch's silence rules survive as cue design. |
| Collectibles | **One kind only: Names** (5 per chapter, plus your own), each behind a mastery use of the chapter's rule | Systems' "collectibles behind mastery", narrative's Names (VR-native knock gesture, unlocks the secret ending). Votives, rubbings and Marks are merged into this. |
| Creature growth | Body length set **per chapter at load** (20 → 32 segments); never grown at runtime | Judge 3 wants it to visibly lengthen; judge 2 forbids runtime growth. The Gathering shows its tail paying out of a breach instead. |
| Kept trigger | **Lantern light only**, on every difficulty; never head gaze | Judge 3 (originality: avoid "moves when unwatched"). Normal compensates with a wider cone, a 3 m hand fill, a grace window and the two-grab rule. |
| Endings | Three endings performed by hand at the Flame: **A Unkindled**, **B Kept**, **C Answered** (secret). A and B both play **THE STILLING**; C is the gentle reward. | Narrative endings + set-pieces' three-body finale, folded together as judge 3 asked; nobody can miss the finale set-piece. |

---

## 1. Logline, tagline, pillars

**Logline.** Every time you die in the Underspire you wake at the last lamp you passed, and the body you died in stays
behind. Descend two and a half kilometres of living cathedral on two tethers, while the thing that hunts you, built from
everyone the light ever left behind, comes down after you.

**Tagline** (already carved at the Threshold): *Trust the ring, not the floor.*

**Store short description** (≤ 150 characters, RELEASE §13): *"Descend a living cathedral on two grappling tethers
while something vast hunts you by sound. Chapter 1 is free."*

### The six pillars (every feature must serve at least one; any feature that breaks one is cut)

1. **The rope is the game.** Traversal is the horror. Every new rule changes the tether or what it touches. No combat,
   no inventory, no upgrades, no stats.
2. **Heard before seen.** Every threat is audible 1–2 s before it is visible. The Mason is fully on screen for at most
   ~10 % of a chapter. Silence always means something.
3. **Your body is the camera.** No cutscenes, no camera moves, nothing ever rotates the view. Movers only translate you,
   and only because you chose to hold or stand on them. Spectacle happens around you while your hands stay on the
   triggers. Endings are things you do with your hands.
4. **Every death is a waking.** Respawn is the curse at the centre of the story. Death to control in ≤ 10 s. Your stone
   body stays where you fell.
5. **Learnable, fair, replayable.** Every moving thing runs on a deterministic section clock that resets on respawn.
   Every section has a safe line and a fast line. Every route and set-piece is verified by bots before a human plays it.
6. **One chapter, one rule, one palette, one emotion.** A chapter only borrows the next chapter's key colour in its last
   section, as a promise.

---

## 2. Story canon (team bible; the player never reads this page)

### 2.1 Canon rules (fixed; every chapter obeys them)

1. **The Still Flame wakes those who carry its light.** A lamp or lantern kindled from it carries the gift: die, and you
   wake at the last such lamp you passed. *(Gameplay: checkpoints are waking lamps, E07.)*
2. **What the Flame lets go of, it keeps.** The body you died in stays where it fell and turns to stone. *(Remnants,
   E08.)*
3. **The kept are blind, and they are not still in the dark.** Out of the light they walk, slowly, toward the lamp that
   left them. **Light holds them still.** One lamp holds one of them; it takes thousands of lamps to hold the Mason out.
   *(The Kept, E22; safe light, E18.)*
4. **The Flame's own light, undiluted, holds everything still**: stone, water, iron, flesh. Linger in it and you are
   stilled whole, and never woken. A pilgrim who is stilled wakes again at the Threshold with every lamp cold, the start
   of a new pilgrimage. *(Stillness, E23; the loop.)*
5. **Nothing wakes what is not kindled.** Put out your light and you can truly die. *(The Unkindled; ending A.)*

### 2.2 The Lanternwrights

An order of builders found a flame at the bottom of the world that never moves, makes no sound and is never consumed:
**the Still Flame**. Its gift was waking, so for centuries they built the Underspire **downward** toward it (*"THE LAMP
DOES NOT RISE TO MEET US. WE GO DOWN TO IT."*) and died freely, because dying did not matter (*"TRUST THE RING, NOT THE
FLOOR."*). Their dead piled up as stone. At first they stood them up as statues, robed, lantern raised: the statues of
Chapter I. Then there were too many, so they **dressed them into blocks and built with them** (*"IT WEARS OUR WORK."*).

The order split three ways. Each faction owns a chapter and an ending.

| Faction | Belief | Their places | Their ending |
|---|---|---|---|
| **Keepers** (orthodox) | Keep the dead lit and still. Never answer them. They wrote Chapter I's plaques and set the Mark. | The Underspire (I), the Keeping (IV) | **B · Kept**: raise the Flame and be held still forever, like every statue. |
| **Lampholders** | Live beside your dead; name them. They lit lamps below the Mark in defiance (*"KNOCK, AND BE KNOWN."*). | Lamphold (II) | **C · Answered**: name the dead, and they lie down. |
| **Unkindled** | Put out your light and rest. | The Mere (III), where they sleep under the water | **A · Unkindled**: put out the Flame itself. |

### 2.3 The Mason

The deep course of the Underspire was laid from the oldest dressed dead. When its lamps failed, those stones woke in the
dark (rule 3) and, packed together, moved **as one** (*"THE MASONS WENT DOWN TO MEND THE DEEP COURSE. THE WALL MENDED
ITSELF."*: it took the menders in too). It is blind (stone eyes see nothing), hunts by sound (*"THE STONE HAS BEEN
LISTENING."*), knocks from inside walls because every body in it is still knocking to be named (*"DO NOT ANSWER WHAT
KNOCKS FROM INSIDE THE WALL."*), and comes for lantern-bearers because every piece of it walks toward the light that left
it. **It wants the light; enough light would hold it still forever; it wants it anyway.** Its crown of fronds is a ring
of raised, empty arms. A Mason kill leaves no remnant: *it wears you now.*

### 2.4 The Mark and the Mark Lamp

The Keepers set **the Mark** at 556 m (*"BELOW THIS MARK NO LAMPS. ONLY THE STILL ONE."*): a chamber whose walls are
coils of the deep course, held still by a lamp kindled straight from the Flame and focused through a lens cradle
(*"LEAVE IT. IT HOLDS MORE THAN LIGHT."*). Linger in the cradle's focused light and your gauntlets begin to grey. When
you lift the **Mark Lamp** out of its cradle at the end of Chapter I, the coils go dark, wake, and pour away down the
shaft: you were inside the Mason the whole time. From then on the Mark Lamp is your lantern: its flame never flickers and
never tilts when you move your hand (world-locked), it throws its light through a lens window (a broad cone, 120° and
10 m, from your left hand, plus a 3 m fill around your hands; the keeper's hood narrows it in Chapter IV), and at story
beats it **leans** toward where the Mason went, which is always toward the Flame.

### 2.5 Who you are

You are a pilgrim, and not for the first time. Each pilgrimage ends in stillness and the Threshold lamp wakes you again
(rule 4). The game's very first frame is a waking that looks exactly like every respawn after it. Last time you stopped
at the Mark and knelt in its light: **you are the Kneeling One** in the demo's last chamber. On the very first
pilgrimage you reached the Flame and tried to put it out with your bare hands, and you are still kneeling there, cupped
around it (Chapter V). Part of the Mason is made of you.

### 2.6 The five truths and their proof images

Every truth is carried by at least three independent images or sounds: one unmissable on the main route, the others
optional rewards for players who look around. If a playtest shows a truth not landing, we add an **image, never text**
(gaze telemetry, E28).

| # | Truth | Chapter | Unmissable proof | Optional proofs |
|---|---|---|---|---|
| 1 | The statues are not carvings | I | Your first death leaves a stone body exactly like the statues around you | The split statue in S3 (mineral bones, your gauntlets); two of the 13 statues wear your gauntlets |
| 2 | They could not die, and they built with their dead | II | The Waking Hall: thousands of beds, each under its lamp, each with a tally plate | The Dressing Yards' half-cut blocks with a lantern arm raised out of them; the relief of a figure falling and the same figure standing at a lamp |
| 3 | Some of them found a way to stop | III | The Drain: the water falls away and thousands of the Unkindled lie at rest; the Mason walks among them without touching one | The altar where lanterns were put out; dark lanterns floating like lilies |
| 4 | The dark ones move, and the Mason is made of them | IV | The Gathering: you watch it pull the Kept off the shelves into its plates | One of the gathered wears your gauntlets; the menders' scaffold beside a wall that has closed over their tools |
| 5 | You have done this before | V | The first pilgrim kneeling at the Flame, cupped hands, your gauntlets | The tally wall (hundreds of marks, room for yours); your Name carved on the first pilgrim's gauntlets |

### 2.7 Chapter I's plaques, read twice

All seven existing plaques stay word for word; each gains a second reading after the endings.

| Plaque (existing) | First read | Second read |
|---|---|---|
| HERE THE DESCENT BEGINS. TRUST THE RING, NOT THE FLOOR. | Tutorial advice | The floor is where your bodies stay. The rings carry the waking. |
| THE LAMP DOES NOT RISE TO MEET US. WE GO DOWN TO IT. | Pilgrimage | They were bound to it. They could only go down. |
| NINTH GALLERY — CLOSED. THE STONE HAS BEEN LISTENING. | Creepy | The stone is people. |
| DO NOT ANSWER WHAT KNOCKS FROM INSIDE THE WALL. | A warning | The Keepers' fear, and the key to ending C |
| THE MASONS WENT DOWN TO MEND THE DEEP COURSE. THE WALL MENDED ITSELF. | Ominous | The Mason being born |
| IT WEARS OUR WORK. | It is built into the walls | "Our work" is our bodies |
| BELOW THIS MARK NO LAMPS. ONLY THE STILL ONE. | You reached the end | The Keepers' law, which Lamphold broke |

---

## 3. Design rules (non-negotiable)

### 3.1 Set-piece rules

1. **Teach, then test, then twist.** A set-piece only combines verbs its chapter has already taught in a safe place at
   least one section earlier. It never debuts a verb.
2. **Quiet before, release after.** ≥ 2 min of low intensity before every set-piece; a silent recovery space with a
   waking lamp, no threat and one story image (≥ 60 s) after it. **The rest after a set-piece is never betrayed.**
3. **The player keeps control.** No cutscenes, no forced rotation, no camera moves. Movers and creatures may translate
   the player; nothing rotates the view.
4. **Readable under pressure.** On the main route the next anchor is always visible (or, in the Keeping's dark, inside
   your cone or phosphor-marked) from the previous hang point. Set-piece anchors use the `escape` styling.
5. **Audio leads.** Every threat is heard 1–2 s before it arrives.
6. **Two lines.** Every set-piece has a safe line and a fast line, and at least one recovery anchor on Normal.
7. **Retry within 10 s,** from a lamp immediately before the set-piece (and between its phases), with the world
   restored exactly (E03 snapshots).
8. **60–180 s of peak** per phase. Long enough to tell a story, short enough to retry.
9. **Rubber-banded, never scripted to kill.** Fronts and pursuers keep pressure relative to the player with a mercy
   floor (E19); a stalling player still dies.
10. **Fair by measurement.** Target ≤ 3 median deaths per set-piece on Normal (playtest); a bot at 75 % of the optimal
    line survives and a bot that stalls 3 s fails (E28).
11. **Every set-piece is a trailer shot**: a 6–10 s moment framed for the store video.

### 3.2 The dread grammar

1. **Heard before seen** (pillar 2). Mason screen time ≤ ~10 % per chapter, measured by gaze telemetry (E28).
2. **One betrayed safety per chapter** (table in §4.4). Never the rest space after a set-piece.
3. **Silence means one specific thing per chapter** (§4.4). Breath and heartbeat never drop out, so silence never
   sounds like a bug.
4. **No scripted scare ever repeats.** Repeat encounters come from systems (the Mason, the Kept, water, light), which
   play out differently each time.
5. **Minimal text.** A plaque has ≤ 12 words and a room has at most one. A hint appears once, only for a new verb. No
   notes, diaries or voice-over. All in-world text stays **under 900 words** (§11).
6. **Readable under every palette.** Anchors stay phosphor-marked and shape-coded (ring / hook / cracked diamond; new
   shapes in ART_AUDIO_PLAN §1.1) in every chapter. In Chapter V's white light they gain dark iron rims.
7. **Collision is boxes; looks can be anything.** Physics is sphere-vs-AABB; round pits, slanted stairs and figures are
   non-colliding decor around axis-aligned collision. Nothing the player stands on rotates.

### 3.3 Pacing grammar inside a chapter

*arrive (wonder) → TEACH the rule safely → TEST it with lethal stakes → TWIST it (new configuration, or the Mason) →
quiet / truth image → REMIX with ≥ 2 earlier rules → EXAM (the set-piece) → silence → descend.* Each section below is
labelled with its beat. Two sections per chapter are marked **[cuttable]**: they can shrink or go without breaking the
curriculum.

### 3.4 Fair-failure rules

- **Waking lamps** (E07) on Normal: one at every section start, one mid-section wherever median death-free play between
  lamps would exceed **120 s**, and one before every exam phase. Nightmare lights every other lamp **plus every
  exam-start lamp**. Abyss lights only the chapter-start lamp (today's `'none'` rule).
- Death to control ≤ 10 s; the world (movers, water levels, fronts, beats, broken anchors) restores to the lamp's
  snapshot (E02, E03).
- No soft-locks: a stuck detector offers "Wake at the last lamp" (T15).

---

## 4. The game at a glance

### 4.1 Chapters

| # | Chapter | Depth | Environment and palette | New rule | The other danger | Exam (set-piece) | First time | Skilled Abyss |
|---|---|---|---|---|---|---|---|---|
| I | **The Underspire** *(free demo)* | 0–556 m (hook to 600) | Inverted stone cathedral; slate fog, teal shafts, amber lamps | *(baseline)* fire, hold, swing, release, chain, reel, yank, jump; fragile rings, crumbling ledges | Falls, rebar, spikes, blades | **The Spiral**, then the hook **THE MARK** | 24–28 min | 5–6 min |
| II | **Lamphold** | 600–1,180 m | A lit town carved into a 110 m pit, 3,000 lamps; its winding engine below. Honey, candle amber, brass; then soot and ember | **LIVE ANCHORS**: rings and floors on moving machinery; the rope takes their motion, and a yank moves machinery | The machine: saws, crushers, express drops, the runaway | **THE SNUFFING** (with **The Span**) | 30–34 min | 6–7 min |
| III | **The Mere** | 1,180–1,700 m | A black lake of floating dark lanterns, a drowned bell-foundry, a weir. Indigo, silver, black water | **THE BREATH LINE**: deep water catches any fall and takes your breath; under water the rope is your engine and, on a bellows ring, your air | Drowning, currents, the drain | **THE DRAIN** | 32–36 min | 7–8 min |
| IV | **The Keeping** | 1,700–2,220 m | A canyon of shelves of the dead. Bone, ochre, black; the only warm light is yours | **HELD LIGHT**: your hooded lantern throws a cone from your left hand; what it lights holds still | **The Kept**: statues that walk when unlit | **THE LAST SHELF** | 31–35 min | 6–7 min |
| V | **The Still Flame** | 2,220–2,700 m, then 240 m up | The oldest place: frozen waterfalls, hanging rubble, the white Halo. White-gold light, colour draining away | **STILLNESS**: the Flame's light holds everything still (debris, water, the Mason, and you); shadow shelters you and lets things fall | Stillness itself | **THE HALO**, then the finale **THE STILLING** | 32–36 min + ending | 6–7 min |

**Totals:** 2,700 m of descent, then 240 m of ascent. **About 160 minutes** (150–170) for a median first-time player
on Normal, deaths included; about 2 h 15 min of it after the demo. A skilled Abyss Full Descent takes ~32–35 min.

### 4.2 The rule ladder and remix matrix (every rule returns at least twice, the finale needs all of them)

| Rule (introduced) | II Lamphold | III The Mere | IV The Keeping | V The Still Flame |
|---|---|---|---|---|
| **Tether** (I): fire, chain, reel, yank, fragile, crumble | Chain a static ring to arrest a 13 m/s counterweight ride; strikes shake fragile rings | Reel and yank are the fast lane under water (≈ 5× swim speed) | Reel toward a held ring you are holding still with the other hand | Yank-climbing up debris your light holds still; the Stilling's last 40 m are pure fire-and-reel |
| **Live anchors** (II) | — | Rafts bob; diving bells rise and sink (moving air); sluice gates lift | Hanging cages swing; **held rings walk** (moving anchors you steer with light) | Prism engines turn the beams; a pendulum frozen at its apex becomes a high anchor; the Throat's ribs contract; falling debris |
| **Breath line** (III) | — | — | The Horns' black pool: under water you are unheard, but the breath clock runs | Waterfalls are columns in light and water in shadow; pools catch your falls; **the First Throat breathes** (currents in air) |
| **Held light** (IV) | (foreshadowed: lit clusters hold the Mason out) | (foreshadowed: dark lanterns of the Unkindled) | — | Your lantern burns white: its cone holds falling debris lit and freezes the Mason's crown |
| **Stillness** (V) | — | — | — | Finale |
| **Knock** (I, interaction) | Knock doors open (*"KNOCK, AND BE KNOWN."*) | A knock carries through water to the Mason | Knock into a listening horn and your sound comes out of another (a decoy) | The tally wall; ending C |

### 4.3 The sense economy (what the Mason and the world read)

| Currency | Who reads it | I | II | III | IV | V |
|---|---|---|---|---|---|---|
| **Sound** | The Mason | Landings, yanks, stalling (legacy model) | The engine's din masks you; when it stops, silence exposes you; knocks are loud | Under water you are almost silent (×0.25); splashes and bells are loud | It hunts by sound in the dark; horns carry your knocks; the Kept are deaf | Sound drains as you are stilled; the Mason moves in shadow |
| **Light** | The Kept, the Mason | Your lantern is a comfort | Clusters of lamps hold the Mason out; it snuffs them | Dark lanterns float on the Mere; your lantern is the only light under water | Your cone holds a Kept still; one lamp is nothing to the Mason | The Flame's light holds everything, including you |
| **Breath** | The water | — | — | The breath clock | The Horns' pool | The breathing Throat |
| **Time** | The clocks | The stall model | Mover clocks | Surface levels | Kept steps | Beam sweeps, the rising front |

### 4.4 Colour, mood and the betrayed safety

Theme tuples use the existing `theme(fog, light, accent, fogNear, fogFar, ambient)` from `level-data-3d.js`.

| Ch | Emotion | Theme (Normal) | The safety that betrays you | Silence means | Last section previews |
|---|---|---|---|---|---|
| I | Awe, then dread | Existing per-section themes (`#252b30` → `#120f0e`; teal `#6fa3b5`; amber `#e0a050`) | The warm chamber at the bottom: its walls are the Mason | It is listening | Lamphold's amber, seen through the opened floor |
| II | False warmth → rhythm → loss | Lit `theme('#2a1f16', '#f0b060', '#ffcf80', 7, 95, 0.36)`; Winding Floor `theme('#1b1712', '#d08a3c', '#6fbf9a', 6, 80, 0.26)`; snuffed `theme('#110c09', '#7a2e1e', '#f07a30', 4, 45, 0.10)` | Light keeps the Mason out. Then it puts the town out, lamp by lamp, and the lamps below you go first. | The engine has stopped and it is listening | Silver water glinting under the ash |
| III | Mourning, hush, held breath | Air `theme('#0e1828', '#9fb8d0', '#bfe8ff', 6, 120, 0.16)`; under water fog `#061019`, near 0.5, far 14 | The water forgives your falls and hides you from its hearing. Then its crown comes into the water. | You are under water, unheard | Bone white in the Breach's spray |
| IV | Paranoia, the unseen | `theme('#0d0c0b', '#d8cfba', '#8a6a3a', 3, 38, 0.06)` | Your light holds the Kept still, but it points one way, and the Mason is blind to it | The Kept are held | White light far below |
| V | Sacred awe → terror → quiet | `theme('#cfc6b0', '#f4e6c0', '#ffffff', 12, 150, 0.60)`, saturation graded 1.0 → 0.15 across the chapter (E25) | Light was always safety. Here its stillness kills, and the predator's shadow is your shelter. | You are being stilled | n/a |

Chapter V is the **brightest** chapter: its fog fades to white, not black. The scariest place in the game is flooded
with light.

### 4.5 How the Mason escalates

| Ch | Body | How you know it is there | What it does that is new | What it reveals |
|---|---|---|---|---|
| I | 20 segments | Sound, one far sighting, then pursuit | Hunts, listens, lunges, punishes stalling; spirals down the inverted spire past you | It is vast and lives in the architecture |
| II | 22 | **Inside the walls**: bulging plaster, travelling knocks | Jams the engine; **changes the world**: puts out the lights | It came for the lamps, not only for you |
| III | 24, wet | Knocks through water; ripples; a crown breaking the surface | Hunts the waterline, knocks on the bell you hide in, **plunges its crown into the water**, breaks the weir | It ignores the truly dead: it wants only the kindled |
| IV | 28, figure-plates prominent | Absent; then you watch it feed | **Gathers the Kept** into itself (its tail pays out of a breach); can be delayed by them; inside the horns, heard from eight mouths | Its origin |
| V | 32, stone-pale | **Its shadow** | Goes for the Flame, not for you; moves only in shadow; freezes in light | It is pitiable, and partly you |

Body length is fixed per chapter at load (E17); the "growth" is authored between chapters.

### 4.6 Difficulty for the new rules (all chapters; Sandbox in the last column)

| Parameter | Normal | Nightmare | Abyss | Sandbox |
|---|---|---|---|---|
| Waking lamps | All | Every other + exam starts | Chapter start only | All, plus warp |
| Remnants | On | On | On (a trail of attempts) | Off |
| Moving-ring ray-assist bonus (II) | +0.6 m | +0.4 m | +0.2 m | +0.6 m |
| Max anchor speed (all) | 13 m/s | 13 m/s | 13 m/s | 13 m/s |
| Runaway engine (II-7) | 1.6× | 1.8× | 2.0× | 1.6× |
| Snuff front lead above you (II-8) | 25–40 m | 18–30 m | 15–25 m | Off |
| Span front base speed / target gap (II-8) | 7 m/s / 22 m | 8 / 16 | 9 / 11 | Replay toy |
| Safe water depth (III) | ≥ 3 m | ≥ 4 m | ≥ 5 m | Any |
| Breath under water (III) | 22 s | 16 s | 12 s | Unlimited |
| Bellows refill (III) | full in 2 s | 3 s | 4 s | instant |
| Plunge withdraws (III-6) | at 8 s or 25 % breath | 10 s or 15 % | 12 s | Off |
| Lantern cone (IV): full angle / range | 60° / 16 m | 50° / 14 m | 44° / 12 m | 60° / 16 m |
| Kept speed when unlit (IV) | 0.9 m/s | 1.2 m/s | 1.5 m/s | Inert (toggle) |
| Kept grabs to kill (IV) | 2 within 6 s | 1 | 1 | Never |
| Stillness to full in the Flame's light (V) | 12 s | 9 s | 7 s | Never lethal |
| Stilled-debris warning before it falls (V) | 0.8 s | 0.6 s | 0.4 s | 0.8 s |
| Mason crown exposure to freeze (V) | 0.3 s | 0.45 s | 0.6 s | 0.3 s |
| Mason crown bow at the Flame (V-6) | 6 s every 20 s | 5 s | 4 s | 6 s |
| Knock rhythm tolerance | ±40 % | ±30 % | ±30 % | ±50 % |

Existing Chapter I presets (aim range 32/29/27 m, cone 12/8/6°, lethal impact 17/15.5/14.5 m/s, creature presets) are
unchanged and apply in every chapter.

---

## 5. Chapter I · THE UNDERSPIRE *(the free demo: the existing descent, polished)*

*"Where the line is learned."* Depth 0 → 556 m, plus the hook to 600 m. **Length target: 24–28 min** first time on
Normal (21–25 min for the descent, 3 min for the hook); 5–6 min skilled Abyss.

**Environment and palette.** Unchanged in identity: an inverted stone cathedral-machine of masonry and oxidised iron,
fog from `#252b30` (S1) to `#120f0e` (S8), cold teal shafts (`#6fa3b5`) above and amber work lamps (`#e0a050`) below;
the Outer Dark colossus through the Threshold's east window; the Vault's 190 m void. New: a faint warm glow far below the
Vault's floor cracks (Lamphold's lamps, 450 m down) and, in the hook, Lamphold's amber rising through the opened floor.

**Mood.** Awe turning to dread; relief at the slam; then the floor of relief gives way.

**Mechanics.** Baseline tether set, all existing: two tethers (trigger per hand), swing pump, reel, grip yank, jump,
fragile rings, crumbling ledges, rebar/spikes/blades, the Mason's stalk/hunt/frenzy/escape with listening and lunges,
four difficulties. **New in Chapter I** (none of them move a route anchor, so the level agent's verification still
holds): waking lamps (E07), remnants (E08), knocking and Names (E10), the scripted Spiral path and false lulls (E03,
E17), the hook's interactables, movers and moving anchor (E09, E13–E16), the end card and purchase (E06, E27).

### 5.1 Polish list (each item is data, art or small engine work)

| # | Polish | Where | Needs |
|---|---|---|---|
| P1 | **The waking opening.** First frame: darkness, a dead lantern on your gauntlet, the Threshold lamp flares (L1-1), your lantern catches, a drawn breath. Identical to every respawn. | S1 spawn | E07, E25 lantern ramp, E26 |
| P2 | **A waking lamp at every checkpoint**, plus a mid-Nave lamp on the perch (Normal). Checkpoints become diegetic; the death panel's button reads **Wake**. | All | E07, E27 |
| P3 | **Remnants on.** Your stone body stays where you died (five poses); Mason deaths add a figure-plate instead. | All | E08 |
| P4 | **One statue language.** All 13 statues use the figure kit (hood, gauntlets, lantern raised); two wear your gauntlets. The S1 pair's raised lanterns mirror ending B. | All statue decor | Art (figure kit) |
| P5 | **The split statue** under the Ninth Gallery plaque: broken at the waist, mineral bones inside, your gauntlets. Name N1-2. | S3 | Art, E10 |
| P6 | **"Something answered."** A knock wall beside "DO NOT ANSWER…" knocks three times. Answer it and it stops; 2 s later three soft knocks come from just behind your head (HRTF) and your hand's haptics echo them. Non-lethal. Name N1-3. | S4 | E10, E11, E26 |
| P7 | **The Mason reads as bodies.** Figure-plates (hooded backs, raised arms in relief, no faces) and fronds that read as raised empty arms. | All | Mason kit v2 (ART_AUDIO_PLAN §1.6) |
| P8 | **Heard in the walls.** Before it appears in the Gullet, its knocking travels inside the walls around you (hidden path, audio only). Foreshadows Chapter II. | S5 | E17 (`path`, hidden), E26 |
| P9 | **THE SPIRAL** (§5.3): the Mason spirals head-first down the inverted spire past you, a guaranteed near miss. | S7 | E03, E17 |
| P10 | **Two false lulls in the Nave.** It withdraws, 6 s of silence, it returns from another side. | S7 | E03, E17 |
| P11 | **Five Names plus your own** (§5.5); a one-time knock hint at the Threshold. | All | E10 |
| P12 | **Slam timing**: the grate slams within 1 s of the goal box; the run timer stops at the slam. | S8 | game |
| P13 | **THE MARK** hook (§5.4), replacing the victory panel. | S9 | §5.4 |
| P14 | **Replay layer**: medals, splits, ghosts, three trials, Unwoken (§10). | All | E12 |
| P15 | **Foreshadowing**: Lamphold's warm glow below the Vault's floor cracks (S4); amber in S8's light shifts toward the Mark Lamp's white-gold. | S4, S8 | decor, theme |
| P16 | **Quality bar**: 72 fps sustained (90 Hz where headroom allows), no hitch at section boundaries; anchors readable at full aim range in every section's fog; full audio-mix and haptics pass; onboarding check (≥ 90 % of first-time VR testers chain two-handed by S7); length tuned to 24–28 min **by lamp and hint pacing, never by adding geometry**. | All | E28 telemetry, E29 |

### 5.2 Beat sheet (S1–S8 exist; the READ…ESCALATION comments live in `level-data-3d.js` and stay authoritative; this table adds the polish delta)

| § | Section · depth · beat · Int. · min | READ / CHOICE / COMMIT (existing) | RISK / RECOVERY / REWARD / ESCALATION (existing) | Polish delta |
|---|---|---|---|---|
| S1 | **The Threshold** · 0–8 m · TEACH · 1 · 2.5 | A ring under a girder, the sill 5 m below across 8 m; fire from the ledge or the lip; the first swing comes down onto the sill. | No lethal risk (pocket floor, parapets); fire again from the pocket; the well ring lowers you 24 m; the well opens into S2's ceiling. | P1 waking opening; knock hint + Name N1-1 on the Threshold statue's plinth; the colossus window is the trailer opener. |
| S2 | **The Long Swing** · 8–58 · TEACH · 2 · 3 | Run, fire at the hook under the floor, release on the upswing for the far pier. | A short release drops 13 m; the mid-hall chain ring catches it (N/NM); the wall-arm ring lowers you through the floor; one more pendulum to the east pier. | Grip-yank hint stays. Remnants first appear here for most players. |
| S3 | **Broken Gallery** · 58–98 · TEST · 2 · 3 | Three broken spans under girders; chain the rings or take each span. | Missing the narrow last span is lethal; the lone save ring (fragile on NM/AB) catches you; the wall arm lowers you to the shelf; Abyss crumbles the first span. | P5 split statue at the shelf's far end, reached by deliberately catching the save ring (Name N1-2). |
| S4 | **The Listening Vault** · 98–150 · WONDER · 1→3 · 3 | Catwalk over a 190 m void; linger or move; the sighting crosses the far wall; ring zig-zag to the plinth. | Falls through the window are 175 m; a ring under the shelf hop (N); the plinth ring lowers you into the Gullet; Abyss cradle crumbles. | Sighting tuned as a wonder beat (no hint); P6 knock wall (Name N1-3); P15 Lamphold glow in the floor cracks. |
| S5 | **The Gullet Stair** · 150–204 · TWIST · 3 · 3 | 8 m ledges spiral down an 18 m throat, a hook between each pair; lower or swing-release. | It hunts from above (stalk); NM rebar and crumbling west ledge; one recovery ring (N); Abyss spikes. | P8 knocking in the walls before it appears; trial *Unheard*. |
| S6 | **The Two Descents** · 204–284 · REMIX · 4 · 3.5 | The Long Stair (slow, sound rings) vs the Throat (frayed rings that snap, a crumbling ledge). | East is ~50 % faster with no recovery; hunt mode; NM/AB rebar. | Name N1-4 in an alcove on the dividing wall halfway down the Throat (east line only); trial *The Late*; the elastic catch (E15) makes the frayed-ring arrests feel right (re-verify S6 timings). |
| S7 | **The Hollow Nave** · 284–420 · EXAM · 5 · 4 | Rings in a spiral round a 120 m inverted spire; chain, cut through on the spire-face rings, or bail to the perch. | 130 m of nothing below; frenzy; whiff-and-refire; recovery rings 2/1/0. | **P9 THE SPIRAL** (§5.3); P10 false lulls; perch lamp L1-7b (N); Name N1-5 on the spire's north face (the dare line); trial *Untouched*. |
| S8 | **The Last Throat** · 420–556 · ESCAPE · 5 · 2 | Escape rings down a converging throat; sprint through the grate. | Relentless pursuit; wall steps at each narrowing; Abyss blades. | P12 slam ≤ 1 s; warm light shifts toward the Mark Lamp's white-gold. |
| S9 | **THE MARK** · 556–600 · HOOK · 1→5→1 · 3 | See §5.4 | See §5.4 | New section |

### 5.3 Set-piece: THE SPIRAL (S7)

- **Setup.** Unchanged geometry. The creature is already in frenzy.
- **Trigger.** A beat on `attached: 's7-n5'` (E03) switches the creature to `path` mode on the spline `spiral-s7`.
- **Beat.** The Mason crawls **head-first down the inverted spire itself**, spiralling. The path is timed (rubber-banded
  to the player's progress along `n5 → n7`, E17 `rubberBand`) so that while you swing from `s7-n6` to `s7-n7` its crown
  passes the spire face **6–8 m from you at your height**: outside every difficulty's kill radius (2.6/2.9/3.1 m), a
  guaranteed near miss. Debris rains off the spire as it passes (decor debris + `debris` trigger audio). Its plates
  grind around the spire, panning behind you, then in front.
- **The dare line.** The spire-face shortcut rings (`s7-sp1`, `s7-sp2`) are faster but on its side of the spire.
- **Release.** At the path's end (spire tip) it rejoins the frenzy hunt from below the tip, then the first false lull
  (it withdraws, 6 s of silence, returns from the opposite wall).
- **Fairness.** Path `lethal: true` only at the head; the bot verifies the minimum head-to-player distance along the
  intended route at 75 % and 125 % of optimal speed is ≥ 5 m (E28).
- **Trailer shot:** the crown passing the spire face beside you, debris falling through your lantern light.

### 5.4 The demo hook: THE MARK (S9)

One unbroken in-engine sequence of about 3 minutes. The player never loses control; beats are triggered by **where the
player goes** (with soft timeouts), so a player who rushes cannot miss the key images. The run timer stopped at the
slam, so speedruns are unaffected. Deaths here count toward "Woken" but not toward Chapter I's records.

**Beat sheet (S9)**

- **READ.** You stand inside the grate it just slammed. A round chamber, warm and suddenly quiet (a `hush` volume, E18:
  for the first time in the game you cannot hear the shaft). Kneeling Lanternwright statues line the walls. In the
  middle, on a plinth over a round iron floor, the **Mark Lamp** sits in a lens cradle, its flame perfectly still. On
  the only path to it kneels a hooded stone figure with its back to you, lantern raised and dark. A plaque: **"LEAVE IT.
  IT HOLDS MORE THAN LIGHT."**
- **CHOICE.** Linger and look (the figure's gauntlets are yours; knock back the rhythm it knocks for your Name), or go
  straight to the Lamp.
- **COMMIT.** Grip the Mark Lamp for 1 s (E09). Your old lantern clicks onto the cradle's hook; the Mark Lamp clips
  onto your left gauntlet. Its flame does not move when your hand moves.
- **RISK.** The floor opens. You must fire at the cradle chain's ring as the iris leaves drop away.
- **RECOVERY.** Normal: a catch ring 20 m down the chimney saves a miss; Nightmare and Abyss: you wake at the Mark lamp
  (L1-9, lit on every difficulty) in under 10 s with the sequence restored to "floor closing".
- **REWARD.** You hang on the chain as the walls (its coils) pour past you and its crown stops 3 m away to look at the
  Lamp in your hand, then drops. The flame leans. You are lowered into a lit town.
- **ESCALATION.** The chain stops on its pawl above a 500 m pit of lamps, and the first moving ring in the game comes
  swinging toward your hand.

**Timeline** (soft times for a median player; each step waits for its trigger)

| # | Beat | Trigger | What happens | Tech |
|---|---|---|---|---|
| 1 | **The slam** (existing) | Goal box | The grate slams; the crown hits the bars, fronds (raised empty arms) reach through and withdraw; you hear it climbing *away*. Relief. Timer stops. Chamber lamp L1-9 kindles. | existing + E07 |
| 2 | **The hush** | Enter chamber | The `hush` volume ducks the shaft bed; heartbeat slows. 20–60 s of quiet. Your gauntlets grey faintly at the edges while you stand within 2 m of the cradle (a first, unexplained taste of stillness; non-lethal). | E18 `hush`, E25 gauntlet creep |
| 3 | **The knock** | Within 3 m of the figure | Knocks sound from inside the figure in a rhythm, **and your own controllers pulse the same rhythm** as if your hand were knocking. Knock it back on the figure: its dark lantern glows for one breath and **your Name** is learned. Optional, no prompt. | E10, E26 haptics |
| 4 | **The lift** | Grip the Lamp 1 s (or 60 s timeout: the Lamp's flame leans toward you) | Lamp swap (above). The chamber's statues' lamps go out one by one around the room. | E09, E25 |
| 5 | **The knocking** | +2 s | One knock inside the wall. Then three. Then all around you, many rhythms at once (HRTF). The wall plates **breathe**: 5 cm translation movers on the coil plates. | E13, E26 |
| 6 | **It stands** | Your lamp's cone off the figure for 0.3 s | Swing your light back: **the figure is standing.** Look away and back: it is closer, its empty hand raised toward your lamp. While your cone is on it, it does not move. A scripted, non-lethal Kept (E22, scripted) that always stops 1.2 m from you. This is the clip people will share. | E21, E22 |
| 7 | **The Lid** | Figure within 2 m, or 30 s after beat 5 | The iron floor is an eight-leaf iris (AABB plates, petal-shaped decor). Each leaf drops 0.3 m with a clank (warned 1 s ahead by a ratchet); a ring on the cradle chain above the plinth lights up. First time only, hint: **"Hold on to something."** The leaves fall away into a chimney with warm light far below. | E13 `steps`, E16 carry, E03 |
| 8 | **The unspooling** | Attached to the cradle ring | The walls slide **down** past you: the coil plates' solids deactivate as the Mason's body pours off the chamber into the chimney (path mode, `lethal: false`). **Its crown passes last, 3 m away.** Its fronds turn to the Lamp in your hand. It stops for two heartbeats, recognising the light, then drops away. Its tail drags past for 6 s. Above, at the lip, the standing figure leans over the edge with its arm raised; as your light leaves it you hear it take one step. | E17 `path`, E13 |
| 9 | **The lean** | Tail gone | Silence. **The flame that never moves leans down**, toward where the Mason went. First statement of the Lamp motif (§5.8). The cradle chain pays out in jerks (a `steps` mover; the rope follows its anchor, E15), lowering you through a band of soot into the ceiling of a vast round pit with **thousands of warm lamps in tiers below**: Lamphold. Faintly, inside the pit's walls, something large moves through the stone. | E13, E15, E25, E26 |
| 10 | **The pawl** | Chain reaches the seam | The chain stops on its pawl, 10 m above the Lamplighters' roof tier. A great chandelier swings beneath you on a 36 m chain every 9 s, its ring glinting as it comes toward your hand (approach glint, phosphor rail). Hint, first time only: **"A moving ring carries you. Fire as it comes. Let go as it goes."** | E13 pendulum, E25 rail/glint |
| 11 | **The end card** *(demo build only)* | First apex after attaching to the chandelier ring | The sim pauses at the top of the arc (a pause state, not a camera move; head tracking continues). A carved stone panel rises at hand height with the lit town behind it (§5.6). Buy → the panel crumbles to dust and the swing continues. | E06, E27, T11 |
| 12 | **The roof** | Grounded on the Lamplighters' roof, no rope attached | **The chapter swap** (E04): Chapter II's level replaces Chapter I's under a 200 ms soot gust (no fade to black). Full-game owners see a carved title, **"II · LAMPHOLD"**, drift up out of the dark. | E04 |

**Seam engineering.** The pit ceiling, the cradle chain, the chandelier and the Lamplighters' roof live in one shared
module, `seam-1-2.js` (E04), loaded by both chapters, so the player's state carries across with no transform at the
swap. The swap happens at the simplest possible moment (grounded, no tethers), never mid-swing. For entitled players
Chapter II's pack is prefetched from the start of S8. For demo players the pack is fetched only after purchase (anti-
tamper, RELEASE §10.7 / T16); the download runs during the swing and the landing. If it is not ready when you land,
the roof's lift (the way down) is "still coming": you hear it climbing the pit wall and its chain rattle; it arrives
when the pack is ready (no loading screen, ever). If the download fails, the panel returns with "Connect to the
internet once to download the descent".

**Difficulty.** Normal: catch ring below the cradle, chandelier ring +0.6 m assist. Nightmare/Abyss: no catch ring.
Sandbox: the iris never drops until you are on the ring.

**Fairness.** The bot verifies (E28): the cradle ring is targetable from every iris leaf; the crown's path keeps ≥ 2.5 m
from a player hanging on the cradle chain at any rope length; the chandelier ring is reachable at some phase from the
pawl hang point on every variant; an early or late release onto the roof lands under 0.85 × lethal impact on Normal.

### 5.5 Names and lore (Chapter I)

| Name | Where | Mastery that earns it | Codex line (≤ 12 words) |
|---|---|---|---|
| N1-1 **MAB TWICE-FALLEN** | The Threshold statue's plinth (on route; teaches knocking) | Knock the carved rhythm | *Fell from the Long Swing ninety times. Laughed at every waking.* |
| N1-2 **WENNA** | The split statue, S3 shelf | Catch the lone save ring on purpose | *Lamplighter of the Ninth Gallery. Closed it herself.* |
| N1-3 **TAMSIN OF THE DEEP COURSE** | The knock wall, S4 | Answer what knocks | *Went down to mend the wall. Answered it.* |
| N1-4 **COLL THE LATE** | Alcove halfway down the Throat, S6 | Take the risk line and stop on a frayed ring | *Always the quick way. Always woke at the top.* |
| N1-5 **ISOLDE** | North face of the inverted spire, S7 | Ride the dare line on its side of the spire | *Carved the spire upside down, so it would point home.* |
| **Your Name** | The Kneeling One, S9 (also carved on the first pilgrim's gauntlets, V-6) | Knock back the rhythm your controllers felt | *THE FIRST. The notches are worn away.* |

Plaques: the seven existing, plus **"LEAVE IT. IT HOLDS MORE THAN LIGHT."** in the Mark chamber.

### 5.6 The demo cut

**What the free demo contains:** all of Chapter I and THE MARK on Normal, Nightmare, Abyss and Sandbox; waking lamps,
remnants and "Woken" stats; 5 Names plus your own; the 3 Chapter I trials; 9 medals (3 per difficulty); ghosts and
splits; settings, accessibility and the full codex shell (Chapter I entries). It is a complete, replayable product:
that matters for store reviews and for speedrunners who will spread it.

**The end card** (demo only; carved stone panel, pointer UI, hand height, the town behind it):

> **I · THE UNDERSPIRE · 556 m** — your time · *Woken N times* (or *"Woken 0 times. The lamps never had to wake
> you."*) · Names x / 5
>
> *This was not the bottom.* **II Lamphold · III The Mere · IV The Keeping · V The Still Flame.** *2,700 m. About two
> and a quarter hours more.*
>
> **[Continue the descent — {price}]** · [Replay Chapter I: Normal / Nightmare / Abyss] · [Menu]

- `{price}` is the localised string from `getDetails()` (E06); never hard-coded. Outside a store install (browser tab,
  sideload, desktop) the button reads "The full descent is on the Meta Horizon Store" and does nothing else (RELEASE
  §10.6).
- The purchase starts **synchronously inside the XR `select` handler** of the hand pointing at the button (T11).
  While the system dialog is up the session is `visible-blurred` and the game is paused; nothing can kill you behind
  the dialog. Cancel returns to the panel.
- On success: unlock at once, the panel crumbles, the swing resumes; `listPurchases()` confirms in the background.
- The main menu and chapter select show the same offer (locked tiles II–V carry the price). Restore purchases lives in
  Settings › Purchases.
- **All demo progress carries over** (Names, records, medals, remnant history, settings).

### 5.7 Creature, hazards, lamps

**Creature beats:** dormant (S1–S3) → the sighting across the Vault (S4) → heard in the walls, then stalk (S5) → hunt
(S6) → frenzy, **the Spiral**, two false lulls (S7) → escape and the slam (S8) → the coils, the unspooling, the crown at
3 m (S9, scripted, non-lethal). Hearing model: `legacy` (today's stall/listen tuning, untouched).
**Skitterlings (WP-SKITTER):** the Ossuary Column's small red kin, 0.45 scale and exactly 1.5x the Mason's speeds, hunt beside it in S6 (1), S7 (1 / 2 / 2) and S8 (1 / 1 / 2) on Normal / Nightmare / Abyss; a bite costs 26 / 32 / 40 % health (never an instant kill). Data: `creature.skitter` per section; `?skitter=off` disables.

**Hazards:** lethal falls (≥ 10.7/8.9/7.8 m free fall), rebar (S5/S6), spikes (S2/S5, Abyss), blades (S8, Abyss),
fragile rings (S3 NM/AB, S6), crumbling ledges (S2 NM, S3 AB, S5 NM, S6), the Mason (S5–S8).

**Waking lamps (checkpoint plan)**

| Lamp | Where | Normal | Nightmare | Abyss |
|---|---|---|---|---|
| L1-1 | Threshold (spawn) | ● | ● | ● |
| L1-2 | S2 landing | ● | | |
| L1-3 | S3 landing | ● | ● | |
| L1-4 | S4 landing | ● | | |
| L1-5 | S5 landing | ● | ● | |
| L1-6 | S6 fork | ● | | |
| L1-7 | S7 landing (Spiral start) | ● | ● | |
| L1-7b | S7 perch (mid-Nave) **new** | ● | | |
| L1-8 | S8 landing | ● | | |
| L1-9 | The Mark chamber (hook) | ● | ● | ● (the run is over) |

### 5.8 Music and ambience cues (Chapter I)

| Cue | Trigger | Content |
|---|---|---|
| `amb.ch1.*` | always | Existing procedural beds (shaft wind, masonry whistle, sub rumble, per-section pad), unchanged |
| `mus.ch1.stems` | S2 onward | Three stems (Calm / Pressure / Peak) mixed by ThreatSystem value; Calm is near-silent in S1–S3 |
| `sting.ch1.sighting` | S4 sighting trigger | A single low swell under the procedural call; then nothing |
| `cue.ch1.spiral` | beat `spiral-start` | Bespoke 60 s cue synced to the path: rising grind, a held cluster as the crown passes, release into Peak stem |
| `sil.ch1.lull` | false lulls | Music and creature audio drop to breath and heartbeat for 6 s |
| `sting.ch1.slam` | goal box | The slam, then all music cuts |
| `cue.ch1.mark` | hook beats 2–12 | Silence (hush) → knocking (diegetic only) → unspooling roar → **the Lamp motif, first statement** (five notes on bowed metal) at the lean → warm strings rising as Lamphold appears → held chord under the end card |

---

## 6. Chapter II · LAMPHOLD

*"Every lamp a bed."* Depth 600 → 1,180 m (580 m). `depthOffset` 600. **Length target: 30–34 min** first time on
Normal; 6–7 min skilled Abyss. Mason body: 22 segments, hearing model `noise` (E11).

**Environment.** A round pit 110 m across and 500 m deep. The Lampholders carved their town into its walls in tiers:
house-fronts and doors, stairs, bridges spanning the void, lamp niches, chandeliers on long chains, counterweight lifts,
crane rails over the stone yards. **About 3,000 small lamps are still burning**, because lamps kindled from the Still
Flame never burn down. Tables are set and beds are made; everyone is gone. Cut into the pit's side at mid-depth is the
**Winding Floor**, the great engine that winds the lifts and chandeliers: a 60 m wheel, an escapement rail, a governor,
trip-hammers, gear trains. (Collision: an octagon of axis-aligned wall boxes; the round look is facade decor. Wheels and
gears rotate visually only; their rings and hubs are translation movers.)

**Palette.** Lit: honey sandstone, candle amber, rust cloth, `theme('#2a1f16', '#f0b060', '#ffcf80', 7, 95, 0.36)`.
Winding Floor: brass, oil-black iron, verdigris phosphor, `theme('#1b1712', '#d08a3c', '#6fbf9a', 6, 80, 0.26)`.
Snuffed (spreads tier by tier during II-8): `theme('#110c09', '#7a2e1e', '#f07a30', 4, 45, 0.10)`. II-9 previews the
Mere's silver.

**Mood.** Homesickness and false warmth (the first warm place in the game, and it is a lie) → the rhythm and awe of being
inside an engine that does not care about you → loss and panic as the light goes out.

**New rule: LIVE ANCHORS.** *"Some rings and floors are bolted to moving machinery. The rope follows the ring, so its
motion becomes yours: catch it as it comes and it carries you; let go as it goes and you keep its speed. And the rope
moves machinery too: yank a counterweight ring and the machine answers."*

- **Momentum theft** falls out of the rope using velocity relative to the anchor (E15): a ring moving at 10 m/s drags
  you to 10 m/s; releasing keeps your absolute velocity.
- **Mover kinds, in teaching order:** pendulum chandeliers (20–36 m chains, 8–11 s period, ≤ 12 m/s); counterweight
  lifts (moving floors, 2–4 m/s, ride either side); pull-anchors (yank to drive a lift, a drawbridge, a counterweight);
  crane hooks on rails (3–6 m/s loops); counterweight **express drops** (80 m in 9 s, peak 13 m/s); hung houses
  (driven pendulums you pump by landing and yanking); the governor (rings orbiting a vertical shaft, 8 m radius, 6 s
  period ≈ 8.4 m/s); the escapement (rings step 1.5 m per 1.2 s tick); the great wheel (60 m, 40 s period, rim 4.7 m/s).
- **Readability:** every moving ring runs along a dashed phosphor **rail**; its marker **glints** while it moves toward
  your hand; every mover **ticks or groans** on its phase; moving rings get **+0.6 m** ray assist (N); anchor speed is
  capped at **13 m/s** and verified (E28).
- **Supporting mechanics:** `safeLight` volumes (clusters of lit lamps the Mason cannot enter, E18) taught in II-5 and
  betrayed in II-8; **noise masking** by the engine's din (E11); moving hazards (stone saws on rails, gear teeth); the
  **crush** rule (E16: telegraphed ≥ 1.5 s, ≥ 1.2 m clearance everywhere a crush is not intended); the **elastic catch**
  on every high-speed arrest (E15); the **rope telegraph** begins: when the Mason climbs the structure your anchor hangs
  from, you feel it in that hand (E11, E26).

### 6.1 Beat sheet

#### II-1 · THE LOWERING (seam) · 600–640 m · TEACH · Int. 1 · 2.5 min
- **READ:** You hang on the Mark's cradle chain under the pit's ceiling, the town's lamps in tiers below. The chain has
  stopped on its pawl. A great chandelier swings beneath you on a 36 m chain every 9 s, its ring glinting as it comes.
- **CHOICE:** Fire as it comes, or wait a pass and watch its arc and its phosphor rail.
- **COMMIT:** Fire on the approach; the ring tears you off the chain (≤ 9 m/s).
- **RISK:** Firing as it recedes yanks you the wrong way; a release on the downswing drops you toward the pit.
- **RECOVERY:** The Lamplighters' roof (wide; 8–10 m under the whole arc) catches every early release on Normal; the
  chandelier returns every 9 s; the chain ring stays reachable from the roof's edge.
- **REWARD:** Release on the upswing onto the Lamplighters' roof: the first street. Lamp L2-1 kindles. The chapter swap
  happens here, grounded (§5.4).
- **ESCALATION:** From here, any anchor might move.

#### II-2 · THE STREET OF DOORS · 640–700 m · TEACH · Int. 1 · 3.5 min
- **READ:** A street carved along the pit wall: doors with notch carvings, set tables through open windows, a lantern on
  every sill. At the street's end a lift cage hangs beside a ring on a counterweight chain. Plaque: **"KNOCK, AND BE
  KNOWN."** Far below, knocking inside the walls.
- **CHOICE:** Knock doors (Names, a shortcut), or go straight to the lift.
- **COMMIT:** Fire at the counterweight ring and **yank** (pull-anchor): the lift climbs to you. Step in; it lowers 30 m.
  Hint (once): *"Some rings move machinery. Yank them."* (desktop: F).
- **RISK:** None lethal. The lift's open side shows the drop; a closing door telegraphs with a ratchet.
- **RECOVERY:** The lift returns on its counterweight; yank again.
- **REWARD:** N2-1 behind the first door (on route); N2-2 behind a door two houses off route, which also opens a
  shortcut stair; the lower street.
- **ESCALATION:** The lift was a moving floor. Next, rings that move fast.

#### II-3 · THE CHANDELIERS · 700–790 m · TEST · Int. 2 · 3.5 min
- **READ:** The pit opens: five chandeliers on 20–36 m chains swing across a 60 m gap at offset phases, with rest
  balconies between them. Each ring has its rail; each chandelier ticks at its apex.
- **CHOICE:** Chain chandelier to chandelier (fast, timing) or step balcony to balcony (safe, slower).
- **COMMIT:** Catch the next ring as it comes toward you while the current one carries you toward it; release on the
  upswing onto a balcony or the far bridge.
- **RISK:** Releasing on the downswing throws you short into a 90 m drop (lethal).
- **RECOVERY:** Static recovery rings under the two longest transfers (N 2, NM 1, AB 0); a lift shaft along the wall
  whose cage roof catches a fall gently (relative-velocity impact, E16).
- **REWARD:** The fast line (two chandeliers chained without a balcony) saves ~25 s; N2-3 on a 1 m ledge reachable only by
  releasing at the third chandelier's maximum amplitude.
- **ESCALATION:** The chandeliers end at the Waking Hall's door. Below, saws whine.

#### II-4 · THE WAKING HALL · 790–840 m · REST / TRUTH 2 · Int. 1 · 2.5 min · [cuttable: shrink to 1.5 min]
- **READ:** A cathedral of beds, thousands of them in tiers, each under its own lamp, each with a tally plate of
  notches. A relief: a figure falling; the same figure standing at a lamp. Plaque: **"EVERY LAMP A BED. EVERY BED A
  MORNING."**
- **CHOICE:** Linger and read the place, or ride straight through.
- **COMMIT:** A slow lowering on a single chandelier through the hall's centre (a moving anchor at walking pace).
- **RISK:** None (one big `safeLight` volume; non-lethal heights on Normal).
- **RECOVERY:** n/a.
- **REWARD:** Truth 2 (unmissable on the lowering path); N2-4 on the one bed with no lamp.
- **ESCALATION:** As you leave, one lamp far above goes out. Then another.

#### II-5 · THE DRESSING YARDS · 840–930 m · TWIST + CREATURE · Int. 3 · 4.5 min
- **READ:** The yards where the dead were dressed into blocks: stacks of half-cut statues with lantern arms raised out of
  the stone; stone saws on rails sweeping between the stacks; crane hooks running on overhead rails; a counterweight
  that drops 80 m down a shaft and climbs back. Plaster walls. Plaque: **"DRESS THE OLD STONE WITH CARE. IT WAS
  SOMEONE."**
- **CHOICE:** Ride a crane hook across (fast; keep its speed on release) or hop the stacks between saw passes (slow,
  timed). Then ride the counterweight express down, or climb down the stacks.
- **COMMIT:** Catch a crane hook as it passes, release with its speed onto the far stack. On the express, chain to a
  static ring before the bottom to arrest the fall (the elastic catch takes the shock).
- **RISK:** Saws (moving hazards, whine 1.5 s ahead); letting go of the express early hits at 13 m/s (lethal); the crane
  bucket can crush you against a stack end where marked (telegraphed).
- **RECOVERY:** Lit zones where nothing moves; every crane hook passes again within 12 s; Normal adds a catch ring below
  the express shaft.
- **REWARD:** The yards' lowest gallery, a lit zone and lamp L2-6. N2-5 in a crane cab (ride the hook to the end of its
  rail).
- **ESCALATION (creature):** The plaster beside you **bulges**; dust falls; knocks travel along the wall as you move.
  Twenty metres away, across the lit gallery, it **breaches**: crown out of the plaster, fronds open. It cannot cross the
  light. It listens at the edge, then withdraws into the wall. Lesson: light is safe.

#### II-6 · THE HUNG QUARTER · 930–1,000 m · REMIX (I + II) · Int. 3 · 3.5 min · [cuttable: drop the houses, keep the governor]
- **READ:** Houses hung on paired chains over the pit's centre, swaying gently; across the void, the governor shaft
  whirls rings in a flat orbit.
- **CHOICE:** Pump a house to reach the next (safe) or ride the governor and release on the tangent across 30 m (fast).
- **COMMIT:** Land on a house and yank its chain ring in rhythm to build its swing (driven pendulum, E13), jumping at the
  apex; or catch a governor ring and let go on the tangent.
- **RISK:** A governor mis-release throws you at 8.4 m/s into the pit; old chains carry fragile rings (rule I remix).
- **RECOVERY:** A web of catch chains under the houses (N full, NM half, AB none).
- **REWARD:** The governor line saves ~20 s. The engine's roar grows below.
- **ESCALATION (creature):** Stalk. It is out of the walls, crawling the pit's outer wall below you: heard, then seen as a
  silhouette crossing the lamp tiers. The rope telegraph fires for the first time when it climbs the wall your anchor
  hangs from.

#### II-7 · THE WINDING FLOOR → THE STOPPING · 1,000–1,060 m · CREATURE BEAT · Int. 4 · 4.5 min
- **READ:** The engine hall. A 60 m wheel, an escapement rail ticking rings 1.5 m per 1.2 s, trip-hammers striking every
  4 s, gear trains sweeping hazard teeth between anchors. The din is the room. The hunt is on, but **inside the din it
  cannot hear you**; it sees with its fronds within 10 m.
- **CHOICE:** Ride the escapement tick by tick (slow, steady) or the wheel's rim up and over the gear wall (fast; the only
  climb before Chapter V). Move on the hammer beat (each strike masks you for 1.5 s) or hang still between beats.
- **COMMIT:** Cross the hammer floor on the beat; ride the rim over the wall.
- **RISK:** Gear teeth; hammer strikes shake fragile rings (life × 0.6); within 10 m it sees you.
- **THE STOPPING** (the creature beat, ~90 s): when you attach to the escapement's last ring, a 4 s grinding telegraph,
  then the Mason forces its body into the great escapement. **Every mover shrieks to a stop over 1.2 s; the din drops to
  zero.** Silence: the designed signal (you feel the danger before you understand it). The stopped machine is a frozen
  climbing frame of static anchors. It is wedged in the gears, **listening**: it stays jammed for 20 s, or until you make
  three loud noises (hard landings, yanks, breaks). Then it tears free and the engine restarts in a **runaway at 1.6×**:
  the din is back (it is deaf again) but it hunts by frond sight. Ride a runaway lift 40 m down to the Lamplighters'
  Gallery.
- **RECOVERY:** Lamp L2-8 at the hall's entry; lamp L2-9 at the runaway start (you wake with the runaway already running,
  restored exactly, E03).
- **REWARD:** It retreats, injured, up into the lit tiers. The Gallery is quiet. Trial *On the Beat*.
- **ESCALATION:** High above, lamps begin to go out.

#### II-8 · THE SNUFFING (exam) · 1,060–1,160 m · EXAM · Int. 5 · 6 min (incl. 2 min quiet)
See §6.2.

#### II-9 · THE SOOT THROAT · 1,160–1,180 m · RECOVERY / EXIT · Int. 1 · 1.5 min
- **READ:** Ash falling in the dark, a single waking lamp (L2-12), a narrow throat leading down. Silence.
- **CHOICE:** Rest, or look back up at the dark town.
- **COMMIT:** Lower on a chain into the throat (seam `seam-2-3`).
- **RISK / RECOVERY:** None. **The true rest; never betrayed.**
- **REWARD:** Below, a glint of silver: water. Chapter card **"III · THE MERE"** as you lower.
- **ESCALATION:** The chain ends over black water.

### 6.2 Set-piece: THE SNUFFING (II-8)

- **Setup (quiet, 2 min).** The Lamplighters' Gallery, a lit balcony over the lower town, lamp L2-10. Plaque: **"WE ARE
  PERMITTED OUR LIGHTS. THE MARK IS FOR THE FEARFUL."** High above, a ring of lamps goes out. Soft pops. Another ring.
- **Trigger.** Leaving the gallery (`inBox`) starts the snuff front (E19, `kind: 'snuff'`) and puts the creature on the
  `snuff` path (E17).
- **Phase A, the Snuffing (~110 s, 70 m down).** The Mason spirals down the pit wall putting the town out: every lamp
  within 6 m of its head goes out (soft pop, a puff of soot); each `safeLight` cluster switches off when its lamps go.
  The front is **rubber-banded 25–40 m above you** (1.2–4 m/s; E19). Three routes down the lit tiers: the chandelier
  chain (fast), the lifts (safe but timed: each lift is its own moving safe light), and the stair-tiers (slow). When it
  comes within 20 m of you in the dark, it switches from path to hunt (lethal).
- **The betrayal (~1,110 m).** The lamps **below** you go out. It went through the wall and came out underneath (hidden
  path, re-emerging at a breach). The only light left is the caged lamp on the **Lamplighter's Lift**, across the Span.
  Lamp L2-11 at the Span head (phase checkpoint, snapshot restores the dark).
- **Phase B, THE SPAN (~80 s, 140 m across).** An iron truss bridge to the Lift tower. When you are 30 m onto it, the
  Mason tears the near anchorage from below and **rides the collapse** after you (E19 `collapse` front): base 7 m/s,
  target gap 22 m (N).
  1. *Run or drop.* Running on the deck (5.5 m/s) is too slow. Drop **under** the deck and swing hook to hook
     (10–12 m/s).
  2. *Runaway trolleys* slide along the under-rail toward you (moving anchors): catch one as it passes for a burst of
     speed, the wrong way unless you release at the right moment. The expert line.
  3. *Deck rain:* sections fall past and through your swing lines, each warned 0.7 s ahead by a creak and a dust burst;
     ropes to anchors on a falling section break (`grapple:break`, reason `'front'`). **Hooks ahead of the front always
     stay solid**, so a falling player can still fire forward.
  4. *The last span* drops in stair-steps (−1 m, hold, −2 m, hold, −4 m; a `steps` mover); leap from it to the Lift's
     cage ring as the Span and the Mason on it fall away.
- **Phase C, the Lift (~30 s).** The Lamplighter's Lift lowers 30 m in 15 s inside its own moving safe light (a
  `safeLight` volume carried by the mover) while the Mason climbs down the lift chains above you, plates grinding, felt
  through your rope. At the bottom, falling debris snuffs the cage lamp; jump into the Soot Throat. It does not follow:
  the town is dark; it did what it came to do.
- **Lines.** Phase A: chandeliers (fast) / lifts (safe) / stairs (slow, a hidden alcove). Phase B: under-deck hooks (safe)
  / trolleys (fast).
- **Difficulty.** Snuff lead 25–40 / 18–30 / 15–25 m. Span base speed and target gap 7 m/s & 22 m / 8 & 16 / 9 & 11.
  Recovery hooks under the deck 4 / 2 / 0. Trolleys on every difficulty.
- **Fairness (E28).** A bot at 75 % of the optimal line survives each phase on every variant; a bot that stalls 3 s on the
  deck falls with it and can still recover on a hook ahead (Normal); the snuff front never kills directly; minimum
  head distance during Phase C ≥ 4 m.
- **Trailer shots:** Lamphold lit, then a ring of lamps going out above you; the Span collapsing behind you with the
  crown riding the wave.

### 6.3 Creature beats, hazards, Names, lamps, music (Chapter II)

**Creature beats:** heard far below inside the pit walls (II-1, II-2) → in the walls beside you, breaches across a lit
zone and cannot cross (II-5, scripted path, non-lethal) → stalk on the outer wall; first rope telegraph (II-6) → hunt in
the din, deaf but seeing within 10 m; the Stopping; runaway hunt; retreats injured up into the town (II-7) → the
Snuffing; the betrayal; rides the Span's collapse; climbs down the lift chains (II-8) → withdraws into the dark town
(II-9).

**Hazards (the other danger: the machine):** falls into the 500 m pit; stone saws on rails; gear teeth; trip-hammers
(moving solids); crush points (crane buckets, lift pistons; telegraphed); express-drop impacts; fragile rings shaken by
strikes; the runaway; collapsing deck.

**Mechanics introduced:** live anchors (pendulum, lift, pull, rail, express, driven house, governor, escapement, wheel),
`safeLight`, noise masking, moving hazards, crush, rope telegraph. **Remixed:** chaining (arrests), fragile rings,
crumbling (the Span), knocking (doors).

**Names**

| Name | Where | Mastery | Codex line |
|---|---|---|---|
| N2-1 **OSWIN LAMPHOLDER** | First door, Street of Doors (on route) | Knock his door's rhythm | *Lit the first lamp below the Mark. Was proud of it.* |
| N2-2 **GODRIC THE LIFTWRIGHT** | A door two houses off route (opens a shortcut) | Find and knock it | *Built the lifts so the old could go down too.* |
| N2-3 **HEDDA** | A 1 m ledge in the Chandeliers | Release at the third chandelier's maximum amplitude | *Wound the chandeliers every morning. Never once fell.* |
| N2-4 **MARGERY** | The bed with no lamp, Waking Hall | Knock the bed's tally rhythm | *Slept here four thousand mornings. Counted every one.* |
| N2-5 **BRASK** | A crane cab in the Dressing Yards | Ride a crane hook to the end of its rail | *Dressed four hundred stones. Knew the last one.* |

**Plaques:** KNOCK, AND BE KNOWN · EVERY LAMP A BED. EVERY BED A MORNING. · DRESS THE OLD STONE WITH CARE. IT WAS
SOMEONE. · WE ARE PERMITTED OUR LIGHTS. THE MARK IS FOR THE FEARFUL.

**Trials:** *Clockwork* (II-3 to II-6 without standing on a static floor) · *On the Beat* (the Winding Floor unheard) ·
*Under the Deck* (the Span without touching the deck).

**Waking lamps**

| Lamp | Where | N | NM | AB |
|---|---|---|---|---|
| L2-1 | Lamplighters' roof (chapter start, seam) | ● | ● | ● |
| L2-2 | Lower street, after the lift | ● | | |
| L2-3 | Second chandelier balcony | ● | ● | |
| L2-4 | Waking Hall | ● | | |
| L2-5 | Dressing Yards, upper stacks | ● | ● | |
| L2-6 | Yards' lit gallery | ● | | |
| L2-7 | Hung Quarter landing | ● | ● | |
| L2-8 | Winding Floor entry | ● | | |
| L2-9 | Runaway start (the Stopping, phase 2) | ● | ● | |
| L2-10 | Lamplighters' Gallery (Snuffing, exam start) | ● | ● | |
| L2-11 | Span head (Snuffing phase B; also covers phase C, the 30 s Lift ride) | ● | ● | |
| L2-12 | Soot Throat (chapter end) | ● | ● | ● |

**Music and ambience**

| Cue | Trigger | Content |
|---|---|---|
| `amb.ch2.lit` | II-1 to II-6 | Thousands of tiny flames as a soft chorus, timber creak, lamp-chain chimes, distant knocking inside the walls |
| `mus.ch2.stems` | II-1 onward | Calm / Pressure / Peak; warm, homesick; the Lamp motif hidden in Calm |
| `amb.ch2.engine` | II-7 | The engine *is* the bed: wheel groan, escapement clack (1.2 s), hammers every 4 s; music locks to the hammer tempo |
| `sil.ch2.stopping` | The Stopping | Everything stops over 1.2 s: music, engine, ambience. Only breath, heartbeat and its listening chitter. |
| `cue.ch2.runaway` | restart | Peak stem re-entering at 1.6× pulse, mechanical percussion |
| `cue.ch2.snuffing` | II-8 phase A | Bespoke ~110 s cue: snuff pops land on its rhythm; the motif in a minor mode when the lamps below go out |
| `cue.ch2.span` | II-8 phase B | Percussive cascade behind you (HRTF groan of the collapse leads it) |
| `cue.ch2.lift` | II-8 phase C | A single held tone under the plate grinding; cut on the cage lamp's snuff |
| `sil.ch2.soot` | II-9 | Silence, then Calm; a glassy high tone previews the Mere |

---

## 7. Chapter III · THE MERE

*"Hold your breath. Hold the line."* Depth 1,180 → 1,700 m (520 m). `depthOffset` 1,180. **Length target: 32–36
min**; 7–8 min skilled Abyss. Mason body: 24 segments, wet-sheen shader state, hearing `noise` with the underwater
multiplier.

**Environment.** A flooded cavern 200 × 140 m: a black lake, **the Mere**, about 25 m deep, on which thousands of **dark
lanterns float** like lilies. Chains hang from a ceiling of stalactites carved into lantern shapes. On its near shore,
the drowned **bell-foundry of the Choir** (the Lanternwrights tuned bells to the deep course's hearing); at its far end,
a **weir** holds the water back. Under the water, unseen until the Drain, the Unkindled lie at rest.

**Palette.** Indigo, silver, black water. Air: `theme('#0e1828', '#9fb8d0', '#bfe8ff', 6, 120, 0.16)`. Under water:
fog `#061019`, near 0.5 m, far 14 m (12 m Nightmare, 10 m Abyss). The Belfry adds verdigris bronze `#3f6b63`. III-9
previews the Keeping's bone white in the spray.

**Mood.** Mourning, hush, held breath. The most beautiful and quietest chapter, which is why its betrayal lands.

**New rule: THE BREATH LINE.** *"Water catches your fall and steals your breath. Under water your rope is your engine,
and on a bellows ring it is your air."*

- **Deep water catches any fall** (E20): a fall into water at least 3 m deep (4 m NM, 5 m AB) never kills. This reverses
  the rule the player has lived by for 1,180 m: the chapter's opening joy. **Tide-posts** mark depth by shape (a post
  carved with a wave band = deep; a post carved with a foot = shallow, still lethal).
- **Breath:** 22 s with the head under water (16 NM, 12 AB). The gauge is diegetic: five glass beads on the left
  gauntlet. A heartbeat starts at half; a muffled gasp warns at 20 %; at zero the world darkens for 3 s (last chance to
  surface or reach air), then you drown (cause `drown`).
- **Under water:** swimming is slow (1.8 m/s along your stick, vertical from head pitch; A strokes up); **reel and yank
  work at full speed**, so the rope is the fast lane (~5× swim speed); aim range is halved (16 m on Normal); markers stay
  phosphor and shape-coded.
- **Bellows rings** (anchor flag `air`): brass rings on the Choir's old air lines. While tethered to one, breath refills
  (full in 2 s N / 3 s NM / 4 s AB) and bubbles stream from your hand. **With two hands, one stays on air while the other
  makes progress**: two-hand chaining becomes breathing.
- **Air pockets** under bells and domes refill breath, each with its own close reverb.
- **Currents** (force volumes, ≤ 6 m/s; the Drain reaches 9 m/s): hold a tether to resist, let go to ride. Silt streaks
  show the lanes.
- **Mantle** onto ledges and out of water (A within 0.9 m of a top edge).
- **Sound:** under water you are almost silent (×0.25). Splashes are loud (scaled by entry speed). Bells ring when
  touched or over-swung.
- **The Mason on the waterline** (E17 `waterline`): it never enters water deeper than 1.5 m, patrols rims and chains,
  bursts toward splashes within 40 m; a player more than 3 m under is unreachable and unheard, and its stall model pauses
  while your breath runs. Until **the Plunge**.

### 7.1 Beat sheet

#### III-1 · THE SPILLWAY · 1,180–1,215 m · TEACH · Int. 1 · 2.5 min
- **READ:** The Soot Throat's chain ends 25 m above a pool lit from below. A tide-post with a wave band stands in it.
  Hint (once): **"Deep water will catch you."**
- **CHOICE:** Lower to the surface on the chain, or let go.
- **COMMIT:** Let go. The first fall in the game that does not kill.
- **RISK:** The pool's rim is shallow (foot-band posts): landing there is lethal; the main drop line cannot reach it on
  Normal.
- **RECOVERY:** Swim to the mantle edge (A). Lamp L3-1.
- **REWARD:** The joy of breaking a rule you have obeyed for 1,180 m. Speedrun line: a 40 m dive from a higher ledge skips
  the stair.
- **ESCALATION:** The pool spills over a lip into the Mere.

#### III-2 · THE SHORE OF LANTERNS · 1,215–1,260 m · TEACH · Int. 1→2 · 3.5 min
- **READ:** The Mere opens: black water to the horizon of the fog, thousands of dark lanterns drifting, chains from a
  carved ceiling. On the shore, an altar bowl. Plaque: **"HERE WE PUT OUT OUR LIGHTS, AND SLEPT."**
- **CHOICE:** Swim the shallows to the first chain, or dive and reel along a submerged chain (faster, uses breath).
- **COMMIT:** First dive: reel along a chain to an air pocket under a dome rock 12 m out.
- **RISK:** Breath (generous here: every leg ≤ 40 % of breath on Normal).
- **RECOVERY:** Air pockets every ≤ 12 s of swim; surface anywhere.
- **REWARD:** The altar (Name N3-1, and the optional *Lampless* trial: hold your lantern over the bowl for 2 s to put it
  out; the rest of the chapter by phosphor light only, and a death returns you to the altar).
- **ESCALATION:** The shore ends at the Choir's drowned wall and its air lines.

#### III-3 · BELLOWS ROW · 1,260–1,300 m · TEST · Int. 2 · 4 min
- **READ:** A 60 m underwater traverse along the drowned wall of the bell-foundry; brass bellows rings on the old air lines
  every 8–12 m; no air pocket in the middle 40 m.
- **CHOICE:** Chain bellows ring to bellows ring (safe), or skip rings on one long reel (fast).
- **COMMIT:** One hand on air, the other reaching for the next ring.
- **RISK:** Drowning if you let go of air too early. Air pockets: N 2, NM 1, AB 0.
- **RECOVERY:** Any bellows ring refills you; the air lines lead upward to the surface.
- **REWARD:** N3-2 on the floor of the deepest cistern, 28 m down with no air: one breath on the efficient reel line
  (~80 % of Normal's breath). Trial *One Breath* (no bellows ring at all).
- **ESCALATION:** The Row surfaces inside the Belfry.

#### III-4 · THE BELFRY · 1,300–1,350 m · TWIST (close encounter) · Int. 3→4 · 4 min
- **READ:** The drowned bell-foundry: bells of five sizes (1.2 to 9 m) hang half-submerged from yokes in a dark nave.
  Anchors on the yokes. Plaque on the great bell's lip: **"WE TUNED THE BELLS TO ITS HEARING. FOR A TIME IT
  LISTENED."**
- **CHOICE:** Swing between the bells without touching them (air: fast), or swim beneath them (silent, breath).
- **COMMIT:** Cross the nave; brushing a bell or over-swinging one on its ring **rings** it (noise 0.4–1.0).
- **RISK:** A ring brings the crown down out of the rafters to **investigate** the spot (E11 INVESTIGATE): pits lit,
  listening for 3–6 s. Hide and stay still, or slip under water. It is lethal in this section (hunt within kill radius).
- **RECOVERY:** Air pockets under the smaller bells; lamp L3-5 at the entry.
- **REWARD and the close encounter:** the way on is the air pocket **inside the great bell**: a stone Lanternwright
  cradling a dead lamp, its Name carved under the lip (N3-3). While you breathe there, **the Mason knocks on the bell
  from outside**: the whole bell rings around your head, again, and again. You are unreachable (scripted; the volume is
  non-lethal). It leaves. Harmless and the most claustrophobic minute in the game.
- **ESCALATION:** You leave under the lip into open water, where it hunts the rims.

#### III-5 · THE FERRY CHAINS · 1,350–1,420 m · TWIST · Int. 3 · 3.5 min
- **READ:** Open water crossed by rafts (bobbing translation movers that creak when landed on) and chains hanging from
  the ceiling; a sluice current runs across the middle (silt streaks). The Mason prowls the waterline: rims, the chains
  overhead.
- **CHOICE:** The high line (chains in the air: fast, heard) or the low line (swim and reel under water: silent, on the
  breath clock).
- **COMMIT:** Commit to a line across the current.
- **RISK:** Splashes within 40 m make it burst to the nearest rim point; raft creaks are noise; the current pushes swimmers
  toward a drain grate (hazard) on Nightmare and Abyss.
- **RECOVERY:** Rafts are rest stops; deep water catches every fall; bellows rings under the rafts.
- **REWARD:** The tower of the Sounding, rising out of the water, and lamp L3-8 at its top. The low line saves ~20 s for
  a player who manages breath well.
- **ESCALATION:** The only way on is down the flooded tower.

#### III-6 · THE SOUNDING → THE PLUNGE · 1,420–1,490 m · REMIX (II) + CLOSE ENCOUNTER · Int. 4 · 4.5 min
- **READ:** A flooded bell tower, 16 × 16 m, 45 m deep, filled to the brim. Rings down its walls; two **diving bells**
  rise and sink on chains inside it (moving air pockets, II remix), one near 15 m, one near 32 m. Plaque at the
  waterline: **"SOUND IT SLOWLY. IT LISTENS AT THE WATER."**
- **CHOICE:** Reel down ring to ring and wait for a diving bell to breathe, or ride a sinking bell down (its air lasts its
  descent; N3-4 is inside the deeper bell).
- **COMMIT:** The dive. Each leg 15–20 m: 5–8 s of reeling plus navigating; inside 22 s with margin on Normal.
- **RISK and THE PLUNGE:** at about 25 m deep (or at your first loud noise in the tower), **the Mason's crown sinks into
  the shaft beside you**: glowing pits in black water, fronds trailing 20 m down. Noise under water comes from moving
  faster than 1.5 m/s, reeling, impacts. **Hang still.** Your breath keeps falling. It withdraws after 8 s, **or earlier
  when your breath reaches 25 % on Normal** (a hidden mercy rule; 10 s / 15 % NM; 12 s, no mercy, AB). The safety
  of the water is betrayed: it can come in after you.
- **RECOVERY:** If heard, it lunges with the standard 1.5 s wind-up; a diving bell nearby is a refuge (unreachable
  inside). Lamp L3-8 at the top.
- **REWARD:** The tower's foot opens into the drowned lanternhouses. Speedrun: a silent fast line that never triggers the
  plunge (move under 1.5 m/s while it is within 30 m).
- **ESCALATION:** It knows you are under the water now.

#### III-7 · THE DROWNED LANTERNHOUSES · 1,490–1,530 m · RECOVERY / LORE · Int. 1 · 2.5 min · [cuttable: shrink]
- **READ:** A sunken street of Lanternwright homes, air in the attics, dark lanterns on every sill. Plaque: **"NOTHING
  WAKES WHAT IS NOT KINDLED."**
- **CHOICE:** Explore the attics (Names) or swim the street.
- **COMMIT / RISK:** Breath only; every attic has air.
- **RECOVERY:** Lamp L3-9.
- **REWARD:** Quiet; the cistern mouth ahead.
- **ESCALATION:** Through the street's end: the weir, and something climbing its outer face.

#### III-8 · THE DRAIN (exam) · 1,530–1,640 m · EXAM · Int. 5→2 · 6 min
See §7.2.

#### III-9 · THE BREACH → THE QUIET BELOW · 1,640–1,700 m · ESCALATION / EXIT · Int. 4→1 · 3.5 min
- **READ:** The outflow: a waterfall pouring through the broken weir into the dark, chains hanging beside it in the
  spray. The Mason is below you, going down ahead.
- **CHOICE:** The chains in the spray (fast; the roar masks you completely) or the dry ledges beside it (slow; in the
  open, heard).
- **COMMIT:** Lower chain to chain through the spray.
- **RISK:** Spray volumes push you toward the fall; ledges crumble when the water leaves them.
- **RECOVERY:** The plunge pool at the bottom catches you (deep water). Lamp L3-12 halfway.
- **REWARD:** The roar fades behind you. White light, far below. A waking lamp (L3-13). **The true rest.** A glint of bone
  white in the spray. Chapter card **"IV · THE KEEPING"**.
- **ESCALATION:** A door carved with a hood.

### 7.2 Set-piece: THE DRAIN (III-8)

*The Mason is not the danger here. The water is.*

- **Setup (quiet before).** The lanternhouses (III-7). Then the weir reach: 160 m of the Mere ending in a curved weir; the
  route crosses under water bell to bell (bellows rings on moving diving bells, air bells), then a gallery on the far
  side. Lamp L3-10 at the cistern mouth.
- **Phase 1, the knocking (~20 s).** It cannot reach you, so it climbs the weir's outer face. You hear the knocks
  through the water and **feel them in the bellows rope** (rope telegraph).
- **Phase 2, the breach (6 s telegraph: cracks, bubble columns, a rising groan).** It breaks the weir. The water drains
  toward the breach: a current builds to 9 m/s toward a lethal drain grate (hazard), and the surface falls **60 m in 60 s**
  (scripted surface, E18).
- **Phase 3, the crossing (~40 s).** Hold on and transfer ring to ring **against the current** toward the far gallery,
  one hand on a bellows ring when you can. The route is designed for 40 s of the 60.
- **Phase 4, the fall of the water.** The falling surface passes you, and suddenly you hang in open air over a newly
  revealed 60 m drop: **the rings that held you against the current now hold you against gravity.** Below, as the last
  water runs off, **thousands of the Unkindled** lie on the cavern floor with folded hands on dark lanterns, the stillest
  image in the game. The Mason walks among them toward the breach **without touching one**. Music stops; breath, drips,
  the far roar.
- **Release / escalation.** You have to follow it down: lower from the gallery onto the Unkindled floor (N3-5 is among
  them, an optional detour while it is still near) and into the Breach.
- **Lines.** Safe: the bell-to-bell line with all bellows rings. Fast: ride the current *toward* the drain and cut across
  on the last ring before the grate.
- **Difficulty.** Surface fall 60 / 50 / 45 s. Current 9 m/s on all. Catch ring at the drain lip: Normal only. Breath per
  §4.6.
- **Fairness (E28).** Every required underwater leg costs ≤ 70 % of breath on Normal at reel speed; a bot at 75 % of
  optimal reaches the far gallery before the surface passes it; during phases 1–3 the Mason is on a non-lethal path on
  the weir; in phase 4 its path keeps ≥ 15 m from the gallery.
- **Trailer shot:** the surface falling past you to reveal the Unkindled below.

### 7.3 Creature beats, hazards, Names, lamps, music (Chapter III)

**Creature beats:** absent for the first ~12 minutes (relief that slowly becomes suspicion) → investigates bell rings;
knocks on the great bell you shelter in (III-4) → waterline hunt; bursts at splashes (III-5) → **the Plunge** (III-6) →
climbs the weir and breaks it; walks among the Unkindled untouching (III-8) → going down ahead of you, masked in the roar
(III-9).

**Hazards (the other danger: water):** drowning; shallow water (lethal impact); currents and the drain grate; the falling
surface; spray; ledges that crumble as water leaves them; the Mason on the waterline.

**Mechanics introduced:** deep-water fall catch, swimming, breath, bellows rings, air pockets, currents, scripted
surfaces, mantle, bells as noise, the Mason's waterline and plunge. **Remixed:** live anchors (rafts, diving bells),
reel/yank (the fast lane), crumbling (water-logged ledges), knocking (through water), chaining (against a current).

**Names**

| Name | Where | Mastery | Codex line |
|---|---|---|---|
| N3-1 **IDE** | The altar bowl, Shore of Lanterns | Knock the altar's rhythm | *Put out her light first. The rest followed her to the water.* |
| N3-2 **AUBERON** | Floor of the deepest cistern, Bellows Row, 28 m down | One breath on the efficient reel line | *Rang the tenor forty years. Went deaf gladly.* |
| N3-3 **CEFN OF THE CHOIR** | Under the great bell's lip, inside its air pocket | Find it while the bell is knocked | *Tuned the bells to its hearing. It sang back once.* |
| N3-4 **ROSWITH** | Inside the sinking diving bell, the Sounding | Ride the bell down and get out before its air runs out | *Went down with the bell to hear what it heard.* |
| N3-5 **LOWEN THE LAST** | Among the Unkindled after the Drain | Detour while the Mason is still near | *Put out the last light on the shore. Lay down beside her.* |

**Plaques:** HERE WE PUT OUT OUR LIGHTS, AND SLEPT. · WE TUNED THE BELLS TO ITS HEARING. FOR A TIME IT LISTENED. · SOUND
IT SLOWLY. IT LISTENS AT THE WATER. · NOTHING WAKES WHAT IS NOT KINDLED.

**Trials:** *One Breath* (Bellows Row without a bellows ring) · *Lampless* (from the altar to the chapter's end with
your lantern out and no waking) · *Against the Drain* (the Drain on Normal without the catch ring, and without
touching the drain grate's catch chain).

**Waking lamps**

| Lamp | Where | N | NM | AB |
|---|---|---|---|---|
| L3-1 | Spillway pool (chapter start) | ● | ● | ● |
| L3-2 | Shore of Lanterns, by the altar | ● | | |
| L3-3 | Bellows Row start | ● | ● | |
| L3-4 | Bellows Row, mid air dome | ● | | |
| L3-5 | Belfry entry | ● | ● | |
| L3-6 | Ferry Chains, first raft island | ● | | |
| L3-7 | Ferry Chains, far raft island | ● | ● | |
| L3-8 | Top of the Sounding tower | ● | | |
| L3-9 | Drowned lanternhouses | ● | ● | |
| L3-10 | Cistern mouth (Drain, exam start) | ● | ● | |
| L3-11 | Far gallery (after the Drain) | ● | | |
| L3-12 | Halfway down the Breach | ● | ● | |
| L3-13 | The Quiet Below (chapter end) | ● | ● | ● |

**Music and ambience**

| Cue | Trigger | Content |
|---|---|---|
| `amb.ch3.mere` | always | Drips, lapping, deep pressure, the hush of the Mere; under water a master low-pass (~700 Hz), muffled breath, bubbles, your heartbeat louder |
| `mus.ch3.stems` | III-1 onward | Calm / Pressure / Peak: glass and bowed metal, slow water-drum pulse; Calm carries the motif at the Shore |
| `sil.ch3.belfry` | III-4 | No score: the bells are the music (modal synthesis, E26); the knocking on the great bell is the cue |
| `sil.ch3.plunge` | the Plunge | Score drops to nothing; breath, heartbeat, bubbles and its pits' low hum only |
| `cue.ch3.drain` | III-8 phases 1–3 | Bespoke cue under the current's roar; rhythmic knocks in phase 1 lead the groan of the breach |
| `cue.ch3.reveal` | III-8 phase 4 | The Lamp motif on a single sustained voice-like instrument (no lyrics), then silence |
| `amb.ch3.breach` | III-9 | The waterfall's roar as a full masking bed; fades to the Quiet Below |

---

## 8. Chapter IV · THE KEEPING

*"Keep them lit."* Depth 1,700 → 2,220 m (520 m). `depthOffset` 1,700. **Length target: 31–35 min**; 6–7 min skilled
Abyss. Mason body: 28 segments, figure-plates prominent; hearing `noise`; ignores light.

**Environment.** A vertical canyon of shelves 40 m wide and 500 m deep, where the Keepers stored their dead before they
began building with them: niches cut in the cliff faces, racks, walkways, iron cages on chains, cranes, and **thousands
of stone figures standing in rows**. Keeper shrines with lit lamps are safe islands. In the lower canyon, the Keepers'
**listening horns**: colossal carved ear-horns they used to hear the deep course moving.

**Palette.** Bone, ochre dust and black: `theme('#0d0c0b', '#d8cfba', '#8a6a3a', 3, 38, 0.06)`. The only warm light is
yours. IV-8 previews the Still Flame's white.

**Mood.** Paranoia and the unseen. **The Mason is absent for two thirds of the chapter**; the danger is the Kept. This is
the chapter where the Mason is not the threat, until it is both.

**New rule: HELD LIGHT.** *"Your light holds them still. It points one way."*

- **The keeper's hood** (IV-1, an interactable) clips onto the Mark Lamp and turns its lens light into a **cone**:
  60° full angle and 16 m on Normal (50°/14 m NM, 44°/12 m AB), plus a 3 m fill around your hands. In VR the cone
  points where your **left hand** points; that hand is also a tether hand. On desktop it follows the view.
- **Light holds the kept** (E21, E22): a Kept inside the cone with line of sight stops dead and makes no sound; it stays
  still for a 0.3 s grace after the light leaves.
- **The Kept**: stone figures (the shared figure kit) on authored rails: shelf ledges, walkways, bridges, cage floors.
  **Unlit**, they step toward you in short grinding steps (0.32 m every 0.35 s on Normal ≈ 0.9 m/s; 1.2 NM, 1.5 AB). They
  are deaf. **Grabs:** on Normal a first grab staggers you, breaks one tether and holds you for 1.2 s; a second grab within
  6 s kills (*"It held you still."*). On Nightmare and Abyss the first grab kills.
- **Held rings**: some Kept hold a ring aloft. The ring moves with the statue (a moving anchor, rule II) that **you steer
  with light**: let it walk toward you in the dark, light it to freeze it in reach, fire, swing. Hang from a held ring and
  let your light slip, and it carries you slowly back toward its **home** niche.
- **Cages** on chains swing (pendulum movers); unlit occupants reach through the bars.
- **Shrines** are `safeLight` volumes: neither the Kept nor the Mason enter; Kept caught inside are held.
- **The flame leans** toward the nearest moving, unlit Kept within 10 m, with a faint tick in the lantern hand: a
  diegetic warning. **Remnants turn to face you** in the dark from this chapter on (dread only, never lethal).
- **The Mason ignores your light** (one lamp is nothing to it) and still hunts by sound; the Kept ignore sound. Two
  dangers, two senses.

### 8.1 Beat sheet

#### IV-1 · THE KEEPER'S DOOR · 1,700–1,735 m · TEACH · Int. 1→2 · 3.5 min
- **READ:** A door carved with a hood; on a hook beside it, a keeper's hood. Plaque: **"KEEP THEM LIT."** Through the
  door, darkness and one stone figure on a ledge.
- **CHOICE:** None real: take the hood (grip it; it clips onto your lamp). Hint (once): VR *"Point your left hand. Your
  light holds them still."* / desktop *"Your lantern follows your view. What it lights holds still."*
- **COMMIT:** Walk the ledge past the figure.
- **RISK:** The lesson (non-lethal on all difficulties): when your light leaves it, it moves; it stops 1 m from you with
  its empty hand raised to your lamp.
- **RECOVERY:** n/a. A shrine and lamp L4-1.
- **REWARD:** Understanding, and the first shrine's warmth.
- **ESCALATION:** Below the shrine, rows of them.

#### IV-2 · THE STACKS · 1,735–1,820 m · TEST · Int. 3 · 5 min
- **READ:** Walkways between shelf cliffs, Kept on ledge rails on both sides; anchors on cranes and walkway beams; two
  shrines glowing below.
- **CHOICE:** The walkways (Kept on both sides, slow) or a swing line over the void (fewer Kept, but the ones on your
  anchor ledges must be lit as you go).
- **COMMIT:** Light one side and listen to the other (the grind gives direction); move between shrines.
- **RISK:** Lethal from here (the grab rule). Falls into the canyon.
- **RECOVERY:** Shrines are true safe islands; lamp L4-3 at the middle shrine.
- **REWARD:** N4-1 at a Keeper shrine; N4-2 in a niche reached by letting a held ring carry you home (IV-3 preview).
- **ESCALATION:** The walkways end at the void. Only held rings cross it.

#### IV-3 · THE HANDS · 1,820–1,900 m · TWIST · Int. 3 · 5 min
- **READ:** Overhanging walkways above a 60 m void; Kept on them hold rings aloft; the rings are out of reach.
- **CHOICE:** Bring a ring to you (let it walk in the dark), then light it in reach; or chain two statues: ride one ring
  home while lighting the next.
- **COMMIT:** The new skill: **swing on the right rope while the left hand's light holds the next ring still.**
- **RISK:** Light slips off the ring you are hanging from: it carries you (slowly, toward its home); light slips off a
  walkway Kept: it comes for you.
- **RECOVERY:** Normal: a static ring under each held-ring transfer; NM half; AB none. Lamp L4-5 at a mid shrine.
- **REWARD:** The fast line (a two-statue chain without touching a walkway) saves ~30 s.
- **ESCALATION:** The walkways give way to cages on chains.

#### IV-4 · THE HANGING CAGES · 1,900–1,960 m · REMIX (II) · Int. 3 · 4 min · [cuttable]
- **READ:** Iron cages swing on chains across the canyon (pendulum movers), a Kept inside each.
- **CHOICE:** Hang from a cage's ring (fast) or the chain above it (safe from its occupant, slower to reach).
- **COMMIT:** Keep the light on the occupant of the cage you hang from while timing the next cage's swing.
- **RISK:** Unlit occupants reach through the bars (hazard boxes active only while unlit); mistimed swings.
- **RECOVERY:** Chains above every cage; lamp L4-6 at the start.
- **REWARD:** N4-3 inside a cage (enter through its open door while you hold its occupant lit).
- **ESCALATION:** Across the canyon, something large is coming down the far wall.

#### IV-5 · THE GATHERING · 1,960–2,000 m · CREATURE BEAT / TRUTH 4 · Int. 2→4 · 3.5 min
- **READ:** An alcove 30–40 m across the canyon from the far shelves. Plaque: **"THEY ONLY WANT THE LAMP THAT LEFT
  THEM."** The menders' scaffold beside a wall that has closed over their tools.
- **CHOICE:** Watch, or leave along the alcove's back path at any time.
- **COMMIT:** Stay still and watch: the Mason comes down the far wall and **pulls Kept off the shelves into its body**;
  its tail pays out of a breach as it lengthens. One of the figures it takes **wears your gauntlets**.
- **RISK:** Any loud noise makes it turn early and cross toward you (hunt). Stay silent and it finishes and climbs away.
- **RECOVERY:** Lamp L4-7 in the alcove.
- **REWARD:** Truth 4 (unmissable from the alcove; the gaze log checks it). N4-4 on the menders' scaffold.
- **ESCALATION:** It goes down into the horns.

#### IV-6 · THE HORNS · 2,000–2,060 m · REMIX (knock + noise + breath) · Int. 4 · 4 min · [cuttable]
- **READ:** A round hall ringed by eight colossal listening horns, its floor a black pool. Plaque: **"LISTEN AT THE
  HORN. NEVER ANSWER IT."** The Mason is **inside the horn network**: its sounds come out of all eight mouths at once.
- **CHOICE:** Cross the hall on rings bolted to the horns (fast, in the open) or through the pool (silent, the breath
  clock).
- **COMMIT:** Ten transfers across the hall, a swinging cage in the middle. **Knock into a horn's mouth and your knock
  comes out of its paired horn across the hall**: a decoy (E11). The rope telegraph tells you which horn it is climbing
  toward, because the horns are what your anchors hang from.
- **RISK:** It emerges from whichever horn is nearest the last loud sound; within 10 m it always telegraphs its lunge
  with the 1.5 s wind-up.
- **RECOVERY:** Falls into the pool are safe (rule III); under water you are unheard. Lamps L4-8 (entry) and L4-9 (a pool
  island).
- **REWARD:** N4-5 in a horn's throat (crawl in and hear your own heartbeat amplified). Trial *Silent Horns*.
- **ESCALATION:** The horns go quiet. Above you, a shrine, and then the Last Shelf.

#### IV-7 · THE LAST SHELF (exam) · 2,060–2,190 m · EXAM · Int. 5 · 6 min
See §8.2.

#### IV-8 · THE SILL · 2,190–2,220 m · RECOVERY / EXIT · Int. 1 · 2.5 min
- **READ:** The canyon's floor ends at a sill over white light far below. Colour starts to bleach. A waking lamp (L4-12).
- **CHOICE / COMMIT:** Rest; then lower over the sill on a chain (seam `seam-4-5`).
- **RISK / RECOVERY:** None. **The true rest.** Behind you, at the edge of the white light, the Mason has stopped. It
  will not come into that light. Not yet.
- **REWARD:** Chapter card **"V · THE STILL FLAME"**.
- **ESCALATION:** Your lamp's flame burns white as you go down.

### 8.2 Set-piece: THE LAST SHELF (IV-7)

- **Setup (quiet before).** The end of the Horns, then a shrine at the head of the canyon's narrowest stretch (lamp
  L4-10), 2 min of quiet: a long look down 130 m of shelves on both walls, walkways, a crane, held rings, cages.
- **Trigger.** Leaving the shrine.
- **Two dangers.** The Mason comes down the canyon after you in frenzy, hunting by **sound** and ignoring your light. The
  Kept move whenever your light is elsewhere and ignore sound.
- **The systemic twist.** Kept you leave **unlit behind you** walk toward you, which puts them **in the Mason's path**:
  it stops for ~2.5 s to gather each one into its plates (E17 `gather`). **Light ahead to pass; leave the dark behind you
  to buy time.** A player who shepherds three Kept into its path earns a clear 7 s.
- **Phase A, the walkways (~60 s):** walkway Kept on both sides, held rings across the gaps.
- **Phase B, the crane and the cages (~50 s):** a crane trolley (moving anchor) and two cages; lamp L4-11 on the crane
  platform (phase checkpoint).
- **Phase C, the last shelf (~40 s):** a long drop on held rings to the Sill's rim with Kept on every side. At the rim, the
  Mason stops dead at the edge of the white light below.
- **Lines.** Safe: lit walkways (slow; more Kept to manage). Fast: held-ring swings in the void (fewer Kept, tight
  light timing).
- **Difficulty.** Kept speed and cone per §4.6; gather pause 2.5 / 2.0 / 1.5 s; Mason escape-grade pursuit
  (N/NM/AB presets); recovery rings 3 / 1 / 0.
- **Fairness (E28).** The bot runs with a scripted lantern aim (always on the next Kept on the route) and survives at
  75 % of optimal; no Kept rail passes within 4 m of the next main-route anchor's hang point; the gather pause is applied
  before any lunge check; a stalling bot dies.
- **Trailer shot:** holding a Kept still with the lantern while swinging on the other rope, the crown rising behind it.

### 8.3 Creature beats, hazards, Names, lamps, music (Chapter IV)

**Creature beats:** absent (IV-1 to IV-4; distant knocking only) → **the Gathering** (witnessed; turns early on noise)
→ inside the horns, heard from eight mouths, decoyed by your knocks (IV-6) → the two-danger chase; gathers the Kept you
leave in its path (IV-7) → stops at the edge of the white light (IV-8).

**Hazards (the other danger: the Kept):** grabs (stagger, forced release, death on the second); reaching occupants of
cages; falls in a 500 m canyon; the Mason (IV-5 on noise, IV-6, IV-7).

**Mechanics introduced:** the hooded cone, light holds the kept, the Kept, held rings (steered moving anchors), the
flame's lean, remnants that turn. **Remixed:** live anchors (cages, crane, held rings), breath (the Horns' pool), knocking
(horn decoys), safe light (shrines), chaining (two-statue chains).

**Names**

| Name | Where | Mastery | Codex line |
|---|---|---|---|
| N4-1 **ENNIS** | A Keeper shrine in the Stacks | Knock the shrine plate's rhythm | *Asked to be left in the dark. We did not let him.* |
| N4-2 **GERVASE** | A home niche in the Stacks | Let a held ring carry you home | *Kept the shelves four hundred years. Lit every face, twice.* |
| N4-3 **NELL** | Inside a hanging cage | Enter while holding its occupant lit | *Reached through the bars for every passing light.* |
| N4-4 **HOB AND HALLAM** | The menders' scaffold (Gathering) | Reach it while the Mason feeds, unheard | *Went down to mend the deep course. Came back as the wall.* |
| N4-5 **VESPER** | Inside a listening horn's throat | Crawl in under the Horns | *Listened at the horn every night. Heard her own name.* |

**Plaques:** KEEP THEM LIT. · THEY ONLY WANT THE LAMP THAT LEFT THEM. · LISTEN AT THE HORN. NEVER ANSWER IT. · THE DARK
SHELVES ARE NOT TO BE ENTERED. (Stacks, at a dead end)

**Trials:** *Ungrasped* (the whole chapter without a grab) · *Silent Horns* (the Horns without it investigating you
once) · *Shepherd* (make it gather six Kept in the Last Shelf).

**Waking lamps**

| Lamp | Where | N | NM | AB |
|---|---|---|---|---|
| L4-1 | Keeper's Door shrine (chapter start) | ● | ● | ● |
| L4-2 | Stacks entry | ● | | |
| L4-3 | Stacks, middle shrine | ● | ● | |
| L4-4 | The Hands, start | ● | | |
| L4-5 | The Hands, mid shrine | ● | ● | |
| L4-6 | Hanging Cages, start | ● | | |
| L4-7 | Gathering alcove | ● | ● | |
| L4-8 | Horns entry | ● | | |
| L4-9 | Horns pool island | ● | ● | |
| L4-10 | Last Shelf head shrine (exam start) | ● | ● | |
| L4-11 | Crane platform (exam phase B) | ● | ● | |
| L4-12 | The Sill (chapter end) | ● | ● | ● |

**Music and ambience**

| Cue | Trigger | Content |
|---|---|---|
| `amb.ch4.keeping` | always | Dry dust, almost nothing; stone grinding only while a Kept moves (HRTF); the flame's tick |
| `mus.ch4.stems` | IV-2 onward | Calm / Pressure / Peak: dry strings struck and scraped, breathy low winds without melody, a drone |
| `cue.ch4.gathering` | IV-5 | The Lamp motif **inverted** and slowed; each gathered figure lands as a soft low hit |
| `amb.ch4.horns` | IV-6 | Diegetic: the Mason's sounds routed out of eight horn mouths; score drops to a drone |
| `cue.ch4.lastshelf` | IV-7 | Bespoke percussive cue built from stone grinds, synced to its gather pauses (each pause is a held breath in the music) |
| `sil.ch4.sill` | IV-8 | Silence, then a high white tone rising from below |

---

## 9. Chapter V · THE STILL FLAME

*"Hold still."* Depth 2,220 → 2,700 m (480 m), then **240 m up** the First Throat. `depthOffset` 2,220. **Length
target: 32–36 min**, plus 3–4 min of ending; 6–7 min skilled Abyss. Mason body: 32 segments, stone-pale, stillness
shader states.

**Environment.** The oldest place. Cathedral stonework gives way to rough-hewn steps, then to bare rock: the order's
history in reverse as you descend. A ravine where a waterfall and a rockfall hang **frozen in mid-air**; **prism
engines** (Lanternwright machines) turning shafts of the Flame's light in slow sweeps; **the Halo**, a spherical cavern
160 m across filled with stilled debris and Lanternwrights stilled mid-fall; at its floor, **the Still Flame** on bare
rock, small and motionless, and a hooded figure kneeling at it with its hands cupped around the light, **wearing your
gauntlets**. From the Halo's floor the **First Throat** rises: a ribbed, breathing shaft 240 m up to the Lip.

**Palette.** White-gold light, colour and sound draining away: `theme('#cfc6b0', '#f4e6c0', '#ffffff', 12, 150,
0.60)` with a material saturation grade from 1.0 (V-1) to 0.15 (V-6) (E25). Fog fades to white, not black. Anchors get
dark iron rims; stilled objects get a pale rim that disappears when they are about to fall.

**Mood.** Sacred awe, then terror, then quiet.

**New rule: STILLNESS.** *"The Flame's light holds everything still: falling stone, water, iron, the Mason, and you.
Shadow shelters you, and lets things fall."*

- **Still-light** (E23) comes from the Flame and from beams the prism engines throw. What it touches **holds**: falling
  debris hangs in the air, waterfalls stand as glass columns, movers stop (time scale ramps to 0 over 0.2 s), and the
  Mason **freezes** once its crown has been lit for 0.3 s (0.45 NM, 0.6 AB).
- **It holds you too.** In direct still-light your `stillness` builds: full in 12 s on Normal (9 NM, 7 AB), three times
  faster within 3 m of the Flame, half as fast in a beam. Shade lets it fall from full to zero in 3 s. As it builds,
  reel and swing weaken, tether range shrinks, your gauntlets grey into stone, sound dims and **your heartbeat slows**
  (the threat cue inverted). At full you die: *"You held still."* (cause `still`).
- **Shade** comes from solid cover or from **the Mason's body**: its shadow (capsules around its spine) is a moving
  shelter.
- **Stilled debris** (solids and anchors flagged `still`): platforms and anchors **only while lit**. When shade reaches
  one (the Mason's shadow, a prism beam turning away), it loses its pale rim, cracks (0.8 / 0.6 / 0.4 s), and falls; if
  you are on it or tethered to it, you fall with it.
- **Your lamp burns white** this close to its source: its cone (rule IV) now counts as still-light for stilled debris
  (hold a slab lit as a sweep passes and swing from it) and for the Mason's crown (freeze it as it turns toward you). It
  never adds stillness to you. **Both tethers stay usable**: the cone is simply where your left hand points.
- **The Mason moves only in shadow** and goes **for the Flame, not for you**; it still kills by proximity.

### 9.1 Beat sheet

#### V-1 · THE FIRST STEPS · 2,220–2,290 m · TEACH · Int. 1 · 3 min
- **READ:** Rough-hewn steps; wordless reliefs of the first waking (a figure rising beside a small flame, arms raised in
  joy). **The tally wall**: hundreds of weathered marks, one per pilgrimage, and room for more. A shaft of white light
  crosses the stair.
- **CHOICE:** Step into the light or around it. Hint (once): *"This light holds everything still. You too. Find shade."*
- **COMMIT:** Cross the beam; feel your gauntlets grey; step into shade and feel them warm.
- **RISK:** Stillness (the first beam is too short to kill on Normal).
- **RECOVERY:** Shade everywhere; lamp L5-1.
- **REWARD:** Knock on the tally wall and your knock leaves a fresh notch (N5-1). A relief carries N5-2.
- **ESCALATION:** The steps end at a waterfall that is not falling.

#### V-2 · THE STILLED FALL · 2,290–2,380 m · TEST · Int. 2→3 · 4.5 min
- **READ:** A frozen waterfall and a frozen rockfall hang down a 90 m ravine; overhangs and pillars throw shade; a prism
  engine's beam rests on the fall.
- **CHOICE:** Climb down the shaded wall (slow, safe from stillness) or swing on the stilled rubble in the light (fast,
  stillness rising).
- **COMMIT:** Descend; when the prism turns, the rubble you are on loses its rim: get off, or **hold it lit with your
  cone** and swing from it.
- **RISK:** Stillness in the open; falling rubble.
- **RECOVERY:** Pools under the frozen fall catch you when its water lets go in shade (rule III); lamps L5-3, L5-4.
- **REWARD:** N5-3 on a Lanternwright stilled mid-fall, reached by riding a held slab.
- **ESCALATION:** Three prism engines below, sweeping.

#### V-3 · THE SWEEP · 2,380–2,470 m · TWIST / REMIX (II, III) · Int. 3 · 4.5 min
- **READ:** A ravine crossed by three swept beams on 20–40 s clocks, readable in the white fog; light-locked rings on
  hanging debris with halos; a pendulum hanging still in a beam; waterfalls that are columns in the light and water in
  the shadow.
- **CHOICE:** Ride the light-locked rings as the beams pass (fast) or move shade to shade along the wall (slow).
- **COMMIT:** Hop between light-locked anchors as the light passes; **freeze the pendulum at the top of its arc** (wait
  for a beam to cross it at its apex) to make a high anchor (rule II); swing on a waterfall column, drop when it turns to
  water into the pool below (rule III).
- **RISK:** A halo drains (0.8 / 0.6 / 0.4 s) and the debris falls with you on it.
- **RECOVERY:** Pools; Normal catch rings under the longest light-locked transfers; lamps L5-5, L5-6.
- **REWARD:** The frozen-pendulum line saves ~25 s. N5-4 on a ledge reachable only by riding falling debris down.
- **ESCALATION:** Above the ravine mouth, a long shadow moves.

#### V-4 · UNDER ITS SHADOW · 2,470–2,540 m · TWIST (creature) · Int. 4 · 4.5 min
- **READ:** The Mason crosses the ravine mouth above, going down toward the Flame. It moves only in shadow; where a beam
  catches its crown it freezes. Its shadow sweeps the debris field.
- **CHOICE:** Travel inside its moving shadow (safe from stillness, close to it) or in the open light (far from it,
  stillness rising).
- **COMMIT:** Ride its shadow down the debris field: debris falls where the shadow passes (so you must keep moving with
  it), but inside it you are safe from the light.
- **RISK:** Its head (kill radius); falling debris; stillness when you leave its shadow. When it turns toward you, keep
  a beam (or your cone) between you.
- **RECOVERY:** Solid shade under overhangs; lamp L5-7.
- **REWARD:** You learn the chapter's last trick: the predator's shadow is your shelter.
- **ESCALATION:** It drops into the Halo.

#### V-5 · THE HALO (exam 1) · 2,540–2,660 m · EXAM · Int. 5 · 6 min
See §9.2.

#### V-6 · THE FLAME · 2,660–2,700 m · TRUTH 5 / THE CHOICE · Int. 2 · 3.5 min
- **READ:** The Halo's floor. The Still Flame on bare rock, a hand's width tall, utterly still. The **first pilgrim**
  kneels at it, hands cupped around the light, **your gauntlets**, your Name carved on them. The Mason lies coiled around
  the Flame; every 20 s it lowers its crown over the light for 6 s, its pits pulsing a rhythm while it listens, and its
  shadow covers the Flame. The last waking lamp (L5-10) is kindled straight from the Flame.
- **CHOICE:** **The ending** (§9.4). Three acts, each signposted by an image, not text: the first pilgrim's cupped hands
  (*put it out*), your lamp's flame leaning toward the Flame (*kindle and raise*), the Mason's pits pulsing a rhythm while
  bowed (*answer*; only with every Name).
- **COMMIT:** Perform one act with your hands.
- **RISK:** Lingering in the Flame's light stills you (wake at L5-10; no timer, no failure ending). The Mason kills only if
  you walk into its head.
- **RECOVERY:** Its bows are your shade; L5-10.
- **REWARD:** Truth 5 (unmissable). Your own Name, if you missed it at the Mark.
- **ESCALATION:** Whatever you choose, it moves.

#### V-7 · THE STILLING (finale; endings A and B) · up 240 m · EXAM · Int. 5 · 5 min
See §9.3.

#### V-8 · EPILOGUE · Int. 1 · 3 min
A climb with the credits drifting up past you as carved panels; you keep control throughout (§9.4).

### 9.2 Set-piece: THE HALO (V-5)

- **Setup (quiet before).** A shaded ledge on the Halo's rim (lamp L5-8): the frozen sphere below, 160 m across, debris
  and stilled Lanternwrights hanging in white light; the Mason circling the inside of the shell; the Flame a spark far
  below.
- **Beats.**
  1. *Into the sphere (~60 s):* descend the shell's upper face on stilled debris and shell rings, moving between solid
     shade (shell buttresses) and the Mason's moving shadow as it circles.
  2. *The crossing (~60 s):* the open middle of the sphere has no solid shade; only its shadow, sweeping as it circles,
     and your cone holding the debris it would drop. Colour almost gone; sound fading to breath and heartbeat. Lamp L5-9
     on a buttress ledge (phase checkpoint).
  3. *The floor (~40 s):* it coils around the Flame. The only way across the open floor is **beside its body, in its
     shadow**, close enough to hear its plates breathe.
- **Lines.** Safe: buttress to buttress (more stillness exposure, longer). Fast: ride its shadow through the open middle
  on falling debris.
- **Difficulty.** Stillness and warnings per §4.6; recovery rings in the sphere 4 / 2 / 0.
- **Fairness (E28).** A bot following the shadow schedule at 75 % of optimal ends with stillness ≤ 70 % on Normal; every
  stilled anchor on the main route stays lit ≥ 2.5 s per pass; the Mason's head path keeps ≥ 4 m from the shadow route.
- **Trailer shot:** walking in the Mason's shadow through the white Halo.

### 9.3 Set-piece: THE STILLING (V-7, the finale)

Plays after ending act **A** (the dark rising) or **B** (the stillness rising); not after C.

- **Setup.** After the act, ~10 s of quiet: B: white light pours out of the Flame across the floor and begins to climb;
  A: the Flame dies, three seconds of true silence (breath and heartbeat only), then lamps far below and around begin to
  go out, soft pops, the dark climbing. The Mason uncoils and goes **up** (B: fleeing the stillness; A: chasing the last
  kindled light, yours). You are in its way. The only way out is **up the First Throat** (the Lanternwrights named
  Chapter I's Last Throat after it).
- **Three bodies:** you on top, the Mason in the middle, the **front** (E19 `still` or `dark`) at the bottom, rising at
  ~70 % of the Mason's speed. You must out-climb the Mason until the front catches it.
- **Beats.**
  1. *Ride the exhale.* The Throat breathes on a 9 s cycle (rule III's currents, in air): **exhale** (an updraft: release
     and rise ~25 m), pause, **inhale** (a downdraft: be tethered), pause. Each breath is heard 1.5 s ahead. The ribs
     contract on the inhale (movers, never narrower than 6 m) and open on the exhale. Reel ring to ring between breaths.
  2. *Below you.* It climbs (rubber-banded path, lethal at the head, lunges telegraphed upward). Looking down: its crown;
     far below it, the light (or the dark), gaining.
  3. *The overtake (~200 m).* It swings onto the far wall and passes you, plates grinding 4 m away for 6 s, felt through
     the rope; it reaches the Lip first. At that moment the front reaches the Throat's "lungs": **the breathing stops.**
     The last 40 m are pure fire-and-reel toward a predator waiting above you.
  4. *The freeze.* As you reach the top ring it turns and lunges down for your light.
     - **B:** the stillness surges past you and **catches it mid-lunge**: the crown frozen an arm's length from your
       raised lamp, the pits fading from glow to stone, its body a stone ladder up to the Lip.
     - **A:** the dark catches it and **it comes apart**: hundreds of hooded figures loosen from its plates and fall away
       past you (non-colliding), to lie down along the Throat; the crown last.
     A guaranteed scripted near miss, timed to your arrival (`attached: 'throat-top'`).
- **Lamps.** L5-11 at 100 m and L5-12 at 200 m on Normal; L5-11 only on Nightmare; none on Abyss. Retry restores the
  front, the Mason and the breath cycle exactly.
- **Difficulty.** Mason uses the escape presets; exhale lift 25 / 22 / 19 m per breath; front speed 70 / 75 / 80 % of
  the Mason's.
- **Fairness (E28).** A bot that catches every exhale stays ≥ 12 m above the Mason on Normal until the overtake; a bot
  that misses two exhales is caught; the overtake path keeps ≥ 4 m from every route position; the front never kills
  before the Mason does except for a player who stalls ≥ 3 s on a ring.
- **Trailer shot:** the climb with the crown below you and the light rising beneath it (never the freeze: no ending
  spoilers in marketing).

### 9.4 The endings (performed, never watched)

All three are physical acts at the Flame during V-6. Desktop alternatives in brackets. The run timer for Chapter V stops
when the act completes.

| Ending | The act | What happens | Epilogue climb (credits) | What it changes |
|---|---|---|---|---|
| **A · UNKINDLED** | While the crown is bowed (its shade lets you survive the light), put both hands around the Flame over the first pilgrim's stone hands and hold both grips for 3 s. [Look at the Flame within 1.5 m and hold E for 3 s during a bow.] | The Flame dies in your hands. **THE STILLING** (dark). At the top it comes apart below you; then the dark reaches your lamp and it gutters out. | In the dark, the Lanternwrights' **phosphor paint** still glows: a line of rings up the last 60 m, spaced so no miss is lethal. At the top ring, a draft of air from very far above. | No one wakes again, including you. End card: *"THE UNKINDLED. Left behind: N. From here, no one wakes."* Menu scene: the Threshold's lamps are dark. |
| **B · KEPT** | Hold your lamp into the Flame for 1.5 s, then raise it above your head. [Hold F at the Flame for 1.5 s, then hold E.] | Your lamp takes the Flame's whole light; stillness pours up from the Halo. **THE STILLING** (still). It freezes mid-lunge an arm's length from your lamp. | Climb **its petrified back** by the rings riveted in its plates (*trust the ring*) to the Lip, while the stillness rises slowly behind you. At the Lip it reaches you: colour drains, haptics fade, your gauntlets turn to stone, your lamp stays raised. You can still look around. Far above, faintly: a lantern catching at the Threshold. Someone waking. | Every statue in the game was a Keeper who chose this. The loop continues. End card: *"THE KEPT. You hold still. Far above, someone wakes."* Menu scene: a third raised-lantern statue at the Threshold, wearing your gauntlets. |
| **C · ANSWERED** *(secret: all 25 Names and your own)* | While the crown is bowed, **knock your own Name on it**. [K in rhythm; with *Trace Names* on, touch the crown and play it from the wrist.] | It goes still and listens. One by one, every Name you collected knocks back from inside its body (spatialised, layered), and with each one a hooded figure unfolds from its plates and kneels in a ring around the Flame. Emptied, the crown settles beside the first pilgrim. You put your hands over the first pilgrim's hands and put the Flame out together (both grips, 3 s). No chase. | Climb **the emptied Mason's back**, which lies up the Throat wall like a ladder of plates and rings, lit by 26 small dark lanterns glowing faintly for you; the knocks of the Names become a slow rhythm under the credits. | *DO NOT ANSWER* was the Keepers' fear. The knocking was the left-behind asking to be named. End card: *"THE ANSWERED. Named: 26."* Menu scene: 26 small lanterns glow around the Threshold arch. |

- **If the player does nothing** at the Flame, nothing changes: the bows repeat and lingering in the light stills you
  (wake at L5-10). No timer, no failure ending, no soft-lock.
- **Return to the Flame** (main menu, after the first ending) starts at L5-10 so the other endings take minutes.
- The menu scene shows the most recent ending; Pilgrim mode adds your statue to the Threshold (§10.6).
- **Rating care.** Bodies are stone, never flesh; no blood, gore or dismemberment (the come-apart in A is hooded stone
  figures loosening and lying down). The Unkindled are rest from a curse, peaceful, never graphic. No children anywhere.

### 9.5 Creature beats, hazards, Names, lamps, music (Chapter V)

**Creature beats:** above you and indifferent, its shadow crossing the ravine mouth (V-4) → circling the Halo's shell, its
shadow your shelter (V-5) → coiled around the Flame, bowing (V-6) → the overtake and the freeze or the coming-apart
(V-7) → a stone ladder (B) or an emptied body lying along the Throat (C).

**Hazards (the other danger: stillness):** stillness in the light; stilled debris falling in shadow; light-locked anchors;
the Mason's head; the Throat's inhale; the rising front.

**Mechanics introduced:** still-light, player stillness, shade (incl. the Mason's shadow), stilled debris and light-locked
anchors, your white cone holding debris and freezing the crown. **Remixed:** every earlier rule (§4.2), the breath cycle
(currents in air), knocking (the tally wall, ending C).

**Names**

| Name | Where | Mastery | Codex line |
|---|---|---|---|
| N5-1 **THE COUNTER** | The tally wall | Knock: your knock leaves a notch | *Carved a mark for every pilgrim. Left room.* |
| N5-2 **FIRST WAKER** | A relief on the First Steps | Knock the relief's border rhythm | *Woke here first. Wept, then laughed.* |
| N5-3 **AMICE** | A Lanternwright stilled mid-fall, the Stilled Fall | Ride a held slab to her | *Fell toward the light. Is falling still.* |
| N5-4 **ORRIN** | A ledge in the Sweep | Ride falling debris down to it | *Rode the falling stone down. Never landed.* |
| N5-5 **THE LAST KEEPER** | The Halo shell | Reach the shell's buttress niche in the crossing | *Held the light on us until she held still.* |

**Trials:** *Shadowed* (the Halo with stillness never above 50 %) · *Unfallen* (V-2 to V-4 without riding a falling slab
down) · *Last Breath* (the Stilling without riding an exhale; bot-verified possible before it ships).

**Waking lamps**

| Lamp | Where | N | NM | AB |
|---|---|---|---|---|
| L5-1 | First Steps (chapter start) | ● | ● | ● |
| L5-2 | The tally wall | ● | | |
| L5-3 | Stilled Fall, top | ● | ● | |
| L5-4 | Stilled Fall, mid shade | ● | | |
| L5-5 | The Sweep, start | ● | ● | |
| L5-6 | The Sweep, mid | ● | | |
| L5-7 | Under Its Shadow, start | ● | ● | |
| L5-8 | Halo rim (exam start) | ● | ● | |
| L5-9 | Halo buttress ledge (phase B) | ● | ● | |
| L5-10 | The Flame (kindled straight from it; the choice) | ● | ● | ● |
| L5-11 | First Throat, 100 m | ● | ● | |
| L5-12 | First Throat, 200 m | ● | | |

**Music and ambience**

| Cue | Trigger | Content |
|---|---|---|
| `amb.ch5.still` | always | A bed that drains: by V-5 only breath, heartbeat and a high, almost inaudible tone; stillness ducks and low-passes the whole mix (E26 silence system) |
| `mus.ch5.stems` | V-1 onward | Calm / Pressure / Peak: wordless choir-like pads thinning to sine tones across the chapter |
| `cue.ch5.halo` | V-5 | Bespoke cue whose instruments drop out one by one as colour drains |
| `sil.ch5.flame` | V-6 | No score. The Mason's pulsing rhythm (the hint for C) and the Flame's silence |
| `cue.ch5.stilling.b` / `.a` | V-7 | Two variants of one cue: the Lamp motif in full over the breath cycle; the freeze (B) is **one beat, then nothing**; the coming-apart (A) is a long fall of soft stone hits into silence |
| `theme.end.a` / `.b` / `.c` | V-8 | Three ending themes over the credits climb; C's is built on the Names' knock rhythms |

---

## 10. Progression, saves and replay

### 10.1 Structure and flow

- **The main menu is a place**: the Threshold, seen from the spawn ledge, with carved stone panels (pointer UI in VR,
  DOM on desktop). Panels: **Continue**, **The Descent Line** (chapter select), **Codex**, **Records**, **Settings**,
  and, once earned, **Return to the Flame**, **Full Descent**, **Pilgrim**. Demo installs also show the unlock offer.
  The scene reflects the latest ending (§9.4).
- **Continue** resumes at the last kindled lamp of the current chapter, at the difficulty you were playing, with the
  world restored from that lamp's snapshot (E03, E05).
- **The Descent Line** (chapter select): a carved vertical diorama of the five strata on the Threshold wall. Point at a
  stratum to see its medals per difficulty, Names x / 5, trials, the Unwoken lamp and best times. Reaching a chapter
  unlocks it on every difficulty. Demo installs see strata II–V carved but sealed, with the price.
- **Difficulty is chosen per chapter start.** Changing difficulty mid-chapter restarts the chapter at the new difficulty.
  Records are kept per chapter per difficulty.
- **Chapter boundaries** are seams (E04): no loading screens, ever. A chapter is complete when you reach its exit lamp;
  its time stops there.
- **After purchase** everything carries over: Names, records, medals, remnants, settings, endings.

### 10.2 What is saved (contract in E05)

| Data | When written | Notes |
|---|---|---|
| Run state: chapter, difficulty, lamp id, beat/mover snapshot, run time, deaths, Woken | Each lamp kindle; chapter complete; pause → quit | One active run per profile |
| Per chapter × difficulty: reached, completed, best time, fewest deaths, medals, section splits | Chapter complete; split on section enter | Records migrate from today's `best.<diff>` keys into Chapter I |
| Names learned (25 + own), trials, Unwoken flags, endings reached | When earned | Shared across difficulties; survive purchase |
| Remnants per chapter (≤ 24) | On death | `x,y,z,pose,cause,section`; < 2 KB per chapter; cleared by "Leave no remnants" |
| Ghosts (best per chapter × difficulty) | Chapter complete with a new best | IndexedDB, ~290 KB per 5 min |
| Totals: Woken, deaths by cause, play time | Continuously, flushed on lamp kindle | Stats page |
| Settings | On change | localStorage, as today |
| Entitlement cache | Entitlement module only | RELEASE §10.5; never written by game code |

Storage is IndexedDB with `navigator.storage.persist()` (T3), with a localStorage fallback; one profile per Horizon
user (Functional.12). "Begin again" resets the run and chapter reach, never records, Names or endings.

### 10.3 Difficulties (unchanged keys, applied per chapter)

| Mode | What it means in every chapter |
|---|---|
| **Normal** | The intended descent. Generous assist, recovery anchors, all lamps, the mercy rules. |
| **Nightmare** | Faster, more aggressive Mason, tighter aim, fewer recovery anchors, every other lamp plus exam starts, harsher rule numbers (§4.6). |
| **Abyss** | For speedrunners. Minimal assist, almost no recovery, the chapter-start lamp only, the harshest rule numbers. |
| **Sandbox** | No predator (unless toggled), falls never lethal, warp to any lamp, the chapter's toys (§10.6). Times not recorded. |

### 10.4 Medals, times and splits

- **Three medals per chapter per difficulty** (45): **Iron** (finish), **Brass** (par), **Still** (expert). Brass = 0.5 ×
  the median first-time completion time from BETA telemetry; Still = the best developer ghost × 1.10. Targets are set
  from data during BETA, never guessed. Order of magnitude for Chapter I Normal: Brass ~12 min, Still ~5.5 min.
- **Section splits** on the wrist HUD against your best (and your ghost, when on).
- **Ghosts**: your best run per chapter and difficulty replays as a faint phosphor figure with its ropes (E12).
- **Full Descent** (after the first ending): all five chapters as one timed run with chapter splits; the hook's end card
  and title cards are skipped; seams play. Categories: Normal / Nightmare / Abyss × *any%* / *Names%*.
- Leaderboards are local only at 1.0 (no backend).

### 10.5 Collectibles and trials

- **Names**: 25 (5 per chapter) plus your own. Each sits behind a **mastery use of its chapter's rule**, never a
  scavenger hunt: about two per chapter are on or beside the main route, the rest reward the fast line, a risk line, a
  set-piece detour or a clever use of a mechanic. Learning one: find the notch carving, knock its rhythm on that object;
  its dark lantern glows for one breath, a tonal knock answers, the rhythm is etched on your wrist and the **Codex**
  gains its line. Read in order, the 26 lines tell the order's decline. All 26 unlock ending C.
- **Trace Names** (accessibility, motor; not a comfort option): hold grip on a carving for 2 s to learn it; play any
  learned Name back from the wrist.
- **Trials** (15, three per chapter; listed per chapter): constraint runs that turn the rule inside out. Rewards are
  cosmetic only (rope tints, lantern-cage variants) and each chapter's Sandbox toys.
- **Unwoken**: finish a chapter without dying (any difficulty) and its stratum's lamp burns steady on the Descent Line;
  all five unlock the *Unwoken* lantern cage.

### 10.6 Modes after the first ending

- **Return to the Flame**: start at L5-10 to perform another ending.
- **Pilgrim** (new game plus): no hints; the Mason one difficulty step more aggressive; remnants persist across the whole
  save and shift closer in the dark; the Kneeling One is missing from the Mark chamber; **your statue stands at the
  Threshold**; one remix toggle per chapter (II: the engine runs at 1.2× from the start; III: breath −25 % and the Drain
  starts 10 s sooner; IV: the hood's cone is 10° narrower; V: the prism engines sweep in reverse). **First on the cut
  list.**
- **Sandbox toys** per chapter (unlocked by that chapter's trials): II scrub and pause mover clocks; III water-level
  slider; IV Kept on/off; V beams on/off and stillness off; every chapter: replay its set-piece, show volumes, mover paths
  and noise rings (the T2 overlay in player form). Good for practice and for content creators.
- **Records page**: deaths by cause per chapter (`impact`, `fall`, `hazard`, `creature`, `crush`, `drown`, `kept`,
  `still`), Woken N times, remnants left behind, Names, trials, medals, endings, play time.

---

## 11. Text budget (all in-world text, under 900 words)

| Kind | Count | Words |
|---|---|---|
| Chapter I plaques (existing, unchanged) | 7 | ~70 |
| New plaques (≤ 12 words each) | 14 | ~120 |
| Names codex lines (≤ 12 words each) | 26 | ~260 |
| Hints (new verbs only, shown once; VR and desktop wording count once) | ~22 | ~300 |
| End cards, chapter titles, ending cards | — | ~110 |
| **Total** | | **≈ 860** |

New plaques (complete list, for tone review): LEAVE IT. IT HOLDS MORE THAN LIGHT. · KNOCK, AND BE KNOWN. · EVERY LAMP A
BED. EVERY BED A MORNING. · DRESS THE OLD STONE WITH CARE. IT WAS SOMEONE. · WE ARE PERMITTED OUR LIGHTS. THE MARK IS FOR
THE FEARFUL. · HERE WE PUT OUT OUR LIGHTS, AND SLEPT. · WE TUNED THE BELLS TO ITS HEARING. FOR A TIME IT LISTENED. ·
SOUND IT SLOWLY. IT LISTENS AT THE WATER. · NOTHING WAKES WHAT IS NOT KINDLED. · KEEP THEM LIT. · THE DARK SHELVES ARE
NOT TO BE ENTERED. · THEY ONLY WANT THE LAMP THAT LEFT THEM. · LISTEN AT THE HORN. NEVER ANSWER IT. · Chapter V has
none: its story is reliefs, the tally wall and the kneeling figure. All text lives in data (localisation-ready).

---

## 12. Considered and set aside (not in 1.0)

| Idea (pitch) | Why not | What survives |
|---|---|---|
| **Beneath the Mason**: riding the creature (set-pieces) | Dilutes the dread the sense economy builds; rideable creature mode is the riskiest system in any pitch; judges 2 and 3 against | Contact horror through the rope telegraph, the Belfry knock, the Plunge, the Stilling's overtake; ending B and C climbs on its body (static) |
| **Lampfall** and skydive volumes (set-pieces) | A fourth chase-type set-piece; 300 instanced debris and rope-cutting limbs; falling-city originality risk | The elastic catch on every high-speed arrest (E15); a post-launch chapter candidate ("The Hanging City") |
| **Wicks / Sallows** swarms (set-pieces, systems) | A second species overlapping the Kept; a third sense to teach | The Kept are the second species |
| **Echolocation crack**, chalk, knowledge-gated darkness (systems) | Too close to existing echolocation horror; a whole chapter of it was rejected by judges 1 and 3 | Knocking is the VR-native gesture; horns carry knocks as decoys |
| **The Kilnworks** heat zones and the Gantry Run in a foundry (set-pieces) | A chapter slot we gave to Lamphold | The Span (II-8) is the Gantry Run; `safeLight` is the creature-avoid shelter |
| **The Plumb** lens and 1.7 km shaft reveal (systems) | Competes with the Mark's story beat; adds a second "lamp" | The flame that leans toward the Flame is the compass |
| Tide clock (systems), updraft chapter (set-pieces) | Two-rule chapters | Scripted surfaces (the Drain); the Throat's breath in the finale |
| Carried freeze beam that costs the left tether (systems) | Takes a tether away at the climax | Your white cone in V; both tethers stay usable |
| Rope burn, rope wrapping, hand-tracking-only play, online leaderboards, voice-over | Systems' own reasons; no backend | — |

---

## 13. Production order, gates and cuts

Engineering detail and sizes are in ENGINE_EXTENSIONS §2. Art and audio scheduling are in ART_AUDIO_PLAN §7.

| Milestone | Content | Gate (all must pass) |
|---|---|---|
| **M0 Foundations** (~4 wk) | Engine foundations (E01–E06, E28, E29); the harness promoted into the repo; the Blender blockout exporter; **the Quest purchase spike on device** (T11: does an XR `select` start the payment dialog?) | Chapter I verifies green under the new harness; the purchase spike result is recorded and the fallback chosen if it fails |
| **M1 Demo** (~6 wk) | Chapter I polish P1–P16, THE MARK, the end card, the replay layer | **Demo release candidate**: ≥ 10 first-time VR testers: median 24–28 min; ≥ 90 % chain two-handed by S7; ≤ 3 median deaths in the Spiral; ≥ 70 % can say what the statues are; 72 fps sustained over 45 min; IAP flow passes RELEASE §10.8 on ALPHA |
| **M2 Lamphold** (~8 wk) | Chapter II; Snuffing graybox in week 1 | Playtest gate (below); harness green |
| **M3 The Mere** (~8–9 wk) | Chapter III; Drain and Plunge graybox in week 1 | Gate; breath fairness |
| **M4 The Keeping** (~8 wk) | Chapter IV; a Kept + lantern greybox room in week 1 (hand-load risk) | Gate; two-hand load ok |
| **M5 The Still Flame** (~8–9 wk) | Chapter V, endings, credits, menu variants; Halo and Stilling graybox in week 1 | Gate; all three endings reachable |
| **M6 Release** (~5 wk) | Full Descent, Pilgrim, store assets, localisation-ready text, VRC sweep, thermal soak | RC passes RELEASE §12–§14 |

**Chapter playtest gate (every milestone):** ≥ 10 first-time VR players; median time inside the chapter's target; ≤ 3
median deaths per set-piece on Normal; ≥ 70 % can state the chapter's truth; Mason screen time ≤ 10 % (gaze log);
breath/stillness/Kept never cited as "unfair" by more than 2 of 10; 72 fps sustained; no blocker bugs.

**Per-chapter pipeline:** this beat sheet → Blender blockout (exporter, E28) with the set-piece graybox first → harness
routes and fairness checks green → desktop playtest → internal VR playtest → kit art pass → audio pass → BETA (under
200 users, RELEASE §12) → polish.

**Schedule honesty.** At this scope and polish bar, a 3–4 person core team needs **~47–50 weeks** (to about October
2027), not the "about 4 weeks per chapter" in RELEASE §17. Options for the owner (§14): accept the date; add two level
designers and one environment artist (~36 weeks); or release the demo earlier as a wishlist builder.

**Cut list, in order, if time runs short:** Pilgrim mode → ghosts (keep splits) → the [cuttable] sections (II-6's
houses, IV-4, IV-6; shrink II-4 and III-7) → Sandbox toys (keep Sandbox) → cosmetic trial rewards → the *Lampless*
trial. **Never cut:** THE MARK; the five exams (the Snuffing with the Span, the Drain, the Last Shelf, the Halo, the
Stilling); the Spiral; the three endings; waking lamps and remnants; the TEACH sections of each rule.

---

## 14. Open questions for the owner

1. **Release cadence.** Recommended: launch all five chapters together (reviews judge the whole), with the demo in BETA
   from M1 for feedback. Alternative: publish the free Chapter I early as a wishlist builder (RELEASE §17 notes the
   unlock cannot be sold before its content exists).
2. **Team size versus date** (§13): accept ~October 2027, or add content staff.
3. **If the XR `select` cannot start the purchase dialog** (M0 spike): a paid app with *Try Before You Buy*, or a
   desktop-panel purchase path (RELEASE §17 "Not used").
4. **Ending B's tone**: the player is stilled at the end of the default-feeling ending. Recommended: yes; C is the
   hopeful one.
5. **Ending C's gate**: all 25 Names plus your own (recommended, with Trace Names for motor access) or 20.
6. **Remnants on by default** (recommended, with the "Leave no remnants" toggle).
7. **Composer commission** for the adaptive score (ART_AUDIO_PLAN §5.4): budget and timing (stems needed from M1).
8. **Localisation at 1.0**: English only, or the top store languages (text is < 900 words and lives in data).
9. **Leaderboards** for Full Descent and Abyss in 1.1 (needs a backend and a verified user id, RELEASE §10.7).

---

## Appendix A. ID conventions (shared by design, level data, audio and the harness)

| Thing | Pattern | Example |
|---|---|---|
| Chapter | `ch1`–`ch5` | `ch3` |
| Section | roman-arabic in docs; `s<n>` in data | `III-6` / `s6` |
| Waking lamp | `L<ch>-<n>[b]` | `L2-10` |
| Name | `N<ch>-<n>` | `N4-2` |
| Trial | `T<ch>-<n>` in data, title in UI | `T2-3` *Under the Deck* |
| Mover / volume / front / beat | `<ch>-<kind>-<name>` | `ch2-mov-chand-3`, `ch3-vol-weir`, `ch2-front-span`, `ch2-beat-stopping` |
| Seam module | `seam-<a>-<b>` | `seam-1-2` |
| Audio cue | `amb.` / `mus.` / `cue.` / `sil.` / `sting.` / `theme.` + `ch<n>.<name>` | `cue.ch3.drain` |
