three.js r170 (npm three@0.170.0), MIT License — see LICENSE. Vendored so the WebXR build needs no CDN.

KTX2 / Basis Universal GPU texture support (vendored from the same npm three@0.170.0 package, examples/jsm; used by src/render/materials.js):
  addons/loaders/KTX2Loader.js, addons/utils/WorkerPool.js, addons/math/ColorSpaces.js  - three.js, MIT (see LICENSE)
  addons/libs/ktx-parse.module.js                                                       - ktx-parse by Don McCurdy, MIT
  addons/libs/zstddec.module.js                                                         - zstddec (Zstandard WASM decoder) by Don McCurdy, MIT; contains Zstandard, BSD-3
  addons/libs/basis/basis_transcoder.{js,wasm}                                          - Basis Universal transcoder, Binomial LLC, Apache-2.0
The encoder (ktx2-encoder + basisu WASM) is a build-time tool only: tools/abyssal-tether-3d/encode_ktx2.mjs. Nothing of it ships.

Meshopt geometry compression (WP-GFX-PARITY): addons/libs/meshopt_decoder.module.js is three@0.170.0 examples/jsm/libs/meshopt_decoder.module.js (meshoptimizer by Arseny Kapoulkine, MIT). addons/loaders/GLTFLoader.js is patched in ONE place: the constructor defaults `meshoptDecoder` to it (a 2-line change, marked AT3D), so every GLTFLoader the game creates reads EXT_meshopt_compression; modules still call setMeshoptDecoder explicitly (render/glbLoad.js). The GLBs are compressed by tools/abyssal-tether-3d/compress_glbs.mjs (build-time encoder, not shipped).
