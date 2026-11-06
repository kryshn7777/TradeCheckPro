// The stylised "3D anime" look (render/materials.js atToon / injectToon / toonBand, renderer3d.js LOOK_PRESETS.anime), Node, no GPU:
//   - the band curve steps the LIGHT (lit / albedo luminance) into a few flat plateaus with soft edges, rises monotonically, is
//     continuous, and above the top band stays the identity (a lantern flare or a glow is still HDR);
//   - the GLSL: the shared function is declared once in every lit grade and in injectToon, runs where the lit colour is final (right
//     after the opaque_fragment, before tone mapping and the fog), is skipped by a uniform (uToonK.x = 0 = the realistic grade);
//   - every patch site that is not the shared grade (Mason + skitterlings, launchers, gear, body, the holdfast) calls injectToon;
//   - the default look is the anime preset, the horror and classic presets stay available and switch it off.
//   node test-toon.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register as reg } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/vendor/three/')).href;
const SRC = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/src/')).href;
const SRCDIR = path.resolve(HERE, '../../../../public/abyssal-tether-3d/src');
reg(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR}/three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR}/addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const THREE = await import('three');
const { LOOK, injectToon, toonBand } = await import(`${SRC}/render/materials.js`);
const { patchMasonMaterial, makeMasonUniforms } = await import(`${SRC}/render/mason/masonMaterial.js`);

let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};
const read = (f) => fs.readFileSync(path.join(SRCDIR, f), 'utf8');

// 1. The band curve.
{
  const bands = 5;
  const gain = 3.2;
  const top = 1 / gain;
  const at = (lit, w = 0.02) => toonBand(lit, bands, gain, w);
  ok(at(0) === 0, 'no light, no band: the floor of the cel is the tinted albedo added in the shader, not a lifted band');
  // plateaus: sample the lighting range finely, count the distinct levels below the top
  const levels = new Set();
  let mono = true;
  let prev = -1;
  let maxJump = 0;
  for (let i = 0; i <= 4000; i++) {
    const lit = (i / 4000) * top;
    const v = at(lit);
    if (v < prev - 1e-12) mono = false;
    maxJump = Math.max(maxJump, v - prev > 0 && prev >= 0 ? v - prev : 0);
    prev = v;
    levels.add(Math.round(v * 1e4));
  }
  ok(mono, 'the lighting is cut into bands that only ever rise with the light');
  // plateau levels are (k / bands)^2 / gain: the squares of an even step in square-root (perceptual) space
  let exact = 0;
  for (let k = 0; k <= bands; k++) if (levels.has(Math.round(((k / bands) ** 2 / gain) * 1e4))) exact++;
  ok(exact === bands + 1, `${bands + 1} flat plateaus (the dark band and ${bands} lit ones) at the squares of an even step in sqrt space`);
  ok(maxJump < top * 0.12, `band edges are soft, not hard steps in the maths (largest step between samples ${(maxJump / top * 100).toFixed(1)} % of the range)`);
  // a plateau is flat: the middle of a band does not move with the light
  const mid = (k) => ((k + 0.25) / bands) ** 2 / gain; // inside band k (rounding at x = k + 0.5)
  const a = at(mid(2));
  const b = at(mid(2) * 1.02);
  ok(Math.abs(a - b) < 1e-9, 'inside a band the colour does not follow the light (flat cel areas)');
  // above the top band the light is untouched
  ok(Math.abs(at(1.0) - 1.0) < 1e-9 && Math.abs(at(7.5) - 7.5) < 1e-9, 'above the top band the light stays continuous and HDR (flares, glows and the lantern pool are not clipped to a band)');
  ok(at(top * 0.999) <= at(top * 1.001) + 1e-9, 'continuous across the top band');
  // the edge half-width: wider = softer
  const edge = (w) => {
    const x = 2.5 / bands; // the 2 -> 3 step at x = 2.5
    const lit = (x * x) / gain;
    return [at(lit * 0.97, w), at(lit * 1.03, w)];
  };
  const [s0, s1] = edge(0.02);
  const [h0, h1] = edge(0.4);
  ok(s1 - s0 > h1 - h0, 'a wider edge softens the step (the shader widens it with the pixel footprint: no crawling, no aliasing)');
}

// 2. The GLSL.
{
  const mat = read('render/materials.js');
  ok((mat.match(/vec3 atToon\(/g) || []).length === 1, 'one shared atToon function');
  ok(/const GRADE_DECL = .*\+ TOON_DECL;\n/.test(mat), 'the lit grade declares it (level, props, decor, the dresser)');
  ok(/atC = atC \* uGradeTint \+ uBlack;\n    if \( uToonK\.x > 0\.001 \) atC = atToon\( atC, diffuseColor\.rgb \);/.test(mat), 'the grade bands the lighting after the grade and black lift, before the horror block and the highlight knee');
  const decl = mat.slice(mat.indexOf('const TOON_DECL'), mat.indexOf('const TOON_FRAG'));
  ok(/fwidth\( xc \)/.test(decl) && /smoothstep\( 0\.5 - w, 0\.5 \+ w, xc - f \)/.test(decl), 'band edges are one pixel wide (fwidth of the banded value), anti-aliased');
  ok(/lit = l \/ a/.test(decl) && /albedo \* uToonShade\.rgb \* uToonShade\.a/.test(decl), 'the light is divided by the albedo (the texture survives) and the shadow is a tint of the albedo');
  ok(/mix\( c, t, uToonK\.x \)/.test(decl), 'a strength of 0 returns the realistic colour untouched');
  // injectToon on a fake shader
  const shader = {
    uniforms: {},
    fragmentShader: '#include <common>\nvoid main() {\n#include <opaque_fragment>\n#include <tonemapping_fragment>\n#include <fog_fragment>\n}',
  };
  injectToon(shader);
  const fsrc = shader.fragmentShader;
  ok(shader.uniforms.uToonK === LOOK.uToonK && shader.uniforms.uToonShade === LOOK.uToonShade, 'injectToon binds the SHARED uniforms (one write per frame drives every material, no recompiles)');
  ok((fsrc.match(/atToon\(/g) || []).length === 2, 'the function and one call');
  ok(fsrc.indexOf('opaque_fragment') < fsrc.indexOf('atToon( max') && fsrc.indexOf('atToon( max') < fsrc.indexOf('tonemapping_fragment') && fsrc.indexOf('tonemapping_fragment') < fsrc.indexOf('fog_fragment'), 'banded where the lit colour is final: after the opaque fragment, before tone mapping and the fog');
  ok(/if \( uToonK\.x > 0\.001 \)/.test(fsrc), 'skipped by a uniform branch (uniform control flow: fwidth stays defined)');
}

// 3. The Mason + skitterling patch.
{
  const mat = new THREE.MeshStandardMaterial();
  patchMasonMaterial(mat, makeMasonUniforms());
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: [
      '#include <common>',
      '#include <clipping_planes_fragment>',
      '#include <color_fragment>',
      '#include <roughnessmap_fragment>',
      '#include <lights_fragment_end>',
      '#include <opaque_fragment>',
      '#include <tonemapping_fragment>',
      '#include <fog_fragment>',
    ].join('\n'),
  };
  mat.onBeforeCompile(shader, null);
  const f = shader.fragmentShader;
  ok(shader.uniforms.uToonK === LOOK.uToonK, 'the Mason binds the shared toon uniforms');
  ok(f.indexOf('atToon( max') > f.indexOf('opaque_fragment') && f.indexOf('atToon( max') < f.indexOf('mPreFog'), 'the Mason is banded before its own fog tail (the haze stays smooth)');
  ok(/mason-rig-v5/.test(mat.customProgramCacheKey()), 'the program cache key changed with the shader');
}

// 4. Every other patch site calls it.
{
  for (const [file, count] of [
    ['render/handsView.js', 2],
    ['render/bodyView.js', 1],
    ['render/holdfastView.js', 1],
    ['render/mason/masonMaterial.js', 1],
    ['render/creatureView.js', 1],
  ]) {
    const src = read(file);
    const calls = (src.match(/injectToon\(shader\)/g) || []).length;
    ok(calls === count && /import \{[^}]*injectToon[^}]*\} from '[./]+\/?(?:\.\.\/)?materials\.js'/.test(src), `${file}: ${count} injectToon call(s) and the import`);
  }
}

// 5. The presets.
{
  const src = read('render/renderer3d.js');
  ok(/let n = settings && typeof settings\.look === 'string' \? settings\.look : 'anime';/.test(src) && /return LOOK_PRESETS\[n\] \|\| LOOK_PRESETS\.anime;/.test(src), 'the default look is anime, and so is the fallback for an unknown name');
  const block = src.slice(src.indexOf('const LOOK_PRESETS = {'), src.indexOf('function lookPreset'));
  const anime = block.slice(block.indexOf('anime:'), block.indexOf('horror:'));
  const horror = block.slice(block.indexOf('horror:'), block.indexOf('classic:'));
  const classic = block.slice(block.indexOf('classic:'));
  ok(/toon: 1/.test(anime) && !/toon:/.test(horror) && !/toon:/.test(classic), 'only the anime preset switches the cel bands on (horror and classic are the realistic picture: ?look=horror brings it back)');
  ok(/grain: 0, vignette: 0, tone: 0/.test(anime), 'no film grain, no vignette, no split toning in the anime look');
  ok(/LOOK\.uToonK\.value\.set\( lk\.toon \|\| 0/.test(src.replace(/\s+/g, ' ').replace('LOOK.uToonK.value.set(lk.toon || 0', 'LOOK.uToonK.value.set( lk.toon || 0')), 'the toon strength is driven per frame from the preset (0 for the other looks)');
}

console.log(`\n${n} checks passed`);
