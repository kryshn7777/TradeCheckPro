/* ABYSSAL TETHER 3D — creatureView.js
 * CreatureView — renders the Mason from the Blender kit (assets/models/mason_kit.glb)
 * on the simulation's body (Creature3D.body): masonry blocks on the spine,
 * ten lattice-girder legs solved with 2-bone IK to the planted hooks, a crown
 * of sensory fronds that open/curl and sweep toward the player, glowing
 * listening pits, plate jitter while it surges.
 *
 * Load-agnostic and NAME-DRIVEN: the constructor takes the parsed GLTF and
 * looks parts up by node name. Required (any missing part degrades to a
 * stand-in): Mason_Segment_<n> (any number of variants), Mason_Tail, Mason_Head,
 * Mason_Frond_<n>, Mason_Pit, Mason_LimbUpper, Mason_LimbLower, Mason_Hook.
 * Optional extras are used when present: Mason_Jaw (head, opens with the
 * lunge), Mason_Spine (dorsal, one per block), Mason_Membrane (crown, spreads
 * with the fronds), and <Part>_LOD1 variants (a second, cheaper mesh shown when
 * the camera is far). Dimensions come from bounding boxes (segment pitch and
 * width, crown rim, girder joint lengths), never from hard-coded sizes.
 *
 * Draw calls: every part instance is baked into ONE merged geometry and moved
 * as a rigid "bone" of a SkinnedMesh (skin weight 1 on its own bone), so the
 * whole creature — ~65 parts — is 1 draw call per eye (2 if the kit carries
 * its own image textures: one per textured material). Kit materials are
 * folded into vertex attributes (colour, metalness, roughness, emissive); a
 * small per-bone data texture drives glow and frond curl (bent in the vertex
 * shader). Optional masonry / metal / flesh detail textures (assets agent
 * manifest) are applied tri-planar in each part's local space.
 *
 *   const view = new CreatureView(scene, gltf);                 // GLTFLoader result
 *   CreatureView.loadTextures('assets/textures/manifest.json').then((t) => view.setTextures(t));
 *   view.update(creature, dt, camera);                          // camera optional (LOD)
 *   view.info → { drawCalls, triangles, bones, parts, optional, missing, lod1 }
 */

import * as THREE from 'three';

const KIT_REQUIRED = ['Mason_Head', 'Mason_Tail', 'Mason_Pit', 'Mason_LimbUpper', 'Mason_LimbLower', 'Mason_Hook'];
const KIT_OPTIONAL = ['Mason_Jaw', 'Mason_Spine', 'Mason_Membrane'];
const RE_SEGMENT = /^Mason_Segment_(\d+)$/;
const RE_FROND = /^Mason_Frond_(\d+)$/;
const LOD_SUFFIX = '_LOD1';

const DEFAULTS = {
  fronds: 10,
  pits: 5,
  lodDistance: 42, // camera → head distance beyond which the LOD1 mesh shows (when the kit has LOD1 parts)
  hideDistance: 260, // never drawn beyond this (fog has swallowed it long before)
  glowPierce: 0.35, // how much of the sensory glow survives the fog (glints in the dark)
  sightingFogCap: 0.8, // fog never fully swallows the far sighting: a dark silhouette in the haze
  detailTile: 0.5, // detail texture tile = manifest tileMeters × this (in part-local metres)
};

// Texture classes (vertex attribute) → detail texture slots.
const CLS_NONE = 0;
const CLS_STONE = 1;
const CLS_RUST = 2;
const CLS_IRON = 3;
const CLS_FLESH = 4;
function classOf(name) {
  const n = (name || '').toLowerCase();
  if (/stone|masonry|rock|brick/.test(n)) return CLS_STONE;
  if (/rust|verdigris|corrod/.test(n)) return CLS_RUST;
  if (/iron|metal|steel|chain/.test(n)) return CLS_IRON;
  if (/flesh|sinew|membrane|frond|tissue/.test(n)) return CLS_FLESH;
  return CLS_NONE;
}
function baseName(o) {
  return (o.userData && o.userData.name) || o.name || '';
}
function len3(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function hash1(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// =============================================================================
// Kit parsing: one template per part name (geometry folded per batch key)
// =============================================================================

/**
 * Collects every mesh under `node` (but not under nested named kit parts) in
 * node-local space (times an optional canonicalising rotation) and folds the
 * materials into attributes. Returns { batches: {key → chunk}, bbox, maxR, tris }.
 */
function buildTemplate(node, partNames, canon) {
  node.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const bbox = new THREE.Box3();
  const batches = {};
  let maxR = 0;
  let tris = 0;
  const visit = (o) => {
    if (o !== node && partNames.has(baseName(o)) && baseName(o) !== baseName(node)) return; // a nested part is its own template
    if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      m.multiplyMatrices(inv, o.matrixWorld);
      if (canon) m.premultiply(canon);
      nm.getNormalMatrix(m);
      let g = o.geometry;
      if (!g.attributes.normal) {
        g = g.clone();
        g.computeVertexNormals();
      }
      const pos = g.attributes.position;
      const nor = g.attributes.normal;
      const uv = g.attributes.uv || null;
      const index = g.index;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const groups = g.groups && g.groups.length ? g.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
      for (const grp of groups) {
        const mat = mats[grp.materialIndex || 0] || mats[0];
        if (!mat) continue;
        const textured = !!(mat.map && uv);
        const key = textured ? 'tex:' + mat.uuid : 'vc';
        let ch = batches[key];
        if (!ch) {
          ch = batches[key] = { key, material: textured ? mat : null, pos: [], nrm: [], col: [], mat4: [], emit: [], uv: [], idx: [], vcount: 0 };
        }
        const color = mat.color || new THREE.Color(0.1, 0.1, 0.1);
        const emi = mat.emissive ? mat.emissive.clone().multiplyScalar(mat.emissiveIntensity == null ? 1 : mat.emissiveIntensity) : new THREE.Color(0, 0, 0);
        const metal = mat.metalness == null ? 0 : mat.metalness;
        const rough = mat.roughness == null ? 0.85 : mat.roughness;
        const cls = classOf(mat.name);
        // Vertices referenced by this group, remapped into the chunk.
        const remap = new Map();
        const count = grp.count === Infinity ? (index ? index.count : pos.count) - grp.start : grp.count;
        for (let k = 0; k < count; k++) {
          const src = index ? index.getX(grp.start + k) : grp.start + k;
          let dst = remap.get(src);
          if (dst === undefined) {
            dst = ch.vcount++;
            remap.set(src, dst);
            v.fromBufferAttribute(pos, src).applyMatrix4(m);
            n.fromBufferAttribute(nor, src).applyMatrix3(nm).normalize();
            ch.pos.push(v.x, v.y, v.z);
            ch.nrm.push(n.x, n.y, n.z);
            ch.col.push(color.r, color.g, color.b);
            ch.mat4.push(metal, rough, cls, 0);
            ch.emit.push(emi.r, emi.g, emi.b);
            if (uv) ch.uv.push(uv.getX(src), uv.getY(src));
            else ch.uv.push(0, 0);
            bbox.expandByPoint(v);
            maxR = Math.max(maxR, v.length());
          }
          ch.idx.push(dst);
        }
        tris += count / 3;
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(node);
  return { batches, bbox, maxR, tris, empty: bbox.isEmpty() };
}

/** Rotation mapping a part's long axis (by bbox) to +Y and its wider cross axis to +X. */
function canonLongAxis(node, partNames) {
  const t = buildTemplate(node, partNames, null);
  if (t.empty) return null;
  const size = new THREE.Vector3();
  t.bbox.getSize(size);
  const ext = [size.x, size.y, size.z];
  const lo = [t.bbox.min.x, t.bbox.min.y, t.bbox.min.z];
  const hi = [t.bbox.max.x, t.bbox.max.y, t.bbox.max.z];
  let a = 0;
  if (ext[1] > ext[a]) a = 1;
  if (ext[2] > ext[a]) a = 2;
  const sgn = Math.abs(hi[a]) >= Math.abs(lo[a]) ? 1 : -1;
  const others = [0, 1, 2].filter((i) => i !== a);
  const b = ext[others[0]] >= ext[others[1]] ? others[0] : others[1];
  const eLong = new THREE.Vector3().setComponent(a, sgn);
  const eB = new THREE.Vector3().setComponent(b, 1);
  const eC = new THREE.Vector3().crossVectors(eB, eLong);
  // Rows (eB, eLong, eB×eLong): a proper rotation taking eLong → +Y, eB → +X.
  return new THREE.Matrix4().set(eB.x, eB.y, eB.z, 0, eLong.x, eLong.y, eLong.z, 0, eC.x, eC.y, eC.z, 0, 0, 0, 0, 1);
}

/** Simple stand-in geometry (a box or a bar) when the kit lacks a part. */
function standInTemplate(kind) {
  let g;
  if (kind === 'bone') {
    g = new THREE.BoxGeometry(0.35, 3.3, 0.18);
    g.translate(0, 1.65, 0);
  } else if (kind === 'frond') {
    g = new THREE.CylinderGeometry(0.02, 0.07, 1.8, 6);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, -0.9);
  } else if (kind === 'small') {
    g = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  } else if (kind === 'hook') {
    g = new THREE.ConeGeometry(0.1, 0.8, 6);
    g.translate(0, 0.4, 0);
  } else {
    g = new THREE.BoxGeometry(1.8, 1.4, 1.3);
  }
  const mat = new THREE.MeshStandardMaterial({
    name: kind === 'frond' ? 'Mason_Frond' : kind === 'small' ? 'Mason_SensoryGlow' : kind === 'bone' || kind === 'hook' ? 'Mason_Rust' : 'Mason_StoneMid',
    color: kind === 'frond' ? 0x9ea89a : kind === 'bone' || kind === 'hook' ? 0x43251a : 0x27251f,
    emissive: kind === 'small' ? 0xb8f0e0 : 0x000000,
    emissiveIntensity: kind === 'small' ? 4 : 1,
    roughness: 0.85,
    metalness: kind === 'bone' || kind === 'hook' ? 0.5 : 0,
  });
  const mesh = new THREE.Mesh(g, mat);
  const holder = new THREE.Group();
  holder.add(mesh);
  return buildTemplate(holder, new Set(), null);
}

// =============================================================================
// Shader patch (shared by every batch material)
// =============================================================================

function patchMasonMaterial(mat, uniforms, opts) {
  const vertexOverrides = opts.vertexMaterial;
  // Shared uniform holder, visible to Renderer3D.precompile(), which uploads the
  // detail textures on the menu instead of on the creature's first sighting.
  mat.userData.masonUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // Use the renderer's fog curve when it installed one (materials.js installRadialFog).
    const fogExpr = /atFogFactor/.test(THREE.ShaderChunk.fog_pars_fragment)
      ? 'float mFog = atFogFactor( vFogDepth );'
      : `#ifdef FOG_EXP2
  float mFog = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
  float mFog = smoothstep( fogNear, fogFar, vFogDepth );
  #endif`;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aMat;   // metalness, roughness, detail class, frond bend flag
attribute vec3 aEmit;  // emissive radiance (colour × strength)
uniform sampler2D uPartTex; // per bone: x glow, y curl (rad), z bend length, w unused
varying vec4 vMat;
varying vec3 vEmit;
varying vec3 vTriPos;
varying vec3 vTriNrm;
vec4 masonPart() {
#ifdef USE_SKINNING
  return texelFetch( uPartTex, ivec2( int( skinIndex.x + 0.5 ), 0 ), 0 );
#else
  return vec4( 1.0, 0.0, 1.0, 0.0 );
#endif
}
vec3 masonBend( vec3 p, vec3 ref, vec4 part ) {
  float s = clamp( length( ref ) / max( part.z, 1e-3 ), 0.0, 1.0 );
  float a = part.y * s * s;
  float c = cos( a );
  float sn = sin( a );
  return vec3( p.x, c * p.y - sn * p.z, sn * p.y + c * p.z );
}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
vec4 mPart = masonPart();
if ( aMat.w > 0.5 ) objectNormal = masonBend( objectNormal, position, mPart );
vec3 mLocalN = objectNormal; // part-local (skinning rotates objectNormal next)`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
if ( aMat.w > 0.5 ) transformed = masonBend( transformed, position, mPart );
vMat = aMat;
vEmit = aEmit * mPart.x;
vTriPos = transformed;
vTriNrm = mLocalN;`,
      );
    let frag = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform sampler2D uTexStone;
uniform sampler2D uTexRust;
uniform sampler2D uTexIron;
uniform sampler2D uTexFlesh;
uniform vec4 uTexOn;    // detail texture present per class (stone, rust, iron, flesh)
uniform vec4 uTexScale; // tiles per local metre per class
uniform vec4 uTexGain;  // 1 / mean albedo per class (keeps the kit's tone)
uniform float uGlowPierce;
uniform float uFogCap;
varying vec4 vMat;
varying vec3 vEmit;
varying vec3 vTriPos;
varying vec3 vTriNrm;
vec3 masonTri( sampler2D t, vec3 p, vec3 n, float sc ) {
  vec3 w = pow( abs( normalize( n ) ), vec3( 4.0 ) );
  w /= ( w.x + w.y + w.z + 1e-5 );
  return texture( t, p.zy * sc ).rgb * w.x + texture( t, p.xz * sc ).rgb * w.y + texture( t, p.xy * sc ).rgb * w.z;
}`,
    );
    frag = frag.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
{
  float mCls = floor( vMat.z + 0.5 );
  if ( mCls > 0.5 ) {
    if ( mCls < 1.5 ) { if ( uTexOn.x > 0.5 ) diffuseColor.rgb *= masonTri( uTexStone, vTriPos, vTriNrm, uTexScale.x ) * uTexGain.x; }
    else if ( mCls < 2.5 ) { if ( uTexOn.y > 0.5 ) diffuseColor.rgb *= masonTri( uTexRust, vTriPos, vTriNrm, uTexScale.y ) * uTexGain.y; }
    else if ( mCls < 3.5 ) { if ( uTexOn.z > 0.5 ) diffuseColor.rgb *= masonTri( uTexIron, vTriPos, vTriNrm, uTexScale.z ) * uTexGain.z; }
    else if ( uTexOn.w > 0.5 ) diffuseColor.rgb *= vec3( dot( masonTri( uTexFlesh, vTriPos, vTriNrm, uTexScale.w ), vec3( 0.2126, 0.7152, 0.0722 ) ) ) * uTexGain.w;
  }
}`,
    );
    if (vertexOverrides) {
      frag = frag
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp( vMat.y, 0.04, 1.0 );')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = clamp( vMat.x, 0.0, 1.0 );');
    }
    frag = frag
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vEmit;')
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
vec3 mPreFog = gl_FragColor.rgb;
#endif
#include <fog_fragment>
#ifdef USE_FOG
{
  ${fogExpr}
  // Capped fog keeps a dark silhouette against the haze (the far sighting);
  // the sensory glow pierces the fog a little (glints in the dark).
  gl_FragColor.rgb = mix( mPreFog, fogColor, min( mFog, uFogCap ) ) + vEmit * uGlowPierce * mFog;
}
#endif`,
      );
    shader.fragmentShader = frag;
  };
  mat.customProgramCacheKey = () => 'mason-view-v2-' + (vertexOverrides ? 'vc' : 'tex') + (/atFogFactor/.test(THREE.ShaderChunk.fog_pars_fragment) ? '-rf' : '');
}

// =============================================================================
// CreatureView
// =============================================================================

export class CreatureView {
  /**
   * @param {THREE.Object3D} scene  parent to add the creature to
   * @param {object|THREE.Object3D} kitGltf  GLTFLoader result ({scene}) or a root Object3D
   * @param {object} [options]  { fronds, pits, lodDistance, hideDistance, glowPierce, textures }
   */
  constructor(scene, kitGltf, options) {
    this.opts = Object.assign({}, DEFAULTS, options || {});
    this.scene = scene || null;
    this.root = new THREE.Group();
    this.root.name = 'MasonView';
    this.root.visible = false;
    this.info = { drawCalls: 0, triangles: 0, bones: 0, parts: {}, optional: [], missing: [], lod1: false, ignored: [] };
    this._time = 0;

    const kitRoot = kitGltf ? kitGltf.scene || kitGltf.scenes?.[0] || (kitGltf.isObject3D ? kitGltf : null) : null;
    const nodes = this._collectNodes(kitRoot);
    this._buildTemplates(nodes);
    this._buildRig();
    this._buildMeshes();
    if (this.opts.textures) this.setTextures(this.opts.textures);
    if (this.scene) this.scene.add(this.root);
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /**
   * Named kit nodes. GLTFLoader keeps a node's original name in userData.name
   * (primitive meshes under a multi-material node only get uniquified names),
   * so those are preferred; plain Object3D roots fall back to .name.
   */
  _collectNodes(root) {
    const nodes = new Map();
    if (!root) return nodes;
    root.updateMatrixWorld(true);
    let gltfNames = false;
    root.traverse((o) => {
      if (o.userData && typeof o.userData.name === 'string') gltfNames = true;
    });
    root.traverse((o) => {
      const name = gltfNames ? o.userData && o.userData.name : o.name;
      if (typeof name !== 'string' || !/^Mason_/.test(name) || nodes.has(name)) return;
      nodes.set(name, o);
    });
    return nodes;
  }

  /** Is this a kit part name we place (incl. its LOD1 twin)? */
  _isPartName(name) {
    const n = name.endsWith(LOD_SUFFIX) ? name.slice(0, -LOD_SUFFIX.length) : name;
    return RE_SEGMENT.test(n) || RE_FROND.test(n) || KIT_REQUIRED.includes(n) || KIT_OPTIONAL.includes(n);
  }

  _buildTemplates(nodes) {
    // Only recognised part nodes delimit templates (a nested part is its own template).
    const names = new Set([...nodes.keys()].filter((k) => this._isPartName(k)));
    const info = this.info;
    const tpl = (name, canon) => {
      const node = nodes.get(name);
      if (!node) return null;
      const t = buildTemplate(node, names, canon || null);
      return t.empty ? null : t;
    };
    const variants = (re) =>
      [...nodes.keys()]
        .filter((k) => re.test(k))
        .sort((a, b) => +a.match(re)[1] - +b.match(re)[1]);

    const segNames = variants(RE_SEGMENT);
    const frondNames = variants(RE_FROND);
    const T = (this.T = { lod0: {}, lod1: {} });
    const put = (role, name, canonFor, standIn) => {
      let t = name ? tpl(name, canonFor && nodes.get(name) ? canonLongAxis(nodes.get(name), names) : null) : null;
      if (!t) {
        info.missing.push(name || role);
        t = standInTemplate(standIn);
        t.standIn = true;
      } else info.parts[role] = name;
      T.lod0[role] = t;
      const ln = name ? name + LOD_SUFFIX : null;
      if (ln && nodes.has(ln)) {
        const t1 = tpl(ln, canonFor ? canonLongAxis(nodes.get(ln), names) : null);
        if (t1) {
          T.lod1[role] = t1;
          info.lod1 = true;
        }
      }
    };
    if (segNames.length === 0) segNames.push(null);
    segNames.forEach((n, i) => put('seg' + i, n, false, 'block'));
    this.segVariants = segNames.length;
    put('tail', 'Mason_Tail', false, 'block');
    put('head', 'Mason_Head', false, 'block');
    if (frondNames.length === 0) frondNames.push(null);
    frondNames.forEach((n, i) => put('frond' + i, n, false, 'frond'));
    this.frondVariants = frondNames.length;
    put('pit', 'Mason_Pit', false, 'small');
    put('upper', 'Mason_LimbUpper', true, 'bone');
    put('lower', 'Mason_LimbLower', true, 'bone');
    put('hook', 'Mason_Hook', false, 'hook');
    for (const name of KIT_OPTIONAL) {
      if (!nodes.has(name)) continue;
      const role = name.slice(6).toLowerCase(); // jaw | spine | membrane
      put(role, name, false, 'small');
      info.optional.push(name);
    }
    for (const k of nodes.keys()) if (!this._isPartName(k)) info.ignored.push(k);
    // The tail falls back to the last block variant, the head to a scaled block.
    if (T.lod0.tail.standIn && !T.lod0.seg0.standIn) T.lod0.tail = T.lod0['seg' + (this.segVariants - 1)];
    if (T.lod0.head.standIn && !T.lod0.seg0.standIn) T.lod0.head = T.lod0.seg0;

    // ---- dimensions from bounding boxes ----
    const sb = T.lod0.seg0.bbox;
    this.dim = {
      segLen: Math.max(0.2, sb.max.z - sb.min.z), // spine runs along local -Z (toward the head)
      segHalfW: Math.max(0.1, Math.max(-sb.min.x, sb.max.x)),
      segBelly: Math.max(0.1, -sb.min.y),
      headFront: Math.max(0.1, -T.lod0.head.bbox.min.z),
      headBack: Math.max(0.1, T.lod0.head.bbox.max.z),
      headRim: Math.max(0.1, Math.min(Math.max(-T.lod0.head.bbox.min.x, T.lod0.head.bbox.max.x), Math.max(-T.lod0.head.bbox.min.y, T.lod0.head.bbox.max.y))),
      // The kit's tail is modelled smaller than a block: undo that so it matches the taper.
      tailRatio: clamp(Math.max(-T.lod0.tail.bbox.min.x, T.lod0.tail.bbox.max.x) / Math.max(0.1, Math.max(-sb.min.x, sb.max.x)), 0.3, 1.5),
      upperLen: this._jointLen(T.lod0.upper),
      lowerLen: this._jointLen(T.lod0.lower),
      frondLen: [],
    };
    for (let i = 0; i < this.frondVariants; i++) this.dim.frondLen.push(Math.max(0.2, T.lod0['frond' + i].maxR));
  }

  /** Joint-to-joint length of a canonical girder (+Y): bbox top minus the pin overhang. */
  _jointLen(t) {
    const b = t.bbox;
    const pin = Math.min(b.max.z - b.min.z, b.max.x - b.min.x) * 0.5;
    return Math.max(0.3, b.max.y - Math.min(pin, b.max.y * 0.1));
  }

  /** Bone layout: one rigid bone per placed part instance. */
  _buildRig() {
    const o = this.opts;
    const list = [];
    const add = (role, kind, extra) => {
      const b = Object.assign({ role, kind, index: list.length }, extra || {});
      list.push(b);
      return b;
    };
    this.SEG = 20;
    this.bSpine = [];
    for (let i = 0; i < this.SEG; i++) {
      let role;
      if (i === 0) role = 'head';
      else if (i === this.SEG - 1) role = 'tail';
      else role = 'seg' + Math.floor(hash1(i * 7 + 3) * this.segVariants);
      this.bSpine.push(add(role, i === 0 ? 'head' : 'seg', { i }));
    }
    this.bFronds = [];
    for (let k = 0; k < o.fronds; k++) {
      // Irregular crown: uneven spacing, lengths and lean (never a tidy star).
      this.bFronds.push(
        add('frond' + Math.floor(hash1(k * 5 + 1) * this.frondVariants), 'frond', {
          k,
          phase: hash1(k + 11) * 6.283,
          ang: ((k + (hash1(k + 23) - 0.5) * 0.55) / o.fronds) * Math.PI * 2 + 0.2,
          len: 0.72 + 0.5 * hash1(k + 37),
          lean: (hash1(k + 41) - 0.5) * 0.5,
          curl0: (hash1(k + 53) - 0.5) * 0.7,
        }),
      );
    }
    this.bPits = [];
    for (let k = 0; k < o.pits; k++) this.bPits.push(add('pit', 'pit', { k }));
    this.bLimbs = [];
    for (let k = 0; k < 10; k++) {
      this.bLimbs.push({ upper: add('upper', 'upper', { k }), lower: add('lower', 'lower', { k }), hook: add('hook', 'hook', { k }) });
    }
    this.bExtra = [];
    if (this.T.lod0.jaw) this.bExtra.push(add('jaw', 'jaw'));
    if (this.T.lod0.membrane) this.bExtra.push(add('membrane', 'membrane'));
    if (this.T.lod0.spine) for (let i = 1; i < this.SEG - 1; i++) this.bExtra.push(add('spine', 'spine', { i }));
    this.bones = list;
    this.info.bones = list.length;
  }

  _buildMeshes() {
    const NB = this.bones.length;
    // Rig: plain Bones (never added to the scene); their matrixWorld is written directly.
    this._boneObjs = [];
    const inv = [];
    for (let i = 0; i < NB; i++) {
      const b = new THREE.Bone();
      b.matrixAutoUpdate = false;
      b.matrixWorldAutoUpdate = false;
      this._boneObjs.push(b);
      inv.push(new THREE.Matrix4());
    }
    this.skeleton = new THREE.Skeleton(this._boneObjs, inv);
    // Per-bone data (glow, curl, bend length).
    this._partData = new Float32Array(NB * 4);
    this._partTex = new THREE.DataTexture(this._partData, NB, 1, THREE.RGBAFormat, THREE.FloatType);
    this._partTex.minFilter = THREE.NearestFilter;
    this._partTex.magFilter = THREE.NearestFilter;
    this._partTex.generateMipmaps = false;
    this._partTex.needsUpdate = true;
    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
    this.uniforms = {
      uPartTex: { value: this._partTex },
      uTexStone: { value: white },
      uTexRust: { value: white },
      uTexIron: { value: white },
      uTexFlesh: { value: white },
      uTexOn: { value: new THREE.Vector4(0, 0, 0, 0) },
      uTexScale: { value: new THREE.Vector4(0.5, 0.5, 1, 1) },
      uTexGain: { value: new THREE.Vector4(1, 1, 1, 1) },
      uGlowPierce: { value: this.opts.glowPierce },
      uFogCap: { value: 1 },
    };
    this._white = white;
    this.lods = [this._buildLod(this.T.lod0, 'lod0')];
    if (this.info.lod1) {
      const merged = Object.assign({}, this.T.lod0, this.T.lod1);
      this.lods.push(this._buildLod(merged, 'lod1'));
    }
    this._lod = 0;
    for (const l of this.lods) for (const m of l.meshes) this.root.add(m);
    this.lods.forEach((l, i) => l.meshes.forEach((m) => (m.visible = i === 0)));
    this.info.drawCalls = this.lods[0].meshes.length;
    this.info.triangles = this.lods[0].tris;
    if (this.lods[1]) this.info.trianglesLod1 = this.lods[1].tris;
    this._sphere = new THREE.Sphere(new THREE.Vector3(), 30);
    // Initial pose so nothing renders at the origin before the first update.
    for (let i = 0; i < NB; i++) this._boneObjs[i].matrixWorld.identity();
  }

  /** Merges every bone's part template into one geometry per batch key. */
  _buildLod(templates, label) {
    const batches = new Map();
    for (const b of this.bones) {
      const t = templates[b.role];
      if (!t) continue;
      for (const key of Object.keys(t.batches)) {
        const ch = t.batches[key];
        let acc = batches.get(key);
        if (!acc) {
          acc = { key, material: ch.material, chunks: [], vcount: 0, icount: 0 };
          batches.set(key, acc);
        }
        acc.chunks.push({ ch, bone: b.index, bend: b.kind === 'frond' ? 1 : 0 });
        acc.vcount += ch.vcount;
        acc.icount += ch.idx.length;
      }
    }
    const meshes = [];
    let tris = 0;
    for (const acc of batches.values()) {
      const V = acc.vcount;
      const pos = new Float32Array(V * 3);
      const nrm = new Float32Array(V * 3);
      const col = new Float32Array(V * 3);
      const mat4 = new Float32Array(V * 4);
      const emit = new Float32Array(V * 3);
      const uv = acc.material ? new Float32Array(V * 2) : null;
      const si = new Uint16Array(V * 4);
      const sw = new Float32Array(V * 4);
      const idx = V > 65535 ? new Uint32Array(acc.icount) : new Uint16Array(acc.icount);
      let vo = 0;
      let io = 0;
      for (const { ch, bone, bend } of acc.chunks) {
        pos.set(ch.pos, vo * 3);
        nrm.set(ch.nrm, vo * 3);
        col.set(ch.col, vo * 3);
        emit.set(ch.emit, vo * 3);
        if (uv) uv.set(ch.uv, vo * 2);
        for (let k = 0; k < ch.vcount; k++) {
          mat4[(vo + k) * 4] = ch.mat4[k * 4];
          mat4[(vo + k) * 4 + 1] = ch.mat4[k * 4 + 1];
          mat4[(vo + k) * 4 + 2] = ch.mat4[k * 4 + 2];
          mat4[(vo + k) * 4 + 3] = bend;
          si[(vo + k) * 4] = bone;
          sw[(vo + k) * 4] = 1;
        }
        for (let k = 0; k < ch.idx.length; k++) idx[io + k] = ch.idx[k] + vo;
        vo += ch.vcount;
        io += ch.idx.length;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aMat', new THREE.BufferAttribute(mat4, 4));
      g.setAttribute('aEmit', new THREE.BufferAttribute(emit, 3));
      if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); // never used (mesh sphere below)
      let material;
      if (acc.material) {
        material = acc.material.clone();
        material.emissive = new THREE.Color(0, 0, 0);
        material.vertexColors = false;
        patchMasonMaterial(material, this.uniforms, { vertexMaterial: false });
      } else {
        material = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 1, emissive: 0x000000, name: 'MasonView' });
        patchMasonMaterial(material, this.uniforms, { vertexMaterial: true });
      }
      const mesh = new THREE.SkinnedMesh(g, material);
      mesh.name = 'Mason_' + label + '_' + (acc.material ? 'tex' : 'vc');
      mesh.bind(this.skeleton, new THREE.Matrix4());
      mesh.frustumCulled = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      meshes.push(mesh);
      tris += idx.length / 3;
    }
    for (const m of meshes) m.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30);
    return { meshes, tris };
  }

  // ---------------------------------------------------------------------------
  // Textures
  // ---------------------------------------------------------------------------

  /**
   * Detail textures. Accepts the manifest-loader shape { masonry|rock|stone: {map, tileMeters},
   * metal|iron|rust: {...}, flesh: {...} } (materials.js loadTextureManifest() output works too).
   * Missing entries simply leave that class untextured.
   */
  setTextures(sets) {
    if (!sets || typeof sets !== 'object') return;
    const pick = (...keys) => {
      for (const k of keys) if (sets[k] && sets[k].map) return sets[k];
      return null;
    };
    const slots = [
      ['uTexStone', 'x', pick('stone', 'masonry', 'rock')],
      ['uTexRust', 'y', pick('rust', 'metal', 'iron')],
      ['uTexIron', 'z', pick('iron', 'metal', 'rust')],
      ['uTexFlesh', 'w', pick('flesh', 'sinew')],
    ];
    const U = this.uniforms;
    for (const [uni, c, s] of slots) {
      if (!s) continue;
      U[uni].value = s.map;
      U.uTexOn.value[c] = 1;
      const tile = Math.max(0.25, (Number(s.tileMeters) || 4) * this.opts.detailTile);
      U.uTexScale.value[c] = 1 / tile;
      U.uTexGain.value[c] = 1 / Math.max(0.05, s.mean || meanLuma(s.map));
    }
  }

  /**
   * Loads the assets agent's manifest ({ "<set>": { albedo, normal, orm, tileMeters } }).
   * Resolves to sets for setTextures(), or null (never rejects).
   */
  static async loadTextures(manifestUrl = 'assets/textures/manifest.json') {
    try {
      if (typeof fetch !== 'function') return null;
      const res = await fetch(manifestUrl, { cache: 'no-cache' });
      if (!res.ok) return null;
      const manifest = await res.json();
      const sets = manifest && manifest.sets ? manifest.sets : manifest;
      const base = manifestUrl.replace(/[^/]*$/, '');
      const loader = new THREE.TextureLoader();
      const out = {};
      const want = { masonry: ['masonry', 'stone', 'rock'], metal: ['metal', 'iron', 'rust'], flesh: ['flesh', 'sinew'] };
      await Promise.all(
        Object.keys(want).map(async (role) => {
          const name = want[role].find((n) => sets[n]);
          if (!name) return;
          const s = sets[name];
          const rel = s.albedo || s.map || s.color || s.diffuse;
          if (!rel) return;
          const map = await new Promise((resolve) => loader.load(/^(https?:|data:|blob:|\/)/.test(rel) ? rel : base + rel, resolve, undefined, () => resolve(null)));
          if (!map) return;
          map.colorSpace = THREE.SRGBColorSpace;
          map.wrapS = THREE.RepeatWrapping;
          map.wrapT = THREE.RepeatWrapping;
          map.anisotropy = 2;
          out[role] = { map, tileMeters: Number(s.tileMeters) || 4, mean: meanLuma(map) };
        }),
      );
      return Object.keys(out).length ? out : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------

  /**
   * Poses every part from creature.body. Allocation-free.
   * @param {Creature3D} creature
   * @param {number} dt
   * @param {THREE.Camera} [camera]  for LOD selection / distance hiding
   */
  update(creature, dt, camera) {
    const B = creature && creature.body;
    if (!B || !B.visible || creature.active === false) {
      this.root.visible = false;
      return;
    }
    this._time += dt > 0 ? Math.min(dt, 0.1) : 0;
    const t = this._time;
    const sp = B.spine;
    const SEG = Math.min(this.SEG, (sp.length / 3) | 0);
    const tune = (creature.constructor && creature.constructor.TUNING) || {};
    const spacing = tune.spacing || 1.5;
    const D = this.dim;
    const kBase = spacing / (D.segLen * 0.86);
    this._kBase = kBase;

    // Distance culling / LOD.
    let camD = 0;
    if (camera) {
      camera.getWorldPosition(_v0);
      camD = len3(_v0.x - sp[0], _v0.y - sp[1], _v0.z - sp[2]);
      if (camD > this.opts.hideDistance) {
        this.root.visible = false;
        return;
      }
    }
    this.root.visible = true;
    const lod = this.lods.length > 1 && camD > this.opts.lodDistance ? 1 : 0;
    if (lod !== this._lod) {
      this.lods.forEach((l, i) => l.meshes.forEach((m) => (m.visible = i === lod)));
      this._lod = lod;
      this.info.drawCalls = this.lods[lod].meshes.length;
    }

    // The far sighting reads as a dark silhouette with glinting pits, not a fogged-out blur.
    const sighting = !!creature.sighting;
    this.uniforms.uFogCap.value = sighting ? this.opts.sightingFogCap : 1;
    this.uniforms.uGlowPierce.value = sighting ? 1 : this.opts.glowPierce;
    const PD = this._partData;
    const jit = B.jitter || 0;
    const jitPhase = Math.floor(t * 24);
    // ---- spine frames ----
    const F = this._frames || (this._frames = new Float32Array(this.SEG * 12));
    for (let i = 0; i < SEG; i++) {
      let fx;
      let fy;
      let fz;
      if (i === 0) {
        fx = B.head.fx;
        fy = B.head.fy;
        fz = B.head.fz;
      } else {
        const a = i - 1;
        const c = Math.min(SEG - 1, i + 1);
        fx = sp[a * 3] - sp[c * 3];
        fy = sp[a * 3 + 1] - sp[c * 3 + 1];
        fz = sp[a * 3 + 2] - sp[c * 3 + 2];
      }
      let l = len3(fx, fy, fz) || 1;
      fx /= l;
      fy /= l;
      fz /= l;
      let ux = i === 0 ? B.head.ux : B.up[i * 3];
      let uy = i === 0 ? B.head.uy : B.up[i * 3 + 1];
      let uz = i === 0 ? B.head.uz : B.up[i * 3 + 2];
      const d = ux * fx + uy * fy + uz * fz;
      ux -= fx * d;
      uy -= fy * d;
      uz -= fz * d;
      l = len3(ux, uy, uz);
      if (l < 1e-4) {
        ux = Math.abs(fy) < 0.9 ? 0 : 1;
        uy = Math.abs(fy) < 0.9 ? 1 : 0;
        uz = 0;
        const d2 = ux * fx + uy * fy + uz * fz;
        ux -= fx * d2;
        uy -= fy * d2;
        uz -= fz * d2;
        l = len3(ux, uy, uz) || 1;
      }
      ux /= l;
      uy /= l;
      uz /= l;
      const o = i * 12;
      F[o] = i === 0 ? B.head.x : sp[i * 3];
      F[o + 1] = i === 0 ? B.head.y : sp[i * 3 + 1];
      F[o + 2] = i === 0 ? B.head.z : sp[i * 3 + 2];
      F[o + 3] = fx;
      F[o + 4] = fy;
      F[o + 5] = fz;
      F[o + 6] = ux;
      F[o + 7] = uy;
      F[o + 8] = uz;
      // right = forward × up
      F[o + 9] = fy * uz - fz * uy;
      F[o + 10] = fz * ux - fx * uz;
      F[o + 11] = fx * uy - fy * ux;
    }

    // ---- blocks, head, tail ----
    for (let i = SEG; i < this.SEG; i++) this._hideBone(this.bSpine[i].index);
    for (let i = 0; i < SEG; i++) {
      const b = this.bSpine[i];
      const o = i * 12;
      const sc = (kBase * (B.scale ? B.scale[i] : 1)) / (i === SEG - 1 ? D.tailRatio : 1);
      let px = F[o];
      let py = F[o + 1];
      let pz = F[o + 2];
      if (jit > 0.01 && i > 0) {
        // Plates grind against each other while it surges.
        const h1 = hash1(jitPhase * 131 + i * 17) - 0.5;
        const h2 = hash1(jitPhase * 71 + i * 29) - 0.5;
        const a = jit * 0.09 * sc;
        px += (F[o + 9] * h1 + F[o + 6] * h2) * a;
        py += (F[o + 10] * h1 + F[o + 7] * h2) * a;
        pz += (F[o + 11] * h1 + F[o + 8] * h2) * a;
      }
      // Kit frame: local -Z = forward, +Y = dorsal up, +X = right.
      this._setBone(b.index, px, py, pz, F[o + 9], F[o + 10], F[o + 11], F[o + 6], F[o + 7], F[o + 8], -F[o + 3], -F[o + 4], -F[o + 5], sc, sc, sc);
      PD[b.index * 4] = 1;
    }

    // ---- crown: fronds + pits ----
    const ho = 0;
    const kHead = kBase;
    const fx = F[ho + 3];
    const fy = F[ho + 4];
    const fz = F[ho + 5];
    const ux = F[ho + 6];
    const uy = F[ho + 7];
    const uz = F[ho + 8];
    const rx = F[ho + 9];
    const ry = F[ho + 10];
    const rz = F[ho + 11];
    const open = clamp(B.frondOpen == null ? 0.5 : B.frondOpen, 0, 1);
    const glow = clamp(B.glow == null ? 0.3 : B.glow, 0, 1);
    const lunge = clamp(B.lunge || 0, 0, 1);
    const front = D.headFront * kHead * 0.82;
    const cx = F[ho] + fx * front;
    const cy = F[ho + 1] + fy * front;
    const cz = F[ho + 2] + fz * front;
    const rim = D.headRim * kHead * 0.62;
    // Focus: direction from the crown toward the player.
    const foc = B.focus || null;
    let qx = 0;
    let qy = 0;
    let qz = 0;
    let qa = 0;
    if (foc) {
      qx = foc.x - cx;
      qy = foc.y - cy;
      qz = foc.z - cz;
      const ql = len3(qx, qy, qz);
      if (ql > 1e-3) {
        qx /= ql;
        qy /= ql;
        qz /= ql;
        qa = clamp(foc.amount || 0, 0, 1);
      }
    }
    const NF = this.bFronds.length;
    for (let k = 0; k < NF; k++) {
      const b = this.bFronds[k];
      const ca = Math.cos(b.ang);
      const sa = Math.sin(b.ang);
      const radx = rx * ca + ux * sa;
      const rady = ry * ca + uy * sa;
      const radz = rz * ca + uz * sa;
      // Closed: bundled forward. Open: splayed out and swept back like an opening crown.
      const sway = Math.sin(t * (0.7 + 0.13 * k) + b.phase) * 0.22 * (1 - qa) + b.lean;
      const fw = 0.95 - 0.75 * open + 0.25 * lunge;
      const rw = 0.35 + 0.9 * open;
      let ox = fx * fw + radx * rw + (rx * -sa + ux * ca) * sway;
      let oy = fy * fw + rady * rw + (ry * -sa + uy * ca) * sway;
      let oz = fz * fw + radz * rw + (rz * -sa + uz * ca) * sway;
      let ol = len3(ox, oy, oz) || 1;
      ox /= ol;
      oy /= ol;
      oz /= ol;
      if (qa > 0) {
        const s = qa * 0.55;
        ox += (qx - ox) * s;
        oy += (qy - oy) * s;
        oz += (qz - oz) * s;
        ol = len3(ox, oy, oz) || 1;
        ox /= ol;
        oy /= ol;
        oz /= ol;
      }
      // Curl reference: outward and back toward the body.
      let cvx = radx - fx * 0.6;
      let cvy = rady - fy * 0.6;
      let cvz = radz - fz * 0.6;
      const cd = cvx * ox + cvy * oy + cvz * oz;
      cvx -= ox * cd;
      cvy -= oy * cd;
      cvz -= oz * cd;
      let cl = len3(cvx, cvy, cvz);
      if (cl < 1e-4) {
        cvx = ux;
        cvy = uy;
        cvz = uz;
        cl = 1;
      }
      cvx /= cl;
      cvy /= cl;
      cvz /= cl;
      // Local: -Z = growth (out), +Y = curl side, X = Y × Z.
      const Zx = -ox;
      const Zy = -oy;
      const Zz = -oz;
      const Xx = cvy * Zz - cvz * Zy;
      const Xy = cvz * Zx - cvx * Zz;
      const Xz = cvx * Zy - cvy * Zx;
      const s = kHead * b.len * (0.8 + 0.3 * open + 0.15 * lunge);
      this._setBone(b.index, cx + radx * rim, cy + rady * rim, cz + radz * rim, Xx, Xy, Xz, cvx, cvy, cvz, Zx, Zy, Zz, s, s, s);
      const flick = 0.72 + 0.28 * Math.sin(t * (4.3 + k * 0.9) + b.phase * 3);
      const writhe = 0.28 * Math.sin(t * 1.3 + b.phase) * (1 - qa * 0.6);
      const p = b.index * 4;
      PD[p] = 0.3 + 1.1 * glow * flick;
      PD[p + 1] = (open - 0.45) * 0.9 + writhe + lunge * 0.35 + b.curl0; // + = curls more
      PD[p + 2] = D.frondLen[k % this.frondVariants];
    }
    const NP = this.bPits.length;
    for (let k = 0; k < NP; k++) {
      const b = this.bPits[k];
      const ang = ((k + 0.37) / NP) * Math.PI * 2 + 0.2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const r = rim * 1.28;
      const px = cx + (rx * ca + ux * sa) * r - fx * 0.05;
      const py = cy + (ry * ca + uy * sa) * r - fy * 0.05;
      const pz = cz + (rz * ca + uz * sa) * r - fz * 0.05;
      const s = kHead;
      this._setBone(b.index, px, py, pz, rx, ry, rz, ux, uy, uz, -fx, -fy, -fz, s, s, s);
      const pulse = 0.65 + 0.35 * Math.sin(t * (2.1 + k * 0.4) + k * 1.7);
      PD[b.index * 4] = 0.15 + 1.25 * glow * pulse * (B.listen > 0 ? 1.15 : 0.85);
    }

    // ---- legs: 2-bone IK from the body flank to the planted hooks ----
    const limbs = B.limbs || [];
    const a0 = D.upperLen;
    const b0 = D.lowerLen;
    for (let k = 0; k < this.bLimbs.length; k++) {
      const L = limbs[k];
      const bl = this.bLimbs[k];
      if (!L) {
        this._hideBone(bl.upper.index);
        this._hideBone(bl.lower.index);
        this._hideBone(bl.hook.index);
        continue;
      }
      const si = clamp(L.seg | 0, 1, SEG - 2);
      const o = si * 12;
      const side = L.side < 0 ? -1 : 1;
      const sc = kBase * (B.scale ? B.scale[si] : 1);
      const wHalf = D.segHalfW * sc * 0.82;
      // Hip on the rendered flank.
      const hx = F[o] + F[o + 9] * side * wHalf - F[o + 6] * D.segBelly * sc * 0.15;
      const hy = F[o + 1] + F[o + 10] * side * wHalf - F[o + 7] * D.segBelly * sc * 0.15;
      const hz = F[o + 2] + F[o + 11] * side * wHalf - F[o + 8] * D.segBelly * sc * 0.15;
      const ftx = L.foot.x;
      const fty = L.foot.y;
      const ftz = L.foot.z;
      // Bone lengths: the sim's reach (+4% so planted knees stay bent).
      const reach = L.reach || 6;
      const kl = (reach * 1.04) / (a0 + b0);
      let A = a0 * kl;
      let Bl = b0 * kl;
      let dx = ftx - hx;
      let dy = fty - hy;
      let dz = ftz - hz;
      let dist = len3(dx, dy, dz);
      if (dist < 1e-4) {
        dx = -F[o + 6];
        dy = -F[o + 7];
        dz = -F[o + 8];
        dist = 1e-4;
      } else {
        dx /= dist;
        dy /= dist;
        dz /= dist;
      }
      let stretch = 1;
      if (dist > (A + Bl) * 0.995) {
        stretch = Math.min(1.3, dist / ((A + Bl) * 0.995));
        A *= stretch;
        Bl *= stretch;
      }
      const D2 = clamp(dist, Math.abs(A - Bl) * 1.01 + 1e-3, (A + Bl) * 0.999);
      const cosA = clamp((A * A + D2 * D2 - Bl * Bl) / (2 * A * D2), -1, 1);
      const along = A * cosA;
      const perp = Math.sqrt(Math.max(0, A * A - along * along));
      // Pole: knees arch up off the wall and well out to the side (a girder elbow
      // that reads from the shaft), a little back.
      let pxv = F[o + 6] * 1.0 + F[o + 9] * side * 0.7 - F[o + 3] * 0.2;
      let pyv = F[o + 7] * 1.0 + F[o + 10] * side * 0.7 - F[o + 4] * 0.2;
      let pzv = F[o + 8] * 1.0 + F[o + 11] * side * 0.7 - F[o + 5] * 0.2;
      const pd = pxv * dx + pyv * dy + pzv * dz;
      pxv -= dx * pd;
      pyv -= dy * pd;
      pzv -= dz * pd;
      let pl = len3(pxv, pyv, pzv);
      if (pl < 1e-4) {
        pxv = F[o + 6];
        pyv = F[o + 7];
        pzv = F[o + 8];
        pl = 1;
      }
      pxv /= pl;
      pyv /= pl;
      pzv /= pl;
      const kx = hx + dx * along + pxv * perp;
      const ky = hy + dy * along + pyv * perp;
      const kz = hz + dz * along + pzv * perp;
      // Bend-plane normal: the lattice web faces it (reads as a girder from the shaft).
      let nx = dy * pzv - dz * pyv;
      let ny = dz * pxv - dx * pzv;
      let nz = dx * pyv - dy * pxv;
      const nl = len3(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const thick = kBase * (0.9 + 0.3 * (L.weight == null ? 1 : L.weight));
      this._boneSeg(bl.upper.index, hx, hy, hz, kx, ky, kz, nx, ny, nz, thick, a0);
      this._boneSeg(bl.lower.index, kx, ky, kz, ftx, fty, ftz, nx, ny, nz, thick, b0);
      PD[bl.upper.index * 4] = 1;
      PD[bl.lower.index * 4] = 1;
      // Hook: continues the lower bone into the masonry, curling back toward the body.
      let yx = ftx - kx;
      let yy = fty - ky;
      let yz = ftz - kz;
      const yl = len3(yx, yy, yz) || 1;
      yx /= yl;
      yy /= yl;
      yz /= yl;
      let zx = -F[o + 9] * side;
      let zy = -F[o + 10] * side;
      let zz = -F[o + 11] * side;
      const zd = zx * yx + zy * yy + zz * yz;
      zx -= yx * zd;
      zy -= yy * zd;
      zz -= yz * zd;
      let zl = len3(zx, zy, zz);
      if (zl < 1e-4) {
        zx = nx;
        zy = ny;
        zz = nz;
        zl = 1;
      }
      zx /= zl;
      zy /= zl;
      zz /= zl;
      const xx = yy * zz - yz * zy;
      const xy = yz * zx - yx * zz;
      const xz = yx * zy - yy * zx;
      const hs = thick * 1.1;
      this._setBone(bl.hook.index, ftx - yx * 0.25 * hs, fty - yy * 0.25 * hs, ftz - yz * 0.25 * hs, xx, xy, xz, yx, yy, yz, zx, zy, zz, hs, hs, hs);
      PD[bl.hook.index * 4] = 1;
    }

    // ---- optional extras ----
    for (const b of this.bExtra) {
      if (b.kind === 'spine') {
        const o = b.i * 12;
        const sc = kBase * (B.scale ? B.scale[b.i] : 1);
        this._setBone(b.index, F[o], F[o + 1], F[o + 2], F[o + 9], F[o + 10], F[o + 11], F[o + 6], F[o + 7], F[o + 8], -F[o + 3], -F[o + 4], -F[o + 5], sc, sc, sc);
      } else if (b.kind === 'jaw') {
        // Hinged at the head pivot: drops open with the lunge (rotation about local X).
        const a = -lunge * 0.55;
        const c = Math.cos(a);
        const s = Math.sin(a);
        // Rotate the head's (up, back) pair about right.
        const yx2 = ux * c + -fx * s;
        const yy2 = uy * c + -fy * s;
        const yz2 = uz * c + -fz * s;
        const zx2 = -fx * c - ux * s;
        const zy2 = -fy * c - uy * s;
        const zz2 = -fz * c - uz * s;
        this._setBone(b.index, F[0], F[1], F[2], rx, ry, rz, yx2, yy2, yz2, zx2, zy2, zz2, kHead, kHead, kHead);
      } else {
        const s = kHead * (0.7 + 0.45 * open);
        this._setBone(b.index, F[0], F[1], F[2], rx, ry, rz, ux, uy, uz, -fx, -fy, -fz, s, s, s);
      }
      PD[b.index * 4] = 0.4 + glow;
    }
    this._partTex.needsUpdate = true;

    // ---- bounds for frustum culling (spine extent + legs + fronds) ----
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < SEG; i++) {
      const x = sp[i * 3];
      const y = sp[i * 3 + 1];
      const z = sp[i * 3 + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    const sph = this._sphere;
    sph.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    sph.radius = len3(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 9 * kBase;
    for (const l of this.lods) for (const m of l.meshes) m.boundingSphere.copy(sph);
  }

  /** Writes bone i's world matrix: basis columns X, Y, Z scaled by sx, sy, sz, at p. */
  _setBone(i, px, py, pz, Xx, Xy, Xz, Yx, Yy, Yz, Zx, Zy, Zz, sx, sy, sz) {
    const e = this._boneObjs[i].matrixWorld.elements;
    e[0] = Xx * sx;
    e[1] = Xy * sx;
    e[2] = Xz * sx;
    e[3] = 0;
    e[4] = Yx * sy;
    e[5] = Yy * sy;
    e[6] = Yz * sy;
    e[7] = 0;
    e[8] = Zx * sz;
    e[9] = Zy * sz;
    e[10] = Zz * sz;
    e[11] = 0;
    e[12] = px;
    e[13] = py;
    e[14] = pz;
    e[15] = 1;
  }

  _hideBone(i) {
    this._setBone(i, 0, -1e5, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1e-4, 1e-4, 1e-4);
  }

  /**
   * A canonical girder (+Y from 0 to `len0`, web along X) from a to b; web normal n.
   */
  _boneSeg(i, ax, ay, az, bx, by, bz, nx, ny, nz, thick, len0) {
    let yx = bx - ax;
    let yy = by - ay;
    let yz = bz - az;
    const l = len3(yx, yy, yz) || 1e-4;
    yx /= l;
    yy /= l;
    yz /= l;
    // X = web direction ⟂ bone (bend-plane normal), Z = X × Y.
    const d = nx * yx + ny * yy + nz * yz;
    let xx = nx - yx * d;
    let xy = ny - yy * d;
    let xz = nz - yz * d;
    const xl = len3(xx, xy, xz) || 1;
    xx /= xl;
    xy /= xl;
    xz /= xl;
    const zx = xy * yz - xz * yy;
    const zy = xz * yx - xx * yz;
    const zz = xx * yy - xy * yx;
    this._setBone(i, ax, ay, az, xx, xy, xz, yx, yy, yz, zx, zy, zz, thick, l / len0, thick);
  }

  setVisible(v) {
    this.root.visible = !!v;
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    for (const l of this.lods) {
      for (const m of l.meshes) {
        m.geometry.dispose();
        m.material.dispose();
      }
    }
    this._partTex.dispose();
    this._white.dispose();
    if (this.skeleton && this.skeleton.boneTexture) this.skeleton.boneTexture.dispose();
  }
}

const _v0 = new THREE.Vector3();

/** Mean linear albedo of a loaded texture (tiny canvas read-back; 0.25 when unavailable). */
function meanLuma(tex) {
  try {
    const img = tex && tex.image;
    if (!img || typeof document === 'undefined') return 0.25;
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 8;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) {
      // sRGB → linear luminance
      const lin = (v) => {
        const x = v / 255;
        return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      s += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    }
    return Math.max(0.03, s / 64);
  } catch {
    return 0.25;
  }
}
