/* ABYSSAL TETHER 3D — materials.js
 * Shared palette, texture sets and the material library for the renderer.
 *
 *  - Texture sets: the assets agent's baked PBR sets (assets/textures/manifest.json:
 *    { "<set>": { albedo, normal, orm, tileMeters } }) are loaded with
 *    THREE.TextureLoader; until (or unless) they arrive, small tileable
 *    procedural canvas sets stand in (rock, masonry, metal, cracked masonry, grate).
 *    Swapping sets later only swaps texture objects: no shader recompiles.
 *  - World-scale UVs without per-instance UV data: an onBeforeCompile patch
 *    projects each face on its dominant axis in metres (instance scale +
 *    translation read from instanceMatrix), so masonry courses line up across
 *    neighbouring boxes and tile ~4 m whatever the box size. Vertex-only cost.
 *  - Small composable patches: ash on top faces (readable walkable surfaces),
 *    a crack overlay (crumbling ledges), per-instance shape selection (one
 *    InstancedMesh draws several anchor/hazard shapes), emissive inlays, and
 *    fog variants (capped fog for silhouettes, fade-to-black for additive glows).
 *
 * Every material is created once; per-frame code only touches uniforms.
 */

import * as THREE from 'three';

/** Math.hypot is ~20× slower than sqrt in V8 and allocates; hot paths use this. */
function hyp(x, y, z = 0) {
  return Math.sqrt(x * x + y * y + z * z);
}


// -----------------------------------------------------------------------------
// Palette (sRGB hex; matches the 2D game's art direction)
// -----------------------------------------------------------------------------
export const PALETTE = {
  stone: 0x3c3833,
  stoneDark: 0x1e1c1a,
  iron: 0x343435,
  rust: 0x7a3b22,
  verd: 0x3f6b63,
  bone: 0x968e7c,
  glow: 0xb8f0e0,
  phos: 0xe8dcc0,
  amber: 0xe0a050,
  cyan: 0x6fa3b5,
  ash: 0x8d877b,
  lantern: 0xffb46a,
  handLeft: 0x5fd8c4, // cool verdigris
  handRight: 0xffa94a, // warm amber
  still: 0xf4ead2,
};

/** The baked sinew set is red; the level's growth is graded to a dark matte brown (linear multiplier). */
const FLESH_GRADE = new THREE.Color(2.3, 8.2, 6.5);
const _white = new THREE.Color(1, 1, 1);

/**
 * Toward the shaft key light (Renderer3D's DirectionalLight: cold light from
 * high above, slanted) — shared so unlit silhouettes shade the same way.
 */
export const KEY_DIR = new THREE.Vector3(-0.45, 1, 0.3).normalize();

/**
 * Shared "look" uniforms, driven per frame by Renderer3D (one object, every lit
 * material reads the same values, so nothing recompiles when they change):
 *  uRimColor  the haze colour reflected at grazing angles (a Fresnel-like edge
 *             light: relief reads as lit edges against the dark wall behind it)
 *  uRim       its strength
 *  uWet       0..1 section wetness: porous stone darkens, roughness drops, so the
 *             carried lantern slides highlights over the surfaces as you swing
 *  uVG        vertical grade: surfaces above the eye catch a little more of the
 *             light that falls down the shaft, those far below sink into the pit
 */
export const LOOK = {
  uRimColor: { value: new THREE.Color(0.2, 0.25, 0.28) },
  uRim: { value: 0.0 },
  uWet: { value: 0.0 },
  uVG: { value: 0.3 },
  uTime: { value: 0.0 },
};

/** Default texture tile (metres) when a set does not say. */
export const DEFAULT_TILE = 4;
/** Fallback texture resolution (px) generated at boot, before the baked sets load. */
const PROCEDURAL_SIZE = 256;

// -----------------------------------------------------------------------------
// Procedural tileable textures (fallback until the baked sets load)
// -----------------------------------------------------------------------------

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Periodic value-noise fBm over a size×size canvas (tiles seamlessly). */
function makeFbm(seed, basePeriod, octaves, gain = 0.5) {
  const rng = makeRng(seed);
  const layers = [];
  let period = basePeriod;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const g = new Float32Array(period * period);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    layers.push({ g, period, amp });
    norm += amp;
    amp *= gain;
    period *= 2;
  }
  /** u, v in [0,1) → 0..1 */
  return (u, v) => {
    let sum = 0;
    for (let o = 0; o < layers.length; o++) {
      const L = layers[o];
      const p = L.period;
      const x = u * p;
      const y = v * p;
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const fx = x - xi;
      const fy = y - yi;
      const x0 = ((xi % p) + p) % p;
      const y0 = ((yi % p) + p) % p;
      const x1 = (x0 + 1) % p;
      const y1 = (y0 + 1) % p;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const a = L.g[y0 * p + x0];
      const b = L.g[y0 * p + x1];
      const c = L.g[y1 * p + x0];
      const d = L.g[y1 * p + x1];
      sum += (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * L.amp;
    }
    return sum / norm;
  };
}

function makeCanvas(size) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const c = new OffscreenCanvas(size, size);
      if (c.getContext('2d')) return c;
    } catch {
      /* fall through */
    }
  }
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/**
 * Builds albedo / normal / ORM canvases from per-pixel callbacks.
 * fill(i, u, v, out) writes out = [r,g,b (0..255 sRGB), height 0..1, ao 0..1, rough 0..1, metal 0..1].
 */
function buildSet(size, fill, normalStrength) {
  const n = size * size;
  const alb = new Uint8ClampedArray(n * 4);
  const orm = new Uint8ClampedArray(n * 4);
  const h = new Float32Array(n);
  const out = [0, 0, 0, 0, 1, 1, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      fill(x, y, x / size, y / size, out);
      alb[i * 4] = out[0];
      alb[i * 4 + 1] = out[1];
      alb[i * 4 + 2] = out[2];
      alb[i * 4 + 3] = 255;
      h[i] = out[3];
      orm[i * 4] = out[4] * 255;
      orm[i * 4 + 1] = out[5] * 255;
      orm[i * 4 + 2] = out[6] * 255;
      orm[i * 4 + 3] = 255;
    }
  }
  // Normal from height (OpenGL convention: +Y = up in texture space = up on the canvas).
  const nrm = new Uint8ClampedArray(n * 4);
  const k = normalStrength * size;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dx = (h[y * size + xp] - h[y * size + xm]) * 0.5 * k;
      const dyCanvas = (h[yp + x] - h[ym + x]) * 0.5 * k;
      // canvas y grows downward; texture v grows upward → dh/dv = -dh/dyCanvas.
      let nx = -dx;
      let ny = dyCanvas;
      let nz = 1;
      const l = hyp(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * size + x) * 4;
      nrm[i] = (nx * 0.5 + 0.5) * 255;
      nrm[i + 1] = (ny * 0.5 + 0.5) * 255;
      nrm[i + 2] = (nz * 0.5 + 0.5) * 255;
      nrm[i + 3] = 255;
    }
  }
  return { alb, nrm, orm };
}

function canvasTexture(size, data, srgb) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function hexRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Layered shaft rock: strata, faults, faint mineral streaks. */
function genRock(size, seed) {
  const f = makeFbm(seed, 4, 6, 0.55);
  const warp = makeFbm(seed + 7, 3, 4);
  const ridge = makeFbm(seed + 13, 6, 4);
  const base = hexRgb(0x3e3a35);
  const verd = hexRgb(PALETTE.verd);
  const rust = hexRgb(PALETTE.rust);
  return buildSet(
    size,
    (x, y, u, v, o) => {
      const n = f(u, v);
      const w = warp(u, v);
      const strata = 0.5 + 0.5 * Math.sin((v * 9 + w * 1.6) * Math.PI * 2);
      const r = 1 - Math.abs(ridge(u, v) * 2 - 1); // ridged → faults near 1
      const fault = smooth(0.82, 0.97, r);
      const b = 0.62 + n * 0.62 + (strata - 0.5) * 0.18 - fault * 0.35;
      const mineral = smooth(0.7, 0.85, w) * smooth(0.6, 0.9, r) * 0.55;
      const tint = w > 0.5 ? verd : rust;
      for (let c = 0; c < 3; c++) o[c] = (base[c] * b) * (1 - mineral) + tint[c] * mineral * 0.9;
      o[3] = n * 0.65 + strata * 0.2 - fault * 0.3;
      o[4] = 0.55 + n * 0.45 - fault * 0.3;
      o[5] = 0.86 + n * 0.12 - mineral * 0.3;
      o[6] = 0;
    },
    2.2,
  );
}

/** Ashlar courses: 8 rows per tile, staggered blocks, worn edges, dark mortar. */
function genMasonry(size, seed, cracked) {
  const rng = makeRng(seed);
  const f = makeFbm(seed + 3, 8, 5, 0.5);
  const chip = makeFbm(seed + 9, 16, 3);
  const rows = 8;
  const rowH = size / rows;
  const cuts = [];
  const tints = [];
  for (let r = 0; r < rows; r++) {
    const list = [];
    let x = rng() * size;
    const start = x;
    while (x < start + size - rowH * 1.6) {
      list.push(x % size);
      x += rowH * (1.6 + rng() * 1.4);
    }
    list.sort((a, b) => a - b);
    cuts.push(list);
    const tl = [];
    for (let i = 0; i < list.length; i++) tl.push(0.82 + rng() * 0.3);
    tints.push(tl);
  }
  const mortar = Math.max(2, size / 160);
  const bevel = size / 70;
  // Crack network (cracked variant): random walks rasterised into a mask.
  let crackMask = null;
  if (cracked) {
    crackMask = new Float32Array(size * size);
    const walks = 26;
    for (let w = 0; w < walks; w++) {
      let px = rng() * size;
      let py = rng() * size;
      let ang = rng() * Math.PI * 2;
      const len = size * (0.12 + rng() * 0.25);
      for (let s = 0; s < len; s++) {
        ang += (rng() - 0.5) * 0.6;
        px += Math.cos(ang);
        py += Math.sin(ang);
        const width = 1.6 * (1 - s / len) + 0.6;
        for (let oy = -2; oy <= 2; oy++) {
          for (let ox = -2; ox <= 2; ox++) {
            const d = hyp(ox, oy);
            if (d > width + 1) continue;
            const ix = (((Math.round(px) + ox) % size) + size) % size;
            const iy = (((Math.round(py) + oy) % size) + size) % size;
            const val = d <= width ? 1 : 0.4;
            const k = iy * size + ix;
            if (val > crackMask[k]) crackMask[k] = val;
          }
        }
      }
    }
  }
  const stone = hexRgb(cracked ? 0x4c463d : 0x46413a);
  const mort = hexRgb(0x1f1d1b);
  return buildSet(
    size,
    (x, y, u, v, o) => {
      const r = Math.min(rows - 1, Math.floor(y / rowH));
      const yIn = y - r * rowH;
      const list = cuts[r];
      // distance to the nearest vertical joint (cyclic)
      let dJ = size;
      let bi = 0;
      for (let i = 0; i < list.length; i++) {
        let d = Math.abs(x - list[i]);
        d = Math.min(d, size - d);
        if (d < dJ) dJ = d;
        if (x >= list[i]) bi = i;
      }
      if (x < list[0]) bi = list.length - 1;
      const dH = Math.min(yIn, rowH - yIn);
      const edge = Math.min(dJ, dH);
      const n = f(u, v);
      const c = chip(u, v);
      const worn = smooth(0, bevel, edge - mortar * 0.5 - c * bevel * 0.8);
      const inMortar = edge < mortar * 0.5 + c * 1.5;
      const tint = tints[r][bi] || 1;
      const b = (0.7 + n * 0.55) * tint;
      let height;
      if (inMortar) {
        for (let k = 0; k < 3; k++) o[k] = mort[k] * (0.8 + n * 0.4);
        height = 0.05;
        o[4] = 0.45;
        o[5] = 0.95;
      } else {
        for (let k = 0; k < 3; k++) o[k] = stone[k] * b * (0.88 + 0.12 * worn);
        height = 0.35 + 0.45 * worn + n * 0.2;
        o[4] = 0.7 + 0.3 * worn;
        o[5] = 0.8 + n * 0.15;
      }
      if (crackMask) {
        const m = crackMask[y * size + x];
        if (m > 0) {
          for (let k = 0; k < 3; k++) o[k] *= 1 - m * 0.75;
          height -= m * 0.4;
          o[4] *= 1 - m * 0.5;
        }
      }
      o[3] = height;
      o[6] = 0;
    },
    3.0,
  );
}

/** Riveted iron plates with rust blooms and drip streaks. */
function genMetal(size, seed) {
  const f = makeFbm(seed, 4, 5);
  const rustN = makeFbm(seed + 5, 6, 5, 0.6);
  const streak = makeFbm(seed + 11, 32, 2);
  const plates = 4;
  const P = size / plates;
  const iron = hexRgb(0x3b3b3d);
  const rust = hexRgb(0x7a3b22);
  const rivetR = size / 220;
  return buildSet(
    size,
    (x, y, u, v, o) => {
      const px = x % P;
      const py = y % P;
      const dSeam = Math.min(px, P - px, py, P - py);
      const n = f(u, v);
      // rivets along plate borders
      const step = P / 8;
      const rx = (px % step) - step / 2;
      const ry = Math.min(py, P - py) - step * 0.35;
      const ry2 = (py % step) - step / 2;
      const rx2 = Math.min(px, P - px) - step * 0.35;
      const rd = Math.min(hyp(rx, ry), hyp(rx2, ry2));
      const rivet = 1 - smooth(rivetR * 0.4, rivetR * 1.4, rd);
      // rust: blooms + vertical drips (streak noise stretched along v)
      const drip = streak(u, v * 0.08) * smooth(0.2, 0.8, rustN(u, v + 0.05));
      const rr = clamp01(smooth(0.52, 0.72, rustN(u, v)) + drip * 0.45);
      const seam = 1 - smooth(1, 3, dSeam);
      for (let k = 0; k < 3; k++) o[k] = (iron[k] * (0.75 + n * 0.5)) * (1 - rr) + rust[k] * (0.6 + n * 0.6) * rr;
      for (let k = 0; k < 3; k++) o[k] *= 1 - seam * 0.6;
      o[3] = 0.5 + rivet * 0.45 - seam * 0.4 + rr * 0.12 + n * 0.06;
      o[4] = 1 - seam * 0.5;
      o[5] = 0.42 + rr * 0.5 + n * 0.08;
      o[6] = 0.85 * (1 - rr);
    },
    2.0,
  );
}

/** RGBA iron grating (alpha-tested). */
function genGrate(size) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const cells = 16;
  const step = size / cells;
  const bar = Math.max(2, step * 0.22);
  ctx.fillStyle = '#4a4744';
  for (let i = 0; i < cells; i++) {
    ctx.fillRect(i * step, 0, bar, size);
    ctx.fillRect(0, i * step, size, bar);
  }
  // heavier frame bars every 4 cells
  ctx.fillStyle = '#3a3633';
  for (let i = 0; i < cells; i += 4) {
    ctx.fillRect(i * step - bar * 0.4, 0, bar * 1.8, size);
    ctx.fillRect(0, i * step - bar * 0.4, size, bar * 1.8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Crack mask (R) for the crumble overlay. */
function genCrackMask(size, seed) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const rng = makeRng(seed);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let w = 0; w < 46; w++) {
    let x = rng() * size;
    let y = rng() * size;
    let ang = rng() * Math.PI * 2;
    const segs = 10 + Math.floor(rng() * 18);
    ctx.lineWidth = 1.2 + rng() * 2.4;
    ctx.strokeStyle = '#fff';
    for (let s = 0; s < segs; s++) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ang += (rng() - 0.5) * 1.1;
      const l = size * (0.012 + rng() * 0.03);
      const nx = x + Math.cos(ang) * l;
      const ny = y + Math.sin(ang) * l;
      // draw wrapped copies so the mask tiles
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          ctx.moveTo(x + ox * size, y + oy * size);
          ctx.lineTo(nx + ox * size, ny + oy * size);
        }
      }
      ctx.stroke();
      ctx.lineWidth *= 0.93;
      x = nx;
      y = ny;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Low-frequency grey noise (R) used to break up texture tiling on big surfaces. */
function genMacro(size, seed) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const f = makeFbm(seed, 3, 5, 0.55);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.round(clamp01(f(x / size, y / size) * 1.25 - 0.12) * 255);
      const i = (y * size + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function setFromBuilt(size, built, tile) {
  if (!built) return null;
  const map = canvasTexture(size, built.alb, true);
  if (!map) return null;
  return {
    map,
    normalMap: canvasTexture(size, built.nrm, false),
    ormMap: canvasTexture(size, built.orm, false),
    tileMeters: tile,
    procedural: true,
  };
}

/**
 * Procedural fallback sets: { rock, masonry, metal, distant, grate, crack, macro }.
 * ~1 s at 512 px, ~0.25 s at 256 px on a desktop (main thread); call once.
 * (Crumbling ledges use the masonry set with the crack overlay.)
 */
export function makeProceduralTextureSets(size = 512) {
  const out = {};
  try {
    out.rock = setFromBuilt(size, genRock(size, 11), 4);
    out.masonry = setFromBuilt(size, genMasonry(size, 23, false), 4);
    out.metal = setFromBuilt(size, genMetal(size, 57), 4);
    out.distant = out.rock;
    out.grate = { map: genGrate(256), tileMeters: 4, procedural: true };
    out.crack = { map: genCrackMask(256, 77), tileMeters: 3, procedural: true };
    out.macro = { map: genMacro(128, 91), tileMeters: 40, procedural: true };
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[AT3D] procedural textures failed', err);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Manifest loading
// -----------------------------------------------------------------------------

const ROLE_MATCH = [
  // role, test(name)
  ['distant', (n) => /dist|far|dark|deep/.test(n) && !/mason|ashlar|brick|metal|iron|rust/.test(n)],
  ['masonry', (n) => /mason|ashlar|brick|block|stone/.test(n) && !/dist|far/.test(n)],
  ['metal', (n) => /metal|iron|rust|steel/.test(n)],
  ['rock', (n) => /rock|cliff|shaft|wall/.test(n)],
  ['flesh', (n) => /flesh|sinew|organic|meat/.test(n)],
];

function pickKey(obj, names) {
  for (const k of names) if (obj && typeof obj[k] === 'string') return obj[k];
  return null;
}

/**
 * Loads assets/textures/manifest.json style sets.
 * @param {string|object} manifestOrUrl  URL of the manifest or the parsed JSON
 * @param {string} [baseUrl]  base for relative paths (defaults to the manifest's folder)
 * @returns {Promise<object|null>} { rock, masonry, metal, distant } (each {map, normalMap, ormMap, tileMeters})
 */
export async function loadTextureManifest(manifestOrUrl = 'assets/textures/manifest.json', baseUrl) {
  let manifest = manifestOrUrl;
  let base = baseUrl;
  if (typeof manifestOrUrl === 'string') {
    if (typeof fetch !== 'function') return null;
    let res;
    try {
      res = await fetch(manifestOrUrl, { cache: 'no-cache' });
    } catch {
      return null;
    }
    if (!res || !res.ok) return null;
    try {
      manifest = await res.json();
    } catch {
      return null;
    }
    if (base == null) base = manifestOrUrl.replace(/[^/]*$/, '');
  }
  if (!manifest || typeof manifest !== 'object') return null;
  if (base == null) base = 'assets/textures/';
  const sets = manifest.sets && typeof manifest.sets === 'object' ? manifest.sets : manifest;
  const loader = new THREE.TextureLoader();
  const load = (rel, srgb) =>
    new Promise((resolve) => {
      if (!rel) {
        resolve(null);
        return;
      }
      const url = /^(https?:|data:|blob:|\/)/.test(rel) ? rel : base + rel;
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          resolve(tex);
        },
        undefined,
        () => resolve(null),
      );
    });

  const result = {};
  const names = Object.keys(sets).filter((k) => sets[k] && typeof sets[k] === 'object');
  const assigned = new Set();
  for (const [role, test] of ROLE_MATCH) {
    const name = names.find((n) => !assigned.has(n) && (n.toLowerCase() === role || test(n.toLowerCase())));
    if (!name) continue;
    assigned.add(name);
    const s = sets[name];
    const [map, normalMap, ormMap] = await Promise.all([
      load(pickKey(s, ['albedo', 'color', 'baseColor', 'diffuse', 'diff', 'map']), true),
      load(pickKey(s, ['normal', 'normalGL', 'nor_gl', 'nrm', 'normalMap']), false),
      load(pickKey(s, ['orm', 'arm', 'ORM', 'ormMap']), false),
    ]);
    if (!map) continue;
    const tile = Number(s.tileMeters || s.tile || s.size || DEFAULT_TILE);
    result[role] = { map, normalMap, ormMap, tileMeters: isFinite(tile) && tile > 0 ? tile : DEFAULT_TILE, name };
  }
  return Object.keys(result).length ? result : null;
}

// -----------------------------------------------------------------------------
// Shader patches
// -----------------------------------------------------------------------------

const UV_TARGETS = ['MAP', 'NORMALMAP', 'AOMAP', 'ROUGHNESSMAP', 'METALNESSMAP', 'ALPHAMAP', 'EMISSIVEMAP'];
const UV_VARY = {
  MAP: 'vMapUv',
  NORMALMAP: 'vNormalMapUv',
  AOMAP: 'vAoMapUv',
  ROUGHNESSMAP: 'vRoughnessMapUv',
  METALNESSMAP: 'vMetalnessMapUv',
  ALPHAMAP: 'vAlphaMapUv',
  EMISSIVEMAP: 'vEmissiveMapUv',
};
const UV_ASSIGN = UV_TARGETS.map((t) => `#ifdef USE_${t}\n\t${UV_VARY[t]} = atUv;\n#endif`).join('\n');

/**
 * Patches a built-in material with any of:
 *  uv: 'box'     world-metric planar projection on the dominant face axis (instanced boxes)
 *      'metric'  geometry uv already in metres (merged decor) → scaled by 1/tile
 *  ash: 0..1     lighter dust on upward faces (needs uv mode for the varying)
 *  crack: Texture  dark crack overlay (crumble), scaled by crackScale
 *  shapes: true  per-vertex aShape vs per-instance iShape.x selection (others collapse),
 *                aSplit × iShape.y lateral split, aGlow × iShape.z emissive inlay (glowColor),
 *                aPlate (1 wall-only / 2 chain-only part) vs iShape.w (1 = chain mount)
 *  shade: true   unlit silhouettes take a cheap key-light term from their world
 *                normal (KEY_DIR, the shaft key in Renderer3D): lit tops and
 *                flanks, shaded undersides — colossi read as carved masses, not cut-outs
 *  lit: true     rim (Fresnel haze edge light) + wetness response from the shared LOOK
 *                uniforms; `wetK` scales this material's wetness, `wetMin` floors it (flesh is always wet)
 *  fog: 'cap'    linear fog capped at fogCap (silhouettes survive)
 *       'fade'   additive materials: fade toward black instead of fog colour
 * Uniform objects live on material.userData.at so callers can drive them.
 */
export function patchMaterial(mat, opts = {}) {
  const U = {
    uTexScale: { value: 1 / (opts.tile || DEFAULT_TILE) },
    uAsh: { value: opts.ash || 0 },
    uAshColor: { value: new THREE.Color(opts.ashColor != null ? opts.ashColor : PALETTE.ash) },
    uCrackMap: { value: opts.crack || null },
    uCrackScale: { value: opts.crackScale || 1 / 3 },
    uCrackAmt: { value: opts.crack ? 1 : 0 },
    uMacroMap: { value: opts.macro || null },
    uMacroAmt: { value: opts.macroAmt != null ? opts.macroAmt : 0.75 },
    uFogCap: { value: opts.fogCap != null ? opts.fogCap : 1 },
    uGlowColor: { value: new THREE.Color(opts.glowColor != null ? opts.glowColor : PALETTE.phos) },
    uSplit: { value: opts.splitGap || 0.08 },
    uNearFade: { value: new THREE.Vector2(opts.nearFade ? opts.nearFade[0] : 0, opts.nearFade ? opts.nearFade[1] : 0) },
  };
  mat.userData.at = U;
  const uvMode = opts.uv || null;
  const shapes = !!opts.shapes;
  const fog = opts.fog || null;
  const ash = opts.ash != null && uvMode;
  const crack = !!opts.crack && uvMode;
  const macro = !!opts.macro && uvMode;
  const shaft = !!opts.shaft;
  const shade = !!opts.shade;
  const lit = !!opts.lit;
  const wetK = opts.wetK != null ? opts.wetK : 1;
  const wetMin = opts.wetMin || 0;
  const breathe = opts.breathe || 0;
  const key = `at3d|uv:${uvMode}|ash:${ash ? 1 : 0}|crack:${crack ? 1 : 0}|macro:${macro ? 1 : 0}|shapes:${shapes ? 1 : 0}|shaft:${shaft ? 1 : 0}|shade:${shade ? 1 : 0}|lit:${lit ? 1 : 0}|br:${breathe}|fog:${fog}`;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    if (lit) Object.assign(shader.uniforms, LOOK);
    let vs = shader.vertexShader;
    let fs = shader.fragmentShader;
    let vDecl = '';
    let fDecl = '';

    if (uvMode) {
      vDecl += 'uniform float uTexScale;\nvarying float vAtTop;\nvarying vec2 vAtUv;\n';
      fDecl += 'varying float vAtTop;\nvarying vec2 vAtUv;\n';
      const uvSrc =
        uvMode === 'box'
          ? `
  #ifdef USE_INSTANCING
    mat4 atM = instanceMatrix;
  #else
    mat4 atM = mat4( 1.0 );
  #endif
    vec3 atS = vec3( length( atM[ 0 ].xyz ), length( atM[ 1 ].xyz ), length( atM[ 2 ].xyz ) );
    vec3 atP = position * atS + atM[ 3 ].xyz + modelMatrix[ 3 ].xyz;
    vec3 atN = abs( normal );
    vec2 atUv = ( atN.x > atN.y && atN.x > atN.z ) ? atP.zy : ( ( atN.y > atN.z ) ? atP.xz : atP.xy );
    atUv *= uTexScale;`
          : `
    vec2 atUv = uv * uTexScale;`;
      vs = vs.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
  {
${uvSrc}
${UV_ASSIGN}
    vAtUv = atUv;
    vAtTop = normal.y;
  }`,
      );
    }

    if (shapes) {
      vDecl += 'attribute float aShape;\nattribute float aSplit;\nattribute float aGlow;\nattribute float aPlate;\nattribute vec4 iShape;\nuniform float uSplit;\nvarying float vAtGlow;\n';
      fDecl += 'varying float vAtGlow;\nuniform vec3 uGlowColor;\n';
      vs = vs.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  if ( abs( aShape - iShape.x ) > 0.5 ) transformed = vec3( 0.0 );
  // aPlate 1 = wall-mount-only part, 2 = chain-mount-only part; iShape.w = 1 for chain mounts
  if ( ( aPlate > 0.5 && aPlate < 1.5 && iShape.w > 0.5 ) || ( aPlate > 1.5 && iShape.w < 0.5 ) ) transformed = vec3( 0.0 );
  transformed.x += aSplit * iShape.y * uSplit;
  vAtGlow = aGlow * iShape.z;`,
      );
      if (fs.includes('#include <emissivemap_fragment>')) {
        fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uGlowColor * vAtGlow;');
      } else {
        fs = fs.replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb *= 1.0 + vAtGlow;');
      }
    }

    if (ash || crack || macro) {
      if (ash) fDecl += 'uniform float uAsh;\nuniform vec3 uAshColor;\n';
      if (crack) fDecl += 'uniform sampler2D uCrackMap;\nuniform float uCrackScale;\nuniform float uCrackAmt;\n';
      if (macro) fDecl += 'uniform sampler2D uMacroMap;\nuniform float uMacroAmt;\n';
      let inject = '#include <map_fragment>\n';
      if (macro) {
        inject += `  {
    float atMa = texture2D( uMacroMap, vAtUv * 0.083 + vec2( 0.31, 0.17 ) ).r;
    float atMb = texture2D( uMacroMap, vAtUv * 0.021 + vec2( 0.53, 0.71 ) ).r;
    diffuseColor.rgb *= mix( 1.0, 0.55 + 0.6 * atMa + 0.35 * ( atMb - 0.5 ), uMacroAmt );
  }
`;
      }
      if (crack) {
        inject += `  {
    float atCr = texture2D( uCrackMap, vAtUv * uCrackScale ).r * uCrackAmt;
    diffuseColor.rgb *= 1.0 - atCr * 0.9;
  }
`;
      }
      if (ash) inject += '  diffuseColor.rgb = mix( diffuseColor.rgb, uAshColor, smoothstep( 0.55, 0.95, vAtTop ) * uAsh );\n';
      fs = fs.replace('#include <map_fragment>', inject);
    }

    if (shaft) {
      // Volumetric fake: bright where the surface faces the eye (thick part of the
      // beam), soft at the silhouette, and gone up close / from inside.
      vDecl += 'varying float vAtFacing;\nvarying float vAtDist;\n';
      fDecl += 'varying float vAtFacing;\nvarying float vAtDist;\nuniform vec2 uNearFade;\n';
      vs = vs.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  {
    vec3 atNv = normalize( normalMatrix * normal );
    vec3 atV = normalize( -mvPosition.xyz );
    vAtFacing = abs( dot( atNv, atV ) );
    vAtDist = length( mvPosition.xyz );
  }`,
      );
      fs = fs.replace(
        '#include <opaque_fragment>',
        '#include <opaque_fragment>\n  gl_FragColor.rgb *= vAtFacing * vAtFacing * smoothstep( uNearFade.x, uNearFade.y, vAtDist );',
      );
    }

    if (lit && breathe > 0) {
      // living growth: a slow position-only sway (no per-face displacement, so flat-shaded faces never tear apart)
      vDecl += 'uniform float uTime;\n';
      vs = vs.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  {
    float atPh = position.y * 0.8 + position.x * 0.5 + position.z * 0.6;
    transformed += vec3( sin( uTime * 0.7 + atPh ), 0.4 * sin( uTime * 0.5 + atPh * 1.3 ), cos( uTime * 0.6 + atPh * 0.9 ) ) * ${breathe.toFixed(4)};
  }`,
      );
    }
    if (lit) {
      fDecl += 'uniform vec3 uRimColor;\nuniform float uRim;\nuniform float uWet;\nuniform float uVG;\n';
      const dry = uvMode ? 'smoothstep( 0.55, 0.95, vAtTop )' : '0.0';
      // porous stone darkens when wet; the water film drops roughness (sharp lantern glints)
      fs = fs.replace('#include <map_fragment>', `#include <map_fragment>
  float atWet = max( uWet * ${wetK.toFixed(3)}, ${wetMin.toFixed(3)} ) * ( 1.0 - ${dry} );
  diffuseColor.rgb *= 1.0 - 0.32 * atWet;
  {
    float atWy = cameraPosition.y + dot( vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] ), - vViewPosition );
    diffuseColor.rgb *= 1.0 + uVG * clamp( ( atWy - cameraPosition.y ) * ( 1.0 / 24.0 ), - 1.0, 1.0 );
  }`);
      fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.42 + 0.06, atWet );`);
      fs = fs.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  {
    float atRim = pow( 1.0 - clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 ), 3.0 );
    totalEmissiveRadiance += uRimColor * ( atRim * uRim ) * ( 0.25 + diffuseColor.rgb );
  }`,
      );
    }

    if (shade) {
      vDecl += 'varying vec3 vAtWN;\n';
      fDecl += 'varying vec3 vAtWN;\n';
      vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vAtWN = normalize( mat3( modelMatrix ) * normal );');
      const k = KEY_DIR;
      fs = fs.replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
  {
    vec3 atN = normalize( vAtWN );
    gl_FragColor.rgb *= 0.45 + 0.95 * max( dot( atN, vec3( ${k.x.toFixed(4)}, ${k.y.toFixed(4)}, ${k.z.toFixed(4)} ) ), 0.0 ) + 0.15 * atN.y;
  }`,
      );
    }

    if (fog === 'cap' || fog === 'fade') {
      fDecl += 'uniform float uFogCap;\n';
      const body =
        fog === 'cap'
          ? 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, min( atFog, uFogCap + ( 1.0 - uFogCap ) * 0.55 * smoothstep( fogFar, fogFar * 4.0, vFogDepth ) ) );'
          : 'gl_FragColor.rgb *= 1.0 - min( atFog, uFogCap );';
      fs = fs.replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
  float atFog = atFogFactor( vFogDepth );
  ${body}
#endif`,
      );
    }

    vs = vs.replace('#include <common>', `#include <common>\n${vDecl}`);
    fs = fs.replace('#include <common>', `#include <common>\n${fDecl}`);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/**
 * Fog for VR, installed globally (ShaderChunk) so every module's materials agree:
 *  - radial (distance) fog instead of view depth: rotation-invariant, so
 *    looking around in the headset never changes what fog hides
 *  - a front-loaded curve between fogNear and fogFar (1 − (1 − t)^2.5): mid
 *    distances turn to haze quickly (silhouettes, depth), and the far value
 *    still reaches exactly 1 so distance culling at fogFar is invisible
 *  - a vertical gradient on the fog colour by view direction (per fragment):
 *    the haze above (where you came from) holds a little light, the abyss below
 *    swallows it. `fogColor` is redefined to the graded colour after the
 *    declarations, so every material's fog code (built-in chunks and custom
 *    patches alike) fades to exactly the same colour as the sky dome
 *    (Renderer3D) — distance culling stays invisible at any pitch.
 * atFogFactor(d) and atFogColor() are available to every fragment shader that uses fog.
 */
export const FOG_GRADIENT = { up: 0.55, down: 0.6 };

export function installRadialFog() {
  const vpars = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogView;\n#endif\n';
  const vtx = '#ifdef USE_FOG\n\tvFogDepth = length( mvPosition.xyz );\n\tvFogView = mvPosition.xyz;\n#endif\n';
  const pars = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogView;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	float atFogFactor( float d ) {
	#ifdef FOG_EXP2
		return 1.0 - exp( - fogDensity * fogDensity * d * d );
	#else
		float t = clamp( ( d - fogNear ) / max( fogFar - fogNear, 1e-3 ), 0.0, 1.0 );
		float u = 1.0 - t;
		return 1.0 - u * u * sqrt( u );
	#endif
	}
	vec3 atFogColor() {
		// world-space up of the view ray: viewMatrix[ 1 ].xyz is world +Y in view space
		float k = dot( normalize( vFogView ), viewMatrix[ 1 ].xyz );
		float up = smoothstep( 0.0, 1.0, k );
		float dn = smoothstep( 0.0, 0.85, - k );
		return fogColor * ( 1.0 + ${FOG_GRADIENT.up.toFixed(3)} * up - ${FOG_GRADIENT.down.toFixed(3)} * dn );
	}
	#define fogColor atFogColor()
#endif
`;
  const frag = '#ifdef USE_FOG\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, atFogFactor( vFogDepth ) );\n#endif\n';
  if (THREE.ShaderChunk.fog_pars_vertex !== vpars) THREE.ShaderChunk.fog_pars_vertex = vpars;
  if (THREE.ShaderChunk.fog_vertex !== vtx) THREE.ShaderChunk.fog_vertex = vtx;
  if (THREE.ShaderChunk.fog_pars_fragment !== pars) THREE.ShaderChunk.fog_pars_fragment = pars;
  if (THREE.ShaderChunk.fog_fragment !== frag) THREE.ShaderChunk.fog_fragment = frag;
}

/** JS twin of the shader fog curve (0..1) for CPU-side fades. */
export function fogFactor(d, near, far) {
  const t = Math.min(1, Math.max(0, (d - near) / Math.max(far - near, 1e-3)));
  const u = 1 - t;
  return 1 - u * u * Math.sqrt(u);
}

// -----------------------------------------------------------------------------
// Material library
// -----------------------------------------------------------------------------

/**
 * Creates every shared material once. Texture sets can be swapped later
 * (procedural → baked) with setTextureSets(); materials keep their programs.
 */
export class MaterialLibrary {
  constructor(renderer) {
    this.renderer = renderer || null;
    this.maxAniso = 4;
    try {
      if (renderer && renderer.capabilities) this.maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy() || 1);
    } catch {
      this.maxAniso = 1;
    }
    // Fallback only: visible until the baked manifest arrives (or for good when
    // it is missing). 256 px keeps its main-thread cost at boot to ~¼.
    this.sets = makeProceduralTextureSets(PROCEDURAL_SIZE);
    this._applyAniso(this.sets);
    this._procedural = this.sets;
    this.m = {};
    this._build();
  }

  _applyAniso(sets) {
    if (!sets) return;
    for (const k of Object.keys(sets)) {
      const s = sets[k];
      if (!s) continue;
      for (const t of [s.map, s.normalMap, s.ormMap]) if (t && t.isTexture) t.anisotropy = this.maxAniso;
    }
  }

  _std(set, params, patch) {
    const s = set || {};
    const mat = new THREE.MeshStandardMaterial(
      Object.assign(
        {
          color: 0xffffff,
          roughness: 1,
          metalness: 1,
          map: s.map || null,
          normalMap: s.normalMap || null,
          aoMap: s.ormMap || null,
          roughnessMap: s.ormMap || null,
          metalnessMap: s.ormMap || null,
          aoMapIntensity: 0.85,
        },
        params,
      ),
    );
    if (!s.ormMap) {
      mat.roughness = params && params.roughness != null ? params.roughness : 0.9;
      mat.metalness = params && params.metalness != null ? params.metalness : 0;
    }
    mat.normalScale.set(1, 1);
    patchMaterial(mat, Object.assign({ tile: s.tileMeters || DEFAULT_TILE }, patch));
    mat.userData.setRole = patch && patch.role;
    return mat;
  }

  _build() {
    const S = this.sets;
    const m = this.m;
    const macro = S.macro && S.macro.map;
    // Level solids (InstancedMesh, box-projected world UVs, ash on tops).
    m.rock = this._std(S.rock, {}, { uv: 'box', ash: 0.32, macro, role: 'rock', lit: true });
    m.masonry = this._std(S.masonry, {}, { uv: 'box', ash: 0.38, macro, role: 'masonry', lit: true });
    // Crumbling ledges read differently by PATTERN (dense dark cracks) and value (paler, dusty), not hue alone.
    m.crumble = this._std(S.masonry, { color: 0xf0e2c8 }, { uv: 'box', ash: 0.55, crack: S.crack && S.crack.map, crackScale: 1 / 1.6, macro, role: 'masonry', lit: true });
    m.metal = this._std(S.metal, {}, { uv: 'box', ash: 0.22, macro, role: 'metal', lit: true, wetK: 0.5 });
    m.grate = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: S.grate && S.grate.map,
      roughness: 0.6,
      metalness: 0.7,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    patchMaterial(m.grate, { uv: 'box', tile: 4 });
    // Merged decor + environment dressing (uv already in metres; vertex colour =
    // baked AO × the section grade).
    m.decorStone = this._std(S.masonry, { vertexColors: true }, { uv: 'metric', ash: 0.3, macro, role: 'masonry', lit: true });
    m.decorMetal = this._std(S.metal, { vertexColors: true }, { uv: 'metric', ash: 0.15, macro, role: 'metal', lit: true, wetK: 0.5 });
    m.decorRock = this._std(S.distant || S.rock, { vertexColors: true }, { uv: 'metric', ash: 0.25, macro, role: 'distant', lit: true });
    // Organic growth (the predator's sinew through the masonry): the flesh set's
    // relief, graded to a dark, MATTE bruise-brown (art bible: never wet red).
    m.decorFlesh = this._std(S.flesh || S.rock, { vertexColors: true, color: S.flesh ? FLESH_GRADE : 0x3a2c28 }, { uv: 'metric', macro, role: 'flesh', lit: true, wetK: 1.4, wetMin: 0.45, breathe: 0.03 });
    m.decorFlesh.userData.matte = 0.82;
    m.decorFlesh.roughnessMap = null;
    m.decorFlesh.roughness = 0.82;
    // Emissive bits of decor (lamp bulbs, inlays, statue lanterns): vertex colours.
    m.decorGlow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    patchMaterial(m.decorGlow, { fog: 'cap', fogCap: 0.55 });
    // Volumetric light shafts: additive, fades to black in fog. forceSinglePass:
    // a transparent DoubleSide material otherwise draws twice per eye (back then
    // front) and re-resolves its program on every pass; additive with no depth
    // write is order-independent, so one pass looks the same.
    m.lightShaft = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      toneMapped: false,
    });
    patchMaterial(m.lightShaft, { fog: 'fade', fogCap: 0.85, shaft: true, nearFade: [2.5, 14] });
    // Anchor mounts: shape-selected iron with phosphor inlays.
    m.mount = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.75 });
    patchMaterial(m.mount, { shapes: true, glowColor: PALETTE.phos, splitGap: 0.05 });
    // Anchor glyphs (billboards): additive phosphor, fades (not fogs) with distance.
    m.glyph = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    patchMaterial(m.glyph, { shapes: true, fog: 'fade', fogCap: 0.55, splitGap: 0.28 });
    // Hazards: shape-selected rusted iron with a dull warning inlay.
    m.hazard = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.3 });
    patchMaterial(m.hazard, { shapes: true, glowColor: 0x8a2c18 });
    // Colossal silhouettes: unlit, colour follows the fog, fog capped.
    m.colossal = new THREE.MeshBasicMaterial({ color: 0x0b0c0d, toneMapped: false });
    patchMaterial(m.colossal, { fog: 'cap', fogCap: 0.5, shade: true });
    m.plaque = this._std(S.masonry, { emissive: new THREE.Color(PALETTE.phos), emissiveIntensity: 0.0 }, { uv: 'metric', role: 'masonry' });
    // Sky dome (Renderer3D): fully fogged, so it shows exactly the graded fog colour.
    m.sky = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, depthWrite: false, depthTest: false, toneMapped: true });
  }

  get(name) {
    return this.m[name] || null;
  }

  /**
   * Swap in baked sets ({ rock, masonry, metal, distant }). Missing roles keep
   * the procedural textures. Returns true when anything changed.
   */
  setTextureSets(sets) {
    if (!sets || typeof sets !== 'object') return false;
    this._applyAniso(sets);
    let changed = false;
    for (const name of Object.keys(this.m)) {
      const mat = this.m[name];
      const role = mat.userData.setRole;
      if (!role) continue;
      const s = sets[role] || (role === 'distant' ? sets.rock : null);
      if (!s || !s.map) continue;
      if (mat.map !== s.map) changed = true;
      mat.map = s.map;
      if (role === 'flesh') mat.color.copy(mat.userData.matte ? FLESH_GRADE : _white);
      if (mat.normalMap && s.normalMap) {
        if (mat.normalMap !== s.normalMap) changed = true;
        mat.normalMap = s.normalMap;
      }
      if (mat.aoMap && s.ormMap) {
        if (mat.aoMap !== s.ormMap) changed = true;
        mat.aoMap = s.ormMap;
        mat.roughnessMap = mat.userData.matte ? null : s.ormMap;
        mat.metalnessMap = s.ormMap;
      }
      if (mat.userData.at) mat.userData.at.uTexScale.value = 1 / (s.tileMeters || DEFAULT_TILE);
    }
    // Same sets again (a restart re-applies them) → nothing to re-upload or recompile.
    if (changed) {
      this.sets = Object.assign({}, this.sets, sets);
      this._releaseProcedural();
    }
    return changed;
  }

  /** Frees the GPU copies of procedural textures no material samples any more (baked sets replaced them). */
  _releaseProcedural() {
    const used = new Set();
    for (const name of Object.keys(this.m)) {
      const mat = this.m[name];
      for (const k of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'emissiveMap']) if (mat[k]) used.add(mat[k]);
      const U = mat.userData.at;
      if (U) for (const k of Object.keys(U)) if (U[k] && U[k].value && U[k].value.isTexture) used.add(U[k].value);
    }
    const group = this._procedural;
    if (!group) return;
    for (const k of Object.keys(group)) {
      const s = group[k];
      if (!s) continue;
      for (const t of [s.map, s.normalMap, s.ormMap]) {
        // dispose() only drops the GPU copy; the canvas stays, so a later re-use simply re-uploads.
        if (t && t.isTexture && !used.has(t)) t.dispose();
      }
    }
  }

  dispose() {
    for (const k of Object.keys(this.m)) this.m[k].dispose();
    const seen = new Set();
    for (const group of [this._procedural, this.sets]) {
      if (!group) continue;
      for (const k of Object.keys(group)) {
        const s = group[k];
        if (!s) continue;
        for (const t of [s.map, s.normalMap, s.ormMap]) {
          if (t && t.isTexture && !seen.has(t)) {
            seen.add(t);
            t.dispose();
          }
        }
      }
    }
  }
}
