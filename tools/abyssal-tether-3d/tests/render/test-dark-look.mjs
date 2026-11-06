// The DARK REALISM look (render/lookPresets.js, the lit grade in render/materials.js, renderer3d.js), Node, no GPU:
//   - the cel-shaded "3D anime" look is gone: no toon / ink / outline symbol anywhere in src, outline.js deleted, no hull objects built;
//   - the preset table: `dark` is the default, `classic` the lighter variant, old names (`horror`, `anime`) and a saved settings.look of
//     'anime' fall back to the dark default, `?look=` overrides the setting; the numbers are in range (neutral-cool shadows, never violet);
//   - the film terms: grain and vignette never in VR, the grain off with reduced effects and on the quest / low tiers;
//   - the grade chunk is a complete program string in a patched lit material (every uniform declared once, braces balanced, bound);
//   - the JS twin of the grade: the toe presses the unlit shadow toward black, the black floor holds, the knee bounds the highlights.
//   node test-dark-look.mjs
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
const M = await import(`${SRC}/render/materials.js`);
const P = await import(`${SRC}/render/lookPresets.js`);
const { makeMasonUniforms } = await import(`${SRC}/render/mason/masonMaterial.js`);
const { makeSkitterUniforms } = await import(`${SRC}/render/mason/skitterMaterial.js`);

let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};
const read = (f) => fs.readFileSync(path.join(SRCDIR, f), 'utf8');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));

// 1. The cel look is gone.
{
  const files = walk(SRCDIR);
  const bad = [];
  const TOON = /atToon|injectToon|toonBand|uToon|TOON_|uInkK|INK_EDGE|inkEdge|addOutline|removeOutline|syncOutlines|setOutlineLook|mergedHullGeometry|outline\.js|hullCalls|\bcel[- ]shad/i;
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    if (TOON.test(s)) bad.push(path.relative(SRCDIR, f) + ': ' + TOON.exec(s)[0]);
    // 'anime' only as the alias that sends old URLs / saves to the dark default
    if (/\banime\b/i.test(s) && !f.endsWith('lookPresets.js')) bad.push(path.relative(SRCDIR, f) + ': anime');
  }
  ok(bad.length === 0, `no toon / ink / outline symbol left anywhere in src (${files.length} files)${bad.length ? ': ' + bad.join(', ') : ''}`);
  ok(!fs.existsSync(path.join(SRCDIR, 'render/outline.js')), 'render/outline.js (the inverted-hull ink module) is deleted');
  ok(!('uToonK' in M.LOOK) && !('uToonShade' in M.LOOK) && !('uInkK' in M.LOOK) && !('uHorrorK' in M.LOOK), 'the shared LOOK uniforms carry no toon, ink or old horror term');
  ok(!('injectToon' in M) && !('toonBand' in M) && !('inkEdge' in M), 'materials.js exports no toon helper');
  const lk = read('render/lookPresets.js');
  ok(!/toon|bands|ink/i.test(lk.replace(/anime: 'dark'/, '').replace(/\banime\b[^\n]*/g, '')), 'the preset table has no band / ink parameter');
}

// 2. No outline objects: the views that had hulls build none.
{
  const mand = read('render/mason/masonMandibles.js');
  const sting = read('render/mason/masonStinger.js');
  const rig = read('render/masonRigView.js');
  const ush = read('render/usherView.js');
  const gear = read('render/handsGear.js');
  const body = read('render/bodyView.js');
  ok(![mand, sting, rig, ush, gear, body].some((s) => /_Outline|BackSide|\.hulls?\b|hullNear|hullFar|_hull\b|this\.outlines/.test(s)), 'the Mason, its tusks and stinger, the Ushers, the hands, launchers and body build no hull / outline object (no extra draw call)');
  const r3 = read('render/renderer3d.js');
  ok(!/syncOutlines|inkDisabled|\?ink=/.test(r3), 'the render loop has no outline sync and no ?ink= switch');
}

// 3. The preset table, aliases and fallbacks.
{
  const D = P.LOOK_PRESETS.dark;
  const C = P.LOOK_PRESETS.classic;
  ok(P.DEFAULT_LOOK === 'dark' && P.resolveLook({}, '') === D && P.resolveLook(null, '') === D, 'the default look is dark');
  ok(P.resolveLook({ look: 'anime' }, '') === D, "a saved settings.look of 'anime' falls back to the dark default");
  ok(P.resolveLook({}, '?look=anime') === D && P.resolveLook({}, '?sw=0&look=ANIME') === D, '?look=anime falls back to the dark default');
  ok(P.resolveLook({}, '?look=horror') === D && P.resolveLook({ look: 'horror' }, '') === D, 'horror (the old realistic name) is an alias of the new default');
  ok(P.resolveLook({}, '?look=classic') === C && P.resolveLook({ look: 'classic' }, '') === C, 'classic is the lighter variant');
  ok(P.resolveLook({ look: 'classic' }, '?look=dark') === D && P.resolveLook({ look: 'dark' }, '?look=classic') === C, '?look= overrides the setting');
  ok(P.resolveLook({ look: 'bogus' }, '?look=nope') === D && P.lookName(42) === 'dark', 'unknown names fall back to the default');
  for (const L of [D, C]) {
    const lo = L.splitLo;
    const hi = L.splitHi;
    ok(L.exposure >= 0.6 && L.exposure <= 1.4 && L.toe >= 0 && L.toe <= 1 && L.split >= 0 && L.split <= 1, `${L.name}: exposure ${L.exposure}, toe ${L.toe}, split ${L.split} in range`);
    ok(lo[2] >= lo[1] && lo[1] >= lo[0] && !(lo[0] > lo[1] && lo[2] > lo[1]) && Math.max(...lo) - Math.min(...lo) <= 0.2, `${L.name}: the shadows are neutral-cool (${lo.join(', ')}), never violet (r and b over g) or green`);
    ok(hi[0] >= hi[1] && hi[1] >= hi[2] && Math.max(...hi) - Math.min(...hi) <= 0.15, `${L.name}: the lit parts are a restrained warm (${hi.join(', ')})`);
    ok(L.floor.length === 8 && L.floor.every((v, i) => v > 0 && (i === 0 || v <= L.floor[i - 1])), `${L.name}: the ambient floor is non-zero in every section and never rises with depth (${L.floor.join(' / ')})`);
    ok(L.lanternDecay >= 1.6 && L.lanternDecay <= 2 && L.lantern >= 1 && L.lantern <= 2, `${L.name}: the lantern x${L.lantern}, decay ${L.lanternDecay}`);
    ok(L.sat < 0 && L.hazeDesat > 0, `${L.name}: drained colour (sat ${L.sat}), the haze drained (${L.hazeDesat})`);
  }
  ok(D.floor[0] / D.floor[7] >= 2, `dark: the descent darkens (with the depth darkness of sim/nightVision3d.js on top) (floor S1 / S8 = ${(D.floor[0] / D.floor[7]).toFixed(1)}x)`);
  ok(D.lanternDecay === 2, 'dark: the lantern falls off with the inverse square (a bright pool, a fast dark)');
  ok(C.exposure > D.exposure && C.toe < D.toe && C.floor.every((v, i) => v > D.floor[i]) && C.lift >= D.lift, 'classic is lighter than dark everywhere (exposure, toe, floor, black lift)');
  ok(D.grain <= 0.05 && D.vignette <= 0.4, `dark: fine grain (${D.grain}) and a gentle vignette (${D.vignette})`);
  ok(Math.abs(P.perSection(D.floor, 0) - D.floor[0]) < 1e-9 && Math.abs(P.perSection(D.floor, 7.5) - D.floor[7]) < 1e-9 && Math.abs(P.perSection(D.floor, 0.5) - (D.floor[0] + D.floor[1]) / 2) < 1e-9, 'perSection blends the table between sections and clamps at the ends');
}

// 4. The film terms: never in VR, tier numbers.
{
  const D = P.LOOK_PRESETS.dark;
  const f = (tier, xr, red) => P.filmTerms(D, tier, xr, red);
  for (const tier of ['low', 'quest', 'high']) {
    const v = f(tier, true, false);
    ok(v.grain === 0 && v.vignette === 0, `${tier} in VR: no grain, no vignette (a per-frame noise shimmers, a view-locked darkening is the comfort vignette's job)`);
  }
  ok(f('high', false, false).grain === D.grain && f('high', false, false).vignette === D.vignette, 'high on desktop: the fine grain and the static vignette');
  ok(f('high', false, true).grain === 0 && f('high', false, true).vignette === D.vignette, 'reduced effects: no grain');
  ok(f('quest', false, false).grain === 0 && f('low', false, false).grain === 0 && f('low', false, false).vignette === 0, 'quest / low tiers: no grain; low: no vignette');
  ok(f('low', false, false).toe < f('quest', false, false).toe && f('quest', false, false).toe === D.toe, 'low tier: a softer toe (no lantern shadow there, keep the shapes)');
  ok(P.LOOK_TIERS.low.floor > 1 && P.LOOK_TIERS.quest.floor === 1 && P.LOOK_TIERS.high.floor === 1, 'low tier: a little more ambient floor');
  const r3 = read('render/renderer3d.js');
  ok(/filmTerms\(lk, this\.lighting\.tier, !!this\.renderer\.xr\.isPresenting/.test(r3), 'the renderer feeds the XR state to the film terms every frame (entering VR drops grain and vignette at once)');
  ok(/r\.toneMapping = this\.look\.toneMapping === 'agx' \? THREE\.AgXToneMapping : THREE\.ACESFilmicToneMapping/.test(r3) && /r\.toneMappingExposure = this\.look\.exposure/.test(r3), 'the tone mapper and the exposure come from the preset');
  ok(/this\.lanternBase = LANTERN_CANDELA \* this\.look\.lantern/.test(r3) && /this\.lantern\.decay = this\.look\.lanternDecay/.test(r3), 'the lantern candela and falloff come from the preset');
  ok(/setLightmapTune\(\{ exposure: lk\.lmExposure, floor: lk\.lmFloor/.test(r3), 'the baked light is tuned by the preset');
}

// 5. The grade chunk is a complete program string.
{
  const mat = new THREE.MeshStandardMaterial();
  M.patchMaterial(mat, { lit: true, grade: true, uv: 'box', bevel: true });
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  mat.onBeforeCompile(shader, null);
  const fs_ = shader.fragmentShader;
  const a = fs_.indexOf('vec3 atC = max( gl_FragColor.rgb');
  ok(a > fs_.indexOf('#include <opaque_fragment>') && a > 0 && fs_.indexOf('#include <tonemapping_fragment>') > a && fs_.indexOf('#include <fog_fragment>') > a, 'the grade runs where the lit colour is final: after the opaque fragment, before tone mapping and the fog');
  for (const u of ['uGradeK', 'uGradeTint', 'uBlack', 'uFilmK', 'uSplitLo', 'uSplitHi']) {
    const decl = fs_.split('\n').filter((l) => new RegExp(`^\\s*uniform\\s+\\w+\\s+${u}\\s*;`).test(l)).length;
    ok(decl === 1 && shader.uniforms[u] === M.LOOK[u], `${u} is declared once and bound to the shared LOOK uniform`);
  }
  let depth = 0;
  let min = 0;
  for (const ch of fs_) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    min = Math.min(min, depth);
  }
  ok(depth === 0 && min === 0, 'the patched fragment program has balanced braces');
  ok(!/atToon|uToon|uInk|uHorror/.test(fs_), 'no toon, ink or old horror term in the program');
  ok(/varying vec3 vAtW|vAtW/.test(fs_) && /vViewPosition/.test(fs_), 'the grade reads only varyings the lit program has (vAtW for depth, vViewPosition for the vignette)');
}

// 6. The JS twin of the grade.
{
  const D = P.LOOK_PRESETS.dark;
  const o = {
    gradeK: new THREE.Vector4(1.1 + D.contrast, 0.94 + D.sat, D.depthDesat, D.toe),
    tint: new THREE.Color(1, 1, 1),
    filmK: new THREE.Vector4(0, 0, D.split, 0),
    splitLo: new THREE.Color(...D.splitLo),
    splitHi: new THREE.Color(...D.splitHi),
    black: new THREE.Color(0.0008, 0.0009, 0.001),
  };
  const noToe = Object.assign({}, o, { gradeK: new THREE.Vector4(o.gradeK.x, o.gradeK.y, o.gradeK.z, 0) });
  const L = (v) => v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
  const dim = [0.006, 0.006, 0.006];
  const nb = { black: new THREE.Color(0, 0, 0) };
  ok(L(M.gradeColor(dim, Object.assign({}, o, nb))) < 0.8 * L(M.gradeColor(dim, Object.assign({}, noToe, nb))), 'the toe presses the unlit shadow toward black (an unlit wall at linear 0.006 loses > 20 %)');
  const lit = [0.4, 0.3, 0.2];
  ok(Math.abs(L(M.gradeColor(lit, o)) - L(M.gradeColor(lit, noToe))) < 1e-6, 'the toe leaves the lantern pool alone');
  const black = M.gradeColor([0, 0, 0], o);
  ok(black[0] >= o.black.r - 1e-9 && black[2] >= o.black.b - 1e-9 && L(black) > 0, 'the black floor holds: nothing is a pure black void');
  const sh = M.gradeColor([0.02, 0.02, 0.02], o);
  ok(sh[2] > sh[1] && sh[1] > sh[0], 'a grey shadow turns neutral-cool (b > g > r)');
  ok(!(sh[0] > sh[1] && sh[2] > sh[1]), 'never violet');
  const pool = M.gradeColor([0.6, 0.6, 0.6], o);
  ok(pool[0] > pool[1] && pool[1] > pool[2], 'a grey surface in the lantern pool turns warm');
  ok(Math.max(...M.gradeColor([60, 50, 40], o)) <= 5.0 + 1e-9, 'the knee bounds the highlights (input 60 -> <= 5)');
  const deep = M.gradeColor([0.3, 0.12, 0.08], o, -300);
  const top = M.gradeColor([0.3, 0.12, 0.08], o, 0);
  const sat = (v) => (Math.max(...v) - Math.min(...v)) / Math.max(...v);
  ok(sat(deep) < sat(top), 'colour drains with depth');
}

// 7. The Mason keeps no cool sheen; the skitterlings keep their own red rim (readability).
{
  const U = makeMasonUniforms();
  ok(U.uRim.value.r === 0 && U.uRim.value.g === 0 && U.uRim.value.b === 0, 'the Mason has no cool rim sheen (the lantern alone shapes it)');
  const S = makeSkitterUniforms();
  ok(S.uRim.value.r > 0.1 && S.uRim.value.r > S.uRim.value.b, 'the skitterlings keep their dull red rim (their silhouette in the dark)');
}

console.log(`\n${n} checks passed`);
