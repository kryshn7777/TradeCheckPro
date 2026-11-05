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

ACES filmic (three r170, vendored), exposure **0.9** (anime was 1.4, horror 1.0). ACES has a real toe: below a linear input of ~0.0023
(after the exposure) it outputs black, so the dark is made by the curve, not by a filter. AgX (also in r170) was considered and is
selectable per preset (`toneMapping: 'agx'`): it is flatter and lifts the blacks to a grey, which reads as "not scary" in a dark headset.

### How black the blacks are

* **The toe** (`toe` 0.5): in the lit grade, below a linear luminance of 0.04 (pre tone map) the colour is pressed toward black
  (`smoothstep(0, 0.04, L)`, half strength). A wall the lantern does not reach goes black; a wall it grazes keeps its shape.
* **The floor** (never a void): two terms.
  * an albedo-proportional fill: the hemisphere light never drops below a per-section floor, `floor` =
    **0.16 / 0.14 / 0.12 / 0.10 / 0.08 / 0.065 / 0.05 / 0.04** (S1..S8; `low` tier x1.25). It keeps the stone's texture (it multiplies
    the albedo), so in the deep you can still make out a ledge edge against the void at a few metres;
  * the black point (`uBlack`, `lift` 0.6 x 0.004 linear, in the haze colour): it sits right at the ACES toe, so it does not grey the
    black, it moves the first steps of shadow detail onto the part of the curve that has slope.
* What the player sees with the lantern alone (albedo 0.25 stone, head-on, through the grade and ACES; sRGB 0..255):

| distance | 1 m | 2 m | 4 m | 7 m | 10 m | 15 m |
| --- | --- | --- | --- | --- | --- | --- |
| anime (before, without the bands) | 215 | 149 | 74 | 36 | 21 | 9 |
| **dark**, full lantern (S1-S2) | 225 | 123 | 31 | 2 | 0 | 0 |
| **dark**, lantern at 47 % (S6) | 179 | 64 | 6 | 0 | 0 | 0 |
| **dark**, lantern at 26 % (S8) | 127 | 33 | 1 | 0 | 0 | 0 |
| classic, full lantern | 223 | 141 | 52 | 18 | 7 | 2 |

  The lantern is a pool, not a floodlight: bright at arm's length, readable to ~4 m, gone by 7 m. Beyond it the world is the haze,
  the lamps, the baked light, the anchors' glyphs and the floor above. (The lantern's fade with depth is the existing gameplay table
  `sim/nightVision3d.js` DEPTH_LANTERN; not changed.)

### The lantern

Warm (`PALETTE.lantern` #ffb46a, ~2000 K flame), candela **x1.45** (9.4 cd at full charge), **inverse-square** falloff (decay 2, was 1.6),
range 30 m (shrinks with the charge as before). The real-time lantern shadow (`lanternShadow.js`) is unchanged: with the square law the
shadow edge reads harder near you and the shadowed side of a ledge is dark, which is the point. On lightmapped stone the lantern's
extra falloff exponent goes 0.38 -> **0.55** and its gain 1.05 -> **1.1**, so baked and dynamic surfaces fall off alike.

### Shadow colour and the grade

In the lit materials' grade (`materials.js` `GRADE_FRAG`, JS twin `gradeColor`), in this order:

1. saturation **0.74** (0.94 - 0.2), and a further **40 %** desaturation toward -300 m (colour drains with the descent);
2. contrast exponent about mid grey **1.24** (+0.06 under threat);
3. the section tint (the accent colour at 10 %);
4. split tone: the shadows x **(0.90, 0.98, 1.06)** (neutral-cool: a hint of blue, never violet, never the old green), the lit parts x
   **(1.05, 1.00, 0.93)** (the lantern's warm pool);
5. the toe (above);
6. desktop only: a static vignette from the view axis (**0.3**) and fine luminance-weighted grain (**0.035**, dies in the blacks);
7. the black point, and the highlight knee (glints roll into the ACES shoulder, input bounded at ~5).

### Haze

The section fog colours are kept (art bible), then: x **0.85**, x **(0.96, 1.00, 0.90)** (a little sickly, yellow-green drained), pulled
**35 %** toward their own grey (warm fogs still lose their extra 65 % of saturation as before). The haze's grazing rim on verticals is
**0.55x** (anime 1.7x): a faint scatter edge, not a drawn line. The depth darkness (`sim/nightVision3d.js` DEPTH_DARK, unchanged) still
dims the fog, the fill and the baked light per section.

### Ambient, key, baked light

Hemisphere fill **x0.72** (never below the floor above), the cold shaft key from above **x0.6**, lightmap exposure **1.25** (was 1.5),
lightmap ambient floor **0.008** (was 0.012). By section: S1 dim but readable (the window, the lamps, the key on the cornices); the descent
darkens with the depth table; S7-S8 the lantern is the world, the lamps and the Still Lamp are islands.

### Reflections, wetness, specular, AO

Unchanged and now visible: the cel bands flattened them. The wet film (`SECTION_WET`), the lantern's clear-coat glint on wet stone, the
reflection probe on puddles, the geometric specular AA and the baked GI AO all pass through the grade. Dark stone keeps a tight wet glint
under the lantern and is matte where dry. The detail normal is back at **100 %** of the tier's and the crevice grime at **115 %** (the cel
look had cut them to 30 % / 35 %): the joints are dirtier, the stone reads by its micro relief.

### Per tier (ALU only; no tier adds a pass or a draw call)

| | low | quest | high |
| --- | --- | --- | --- |
| toe | 0.375 (x0.75: no lantern shadow there, keep the shapes) | 0.5 | 0.5 |
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

## 4. Verification

Captures, stats and the contact sheet: see the hand-back (scratchpad `dark/`). Tests: `tools/abyssal-tether-3d/tests/render/test-dark-look.mjs`.

Not verified: the headset (LCD black level, the floor's visibility in a dark room), the Quest's real ALU timing, readability on a
real dark display.
