/* ABYSSAL TETHER 3D — giFormat.js
 * File format of the baked lighting volume (assets/lighting/gi_ch1.bin), shared by the Node bake
 * (tools/abyssal-tether-3d/bake/bake_gi.mjs) and the browser loader (lighting.js). No three.js, no DOM: Node-testable.
 *
 *   header (64 bytes, little endian)
 *     0  char[8]  'AT3DGI01'
 *     8  u32      version (1)
 *     12 u32      dimX, 16 u32 dimY, 20 u32 dimZ
 *     24 f32      minX, minY, minZ   (world position of the volume's corner; voxel i spans [min + i·voxel, min + (i+1)·voxel])
 *     36 f32      sizeX, sizeY, sizeZ (world size)
 *     48 u32      level hash (levelGiHash: solid boxes + lights, so a changed layout disables a stale bake)
 *     52 u32      rawLength (dimX·dimY·dimZ·4)
 *     56 u32      payload codec: 1 = zlib (deflate) of the delta-filtered bytes
 *     60 u32      reserved
 *   payload      zlib stream; bytes are RGBA8, x-fastest, then z, then y (3D texture layer order = y... see below);
 *                delta filter: b[i] = raw[i] - raw[i - 4] (mod 256), so smooth fields deflate well.
 *
 * Voxel channels: R sqrt-encoded static bounce light (irradiance = (R/255)² · 2, the unit of the hemisphere light),
 * G warmth (0 cool .. 1 warm), B visibility of the shaft key light (1 = lit), A ambient occlusion (1 = open).
 * Layout: texture width = dimX, height = dimZ, depth = dimY: index = ((y · dimZ) + z) · dimX + x. The shader samples
 * with ((world − min) / size).xzy.
 */

export const GI_MAGIC = 'AT3DGI01';
export const GI_VERSION = 1;
export const GI_HEADER_BYTES = 64;
export const GI_CODEC_ZLIB_DELTA = 1;

/** Deterministic hash of what the bake depends on (static solids + lights), rounded to cm. FNV-1a over the rounded values. */
export function levelGiHash(level) {
  let h = 2166136261 >>> 0;
  const mix = (v) => {
    const n = Math.round(v * 100) | 0;
    h ^= n & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (n >> 8) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (n >> 16) & 0xff;
    h = Math.imul(h, 16777619);
    h ^= (n >> 24) & 0xff;
    h = Math.imul(h, 16777619);
  };
  const solids = (level && level.solids) || [];
  for (const s of solids) {
    // variant-specific pieces (the Abyss variant drops a solid) do not invalidate the shared bake: only the stable core
    if (s.kind === 'crumble') continue;
    mix(s.minX);
    mix(s.minY);
    mix(s.minZ);
    mix(s.maxX);
    mix(s.maxY);
    mix(s.maxZ);
  }
  const lights = (level && level.lights) || [];
  for (const l of lights) {
    mix(l.x);
    mix(l.y);
    mix(l.z || 0);
    mix(l.range || 0);
  }
  return h >>> 0;
}

/** Writes the 64-byte header into a DataView. */
export function writeHeader(dv, meta) {
  for (let i = 0; i < 8; i++) dv.setUint8(i, GI_MAGIC.charCodeAt(i));
  dv.setUint32(8, GI_VERSION, true);
  dv.setUint32(12, meta.dims[0], true);
  dv.setUint32(16, meta.dims[1], true);
  dv.setUint32(20, meta.dims[2], true);
  for (let i = 0; i < 3; i++) dv.setFloat32(24 + i * 4, meta.min[i], true);
  for (let i = 0; i < 3; i++) dv.setFloat32(36 + i * 4, meta.size[i], true);
  dv.setUint32(48, meta.hash >>> 0, true);
  dv.setUint32(52, meta.dims[0] * meta.dims[1] * meta.dims[2] * 4, true);
  dv.setUint32(56, GI_CODEC_ZLIB_DELTA, true);
  dv.setUint32(60, 0, true);
}

/** Parses the header; returns null when it is not a bake of this format. dims = [x, y, z] world axes. */
export function readHeader(buf) {
  if (!buf || buf.byteLength < GI_HEADER_BYTES) return null;
  const dv = new DataView(buf.buffer || buf, buf.byteOffset || 0, GI_HEADER_BYTES);
  for (let i = 0; i < 8; i++) if (dv.getUint8(i) !== GI_MAGIC.charCodeAt(i)) return null;
  if (dv.getUint32(8, true) !== GI_VERSION) return null;
  const dims = [dv.getUint32(12, true), dv.getUint32(16, true), dv.getUint32(20, true)];
  const min = [dv.getFloat32(24, true), dv.getFloat32(28, true), dv.getFloat32(32, true)];
  const size = [dv.getFloat32(36, true), dv.getFloat32(40, true), dv.getFloat32(44, true)];
  const rawLength = dv.getUint32(52, true);
  if (!dims.every((d) => d > 0 && d <= 512) || rawLength !== dims[0] * dims[1] * dims[2] * 4) return null;
  return { dims, min, size, hash: dv.getUint32(48, true), rawLength, codec: dv.getUint32(56, true) };
}

/** Undoes the delta filter in place (stride 4). */
export function undelta(bytes) {
  for (let i = 4; i < bytes.length; i++) bytes[i] = (bytes[i] + bytes[i - 4]) & 255;
  return bytes;
}

/** Applies the delta filter (stride 4), returning a new array. */
export function delta(raw) {
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = (raw[i] - (i >= 4 ? raw[i - 4] : 0)) & 255;
  return out;
}

/** Index of voxel (x, y, z) in the RGBA8 array (x fastest, then z, then y). */
export function voxelIndex(dims, x, y, z) {
  return ((y * dims[2] + z) * dims[0] + x) * 4;
}
