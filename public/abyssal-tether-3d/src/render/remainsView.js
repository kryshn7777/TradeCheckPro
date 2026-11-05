/* ABYSSAL TETHER 3D — render/remainsView.js
 * The dead of the Underspire: skeletons (assets/models/bones.glb, build_bones.py) and old blood (assets/textures/blood_atlas.png + .json,
 * build_blood_atlas.py), laid out by sim/remainsPlan.js ("this game is going to be definitely R-rated. I need bloodstains here and there.
 * A lot of skeletons").
 *
 *   SKELETONS   one InstancedMesh per kind that the level uses (each mesh of the GLB is one pose: slumped, hanging, sprawled, crumpled, crawling,
 *               ribcage, loose bones, skull pile, a hand in a heap), sharing the GLB's one material (vertex colours, the level's lit patch). Only the
 *               ones within the tier's range are in the instance buffers (a refresh every 1.5 m of travel): Quest 28 m, low 22 m, desktop 70 m.
 *   BLOOD       ONE InstancedMesh of quads with the atlas (an alpha-blended decal 1-2 cm off the surface: the same haze as the level, darker away from
 *               the lantern so it does not glow); floors use the pools and the drag marks, walls the sprays, splatters, handprints and runs
 *               (the atlas rows run DOWN: a wall decal's v+ is down the wall). Within 45 m.
 *
 *   new RemainsView(game)     game: { renderer.{scene,camera,qualityTier}, level }
 *   .load(loaderFactory)      starts the background load of both assets (idempotent); until they arrive nothing is drawn
 *   .buildFromGLTF(gltf) .setAtlas(texture, json)    (also the tests)
 *   .update(dt, game)         once per frame
 *   .stats                    { skeletons (planned), shown, stains (planned), stainsShown, kinds, ready }
 */
import * as THREE from 'three';
import { patchMaterial } from './materials.js';
import { planRemains, REMAINS } from '../sim/remainsPlan.js';

export const BONES_URL = new URL('../../assets/models/bones.glb', import.meta.url).href;
export const ATLAS_URL = new URL('../../assets/textures/blood_atlas.png', import.meta.url).href;
export const ATLAS_JSON_URL = new URL('../../assets/textures/blood_atlas.json', import.meta.url).href;

/** How far (m) each tier draws them. */
export const RANGE = { low: 22, quest: 28, high: 70 };
const STAIN_RANGE = 45;
const REFRESH = 1.5; // m of camera travel between rebuilds of the near lists
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * The plan's kinds -> the meshes of bones.glb that can stand for it (by node name; a kind with several picks one by the item's id, so two
 * sprawled ones differ). build_bones.py's nodes: Bones_Crawler, _Hanging (origin at the HOOK), _LyingA, _LyingB, _Reach, _Ribcage, _Scatter,
 * _SittingWall (origin on the wall plane, the skeleton in +z), _Skull, _SkullJawless, _SkullPile.
 */
const NAME = {
  slumped: [/sitting|slump/i],
  hanging: [/hang/i],
  sprawled: [/lyinga|sprawl/i, /lyingb/i],
  crumpled: [/lyingb|crumple/i],
  crawling: [/crawl/i],
  ribcage: [/rib/i],
  loose: [/scatter|loose/i, /skull$|skulljawless/i],
  skullpile: [/pile/i],
  hand: [/reach|hand/i],
};
/** Slumped: the model's origin is ON the wall plane, the plan puts the body this far out from it. */
const SLUMP_OFF = 0.42;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aUV;
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = mix(aUV.xy, aUV.zw, uv);
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uMap;
uniform vec3 uCam;
varying vec2 vUv;
varying vec3 vW;
void main() {
  vec4 t = texture2D(uMap, vUv);
  if (t.a < 0.01) discard;
  float d = length(vW - uCam);
  float lit = 0.1 + 0.95 * exp(-d / 11.0); // wet and dark: seen by the lantern, near
  gl_FragColor = vec4(t.rgb * lit, t.a * 0.92);
  #include <fog_fragment>
}
`;

export class RemainsView {
  constructor(game) {
    this.game = game;
    this.scene = game.renderer.scene;
    this.level = game.level || null;
    this.plan = this.level ? planRemains(this.level) : { skeletons: [], stains: [] };
    this.stats = { skeletons: this.plan.skeletons.length, shown: 0, stains: this.plan.stains.length, stainsShown: 0, kinds: 0, ready: false };
    this.loading = false;
    this.ready = false;
    this.failed = false;
    this.error = null;
    this.byKind = new Map(); // kind -> { mesh: InstancedMesh, base: THREE.Mesh, items: [plan skeletons], mats: Float32Array }
    this.atlas = null;
    this._last = new THREE.Vector3(1e9, 1e9, 1e9);
    this._cam = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._e = new THREE.Euler();
    this.stainMesh = null;
    this._stainMats = null;
    this._stainUV = null;
    this.glb = false;
    this.tex = false;
  }

  /** Background load of both assets (idempotent). */
  load(loaderFactory) {
    if (this.loading || this.ready || this.failed || typeof loaderFactory !== 'function') return;
    this.loading = true;
    this._pending = 2; // the model and the atlas
    const fail = (err) => {
      this.loading = false;
      this.failed = true;
      this.error = err;
    };
    let loader;
    try {
      loader = loaderFactory();
    } catch (err) {
      fail(err);
      return;
    }
    loader.load(
      BONES_URL,
      (gltf) => {
        try {
          this.buildFromGLTF(gltf);
        } catch (err) {
          this.error = err; // the bones may be missing: the blood still shows
        }
        this._done();
      },
      undefined,
      (err) => {
        this.error = err;
        this._done();
      },
    );
    try {
      const tl = new THREE.TextureLoader();
      Promise.all([
        fetch(ATLAS_JSON_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error('blood_atlas.json ' + r.status)))),
        new Promise((res, rej) => tl.load(ATLAS_URL, res, undefined, rej)),
      ])
        .then(([json, tex]) => {
          this.setAtlas(tex, json);
          this._done();
        })
        .catch((err) => {
          this.error = this.error || err;
          this._done();
        });
    } catch (err) {
      this.error = err;
      this._done();
    }
  }

  _done() {
    this._pending = (this._pending == null ? 2 : this._pending) - 1;
    if (this._pending <= 0) {
      this.loading = false;
      this.ready = this.glb || this.tex;
      this.failed = !this.ready;
      this.stats.ready = this.ready;
      this._last.set(1e9, 1e9, 1e9);
    }
  }

  /** Builds the instanced skeletons from a loaded glTF: every mesh whose name matches a kind. */
  buildFromGLTF(gltf) {
    const found = [];
    // bones.glb is quantised (KHR_mesh_quantization): the vertices are normalised int16 and each NODE carries the scale + offset that bring them to
    // metres, so every instance matrix is (place) x (the node's own matrix), and the extents come from the node-transformed box
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (o.isMesh && o.geometry) found.push(o);
    });
    if (!found.length) throw new Error('bones.glb has no meshes');
    const fallback = found.find((o) => /lyinga|sprawl|crumple|lyingb/i.test(o.name)) || found[0];
    const hashId = (id) => {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      return h;
    };
    // group the plan's skeletons by the mesh that stands for them
    const groups = new Map(); // mesh -> { base, kind, items[] }
    for (const s of this.plan.skeletons) {
      const cands = (NAME[s.kind] || []).map((re) => found.find((o) => re.test(o.name))).filter(Boolean);
      const base = cands.length ? cands[hashId(s.id) % cands.length] : fallback;
      if (!groups.has(base)) groups.set(base, { base, kind: s.kind, items: [] });
      groups.get(base).items.push(s);
    }
    const mats = new Map();
    for (const [base, grp] of groups) {
      const items = grp.items;
      let mat = mats.get(base.material);
      if (!mat) {
        mat = base.material.clone();
        mat.vertexColors = !!base.geometry.getAttribute('color');
        patchMaterial(mat, { lit: true, grade: true, wetMin: 0.1 });
        const ls = this.game.renderer && this.game.renderer.lanternShadow;
        if (ls && typeof ls.attach === 'function') ls.attach(mat);
        mats.set(base.material, mat);
      }
      const im = new THREE.InstancedMesh(base.geometry, mat, items.length);
      im.name = 'remains-' + base.name;
      im.frustumCulled = false;
      im.count = 0;
      const box = new THREE.Box3().setFromObject(base); // metres, in the model's own frame (the node transform applied)
      const top = box.max.y;
      const nodeM = base.matrixWorld.clone();
      this.scene.add(im);
      const rec = { mesh: im, base, kind: grp.kind, items, top, mats: new Float32Array(items.length * 16) };
      this.byKind.set(base.name, rec);
      // the matrices of every item, once
      const m = this._m;
      for (let i = 0; i < items.length; i++) {
        const s = items[i];
        let x = s.x;
        let y = s.y;
        let z = s.z;
        if (grp.kind === 'hanging' && s.hook != null) y = s.hook; // the model's origin is the hook
        else if (/sitting|slump/i.test(base.name)) {
          // the origin is on the wall plane: step back from where the plan put the body (it faces out of the wall along yaw)
          x -= Math.sin(s.yaw) * SLUMP_OFF;
          z -= Math.cos(s.yaw) * SLUMP_OFF;
        }
        this._p.set(x, y, z);
        this._q.setFromAxisAngle(Y_AXIS, s.yaw);
        this._s.set(1, 1, 1);
        m.compose(this._p, this._q, this._s).multiply(nodeM);
        m.toArray(rec.mats, i * 16);
      }
    }
    this.stats.kinds = this.byKind.size;
    this.glb = true;
  }

  /** The blood atlas: a texture + its json (cells with name, uv [u0, v0, u1, v1] and world_size_m). */
  setAtlas(texture, json) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = 4;
    this.atlas = { texture, cells: (json && json.cells) || [] };
    const cells = this.atlas.cells;
    if (!cells.length || !this.plan.stains.length) return;
    const floorCells = cells.filter((c) => /puddle|pool|drag|smear|pooled/i.test(c.name));
    const wallCells = cells.filter((c) => !/puddle|pool|drag|smear|pooled/i.test(c.name));
    const pickCells = (isFloor) => (isFloor ? (floorCells.length ? floorCells : cells) : wallCells.length ? wallCells : cells);
    const N = this.plan.stains.length;
    const geo = new THREE.PlaneGeometry(1, 1);
    this._stainUV = new Float32Array(N * 4);
    geo.setAttribute('aUV', new THREE.InstancedBufferAttribute(this._stainUV, 4));
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: texture }, uCam: { value: new THREE.Vector3() } }]);
    this.stainMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.stainMesh = new THREE.InstancedMesh(geo, this.stainMat, N);
    this.stainMesh.name = 'remains-blood';
    this.stainMesh.frustumCulled = false;
    this.stainMesh.renderOrder = 5;
    this.stainMesh.count = 0;
    this.scene.add(this.stainMesh);
    this._stainMats = new Float32Array(N * 16);
    this._stainCell = new Array(N);
    const m = this._m;
    const q2 = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 0, 1);
    const nrm = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const s = this.plan.stains[i];
      const floor = s.ny > 0.5;
      const list = pickCells(floor);
      const c = list[s.variant % list.length];
      this._stainCell[i] = c;
      const sz = (c.world_size_m && c.world_size_m[0] ? c.world_size_m[0] : 1) * Math.max(0.6, s.size);
      nrm.set(s.nx, s.ny, s.nz);
      q2.setFromUnitVectors(up, nrm); // the quad's +z onto the surface normal
      if (floor) {
        // spin about the normal (a floor decal has no "down")
        this._q.setFromAxisAngle(nrm, s.rot);
        q2.premultiply(this._q);
      } else {
        // keep a wall decal upright (its v+ runs down the wall), a few degrees of tilt only
        this._q.setFromAxisAngle(nrm, (s.rot - Math.PI) * 0.04);
        q2.premultiply(this._q);
        // setFromUnitVectors for a horizontal normal leaves +y of the quad pointing up the wall already (the quad's local y stays vertical)
      }
      this._p.set(s.x, s.y, s.z);
      this._s.set(sz, sz, 1);
      m.compose(this._p, q2, this._s);
      m.toArray(this._stainMats, i * 16);
    }
    this.tex = true;
  }

  update(dt, game) {
    if (!this.glb && !this.tex) return;
    const cam = game.renderer && game.renderer.camera;
    if (!cam) return;
    cam.getWorldPosition(this._cam);
    if (this.uniforms) this.uniforms.uCam.value.copy(this._cam);
    if (this._cam.distanceToSquared(this._last) < REFRESH * REFRESH) return;
    this._last.copy(this._cam);
    const tier = (game.renderer && game.renderer.qualityTier) || 'quest';
    const range = RANGE[tier] || RANGE.quest;
    let shown = 0;
    for (const [, k] of this.byKind) {
      let n = 0;
      const im = k.mesh;
      const arr = im.instanceMatrix.array;
      for (let i = 0; i < k.items.length; i++) {
        const s = k.items[i];
        const dx = s.x - this._cam.x;
        const dy = s.y - this._cam.y;
        const dz = s.z - this._cam.z;
        if (dx * dx + dy * dy + dz * dz > range * range) continue;
        for (let j = 0; j < 16; j++) arr[n * 16 + j] = k.mats[i * 16 + j];
        n++;
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      im.visible = n > 0;
      shown += n;
    }
    this.stats.shown = shown;
    if (this.stainMesh) {
      let n = 0;
      const arr = this.stainMesh.instanceMatrix.array;
      const uv = this.stainMesh.geometry.getAttribute('aUV');
      const R2 = STAIN_RANGE * STAIN_RANGE;
      const stains = this.plan.stains;
      for (let i = 0; i < stains.length; i++) {
        const s = stains[i];
        const dx = s.x - this._cam.x;
        const dy = s.y - this._cam.y;
        const dz = s.z - this._cam.z;
        if (dx * dx + dy * dy + dz * dz > R2) continue;
        for (let j = 0; j < 16; j++) arr[n * 16 + j] = this._stainMats[i * 16 + j];
        const c = this._stainCell[i];
        const r = c.uv; // [u0, v0, u1, v1]
        uv.array[n * 4] = r[0];
        uv.array[n * 4 + 1] = r[1];
        uv.array[n * 4 + 2] = r[2];
        uv.array[n * 4 + 3] = r[3];
        n++;
      }
      this.stainMesh.count = n;
      this.stainMesh.instanceMatrix.needsUpdate = true;
      uv.needsUpdate = true;
      this.stainMesh.visible = n > 0;
      this.stats.stainsShown = n;
    }
  }

  dispose() {
    for (const [, k] of this.byKind) {
      if (k.mesh.parent) k.mesh.parent.remove(k.mesh);
      k.mesh.dispose();
      k.mesh.material.dispose();
    }
    this.byKind.clear();
    if (this.stainMesh) {
      if (this.stainMesh.parent) this.stainMesh.parent.remove(this.stainMesh);
      this.stainMesh.geometry.dispose();
      this.stainMat.dispose();
      if (this.atlas && this.atlas.texture) this.atlas.texture.dispose();
    }
  }
}

export { REMAINS };
