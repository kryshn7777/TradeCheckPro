/* ABYSSAL TETHER 3D — glbLoad.js
 * One place that creates a GLTFLoader able to read the shipped GLBs, which are geometry-compressed with EXT_meshopt_compression
 * + KHR_mesh_quantization (tools/abyssal-tether-3d/compress_glbs.mjs): the vendored MeshoptDecoder (vendor/three/addons/libs/)
 * is attached with setMeshoptDecoder. The vendored GLTFLoader also defaults to this decoder, so loaders created elsewhere
 * (game.js) read the same files.
 */

/** Resolves a GLTFLoader with the meshopt decoder set (dynamic imports: a missing loader only costs the model). */
export function createGLTFLoader() {
  return Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')]).then(([M, D]) => {
    const loader = new M.GLTFLoader();
    if (D && D.MeshoptDecoder && typeof loader.setMeshoptDecoder === 'function') loader.setMeshoptDecoder(D.MeshoptDecoder);
    return loader;
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
