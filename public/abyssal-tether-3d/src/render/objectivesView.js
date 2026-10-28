/* ABYSSAL TETHER 3D — objectivesView.js
 * The section seals' iron grating (LEVEL_FUN_PLAN P1, sim/objectives3d.js): ONE InstancedMesh of opaque iron bars (the unit
 * box with the level's `metal` material) for every seal, so all seals together cost one draw call, drawn only while a seal
 * is in view distance and not open. Not the alpha-tested `grate` material: its double-sided overdraw over floors of up to
 * 1,600 m² is the wrong cost on Quest.
 *
 * Closed: parallel bars over each plate's top face (along its long side, every BAR.gap m) on cross straps. Opening ('slide'):
 * the two halves of a plate part toward the walls over BAR.openTime; ('iris') each quarter slides away from the seal's centre
 * into the floor around it. Fully open seals are not drawn. Render-only motion: the sim already let go of the solids.
 *
 * sealBars(level) is pure (Node-testable); SealView owns the mesh. The instance buffer is re-packed only when the set of
 * seals in view or their open state changes, and every frame while one is opening.
 */
import * as THREE from 'three';

export const BAR = Object.freeze({
  gap: 0.5, // m between bar centres
  w: 0.11, // bar width
  h: 0.14, // bar height (its top is the plate's top: the floor you stand on)
  strapEvery: 4, // m between cross straps (under the bars)
  strapW: 0.18,
  strapH: 0.1,
  frame: 0.22, // a rail along each long edge of a plate
  openTime: 1.4, // s
  tint: [0.42, 0.4, 0.38], // dark iron (instance colour times the metal material)
});

/**
 * The bars of every seal of the level (its `sealSolids`, grouped by seal id). Each bar: centre (x, y, z), size (sx, sy, sz)
 * and the offset it slides by when its seal opens (dx, dz). Returns [{ id, minX, maxX, minY, maxY, minZ, maxZ, n, bars:
 * Float32Array(n * 8) }].
 */
export function sealBars(level) {
  const plates = (level && level.sealSolids) || [];
  const groups = new Map();
  for (const p of plates) {
    if (!groups.has(p.seal)) groups.set(p.seal, []);
    groups.get(p.seal).push(p);
  }
  const out = [];
  for (const [id, list] of groups) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of list) {
      minX = Math.min(minX, p.minX);
      maxX = Math.max(maxX, p.maxX);
      minZ = Math.min(minZ, p.minZ);
      maxZ = Math.max(maxZ, p.maxZ);
      minY = Math.min(minY, p.minY);
      maxY = Math.max(maxY, p.maxY);
    }
    const iris = list.length > 1;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const bars = [];
    for (const p of list) plateBars(p, iris, cx, cz, bars);
    out.push({ id, minX, maxX, minY, maxY, minZ, maxZ, n: bars.length / 8, bars: Float32Array.from(bars) });
  }
  return out;
}

/** Bars of one plate. Iris plates slide as one away from the seal's centre (cx, cz); a lone plate parts in two halves. */
function plateBars(p, iris, cx, cz, out) {
  const lx = p.maxX - p.minX;
  const lz = p.maxZ - p.minZ;
  const alongX = lx >= lz; // bars run along the long side
  const len = alongX ? lx : lz;
  const span = alongX ? lz : lx;
  const a0 = alongX ? p.minZ : p.minX; // the across axis
  const amid = a0 + span / 2;
  const top = p.maxY;
  const pcx = (p.minX + p.maxX) / 2;
  const pcz = (p.minZ + p.maxZ) / 2;
  // iris: the whole plate slides outward along its dominant offset from the centre
  let idx = 0;
  let idz = 0;
  if (iris) {
    const ox = pcx - cx;
    const oz = pcz - cz;
    if (Math.abs(ox) >= Math.abs(oz)) idx = Math.sign(ox || 1) * lx;
    else idz = Math.sign(oz || 1) * lz;
  }
  const push = (x, y, z, sx, sy, sz, dx, dz) => out.push(x, y, z, sx, sy, sz, dx, dz);
  /** Offset of an element centred at `a` (half its width across: `hw`): each half slides until it is past its own edge. */
  const slideOf = (a, hw) => {
    if (iris) return [idx, idz];
    const d = a < amid ? -(a - a0) - hw - BAR.gap : a0 + span - a + hw + BAR.gap;
    return alongX ? [0, d] : [d, 0];
  };
  // bars
  const nb = Math.max(1, Math.floor(span / BAR.gap));
  const step = span / nb;
  for (let k = 0; k < nb; k++) {
    const a = a0 + step * (k + 0.5);
    const [dx, dz] = slideOf(a, BAR.w / 2);
    if (alongX) push(pcx, top - BAR.h / 2, a, len, BAR.h, BAR.w, dx, dz);
    else push(a, top - BAR.h / 2, pcz, BAR.w, BAR.h, len, dx, dz);
  }
  // cross straps under the bars: one per half (a lone plate parts between them), every strapEvery m along the length
  const ns = Math.max(2, Math.round(len / BAR.strapEvery) + 1);
  const l0 = (alongX ? p.minX : p.minZ) + 0.3;
  const l1 = (alongX ? p.maxX : p.maxZ) - 0.3;
  const halves = iris ? [[a0, a0 + span]] : [[a0, amid], [amid, a0 + span]];
  for (let s = 0; s < ns; s++) {
    const l = l0 + ((l1 - l0) * s) / (ns - 1);
    for (const [h0, h1] of halves) {
      const am = (h0 + h1) / 2;
      const [dx, dz] = slideOf(am, (h1 - h0) / 2);
      const y = top - BAR.h - BAR.strapH / 2;
      if (alongX) push(l, y, am, BAR.strapW, BAR.strapH, h1 - h0, dx, dz);
      else push(am, y, l, h1 - h0, BAR.strapH, BAR.strapW, dx, dz);
    }
  }
  // the two rails along the long edges (they part with their halves)
  for (const a of [a0 + BAR.frame / 2, a0 + span - BAR.frame / 2]) {
    const [dx, dz] = slideOf(a, BAR.frame / 2);
    if (alongX) push(pcx, top - BAR.h / 2 - 0.02, a, len, BAR.h + 0.04, BAR.frame, dx, dz);
    else push(a, top - BAR.h / 2 - 0.02, pcz, BAR.frame, BAR.h + 0.04, len, dx, dz);
  }
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();
const _b = new THREE.Box3();

const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

export class SealView {
  /**
   * @param {Level3D} level
   * @param {THREE.Material} material   the level view's `metal` bucket material (shared, not owned)
   * @param {THREE.BufferGeometry} unitBox  a 1 m box (cloned here)
   * @param {THREE.Object3D} root
   */
  constructor(level, material, unitBox, root) {
    this.seals = sealBars(level);
    this.total = this.seals.reduce((n, s) => n + s.n, 0);
    this.mesh = null;
    this.stats = { bars: this.total, drawn: 0, packs: 0 };
    this._state = this.seals.map(() => ({ open: 0, t: 0, near: false, oi: -1 }));
    this._objectives = null;
    this._mask = -1; // bit i: seal i is drawn (in view and not fully open)
    if (!this.total || !material || !unitBox) return;
    const geo = unitBox.clone();
    // the bucket material reads a per-instance lightmap row (iLm, 0 = none: the baked volume lights the bars)
    geo.setAttribute('iLm', new THREE.InstancedBufferAttribute(new Float32Array(this.total), 1));
    const mesh = new THREE.InstancedMesh(geo, material, this.total);
    mesh.name = 'seal_bars';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _c.setRGB(BAR.tint[0], BAR.tint[1], BAR.tint[2]);
    for (let i = 0; i < this.total; i++) mesh.setColorAt(i, _c);
    root.add(mesh);
    this.mesh = mesh;
  }

  /**
   * Once per frame. `objectives` = game.objectives (null: nothing is drawn); `head` = world head position; `vd` = the
   * view distance.
   */
  update(dt, objectives, head, vd) {
    const mesh = this.mesh;
    if (!mesh) return;
    if (objectives !== this._objectives) {
      // a new run (or the menu): map our seals onto its seals by id; their current state shows at once (no animation)
      this._objectives = objectives;
      for (let i = 0; i < this.seals.length; i++) {
        const st = this._state[i];
        st.oi = -1;
        if (objectives) for (const s of objectives.seals) if (s.id === this.seals[i].id) st.oi = s.index;
        st.open = st.oi >= 0 && objectives.sealOpen[st.oi] ? 1 : 0;
        st.t = st.open ? BAR.openTime : 0;
      }
      this._mask = -1;
    }
    let anim = false;
    let mask = 0;
    for (let i = 0; i < this.seals.length; i++) {
      const s = this.seals[i];
      const st = this._state[i];
      const open = !objectives || st.oi < 0 || objectives.sealOpen[st.oi] ? 1 : 0;
      _b.min.set(s.minX - 2, s.minY - 1, s.minZ - 2);
      _b.max.set(s.maxX + 2, s.maxY + 1, s.maxZ + 2);
      const near = _b.distanceToPoint(head) <= vd;
      if (open !== st.open) {
        st.open = open;
        // it slides open only when opened in play and in sight; out of sight, or opened silently (a warp, Continue), it is gone
        st.t = open && near && objectives && objectives.sealLoud && objectives.sealLoud[st.oi] ? 0 : open ? BAR.openTime : 0;
      }
      if (st.open && st.t < BAR.openTime) {
        st.t = Math.min(BAR.openTime, st.t + dt);
        anim = true;
      }
      st.near = near && !(st.open && st.t >= BAR.openTime);
      if (st.near) mask |= 1 << i;
    }
    if (!anim && mask === this._mask) return;
    this._mask = anim ? -1 : mask;
    let n = 0;
    _q.identity();
    for (let i = 0; i < this.seals.length; i++) {
      const st = this._state[i];
      if (!st.near) continue;
      const k = st.open ? ease(st.t / BAR.openTime) : 0;
      const b = this.seals[i].bars;
      for (let j = 0; j < b.length; j += 8) {
        _p.set(b[j] + b[j + 6] * k, b[j + 1], b[j + 2] + b[j + 7] * k);
        _s.set(b[j + 3], b[j + 4], b[j + 5]);
        mesh.setMatrixAt(n++, _m.compose(_p, _q, _s));
      }
    }
    mesh.count = n;
    mesh.visible = n > 0;
    if (n) mesh.instanceMatrix.needsUpdate = true;
    this.stats.drawn = n;
    this.stats.packs++;
  }
}
