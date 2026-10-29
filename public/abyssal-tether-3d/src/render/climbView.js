/* ABYSSAL TETHER 3D — climbView.js
 * Marks the climbable surfaces (level data `climb`, sim/climb3d.js) with chalk-pale studs so a player can read what can be
 * gripped: short rungs of dressed stone standing proud of the wall, a few per square metre, jittered, every one a handhold.
 *
 *   ClimbView(game)         game: { renderer.scene, level, sectionIndex, player }
 *   .update(dt, game)       once per frame (Game3D._updateViews): builds the studs when the level changes, shows only the
 *                           sections near the player
 *   .dispose()
 *
 * ONE InstancedMesh per section that has zones (all sharing one geometry and one material), so at most one or two are in
 * the frame (sections not near the player are switched off): 1-2 draw calls, a stud is 12 triangles, a few hundred per
 * section. A MeshStandardMaterial (lit by the lantern like the rest of the level, swallowed by the fog) with a little
 * self-emission so the marks read in the dark before the lantern reaches them. Nothing is allocated per frame.
 * The glow of a hold in reach is drawn by the hands (render/handsView.js), not here.
 */

import * as THREE from 'three';
import { holdfastMode, onPatch, resolveHoldfastSites } from '../sim/holdfast3d.js';

/** THE HOLDFAST's patches (sim/holdfast3d.js): no chalk stud there, the knuckles take their place (unless ?holdfast=off). */
function holdfastPatches(level) {
  try {
    if (holdfastMode(typeof location !== 'undefined' ? location.search || '' : '') === 'off') return [];
    return resolveHoldfastSites(level).sites;
  } catch {
    return [];
  }
}

const SPACING_U = 0.8; // m along the surface
const SPACING_V = 0.9;
const SHOW_RANGE = 70; // m: sections farther than this (vertically) from the player are not drawn
const CHALK = 0xd9d3bd;

function hash(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}

export class ClimbView {
  constructor(game) {
    this.scene = game.renderer.scene;
    this.geometry = new THREE.BoxGeometry(0.2, 0.07, 0.12);
    this.material = new THREE.MeshStandardMaterial({ color: CHALK, roughness: 0.92, metalness: 0, emissive: 0x6d6858, emissiveIntensity: 0.42 });
    this.material.name = 'climbStuds';
    this.meshes = []; // { mesh, minY, maxY }
    this._level = null;
    this._m = new THREE.Matrix4();
    this._t = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qr = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this.count = 0;
    this.build(game.level);
  }

  /** Builds the studs of every zone of `level` (one InstancedMesh per section). */
  build(level) {
    this._clear();
    this._level = level || null;
    const zones = level && Array.isArray(level.climb) ? level.climb : [];
    this._hf = level ? holdfastPatches(level) : [];
    this.skipped = 0;
    const bySection = new Map();
    for (let zi = 0; zi < zones.length; zi++) {
      const z = zones[zi];
      const k = z.section;
      if (!bySection.has(k)) bySection.set(k, []);
      bySection.get(k).push(zi);
    }
    let total = 0;
    for (const [, list] of bySection) {
      const mats = [];
      let minY = Infinity;
      let maxY = -Infinity;
      for (const zi of list) {
        const z = zones[zi];
        this._studs(z, zi, mats);
        if (z.minY < minY) minY = z.minY;
        if (z.maxY > maxY) maxY = z.maxY;
      }
      if (!mats.length) continue;
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, mats.length);
      mesh.name = 'AT3D-climb-studs';
      for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.visible = true; // visible until the first update: the scene precompile compiles the program
      this.scene.add(mesh);
      this.meshes.push({ mesh, minY, maxY });
      total += mats.length;
    }
    this.count = total;
  }

  /** Appends the stud matrices of one zone to `out`. */
  _studs(z, zi, out) {
    const m = this._m;
    const n = this._n;
    const t = this._t;
    const u = this._u;
    const q = this._q;
    if (z.kind === 'chain') {
      // rungs of grip around the links: one every ~0.8 m, turning a quarter each time
      const cx = (z.minX + z.maxX) / 2;
      const cz = (z.minZ + z.maxZ) / 2;
      let i = 0;
      for (let y = z.minY + 0.3; y < z.maxY - 0.1; y += 0.8, i++) {
        const a = (i & 3) * (Math.PI / 2) + hash(zi * 977 + i) * 0.3;
        n.set(Math.cos(a), 0, Math.sin(a));
        t.set(n.z, 0, -n.x);
        u.set(0, 1, 0);
        m.makeBasis(t, u, n);
        m.setPosition(cx + n.x * 0.3, y, cz + n.z * 0.3);
        out.push(m.clone());
      }
      return;
    }
    // the surface frame: n out of the wall, t / u along it
    n.set(z.nx, z.ny, z.nz);
    let uLo;
    let uHi;
    let vLo;
    let vHi;
    let underside = false;
    if (z.ny !== 0) {
      underside = true;
      uLo = z.minX;
      uHi = z.maxX;
      vLo = z.minZ;
      vHi = z.maxZ;
    } else if (z.nx !== 0) {
      uLo = z.minZ;
      uHi = z.maxZ;
      vLo = z.minY;
      vHi = z.maxY;
    } else {
      uLo = z.minX;
      uHi = z.maxX;
      vLo = z.minY;
      vHi = z.maxY;
    }
    const nu = Math.max(1, Math.floor((uHi - uLo) / SPACING_U));
    const nv = Math.max(1, Math.floor((vHi - vLo) / SPACING_V));
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const seed = zi * 7919 + j * 131 + i * 17;
        const fu = (i + 0.5 + (j & 1) * 0.5 + (hash(seed) - 0.5) * 0.5) / (nu + 0.5);
        const fv = (j + 0.5 + (hash(seed + 5) - 0.5) * 0.5) / nv;
        const a = uLo + (uHi - uLo) * Math.min(0.98, Math.max(0.02, fu));
        const b = vLo + (vHi - vLo) * Math.min(0.98, Math.max(0.02, fv));
        let px;
        let py;
        let pz;
        if (underside) {
          t.set(1, 0, 0);
          u.set(0, 0, 1);
          px = a;
          pz = b;
          py = z.face - 0.06;
        } else if (z.nx !== 0) {
          t.set(0, 0, -z.nx); // (nz, 0, -nx) with nz = 0
          u.set(0, 1, 0);
          px = z.face + z.nx * 0.06;
          py = b;
          pz = a;
        } else {
          t.set(z.nz, 0, 0);
          u.set(0, 1, 0);
          px = a;
          py = b;
          pz = z.face + z.nz * 0.06;
        }
        let held = false;
        for (let h = 0; h < this._hf.length && !held; h++) {
          const s = this._hf[h];
          held = s.zone === z && onPatch(s, px, py, pz);
        }
        if (held) {
          this.skipped++;
          continue; // THE HOLDFAST: these studs are its knuckles
        }
        m.makeBasis(t, u, n);
        // a little twist about the normal so no two rungs read alike, and a width range
        const tw = (hash(seed + 11) - 0.5) * 0.5;
        this._qr.setFromAxisAngle(n, tw);
        q.setFromRotationMatrix(m).premultiply(this._qr);
        this._s.set(0.8 + hash(seed + 3) * 0.7, 1, 0.9 + hash(seed + 9) * 0.5);
        m.compose(this._v.set(px, py, pz), q, this._s);
        out.push(m.clone());
      }
    }
  }

  _clear() {
    for (const e of this.meshes) {
      if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
      e.mesh.dispose();
    }
    this.meshes.length = 0;
    this.count = 0;
  }

  update(dt, game) {
    const lvl = game ? game.level : null;
    if (lvl !== this._level) this.build(lvl);
    const p = game ? game.player : null;
    const st = game ? game.state : '';
    const inRun = !!p && !game.hidePlayer && (st === 'playing' || st === 'paused' || st === 'dead' || st === 'victory');
    const py = p ? p.ry : 0;
    for (let i = 0; i < this.meshes.length; i++) {
      const e = this.meshes[i];
      const gap = py > e.maxY ? py - e.maxY : py < e.minY ? e.minY - py : 0;
      e.mesh.visible = inRun && gap < SHOW_RANGE;
    }
  }

  dispose() {
    this._clear();
    this.geometry.dispose();
    this.material.dispose();
  }
}
