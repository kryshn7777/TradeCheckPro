/* ABYSSAL TETHER 3D — sceneDetail.js  (WP-SCENE-DETAIL)
 * Random scene details that make the shaft feel lived-in and decayed: bones and skulls, rubble, broken crates / barrels / planks,
 * rusted tools, chain and rope ends swaying in the draught, tattered banners, tags, cobwebs, roots and sinew, stalactites, candle
 * stubs, wax, paper, fungus; puddles with drips and ripples; rust / slime / mineral / moss / water-streak / soot decals on the
 * walls; six small authored "story" vignettes per run. RENDER ONLY: it reads the level and never touches the simulation, has no
 * collision and changes no gameplay.
 *
 *   SceneDetail(game)           game: Game3D ({ renderer, level, settings, bus, state, _runCount })
 *   .update(dt, game)           once per frame (Game3D._updateViews)
 *   .dispose()
 *   .setSeed(n) / .stats() / .vignettes()      tests and store shots (also window.AT3D.sceneDetail)
 *   ?seed=N (or any word)       fixes the layout; without it every run (every new Level3D) gets a fresh seed
 *   ?detail=off                 turns the whole thing off
 *
 * Placement (sceneDetailPlan.js) is seeded and authored by section; the geometry kit is procedural (sceneDetailKit.js); both are
 * three-free and Node-tested (tests/render/test-scene-detail.mjs). This file is the renderer:
 *
 *  - ONE merged dynamic mesh for every prop (1 draw call): the items inside a window around the head are re-packed (a few
 *    thousand triangles copied through their matrices, no allocation) whenever the head has moved 2 m or the plan, tier or
 *    section changed; a distance dither fades the rim of the window out. The material is the level's lit-surface patch
 *    (patchMaterial lit + grade: baked GI volume, wetness, rim light, the carried lantern, fog, filmic grade) with a vertex sway
 *    (the draught moves chains, rope, banners, roots, webs, tags) and a flame / fungus glow;
 *  - ONE instanced mesh of decal quads (rust streaks, slime, mineral crust, moss, water streaks, soot, tally marks, candle light
 *    pools): alpha blended, lit like the walls (1 draw call);
 *  - ONE instanced mesh of puddles, with the falling drops and the ripples computed in the vertex / fragment shader from the
 *    shared time (a few triangles per puddle, no CPU per frame) and the shared reflection probe (1 draw call).
 *  Total: 3 draw calls, <= ~6 k unique triangles in the worst window (quality tier decides: low about 2.4 k, quest 5.2 k, high 6.5 k).
 *
 * Quality tiers follow the lighting tier (settings.reducedEffects -> low, XR / Quest -> quest, desktop -> high, governor level 3 ->
 * low): a lower tier keeps a random subset of the same layout (every entry has a rank). reducedEffects also stills the sway and
 * the falling chips. A chip now and then drops from a stalactite near you (FX rubble: its own dust puff on landing).
 */

import * as THREE from 'three';
import { LOOK, patchMaterial } from './materials.js';
import { D, P, decalCell, hash32, hashStr, mulberry32 } from './sceneDetailKit.js';
import { DECAL_STRIDE, ITEM_STRIDE, PUDDLE_STRIDE, getKit, planSteps, selectItems, selectRecords } from './sceneDetailPlan.js';

export const DRAW_CALLS = 3;
/** Per quality tier: rank cut, triangle cap of the prop window, radius, decal / puddle caps. */
export const DETAIL_TIERS = Object.freeze({
  low: Object.freeze({ name: 'low', rank: 0.4, tris: 2400, radius: 16, decals: 90, puddles: 10 }),
  quest: Object.freeze({ name: 'quest', rank: 0.75, tris: 5200, radius: 22, decals: 200, puddles: 22 }),
  high: Object.freeze({ name: 'high', rank: 1.0, tris: 6500, radius: 28, decals: 260, puddles: 30 }),
});
const MAX_V = 24000;
const MAX_I = 3 * 8000;
const MAX_DECALS = 260;
const MAX_PUDDLES = 30;
const REPACK_DIST = 2.0;

// -----------------------------------------------------------------------------
// Procedural atlases (DataTexture, no canvas: also works headless)
// -----------------------------------------------------------------------------
function h2(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
function vn(x, y, s) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = h2(xi, yi, s);
  const b = h2(xi + 1, yi, s);
  const c = h2(xi, yi + 1, s);
  const d = h2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct = 3) {
  let a = 0.5;
  let f = 1;
  let t = 0;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    t += a * vn(x * f, y * f, s + i * 17);
    n += a;
    f *= 2;
    a *= 0.5;
  }
  return t / n;
}
/** GLSL-style smoothstep that also takes reversed edges (a > b: 1 below b, 0 above a). */
const sstep = (a, b, x) => {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};
const CELL = 128;

/** Paints cell i of a (cols x rows) atlas: fn(u, v, out) with v UP (v = 1 is the top of the cell), out = [r, g, b, a] in 0..255. */
function paintCell(data, W, rows, i, fn) {
  const c = i & 3;
  const r = i >> 2;
  const x0 = c * CELL;
  const y0 = (rows - 1 - r) * CELL;
  const out = [0, 0, 0, 255];
  for (let py = 0; py < CELL; py++) {
    const v = (py + 0.5) / CELL;
    for (let px = 0; px < CELL; px++) {
      const u = (px + 0.5) / CELL;
      out[0] = out[1] = out[2] = 128;
      out[3] = 255;
      fn(u, v, out);
      const o = ((y0 + py) * W + x0 + px) * 4;
      data[o] = out[0] < 0 ? 0 : out[0] > 255 ? 255 : out[0];
      data[o + 1] = out[1] < 0 ? 0 : out[1] > 255 ? 255 : out[1];
      data[o + 2] = out[2] < 0 ? 0 : out[2] > 255 ? 255 : out[2];
      data[o + 3] = out[3] < 0 ? 0 : out[3] > 255 ? 255 : out[3];
    }
  }
}
const grey = (o, v, tr = 1, tg = 1, tb = 1) => {
  o[0] = v * 255 * tr;
  o[1] = v * 255 * tg;
  o[2] = v * 255 * tb;
};

/** The props atlas (4 x 4 cells of 128 px; vertex colours carry the hue, the cells carry grain, weave, holes and tears). */
export function paintPropsAtlas() {
  const W = CELL * 4;
  const data = new Uint8Array(W * W * 4);
  const cell = (i, fn) => paintCell(data, W, 4, i, fn);
  cell(P.GRAIN, (u, v, o) => grey(o, 0.74 + 0.3 * (fbm(u * 9, v * 9, 1, 4) - 0.5) - (h2((u * 90) | 0, (v * 90) | 0, 2) > 0.93 ? 0.16 : 0), 1, 0.985, 0.96));
  const wood = (seedA, dark) => (u, v, o) => {
    const g = fbm(u * 3, v * 30, seedA, 3);
    const knot = Math.max(0, 1 - Math.hypot((u - 0.7) * 3, (v - 0.4) * 9)) * 0.5;
    grey(o, (0.72 + 0.36 * (g - 0.5) - knot * 0.5) * dark, 1, 0.97, 0.93);
  };
  cell(P.WOOD, wood(3, 1));
  cell(P.WOOD2, (u, v, o) => {
    wood(4, 0.85)(u, v, o);
    if (Math.hypot(u - 0.12, v - 0.5) < 0.025 || Math.hypot(u - 0.88, v - 0.5) < 0.025) grey(o, 0.2); // nail heads
  });
  cell(P.BONE, (u, v, o) => {
    const crack = Math.abs(fbm(u * 6, v * 6, 5, 3) - 0.5) < 0.012 ? 0.5 : 1;
    grey(o, (0.88 + 0.16 * (fbm(u * 14, v * 14, 6, 3) - 0.5)) * crack - (h2((u * 70) | 0, (v * 70) | 0, 7) > 0.95 ? 0.2 : 0), 1, 0.98, 0.93);
  });
  cell(P.RUST, (u, v, o) => {
    const n = fbm(u * 8, v * 8, 8, 4);
    const pit = fbm(u * 26, v * 26, 9, 2) > 0.7 ? 0.5 : 1;
    grey(o, (0.55 + 0.7 * n) * pit, 1, 0.9, 0.82);
  });
  cell(P.ROPE, (u, v, o) => {
    const tw = 0.5 + 0.5 * Math.sin((u * 6 + v * 5) * Math.PI * 4);
    grey(o, 0.62 + 0.3 * tw + 0.1 * (vn(u * 60, v * 10, 10) - 0.5), 1, 0.97, 0.92);
  });
  cell(P.CLOTH, (u, v, o) => {
    const wv = 0.5 + 0.5 * Math.sin(u * 150) * Math.sin(v * 150);
    grey(o, 0.7 + 0.14 * wv + 0.3 * (fbm(u * 6, v * 6, 11, 3) - 0.5));
  });
  cell(P.BANNER, (u, v, o) => {
    const wv = 0.5 + 0.5 * Math.sin(u * 150) * Math.sin(v * 150);
    let val = 0.7 + 0.14 * wv + 0.36 * (fbm(u * 5, v * 5, 12, 3) - 0.5);
    if (v > 0.74 && v < 0.8) val *= 0.5; // a woven band
    if (v > 0.12 && v < 0.14) val *= 0.7;
    const edge = 0.06 + 0.24 * vn(u * 9, 3.1, 13);
    let a = v > edge ? 255 : 0;
    if (0.5 - Math.abs(u - 0.5) < 0.02 + 0.03 * vn(v * 12, 1.7, 14)) a = 0;
    if (vn(u * 7, v * 2.2, 15) > 0.8 && v < 0.55) a = 0; // torn slits
    if (fbm(u * 15, v * 15, 16, 2) > 0.74) a = 0; // moth holes
    grey(o, val);
    o[3] = a;
  });
  cell(P.RAG, (u, v, o) => {
    const wv = 0.5 + 0.5 * Math.sin(u * 120) * Math.sin(v * 120);
    const d = Math.hypot((u - 0.5) * 1.1, (v - 0.5) * 0.95);
    let a = d < 0.42 + 0.14 * (vn(u * 6, v * 6, 17) - 0.5) ? 255 : 0;
    if (fbm(u * 12, v * 12, 18, 2) > 0.72) a = 0;
    grey(o, 0.62 + 0.18 * wv + 0.3 * (fbm(u * 5, v * 5, 19, 3) - 0.5));
    o[3] = a;
  });
  cell(P.WEB, (u, v, o) => {
    // a fan from the top-left corner: radial threads and sagging arcs, broken here and there
    const dx = u;
    const dy = 1 - v;
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx); // 0 .. pi/2
    let a = 0;
    const nr = 7;
    const t = (ang / (Math.PI / 2)) * (nr - 1);
    const dr = Math.abs(t - Math.round(t));
    if (dr < 0.075 && r < 1.0) a = Math.max(a, 1 - dr / 0.075);
    const rings = r * 7.5 + 0.6 * Math.sin(ang * 7);
    const dring = Math.abs(rings - Math.round(rings));
    if (dring < 0.1 && Math.round(rings) > 0 && r < 1.0) a = Math.max(a, 1 - dring / 0.1);
    if (vn(u * 10, v * 10, 20) > 0.74) a *= 0.2;
    const fade = sstep(1.02, 0.7, r);
    grey(o, 0.93);
    o[3] = Math.min(1, a) * fade * 235;
  });
  cell(P.PAPER, (u, v, o) => {
    let a = 255;
    const corner = u + (1 - v) - (1.78 + 0.1 * vn(v * 8, 2, 21));
    if (corner > 0) a = 0;
    if (vn(u * 9, v * 9, 22) < 0.1 + 0.18 * (1 - Math.min(u, 1 - u, v, 1 - v) * 14)) a = Math.min(a, 80 + 0 * u);
    if (Math.min(u, 1 - u, v, 1 - v) < 0.02 + 0.03 * vn(u * 20 + v * 20, 4, 23)) a = 0;
    let ink = 0;
    const row = Math.floor(v * 15);
    if (row > 1 && row < 14 && v * 15 - row > 0.3 && v * 15 - row < 0.62 && u > 0.12 && u < 0.88 - 0.4 * h2(row, 9, 24) && h2((u * 22) | 0, row, 25) > 0.28) ink = 1;
    const base = 0.86 + 0.14 * (fbm(u * 7, v * 7, 26, 3) - 0.5) * 2;
    grey(o, base * (ink ? 0.32 : 1), 1, 0.97, 0.9);
    o[3] = a;
  });
  cell(P.TAG, (u, v, o) => {
    let a = 255;
    if (Math.hypot(u - 0.5, v - 0.9) < 0.07) a = 0; // the string hole
    if (Math.min(u, 1 - u, v, 1 - v) < 0.03 || (u < 0.18 && v > 0.84) || (u > 0.82 && v > 0.84)) a = 0;
    const ink = v < 0.62 && v > 0.2 && Math.abs(Math.sin(u * 40 + h2((v * 12) | 0, 1, 27) * 6)) > 0.65 && h2((v * 12) | 0, 2, 28) > 0.3;
    grey(o, (0.8 + 0.2 * (vn(u * 12, v * 12, 29) - 0.5)) * (ink ? 0.35 : 1), 1, 0.96, 0.88);
    o[3] = a;
  });
  cell(P.FIBRE, (u, v, o) => grey(o, 0.55 + 0.5 * fbm(u * 3, v * 40, 30, 3), 1, 0.95, 0.9));
  cell(P.WAX, (u, v, o) => grey(o, 0.9 + 0.1 * fbm(u * 5, v * 5, 31, 2), 1, 0.97, 0.9));
  cell(P.CAP, (u, v, o) => {
    const spot = h2((u * 18) | 0, (v * 18) | 0, 32) > 0.82 && vn(u * 18, v * 18, 33) > 0.4;
    grey(o, spot ? 1 : 0.7 + 0.2 * fbm(u * 6, v * 6, 34, 2));
  });
  cell(P.FLAME, (u, v, o) => {
    // a teardrop: hot core, orange rim
    const x = (u - 0.5) * 2;
    const y = (v - 0.18) * 1.25;
    const w = Math.max(0.02, 0.62 * Math.sqrt(Math.max(0, 1 - y)) * Math.pow(Math.max(0, 1 - y), 0.35) * (y < 0 ? 0.5 + y : 1));
    const d = Math.abs(x) / w;
    const a = sstep(1, 0.15, d) * sstep(1.0, 0.8, y);
    const core = sstep(0.6, 0, d) * sstep(0.7, 0.1, y);
    o[0] = 255;
    o[1] = 150 + 105 * core;
    o[2] = 60 + 150 * core;
    o[3] = a * 255;
  });
  const tex = new THREE.DataTexture(data, W, W, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.name = 'at3dDetailProps';
  return tex;
}

/** The decal atlas (4 x 2 cells): rgb = colour (kept under zero alpha: no dark halos), a = coverage. */
export function paintDecalAtlas() {
  const W = CELL * 4;
  const H = CELL * 2;
  const data = new Uint8Array(W * H * 4);
  const cell = (i, fn) => paintCell(data, W, 2, i, fn);
  cell(D.RUST, (u, v, o) => {
    // a streak running down from the top: wide at its source, thin and broken toward the foot
    const w = (0.07 + 0.2 * fbm(v * 6, 1.3, 40, 2)) * (0.25 + 0.75 * v);
    const m = sstep(w, w * 0.25, Math.abs(u - 0.5 - (fbm(v * 4, 2.2, 41, 2) - 0.5) * 0.25));
    const brk = 0.6 + 0.6 * fbm(u * 8, v * 14, 42, 3);
    const a = m * Math.min(1, brk) * (0.35 + 0.65 * Math.pow(v, 0.6));
    o[0] = 150 + 40 * fbm(u * 5, v * 5, 43, 2);
    o[1] = 72 + 25 * fbm(u * 5, v * 5, 44, 2);
    o[2] = 36;
    o[3] = a * 255;
  });
  cell(D.SLIME, (u, v, o) => {
    const dx = u - 0.5;
    const dy = v - 0.62;
    const r = Math.hypot(dx * 1.1, dy * 1.2) + (fbm(u * 7, v * 7, 45, 3) - 0.5) * 0.45;
    let a = sstep(0.4, 0.28, r);
    // drips running down from the blob
    const col = Math.floor(u * 12);
    if (h2(col, 3, 46) > 0.5 && v < 0.62) {
      const len = 0.12 + 0.45 * h2(col, 5, 46);
      const fu = u * 12 - col - 0.5;
      a = Math.max(a, sstep(0.16, 0.05, Math.abs(fu)) * sstep(0.62 - len, 0.62, v));
    }
    o[0] = 55;
    o[1] = 82 + 30 * fbm(u * 9, v * 9, 47, 2);
    o[2] = 50;
    o[3] = a * (0.65 + 0.35 * fbm(u * 12, v * 12, 48, 2)) * 255;
  });
  cell(D.STREAK, (u, v, o) => {
    // wet runs: a few thin vertical lines of different weight, fading toward the foot
    let a = 0;
    for (let k = 0; k < 5; k++) {
      const cx = 0.14 + k * 0.18 + (h2(k, 1, 49) - 0.5) * 0.08 + (fbm(v * 5, k, 50, 2) - 0.5) * 0.05;
      const w = 0.012 + 0.03 * h2(k, 2, 51);
      a = Math.max(a, sstep(w, w * 0.2, Math.abs(u - cx)) * (0.35 + 0.65 * h2(k, 3, 52)) * sstep(0.0, 0.25 + 0.5 * h2(k, 4, 53), v));
    }
    o[0] = 28;
    o[1] = 36;
    o[2] = 40;
    o[3] = a * 255;
  });
  cell(D.MINERAL, (u, v, o) => {
    const n = fbm(u * 6, v * 6, 54, 4);
    const edge = sstep(0.5, 0.35, Math.hypot(u - 0.5, v - 0.5) + (n - 0.5) * 0.5);
    const crust = sstep(0.42, 0.62, fbm(u * 18, v * 18, 55, 2));
    o[0] = 226;
    o[1] = 222;
    o[2] = 200;
    o[3] = edge * (0.4 + 0.6 * crust) * 255;
  });
  cell(D.MOSS, (u, v, o) => {
    const n = fbm(u * 10, v * 10, 56, 4);
    const m = sstep(0.5, 0.35, Math.hypot((u - 0.5) * 1.05, (v - 0.5) * 1.1) + (n - 0.5) * 0.55);
    const clump = 0.55 + 0.45 * fbm(u * 30, v * 30, 57, 2);
    o[0] = 48 + 20 * clump;
    o[1] = 78 + 30 * clump;
    o[2] = 36;
    o[3] = m * clump * 255;
  });
  cell(D.TALLY, (u, v, o) => {
    // four strokes and a strike-through, in rows of groups, scratched into the stone: pale line, dark groove edge
    let a = 0;
    let shade = 1;
    const stroke = (x0, y0, x1, y1) => {
      const px = u - x0;
      const py = v - y0;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(px - dx * t, py - dy * t);
      const w = 0.011;
      if (d < w * 2.4) {
        if (d < w) a = Math.max(a, 1 - 0.3 * vn(u * 50, v * 50, 58));
        else shade = Math.min(shade, 0.35);
      }
    };
    for (let row = 0; row < 3; row++) {
      for (let g = 0; g < 2; g++) {
        const ox = 0.1 + g * 0.45 + (h2(row, g, 59) - 0.5) * 0.04;
        const oy = 0.12 + row * 0.3;
        if (row === 2 && g === 1) continue;
        for (let k = 0; k < 4; k++) stroke(ox + k * 0.075, oy + (h2(row * 7 + g, k, 60) - 0.5) * 0.03, ox + k * 0.075 + (h2(g, k, 61) - 0.5) * 0.02, oy + 0.2);
        stroke(ox - 0.03, oy + 0.03, ox + 0.3, oy + 0.18);
      }
    }
    o[0] = 214 * shade;
    o[1] = 208 * shade;
    o[2] = 192 * shade;
    o[3] = Math.max(a, 1 - shade) * (a > 0 ? 255 : 150);
  });
  cell(D.GLOW, (u, v, o) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    const a = Math.pow(Math.max(0, 1 - r), 2.2);
    o[0] = 255;
    o[1] = 255;
    o[2] = 255;
    o[3] = a * 255;
  });
  cell(D.SOOT, (u, v, o) => {
    // a plume: narrow at its foot, spreading and thinning upward, streaky
    const w = 0.08 + 0.34 * v;
    const m = sstep(w, w * 0.2, Math.abs(u - 0.5 - (fbm(v * 3, 0.7, 62, 2) - 0.5) * 0.2));
    const streak = 0.55 + 0.45 * fbm(u * 24, v * 4, 63, 3);
    o[0] = 20;
    o[1] = 18;
    o[2] = 16;
    o[3] = m * streak * (1 - v * 0.65) * 255;
  });
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.name = 'at3dDetailDecals';
  return tex;
}

// -----------------------------------------------------------------------------
// Materials (the level's lit-surface patch + a little of our own)
// -----------------------------------------------------------------------------
function chain(mat, tag, edit) {
  const base = mat.onBeforeCompile;
  const baseKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    edit(shader);
  };
  mat.customProgramCacheKey = () => `${baseKey.call(mat)}|${tag}`;
}

function makePropsMaterial(map, U) {
  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.4, envMapIntensity: 0.35 });
  mat.alphaToCoverage = true;
  mat.name = 'at3dDetailProps';
  patchMaterial(mat, { lit: true, grade: true });
  chain(mat, 'sd-props2', (shader) => {
    shader.uniforms.uSdTime = LOOK.uTime;
    shader.uniforms.uSdWind = U.wind;
    shader.uniforms.uSdFar = U.far;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFx;\nuniform float uSdTime;\nuniform vec3 uSdWind;\nvarying float vSdGlow;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  {
    float atW = aFx.x;
    float atT = uSdTime * 1.15 + aFx.y;
    float atS1 = sin( atT ) * 0.7 + sin( atT * 2.3 + 1.7 ) * 0.3;
    float atS2 = sin( atT * 0.9 + 0.5 ) * 0.7 + sin( atT * 2.9 ) * 0.3;
    transformed.x += uSdWind.x * atW * atS1 * uSdWind.z;
    transformed.z += uSdWind.y * atW * atS2 * uSdWind.z;
    transformed.y -= atW * 0.12 * ( 0.5 - 0.5 * cos( atT * 1.7 ) ) * uSdWind.z;
    float atF = aFx.z;
    // flames flicker, fungus breathes
    vSdGlow = atF * ( atF > 2.0 ? 0.78 + 0.22 * sin( uSdTime * 15.0 + aFx.y * 5.0 ) * sin( uSdTime * 7.3 + aFx.y ) : 0.82 + 0.18 * sin( uSdTime * 0.7 + aFx.y ) );
  }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSdFar;\nvarying float vSdGlow;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
  {
    // the rim of the window dithers out
    float atFd = smoothstep( uSdFar - 7.0, uSdFar, length( vViewPosition ) );
    if ( atFd > fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) ) discard;
  }`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor.rgb * vSdGlow;');
  });
  mat.dithering = true;
  return mat;
}

function makeDecalMaterial(map, U) {
  const mat = new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    roughness: 0.86,
    metalness: 0,
    envMapIntensity: 0,
  });
  mat.name = 'at3dDetailDecals';
  patchMaterial(mat, { lit: true, grade: true, wetMin: 0.2 });
  chain(mat, 'sd-decal2', (shader) => {
    shader.uniforms.uSdTime = LOOK.uTime;
    shader.uniforms.uSdFar = U.far;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 iCell;\nattribute vec4 iTint;\nattribute vec2 iAux;\nuniform float uSdTime;\nuniform float uSdFar;\nvarying vec4 vSdTint;\nvarying float vSdGlow;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  #ifdef USE_MAP\n  vMapUv = vMapUv * iCell.zw + iCell.xy;\n  #endif')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  {
    float atFd = 1.0 - smoothstep( uSdFar - 7.0, uSdFar, length( mvPosition.xyz ) );
    vSdTint = vec4( iTint.rgb, iTint.a * atFd );
    vSdGlow = iAux.x * ( 0.86 + 0.14 * sin( uSdTime * 13.0 + iAux.y * 40.0 ) * sin( uSdTime * 5.1 + iAux.y * 9.0 ) );
  }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vSdTint;\nvarying float vSdGlow;')
      .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n  diffuseColor.rgb *= vSdTint.rgb;\n  diffuseColor.a *= vSdTint.a;\n  if ( diffuseColor.a < 0.004 ) discard;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vSdTint.rgb * ( vSdGlow * diffuseColor.a );');
  });
  mat.dithering = true;
  return mat;
}

const PUDDLE_VERT_DECL = `attribute float aPart;
attribute vec3 aDrip;
attribute vec4 iPud;
uniform float uSdTime;
uniform float uSdFar;
varying vec2 vPudL;
varying vec4 vPudR;
varying float vPudFade;
varying float vPudPart;`;

function makePuddleMaterial(U) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x07090a,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    roughness: 0.05,
    metalness: 0,
    envMapIntensity: 1.1,
  });
  mat.name = 'at3dDetailPuddles';
  patchMaterial(mat, { lit: true, grade: true, wetMin: 1 });
  chain(mat, 'sd-puddle2', (shader) => {
    shader.uniforms.uSdTime = LOOK.uTime;
    shader.uniforms.uSdFar = U.far;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PUDDLE_VERT_DECL}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  {
    float atRx = length( instanceMatrix[ 0 ].xyz );
    float atPer = iPud.x;
    float atHid = ( atPer < 0.01 ) ? 1.0 : 0.0;
    // a puddle with no visible drop still stirs now and then (a hidden drip, ring only)
    float atT = atHid > 0.5 ? mod( uSdTime + iPud.y, 6.0 + iPud.w * 5.0 ) : mod( uSdTime + iPud.y, atPer );
    float atFall = atHid > 0.5 ? 0.0 : sqrt( 2.0 * iPud.z / 9.81 );
    float atAge = atT >= atFall ? atT - atFall : atT + ( ( atHid > 0.5 ? 6.0 + iPud.w * 5.0 : atPer ) - atFall );
    vPudR = vec4( atAge, atHid, atRx, iPud.w );
    vPudPart = aPart;
    vPudL = position.xz;
    if ( aPart > 0.5 ) {
      // the falling drop: a thin streak that stretches as it speeds up, gone before it starts and once it has landed
      if ( atHid > 0.5 || atT >= atFall ) {
        transformed = vec3( 0.0 );
      } else {
        float atV = 9.81 * atT;
        float atLen = clamp( atV * 0.012, 0.025, 0.16 );
        float atY = iPud.z - 0.5 * 9.81 * atT * atT;
        transformed = vec3( aDrip.x / atRx + ( iPud.w - 0.5 ) * 0.5, atY + aDrip.y * atLen, aDrip.z / atRx + ( fract( iPud.w * 7.0 ) - 0.5 ) * 0.5 );
      }
    }
  }`,
      )
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vPudFade = 1.0 - smoothstep( uSdFar - 7.0, uSdFar, length( mvPosition.xyz ) );');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vPudL;
varying vec4 vPudR;
varying float vPudFade;
varying float vPudPart;
float atPhash( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
float atPnz( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( atPhash( i ), atPhash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( atPhash( i + vec2( 0.0, 1.0 ) ), atPhash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  float atPa = 1.0;
  vec2 atPG = vec2( 0.0 );
  if ( vPudPart < 0.5 ) {
    // an irregular pool: the disc's edge wobbles, thin films shine a little lighter at the rim
    float atR = length( vPudL ) + ( atPnz( vPudL * 3.2 + vPudR.w * 40.0 ) - 0.5 ) * 0.34;
    atPa = smoothstep( 1.0, 0.8, atR ) * 0.93;
    diffuseColor.rgb += vec3( 0.02, 0.024, 0.026 ) * smoothstep( 0.6, 1.0, atR );
    // the ring from the last drop: radius grows at 0.3 m/s, fades in ~2 s; its slope tilts the normal
    vec2 atPW = vPudL * vPudR.z;
    vec2 atC = ( vec2( vPudR.w, fract( vPudR.w * 7.0 ) ) - 0.5 ) * 0.5 * vPudR.z;
    vec2 atDv = atPW - atC;
    float atDd = length( atDv );
    float atRing = atDd - vPudR.x * 0.3;
    float atAmp = exp( - vPudR.x * 1.6 ) * ( vPudR.y > 0.5 ? 0.5 : 1.0 ) * exp( - atRing * atRing * 90.0 );
    float atWv = cos( atRing * 70.0 ) * atAmp;
    atPG = ( atDv / max( atDd, 1e-3 ) ) * atWv;
  } else {
    atPa = 0.9;
    diffuseColor.rgb = vec3( 0.55, 0.62, 0.66 );
  }
  diffuseColor.a *= atPa * vPudFade;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\n  normal = normalize( normal + ( viewMatrix * vec4( atPG.x, 0.0, atPG.y, 0.0 ) ).xyz * 0.55 );',
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  if ( vPudPart > 0.5 ) totalEmissiveRadiance += vec3( 0.07, 0.085, 0.095 );');
  });
  mat.dithering = true;
  return mat;
}

// -----------------------------------------------------------------------------
// The view
// -----------------------------------------------------------------------------
function parseSeed(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10) >>> 0;
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16) >>> 0;
  return hashStr(s);
}

function urlParam(name) {
  try {
    if (typeof location === 'undefined') return null;
    const m = new RegExp(`[?&]${name}=([^&#]*)`).exec(location.search || '');
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export class SceneDetail {
  /** @param {object} game Game3D (renderer, level, settings, bus) */
  constructor(game) {
    this.renderer = game && game.renderer ? game.renderer : null;
    this.scene = this.renderer ? this.renderer.scene : null;
    this.enabled = urlParam('detail') !== 'off' && !!this.scene;
    this.level = null;
    this.plan = null;
    this.kit = getKit();
    this._fixed = parseSeed(urlParam('seed'));
    this._base = hash32(Date.now() & 0x7fffffff, Math.floor((typeof performance !== 'undefined' ? performance.now() : 0) * 1000), 0x3d7a);
    this.seed = 0;
    this._gen = null;
    this._genSeed = 0;
    this._planMs = 0;
    this._dirty = true;
    this._tier = DETAIL_TIERS.quest;
    this._reduced = false;
    this._head = new THREE.Vector3();
    this._last = new THREE.Vector3(1e9, 1e9, 1e9);
    this._sel = null;
    this._selD = new Int32Array(MAX_DECALS);
    this._selP = new Int32Array(MAX_PUDDLES);
    this._win = { n: 0, radius: 0 };
    this._chipT = 8;
    this._dripT = 3;
    this._rng = mulberry32(0x5eed);
    this._apiDone = false;
    this.counts = { items: 0, tris: 0, decals: 0, puddles: 0, verts: 0, repacks: 0 };
    this.uniforms = { wind: { value: new THREE.Vector3(1, 0, 1) }, far: { value: 22 } };
    this.meshes = [];
    if (!this.enabled) return;
    this._build();
  }

  _build() {
    const U = this.uniforms;
    this.propsTex = paintPropsAtlas();
    this.decalTex = paintDecalAtlas();
    const aniso = this.renderer && this.renderer.renderer && this.renderer.renderer.capabilities ? Math.min(4, this.renderer.renderer.capabilities.getMaxAnisotropy() || 1) : 1;
    this.propsTex.anisotropy = aniso;
    this.decalTex.anisotropy = aniso;
    this.propsMat = makePropsMaterial(this.propsTex, U);
    this.decalMat = makeDecalMaterial(this.decalTex, U);
    this.puddleMat = makePuddleMaterial(U);
    const lighting = this.renderer && this.renderer.lighting;
    if (lighting && typeof lighting.applyLookTo === 'function') {
      lighting.applyLookTo(this.puddleMat, { env: 1.1, force: true });
    }

    // props: one merged dynamic geometry
    const g = new THREE.BufferGeometry();
    this._pos = new Float32Array(MAX_V * 3);
    this._nrm = new Float32Array(MAX_V * 3);
    this._col = new Float32Array(MAX_V * 3);
    this._uv = new Float32Array(MAX_V * 2);
    this._fx = new Float32Array(MAX_V * 3);
    this._idx = new Uint16Array(MAX_I);
    const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', dyn(this._pos, 3));
    g.setAttribute('normal', dyn(this._nrm, 3));
    g.setAttribute('color', dyn(this._col, 3));
    g.setAttribute('uv', dyn(this._uv, 2));
    g.setAttribute('aFx', dyn(this._fx, 3));
    g.setIndex(new THREE.BufferAttribute(this._idx, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e5);
    this.geometry = g;
    this.propsMesh = new THREE.Mesh(g, this.propsMat);
    this.propsMesh.name = 'AT3D-detail-props';
    this.propsMesh.frustumCulled = false;
    this.propsMesh.renderOrder = 1;
    this.propsMesh.visible = true; // the scene precompile compiles the program; hidden by the first update without a plan
    this._sel = new Int32Array(8192);

    // decals: instanced quads
    const quad = new THREE.PlaneGeometry(1, 1);
    this.decalGeo = quad;
    this.decalMesh = new THREE.InstancedMesh(quad, this.decalMat, MAX_DECALS);
    this.decalMesh.name = 'AT3D-detail-decals';
    this.decalMesh.count = 0;
    this.decalMesh.frustumCulled = false;
    this.decalMesh.renderOrder = 4;
    this.decalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._iCell = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DECALS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this._iTint = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DECALS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this._iAux = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DECALS * 2), 2).setUsage(THREE.DynamicDrawUsage);
    quad.setAttribute('iCell', this._iCell);
    quad.setAttribute('iTint', this._iTint);
    quad.setAttribute('iAux', this._iAux);
    this.decalMesh.visible = true;

    // puddles: instanced pool + two crossed drop streaks
    const pg = new THREE.BufferGeometry();
    const pos = [];
    const part = [];
    const drip = [];
    const idx = [];
    const add = (x, y, z, pt, dx, dy, dz) => {
      pos.push(x, y, z);
      part.push(pt);
      drip.push(dx, dy, dz);
      return pos.length / 3 - 1;
    };
    const a0 = add(-1, 0, -1, 0, 0, 0, 0);
    const a1 = add(1, 0, -1, 0, 0, 0, 0);
    const a2 = add(1, 0, 1, 0, 0, 0, 0);
    const a3 = add(-1, 0, 1, 0, 0, 0, 0);
    idx.push(a0, a3, a2, a0, a2, a1);
    for (const ax of [0, 1]) {
      const w = 0.006;
      const b0 = add(0, 0, 0, 1, ax ? 0 : -w, 0, ax ? -w : 0);
      const b1 = add(0, 0, 0, 1, ax ? 0 : w, 0, ax ? w : 0);
      const b2 = add(0, 0, 0, 1, ax ? 0 : w, 1, ax ? w : 0);
      const b3 = add(0, 0, 0, 1, ax ? 0 : -w, 1, ax ? -w : 0);
      idx.push(b0, b1, b2, b0, b2, b3);
    }
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    pg.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
    pg.setAttribute('aDrip', new THREE.Float32BufferAttribute(drip, 3));
    const nrm = [];
    for (let i = 0; i < pos.length / 3; i++) nrm.push(0, 1, 0);
    pg.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    pg.setIndex(idx);
    this._iPud = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUDDLES * 4), 4).setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('iPud', this._iPud);
    this.puddleGeo = pg;
    this.puddleMesh = new THREE.InstancedMesh(pg, this.puddleMat, MAX_PUDDLES);
    this.puddleMesh.name = 'AT3D-detail-puddles';
    this.puddleMesh.count = 0;
    this.puddleMesh.frustumCulled = false;
    this.puddleMesh.renderOrder = 3;
    this.puddleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puddleMesh.visible = true;

    for (const m of [this.propsMesh, this.decalMesh, this.puddleMesh]) {
      this.scene.add(m);
      this.meshes.push(m);
    }
  }

  // ---------------------------------------------------------------------------
  // Seeds and plans
  // ---------------------------------------------------------------------------
  /** Fixes the layout (null = a fresh seed per run again) and re-plans. */
  setSeed(n) {
    this._fixed = n == null ? null : parseSeed(n);
    this.level = null; // the next update re-plans
  }

  _startPlan(level, game) {
    this.level = level;
    const run = game && typeof game._runCount === 'number' ? game._runCount | 0 : 0;
    this._genSeed = this._fixed != null ? this._fixed : hash32(this._base, run, 0x5d);
    this._gen = level ? planSteps(level, this._genSeed, this.kit) : null;
    this._planMs = 0;
  }

  _stepPlan(budgetMs) {
    if (!this._gen) return;
    const t0 = performance.now();
    for (;;) {
      const r = this._gen.next();
      if (r.done) {
        this.plan = r.value;
        this.seed = this._genSeed;
        this._gen = null;
        this._dirty = true;
        this._last.set(1e9, 1e9, 1e9);
        break;
      }
      if (performance.now() - t0 > budgetMs) break;
    }
    this._planMs += performance.now() - t0;
  }

  vignettes() {
    return this.plan ? this.plan.vignettes.map((v) => Object.assign({}, v)) : [];
  }

  stats() {
    const c = this.counts;
    return {
      enabled: this.enabled,
      seed: this.seed,
      ready: !!this.plan,
      tier: this._tier.name,
      drawCalls: this.enabled && this.plan ? DRAW_CALLS : 0,
      uniqueTris: c.tris + c.decals * 2 + c.puddles * 6,
      items: c.items,
      propTris: c.tris,
      decals: c.decals,
      puddles: c.puddles,
      verts: c.verts,
      repacks: c.repacks,
      radius: this._win.radius,
      planMs: this._planMs,
      total: this.plan ? { items: this.plan.nItems, decals: this.plan.nDecals, puddles: this.plan.nPuddles } : null,
      vignettes: this.plan ? this.plan.vignettes.length : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------
  update(dt, game) {
    if (!this.enabled) return;
    const lvl = game ? game.level : null;
    if (lvl !== this.level) this._startPlan(lvl, game);
    if (this._gen) this._stepPlan(game && game.state === 'playing' ? 2.5 : 8);
    if (!this._apiDone && typeof window !== 'undefined' && window.AT3D) {
      this._apiDone = true;
      try {
        window.AT3D.sceneDetail = {
          setSeed: (n) => this.setSeed(n),
          stats: () => this.stats(),
          vignettes: () => this.vignettes(),
          seed: () => this.seed,
        };
      } catch {
        /* a frozen debug object */
      }
    }
    if (!this.plan) {
      for (const m of this.meshes) m.visible = false;
      return;
    }
    const rend = this.renderer;
    // tier
    const light = rend && rend.lighting;
    const settings = (game && game.settings) || (rend && rend.settings) || {};
    this._reduced = !!settings.reducedEffects;
    let name = light && light.tier ? light.tier : 'quest';
    if (this._reduced) name = 'low';
    const tier = DETAIL_TIERS[name] || DETAIL_TIERS.quest;
    if (tier !== this._tier) {
      this._tier = tier;
      this._dirty = true;
    }
    const head = rend && typeof rend.headPosition === 'function' ? rend.headPosition(this._head) : this._head;
    // wind: a slow turn and a breathing gust (still when the player asked for reduced effects)
    const t = LOOK.uTime.value;
    const a = 0.6 + 0.9 * Math.sin(t * 0.037) + 0.4 * Math.sin(t * 0.011 + 1.3);
    const gust = this._reduced ? 0 : 0.55 + 0.45 * Math.sin(t * 0.21) * Math.sin(t * 0.067 + 1.0) + 0.25 * Math.max(0, Math.sin(t * 0.9 + Math.sin(t * 0.13) * 3));
    this.uniforms.wind.value.set(Math.cos(a), Math.sin(a), gust);
    this.uniforms.far.value = tier.radius;
    if (this._dirty || head.distanceToSquared(this._last) > REPACK_DIST * REPACK_DIST) {
      this._last.copy(head);
      this._dirty = false;
      this._repack(head);
    }
    this.propsMesh.visible = this.counts.tris > 0;
    this.decalMesh.visible = this.counts.decals > 0;
    this.puddleMesh.visible = this.counts.puddles > 0;
    this._alive(dt, game, head);
  }

  // ---------------------------------------------------------------------------
  // Window re-pack (props, decals, puddles)
  // ---------------------------------------------------------------------------
  _repack(head) {
    const plan = this.plan;
    const tier = this._tier;
    const kit = plan.kit;
    const items = plan.items;
    const tris = selectItems(plan, head.x, head.y, head.z, tier.radius, tier.rank, tier.tris, this._sel, this._win);
    const P = this._pos;
    const N = this._nrm;
    const C = this._col;
    const T = this._uv;
    const F = this._fx;
    const I = this._idx;
    let vc = 0;
    let ic = 0;
    for (let s = 0; s < this._win.n; s++) {
      const o = this._sel[s] * ITEM_STRIDE;
      const t = kit.templates[items[o + 12]];
      if (vc + t.vn > MAX_V || ic + t.inn > MAX_I) break;
      const px = items[o];
      const py = items[o + 1];
      const pz = items[o + 2];
      const yaw = items[o + 3];
      const rx = items[o + 4];
      const rz = items[o + 5];
      const sc = items[o + 6];
      const tr = items[o + 7];
      const tg = items[o + 8];
      const tb = items[o + 9];
      const ph = items[o + 10];
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cx = Math.cos(rx);
      const sx = Math.sin(rx);
      const cz = Math.cos(rz);
      const sz = Math.sin(rz);
      // R = Ry · Rx · Rz (unscaled)
      const a0 = cz;
      const a1 = -sz;
      const a2 = 0;
      const a3 = cx * sz;
      const a4 = cx * cz;
      const a5 = -sx;
      const a6 = sx * sz;
      const a7 = sx * cz;
      const a8 = cx;
      const r00 = cy * a0 + sy * a6;
      const r01 = cy * a1 + sy * a7;
      const r02 = cy * a2 + sy * a8;
      const r10 = a3;
      const r11 = a4;
      const r12 = a5;
      const r20 = -sy * a0 + cy * a6;
      const r21 = -sy * a1 + cy * a7;
      const r22 = -sy * a2 + cy * a8;
      const kp = kit.pos;
      const kn = kit.nrm;
      const kc = kit.col;
      const ku = kit.uv;
      const kf = kit.fx;
      for (let v = 0; v < t.vn; v++) {
        const k = t.v0 + v;
        const x = kp[k * 3];
        const y = kp[k * 3 + 1];
        const z = kp[k * 3 + 2];
        const d = (vc + v) * 3;
        P[d] = (r00 * x + r01 * y + r02 * z) * sc + px;
        P[d + 1] = (r10 * x + r11 * y + r12 * z) * sc + py;
        P[d + 2] = (r20 * x + r21 * y + r22 * z) * sc + pz;
        const nx = kn[k * 3];
        const ny = kn[k * 3 + 1];
        const nz = kn[k * 3 + 2];
        N[d] = r00 * nx + r01 * ny + r02 * nz;
        N[d + 1] = r10 * nx + r11 * ny + r12 * nz;
        N[d + 2] = r20 * nx + r21 * ny + r22 * nz;
        C[d] = kc[k * 3] * tr;
        C[d + 1] = kc[k * 3 + 1] * tg;
        C[d + 2] = kc[k * 3 + 2] * tb;
        const du = (vc + v) * 2;
        T[du] = ku[k * 2];
        T[du + 1] = ku[k * 2 + 1];
        F[d] = kf[k * 3] * sc;
        F[d + 1] = kf[k * 3 + 1] + ph;
        F[d + 2] = kf[k * 3 + 2];
      }
      const ki = kit.idx;
      for (let k = 0; k < t.inn; k++) I[ic + k] = ki[t.i0 + k] + vc;
      vc += t.vn;
      ic += t.inn;
    }
    const g = this.geometry;
    for (const name of ['position', 'normal', 'color', 'aFx']) {
      const at = g.getAttribute(name);
      at.clearUpdateRanges();
      at.addUpdateRange(0, vc * 3);
      at.needsUpdate = true;
    }
    const uv = g.getAttribute('uv');
    uv.clearUpdateRanges();
    uv.addUpdateRange(0, vc * 2);
    uv.needsUpdate = true;
    const ix = g.getIndex();
    ix.clearUpdateRanges();
    ix.addUpdateRange(0, ic);
    ix.needsUpdate = true;
    g.setDrawRange(0, ic);
    this.counts.items = this._win.n;
    this.counts.tris = ic / 3;
    this.counts.verts = vc;
    void tris;

    // decals
    const nd = selectRecords(plan.decals, DECAL_STRIDE, 14, plan.nDecals, head.x, head.y, head.z, tier.radius + 4, tier.rank, Math.min(tier.decals, MAX_DECALS), this._selD);
    const dm = this.decalMesh.instanceMatrix.array;
    const dc = this._iCell.array;
    const dt = this._iTint.array;
    const da = this._iAux.array;
    const dec = plan.decals;
    for (let s = 0; s < nd; s++) {
      const o = this._selD[s] * DECAL_STRIDE;
      const orient = dec[o + 3];
      const yaw = dec[o + 4];
      const roll = dec[o + 5];
      const w = dec[o + 6];
      const h = dec[o + 7];
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      // the quad's frame: right, up, normal
      let rxx = cy;
      let rxy = 0;
      let rxz = -sy;
      let nxx;
      let nxy;
      let nxz;
      let uxx;
      let uxy;
      let uxz;
      if (orient < 0.5) {
        nxx = sy;
        nxy = 0;
        nxz = cy;
        uxx = 0;
        uxy = 1;
        uxz = 0;
      } else if (orient < 1.5) {
        nxx = 0;
        nxy = 1;
        nxz = 0;
        uxx = -sy;
        uxy = 0;
        uxz = -cy;
      } else {
        nxx = 0;
        nxy = -1;
        nxz = 0;
        uxx = sy;
        uxy = 0;
        uxz = cy;
      }
      if (roll !== 0) {
        const cr = Math.cos(roll);
        const sr = Math.sin(roll);
        const ax = rxx * cr + uxx * sr;
        const ay = rxy * cr + uxy * sr;
        const az = rxz * cr + uxz * sr;
        uxx = -rxx * sr + uxx * cr;
        uxy = -rxy * sr + uxy * cr;
        uxz = -rxz * sr + uxz * cr;
        rxx = ax;
        rxy = ay;
        rxz = az;
      }
      const m = s * 16;
      dm[m] = rxx * w;
      dm[m + 1] = rxy * w;
      dm[m + 2] = rxz * w;
      dm[m + 3] = 0;
      dm[m + 4] = uxx * h;
      dm[m + 5] = uxy * h;
      dm[m + 6] = uxz * h;
      dm[m + 7] = 0;
      dm[m + 8] = nxx;
      dm[m + 9] = nxy;
      dm[m + 10] = nxz;
      dm[m + 11] = 0;
      dm[m + 12] = dec[o];
      dm[m + 13] = dec[o + 1];
      dm[m + 14] = dec[o + 2];
      dm[m + 15] = 1;
      const r = decalCell(dec[o + 8]);
      dc[s * 4] = r[0];
      dc[s * 4 + 1] = r[1];
      dc[s * 4 + 2] = r[2] - r[0];
      dc[s * 4 + 3] = r[3] - r[1];
      dt[s * 4] = dec[o + 9];
      dt[s * 4 + 1] = dec[o + 10];
      dt[s * 4 + 2] = dec[o + 11];
      dt[s * 4 + 3] = dec[o + 12];
      da[s * 2] = dec[o + 13];
      da[s * 2 + 1] = dec[o + 15];
    }
    this.decalMesh.count = nd;
    this.decalMesh.instanceMatrix.clearUpdateRanges();
    this.decalMesh.instanceMatrix.addUpdateRange(0, nd * 16);
    this.decalMesh.instanceMatrix.needsUpdate = true;
    for (const [at, n] of [[this._iCell, 4], [this._iTint, 4], [this._iAux, 2]]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, nd * n);
      at.needsUpdate = true;
    }
    this.counts.decals = nd;

    // puddles
    const np = selectRecords(plan.puddles, PUDDLE_STRIDE, 9, plan.nPuddles, head.x, head.y, head.z, tier.radius + 4, tier.rank, Math.min(tier.puddles, MAX_PUDDLES), this._selP);
    const pm = this.puddleMesh.instanceMatrix.array;
    const pp = this._iPud.array;
    const pd = plan.puddles;
    for (let s = 0; s < np; s++) {
      const o = this._selP[s] * PUDDLE_STRIDE;
      const m = s * 16;
      pm[m] = pd[o + 3];
      pm[m + 1] = 0;
      pm[m + 2] = 0;
      pm[m + 3] = 0;
      pm[m + 4] = 0;
      pm[m + 5] = 1;
      pm[m + 6] = 0;
      pm[m + 7] = 0;
      pm[m + 8] = 0;
      pm[m + 9] = 0;
      pm[m + 10] = pd[o + 4];
      pm[m + 11] = 0;
      pm[m + 12] = pd[o];
      pm[m + 13] = pd[o + 1];
      pm[m + 14] = pd[o + 2];
      pm[m + 15] = 1;
      pp[s * 4] = pd[o + 5];
      pp[s * 4 + 1] = pd[o + 6];
      pp[s * 4 + 2] = pd[o + 7];
      pp[s * 4 + 3] = pd[o + 8];
    }
    this.puddleMesh.count = np;
    this.puddleMesh.instanceMatrix.clearUpdateRanges();
    this.puddleMesh.instanceMatrix.addUpdateRange(0, np * 16);
    this.puddleMesh.instanceMatrix.needsUpdate = true;
    this._iPud.clearUpdateRanges();
    this._iPud.addUpdateRange(0, np * 4);
    this._iPud.needsUpdate = true;
    this.counts.puddles = np;
    this.counts.repacks++;
  }

  // ---------------------------------------------------------------------------
  // Small signs of life: a chip falls from a stalactite near you, a drip is heard (bus event, audio may listen)
  // ---------------------------------------------------------------------------
  _alive(dt, game, head) {
    if (this._reduced || !game || game.state !== 'playing' || !this.plan) return;
    const rnd = this._rng;
    this._chipT -= dt;
    if (this._chipT <= 0) {
      this._chipT = 10 + rnd() * 18;
      const fx = this.renderer && this.renderer.fx;
      if (fx && fx.rubble && typeof fx.rubble.spawn === 'function') {
        const plan = this.plan;
        const items = plan.items;
        const tt = plan.kit.templates;
        const n = this._win.n;
        let pickIdx = -1;
        let seen = 0;
        for (let s = 0; s < n; s++) {
          const o = this._sel[s] * ITEM_STRIDE;
          if (tt[items[o + 12]].cat !== 'stal' || items[o + 4] !== 0) continue; // hanging stalactites only (not the upturned stalagmites)
          const dx = items[o] - head.x;
          const dy = items[o + 1] - head.y;
          const dz = items[o + 2] - head.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 36 || d2 > 17 * 17) continue;
          seen++;
          if (rnd() * seen < 1) pickIdx = o; // reservoir sample
        }
        if (pickIdx >= 0) {
          const o = pickIdx;
          const len = tt[items[o + 12]].height * items[o + 6];
          const x = items[o];
          const y = items[o + 1] - len;
          const z = items[o + 2];
          try {
            fx.rubble.spawn(x, y, z, (rnd() - 0.5) * 0.3, -0.2, (rnd() - 0.5) * 0.3, 0.03 + rnd() * 0.04);
            if (typeof fx.burst === 'function') fx.burst('dust', x, y + 0.05, z, { count: 1 });
          } catch {
            /* the chip is a flourish */
          }
        }
      }
    }
    this._dripT -= dt;
    if (this._dripT <= 0) {
      this._dripT = 2.5 + rnd() * 5;
      const bus = game.bus;
      if (bus && typeof bus.emit === 'function' && this.counts.puddles > 0) {
        const pd = this.plan.puddles;
        for (let s = 0; s < this.counts.puddles; s++) {
          const o = this._selP[s] * PUDDLE_STRIDE;
          if (pd[o + 5] <= 0) continue; // no visible drip
          const dx = pd[o] - head.x;
          const dy = pd[o + 1] - head.y;
          const dz = pd[o + 2] - head.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < 14 && rnd() < 0.5) {
            bus.emit('detail:drip', { x: pd[o], y: pd[o + 1], z: pd[o + 2], dist: d });
            break;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  dispose() {
    for (const m of this.meshes) if (m.parent) m.parent.remove(m);
    this.meshes.length = 0;
    for (const o of [this.geometry, this.decalGeo, this.puddleGeo, this.propsMat, this.decalMat, this.puddleMat, this.propsTex, this.decalTex]) if (o && o.dispose) o.dispose();
    for (const m of [this.decalMesh, this.puddleMesh]) if (m && m.dispose) m.dispose();
    this.plan = null;
    this._gen = null;
    try {
      if (typeof window !== 'undefined' && window.AT3D && window.AT3D.sceneDetail) delete window.AT3D.sceneDetail;
    } catch {
      /* ignore */
    }
  }
}

