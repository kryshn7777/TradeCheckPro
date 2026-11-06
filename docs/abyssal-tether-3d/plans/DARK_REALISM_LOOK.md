# THE LANTERN: the dark realism look

Owner (2026-11-05): "remove the cell shading and then replace it with a realistic one, a realistic, dark and terrorizing shading."

The cel-shaded "3D anime" look is deleted, with everything that existed only for it. The default picture is now a realistic, dark,
frightening one: physically lit surfaces, real shadows, deep dark where the light does not reach, the lantern as the one warm source you
depend on ("light is life"), an oppressive haze, wet and dusty stone that reads as material. It is a coherent look, not a filter: the
tone mapper, the exposure, the grade inside the lit shader, the lantern's falloff, the baked light, the ambient floor and the haze are tuned
together. It stays playable (hand-holds, anchors, ledges and the fall cue read) and it costs the Quest nothing new: no post pass, no draw
call, ALU only, and it is cheaper than the cel look it replaces.

Everything is data in `src/render/lookPresets.js` (pure, Node-tested), consumed by `src/render/renderer3d.js`.

## 1. What is removed

| Removed | Where | Why |
| --- | --- | --- |
| the `anime` preset (exposure 1.4, saturation +0.4, flat contrast, rim 1.7x, detail normal 30 %, grime 35 %, ink settings) | `renderer3d.js` `LOOK_PRESETS` | the cel look |
| `atToon` (the light cut into 5 soft bands over the albedo), `TOON_DECL` / `TOON_FRAG`, `injectToon`, `toonBand` (JS twin), `uToonK`, `uToonShade` (the violet shadow tint) | `materials.js` | the cel look |
| every `injectToon` call: Mason (`mason/masonMaterial.js`), skitterlings and legacy creature (`creatureView.js`), launchers + gear (`handsView.js`), body (`bodyView.js`), holdfast (`holdfastView.js`), Ushers (`usherView.js`) | 7 files | each paid a band pass + an `fwidth` per fragment |
| the ink outlines: `outline.js` (inverted hulls), `addOutline` on the hands / sleeves / launchers (`handsGear.js`), body, Mason (one LOD1 hull), tusks (`masonMandibles.js`), stinger (`masonStinger.js`), Ushers (near + far hull, `usherView.js`), `syncOutlines` in the render loop, `setOutlineLook`, `?ink=` / `settings.ink` | 8 files | the cel look; each hull was a draw call and a second pass over its triangles |
| box-edge ink on the masonry (`INK_EDGE_FRAG`, `inkEdge`, `uInkK`) | `materials.js` | the cel look |
| the old `horror` split tone (cold green-grey shadows), `uHorrorK` | `materials.js` | replaced by the new grade (neutral-cool, never green or violet) |
| the Mason's cool `uRim` sheen (now black by default; the skitterlings keep their own dull red rim, which is their silhouette) | `mason/masonMaterial.js` (one line) | a stylised sheen; the lantern alone shapes the Mason |
| `ANIME_LOOK.md`, `tests/render/test-toon.mjs`, `tests/render/test-outline.mjs` | docs, tests | pinned the cel look |

`?look=` still works. Old names keep working: `horror`, `anime`, `realistic` resolve to the new default; `classic` is the lighter variant.
A saved `settings.look: 'anime'` falls back to the default. No new localStorage key.

## 2. The design

### Tone mapping and exposure

ACES filmic (three r170, vendored), exposure **1.0** (anime was 1.4, horror 1.0). ACES has a real toe: below a linear input of ~0.0023
(after the exposure) it outputs black, so the dark is made by the curve, not by a filter. AgX (also in r170) was considered and is
selectable per preset (`toneMapping: 'agx'`): it is flatter and lifts the blacks to a grey, which reads as "not scary" in a dark headset.

### How black the blacks are

* **The toe** (`toe` 0.3): in the lit grade, below a linear luminance of 0.04 (pre tone map) the colour is pressed toward black
  (`smoothstep(0, 0.04, L)`, 30 % strength; 0.5 was tried and with the ACES toe on top it turned S4-S6 into a black screen, see section 4). A wall the lantern does not reach goes black; a wall it grazes keeps its shape.
* **The floor** (never a void): two terms.
  * an albedo-proportional fill: the hemisphere light never drops below a per-section floor, `floor` =
    **0.26 / 0.24 / 0.22 / 0.20 / 0.18 / 0.16 / 0.13 / 0.10** (S1..S8; `low` tier x1.25). The depth darkness
    (`sim/nightVision3d.js`) still takes the theme's own fill down with depth: the floor is what is left when it has. It keeps the stone's texture (it multiplies
    the albedo), so in the deep you can still make out a ledge edge against the void at a few metres;
  * the black point (`uBlack`, `lift` 0.6 x 0.004 linear, in the haze colour): it sits right at the ACES toe, so it does not grey the
    black, it moves the first steps of shadow detail onto the part of the curve that has slope.
* What the player sees with the lantern alone (albedo 0.25 stone, head-on, through the grade and ACES; sRGB 0..255):

| distance | 1 m | 2 m | 4 m | 7 m | 10 m | 15 m |
| --- | --- | --- | --- | --- | --- | --- |
| anime (before, without the bands) | 215 | 149 | 74 | 36 | 21 | 9 |
| **dark**, full lantern (S1-S2) | 229 | 144 | 47 | 9 | 2 | 0 |
| **dark**, lantern at 47 % (S6) | 193 | 84 | 17 | 2 | 0 | 0 |
| **dark**, lantern at 26 % (S8) | 148 | 49 | 6 | 1 | 0 | 0 |
| classic, full lantern | 234 | 170 | 73 | 27 | 12 | 3 |

  The lantern is a pool, not a floodlight: bright at arm's length, readable to ~4 m near the top (~2-3 m in the deep, where it has
  faded), gone by 7 m. Beyond it the world is the haze,
  the lamps, the baked light, the anchors' glyphs and the floor above. (The lantern's fade with depth is the existing gameplay table
  `sim/nightVision3d.js` DEPTH_LANTERN; not changed.)

### The lantern

Warm (`PALETTE.lantern` #ffb46a, ~2000 K flame), candela **x1.7** (11 cd at full charge), **inverse-square** falloff (decay 2, was 1.6),
range 30 m (shrinks with the charge as before). The real-time lantern shadow (`lanternShadow.js`) is unchanged: with the square law the
shadow edge reads harder near you and the shadowed side of a ledge is dark, which is the point. On lightmapped stone the lantern's
extra falloff exponent goes 0.38 -> **0.42** and its gain 1.05 -> **1.15**, so baked and dynamic surfaces fall off alike.

### Shadow colour and the grade

In the lit materials' grade (`materials.js` `GRADE_FRAG`, JS twin `gradeColor`), in this order:

1. saturation **0.74** (0.94 - 0.2), and a further **40 %** desaturation toward -300 m (colour drains with the descent);
2. contrast exponent about mid grey **1.14** (+0.06 under threat; 1.24 was tried: a power curve halves every deep shadow, the toe
   crushes more selectively);
3. the section tint (the accent colour at 10 %);
4. split tone: the shadows x **(0.90, 0.98, 1.06)** (neutral-cool: a hint of blue, never violet, never the old green), the lit parts x
   **(1.05, 1.00, 0.93)** (the lantern's warm pool);
5. the toe (above);
6. desktop only: a static vignette from the view axis (**0.3**) and fine luminance-weighted grain (**0.035**, dies in the blacks);
7. the black point, and the highlight knee (glints roll into the ACES shoulder, input bounded at ~5).

### Haze

The section fog colours are kept (art bible), then: x **0.9**, x **(0.96, 1.00, 0.90)** (a little sickly, yellow-green drained), pulled
**35 %** toward their own grey (warm fogs still lose their extra 65 % of saturation as before). The haze's grazing rim on verticals is
**0.55x** (anime 1.7x): a faint scatter edge, not a drawn line. The depth darkness (`sim/nightVision3d.js` DEPTH_DARK, unchanged) still
dims the fog, the fill and the baked light per section.

### Ambient, key, baked light

Hemisphere fill **x0.9** (never below the floor above), the cold shaft key from above **x0.75**, lightmap exposure **1.5** and ambient
floor **0.012** (as before: 1.25 / 0.008 were tried and, with the depth darkness on top, left the mid-descent unreadable).
**`bakedDark` 0.55**: the baked light takes 55 % of the depth darkness (`sim/nightVision3d.js` DEPTH_DARK, unchanged); the fog, the fill
and the lamps take all of it. With all of it, the baked exposure fell to 0.39x at S6 and S4-S7 were a black screen (the cel bands had
lifted that dim light into a visible band; a realistic curve does not). By section: S1 dim but readable (the window, the lamps, the key on the cornices); the descent
darkens with the depth table; S7-S8 the lantern is the world, the lamps and the Still Lamp are islands.

### Reflections, wetness, specular, AO

Unchanged and now visible: the cel bands flattened them. The wet film (`SECTION_WET`), the lantern's clear-coat glint on wet stone, the
reflection probe on puddles, the geometric specular AA and the baked GI AO all pass through the grade. Dark stone keeps a tight wet glint
under the lantern and is matte where dry. The detail normal is back at **100 %** of the tier's and the crevice grime at **115 %** (the cel
look had cut them to 30 % / 35 %): the joints are dirtier, the stone reads by its micro relief.

### Per tier (ALU only; no tier adds a pass or a draw call)

| | low | quest | high |
| --- | --- | --- | --- |
| toe | 0.225 (x0.75: no lantern shadow there, keep the shapes) | 0.3 | 0.3 |
| ambient floor | x1.25 | x1 | x1 |
| grain (desktop) | 0 | 0 | 0.035 |
| vignette (desktop) | 0 | 0.3 | 0.3 |
| in VR, any tier | no grain, no vignette | | |
| reduced effects | no grain | | |

Grain is never in VR (a per-frame noise shimmers in a headset); the vignette is never in VR (a view-locked darkening is the comfort
vignette's job, `src/ui/comfort.js`, and nothing here moves or pumps). No strobing anywhere: the lantern's flicker and the grain are the
existing bounded terms.

### What stays tunable

`?look=dark|classic` (aliases `horror`, `anime`, `realistic` -> dark) and `settings.look`; every number above is a field of the preset in
`lookPresets.js`, read when the renderer is built (exposure, tone mapper, lantern, baked tune) or every frame (grade, film, floor, haze).
The resolution (`resolveLook(settings, search)`) is generic so the opening cinematic can use the same grade.

## 3. Cost

Removed per lit fragment: the shared grade lost `atToon` (two luminance dots, a divide, `sqrt`, `floor`, `fwidth`, a smoothstep, a
rebuild, about 30 ALU + one derivative) and the masonry's ink edge (a smoothstep). Seven other programs (Mason, skitterlings, legacy
creature, launchers, gear, body, holdfast, Ushers) lost the same ~30 ALU + `fwidth`. Added to the shared grade: the split tone and toe
(one luminance dot, two smoothsteps, two mixes: ~14 ALU) behind a uniform branch, the desktop-only vignette / grain behind their own uniform
branches (skipped on Quest). Net on Quest: roughly -16 ALU per lit world fragment and -30 ALU per character fragment. Draw calls: the
ink hulls are gone (hands, sleeves and launchers on both hands, the body, the Mason's hull, two tusks and the stinger, one per Usher),
measured in the captures below.

## 4. Verification (software GL captures, 960x540, desktop `high` tier unless noted)

Same frames before (the cel look, base `aebfe29`) and after, through `AT3D.debug` (warp, freeze, god mode). Luma (sRGB 0..255, Rec.709):
mean / p5 / p50 / p95 / % of pixels under 8 / under 20.

| frame | before (cel) | after (dark, final) |
| --- | --- | --- |
| S1 threshold | 129 / 34 / 127 / 241 / 0 / 2 | 90 / 20 / 85 / 192 / 1 / 5 |
| hands + launchers in the lantern (S2) | 83 / 26 / 91 / 133 / 0 / 3 | 48 / 10 / 49 / 76 / 4 / 13 |
| lamp ledge (S4) | 39 / 17 / 36 / 67 / 0 / 8 | 15 / 4 / 12 / 33 / 26 / 80 |
| deep, lantern only (S7) | 36 / 13 / 30 / 90 / 1 / 35 | 15 / 1 / 8 / 46 / 50 / 68 |
| same, night vision on | 34 / 3 / 18 / 110 / 22 / 54 | 21 / 0 / 6 / 76 / 54 / 68 |
| anchor (ring) at 6.1 m in the dark (S6) | 31 / 16 / 30 / 59 / 0 / 14 | 18 / 2 / 18 / 35 / 10 / 66 |
| fall cue (S3, falling 22 m/s) | 44 / 12 / 38 / 98 / 1 / 18 | 28 / 5 / 19 / 98 / 8 / 52 |
| the Mason at 17 m | 38 / 16 / 35 / 61 / 2 / 9 | 25 / 4 / 17 / 63 / 15 / 58 |
| the Mason at 8 m | 37 / 5 / 29 / 92 / 6 / 25 | 14 / 0 / 10 / 41 / 42 / 83 |
| quest tier: S1 / lamp ledge / S7 / S6 warp view | 126 / 39 / 34 / 32 | 88 / 15 / 13 / 18 |

Read: the picture is 1.5-2.5x darker in the mean, the p95 (the lantern pool, the lamps, the eyes, the glyphs) holds up much better than the
mean (the light still reads as light), and the dark mass sits in the deep frames. The anchor glyph, the fall-cue markers, the Mason's red
glow and the night vision lift all read; the anchor frame has only 10 % of its pixels under 8.

Look-dev history: pass 1 (toe 0.5, contrast +0.14, baked exposure 1.25, the depth darkness on the baked light in full) put S4-S6 at a mean
of 5-9 with 56-85 % of the frame under 8: a black screen, not a dark place. Pass 2 (more fill, floor, lantern) barely moved it: the
lightmapped stone takes its fill from the baked light, which the depth darkness cut to 0.39x at S6. Pass 3 (`bakedDark` 0.55, contrast
+0.04 with the toe doing the crushing, exposure 1.0) is the shipped one.

Draw calls (desktop, mono, the frame's `renderer.info`): S1 71 -> 56, hands 73 -> 67, lamp ledge 75 -> 69, S7 67 -> 62, the fall 75 -> 61,
the Mason at 17 m 95 -> 77 (its hull, the two tusks', the stinger's, the hands' and the body's hulls are gone). In stereo on Quest every
level object counts twice: about -10 to -36 calls a frame.

Open: in the hands frame the body's shadow from the overhead lamp (the aux shadow) reads much weaker than under the cel bands, which had
cut it into a hard dark band. Both shadow systems were checked running identically before and after (`lanternShadow.stats`: enabled,
strength ~1, 6 casters; the aux in lamp mode, ready); the brighter inverse-square lantern now fills the floor where that shadow falls. A
lower lantern fill under the aux shadow is the next tuning step if it is missed in the headset.

Tests: `tools/abyssal-tether-3d/tests/render/test-dark-look.mjs` (63 checks).

Not verified: the headset (the LCD black level, the floor's visibility in a dark room, comfort), the Quest's real ALU timing, readability on
a real dark display, the `low` tier in pictures (its numbers are unit-tested only).
