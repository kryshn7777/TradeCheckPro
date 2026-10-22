/* ABYSSAL TETHER 3D — ropeView.js
 * One tether per hand, drawn as a thin world-space tube (works in stereo; no
 * screen-space lines) from the launcher's NOZZLE (HandsView.getMuzzle) to the anchor:
 *  - flying: the shot is a projectile (sim: hand.flying / flightFrac). The grapple head flies from the
 *    nozzle to the target on a slightly arcing path trailing smoke while the line pays out behind it
 *    (leaving the nozzle along the barrel, sagging, with a travelling ripple), pulling taut as it nears
 *  - bite: a puff of stone dust + sparks at the anchor, a crack running back down the line, and the
 *    line snapping from its sag to taut over CONFIG.rope.attachRamp (the pull builds up at the same time)
 *  - a muzzle burst (ropeFx.js: flash, smoke jet, sparks) and a hand recoil kick on every shot
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
import { RopeFx } from './ropeFx.js';

/** Math.hypot is ~20× slower than sqrt in V8 and allocates; hot paths use this. */
function hyp(x, y, z = 0) {
  return Math.sqrt(x * x + y * y + z * z);
}


const SEG = 32; // segments along the rope
const RAD = 8; // sides (8: a round silhouette at arm's length; 6 showed facets)
const BASE_R = 0.0065; // metres at the hand
const R_PER_M = 0.0013; // extra radius per metre from the head
const HANDS = ['left', 'right'];
// Twisted-strand look (VR polish): a 3-strand lay computed in the fragment shader from (cos, sin, length) of each ring vertex, so the
// tube needs no UVs or texture. The lay is a faint albedo ridge (+-4 %, 3.6 cm lay length) that fades out beyond 1.5 m and is below a
// pixel by 4.5 m: fibre, not plastic. It is not a derivative-based bump: screen derivatives notch along the grazing silhouette.
const LAY_PER_M = 28;
const STRAND_TINT = 0.08;
const MISS_TIME = (CONFIG.rope && CONFIG.rope.missTime) || 0.24;
const RAMP = (CONFIG.rope && CONFIG.rope.attachRamp) || 0.2;
const SETTLE = RAMP + 0.12; // s after the bite the shape is still driven by the flight model (snap-taut + crack)
const SLACK_FIRE = 0.045; // spare line, as a fraction of the chord, right after the shot
const SLACK_END = 0.004; // ... and as the hook arrives
const HEAD_RINGS = 4; // grapple head: an arrowhead of 4 rings (apex, shoulder, waist, tail)
const HEAD_OFF = [2.4, 0.8, -0.7, -1.5]; // along the flight direction, in head radii
const HEAD_RAD = [0, 1.0, 0.85, 0.3]; // ring radius, in head radii

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
const _hook = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _dirW = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _dn = new THREE.Vector3();

function num(v, fb) {
  return typeof v === 'number' && isFinite(v) ? v : fb;
}

class RopeStrand {
  constructor(scene, hand) {
    this.hand = hand;
    const ropeVerts = (SEG + 1) * RAD;
    const verts = ropeVerts + HEAD_RINGS * RAD;
    this.headBase = ropeVerts * 3;
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
    for (let k = 0; k < HEAD_RINGS - 1; k++) {
      for (let j = 0; j < RAD; j++) {
        const a = ropeVerts + k * RAD + j;
        const b = ropeVerts + k * RAD + ((j + 1) % RAD);
        const c = ropeVerts + (k + 1) * RAD + j;
        const d = ropeVerts + (k + 1) * RAD + ((j + 1) % RAD);
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    this.nrmAttr = new THREE.BufferAttribute(nrm, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('normal', this.nrmAttr);
    this.lenAttr = new THREE.BufferAttribute(new Float32Array(verts * 3), 3); // (cos, sin) around the tube, metres along it
    this.lenAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aRope', this.lenAttr);
    geo.setIndex(idx);
    this.color = new THREE.Color(hand === 'left' ? PALETTE.handLeft : PALETTE.handRight);
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x5a554e,
      roughness: 0.62,
      metalness: 0.3,
      emissive: this.color,
      emissiveIntensity: 0.15,
    });
    this.mat.dithering = true;
    this.mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aRope;\nvarying vec3 vRope;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRope = aRope;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRope;')
        .replace(
          '#include <normal_fragment_maps>',
          `  {
    // three strands twisted along the rope, as a faint lit ridge per strand in the albedo. No screen derivatives here: a bump
    // computed from them notched along the grazing silhouette of the tube.
    float atP = 3.0 * atan( vRope.y, vRope.x ) * 0.159155 + vRope.z * ${LAY_PER_M.toFixed(1)};
    float atH = 0.5 - 0.5 * cos( 6.28318 * atP );
    float atF = step( 0.5, dot( vRope.xy, vRope.xy ) ) * ( 1.0 - smoothstep( 1.5, 4.5, length( vViewPosition ) ) );
    diffuseColor.rgb *= 1.0 + ${STRAND_TINT.toFixed(2)} * ( atH - 0.5 ) * atF;
  }
#include <normal_fragment_maps>`,
        );
    };
    this.mat.customProgramCacheKey = () => 'at3dRopeStrands';
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = `rope_${hand}`;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.sag = 0;
    this.glow = 0;
    this.prevAttached = false;
    this.wasFlying = false;
    this.F = new THREE.Vector3(); // where the hook left the nozzle (world)
    this.fireT = -10; // RopeView.time of the shot
    this.hitT = -1; // RopeView.time of the bite (-1: none / settled)
    this.hook = new THREE.Vector3(); // the hook's current position
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
    const rp = this.lenAttr.array;
    let run = 0;
    for (let i = 0; i <= SEG; i++) {
      if (i > 0) run += hyp(c[i * 3] - c[i * 3 - 3], c[i * 3 + 1] - c[i * 3 - 2], c[i * 3 + 2] - c[i * 3 - 1]);
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
        rp[k] = ca;
        rp[k + 1] = sa;
        rp[k + 2] = run;
      }
    }
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
    this.lenAttr.needsUpdate = true;
  }

  /**
   * The grapple head: an arrowhead at (cx,cy,cz) pointing along (tx,ty,tz), `r` metres wide
   * (0 collapses it to nothing). Writes the extra ring vertices after the rope tube's.
   */
  _head(cx, cy, cz, tx, ty, tz, r, head) {
    const pos = this.posAttr.array;
    const nrm = this.nrmAttr.array;
    const tl = hyp(tx, ty, tz);
    if (tl < 1e-6) {
      tx = 0;
      ty = 0;
      tz = 1;
    } else {
      tx /= tl;
      ty /= tl;
      tz /= tl;
    }
    _t.set(tx, ty, tz);
    if (Math.abs(ty) < 0.9) _ref.set(0, 1, 0);
    else _ref.set(1, 0, 0);
    _b.crossVectors(_t, _ref).normalize();
    _n.crossVectors(_b, _t);
    // wider with the distance from the eyes so it still reads at 25 m
    const rr = r * (1 + Math.max(0, hyp(cx - head.x, cy - head.y, cz - head.z) - 1.5) * 0.045);
    for (let k = 0; k < HEAD_RINGS; k++) {
      const ox = cx + tx * HEAD_OFF[k] * rr;
      const oy = cy + ty * HEAD_OFF[k] * rr;
      const oz = cz + tz * HEAD_OFF[k] * rr;
      const rad = HEAD_RAD[k] * rr;
      for (let j = 0; j < RAD; j++) {
        const ang = ((j + 0.5) / RAD) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const nx = _n.x * ca + _b.x * sa;
        const ny = _n.y * ca + _b.y * sa;
        const nz = _n.z * ca + _b.z * sa;
        const o = this.headBase + (k * RAD + j) * 3;
        pos[o] = ox + nx * rad;
        pos[o + 1] = oy + ny * rad;
        pos[o + 2] = oz + nz * rad;
        // slanted normal: the apex cone faces forward, the tail faces back
        const f = k === 0 ? 0.7 : k === HEAD_RINGS - 1 ? -0.7 : 0.15;
        nrm[o] = nx + tx * f;
        nrm[o + 1] = ny + ty * f;
        nrm[o + 2] = nz + tz * f;
      }
    }
  }

  /**
   * A shot in the air (f < 1) or just bitten (f = 1, tAfter s since the bite): an analytic line from the
   * nozzle h to the hook: a quadratic Bezier that leaves the nozzle along `dir` and finds the hook, the sag
   * of the spare line (it pulls taut as the hook nears / over the attach ramp), a travelling ripple (the
   * launch) and, after the bite, a crack running back down the line.
   * @param dir unit barrel direction or null; F where the hook left the nozzle; a the anchor
   */
  chain(h, dir, F, a, f, tAfter, time, dt, head) {
    const tFly = time - this.fireT;
    // The hook: a straight line from where it left, lifted into a shallow arc.
    if (f < 1) {
      const arc = Math.min(0.9, 0.025 * hyp(a.x - F.x, a.y - F.y, a.z - F.z)) * 4 * f * (1 - f);
      _hook.set(F.x + (a.x - F.x) * f, F.y + (a.y - F.y) * f + arc, F.z + (a.z - F.z) * f);
    } else _hook.copy(a);
    this.hook.copy(_hook);
    _chord.subVectors(_hook, h);
    const D = Math.max(_chord.length(), 1e-4);
    _chord.multiplyScalar(1 / D);
    // spare line → sag (parabolic arc-length approximation), tightening
    let slack;
    if (f < 1) slack = SLACK_FIRE * Math.pow(1 - f, 1.5) + SLACK_END;
    else {
      const u = Math.min(1, Math.max(0, tAfter / RAMP));
      slack = SLACK_END * (1 - u * u * (3 - 2 * u));
    }
    const sagAmp = Math.min(D * 0.3, D * Math.sqrt((3 * slack) / 8));
    _sag.set(0, -1, 0).addScaledVector(_chord, _chord.y);
    if (_sag.lengthSq() < 1e-6) _sag.set(0, 0, 0);
    else _sag.normalize();
    _hum.crossVectors(_chord, _sag.lengthSq() > 0 ? _sag : _ref.set(1, 0, 0));
    if (_hum.lengthSq() < 1e-6) _hum.set(1, 0, 0);
    _hum.normalize();
    // Bezier control point: leaves along the barrel at first, straight (the chord's midpoint) once the shot is home
    _mid.copy(h).addScaledVector(_chord, D * 0.5);
    _p1.copy(_mid);
    if (dir) {
      const w = f < 1 ? 1 - f * f * (3 - 2 * f) : 0;
      _p1.x += (h.x + dir.x * D * 0.5 - _mid.x) * w;
      _p1.y += (h.y + dir.y * D * 0.5 - _mid.y) * w;
      _p1.z += (h.z + dir.z * D * 0.5 - _mid.z) * w;
    }
    // ripple (launch) and crack (bite)
    const rippleAmp = Math.min(0.12, 0.05 * Math.min(1, D / 5)) * Math.exp(-tFly * 1.4);
    const crack = tAfter >= 0 ? Math.min(0.2, 0.16 * Math.min(1, D / 6)) * Math.exp(-tAfter * 7) : 0;
    const front = tAfter >= 0 ? 1 - tAfter / 0.22 : -9;
    const c = this.centre;
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG;
      const q = 1 - s;
      const b0 = q * q;
      const b1 = 2 * s * q;
      const b2 = s * s;
      const bell = 4 * s * q;
      const env = Math.pow(Math.sin(Math.PI * s), 0.6);
      const ph = Math.PI * 2 * (2.2 * s - 2.8 * tFly);
      let w1 = rippleAmp * env * Math.sin(ph);
      let w2 = rippleAmp * env * 0.7 * Math.cos(ph);
      if (crack > 0.001) {
        const d = (s - front) / 0.1;
        const g = Math.exp(-d * d) * crack;
        w1 += g * Math.cos(Math.PI * 2 * 5 * (s - front));
        w2 += g * 0.5 * Math.sin(Math.PI * 2 * 5 * (s - front));
      }
      const sg = sagAmp * bell + w2;
      c[i * 3] = b0 * h.x + b1 * _p1.x + b2 * _hook.x + _sag.x * sg + _hum.x * w1;
      c[i * 3 + 1] = b0 * h.y + b1 * _p1.y + b2 * _hook.y + _sag.y * sg + _hum.y * w1;
      c[i * 3 + 2] = b0 * h.z + b1 * _p1.z + b2 * _hook.z + _sag.z * sg + _hum.z * w1;
      this.radius[i] = 1;
    }
    this.radius[SEG] = 0.8;
    this._tube(head);
    // the hook points along the last stretch of line
    _dn.set(c[SEG * 3] - c[(SEG - 1) * 3], c[SEG * 3 + 1] - c[(SEG - 1) * 3 + 1], c[SEG * 3 + 2] - c[(SEG - 1) * 3 + 2]);
    this._head(_hook.x, _hook.y, _hook.z, _dn.x, _dn.y, _dn.z, 0.024, head);
    this.sag = 0;
    this.glow = 0;
    const flash = tAfter >= 0 ? 0.9 * Math.exp(-tAfter * 14) + 0.25 * Math.exp(-tAfter * 6) : 0.55;
    this.mat.emissiveIntensity = 0.035 + flash;
    this.mesh.visible = true;
    void dt;
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
    this._head(c[SEG * 3], c[SEG * 3 + 1], c[SEG * 3 + 2], c[SEG * 3] - c[(SEG - 1) * 3], c[SEG * 3 + 1] - c[(SEG - 1) * 3 + 1], c[SEG * 3 + 2] - c[(SEG - 1) * 3 + 2], 0.024, head);
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
    this._head(c[SEG * 3], c[SEG * 3 + 1], c[SEG * 3 + 2], c[SEG * 3] - c[(SEG - 1) * 3], c[SEG * 3 + 1] - c[(SEG - 1) * 3 + 1], c[SEG * 3 + 2] - c[(SEG - 1) * 3 + 2], 0.024 * (L > 0.05 ? 1 : 0), head);
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
    this.hitT = -1;
    this.wasFlying = false;
  }
}

export class RopeView {
  constructor(scene) {
    this.scene = scene;
    this.strands = { left: new RopeStrand(scene, 'left'), right: new RopeStrand(scene, 'right') };
    this.fx = new RopeFx(scene);
    this.time = 0;
    this._hand = new THREE.Vector3();
    this._anchor = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._bus = null;
    this._busOff = [];
    // one-shot notes from the bus, consumed by the next update (the muzzle pose is read then, not mid-step)
    this._pend = {
      left: { fire: 0, hit: false, nx: 0, ny: 1, nz: 0 },
      right: { fire: 0, hit: false, nx: 0, ny: 1, nz: 0 },
    };
  }

  _bind(bus) {
    for (const off of this._busOff) if (typeof off === 'function') off();
    this._busOff.length = 0;
    this._bus = bus;
    if (!bus || typeof bus.on !== 'function') return;
    const on = (type, fn) => this._busOff.push(bus.on(type, fn));
    on('rope:fire', (e) => {
      const p = e && this._pend[e.hand];
      if (p) p.fire = e.target ? 1 : 0.6;
    });
    on('rope:hit', (e) => {
      const p = e && this._pend[e.hand];
      if (!p) return;
      p.hit = true;
      const n = e.normal;
      if (n) {
        p.nx = num(n.x, 0);
        p.ny = num(n.y, 1);
        p.nz = num(n.z, 0);
      }
    });
  }

  /**
   * Where a hand's line starts and which way the barrel points: HandsView.getMuzzle (the launcher's nozzle)
   * when it exists, else the older muzzlePosition / input pose (no direction: `dir` is zeroed).
   * Returns true when `dir` holds a unit barrel direction.
   */
  muzzle(game, hand, pos, dir) {
    const hv = game && game.handsView;
    dir.set(0, 0, 0);
    if (hv && typeof hv.getMuzzle === 'function') {
      try {
        hv.getMuzzle(hand, pos, dir); // (true: the GLB nozzle; false: the grip pose and its forward axis)
        const dl = dir.length();
        if (isFinite(pos.x + pos.y + pos.z) && isFinite(dl) && dl > 0.5) {
          dir.multiplyScalar(1 / dl);
          return true;
        }
      } catch {
        // fall through
      }
      dir.set(0, 0, 0);
    }
    this.handPosition(game, hand, pos);
    return false;
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
    if (game && game.bus && game.bus !== this._bus) this._bind(game.bus);
    for (const h of HANDS) {
      const strand = this.strands[h];
      const st = hands ? hands[h] : null;
      const pend = this._pend[h];
      if (!st || !pl) {
        strand.hide();
        pend.fire = 0;
        pend.hit = false;
        continue;
      }
      const alive = pl.alive !== false;
      const rope = st.rope;
      const anchor = rope ? rope.anchor : null;
      const hook = st.flying && st.flightObj ? st.flightObj.target : null;
      const fireNow = pend.fire > 0 || (!!hook && !strand.wasFlying);
      if (alive && (anchor || hook || st.miss || fireNow)) {
        const hasDir = this.muzzle(game, h, this._hand, this._dir);
        if (fireNow) this._shot(game, h, strand, hook, pend.fire > 0 ? pend.fire : 1, hasDir);
        if (hook) {
          // in the air: the hook flies, the line pays out behind it
          this._anchor.set(hook.x, hook.y, hook.z);
          strand.chain(this._hand, hasDir ? this._dir : null, strand.F, this._anchor, num(st.flightFrac, 0), -1, this.time, dt, head);
          this.fx.trail(h, strand.hook.x, strand.hook.y, strand.hook.z, dt);
        } else if (anchor) {
          this._anchor.set(anchor.x, anchor.y, anchor.z);
          if (pend.hit || (strand.wasFlying && strand.hitT < 0)) this._bite(h, strand, pl, anchor, pend);
          if (strand.hitT >= 0 && this.time - strand.hitT < SETTLE) {
            strand.chain(this._hand, null, strand.F, this._anchor, 1, this.time - strand.hitT, this.time, dt, head);
          } else {
            strand.hitT = -1;
            const px = num(pl.rx, pl.x);
            const py = num(pl.ry, pl.y);
            const pz = num(pl.rz, pl.z);
            const dBody = hyp(px - anchor.x, py - anchor.y, pz - anchor.z);
            const slack = Math.max(0, num(rope.length, dBody) - dBody);
            strand.attached(this._hand, this._anchor, num(st.extend, 1), slack, num(rope.tension, 0), dt, this.time, head);
          }
        } else if (st.miss) {
          strand.miss(this._hand, st.miss, this.time, head);
        } else strand.hide();
      } else {
        strand.hide();
      }
      strand.wasFlying = !!hook;
      pend.fire = 0;
      pend.hit = false;
    }
    this.fx.update(dt, head, !!(game && game.settings && game.settings.reducedEffects));
  }

  /** A shot leaves the nozzle: capture where, burst, kick the hand. */
  _shot(game, hand, strand, hook, power, hasDir) {
    strand.F.copy(this._hand);
    strand.fireT = this.time;
    strand.hitT = -1;
    const d = this._dir;
    if (!hasDir) {
      // no barrel direction: aim at the target (or straight ahead)
      if (hook) d.set(hook.x - this._hand.x, hook.y - this._hand.y, hook.z - this._hand.z);
      else d.set(0, 0, -1);
      if (d.lengthSq() < 1e-8) d.set(0, 0, -1);
      d.normalize();
    }
    this.fx.muzzleBurst(this._hand.x, this._hand.y, this._hand.z, d.x, d.y, d.z, power);
    const hv = game && game.handsView;
    if (hv && typeof hv.onFire === 'function') {
      try {
        hv.onFire(hand, 0.9);
      } catch {
        // the recoil is a nicety
      }
    }
  }

  /** The hook bites: dust, sparks and chips at the anchor; the line starts its snap-taut / crack. */
  _bite(hand, strand, pl, anchor, pend) {
    strand.hitT = this.time;
    let nx = pend.nx;
    let ny = pend.ny;
    let nz = pend.nz;
    if (!pend.hit) {
      nx = num(pl.rx, pl.x) - anchor.x;
      ny = num(pl.ry, pl.y) - anchor.y;
      nz = num(pl.rz, pl.z) - anchor.z;
    }
    this.fx.impactBurst(anchor.x, anchor.y, anchor.z, nx, ny, nz);
  }

  dispose() {
    for (const off of this._busOff) if (typeof off === 'function') off();
    this._busOff.length = 0;
    for (const h of HANDS) this.strands[h].dispose();
    this.fx.dispose();
  }
}
