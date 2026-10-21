#!/usr/bin/env node
/* ABYSSAL TETHER 3D — bake_lightmaps.mjs
 * Bakes the static lighting of Chapter I into LIGHTMAPS (no Blender, deterministic, worker threads):
 *
 *   node tools/abyssal-tether-3d/bake/bake_lightmaps.mjs [--draft] [--workers 4] [--budget 4000000] [--out <dir>] [--preview <dir>] [--verify]
 *
 * Scene: the level's static solid boxes (kind → albedo estimate; crumbling ledges and variant-specific pieces are left out).
 * Lights: the 13 level lamps (sphere area lights, three's own distance falloff, soft shadows), the shaft key
 * (KEY_DIR, per-section colour and strength as Renderer3D would set it, cone-sampled shadows: soft window patches on
 * floors), the light-shaft decor (vertical line emitters) and the sky/abyss ambient (the renderer's hemisphere colours
 * times baked ambient occlusion, so the pit falls into near-black). Diffuse GI: three gather passes (cosine-weighted rays,
 * the previous pass's lightmap read at the hit) → three bounces with colour bleeding.
 * Charts: every visible face of every solid (rays from eye points along the route decide what is visible), texel density
 * 0.1-0.6 m adaptive to the distance to the route under a global texel budget, MaxRects-packed into 1024² pages,
 * cross-bilateral denoise + dilation, sqrt-encoded RGBA8 (see src/render/lightmapFormat.js).
 *
 * Output (public/abyssal-tether-3d/assets/lighting/): lm_ch1_index.json, lm_ch1_p<N>.bin.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { Level3D } from '../../../public/abyssal-tether-3d/src/sim/level3d.js';
import { LEVEL_DATA_3D } from '../../../public/abyssal-tether-3d/src/data/level-data-3d.js';
import {
  LM_FACE,
  LM_FACES,
  LM_FACE_FLOATS,
  LM_HEADER_BYTES,
  LM_PAGE,
  LM_RANGE_LAMP,
  LM_RANGE_STATIC,
  LM_VERSION,
  levelLmHash,
  lmDelta,
  lmPageFile,
  LM_INDEX_NAME,
  writeLmHeader,
} from '../../../public/abyssal-tether-3d/src/render/lightmapFormat.js';
import { buildCharts, fitBudget, packPages, CHART_CFG } from './lmCharts.mjs';
import { BoxGrid } from './lmTrace.mjs';
import { KEY_DIR, hexToLinear, lookAt, parseThemes } from './lmTheme.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const DEFAULT_OUT = path.join(ROOT, 'public/abyssal-tether-3d/assets/lighting');

export const QUALITY = {
  final: { gather: [32, 16, 12], lampSamples: 6, shaftSamples: 6, keySamples: 12, budget: 5000000, eyeRays: 4000 },
  draft: { gather: [6, 4, 4], lampSamples: 2, shaftSamples: 2, keySamples: 3, budget: 1200000, eyeRays: 1200 },
};
const BASE_QUALITY = {
  keyRange: 150,
  keyFloor: 0.22, // the share of the key that blocked regions keep (the runtime's old slanted-fill behaviour was 0.55)
  gatherRange: 120,
  aoRange: 7,
  aoShort: 1.2, // contact occlusion radius (m): crisp dark lines where floors meet walls and under ledges
  aoContact: 0.75,
  aoRelief: 0.06,
  aoGain: 2.3,
  aoStrength: 1.0,
  aoFloor: 0.1,
  aoTarget: 0.78,
  shaftGain: 0.8, // linear intensity of a light shaft's emitter (E ≈ 2·J/d next to an infinite line)
  ambientGain: 0.6, // the flat hemisphere fill was the "2010" look; the sources and their bounces carry the picture now
  bounceGain: 1.5, // artistic: stone is brighter than the albedo estimate says, so bounces and colour bleeding read
  anchorCandela: 5.5, // each grapple point's baked glow (cd; range 6.5 × 1.5 m)
  lampGain: 2.0, // the lamps are the warm heart of the picture: baked pools are brighter than the old runtime lamps
};

// Albedo estimates (linear): the level's stone is dark grey-brown, metal cold, bridges warm, pillars pale, flesh dark.
const ALBEDO = {
  wall: [0.2, 0.18, 0.16],
  stone: [0.26, 0.23, 0.2],
  pillar: [0.3, 0.28, 0.25],
  bridge: [0.3, 0.23, 0.17],
  metal: [0.18, 0.19, 0.21],
  grate: [0.14, 0.14, 0.15],
};
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// ---------------------------------------------------------------------------------------------------------------------
// Worker pool
// ---------------------------------------------------------------------------------------------------------------------
class Pool {
  constructor(n, data) {
    this.workers = [];
    this.pending = new Map();
    this.seq = 1;
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./lmWorker.mjs', import.meta.url), { workerData: data });
      w.on('message', (m) => {
        const cb = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (cb) cb(w);
      });
      w.on('error', (e) => {
        console.error('[bake_lightmaps] worker error', e);
        process.exit(2);
      });
      this.workers.push(w);
    }
  }

  /** Runs `job` over [0, total) in chunks; resolves when every chunk is done. */
  run(total, chunk, job) {
    return new Promise((resolve) => {
      let next = 0;
      let outstanding = 0;
      const feed = (w) => {
        if (next >= total) {
          if (outstanding === 0) resolve();
          return;
        }
        const a = next;
        const b = Math.min(total, a + chunk);
        next = b;
        const id = this.seq++;
        outstanding++;
        this.pending.set(id, (ww) => {
          outstanding--;
          feed(ww);
        });
        w.postMessage(Object.assign({ id, a, b }, job));
      };
      for (const w of this.workers) feed(w);
    });
  }

  close() {
    for (const w of this.workers) w.terminate();
  }
}

const sab = (Type, n) => new Type(new SharedArrayBuffer(n * Type.BYTES_PER_ELEMENT));

// ---------------------------------------------------------------------------------------------------------------------
// Texel field post-processing (single thread)
// ---------------------------------------------------------------------------------------------------------------------
/** Fills texels without a valid sample from valid neighbours inside the chart. fields: [{ a, n }] */
function fillInvalid(charts, valid, fields) {
  let remaining = 0;
  for (const c of charts) {
    const { w, h, base } = c;
    let miss = 0;
    for (let i = 0; i < w * h; i++) if (!valid[base + i]) miss++;
    if (!miss) continue;
    const have = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) have[i] = valid[base + i];
    for (let it = 0; it < 64 && miss > 0; it++) {
      const next = have.slice();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (have[i]) continue;
          let cnt = 0;
          const acc = fields.map((f) => new Float64Array(f.n));
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const X = x + dx;
            const Y = y + dy;
            if (X < 0 || Y < 0 || X >= w || Y >= h || !have[Y * w + X]) continue;
            cnt++;
            const j = base + Y * w + X;
            fields.forEach((f, k) => {
              for (let q = 0; q < f.n; q++) acc[k][q] += f.a[j * f.n + q];
            });
          }
          if (!cnt) continue;
          fields.forEach((f, k) => {
            for (let q = 0; q < f.n; q++) f.a[(base + i) * f.n + q] = acc[k][q] / cnt;
          });
          next[i] = 1;
          miss--;
        }
      }
      have.set(next);
    }
    remaining += miss;
  }
  return remaining;
}

/**
 * Cross-bilateral 5×5 denoise inside every chart. `guide(t)` gives the luminance used for the edge weights (so shadow
 * edges survive); all `fields` are filtered with the same weights.
 */
function denoise(charts, fields, guideArr, strength = 1) {
  const R = 2;
  const sp = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) sp.push(Math.exp(-(dx * dx + dy * dy) / (2 * 1.15 * 1.15)));
  const out = fields.map((f) => new Float32Array(f.a.length));
  const tot = fields.reduce((n, f) => n + f.n, 0);
  const acc = new Float64Array(tot);
  for (const c of charts) {
    const { w, h, base } = c;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = base + y * w + x;
        const gc = guideArr[t];
        const sg = (0.22 * gc + 0.02) / strength;
        const inv = 1 / (2 * sg * sg);
        let ws = 0;
        acc.fill(0);
        let k = 0;
        for (let dy = -R; dy <= R; dy++) {
          const Y = y + dy;
          for (let dx = -R; dx <= R; dx++, k++) {
            const X = x + dx;
            if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
            const tt = base + Y * w + X;
            const d = guideArr[tt] - gc;
            const wt = sp[k] * Math.exp(-d * d * inv);
            ws += wt;
            let o = 0;
            for (let f = 0; f < fields.length; f++) {
              const fa = fields[f];
              for (let q = 0; q < fa.n; q++) acc[o++] += wt * fa.a[tt * fa.n + q];
            }
          }
        }
        let o = 0;
        for (let f = 0; f < fields.length; f++) for (let q = 0; q < fields[f].n; q++) out[f][t * fields[f].n + q] = acc[o++] / ws;
      }
    }
  }
  fields.forEach((f, i) => f.a.set(out[i]));
}

// ---------------------------------------------------------------------------------------------------------------------
// PNG preview writer (debug)
// ---------------------------------------------------------------------------------------------------------------------
function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function writePng(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = rgb[y * w * 3 + x];
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// ---------------------------------------------------------------------------------------------------------------------
// Bake
// ---------------------------------------------------------------------------------------------------------------------
export async function bakeLightmaps(level, opts = {}) {
  const log = opts.log || (() => {});
  const T0 = Date.now();
  const qname = opts.draft ? 'draft' : 'final';
  const Q = Object.assign({}, BASE_QUALITY, QUALITY[qname], opts.quality || {});
  const budget = opts.budget || Q.budget;
  const nWorkers = Math.max(1, opts.workers || Math.min(4, os.cpus().length));
  const stamp = (m) => log(`${m} (${((Date.now() - T0) / 1000).toFixed(1)} s)`);

  // ---- charts -------------------------------------------------------------------------------------------------------
  const cc = buildCharts(level, LEVEL_DATA_3D.solids, { budget, eyeRays: Q.eyeRays });
  const { charts, solids, boxes, cfg } = cc;
  const fit = fitBudget(charts, cfg);
  const pack = packPages(charts, cfg);
  const N = fit.texels;
  stamp(`charts: ${charts.length} on ${solids.length} solids, ${(cc.stats.exposedArea / 1000).toFixed(0)}k m² visible of ${(cc.stats.faceArea / 1000).toFixed(0)}k, ` +
    `${(N / 1e6).toFixed(2)}M texels (scale ${fit.k.toFixed(2)}), ${pack.pages.length} pages of ${LM_PAGE[0]}x${LM_PAGE[1]}`);

  // ---- tables for the workers ---------------------------------------------------------------------------------------
  const CS = 16;
  const chartsT = sab(Float64Array, charts.length * CS);
  // sort by base (already ascending: fitBudget assigns bases in array order)
  charts.forEach((c, i) => {
    chartsT.set([c.solid, c.face, c.a, LM_FACE[c.face][1], c.sa, c.ta, c.p, c.s0, c.s1, c.t0, c.t1, c.w, c.h, c.base, c.section, 0], i * CS);
    c.index = i;
  });
  const faceChart = sab(Int32Array, solids.length * 6);
  faceChart.fill(-1);
  for (const c of charts) faceChart[c.solid * 6 + c.face] = c.index;
  const albedo = sab(Float32Array, solids.length * 3);
  solids.forEach((s, i) => {
    const a = ALBEDO[s.kind] || ALBEDO.stone;
    albedo.set(a, i * 3);
  });
  const themes = parseThemes(level);
  // lights
  const lights = (level.lights || []).slice();
  // Anchors glow in the game (warm white rings, amber hooks, rust-red fragile ones): baked as small steady lights hung a
  // little in front of the mount, so every grapple point sits in its own pool of light (costs nothing at run time).
  const ANCHOR_COL = { ring: '#e8dcc0', hook: '#e0a050', fragile: '#b05040' };
  for (const a of level.anchors || []) {
    const n = a.normal || { x: 0, y: -1, z: 0 };
    lights.push({ x: a.x + n.x * 0.5, y: a.y + n.y * 0.5, z: (a.z || 0) + n.z * 0.5, color: ANCHOR_COL[a.kind] || ANCHOR_COL.ring, intensity: 1, range: 6.5, flicker: 0, anchor: true });
  }
  const lightsT = sab(Float64Array, lights.length * 12);
  const flame = [];
  lights.forEach((l, i) => {
    const col = hexToLinear(l.color, '#e0a050');
    const range = Math.max(2, l.range || 12);
    const candela = l.anchor ? Q.anchorCandela : Math.max(0, l.intensity == null ? 1 : l.intensity) * Math.max(6, 0.06 * range * range) * 1.6 * Q.lampGain;
    const rad = l.anchor ? 0.2 : Math.min(2.5, Math.max(0.25, range * 0.03));
    const isFlame = l.flicker && l.flicker > 0 ? 1 : 0;
    lightsT.set([l.x, l.y, l.z || 0, col[0], col[1], col[2], candela, range * 1.5, rad, isFlame, lum(col), 0], i * 12);
    if (isFlame) flame.push({ section: Math.max(0, level.sectionIndexAt(l.y) | 0), col, w: candela });
  });
  const shaftsDecor = (level.decor || []).filter((d) => d.type === 'shaft-light');
  const shaftsT = sab(Float64Array, shaftsDecor.length * 12);
  shaftsDecor.forEach((d, i) => {
    const col = hexToLinear(d.color, '#6fa3b5');
    shaftsT.set([d.x, d.y - d.sy / 2, d.y + d.sy / 2, d.z, Math.max(d.sx, d.sz) / 2, col[0], col[1], col[2], Q.shaftGain, 22 + Math.max(d.sx, d.sz) / 2, 0, 0], i * 12);
  });
  // flame-lamp tint per section: colour / luminance (so that scalar × tint = the lamp's coloured irradiance)
  const amber = hexToLinear('#e0a050');
  const tints = sab(Float32Array, themes.length * 3);
  const tintList = [];
  for (let s = 0; s < themes.length; s++) {
    const m = flame.filter((f) => f.section === s);
    let r = amber[0];
    let g = amber[1];
    let b = amber[2];
    if (m.length) {
      r = g = b = 0;
      let wsum = 0;
      for (const f of m) {
        const l = lum(f.col);
        r += (f.col[0] / l) * f.w;
        g += (f.col[1] / l) * f.w;
        b += (f.col[2] / l) * f.w;
        wsum += f.w;
      }
      r /= wsum;
      g /= wsum;
      b /= wsum;
    } else {
      const l = lum(amber);
      r /= l;
      g /= l;
      b /= l;
    }
    const l2 = lum([r, g, b]);
    tints.set([r / l2, g / l2, b / l2], s * 3);
    tintList.push([r / l2, g / l2, b / l2]);
  }
  const D = sab(Float32Array, N * 3);
  const DL = sab(Float32Array, N);
  const AO = sab(Float32Array, N);
  const AOS = sab(Float32Array, N);
  const B0 = sab(Float32Array, N * 3);
  const B1 = sab(Float32Array, N * 3);
  const valid = sab(Uint8Array, N);
  // Decor that casts shadows (statues, machinery, cages, pipes): shrunk boxes appended after the solids. They occlude and
  // darken (AO) but carry no lightmap of their own.
  const OCC = { statue: 0.6, machinery: 0.8, cage: 0.55, pipe: 0.8 };
  const occ = [];
  for (const d of level.decor || []) {
    const k = OCC[d.type];
    if (!k) continue;
    const hx = (Math.max(d.sx, d.sz) * k) / 2;
    occ.push([d.x - hx, d.y - d.sy / 2, d.z - hx, d.x + hx, d.y + d.sy / 2, d.z + hx]);
  }
  const allBoxes = new Float64Array(boxes.length + occ.length * 6);
  allBoxes.set(boxes);
  occ.forEach((b, i) => allBoxes.set(b, boxes.length + i * 6));
  const boxesS = sab(Float64Array, allBoxes.length);
  boxesS.set(allBoxes);
  const gridAll = new BoxGrid(allBoxes, cfg.min, cfg.size, cfg.cell);
  const gridShared = (() => {
    const s = gridAll.exportShared();
    const start = sab(Uint32Array, s.start.length);
    start.set(s.start);
    const items = sab(Uint32Array, s.items.length);
    items.set(s.items);
    return { start, items };
  })();
  log(`  ${occ.length} decor shadow casters`);

  const pool = new Pool(nWorkers, {
    boxes: boxesS,
    gridShared,
    cfg: { gridMin: cfg.min, gridSize: cfg.size, cell: cfg.cell, lift: 0.04, seed: 0x1b873593, nSolids: solids.length },
    charts: chartsT,
    faceChart,
    albedo,
    lights: lightsT,
    shafts: shaftsT,
    tints,
    D,
    DL,
    AO,
    AOS,
    valid,
    B0,
    B1,
    themes,
    keyDir: KEY_DIR,
    quality: { lampSamples: Q.lampSamples, shaftSamples: Q.shaftSamples, keySamples: Q.keySamples, keyRange: Q.keyRange, keyFloor: Q.keyFloor, gatherRange: Q.gatherRange, aoRange: Q.aoRange, aoShort: Q.aoShort },
  });
  const CHUNK = 4096;

  // ---- direct light ---------------------------------------------------------------------------------------------------
  await pool.run(N, CHUNK, { op: 'direct', pass: 0 });
  stamp('direct light done');
  const fields = (arrs) => arrs;
  const missing = fillInvalid(charts, valid, fields([{ a: D, n: 3 }, { a: DL, n: 1 }]));
  if (missing) log(`  ${missing} texels in fully buried charts stay dark`);
  const lumOf = (out) => {
    for (let t = 0; t < N; t++) out[t] = lum([D[t * 3], D[t * 3 + 1], D[t * 3 + 2]]) + 0.6 * DL[t];
    return out;
  };
  const guide = new Float32Array(N);
  denoise(charts, [{ a: D, n: 3 }, { a: DL, n: 1 }], lumOf(guide));
  stamp('direct light denoised');

  // ---- gather passes: pass 0 = AO + first bounce ------------------------------------------------------------------------
  let src = 0;
  B0.fill(0);
  B1.fill(0);
  for (let p = 0; p < Q.gather.length; p++) {
    const dst = 1 - src;
    await pool.run(N, CHUNK, { op: 'gather', pass: p, K: Q.gather[p], src, dst });
    const Bd = dst === 0 ? B0 : B1;
    fillInvalid(charts, valid, [{ a: Bd, n: 3 }, ...(p === 0 ? [{ a: AO, n: 1 }, { a: AOS, n: 1 }] : [])]);
    for (let t = 0; t < N; t++) guide[t] = lum([D[t * 3] + Bd[t * 3], D[t * 3 + 1] + Bd[t * 3 + 1], D[t * 3 + 2] + Bd[t * 3 + 2]]) + 0.6 * DL[t];
    denoise(charts, [{ a: Bd, n: 3 }, ...(p === 0 ? [{ a: AO, n: 1 }, { a: AOS, n: 1 }] : [])], guide, 0.9);
    src = dst;
    stamp(`gather pass ${p + 1}/${Q.gather.length} (${Q.gather[p]} rays)`);
  }
  const Bf = src === 0 ? B0 : B1;
  pool.close();

  // ---- compose: ambient (hemisphere × AO) + direct + bounce ---------------------------------------------------------------
  const look = {};
  const vis = new Float32Array(N);
  const secSum = new Float64Array(themes.length);
  const secCnt = new Float64Array(themes.length);
  const posY = new Float32Array(N);
  for (const c of charts) {
    for (let j = 0; j < c.h; j++) {
      for (let i = 0; i < c.w; i++) {
        const t = c.base + j * c.w + i;
        const sv = c.s0 + ((i + 0.5) / c.w) * (c.s1 - c.s0);
        const tv = c.t0 + ((j + 0.5) / c.h) * (c.t1 - c.t0);
        posY[t] = c.sa === 1 ? sv : c.ta === 1 ? tv : c.p;
        const v = (1 - Math.min(1, Math.max(0, (AO[t] - Q.aoRelief) * Q.aoGain)) * Q.aoStrength) * (1 - Math.min(1, AOS[t] * 1.6) * Q.aoContact);
        vis[t] = v;
        secSum[c.section] += v;
        secCnt[c.section]++;
      }
    }
  }
  const secScale = Array.from(secSum, (s, i) => (secCnt[i] > 50 ? Math.min(1.5, Q.aoTarget / (s / secCnt[i])) : 1));
  log('  ambient visibility scale per section: ' + secScale.map((v) => v.toFixed(2)).join(' '));
  const staticE = new Float32Array(N * 3);
  const stats = { maxS: 0, maxL: 0, meanS: 0, meanL: 0, clipS: 0, clipL: 0 };
  for (const c of charts) {
    const nrm = LM_FACE[c.face][0] === 1 ? LM_FACE[c.face][1] : 0;
    for (let j = 0; j < c.h; j++) {
      for (let i = 0; i < c.w; i++) {
        const t = c.base + j * c.w + i;
        lookAt(themes, posY[t], look);
        const v = Math.max(Q.aoFloor, Math.min(1, vis[t] * secScale[c.section]));
        const k = 0.5 + 0.5 * nrm;
        for (let ch = 0; ch < 3; ch++) {
          const amb = (look.ground[ch] + (look.sky[ch] - look.ground[ch]) * k) * look.hemiK * v * Q.ambientGain;
          staticE[t * 3 + ch] = amb + D[t * 3 + ch] + Bf[t * 3 + ch] * Q.bounceGain;
        }
      }
    }
  }
  // ---- encode + atlas ---------------------------------------------------------------------------------------------------
  const [PW, PH] = LM_PAGE;
  const g = cfg.gutter;
  const pagesData = pack.pages.map(() => new Uint8Array(PW * PH * 4));
  // deterministic dither (±½ level) breaks the banding of the 8-bit sqrt encoding in smooth gradients
  const dith = (t, ch) => ((Math.imul(t * 4 + ch + 1, 0x9e3779b1) ^ Math.imul(t + 0x7f4a7c15, 0x85ebca6b)) >>> 8) / 16777216 - 0.5;
  const enc = (e, range, t, ch) => Math.min(255, Math.max(0, Math.round(255 * Math.sqrt(Math.min(1, Math.max(0, e / range))) + dith(t, ch))));
  for (const c of charts) {
    const pd = pagesData[c.page];
    for (let y = -g; y < c.h + g; y++) {
      const cy = Math.min(c.h - 1, Math.max(0, y));
      for (let x = -g; x < c.w + g; x++) {
        const cx = Math.min(c.w - 1, Math.max(0, x));
        const t = c.base + cy * c.w + cx;
        const o = ((c.py + y) * PW + c.px + x) * 4;
        const r = staticE[t * 3];
        const gg = staticE[t * 3 + 1];
        const b = staticE[t * 3 + 2];
        const l = DL[t];
        pd[o] = enc(r, LM_RANGE_STATIC, t, 0);
        pd[o + 1] = enc(gg, LM_RANGE_STATIC, t, 1);
        pd[o + 2] = enc(b, LM_RANGE_STATIC, t, 2);
        pd[o + 3] = enc(l, LM_RANGE_LAMP, t, 3);
        if (x >= 0 && x < c.w && y >= 0 && y < c.h) {
          stats.meanS += (r + gg + b) / 3;
          stats.meanL += l;
          stats.maxS = Math.max(stats.maxS, r, gg, b);
          stats.maxL = Math.max(stats.maxL, l);
          if (Math.max(r, gg, b) > LM_RANGE_STATIC) stats.clipS++;
          if (l > LM_RANGE_LAMP) stats.clipL++;
        }
      }
    }
  }
  stats.meanS /= N;
  stats.meanL /= N;
  stamp(`composed: mean static E ${stats.meanS.toFixed(3)}, mean lamp E ${stats.meanL.toFixed(3)}, max ${stats.maxS.toFixed(2)} / ${stats.maxL.toFixed(2)}, clipped ${stats.clipS} / ${stats.clipL}`);

  // ---- index ----------------------------------------------------------------------------------------------------------
  const coreIds = solids.map((s) => s.id);
  const rows = solids.map(() => new Array(LM_FACES * LM_FACE_FLOATS).fill(0));
  rows.forEach((r) => {
    for (let f = 0; f < LM_FACES; f++) r[f * LM_FACE_FLOATS] = -1;
  });
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  for (const c of charts) {
    const s = solids[c.solid];
    const mn = [s.minX, s.minY, s.minZ];
    const mx = [s.maxX, s.maxY, s.maxZ];
    const S0 = (c.s0 - mn[c.sa]) / (mx[c.sa] - mn[c.sa]);
    const S1 = (c.s1 - mn[c.sa]) / (mx[c.sa] - mn[c.sa]);
    const T0 = (c.t0 - mn[c.ta]) / (mx[c.ta] - mn[c.ta]);
    const T1 = (c.t1 - mn[c.ta]) / (mx[c.ta] - mn[c.ta]);
    rows[c.solid].splice(c.face * LM_FACE_FLOATS, LM_FACE_FLOATS, c.page, r6(c.px / PW), r6(c.py / PH), r6((c.px + c.w) / PW), r6((c.py + c.h) / PH), r6(S0), r6(T0), r6(S1), r6(T1));
  }
  const sectionPages = themes.map((_, si) => [...new Set(charts.filter((c) => c.section === si).map((c) => c.page))].sort((a, b) => a - b));
  const index = {
    format: 'AT3DLM01',
    version: LM_VERSION,
    hash: levelLmHash(level, coreIds),
    page: [PW, PH],
    layers: pack.pages.length,
    ranges: [LM_RANGE_STATIC, LM_RANGE_LAMP],
    pages: pack.pages.map((p, i) => ({ file: lmPageFile(i), sections: p.sections })),
    sections: themes.map((_, si) => ({ lampTint: tintList[si].map(r6), pages: sectionPages[si] })),
    solids: Object.fromEntries(coreIds.map((id, i) => [id, i])),
    rows,
    boxes: Object.fromEntries(solids.map((s) => [s.id, [s.minX, s.minY, s.minZ, s.maxX, s.maxY, s.maxZ].map((v) => Math.round(v * 100))])),
    stats: {
      quality: qname,
      texels: N,
      texelsWithGutters: fit.withGutters,
      charts: charts.length,
      scale: r6(fit.k),
      visibleArea: Math.round(cc.stats.exposedArea),
      pageFill: pack.pages.map((p) => r6(p.used / (PW * PH))),
      meanStatic: r6(stats.meanS),
      meanLamp: r6(stats.meanL),
    },
  };
  stamp('done');
  return { index, pages: pagesData, charts, stats: index.stats, bakeSeconds: (Date.now() - T0) / 1000 };
}

export function packPage(data) {
  const body = zlib.deflateSync(Buffer.from(lmDelta(data)), { level: 9 });
  const out = Buffer.alloc(LM_HEADER_BYTES + body.length);
  writeLmHeader(new DataView(out.buffer, out.byteOffset, LM_HEADER_BYTES), { w: LM_PAGE[0], h: LM_PAGE[1], pages: 1 });
  body.copy(out, LM_HEADER_BYTES);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const argOf = (n, d) => {
    const i = args.indexOf(n);
    return i >= 0 && args[i + 1] ? args[i + 1] : d;
  };
  const outDir = path.resolve(argOf('--out', DEFAULT_OUT));
  const level = new Level3D(LEVEL_DATA_3D, 'normal');
  if (args.includes('--verify')) {
    const idx = JSON.parse(fs.readFileSync(path.join(outDir, LM_INDEX_NAME), 'utf8'));
    const ok = idx.hash === levelLmHash(level, Object.keys(idx.solids));
    console.log(`${outDir}: ${idx.layers} pages, hash ${ok ? 'matches the level' : 'STALE (re-bake)'}`);
    process.exit(ok ? 0 : 1);
  }
  const res = await bakeLightmaps(level, {
    draft: args.includes('--draft'),
    workers: +argOf('--workers', 0) || undefined,
    budget: +argOf('--budget', 0) || undefined,
    log: (m) => console.log('[bake_lightmaps]', m),
  });
  fs.mkdirSync(outDir, { recursive: true });
  let bytes = 0;
  res.pages.forEach((p, i) => {
    const buf = packPage(p);
    bytes += buf.length;
    fs.writeFileSync(path.join(outDir, lmPageFile(i)), buf);
  });
  fs.writeFileSync(path.join(outDir, LM_INDEX_NAME), JSON.stringify(res.index));
  console.log(`[bake_lightmaps] wrote ${res.pages.length} pages (${(bytes / 1048576).toFixed(1)} MiB on disk, ${(res.pages.length * LM_PAGE[0] * LM_PAGE[1] * 4 / 1048576).toFixed(0)} MiB of GPU memory) + index to ${outDir} in ${res.bakeSeconds.toFixed(0)} s`);
  const prev = argOf('--preview', '');
  if (prev) {
    fs.mkdirSync(prev, { recursive: true });
    res.pages.forEach((p, i) => {
      const rgb = Buffer.alloc(LM_PAGE[0] * LM_PAGE[1] * 3);
      for (let k = 0; k < LM_PAGE[0] * LM_PAGE[1]; k++) {
        // preview: static irradiance as stored (sqrt ≈ display), lamp channel added in amber
        const l = (p[k * 4 + 3] / 255) ** 2 * 2;
        rgb[k * 3] = Math.min(255, p[k * 4] + 255 * Math.sqrt(l * 0.8));
        rgb[k * 3 + 1] = Math.min(255, p[k * 4 + 1] + 255 * Math.sqrt(l * 0.4));
        rgb[k * 3 + 2] = Math.min(255, p[k * 4 + 2] + 255 * Math.sqrt(l * 0.1));
      }
      writePng(path.join(prev, `page${i}.png`), LM_PAGE[0], LM_PAGE[1], rgb);
    });
  }
}
