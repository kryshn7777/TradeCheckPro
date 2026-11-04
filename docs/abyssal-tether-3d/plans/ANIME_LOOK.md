# The stylised "3D anime" look

The game's default picture is now a cel-shaded, "3D anime" look instead of the realistic horror grade. It is one preset of the existing
look system (`render/renderer3d.js` `LOOK_PRESETS`), done inside the lit materials' own shader: **no post pass, no extra draw call,
no extra geometry**, so it costs a few ALU ops per lit fragment on the Quest.

| URL / setting | Picture |
| --- | --- |
| *(default)*, `?look=anime` | stylised: cel bands, violet shadows, vivid colour, hard rim, clean surfaces |
| `?look=horror` | the previous realistic picture (grain, vignette, cold crushed shadows, sickly warm lights) |
| `?look=classic` | the first realistic grade |

`settings.look` takes the same names.

## What the preset does

1. **Banded lighting over an intact albedo** (`materials.js` `atToon`). The lit colour is divided by the surface's own albedo
   luminance, so only the *light* is stepped, never the stone's or the paint's texture. That ratio goes through five soft-edged
   steps in square-root space (an even step in perceived brightness), then the colour is rebuilt with the albedo. The hue is untouched
   (the gain is the same on r, g and b). Band edges are one pixel wide (`fwidth` of the banded value), so they neither crawl in the
   headset nor alias. Above the top band the light stays continuous, so the lantern's pool, glints and glows keep their HDR range.
2. **Violet shadows.** The darkest band is a cool tint of the albedo (`uToonShade`), not black: shadow is coloured, like a painted cel.
3. **Vivid colour, flat contrast.** Saturation +0.4, the contrast curve is left near 1, depth desaturation is almost off, exposure 1.4.
4. **Hard haze rim.** The rim light (1.7x) is added to the emissive before the banding, so it becomes a crisp lit edge on every vertical.
5. **Clean surfaces.** The detail normal and the crevice grime are reduced to 30 % / 35 % so the bands stay clean on the stone.
6. **No grain, no vignette, no split toning.**

## Where it is applied

* Every `_std` / `patchMaterial` material (level masonry, rock, metal, decor, flesh, decals, props, the dresser's figure): the shared
  grade, right after the contrast curve and black lift, before the highlight knee.
* The Mason, the skitterlings and the legacy creature view, the launchers, the gear, the body and the holdfast: `injectToon(shader)`
  (the same GLSL, declared once, called where the lit colour is final: after `opaque_fragment`, before tone mapping and the fog).
* Not applied: particles, glows, sprites, rope, the UI and the unlit effects (they are not lit; the stylisation reads as they are).

## Tuning

The band range matters most. `gain` sets where the top band sits (lighting / albedo = 1 / gain). The first pass used 3.2, which put it
at 0.31x: nearly every lit surface was already above it, passed through unbanded (the top band stays continuous on purpose) and the
picture stayed photographic. Screenshots at 0.5 / 1.2 / 3.2 showed 0.5 gives flat, readable cels on the floors and walls, so the
default is 0.55.

All numbers are in `LOOK_PRESETS.anime` and are uniforms (no recompiles): `bands`, `soft` (edge width in pixels), `gain` (how much
of the lighting range the bands cover), `shade` / `shadeAmt` (shadow tint), `sat`, `contrast`, `rim`, `detail`, `crev`.

## Ink outlines

Two kinds, both inside the existing materials (no post pass):

* **Silhouette outlines on the hero meshes: an inverted hull** (`render/outline.js`). A second, back-face-only copy of the mesh is pushed out
  along its smoothed normals by `width x view distance` (an ANGLE, so the line is the same few pixels from 1 m to 40 m) and filled with the
  ink colour, fogged like everything else; the mesh drawn over it leaves only the ring that sticks out. Smoothed normals (averaged over
  vertices that share a position) keep a hard-edged mesh from cracking open. Hulls: the glove, the sleeve and the launcher (shared skeleton and
  geometry, so the hidden sleeve applies to them), the body, the tusks and the stinger, and ONE hull for the whole creature, built from its cheap
  LOD1 geometry (~23 k triangles; the 63 k of LOD0 twice over would not fit the Quest). Cost: one draw call per hull (about +5 with the Mason in
  view) and one more pass over those triangles.
* **Edge ink on the masonry** (`materials.js`, `INK_EDGE_FRAG`): the bevel band of the box solids is darkened to near black in its inner part, so the
  level's solids carry a thin dark line along their edges. Free (a few ALU ops); only the materials that have the bevel.

Numbers (`LOOK_PRESETS.anime`): `ink` (on), `inkWidth` (0.0026 rad, about 2 px), `inkEdge` (0.9), `inkColor`. Off for `?look=horror|classic`, in the
`low` tier and with reduced effects, and by `?ink=off` / `settings.ink = false` whatever the look. Not on the level's other meshes, the Dresser,
the Holdfast or the lantern.

Seen only in headless software-GL screenshots so far (the creature shot was framed behind a pillar; the line is thin at 1024 px): the width and the
ink colour need a look on a headset.

## Not included (honest limits)

* **Outlines are partial.** The hero meshes have hull outlines and the masonry's box edges have ink (above), but the level's other meshes and
  props have no silhouette line: a hull on every mesh, or an edge-detect post pass, would cost draw calls / fill rate the Quest budget (150 draw
  calls) has not been measured for.
* The albedo textures themselves are still the photographic stone, wood and leather; they are not repainted. Only the lighting is stylised,
  so the result reads as a *stylised, cel-lit* picture rather than a full anime one. Flattening the textures (a blurred / posterised albedo
  tap) and line art are the two steps that would close that gap.
* Not measured on a headset. The cost is a handful of ALU ops per lit fragment and one `fwidth`.

Tests: `tools/abyssal-tether-3d/tests/render/test-toon.mjs`.
