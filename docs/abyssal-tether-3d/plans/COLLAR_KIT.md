# THE COLLAR kit: the surface station, the hoist drones, the cradle

Owner of this file: 3D ART. Consumer: the STORY owner's opening cinematic (`render/openingView.js`, `game.js`), which codes against
`src/render/facilityKit.js` (the API below is the contract). This plan is the art direction; the code is the source of truth for numbers
(`FACILITY` in `facilityKit.js`).

## 0. The point of it

Elias Wren, line rescuer of Expedition 42, is lowered from THE COLLAR, a clean high-tech surface station bolted onto the mouth of the
Underspire, on a CRADLE carried by four HOIST DRONES. Sixty metres down, at the Threshold ledge, the drones cannot go deeper: they release
him and fall dark. The opening's contrast is **precise machines against ancient black carved stone**: so the machines must read as real,
expensive, used equipment (an aerospace / offshore-rescue design language), never as toys.

Rules (DARK_REALISM_LOOK.md): matte, physically lit, worn. No cel shading, no gloss toy plastic, no real brand marks. The only light in
the hall is cold LED (5600-6500 K strips, a few cyan status pips, amber warnings); the lantern below is the one warm thing in the film.

## 1. Build route (decided): procedural, in JS, no GLB

The kit is authored as deterministic procedural geometry in `facilityKit.js` (the repo's merged vertex-colour pattern: `pickupsView.js`,
`knockerView.js`), not in Blender:

- it costs the precache **0 bytes** (core is ~75.1 of 80 MiB; the opening needs the kit at frame 0, so a GLB would have to be core);
- the API needs live, animatable parts (rotors, jaws, iris leaves, gate, spool) with exact pivots: built in code they are exact by
  construction, and the tests run the real thing in Node without a fallback path that could drift from the shipped model;
- all hard-surface pieces here are boxes, chamfered boxes, lathes and sweeps, which code builds as well as Blender would at these budgets.

No `collar.glb`, no build script, no precache change. (If a later art pass wants sculpted detail, `build_collar.py` can export a GLB whose
node names match section 4 and the builders can prefer it; not needed now.)

## 2. Palette (linear-ish albedo in sRGB hex; grime darkens 0-35 % per vertex by seeded noise + cavity + underside terms)

| Swatch | Hex | Used for |
| --- | --- | --- |
| composite white (scuffed) | `#b9bab4` | drone top shells, cradle console, deck markings base, wall panels (upper) |
| warm grey composite | `#8e8f8a` | panels lower, ducts outer |
| graphite carbon | `#2b2d30` | drone arms, belly, cradle frame, ring girder |
| gunmetal | `#4a4e53` | metal parts (motor bells, winch, rails, grating), bolts |
| bare steel (worn edge) | `#7a7d80` | jaw pads, deck plate wear, rail tops |
| deck charcoal | `#3a3c3d` | deck plates, catwalk grating |
| hazard yellow (dulled) | `#b8902a` + black `#1c1c1c` | 45-degree stripes: deck lip, pad borders, cradle kick plates, clamp arm |
| safety orange (faded) | `#a8552a` | lift rings, rope spool flanges, drone tail tabs |
| stencil black | `#151617` | serials `HD-42-01..04`, `LINE 42`, `PAD 1..4`, `E-42`, `NO STEP` |
| LED cold white | `#d8ecff` | strips (emissive) |
| status cyan / amber / red | `#5fe0ff` / `#ffb040` / `#ff3a2a` | pips (emissive) |

Roughness / metalness per vertex (attribute `aRM`, no texture): composite 0.62 / 0.0, carbon 0.5 / 0.1, metal 0.42 / 0.55, rubber 0.85 / 0.

## 3. Pieces

### 3.1 HOIST DRONE (`buildDrone`)

Silhouette: a flat X-quad, **1.22 m across the duct rims**, 0.34 m tall with the clamp. Four **ducted fans** (shroud ring, lipped intake,
three stator vanes, a motor bell) at (+-0.42, 0, +-0.42) joined by tapered carbon arms to a low **chamfered fuselage** (white top shell,
graphite belly, a raised spine with a sensor bump front). Under the belly: a **winch drum** (axis X, flanged, a wrap of dark cable) and a
short cable to the **clamp head**: a block with two **jaws** that swing open about X (closed = they meet under the lift ring). A
downward **work-light** (a recessed lens; its beam is the additive cone) and a **scanner bar** at the nose (the scan fan's origin). LEDs:
navigation pips on each duct (port red-ish / starboard cyan per the family; stern white), a status bar on the spine. Serial stencil
`HD-42-0n` on both flanks (a 3x5 pixel font in geometry), hazard stripes on the clamp head, orange tail tabs.

| | LOD0 | LOD1 |
| --- | --- | --- |
| tris | <= 4 000 | <= 900 |
| draw calls | hull 1, rotors 4 (blades or blur disc, swapped by speed), jaws 2, LEDs 1, beam 1 (hidden by default), scan 1 (hidden) | same nodes, fewer segments, 2-blade rotors, no stencils |

Animation: `rotors[i]` spin about local Y (`update(dt, {spin})`, alternate directions; above 0.55 of full speed the blades hide and a
dark translucent blur disc shows: no aliasing strobe), `setClamp(k)` (0 closed, 1 open: jaws rotate +-1.1 rad), `setLights(k)`,
`setBeam(k)`, `setScan(k, phase)` (the fan's opacity and its sweep), `setStatus(hex)`. Falling dark at the end = `setLights(0)`.

### 3.2 CRADLE (`buildCradle`)

An open rescue cage, **1.6 x 1.6 m floor**, origin = the top of the floor grating (the player's feet; the eye is 1.65 m above it). A
skid frame under it (0.12 m), a real **bar grating** floor (bearing bars + cross rods), 0.15 m **kick plates** with hazard stripes, four
corner posts, **waist rails at 1.05 m** + mid rails at 0.55 m, a gap on -Z with a hinged **gate bar** (`gate`, swings about Y). Above the
head at 2.35 m a **spreader X** (two carbon beams) whose ends carry four orange **lift rings** at (+-1.1, 2.45, +-1.1): the drones' clamp
points (`anchors[]`). On the +X rail a **rope spool** (`spool`, rotates about its axle; orange flanges, a cold LED ring) and on the +Z/-X
corner a small **console**: a tilted panel with a 0.18 x 0.11 m **status screen** (`screen`: MeshBasic + a 256 x 128 CanvasTexture,
`screenSetText(text)` redraws it). Tris <= 6 000; draw calls: frame 1, LEDs 1, screen 1, spool 1, gate 1.

### 3.3 THE COLLAR (`buildCollar`)

Plan (y = collarY = 60, the shaft mouth; the shaft is the 22 x 22 m S1 chimney, x, z in -11..11):

- **The stone mouth**: the Underspire's own black carved stone, a square-holed ring from the 22 m square out to r 16.4, top at 59.6: the
  ancient thing the station is bolted onto, seen in the corners between the square and the circular aperture.
- **The iris**: 12 wedge leaves (30 degrees each, 16.6 m from the centre, 0.2 m thick, ribbed, hazard chevrons at the tips, a seam
  gasket) over the **16.0 m aperture** (covers the square: its half-diagonal is 15.56 m). `setIris(k)` slides every leaf outward along
  its bisector by `k * 16.4 m` into the pocket under the deck (one mesh, positions rewritten in place, no allocation). k = 0 closed,
  1 open (no leaf inside r 16.0).
- **The deck**: charcoal plates from r 16 to the hall wall (r 34), a raised steel **collar ring** at the aperture lip (r 16..17.2, 0.25 m
  tall) with a hazard band and a cold LED lip strip, bolt heads.
- **The gantry ring**: a ring girder at y +9 (r 18.5), 8 columns, an LED strip on its underside (the hall's main light).
- **The launch bay** (south, around the descent column): **four drone pads** (2.4 m plates, hazard border, `PAD n`), each with a
  **charging cradle** (a U frame with contact arms and an amber LED), cable trays to the wall.
- **The hall**: a 20-sided wall (r 34, 20 m tall) of ribbed panels with seams, a ring **catwalk** at +6 m with rails, cable trays at
  +3 m, a horizontal LED strip at +12 m, ceiling **girders** (radial, 20 m up) and a roof plate.
- **The control hall** (north, -Z, raised +7 m): a box room with a long sloped **window**, three desks with screens left on, three
  **empty chairs** (one pushed back, one turned), a cup on the middle desk. Nobody inside.

Budget: <= 25 k tris, <= 12 draw calls (shell 1, iris 1, glow 1, screens 1, glass 1 = 5). `setLights(k)` scales the LED glow (and the
emitters list for the STORY agent's real lights); `lights` = suggested light descriptors (position, colour, intensity, distance): the
kit creates no Light objects.

### 3.4 The descent column

The cradle starts parked on the closed iris **over the Threshold spawn**, `cageAnchor = (-4, 60.12, 8.5)` (the skids on the leaves), so
the whole descent is a pure vertical 60 m drop onto the ledge (VR comfort: no lateral motion), clear of the S1 girder, statues and arch.
The pads sit on the deck south of it, the control window faces it from the north (in view when looking -Z, the spawn yaw).

## 4. Materials and budgets

- one lit `MeshStandardMaterial` per builder (vertex colours + `aRM`), `patchMaterial(mat, { lit, grade })` so the dark-realism grade,
  rim and lantern shadow apply; **no texture on any lit material** (Quest sampler limit);
- `MeshBasicMaterial` vertex-coloured for LED / screens (one per builder), additive `MeshBasicMaterial` for the beam cone and scan fan,
  transparent dark `MeshBasicMaterial` for the rotor blur discs and the control-room glass;
- the only texture is the cradle screen's CanvasTexture (unlit material);
- grime: seeded hash noise per vertex + a cavity term (faces pointing down darker) + a height term; deterministic, no `Math.random`.

## 4b. As built (numbers from the test)

| Piece | Triangles | Draw calls | Notes |
| --- | --- | --- | --- |
| drone LOD0 | 3 978 counting every mesh (3 498 at rest) | 9 at rest (+ beam, scan when on) | hull 1, clamp head 1, jaws 2, rotors 4 (blades or blur), LEDs 1 |
| drone LOD1 | 868 counting every mesh (764 at rest) | same nodes | 2-blade rotors, no stencils |
| cradle | 3 502 | 6 | frame, spool drum, spool LED, gate, LEDs, screen |
| collar | 16 268 | 5 | shell, iris, LEDs, control-room screens, glass |

Film recipe: `drone.position = cradle.localToWorld(anchor) - drone.clampPoint` (all drones yaw 0 with the cradle: their jaws close
from +-Z under the ring's top bar); docked drones sit at `dronePads[i]` with `rotation.y = yaw`; the cradle starts at `cageAnchor`
(-4, 60.42, 8.5) on the closed iris; the eye is `cradle.position.y + 1.65`. `collar.lights` are descriptors for the real lights the film
creates (gantry points, a column spot onto the cradle, pad ambers, a hemisphere fill). Note for the film: the scene fog of S1 will eat
the hall beyond ~30 m unless the opening sets a longer fog while the camera is at the collar.

## 5. Verification

`tests/render/test-facility-kit.mjs` (API, nodes, caps, bounds, determinism, iris monotonic coverage, dispose, heap-sampled update
helpers, no samplers) and a capture (scratchpad script, flock'd browser): the cradle POV with the iris half open, a drone close-up, the
cradle screen, the four drones clamped seen from below, the whole at 30 m; contact sheet in `plans/img/collar-kit-contact.jpg`.
