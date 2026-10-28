/* ABYSSAL TETHER 3D — objectivesView.js
 * The section seals' iron grating (LEVEL_FUN_PLAN P1, sim/objectives3d.js): ONE InstancedMesh of opaque iron bars (the unit
 * box with the level's `metal` material) for every seal, so all seals together cost one draw call, drawn only while a seal
 * is in view distance and not open. Not the alpha-tested `grate` material: its double-sided overdraw over floors of up to
 * 1,600 m² is the wrong cost on Quest.
 *
 * P3 ("first verbs"): the things the verbs act on are folded into the same mesh (no new draw call): the S1 bell (a stack of
 * bronze-tinted boxes that swings about its chain after a strike) and the S2 counterweight (an iron block on its own chain
 * that rises a notch per haul notch, under a pulley housing). The S4 lamps' housings are level decor (the kit lantern,
 * `lit: false`); a relit lamp's flame is one instance of a second small InstancedMesh with the level's emissive decor glow
 * material (+1 call only while a relit lamp is in view; no light: the baked lamp pools follow the objective's progress in
 * render/lighting.js).
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

/** Same rule as level3d.js inVariant (`omitIn` / `onlyIn`). */
function inVariant(o, v) {
  if (Array.isArray(o.onlyIn) && o.onlyIn.length > 0 && o.onlyIn.indexOf(v) < 0) return false;
  return !(Array.isArray(o.omitIn) && o.omitIn.indexOf(v) >= 0);
}

export const FIX = Object.freeze({
  bronze: [0.68, 0.47, 0.22],
  iron: [0.36, 0.34, 0.32],
  band: [0.55, 0.5, 0.44],
  bellSwing: 0.32, // rad, the first swing after a strike
  bellPeriod: 1.7, // s
  bellDecay: 1.6, // s
  notchRise: 0.9, // m the counterweight rises per notch
  flame: 0.075, // m, the octahedral flame core of a relit lamp
  flameColor: [1.9, 1.15, 0.45],
});

/**
 * The view parts of the level's P3 fixtures (pure: Node-testable). Bell: boxes relative to its pivot (the top, where the
 * chain holds it); counterweight: block, band, chain and pulley housing around its ring; lamp: the flame position.
 * Returns [{ id, kind, x, y, z, minX..maxZ, boxes: [[dx, dy, dz, sx, sy, sz, rotY, r, g, b]...], pivot?, ring?, pulleyY? }].
 */
export function fixtureParts(level) {
  const d = (level && level.data) || {};
  const v = (level && level.variant) || 'normal';
  const out = [];
  for (const f of Array.isArray(d.fixtures) ? d.fixtures : []) {
    if (!f || typeof f.id !== 'string' || !inVariant(f, v)) continue;
    if (f.kind === 'bell') {
      const r = typeof f.r === 'number' ? f.r : 0.75;
      const k = r / 0.75;
      const B = FIX.bronze;
      const boxes = [
        [0, -0.12, 0, 0.36, 0.24, 0.36, 0],
        [0, -0.42, 0, 0.85, 0.38, 0.85, Math.PI / 4],
        [0, -0.85, 0, 1.15, 0.5, 1.15, 0],
        [0, -1.28, 0, 1.5, 0.3, 1.5, Math.PI / 4],
      ].map((b) => [b[0] * k, b[1] * k, b[2] * k, b[3] * k, b[4] * k, b[5] * k, b[6], B[0], B[1], B[2]]);
      boxes.push([0, -1.22 * k, 0, 0.16 * k, 0.5 * k, 0.16 * k, 0, FIX.iron[0], FIX.iron[1], FIX.iron[2]]); // the clapper
      const py = f.y + r;
      out.push({ id: f.id, kind: 'bell', x: f.x, y: py, z: f.z, minX: f.x - 1.2 * k, maxX: f.x + 1.2 * k, minY: py - 1.6 * k, maxY: py, minZ: f.z - 1.2 * k, maxZ: f.z + 1.2 * k, boxes });
    } else if (f.kind === 'haul') {
      const a = level.byId && level.byId[f.anchorId];
      if (!a || a.x === undefined) continue;
      const bx = a.x + 1.1;
      let top = a.y + 8;
      const hit = typeof level.raycast === 'function' ? level.raycast(a.x + 0.55, a.y + 1, a.z, 0, 1, 0, 20) : null;
      if (hit) top = hit.y;
      const pulleyY = top - 0.3;
      out.push({ id: f.id, kind: 'haul', x: bx, y: a.y, z: a.z, ring: [a.x, a.y, a.z], pulleyY, notches: Math.max(1, Math.round(f.notches || 1)), minX: a.x - 1, maxX: bx + 1, minY: a.y - 1, maxY: top, minZ: a.z - 1, maxZ: a.z + 1, boxes: [] });
    } else if (f.kind === 'lamp') {
      out.push({ id: f.id, kind: 'lamp', x: f.x, y: f.y, z: f.z, minX: f.x - 0.5, maxX: f.x + 0.5, minY: f.y - 0.5, maxY: f.y + 0.5, minZ: f.z - 0.5, maxZ: f.z + 0.5, boxes: [] });
    }
  }
  return out;
}

/** The counterweight's boxes for `k` notches raised (0..notches, fractional while it moves). */
export function counterweightBoxes(fx, k) {
  const I = FIX.iron;
  const N = FIX.band;
  const by = fx.ring[1] + 2 + k * FIX.notchRise; // block centre
  const top = by + 0.55;
  const chain = Math.max(0.05, fx.pulleyY - 0.22 - top);
  return [
    [fx.x, by, fx.z, 0.8, 1.1, 0.8, 0, I[0], I[1], I[2]],
    [fx.x, by + 0.3, fx.z, 0.86, 0.12, 0.86, 0, N[0], N[1], N[2]],
    [fx.x, top + chain / 2, fx.z, 0.07, chain, 0.07, 0, I[0], I[1], I[2]],
    [(fx.x + fx.ring[0]) / 2, fx.pulleyY, fx.z, Math.abs(fx.x - fx.ring[0]) + 0.6, 0.45, 0.5, 0, I[0], I[1], I[2]],
  ];
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const _b = new THREE.Box3();

const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

export class SealView {
  /**
   * @param {Level3D} level
   * @param {THREE.Material} material   the level view's `metal` bucket material (shared, not owned)
   * @param {THREE.BufferGeometry} unitBox  a 1 m box (cloned here)
   * @param {THREE.Object3D} root
   * @param {THREE.Material} [glowMaterial]  the level view's emissive decor glow material (vertex colours): relit lamps
   */
  constructor(level, material, unitBox, root, glowMaterial) {
    this.seals = sealBars(level);
    this.fixtures = fixtureParts(level);
    this.total = this.seals.reduce((n, s) => n + s.n, 0);
    // the bell and the counterweight join the bars' mesh: room for their boxes
    const fixBoxes = this.fixtures.reduce((n, f) => n + (f.kind === 'bell' ? f.boxes.length : f.kind === 'haul' ? 4 : 0), 0);
    this.lamps = this.fixtures.filter((f) => f.kind === 'lamp');
    this.mesh = null;
    this.glow = null;
    this.stats = { bars: this.total, fixtureBoxes: fixBoxes, drawn: 0, packs: 0, flames: 0 };
    this._state = this.seals.map(() => ({ open: 0, t: 0, near: false, oi: -1 }));
    this._fxState = this.fixtures.map(() => ({ fi: -1, near: false, k: 0, lit: false, swing: 0 }));
    this._objectives = null;
    this._mask = -1; // bit i: seal i is drawn (in view and not fully open)
    this._fxMask = -1; // bit j: fixture j is drawn (in view)
    this._glowMask = -1;
    const cap = this.total + fixBoxes;
    if (!cap || !material || !unitBox) return;
    const geo = unitBox.clone();
    // the bucket material reads a per-instance lightmap row (iLm, 0 = none: the baked volume lights the bars)
    geo.setAttribute('iLm', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    const mesh = new THREE.InstancedMesh(geo, material, cap);
    mesh.name = 'seal_bars';
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _c.setRGB(BAR.tint[0], BAR.tint[1], BAR.tint[2]);
    for (let i = 0; i < cap; i++) mesh.setColorAt(i, _c);
    if (mesh.instanceColor) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    root.add(mesh);
    this.mesh = mesh;
    if (this.lamps.length && glowMaterial) {
      // relit lamps: an octahedral flame core per lamp, white vertex colour times the instance colour (emissive, unlit)
      const og = new THREE.OctahedronGeometry(1, 0);
      const col = new Float32Array(og.attributes.position.count * 3).fill(1);
      og.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const gm = new THREE.InstancedMesh(og, glowMaterial, this.lamps.length);
      gm.name = 'lamp_flames';
      gm.count = 0;
      gm.frustumCulled = false;
      gm.visible = false;
      _c.setRGB(FIX.flameColor[0], FIX.flameColor[1], FIX.flameColor[2]);
      for (let i = 0; i < this.lamps.length; i++) gm.setColorAt(i, _c);
      root.add(gm);
      this.glow = gm;
    }
  }

  /**
   * Once per frame. `objectives` = game.objectives (null: nothing is drawn); `head` = world head position; `vd` = the
   * view distance; `t` = the run clock (game.time: the bell's swing after a strike).
   */
  update(dt, objectives, head, vd, t = 0) {
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
      for (let j = 0; j < this.fixtures.length; j++) {
        const fs = this._fxState[j];
        fs.fi = objectives && typeof objectives.fixtureIndex === 'function' ? objectives.fixtureIndex(this.fixtures[j].id) : -1;
        fs.k = this._notchTarget(j);
      }
      this._mask = -1;
      this._fxMask = -1;
      this._glowMask = -1;
    }
    const fxAnim = this._updateFixtures(dt, objectives, head, vd, t);
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
    if (!anim && !fxAnim && mask === this._mask) return;
    this._mask = anim || fxAnim === 2 ? -1 : mask;
    let n = 0;
    _q.identity();
    _c.setRGB(BAR.tint[0], BAR.tint[1], BAR.tint[2]);
    for (let i = 0; i < this.seals.length; i++) {
      const st = this._state[i];
      if (!st.near) continue;
      const k = st.open ? ease(st.t / BAR.openTime) : 0;
      const b = this.seals[i].bars;
      for (let j = 0; j < b.length; j += 8) {
        _p.set(b[j] + b[j + 6] * k, b[j + 1], b[j + 2] + b[j + 7] * k);
        _s.set(b[j + 3], b[j + 4], b[j + 5]);
        mesh.setMatrixAt(n, _m.compose(_p, _q, _s));
        mesh.setColorAt(n++, _c);
      }
    }
    n = this._packFixtures(mesh, n);
    mesh.count = n;
    mesh.visible = n > 0;
    if (n) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.stats.drawn = n;
    this.stats.packs++;
  }

  /** Notches the counterweight shows (done: all of them). */
  _notchTarget(j) {
    const O = this._objectives;
    const fs = this._fxState[j];
    const f = this.fixtures[j];
    if (!O || fs.fi < 0 || f.kind !== 'haul') return 0;
    return O.fixtureDone(fs.fi) ? f.notches : O.fxN ? O.fxN[fs.fi] : 0;
  }

  /**
   * Fixture states for this frame (in view, the bell's swing, the counterweight's height, the lit lamps). Returns 0: no
   * change, 1: the set in view changed (one re-pack), 2: something moves (a re-pack every frame).
   */
  _updateFixtures(dt, O, head, vd, t) {
    let anim = false;
    let mask = 0;
    let glowMask = 0;
    for (let j = 0; j < this.fixtures.length; j++) {
      const f = this.fixtures[j];
      const fs = this._fxState[j];
      _b.min.set(f.minX - 1, f.minY - 1, f.minZ - 1);
      _b.max.set(f.maxX + 1, f.maxY + 1, f.maxZ + 1);
      fs.near = !!O && fs.fi >= 0 && _b.distanceToPoint(head) <= vd;
      if (!fs.near) continue;
      if (f.kind === 'lamp') {
        fs.lit = O.fixtureDone(fs.fi);
        if (fs.lit) glowMask |= 1 << j;
        continue;
      }
      mask |= 1 << j;
      if (f.kind === 'bell') {
        const e = t - (O.fxHitT ? O.fxHitT[fs.fi] : -1e9);
        fs.swing = e >= 0 && e < FIX.bellDecay * 5 ? FIX.bellSwing * Math.exp(-e / FIX.bellDecay) * Math.sin((2 * Math.PI * e) / FIX.bellPeriod) : 0;
        if (fs.swing !== 0) anim = true;
      } else if (f.kind === 'haul') {
        const target = this._notchTarget(j);
        if (Math.abs(target - fs.k) > 0.002) {
          fs.k += (target - fs.k) * Math.min(1, dt * 5);
          anim = true;
        } else fs.k = target;
      }
    }
    let changed = false;
    if (mask !== this._fxMask) {
      this._fxMask = mask;
      changed = true;
    }
    if (this.glow && glowMask !== this._glowMask) {
      this._glowMask = glowMask;
      let g = 0;
      _q.identity();
      for (let j = 0; j < this.fixtures.length; j++) {
        if (!(glowMask & (1 << j))) continue;
        const f = this.fixtures[j];
        _p.set(f.x, f.y, f.z);
        _s.set(FIX.flame, FIX.flame * 1.6, FIX.flame);
        this.glow.setMatrixAt(g++, _m.compose(_p, _q, _s));
      }
      this.glow.count = g;
      this.glow.visible = g > 0;
      if (g) this.glow.instanceMatrix.needsUpdate = true;
      this.stats.flames = g;
    }
    return anim ? 2 : changed ? 1 : 0;
  }

  /** Writes the bell / counterweight boxes after the bars; returns the new instance count. */
  _packFixtures(mesh, n) {
    for (let j = 0; j < this.fixtures.length; j++) {
      if (!(this._fxMask & (1 << j))) continue;
      const f = this.fixtures[j];
      const fs = this._fxState[j];
      if (f.kind === 'bell') {
        const O = this._objectives;
        const hx = O && O.fxHitX ? O.fxHitX[fs.fi] : 1;
        const hz = O && O.fxHitZ ? O.fxHitZ[fs.fi] : 0;
        _ax.set(hz, 0, -hx);
        if (_ax.lengthSq() < 1e-6) _ax.set(1, 0, 0);
        _ax.normalize();
        _q2.setFromAxisAngle(_ax, fs.swing);
        for (const b of f.boxes) {
          _p.set(b[0], b[1], b[2]).applyQuaternion(_q2);
          _p.x += f.x;
          _p.y += f.y;
          _p.z += f.z;
          _q.setFromAxisAngle(_up, b[6]).premultiply(_q2);
          _s.set(b[3], b[4], b[5]);
          mesh.setMatrixAt(n, _m.compose(_p, _q, _s));
          _c.setRGB(b[7], b[8], b[9]);
          mesh.setColorAt(n++, _c);
        }
      } else if (f.kind === 'haul') {
        _q.identity();
        for (const b of counterweightBoxes(f, fs.k)) {
          _p.set(b[0], b[1], b[2]);
          _s.set(b[3], b[4], b[5]);
          mesh.setMatrixAt(n, _m.compose(_p, _q, _s));
          _c.setRGB(b[7], b[8], b[9]);
          mesh.setColorAt(n++, _c);
        }
      }
    }
    return n;
  }
}
