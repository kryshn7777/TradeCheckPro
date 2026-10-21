# ABYSSAL TETHER 3D: Chapter I art direction (WP-ART-PASS)

Owner verdict (2026-10-20/21): "still looks like a 2010 game". Hands and launchers are fine; the environment fails on four counts:
murky near-black frames with no value structure, huge empty dark volumes with no lit mid-distance landmark, noisy foil-like
wall / floor textures with no believable masonry form, flat box silhouettes. This is the Quest-only fix (stay WebXR; no PC tier).

## Rules for the whole descent

1. **Value structure first.** Every view has three layers: a *dark near layer* (silhouettes: girders, rings on chains, ledge lips,
   statues), a *mid layer lit by a pool of light* (the thing the player is about to use), and a *lit far layer* (haze glowing in
   the fog colour, a window, a shaft, a lantern-bearing colossus). The fog colour is the lightest large area in a frame and is
   never near-black: the section fogs are 25-45 sRGB lighter than before, desaturated, and every dark silhouette reads against
   them. Contrast comes from dark shadow sides and light pools, not from raising everything.
2. **Warm / cool separation.** Cool (teal-blue, mint) = the outside, the shafts, the Vault: *distance and space*. Warm (amber, ember)
   = lamps, forges, the Still Lamp: *use and goal*. A warm pool is always where the player is meant to stand or act; cool light
   comes from far away and is never where you stand. Rust-red is only ever danger (frayed rings, the Gullet's furnace).
3. **One landmark per section, visible from the checkpoint.** The first thing seen on arrival is lit; the exit is lit warmer than
   the entrance.
4. **Real masonry relief on the route.** Within ~11 m of any anchor / checkpoint / spawn the walls are authored bevelled ashlar
   panels (kit `wall_a/b/c`: large stones, 8-9 cm joints, 5-17 cm proud, chipped corners, per-stone tone in the vertex colour
   so a wall is a pattern of stones) on top of calm PBR sets (`rock` = big dressed ashlar with deep joints, `masonry` = flagstones,
   `metal` = riveted plate); big silhouettes (buttresses hung on corbels, column clusters, broken stair flights, pipe runs, wall
   lanterns) sit away from the player space. Nothing authored is collidable; nothing sits within 1.3 m of an anchor or a climb zone.
5. **Nothing is noisy at 1 m.** Texture frequency stays below what the 2K tiles can resolve; no peck / pit / blotch octaves; the
   detail comes from forms (joints, chips, shelves), not from speckle.

## Section by section

| # | Section | Key colour / accent | Light story (where light enters) | First thing seen | Focal landmark | Sightlines |
|---|---|---|---|---|---|---|
| S1 | The Threshold | steel-blue haze `#2f414d` / amber `#e8a458` | Cold Outer Dark pours through the 6 x 22 m east window onto the opposite wall (`light` 2.6 @ (10,19,0)); a lit well shaft (cold) falls into the descent hole; two warm lanterns flank the Threshold arch and pool on the statues | the pale ring + girder ahead, backlit by the cold shaft | the east window with the colossal arch in it (warm lantern vs cold dawn) | spawn -> ring -> window; well shaft pulls the eye down |
| S2 | The Long Swing | slate `#293a49` / amber | The west window behind the colossal Lanternwright floods the hall cold and rim-lights the statue (3.0 @ (-32,-17,0)); warm lamps on the landing and between the arches make a pool-dark-pool rhythm down 45 m; a cold shaft drops from the well onto the floor | the far pier + colossus silhouetted against the window | the colossus's lantern (warm) in a cold window | the hall axis (x), arches framing it |
| S3 | The Broken Gallery | green-grey `#25322f` / verdigris `#4fa08e` | One cold oculus column (2.0 @ (-16,-62,0), 5 x 40 m shaft) lights the spans from above; warm landing at the east; a warm beacon lamp over the narrow last span; pale-teal glow along the glyph band | the girders cut by the cold column | the lit last span (warm beacon in a cold shaft) | across the three spans toward the beacon |
| S4 | The Listening Vault | teal mist `#254650` / mint `#b8f0e0` | Cold mint shafts across a 190 m void (three, at three depths) and a very cold far light; the catwalk / shelf / plinth carry warm lamps so each landing is a warm island in a cold sea | the void with mist columns and silhouettes | the mist columns + the far spire / colossus silhouetted | catwalk -> cradle -> shelf -> plinth, each lit |
| S5 | The Gullet Stair | ember brown `#38211a` / furnace `#c4602a` | Cold leak from the vault above (1.2 @ top), a hot furnace glow rising from the fork below (2.6 @ (-12,-198,0), flicker); alternate-ledge lamps; hairline ember cracks | the spiral of ledges lit from below | the furnace glow at the bottom | down the throat |
| S6 | The Two Descents | warm-cool split / rust `#c0602e` | **West = warm** (five lamps down the long stair + amber shaft), **East = cold teal** (two teal lights + a cyan shaft) with one rust-red warning lamp at the crumbling ledge; the divider is the colour boundary | the fork platform and the two plaques | the divider wall between amber and teal | both columns visible from the fork |
| S7 | The Hollow Nave | deep teal `#1d3541` / mint | The inverted spire is lit cold along its whole length (3 lights + a base glow) as the one big landmark; two corner colossi hold warm lanterns far out; cold shafts | the spire, hanging | the spire | rings spiral round it |
| S8 | The Last Throat | amber haze `#46301a` / gold `#f0a850` | The throat warms and brightens toward the Still Lamp (gold steps 1.4 -> 2.2, shaft, lamp 3.2); one cold look back at the nave | the warm glow far below | the Still Lamp's chamber | straight down the throat |

## Environment pieces added (kit part set 2, `tools/abyssal-tether-3d/env_kit2_parts.py`, in `ch1_env_kit.glb`)

`wall_a/b/c` (4 x 4 m panels, 120 / 320 / 170 tris), `buttress_lo/cap` (4 m modules on a corbel), `column_cluster` (5 m, 524 tris),
`stair_fragment` (broken flight + snapped rail, 230), `pipe_run` (4 m on clamps with flanges and a valve), `lantern` + `lantern_glass`
(wall lantern; the glass is in the emissive `glow` list). Procedural additions in `render/levelView.js`: panel planner (route-distance
cells, per-section cap), buttresses, stair flights, pipe runs and emissive cracks (S5-S8). All go through the existing merged decor
lists (no new draw call).

## Budget rule

The frame already sat at the 150-call / 350k-tri line before this pass, so authored detail is paid for by trims: far arcades / lancets,
rubble, stains and roots are thinned; the figures are in `docs/abyssal-tether-3d/STATUS.md` / the WP-ART-PASS row.
