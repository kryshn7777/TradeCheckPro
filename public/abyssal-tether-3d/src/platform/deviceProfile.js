/* ABYSSAL TETHER 3D — platform/deviceProfile.js
 * WP-TOUCH: what kind of screen this is, in one place (no three.js; every lookup is guarded so Node can import it).
 *   isQuestBrowser()   Meta Quest Browser (VR first: never gets the touch layer or the phone render caps)
 *   isCoarsePrimary()  the primary pointer is a finger (phones, tablets) and this is not a Quest
 *   maxPixelRatio()    the canvas pixel-ratio cap: 1.5 on touch devices (fill-rate), 2 elsewhere
 *   defaultTier()      the automatic lighting tier: 'quest' on Quest, 'low' on phones / tablets, 'high' on desktops;
 *                      bumpDefaultTier('quest') is what ui/perfDiag.js calls when a phone shows frame-rate headroom
 * The user's own qualityTier pin and reducedEffects always win over this default (render/lighting.js _resolve).
 */

let bump = null;

export function isQuestBrowser() {
  try {
    return typeof navigator !== 'undefined' && /OculusBrowser|Quest/i.test(navigator.userAgent || '');
  } catch {
    return false;
  }
}

export function isCoarsePrimary() {
  try {
    if (isQuestBrowser() || typeof window === 'undefined') return false;
    const mm = window.matchMedia;
    if (typeof mm === 'function') {
      if (mm.call(window, '(pointer: coarse)').matches) return true;
      if (mm.call(window, '(pointer: fine)').matches) return false;
    }
    return 'ontouchstart' in window && (navigator.maxTouchPoints || 0) > 0;
  } catch {
    return false;
  }
}

export function isIOS() {
  try {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  } catch {
    return false;
  }
}

/** Pure: the pixel-ratio cap for a device (tests). */
export function pixelRatioCap(dpr, touch) {
  const d = typeof dpr === 'number' && isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.min(d, touch ? 1.5 : 2);
}

export function maxPixelRatio() {
  return pixelRatioCap(typeof window !== 'undefined' ? window.devicePixelRatio : 1, isCoarsePrimary());
}

export function defaultTier() {
  if (bump) return bump;
  if (isQuestBrowser()) return 'quest';
  return isCoarsePrimary() ? 'low' : 'high';
}

/** A phone showed headroom: raise the automatic default one step (never lowers, never touches a user pin). */
export function bumpDefaultTier(tier) {
  if (tier === 'quest' || tier === 'high') bump = tier;
  return defaultTier();
}

/**
 * Pure headroom rule for ui/perfDiag.js: after `windows` consecutive 1 s windows at or above `fps` with the render
 * ratio at its cap, a touch device on the 'low' default may step up to 'quest'.
 */
export function headroomStep({ touch, tier, fps, ratio, cap, good }) {
  if (!touch || tier !== 'low') return false;
  return fps >= 57 && ratio >= cap - 1e-3 && good >= 8;
}
