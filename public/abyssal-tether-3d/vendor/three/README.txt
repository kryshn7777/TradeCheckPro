three.js r170 (npm three@0.170.0), MIT License — see LICENSE. Vendored so the WebXR build needs no CDN.

KTX2 / Basis Universal GPU texture support (vendored from the same npm three@0.170.0 package, examples/jsm; used by src/render/materials.js):
  addons/loaders/KTX2Loader.js, addons/utils/WorkerPool.js, addons/math/ColorSpaces.js  - three.js, MIT (see LICENSE)
  addons/libs/ktx-parse.module.js                                                       - ktx-parse by Don McCurdy, MIT
  addons/libs/zstddec.module.js                                                         - zstddec (Zstandard WASM decoder) by Don McCurdy, MIT; contains Zstandard, BSD-3
  addons/libs/basis/basis_transcoder.{js,wasm}                                          - Basis Universal transcoder, Binomial LLC, Apache-2.0
The encoder (ktx2-encoder + basisu WASM) is a build-time tool only: tools/abyssal-tether-3d/encode_ktx2.mjs. Nothing of it ships.
