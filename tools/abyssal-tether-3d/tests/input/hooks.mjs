// Node module hooks for the input tests: resolve the browser importmap ("three",
// "three/addons/…") to the game's vendored three.js. The vendor URL comes from
// register.mjs (initialize data), so the tests follow --root / AT3D_ROOT.
let vendor = null;
export async function initialize(data) {
  vendor = data && data.vendor;
}
export async function resolve(specifier, context, next) {
  if (vendor && specifier === 'three') return { url: vendor + 'three.module.min.js', shortCircuit: true };
  if (vendor && specifier.startsWith('three/addons/')) return { url: vendor + 'addons/' + specifier.slice('three/addons/'.length), shortCircuit: true };
  return next(specifier, context);
}
