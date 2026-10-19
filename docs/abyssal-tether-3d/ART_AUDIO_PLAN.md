# ABYSSAL TETHER: Art and Audio Plan

> Companion to [CHAPTERS.md](CHAPTERS.md) (what each chapter needs and why) and
> [ENGINE_EXTENSIONS.md](ENGINE_EXTENSIONS.md) (the render and audio contracts, E25 and E26). Date: 2026-10-19. Status:
> **approved plan for production**. Scope: per-chapter Blender kits, materials and textures, creature variants and
> poses, VFX, lighting, the audio plan (what stays procedural, what needs designed SFX and music), and the sourcing
> rules. Nothing here edits `src/` or `assets/` (both are being polished by other agents); deliverables land through
> their owners.

---

## 0. Principles and pipeline

### 0.1 Visual direction (unchanged from the original spec, sharpened per chapter)

- **Dark and stylised, never generic black-screen horror.** Readable silhouettes; mostly desaturated neutrals; **one key
  colour per chapter** (CHAPTERS §4.4); strategic contrast; fog swallows distance. *The player can understand the
  geometry but cannot completely understand the place.*
- **Scale is the spectacle.** Far structures in fog, voids that outsize the play space, the creature longer than any
  room it is in.
- **Bodies are stone.** Statues, remnants, the Kept, the Unkindled and the Mason's plates are carved or dressed stone.
  The Mason's sinew is dark and matte, never wet red. No blood, no gore, no dismemberment, no children (rating care,
  RELEASE §16).
- **Anchors are sacred.** Phosphor-marked and shape-coded in every chapter, readable at full aim range in that chapter's
  fog (§1.1). Art never hides, recolours or crowds a route anchor.

### 0.2 Collision versus art

Collision is the level data's axis-aligned boxes (sphere-vs-AABB physics); **art wraps the boxes** and never defines
collision. Kits are built so their silhouettes can be round, slanted or organic while their collision footprint stays a
box: author kit modules on a **0.5 m grid**, with their collision box documented as a custom property, so the Blender
blockout exporter (E28 T1) can emit the solid and the decor from the same object.

### 0.3 Pipeline

| Step | Tool | Rules |
|---|---|---|
| Blockout | Blender + the blockout exporter (E28 T1) | Unrotated boxes, empties for anchors/lamps/Names/Kept, curves for paths; exported to chapter data |
| Kit modelling | Blender (hand modelling, or procedural `bpy` builders like `tools/abyssal-tether-3d/build_mason.py`) | Metres; Blender Z-up exports as glTF Y-up; pivots at the module's snap corner (environment) or joint (props, creature); names `ch<n>_<kit>_<part>[_v<k>]` |
| Export | glTF binary (`.glb`) per kit | PBR metallic-roughness; one material per texture set; no embedded textures (shared sets from the manifest) |
| Textures | `tools/abyssal-tether-3d/build_textures.py` (original procedural bakes, as today) or hand-painted originals; CC0 sets only through `fetch_polyhaven.py` with a ledger entry | 1024², seamless; `albedo` (sRGB), `normal` (OpenGL +Y), `orm` (R AO, G roughness, B metalness); listed in `assets/textures/manifest.json` with `tileMeters` |
| Integration | `render/themes/<theme>.js` (E25) | Kits instanced; LODs; decor-type registry |
| Review | In headset at 1:1 | Silhouette test, anchor-readability test at max aim range in fog, brightness calibration (T12), budget overlay (T4) |

### 0.4 Budgets (per chapter; the whole frame must stay inside CONTRACT3D's ≤ 150 draws and ≤ 350k triangles)

| Item | Budget |
|---|---|
| New PBR texture sets per chapter | ≤ 3 at 1024² (plus at most one 512² utility map, e.g. water normals) |
| Environment kit triangles visible at the worst moment | ≤ 140k |
| The Mason | ≤ 25k (LOD0 within 15 m), ≤ 10k (LOD1), ≤ 3k silhouette (LOD2 beyond 60 m) at 32 segments |
| Figures (statues, remnants, Kept) | ≤ 30k visible (LOD0 ~2k each within 10 m; LOD1 ~600; impostor cards beyond 40 m) |
| Effects | ≤ 12 draws per chapter, pooled |
| Draw calls per new feature | ≤ 10 (E25) |
| Dynamic lights | ≤ 4 + the lantern (spot + fill); no shadow-casting lights |
| Post-processing | none (grades and tints live in materials) |

---

## 1. Global assets (all chapters)

### 1.1 Anchor kit v2 (shape-coded, never colour-only)

| Anchor | Shape | Notes | Tris |
|---|---|---|---|
| Ring (existing) | circle | unchanged | ≤ 300 |
| Hook (existing) | triangle | unchanged | ≤ 300 |
| Fragile (existing) | cracked diamond | unchanged | ≤ 300 |
| **Moving ring** (II–V) | ring with a short motion-tail fin | rides a **dashed phosphor rail** showing its path; marker **glints** while moving toward the aiming hand | ≤ 350 |
| **Bellows ring** (III) | ring with a bell-shaped nib | bubble-stream emitter socket; soft cyan pulse while tethered | ≤ 350 |
| **Held ring** (IV) | ring gripped in a stone hand | part of the Kept *hold-ring* pose; phosphor only on the ring | in figure |
| **Light-locked ring** (V) | ring inside a halo | the halo drains clockwise during the warning | ≤ 400 |
| **Creature back ring** (endings B, C) | riveted Lanternwright ring on a plate | must read as an anchor when the body is static | in Mason kit |
| Set-piece / escape styling | existing `escape` tag | larger, brighter | — |
| Chapter V variants | all of the above with **dark iron rims** | contrast against white fog | — |

Phosphor colours follow each chapter's palette, but **shape carries the meaning**. Markers ignore fog within 18 m.

### 1.2 The Mark Lamp (hero prop) and lanterns

- **The Mark Lamp:** a pale iron cage with a **lens window** on one face (it throws a cone), on a **lens cradle** (the
  plinth in the Mark chamber). ≤ 3k triangles. States: *in the cradle* (focused, chamber-filling light), *carried*
  (unhooded cone, Chapters I–III), *hooded* (Chapter IV: a riveted leather-and-iron hood clips over the cage, leaving a
  slot), *white burn* (Chapter V: flame and glass go white-gold). Lean: a uniform tilts the flame at story beats.
- **World-locked flame shader:** the flame always points world-up and **never flickers**, whatever the hand does: an
  instantly unsettling detail. Built from frozen noise (alive-looking but motionless).
- **The old lantern** (Chapter I): left on the cradle's hook when you take the Mark Lamp.
- **The keeper's hood** prop on its hook at the Keeper's Door (IV-1).

### 1.3 Waking lamps (votives)

States cold → kindling (0.6 s flare) → lit; a flame card; ≤ 400 triangles. One variant per chapter: an iron bracket lamp
(I), a Lamphold niche lamp (II), a drowned lanternhouse lamp on a post above the waterline (III), a shrine lamp (IV), a
bare-rock votive (V); the Flame's own lamp (L5-10) is white-gold.

### 1.4 The figure kit (one body, many uses)

One hooded, robed Lanternwright body: **~2k triangles** LOD0, ~600 LOD1, plus an impostor atlas for crowds. **Rigid
poses, no skinning** (stepping Kept alternate two step poses). Material: the masonry set, tinted per chapter.

| Pose | Used for |
|---|---|
| stand, lantern raised | the Threshold statues; ending B's statue; Chapter V reliefs |
| kneel, lantern raised (dark) | the Mark chamber statues; **the Kneeling One** |
| kneel, hands cupped | **the first pilgrim** at the Flame |
| reach (empty hand raised) | the Kept; the hook's standing figure; *kept* remnants |
| hold ring aloft | Kept holding rings (IV) |
| step A / step B | Kept moving |
| lie, hands folded on a dark lantern | the Unkindled (III) |
| lying / slumped / curled / kneeling / standing raised | remnants by death cause (E08) |
| half-dressed into a block | the Dressing Yards (II) |
| falling (mid-air) | Lanternwrights stilled mid-fall (V); the come-apart in ending A |
| split at the waist, mineral bones | the S3 split statue (I) |

Variants: three hood shapes; lantern dark or lit; **the player's gauntlets** (the same mesh as `handsView`) on two of
Chapter I's 13 statues, the Kneeling One, the gathered figure in IV, the first pilgrim, and every remnant; the first
pilgrim's gauntlets carry the player's Name as carved notches.

### 1.5 Player gauntlets (`handsView`, existing)

Add: the **bead breath gauge** on the left gauntlet (five glass beads that empty from the top, III); the **Name etch** on
the wrist (a decal that gains a notch group per learned Name); **stone-creep** (a material uniform driven by stillness:
grey from the fingertips inward; also the faint greying beside the Mark Lamp's cradle); the hood attachment on the
lantern.

### 1.6 The Mason, kit v2

The creature's base design and rig are being finished by the creature workflow now (the current concept direction,
*Ossuary Column*: stacked masonry vertebrae split and held open by dark sinew, a rose-window crown whose oculi are the
listening pits, buttress legs with grapnel feet, Lanternwright cages and ladders fused into it as human-scale cues).
This plan does not redesign it; it lists what the five chapters need **on top of** that base, as kit parts and shader
states rather than new meshes per chapter.

**Kit additions (modular, like today's `mason_kit.glb`):**
- **Figure-plates** (4 variants): hooded backs and raised arms in shallow relief, **no faces**, instanced over segment
  blocks; more appear per chapter (I few → IV prominent); +1 plate per Mason kill (E08) and per gathered Kept (E17).
- **Frond-arms** (3 variants): the crown's sensory fronds read as **raised, empty arms** with open hands at the tips.
- **Back rings**: Lanternwright rings riveted into plates on `ringSegs` (≈ every third segment), readable as anchors when
  the body is static (endings B and C).
- **Human-scale cues**: a fused cage, an iron ladder through the neck, a previous climber's grapple with a frayed tether
  hooked in a plate (consistent with the Kneeling One's frayed rope).
- Faceless and eyeless, per the kit README.

**Per-chapter variant (length set at load; no runtime growth):**

| Ch | Segments | Look | States and scripted poses needed |
|---|---|---|---|
| I | 20 | as the base design; figure-plates sparse | listen glow; the Spiral crawl head-down around the spire; the hook's coil (the chamber's coil plates are environment pieces that match its plates) and the unspooling slide; the crown pausing at the Lamp |
| II | 22 | plaster dust coat after breaches | hidden travel (no visual), breach pose (crown out of plaster), wedged in the escapement (the Stopping), snuffing crawl along lamp tiers, riding the Span's collapse, climbing down lift chains |
| III | 24 | **wet sheen** and drips | waterline crawl on rims, the **plunge** (crown vertical into black water, fronds trailing 20 m), knocking on a bell with its crown, walking among the Unkindled (careful foot placement between figures) |
| IV | 28 | figure-plates prominent | the **gather** (fronds pull a figure into a plate slot), tail paying out of a breach, hidden inside the horns |
| V | 32 | stone-pale base | the **stone ramp** (per-segment stillness), the **bow** over the Flame, the overtake on the far wall, the **lunge freeze** (B), the **come-apart** (A: segments swap to falling figure instances), the **settle** along the Throat wall (C) |

**Shader states (no new meshes):** listen glow (pits and seams), wet sheen, dust coat, stone ramp (`body.stone` per
segment), stilled tint, extra-plate count. **Budget:** ≤ 25k triangles LOD0 at 32 segments (instanced segment blocks and
plates), ≤ 10k LOD1, ≤ 3k LOD2.

### 1.7 UI art

Carved stone panels (end card, ending cards, chapter title cards, the Descent Line's five strata tiles), codex pages with
notch glyphs, medal plaques (Iron, Brass, Still), trial glyphs, wrist glyphs (split, telegraph, Name), the Records page.
Fonts: an original or OFL-licensed carved serif for in-world text and a legible sans for settings, both with embedding
rights logged (§6).

---

## 2. Per chapter

Each table lists the kit modules to build in Blender (sizes are footprints in metres; triangles are LOD0 per instance),
then textures, the creature, VFX, lighting and the worst-moment budget check. "Inst." means the module is instanced.

### 2.1 Chapter I · The Underspire (polish; no new texture sets)

| Module | Size | Tris | Notes |
|---|---|---|---|
| Mark chamber iris floor | 8 leaves over a 12 × 12 m round floor | 6k total | AABB plates (data) under petal-shaped decor; each leaf drops 0.3 m (mover `steps`) |
| Lens cradle and plinth | 2 × 2 × 1.6 m | 2k | holds the Mark Lamp; the old lantern's hook |
| Coil-wall plates | 3 × 3 m, ×24 | 600 inst. | the chamber walls; match the Mason's plates; breathe (5 cm `bob`) then slide down (unspooling) |
| Kneeling statues ring | figure kit | — | 8 around the chamber walls |
| Cradle chain and pawl | 60 m chain, pawl block | 1.5k + links inst. | pays out in jerks; the pawl clanks |
| Seam: pit ceiling opening, soot band, Lamplighters' roof | from the Chapter II kit | — | `seam-1-2` |
| Chandelier (the first moving ring) | from the Chapter II kit | — | 36 m chain |
| Split statue (S3) | figure kit variant | 2.5k | broken at the waist; mineral bones (existing `bones` decor) |
| Knock wall plate (S4) | 3.6 × 0.9 m | 200 | beside "DO NOT ANSWER…" |
| Notch carvings (Names) | decal atlas | — | 1–4 notch groups |
| Waking lamps | §1.3 | — | ×10 |
| Statue language update | figure kit | — | the 13 existing statues re-skinned to the figure kit; two wear your gauntlets |

- **Textures:** existing `rock`, `masonry`, `metal`, `rockFar`, `flesh`.
- **VFX:** lamp kindle flare; the chamber lamps going out one by one; dust from breathing walls; iris clanks (dust puff
  per leaf); grit and dust falling during the unspooling; the soot band (a scrolling card); debris raining off the spire
  (the Spiral); the warm glow under the Vault's floor cracks (`shaft-light` decor, warm).
- **Lighting:** existing per-section themes; the Mark Lamp's focused light (existing `still` light); chamber lamps out in
  sequence; Lamphold's amber from below during the lowering (fog tint ramp).
- **Worst moment:** the unspooling (20-segment creature + coil plates + chamber + pit view): within budget with the pit's
  lamp-field as one draw.

### 2.2 Chapter II · Lamphold

**Textures (3 new):** `lampholdStone` honey sandstone (4 m tile), `sootPlaster` (4 m; the bulging walls), `brass`
(2 m; the engine). Existing `metal` and `masonry` reused (soot-tinted variants by material parameters, not new sets).

| Module | Size | Tris | Notes |
|---|---|---|---|
| House-front facades | 4 / 6 / 8 m wide × 7 m (2 storeys) | 1.5k inst. | doors with a notch-carving slot; windows with an interior card (a set table, a lit sill lantern) |
| Street slabs, stair tiers, balustrades | 4 m modules | 200–600 inst. | octagonal pit: modules angle by decor only |
| Lamp niches + **lamp-field** | quads | 2 tris × ~3,000 | one draw; per-instance `lit` attribute for snuffing |
| Chandeliers | ring Ø 3 / 5 / 8 m | 2–4k | chains as instanced links; ring = moving anchor |
| Counterweight lift | cage 3 × 3 × 3 m; counterweight; rails; pulley head | 3k | the Lamplighter's Lift adds a caged lamp |
| Crane gantry | rail beam 8 m; trolley; hook block; cab | 2.5k | the crane cab hides N2-5 |
| Stone saws | frame + 3 m disc | 1.2k | disc spins visually; hazard box is data |
| Dressing Yards stacks | 1–2 m blocks | 100 inst. | with half-dressed figure blocks (figure kit) |
| Waking Hall beds | bed + tally plate + lamp | 400 inst. | ~600 visible, impostors beyond |
| Hung houses | 6 × 6 × 8 m, 2 variants | 3k | on paired chains (driven pendulum) |
| Governor | 30 m vertical shaft with 3 orbit arms and rings | 4k | |
| Winding Floor | great wheel Ø 60 m (render-only rotation; rim rings are movers); escapement rail and pallet; trip-hammers (head 3 × 2 × 2 m); gear trains (3 sizes); pistons; oiled pipes | wheel ~8k; gears 1–2k inst. | the din room |
| **The Span** | truss modules: deck plate 4 m, truss side 4 m, under-rail, hook hanger, trolley; deck pre-fractured into 3 pieces | 1.5k inst. | debris pool for the collapse front |
| Far structures | pit-wall lamp tiers (impostor ring), far wheels in fog | — | |

- **Creature:** 22 segments; plaster dust coat; breach, jam, snuff, Span-ride, chain-climb poses (§1.6).
- **VFX:** snuff puff (sprite + smoke) per lamp; soot fall (GPU points); embers; sparks (saws, hammers); plaster crack
  decal + bulge + dust burst (pooled ×4); runaway steam; Span deck dust and falling debris; lift motion dust; kindle
  flares.
- **Lighting:** **the town's warmth is emissive** (lamp-field, windows) plus lit fog, not real lights; ≤ 2 environment
  point lights per section; the lantern. During the Snuffing the theme lerps tier by tier from *lit* to *snuffed* by the
  front's height (CHAPTERS §6, E19).
- **Worst moment:** the Snuffing phase A (lamp-field + tiers + chandeliers + creature) and the Span collapse (truss +
  debris pool ≤ 64): each ≤ 150 draws / 350k triangles.

### 2.3 Chapter III · The Mere

**Textures (3 new + utility):** `wetBasalt` (4 m), `verdigrisBronze` (2 m; bells, bellows), `flowstone` (4 m; pale
limestone and silt); utility: a 512² tileable **water normal map** and a 512² **caustics** map.

| Module | Size | Tris | Notes |
|---|---|---|---|
| Water surface | per water volume | 2 per plane | scrolling normals, fresnel, depth tint (E25) |
| Floating dark lanterns | 0.4 m | 120 inst. | vertex-shader bob; ~1,500 visible |
| Stalactite lantern hangers | 2–6 m | 800 inst. | the carved ceiling; chains |
| Rafts | 3 × 3, 5 × 4 m | 800 | `bob` movers; creak when landed on |
| Bells | Ø 1.2 / 2 / 3.5 / 6 / 9 m, with yokes and clappers | 1–6k | the great bell has an interior shell (air pocket) |
| Bell tower | 16 × 16 m shaft modules, 45 m | 4 m modules | rings on the walls |
| Diving bells | Ø 3 m + chains | 2k | moving air pockets |
| Bellows rings and air lines | pipe segments 2 m with joints | 300 inst. | |
| Tide-posts | 0.4 × 3 m | 200 | **deep**: wave band; **shallow**: foot band (shape, not colour) |
| Dome rocks | 3–6 m | 800 | air pockets inside |
| Sunken lanternhouses | Chapter II facades | — | wet/silt material variant |
| Altar bowl | 1.5 m | 600 | |
| Weir | curved facade over AABB blocks; breach pieces pre-fractured | 6k | drain grate (hazard) |
| The Unkindled | figure kit *lie-folded* | — | ≤ 200 near (instanced), an impostor field of thousands |
| Spillway and outflow falls | scrolling cards | — | |

- **Creature:** 24 segments; wet sheen and drips; waterline crawl, plunge, bell-knock, walking among the Unkindled
  (§1.6).
- **VFX:** bubbles (from mouth/hand; bellows streams); splash scaled by entry speed; spray; silt motes; **current
  streaks** (silt lines showing lanes); drips; the crown's entry ring wave; the weir breach burst and bubble columns;
  waterfall mist; a foam ring on the falling waterline (the Drain).
- **Lighting:** under water the lantern is the only light (cone + caustic flicker); Belfry verdigris algae emissive; a
  silver far light over the Mere; underwater fog swap (E25).
- **Worst moment:** the Drain reveal (surface plane, Unkindled near instances + impostor field, creature, gallery): within
  budget with the field as one draw.

### 2.4 Chapter IV · The Keeping

**Textures (3 new):** `boneLimestone` (4 m), `ochreDust` (4 m; floors, ledges), `blackIron` (2 m; cages, cranes,
horn bands).

| Module | Size | Tris | Notes |
|---|---|---|---|
| Shelf cliff modules | niche rows 4 / 8 / 12 m wide, 3 m niches | 1–3k inst. | the Kept stand in them |
| Racks, walkways, plank and rope bridges | 4 m modules | 200–800 inst. | |
| Iron cages on chains | 2 sizes (2 × 2 × 3, 3 × 3 × 4 m) | 1.5k | pendulum movers; occupants reach through bars |
| Keeper shrines | alcove + lamp cluster + plate | 2k | safe islands (`safeLight`) |
| Cranes | trolley + hook | 2k | Last Shelf phase B |
| Menders' scaffold | 6 × 3 × 8 m | 3k | tools sunk in a closed-over wall |
| **Listening horns** | mouth Ø 6 and 12 m | 3k / 6k | 8 large in the Horns hall; ring bands carry anchors |
| Keeper's hood | prop | 600 | on its hook; attached state on the lamp |
| The Kept | figure kit *reach*, *hold-ring*, *step A/B*, *stand* | — | ≤ 24 active; far shelves as impostors |

- **Creature:** 28 segments; figure-plates prominent; gather, tail-from-breach, hidden-in-horns (§1.6).
- **VFX:** dust trickle per Kept step; tiny stone-grind shards; gather dust; lantern cone motes; a faint air ripple at a
  horn mouth when it carries sound; remnants turn without effects (that is the point).
- **Lighting:** the hooded spot + fill; shrines (emissive + at most 1 point light per section); near-black ambient;
  phosphor anchors. The darkest chapter: calibrate with the brightness setting (T12) on Quest 3 and 3S panels.
- **Worst moment:** the Last Shelf (24 Kept + shelves + creature + crane): within budget with figure LOD1 beyond 10 m.

### 2.5 Chapter V · The Still Flame

**Textures (2 new + shader):** `calcite` white (4 m), `bleachedRock` (4 m; a bleached variant of `rock`); crystal and
stilled-water glass are shader-only (no texture set).

| Module | Size | Tris | Notes |
|---|---|---|---|
| Rough-hewn steps and bare-rock walls | 4 m modules | 300–800 inst. | history in reverse: carved → hewn → bare |
| Wordless relief panels | 4 designs, 3 × 2 m | 1.5k | the first waking, a figure rising beside a small flame |
| The tally wall | 12 × 4 m | 200 + CanvasTexture | procedural marks; your knock adds one |
| Frozen waterfall columns | 3 sizes, up to 40 m | 1–3k | translucent emissive glass shader; turns to falling water in shadow |
| Frozen rubble kit | 8 pieces, 1–4 m | 300–800 inst. | plus a pre-fractured falling set |
| Prism engines | 6 m frame + crystal | 4k | rotating visual frame; beam emitter |
| Beam cones | additive | 50 | ≤ 3 visible |
| Halo shell | sphere facets over AABB collision; buttresses | 6k | 160 m sphere |
| Stilled Lanternwrights | figure kit *falling* | — | hanging mid-air |
| **The Still Flame** | 0.1 × 0.25 m flame on a rock | 200 + shader | frozen noise: alive but motionless |
| The first pilgrim | figure kit *kneel-cupped* + gauntlets with your Name | — | |
| First Throat | rib rings Ø 8 m (contract to 6 m on the inhale), wall modules, the Lip | 1.5k inst. | movers synced to the breath schedule |
| Epilogue phosphor rings (ending A) | anchor kit | — | glowing in total dark |

- **Creature:** 32 segments; stone-pale; stone ramp, bow, overtake, freeze, come-apart, settle (§1.6).
- **VFX:** stillness tint and shimmer; pale rims (off during the warning); crack telegraph shards; falling-debris dust;
  **breath dust streams** (dust rising on the exhale, sucked down on the inhale: the breath made visible); the still
  front (a rising white band, `uStillY`); the dark front (a climbing wave of lamp pops); figures coming apart and falling
  (A); gauntlet stone-creep; the Names' small lanterns (C); the saturation drain.
- **Lighting:** bright fog fading to white; the saturation grade in materials (1.0 → 0.15 across the chapter); beams are
  emissive; real lights only the lantern and one key.
- **Worst moment:** the Stilling (throat ribs + 32-segment creature + front band + dust) and the Halo (debris + beams +
  creature): each ≤ 150 draws / 350k triangles.

---

## 3. VFX library (shared, pooled)

| Effect | Technique | Pool | Draws | Chapters |
|---|---|---|---|---|
| Dust, ash, motes (existing) | GPU points | — | 1 | all |
| Lamp kindle / snuff | sprite flare + smoke puff | 16 | 1 | all / II, V |
| Debris pieces | pre-fractured instanced meshes | 64 | ≤ 4 | II, V |
| Sparks, embers | GPU points | 256 | 1 | II |
| Plaster bulge + crack + dust | displacement patch, decal, burst | 4 | 2 | II |
| Bubbles, splash, spray, mist | instanced billboards | 128 | 2 | III, IV, V |
| Current streaks | scrolling line strips | 8 | 1 | III |
| Crown water-entry ring | animated ring decal on the surface | 2 | 1 | III |
| Kept step dust, grind shards | GPU points | 64 | 1 | IV |
| Lantern cone motes | points inside the cone | 1 | 1 | IV, V |
| Beam cones + motes | additive cones | 3 | 3 | V |
| Still / dark fronts | material uniform band; pop wave over the lamp-field | — | 0–1 | V |
| Breath dust streams | GPU points driven by the breath schedule | 1 | 1 | V |
| Come-apart figures | figure instances on ballistic paths | 48 | 1 | V (ending A) |
| Ghost figure and ropes | translucent figure + 2 lines | 1 | 3 | replay |

---

## 4. Lighting rules

1. **Emissive first.** Lamps, windows, phosphor, pits, beams and lamp-fields are emissive. Real lights: the lantern
   (spot + fill) and at most 4 environment point lights in view, never casting shadows.
2. **Fog is light.** Each section's theme tuple sets fog colour, near and far; distance fades to that colour (black in
   I–IV, white in V). Far structures exist to be half-seen through it.
3. **The lantern is the player's light** and the rule of Chapters IV and V: unhooded cone (120°, 10 m) from the hook to
   Chapter III; hooded cone (60° / 16 m on Normal) from Chapter IV; white in V.
4. **Readability over mood.** Anchors stay legible at full aim range in every section's fog and at the darkest brightness
   setting; if mood and readability conflict, readability wins (CHAPTERS §3.2).
5. **Brightness calibration** (T12) with a calibration image per chapter palette; the darkest chapters (IV, III under
   water) are tuned on both Quest 3 and Quest 3S panels.

---

## 5. Audio plan

### 5.1 Architecture (extends today's `audio3d.js` graph)

```text
ambient ─┐
player ──┼─► world filter (underwater low-pass, silence-system duck) ─► muffle (death) ─┐
creature ┤                                                                              ├─► master ─► compressor ─► soft clip ─► out
movers ──┤   room: per-chapter convolver (generated IR); Chapter I keeps today's space │
psych ───┼── breath + heartbeat bypass the world filter and the silence system ─────────┤
music ───┼── MusicDirector stems/cues; ducked by creature intensity and by sil.* states ┤
ui, stinger ────────────────────────────────────────────────────────────────────────────┘
```

- Spatial sources stay HRTF `PannerNode`s with today's voice cap (`MAX_HRTF`), beyond which voices fall back to
  equal-power panning. Priority: creature > knocks/bells near you > movers (≤ 8 nearest) > Kept (≤ 4 nearest) > ambience
  one-shots.
- **The horns** (IV-6) route one creature source out of 8 mouths: two nearest mouths HRTF, six equal-power.
- **Per-chapter rooms** (generated impulse responses, E26): Lamphold 4 s warm; Winding Floor 2.5 s metallic; the Mere 6 s;
  inside a bell 1.2 s; the Keeping 3 s dry; the Halo 9 s bright.

### 5.2 What stays procedural

**Everything that exists today stays procedural** (`audio3d.js`): shaft wind, masonry whistle, sub rumble, per-section
pad, creaks, drips, settling ticks; breathing; tether fire, miss, release, jolt; rope creak; fragile-anchor grinding;
reel ratchet; footsteps; landings; wall hits; the falling roar; stingers; anchor bites, breaks, crumbles, debris; the
creature's scrape bed, close scrape, drone, listening chitter, limb clicks, calls, bursts, attacks, retreats, sightings;
heartbeat and dread rumble.

**New procedural sounds** (E26), original synthesis in the same style:

| Sound | Synthesis | Chapters |
|---|---|---|
| Knocks | short filtered noise + body resonance; **per-Name pitch** so rhythms are distinct | all |
| Lamp kindle chime | small bell partials + flare noise | all |
| Bells | modal synthesis, 5–7 inharmonic partials, pitch by size; struck, brushed, over-swung | III |
| Mover voices | tick, groan, chain, gear grind, hammer, pendulum creak, lift motor, escapement clack | II–V |
| Water | lapping, splash scaled by speed, pressure bed, bubbles, current rush | III–V |
| Kept steps | stone grind per step (granular) | IV |
| Snuff pops | granular cloud of soft pops; climbs the shaft for the dark front | II, V |
| Plaster | crack, bulge creak, dust fall | II |
| Fronts | collapse cascade behind you; the still chord rising; the dark pop wave | II, V |
| Mason extras | crown entering water, knock on a bell, gather, overtake grind, horn-routed voice | II–V |
| Silence system | master duck + low-pass from `hush` and stillness; a near-inaudible high tone with slow beating near the Flame | I (hook), V |
| Breath states | waking breath, held-breath release, gasp, breath-low; heartbeat inversion with stillness | all |
| Rope | telegraph creak travelling up the rope; elastic-catch twang | II–V |

### 5.3 Designed SFX: the foley pack (original, recorded in-house)

Recorded by us, for us: 96 kHz / 24-bit masters, edited and delivered at 48 kHz, runtime Opus 64–96 kbps mono. Target
≈ 10 MB for the whole game. Each is **layered under** the synthesis, not a replacement for it.

| Category | Recordings | First needed |
|---|---|---|
| Chain | link rattles, the pawl's clank, a ratchet paying out, chain under load, chain snap | M1 |
| Stone | knocks on real stone (knuckle and hard plastic, to match a controller tap), a dragged slab (grind), crumble and rubble, plaster crack and fall | M1 |
| Lamps | oil-lamp ignition, flame flare, a pinched wick (snuff), hiss | M1 |
| Rope | creak under tension, whip, snap, fibre slip | M1 |
| Breath (non-verbal performance) | calm, exertion, held-breath release, gasp, waking breath, near-drowning; a signed performer release | M1 |
| Iron and brass | gear meshing, escapement clack, a large hammer on sheet steel, trolley wheels on rail, cage doors, lift clatter | M2 |
| Water | splashes by mass, hydrophone bubbles, drips in a large room, lapping, a waterfall far and close | M3 |
| Bronze | handbells and bronze objects struck and rubbed, to seed the modal bell synthesis (any real bell is recorded only with its owner's written permission) | M3 |
| Stone, dry | slow grinds and shard ticks for the Kept | M4 |
| Crystal and glass | rubbed glass, ice cracks (thaw cracks and stilled-debris warnings) | M5 |

No voice-over and no dialogue anywhere in the game.

### 5.4 Music: an original adaptive score (commissioned)

- **Contract.** One composer under a **work-for-hire agreement or an exclusive, perpetual, worldwide licence** covering the
  game, trailers, the store page, an optional soundtrack release, and **players' videos and streams**: the score is
  **not registered with Content ID** (or our channel and players are whitelisted), so no player is ever claimed. Stems and
  project files are delivered.
- **The Lamp motif.** Five notes, first heard at THE MARK's lean (a single bowed metal), hidden in Lamphold's Calm stem,
  in a minor mode when the lamps below go out, on a sustained voice-like instrument at the Drain's reveal (no lyrics),
  inverted at the Gathering, complete and full in the Stilling; the three ending themes are built on it (A dissolves,
  B holds, C becomes the Names' knock rhythm).
- **Per-chapter palette** (original writing; no pastiche of any existing game or film score):

  | Ch | Palette |
  |---|---|
  | I | low strings, bowed metal, organ-pedal drones, struck iron; Calm is near-silent |
  | II | warm strings and small mechanisms; mechanical percussion locked to the engine's tempo; snuffed: thinned to low brass embers |
  | III | glass and bowed metal, a slow water-drum pulse, a sustained wordless voice-like instrument |
  | IV | dry struck and scraped strings, breathy low winds without melody, bone-like percussion, drones |
  | V | wordless choir-like pads thinning to sine tones; the full ensemble only in the Stilling |

- **Stems.** Per chapter, three seamless loops (Calm, Pressure, Peak) of 90–150 s in the same tempo and key centre, so any
  crossfade works, plus 2–4 bar tails for transitions. The MusicDirector (E26) crossfades them by the threat value and
  section intensity.
- **Cues** (bespoke, synced to beats with a bar/beat marker map delivered as JSON):

  | Cue | Length | Notes |
  |---|---|---|
  | Title theme | 2–3 min loop | the Threshold menu |
  | `cue.ch1.spiral` | 60 s | held cluster as the crown passes |
  | `cue.ch1.mark` | ~180 s in sections | hush → knocking (diegetic) → unspooling → **motif** at the lean → warmth rising into Lamphold → held chord under the end card |
  | `cue.ch2.runaway` | 60 s loop | engine tempo × 1.6 |
  | `cue.ch2.snuffing` | 110 s + betrayal variation | snuff pops on its rhythm |
  | `cue.ch2.span` / `cue.ch2.lift` | 80 s / 30 s | the cascade leads; a single held tone |
  | `cue.ch3.drain` / `cue.ch3.reveal` | 60 s / 30 s | knocks lead the breach; the motif, then silence |
  | `cue.ch4.gathering` / `cue.ch4.lastshelf` | 60 s / 150 s | the inverted motif; holds on each gather pause |
  | `cue.ch5.halo` | 160 s | instruments drop out as colour drains |
  | `cue.ch5.stilling.a` / `.b` | 150 s each | the motif in full; B ends on **one beat, then nothing** |
  | `theme.end.a` / `.b` / `.c` | 120–180 s each | over the credits climb |

- **Silence is designed** (CHAPTERS §4.4 and each chapter's `sil.*` cues): the Stopping, the false lulls, the Belfry
  (the bells are the music), the Plunge, the Drain's reveal, the Flame.
- **Delivery and loudness.** 48 kHz / 24-bit WAV stems and cues; runtime Opus 128 kbps stereo, lazy-loaded per chapter
  pack (~4–6 MB per chapter, ~25 MB total). Each stem ≈ −23 LUFS integrated (summed stems ≈ −18 LUFS); true peak
  ≤ −1 dBTP.
- **Schedule.** M1: title, Chapter I stems, the Spiral and the Mark. M2–M5: each chapter's stems and cues. M5: endings
  and credits. M6: final mix.

### 5.5 Mix targets

- The creature is always audible over the music within 40 m (music sidechain-ducked by creature intensity, up to −8 dB).
- Breath and heartbeat are never ducked or filtered (silence must never sound like a bug).
- UI and hint chimes sit ≥ 18 dB under peak.
- Play loudness ≈ −18 to −16 LUFS short-term on Quest 3 built-in audio; checked on built-in speakers and headphones.
- A mix pass in headset at the end of every chapter milestone; a whole-game mix at M6.

### 5.6 Haptic vocabulary

| Event | Hand | Pattern |
|---|---|---|
| Attach (existing) | that hand | click 0.45 / 40 ms |
| Release (existing) | that hand | 0.12 / 25 ms |
| Anchor breaks (existing) | that hand | 0.9 / 140 ms |
| Rope tension (existing) | tethered hands | hum scaled by tension |
| Riding a moving anchor | tethered hand | continuous rumble ∝ anchor speed (≤ 0.35) |
| Mover tick / apex | tethered hand | 0.25 / 15 ms per tick |
| Elastic catch | that hand | long squeeze 0.8 → 0.3 over 250 ms |
| Rope telegraph | that hand | pulses 0.15–0.6 at 2–6 Hz with the Mason's proximity on your structure |
| Mason steps on your structure | that hand | 0.3 / 25 ms per planted limb |
| Your knock | knocking hand | sharp 0.8 / 12 ms |
| A Name learned | both | the Name's rhythm, 0.5 / 30 ms per knock |
| The Kneeling One | both | **your own Name's rhythm**, 0.6 |
| Lamp kindles | both | double pulse 0.2 |
| Waking | both | one swell 0.3 / 600 ms |
| Splash | both | thump 0.6 / 60 ms |
| Bellows air | air hand | soft buzz (10 ms on / 20 ms off) 0.1 |
| Breath low | both | heartbeat double pulses 0.3, rate rising |
| The Belfry knock | both | 0.7 / 120 ms per strike (felt through the bell) |
| Crown in the water (the Plunge) | both | continuous low rumble 0.4 while it is down |
| A Kept moving within 10 m | lantern hand | faint tick 0.1 / 10 ms per step |
| Kept grab | both | hard squeeze 1.0 / 300 ms |
| Stillness | all | every pattern scaled by (1 − stillness); at full, nothing |
| The freeze (ending B) | both | **one beat (0.9 / 80 ms), then nothing** |

All patterns respect the haptics setting and clamp to 1.0 per hand.

### 5.7 Audio accessibility

Captions (T13) with direction glyphs for every key sound: knocking inside the wall, something large moving above, the
engine stopping, lamps going out above, water rising or falling, a bell ringing, stone grinding behind you, the Throat
breathing in and out. Visual stand-ins for audio-critical beats: the Stopping (movers visibly stop, steam cuts out), the
Plunge (the crown's glow in the water), the Kept (the flame's lean), the rope telegraph (a wrist glyph), the breath cycle
(dust streams).

---

## 6. Sourcing rules (original or properly licensed only)

**Allowed**
1. Made in-house by the team (models, textures, procedural audio, foley, UI art).
2. **Commissioned** with a written work-for-hire or assignment, or an exclusive, perpetual, worldwide licence covering the
   game, trailers, the store page, marketing and players' videos (the score, any commissioned art).
3. **CC0** assets (e.g. Poly Haven textures through `fetch_polyhaven.py`), each logged.
4. **Commercial libraries** only when the licence explicitly permits use in interactive products and their marketing, with
   the receipt and licence text stored and every file logged.
5. Fonts under the SIL Open Font License or a commercial licence with embedding rights.

**Not allowed**
- CC-BY-NC, CC-BY-ND, "personal use only", or any asset whose licence cannot be produced on request.
- Anything ripped, sampled or traced from games, films, trailers, streams or videos; sound-alikes or pastiches of an
  existing game or film score; existing creature designs, logos, trademarks or a real person's likeness.
- Voice cloning; voice performances without a signed release.
- **AI-generated assets** unless the owner approves that specific use in writing, the tool's terms grant commercial use,
  and the ledger marks it as such; **never** for the score, the creature or the key art (purely AI-generated output may
  not be protectable as ours).

**The ledger.** Every file under `public/abyssal-tether-3d/assets/` (and every chapter pack) has a row in
`public/abyssal-tether-3d/assets/LICENSES.json`: `{ path, kind, source: 'in-house' | 'commissioned' | 'cc0' |
'commercial', author, licence, url, date, proof, notes }`. The verification harness (E28) fails a build that ships a
file with no ledger row. `proof` points to the contract, receipt or licence copy kept **outside** the public web folder.

**IP and originality review** before any marketing: names, the creature's silhouette and every set-piece (the collapse
chase, statues that move when unlit, a crown in water, the falling-water reveal) are screened against existing titles;
the Kept are keyed strictly to lantern light (never gaze); the riding and falling-city ideas are out of 1.0.

**Rating care in art:** bodies are stone; the Mason's sinew is dark and matte; no blood, gore, dismemberment or
children; no flesh close-ups in key art or covers (RELEASE §13, §16).

---

## 7. Art and audio schedule by milestone

| Milestone | Art | Audio |
|---|---|---|
| **M0** | Blockout exporter conventions agreed with level design (E28 T1); `render/themes` skeleton; new texture recipes stubbed in `build_textures.py`; asset ledger created | Composer contract signed; foley recording plan; MusicDirector spec reviewed |
| **M1 Demo** | Figure kit (Chapter I poses, remnant poses, split statue, the Kneeling One); the Mark Lamp and lantern states; waking lamps; anchor kit v2 (moving ring, rail, glint); the Mark chamber kit; seam pieces and one chandelier; Mason kit v2 figure-plates, frond-arms and back rings (with the creature workflow); Chapter I VFX; key-art concept | Title theme, Chapter I stems, the Spiral and the Mark cues; foley part 1 (chain, stone, lamps, rope, breath); knocks, kindle and silence system; full haptics pass |
| **M2 Lamphold** | 3 texture sets; the town, lamp-field, Waking Hall, Dressing Yards, Hung Quarter, Winding Floor, the Span; Mason II states | Chapter II stems and cues; mover voices; foley part 2 (iron and brass) |
| **M3 The Mere** | 3 texture sets + water maps; water surfaces and underwater mode; bells; the Belfry; the weir; the Unkindled field; Mason wet state | Chapter III stems and cues; bells; water; underwater filter; foley part 3 (water, bronze) |
| **M4 The Keeping** | 3 texture sets; shelves, cages, shrines, horns; Kept poses; the hood; Mason gather | Chapter IV stems and cues; Kept steps; horn routing; foley part 4 |
| **M5 The Still Flame** | 2 texture sets + shaders (stillness, glass, the Flame); the Halo; the Throat; Mason stone, freeze, come-apart and settle; menu scene variants; credits panels | Chapter V stems and cues; the Stilling A/B; three ending themes; credits; foley part 5 (glass) |
| **M6 Release** | LOD and impostor pass; performance fixes; trailer and screenshots; IP review; ledger audit | Whole-game mix; loudness check on device; captions complete |

---

## 8. Store and marketing assets

Formats and sizes per RELEASE §13 (hero 3000 × 900, covers 2560 × 1440 / 1440 × 1440 / 1008 × 1440, mini 1080 × 360,
logo, icon 1024 master, ≥ 3 screenshots at 2560 × 1440 captured on device, a 30–60 s trailer).

- **Key art concept:** a hooded stone figure wearing *your* gauntlets, kneeling with its back to us before a small flame
  that does not move; a tether hanging into the dark. No flesh, no gore; no ending spoiler.
- **Logo:** an original carved wordmark.
- **Add-on art** for "Abyssal Tether: The Full Descent".
- **Capture:** gameplay is captured in headset on Quest 3 from RC builds; key art and covers may use a **dev-only desktop
  photo mode** (free camera; never shipped) on the same scenes.
- **Trailer shots** (6–10 s each, from CHAPTERS' set-piece shot list; no ending spoilers):

  | # | Shot | Chapter |
  |---|---|---|
  | 1 | The first swing, the colossus through the Threshold's window | I |
  | 2 | The crown passing the inverted spire beside you | I |
  | 3 | The Kneeling One standing in the dark when the lamp swings back | I (hook) |
  | 4 | Lamphold lit; a ring of lamps going out above you | II |
  | 5 | Torn off a chain by a chandelier, over the lit pit | II |
  | 6 | The Span collapsing behind you, the crown riding the wave | II |
  | 7 | The crown sinking into black water beside you | III |
  | 8 | The surface falling to reveal the Unkindled | III |
  | 9 | Holding a Kept still with the lantern while swinging on the other rope | IV |
  | 10 | Walking in the Mason's shadow through the white Halo | V |
  | 11 | The Stilling climb, the crown and the light rising below you | V |

  The 60 s trailer runs 1→11 from wonder to the climb; the 30 s cut uses 1, 3, 4, 7, 9, 10.
