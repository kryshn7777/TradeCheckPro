/* ABYSSAL TETHER 3D — ropeView.js
 * One tether per hand, drawn as a thin world-space tube (works in stereo; no
 * screen-space lines) from the hand pose to the anchor:
 *  - firing: the tip travels out with tethers.hands[h].extend (0..1)
 *  - slack: a parabolic (catenary-ish) sag perpendicular to the chord, sized
 *    from the spare rope length, eased so it never pops
 *  - taut: straight, a faint hum, and an emissive glow ∝ rope tension
 *  - miss: the line whips out along the aim and snaps back
 * Thickness grows a little with distance from the head so a 30 m line still
 * reads instead of shimmering below a pixel. One draw call per visible hand;
 * geometry buffers are rewritten in place (no per-frame allocation).
 */

import * as THREE from 'three';
import { CONFIG } from '../sim/config3d.js';
import { PALETTE } from './materials.js';

/** Math.hypot is ~20× slower than sqrt in V8 and allocates; hot paths use this. */
function hyp(x, y, z = 0) {
  return Math.sqrt(x * x + y * y + z * z);
}


const SEG = 32; // segments along the rope
const RAD = 6; // sides
const BASE_R = 0.0065; // metres at the hand
const R_PER_M = 0.0013; // extra radius per metre from the head
const HANDS = ['left', 'right'];
const MISS_TIME = (CONFIG.rope && CONFIG.rope.missTime) || 0.24;

const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _chord = new THREE.Vector3();
const _sag = new THREE.Vector3();
const _hum = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ref = new THREE.Vector3();
const _fallbackPose = { x: 0, y: 0, z: 0 };

function num(v, fb) {
  return typeof v === 'number' && isFinite(v) ? v : fb;
}

class RopeStrand {
  constructor(scene, hand) {
    this.hand = hand;
    const verts = (SEG + 1) * RAD;
    this.centre = new Float32Array((SEG + 1) * 3);
    this.radius = new Float32Array(SEG + 1);
    const pos = new Float32Array(verts * 3);
    const nrm = new Float32Array(verts * 3);
    const idx = [];
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < RAD; j++) {
        const a = i * RAD + j;
        const b = i * RAD + ((j + 1) % RAD);
        const c = (i + 1) * RAD + j;
        const d = (i + 1) * RAD + ((j + 1) % RAD);
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    this.nrmAttr = new THREE.BufferAttribute(nrm, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('normal', this.nrmAttr);
    geo.setIndex(idx);
    this.color = new THREE.Color(hand === 'left' ? PALETTE.handLeft : PALETTE.handRight);
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x5a554e,
      roughness: 0.5,
      metalness: 0.35,
      emissive: this.color,
      emissiveIntensity: 0.15,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = `rope_${hand}`;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.sag = 0;
    this.glow = 0;
    this.prevAttached = false;
  }

  dispose() {
    this.mesh.parent && this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }

  /** Rebuilds ring vertices around the centreline. */
  _tube(head) {
    const c = this.centre;
    const pos = this.posAttr.array;
    const nrm = this.nrmAttr.array;
    for (let i = 0; i <= SEG; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(SEG, i + 1);
      _t.set(c[i1 * 3] - c[i0 * 3], c[i1 * 3 + 1] - c[i0 * 3 + 1], c[i1 * 3 + 2] - c[i0 * 3 + 2]);
      if (_t.lengthSq() < 1e-12) _t.set(0, 1, 0);
      _t.normalize();
      if (Math.abs(_t.y) < 0.9) _ref.set(0, 1, 0);
      else _ref.set(1, 0, 0);
      _b.crossVectors(_t, _ref).normalize();
      _n.crossVectors(_b, _t);
      const cx = c[i * 3];
      const cy = c[i * 3 + 1];
      const cz = c[i * 3 + 2];
      const dh = hyp(cx - head.x, cy - head.y, cz - head.z);
      const r = this.radius[i] * (BASE_R + Math.max(0, dh - 0.6) * R_PER_M);
      for (let j = 0; j < RAD; j++) {
        const ang = (j / RAD) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const nx = _n.x * ca + _b.x * sa;
        const ny = _n.y * ca + _b.y * sa;
        const nz = _n.z * ca + _b.z * sa;
        const k = (i * RAD + j) * 3;
        pos[k] = cx + nx * r;
        pos[k + 1] = cy + ny * r;
        pos[k + 2] = cz + nz * r;
        nrm[k] = nx;
        nrm[k + 1] = ny;
        nrm[k + 2] = nz;
      }
    }
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
  }

  /**
   * Attached / firing rope.
   * @param h hand origin, a anchor, extend 0..1, slack metres (≥0), tension m/s²
   */
  attached(h, a, extend, slack, tension, dt, time, head) {
    _chord.subVectors(a, h);
    const full = _chord.length();
    const e = Math.max(0.02, Math.min(1, extend));
    const D = full * e;
    // sag from spare length (parabolic arc-length approximation)
    const targetSag = e >= 1 ? Math.min(Math.sqrt((3 * Math.max(D, 0.1) * Math.max(0, slack)) / 8), D * 0.45) : 0;
    const rate = targetSag > this.sag ? 6 : 14;
    this.sag += (targetSag - this.sag) * (1 - Math.exp(-rate * dt));
    // tension glow
    const g = THREE.MathUtils.clamp((tension - 8) / 40, 0, 1) * (slack > 0.15 ? 0.3 : 1);
    this.glow += (g - this.glow) * (1 - Math.exp(-10 * dt));
    // sag direction: gravity minus its component along the chord
    if (full > 1e-4) _chord.multiplyScalar(1 / full);
    else _chord.set(0, -1, 0);
    _sag.set(0, -1, 0).addScaledVector(_chord, _chord.y);
    if (_sag.lengthSq() < 1e-6) _sag.set(0, 0, 0);
    else _sag.normalize();
    // hum: tiny transverse vibration when hard taut
    _hum.crossVectors(_chord, _sag.lengthSq() > 0 ? _sag : _ref.set(1, 0, 0));
    if (_hum.lengthSq() < 1e-6) _hum.set(1, 0, 0);
    _hum.normalize();
    const humAmp = this.glow > 0.4 ? (this.glow - 0.4) * 0.012 : 0;
    const c = this.centre;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const bell = 4 * t * (1 - t);
      const s = this.sag * bell;
      const hm = humAmp * Math.sin(Math.PI * t) * Math.sin(time * 190 + t * 3);
      // firing: a slight travelling ripple toward the tip
      const rip = e < 1 ? Math.sin(t * 18 - time * 60) * 0.03 * t * (1 - e) : 0;
      c[i * 3] = h.x + _chord.x * D * t + _sag.x * s + _hum.x * (hm + rip);
      c[i * 3 + 1] = h.y + _chord.y * D * t + _sag.y * s + _hum.y * (hm + rip);
      c[i * 3 + 2] = h.z + _chord.z * D * t + _sag.z * s + _hum.z * (hm + rip);
      this.radius[i] = 1;
    }
    this.radius[SEG] = e < 1 ? 1.8 : 1.15; // tether head / clamp at the anchor
    this._tube(head);
    this.mat.emissiveIntensity = 0.035 + this.glow * this.glow * 0.8 + (e < 1 ? 0.6 : 0);
    this.mesh.visible = true;
  }

  /** Missed shot: out along the aim, then whip back and droop. */
  miss(h, miss, time, head) {
    const u = THREE.MathUtils.clamp(miss.t / MISS_TIME, 0, 1);
    let L;
    if (u < 0.45) {
      const k = u / 0.45;
      L = miss.len * (1 - (1 - k) * (1 - k));
    } else {
      const k = (u - 0.45) / 0.55;
      L = miss.len * (1 - k * k);
    }
    _chord.set(miss.dx, miss.dy, miss.dz);
    if (_chord.lengthSq() < 1e-8) _chord.set(0, 0, -1);
    _chord.normalize();
    _sag.set(0, -1, 0).addScaledVector(_chord, _chord.y);
    if (_sag.lengthSq() < 1e-6) _sag.set(1, 0, 0);
    _sag.normalize();
    _hum.crossVectors(_chord, _sag).normalize();
    const whip = u > 0.3 ? (u - 0.3) * 1.2 : 0;
    const droop = u > 0.45 ? (u - 0.45) * 0.9 * L * 0.25 : 0;
    const c = this.centre;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const wave = Math.sin(t * 9 - u * 26) * t * whip * 0.9;
      const s = droop * t * t;
      c[i * 3] = h.x + _chord.x * L * t + _hum.x * wave + _sag.x * s;
      c[i * 3 + 1] = h.y + _chord.y * L * t + _hum.y * wave + _sag.y * s;
      c[i * 3 + 2] = h.z + _chord.z * L * t + _hum.z * wave + _sag.z * s;
      this.radius[i] = 1 - t * 0.3;
    }
    this.radius[SEG] = 1.5;
    this._tube(head);
    this.mat.emissiveIntensity = 0.5 * (1 - u) + 0.08;
    this.mesh.visible = L > 0.05;
    this.sag = 0;
    this.glow = 0;
    void time;
  }

  hide() {
    this.mesh.visible = false;
    this.sag = 0;
    this.glow = 0;
  }
}

export class RopeView {
  constructor(scene) {
    this.scene = scene;
    this.strands = { left: new RopeStrand(scene, 'left'), right: new RopeStrand(scene, 'right') };
    this.time = 0;
    this._hand = new THREE.Vector3();
    this._anchor = new THREE.Vector3();
  }

  /**
   * Where a hand's line starts: the launcher's muzzle (HandsView.muzzlePosition, the GLB's
   * muzzle crown) when the hands model is up, else input.handPose, else near the body.
   */
  handPosition(game, hand, out) {
    const input = game && game.input;
    const hv = game && game.handsView;
    if (hv && typeof hv.muzzlePosition === 'function') {
      try {
        if (hv.muzzlePosition(hand, out) && isFinite(out.x) && isFinite(out.y) && isFinite(out.z)) return out;
      } catch {
        // fall through to the input pose
      }
    }
    let pose = null;
    if (input && typeof input.handPose === 'function') {
      try {
        pose = input.handPose(hand);
      } catch {
        pose = null;
      }
    }
    if (pose && isFinite(pose.x) && isFinite(pose.y) && isFinite(pose.z)) return out.set(pose.x, pose.y, pose.z);
    const pl = game && game.player;
    const p = pl ? _fallbackPose : null;
    if (p) {
      p.x = num(pl.rx, num(pl.x, 0));
      p.y = num(pl.ry, num(pl.y, 0));
      p.z = num(pl.rz, num(pl.z, 0));
      return out.set(p.x + (hand === 'left' ? -0.22 : 0.22), p.y + 0.15, p.z);
    }
    return out.set(0, 0, 0);
  }

  update(dt, game, head) {
    this.time += dt;
    const tethers = game && game.tethers;
    const hands = tethers && tethers.hands;
    const pl = game && game.player;
    for (const h of HANDS) {
      const strand = this.strands[h];
      const st = hands ? hands[h] : null;
      if (!st || !pl) {
        strand.hide();
        continue;
      }
      const rope = st.rope;
      const anchor = rope ? rope.anchor : null;
      if (anchor && pl.alive !== false) {
        this.handPosition(game, h, this._hand);
        this._anchor.set(anchor.x, anchor.y, anchor.z);
        const px = num(pl.rx, pl.x);
        const py = num(pl.ry, pl.y);
        const pz = num(pl.rz, pl.z);
        const dBody = hyp(px - anchor.x, py - anchor.y, pz - anchor.z);
        const slack = Math.max(0, num(rope.length, dBody) - dBody);
        strand.attached(this._hand, this._anchor, num(st.extend, 1), slack, num(rope.tension, 0), dt, this.time, head);
      } else if (st.miss && pl.alive !== false) {
        this.handPosition(game, h, this._hand);
        strand.miss(this._hand, st.miss, this.time, head);
      } else {
        strand.hide();
      }
    }
  }

  dispose() {
    for (const h of HANDS) this.strands[h].dispose();
  }
}
