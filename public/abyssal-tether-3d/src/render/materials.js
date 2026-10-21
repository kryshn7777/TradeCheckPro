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
import { LM_RANGE_LAMP, LM_RANGE_STATIC } from './lightmapFormat.js';
import { installDither } from './vrShade.js';

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
  // Reflection (render/envProbe.js): x global scale of the procedural environment (0 = off: the fetch is skipped),
  // y wet boost (a wet surface reflects 1 + y times more), z how far the water film flattens the normal used for it.
  uEnvK: { value: new THREE.Vector4(1, 3, 0.6, 0) },
  // Wet film glint from the carried lantern (a smooth clear-coat lobe on the geometric normal, no MeshPhysicalMaterial).
  uLanternW: { value: new THREE.Vector3(0, 1e5, 0) }, // world position
  uLanternC: { value: new THREE.Vector4(0, 0, 0, 0) }, // rgb colour × candela, a = film strength (0 = off)
  uLanternR: { value: new THREE.Vector2(30, 1.6) }, // range (m), decay
  // Baked GI (render/lighting.js, tools/abyssal-tether-3d/bake/bake_gi.mjs): x on/off, y ambient-occlusion strength,
  // z bounce gain, w shaft-key visibility strength.
  uGI: { value: null },
  uGIK: { value: new THREE.Vector4(0, 0.85, 1, 0.7) },
  uGIMin: { value: new THREE.Vector3(0, 0, 0) },
  uGIInv: { value: new THREE.Vector3(1, 1, 1) },
  uGIWarm: { value: new THREE.Color(1.0, 0.55, 0.22) },
  uGICool: { value: new THREE.Color(0.3, 0.5, 0.6) },
  // Baked lightmaps (render/lighting.js, tools/abyssal-tether-3d/bake/bake_lightmaps.mjs): uLM = RGBA8 page array (rgb sqrt
  // static irradiance, a sqrt flame-lamp direct light), uLMTab = per-solid chart table (vertex shader), uLMK: x on/off,
  // y exposure, z lamp flicker, w ambient floor (irradiance added everywhere), uLMLamp = lamp tint (luminance 1).
  uLM: { value: null },
  uLMTab: { value: null },
  uLMK: { value: new THREE.Vector4(0, 1, 1, 0) },
  uLMLamp: { value: new THREE.Color(1.0, 0.55, 0.22) },
  uLMLan: { value: new THREE.Vector2(1.05, 0.38) }, // lantern on lightmapped surfaces: gain, extra distance falloff exponent (see LIGHTS_BEGIN_GI)
  // Surface detail (WP-GFX-QUEST-MAT): x detail-normal strength, y / z distance (m) over which it fades out.
  uDetailK: { value: new THREE.Vector4(0.9, 5, 16, 0) },
  // Parallax offset mapping: x on/off, y max distance (m), z fade length (m), w depth scale. Driven by the quality tier.
  uParallaxK: { value: new THREE.Vector4(1, 8, 3, 1) },
  // Steep parallax (WP-GFX-PARITY, FLOORS only: surfaces facing up): x max ray-march steps (< 2 = off, the 1-tap above applies),
  // y max distance (m) beyond which the 1-tap applies, z fade length (m) over which the step count falls to 2, w unused.
  uParallaxS: { value: new THREE.Vector4(6, 3, 1.2, 0) },
  // Height-based blending in cracks and joints: x grime, y moss, z standing water (× wetness).
  uCrevK: { value: new THREE.Vector4(0.55, 0.55, 0.7, 0) },
  // In-shader filmic grade (no post pass): x contrast about mid grey, y saturation, z extra desaturation at depth
  // (0 at y = 0 m .. full at y = -300 m), w unused; uGradeTint multiplies the linear colour (per-section warmth).
  uGradeK: { value: new THREE.Vector4(1.1, 1.0, 0.2, 0) },
  uGradeTint: { value: new THREE.Color(1, 1, 1) },
  // LCD black point (VR polish): linear colour added to the lit surfaces after the contrast curve, before the tone mapper (the haze
  // colour at a fraction, driven per section by Renderer3D): the pits keep a trace of colour instead of crushing to OLED black.
  uBlack: { value: new THREE.Color(0, 0, 0) },
  // Box edge bevel (WP-GFX-PARITY, unit-box solids): x strength (0 = off, branch-skipped), y bevel width (m), z fade-out distance (m).
  uBevelK: { value: new THREE.Vector4(1, 0.035, 34, 0) },
  // Parallax-corrected reflections: the current section's shaft as a box (xyz centre, w 1 = on) and its half extents; the shared
  // probe is one cube rendered from a notional centre, so a ray from a floor puddle is intersected with this box before the fetch.
  uProbeC: { value: new THREE.Vector4(0, 0, 0, 0) },
  uProbeH: { value: new THREE.Vector3(20, 20, 20) },
  // Standing water: x puddle strength (0 = no puddles), y mirror roughness, z albedo darkening, w reflection boost.
  uPudK: { value: new THREE.Vector4(1, 0.045, 0.4, 0.9) },
};

/**
 * Lantern shadow (WP-SHADOWS, render/lanternShadow.js): the carried lantern's real-time shadow, as shared uniform holders. Two
 * hardware-compare depth maps (sampler2DShadow) + the world -> map matrices: S = the cached STATIC map (level solids, rendered only
 * when the lantern has moved / turned), D = the DYNAMIC map (creature, body, hands, rope, props; every frame). uLSK: x strength
 * (0 = off: the receivers return at once), y / z world size of one S / D texel per metre of distance (normal-offset and bias scale),
 * w range (m) over which the shadow fades back to the unshadowed lantern. Receivers get these through patchLanternShadow().
 */
export const LSHADOW = {
  uLSMapS: { value: null },
  uLSMapD: { value: null },
  uLSMS: { value: new THREE.Matrix4() },
  uLSMD: { value: new THREE.Matrix4() },
  uLSK: { value: new THREE.Vector4(0, 0.003, 0.006, 14) },
};

/** Default texture tile (metres) when a set does not say. */
export const DEFAULT_TILE = 4;
/** Fallback texture resolution (px) generated at boot, before the baked sets load. */
const PROCEDURAL_SIZE = 256;

// -----------------------------------------------------------------------------
// Procedural tileable textures (fallback until the baked sets load)
// -----------------------------------------------------------------------------

export function makeRng(seed) {
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
export function makeFbm(seed, basePeriod, octaves, gain = 0.5) {
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
  ['detail', (n) => n === 'detail'],
  ['decals', (n) => n === 'decals'],
  ['rubble', (n) => n === 'rubble'],
  ['roots', (n) => n === 'roots'],
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

// KTX2 (Basis Universal, GPU-compressed): the renderer hands itself over once (Renderer3D → configureTextureLoading); the
// loader is created lazily, so a missing transcoder / Worker / WebAssembly never breaks anything: the JPEG sets load instead.
let _ktxRenderer = null;
let _ktxLoader = null; // KTX2Loader | false (tried and unavailable)
export function configureTextureLoading(opts = {}) {
  if (opts.renderer) _ktxRenderer = opts.renderer;
}
const KTX2_BASIS_PATH = (() => {
  try {
    return new URL('../../vendor/three/addons/libs/basis/', import.meta.url).href;
  } catch {
    return null;
  }
})();
async function getKTX2Loader() {
  if (_ktxLoader !== null) return _ktxLoader || null;
  _ktxLoader = false;
  try {
    if (!_ktxRenderer || !KTX2_BASIS_PATH || typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return null;
    const mod = await import('three/addons/loaders/KTX2Loader.js');
    const l = new mod.KTX2Loader();
    l.setTranscoderPath(KTX2_BASIS_PATH);
    l.setWorkerLimit(2);
    l.detectSupport(_ktxRenderer);
    _ktxLoader = l;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[AT3D] KTX2 unavailable, using JPEG textures', err && err.message);
  }
  return _ktxLoader || null;
}
function releaseKTX2Loader() {
  if (_ktxLoader && typeof _ktxLoader.dispose === 'function') {
    try {
      _ktxLoader.dispose(); // ends the transcoder workers (their WASM heaps are several MB each)
    } catch {
      /* nothing */
    }
  }
  _ktxLoader = null; // a later call (a restart with another manifest) builds a fresh one
}

/**
 * Loads assets/textures/manifest.json style sets.
 * Each entry: { albedo, normal, orm, tileMeters, [heightM], [ktx2: { albedo, normal, orm, normalHeightInB }] }. When the
 * entry has a `ktx2` block and the browser can run the Basis transcoder, the GPU-compressed files are used (UASTC / ETC1S
 * -> ASTC / ETC2 / BC7 on the device, full mip chains, the normal map's blue channel carries the height field for parallax);
 * otherwise (or if any of the three fails) the JPEG fallbacks load.
 * @param {string|object} manifestOrUrl  URL of the manifest or the parsed JSON
 * @param {string} [baseUrl]  base for relative paths (defaults to the manifest's folder)
 * @returns {Promise<object|null>} { rock, masonry, metal, distant, flesh, rubble, roots, detail } (each {map, normalMap, ormMap, tileMeters, heightM})
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
  if (base == null && typeof manifest.base === 'string') base = manifest.base; // game.js resolved manifest: { url, base, sets }
  if (base == null) base = 'assets/textures/';
  const sets = manifest.sets && typeof manifest.sets === 'object' ? manifest.sets : manifest;
  const loader = new THREE.TextureLoader();
  const abs = (rel) => (/^(https?:|data:|blob:|\/)/.test(rel) ? rel : base + rel);
  const setup = (tex, srgb, mips) => {
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (!mips) tex.generateMipmaps = true; // compressed textures ship their own mip chain
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  };
  const load = (rel, srgb) =>
    new Promise((resolve) => {
      if (!rel) {
        resolve(null);
        return;
      }
      loader.load(abs(rel), (tex) => resolve(setup(tex, srgb, false)), undefined, () => resolve(null));
    });
  const loadK = (ktx, rel, srgb) =>
    new Promise((resolve) => {
      if (!rel) {
        resolve(null);
        return;
      }
      ktx.load(abs(rel), (tex) => resolve(setup(tex, srgb, true)), undefined, () => resolve(null));
    });

  const names = Object.keys(sets).filter((k) => sets[k] && typeof sets[k] === 'object');
  const wantsKtx = names.some((n) => sets[n].ktx2 && typeof sets[n].ktx2 === 'object');
  const ktx = wantsKtx ? await getKTX2Loader() : null;
  const dispose = (list) => {
    for (const t of list) if (t && t.dispose) t.dispose();
  };

  const result = {};
  const assigned = new Set();
  for (const [role, test] of ROLE_MATCH) {
    const name = names.find((n) => !assigned.has(n) && (n.toLowerCase() === role || test(n.toLowerCase())));
    if (!name) continue;
    assigned.add(name);
    const s = sets[name];
    const tile = Number(s.tileMeters || s.tile || s.size || DEFAULT_TILE);
    const tileMeters = isFinite(tile) && tile > 0 ? tile : DEFAULT_TILE;
    const k = s.ktx2 && typeof s.ktx2 === 'object' ? s.ktx2 : null;
    if (role === 'detail') {
      let n = ktx && k && k.normal ? await loadK(ktx, k.normal, false) : null;
      if (!n) n = await load(pickKey(s, ['normal', 'normalGL', 'nor_gl', 'nrm', 'normalMap']), false);
      if (n) result.detail = { normalMap: n, tileMeters };
      continue;
    }
    let map = null;
    let normalMap = null;
    let ormMap = null;
    let packed = false;
    if (ktx && k && k.albedo && (k.normal || role === 'decals')) {
      [map, normalMap, ormMap] = await Promise.all([loadK(ktx, k.albedo, true), loadK(ktx, k.normal, false), loadK(ktx, k.orm, false)]);
      if (map && (normalMap || !k.normal) && (ormMap || !k.orm)) {
        packed = !!k.normalHeightInB && Number(s.heightM) > 0;
      } else {
        dispose([map, normalMap, ormMap]);
        map = normalMap = ormMap = null;
      }
    }
    if (!map) {
      [map, normalMap, ormMap] = await Promise.all([
        load(pickKey(s, ['albedo', 'color', 'baseColor', 'diffuse', 'diff', 'map']), true),
        load(pickKey(s, ['normal', 'normalGL', 'nor_gl', 'nrm', 'normalMap']), false),
        load(pickKey(s, ['orm', 'arm', 'ORM', 'ormMap']), false),
      ]);
    }
    if (!map) continue;
    const mean = Number(s.meanLuma);
    result[role] = { map, normalMap, ormMap, tileMeters, mean: mean > 0 ? mean : undefined, heightM: packed ? Number(s.heightM) : 0, ktx2: packed || (!!ktx && !!k && map.isCompressedTexture === true), name };
  }
  if (wantsKtx) releaseKTX2Loader();
  return Object.keys(result).length ? result : null;
}

// -----------------------------------------------------------------------------
// Shader patches
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Lighting chunks: baked GI + procedural reflections + wet film (lit materials only)
// -----------------------------------------------------------------------------

/**
 * Lightmap plumbing (solids only: materials that define AT_LM and meshes with the per-instance attribute `iLm` = chart
 * table row + 1, 0 = none; see LevelView.setLightmapIndex). The unit-box faces map to the chart of their solid: the
 * vertex shader looks up the face's atlas rectangle in the chart table (uLMTab, 3 texels per face: rect, crop, layer)
 * and the varyings carry the atlas uv (linear over the face), the layer and the rectangle (to clamp the sample).
 * Face order and (s, t) axes: render/lightmapFormat.js.
 */
const LM_VERT_DECL = `#ifdef AT_LM
attribute float iLm;
uniform highp sampler2D uLMTab;
varying highp vec2 vLmUv;
flat varying highp float vLmLayer;
flat varying highp vec4 vLmRect;
#endif
`;
const LM_FRAG_VARY = `#ifdef AT_LM
varying highp vec2 vLmUv;
flat varying highp float vLmLayer;
flat varying highp vec4 vLmRect;
#endif
`;
const LM_VERT_BODY = `#ifdef AT_LM
  vLmLayer = - 1.0;
  vLmUv = vec2( 0.0 );
  vLmRect = vec4( 0.0 );
  if ( iLm > 0.5 ) {
    vec3 atLa = abs( normal );
    int atLf = 0;
    vec2 atLst = position.zy + 0.5;
    if ( atLa.x > 0.5 ) {
      atLf = normal.x > 0.0 ? 0 : 1;
    } else if ( atLa.y > 0.5 ) {
      atLf = normal.y > 0.0 ? 2 : 3;
      atLst = position.xz + 0.5;
    } else {
      atLf = normal.z > 0.0 ? 4 : 5;
      atLst = position.xy + 0.5;
    }
    ivec2 atLt = ivec2( atLf * 3, int( iLm + 0.5 ) - 1 );
    vec4 atLr = texelFetch( uLMTab, atLt, 0 );
    vec4 atLc = texelFetch( uLMTab, atLt + ivec2( 1, 0 ), 0 );
    float atLy = texelFetch( uLMTab, atLt + ivec2( 2, 0 ), 0 ).x;
    if ( atLy > - 0.5 ) {
      vLmUv = mix( atLr.xy, atLr.zw, ( atLst - atLc.xy ) / max( atLc.zw - atLc.xy, vec2( 1e-5 ) ) );
      vLmLayer = atLy;
      vLmRect = atLr;
    }
  }
#endif`;

const LOOK_FRAG_DECL = `uniform highp sampler3D uGI;
uniform vec4 uGIK;
uniform vec3 uGIMin;
uniform vec3 uGIInv;
uniform vec3 uGIWarm;
uniform vec3 uGICool;
uniform vec4 uEnvK;
uniform vec3 uLanternW;
uniform vec4 uLanternC;
uniform vec2 uLanternR;
uniform vec4 uProbeC;
uniform vec3 uProbeH;
uniform vec4 uPudK;
#ifdef AT_LM
uniform highp sampler2DArray uLM;
uniform vec4 uLMK;
uniform vec3 uLMLamp;
uniform vec2 uLMLan;
#endif
`;

/** Injected after envmap_physical_pars_fragment (needs envMap / textureCubeUV, which are declared there): see atIBLRadiance. */
const LOOK_ENV_FN = `#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
// Parallax-corrected environment fetch: the reflection ray from the world position is intersected with the section's shaft box
// (uProbeC / uProbeH) and the probe is read toward that hit point, as if the cube had been rendered at the box centre. A puddle at the
// shaft wall then reflects the far window from where it is, not as an infinitely distant sky. Same blur / mip selection as three's own.
vec3 atIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 wpos ) {
	vec3 rv = reflect( - viewDir, normal );
	rv = normalize( mix( rv, normal, roughness * roughness ) );
	rv = inverseTransformDirection( rv, viewMatrix );
	if ( uProbeC.w > 0.5 ) {
		vec3 inv = 1.0 / ( rv + vec3( 1e-5 ) * sign( rv + vec3( 1e-9 ) ) );
		vec3 lo = ( uProbeC.xyz - uProbeH - wpos ) * inv;
		vec3 hi = ( uProbeC.xyz + uProbeH - wpos ) * inv;
		vec3 far = max( lo, hi );
		float t = min( far.x, min( far.y, far.z ) );
		if ( t > 0.0 ) {
			vec3 corr = normalize( wpos + rv * t - uProbeC.xyz );
			rv = normalize( mix( corr, rv, clamp( roughness * 1.6, 0.0, 0.85 ) ) ); // rough surfaces blur the parallax away
		}
	}
	return textureCubeUV( envMap, envMapRotation * rv, roughness ).rgb * envMapIntensity;
}
#endif
`;

// -----------------------------------------------------------------------------
// Lantern shadow receiver (WP-SHADOWS)
// -----------------------------------------------------------------------------

/**
 * Declared in lights_pars_begin under AT_LSHADOW (defined per program by patchLanternShadow(), so every other program compiles to
 * exactly the stock code). The lantern is the point light with decay < 1.8 (the pooled lamps have 2): atLanternShadow() returns its
 * visibility 0..1 for the fragment, from the view-space position / normal / light position:
 *  - the point is moved off the surface along the geometric normal (normal-offset bias, scaled by the texel size at this distance and
 *    by the grazing angle) and a little toward the light (slope-scaled depth bias), then projected into the cached static map and the
 *    dynamic map; outside the cone, beyond the range or at the frustum edge the shadow fades back to 1 (the unshadowed lantern, as
 *    before this feature);
 *  - static: 4 hardware-compare (bilinear) taps on a rotated grid = a soft ~12-sample PCF; dynamic: 2 taps;
 *  - back-facing fragments (n.l <= 0) get nothing from the lantern anyway: no fetch.
 */
const LS_PARS = `
#ifdef AT_LSHADOW
uniform sampler2DShadow uLSMapS;
uniform sampler2DShadow uLSMapD;
uniform highp mat4 uLSMS;
uniform highp mat4 uLSMD;
uniform vec4 uLSK;
vec3 atLsRot( const in vec3 v ) {
	return ( vec4( v, 0.0 ) * viewMatrix ).xyz; // view -> world rotation (viewMatrix is a rigid transform)
}
float atLanternShadow( const in vec3 vpos, const in vec3 vnrm, const in vec3 vlp ) {
	if ( uLSK.x < 0.002 ) return 1.0;
	vec3 lv = vlp - vpos;
	float d = length( lv );
	float nl = dot( vnrm, lv ) / max( d, 1e-3 );
	if ( nl <= 0.02 ) return 1.0;
	float fr = 1.0 - smoothstep( 0.72, 1.0, d / uLSK.w );
	if ( fr <= 0.001 ) return 1.0;
	vec3 wn = atLsRot( vnrm );
	vec3 wl = atLsRot( lv ) / max( d, 1e-3 );
	vec3 wp = atLsRot( vpos ) + cameraPosition;
	float sinT = sqrt( max( 1.0 - nl * nl, 0.0 ) );
	float slope = min( sinT / max( nl, 0.15 ), 4.0 );
	float vis = 1.0;
	vec4 cs = uLSMS * vec4( wp + wn * ( d * uLSK.y * ( 1.0 + 1.5 * sinT ) ) + wl * ( d * uLSK.y * ( 0.5 + 1.1 * slope ) ), 1.0 );
	if ( cs.w > 0.0 ) {
		vec3 c = cs.xyz / cs.w;
		vec2 e = min( c.xy, 1.0 - c.xy );
		float f = smoothstep( 0.0, 0.06, min( e.x, e.y ) ) * step( c.z, 1.0 );
		if ( f > 0.001 ) {
			float t = 1.4 / float( textureSize( uLSMapS, 0 ).x );
			float s = texture( uLSMapS, vec3( c.xy + vec2( 0.5, 1.4 ) * t, c.z ) ) + texture( uLSMapS, vec3( c.xy + vec2( -1.4, 0.5 ) * t, c.z ) )
				+ texture( uLSMapS, vec3( c.xy + vec2( -0.5, -1.4 ) * t, c.z ) ) + texture( uLSMapS, vec3( c.xy + vec2( 1.4, -0.5 ) * t, c.z ) );
			vis = mix( 1.0, s * 0.25, f );
		}
	}
	vec4 cd = uLSMD * vec4( wp + wn * ( d * uLSK.z * ( 1.0 + 1.5 * sinT ) ) + wl * ( d * uLSK.z * ( 0.5 + 1.1 * slope ) ), 1.0 );
	if ( cd.w > 0.0 ) {
		vec3 c = cd.xyz / cd.w;
		vec2 e = min( c.xy, 1.0 - c.xy );
		float f = smoothstep( 0.0, 0.06, min( e.x, e.y ) ) * step( c.z, 1.0 );
		if ( f > 0.001 ) {
			float t = 1.2 / float( textureSize( uLSMapD, 0 ).x );
			float s = 0.5 * ( texture( uLSMapD, vec3( c.xy + vec2( 0.7, 0.7 ) * t, c.z ) ) + texture( uLSMapD, vec3( c.xy - vec2( 0.7, 0.7 ) * t, c.z ) ) );
			vis *= mix( 1.0, s, f );
		}
	}
	return mix( 1.0, vis, fr * uLSK.x );
}
#endif
`;

/**
 * Installs the lantern-shadow hooks into three's stock chunks (idempotent): the function above in lights_pars_begin, the visibility
 * variable at the top of lights_fragment_begin and the multiply on the lantern's direct light inside the point-light loop. Must run
 * before buildLightsBeginGI() reads the chunk. Returns false when this three build's chunks lack the expected anchors.
 */
function installLanternShadowChunks() {
  const SC = THREE.ShaderChunk;
  if (SC.lights_fragment_begin.includes('atLsVis')) return true;
  const mPoint = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
  if (!SC.lights_pars_begin || !SC.lights_fragment_begin.includes(mPoint)) return false;
  SC.lights_pars_begin = SC.lights_pars_begin + LS_PARS;
  SC.lights_fragment_begin =
    'float atLsVis = 1.0;\n' +
    SC.lights_fragment_begin.replace(
      mPoint,
      mPoint + '\n#ifdef AT_LSHADOW\n\t\tif ( pointLight.decay < 1.8 && dot( directLight.color, vec3( 1.0 ) ) > 0.002 ) { atLsVis = atLanternShadow( geometryPosition, nonPerturbedNormal, pointLight.position ); directLight.color *= atLsVis; }\n#endif',
    );
  return true;
}
const LS_CHUNKS_OK = installLanternShadowChunks();

/** Gives one program the lantern shadow: the define, the shared uniforms. Call from an onBeforeCompile on a lights_pars_begin material. */
export function patchLanternShadow(shader) {
  if (!LS_CHUNKS_OK) return;
  Object.assign(shader.uniforms, LSHADOW);
  shader.fragmentShader = '#define AT_LSHADOW\n' + shader.fragmentShader;
}

/**
 * Makes another module's MeshStandardMaterial / MeshPhysicalMaterial receive the lantern shadow: chains onto its onBeforeCompile
 * and program cache key (the earlier patch runs first). Idempotent; returns true when the material was newly attached (it then
 * recompiles once). userData.noShadowRecv opts a material out.
 */
export function attachLanternShadow(mat) {
  if (!LS_CHUNKS_OK || !mat || !mat.isMeshStandardMaterial || mat.userData.lsAttached || mat.userData.noShadowRecv) return false;
  mat.userData.lsAttached = true;
  const prev = mat.onBeforeCompile;
  const baseKey = String(mat.customProgramCacheKey());
  mat.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === 'function') prev.call(mat, shader, renderer);
    patchLanternShadow(shader);
  };
  mat.customProgramCacheKey = () => baseKey + '|at3d-ls';
  mat.needsUpdate = true;
  return true;
}

/**
 * three's lights_fragment_begin with the baked volume folded in (one trilinear fetch per fragment, branch-skipped when
 * the tier turns it off). The volume (RGBA8) holds R sqrt-encoded static bounce light (lamps, shaft fill), G its warmth
 * (0 cool .. 1 warm), B visibility of the shaft key, A ambient occlusion:
 *  - the hemisphere ambient is multiplied by the AO (dark crevices, corners, undersides),
 *  - the bounce is added as indirect irradiance (warm near lamps, cool under the shaft), colours from the theme,
 *  - the shaft key loses its light where it is blocked (no unshadowed sun under ledges).
 * Only static contributions are baked: the pooled dynamic lamps and the lantern still add their own direct light.
 * null when this three build's chunk does not have the expected anchors (the materials then keep stock lighting).
 */
function buildLightsBeginGI() {
  let c = THREE.ShaderChunk.lights_fragment_begin;
  const mDir = 'getDirectionalLightInfo( directionalLight, directLight );';
  const mTail = '#if defined( RE_IndirectSpecular )\n\tvec3 radiance = vec3( 0.0 );';
  if (!c || !c.includes(mDir) || !c.includes(mTail)) return null;
  c = c.replace(mDir, mDir + '\n\t\tdirectLight.color *= atKeyVis;');
  // lightmapped fragments: the pooled dynamic lamps (decay 2; the lantern keeps 1.6, lighting.js sets both) are baked
  // (the BRDF call itself is skipped there, not just zeroed: two of the three point lights and the key cost nothing)
  const mPoint = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
  const reDirect = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  const skipNext = (src, marker, cond) => {
    const i = src.indexOf(marker);
    const j = i < 0 ? -1 : src.indexOf(reDirect, i);
    return j < 0 ? src : src.slice(0, j) + `if ( ${cond} ) { ${reDirect} }` + src.slice(j + reDirect.length);
  };
  // the lantern's range was stretched (decay 1.6) to stand in for the missing ambient: on lightmapped surfaces, where the
  // baked light supplies the far field, it gets an extra distance falloff (d^-uLMLan.y) so it reads as a pool, not a wash
  if (c.includes(mPoint)) {
    c = c.replace(mPoint, mPoint + '\n#ifdef AT_LM\n\t\tif ( atLmOn > 0.5 && pointLight.decay <= 1.8 ) directLight.color *= clamp( uLMLan.x * pow( max( length( pointLight.position - geometryPosition ), 1.0 ), - uLMLan.y ), 0.0, 1.0 );\n#endif');
  }
  c = skipNext(c, mPoint, '! ( atLmOn > 0.5 && pointLight.decay > 1.8 )');
  c = skipNext(c, mDir, 'atLmOn < 0.5');
  c = c.replace(
    mTail,
    `#if defined( RE_IndirectDiffuse )
	if ( atLmOn > 0.5 ) {
		irradiance = atLmE;
	} else {
		irradiance *= mix( 1.0, atGv.a, uGIK.y );
		iblIrradiance += atBounce;
	}
#endif
` + mTail,
  );
  return `
vec4 atGv = vec4( 1.0, 0.0, 1.0, 1.0 );
float atKeyVis = 1.0;
vec3 atBounce = vec3( 0.0 );
float atLmOn = 0.0;
vec3 atLmE = vec3( 0.0 );
#ifdef AT_LM
if ( uLMK.x > 0.5 && vLmLayer > - 0.5 ) {
	// baked lightmap: ONE fetch (rgb static irradiance, a flame-lamp direct light); replaces the hemisphere ambient, the
	// shaft key and the volume for this fragment. The lantern still adds its own direct light below.
	vec2 atLu = clamp( vLmUv, vLmRect.xy + 0.0005, vLmRect.zw - 0.0005 );
	vec4 atLm = texture( uLM, vec3( atLu, vLmLayer ) );
	vec3 atLs = atLm.rgb * atLm.rgb * ${LM_RANGE_STATIC.toFixed(1)};
	float atLl = atLm.a * atLm.a * ${LM_RANGE_LAMP.toFixed(1)} * uLMK.z;
	atLmE = ( atLs + uLMLamp * atLl ) * uLMK.y + vec3( uLMK.w );
	// relief under baked light: the flat irradiance is tilted with the perturbed normal's "up" (what the hemisphere fill did)
	atLmE *= clamp( 1.0 + 0.85 * dot( normal - nonPerturbedNormal, viewMatrix[ 1 ].xyz ), 0.3, 1.8 );
	atLmOn = 1.0;
	atKeyVis = 0.0;
	atGv.a = clamp( 0.3 + 0.7 * sqrt( dot( atLs, vec3( 0.3333 ) ) * uLMK.y ), 0.0, 1.0 );
} else
#endif
if ( uGIK.x > 0.5 ) {
	vec3 atGq = ( vAtW + inverseTransformDirection( nonPerturbedNormal, viewMatrix ) * 0.8 - uGIMin ) * uGIInv;
	vec3 atGd = abs( atGq - 0.5 );
	float atGin = 1.0 - smoothstep( 0.46, 0.5, max( atGd.x, max( atGd.y, atGd.z ) ) );
	atGv = mix( vec4( 0.0, 0.5, 1.0, 1.0 ), texture( uGI, atGq.xzy ), atGin );
	atKeyVis = mix( 1.0, atGv.b, uGIK.w );
	atBounce = ( atGv.r * atGv.r * 2.0 * uGIK.z ) * mix( uGICool, uGIWarm, atGv.g );
}
` + c;
}
const LIGHTS_BEGIN_GI = buildLightsBeginGI();

/**
 * Specular side of the look, replacing lights_fragment_maps on lit materials:
 *  - environment reflection from the shared procedural probe (PMREM, envProbe.js): scaled by the tier, by the surface's
 *    wetness (a wet film reflects several times more, and flattens the normal it sees), by the baked occlusion
 *    (no sky in crevices); Fresnel and roughness blur come from three's own IBL terms; the diffuse IBL term is gone
 *    (ambient is the hemisphere + baked volume);
 *  - the wet film glint of the lantern: one smooth GGX lobe (F0 0.04, roughness ~0.22) on the unperturbed normal,
 *    i.e. a clear coat without MeshPhysicalMaterial.
 */
const LIGHTS_MAPS_LIT = `
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	if ( uEnvK.x * envMapIntensity > 0.0005 ) {
		vec3 atEn = normalize( mix( normal, nonPerturbedNormal, atWet * uEnvK.z ) );
		#ifdef ENVMAP_TYPE_CUBE_UV
		radiance += atIBLRadiance( geometryViewDir, atEn, material.roughness, vAtW ) * ( uEnvK.x * ( 1.0 + atWet * uEnvK.y + atPud * uPudK.w ) * mix( 1.0, atGv.a, uGIK.y ) );
		#else
		radiance += getIBLRadiance( geometryViewDir, atEn, material.roughness ) * ( uEnvK.x * ( 1.0 + atWet * uEnvK.y ) * mix( 1.0, atGv.a, uGIK.y ) );
		#endif
	}
#endif
if ( uLanternC.a > 0.001 && atWet > 0.03 ) {
	vec3 atLv = ( viewMatrix * vec4( uLanternW, 1.0 ) ).xyz - geometryPosition;
	float atLd = length( atLv );
	vec3 atLl = atLv / max( atLd, 1e-3 );
	float atNL = saturate( dot( nonPerturbedNormal, atLl ) );
	if ( atNL > 0.0 ) {
		vec3 atH = normalize( atLl + geometryViewDir );
		float atNH = saturate( dot( nonPerturbedNormal, atH ) );
		float atNV = saturate( dot( nonPerturbedNormal, geometryViewDir ) );
		float atVH = saturate( dot( geometryViewDir, atH ) );
		float atAl = pow2( 0.22 + geometryRoughness ); // 0.0484 on flat stone, wider where the surface is curved or far (no crawling pinpoint)
		float atSp = D_GGX( atAl, atNH ) * V_GGX_SmithCorrelated( atAl, atNL, atNV ) * F_Schlick( vec3( 0.04 ), 1.0, atVH ).x;
		atSp = 4.0 * atSp / ( 4.0 + atSp ); // soft shoulder: the hand-held glint never blows out to a white dot
		float atAt = pow2( saturate( 1.0 - pow4( atLd / uLanternR.x ) ) ) / max( pow( atLd, uLanternR.y ), 0.01 );
		reflectedLight.directSpecular += uLanternC.rgb * ( atAt * atNL * atSp * uLanternC.a * atWet${LS_CHUNKS_OK ? ' * atLsVis' : ''} );
	}
}
`;
const LIGHTS_MAPS_LIT_NOGI = 'vec4 atGv = vec4( 1.0, 0.0, 1.0, 1.0 );\n' + LIGHTS_MAPS_LIT;

/**
 * Stock lights_fragment_maps with two changes for materials that carry the shared probe (define AT_LOOK_ENV, set by
 * applyLookTo): no diffuse IBL term (ambient is the hemisphere + baked GI; the probe is for reflections only) and a
 * uniform branch that skips the fetch when the tier / envMapIntensity is 0. Materials with their own environment (the
 * arms' gear map) keep the stock behaviour.
 */
const LIGHTS_MAPS_LOOK = `#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV ) && ! defined( AT_LOOK_ENV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef AT_LOOK_ENV
	if ( envMapIntensity > 0.0005 ) {
	#endif
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
	#ifdef AT_LOOK_ENV
	}
	#endif
#endif
`;

/** Installs the lights_fragment_maps variant (idempotent). Called by installRadialFog(). */
export function installLookChunks() {
  if (THREE.ShaderChunk.lights_fragment_maps !== LIGHTS_MAPS_LOOK && /getIBLIrradiance/.test(THREE.ShaderChunk.lights_fragment_maps)) {
    THREE.ShaderChunk.lights_fragment_maps = LIGHTS_MAPS_LOOK;
  }
}

// -----------------------------------------------------------------------------
// Surface detail chunks (WP-GFX-QUEST-MAT): parallax offset, detail normal, packed-height normal, crevice blending, grade
// -----------------------------------------------------------------------------

const HQ_FRAG_DECL = `uniform sampler2D uDetailMap;
uniform float uDetailScale;
uniform float uDetailAmt;
uniform float uHeightM;
uniform float uTexScale;
uniform vec4 uDetailK;
uniform vec4 uParallaxK;
uniform vec4 uParallaxS;
uniform vec4 uCrevK;
`;

/**
 * Runs at the top of the colour pipeline (before map_fragment). Everything the surface samples afterwards goes through
 * atPUv: the box / metric UV, shifted by ONE parallax tap on near surfaces (uHeightM > 0 means the normal map's blue
 * channel holds the height field, see tools/abyssal-tether-3d/build_textures_hq.py): offset limiting, single step, no
 * silhouette; the tangent frame is the same screen-derivative frame three.js uses for normal maps, so box-mapped
 * faces (UV swaps per face) and metric decor UVs need no tangents. Beyond uParallaxK.y metres it is skipped.
 * atHN is the height (0..1) at the shifted UV (0.5 when the set has none), atDt the shared detail texel (RG normal, B grain).
 */
const HQ_PARALLAX = `vec2 atPUv = vAtUv;
float atHN = 0.5;
vec4 atDt = vec4( 0.5, 0.5, 0.5, 1.0 );
float atDist = length( vViewPosition );
// VR: fine relief shimmers at grazing angles and at distance (the eyes move constantly); fade it with both
float atNv = abs( dot( normalize( vNormal ), vViewPosition ) ) / max( atDist, 1e-3 );
float atDf = uDetailAmt * uDetailK.x * ( 1.0 - smoothstep( uDetailK.y, uDetailK.z, atDist ) ) * smoothstep( 0.06, 0.34, atNv );
vec2 atGx = dFdx( vAtUv );
vec2 atGy = dFdy( vAtUv );
#ifdef USE_NORMALMAP
if ( uHeightM > 0.0 ) {
	float atPf = uParallaxK.x * ( 1.0 - smoothstep( uParallaxK.y - uParallaxK.z, uParallaxK.y, atDist ) ) * smoothstep( 0.16, 0.5, atNv );
	if ( atPf > 0.001 ) {
		mat3 atTbn = getTangentFrame( - vViewPosition, normalize( vNormal ), vAtUv );
		vec3 atV = normalize( vViewPosition );
		vec2 atVt = vec2( dot( atV, atTbn[ 0 ] ), dot( atV, atTbn[ 1 ] ) );
		float atVz = max( dot( atV, atTbn[ 2 ] ), 0.3 );
		// full-depth uv offset of the height field along the view ray (clamped by atVz >= 0.3, faded at grazing angles by atPf)
		vec2 atOff = atVt / atVz * ( uHeightM * uParallaxK.w * atPf * uTexScale );
		if ( vAtTop > 0.7 && uParallaxS.x > 1.5 && atDist < uParallaxS.y ) {
			// FLOORS: steep parallax. The ray enters at the top of the height field (h = 1) and descends N layers; the first layer under
			// the surface ends the march and the last two samples are linearly interpolated (the refine, no extra fetch). N falls with
			// distance (to 2 over uParallaxS.z) and at grazing angles. The height is read from a blurred level (x2 gradients) so the
			// fine grain of the packed field never makes the layers step noisily. Same sign convention as the 1-tap below: the surface
			// at height h shifts the uv by atOff * ( h - 0.5 ), i.e. the ray at layer L sits at vAtUv + atOff * ( L - 0.5 ).
			float atFd = 1.0 - smoothstep( uParallaxS.y - uParallaxS.z, uParallaxS.y, atDist );
			float atN = clamp( floor( uParallaxS.x * atFd * mix( 0.6, 1.0, smoothstep( 0.2, 0.6, atNv ) ) + 0.5 ), 2.0, uParallaxS.x );
			vec2 atG2x = atGx * 2.0;
			vec2 atG2y = atGy * 2.0;
			vec2 atStep = - atOff / atN;
			vec2 atUc = vAtUv + atOff * 0.5;
			float atLc = 1.0;
			float atHc = textureGrad( normalMap, atUc, atG2x, atG2y ).b;
			vec2 atUp = atUc;
			float atLp = atLc;
			float atHp = atHc;
			for ( int i = 0; i < 12; i ++ ) {
				if ( float( i ) >= atN || atHc >= atLc ) break;
				atUp = atUc;
				atLp = atLc;
				atHp = atHc;
				atUc += atStep;
				atLc -= 1.0 / atN;
				atHc = textureGrad( normalMap, atUc, atG2x, atG2y ).b;
			}
			float atDp = max( atLp - atHp, 0.0 );
			float atDc = max( atHc - atLc, 0.0 );
			float atW = atDp / max( atDp + atDc, 1e-4 );
			atPUv = mix( atUp, atUc, atW );
			atHN = mix( atHp, atHc, atW );
		} else {
			atHN = textureGrad( normalMap, vAtUv, atGx, atGy ).b;
			atPUv = vAtUv + atOff * ( atHN - 0.5 );
			atHN = textureGrad( normalMap, atPUv, atGx, atGy ).b;
		}
	} else {
		atHN = textureGrad( normalMap, vAtUv, atGx, atGy ).b;
	}
}
#endif
if ( atDf > 0.002 ) atDt = textureGrad( uDetailMap, atPUv * uDetailScale, atGx * uDetailScale, atGy * uDetailScale );
// near field (floor, ledge lip, wall within arm's reach at 1:1 scale): a second, finer octave of the same detail texture
// (VR-POLISH read 'crumpled foil' on the close floor: the octave is now half the amplitude, 2.4x instead of 3.7x the base frequency
// and gone by 2.2 m, so it reads as fine stone grain at arm's length and nothing beyond)
float atNear = uDetailK.w * ( 1.0 - smoothstep( 0.7, 2.2, atDist ) ) * smoothstep( 0.12, 0.45, atNv ) * uDetailAmt;
vec4 atDt2 = vec4( 0.5, 0.5, 0.5, 1.0 );
if ( atNear > 0.01 ) atDt2 = textureGrad( uDetailMap, atPUv * ( uDetailScale * 2.4 ) + vec2( 0.31, 0.77 ), atGx * ( uDetailScale * 2.4 ), atGy * ( uDetailScale * 2.4 ) );
#define vMapUv atPUv
#define vNormalMapUv atPUv
#define vAoMapUv atPUv
#define vRoughnessMapUv atPUv
#define vMetalnessMapUv atPUv
`;

/**
 * three's normal_fragment_maps with the tangent-space normal read as: xy from the texture, z rebuilt when the blue channel
 * carries height, then the shared detail normal layered over it (fades with distance). null when the chunk has other text
 * (a different three.js build): the materials then keep the stock normal path and the packed height is ignored.
 */
function buildHQNormalChunk() {
  const c = THREE.ShaderChunk.normal_fragment_maps;
  const stock = 'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;\n\tmapN.xy *= normalScale;\n\tnormal = normalize( tbn * mapN );';
  if (!c || !c.includes(stock)) return null;
  return c.replace(
    stock,
    `vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	if ( uHeightM > 0.0 ) mapN.z = sqrt( max( 1.0 - dot( mapN.xy, mapN.xy ), 0.05 ) );
	mapN.xy *= 1.0 - 0.45 * smoothstep( 22.0, 70.0, atDist );
	if ( atDf > 0.002 ) mapN.xy += ( atDt.xy * 2.0 - 1.0 ) * atDf;
	if ( atNear > 0.01 ) mapN.xy += ( atDt2.xy * 2.0 - 1.0 ) * ( 0.24 * atNear );
	normal = normalize( tbn * mapN );`,
  );
}
const HQ_NORMAL = buildHQNormalChunk();

/** Height-based blending, after the wetness is known: grime and moss settle in the low parts (joints, cracks, pits). */
const HQ_CREVICE = `  float atMossV = 0.0;
  {
    float atCav = 1.0 - smoothstep( 0.08, 0.5, atHN );
    float atAoV = 1.0;
    #ifdef USE_AOMAP
      atAoV = texture2D( aoMap, vAoMapUv ).r;
    #endif
    diffuseColor.rgb *= mix( 1.0, 0.82 + 0.36 * atDt.b, clamp( atDf * 1.4, 0.0, 1.0 ) );
    diffuseColor.rgb *= 1.0 - uCrevK.x * atCav * ( 0.35 + 0.65 * ( 1.0 - atAoV ) ) * 0.6;
    if ( atDist < 28.0 && atCav > 0.02 ) { // moss only where there is a crevice, and only near enough to read
      float atMn = textureGrad( uMacroMap, vAtUv * 0.37 + vec2( 0.7, 0.2 ), atGx * 0.37, atGy * 0.37 ).r;
      atMossV = clamp( atCav * smoothstep( 0.35, 0.8, atMn ) * ( 0.3 + 0.7 * smoothstep( 0.2, 0.9, vAtTop ) ) * uCrevK.y * ( 0.2 + uWet * 1.6 ) * ( 1.0 - smoothstep( 18.0, 28.0, atDist ) ), 0.0, 0.85 );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.04, 0.07, 0.03 ) * ( 0.6 + atMn ), atMossV );
    }
    atWet = max( atWet, atCav * uWet * uCrevK.z * ( 1.0 - atMossV ) );
  }
`;

/**
 * Specular anti-aliasing for normal-mapped surfaces (Kaplanyan / Tokuyoshi style roughness widening): the screen-space variance
 * of the normal-map-perturbed part of the normal (the shading normal minus the geometric one, so box edges are not counted twice:
 * three's own geometryRoughness already covers those) is added to the GGX alpha^2, so sub-pixel relief turns into a wider, dimmer
 * highlight instead of a crawling sparkle. Runs after lights_physical_fragment; ~15 ALU, no fetches.
 */
const SPEC_AA = `  {
    vec3 atDnx = dFdx( normal - nonPerturbedNormal );
    vec3 atDny = dFdy( normal - nonPerturbedNormal );
    float atVar = min( 0.159 * ( dot( atDnx, atDnx ) + dot( atDny, atDny ) ), 0.18 );
    float atA = material.roughness * material.roughness;
    material.roughness = sqrt( sqrt( atA * atA + atVar ) );
  }
`;

const GRADE_DECL = 'uniform vec4 uGradeK;\nuniform vec3 uGradeTint;\nuniform vec3 uBlack;\n';
/**
 * Filmic grade on the lit linear colour, before tone mapping: contrast about mid grey, saturation, extra desaturation with depth,
 * then (VR / LCD) a black-point lift and a soft knee on the highlights: the lantern's wet glints and hot pools roll off into the
 * tone mapper's shoulder instead of clipping to a white blob (the knee bounds the HDR input at ~5).
 */
const GRADE_FRAG = `  {
    vec3 atC = max( gl_FragColor.rgb, vec3( 0.0 ) );
    float atL = dot( atC, vec3( 0.2126, 0.7152, 0.0722 ) );
    float atSat = uGradeK.y * ( 1.0 - uGradeK.z * smoothstep( 0.0, - 300.0, vAtW.y ) );
    atC = mix( vec3( atL ), atC, atSat );
    atC = pow( atC * ( 1.0 / 0.18 ), vec3( uGradeK.x ) ) * 0.18;
    atC = atC * uGradeTint + uBlack;
    float atHi = max( atC.r, max( atC.g, atC.b ) );
    if ( atHi > 3.0 ) atC *= ( 3.0 + 2.0 * ( 1.0 - exp( 0.5 * ( 3.0 - atHi ) ) ) ) / atHi;
    gl_FragColor.rgb = atC;
  }`;

/**
 * Shader edge bevel for the unit-box solids (no geometry): the box-local position gives the distance to each edge of the face in
 * metres, and within uBevelK.y (3.5 cm) of an edge the shading normal rolls toward the neighbouring face (a rounded profile, the
 * strength squared of the distance to the edge), so every block catches a thin highlight on its lit edge and a shadow line on the
 * other. The band fades out when it is narrower than about a pixel (screen-space footprint of the distance, so it never shimmers at
 * range) and beyond uBevelK.z metres; uBevelK.x = 0 (the `low` tier / governor level >= 3) skips it. The tilt only touches the
 * view-space normal AFTER the lightmap's face / uv lookup (vertex stage) and the baked-light sample, which read the geometric
 * face, so lightmapped and volume-lit surfaces take it identically: the baked relief term (normal - nonPerturbedNormal tilted toward
 * "up") brightens upward-rolling edges and darkens downward ones, which is the intended edge light. The instanced solids are axis
 * aligned (scale + translation only), so box axes are world axes. The edge is also a hair lighter and glossier (worn corners).
 */
const BEVEL_FRAG = `
  float atBev = 0.0;
  {
    vec3 atBe = max( vAtBh - abs( vAtBp ), vec3( 0.0 ) ) + vAtFN * 1.0e3;
    vec3 atBw = min( vec3( uBevelK.y ), vAtBh * 0.9 );
    vec3 atBfw = fwidth( atBe );
    if ( uBevelK.x > 0.001 && dot( vViewPosition, vViewPosition ) < uBevelK.z * uBevelK.z ) {
      vec3 atBs = 1.0 - smoothstep( 0.45 * atBw, 1.1 * atBw, atBfw );
      vec3 atBk = ( 1.0 - clamp( atBe / atBw, 0.0, 1.0 ) ) * atBs;
      atBk *= atBk;
      vec3 atSg = sign( vAtBp );
      mat3 atV = mat3( viewMatrix );
      normal = normalize( normal + ( atV[ 0 ] * ( atSg.x * atBk.x ) + atV[ 1 ] * ( atSg.y * atBk.y ) + atV[ 2 ] * ( atSg.z * atBk.z ) ) * ( 1.1 * uBevelK.x ) );
      atBev = max( atBk.x, max( atBk.y, atBk.z ) ) * uBevelK.x;
    }
  }
  diffuseColor.rgb *= 1.0 + 0.1 * atBev;
  roughnessFactor *= 1.0 - 0.18 * atBev;
`;

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
    // surface detail (hq): shared detail normal texture, its repeat per material tile, per-material strength, and the
    // height range (m) of the set's packed height (0 = the set has none: no parallax, stock normal z)
    uDetailMap: { value: null },
    uDetailScale: { value: 8 },
    uDetailAmt: { value: 0 },
    uHeightM: { value: 0 },
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
  const aniso = lit && macro && opts.aniso ? opts.aniso : 0;
  const gi = lit && opts.gi !== false && LIGHTS_BEGIN_GI !== null;
  const hq = lit && !!uvMode && macro && !!opts.hq && HQ_NORMAL !== null;
  const grade = lit && !!opts.grade;
  const bevel = lit && uvMode === 'box' && !!opts.bevel;
  mat.userData.hq = hq;
  if (lit) mat.userData.lsAttached = true; // receives the lantern shadow through this patch
  mat.userData.hqDetail = opts.detail != null ? opts.detail : 1;
  const key = `at3d|hq:${hq ? 1 : 0}|gr:${grade ? 1 : 0}|uv:${uvMode}|ash:${ash ? 1 : 0}|crack:${crack ? 1 : 0}|macro:${macro ? 1 : 0}|bv:${bevel ? 1 : 0}|shapes:${shapes ? 1 : 0}|shaft:${shaft ? 1 : 0}|shade:${shade ? 1 : 0}|lit:${lit ? 1 : 0}|br:${breathe}|an:${aniso}|gi:${gi ? 1 : 0}|ls:${lit && LS_CHUNKS_OK ? 1 : 0}|fog:${fog}`;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    if (lit) Object.assign(shader.uniforms, LOOK);
    let vs = shader.vertexShader;
    let fs = shader.fragmentShader;
    let vDecl = '';
    let fDecl = '';
    if (lit && LS_CHUNKS_OK) {
      // the lantern's real-time shadow (render/lanternShadow.js): shared uniforms + the AT_LSHADOW define (see patchLanternShadow)
      Object.assign(shader.uniforms, LSHADOW);
      fs = '#define AT_LSHADOW\n' + fs;
    }

    if (uvMode) {
      vDecl += 'uniform float uTexScale;\nvarying float vAtTop;\nvarying vec2 vAtUv;\n';
      fDecl += 'varying float vAtTop;\nvarying vec2 vAtUv;\n';
      if (bevel) {
        // unit-box solids: the fragment's box-local position in metres, the box half extents and the face axis (see BEVEL_FRAG)
        vDecl += 'varying vec3 vAtBp;\nflat varying vec3 vAtBh;\nflat varying vec3 vAtFN;\n';
        fDecl += 'varying vec3 vAtBp;\nflat varying vec3 vAtBh;\nflat varying vec3 vAtFN;\nuniform vec4 uBevelK;\n';
      }
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
    atUv *= uTexScale;${
      bevel
        ? `
    vAtBp = position * atS;
    vAtBh = atS * 0.5;
    vAtFN = vec3( atN.x > 0.5 ? 1.0 : 0.0, atN.y > 0.5 ? 1.0 : 0.0, atN.z > 0.5 ? 1.0 : 0.0 );`
        : ''
    }`
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

    if (hq) {
      fDecl += HQ_FRAG_DECL;
      fs = fs.replace('#include <map_fragment>', HQ_PARALLAX + '#include <map_fragment>');
      fs = fs.replace('#include <normal_fragment_maps>', HQ_NORMAL);
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

    if (lit) {
      vDecl += 'varying vec3 vAtW;\n' + LM_VERT_DECL;
      fDecl += 'varying vec3 vAtW;\n' + LM_FRAG_VARY;
      vs = vs.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  {
    vec4 atWp4 = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      atWp4 = instanceMatrix * atWp4;
    #endif
    vAtW = ( modelMatrix * atWp4 ).xyz;
  }
${LM_VERT_BODY}`,
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
      fDecl += 'uniform vec3 uRimColor;\nuniform float uRim;\nuniform float uWet;\nuniform float uVG;\n' + LOOK_FRAG_DECL;
      if (fs.includes('#include <envmap_physical_pars_fragment>')) fs = fs.replace('#include <envmap_physical_pars_fragment>', '#include <envmap_physical_pars_fragment>\n' + LOOK_ENV_FN);
      const dry = uvMode ? 'smoothstep( 0.55, 0.95, vAtTop )' : '0.0';
      // porous stone darkens when wet; the water film drops roughness (sharp lantern glints)
      fs = fs.replace('#include <map_fragment>', `#include <map_fragment>
  float atWet = max( uWet * ${wetK.toFixed(3)}, ${wetMin.toFixed(3)} ) * ( 1.0 - ${dry} );
  float atPud = 0.0;
${
  macro
    ? `  {
    // floors and ledge tops are dusty, but in the wet sections water stands on them: a broad damp film that darkens the stone
    // and turns it glossy, and, where the macro noise rises above a wetness-driven level, real puddles (crisp edge, a mirror-flat
    // surface that reflects the probe with parallax correction, deepest where the relief dips; see uPudK). A darker damp ring
    // follows each puddle's edge.
    float atPn = texture2D( uMacroMap, vAtUv * 0.13 + vec2( 0.37, 0.11 ) ).r + 0.25 * ( texture2D( uMacroMap, vAtUv * 0.41 ).r - 0.5 );
    float atPw = clamp( uWet * ${wetK.toFixed(3)} * 1.7, 0.0, 1.0 );
    atWet = max( atWet, atPw * smoothstep( 0.4, 0.62, atPn ) * ${dry} );
    if ( uPudK.x > 0.001 && atPw > 0.12 ) {
      float atPl = 0.74 - 0.22 * atPw;
      atWet = max( atWet, 0.8 * smoothstep( atPl - 0.09, atPl, atPn ) * ${dry} * atPw );
      atPud = smoothstep( atPl, atPl + 0.07, atPn ) * ${dry} * uPudK.x;
${hq ? '      if ( uHeightM > 0.0 ) atPud *= 1.0 - 0.75 * smoothstep( 0.4, 0.62, atHN );\n' : ''}      atWet = max( atWet, atPud );
    }
  }`
    : ''
}
${hq ? HQ_CREVICE : ''}  diffuseColor.rgb *= 1.0 - ( 0.32 - 0.14 * ${dry} ) * atWet;
  diffuseColor.rgb *= 1.0 - uPudK.z * atPud;
  diffuseColor.rgb *= 1.0 + uVG * clamp( ( vAtW.y - cameraPosition.y ) * ( 1.0 / 24.0 ), - 1.0, 1.0 );`);
      fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
${
  hq
    ? `  roughnessFactor *= 0.9 + 0.2 * texture2D( uMacroMap, vAtUv * 0.083 + vec2( 0.31, 0.17 ) ).r;
  roughnessFactor = mix( roughnessFactor, 0.92, atMossV );
`
    : ''
}  roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.42 + 0.06, atWet );
  roughnessFactor = mix( roughnessFactor, uPudK.y, atPud );
  // VR: a mirror-sharp wet film sparkles in motion (every head tremor moves the glint across a pixel): floor the roughness
  // (standing water is flat, so its floor is lower: the probe reflection stays crisp but never a pinpoint)
  roughnessFactor = max( roughnessFactor, ( 0.14 - 0.08 * atPud ) * clamp( atWet * 3.0, 0.0, 1.0 ) );`);
      fs = fs.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' + SPEC_AA);
      // everything that reshapes the shading normal, in order, right after the normal map: brushed grain, mirror-flat puddles, box bevels
      const nrmAnchor = hq ? HQ_NORMAL : '#include <normal_fragment_maps>';
      let post = '';
      if (aniso > 0) {
        // Brushed-metal look without tangents or MeshPhysicalMaterial: a fine grain across the surface's v axis
        // tilts the normal along v, so the lantern's highlight stretches into a short streak across the grain.
        post += `
  {
    vec3 atQ0 = dFdx( - vViewPosition );
    vec3 atQ1 = dFdy( - vViewPosition );
    vec2 atS0 = dFdx( vAtUv );
    vec2 atS1 = dFdy( vAtUv );
    vec3 atB = cross( atQ1, normal ) * atS0.y + cross( normal, atQ0 ) * atS1.y;
    float atBl = dot( atB, atB );
    if ( atBl > 1e-12 ) {
      float atG = texture2D( uMacroMap, vAtUv * vec2( 1.7, 53.0 ) ).r + 0.5 * texture2D( uMacroMap, vAtUv * vec2( 4.1, 131.0 ) ).r - 0.75;
      normal = normalize( normal + atB * ( inversesqrt( atBl ) * atG * ${aniso.toFixed(3)} ) );
    }
  }`;
      }
      // standing water is flat: the stone's relief (and the detail normal) is flattened inside a puddle
      if (macro) post += '\n  normal = normalize( mix( normal, nonPerturbedNormal, atPud * 0.92 ) );';
      if (bevel) post += BEVEL_FRAG;
      if (post) fs = fs.replace(nrmAnchor, nrmAnchor + post);
      if (gi) {
        fs = fs.replace('#include <lights_fragment_begin>', LIGHTS_BEGIN_GI);
        fs = fs.replace('#include <lights_fragment_maps>', LIGHTS_MAPS_LIT);
      } else {
        fs = fs.replace('#include <lights_fragment_maps>', LIGHTS_MAPS_LIT_NOGI);
      }
      fs = fs.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  {
    float atRim = pow( 1.0 - clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 ), 3.0 );
    atRim *= 1.0 - 0.75 * clamp( dot( normalize( normal ), viewMatrix[ 1 ].xyz ), 0.0, 1.0 ); // floors keep their stone: the haze edge belongs to verticals
    totalEmissiveRadiance += uRimColor * ( atRim * uRim ) * ( 0.25 + diffuseColor.rgb );
    totalEmissiveRadiance += uRimColor * ( atPud * 0.1 ); // standing water carries the haze's colour even when it mirrors a dark wall
  }`,
      );
    }

    if (grade) {
      fDecl += GRADE_DECL;
      fs = fs.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + GRADE_FRAG);
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
  installLookChunks();
  installDither();
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
    this.maxAniso = 8;
    try {
      if (renderer && renderer.capabilities) this.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 1);
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
    m.rock = this._std(S.rock, { envMapIntensity: 0.5 }, { uv: 'box', ash: 0.32, macro, role: 'rock', lit: true, hq: true, grade: true, bevel: true });
    m.masonry = this._std(S.masonry, { envMapIntensity: 0.5 }, { uv: 'box', ash: 0.38, macro, role: 'masonry', lit: true, hq: true, grade: true, bevel: true });
    // Crumbling ledges read differently by PATTERN (dense dark cracks) and value (paler, dusty), not hue alone.
    m.crumble = this._std(S.masonry, { color: 0xf0e2c8, envMapIntensity: 0.4 }, { uv: 'box', ash: 0.55, crack: S.crack && S.crack.map, crackScale: 1 / 1.6, macro, role: 'masonry', lit: true, hq: true, grade: true, bevel: true });
    m.metal = this._std(S.metal, { envMapIntensity: 1.25 }, { uv: 'box', ash: 0.22, macro, role: 'metal', lit: true, wetK: 0.6, aniso: 0.4, hq: true, grade: true, detail: 0.6, bevel: true });
    m.grate = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: S.grate && S.grate.map,
      roughness: 0.6,
      metalness: 0.7,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    m.grate.envMapIntensity = 0.8;
    patchMaterial(m.grate, { uv: 'box', tile: 4 });
    // Merged decor + environment dressing (uv already in metres; vertex colour =
    // baked AO × the section grade).
    m.decorStone = this._std(S.masonry, { vertexColors: true, envMapIntensity: 0.5 }, { uv: 'metric', ash: 0.3, macro, role: 'masonry', lit: true, hq: true, grade: true });
    m.decorMetal = this._std(S.metal, { vertexColors: true, envMapIntensity: 1.2 }, { uv: 'metric', ash: 0.15, macro, role: 'metal', lit: true, wetK: 0.5, aniso: 0.3, hq: true, grade: true, detail: 0.6 });
    m.decorRock = this._std(S.distant || S.rock, { vertexColors: true, envMapIntensity: 0.45 }, { uv: 'metric', ash: 0.25, macro, role: 'distant', lit: true, hq: true, grade: true, detail: 0.5 });
    // Organic growth (the predator's sinew through the masonry): the flesh set's
    // relief, graded to a dark, MATTE bruise-brown (art bible: never wet red).
    m.decorFlesh = this._std(S.flesh || S.rock, { vertexColors: true, envMapIntensity: 0.8, color: S.flesh ? FLESH_GRADE : 0x3a2c28 }, { uv: 'metric', macro, role: 'flesh', lit: true, wetK: 1.4, wetMin: 0.45, breathe: 0.03, hq: true, grade: true, detail: 0.35 });
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
    m.mount = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.75, envMapIntensity: 0.9 });
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
    m.hazard = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.3, envMapIntensity: 0.5 });
    patchMaterial(m.hazard, { shapes: true, glowColor: 0x8a2c18 });
    // Colossal silhouettes: unlit, colour follows the fog, fog capped.
    m.colossal = new THREE.MeshBasicMaterial({ color: 0x0b0c0d, toneMapped: false });
    patchMaterial(m.colossal, { fog: 'cap', fogCap: 0.5, shade: true });
    m.plaque = this._std(S.masonry, { emissive: new THREE.Color(PALETTE.phos), emissiveIntensity: 0.0, envMapIntensity: 0.4 }, { uv: 'metric', role: 'masonry' });
    // Sky dome (Renderer3D): fully fogged, so it shows exactly the graded fog colour.
    m.sky = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, depthWrite: false, depthTest: false, toneMapped: true });
    // Decals (levelView): alpha-blended lit quads cut from the decal atlas; rgb = colour, a = coverage, vertex colour
    // (rgb tint, a strength). The atlas only exists as baked sets: nothing is drawn until it loads (LevelView checks .map).
    m.decal = this._std(null, { vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.92, metalness: 0, envMapIntensity: 0.25 }, { role: 'decals', lit: true, grade: true });
    m.decal.roughness = 0.92;
    m.decal.metalness = 0;
    // Shared reflection probe (render/lighting.js assigns the texture): the stock-chunk materials get AT_LOOK_ENV
    // (no diffuse IBL term, branch-skipped when the tier turns reflections off); the lit-patched ones carry their own chunk.
    for (const k of ['grate', 'mount', 'hazard', 'plaque']) m[k].defines = Object.assign({}, m[k].defines, { AT_LOOK_ENV: '' });
    // VR: every library material dithers its 8-bit output (interleaved gradient noise, vrShade.js): fog, sky, light shafts
    // and the dark lit gradients band badly on an LCD headset. Exact black stays black (additive shafts).
    for (const k of Object.keys(m)) m[k].dithering = true;
  }

  /** Hands the shared environment probe (a PMREM texture) to every standard material of the library. */
  setEnvironment(tex) {
    this._env = tex || null;
    for (const k of Object.keys(this.m)) {
      const mat = this.m[k];
      if (!mat.isMeshStandardMaterial || mat.envMap === this._env) continue;
      mat.envMap = this._env;
      mat.needsUpdate = true;
    }
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
    const det = sets.detail && sets.detail.normalMap ? sets.detail : null;
    for (const name of Object.keys(this.m)) {
      const mat = this.m[name];
      const role = mat.userData.setRole;
      if (!role) continue;
      const s = sets[role] || (role === 'distant' ? sets.rock : null);
      if (!s || !s.map) continue;
      if (mat.map !== s.map) changed = true;
      if (!mat.map || (mat.userData.setRole === 'decals' && !mat.normalMap && s.normalMap)) mat.needsUpdate = true; // a define appears (USE_MAP / USE_NORMALMAP)
      mat.map = s.map;
      if (role === 'flesh') mat.color.copy(mat.userData.matte ? FLESH_GRADE : _white);
      if (s.normalMap && (mat.normalMap || mat.userData.setRole === 'decals')) {
        if (mat.normalMap !== s.normalMap) changed = true;
        mat.normalMap = s.normalMap;
      }
      if (mat.aoMap && s.ormMap) {
        if (mat.aoMap !== s.ormMap) changed = true;
        mat.aoMap = s.ormMap;
        mat.roughnessMap = mat.userData.matte ? null : s.ormMap;
        mat.metalnessMap = s.ormMap;
      }
      const U = mat.userData.at;
      if (U) U.uTexScale.value = 1 / (s.tileMeters || DEFAULT_TILE);
      if (U && mat.userData.hq) {
        // packed height (normal.b) only when the set was loaded from KTX2; the JPEG fallbacks keep the stock normal
        U.uHeightM.value = mat.normalMap === s.normalMap ? s.heightM || 0 : 0;
        if (det) {
          U.uDetailMap.value = det.normalMap;
          U.uDetailScale.value = (s.tileMeters || DEFAULT_TILE) / (det.tileMeters || 0.5);
          U.uDetailAmt.value = mat.userData.hqDetail;
        }
      }
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
