/* ABYSSAL TETHER 3D — mason/skitterClone.js (WP-SKITTER)
 * Clones the loaded rigged glTF scene for another view WITHOUT duplicating the download or the GPU geometry: Object3D.clone shares
 * geometries, materials and textures by reference; the skinned meshes are re-bound to cloned bones (like SkeletonUtils.clone,
 * which is not vendored). Call BEFORE the first MasonRigView takes the meshes out of gltf.scene.
 */
import * as THREE from 'three';

export function cloneRigged(source) {
  const clone = source.clone(true);
  const pairs = new Map(); // source node -> clone node
  const walk = (a, b) => {
    pairs.set(a, b);
    for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i]);
  };
  walk(source, clone);
  const back = new Map();
  for (const [a, b] of pairs) back.set(b, a);
  clone.traverse((node) => {
    if (!node.isSkinnedMesh) return;
    const src = back.get(node);
    const bones = src.skeleton.bones.map((b) => pairs.get(b));
    node.skeleton = new THREE.Skeleton(bones, src.skeleton.boneInverses);
    node.bind(node.skeleton, src.bindMatrix);
  });
  return clone;
}
