// WALL DEPTH (render/materials.js steep parallax on walls, render/renderer3d.js SURFACE_TIERS.wallDepth, the look's detail / crev), Node, no GPU.
// Reported from VR: "add some depth to the walls. It just looks like a fake flat texture applied on the walls. Like, the bricks aren't bricks."
// The height field of the masonry is only ~2 cm; walls got ONE parallax tap, the steep ray march was for floors. Now: the march runs on vertical faces
// near the eye, their relief is (1 + wallDepth)x deeper (Quest 1.6), the dark realism look keeps the full detail normal and a little more crevice grime
// (the cel look that had cut them to 30 % / 35 % is gone), and `?walldepth=N` is an A/B switch (0 = the old picture).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../../../public/abyssal-tether-3d/src/render');
const mat = fs.readFileSync(path.join(SRC, 'materials.js'), 'utf8');
const r3 = fs.readFileSync(path.join(SRC, 'renderer3d.js'), 'utf8');
let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};
ok(/if \( uParallaxS\.x > 1\.5 && atDist < uParallaxS\.y && \( vAtTop > 0\.7 \|\| uParallaxS\.w > 0\.0 \) \) \{/.test(mat), 'the steep march runs on floors and, with a wall depth > 0, on walls too');
ok(/\( 1\.0 \+ uParallaxS\.w \* \( 1\.0 - smoothstep\( 0\.2, 0\.7, vAtTop \) \) \)/.test(mat), 'a vertical face has (1 + wallDepth) x the relief of a floor (a floor keeps 1)');
const tiers = /const SURFACE_TIERS = \{([\s\S]*?)\n\};/.exec(r3)[1];
const wd = (name) => Number(new RegExp(name + ': \\{[^}]*wallDepth: ([0-9.]+)').exec(tiers)[1]);
ok(wd('quest') === 1.0 && wd('high') === 2 && wd('low') === 0.8, 'wall depth per tier: Quest 1.0 (a wall has 2x a floor\'s relief), high 2, low 0.8 (low has no steps: the one tap only)');
ok(/stepMax: 3\.5/.test(tiers) && /quest: \{[^}]*steps: 6/.test(tiers), 'Quest: 6 steps within 3.5 m (was 3 m)');
ok(/LOOK\.uParallaxS\.value\.set\(lvl >= 2 \? 0 : P\.steps, P\.stepMax, P\.stepFade, wallDepthOverride\(\) \?\? P\.wallDepth\)/.test(r3), 'the lever is driven every frame, with the ?walldepth override');
ok(/function wallDepthOverride\(\)/.test(r3) && /walldepth=/.test(r3), '?walldepth=N is read (0 = off, up to 6)');
const looks = fs.readFileSync(path.join(SRC, 'lookPresets.js'), 'utf8');
const dark = /dark: Object\.freeze\(\{([\s\S]*?)\n {2}\}\),/.exec(looks)[1];
ok(/detail: 1,/.test(dark) && Number(/crev: ([0-9.]+)/.exec(dark)[1]) >= 1, 'the dark look keeps the full detail normal and at least the full crevice grime (the cel look\'s 0.3 / 0.35 cut is gone): real stone reads by its micro relief');
console.log(`\n${n} checks passed`);
