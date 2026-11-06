/* THE LANTERN (ABYSSAL TETHER 3D) — render/roachView.js
 * THE TINY SKITTERLINGS ("swarm skitterlings": the file keeps its old 'roach' name, the player only ever reads "skitterlings"; one species with
 * the hunter skitterlings, docs/abyssal-tether-3d/plans/SKITTERLINGS.md). sim/roaches.js, plans/ROACHES.md: ONE InstancedMesh, ONE draw call
 * for every swarm skitterling and every smear. The model and the shader are the species' own, shared with the hunters (skitterlingModel.js).
 *
 *   MODEL    procedural, 27 triangles, 1 unit long (+z forward, +y off the surface): an oval carapace tented along the spine (10), a head (3),
 *            six legs as thin quads (12), two long antennae (2). Per vertex aRig = (part 0 body / 1 head / 2 leg / 3 antenna, weight 0 at the
 *            root .. 1 at the tip, the leg's tripod phase 0 / PI, side -1 / +1).
 *   GAIT     all in the vertex shader from one per-instance vec4 aAnim = (gait phase, speed 0..1 (< 0: a smear, -1 fresh .. 0 gone), seed,
 *            antenna twitch): the alternating tripod (L1 R2 L3 against R1 L2 R3) swings and lifts the feet, the body bobs, the antennae sweep
 *            and twitch (harder when it freezes). No skeleton, no per-roach CPU animation beyond the instance matrix.
 *   LOOK     a ShaderMaterial: the carried lantern only (the shared LOOK uniforms uLanternW / uLanternC / uLanternR the lighting drives for the
 *            wet film), wrapped diffuse, a tight glossy chitin highlight and a lantern-coloured rim, a seam down the wing cases and a lighter
 *            pronotum, a trace of ambient so a silhouette survives; the level's radial haze (fog chunks), tone mapping, colour space.
 *            A squished one is the same instance flattened and splayed into a dark wet smear that shrinks away.
 *
 *   new RoachView(game)       game: { renderer.{scene, camera, ...} }; the mesh is in the scene from the start (hidden while empty)
 *   .update(dt, game)         once per frame (Game._updateViews): fills the sim's context, steps game.roaches, writes the instances
 *   .stats                    { shown, triangles, calls }
 *   roachContext(game, ctx)   the glue: head pose + frustum, lantern, hands, body, governor, tier, on/off (also the tests)
 *   buildRoachGeometry()      the model (also the tests)
 */
import * as THREE from 'three';
import { ROACH, ROACH_STATE, makeRoachCtx } from '../sim/roaches.js';
import { SWARM_TRIS, buildSwarmGeometry, makeSkitterlingMaterial } from './skitterlingModel.js';
import { CONFIG } from '../sim/config3d.js';

export const ROACH_TRIS = SWARM_TRIS;

/** The swarm skitterling's model (shared with the hunters' far LOD: render/skitterlingModel.js). */
export const buildRoachGeometry = buildSwarmGeometry;

/** Fills the sim's context from the game (allocation-free). Returns ctx. */
export function roachContext(game, ctx) {
  const r = game.renderer;
  const p = game.player;
  const st = game.settings;
  const sc = game.deathScene;
  ctx.on = !!(r && r.camera && p && p.alive && game.state === 'playing' && !(game.victoryT >= 0) && !(sc && sc.active) && !(st && st.roaches === false));
  if (!ctx.on) return ctx;
  ctx.tier = r.qualityTier || 'quest';
  ctx.gov = r.governor && typeof r.governor.level === 'number' ? r.governor.level : 0;
  // the head: the camera's world pose (in a headset the user camera carries the XR pose) and a frustum at least as wide as the headset's
  const cam = r.camera;
  const e = cam.matrixWorld.elements;
  const H = ctx.head;
  H.x = e[12];
  H.y = e[13];
  H.z = e[14];
  let l = Math.hypot(e[0], e[1], e[2]) || 1;
  H.rx = e[0] / l;
  H.ry = e[1] / l;
  H.rz = e[2] / l;
  l = Math.hypot(e[4], e[5], e[6]) || 1;
  H.ux = e[4] / l;
  H.uy = e[5] / l;
  H.uz = e[6] / l;
  l = Math.hypot(e[8], e[9], e[10]) || 1;
  H.fx = -e[8] / l;
  H.fy = -e[9] / l;
  H.fz = -e[10] / l;
  const pm = cam.projectionMatrix.elements;
  const xr = !!game.xrActive;
  H.tanH = Math.max(pm[0] > 0 ? 1 / pm[0] : 1, xr ? 1.45 : 0);
  H.tanV = Math.max(pm[5] > 0 ? 1 / pm[5] : 0.8, xr ? 1.3 : 0);
  // the lantern: where it hangs, shining along the view
  const L = ctx.lantern;
  const lan = r.lantern;
  if (lan) {
    const m = lan.matrixWorld.elements;
    L.x = m[12];
    L.y = m[13];
    L.z = m[14];
    L.k = lan.visible === false ? 0 : Math.max(0, Math.min(1, lan.intensity / (r.lanternBase || 6.5)));
    // THE HOOD (sim/lanternHood.js): the base above is already scaled by the hood, so the ratio would cancel it: apply it here (the
    // swarm stops fleeing a covered lantern and creeps up)
    const hood = game.hood;
    if (hood && hood.k > 0) L.k *= 1 - hood.k;
  } else {
    L.x = H.x;
    L.y = H.y;
    L.z = H.z;
    L.k = 0;
  }
  L.ax = H.fx;
  L.ay = H.fy;
  L.az = H.fz;
  // the hands (XR: the controllers / tracked hands; desktop: the virtual hands in front of the camera)
  for (let k = 0; k < 2; k++) {
    const hd = ctx.hands[k];
    hd.ok = false;
    if (typeof game.handOrigin === 'function') {
      game.handOrigin(k === 0 ? 'left' : 'right', hd);
      hd.ok = Number.isFinite(hd.x);
    }
  }
  // the body
  const B = ctx.body;
  B.x = p.rx;
  B.y = p.ry;
  B.z = p.rz;
  B.vx = p.vx || 0;
  B.vy = p.vy || 0;
  B.vz = p.vz || 0;
  B.grounded = !!p.grounded;
  B.footY = p.ry - ((CONFIG && CONFIG.player && CONFIG.player.radius) || 0.38);
  B.landed = !!p.landedThisStep;
  return ctx;
}

export class RoachView {
  constructor(game) {
    this.scene = game.renderer.scene;
    this.ctx = makeRoachCtx();
    this.stats = { shown: 0, triangles: 0, calls: 0 };
    this._t = 0;
    const N = ROACH.pool;
    const geo = buildRoachGeometry();
    this.anim = new Float32Array(N * 4);
    const aAnim = new THREE.InstancedBufferAttribute(this.anim, 4);
    aAnim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAnim', aAnim);
    this._aAnim = aAnim;
    this.material = makeSkitterlingMaterial(false); // the species' wet red chitin (shared with the hunter skitterlings)
    this.uniforms = this.material.uniforms;
    this.mesh = new THREE.InstancedMesh(geo, this.material, N);
    this.mesh.name = 'skitterlings-swarm';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.userData.noShadowCast = true;
    this.scene.add(this.mesh);
  }

  /** Steps the sim (game.roaches) and writes the instances. */
  update(dt, game) {
    const sim = game.roaches;
    if (!sim) {
      this._hide();
      return;
    }
    this._t = (this._t + (dt > 0 ? dt : 0)) % 1000;
    this.uniforms.uTime.value = this._t;
    if (game.state === 'paused') return; // frozen as they were
    if (!sim.hasHotspots && game.remainsView && game.remainsView.plan && game.remainsView.level === sim.level) sim.setHotspots(game.remainsView.plan);
    roachContext(game, this.ctx);
    sim.update(dt, this.ctx);
    this.write(sim);
  }

  /** Writes the sim's live roaches and smears into the instance buffers (allocation-free). Returns how many. */
  write(sim) {
    const arr = this.mesh.instanceMatrix.array;
    const an = this.anim;
    const P = ROACH.pool;
    const pos = sim.pos;
    let n = 0;
    for (let i = 0; i < P; i++) {
      const s = sim.st[i];
      if (s === ROACH_STATE.FREE) continue;
      const a = sim.axis[i];
      const k = a >> 1; // the normal's component
      const sg = a & 1 ? 1 : -1;
      // Y = the face normal; Z = the heading on the face (cos along u, sin along v); X = Y x Z
      let yx = 0;
      let yy = 0;
      let yz = 0;
      if (k === 0) yx = sg;
      else if (k === 1) yy = sg;
      else yz = sg;
      const ca = Math.cos(sim.ang[i]);
      const sa = Math.sin(sim.ang[i]);
      // u / v components per face (sim/roaches.js UC / VC): x-faces (z, y), y-faces (x, z), z-faces (x, y)
      let zx = 0;
      let zy = 0;
      let zz = 0;
      if (k === 0) {
        zz = ca;
        zy = sa;
      } else if (k === 1) {
        zx = ca;
        zz = sa;
      } else {
        zx = ca;
        zy = sa;
      }
      const xx = yy * zz - yz * zy;
      const xy = yz * zx - yx * zz;
      const xz = yx * zy - yy * zx;
      const sc = ROACH.len * sim.sz[i];
      const o = n * 16;
      arr[o] = xx * sc;
      arr[o + 1] = xy * sc;
      arr[o + 2] = xz * sc;
      arr[o + 3] = 0;
      arr[o + 4] = yx * sc;
      arr[o + 5] = yy * sc;
      arr[o + 6] = yz * sc;
      arr[o + 7] = 0;
      arr[o + 8] = zx * sc;
      arr[o + 9] = zy * sc;
      arr[o + 10] = zz * sc;
      arr[o + 11] = 0;
      arr[o + 12] = pos[i * 3];
      arr[o + 13] = pos[i * 3 + 1];
      arr[o + 14] = pos[i * 3 + 2];
      arr[o + 15] = 1;
      const q = n * 4;
      an[q] = sim.ph[i];
      if (s === ROACH_STATE.SMEAR) {
        const f = sim.tmr[i] / ROACH.smearFade;
        an[q + 1] = -(0.002 + (f > 1 ? 1 : f < 0 ? 0 : f));
      } else an[q + 1] = Math.min(1, sim.spd[i] / 1.2);
      an[q + 2] = sim.seedK[i];
      an[q + 3] = sim.tw[i];
      n++;
    }
    const m = this.mesh;
    m.count = n;
    m.visible = n > 0;
    if (n > 0) {
      // the whole buffers go up (at most 96 x 80 bytes = 7.5 KB): update ranges would allocate a range record and the array's
      // backing store every frame (three clears them with length = 0 after each upload)
      m.instanceMatrix.needsUpdate = true;
      this._aAnim.needsUpdate = true;
    }
    this.stats.shown = n;
    this.stats.triangles = n * ROACH_TRIS;
    this.stats.calls = n > 0 ? 1 : 0;
    return n;
  }

  _hide() {
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.stats.shown = this.stats.triangles = this.stats.calls = 0;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
