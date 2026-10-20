// Minimal GLB reader for the Node tests: parses the JSON + BIN chunks and returns accessor data, decoding EXT_meshopt_compression
// bufferViews with the game's own vendored decoder (public/abyssal-tether-3d/vendor/three/addons/libs/meshopt_decoder.module.js),
// so the tests read exactly what the browser loads. Accessor values come back RAW (normalised integers stay integers).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MODELS_DIR = path.resolve(HERE, '../../../../public/abyssal-tether-3d/assets/models');
const DECODER = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/vendor/three/addons/libs/meshopt_decoder.module.js')).href;

const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const CT = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array, 5120: Int8Array, 5122: Int16Array };

/** @returns {Promise<{buf: Buffer, js: object, bin: Buffer, size: number, view: (i:number)=>Uint8Array, acc: (i:number)=>TypedArray, meshopt: boolean}>} */
export async function readGLB(file) {
  const buf = fs.readFileSync(file);
  let js = null;
  let bin = null;
  for (let off = 12; off < buf.length; ) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) js = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  const meshopt = (js.extensionsUsed || []).includes('EXT_meshopt_compression');
  let dec = null;
  if (meshopt) {
    dec = (await import(DECODER)).MeshoptDecoder;
    await dec.ready;
  }
  const cache = new Map();
  const view = (i) => {
    if (cache.has(i)) return cache.get(i);
    const bv = js.bufferViews[i];
    let out;
    const mo = bv.extensions && bv.extensions.EXT_meshopt_compression;
    if (mo) {
      out = new Uint8Array(mo.count * mo.byteStride);
      dec.decodeGltfBuffer(out, mo.count, mo.byteStride, bin.subarray(mo.byteOffset || 0, (mo.byteOffset || 0) + mo.byteLength), mo.mode, mo.filter || 'NONE');
    } else {
      out = new Uint8Array(bin.buffer, bin.byteOffset + (bv.byteOffset || 0), bv.byteLength);
    }
    cache.set(i, out);
    return out;
  };
  const acc = (i) => {
    const a = js.accessors[i];
    const bv = js.bufferViews[a.bufferView];
    const T = CT[a.componentType];
    const nc = NC[a.type];
    const data = view(a.bufferView);
    const stride = bv.byteStride || nc * T.BYTES_PER_ELEMENT;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const get = { 5126: 'getFloat32', 5123: 'getUint16', 5125: 'getUint32', 5121: 'getUint8', 5120: 'getInt8', 5122: 'getInt16' }[a.componentType];
    const out = new T(a.count * nc);
    const base = a.byteOffset || 0;
    for (let k = 0; k < a.count; k++) {
      for (let c = 0; c < nc; c++) out[k * nc + c] = dv[get](base + k * stride + c * T.BYTES_PER_ELEMENT, true);
    }
    return out;
  };
  return { buf, js, bin, size: buf.length, view, acc, meshopt };
}
