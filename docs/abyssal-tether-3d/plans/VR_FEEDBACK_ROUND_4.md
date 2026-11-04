# VR feedback, round 4: the wrist, durability, wall depth

> "I can't see the actual health when playing in VR. The wrist doesn't show anything, like the health percentage."
> "Make the player more durable. He just loses HP in easy falls."
> "Add some depth to the walls. It just looks like a fake flat texture applied on the walls. The bricks aren't bricks."

## 1. A health badge on the wrist (render/wristVitals.js)

The only health readout in VR was the launcher's little ECG screen (a 7 x 3 cm quad on the launcher body; the number 100 in a corner of a 256 x 128
canvas). Now a **9 x 4.5 cm badge** sits on the back of the **left** forearm: "HP", the percentage in large numerals, a bar. Green from 60 %, amber below,
red and pulsing at or below the low threshold (35 %), a grey "--" when dead. One quad, one draw call, redrawn only when the shown value changes (8 Hz while
it pulses). It attaches itself to the arm model at (-0.03, 0.10, 0.14) in the arm's frame (measured on `player_arms.glb`: the left arm's centre line, its top,
the forearm side), tilted toward the eye like the old ECG plane. VR only; on the desktop `?wristvitals=on` shows it (the desktop HUD has the monitor).
The right wrist keeps the bag. Test: `tests/render/test-wrist-vitals.mjs`. **Not seen in a headset**: the position on the arm was checked on the desktop
with the left hand raised; if it sits wrong on the real arm, it is one line (`_attach`).

## 2. A more durable player (sim/config3d.js)

Fall damage is `((v / lethal - threshold) / (1 - threshold))^2`. The threshold was 0.35 of the lethal speed: a drop of about 1.3 m already cost health, 4 m cost
16 %, 6 m cost 38 %. Now (Normal 0.55, Nightmare 0.50, Abyss 0.45, Sandbox 0.55): **a drop under about 3.3 m is free** (Normal), 5 m costs about 9 %, 6 m about 20 %,
8 m about 50 %, and the lethal fall is unchanged (10.7 m on Normal). Side impacts are free under 60 % of the lethal speed (was 50 %). Regeneration is a little faster
(Normal: after 5 s instead of 6, 6 % a second instead of 5 %). Tests: `tests/health/unit.mjs` (updated to the new numbers).

## 3. Depth in the walls (render/materials.js, render/renderer3d.js)

Walls are boxes with a masonry texture; the relief came from a normal map and a height field of only about 2 cm, with ONE parallax tap on a wall (the steep
ray march was only for floors), and the anime look had cut the detail normal and the crevice shading to 30 % / 35 %. So the bricks read as a print.
Now (all in the shader, no new geometry, no new draw call):

* the **steep parallax march runs on vertical faces** within 3.5 m of the eye (Quest: 6 steps, tapering with distance), and a wall's relief is **(1 + 1.0)x deeper**
  than a floor's (`SURFACE_TIERS.*.wallDepth`: Quest 1.0, high 2, low 0.8 and no march);
* the anime look's `detail` and `crev` stay at 0.3 / 0.35: raised to 0.5 and 0.8 they were tried, and the detail normal turned the cel bands into blotchy camouflage (screenshots), so the depth comes from the parallax, not from more detail normal.
* `?walldepth=N` overrides the depth (0 = the old flat picture, 3 = deep; the default on Quest is 1.0) so the two can be compared on the headset.

Seen in headless screenshots: pits, grit and chipped edges on the blocks at arm's length, steadier relief on the Listening Vault's stone. **Not measured on a headset**:
the march costs fragments within 3.5 m of the eye (most when climbing close to a wall); if it costs frames, lower `steps` or `stepMax` for `quest`.
Real brick geometry is the other way: it needs the budget measured first (the authored wall panels were cut for the Quest triangle budget, `panelR` / `panelCap`).
Test: `tests/render/test-wall-depth.mjs`.
