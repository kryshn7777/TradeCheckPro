/* ABYSSAL TETHER 3D — bloodWriting.js
 * Settings › Display › Blood writing (OFF by default): the Masons' messages in blood (data/blood-writing-3d.js, read from
 * `level.data.blood`), drawn only while the setting is on. LevelView owns one BloodWriting; Renderer3D switches it from
 * settings.bloodWriting every frame (built / removed live, then precompiled).
 *
 * Cost: every writing is one quad (2 triangles) cut from ONE procedural canvas atlas (2 columns of 768 x 256 cells: 1536 x 2816
 * for the 21 texts, about 22 MB with mips, allocated only while the setting is on), merged into ONE mesh with ONE material for the whole level: at most one draw call (per
 * eye), only while a writing is within BLOOD_DIST (x the view's detail scale) of the head, otherwise none. The material is
 * the decals' recipe (render/materials.js m.decal: alpha-blended, lit by the baked GI volume, the lantern and the pooled
 * lamps; polygon offset, no depth write), so the writing reads by lamp light and lantern like the stains around it.
 * Nothing here is a level object: no collider, anchor, climb surface, bake, lightmap / GI hash or dressing keep-out.
 *
 * The scrawl (drawBloodText): no web font is needed: a generic hand / cursive stack, and every glyph gets its own size,
 * rotation, offset and an irregular, drifting baseline; finger-thick strokes (offset copies + a fat stroke), a faint wet
 * highlight on the top-left edges, wiped smears under the letters and drips running down from them with a bead at the end;
 * dark wet red (#7a0b0b) drying to near black (#2a0303), fresher the deeper it was written. Transparent background.
 */

import * as THREE from 'three';
import { DEFAULT_TILE, patchMaterial } from './materials.js';
import { BLOOD_ASPECT, BLOOD_MAX_LINES } from '../data/blood-writing-3d.js';

export const BLOOD_CELL_W = 768;
export const BLOOD_CELL_H = Math.round(BLOOD_CELL_W / BLOOD_ASPECT); // 256
export const BLOOD_COLS = 2;
/** A writing is in view while the head is within this many metres (x the view's detail scale: Quest 0.85 → 11.9 m). */
export const BLOOD_DIST = 14;
const OFF_WALL = 0.014; // metres off the wall / floor (plus polygon offset): never z-fights, never floats visibly
const OFF_FLOOR = 0.012;
const PAD = 2; // px kept clear around each atlas cell (filtering / mips never bleed a neighbour)
const FRESH = [0x7a, 0x0b, 0x0b]; // #7a0b0b
const DRY = [0x2a, 0x03, 0x03]; // #2a0303
const FONT = "'Segoe Print', 'Bradley Hand', 'Chalkboard SE', 'Comic Sans MS', cursive, sans-serif";

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/** mulberry32: the same scrawl every build. */
function rngOf(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bloodColor(t, alpha = 1) {
  const c = (i) => Math.round(FRESH[i] + (DRY[i] - FRESH[i]) * t);
  return `rgba(${c(0)},${c(1)},${c(2)},${alpha})`;
}

/** Atlas size for n writings: { w, h, rows }. */
export function bloodAtlasSize(n) {
  const rows = Math.max(1, Math.ceil(Math.max(1, n) / BLOOD_COLS));
  return { w: BLOOD_COLS * BLOOD_CELL_W, h: rows * BLOOD_CELL_H, rows };
}

/** Pixel rect of atlas cell i: [x, y, w, h]. */
export function bloodCell(i) {
  return [(i % BLOOD_COLS) * BLOOD_CELL_W, Math.floor(i / BLOOD_COLS) * BLOOD_CELL_H, BLOOD_CELL_W, BLOOD_CELL_H];
}

/** A run of blood from (x, y) down `len` px: tapering, wandering a little, a bead at its end, a glint on the bead. */
function drip(ctx, x, y, len, w, col, rng) {
  const wander = (rng() - 0.5) * w * 1.6;
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.5, y);
  ctx.quadraticCurveTo(x - w * 0.34 + wander * 0.4, y + len * 0.55, x - w * 0.26 + wander, y + len);
  ctx.lineTo(x + w * 0.26 + wander, y + len);
  ctx.quadraticCurveTo(x + w * 0.34 + wander * 0.4, y + len * 0.55, x + w * 0.5, y);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + wander, y + len, w * (0.5 + rng() * 0.25), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = 'rgb(196,58,48)';
  ctx.beginPath();
  ctx.arc(x + wander - w * 0.17, y + len - w * 0.2, Math.max(0.8, w * 0.15), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * Draws one message into the cell (x0, y0, cw, ch) of a 2D context: lines as given (no wrapping), the largest size whose
 * widest line and drips fit. `fresh` 0 (old, dried dark) .. 1 (fresh, wet red). Pure canvas 2D calls (testable on a stub).
 * Returns { fs, lines, glyphs, drips }.
 */
export function drawBloodText(ctx, text, x0, y0, cw, ch, seed = 1, fresh = 0.5) {
  const rng = rngOf(seed);
  const lines = String(text || '')
    .split('\n')
    .slice(0, BLOOD_MAX_LINES);
  const n = Math.max(1, lines.length);
  const font = (px) => `700 ${Math.max(1, Math.round(px))}px ${FONT}`;
  ctx.font = font(100);
  const adv100 = new Map();
  const advOf = (c) => {
    let a = adv100.get(c);
    if (a === undefined) {
      a = Math.max(1, ctx.measureText(c).width);
      adv100.set(c, a);
    }
    return a;
  };
  let widest = 1;
  for (const l of lines) {
    let w = 0;
    for (const c of l) w += advOf(c);
    widest = Math.max(widest, w);
  }
  const padX = cw * 0.05;
  const padTop = ch * 0.05;
  const lineH = 1.1; // x fs
  const dripRoom = 0.55; // x fs below the last baseline
  const fs = Math.min(((cw - 2 * padX) * 100) / (widest * 1.08), (ch - padTop - ch * 0.03) / (0.82 + (n - 1) * lineH + dripRoom));
  const bottom = y0 + ch - PAD - 3;
  const dryBias = 1 - Math.max(0, Math.min(1, fresh));
  const glyphCol = () => Math.min(1, Math.max(0, 0.08 + dryBias * 0.55 + (rng() - 0.5) * 0.35));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  let glyphs = 0;
  let drips = 0;
  // smears under the letters: a hand wiped through the wet writing
  const smears = 1 + (rng() < 0.6 ? 1 : 0);
  for (let s = 0; s < smears; s++) {
    const li = Math.floor(rng() * n);
    const by = y0 + padTop + fs * (0.82 + li * lineH) - fs * (0.25 + rng() * 0.3);
    const sx = x0 + padX + rng() * (cw - 2 * padX) * 0.5;
    const len = (cw - 2 * padX) * (0.25 + rng() * 0.45);
    ctx.globalAlpha = 0.1 + rng() * 0.08;
    ctx.strokeStyle = bloodColor(0.55 + rng() * 0.3);
    ctx.lineWidth = fs * (0.28 + rng() * 0.3);
    ctx.beginPath();
    ctx.moveTo(sx, by);
    ctx.quadraticCurveTo(sx + len * 0.5, by + (rng() - 0.5) * fs * 0.6, Math.min(x0 + cw - padX, sx + len), by + (rng() - 0.5) * fs * 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let lw = 0;
    for (const c of line) lw += advOf(c) * (fs / 100);
    const room = cw - 2 * padX - lw;
    let x = x0 + padX + Math.max(0, room) * (0.5 + (rng() - 0.5) * 0.5);
    const lx = x;
    const base = y0 + padTop + fs * (0.82 + li * lineH);
    const slope = (rng() - 0.5) * 0.07; // the line drifts up or down as the hand moves
    const wobA = fs * (0.03 + rng() * 0.04);
    const wobF = 0.004 + rng() * 0.006;
    const wobP = rng() * 6.28;
    const last = li === lines.length - 1;
    for (const c of line) {
      const adv = advOf(c) * (fs / 100);
      if (c === ' ') {
        x += adv * (0.75 + rng() * 0.4);
        continue;
      }
      const k = 0.88 + rng() * 0.24;
      const sx = 0.9 + rng() * 0.16;
      const rot = (rng() - 0.5) * 0.26;
      const gx = x + (rng() - 0.5) * fs * 0.07;
      const gy = base + slope * (x - lx) + Math.sin(wobP + (x - lx) * wobF) * wobA + (rng() - 0.5) * fs * 0.09;
      const t = glyphCol();
      const col = bloodColor(t);
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(rot);
      ctx.scale(k * sx, k);
      ctx.font = font(fs);
      // finger-thick, ragged: two offset ghost copies, then the stroke itself, then a fat outline of it
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.34;
      ctx.fillText(c, (rng() - 0.5) * fs * 0.08, (rng() - 0.5) * fs * 0.07);
      ctx.fillText(c, (rng() - 0.5) * fs * 0.08, (rng() - 0.5) * fs * 0.07);
      ctx.globalAlpha = 0.95;
      ctx.fillText(c, 0, 0);
      ctx.strokeStyle = col;
      ctx.lineWidth = fs * (0.035 + rng() * 0.03);
      ctx.globalAlpha = 0.7;
      ctx.strokeText(c, 0, 0);
      // a faint wet highlight along the top-left edges, kept on the blood already there
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = 0.16 + 0.12 * (1 - t);
      ctx.fillStyle = 'rgb(198,52,44)';
      ctx.fillText(c, -fs * 0.03, -fs * 0.035);
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
      ctx.globalAlpha = 1;
      glyphs++;
      // drips run from the foot of the letters (more, and longer, from the last line)
      if (rng() < (last ? 0.45 : 0.24)) {
        const dx = gx + adv * (0.2 + rng() * 0.6) * k;
        const dy = gy - fs * 0.04;
        const len = Math.min(fs * (0.2 + rng() * rng() * 1.9) * (last ? 1.35 : 1), bottom - dy);
        if (len > fs * 0.12) {
          drip(ctx, dx, dy, len, fs * (0.045 + rng() * 0.05), bloodColor(Math.min(1, t + 0.1)), rng);
          drips++;
        }
      }
      // fine spatter
      if (rng() < 0.12) {
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.75;
        for (let q = 0, m = 1 + Math.floor(rng() * 3); q < m; q++) {
          ctx.beginPath();
          ctx.arc(gx + (rng() - 0.2) * fs * 0.9, gy - fs * (rng() * 0.9), Math.max(0.8, fs * (0.01 + rng() * 0.025)), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      x += adv * k * sx * (0.94 + rng() * 0.08);
    }
  }
  ctx.globalAlpha = 1;
  return { fs, lines: lines.length, glyphs, drips };
}

function defaultCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** World-space quad of one writing: { c (centre), r (right), u (text up), n (normal), hw, hh }. */
export function bloodQuad(e) {
  const w = Math.max(0.2, Number(e.w) || 1.8);
  const hw = w / 2;
  const hh = w / BLOOD_ASPECT / 2;
  const yaw = Number(e.yaw) || 0;
  const sx = -Math.sin(yaw);
  const sz = -Math.cos(yaw);
  if (e.floor) {
    // the reader faces (sx, sz): the text's top is the far side, its right the reader's right
    return { c: [e.x, e.y + OFF_FLOOR, e.z], r: [-sz, 0, sx], u: [sx, 0, sz], n: [0, 1, 0], hw, hh };
  }
  // the writing faces (sx, sz) out of the wall; the reader looks the other way, so its right is (fz, 0, -fx)
  return { c: [e.x + sx * OFF_WALL, e.y, e.z + sz * OFF_WALL], r: [sz, 0, -sx], u: [0, 1, 0], n: [sx, 0, sz], hw, hh };
}

/** One non-indexed geometry for all the quads (position, normal, uv, colour rgba: the decal layout). */
export function bloodGeometry(entries, atlas) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const col = [];
  entries.forEach((e, i) => {
    const q = bloodQuad(e);
    const [px, py, pw, ph] = bloodCell(i);
    const u0 = (px + PAD) / atlas.w;
    const u1 = (px + pw - PAD) / atlas.w;
    const vt = 1 - (py + PAD) / atlas.h; // CanvasTexture flipY: the canvas's top row is v = 1
    const vb = 1 - (py + ph - PAD) / atlas.h;
    const corner = (sr, su) => [q.c[0] + q.r[0] * q.hw * sr + q.u[0] * q.hh * su, q.c[1] + q.r[1] * q.hw * sr + q.u[1] * q.hh * su, q.c[2] + q.r[2] * q.hw * sr + q.u[2] * q.hh * su];
    const v = [
      [corner(-1, -1), u0, vb],
      [corner(1, -1), u1, vb],
      [corner(1, 1), u1, vt],
      [corner(-1, 1), u0, vt],
    ];
    const strength = 0.9 + 0.1 * ((hashStr(String(e.id || i)) % 100) / 100);
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...v[k][0]);
      nrm.push(...q.n);
      uv.push(v[k][1], v[k][2]);
      col.push(1, 1, 1, strength);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.computeBoundingSphere();
  return g;
}

/** The decals' material recipe (render/materials.js m.decal) with the blood atlas: lit, alpha-blended, wetter. */
function bloodMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tex,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    roughness: 0.42, // wet: the lantern and the lamps glint on it
    metalness: 0,
    envMapIntensity: 0.25,
  });
  patchMaterial(mat, { tile: DEFAULT_TILE, role: 'decals', lit: true, grade: true });
  mat.dithering = true;
  return mat;
}

export class BloodWriting {
  /**
   * @param {THREE.Object3D} parent  where the mesh goes (LevelView.root)
   * @param {{makeCanvas?: (w: number, h: number) => object}} [opts]  canvas factory (tests); default: a DOM canvas, none in Node
   */
  constructor(parent, opts = {}) {
    this.parent = parent;
    this.makeCanvas = opts.makeCanvas || defaultCanvas;
    this.mesh = null;
    this.count = 0;
    this._pts = null; // centres, xyz per writing (visibility)
  }

  /** Builds the one mesh for `entries` (replacing any). Returns true when there is a mesh. */
  build(entries) {
    this.dispose();
    const list = (Array.isArray(entries) ? entries : []).filter((e) => e && isFinite(e.x) && isFinite(e.y) && isFinite(e.z) && e.text);
    if (!list.length || !this.parent) return false;
    const atlas = bloodAtlasSize(list.length);
    const canvas = this.makeCanvas(atlas.w, atlas.h);
    const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return false;
    ctx.clearRect(0, 0, atlas.w, atlas.h);
    const depth = list.map((e) => e.y);
    const top = Math.max(...depth);
    const span = Math.max(1, top - Math.min(...depth));
    list.forEach((e, i) => {
      const [x, y, w, h] = bloodCell(i);
      ctx.save();
      drawBloodText(ctx, e.text, x + PAD, y + PAD, w - 2 * PAD, h - 2 * PAD, hashStr(String(e.id || e.text)), 0.25 + (0.75 * (top - e.y)) / span); // fresher deeper down
      ctx.restore();
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mesh = new THREE.Mesh(bloodGeometry(list, atlas), bloodMaterial(tex));
    mesh.name = 'bloodWriting';
    mesh.userData.ownMaterial = true; // LevelView.clear() would dispose it like the plaques (dispose() gets there first)
    mesh.frustumCulled = false; // one mesh spread over the whole shaft: shown by distance instead (update)
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 3; // over the decals (2), under the plaques (5)
    mesh.visible = false;
    this.parent.add(mesh);
    this.mesh = mesh;
    this.count = list.length;
    this._pts = new Float32Array(list.length * 3);
    list.forEach((e, i) => this._pts.set([e.x, e.y, e.z], i * 3));
    return true;
  }

  /** Removes the mesh and frees its geometry, material and atlas. */
  dispose() {
    const m = this.mesh;
    this.mesh = null;
    this.count = 0;
    this._pts = null;
    if (!m) return;
    if (m.parent) m.parent.remove(m);
    m.geometry.dispose();
    if (m.material.map) m.material.map.dispose();
    m.material.dispose();
  }

  /** Shown while a writing is within BLOOD_DIST x scale of the head. */
  update(head, scale = 1) {
    const m = this.mesh;
    if (!m || !head) return;
    const p = this._pts;
    const r = BLOOD_DIST * scale;
    const r2 = r * r;
    let on = false;
    for (let i = 0; i < p.length && !on; i += 3) {
      const dx = p[i] - head.x;
      const dy = p[i + 1] - head.y;
      const dz = p[i + 2] - head.z;
      on = dx * dx + dy * dy + dz * dz < r2;
    }
    m.visible = on;
  }
}
