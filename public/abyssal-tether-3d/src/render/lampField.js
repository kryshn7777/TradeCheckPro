/* ABYSSAL TETHER 3D — render/lampField.js
 * LAMPHOLD'S LAMPS: "every lamp a bed". The pit's four walls are lined with thousands of small warm lamps (each a sleeper's), and the stalls of the Well hold forty
 * more. They are ONE draw call (additive points, no depth write, drawn through the fog like far lamps are), they sway with a slow flicker, and they go OUT:
 *   - the Evening's front: every lamp above `snuffY` is dark (the town is put out from the top down; a soft fade over `fade` metres), set by the director;
 *   - single lamps by id (a cluster the Round snuffed, the stalls swept by the Doorman's throat): `snuff(ids...)`, each fading over 0.6 s with a puff of soot
 *     (`onPuff(x, y, z)` for the fx);
 *   - everything: `snuffAll()` (the master lamp's death).
 * `lit` per lamp is a Float32Array the points read as a vertex attribute (re-uploaded only on frames where something changed).
 *
 *   const f = new LampField(scene)
 *   f.build({ solids, shaft: 26, yTop, yBottom, count, stalls: [{x, y, z}], clusters: [{x, y, z}] })   deterministic from the level data
 *   f.update(dt, { snuffY, time })           snuffY: lamps above it are out (Infinity: none, -Infinity: all)
 *   f.snuffStall(i) / f.snuffCluster(i) / f.relight() / f.snuffAll()
 *   f.stats { lamps, lit, drawCalls }
 * DOM-free apart from three.js; no per-frame allocation.
 */
import * as THREE from 'three';

const VERT = `
attribute float aLit;
attribute float aSeed;
uniform float uTime, uSize, uSnuffY, uFade;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float fall = clamp((uSnuffY - position.y) / uFade, 0.0, 1.0); // 0 above the front (out) .. 1 below it (lit)
  float on = aLit * fall;
  float flick = 0.85 + 0.15 * sin(uTime * 2.3 + aSeed * 31.0) * sin(uTime * 0.9 + aSeed * 7.0);
  vA = on * flick;
  gl_PointSize = uSize * (0.55 + 0.45 * on) * clamp(220.0 / max(-mv.z, 1.0), 0.6, 6.0);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  float g = clamp(1.0 - r, 0.0, 1.0);
  float a = g * g * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0, 0.72, 0.38) * (0.6 + 0.8 * g), a);
}`;

const hash = (n) => {
  let x = Math.imul(n ^ 0x9e3779b1, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

export class LampField {
  constructor(scene) {
    this.scene = scene;
    this.points = null;
    this.stats = { lamps: 0, lit: 0, drawCalls: 0 };
    this.onPuff = null;
    this._n = 0;
    this._lit = null;
    this._target = null; // per-lamp target (1 lit, 0 out)
    this._dirty = false;
    this._firstStall = 0;
    this._firstCluster = 0;
    this._pos = null;
    this.uniforms = { uTime: { value: 0 }, uSize: { value: 26 }, uSnuffY: { value: 1e9 }, uFade: { value: 12 } };
  }

  build(o) {
    if (this.points) return;
    const S = o.shaft || 26;
    const yTop = o.yTop;
    const yBot = o.yBottom;
    const count = o.count || 2600;
    const stalls = o.stalls || [];
    const clusters = o.clusters || [];
    const n = count + stalls.length + clusters.length;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    // the wall lamps: on the four inner faces, 1.5 m in front of the stone, spread over the chapter's depth in rows (the beds of the tiers)
    for (let i = 0; i < count; i++) {
      const wall = i % 4;
      const y = yTop - 4 - hash(i * 5 + 1) * (yTop - yBot - 8);
      const t = (hash(i * 5 + 2) * 2 - 1) * (S - 2);
      const o2 = S - 1.4;
      if (wall === 0) pos.set([-o2, y, t], i * 3);
      else if (wall === 1) pos.set([o2, y, t], i * 3);
      else if (wall === 2) pos.set([t, y, -o2], i * 3);
      else pos.set([t, y, o2], i * 3);
      seed[i] = hash(i * 5 + 3);
    }
    this._firstStall = count;
    stalls.forEach((s, k) => {
      pos.set([s.x, s.y, s.z], (count + k) * 3);
      seed[count + k] = hash(900 + k);
    });
    this._firstCluster = count + stalls.length;
    clusters.forEach((s, k) => {
      pos.set([s.x, s.y + 1.6, s.z], (this._firstCluster + k) * 3);
      seed[this._firstCluster + k] = hash(1900 + k);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._lit = new Float32Array(n).fill(1);
    this._target = new Float32Array(n).fill(1);
    g.setAttribute('aLit', new THREE.BufferAttribute(this._lit, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.points = new THREE.Points(g, m);
    this.points.name = 'AT3D-lamp-field';
    this.points.frustumCulled = false;
    this.points.renderOrder = 12;
    this._pos = pos;
    this._n = n;
    this.scene.add(this.points);
    this.stats.lamps = n;
    this.stats.lit = n;
    this.stats.drawCalls = 1;
  }

  /** The dark front: lamps above y are out. */
  setSnuffY(y) {
    this.uniforms.uSnuffY.value = y;
  }

  _off(i) {
    if (i < 0 || i >= this._n || this._target[i] === 0) return;
    this._target[i] = 0;
    if (this.onPuff && this._lit[i] > 0.2) this.onPuff(this._pos[i * 3], this._pos[i * 3 + 1], this._pos[i * 3 + 2]);
  }

  snuffStall(i) {
    this._off(this._firstStall + i);
  }

  snuffCluster(i) {
    this._off(this._firstCluster + i);
  }

  /** The stalls from the back: every stall lamp whose index is >= k is out (the sweep puts them out row by row). */
  snuffStallsFrom(k) {
    for (let i = k; i < this._firstCluster - this._firstStall; i++) this.snuffStall(i);
  }

  snuffAll() {
    for (let i = 0; i < this._n; i++) this._target[i] = 0;
    this.uniforms.uSnuffY.value = -1e9;
  }

  /** A new run / a respawn: everything lit again (the front resets with the director). */
  relight() {
    this._target.fill(1);
    this._lit.fill(1);
    this.uniforms.uSnuffY.value = 1e9;
    this._dirty = true;
  }

  update(dt, o) {
    if (!this.points) return;
    this.uniforms.uTime.value = (o && o.time) || this.uniforms.uTime.value + dt;
    if (o && typeof o.snuffY === 'number') this.uniforms.uSnuffY.value = o.snuffY;
    // fade single lamps toward their targets
    let changed = false;
    let lit = 0;
    const k = Math.min(1, dt / 0.6);
    for (let i = 0; i < this._n; i++) {
      const d = this._target[i] - this._lit[i];
      if (d !== 0) {
        this._lit[i] = Math.abs(d) < 0.01 ? this._target[i] : this._lit[i] + d * k;
        changed = true;
      }
      if (this._lit[i] > 0.5) lit++;
    }
    if (changed || this._dirty) {
      this.points.geometry.getAttribute('aLit').needsUpdate = true;
      this._dirty = false;
    }
    this.stats.lit = lit;
  }

  dispose() {
    if (!this.points) return;
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.points = null;
  }
}
