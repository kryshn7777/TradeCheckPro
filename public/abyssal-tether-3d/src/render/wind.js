/* ABYSSAL TETHER 3D — wind.js
 * The shaft's draught (windAngle / windGust / windSquall) now lives in sim/wind3d.js (LEVEL_FUN_PLAN P6: the gameplay
 * squalls push the body with the same functions the view sways the props and the wisps with). Kept as the view's import
 * path: sceneDetail.js and windGusts.js read the draught from here.
 */
export { windAngle, windGust, windSquall } from '../sim/wind3d.js';
