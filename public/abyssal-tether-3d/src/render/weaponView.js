/* THE LANTERN (ABYSSAL TETHER 3D) — weaponView.js
 * What the SOLDIERS' WEAPONS (sim/weapons3d.js, plans/SOLDIER_WEAPONS.md) look like in the world.
 *
 *   ONE InstancedMesh (one draw call; WEAPONS.grenade.maxProps + 1 = 4 instances at most): the grenades in the air / fizzing on a ledge
 *   and, in VR, the grenade or the revolver in the hand that drew it. The geometry holds BOTH models; a per-vertex aPart.x says which
 *   model a vertex belongs to and a per-instance aState.x which model the instance shows (the other collapses to a point in the vertex
 *   shader). aPart.y is an emissive mask (the fuse's ember) lit by aState.y. A lit, graded MeshStandardMaterial through the engine's
 *   shared look (materials.js patchMaterial, as a client): no texture, no light, no sampler of its own.
 *   The blast, the muzzle flash and the splats are the EXISTING systems: Renderer3D's FX bursts (one Points draw that already exists:
 *   sparks, stone dust, chips, rubble; a tint for the gore) and the lantern's flare (game.flow.flare, the swing-chain path in
 *   game.js _updateLantern: x1.5 at most, decaying in ~0.4 s): +0 draw calls, +0 lights. The Mason's flinch is its own RECOVERING recoil.
 *   The grenade AIM ARC reuses the knocker view's line (KnockerView.setArc): +0.
 *
 *   The models come from weaponTemplate(kind) below: render/itemModels.js buildGrenade() / buildSidearm() (the placeholder geometry is only
 *   the fallback for any other kind). The pickups view builds its own copy with its tilt.
 *
 *   new WeaponView(game)      game: { renderer.scene, renderer.fx, weapons (WeaponGlue: .sim Weapons3D), hidePlayer }
 *   .update(dt, game)         once per frame (WeaponGlue.update)
 *   .burst(kind, x, y, z, k)  'blast' | 'muzzle' | 'mason' | 'splat' | 'wall': the effect bursts (called from the bus by the glue)
 *   .stats                    { instances, triangles }
 */
import * as THREE from 'three';
import { GSTATE, WEAPONS } from '../sim/weapons3d.js';
import { ITEM } from '../sim/inventory3d.js';
import { patchMaterial } from './materials.js';
import { buildGrenade, buildSidearm } from './itemModels.js';

export const WEAPON_VIEW = Object.freeze({ maxInstances: WEAPONS.grenade.maxProps + 1, scale: 1.5 }); // drawn 1.5x so a 9 cm grenade reads in the dark

const IRON = [0.17, 0.17, 0.18];
const IRON_LT = [0.3, 0.29, 0.27];
const BRASS_DK = [0.46, 0.33, 0.15];
const CORD = [0.36, 0.27, 0.17];
const EMBER = [1.0, 0.45, 0.12];
const BLUED = [0.15, 0.16, 0.19];
const WOOD = [0.33, 0.2, 0.11];

/** Placeholder parts of a model: [geometry, colour, glow mask] in metres, origin at the model's centre, +Y up, the barrel along -Z. */
function placeholderParts(kind) {
  const P = [];
  const add = (geo, color, glow = 0) => P.push({ geo, color, glow });
  if (kind === ITEM.GRENADE) {
    // a fused iron ball grenade: a ribbed iron body, a brass collar, a cord fuse with an ember at its tip
    add(new THREE.SphereGeometry(0.045, 10, 8), IRON);
    add(new THREE.CylinderGeometry(0.047, 0.047, 0.01, 10, 1, true), IRON_LT);
    add(new THREE.CylinderGeometry(0.014, 0.017, 0.018, 8, 1).translate(0, 0.047, 0), BRASS_DK);
    add(new THREE.CylinderGeometry(0.004, 0.004, 0.026, 5, 1).translate(0, 0.068, 0), CORD);
    add(new THREE.OctahedronGeometry(0.007, 0).translate(0, 0.083, 0), EMBER, 1);
  } else {
    // an old service revolver: frame, a six-chamber drum, a long barrel, a hammer, a trigger guard and a wooden grip
    add(new THREE.BoxGeometry(0.026, 0.034, 0.075).translate(0, 0.01, 0.0), BLUED);
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.036, 8, 1).rotateX(Math.PI / 2).translate(0, 0.012, -0.012), IRON_LT);
    add(new THREE.CylinderGeometry(0.0075, 0.0075, 0.13, 7, 1).rotateX(Math.PI / 2).translate(0, 0.02, -0.1), BLUED);
    add(new THREE.BoxGeometry(0.008, 0.014, 0.012).translate(0, 0.032, 0.032), BLUED);
    add(new THREE.BoxGeometry(0.006, 0.02, 0.026).translate(0, -0.014, 0.004), BLUED);
    add(new THREE.BoxGeometry(0.024, 0.075, 0.03).rotateX(-0.35).translate(0, -0.035, 0.045), WOOD);
  }
  return P;
}

/**
 * A weapon model as flat arrays: { pos, nor, col, glow, idx, verts, tris } (metres, origin at its centre). Built once.
 * Grenade and revolver: the itemModels builders (the seam is closed).
 */
export function weaponTemplate(kind) {
  // the real models (render/itemModels.js): the iron grenade and the service revolver, one merged model each
  const m = kind === ITEM.GRENADE ? buildGrenade(0, 1) : kind === ITEM.SIDEARM ? buildSidearm(0, 1) : null;
  if (m) return { pos: m.pos, nor: m.nor, col: m.col, glow: new Float32Array(m.verts), idx: m.idx, verts: m.verts, tris: m.idx.length / 3 };
  const parts = placeholderParts(kind);
  let verts = 0;
  let nIdx = 0;
  for (const p of parts) {
    verts += p.geo.attributes.position.count;
    nIdx += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
  }
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 3);
  const glow = new Float32Array(verts);
  const idx = new Uint16Array(nIdx);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const g = p.geo;
    const pa = g.attributes.position;
    const na = g.attributes.normal;
    for (let i = 0; i < pa.count; i++) {
      pos[(vo + i) * 3] = pa.getX(i);
      pos[(vo + i) * 3 + 1] = pa.getY(i);
      pos[(vo + i) * 3 + 2] = pa.getZ(i);
      nor[(vo + i) * 3] = na.getX(i);
      nor[(vo + i) * 3 + 1] = na.getY(i);
      nor[(vo + i) * 3 + 2] = na.getZ(i);
      col[(vo + i) * 3] = p.color[0];
      col[(vo + i) * 3 + 1] = p.color[1];
      col[(vo + i) * 3 + 2] = p.color[2];
      glow[vo + i] = p.glow;
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = vo + g.index.getX(i);
    else for (let i = 0; i < pa.count; i++) idx[io + i] = vo + i;
    io += g.index ? g.index.count : pa.count;
    vo += pa.count;
    g.dispose();
  }
  return { pos, nor, col, glow, idx, verts, tris: nIdx / 3 };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const GORE = Object.freeze([0.32, 0.03, 0.02]);
const EMBERS = Object.freeze([1.0, 0.55, 0.22]);
// burst options (reused: the FX burst reads them at once)
const O = { count: 8, spread: 0.15, size: 0.08, ground: false, up: false, tint: null };
const opt = (count, spread, size, tint, up) => {
  O.count = count;
  O.spread = spread;
  O.size = size;
  O.tint = tint || null;
  O.up = !!up;
  O.ground = false;
  return O;
};

export class WeaponView {
  constructor(game) {
    this.game = game;
    this.scene = game.renderer.scene;
    this.t = 0;
    const a = weaponTemplate(ITEM.GRENADE);
    const b = weaponTemplate(ITEM.SIDEARM);
    this.trianglesEach = Math.max(a.tris, b.tris);
    const V = a.verts + b.verts;
    const pos = new Float32Array(V * 3);
    const nor = new Float32Array(V * 3);
    const col = new Float32Array(V * 3);
    const part = new Float32Array(V * 2);
    const idx = new Uint16Array(a.idx.length + b.idx.length);
    pos.set(a.pos, 0);
    pos.set(b.pos, a.verts * 3);
    nor.set(a.nor, 0);
    nor.set(b.nor, a.verts * 3);
    col.set(a.col, 0);
    col.set(b.col, a.verts * 3);
    for (let i = 0; i < a.verts; i++) part[i * 2 + 1] = a.glow[i];
    for (let i = 0; i < b.verts; i++) {
      part[(a.verts + i) * 2] = 1;
      part[(a.verts + i) * 2 + 1] = b.glow[i];
    }
    idx.set(a.idx, 0);
    for (let i = 0; i < b.idx.length; i++) idx[a.idx.length + i] = b.idx[i] + a.verts;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPart', new THREE.BufferAttribute(part, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const N = WEAPON_VIEW.maxInstances;
    this._aState = new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2);
    this._aState.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aState', this._aState);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.5, emissive: 0x000000 });
    mat.name = 'weapons';
    patchMaterial(mat, { lit: true, grade: true, wetK: 0.3 });
    const base = mat.onBeforeCompile;
    const baseKey = String(mat.customProgramCacheKey());
    mat.onBeforeCompile = (shader, renderer) => {
      base(shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aPart;\nattribute vec2 aState;\nvarying float vWpGlow;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  transformed *= step( abs( aPart.x - aState.x ), 0.5 );
  vWpGlow = aState.y * aPart.y;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWpGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3( 1.0, 0.5, 0.16 ) * ( 5.0 * vWpGlow );');
    };
    mat.customProgramCacheKey = () => baseKey + '|at3d-weapons';
    this.mesh = new THREE.InstancedMesh(g, mat, N);
    this.mesh.name = 'weapons';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.stats = { instances: 0, triangles: 0, bursts: 0 };
  }

  _fx() {
    const r = this.game && this.game.renderer;
    return r && r.fx && typeof r.fx.burst === 'function' ? r.fx : null;
  }

  /** The effect bursts through the existing FX points / rubble (no draw call of its own). */
  burst(kind, x, y, z, k = 1) {
    const fx = this._fx();
    if (!fx || !isFinite(x) || !isFinite(y) || !isFinite(z)) return;
    this.stats.bursts++;
    if (kind === 'blast') {
      fx.burst('sparks', x, y + 0.2, z, opt(28, 0.3, 0.08, EMBERS));
      fx.burst('puff', x, y + 0.3, z, opt(16, 0.9, 0.08));
      fx.burst('chips', x, y + 0.1, z, opt(18, 0.4, 0.05));
      fx.burst('debris', x, y + 0.2, z, opt(9, 0.3, 0.07, null, true));
    } else if (kind === 'muzzle') {
      fx.burst('sparks', x, y, z, opt(5, 0.03, 0.05, EMBERS));
    } else if (kind === 'mason') {
      fx.burst('chips', x, y, z, opt(12 * k + 4, 0.25, 0.05));
      fx.burst('puff', x, y, z, opt(5, 0.3, 0.08));
    } else if (kind === 'splat') {
      fx.burst('splash', x, y, z, opt(22, 0.2, 0.08, GORE));
      fx.burst('chips', x, y, z, opt(10, 0.15, 0.05, GORE));
    } else if (kind === 'wall') {
      fx.burst('chips', x, y, z, opt(6, 0.05, 0.05));
      fx.burst('dust', x, y, z, opt(1, 0.05, 0.08));
    }
  }

  update(dt, game) {
    const g = game || this.game;
    this.t += dt;
    const glue = g.weapons;
    const w = glue && glue.sim;
    const mesh = this.mesh;
    const st = this._aState.array;
    let n = 0;
    if (w && !g.hidePlayer) {
      const G = WEAPONS.grenade;
      for (let i = 0; i < w.slots.length && n < WEAPON_VIEW.maxInstances; i++) {
        const s = w.slots[i];
        if (s.state !== GSTATE.FLIGHT && s.state !== GSTATE.REST && s.state !== GSTATE.HELD) continue;
        _q.setFromAxisAngle(_up, s.yaw);
        if (s.state === GSTATE.FLIGHT && s.spin !== 0) {
          _ax.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
          _q2.setFromAxisAngle(_ax, -s.spin);
          _q.premultiply(_q2);
        }
        _p.set(s.x, s.y + (s.state === GSTATE.REST ? 0.045 * WEAPON_VIEW.scale - G.radiusObj : 0), s.z);
        _s.set(WEAPON_VIEW.scale, WEAPON_VIEW.scale, WEAPON_VIEW.scale);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(n, _m);
        st[n * 2] = 0;
        // the ember: steady in the hand, flickering faster as the fuse runs down
        const left = s.state === GSTATE.HELD ? G.fuse : s.fuse;
        const rate = 9 + (1 - left / G.fuse) * 22;
        st[n * 2 + 1] = s.state === GSTATE.HELD ? 0.25 : 0.55 + 0.45 * Math.sin(this.t * rate + i);
        n++;
      }
      // VR: the revolver in the hand that drew it
      const rh = glue.revolverPose;
      if (rh && rh.on && n < WEAPON_VIEW.maxInstances) {
        _q.set(rh.qx, rh.qy, rh.qz, rh.qw);
        _p.set(rh.x, rh.y, rh.z);
        _s.set(1.2, 1.2, 1.2);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(n, _m);
        st[n * 2] = 1;
        st[n * 2 + 1] = 0;
        n++;
      }
      if (n > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        this._aState.needsUpdate = true;
      }
    }
    mesh.count = n;
    this.stats.instances = n;
    this.stats.triangles = n * this.trianglesEach;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
