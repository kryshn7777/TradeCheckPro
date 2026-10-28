/* ABYSSAL TETHER 3D — lightmapFormat.js
 * File formats and shared constants of the baked LIGHTMAPS (assets/lighting/lm_ch1_*), shared by the Node baker
 * (tools/abyssal-tether-3d/bake/bake_lightmaps.mjs), the Node tests and the browser loader (lighting.js). No three.js,
 * no DOM.
 *
 * What a lightmap texel holds (RGBA8, one texture array layer = one 1024² page, no mips, linear filter):
 *   R G B  sqrt-encoded static irradiance:  E = (v/255)² · LM_RANGE_STATIC   (the unit of three's `irradiance`, i.e. what
 *          the hemisphere light used to supply). Contains the ambient fill (hemisphere colours × baked occlusion), the
 *          shaft key light with soft window shadows, the light shafts, the steady lamps and every bounce of all of it.
 *   A      sqrt-encoded FLAME-LAMP DIRECT light, scalar: E = (v/255)² · LM_RANGE_LAMP. The runtime multiplies it by the
 *          section's lamp tint and the lamps' current flicker, so the baked lamp pools still breathe. The lamps'
 *          bounced light is inside RGB (steady, coloured by the walls it bounced from).
 * The static texel never contains the lantern or the pooled dynamic lamps: those stay dynamic. On lightmapped surfaces the
 * pooled lamps are switched off (the bake already holds their direct light, with shadows), the lantern adds on top.
 *
 * Charts: every exposed face of every static solid box is one rectangle (its exposed bounding rectangle) with its own
 * texel density. Face axes (shared with the vertex shader in materials.js): faces 0/1 = +x/−x: s = z, t = y;
 * 2/3 = +y/−y: s = x, t = z; 4/5 = +z/−z: s = x, t = y. (s, t) are normalised to [0, 1] over the whole face. A chart
 * stores the cropped region [s0, s1] × [t0, t1] and the atlas rectangle [u0, v0, u1, v1] (v0 = top row of the page,
 * data row 0 = v 0) it occupies, plus the array layer.
 *
 *   lm_ch1_index.json   { format, version, hash, page: [W, H], layers, ranges, pages: [{ file, sections }], sections:
 *                         [{ lampTint: [r, g, b], pages }], solids: { <id>: row }, rows: [row → 6 faces × [layer, u0, v0,
 *                         u1, v1, s0, t0, s1, t1] flat (layer −1 = no chart)], boxes: { <id>: [minX..maxZ in cm] }, stats }
 *   lm_ch1_pN.bin       header (32 bytes) + zlib(delta-filtered RGBA8 of one page). Pages are packed across sections
 *                       (per-section packing wasted ~45 % of the memory); index.sections[i].pages lists the pages a
 *                       section's charts live on, so a streaming loader can still drop pages no section needs.
 *       0 char[8] 'AT3DLM01', 8 u32 version, 12 u32 W, 16 u32 H, 20 u32 pages, 24 u32 rawLength, 28 u32 codec (1 = zlib+delta)
 */

export const LM_MAGIC = 'AT3DLM01';
export const LM_VERSION = 1;
export const LM_HEADER_BYTES = 32;
export const LM_CODEC_ZLIB_DELTA = 1;
/** Bump when the bake's meaning changes (encoding, light model): old files then count as stale. */
export const LM_BAKE_REV = 3;
/** Decor the bake depends on: light shafts (emitters) and shadow casters. */
export const LM_DECOR_TYPES = new Set(['shaft-light', 'statue', 'machinery', 'cage', 'pipe']);
export const LM_RANGE_STATIC = 4.0;
export const LM_RANGE_LAMP = 8.0;
export const LM_PAGE = [1024, 1024];
export const LM_FACES = 6;
/** floats per face in a chart-table row: layer, u0, v0, u1, v1, s0, t0, s1, t1 */
export const LM_FACE_FLOATS = 9;
export const LM_INDEX_NAME = 'lm_ch1_index.json';
export const lmPageFile = (i) => `lm_ch1_p${i + 1}.bin`;

/**
 * Face table: [axis (0 x, 1 y, 2 z), sign (+1 max side, −1 min side), s axis, t axis].
 */
export const LM_FACE = [
  [0, 1, 2, 1],
  [0, -1, 2, 1],
  [1, 1, 0, 2],
  [1, -1, 0, 2],
  [2, 1, 0, 1],
  [2, -1, 0, 1],
];

const MIN = ['minX', 'minY', 'minZ'];
const MAX = ['maxX', 'maxY', 'maxZ'];
export function faceBox(s, f) {
  const [a, , sa, ta] = LM_FACE[f];
  return { a, sa, ta, s0: s[MIN[sa]], s1: s[MAX[sa]], t0: s[MIN[ta]], t1: s[MAX[ta]], p: LM_FACE[f][1] > 0 ? s[MAX[a]] : s[MIN[a]] };
}

/** Solids that never get a lightmap and never occlude it: crumbling ledges (they fall) and variant-specific pieces. */
export function isCoreSolid(s, rawById) {
  if (!s || s.kind === 'crumble') return false;
  const r = rawById && rawById.get ? rawById.get(s.id) : null;
  if (r && ((Array.isArray(r.omitIn) && r.omitIn.length) || (Array.isArray(r.onlyIn) && r.onlyIn.length))) return false;
  return true;
}

function fnvMixer() {
  let h = 2166136261 >>> 0;
  const byte = (b) => {
    h ^= b & 0xff;
    h = Math.imul(h, 16777619);
  };
  return {
    num(v) {
      const n = Math.round((Number.isFinite(v) ? v : 0) * 100) | 0;
      byte(n);
      byte(n >> 8);
      byte(n >> 16);
      byte(n >> 24);
    },
    str(s) {
      s = String(s == null ? '' : s);
      for (let i = 0; i < s.length; i++) byte(s.charCodeAt(i));
      byte(0);
    },
    get value() {
      return h >>> 0;
    },
  };
}

/**
 * Hash of what the bake depends on: the core solids (ids + boxes, cm), the lights and the light-shaft decor, and
 * LM_BAKE_REV. `coreIds` = the solids that were baked (index.rows keys); levels of other variants carry a few other
 * solids that the hash ignores. Crumbling ledges and the section seals' plates (LEVEL_FUN_PLAN P1; Level3D keeps those in
 * `sealSolids`, not `solids`) come and go at run time: never baked, never hashed.
 */
export function levelLmHash(level, coreIds) {
  const m = fnvMixer();
  m.num(LM_BAKE_REV);
  const solids = (level && level.solids) || [];
  const ids = coreIds ? new Set(coreIds) : null;
  const list = solids.filter((s) => (ids ? ids.has(s.id) : s.kind !== 'crumble' && !s.seal)).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const s of list) {
    m.str(s.id);
    m.num(s.minX);
    m.num(s.minY);
    m.num(s.minZ);
    m.num(s.maxX);
    m.num(s.maxY);
    m.num(s.maxZ);
  }
  for (const l of (level && level.lights) || []) {
    m.num(l.x);
    m.num(l.y);
    m.num(l.z || 0);
    m.num(l.range || 0);
    m.num(l.intensity == null ? 1 : l.intensity);
    m.num(l.flicker ? 1 : 0);
    m.str(l.color);
  }
  // anchors (baked as small glows) differ per variant, so they are not part of the hash: moving one only shifts a glow
  for (const d of (level && level.decor) || []) {
    if (!LM_DECOR_TYPES.has(d.type)) continue; // light shafts (emitters) and the shadow-casting decor
    m.str(d.type);
    m.num(d.x);
    m.num(d.y);
    m.num(d.z);
    m.num(d.sx);
    m.num(d.sy);
    m.num(d.sz);
    m.str(d.color);
  }
  return m.value;
}

export function writeLmHeader(dv, meta) {
  for (let i = 0; i < 8; i++) dv.setUint8(i, LM_MAGIC.charCodeAt(i));
  dv.setUint32(8, LM_VERSION, true);
  dv.setUint32(12, meta.w, true);
  dv.setUint32(16, meta.h, true);
  dv.setUint32(20, meta.pages, true);
  dv.setUint32(24, meta.w * meta.h * 4 * meta.pages, true);
  dv.setUint32(28, LM_CODEC_ZLIB_DELTA, true);
}

export function readLmHeader(buf) {
  if (!buf || buf.byteLength < LM_HEADER_BYTES) return null;
  const dv = new DataView(buf.buffer || buf, buf.byteOffset || 0, LM_HEADER_BYTES);
  for (let i = 0; i < 8; i++) if (dv.getUint8(i) !== LM_MAGIC.charCodeAt(i)) return null;
  if (dv.getUint32(8, true) !== LM_VERSION) return null;
  const w = dv.getUint32(12, true);
  const h = dv.getUint32(16, true);
  const pages = dv.getUint32(20, true);
  const rawLength = dv.getUint32(24, true);
  if (w < 1 || h < 1 || w > 4096 || h > 4096 || pages < 1 || pages > 64 || rawLength !== w * h * 4 * pages) return null;
  return { w, h, pages, rawLength, codec: dv.getUint32(28, true) };
}

/** Delta filter (stride 4, along the row-major pixel order). */
export function lmDelta(raw) {
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = (raw[i] - (i >= 4 ? raw[i - 4] : 0)) & 255;
  return out;
}
export function lmUndelta(bytes) {
  for (let i = 4; i < bytes.length; i++) bytes[i] = (bytes[i] + bytes[i - 4]) & 255;
  return bytes;
}

/** Float32 chart table (LM_FACES × 3 texels × 4 floats per solid row) for the vertex shader, from index.rows. */
export function buildChartTable(rows) {
  const n = Math.max(1, rows.length);
  const w = LM_FACES * 3;
  const data = new Float32Array(w * n * 4);
  for (let r = 0; r < rows.length; r++) {
    for (let f = 0; f < LM_FACES; f++) {
      const q = rows[r].slice(f * LM_FACE_FLOATS, (f + 1) * LM_FACE_FLOATS);
      const o = (r * w + f * 3) * 4;
      // texel 0: atlas rect; texel 1: chart crop in face coordinates; texel 2: layer (−1 = none)
      data[o] = q[1];
      data[o + 1] = q[2];
      data[o + 2] = q[3];
      data[o + 3] = q[4];
      data[o + 4] = q[5];
      data[o + 5] = q[6];
      data[o + 6] = q[7];
      data[o + 7] = q[8];
      data[o + 8] = q[0];
    }
  }
  return { data, width: w, height: n };
}
