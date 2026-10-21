/* ABYSSAL TETHER 3D — glbLoad.js
 * One place that creates a GLTFLoader able to read the shipped GLBs, which are
 *  - geometry-compressed with EXT_meshopt_compression + KHR_mesh_quantization (tools/abyssal-tether-3d/compress_glbs.mjs): the vendored
 *    MeshoptDecoder (vendor/three/addons/libs/) is attached with setMeshoptDecoder. The vendored GLTFLoader also defaults to this
 *    decoder, so loaders created elsewhere (game.js) read the same files;
 *  - texture-compressed with KHR_texture_basisu (KTX2 UASTC, tools/abyssal-tether-3d/compress_glb_textures.mjs): a GLB texture costs
 *    1 byte / texel on the GPU (ASTC on Quest) instead of the 4 of a decoded JPEG. attachKTX2(loader) gives a loader the shared KTX2Loader
 *    (vendored Basis transcoder), which needs the renderer's compressed-format support: Renderer3D hands itself over with
 *    setKTX2Renderer(). The transcoder workers are ended a moment after the last GLB finished loading.
 */
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

const BASIS_PATH = (() => {
  try {
    return new URL('../../vendor/three/addons/libs/basis/', import.meta.url).href;
  } catch {
    return null;
  }
})();
const IDLE_DISPOSE_MS = 4000;

let _renderer = null;
let _ktx = null; // live KTX2Loader
let _pending = 0; // GLB loads that may still need the transcoder
let _timer = 0;

/** The WebGLRenderer whose compressed-texture capabilities pick the transcode target (ASTC / BC7 / ETC2). */
export function setKTX2Renderer(renderer) {
  _renderer = renderer || null;
}

function sharedKTX2() {
  if (_ktx) return _ktx;
  if (!_renderer || !BASIS_PATH || typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return null;
  try {
    const l = new KTX2Loader();
    l.setTranscoderPath(BASIS_PATH);
    l.setWorkerLimit(2);
    l.detectSupport(_renderer);
    _ktx = l;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[AT3D] KTX2 unavailable for GLB textures', err && err.message);
  }
  return _ktx;
}

function loadStarted() {
  _pending++;
  if (_timer) {
    clearTimeout(_timer);
    _timer = 0;
  }
}
function loadEnded() {
  if (--_pending > 0 || !_ktx) return;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    _timer = 0;
    if (_pending > 0 || !_ktx) return;
    try {
      _ktx.dispose(); // ends the transcoder workers (their WASM heaps are several MB each); the next GLB builds a fresh loader
    } catch {
      /* nothing */
    }
    _ktx = null;
  }, IDLE_DISPOSE_MS);
}

/**
 * Gives a GLTFLoader (from anywhere) the shared KTX2Loader so KHR_texture_basisu textures decode, and tracks its load() calls so the
 * transcoder workers can be released when the last model is in. Returns the loader.
 */
export function attachKTX2(loader) {
  if (!loader || loader._at3dKtx2 || typeof loader.setKTX2Loader !== 'function') return loader;
  loader._at3dKtx2 = true;
  const ktx = sharedKTX2();
  if (ktx) loader.setKTX2Loader(ktx);
  const load = loader.load.bind(loader);
  loader.load = (url, onLoad, onProgress, onError) => {
    // the KTX2Loader is looked up per load: it may have been disposed after an earlier model
    const k = sharedKTX2();
    if (k) loader.setKTX2Loader(k);
    loadStarted();
    return load(
      url,
      (gltf) => {
        loadEnded();
        if (onLoad) onLoad(gltf);
      },
      onProgress,
      (err) => {
        loadEnded();
        if (onError) onError(err);
      },
    );
  };
  return loader;
}

/** Resolves a GLTFLoader with the meshopt decoder and the KTX2 loader set (dynamic imports: a missing loader only costs the model). */
export function createGLTFLoader() {
  return Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')]).then(([M, D]) => {
    const loader = new M.GLTFLoader();
    if (D && D.MeshoptDecoder && typeof loader.setMeshoptDecoder === 'function') loader.setMeshoptDecoder(D.MeshoptDecoder);
    return attachKTX2(loader);
  });
}

/** Loads one GLB (url) → glTF result. */
export function loadGLB(url) {
  return createGLTFLoader().then(
    (loader) =>
      new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      }),
  );
}
