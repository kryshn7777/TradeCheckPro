/* ABYSSAL TETHER 3D — lmTheme.mjs
 * The per-section look the renderer feeds its hemisphere ambient and shaft key (render/renderer3d.js: themeAt,
 * hemi / key colours and intensities), reproduced for the lightmap baker so the baked ambient and key match what the
 * runtime lighting would have produced. All colours are LINEAR RGB (three.js converts hex with sRGB → linear).
 */

export function hexToLinear(hex, fb = '#808080') {
  let h = String(hex || fb).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const ch = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [ch((n >> 16) & 255), ch((n >> 8) & 255), ch(n & 255)];
}

export const THEME_BLEND = 9; // metres either side of a section boundary (renderer3d.js)
export const AMBIENT_SCALE = 3.0;
export const KEY_SCALE = 6.8;
export const KEY_DIR = (() => {
  const v = [-0.45, 1, 0.3];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function parseThemes(level) {
  return level.sections.map((s) => {
    const th = s.theme || {};
    return {
      yTop: isFinite(s.yTop) ? s.yTop : Infinity,
      yBottom: isFinite(s.yBottom) ? s.yBottom : -Infinity,
      light: hexToLinear(th.light, '#6fa3b5'),
      fog: hexToLinear(th.fog, '#1c2125'),
      accent: hexToLinear(th.accent, '#e0a050'),
      ambient: typeof th.ambient === 'number' ? th.ambient : 0.35,
    };
  });
}

export function sectionIndex(themes, y) {
  for (let i = 0; i < themes.length; i++) if (y <= themes[i].yTop && y > themes[i].yBottom) return i;
  return y > themes[0].yTop ? 0 : themes.length - 1;
}

/**
 * Hemisphere + key parameters at height y (blended across section boundaries like Renderer3D.themeAt).
 * @returns {{ sky: number[], ground: number[], hemiK: number, keyCol: number[], keyK: number, section: number }}
 */
export function lookAt(themes, y, out = {}) {
  const i = sectionIndex(themes, y);
  let a = themes[i];
  let b = themes[i];
  let yb = NaN;
  if (i > 0 && isFinite(themes[i].yTop) && y > themes[i].yTop - THEME_BLEND) {
    a = themes[i - 1];
    yb = themes[i].yTop;
  } else if (i < themes.length - 1 && isFinite(themes[i].yBottom) && y < themes[i].yBottom + THEME_BLEND) {
    b = themes[i + 1];
    yb = themes[i].yBottom;
  }
  let w = 0;
  if (a !== b) {
    const t = Math.min(1, Math.max(0, (yb + THEME_BLEND - y) / (2 * THEME_BLEND)));
    w = t * t * (3 - 2 * t);
  }
  const light = lerp3(a.light, b.light, w);
  const fog = lerp3(a.fog, b.fog, w);
  const accent = lerp3(a.accent, b.accent, w);
  const ambient = a.ambient + (b.ambient - a.ambient) * w;
  const grey = (light[0] + light[1] + light[2]) / 3;
  out.sky = lerp3([grey, grey, grey], light, 0.7);
  out.ground = lerp3([fog[0] * 0.9, fog[1] * 0.9, fog[2] * 0.9], accent, 0.06);
  out.hemiK = Math.max(0, ambient) * AMBIENT_SCALE;
  out.keyCol = lerp3([grey, grey, grey], light, 0.55);
  out.keyK = Math.max(0, ambient) * KEY_SCALE;
  out.section = i;
  return out;
}
