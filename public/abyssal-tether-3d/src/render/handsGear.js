/* ABYSSAL TETHER 3D — handsGear.js
 * The player's gloved arms + tether launchers from assets/models/player_arms.glb
 * (tools/abyssal-tether-3d/build_hands.py), driven by HandsView.
 *
 * GLB layout (glTF y-up; every side root is authored in the hand-SOCKET frame, so
 * it is parented to input.handSocket(hand) with an identity transform: origin =
 * the centre of the fist on the launcher handle, −Z = barrel / aim, +Y = up):
 *   Arm_L / Arm_R                     side root
 *     Arm_X_Armature                  17 bones: Forearm, Hand, {Thumb,Index,Middle,Ring,Pinky}{1,2,3}
 *       Arm_X_Mesh (+ _LOD1)          the skinned glove + sleeve
 *     Launcher_X_Rig                  6 bones: Body (root), Drum, Needle, Slide, Head (child of Slide), Trigger
 *       Launcher_X_Mesh (+ _LOD1)     the skinned launcher (named parts: see README)
 *     Muzzle_X                        rope origin (the muzzle crown opening)
 *     LanternHook_X (left: lantern bail), WristHUD_X
 *   GrappleHead                       the loose barbed head (origin = the seat in the muzzle, tip at −Z)
 *   Lantern (+ Lantern_Socket)        the carried lantern (origin = the bail, hangs along −Y; socket = glass core)
 *   Animations Open_/Grip_/Trigger_/Point_ + L/R: one pose each (frame 0 = the bone-local rotations)
 *
 * Moving parts, axes in the SOCKET frame (glTF coordinates; the left side mirrors x):
 *   Drum     rotates about +X   (+angle = the line pays out: the drum bottom moves toward the muzzle)
 *   Needle   rotates about the gauge normal (−0.34, 0.80, 0.50), mirrored on the left; rest = 12 o'clock,
 *            the dial runs −135° … +135° clockwise over 0 … 5.5 g (red zone from 80 %)
 *   Trigger  rotates about +X   (−angle = pulled; ≈ 12° at full pull)
 *   Slide    translates along the barrel (−Z); +Z = recoil, travel 14 mm; carries the Head bone
 *   Head     the grapple head seated in the muzzle; scaled to 0 while the line is out (the loose
 *            GrappleHead mesh flies / sticks instead)
 * Axes are converted to each bone's parent frame at load, so no bone roll is assumed.
 */

import { Color, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three';

export const GEAR_URL = new URL('../../assets/models/player_arms.glb', import.meta.url).href;

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const POSES = ['Open', 'Grip', 'Trigger', 'Point'];

export const GEAR_TUNING = {
  drumRadius: 0.0255, // wound cable radius (m): line speed / this = drum rad/s
  drumMaxRate: 30, // rad/s drawn at most (above this a drum looks like a strobe)
  needleMaxG: 5.5, // rope.tension is capped near this many g
  triggerPull: (12 * Math.PI) / 180,
  recoilTravel: 0.014, // slide travel (m)
  recoilKick: 0.55, // m/s impulse on firing
  recoilK: 1100, // slide spring (1/s²)
  recoilC: 46, // slide damping (1/s)
  needleOmega: 26, // needle spring (rad/s)
  needleZeta: 0.42,
  vibrateStart: 0.55, // normalised load where the frame starts to hum
  vibrateAmp: 0.0007, // m of frame shake at full load
};

const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _ax = new Vector3();
const _rest = new Quaternion();

/** Product of the local rotations from `root` (excluded) down to `node` (included). */
function chainQuat(node, root, out) {
  out.identity();
  const chain = [];
  for (let n = node; n && n !== root; n = n.parent) chain.push(n);
  for (let i = chain.length - 1; i >= 0; i--) out.multiply(chain[i].quaternion);
  return out;
}

/** Loads the GLB (GLTFLoader imported lazily so a missing loader only costs the fallback hands). */
export function loadGearGLTF(url = GEAR_URL) {
  return import('three/addons/loaders/GLTFLoader.js').then(
    (M) =>
      new Promise((resolve, reject) => {
        new M.GLTFLoader().load(url, resolve, undefined, reject);
      }),
  );
}

/** One launcher-bone driver: converts a socket-space axis into the bone's parent frame once. */
class BoneDriver {
  constructor(node, root, axisSocket) {
    this.node = node;
    this.restQ = node.quaternion.clone();
    this.restP = node.position.clone();
    this.restS = node.scale.clone();
    const pw = chainQuat(node.parent, root, new Quaternion()); // parent's rest rotation in socket space
    this.axisLocal = axisSocket.clone().normalize().applyQuaternion(pw.invert()); // axis in the parent's frame
  }

  rotate(angle) {
    _q.setFromAxisAngle(this.axisLocal, angle);
    this.node.quaternion.copy(_q).multiply(this.restQ);
  }

  slide(dist) {
    this.node.position.copy(this.restP).addScaledVector(this.axisLocal, dist);
  }

  reset() {
    this.node.quaternion.copy(this.restQ);
    this.node.position.copy(this.restP);
    this.node.scale.copy(this.restS);
  }
}

/** Everything about one side: finger blending + launcher mechanics. */
export class HandGear {
  /**
   * @param {'left'|'right'} hand
   * @param {Object3D} root the Arm_L / Arm_R node
   * @param {Map<string, Map<string, Quaternion>>} poses pose → bone → local rotation
   * @param {MeshStandardMaterial} material per-hand clone (emissive tint driven here)
   */
  constructor(hand, root, poses, material, tuning) {
    this.hand = hand;
    this.root = root;
    this.T = tuning;
    this.material = material;
    const sfx = hand === 'left' ? 'L' : 'R';
    const sg = hand === 'left' ? -1 : 1;
    this.meshes = [];
    root.traverse((o) => {
      if (o.isMesh) {
        if (/_LOD1$/.test(o.name)) {
          o.visible = false; // LOD1 is for far/low tiers; hands are always inside 1 m
          return;
        }
        o.material = material;
        o.frustumCulled = false;
        o.castShadow = false;
        o.receiveShadow = false;
        this.meshes.push(o);
      }
    });
    this.armMesh = root.getObjectByName(`Arm_${sfx}_Mesh`) || null;
    this.launcherMesh = root.getObjectByName(`Launcher_${sfx}_Mesh`) || null;
    this.muzzle = root.getObjectByName(`Muzzle_${sfx}`) || null;
    this.hook = root.getObjectByName(`LanternHook_${sfx}`) || null;
    this.wristHud = root.getObjectByName(`WristHUD_${sfx}`) || null;

    // --- finger bones + pose rotations ------------------------------------------------
    this.fingerBones = [];
    for (const f of FINGERS) {
      for (let i = 1; i <= 3; i++) {
        const node = root.getObjectByName(`${f}${i}_${sfx}`);
        if (node) this.fingerBones.push({ finger: f, node, key: `${f}${i}` });
      }
    }
    this.pose = {};
    for (const p of POSES) {
      const m = poses.get(`${p}_${sfx}`) || new Map();
      this.pose[p] = m;
    }
    this._fingerW = { Thumb: 0, Index: 0, Middle: 0, Ring: 0, Pinky: 0 }; // smoothed grip per finger
    this._fingerRate = { Thumb: 11, Index: 16, Middle: 15, Ring: 13, Pinky: 11.5 };
    this._trig = 0;
    this._point = 0;

    // --- launcher drivers --------------------------------------------------------------
    const bone = (n) => root.getObjectByName(`${n}_${sfx}`);
    const X = new Vector3(1, 0, 0);
    const gauge = new Vector3(-0.34 * sg, 0.8, 0.5);
    const back = new Vector3(0, 0, 1);
    this.drum = bone('Drum') ? new BoneDriver(bone('Drum'), root, X) : null;
    this.needle = bone('Needle') ? new BoneDriver(bone('Needle'), root, gauge) : null;
    this.trigger = bone('Trigger') ? new BoneDriver(bone('Trigger'), root, X) : null;
    this.slide = bone('Slide') ? new BoneDriver(bone('Slide'), root, back) : null;
    this.body = bone('Body') ? new BoneDriver(bone('Body'), root, back) : null;
    this.head = bone('Head') || null;
    this.headRestScale = this.head ? this.head.scale.clone() : null;

    // --- mechanics state ---------------------------------------------------------------
    this.drumAngle = 0;
    this.needleAngle = 0;
    this.needleVel = 0;
    this.slideX = 0;
    this.slideV = 0;
    this.headOut = false;
    this.vibe = 0;
    this._t = Math.random() * 10;
    this.tension = 0; // smoothed m/s² (HandsView sets the input, we animate)
  }

  /** The head leaves (true) or returns to (false) the muzzle. */
  setHeadOut(out, kick = 1) {
    if (out === this.headOut) return;
    this.headOut = out;
    if (this.head) {
      if (out) this.head.scale.setScalar(0.0001);
      else this.head.scale.copy(this.headRestScale);
    }
    // firing kicks the slide back; re-seating nudges it forward (a small clunk)
    this.slideV += out ? this.T.recoilKick * kick : -this.T.recoilKick * 0.35;
  }

  /**
   * Blends the glove's pose from the analog inputs.
   * @param {number} dt
   * @param {number} squeeze 0..1 grip button
   * @param {number} trigger 0..1 trigger button
   * @param {number} point 0..1 how much the index finger is lifted off the lever (needs squeeze)
   */
  poseFingers(dt, squeeze, trigger, point) {
    const W = this._fingerW;
    for (const f of FINGERS) {
      const rate = this._fingerRate[f];
      W[f] += (squeeze - W[f]) * (1 - Math.exp(-rate * dt));
    }
    this._trig += (trigger - this._trig) * (1 - Math.exp(-28 * dt));
    this._point += (point - this._point) * (1 - Math.exp(-14 * dt));
    const t = this._trig;
    const pt = this._point;
    const open = this.pose.Open;
    const grip = this.pose.Grip;
    const trg = this.pose.Trigger;
    const pnt = this.pose.Point;
    for (let i = 0; i < this.fingerBones.length; i++) {
      const { finger, node, key } = this.fingerBones[i];
      const qo = open.get(key);
      const qg = grip.get(key);
      if (!qo || !qg) continue;
      const s = W[finger];
      if (finger === 'Index') {
        const qp = pnt.get(key) || qg;
        const qt = trg.get(key) || qg;
        // free index: open → pointing as the grip closes
        _q.copy(qo).slerp(qp, s);
        // held index: resting on the lever → pulled
        _q2.copy(qg).slerp(qt, t);
        // lever contact: the pull always wins, a closed grip rests the finger on the lever unless it is lifted
        const h = Math.max(t, s * (1 - pt));
        _q.slerp(_q2, h);
        node.quaternion.copy(_q);
      } else if (finger === 'Thumb') {
        const qp = pnt.get(key) || qg;
        _q2.copy(qg).slerp(qp, pt);
        node.quaternion.copy(qo).slerp(_q2, s);
      } else {
        node.quaternion.copy(qo).slerp(qg, s);
      }
    }
  }

  /**
   * Launcher mechanics.
   * @param {number} dt
   * @param {object} m { trigger 0..1, tension m/s² (0 when not attached), pay m/s of line leaving (+) or
   *   returning (−) the drum, slip m/s (>=0), gravity m/s² }
   */
  animate(dt, m) {
    const T = this.T;
    this._t += dt;
    const g = m.gravity || 9.81;
    // trigger lever follows the finger
    if (this.trigger) this.trigger.rotate(-T.triggerPull * m.trigger);

    // gauge needle: damped spring toward the load, a little tremble while the line is loaded
    const load = Math.min(1, Math.max(0, m.tension / (g * T.needleMaxG)));
    const target = -135 + 270 * load;
    const tremble = load > 0.02 ? Math.sin(this._t * 61) * 1.1 * load + Math.sin(this._t * 37 + 1.7) * 0.8 : 0;
    const w = T.needleOmega;
    const acc = w * w * (target + tremble - this.needleAngle) - 2 * T.needleZeta * w * this.needleVel;
    this.needleVel += acc * dt;
    this.needleAngle += this.needleVel * dt;
    if (this.needleAngle < -140) {
      this.needleAngle = -140;
      this.needleVel = Math.max(0, this.needleVel);
    }
    if (this.needleAngle > 140) {
      this.needleAngle = 140;
      this.needleVel = Math.min(0, this.needleVel);
    }
    if (this.needle) this.needle.rotate((-this.needleAngle * Math.PI) / 180);

    // drum: exact line speed / radius, limited to what a frame can show; slipping adds a stutter
    let rate = m.pay / T.drumRadius;
    const lim = T.drumMaxRate;
    if (rate > lim) rate = lim;
    else if (rate < -lim) rate = -lim;
    let stutter = 0;
    if (m.slip > 0.05) stutter = Math.sin(this._t * 83) * 0.03 * Math.min(1, m.slip / 3);
    this.drumAngle += rate * dt + stutter;
    if (this.drumAngle > 100000 || this.drumAngle < -100000) this.drumAngle %= Math.PI * 2;
    if (this.drum) this.drum.rotate(this.drumAngle);

    // recoil slide (spring), clamped to its travel
    this.slideV += (-T.recoilK * this.slideX - T.recoilC * this.slideV) * dt;
    this.slideX += this.slideV * dt;
    if (this.slideX > T.recoilTravel) {
      this.slideX = T.recoilTravel;
      this.slideV = Math.min(0, this.slideV) * 0.4;
    } else if (this.slideX < -0.004) {
      this.slideX = -0.004;
      this.slideV = Math.max(0, this.slideV) * 0.4;
    }
    if (this.slide) this.slide.slide(this.slideX);

    // frame hum under high load, harsher while the clutch is paying out
    const vib = Math.max(0, (load - T.vibrateStart) / (1 - T.vibrateStart)) + Math.min(0.6, m.slip / 8);
    this.vibe += (vib - this.vibe) * (1 - Math.exp(-12 * dt));
    if (this.body) {
      const a = T.vibrateAmp * this.vibe * this.vibe;
      const tt = this._t;
      this.body.node.position.set(
        this.body.restP.x + a * Math.sin(tt * 301),
        this.body.restP.y + a * Math.sin(tt * 277 + 1.1),
        this.body.restP.z + a * 0.6 * Math.sin(tt * 253 + 2.3),
      );
    }
  }

  /** World position of the muzzle (rope origin). Returns false when the node is missing. */
  muzzleWorld(out) {
    if (!this.muzzle) return false;
    this.muzzle.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(this.muzzle.matrixWorld);
    return true;
  }
}

/** Reads the pose clips (frame 0) into pose → bone → Quaternion. */
export function readPoses(animations) {
  const out = new Map();
  for (const clip of animations || []) {
    const m = new Map();
    for (const tr of clip.tracks) {
      if (!tr.name.endsWith('.quaternion')) continue;
      const bone = tr.name.slice(0, -'.quaternion'.length);
      const v = tr.values;
      m.set(bone.replace(/_(L|R)$/, ''), new Quaternion(v[0], v[1], v[2], v[3]));
    }
    out.set(clip.name, m);
  }
  return out;
}

/** Colour helper for emissive tints. */
export function tint(hex) {
  return new Color(hex);
}

export { Object3D };
