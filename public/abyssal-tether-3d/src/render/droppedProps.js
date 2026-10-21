/* ABYSSAL TETHER 3D — droppedProps.js
 * Weight and inertia for the bag's consumables (WP-GFX-PARITY). When an item leaves the hand it is a small rigid prop with mass:
 *   - bag:done    the spent item (syringe, bandage roll, empty cell, first aid case) is tossed away: it inherits the hand's velocity
 *                 plus a flick outward and falls
 *   - bag:cancel  the application was interrupted (a hit, the grip let go, the channel cancelled): the item slips out of the hand and
 *                 drops from it. The bag keeps the item (gameplay is unchanged, this is dressing: the prop is a fumbled spare and
 *                 melts away after it has landed), so nothing here ever touches the simulation or its determinism
 *   - spawn(kind, x, y, z, vx, vy, vz)   anything else may throw an item (debug, tests, future "drop item")
 * Physics (render side, semi-implicit Euler at the frame rate, sub-stepped to 1/120 s): gravity from CONFIG.player.gravity, a little air
 * drag, swept collision against the level's axis-aligned solids (one ray cast along the step, item radius 6 cm), restitution and tangential
 * friction per kind (the cell bounces, the bandage thuds), tumble that decays on every impact, a settle that rights the prop into its lying
 * pose, and a fade (shrink) 5 s after it lies still. At most MAX items; the oldest is recycled.
 *
 * Rendering: ONE dynamic mesh (<= MAX items x <= ~320 vertices, rewritten in JS only while something is active; hidden = 0 draw calls),
 * a lit MeshStandardMaterial with vertex colours (the shared probe / lantern / baked GI apply like for any lit prop).
 *
 * Impact sound hook: bus 'prop:impact' { kind, x, y, z, speed (m/s along the normal), surface: 'stone' } on every bounce harder than
 * 0.9 m/s (throttled 60 ms), plus the optional game.audio.propImpact(payload) when an audio module provides it.
 */

import * as THREE from 'three';
import { CONFIG } from '../sim/config3d.js';
import { ITEM } from '../sim/inventory3d.js';
import { buildTemplates } from './pickupsView.js';
import { boxFaceNormal } from './contactShadows.js';

export const DROP_MAX = 6;
const RADIUS = 0.06;
const SUBSTEP = 1 / 120;
const REST_FOR = 5; // s lying still before it melts away
const FADE_S = 0.5;
const MAX_LIFE = 12; // s: a prop still moving (rolling off a ledge) never lives longer than this
const KILL_BELOW = 60; // m: an item that has fallen this far below where it spawned is gone

// per kind: restitution, tangential friction kept per impact, spin decay per impact
const BODY = {
  [ITEM.FIRST_AID]: { e: 0.28, mu: 0.72, spin: 0.55 },
  [ITEM.BANDAGE]: { e: 0.1, mu: 0.55, spin: 0.4 },
  [ITEM.ADRENALINE]: { e: 0.34, mu: 0.7, spin: 0.6 },
  [ITEM.BATTERY]: { e: 0.46, mu: 0.8, spin: 0.7 },
};
// lying pose per kind (rotation of the untilted template): the first aid case on its back, the bandage on its tail, the syringe on its
// side, the cell on its side
const REST = {
  [ITEM.FIRST_AID]: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
  [ITEM.BANDAGE]: new THREE.Quaternion(),
  [ITEM.ADRENALINE]: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.61)),
  [ITEM.BATTERY]: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
};
// half-height of the lying prop above the surface (its centre rests this high)
const REST_H = { [ITEM.FIRST_AID]: 0.056, [ITEM.BANDAGE]: 0.082, [ITEM.ADRENALINE]: 0.035, [ITEM.BATTERY]: 0.062 };

function makeItem() {
  return {
    active: false,
    kind: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    q: new THREE.Quaternion(),
    wx: 0,
    wy: 0,
    wz: 0, // angular velocity (rad/s, world axes)
    t: 0,
    still: 0,
    rested: false,
    fade: 1,
    spawnY: 0,
    lastSound: -1,
  };
}

const _q = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _n = { x: 0, y: 1, z: 0 };

export class DroppedProps {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [opts] { gravity }
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.gravity = opts.gravity || (CONFIG.player && CONFIG.player.gravity) || 9.81;
    this.items = [];
    for (let i = 0; i < DROP_MAX; i++) this.items.push(makeItem());
    this.activeCount = 0;
    this.stats = { spawned: 0, impacts: 0, drawn: 0 };
    this._time = 0;
    this._level = null;
    this._bus = null;
    this._handPrev = [null, null];
    this._handVel = [new THREE.Vector3(), new THREE.Vector3()];
    this._handPos = [new THREE.Vector3(), new THREE.Vector3()];
    this._handSeen = [false, false];
    this._lastHand = 1; // the hand that opened the radial last (right unless the left did)
    this._hit = { t: 0, solid: null, x: 0, y: 0, z: 0 };

    this.templates = buildTemplates(0);
    let maxV = 0;
    let maxI = 0;
    for (const k of Object.keys(this.templates)) {
      maxV = Math.max(maxV, this.templates[k].verts);
      maxI = Math.max(maxI, this.templates[k].idx.length);
    }
    const cap = DROP_MAX * maxV;
    const g = new THREE.BufferGeometry();
    this._aPos = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
    this._aNor = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
    this._aCol = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
    this._aIdx = new THREE.BufferAttribute(new Uint16Array(DROP_MAX * maxI), 1);
    for (const a of [this._aPos, this._aNor, this._aCol, this._aIdx]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this._aPos);
    g.setAttribute('normal', this._aNor);
    g.setAttribute('color', this._aCol);
    g.setIndex(this._aIdx);
    g.setDrawRange(0, 0);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 });
    mat.name = 'droppedProps';
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'DroppedProps';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Subscribes to the game's bus (idempotent per bus). `getGame` returns the live game (hands, level). */
  bind(bus, getGame) {
    if (!bus || typeof bus.on !== 'function' || this._bus === bus) return;
    if (this._off) this._off();
    this._bus = bus;
    this._getGame = getGame;
    const offs = [
      bus.on('bag:done', (e) => this._fromBag(e, true)),
      bus.on('bag:cancel', (e) => {
        if (e && e.reason === 'inactive') return; // paused / dead / menu: no fumble
        this._fromBag(e, false);
      }),
      bus.on('game:restart', () => this.clear()),
      bus.on('game:respawn', () => this.clear()),
      bus.on('game:menu', () => this.clear()),
    ];
    this._off = () => {
      for (const f of offs) if (typeof f === 'function') f();
      this._bus = null;
    };
  }

  clear() {
    for (const it of this.items) it.active = false;
    this.activeCount = 0;
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  /** A bag event: spawn the prop at the hand that was using the bag (the desktop: low in front of the view). */
  _fromBag(e, spent) {
    const game = this._getGame ? this._getGame() : null;
    if (!game || e == null || !(e.kind >= 0)) return;
    const inp = game.input;
    const p = _hand;
    let hand = this._lastHand;
    const bg = inp && inp._bagGesture;
    if (bg && bg.hand >= 0) hand = bg.hand;
    let ok = false;
    if (game.xrActive && inp && typeof inp.handPose === 'function') {
      const hp = inp.handPose(hand === 0 ? 'left' : 'right');
      if (hp && isFinite(hp.x)) {
        p.x = hp.x;
        p.y = hp.y;
        p.z = hp.z;
        ok = true;
      }
    }
    let vx = 0;
    let vy = 0;
    let vz = 0;
    if (ok && this._handSeen[hand]) {
      vx = this._handVel[hand].x;
      vy = this._handVel[hand].y;
      vz = this._handVel[hand].z;
    } else if (!ok) {
      // desktop: low and slightly right of the view, the camera's forward as the throw direction
      const cam = game.renderer && game.renderer.camera;
      if (!cam) return;
      cam.updateWorldMatrix(true, false);
      const el = cam.matrixWorld.elements;
      p.x = el[12] + (-el[8]) * 0.4 + el[0] * 0.22 - el[4] * 0.3;
      p.y = el[13] + (-el[9]) * 0.4 + el[1] * 0.22 - el[5] * 0.3;
      p.z = el[14] + (-el[10]) * 0.4 + el[2] * 0.22 - el[6] * 0.3;
      const pl = game.player;
      if (pl) {
        vx = pl.vx || 0;
        vy = pl.vy || 0;
        vz = pl.vz || 0;
      }
      _flickV.set(-el[8], -el[9], -el[10]).normalize();
    }
    // a spent item is tossed (a flick outward and up); a fumbled one just slips (a little down and away)
    const kick = spent ? 1.6 : 0.5;
    if (ok) {
      const g = game.renderer && game.renderer.camera;
      if (g) {
        g.updateWorldMatrix(true, false);
        const el = g.matrixWorld.elements;
        _flickV.set(-el[8], 0, -el[10]).normalize();
      } else _flickV.set(0, 0, -1);
    }
    vx += _flickV.x * kick + (spent ? 0 : _flickV.z * 0.2);
    vz += _flickV.z * kick;
    vy += spent ? 1.4 : -0.4;
    this.spawn(e.kind, p.x, p.y, p.z, vx, vy, vz, spent ? 7 : 3);
  }

  /**
   * Throws an item. spin = peak tumble rate (rad/s). Returns the slot used.
   */
  spawn(kind, x, y, z, vx = 0, vy = 0, vz = 0, spin = 5) {
    if (!(kind in this.templates)) return -1;
    let slot = -1;
    let oldest = 0;
    for (let i = 0; i < this.items.length; i++) {
      if (!this.items[i].active) {
        slot = i;
        break;
      }
      if (this.items[i].t > this.items[oldest].t) oldest = i;
    }
    if (slot < 0) slot = oldest;
    const it = this.items[slot];
    it.active = true;
    it.kind = kind;
    it.x = x;
    it.y = y;
    it.z = z;
    it.vx = vx;
    it.vy = vy;
    it.vz = vz;
    it.t = 0;
    it.still = 0;
    it.rested = false;
    it.fade = 1;
    it.spawnY = y;
    it.lastSound = -1;
    // random-looking but deterministic per spawn: a hash of the time and kind (render-side only, never the sim's RNG)
    const h = Math.sin(this._time * 12.9898 + kind * 78.233 + this.stats.spawned * 37.719) * 43758.5453;
    const r1 = h - Math.floor(h);
    const r2 = Math.sin(h * 1.37) * 0.5 + 0.5;
    const r3 = Math.sin(h * 2.11 + 1.3) * 0.5 + 0.5;
    it.wx = (r1 - 0.5) * 2 * spin;
    it.wy = (r2 - 0.5) * 2 * spin;
    it.wz = (r3 - 0.5) * 2 * spin;
    _e.set(r1 * 6.28, r2 * 6.28, r3 * 6.28);
    it.q.setFromEuler(_e);
    this.stats.spawned++;
    this._recount();
    return slot;
  }

  _recount() {
    let n = 0;
    for (const it of this.items) if (it.active) n++;
    this.activeCount = n;
  }

  /** Tracks a hand's velocity (m/s) for the throw. */
  _trackHands(dt, game) {
    const inp = game && game.input;
    if (!inp || !game.xrActive || typeof inp.handPose !== 'function' || !(dt > 0)) {
      this._handSeen[0] = this._handSeen[1] = false;
      return;
    }
    for (let h = 0; h < 2; h++) {
      const hp = inp.handPose(h === 0 ? 'left' : 'right');
      if (!hp || !isFinite(hp.x)) {
        this._handSeen[h] = false;
        continue;
      }
      const P = this._handPos[h];
      if (this._handSeen[h]) {
        const k = 1 - Math.exp(-18 * dt);
        this._handVel[h].x += ((hp.x - P.x) / dt - this._handVel[h].x) * k;
        this._handVel[h].y += ((hp.y - P.y) / dt - this._handVel[h].y) * k;
        this._handVel[h].z += ((hp.z - P.z) / dt - this._handVel[h].z) * k;
      } else this._handVel[h].set(0, 0, 0);
      P.set(hp.x, hp.y, hp.z);
      this._handSeen[h] = true;
    }
    const bg = inp._bagGesture;
    if (bg && bg.open && bg.hand >= 0) this._lastHand = bg.hand;
  }

  /**
   * @param {number} dt
   * @param {object} game
   */
  update(dt, game) {
    const d = Math.min(Math.max(dt, 0), 0.1);
    this._time += d;
    this._level = game && game.level ? game.level : this._level;
    this._trackHands(d, game);
    if (this.activeCount === 0) return;
    let steps = Math.max(1, Math.ceil(d / SUBSTEP));
    if (steps > 12) steps = 12;
    const h = d / steps;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.active) continue;
      for (let s = 0; s < steps; s++) this._step(it, h, game);
      it.t += d;
      if (it.rested) {
        it.still += d;
        if (it.still > REST_FOR) it.fade = Math.max(0, 1 - (it.still - REST_FOR) / FADE_S);
      }
      if (it.fade <= 0 || it.t > MAX_LIFE + REST_FOR || it.spawnY - it.y > KILL_BELOW) it.active = false;
    }
    this._recount();
    this._write();
  }

  _step(it, h, game) {
    if (it.rested) return;
    const lv = this._level;
    // integrate
    it.vy -= this.gravity * h;
    const drag = Math.exp(-0.15 * h);
    it.vx *= drag;
    it.vy *= drag;
    it.vz *= drag;
    const mx = it.vx * h;
    const my = it.vy * h;
    const mz = it.vz * h;
    const len = Math.sqrt(mx * mx + my * my + mz * mz);
    let hit = null;
    if (lv && typeof lv.raycast === 'function' && len > 1e-7) {
      // sweep: from the centre along the step, plus the radius (a sphere hits a face a radius early)
      hit = lv.raycast(it.x, it.y, it.z, mx, my, mz, len + RADIUS, this._hit);
    }
    if (hit && hit.t < len + RADIUS) {
      const ux = mx / len;
      const uy = my / len;
      const uz = mz / len;
      const n = boxFaceNormal(hit.solid, hit.x, hit.y, hit.z, ux, uy, uz, _n);
      // stop a radius off the face
      const tt = Math.max(0, hit.t - RADIUS);
      it.x += ux * tt;
      it.y += uy * tt;
      it.z += uz * tt;
      const B = BODY[it.kind] || BODY[ITEM.FIRST_AID];
      const vn = it.vx * n.x + it.vy * n.y + it.vz * n.z;
      if (vn < 0) {
        // reflect the normal part (restitution), keep a fraction of the tangential part (friction)
        const tx = it.vx - vn * n.x;
        const ty = it.vy - vn * n.y;
        const tz = it.vz - vn * n.z;
        const e = Math.abs(vn) > 1.2 ? B.e : B.e * 0.4;
        it.vx = tx * B.mu - vn * e * n.x;
        it.vy = ty * B.mu - vn * e * n.y;
        it.vz = tz * B.mu - vn * e * n.z;
        // tumble: damp, and a kick from the tangential motion (it rolls off the surface it skids along)
        it.wx = it.wx * B.spin + tz * 0.9 * B.spin;
        it.wy *= B.spin;
        it.wz = it.wz * B.spin - tx * 0.9 * B.spin;
        const sp = -vn;
        if (sp > 0.9 && (it.lastSound < 0 || it.t - it.lastSound > 0.06)) {
          it.lastSound = it.t;
          this._impact(it, sp, game);
        }
        if (n.y > 0.7) {
          // on a floor: slow enough = it lies there
          const horiz = Math.sqrt(it.vx * it.vx + it.vz * it.vz);
          if (it.vy < 0.5 && horiz < 0.35 && sp < 0.9) {
            it.rested = true;
            it.vx = it.vy = it.vz = 0;
            it.wx = it.wy = it.wz = 0;
            it.y = hit.y + (REST_H[it.kind] || 0.05);
            it.x = hit.x;
            it.z = hit.z;
            this._rightProp(it);
            return;
          }
        }
      }
      // the rest of the step is spent along the new velocity next sub-step
      it.x += n.x * 0.002;
      it.y += n.y * 0.002;
      it.z += n.z * 0.002;
    } else {
      it.x += mx;
      it.y += my;
      it.z += mz;
    }
    // integrate rotation (world-axis angular velocity)
    const w = Math.sqrt(it.wx * it.wx + it.wy * it.wy + it.wz * it.wz);
    if (w > 1e-4) {
      _qw.setFromAxisAngle(_axis.set(it.wx / w, it.wy / w, it.wz / w), w * h);
      it.q.premultiply(_qw).normalize();
    }
  }

  /** Settle: the prop is righted into its lying pose, keeping the yaw it had. */
  _rightProp(it) {
    // yaw of the current orientation about +Y (from the rotated local +X axis), then rest * yaw
    _axis.set(1, 0, 0).applyQuaternion(it.q);
    const yaw = Math.atan2(-_axis.z, _axis.x);
    _q.setFromAxisAngle(_up, yaw);
    it.q.copy(_q).multiply(REST[it.kind] || _q2.identity());
  }

  _impact(it, speed, game) {
    this.stats.impacts++;
    const payload = { kind: it.kind, x: it.x, y: it.y, z: it.z, speed, surface: 'stone' };
    if (this._bus) this._bus.emit('prop:impact', payload);
    const au = game && game.audio;
    if (au && typeof au.propImpact === 'function') {
      try {
        au.propImpact(payload);
      } catch {
        /* optional hook */
      }
    }
  }

  /** Rewrites the dynamic mesh: every active item's template, rotated and translated (scaled to 0 while it melts away). */
  _write() {
    const P = this._aPos.array;
    const N = this._aNor.array;
    const C = this._aCol.array;
    const X = this._aIdx.array;
    let vo = 0;
    let io = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.active) continue;
      const tpl = this.templates[it.kind];
      _m.makeRotationFromQuaternion(it.q);
      const e = _m.elements;
      const sc = it.fade < 1 ? it.fade : 1;
      const pos = tpl.pos;
      const nor = tpl.nor;
      const col = tpl.col;
      for (let k = 0; k < tpl.verts; k++) {
        const a = k * 3;
        const x = pos[a];
        const y = pos[a + 1];
        const z = pos[a + 2];
        const o = (vo + k) * 3;
        P[o] = (e[0] * x + e[4] * y + e[8] * z) * sc + it.x;
        P[o + 1] = (e[1] * x + e[5] * y + e[9] * z) * sc + it.y;
        P[o + 2] = (e[2] * x + e[6] * y + e[10] * z) * sc + it.z;
        const nx = nor[a];
        const ny = nor[a + 1];
        const nz = nor[a + 2];
        N[o] = e[0] * nx + e[4] * ny + e[8] * nz;
        N[o + 1] = e[1] * nx + e[5] * ny + e[9] * nz;
        N[o + 2] = e[2] * nx + e[6] * ny + e[10] * nz;
        C[o] = col[a];
        C[o + 1] = col[a + 1];
        C[o + 2] = col[a + 2];
      }
      for (let k = 0; k < tpl.idx.length; k++) X[io + k] = vo + tpl.idx[k];
      vo += tpl.verts;
      io += tpl.idx.length;
    }
    this.mesh.geometry.setDrawRange(0, io);
    this.mesh.visible = io > 0;
    this.stats.drawn = io / 3;
    this._aPos.needsUpdate = true;
    this._aNor.needsUpdate = true;
    this._aCol.needsUpdate = true;
    this._aIdx.needsUpdate = true;
  }

  dispose() {
    if (this._off) this._off();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

const _hand = { x: 0, y: 0, z: 0 };
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _flickV = new THREE.Vector3(0, 0, -1);
