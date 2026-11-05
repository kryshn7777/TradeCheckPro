/* ABYSSAL TETHER 3D — render/jetpackView.js
 * What the jetpack (sim/jetpack3d.js) looks like in the world:
 *
 *   FUEL CANS    a squat red-orange canister with a pale cyan band and a cap, lying on a ledge: ONE InstancedMesh (standard material, lit by the
 *                lantern, swallowed by the fog like the rest of the level) + ONE Points halo (additive, a soft cyan dot that bobs) so a can in a dark
 *                corner is findable; spin and bob in the vertex shader of nothing — the instance matrices are rewritten only when a can is taken.
 *   THE FLAME    two additive cones (a long orange outer, a short white-blue core) hung under the feet while it burns, pointing down, flickering,
 *                length from the thrust; plus sparks and dust where it blows on the floor (fx.burst). Hidden when it is not burning.
 *
 * Three draw calls at most (cans, halos, one flame group of two meshes); the meshes exist from the start (visible) so the scene precompile
 * compiles their programs, then hide while there is nothing to show.
 *
 *   new JetpackView(game)     game: { renderer.scene, jet, player }
 *   .update(dt, game)         once per frame (Game._updateViews)
 *   .stats                    { cans, flame }
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MAX_CANS = 12;
const FLAME_LEN = 1.5;

function canGeometry() {
  const parts = [];
  const body = new THREE.CylinderGeometry(0.085, 0.09, 0.26, 12);
  const cap = new THREE.CylinderGeometry(0.035, 0.045, 0.06, 10);
  cap.translate(0, 0.16, 0);
  const band = new THREE.CylinderGeometry(0.093, 0.093, 0.045, 12, 1, true);
  band.translate(0, 0.04, 0);
  const handle = new THREE.TorusGeometry(0.05, 0.01, 5, 10, Math.PI);
  handle.rotateZ(Math.PI / 2);
  handle.translate(0, 0.17, 0);
  const paint = (g, r, gr, b) => {
    const n = g.getAttribute('position').count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = r;
      c[i * 3 + 1] = gr;
      c[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  parts.push(paint(body, 0.62, 0.22, 0.09), paint(cap, 0.18, 0.18, 0.2), paint(band, 0.45, 0.85, 0.95), paint(handle, 0.15, 0.15, 0.17));
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  g.computeVertexNormals();
  return g;
}

function haloTexture() {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) / n - 0.5;
      const y = (j + 0.5) / n - 0.5;
      const r = Math.sqrt(x * x + y * y) * 2;
      const a = Math.max(0, 1 - r);
      const v = a * a * a;
      const o = (j * n + i) * 4;
      data[o] = 140;
      data[o + 1] = 235;
      data[o + 2] = 255;
      data[o + 3] = Math.round(v * 255);
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function coneMesh(len, rad, color, order) {
  const g = new THREE.ConeGeometry(rad, len, 14, 1, true);
  g.rotateX(Math.PI); // ConeGeometry's apex is +y: flip it down ...
  g.translate(0, -len / 2, 0); // ... and hang it: the base at the origin (the feet), the apex at -len
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = order;
  mesh.frustumCulled = false;
  return mesh;
}

export class JetpackView {
  constructor(game) {
    this.game = game;
    this.scene = game.renderer.scene;
    this.stats = { cans: 0, flame: false };
    this._version = -1;
    this._t = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    // cans
    this.canMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.45, emissive: new THREE.Color(0.05, 0.16, 0.2) });
    this.cans = new THREE.InstancedMesh(canGeometry(), this.canMat, MAX_CANS);
    this.cans.name = 'jetCans';
    this.cans.frustumCulled = false;
    this.cans.count = 0;
    this.scene.add(this.cans);
    // halos
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_CANS * 3), 3));
    this.haloMap = haloTexture();
    this.haloMat = new THREE.PointsMaterial({ map: this.haloMap, size: 0.9, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, fog: false });
    this.halo = new THREE.Points(pg, this.haloMat);
    this.halo.name = 'jetHalos';
    this.halo.frustumCulled = false;
    pg.setDrawRange(0, 0);
    this.scene.add(this.halo);
    // flame
    this.flame = new THREE.Group();
    this.flame.name = 'jetFlame';
    this.outer = coneMesh(FLAME_LEN, 0.2, 0xff8a2a, 40);
    this.core = coneMesh(FLAME_LEN * 0.55, 0.1, 0xbfe6ff, 41);
    this.flame.add(this.outer, this.core);
    this.flame.visible = false;
    this.scene.add(this.flame);
    this._pos = [];
  }

  /** Re-lay the cans (when the list or a can's taken flag changes). */
  _sync(jet) {
    let n = 0;
    const m = this._m;
    const pos = this.halo.geometry.getAttribute('position');
    this._pos.length = 0;
    for (const c of jet.cans) {
      if (c.taken || n >= MAX_CANS) continue;
      this._v.set(c.x, c.y, c.z);
      m.compose(this._v, this._q.setFromEuler(new THREE.Euler(0.12, n * 1.3, 0.1)), this._s);
      this.cans.setMatrixAt(n, m);
      pos.setXYZ(n, c.x, c.y + 0.15, c.z);
      this._pos.push(c);
      n++;
    }
    this.cans.count = n;
    this.cans.instanceMatrix.needsUpdate = true;
    pos.needsUpdate = true;
    this.halo.geometry.setDrawRange(0, n);
    this.cans.visible = this.halo.visible = n > 0;
  }

  update(dt, game) {
    const jet = game.jet;
    if (!jet) return;
    this._t += dt > 0 ? dt : 0;
    if (jet.version !== this._version) {
      this._version = jet.version;
      this._sync(jet);
    }
    // the halos breathe
    this.haloMat.opacity = 0.42 + 0.18 * Math.sin(this._t * 2.1);
    this.stats.cans = this.cans.count;
    // the flame
    const burning = jet.burning && game.player && game.player.alive !== false;
    this.flame.visible = burning;
    this.stats.flame = burning;
    if (!burning) return;
    const p = game.player;
    const k = Math.min(1, jet.thrust / 46);
    const flick = 0.82 + 0.18 * Math.sin(this._t * 61) * Math.sin(this._t * 23 + 1);
    const len = (0.35 + 0.65 * k) * flick;
    this.flame.position.set(p.rx, p.ry - 0.38 - 0.1, p.rz);
    this.outer.scale.set(1 + 0.1 * Math.sin(this._t * 47), len, 1 + 0.1 * Math.cos(this._t * 43));
    this.core.scale.set(1, len * (0.9 + 0.1 * Math.sin(this._t * 71)), 1);
    this.outer.material.opacity = 0.55 + 0.3 * k;
    // sparks + dust where it blows on the ground below (a short ray straight down, drawn from the level's own probe when there is one)
    const fx = game.renderer && game.renderer.fx;
    if (fx && typeof fx.burst === 'function' && Math.random() < 0.5) fx.burst('sparks', p.rx, p.ry - 0.5 - 1.2 * len, p.rz, { count: 2 });
  }

  dispose() {
    for (const o of [this.cans, this.halo, this.flame]) if (o.parent) o.parent.remove(o);
    this.cans.geometry.dispose();
    this.canMat.dispose();
    this.halo.geometry.dispose();
    this.haloMat.dispose();
    this.haloMap.dispose();
    for (const m of [this.outer, this.core]) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}
