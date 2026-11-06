/* ABYSSAL TETHER 3D — render/mason/masonFace.js
 * The Mason's face, which used to be still: two red glowing slit eyes (with a soft halo) and a MAW that opens and closes with the jaw.
 *
 *   - Eyes: one merged mesh (two tilted ellipsoids, unlit red, never fogged: a red glow in the dark) and one Points draw for the two halos.
 *     eyeGlow(snap, t, seed) is a pure function of the clip graph's snapshot: a slow breathing glow at rest, a pulse while it listens, brighter as it
 *     hunts, flaring through the attack's wind-up and flashing on the strike.
 *   - Maw: a dark red cavity and two interlocking rows of teeth (upper points down, lower points up) between the mandibles. mawOpen(jaw) maps the
 *     mandibles' opening angle to a gape 0..1: closed at rest, wide through the wind-up, SLAMMING shut on the strike, chewing while it hunts.
 *   - Both are mounted on the view's root and driven from the neck bone's world matrix (the rig's bones are not in the scene graph).
 */
import * as THREE from 'three';

export const EYES = {
  x: 1.05, // m at kit scale, in the neck bone's frame (x right, y up, z back: the face looks down -z)
  y: 1.3,
  z: -1.25,
  radii: [0.5, 0.2, 0.3], // a slit: wide, thin, shallow
  tilt: 0.42, // rad: the outer corners rise, an angry brow
  halo: 4.4, // halo size (m, attenuated with distance)
};
export const MAW = {
  y: -1.05,
  z: -2.35,
  half: 1.55, // half width of the mouth
  teeth: 9,
  tooth: 0.5, // tooth height at the middle of a row
  gapClosed: 0.1,
  gapOpen: 2.3, // the jaw drops this far when it is wide open (was 1.7: from 10 m the open mouth read as a slit)
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 0..~1.8: how hard the eyes glow. A pure function of the clip graph's snapshot. */
export function eyeGlow(snap, t, seed = 0) {
  const breathe = 0.72 + 0.12 * Math.sin(t * 1.9 + seed * 6.3);
  if (!snap) return breathe;
  const near = smooth(45, 8, snap.distance == null ? 99 : snap.distance);
  switch (snap.phase) {
    case 'windup':
      return 1.0 + 0.7 * smooth(0, 1, snap.atkT / Math.max(snap.atkWindup, 0.05));
    case 'strike':
      return 1.9; // the flash as the jaws slam shut
    case 'recoil':
      return 1.3;
    default:
  }
  if (snap.state === 'BURST') return 1.25 + 0.15 * Math.sin(t * 18);
  if (snap.listening) return 0.95 + 0.25 * Math.sin(t * 7 + seed);
  return breathe + 0.45 * near; // brighter as it comes
}

/** The gape 0..1 for the mandibles' opening angle (rad): shut up to ~17 degrees, fully open at ~1 rad (the wind-up's flare). */
export function mawOpen(jaw) {
  return smooth(0.22, 1.0, jaw);
}

/** A radial gradient for the halo (RGBA, soft edge). */
function haloTexture() {
  const n = 48;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = (1 - r) * (1 - r);
      const o = (y * n + x) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = Math.round(255 * a * a * 1.4 > 255 ? 255 : 255 * a * a * 1.4);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** Both eyes in one geometry: ellipsoids mirrored about x = 0 and tilted (the outer corners up). */
export function eyesGeometry() {
  const base = new THREE.SphereGeometry(1, 14, 8);
  const parts = [];
  for (const s of [1, -1]) {
    const g = base.clone();
    g.scale(EYES.radii[0], EYES.radii[1], EYES.radii[2]);
    g.rotateZ(s * EYES.tilt);
    g.translate(s * EYES.x, EYES.y, EYES.z);
    parts.push(g);
  }
  const pos = [];
  const idx = [];
  let off = 0;
  for (const g of parts) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    const ix = g.index;
    for (let i = 0; i < ix.count; i++) idx.push(ix.array[i] + off);
    off += p.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

export class Eyes {
  /** @param {{variant?: boolean, seed?: number}} [opts] */
  constructor(opts = {}) {
    this.seed = opts.seed || 0;
    this.geometry = eyesGeometry();
    this.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.002, 0.001), fog: false, toneMapped: false });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'Eyes';
    this.mesh.frustumCulled = false;
    this.haloGeometry = new THREE.BufferGeometry();
    this.haloGeometry.setAttribute('position', new THREE.Float32BufferAttribute([EYES.x, EYES.y, EYES.z - 0.1, -EYES.x, EYES.y, EYES.z - 0.1], 3));
    this.haloMap = haloTexture();
    this.haloMaterial = new THREE.PointsMaterial({
      size: EYES.halo,
      sizeAttenuation: true,
      map: this.haloMap,
      color: new THREE.Color(1, 0.004, 0.002),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false, // the tone mapper washes a bright red toward pink / orange: the eyes are drawn straight
      opacity: 0.6,
    });
    this.halo = new THREE.Points(this.haloGeometry, this.haloMaterial);
    this.halo.name = 'EyeHalo';
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 31;
    this.group = new THREE.Group();
    this.group.name = 'EyesMount';
    this.group.add(this.mesh, this.halo);
    this.glow = 0.8;
  }

  mount(parent) {
    if (this.group.parent !== parent) parent.add(this.group);
    this.group.matrixAutoUpdate = false;
    return this;
  }

  follow(world, rootWorld) {
    const m = this.group.matrix;
    if (rootWorld) m.copy(rootWorld).invert().multiply(world);
    else m.copy(world);
    this.group.matrixWorldNeedsUpdate = true;
    return this;
  }

  /** @param {object} snap the clip graph's snapshot; @param {number} t view time (s); @param {boolean} show */
  update(snap, t, show) {
    this.group.visible = !!show;
    if (!show) return;
    const g = eyeGlow(snap, t, this.seed);
    this.glow = g;
    // brighter = more red (never pink or white: the green / blue channels are ~0, so the display shows (255, ~5, ~3)), the halo swells and strengthens
    this.material.color.setRGB(0.6 + 0.55 * g, 0.002, 0.001);
    this.haloMaterial.opacity = clamp(0.4 + 0.45 * g, 0, 1);
    this.haloMaterial.size = EYES.halo * (0.85 + 0.3 * g);
  }

  /** Raises the glow to g this frame (MASON SNAKE ATTACK: the lock flare; the same red, the halo swells). */
  boost(g) {
    if (!(g > this.glow)) return;
    this.glow = g;
    this.material.color.setRGB(0.6 + 0.55 * g, 0.002, 0.001);
    this.haloMaterial.opacity = clamp(0.4 + 0.45 * g, 0, 1);
    this.haloMaterial.size = EYES.halo * (0.85 + 0.3 * g);
  }

  /** Draw calls it costs right now. */
  calls() {
    return this.group.visible ? 2 : 0;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.haloGeometry.dispose();
    this.haloMaterial.dispose();
    this.haloMap.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

/** One row of teeth along x in an arc (a slight smile), each a five-sided cone pointing along `dir` (+1 up, -1 down). Returns a BufferGeometry. */
export function teethRow(dir) {
  const pos = [];
  const nrm = [];
  const idx = [];
  const n = MAW.teeth;
  for (let k = 0; k < n; k++) {
    const u = n === 1 ? 0 : (k / (n - 1)) * 2 - 1; // -1..1 across the mouth
    const x = u * MAW.half;
    const z = -0.18 * (1 - u * u); // the middle of the row sits a little forward
    const h = MAW.tooth * (0.45 + 0.55 * (1 - u * u)) * (k % 2 ? 0.8 : 1);
    const r = 0.17 * (0.7 + 0.3 * (1 - u * u));
    const base = pos.length / 3;
    for (let s = 0; s < 5; s++) {
      const a = (s / 5) * Math.PI * 2;
      pos.push(x + Math.cos(a) * r, 0, z + Math.sin(a) * r * 0.8);
      nrm.push(Math.cos(a), 0.3 * dir, Math.sin(a));
    }
    pos.push(x, dir * h, z);
    nrm.push(0, dir, 0);
    for (let s = 0; s < 5; s++) idx.push(base + s, base + 5, base + ((s + 1) % 5));
    // a floor so no tooth is hollow from below
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2, base, base + 4, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export class Maw {
  /** @param {{variant?: boolean}} [opts] */
  constructor() {
    this.upperGeometry = teethRow(-1); // the upper row points down
    this.lowerGeometry = teethRow(1); // the lower row points up
    this.teethMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.66, 0.6, 0.5), roughness: 0.45, metalness: 0.15 });
    this.upper = new THREE.Mesh(this.upperGeometry, this.teethMaterial);
    this.lower = new THREE.Mesh(this.lowerGeometry, this.teethMaterial);
    this.upper.name = 'MawUpper';
    this.lower.name = 'MawLower';
    // the cavity: a dark disc that glows a dull red toward its middle
    this.cavityGeometry = new THREE.CircleGeometry(1, 24);
    const cp = this.cavityGeometry.getAttribute('position');
    const cc = [];
    for (let i = 0; i < cp.count; i++) {
      const r = Math.min(1, Math.hypot(cp.getX(i), cp.getY(i)));
      const k = (1 - r) * (1 - r);
      cc.push(0.02 + 0.5 * k, 0.0 + 0.02 * k, 0.0 + 0.02 * k);
    }
    this.cavityGeometry.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
    this.cavityMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false, side: THREE.DoubleSide });
    this.cavity = new THREE.Mesh(this.cavityGeometry, this.cavityMaterial);
    this.cavity.name = 'MawCavity';
    this.cavity.rotation.y = Math.PI; // CircleGeometry faces +z; the face looks down -z
    for (const m of [this.upper, this.lower, this.cavity]) m.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.name = 'MawMount';
    this.group.add(this.cavity, this.upper, this.lower);
    this.gape = 0;
    this.vel = 0;
    this._place(0);
  }

  mount(parent) {
    if (this.group.parent !== parent) parent.add(this.group);
    this.group.matrixAutoUpdate = false;
    return this;
  }

  follow(world, rootWorld) {
    const m = this.group.matrix;
    if (rootWorld) m.copy(rootWorld).invert().multiply(world);
    else m.copy(world);
    this.group.matrixWorldNeedsUpdate = true;
    return this;
  }

  _place(g) {
    const gap = MAW.gapClosed + (MAW.gapOpen - MAW.gapClosed) * g;
    this.upper.position.set(0, MAW.y + gap / 2, MAW.z);
    this.lower.position.set(0, MAW.y - gap / 2, MAW.z);
    this.cavity.position.set(0, MAW.y, MAW.z + 0.15);
    this.cavity.scale.set(MAW.half * (0.7 + 0.3 * g), Math.max(0.001, 0.08 + (MAW.gapOpen * 0.5) * g), 1);
    this.cavity.visible = g > 0.03;
  }

  /**
   * @param {number} jaw   the mandibles' opening angle (rad); the maw follows it
   * @param {boolean} show full detail only
   * @param {number} dt
   */
  update(dt, jaw, show) {
    const want = mawOpen(jaw);
    // a damped spring: opens at a moderate rate, slams shut very fast
    const closing = want < this.gape - 0.05;
    const w0 = closing ? 60 : 14;
    const z = closing ? 0.9 : 0.75;
    if (dt > 0) {
      const n = Math.max(1, Math.ceil(dt / 0.008));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        this.vel += (w0 * w0 * (want - this.gape) - 2 * z * w0 * this.vel) * h;
        this.gape += this.vel * h;
      }
    }
    this.gape = clamp(this.gape, 0, 1.05);
    this.group.visible = !!show;
    this._place(clamp(this.gape, 0, 1));
  }

  /** Draw calls it costs right now (the cavity only while the mouth is open). */
  calls() {
    return this.group.visible ? 2 + (this.cavity.visible ? 1 : 0) : 0;
  }

  dispose() {
    this.upperGeometry.dispose();
    this.lowerGeometry.dispose();
    this.cavityGeometry.dispose();
    this.teethMaterial.dispose();
    this.cavityMaterial.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
