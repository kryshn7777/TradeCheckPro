# THE LANTERN: item models (first aid case, field dressing, grenade, revolver)

Owner (2026-11): "Use better 3D models for the medkit and the bandages. The current bandages look like toilet papers."

All four props live in `src/render/itemModels.js`: procedural merged geometry, vertex colours only (no texture, no sampler, no new
material: they draw in the existing pickups / dropped-props meshes, one draw call each), matte, worn by a deterministic coordinate
hash (no `Math.random`). They follow the dark realism look (`DARK_REALISM_LOOK.md`): no cel shading, no outline, no emissive of their
own (the pickups' existing pulse and glow halo are unchanged, so they are still spotted in the lantern's pool).

| kind | what it is | silhouette (local space) | tris / verts |
| --- | --- | --- | --- |
| FIRST_AID | an old field medical case: chipped cream enamel over dark iron, a faded red cross on both faces, a dark steel rim round the seam, riveted corner caps, a leather strap handle on two brackets, two brass latches thrown open, the lid sprung ajar at the top with gauze showing and a stained fold hanging over the edge | upright, handle +Y, lid face +Z; 0.31 x 0.25 x 0.14 m | ~830 / ~1150 |
| BANDAGE | a field dressing: a folded linen pad (a folded top layer), half still in a torn kraft-paper wrapper, bound with twine both ways, dried blood soaked into one corner, two long linen tails trailing from one end and lying in loose curves, frayed tips with loose threads, a safety pin | flat in XZ (4 cm tall), tails toward +X; 0.28 x 0.04 x 0.12 m. Never a drum: the test pins that nothing of it stands more than 5 cm off its floor | ~1210 / ~1050 |
| GRENADE | the expedition soldiers' fused iron fragmentation grenade: a ribbed cast-iron egg (5 rows x 8 columns, a smooth waist band), rust, a steel collar, a tarnished brass fuse cap, the lever down the +X flank, a split pin and a pull ring on +Z with a short frayed cord | upright, fuse +Y; 0.06 x 0.12 x 0.07 m | ~1400 / ~1060 |
| SIDEARM | an old service revolver in profile: blued steel worn bright at the edges, a fluted cylinder with its chamber mouths, barrel + ejector housing + front sight, hammer, trigger guard, a walnut bird's-head grip with a butt cap, grip screw and lanyard ring, rust | profile in XY, muzzle +X, thin in Z; 0.23 x 0.16 x 0.04 m | ~860 / ~1170 |

Caps (`ITEM_MODEL_CAPS`): <= 1500 triangles and <= 1300 vertices per kind, so 48 pickups (pickupsView `MAX_ITEMS`) of the largest still
fit the Uint16 index. Quest budget: a handful of pickups are near at once (~1 k triangles each, still one call for all of them).

## API

```js
import { buildFirstAid, buildBandage, buildGrenade, buildSidearm, MODEL_REST, restQuaternion, ITEM_MODEL_CAPS } from './itemModels.js';
buildX(tilt = 0, size = 1) // -> { pos, nor, col: Float32Array, idx: Uint16Array, verts }: the pickups template format, origin at the prop centre
MODEL_REST.X               // { h, euler: [x, y, z], body: { e, mu, spin } } the lying pose for droppedProps.js
```

`pickupsView.buildTemplates(tilt)` uses `buildFirstAid(tilt)` / `buildBandage(tilt)` (the floating pickups lean 0.28 rad toward the
viewer, the dropped props pass 0). `droppedProps.js` takes the rest height, lying rotation and restitution / friction of both from
`MODEL_REST` (`FROM_MODELS` table). The bag icon of the bandage (`bagFx.js drawItemIcon`) is redrawn as the bound pad with two tails.

Lying poses: the case on its back (lid face up, the cross to the lantern, h 0.057 m); the dressing as modelled (h 0.020 m, the cloth
hardly bounces: e 0.06); the grenade on its side, lever up (h 0.029 m); the revolver on its side, +Z face up (h 0.021 m).

### Wiring the grenade and the revolver (for the gameplay agent; ITEM.GRENADE = 5, ITEM.SIDEARM = 6)

* `pickupsView.js buildTemplates`: `t[ITEM.GRENADE] = buildGrenade(tilt);` and `t[ITEM.SIDEARM] = buildSidearm(tilt);` (and a glow tint
  for kinds 5 / 6 in `GLOW_FRAG` if they float as pickups).
* `droppedProps.js FROM_MODELS`: `[ITEM.GRENADE, MODEL_REST.GRENADE],` and `[ITEM.SIDEARM, MODEL_REST.SIDEARM],`.
* `bagFx.js drawItemIcon` has no icon for them yet.

## Verification

* `tools/abyssal-tether-3d/tests/render/test-item-models.mjs` (in `run-tests.mjs`): caps, one indexed vertex-coloured template per kind,
  no NaN / unit normals / no near-white colours, hand-sized and centred bounds, distinct silhouettes (proportions and volumes), the
  dressing is flat, rest heights against the lying geometry (2 mm), determinism + tilt + no `Math.random`, the pickups / dropped-props
  wiring, a dropped case and dressing land and rest at their height, dispose.
* `tools/abyssal-tether-3d/release/render-items.mjs` renders the four in the real game (god mode, frozen, the dark look, the lantern in
  the player's hand) at ~0.7 m and the row at ~2 m, plus a real dropped case + dressing and the two floating pickups:
  `img/item-models.png`.
