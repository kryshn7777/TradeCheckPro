/* ABYSSAL TETHER 3D — sceneDetailPlan.js
 * The placement of the scene dressing (render/sceneDetail.js draws it): a seeded, RENDER-ONLY scatter over the level's solids,
 * decor, anchors and lamps. Pure data in / typed arrays out, no three.js, no DOM, never touches the simulation (it only reads the
 * level): Node-testable, deterministic for a given (level, seed).
 *
 * Authored composition, not noise:
 *  - every solid is dressed by what it is: floors (rubble, bones, broken crates and planks, tools, paper, candle stubs, puddles
 *    with drips, fungus, slime), wall faces (rust streaks under metal, water streaks, mineral crust, moss and slime low down,
 *    banners, tags, roots and sinew), undersides (dust-crusted stalactites, chain and rope ends, roots, cobwebs in the corners);
 *    items hug the wall bases and the lips, a walkway's centre line stays clear;
 *  - each of the eight sections has its own mix (SECTION_MIX): dry and cloth-hung at the top, wet and slimy in the middle, bone,
 *    sinew and wax at the bottom;
 *  - statues get candles, lamps get soot, machinery gets dropped tools, pipes drip into puddles;
 *  - six authored vignettes per run (a dropped bag, a climber's camp, a candle shrine, a hand-scratched tally, a fallen scaffold,
 *    slumped remains), sites picked by the seed from the level's own ledges;
 *  - nothing that dangles or glows is placed near a grapple anchor (no prop may look like a hook or a ring), nothing near a
 *    checkpoint or a grip zone.
 *
 * Output: three flat arrays (strides below) plus stats. Each entry has a `rank` in [0, 1): the quality tier keeps the entries
 * with rank <= its density, so a lower tier is a subset of a higher one (vignettes have rank 0 and always stay).
 */

import { D, P, TAU, buildKit, hash32, mulberry32 } from './sceneDetailKit.js';

/** Item layout: x y z yaw tiltX tiltZ scale r g b phase rank template cat */
export const ITEM_STRIDE = 14;
/** Decal layout: x y z orient(0 wall, 1 floor, 2 ceiling) yaw roll w h cell r g b a glow rank seed */
export const DECAL_STRIDE = 16;
/** Puddle layout: x y z radiusX radiusZ dripPeriod dripPhase dripHeight seed rank */
export const PUDDLE_STRIDE = 10;

/** Per-section caps (memory and a ceiling on the work done in the window selection). */
export const PLAN_CAPS = { items: 1100, decals: 170, puddles: 26 };

export const CAT_NAMES = ['bone', 'stone', 'wood', 'tool', 'chain', 'rope', 'root', 'sinew', 'stal', 'cloth', 'web', 'camp', 'candle', 'fungus', 'paper'];

/**
 * What each section is made of (weights 0..1.2; density scales how many spots are tried). Wet lower middle: puddles, slime, roots;
 * the top: dust, cloth, rope; the deep: bone, sinew, wax.
 */
export const SECTION_MIX = [
  // S1 The Threshold: dry, lamp-lit, lived in
  { density: 0.85, bone: 0.15, rubble: 0.8, wood: 0.55, tool: 0.35, chain: 0.5, rope: 0.5, cloth: 0.95, paper: 0.7, web: 0.55, puddle: 0.1, slime: 0.03, rust: 0.4, streak: 0.2, mineral: 0.3, moss: 0.08, root: 0.03, sinew: 0, stal: 0.3, candle: 0.5, fungus: 0 },
  // S2 The Long Swing: a hall hung with chain
  { density: 0.9, bone: 0.2, rubble: 0.7, wood: 0.6, tool: 0.45, chain: 0.95, rope: 0.65, cloth: 0.75, paper: 0.5, web: 0.45, puddle: 0.25, slime: 0.1, rust: 0.55, streak: 0.3, mineral: 0.3, moss: 0.12, root: 0.08, sinew: 0, stal: 0.35, candle: 0.25, fungus: 0 },
  // S3 Broken Gallery: collapsed, rubble and broken timber
  { density: 1.0, bone: 0.3, rubble: 1.0, wood: 0.95, tool: 0.6, chain: 0.5, rope: 0.45, cloth: 0.4, paper: 0.4, web: 0.4, puddle: 0.35, slime: 0.2, rust: 0.55, streak: 0.35, mineral: 0.4, moss: 0.2, root: 0.12, sinew: 0, stal: 0.5, candle: 0.15, fungus: 0.05 },
  // S4 The Listening Vault: wax, paper, cobwebs
  { density: 0.9, bone: 0.45, rubble: 0.55, wood: 0.3, tool: 0.2, chain: 0.3, rope: 0.25, cloth: 0.6, paper: 0.8, web: 0.9, puddle: 0.25, slime: 0.15, rust: 0.3, streak: 0.2, mineral: 0.55, moss: 0.25, root: 0.12, sinew: 0.05, stal: 0.7, candle: 0.7, fungus: 0.1 },
  // S5 The Gullet Stair: wet, the first sinew
  { density: 1.0, bone: 0.55, rubble: 0.5, wood: 0.25, tool: 0.25, chain: 0.3, rope: 0.2, cloth: 0.2, paper: 0.2, web: 0.4, puddle: 0.6, slime: 0.6, rust: 0.35, streak: 0.6, mineral: 0.4, moss: 0.55, root: 0.5, sinew: 0.45, stal: 0.5, candle: 0.25, fungus: 0.35 },
  // S6 The Two Descents: the wettest, slime, roots, drips
  { density: 1.0, bone: 0.5, rubble: 0.5, wood: 0.3, tool: 0.3, chain: 0.3, rope: 0.15, cloth: 0.15, paper: 0.15, web: 0.35, puddle: 0.85, slime: 0.7, rust: 0.4, streak: 0.75, mineral: 0.4, moss: 0.6, root: 0.6, sinew: 0.5, stal: 0.5, candle: 0.15, fungus: 0.45 },
  // S7 The Hollow Nave: bone, sinew, big stalactites
  { density: 0.8, bone: 0.85, rubble: 0.4, wood: 0.1, tool: 0.1, chain: 0.15, rope: 0.1, cloth: 0.1, paper: 0.1, web: 0.3, puddle: 0.45, slime: 0.45, rust: 0.2, streak: 0.5, mineral: 0.45, moss: 0.4, root: 0.5, sinew: 0.85, stal: 0.75, candle: 0.45, fungus: 0.5 },
  // S8 The Last Throat: bone, sinew, wax drips, almost nothing made by hands
  { density: 0.9, bone: 1.0, rubble: 0.35, wood: 0.05, tool: 0.05, chain: 0.1, rope: 0.05, cloth: 0.05, paper: 0.05, web: 0.2, puddle: 0.5, slime: 0.55, rust: 0.15, streak: 0.55, mineral: 0.35, moss: 0.35, root: 0.65, sinew: 1.0, stal: 0.6, candle: 0.6, fungus: 0.55 },
];

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

let _kit = null;
/** The shared kit (built once per page / process). */
export function getKit() {
  if (!_kit) _kit = buildKit();
  return _kit;
}

function pick(rng, entries) {
  let tot = 0;
  for (let i = 0; i < entries.length; i += 2) tot += entries[i + 1];
  if (tot <= 0) return null;
  let r = rng() * tot;
  for (let i = 0; i < entries.length; i += 2) {
    r -= entries[i + 1];
    if (r <= 0) return entries[i];
  }
  return entries[entries.length - 2];
}

// -----------------------------------------------------------------------------
// Context: spatial questions over the level + the output collectors
// -----------------------------------------------------------------------------
class Ctx {
  constructor(level, seed, kit) {
    this.level = level;
    this.seed = seed >>> 0;
    this.kit = kit;
    this.nSec = Math.max(1, level.sections.length);
    this.scr = [];
    this.scr2 = [];
    this.items = [];
    this.decals = [];
    this.puddles = [];
    this.nItems = new Int32Array(this.nSec);
    this.nDecals = new Int32Array(this.nSec);
    this.nPuddles = new Int32Array(this.nSec);
    this.catCount = Object.create(null);
    this.vignettes = [];
    this.sites = [];
    this.rej = {};
    // route points: anchors, checkpoints, lamps (the dressing only goes where a player can come near)
    this.route = [];
    for (const a of level.anchors) this.route.push(a.x, a.y, a.z);
    for (const s of level.sections) if (s.checkpoint) this.route.push(s.checkpoint.x, s.checkpoint.y, s.checkpoint.z);
    for (const l of level.lights) this.route.push(l.x, l.y, l.z);
    this.cps = [];
    for (const s of level.sections) if (s.checkpoint) this.cps.push(s.checkpoint.x, s.checkpoint.y, s.checkpoint.z);
    if (level.spawn) this.cps.push(level.spawn.x, level.spawn.y, level.spawn.z);
    this.anch = [];
    for (const a of level.anchors) this.anch.push(a.x, a.y, a.z);
    this.climb = level.climb || [];
  }

  secOf(y) {
    return clamp(this.level.sectionIndexAt(y) | 0, 0, this.nSec - 1);
  }

  mix(si) {
    return SECTION_MIX[Math.min(si, SECTION_MIX.length - 1)];
  }

  /** No active solid overlaps the box (touching faces do not count). */
  free(x0, y0, z0, x1, y1, z1) {
    const e = 0.004;
    const L = this.level.querySolids(x0 + e, y0 + e, z0 + e, x1 - e, y1 - e, z1 - e, this.scr);
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      if (s.active === false || s.fallen || s.kind === 'crumble') continue;
      return false;
    }
    return true;
  }

  /** Distance up to the first solid underside above (x, y, z), or Infinity. */
  ceilAbove(x, y, z, maxRise) {
    const L = this.level.querySolids(x - 0.06, y + 0.03, z - 0.06, x + 0.06, y + maxRise, z + 0.06, this.scr);
    let best = Infinity;
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      if (s.active === false || s.fallen || s.kind === 'crumble') continue;
      if (s.minY >= y - 0.001 && s.minY - y < best) best = s.minY - y;
    }
    return best;
  }

  /** Top face height of the first solid below (x, y, z) within maxDrop, or null. */
  floorBelow(x, y, z, maxDrop) {
    const L = this.level.querySolids(x - 0.06, y - maxDrop, z - 0.06, x + 0.06, y, z + 0.06, this.scr);
    let best = null;
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      if (s.active === false || s.fallen || s.kind === 'crumble') continue;
      if (s.maxY <= y + 0.05 && (best === null || s.maxY > best)) best = s.maxY;
    }
    return best;
  }

  /** Distance from (x, y, z) to the nearest solid face in horizontal direction (dx, dz) within maxD, or Infinity. */
  wallFace(x, y, z, dx, dz, maxD) {
    const x0 = Math.min(x, x + dx * maxD) - 0.05;
    const x1 = Math.max(x, x + dx * maxD) + 0.05;
    const z0 = Math.min(z, z + dz * maxD) - 0.05;
    const z1 = Math.max(z, z + dz * maxD) + 0.05;
    const L = this.level.querySolids(x0, y - 0.1, z0, x1, y + 0.1, z1, this.scr);
    let best = Infinity;
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      if (s.active === false || s.fallen || s.kind === 'crumble') continue;
      let d = Infinity;
      if (dx > 0 && z >= s.minZ - 0.02 && z <= s.maxZ + 0.02 && s.minX >= x - 0.02) d = s.minX - x;
      else if (dx < 0 && z >= s.minZ - 0.02 && z <= s.maxZ + 0.02 && s.maxX <= x + 0.02) d = x - s.maxX;
      else if (dz > 0 && x >= s.minX - 0.02 && x <= s.maxX + 0.02 && s.minZ >= z - 0.02) d = s.minZ - z;
      else if (dz < 0 && x >= s.minX - 0.02 && x <= s.maxX + 0.02 && s.maxZ <= z + 0.02) d = z - s.maxZ;
      if (d < best) best = d;
    }
    return best <= maxD ? best : Infinity;
  }

  nearAnchor(x, y, z, r) {
    const a = this.anch;
    const r2 = r * r;
    for (let i = 0; i < a.length; i += 3) {
      const dx = a[i] - x;
      const dy = a[i + 1] - y;
      const dz = a[i + 2] - z;
      if (dx * dx + dy * dy + dz * dz < r2) return true;
    }
    return false;
  }

  nearCp(x, y, z, r) {
    const a = this.cps;
    const r2 = r * r;
    for (let i = 0; i < a.length; i += 3) {
      const dx = a[i] - x;
      const dy = a[i + 1] - y;
      const dz = a[i + 2] - z;
      if (dx * dx + dy * dy + dz * dz < r2) return true;
    }
    return false;
  }

  nearRoute(x, y, z, r) {
    const a = this.route;
    const r2 = r * r;
    for (let i = 0; i < a.length; i += 3) {
      const dx = a[i] - x;
      const dy = a[i + 1] - y;
      const dz = a[i + 2] - z;
      if (dx * dx + dy * dy + dz * dz < r2) return true;
    }
    return false;
  }

  nearClimb(x, y, z, r) {
    const L = this.climb;
    for (let i = 0; i < L.length; i++) {
      const c = L[i];
      if (x > c.minX - r && x < c.maxX + r && y > c.minY - r && y < c.maxY + r && z > c.minZ - r && z < c.maxZ + r) return true;
    }
    return false;
  }

  /** Adds a prop. o: yaw, tx, tz, s, tint, col [r,g,b], vig (authored: always drawn, no placement filters). Returns false when refused. */
  add(name, x, y, z, rng, o = {}) {
    const ti = this.kit.index[name];
    if (ti === undefined) return false;
    const t = this.kit.templates[ti];
    const si = this.secOf(y);
    if (!o.vig) {
      if (this.nItems[si] >= PLAN_CAPS.items) return false;
      if (t.hang || o.hangs) {
        if (this.nearAnchor(x, y, z, t.web ? 2.2 : t.cat === 'stal' ? 2.4 : 3.2)) return false;
        if (this.nearClimb(x, y, z, 0.9)) return false;
      } else if (this.nearAnchor(x, y, z, 1.0)) return false;
      if (t.lit && this.nearAnchor(x, y, z, 5.5)) return false;
    }
    const k = o.tint != null ? o.tint : 0.82 + 0.36 * rng();
    const c = o.col || [1, 1, 1];
    const yaw = o.yaw != null ? o.yaw : rng() * TAU;
    const ph = rng() * TAU;
    this.items.push(
      x, y, z, yaw, o.tx || 0, o.tz || 0, o.s != null ? o.s : 1,
      k * c[0] * (0.95 + 0.1 * rng()), k * c[1] * (0.95 + 0.1 * rng()), k * c[2] * (0.95 + 0.1 * rng()),
      ph, o.vig ? 0 : rng() * 0.999, ti, CAT_NAMES.indexOf(t.cat) < 0 ? 0 : CAT_NAMES.indexOf(t.cat),
    );
    this.nItems[si]++;
    this.catCount[t.cat] = (this.catCount[t.cat] || 0) + 1;
    return true;
  }

  /** Adds a decal quad. orient 0 wall (faces yaw), 1 floor, 2 ceiling. */
  decal(cell, orient, x, y, z, yaw, w, h, rgba, glow, rng, o = {}) {
    const si = this.secOf(y);
    if (!o.vig && this.nDecals[si] >= PLAN_CAPS.decals) return false;
    if (!o.vig && this.nearAnchor(x, y, z, 0.9)) return false;
    this.decals.push(
      x, y, z, orient, yaw, o.roll != null ? o.roll : 0, w, h, cell,
      rgba[0], rgba[1], rgba[2], rgba[3], glow || 0, o.vig ? 0 : rng() * 0.999, rng(),
    );
    this.nDecals[si]++;
    this.catCount['decal' + cell] = (this.catCount['decal' + cell] || 0) + 1;
    return true;
  }

  puddle(x, y, z, rx, rz, dripH, rng) {
    const si = this.secOf(y);
    if (this.nPuddles[si] >= PLAN_CAPS.puddles) return false;
    if (this.nearAnchor(x, y, z, 1.2)) return false;
    this.puddles.push(x, y, z, rx, rz, dripH > 0 ? 1.6 + rng() * 3.4 : 0, rng() * 6, dripH, rng(), rng() * 0.999);
    this.nPuddles[si]++;
    this.catCount.puddle = (this.catCount.puddle || 0) + 1;
    return true;
  }
}

const WARM = [1.0, 0.6, 0.26];

/** Wall decal helper: p is the point ON the wall, n the outward normal (horizontal). */
function wallDecal(C, cell, px, py, pz, nx, nz, w, h, rgba, rng, o = {}) {
  return C.decal(cell, 0, px + nx * 0.012, py, pz + nz * 0.012, Math.atan2(nx, nz), w, h, rgba, o.glow || 0, rng, o);
}

// -----------------------------------------------------------------------------
// Emitters (ground props)
// -----------------------------------------------------------------------------
function scatter(C, rng, x, y, z, spread, count, choose, o = {}) {
  for (let i = 0; i < count; i++) {
    const a = rng() * TAU;
    const r = Math.sqrt(rng()) * spread;
    const name = choose(rng);
    if (!name) continue;
    C.add(name, x + Math.cos(a) * r, y, z + Math.sin(a) * r, rng, Object.assign({ s: 0.7 + rng() * 0.8, tx: (rng() - 0.5) * 0.5, tz: (rng() - 0.5) * 0.5 }, o));
  }
}

const chooseChip = (rng) => {
  const r = rng();
  return r < 0.45 ? 'chipA' : r < 0.78 ? 'chipB' : r < 0.9 ? 'chipC' : r < 0.96 ? (rng() < 0.5 ? 'slabA' : 'slabB') : 'block';
};

function emitRubble(C, rng, x, y, z, base, mix) {
  const n = base ? 3 + ((rng() * 4) | 0) : 1 + ((rng() * 3) | 0);
  scatter(C, rng, x, y, z, 0.25 + rng() * 0.3 + (base ? 0.1 : 0), n, chooseChip);
  if (rng() < 0.12 * mix.rubble) C.add('block', x + (rng() - 0.5) * 0.5, y, z + (rng() - 0.5) * 0.5, rng, { s: 0.8 + rng() * 0.8 });
}

function emitBones(C, rng, x, y, z, mix) {
  const r = rng();
  if (r < 0.4) {
    C.add(rng() < 0.7 ? 'femur' : 'femurBroken', x, y, z, rng, { s: 0.9 + rng() * 0.2, col: [0.9, 0.9, 0.85] });
    if (rng() < 0.4) C.add('rib', x + (rng() - 0.5) * 0.4, y, z + (rng() - 0.5) * 0.4, rng);
  } else if (r < 0.8) {
    const n = 2 + ((rng() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const name = pick(rng, ['femur', 1, 'femurBroken', 0.7, 'rib', 1.4, 'vert', 1.0, 'hand', 0.6, 'jaw', 0.4]);
      C.add(name, x + (rng() - 0.5) * 0.7, y, z + (rng() - 0.5) * 0.7, rng, { s: 0.9 + rng() * 0.25, col: [0.95, 0.9, 0.85] });
    }
  } else {
    C.add('skull', x, y, z, rng, { s: 0.9 + rng() * 0.2, tx: (rng() - 0.5) * 0.3, tz: (rng() - 0.5) * 0.3 });
    const n = 1 + ((rng() * 3) | 0);
    for (let i = 0; i < n; i++) C.add(pick(rng, ['femur', 1, 'rib', 1.3, 'vert', 1, 'jaw', 0.6]), x + (rng() - 0.5) * 0.6, y, z + (rng() - 0.5) * 0.6, rng, { col: [0.95, 0.9, 0.85] });
  }
  void mix;
}

function emitWood(C, rng, x, y, z, ctx) {
  const r = rng();
  if (r < 0.46) {
    const n = 1 + ((rng() * 3) | 0);
    const a0 = rng() * TAU;
    for (let i = 0; i < n; i++) C.add(pick(rng, ['plankA', 1, 'plankB', 0.8, 'plankC', 0.6]), x + (rng() - 0.5) * 0.3, y + i * 0.03, z + (rng() - 0.5) * 0.3, rng, { yaw: a0 + (rng() - 0.5) * 1.6, tx: (rng() - 0.5) * 0.08, tz: (rng() - 0.5) * 0.08 });
    if (ctx.wall >= 0 && rng() < 0.45) {
      // one plank leaning on the wall
      const [dx, dz] = DIRS[ctx.wall];
      const d = Math.min(ctx.dw, 0.6);
      C.add('plankC', x + dx * (d - 0.06), y + 0.02, z + dz * (d - 0.06), rng, { yaw: Math.atan2(dx, dz) + Math.PI / 2 + (rng() - 0.5) * 0.4, tz: 0.0, tx: 0.0, s: 0.9 });
    }
  } else if (r < 0.66) C.add('crateSmash', x, y, z, rng);
  else if (r < 0.78) C.add('crateBroken', x, y, z, rng);
  else if (r < 0.9) C.add('barrel', x, y + 0.235, z, rng, { tz: Math.PI / 2, tx: 0, yaw: rng() * TAU });
  else C.add('barrel', x, y, z, rng);
  if (rng() < 0.5) scatter(C, rng, x, y, z, 0.5, 1 + ((rng() * 2) | 0), (q) => (q() < 0.5 ? 'plankB' : 'chipA'), { s: 0.8 });
}

function emitTool(C, rng, x, y, z) {
  const name = pick(rng, ['pickaxe', 1, 'crowbar', 1, 'hammer', 0.9, 'shovel', 0.8, 'bucket', 0.8, 'cup', 0.5]);
  if (name === 'bucket') C.add('bucket', x, rng() < 0.4 ? y + 0.12 : y, z, rng, rng() < 0.4 ? { tz: Math.PI / 2 } : {});
  else C.add(name, x, y, z, rng, { tz: (rng() - 0.5) * 0.04 });
}

function emitPaper(C, rng, x, y, z) {
  const n = 1 + ((rng() * 3) | 0);
  for (let i = 0; i < n; i++) C.add(pick(rng, ['paperA', 1, 'paperB', 1, 'paperCurl', 0.7]), x + (rng() - 0.5) * 0.5, y + 0.002 * i, z + (rng() - 0.5) * 0.5, rng, { col: [1, 0.95 + rng() * 0.1, 0.9] });
}

function emitCandle(C, rng, x, y, z) {
  const r = rng();
  let lit = false;
  if (r < 0.5) C.add('candle', x, y, z, rng);
  else if (r < 0.76) C.add('waxPool', x, y, z, rng);
  else if (r < 0.9) lit = C.add('candleCluster', x, y, z, rng);
  else lit = C.add('candleLit', x, y, z, rng);
  if (lit) C.decal(D.GLOW, 1, x, y + 0.01, z, rng() * TAU, 1.3, 1.3, [WARM[0], WARM[1], WARM[2], 0.55], 0.9, rng);
}

function emitPuddle(C, rng, x, y, z, fit, wet) {
  const r = Math.min(0.28 + rng() * 0.7 + wet * 0.2, fit + 0.1);
  if (r < 0.2) return;
  const rise = C.ceilAbove(x, y, z, 14);
  const dripH = rise < 14 && rng() < 0.45 + wet * 0.5 ? Math.min(rise, 10) - 0.2 : 0;
  C.puddle(x, y + 0.004, z, r, r * (0.6 + 0.4 * rng()), dripH, rng);
}

// -----------------------------------------------------------------------------
// Floors
// -----------------------------------------------------------------------------
const FLOOR_W = {
  open: { rubble: 3.0, bone: 1.5, wood: 1.3, tool: 0.7, paper: 0.9, cloth: 0.5, candle: 0.45, puddle: 1.6, fungus: 0.6, slime: 0.6, rope: 0.45, stal: 0.4, root: 0 },
  base: { rubble: 4.0, bone: 2.0, wood: 2.0, tool: 0.9, paper: 1.0, cloth: 0.7, candle: 0.6, puddle: 0.5, fungus: 1.2, slime: 1.2, rope: 0.5, stal: 0.4, root: 1.5 },
  lip: { rubble: 2.2, bone: 0.8, wood: 0.7, tool: 0.2, paper: 0.5, cloth: 0.7, candle: 0.2, puddle: 0.2, fungus: 0.2, slime: 0.3, rope: 0.2, stal: 0, root: 0 },
};

function floorContext(C, s, x, y, z) {
  const ctx = { wall: -1, dw: 9, lip: -1, dl: 9 };
  for (let k = 0; k < 4; k++) {
    const dx = DIRS[k][0];
    const dz = DIRS[k][1];
    const cx = x + dx * 0.5;
    const cz = z + dz * 0.5;
    if (ctx.wall < 0 && !C.free(cx - 0.1, y + 0.3, cz - 0.1, cx + 0.1, y + 0.9, cz + 0.1)) {
      const d = C.wallFace(x, y + 0.6, z, dx, dz, 0.7);
      if (d < 0.7) {
        ctx.wall = k;
        ctx.dw = d;
      }
    }
    if (ctx.lip < 0) {
      const ex = x + dx * 0.55;
      const ez = z + dz * 0.55;
      if (C.free(ex - 0.1, y - 0.7, ez - 0.1, ex + 0.1, y - 0.08, ez + 0.1)) {
        ctx.lip = k;
        ctx.dl = dx > 0 ? s.maxX - x : dx < 0 ? x - s.minX : dz > 0 ? s.maxZ - z : z - s.minZ;
      }
    }
  }
  return ctx;
}

function dressFloor(C, s, si, rng) {
  const w = s.maxX - s.minX;
  const d = s.maxZ - s.minZ;
  const area = w * d;
  if (area < 1.2 || Math.min(w, d) < 0.6) return;
  const mix = C.mix(si);
  const narrow = Math.min(w, d) < 3.2;
  const n = Math.round(clamp(area * 0.7, 3, 60) * mix.density);
  const y = s.maxY;
  const wet = mix.puddle;
  let placed = 0;
  for (let k = 0; k < n && placed < 70; k++) {
    let x;
    let z;
    if (rng() < 0.42) {
      const side = (rng() * 4) | 0;
      const off = 0.14 + rng() * 0.6;
      const t = rng();
      if (side === 0) x = s.maxX - off;
      else if (side === 1) x = s.minX + off;
      else x = s.minX + 0.14 + t * (w - 0.28);
      if (side === 2) z = s.maxZ - off;
      else if (side === 3) z = s.minZ + off;
      else z = s.minZ + 0.14 + rng() * (d - 0.28);
    } else {
      x = s.minX + 0.22 + rng() * Math.max(0, w - 0.44);
      z = s.minZ + 0.22 + rng() * Math.max(0, d - 0.44);
    }
    x = clamp(x, s.minX + 0.1, s.maxX - 0.1);
    z = clamp(z, s.minZ + 0.1, s.maxZ - 0.1);
    if (!C.free(x - 0.12, y + 0.06, z - 0.12, x + 0.12, y + 1.6, z + 0.12)) continue;
    if (!C.nearRoute(x, y, z, 26)) continue;
    if (C.nearCp(x, y, z, 1.4)) continue;
    const fit = Math.min(x - s.minX, s.maxX - x, z - s.minZ, s.maxZ - z);
    // a walkway's centre line stays clear: on narrow ledges only the flat and the small things sit in the middle
    const centred = narrow && fit > Math.min(w, d) * 0.3;
    const ctx = floorContext(C, s, x, y, z);
    const kind = ctx.wall >= 0 ? 'base' : ctx.lip >= 0 ? 'lip' : 'open';
    const W = FLOOR_W[kind];
    const cat = pick(rng, [
      'rubble', W.rubble * mix.rubble,
      'bone', W.bone * mix.bone,
      'wood', W.wood * mix.wood * (centred ? 0.2 : 1) * (fit < 0.5 ? 0.3 : 1),
      'tool', W.tool * mix.tool * (centred ? 0.3 : 1),
      'paper', W.paper * mix.paper,
      'cloth', W.cloth * mix.cloth,
      'candle', W.candle * mix.candle,
      'puddle', W.puddle * mix.puddle * (fit < 0.4 ? 0.3 : 1),
      'fungus', W.fungus * mix.fungus,
      'slime', W.slime * mix.slime,
      'rope', W.rope * mix.rope * (centred ? 0.3 : 1),
      'stal', W.stal * mix.stal,
      'root', W.root * mix.root,
    ]);
    if (!cat) continue;
    placed++;
    switch (cat) {
      case 'rubble':
        emitRubble(C, rng, x, y, z, kind === 'base', mix);
        break;
      case 'bone':
        emitBones(C, rng, x, y, z, mix);
        break;
      case 'wood':
        emitWood(C, rng, x, y, z, ctx);
        break;
      case 'tool':
        emitTool(C, rng, x, y, z);
        break;
      case 'paper':
        emitPaper(C, rng, x, y, z);
        break;
      case 'cloth':
        C.add('ragFloor', x, y, z, rng, { col: [1, 0.9 + rng() * 0.2, 0.85] });
        break;
      case 'candle':
        emitCandle(C, rng, x, y, z);
        break;
      case 'puddle':
        emitPuddle(C, rng, x, y, z, fit, wet);
        break;
      case 'fungus':
        C.add('fungus', x, y, z, rng, { s: 0.8 + rng() * 0.6 });
        break;
      case 'slime':
        C.decal(D.SLIME, 1, x, y + 0.006, z, rng() * TAU, 0.6 + rng() * 0.8, 0.5 + rng() * 0.7, [0.6, 0.85, 0.6, 0.55 + rng() * 0.3], 0, rng, { roll: rng() * TAU });
        break;
      case 'rope':
        C.add('ropeCoil', x, y, z, rng, { s: 0.8 + rng() * 0.4 });
        break;
      case 'stal': // a stalagmite: the stalactite upside down
        C.add(pick(rng, ['stalA', 1, 'stalC', 1.4, 'stalB', 0.5]), x, y, z, rng, { tx: Math.PI, s: 0.8 + rng() * 0.6, hangs: false });
        break;
      case 'root': // a root climbing the wall from the floor
        if (ctx.wall >= 0) {
          const [dx, dz] = DIRS[ctx.wall];
          C.add(rng() < mix.sinew / (mix.root + mix.sinew + 0.01) ? 'sinewHang' : 'rootHang', x + dx * (ctx.dw - 0.05), y, z + dz * (ctx.dw - 0.05), rng, { tx: Math.PI, yaw: Math.atan2(-dx, -dz) + (rng() - 0.5), s: 0.9 + rng() * 0.8 });
        }
        break;
      default:
        break;
    }
    // the wall behind a floor spot: damp, moss, slime
    if (ctx.wall >= 0 && rng() < 0.16 + 0.5 * Math.max(mix.moss, mix.slime)) {
      const [dx, dz] = DIRS[ctx.wall];
      const px = x + dx * ctx.dw;
      const pz = z + dz * ctx.dw;
      const moss = rng() < mix.moss / (mix.moss + mix.slime + 0.05);
      const hh = 0.5 + rng() * 0.9;
      wallDecal(C, moss ? D.MOSS : D.SLIME, px, y + hh * 0.45, pz, -dx, -dz, 0.6 + rng() * 1.0, hh, moss ? [0.6, 0.85, 0.5, 0.7 + rng() * 0.3] : [0.55, 0.8, 0.6, 0.6 + rng() * 0.3], rng);
    }
    // the lip: water running over the edge and down the face
    if (ctx.lip >= 0 && rng() < 0.55 * mix.streak) {
      const [dx, dz] = DIRS[ctx.lip];
      const hh = Math.min((s.maxY - s.minY) * 0.9, 0.8 + rng() * 1.6);
      wallDecal(C, D.STREAK, x + dx * ctx.dl, y - hh / 2 - 0.02, z + dz * ctx.dl, dx, dz, 0.18 + rng() * 0.2, hh, [0.75, 0.85, 0.9, 0.5 + rng() * 0.3], rng);
    }
    if (ctx.lip < 0 && ctx.wall < 0 && C.sites.length < 400 && area >= 6 && Math.min(w, d) >= 2.0 && area <= 2500) C.sites.push(s);
  }
  // salt crust / mineral bloom on a few ledge tops
  if (rng() < 0.3 * mix.mineral && area >= 3) {
    const x = s.minX + 0.4 + rng() * Math.max(0, w - 0.8);
    const z = s.minZ + 0.4 + rng() * Math.max(0, d - 0.8);
    if (C.free(x - 0.2, y + 0.05, z - 0.2, x + 0.2, y + 1.2, z + 0.2) && C.nearRoute(x, y, z, 26)) C.decal(D.MINERAL, 1, x, y + 0.005, z, rng() * TAU, 0.8 + rng() * 1.0, 0.7 + rng() * 0.8, [0.9, 0.9, 0.82, 0.5 + rng() * 0.3], 0, rng, { roll: rng() * TAU });
  }
}

// -----------------------------------------------------------------------------
// Wall faces
// -----------------------------------------------------------------------------
const FACES = [
  { n: [1, 0], pos: (s) => s.maxX, a0: (s) => s.minZ, a1: (s) => s.maxZ },
  { n: [-1, 0], pos: (s) => s.minX, a0: (s) => s.minZ, a1: (s) => s.maxZ },
  { n: [0, 1], pos: (s) => s.maxZ, a0: (s) => s.minX, a1: (s) => s.maxX },
  { n: [0, -1], pos: (s) => s.minZ, a0: (s) => s.minX, a1: (s) => s.maxX },
];

function dressWalls(C, s, si, rng) {
  const mix = C.mix(si);
  const H = s.maxY - s.minY;
  const metal = s.kind === 'metal' || s.kind === 'bridge';
  if (H < (metal ? 0.7 : 1.6)) return;
  for (const F of FACES) {
    const a0 = F.a0(s);
    const a1 = F.a1(s);
    const L = a1 - a0;
    if (L < 0.8) continue;
    const area = L * H;
    let n = Math.round(clamp(area * 0.045 * mix.density, metal ? 0.6 : 0, 28));
    if (n === 0 && area > 2.5 && rng() < 0.4) n = 1;
    const fp = F.pos(s);
    const nx = F.n[0];
    const nz = F.n[1];
    for (let k = 0; k < n; k++) {
      const a = a0 + 0.2 + rng() * Math.max(0, L - 0.4);
      const y = s.minY + 0.15 + rng() * Math.max(0, H - 0.3);
      const px = nx !== 0 ? fp : a;
      const pz = nx !== 0 ? a : fp;
      const x0 = nx > 0 ? px + 0.02 : nx < 0 ? px - 1.0 : px - 0.25;
      const x1 = nx > 0 ? px + 1.0 : nx < 0 ? px - 0.02 : px + 0.25;
      const z0 = nz > 0 ? pz + 0.02 : nz < 0 ? pz - 1.0 : pz - 0.25;
      const z1 = nz > 0 ? pz + 1.0 : nz < 0 ? pz - 0.02 : pz + 0.25;
      if (!C.free(x0, y - 0.3, z0, x1, y + 0.3, z1)) continue;
      if (!C.nearRoute(px, y, pz, 24)) continue;
      const low = C.floorBelow(px + nx * 0.4, y, pz + nz * 0.4, 1.4) !== null;
      const cat = pick(rng, metal
        ? ['rust', 3.2 * mix.rust, 'streak', 0.9 * mix.streak, 'mineral', 0.3 * mix.mineral, 'tag', 0.5 * mix.cloth, 'soot', 0.2]
        : [
            'streak', 1.5 * mix.streak,
            'mineral', 1.2 * mix.mineral,
            'rust', 0.35 * mix.rust,
            'moss', (low ? 1.8 : 0.5) * mix.moss,
            'slime', low ? 1.6 * mix.slime : 0.05,
            'banner', H > 4.5 ? 0.9 * mix.cloth : 0,
            'tag', 0.45 * mix.cloth,
            'root', 0.7 * mix.root,
            'sinew', 0.8 * mix.sinew,
            'soot', 0.2,
          ]);
      if (!cat) continue;
      switch (cat) {
        case 'rust': {
          const hh = metal ? Math.min(H * 0.92, 0.6 + rng() * 1.2) : 0.9 + rng() * 1.4;
          wallDecal(C, D.RUST, px, metal ? s.maxY - hh / 2 - 0.02 : y - hh / 2, pz, nx, nz, 0.22 + rng() * 0.3, hh, [1, 0.85 + rng() * 0.2, 0.8, 0.65 + rng() * 0.3], rng);
          break;
        }
        case 'streak': {
          const hh = 1.5 + rng() * 2.6;
          wallDecal(C, D.STREAK, px, y - hh / 2, pz, nx, nz, 0.16 + rng() * 0.22, hh, [0.8, 0.88, 0.95, 0.45 + rng() * 0.35], rng);
          break;
        }
        case 'mineral':
          wallDecal(C, D.MINERAL, px, y, pz, nx, nz, 0.6 + rng() * 1.1, 0.5 + rng() * 0.8, [0.92, 0.92, 0.84, 0.5 + rng() * 0.35], rng, { roll: (rng() - 0.5) * 0.6 });
          break;
        case 'moss':
          wallDecal(C, D.MOSS, px, y, pz, nx, nz, 0.5 + rng() * 1.0, 0.4 + rng() * 0.7, [0.6, 0.85, 0.5, 0.7 + rng() * 0.3], rng, { roll: rng() * TAU });
          break;
        case 'slime':
          wallDecal(C, D.SLIME, px, y, pz, nx, nz, 0.5 + rng() * 0.9, 0.9 + rng() * 1.2, [0.55, 0.8, 0.6, 0.6 + rng() * 0.3], rng);
          break;
        case 'soot':
          wallDecal(C, D.SOOT, px, y, pz, nx, nz, 0.7 + rng() * 0.8, 1.0 + rng() * 1.0, [1, 1, 1, 0.35 + rng() * 0.3], rng);
          break;
        case 'banner':
          // a banner hung from a rod on a wall bracket: needs the wall clear in front of it and room below
          if (y - 1.9 > s.minY + 0.2 && C.free(Math.min(px, px + nx * 0.5) - 0.45 * Math.abs(nz), y - 1.9, Math.min(pz, pz + nz * 0.5) - 0.45 * Math.abs(nx), Math.max(px, px + nx * 0.5) + 0.45 * Math.abs(nz), y + 0.05, Math.max(pz, pz + nz * 0.5) + 0.45 * Math.abs(nx))) {
            C.add(pick(rng, ['banner', 1.5, 'bannerTeal', 1, 'bannerShort', 1]), px + nx * 0.03, y, pz + nz * 0.03, rng, { yaw: Math.atan2(nx, nz), s: 0.9 + rng() * 0.3, hangs: true });
          }
          break;
        case 'tag':
          C.add('tag', px + nx * 0.02, y, pz + nz * 0.02, rng, { yaw: Math.atan2(nx, nz), hangs: true });
          break;
        case 'root':
        case 'sinew':
          C.add(cat === 'root' ? 'rootHang' : 'sinewHang', px + nx * 0.03, y, pz + nz * 0.03, rng, { yaw: rng() * TAU, s: 0.9 + rng() * 0.9, hangs: true });
          break;
        default:
          break;
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Undersides: stalactites, chains, rope ends, roots, cobwebs
// -----------------------------------------------------------------------------
function dressUnder(C, s, si, rng) {
  const w = s.maxX - s.minX;
  const d = s.maxZ - s.minZ;
  const area = w * d;
  if (area < 1.0 || Math.min(w, d) < 0.5) return;
  const mix = C.mix(si);
  const n = Math.round(clamp(area * 0.3, 2, 26) * mix.density);
  const y = s.minY;
  for (let k = 0; k < n; k++) {
    let x;
    let z;
    if (rng() < 0.5) {
      const side = (rng() * 4) | 0;
      const off = 0.1 + rng() * 0.3;
      x = side === 0 ? s.maxX - off : side === 1 ? s.minX + off : s.minX + rng() * w;
      z = side === 2 ? s.maxZ - off : side === 3 ? s.minZ + off : s.minZ + rng() * d;
    } else {
      x = s.minX + 0.2 + rng() * Math.max(0, w - 0.4);
      z = s.minZ + 0.2 + rng() * Math.max(0, d - 0.4);
    }
    x = clamp(x, s.minX + 0.08, s.maxX - 0.08);
    z = clamp(z, s.minZ + 0.08, s.maxZ - 0.08);
    if (!C.free(x - 0.12, y - 1.4, z - 0.12, x + 0.12, y - 0.03, z + 0.12)) continue;
    if (!C.nearRoute(x, y, z, 26)) continue;
    // a wall next to this spot, a little below the underside: a cobweb corner
    let wallK = -1;
    let dw = 9;
    for (let q = 0; q < 4 && wallK < 0; q++) {
      const dd = C.wallFace(x, y - 0.3, z, DIRS[q][0], DIRS[q][1], 0.9);
      if (dd < 0.9) {
        wallK = q;
        dw = dd;
      }
    }
    const cat = pick(rng, [
      'stal', 3.0 * mix.stal,
      'chain', 1.5 * mix.chain,
      'rope', 1.2 * mix.rope * (s.kind === 'metal' ? 2 : 1),
      'root', 1.2 * mix.root,
      'sinew', 1.2 * mix.sinew,
      'tag', 0.7 * mix.cloth,
      'rag', 0.7 * mix.cloth,
      'web', wallK >= 0 ? 4.0 * mix.web : 0.4 * mix.web,
    ]);
    if (!cat) continue;
    switch (cat) {
      case 'stal':
        C.add(pick(rng, ['stalA', 1, 'stalB', 0.7, 'stalC', 1.2, 'stalCluster', area > 10 ? 1 : 0.2]), x, y, z, rng, { yaw: rng() * TAU, s: 0.8 + rng() * 0.7 });
        break;
      case 'chain':
        C.add(rng() < 0.45 ? 'chain7' : 'chain4', x, y, z, rng, { s: 0.9 + rng() * 0.3 });
        break;
      case 'rope':
        C.add('ropeHang', x, y, z, rng, { s: 0.6 + rng() * 0.8 });
        break;
      case 'root':
        C.add('rootHang', x, y, z, rng, { s: 0.8 + rng() * 0.9 });
        break;
      case 'sinew':
        C.add('sinewHang', x, y, z, rng, { s: 0.8 + rng() * 1.0 });
        break;
      case 'tag':
        C.add('tag', x, y, z, rng);
        break;
      case 'rag':
        C.add('rag', x, y, z, rng, { col: [1, 0.9 + rng() * 0.2, 0.85], s: 0.8 + rng() * 0.6 });
        break;
      case 'web':
        if (wallK >= 0) {
          const [dx, dz] = DIRS[wallK];
          C.add(rng() < 0.5 ? 'webCorner' : 'webCornerR', x + dx * dw, y - 0.005, z + dz * dw, rng, { yaw: Math.atan2(-dx, -dz), s: 0.7 + rng() * 0.8, hangs: true });
        } else {
          C.add('webStrand', x, y - 0.1, z, rng, { s: 0.8 + rng() * 0.6, hangs: true });
        }
        break;
      default:
        break;
    }
  }
}

// -----------------------------------------------------------------------------
// Decor-driven details
// -----------------------------------------------------------------------------
function dressDecor(C, o, rng) {
  const si = C.secOf(o.y);
  const mix = C.mix(si);
  const fx = -Math.sin(o.yaw);
  const fz = -Math.cos(o.yaw);
  if (o.type === 'statue') {
    // offerings at the feet of the Lanternwright: candle stubs, wax, paper
    const n = rng() < 0.7 ? 1 + ((rng() * 3) | 0) : 0;
    const base = o.y - o.sy / 2;
    for (let i = 0; i < n; i++) {
      const lx = (rng() - 0.5) * 1.6;
      const lf = o.sx / 2 + 0.3 + rng() * 0.9;
      const x = o.x + fx * lf + -fz * lx;
      const z = o.z + fz * lf + fx * lx;
      const fy = C.floorBelow(x, base + 1.0, z, 2.0);
      if (fy === null) continue;
      if (rng() < 0.5 + 0.5 * mix.candle) emitCandle(C, rng, x, fy, z);
      if (rng() < 0.5 * mix.paper) emitPaper(C, rng, x + 0.2, fy, z);
    }
  } else if (o.type === 'lamp') {
    // soot above a lamp, on the wall behind it
    const wx = -fx;
    const wz = -fz;
    const dd = C.wallFace(o.x, o.y, o.z, wx, wz, 0.7);
    if (dd < 0.7) wallDecal(C, D.SOOT, o.x + wx * dd, o.y + 0.85, o.z + wz * dd, -wx, -wz, 0.8, 1.3, [1, 1, 1, 0.55], rng);
  } else if (o.type === 'machinery') {
    const base = o.y - o.sy / 2;
    const ox = o.x + (rng() - 0.5) * o.sx;
    const oz = o.z + o.sz / 2 + 0.5;
    const fy = C.floorBelow(ox, base + 0.8, oz, 3);
    if (fy !== null && C.nearRoute(ox, fy, oz, 26)) {
      C.decal(D.SOOT, 1, ox, fy + 0.005, oz, rng() * TAU, 1.5, 1.2, [0.7, 0.7, 0.7, 0.7], 0, rng, { roll: rng() * TAU });
      emitTool(C, rng, ox + 0.3, fy, oz);
      if (rng() < 0.5) C.add('ropeCoil', ox - 0.4, fy, oz + 0.2, rng);
    }
  } else if (o.type === 'pipe') {
    const bottom = o.y - Math.min(o.sy, o.sx, o.sz) / 2;
    const fy = C.floorBelow(o.x, bottom, o.z, 16);
    if (fy !== null && bottom - fy > 0.5 && C.nearRoute(o.x, fy, o.z, 26)) C.puddle(o.x + (rng() - 0.5) * 0.4, fy + 0.004, o.z + (rng() - 0.5) * 0.4, 0.45 + rng() * 0.4, 0.4 + rng() * 0.3, Math.min(bottom - fy, 10), rng);
  } else if (o.type === 'cage') {
    const bottom = o.y - o.sy / 2;
    const fy = C.floorBelow(o.x, bottom, o.z, 14);
    if (fy !== null && C.nearRoute(o.x, fy, o.z, 26)) {
      emitBones(C, rng, o.x + (rng() - 0.5) * 0.5, fy, o.z + (rng() - 0.5) * 0.5, mix);
      C.add('skull', o.x + 0.3, fy, o.z - 0.2, rng);
    }
  }
}

// -----------------------------------------------------------------------------
// Vignettes
// -----------------------------------------------------------------------------
function frame(site) {
  const sy = Math.sin(site.yaw);
  const cy = Math.cos(site.yaw);
  return (lx, lz) => [site.x + cy * lx + sy * lz, site.z - sy * lx + cy * lz];
}

function makePut(C, rng, site) {
  const at = frame(site);
  return (name, lx, lz, o = {}) => {
    const [x, z] = at(lx, lz);
    return C.add(name, x, site.y + (o.dy || 0), z, rng, Object.assign({}, o, { vig: true, yaw: site.yaw + (o.yaw || 0) }));
  };
}

/** A decal on the wall behind the site (the wall is 0.9 m behind the site origin), lateral offset lx, height hy above the floor. */
function wallMark(C, rng, site, cell, lx, hy, w, h, rgba, o = {}) {
  const at = frame(site);
  const [x, z] = at(lx, -0.888);
  return C.decal(cell, 0, x, site.y + hy, z, site.yaw, w, h, rgba, 0, rng, Object.assign({ vig: true }, o));
}

const GLOWPOOL = (C, rng, x, y, z, w, a) => C.decal(D.GLOW, 1, x, y + 0.01, z, 0, w, w, [WARM[0], WARM[1], WARM[2], a], 0.9, rng, { vig: true });
const PALE = [0.95, 0.92, 0.85];

const VIGNETTES = [
  {
    // a climber's camp: bedroll, candle cluster, dead lantern, rope, tools, soot on the wall
    id: 'camp', secs: [2, 3], kind: 'wall',
    build(C, rng, site) {
      const put = makePut(C, rng, site);
      const at = frame(site);
      put('bedroll', 0.45, -0.35, { yaw: Math.PI / 2 + 0.1 });
      put('candleCluster', -0.55, -0.5);
      const [lx, lz] = at(-0.55, -0.5);
      GLOWPOOL(C, rng, lx, site.y, lz, 1.6, 0.6);
      put('lantern', -0.2, 0.15, { yaw: 0.5 });
      put('ropeCoil', -0.95, 0.4);
      put('cup', 0.1, 0.3, { yaw: 1 });
      put('paperA', 0.75, 0.3, { yaw: 0.3 });
      put('paperB', 0.9, 0.5, { yaw: 1.4 });
      put('pickaxe', 1.1, -0.55, { yaw: 0.2 });
      put('crateBroken', 0.2, -0.75, { yaw: 0.2 });
      put('satchel', 0.95, -0.3, { yaw: 2.2 });
      wallMark(C, rng, site, D.SOOT, -0.55, 1.3, 1.0, 1.6, [1, 1, 1, 0.6]);
    },
  },
  {
    // a dropped bag at a lip: the satchel and what spilled
    id: 'bag', secs: [1, 0], kind: 'lip',
    build(C, rng, site) {
      const put = makePut(C, rng, site);
      put('satchel', 0, 0, { yaw: 0.6, tz: 0.08 });
      put('paperA', 0.35, 0.25, { yaw: 0.4 });
      put('paperB', -0.3, 0.4, { yaw: 2.1 });
      put('paperCurl', 0.5, -0.1, { yaw: 1.2 });
      put('cup', -0.25, -0.2, { yaw: 0.9, tz: Math.PI / 2, dy: 0.04 });
      put('ragFloor', 0.15, -0.35, { yaw: 0.2 });
      put('candle', -0.5, 0.0);
    },
  },
  {
    // a shrine of wax and paper round a skull
    id: 'shrine', secs: [3, 2], kind: 'wall',
    build(C, rng, site) {
      const put = makePut(C, rng, site);
      const at = frame(site);
      put('skull', 0, -0.2, { yaw: Math.PI });
      put('femur', 0.3, -0.35, { yaw: 0.3 });
      put('candleCluster', -0.55, 0.1);
      put('candleCluster', 0.6, 0.05);
      put('candle', -0.3, 0.6);
      put('candleLit', 0.25, 0.6);
      put('candle', 0.85, 0.5);
      put('waxPool', -0.2, 0.4);
      put('waxPool', 0.45, 0.3);
      put('paperB', 0, 0.45, { yaw: 0.9 });
      put('paperA', -0.7, 0.55, { yaw: 2 });
      put('paperCurl', 0.95, 0.15, { yaw: 1.4 });
      for (const [lx, lz] of [[-0.55, 0.1], [0.6, 0.05], [0.25, 0.6]]) {
        const [x, z] = at(lx, lz);
        GLOWPOOL(C, rng, x, site.y, z, 1.4, 0.55);
      }
      wallMark(C, rng, site, D.SOOT, 0, 1.1, 1.3, 1.8, [1, 1, 1, 0.65]);
    },
  },
  {
    // a hand-scratched tally with a candle stub and the climber's bones
    id: 'tally', secs: [4, 5], kind: 'wall',
    build(C, rng, site) {
      const put = makePut(C, rng, site);
      wallMark(C, rng, site, D.TALLY, 0, 1.45, 1.2, 1.2, [PALE[0], PALE[1], PALE[2], 0.95]);
      wallMark(C, rng, site, D.TALLY, 0.55, 1.15, 0.8, 0.8, [PALE[0], PALE[1], PALE[2], 0.8], { roll: 0.05 });
      put('candle', 0.2, -0.55);
      put('waxPool', 0.05, -0.5);
      put('femur', 0.45, 0.2, { yaw: 0.8 });
      put('hand', -0.1, 0.35, { yaw: 2.4 });
      put('paperA', -0.45, 0.1, { yaw: 0.2 });
      put('chipB', -0.35, -0.55);
      put('chipA', 0.6, -0.5);
    },
  },
  {
    // a fallen scaffold: smashed crates, planks, rusted tools
    id: 'scaffold', secs: [5, 4], kind: 'open',
    build(C, rng, site) {
      const put = makePut(C, rng, site);
      put('crateSmash', 0, 0, { yaw: 0.3 });
      put('crateSmash', 0.8, 0.5, { yaw: 1.9 });
      put('plankC', -0.3, 0.55, { yaw: 0.9, dy: 0.03, tz: 0.04 });
      put('plankA', 0.2, 0.9, { yaw: 2.3, dy: 0.03 });
      put('plankC', 0.6, -0.5, { yaw: -0.6, dy: 0.03 });
      put('plankB', -0.7, -0.2, { yaw: 1.4, dy: 0.03 });
      put('barrel', -1.0, 0.7, { dy: 0.235, tz: Math.PI / 2, yaw: 0.4 });
      put('pickaxe', 1.3, -0.1, { yaw: 0.6 });
      put('shovel', -0.9, 0.0, { yaw: 2.9 });
      put('ropeCoil', 0.3, 1.3);
      put('bucket', -0.4, 1.1, { dy: 0.12, tz: Math.PI / 2 });
      put('lantern', 1.2, 0.8, { yaw: 1 });
      put('chipA', -0.2, 0.2);
      put('chipB', 0.4, 0.2);
      put('block', 1.0, 1.2);
    },
  },
  {
    // a climber slumped against the wall
    id: 'remains', secs: [6, 7], kind: 'wall',
    build(C, rng, site) {
      const put = makePut(C, rng, site);
      put('skull', 0.0, -0.62, { dy: 0.5, yaw: Math.PI + 0.3, tx: 0.4 });
      put('jaw', 0.12, -0.35, { yaw: 0.8 });
      for (let i = 0; i < 3; i++) put('rib', -0.12 + i * 0.1, -0.7, { dy: 0.12 + i * 0.1, yaw: Math.PI / 2 + i * 0.1, tx: 0.2 });
      for (let i = 0; i < 4; i++) put('vert', 0.0, -0.78, { dy: 0.04 + i * 0.1, yaw: i });
      put('femur', 0.18, 0.15, { yaw: 0.05 });
      put('femur', -0.18, 0.2, { yaw: -0.1 });
      put('femurBroken', 0.12, 0.62, { yaw: 0.2 });
      put('hand', 0.45, -0.1, { yaw: 1.8 });
      put('hand', -0.5, -0.2, { yaw: 3.4 });
      put('satchel', 0.65, -0.45, { yaw: 2.5 });
      put('candle', -0.6, 0.35);
      put('paperCurl', 0.5, 0.4, { yaw: 0.6 });
      wallMark(C, rng, site, D.TALLY, 0, 1.0, 0.9, 0.9, [PALE[0], PALE[1], PALE[2], 0.9]);
    },
  },
  {
    // the last tally, deep down
    id: 'tally2', secs: [7, 6], kind: 'wall',
    build(C, rng, site) {
      const put = makePut(C, rng, site);
      wallMark(C, rng, site, D.TALLY, 0, 1.3, 1.4, 1.4, [PALE[0], PALE[1], PALE[2], 0.95]);
      put('waxPool', 0.1, -0.5);
      put('candle', 0.1, -0.5);
      put('skull', 0.5, 0.1, { yaw: 0.4 });
      put('rib', -0.3, 0.25, { yaw: 1 });
      put('vert', 0.0, 0.5);
    },
  },
];

function findSite(C, rng, v, si) {
  // candidate floors of that section, big enough, shuffled by the seed
  const cands = [];
  for (const s of C.sites) if (C.secOf((s.minY + s.maxY) / 2) === si || C.secOf(s.maxY) === si) cands.push(s);
  if (!cands.length) return null;
  for (let tries = 0; tries < 60; tries++) {
    const s = cands[(rng() * cands.length) | 0];
    const w = s.maxX - s.minX;
    const d = s.maxZ - s.minZ;
    let x;
    let z;
    let wallK = -1;
    if (v.kind === 'open') {
      x = s.minX + 1.5 + rng() * Math.max(0, w - 3);
      z = s.minZ + 1.5 + rng() * Math.max(0, d - 3);
    } else {
      // against a wall or at a lip: start from the edge of the floor and walk 0.9 m in
      const side = (rng() * 4) | 0;
      const off = v.kind === 'lip' ? 0.8 : 0.95;
      x = side === 0 ? s.maxX - off : side === 1 ? s.minX + off : s.minX + 1 + rng() * Math.max(0, w - 2);
      z = side === 2 ? s.maxZ - off : side === 3 ? s.minZ + off : s.minZ + 1 + rng() * Math.max(0, d - 2);
      x = clamp(x, s.minX + 0.5, s.maxX - 0.5);
      z = clamp(z, s.minZ + 0.5, s.maxZ - 0.5);
      if (v.kind === 'wall') {
        C.rej.tryWall = (C.rej.tryWall || 0) + 1;
        for (let q = 0; q < 4; q++) {
          const dd = C.wallFace(x, s.maxY + 0.6, z, DIRS[q][0], DIRS[q][1], 1.3);
          if (dd < 1.3) {
            wallK = q;
            x += DIRS[q][0] * (dd - 0.9); // the wall ends up exactly 0.9 m behind the site
            z += DIRS[q][1] * (dd - 0.9);
            break;
          }
        }
        if (wallK < 0) {
          C.rej.noWall = (C.rej.noWall || 0) + 1;
          continue;
        }
      } else {
        // lip: the void side must be near
        let lipK = -1;
        for (let q = 0; q < 4; q++) {
          const ex = x + DIRS[q][0] * 1.1;
          const ez = z + DIRS[q][1] * 1.1;
          if (C.free(ex - 0.1, s.maxY - 0.8, ez - 0.1, ex + 0.1, s.maxY - 0.08, ez + 0.1)) {
            lipK = q;
            break;
          }
        }
        if (lipK < 0) continue;
        wallK = lipK; // for a lip the "back" is the void, so the items face away from it
      }
    }
    const y = s.maxY;
    if (!C.free(x - 1.4, y + 0.06, z - 1.4, x + 1.4, y + 2.0, z + 1.4)) {
      C.rej.blocked = (C.rej.blocked || 0) + 1;
      continue;
    }
    if (C.nearAnchor(x, y, z, 2.5) || C.nearCp(x, y, z, 3.0) || C.nearClimb(x, y, z, 1.2)) {
      C.rej.near = (C.rej.near || 0) + 1;
      continue;
    }
    if (!C.nearRoute(x, y, z, 30)) {
      C.rej.far = (C.rej.far || 0) + 1;
      continue;
    }
    // the frame: local -z points at the wall (or the void)
    const yaw = wallK >= 0 ? Math.atan2(-DIRS[wallK][0], -DIRS[wallK][1]) : rng() * TAU;
    return { x, y, z, yaw, solid: s };
  }
  return null;
}

function placeVignettes(C, rngSeed) {
  const rng = mulberry32(hash32(C.seed, 0x71e7, rngSeed));
  // 6 of the 7: the seed drops one (never the camp)
  const drop = 1 + ((rng() * (VIGNETTES.length - 1)) | 0);
  for (let i = 0; i < VIGNETTES.length; i++) {
    if (i === drop) continue;
    const v = VIGNETTES[i];
    const order = rng() < 0.65 ? v.secs : [v.secs[1], v.secs[0]];
    let site = null;
    let used = -1;
    for (const si of order) {
      site = findSite(C, rng, v, si);
      if (site) {
        used = si;
        break;
      }
    }
    if (!site) continue;
    v.build(C, mulberry32(hash32(C.seed, i, 0x5a7e)), site);
    C.vignettes.push({ id: v.id, section: used, x: site.x, y: site.y, z: site.z });
  }
}

// -----------------------------------------------------------------------------
// Driver
// -----------------------------------------------------------------------------
/**
 * The plan as a generator (one solid or decor item per step, so the view can spread the work over frames); the return value is
 * the finished plan. `planSceneDetail` runs it to the end.
 */
export function* planSteps(level, seed, kitIn) {
  const kit = kitIn || getKit();
  const C = new Ctx(level, seed, kit);
  const solids = level.solids;
  // a stable processing order that depends on the seed, so no section starves under the per-section caps
  const order = solids.map((_, i) => i);
  const r0 = mulberry32(hash32(C.seed, 0x0dde));
  for (let i = order.length - 1; i > 0; i--) {
    const j = (r0() * (i + 1)) | 0;
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  for (let k = 0; k < order.length; k++) {
    const idx = order[k];
    const s = solids[idx];
    if (s.kind !== 'crumble' && s.active !== false) {
      const si = C.secOf((s.minY + s.maxY) / 2);
      const sb = C.secOf(s.maxY);
      dressFloor(C, s, sb, mulberry32(hash32(C.seed, idx, 1)));
      dressWalls(C, s, si, mulberry32(hash32(C.seed, idx, 2)));
      dressUnder(C, s, C.secOf(s.minY), mulberry32(hash32(C.seed, idx, 3)));
    }
    yield k;
  }
  for (let i = 0; i < level.decor.length; i++) {
    dressDecor(C, level.decor[i], mulberry32(hash32(C.seed, i, 4)));
    if ((i & 7) === 7) yield i;
  }
  placeVignettes(C, 1);
  yield -1;
  return finish(C);
}

function finish(C) {
  const kit = C.kit;
  const items = Float32Array.from(C.items);
  const decals = Float32Array.from(C.decals);
  const puddles = Float32Array.from(C.puddles);
  const nItems = items.length / ITEM_STRIDE;
  let tris = 0;
  const perSection = new Array(C.nSec).fill(0);
  for (let i = 0; i < nItems; i++) {
    const t = kit.templates[items[i * ITEM_STRIDE + 12]].tris;
    tris += t;
    perSection[C.secOf(items[i * ITEM_STRIDE + 1])] += t;
  }
  // a checksum over the placement (tests: same seed → same plan)
  let h = 0x811c9dc5;
  const mixIn = (arr) => {
    for (let i = 0; i < arr.length; i += 1) h = Math.imul(h ^ Math.round(arr[i] * 1000), 0x01000193);
  };
  mixIn(items);
  mixIn(decals);
  mixIn(puddles);
  return {
    seed: C.seed,
    kit,
    items,
    nItems,
    decals,
    nDecals: decals.length / DECAL_STRIDE,
    puddles,
    nPuddles: puddles.length / PUDDLE_STRIDE,
    vignettes: C.vignettes,
    checksum: h >>> 0,
    stats: {
      items: nItems,
      decals: decals.length / DECAL_STRIDE,
      puddles: puddles.length / PUDDLE_STRIDE,
      tris,
      perSectionItems: Array.from(C.nItems),
      perSectionDecals: Array.from(C.nDecals),
      perSectionPuddles: Array.from(C.nPuddles),
      perSectionTris: perSection,
      cats: Object.assign({}, C.catCount),
      rejects: Object.assign({}, C.rej),
      sites: C.sites.length,
    },
  };
}

/** Plans the whole level now (tests, tools). */
export function planSceneDetail(level, seed, kit) {
  const it = planSteps(level, seed, kit);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

// -----------------------------------------------------------------------------
// Window selection (shared by the view and the tests)
// -----------------------------------------------------------------------------
/**
 * Picks the items to draw around the head: those with rank <= rankMax within the radius, shrinking the radius until their
 * triangles fit maxTris. Writes item indices into `out` (Int32Array, length >= plan.nItems). Returns the triangle sum; the final
 * radius and count are left in `win`.
 */
export function selectItems(plan, hx, hy, hz, radius, rankMax, maxTris, out, win) {
  const items = plan.items;
  const tt = plan.kit.templates;
  let r = radius;
  let n = 0;
  let tris = 0;
  for (let pass = 0; pass < 7; pass++) {
    n = 0;
    tris = 0;
    const r2 = r * r;
    for (let i = 0; i < plan.nItems; i++) {
      const o = i * ITEM_STRIDE;
      const dy = items[o + 1] - hy;
      if (dy > r || dy < -r) continue;
      if (items[o + 11] > rankMax) continue;
      const dx = items[o] - hx;
      const dz = items[o + 2] - hz;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      out[n++] = i;
      tris += tt[items[o + 12]].tris;
    }
    if (tris <= maxTris) break;
    r *= 0.82;
  }
  if (win) {
    win.n = n;
    win.radius = r;
  }
  return tris;
}

/** Same for decals / puddles (flat records, x y z first, rank at `rankAt`): at most `maxN` nearest within the radius. */
export function selectRecords(arr, stride, rankAt, count, hx, hy, hz, radius, rankMax, maxN, out) {
  let r = radius;
  let n = 0;
  for (let pass = 0; pass < 7; pass++) {
    n = 0;
    const r2 = r * r;
    for (let i = 0; i < count; i++) {
      const o = i * stride;
      const dy = arr[o + 1] - hy;
      if (dy > r || dy < -r) continue;
      if (arr[o + rankAt] > rankMax) continue;
      const dx = arr[o] - hx;
      const dz = arr[o + 2] - hz;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      out[n++] = i;
    }
    if (n <= maxN) break;
    r *= 0.82;
  }
  return Math.min(n, maxN);
}

export { D, P };
