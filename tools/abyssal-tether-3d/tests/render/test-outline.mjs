// Ink outlines for the stylised look (render/outline.js: inverted hulls on the hero meshes; render/materials.js: the line on the masonry's
// box edges; render/renderer3d.js: the preset), Node, no GPU:
//   - smoothed normals weld the vertices that share a position (so the push-out does not crack along hard edges); unit length;
//   - one merged hull geometry for a creature that is several meshes (one draw call), indices offset right, skin attributes kept;
//   - a hull sits beside its source (same parent, same transform, shared geometry, back faces only, shared fogged ink material), is hidden
//     until the look is on, follows the source's visibility (any of several sources), and can be removed; skinned sources share the skeleton;
//   - the hull's vertex shader pushes the vertex out along the (skinned) smoothed normal by `width x view distance`: a constant on-screen line;
//   - the edge ink: the bevel band is darkened (JS twin), only the materials that have the bevel carry it;
//   - the anime preset turns the ink on, the others do not; ?ink=off / low tier / reduced effects turn it off; every hero view has its hull.
//   node test-outline.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/vendor/three/')).href;
const SRC = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/src/')).href;
const SRCDIR = path.resolve(HERE, '../../../../public/abyssal-tether-3d/src');
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR}/three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR}/addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const THREE = await import('three');
const O = await import(`${SRC}/render/outline.js`);
const { inkEdge } = await import(`${SRC}/render/materials.js`);

let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};
const read = (f) => fs.readFileSync(path.join(SRCDIR, f), 'utf8');

/** A unit cube with split vertices (24 vertices, hard edges: each face has its own normals), as a typical low-poly mesh. */
function cube() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  return g;
}

// 1. Smoothed normals.
{
  const g = cube();
  ok(g.attributes.position.count === 24, 'a box has 24 vertices (three per corner: the hard edges split them)');
  const a = O.smoothNormals(g);
  ok(a.count === 24 && a.itemSize === 3 && g.getAttribute('oNormal') === a, 'one smoothed normal per vertex, stored as oNormal');
  // every copy of a corner got the same normal: the diagonal
  const pos = g.attributes.position;
  const byPos = new Map();
  let same = true;
  let unit = true;
  for (let i = 0; i < 24; i++) {
    const k = [pos.getX(i), pos.getY(i), pos.getZ(i)].join(',');
    const v = [a.getX(i), a.getY(i), a.getZ(i)];
    if (Math.abs(Math.hypot(...v) - 1) > 1e-5) unit = false;
    if (byPos.has(k)) {
      const w = byPos.get(k);
      if (Math.hypot(v[0] - w[0], v[1] - w[1], v[2] - w[2]) > 1e-5) same = false;
    } else byPos.set(k, v);
    // a corner of a cube: the diagonal (+-0.577 on each axis)
    if (Math.abs(Math.abs(v[0]) - 0.57735) > 1e-4 || Math.abs(Math.abs(v[1]) - 0.57735) > 1e-4 || Math.abs(Math.abs(v[2]) - 0.57735) > 1e-4) same = false;
  }
  ok(unit && same, 'the vertices that share a position share a unit normal (the corner diagonal): the push-out cannot crack a hard edge');
  ok(O.smoothNormals(g) === a, 'computed once');
  assert.throws(() => O.smoothNormals(new THREE.BufferGeometry()), /position and normal/);
  ok(true, 'a geometry without normals is refused');
}

// 2. One merged geometry for several skinned meshes.
{
  const mk = (n, w) => {
    const g = new THREE.BufferGeometry();
    const p = [];
    const nn = [];
    const si = [];
    const sw = [];
    for (let i = 0; i < n; i++) {
      p.push(i, w, 0);
      nn.push(0, 0, 1);
      si.push(i % 3, 0, 0, 0);
      sw.push(1, 0, 0, 0);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    const idx = [];
    for (let i = 0; i + 2 < n; i++) idx.push(i, i + 1, i + 2);
    g.setIndex(idx);
    return { geometry: g };
  };
  const a = mk(5, 0);
  const b = mk(4, 1);
  const m = O.mergedHullGeometry([a, b]);
  ok(m.attributes.position.count === 9 && m.index.count === (3 + 2) * 3, 'two meshes, one geometry (9 vertices, 5 triangles)');
  const idx = m.index.array;
  ok(idx[9] === 5 && idx[10] === 6 && idx[11] === 7, 'the second mesh\'s indices are offset by the first\'s vertex count');
  ok(m.attributes.skinIndex.getComponent(7, 0) === 2 && m.attributes.skinWeight.getComponent(8, 0) === 1 && !!m.attributes.oNormal, 'skin indices, weights and the smoothed normals survive the merge');
  ok(O.mergedHullGeometry([]) === null, 'nothing to merge = null');
  ok(O.mergedHullGeometry([a]).attributes.position.count === 5, 'one mesh: its own data');
}

// 3. A hull beside its source.
{
  const parent = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial();
  const src = new THREE.Mesh(cube(), mat);
  src.name = 'Tusk';
  src.position.set(1, 2, 3);
  src.scale.set(-1, 1, 1);
  parent.add(src);
  O.setOutlineLook(false, 0.002, new THREE.Color(0.01, 0.01, 0.01));
  const before = O.outlineStats().hulls;
  const hull = O.addOutline(src);
  ok(hull.parent === parent && hull.geometry === src.geometry && hull.name === 'Tusk_Outline', 'the hull is a sibling under the same parent and shares the geometry (a draw range on the source applies to it too)');
  ok(hull.position.equals(src.position) && hull.scale.x === -1, 'it copies the source\'s transform (a mirrored tusk stays mirrored)');
  ok(hull.material.side === THREE.BackSide && hull.material.fog === true && hull.material === O.outlineMaterial(false), 'back faces only, fogged, the shared ink material');
  ok(O.outlineMaterial(true) !== O.outlineMaterial(false) && O.outlineMaterial(true).transparent === true, 'the hands get the transparent-queue twin');
  ok(hull.visible === false && O.outlineStats().hulls === before + 1, 'hidden while the look is off');
  O.setOutlineLook(true, 0.003, new THREE.Color(0.02, 0.0, 0.0));
  ok(hull.visible === true && O.OUTLINE.uW.value === 0.003 && Math.abs(hull.material.color.r - 0.02) < 1e-9, 'on: the hull shows, the width and the ink colour are the preset\'s');
  src.visible = false;
  O.syncOutlines();
  ok(hull.visible === false, 'it follows the source\'s visibility (a hidden mesh has no outline)');
  src.visible = true;
  // several sources: any of them shows it
  const s2 = new THREE.Mesh(cube(), mat);
  parent.add(s2);
  const h2 = O.addOutline([src, s2], { geometry: s2.geometry });
  src.visible = false;
  O.syncOutlines();
  ok(h2.visible === true, 'with several sources (the creature\'s LOD0 and LOD1) it shows while any one does');
  s2.visible = false;
  O.syncOutlines();
  ok(h2.visible === false, 'and hides when none does');
  O.removeOutline(hull);
  O.removeOutline(h2);
  ok(hull.parent === null && O.outlineStats().hulls === before, 'removed from the scene and the registry');
  O.setOutlineLook(false, 0.0026, new THREE.Color(0.012, 0.008, 0.02));
}

// 4. A skinned source shares the skeleton.
{
  const bones = [new THREE.Bone(), new THREE.Bone()];
  bones[0].add(bones[1]);
  const skel = new THREE.Skeleton(bones);
  const g = new THREE.BoxGeometry(1, 1, 1);
  const n = g.attributes.position.count;
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const sm = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
  sm.add(bones[0]);
  sm.bind(skel);
  const parent = new THREE.Group();
  parent.add(sm);
  const hull = O.addOutline(sm, { transparent: true });
  ok(hull.isSkinnedMesh && hull.skeleton === skel && hull.bindMode === sm.bindMode, 'a skinned source: the hull is a skinned mesh on the SAME skeleton (one bone update drives both)');
  ok(hull.material === O.outlineMaterial(true), 'in the hands\' (transparent) queue when asked');
  O.removeOutline(hull);
}

// 5. The vertex shader.
{
  const mat = O.outlineMaterial(false);
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <project_vertex>\n',
    fragmentShader: '',
  };
  mat.onBeforeCompile(shader);
  const v = shader.vertexShader;
  ok(shader.uniforms.uOutlineW === O.OUTLINE.uW, 'the width uniform is the shared one (one write per frame)');
  ok(/attribute vec3 oNormal;/.test(v) && /vec3 objectNormal = vec3\( oNormal \);/.test(v), 'the smoothed normal replaces the vertex normal (and goes through the skinning)');
  ok(v.indexOf('#include <project_vertex>') < v.indexOf('uOutlineW * max('), 'the push-out comes after the projection set mvPosition');
  ok(/mvPosition\.xyz \+= olN \* \( uOutlineW \* max\( - mvPosition\.z, 0\.05 \) \);/.test(v) && /gl_Position = projectionMatrix \* mvPosition;/.test(v), 'pushed out by width x view distance (a constant angle: the same pixels from 1 m to 40 m), then re-projected');
  ok(/#ifdef USE_SKINNING\n\s+vec3 olN = normalize\( transformedNormal \);/.test(v), 'a skinned mesh pushes along the skinned normal');
  ok(mat.customProgramCacheKey() === 'at3d-outline', 'one cache key (the skinned / plain variants are told apart by three itself)');
}

// 6. The edge ink on the masonry.
{
  ok(inkEdge(0, 1) === 1 && inkEdge(0.2, 1) === 1, 'away from the edge the colour is untouched');
  ok(inkEdge(0.5, 1) < 0.08 && inkEdge(1, 1) < 0.08, 'on the edge it is nearly black (the ink)');
  ok(inkEdge(0.5, 0) === 1, 'strength 0 = off');
  let mono = true;
  let prev = 2;
  for (let b = 0; b <= 1.0001; b += 0.01) {
    const x = inkEdge(Math.min(1, b), 1);
    if (x > prev + 1e-12) mono = false;
    prev = x;
  }
  ok(mono, 'the line deepens monotonically toward the edge');
  const mat = read('render/materials.js');
  ok(/INK_EDGE_FRAG = '[^']*smoothstep\( 0\.26, 0\.5, atBev \)/.test(mat) && /GRADE_FRAG\.replace\( ?'\/\*AT_INK\*\/', bevel \? INK_EDGE_FRAG : ''\)/.test(mat.replace(/\s+/g, ' ').replace('GRADE_FRAG.replace(\'/*AT_INK*/\'', 'GRADE_FRAG.replace( \'/*AT_INK*/\'')), 'only the materials that carry the bevel get the edge ink');
  ok(/uniform vec4 uInkK;/.test(mat) && /uInkK: \{ value:/.test(mat), 'the strength is a shared uniform (no recompile)');
}

// 7. The preset and the views.
{
  const r = read('render/renderer3d.js');
  const block = r.slice(r.indexOf('const LOOK_PRESETS = {'), r.indexOf('function lookPreset'));
  const anime = block.slice(block.indexOf('anime:'), block.indexOf('horror:'));
  const rest = block.slice(block.indexOf('horror:'));
  ok(/ink: 1,/.test(anime) && !/ink:/.test(rest), 'only the anime preset has ink (horror and classic are the realistic picture)');
  ok(/inkWidth: 0\.\d+/.test(anime) && /inkColor: \[/.test(anime) && /inkEdge: 0\.\d+/.test(anime), 'the width (an angle), the ink colour and the edge strength are the preset\'s numbers');
  ok(/setOutlineLook\( ?ink > 0 && !lowFx0,/.test(r.replace(/\s+/g, ' ').replace('setOutlineLook(ink', 'setOutlineLook( ink')) || /setOutlineLook\(ink > 0 && !lowFx0,/.test(r), 'the hulls are off in the low tier / with reduced effects');
  ok(/\[\?&\]ink=/.test(r) && /settings\.ink === false/.test(r), '?ink=off and settings.ink = false turn the outlines off');
  ok(/syncOutlines\(\);[^\n]*\n\s*r\.render\(this\.scene, this\.camera\);/.test(r), 'the hulls follow their meshes\' visibility right before every render');
  for (const [file, what] of [
    ['render/handsGear.js', /addOutline\(m, \{ transparent: true \}\)/],
    ['render/bodyView.js', /addOutline\(mesh\)/],
    ['render/masonRigView.js', /addOutline\(sources, \{ geometry: geo \}\)/],
    ['render/mason/masonMandibles.js', /addOutline\(mesh\)/],
    ['render/mason/masonStinger.js', /addOutline\(this\.mesh\)/],
  ]) ok(what.test(read(file)), `${file}: has its outline hull`);
  ok(/mergedHullGeometry\(hullFrom\)/.test(read('render/masonRigView.js')) && /this\.meshes\[1\] !== this\.meshes\[0\] \? this\.meshes\[1\]/.test(read('render/masonRigView.js')), 'the Mason: ONE hull draw call from the cheap LOD1 geometry (not 63 k triangles twice)');
}

console.log(`\n${n} checks passed`);
