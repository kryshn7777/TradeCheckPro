# "Ground ahead": the blocks that will stop a fall are visible from far away

> "I need distant hard stopping blocks to be visible: some are spawning below the player suddenly during free fall and he dies"

They did not spawn: the level is only drawn out to the fog cull distance (25-55 m, less in the fog-thick sections) and a fall reaches
38 m/s, so a ledge came out of the haze about a second before the impact (a fall is lethal from ~15-17 m/s).

`render/fallCue.js` (one instanced draw call, `FallCue`, owned by `LevelView`): while the player falls (>= 4 m/s down, full at 12), the solids
below get a marker on their top face, drawn through the haze (unlit, additive, no fog, depth-tested so a nearer wall still hides it):
a border that keeps its angular width from any distance and a faint plate, amber, red when the estimated impact there is near-lethal
(`sqrt(vy^2 + 2 g d)` vs `diff.lethalImpact`, drag ignored). It fades out as the real block gets within 4-14 m.

`pickFallBlocks` (pure, Node-testable) picks the nearest top faces in the column the player falls through (half width 7 m + the drift, up to
170 m ahead, at most 14), drops blocks covered by a higher one, bars (< 0.6 m2), kit dressing and inactive solids, re-run every 0.2 s / 2 m.

Off: `?fallcue=off` or `settings.fallCue = false`. Cost: nothing unless falling; 1 draw call, <= 14 quads.
Checked: from every checkpoint of the real level a fall finds 22 floors past 45 m in all but one section (test); headless screenshot in S7
(amber frames 84-128 m down). Not measured on a headset.

Tests: `tests/render/test-fall-cue.mjs`.
