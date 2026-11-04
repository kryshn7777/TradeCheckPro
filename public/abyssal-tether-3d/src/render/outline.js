/* ABYSSAL TETHER 3D — render/outline.js
 * Ink outlines for the stylised ("3D anime") look, the classic way: an INVERTED HULL. A second copy of a mesh is drawn with its back faces only,
 * pushed out along the surface normal by a small constant on-screen width and filled with the ink colour; the mesh itself, drawn after it,
 * covers everything but the ring that sticks out past its silhouette, which is the line.
 *
 *   - the width is an ANGLE (the offset is `uW x view distance`), so the line keeps the same thickness in pixels from 1 m to 40 m;
 *   - the push-out uses SMOOTHED normals (averaged over vertices that share a position: `oNormal`), so a hard-edged mesh does not crack open
 *     along its edges;
 *   - skinned meshes share the source's skeleton (same bones, same bind), plain meshes copy its transform; the hull is a sibling under the
 *     same parent and shares the geometry (so a draw range, e.g. the hidden sleeve, applies to it too);
 *   - the ink is fogged like everything else (a far creature's line fades into the haze instead of staying black);
 *   - one extra draw call and one more pass over the geometry per hull: it is only put on the few hero meshes near the camera (the hands, the
 *     launchers, the body, the creatures, the tusks), never on the level; `setOutlineLook` switches the lot off (horror / classic look, the
 *     `low` tier, ?ink=off). The level's masonry gets its lines in its own shader instead (materials.js, the bevel band).
 */
import * as THREE from 'three';

/** Shared uniforms: `uW` the width in radians (x the view distance = the push-out), `ink` the line colour (a straight linear colour). */
export const OUTLINE = {
  uW: { value: 0.0026 },
  ink: new THREE.Color(0.012, 0.008, 0.02),
  on: false,
};

const HULLS = new Set();
const _mats = new Map();

function makeMaterial(transparent) {
  const m = new THREE.MeshBasicMaterial({ color: OUTLINE.ink.clone(), side: THREE.BackSide, fog: true, transparent: !!transparent, depthWrite: true });
  if (transparent) m.forceSinglePass = true; // (the hands' queue: see handsView HANDS_RENDER_ORDER_XR)
  m.name = transparent ? 'at3dOutlineT' : 'at3dOutline';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlineW = OUTLINE.uW;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 oNormal;\nuniform float uOutlineW;')
      // skinned meshes: the smoothed normal goes through the skinning like the real one
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( oNormal );\n#ifdef USE_TANGENT\n  vec3 objectTangent = vec3( tangent.xyz );\n#endif')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
#ifdef USE_SKINNING
  vec3 olN = normalize( transformedNormal );
#else
  vec3 olN = normalize( normalMatrix * oNormal );
#endif
  mvPosition.xyz += olN * ( uOutlineW * max( - mvPosition.z, 0.05 ) );
  gl_Position = projectionMatrix * mvPosition;
}`,
      );
  };
  m.customProgramCacheKey = () => 'at3d-outline';
  return m;
}

/** The shared hull material (opaque queue, or the transparent queue for the hands, which sort after the VR UI). */
export function outlineMaterial(transparent = false) {
  const k = transparent ? 1 : 0;
  if (!_mats.has(k)) _mats.set(k, makeMaterial(transparent));
  return _mats.get(k);
}

/**
 * Adds the smoothed normal attribute `oNormal` to a geometry (once): the average of the vertex normals over every vertex that shares a
 * position (UV seams and hard edges split them), so the push-out moves all the copies of a corner the same way. Returns the attribute.
 */
export function smoothNormals(geometry) {
  const have = geometry.getAttribute('oNormal');
  if (have) return have;
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  if (!pos || !nor) throw new Error('outline: the geometry needs position and normal');
  const n = pos.count;
  const sums = new Map();
  const keys = new Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`;
    keys[i] = k;
    let s = sums.get(k);
    if (!s) {
      s = [0, 0, 0];
      sums.set(k, s);
    }
    s[0] += nor.getX(i);
    s[1] += nor.getY(i);
    s[2] += nor.getZ(i);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = sums.get(keys[i]);
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    out[i * 3] = s[0] / l;
    out[i * 3 + 1] = s[1] / l;
    out[i * 3 + 2] = s[2] / l;
  }
  const attr = new THREE.BufferAttribute(out, 3);
  geometry.setAttribute('oNormal', attr);
  return attr;
}

/**
 * One geometry out of several skinned meshes that share a skeleton (position, skin indices / weights, smoothed normals only, one index): a
 * creature that is drawn as several meshes gets ONE hull draw call. Returns null if there is nothing to merge.
 */
export function mergedHullGeometry(meshes) {
  const parts = [];
  for (const m of meshes) {
    const g = m.geometry;
    if (!g || !g.index || !g.attributes.position) continue;
    smoothNormals(g);
    const p = new THREE.BufferGeometry();
    p.setAttribute('position', g.attributes.position);
    p.setAttribute('normal', g.attributes.normal);
    p.setAttribute('oNormal', g.attributes.oNormal);
    if (g.attributes.skinIndex) {
      p.setAttribute('skinIndex', g.attributes.skinIndex);
      p.setAttribute('skinWeight', g.attributes.skinWeight);
    }
    p.setIndex(g.index);
    parts.push(p);
  }
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  let pos = 0;
  let idx = 0;
  for (const p of parts) {
    pos += p.attributes.position.count;
    idx += p.index.count;
  }
  const skin = !!parts[0].attributes.skinIndex;
  const P = new Float32Array(pos * 3);
  const N = new Float32Array(pos * 3);
  const O = new Float32Array(pos * 3);
  const SI = skin ? new Uint16Array(pos * 4) : null;
  const SW = skin ? new Float32Array(pos * 4) : null;
  const I = new Uint32Array(idx);
  let v = 0;
  let t = 0;
  for (const p of parts) {
    const a = p.attributes;
    const c = a.position.count;
    for (let i = 0; i < c; i++) {
      P[(v + i) * 3] = a.position.getX(i);
      P[(v + i) * 3 + 1] = a.position.getY(i);
      P[(v + i) * 3 + 2] = a.position.getZ(i);
      N[(v + i) * 3] = a.normal.getX(i);
      N[(v + i) * 3 + 1] = a.normal.getY(i);
      N[(v + i) * 3 + 2] = a.normal.getZ(i);
      O[(v + i) * 3] = a.oNormal.getX(i);
      O[(v + i) * 3 + 1] = a.oNormal.getY(i);
      O[(v + i) * 3 + 2] = a.oNormal.getZ(i);
      if (skin) {
        for (let k = 0; k < 4; k++) {
          SI[(v + i) * 4 + k] = a.skinIndex.getComponent(i, k);
          SW[(v + i) * 4 + k] = a.skinWeight.getComponent(i, k);
        }
      }
    }
    for (let i = 0; i < p.index.count; i++) I[t + i] = p.index.getX(i) + v;
    v += c;
    t += p.index.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('oNormal', new THREE.BufferAttribute(O, 3));
  if (skin) {
    g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  }
  g.setIndex(new THREE.BufferAttribute(I, 1));
  return g;
}

/**
 * Puts an outline hull next to `source` (a Mesh or SkinnedMesh; or an array of them: the hull then shows while ANY of them does).
 * opts: { geometry } (a cheaper geometry for the hull, e.g. the creature's LOD1; it needs normals, and for a skinned source the same
 * skin attributes), { transparent } (the hands' queue). Returns the hull mesh.
 */
export function addOutline(source, opts = {}) {
  const sources = Array.isArray(source) ? source : [source];
  const first = sources[0];
  const geometry = opts.geometry || first.geometry;
  smoothNormals(geometry);
  const mat = outlineMaterial(!!opts.transparent);
  let hull;
  if (first.isSkinnedMesh) {
    hull = new THREE.SkinnedMesh(geometry, mat);
    hull.bindMode = first.bindMode;
    hull.bind(first.skeleton, first.bindMatrix);
    hull.boundingSphere = first.boundingSphere || null;
  } else {
    hull = new THREE.Mesh(geometry, mat);
  }
  hull.name = (first.name || 'Mesh') + '_Outline';
  hull.position.copy(first.position);
  hull.quaternion.copy(first.quaternion);
  hull.scale.copy(first.scale);
  hull.frustumCulled = first.frustumCulled;
  hull.renderOrder = first.renderOrder;
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.userData.noShadowCast = true;
  hull.userData.outlineSources = sources;
  hull.visible = OUTLINE.on;
  if (first.parent) first.parent.add(hull);
  HULLS.add(hull);
  return hull;
}

/** Removes a hull (the geometry belongs to the source; the shared material stays). */
export function removeOutline(hull) {
  if (!hull) return;
  HULLS.delete(hull);
  if (hull.parent) hull.parent.remove(hull);
}

/** How many hulls exist / are showing (tests, the budget). */
export function outlineStats() {
  let shown = 0;
  for (const h of HULLS) if (h.visible) shown++;
  return { hulls: HULLS.size, shown };
}

/** Per frame: the look (on / width in radians / ink colour) and every hull's visibility (on, and one of its sources is showing). */
export function setOutlineLook(on, width, ink) {
  OUTLINE.on = !!on;
  if (typeof width === 'number' && isFinite(width)) OUTLINE.uW.value = width;
  if (ink) {
    OUTLINE.ink.copy(ink);
    for (const m of _mats.values()) m.color.copy(OUTLINE.ink);
  }
  syncOutlines();
}

/** Hulls follow their sources' visibility (LOD switches, hidden meshes); call after the views have updated. */
export function syncOutlines() {
  for (const h of HULLS) {
    let vis = false;
    if (OUTLINE.on) {
      for (const s of h.userData.outlineSources) {
        if (s.visible) {
          vis = true;
          break;
        }
      }
    }
    if (h.visible !== vis) h.visible = vis;
  }
}
