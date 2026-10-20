/* ABYSSAL TETHER 3D — buildInfo.js
 * Build identity. The source tree is the 'dev' channel; `npm run build:at3d-release` overwrites this file in
 * the dist copy with channel 'release' (no URL mock switches, service worker on every host).
 *
 *   channel  'dev'      source tree / GitHub Pages beta: ?entitlement= mocks, ?sw=1 on localhost
 *            'release'  the store build
 */
export const BUILD = {
  channel: 'dev',
  version: '0.0.0-dev',
  builtAt: null,
  commit: null,
};
