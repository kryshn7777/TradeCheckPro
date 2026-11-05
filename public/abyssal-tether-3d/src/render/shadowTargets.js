/* ABYSSAL TETHER 3D — shadowTargets.js
 * The three-js pieces the two real-time shadows share (lanternShadow.js, auxShadow.js): the hardware-compare depth target, the manually-driven
 * cone camera and the aim that fills its matrices and the world -> map matrix the receivers use.
 */
import * as THREE from 'three';

const _bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _back = new THREE.Vector3();

/** A depth-only target: hardware compare (sampler2DShadow, bilinear = free 2x2 PCF); the colour attachment (R8, writes masked) only exists because a framebuffer needs one. */
export function makeTarget(size, name = 'lanternShadow') {
  const depth = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
  depth.compareFunction = THREE.LessEqualCompare;
  depth.minFilter = THREE.LinearFilter;
  depth.magFilter = THREE.LinearFilter;
  depth.name = name + 'Depth';
  const rt = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RedFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture: depth,
  });
  rt.texture.name = name + 'Color';
  return rt;
}

export function shadowCamera(name = 'LanternShadowCamera') {
  const c = new THREE.PerspectiveCamera();
  c.matrixAutoUpdate = false;
  c.matrixWorldAutoUpdate = false;
  c.name = name;
  return c;
}

/** Aims a shadow camera: apex p, unit axis a, square cone (fit from lanternShadowLogic.coneFit), writes the world -> map matrix into `outM`. */
export function aimShadowCamera(cam, px, py, pz, ax, ay, az, fit, outM) {
  _back.set(-ax, -ay, -az);
  if (Math.abs(ay) > 0.96) _up.set(1, 0, 0);
  else _up.set(0, 1, 0);
  _right.crossVectors(_up, _back).normalize();
  _up.crossVectors(_back, _right).normalize();
  cam.matrixWorld.makeBasis(_right, _up, _back).setPosition(px, py, pz);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  const n = fit.near;
  const t = fit.tanHalf * n;
  cam.near = n;
  cam.far = fit.far;
  cam.projectionMatrix.makePerspective(-t, t, t, -t, n, fit.far);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  outM.copy(_bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
}
