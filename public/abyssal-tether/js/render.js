/* ABYSSAL TETHER — render.js
 * AT.Renderer: draws one frame of the Underspire from game state on a single
 * Canvas 2D context. Goal: "the player can understand the geometry but cannot
 * completely understand the place".
 *
 * Frame pipeline (back to front):
 *   1. background gradient (section theme, blended across boundaries; deeper = darker)
 *   2. deep + far procedural megastructure (inverted towers, buttresses, cables,
 *      faint windows, cold shaft light) seeded per chunk, far decor, creature.renderFar
 *   3. fog sheets, mid decor (architecture), fog sheets, back particles
 *   4. world: walls/platforms (cached Path2D detail), solid-only darkness pass,
 *      gate, Still Lamp, hazards, anchors, rope, player, creature, front particles
 *   5. near silhouettes (foreground occluders, faded near the screen centre)
 *   6. lighting: low-res darkness buffer with light holes (lantern, lamps, light
 *      shafts, the Still Lamp) + vignette + threat edge tint, blitted once;
 *      additive warm glows
 *   7. above darkness: anchor glyph markers (shape-coded), targeting cue,
 *      creature.renderGlow, lamp cores
 *   8. screen space: death fade, flash, mouse reticle / aim chevron, touch controls
 *
 * Performance rules (measured on CPU-raster Chromium, where they matter most):
 *  - no shadowBlur/filter, no per-frame gradient creation, no 'lighter'
 *    compositing (glows blend source-over toward a light colour: ~4x cheaper,
 *    same look on these dark scenes);
 *  - big soft images are drawn either as exact-size 1:1 integer blits (fog
 *    bands, lantern light/glow, threat tint) or unsmoothed (darkness buffer):
 *    smoothed scaling is ~5x the cost of a 1:1 blit;
 *  - gradients become solid bands (background, masonry depth);
 *  - fine detail lines are 1-device-px hairlines (wide strokes are ~20x the
 *    cost); masonry joints are filled rects;
 *  - static geometry becomes Path2D once; every layer is culled by visibleRect;
 *    scratch arrays/objects are reused (no per-frame allocation in hot paths).
 */
(function (AT) {
  'use strict';

  const U = AT.util;

  // ===========================================================================
  // Tunables
  // ===========================================================================
  const P_DEEP = 0.12; // deepest procedural layer (hazy megastructure)
  const P_FAR_DEFAULT = 0.25;
  const P_MID_DEFAULT = 0.6;
  const P_NEAR_DEFAULT = 1.2;
  const P_FOG_A = 0.42;
  const P_FOG_B = 0.8;
  const P_NEAR_PROC = 1.28; // procedural edge occluders
  const THEME_BLEND = 420; // world units either side of a section boundary
  const LANTERN_R = 300; // lantern light radius (world units)
  const FAR_CHUNK = 760; // layer units per procedural far chunk
  const DEEP_CHUNK = 680;
  const NEAR_CHUNK = 900;
  const FOG_SPACING = 330;
  const FOG_BAND_CSS = 240; // fog band texture height (CSS px)
  const DECOR_MARGIN = 420; // decor may overhang its AABB (chains, sway)
  const MAX_LIGHTS = 48;
  const TINT_PAD = 8;
  const SEAM = 2.4; // masonry joint width (world units) — filled rects, not strokes
  const INTERIOR = 357.5; // masonry deeper than this from its face is drawn as one dark fill
  const ANCHOR_MARK_WORLD = 9; // marker radius in world units (clamped in px)

  // Fill/stroke tone indices used by cached geometry parts.
  const T_BASE = 0;
  const T_DARK = 1;
  const T_RIM = 2;
  const T_METAL = 3;
  const T_RUST = 4;
  const T_VERD = 5;
  const T_BONE = 6;
  const T_GLOW = 7;
  const T_TEXT = 8;
  const T_CARVE = 9;
  const T_SHADE = 10;
  const T_GROWTH = 11;
  const TONE_COUNT = 12;
  const DETAIL_TONES = [T_DARK, T_RIM, T_GLOW, T_CARVE, T_SHADE, T_VERD];
  /** Tones whose strokes are fine detail: drawn as 1-device-px hairlines (≈20x cheaper on CPU raster). */
  const DETAIL_TONE = [];
  for (let i = 0; i < TONE_COUNT; i++) DETAIL_TONE.push(DETAIL_TONES.indexOf(i) >= 0);

  // Base materials (sRGB 0..255).
  const MAT = {
    stone: [60, 56, 51],
    stoneDark: [30, 28, 26],
    iron: [52, 52, 53],
    rust: [122, 59, 34],
    verd: [63, 107, 99],
    bone: [150, 142, 124],
    glow: [184, 240, 224],
    phos: [232, 220, 192],
    amber: [224, 160, 80],
    cyan: [111, 163, 181],
    growth: [64, 52, 46],
    black: [0, 0, 0],
  };

  /** Layer palette recipe: [tone, material, brightness]. */
  const PAL_RECIPE = [
    [T_BASE, MAT.stone, 1],
    [T_DARK, MAT.stoneDark, 0.8],
    [T_RIM, MAT.bone, 1.1],
    [T_METAL, MAT.iron, 1],
    [T_RUST, MAT.rust, 0.8],
    [T_VERD, MAT.verd, 1],
    [T_BONE, MAT.bone, 0.85],
    [T_GLOW, MAT.glow, 1.2],
    [T_TEXT, MAT.phos, 1.2],
    [T_CARVE, MAT.bone, 0.75],
    [T_SHADE, MAT.stoneDark, 0.6],
    [T_GROWTH, MAT.growth, 1],
  ];

  const STILL_LIGHT = [238, 228, 204];
  const FOG_LUM_FLOOR = 38; // minimum luminance of the theme fog (0..255)

  const DASH_CUE = [4, 6];
  const DASH_RING = [3, 4];
  const DASH_NONE = [];

  // ===========================================================================
  // Colour helpers — strings are cached by packed RGB so frames allocate none.
  // ===========================================================================
  const HEX = new Array(256);
  for (let i = 0; i < 256; i++) HEX[i] = (i < 16 ? '0' : '') + i.toString(16);
  const colorCache = new Map();

  function c255(v) {
    return v <= 0 ? 0 : v >= 255 ? 255 : v | 0;
  }
  function rgbStr(r, g, b) {
    r = c255(r);
    g = c255(g);
    b = c255(b);
    const key = (r << 16) | (g << 8) | b;
    let s = colorCache.get(key);
    if (s === undefined) {
      if (colorCache.size > 4096) colorCache.clear();
      s = '#' + HEX[r] + HEX[g] + HEX[b];
      colorCache.set(key, s);
    }
    return s;
  }
  function css(c) {
    return rgbStr(c[0], c[1], c[2]);
  }
  function key3(c) {
    return (c255(c[0]) << 16) | (c255(c[1]) << 8) | c255(c[2]);
  }
  function hexToRgb(hex, fallback) {
    if (typeof hex !== 'string') return fallback.slice();
    let h = hex.trim();
    if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    if (h.length !== 6 || !isFinite(n)) return fallback.slice();
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  /** Parses one of our cached '#rrggbb' strings back into an array (no allocation). */
  function hexDigit(c) {
    return c <= 57 ? c - 48 : (c | 32) - 87; // '0'-'9', 'a'-'f' / 'A'-'F'
  }
  function hexToArr(str, out) {
    // char-code parse: no substring allocation (called every frame)
    for (let i = 0; i < 3; i++) out[i] = hexDigit(str.charCodeAt(1 + i * 2)) * 16 + hexDigit(str.charCodeAt(2 + i * 2));
    return out;
  }
  function mix(out, a, b, t) {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
    return out;
  }
  function scl(out, a, k) {
    out[0] = a[0] * k;
    out[1] = a[1] * k;
    out[2] = a[2] * k;
    return out;
  }
  function finite(v, fb) {
    return typeof v === 'number' && isFinite(v) ? v : fb;
  }
  function seedOf(o) {
    if (o && typeof o.seed === 'number' && isFinite(o.seed)) return o.seed | 0;
    const x = finite(o && o.x, 0);
    const y = finite(o && o.y, 0);
    const w = finite(o && o.w, 0);
    return (U.hash((x * 7.13 + y * 13.7 + w * 3.1) | 0) * 2147483647) | 0;
  }

  // ===========================================================================
  // Canvas / sprite helpers (built once or on resize)
  // ===========================================================================
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  /** Radial sprite; stops: [[t, r, g, b, a], ...]. */
  function radialSprite(size, stops) {
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const half = size / 2;
    const grad = g.createRadialGradient(half, half, 0, half, half, half);
    for (const s of stops) grad.addColorStop(s[0], `rgba(${s[1]},${s[2]},${s[3]},${s[4]})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  function glowStops(col, peak) {
    return [
      [0, col[0], col[1], col[2], peak],
      [0.22, col[0], col[1], col[2], peak * 0.62],
      [0.5, col[0], col[1], col[2], peak * 0.24],
      [0.78, col[0], col[1], col[2], peak * 0.06],
      [1, col[0], col[1], col[2], 0],
    ];
  }

  /** Soft vertical beam (white), fading at both ends and to the sides. */
  function beamSprite(col, peak) {
    const w = 64;
    const h = 256;
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    const gx = g.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    gx.addColorStop(0.3, `rgba(${col[0]},${col[1]},${col[2]},${peak * 0.55})`);
    gx.addColorStop(0.5, `rgba(${col[0]},${col[1]},${col[2]},${peak})`);
    gx.addColorStop(0.7, `rgba(${col[0]},${col[1]},${col[2]},${peak * 0.55})`);
    gx.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    g.fillStyle = gx;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const gy = g.createLinearGradient(0, 0, 0, h);
    gy.addColorStop(0, 'rgba(0,0,0,0)');
    gy.addColorStop(0.18, 'rgba(0,0,0,1)');
    gy.addColorStop(0.7, 'rgba(0,0,0,0.85)');
    gy.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gy;
    g.fillRect(0, 0, w, h);
    return c;
  }

  /** Elliptical edge ring (vignette / tint) covering the whole canvas. */
  function edgeCanvas(w, h, col, inner, peak) {
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    g.setTransform(c.width / 2, 0, 0, c.height / 2, c.width / 2, c.height / 2);
    const grad = g.createRadialGradient(0, 0, inner, 0, 0, 1.42);
    grad.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    grad.addColorStop(0.35, `rgba(${col[0]},${col[1]},${col[2]},${peak * 0.18})`);
    grad.addColorStop(0.7, `rgba(${col[0]},${col[1]},${col[2]},${peak * 0.62})`);
    grad.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},${peak})`);
    g.fillStyle = grad;
    g.fillRect(-1, -1, 2, 2);
    return c;
  }

  // ===========================================================================
  // Geometry part helpers. A "parts" object is built once per static item:
  //   { list: [{ path, tone, w, a, xf }], light, text, beam }
  // w = 0 → fill, else stroke width (layer units). xf = optional animated
  // transform { x, y, swing, spd, ph, rot, flip }.
  // ===========================================================================
  function P() {
    return new Path2D();
  }
  function part(list, path, tone, w, a, xf) {
    list.push({ path, tone, w: w || 0, a: a == null ? 1 : a, xf: xf || null });
  }
  /** Downward-pointing triangle (positive winding in screen space). */
  function triDown(p, x, y, w, h) {
    p.moveTo(x, y);
    p.lineTo(x + w, y);
    p.lineTo(x + w * 0.5, y + h);
    p.closePath();
  }
  function triUp(p, x, y, w, h) {
    // base at y, apex at y - h; still clockwise on screen.
    p.moveTo(x + w * 0.5, y - h);
    p.lineTo(x + w, y);
    p.lineTo(x, y);
    p.closePath();
  }
  function ring(p, x, y, r) {
    p.moveTo(x + r, y);
    p.arc(x, y, r, 0, Math.PI * 2);
  }
  /** Maps unit (u, v) coordinates of a rect into layer space (optionally flipped vertically). */
  function pen(d, flip) {
    const x = d.x;
    const y = d.y;
    const w = d.w;
    const h = d.h;
    return {
      X: (u) => x + u * w,
      Y: flip ? (v) => y + (1 - v) * h : (v) => y + v * h,
    };
  }

  // ---------------------------------------------------------------------------
  // Procedural megastructure pieces (far + deep layers)
  // ---------------------------------------------------------------------------
  /**
   * An inverted tower hanging from the dark above: a narrow neck (drawn in the
   * hazier tone so it recedes upward into fog), a flared collar, tiers that
   * narrow toward a downward spire, pendant pinnacles and window slits.
   * Returns the y of the spire tip.
   */
  function addInvertedTower(neck, fill, win, lights, r, cx, yTop, w, len, litChance) {
    const nw = w * (0.32 + r() * 0.18);
    neck.rect(cx - nw * 0.5, yTop - 760, nw, 760);
    // ring collars on the neck
    for (let y = yTop - 120 - r() * 140; y > yTop - 700; y -= 150 + r() * 160) neck.rect(cx - nw * 0.62, y, nw * 1.24, 7);
    // flared collar (clockwise: top edge left→right first)
    const ch = w * 0.4;
    fill.moveTo(cx - nw * 0.5, yTop - ch);
    fill.lineTo(cx + nw * 0.5, yTop - ch);
    fill.lineTo(cx + w * 0.5, yTop);
    fill.lineTo(cx - w * 0.5, yTop);
    fill.closePath();
    let y = yTop;
    let cw = w;
    const tiers = 2 + Math.floor(r() * 3);
    const bodyLen = len * 0.7;
    for (let i = 0; i < tiers; i++) {
      const th = (bodyLen / tiers) * (0.75 + r() * 0.5);
      const fl = cw * 0.09;
      const fh = Math.max(5, th * 0.07);
      fill.rect(cx - cw * 0.5 - fl, y, cw + fl * 2, fh); // ledge
      fill.rect(cx - cw * 0.5, y, cw, th);
      // little pendant pinnacles under the ledge corners
      triDown(fill, cx - cw * 0.5 - fl, y + fh, fl * 1.6, th * (0.25 + r() * 0.25));
      triDown(fill, cx + cw * 0.5 + fl - fl * 1.6, y + fh, fl * 1.6, th * (0.25 + r() * 0.25));
      // window slits (a lighter tone), rare lit ones
      const nW = Math.max(1, Math.floor(cw / 30));
      const ww = Math.max(3, cw * 0.06);
      for (let j = 0; j < nW; j++) {
        if (r() < 0.4) continue;
        const wx = cx - cw * 0.5 + ((j + 0.5) / nW) * cw - ww * 0.5;
        const wy = y + fh + th * 0.16;
        const wh = th * (0.3 + r() * 0.35);
        win.rect(wx, wy, ww, wh);
        if (r() < litChance) lights.push(wx + ww * 0.5, wy + wh * 0.5, Math.max(ww, 4) * 1.2, r() * 10);
      }
      y += th;
      cw *= 0.64 + r() * 0.16;
    }
    fill.moveTo(cx - cw * 0.5, y);
    fill.lineTo(cx + cw * 0.5, y);
    fill.lineTo(cx, y + len * 0.3);
    fill.closePath();
    return y + len * 0.3;
  }

  /** A gallery: a long horizontal band of masonry with pendant lobes and window slits. */
  function addGallery(fill, win, lights, r, xa, xb, y, thick) {
    fill.rect(xa, y, xb - xa, thick);
    fill.rect(xa - thick * 0.3, y - thick * 0.25, xb - xa + thick * 0.6, thick * 0.25);
    const bay = thick * (2.4 + r() * 1.2);
    for (let x = xa + bay * 0.2; x < xb - bay * 0.6; x += bay) {
      if (r() < 0.25) continue; // fallen away
      // a pendant lobe (upside-down arch crown), each a little different
      const bw = bay * (0.6 + r() * 0.25);
      const drop = thick * (1.6 + r() * 1.6);
      fill.moveTo(x, y + thick);
      fill.lineTo(x + bw, y + thick);
      fill.quadraticCurveTo(x + bw, y + thick + drop * 0.8, x + bw * 0.5, y + thick + drop);
      fill.quadraticCurveTo(x, y + thick + drop * 0.8, x, y + thick);
      fill.closePath();
      if (r() < 0.5) {
        win.rect(x + bay * 0.33, y + thick * 0.25, bay * 0.14, thick * 0.5);
        if (r() < 0.08) lights.push(x + bay * 0.4, y + thick * 0.5, thick * 0.3, r() * 10);
      }
    }
  }

  /**
   * A quadratic "stroke" turned into a filled, tapering band (fills are far
   * cheaper than wide strokes on CPU raster, and the taper reads as masonry).
   */
  function addBand(fill, x0, y0, cx, cy, x1, y1, w0, w1) {
    const N = 10;
    const L = [];
    const R = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const mt = 1 - t;
      const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
      const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
      const dx = 2 * mt * (cx - x0) + 2 * t * (x1 - cx);
      const dy = 2 * mt * (cy - y0) + 2 * t * (y1 - cy);
      const dl = Math.hypot(dx, dy) || 1;
      const hw = (w0 + (w1 - w0) * t) * 0.5;
      L.push(x - (dy / dl) * hw, y + (dx / dl) * hw);
      R.push(x + (dy / dl) * hw, y - (dx / dl) * hw);
    }
    // winding: whichever, as long as the band does not self-overlap a sibling
    // shape with the opposite direction — compute and normalise.
    let area = 0;
    const pts = [];
    for (let i = 0; i < L.length; i += 2) pts.push(L[i], L[i + 1]);
    for (let i = R.length - 2; i >= 0; i -= 2) pts.push(R[i], R[i + 1]);
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
    }
    for (let k = 0; k < n; k++) {
      const i = area >= 0 ? k : n - 1 - k;
      if (k === 0) fill.moveTo(pts[i * 2], pts[i * 2 + 1]);
      else fill.lineTo(pts[i * 2], pts[i * 2 + 1]);
    }
    fill.closePath();
  }

  function addCable(stroke, xa, ya, xb, yb, sag) {
    stroke.moveTo(xa, ya);
    stroke.quadraticCurveTo((xa + xb) * 0.5, Math.max(ya, yb) + sag * 2, xb, yb);
  }

  /**
   * Builds one procedural chunk (layer space): a hazy tone (necks, distant
   * bits), a body tone, three stroke widths, window cut-outs, point lights and
   * light beams. Seeded by chunk index → identical every visit.
   */
  function buildMegaChunk(k, chunkH, centerX, span, seed, deep) {
    const r = U.rng((((seed + 1) * 2654435761) ^ Math.imul(k + 7919, 40503)) >>> 0);
    const ch = {
      k,
      fills: [P(), P()],
      strokes: [P()],
      windows: P(),
      lights: [],
      beams: [],
    };
    const y0 = k * chunkH;
    const slots = deep ? 4 : 6;
    const slotW = (span * 2) / slots;
    const scale = deep ? 1.5 : 1;
    for (let s = 0; s < slots; s++) {
      const roll = r();
      const cx = centerX - span + slotW * (s + 0.2 + r() * 0.6);
      if (roll < 0.22) {
        const w = (70 + r() * 110) * scale;
        const len = (380 + r() * 700) * scale;
        const top = y0 + r() * chunkH * 0.8;
        const end = addInvertedTower(ch.fills[0], ch.fills[1], ch.windows, ch.lights, r, cx, top, w, len, deep ? 0.05 : 0.09);
        if (r() < 0.5) {
          // flying buttress from the tower out into the void
          const side = r() < 0.5 ? -1 : 1;
          const sx = cx + side * w * 0.4;
          const sy = top + (end - top) * (0.1 + r() * 0.3);
          const ex = sx + side * (220 + r() * 420) * scale;
          const ey = sy - (100 + r() * 300) * scale;
          const bw = (r() < 0.5 ? 18 : 10) * scale;
          addBand(ch.fills[1], sx, sy, sx + (ex - sx) * 0.1, ey + 30, ex, ey, bw * 1.6, bw * 0.7);
        }
      } else if (roll < 0.3) {
        // galleries are rare and hazy (they read as a repeating border otherwise)
        const half = (140 + r() * 300) * scale;
        addGallery(ch.fills[0], ch.windows, ch.lights, r, cx - half, cx + half, y0 + r() * chunkH, (deep ? 26 : 14) + r() * 12);
      } else if (roll < 0.56) {
        // hanging cables / chains across the void
        const xa = cx - (200 + r() * 400) * scale;
        const xb = cx + (200 + r() * 400) * scale;
        const ya = y0 + r() * chunkH;
        addCable(ch.strokes[0], xa, ya, xb, ya + (r() * 2 - 1) * 120, 60 + r() * 200);
        if (r() < 0.5) addCable(ch.strokes[0], xa + 30, ya + 18, xb - 40, ya + 30, 80 + r() * 200);
      } else if (roll < 0.64) {
        // a lone pendant column with a broken end
        const w = (16 + r() * 30) * scale;
        const top = y0 + r() * chunkH * 0.5;
        const len = 200 + r() * 500;
        ch.fills[0].rect(cx - w * 0.5, top - 500, w, 500);
        ch.fills[1].rect(cx - w * 0.5, top, w, len);
        triDown(ch.fills[1], cx - w * 0.5, top + len, w, w * (0.8 + r()));
      } else if (roll < 0.72) {
        // a great rib: a curved structural arc rising from far below
        const side = r() < 0.5 ? -1 : 1;
        const bx = cx;
        const by = y0 + chunkH * (0.5 + r() * 0.5);
        const rw = (20 + r() * 12) * scale;
        addBand(ch.fills[1], bx, by + 300, bx, by - 260 * scale, bx + side * (300 + r() * 300) * scale, by - (300 + r() * 200) * scale, rw * 1.4, rw * 0.6);
      } else if (deep && r() < 0.35) {
        // far-above cold light falling through a breach
        ch.beams.push(cx, y0 + r() * chunkH * 0.5, 70 + r() * 160, 1400 + r() * 900);
      }
      // distant pinprick lights (lanterns nobody tends)
      if (r() < (deep ? 0.22 : 0.16)) ch.lights.push(cx + (r() * 2 - 1) * slotW * 0.5, y0 + r() * chunkH, 2 + r() * 2.5, r() * 10);
    }
    return ch;
  }

  /** Foreground edge occluders (procedural; screen edges only). */
  function buildNearChunk(k, seed, leftX, rightX) {
    const r = U.rng((((seed + 77) * 2246822519) ^ Math.imul(k + 31, 3266489917)) >>> 0);
    const fill = P();
    const stroke = P();
    const y0 = k * NEAR_CHUNK;
    for (let side = -1; side <= 1; side += 2) {
      if (r() < 0.45) continue;
      const bx = side < 0 ? leftX : rightX;
      const y = y0 + r() * NEAR_CHUNK;
      const kind = r();
      if (kind < 0.45) {
        // jutting masonry chunk
        const w = 120 + r() * 160;
        const h = 60 + r() * 140;
        const x = side < 0 ? bx - w * 0.4 : bx - w * 0.6;
        fill.moveTo(x, y);
        fill.lineTo(x + w, y + r() * 20);
        fill.lineTo(x + w * (0.8 + r() * 0.2), y + h);
        fill.lineTo(x + w * 0.2, y + h * (0.7 + r() * 0.3));
        fill.closePath();
      } else if (kind < 0.8) {
        // dangling chain
        const x = bx + side * -(20 + r() * 80);
        const len = 220 + r() * 520;
        stroke.moveTo(x, y - 600);
        stroke.lineTo(x + (r() * 2 - 1) * 10, y + len);
      } else {
        // girder stub
        const w = 160 + r() * 200;
        const x = side < 0 ? bx - w * 0.5 : bx - w * 0.5;
        fill.rect(x, y, w, 18 + r() * 14);
      }
    }
    return { k, fill, stroke };
  }

  // ---------------------------------------------------------------------------
  // Decor builders (contract vocabulary). All coordinates in the item's layer space.
  // ---------------------------------------------------------------------------
  const DECOR_BUILDERS = {
    pillar(d, r) {
      const L = [];
      const { x, y, w, h } = d;
      const body = P();
      const flute = P();
      const rim = P();
      const metal = P();
      const sw = w * 0.74;
      const sx = x + (w - sw) / 2;
      const capH = Math.min(h * 0.08, w * 0.7);
      const broken = r() < 0.35;
      // Inverted order: the heavy plinth is at the TOP (they built downward).
      body.rect(x, y, w, capH);
      body.rect(x + w * 0.06, y + capH, w * 0.88, capH * 0.45);
      let by = y + h - capH * 1.6;
      if (broken) {
        by = y + h * (0.62 + r() * 0.3);
        body.moveTo(sx, y + capH);
        body.lineTo(sx + sw, y + capH);
        body.lineTo(sx + sw, by);
        const teeth = 4 + Math.floor(r() * 3);
        for (let i = teeth; i >= 0; i--) body.lineTo(sx + (sw * i) / teeth, by + (r() - 0.25) * sw * 0.45);
        body.closePath();
      } else {
        body.rect(sx, y + capH, sw, h - capH * 2);
        body.moveTo(sx, by);
        body.lineTo(sx + sw, by);
        body.lineTo(x + w, y + h - capH * 0.5);
        body.lineTo(x, y + h - capH * 0.5);
        body.closePath();
        body.rect(x, y + h - capH * 0.5, w, capH * 0.5);
      }
      for (let i = 1; i < 4; i++) {
        const fx = sx + (sw * i) / 4;
        flute.moveTo(fx, y + capH * 1.6);
        flute.lineTo(fx, by - 6);
      }
      const nb = 1 + Math.floor(r() * 3);
      for (let i = 0; i < nb; i++) {
        const yy = y + capH * 2 + (by - y - capH * 3) * r();
        metal.rect(sx - 2, yy, sw + 4, Math.max(4, w * 0.07));
      }
      rim.moveTo(sx + 1, y + capH * 1.5);
      rim.lineTo(sx + 1, by);
      part(L, body, T_BASE);
      part(L, metal, T_METAL);
      part(L, flute, T_DARK, Math.max(1.5, w * 0.035), 0.8);
      part(L, rim, T_RIM, Math.max(1.2, w * 0.03), 0.55);
      return { list: L };
    },

    arch(d, r) {
      const L = [];
      const w = d.w;
      const inv = r() < 0.4; // some arches hang upside down
      const p = pen(d, inv);
      const t = Math.min(0.16, 34 / Math.max(w, 1)) * 1.0 + 0.04;
      const spring = 0.42;
      const body = P();
      const vouss = P();
      // outer silhouette (clockwise in unit space; flip keeps fills consistent)
      body.moveTo(p.X(0), p.Y(1));
      body.lineTo(p.X(0), p.Y(spring));
      body.quadraticCurveTo(p.X(0.02), p.Y(0.04), p.X(0.5), p.Y(0));
      body.quadraticCurveTo(p.X(0.98), p.Y(0.04), p.X(1), p.Y(spring));
      body.lineTo(p.X(1), p.Y(1));
      body.lineTo(p.X(1 - t), p.Y(1));
      body.lineTo(p.X(1 - t), p.Y(spring + 0.03));
      body.quadraticCurveTo(p.X(1 - t - 0.02), p.Y(0.06 + t), p.X(0.5), p.Y(0.07 + t * 0.9));
      body.quadraticCurveTo(p.X(t + 0.02), p.Y(0.06 + t), p.X(t), p.Y(spring + 0.03));
      body.lineTo(p.X(t), p.Y(1));
      body.closePath();
      // voussoir joints
      for (let i = 1; i < 9; i++) {
        const u = (i / 9) * 0.9 + 0.05;
        const v0 = 0.04 + Math.pow(Math.abs(u - 0.5) * 2, 2) * (spring - 0.04);
        voussLine(vouss, p, u, v0, t);
      }
      // keystone
      const ks = P();
      ks.rect(Math.min(p.X(0.47), p.X(0.53)), Math.min(p.Y(0), p.Y(0.09 + t)), Math.abs(p.X(0.53) - p.X(0.47)), Math.abs(p.Y(0.09 + t) - p.Y(0)));
      part(L, body, T_BASE);
      part(L, ks, T_SHADE, 0, 0.8);
      part(L, vouss, T_DARK, Math.max(1.2, w * 0.006), 0.8);
      if (r() < 0.5) {
        // hanging growth from the arch
        const g = P();
        const n = 2 + Math.floor(r() * 4);
        for (let i = 0; i < n; i++) {
          const u = 0.15 + r() * 0.7;
          const v = 0.06 + Math.pow(Math.abs(u - 0.5) * 2, 2) * spring;
          g.moveTo(p.X(u), p.Y(v + t));
          g.quadraticCurveTo(p.X(u + 0.03), p.Y(v + t + 0.15), p.X(u + (r() - 0.5) * 0.05), p.Y(v + t + 0.1 + r() * 0.3));
        }
        part(L, g, T_GROWTH, Math.max(1.5, w * 0.008), 0.9);
      }
      return { list: L };
    },

    chain(d, r) {
      const L = [];
      const len = finite(d.len, d.h);
      const cx = d.x + d.w * 0.5;
      const lh = U.clamp(d.w * 0.55, 6, 26); // link height
      const lw = lh * 0.55;
      // links as filled bars (face-on links show both sides, edge-on links one bar)
      const face = P();
      const edge = P();
      const bar = Math.max(1.2, lh * 0.2);
      let y = 0;
      let i = 0;
      while (y < len && i < 400) {
        if (i % 2 === 0) {
          face.rect(-lw * 0.5, y, bar, lh);
          face.rect(lw * 0.5 - bar, y, bar, lh);
          face.rect(-lw * 0.5, y, lw, bar);
          face.rect(-lw * 0.5, y + lh - bar, lw, bar);
        } else {
          edge.rect(-bar * 0.6, y - lh * 0.1, bar * 1.2, lh * 1.2);
        }
        y += lh * 0.78;
        i++;
      }
      // a hook or a broken end
      const end = P();
      if (r() < 0.5) {
        end.moveTo(0, y);
        end.lineTo(0, y + lh);
        end.arc(-lh * 0.6, y + lh, lh * 0.6, 0, Math.PI * 0.95);
      }
      const xf = { x: cx, y: d.y, swing: 0.02 + Math.min(0.03, 30 / Math.max(len, 1)), spd: 0.5 + r() * 0.5, ph: r() * 6.28 };
      part(L, face, T_METAL, 0, 1, xf);
      part(L, edge, T_METAL, 0, 1, xf);
      part(L, end, T_RUST, Math.max(1.4, lh * 0.26), 1, xf);
      return { list: L };
    },

    'broken-bridge'(d, r) {
      const L = [];
      const { x, y, w, h } = d;
      const th = U.clamp(h * 0.3, 8, 40);
      const deck = P();
      const truss = P();
      const hang = P();
      const gapA = x + w * (0.36 + r() * 0.1);
      const gapB = x + w * (0.58 + r() * 0.1);
      // left span with jagged end
      deck.moveTo(x, y);
      deck.lineTo(gapA, y);
      deck.lineTo(gapA - th * 0.4, y + th * 0.5);
      deck.lineTo(gapA + th * 0.2, y + th * 0.7);
      deck.lineTo(gapA - th * 0.6, y + th);
      deck.lineTo(x, y + th);
      deck.closePath();
      // right span
      deck.moveTo(gapB, y + th * 0.1);
      deck.lineTo(x + w, y);
      deck.lineTo(x + w, y + th);
      deck.lineTo(gapB + th * 0.5, y + th);
      deck.lineTo(gapB - th * 0.3, y + th * 0.55);
      deck.closePath();
      // railing posts + under-truss
      for (let px = x + 12; px < x + w - 6; px += 26 + r() * 10) {
        if (px > gapA - 6 && px < gapB + 6) continue;
        truss.moveTo(px, y);
        truss.lineTo(px, y - th * 1.4);
        truss.moveTo(px, y + th);
        truss.lineTo(px + 14, y + th + Math.min(h - th, th * 2));
      }
      // dangling planks / cables from the break
      for (let i = 0; i < 3; i++) {
        const ax = gapA - th * (0.3 + i * 0.4);
        hang.moveTo(ax, y + th);
        hang.quadraticCurveTo(ax + 6, y + th + 50, ax - 4 + r() * 10, y + th + 40 + r() * Math.max(30, h));
        const bx = gapB + th * (0.2 + i * 0.4);
        hang.moveTo(bx, y + th);
        hang.lineTo(bx + (r() - 0.5) * 12, y + th + 30 + r() * Math.max(30, h * 0.8));
      }
      part(L, deck, T_BASE);
      part(L, truss, T_METAL, Math.max(1.6, th * 0.18));
      part(L, hang, T_RUST, Math.max(1.2, th * 0.12), 0.9);
      return { list: L };
    },

    girder(d, r) {
      const L = [];
      const { x, y, w, h } = d;
      const vertical = h > w * 1.6;
      const body = P();
      const web = P();
      const rivets = P();
      const len = vertical ? h : w;
      const dep = vertical ? w : h;
      const fl = Math.max(3, dep * 0.16);
      const cell = Math.max(dep * 1.1, 18);
      const map = vertical ? (a, b) => [x + b, y + a] : (a, b) => [x + a, y + b];
      const rect = (a0, b0, a1, b1) => {
        const p0 = map(a0, b0);
        const p1 = map(a1, b1);
        body.rect(Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.abs(p1[0] - p0[0]), Math.abs(p1[1] - p0[1]));
      };
      rect(0, 0, len, fl);
      rect(0, dep - fl, len, dep);
      let a = 0;
      let up = true;
      while (a < len - 1) {
        const a2 = Math.min(len, a + cell);
        const s = map(a, up ? fl : dep - fl);
        const e = map(a2, up ? dep - fl : fl);
        web.moveTo(s[0], s[1]);
        web.lineTo(e[0], e[1]);
        const rv = map(a, fl * 0.5);
        rivets.moveTo(rv[0] + 1.6, rv[1]);
        rivets.arc(rv[0], rv[1], 1.6, 0, Math.PI * 2);
        a = a2;
        up = !up;
      }
      part(L, body, T_METAL);
      part(L, web, T_METAL, Math.max(1.5, dep * 0.1));
      part(L, rivets, T_RIM, 0, 0.5);
      if (r() < 0.5) {
        const st = P();
        for (let i = 0; i < 3; i++) {
          const p0 = map(r() * len, dep);
          st.moveTo(p0[0], p0[1]);
          st.lineTo(p0[0] + (vertical ? 0 : 1), p0[1] + 10 + r() * 30);
        }
        part(L, st, T_VERD, 1.5, 0.6);
      }
      return { list: L };
    },

    pipe(d, r) {
      const L = [];
      const { x, y, w, h } = d;
      const horiz = w >= h;
      const body = P();
      const flange = P();
      const hi = P();
      const patina = P();
      const dia = horiz ? h : w;
      if (horiz) {
        body.rect(x, y + dia * 0.1, w, dia * 0.8);
        hi.moveTo(x, y + dia * 0.25);
        hi.lineTo(x + w, y + dia * 0.25);
        for (let fx = x + 30 + r() * 40; fx < x + w - 10; fx += 70 + r() * 90) flange.rect(fx, y, dia * 0.35, dia);
        for (let i = 0; i < 3; i++) patina.rect(x + r() * w, y + dia * 0.55, 20 + r() * 50, dia * 0.35);
      } else {
        body.rect(x + dia * 0.1, y, dia * 0.8, h);
        hi.moveTo(x + dia * 0.28, y);
        hi.lineTo(x + dia * 0.28, y + h);
        for (let fy = y + 30 + r() * 40; fy < y + h - 10; fy += 70 + r() * 90) flange.rect(x, fy, dia, dia * 0.35);
        for (let i = 0; i < 3; i++) patina.rect(x + dia * 0.5, y + r() * h, dia * 0.4, 20 + r() * 50);
      }
      part(L, body, T_METAL);
      part(L, patina, T_VERD, 0, 0.45);
      part(L, flange, T_SHADE);
      part(L, hi, T_RIM, Math.max(1, dia * 0.08), 0.45);
      return { list: L };
    },

    grate(d) {
      const L = [];
      const { x, y, w, h } = d;
      const frame = P();
      const bars = P();
      const t = Math.max(3, Math.min(w, h) * 0.06);
      frame.rect(x, y, w, t);
      frame.rect(x, y + h - t, w, t);
      frame.rect(x, y, t, h);
      frame.rect(x + w - t, y, t, h);
      for (let bx = x + 12; bx < x + w - 6; bx += 12) {
        bars.moveTo(bx, y + t);
        bars.lineTo(bx, y + h - t);
      }
      for (let by = y + 40; by < y + h - 20; by += 40) {
        bars.moveTo(x + t, by);
        bars.lineTo(x + w - t, by);
      }
      part(L, frame, T_METAL);
      part(L, bars, T_METAL, 2.2);
      return { list: L };
    },

    ribs(d, r) {
      const L = [];
      const { x, y, w, h } = d;
      const bone = P();
      const spine = P();
      const n = 3 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const u0 = (i + 0.2 + r() * 0.3) / n;
        const bx = x + u0 * w;
        const span = (w / n) * (1.6 + r() * 0.8);
        const top = y + h * (0.02 + r() * 0.08);
        const tk = Math.max(4, span * 0.08);
        // crescent rib: outer curve up and over, inner curve back (clockwise)
        bone.moveTo(bx, y + h);
        bone.quadraticCurveTo(bx - span * 0.15, top, bx + span * 0.5, top);
        bone.lineTo(bx + span * 0.5, top + tk);
        bone.quadraticCurveTo(bx - span * 0.05 + tk, top + tk, bx + tk, y + h);
        bone.closePath();
        spine.moveTo(bx + span * 0.5 + tk * 0.8, top + tk * 0.5);
        spine.arc(bx + span * 0.5, top + tk * 0.5, tk * 0.8, 0, Math.PI * 2);
      }
      // the spine ridge: a filled band (a wide stroke would be ~20x the cost)
      const ridge = P();
      const rt = Math.max(3, h * 0.02) * 0.5;
      const ry = [];
      for (let i = 0; i <= 10; i++) ry.push(y + h * (0.05 + Math.sin((i / 10) * 9 + r()) * 0.02));
      ridge.moveTo(x, ry[0] - rt);
      for (let i = 1; i <= 10; i++) ridge.lineTo(x + (i / 10) * w, ry[i] - rt);
      for (let i = 10; i >= 0; i--) ridge.lineTo(x + (i / 10) * w, ry[i] + rt);
      ridge.closePath();
      part(L, bone, T_BONE);
      part(L, ridge, T_BONE);
      part(L, spine, T_BONE);
      return { list: L };
    },

    statue(d, r) {
      // An abstract Lanternwright: hooded, faceless, cupping a dead lamp. Some hang upside down.
      const L = [];
      const inv = r() < 0.4;
      const p = pen(d, inv);
      const body = P();
      body.moveTo(p.X(0.5), p.Y(0));
      body.quadraticCurveTo(p.X(0.72), p.Y(0.01), p.X(0.7), p.Y(0.16));
      body.lineTo(p.X(0.9), p.Y(0.24));
      body.lineTo(p.X(1), p.Y(1));
      // broken, jagged lower edge
      const teeth = 6;
      for (let i = teeth; i >= 0; i--) body.lineTo(p.X(i / teeth), p.Y(1 - (i % 2 ? 0.05 + r() * 0.08 : 0)));
      body.lineTo(p.X(0.1), p.Y(0.24));
      body.lineTo(p.X(0.3), p.Y(0.16));
      body.quadraticCurveTo(p.X(0.28), p.Y(0.01), p.X(0.5), p.Y(0));
      body.closePath();
      const face = P();
      face.moveTo(p.X(0.47), p.Y(0.05));
      face.lineTo(p.X(0.53), p.Y(0.05));
      face.lineTo(p.X(0.52), p.Y(0.15));
      face.lineTo(p.X(0.48), p.Y(0.15));
      face.closePath();
      const hands = P();
      hands.rect(Math.min(p.X(0.38), p.X(0.62)), Math.min(p.Y(0.38), p.Y(0.44)), Math.abs(p.X(0.62) - p.X(0.38)), Math.abs(p.Y(0.44) - p.Y(0.38)));
      const lampP = P();
      lampP.rect(Math.min(p.X(0.44), p.X(0.56)), Math.min(p.Y(0.3), p.Y(0.39)), Math.abs(p.X(0.56) - p.X(0.44)), Math.abs(p.Y(0.39) - p.Y(0.3)));
      const folds = P();
      for (let i = 0; i < 5; i++) {
        const u = 0.2 + i * 0.15;
        folds.moveTo(p.X(u), p.Y(0.46));
        folds.quadraticCurveTo(p.X(u + 0.03), p.Y(0.7), p.X(u - 0.02 + r() * 0.04), p.Y(0.92));
      }
      const cracks = P();
      let cx = 0.35 + r() * 0.3;
      let cy = 0.1;
      cracks.moveTo(p.X(cx), p.Y(cy));
      for (let i = 0; i < 6; i++) {
        cx += (r() - 0.5) * 0.12;
        cy += 0.08 + r() * 0.06;
        cracks.lineTo(p.X(cx), p.Y(cy));
      }
      part(L, body, T_BASE);
      part(L, face, T_DARK);
      part(L, hands, T_SHADE);
      part(L, lampP, T_METAL);
      part(L, folds, T_DARK, Math.max(1.5, d.w * 0.012), 0.8);
      part(L, cracks, T_DARK, Math.max(1, d.w * 0.006), 0.9);
      return { list: L };
    },

    'shaft-light'(d) {
      return { list: [], beam: { color: typeof d.color === 'string' ? d.color : null } };
    },

    glyphs(d, r) {
      const L = [];
      const { x, y, w, h } = d;
      const carve = P();
      const lit = P();
      const g = U.clamp(Math.min(w, h) * 0.2, 10, 22);
      for (let gy = y + g * 0.5; gy < y + h - g * 0.5; gy += g * 1.5) {
        for (let gx = x + g * 0.3; gx < x + w - g * 0.8; gx += g * 1.2) {
          const target = r() < 0.12 ? lit : carve;
          glyph(target, r, gx, gy, g);
        }
      }
      part(L, carve, T_CARVE, Math.max(1.2, g * 0.11), 0.7);
      part(L, lit, T_GLOW, Math.max(1.2, g * 0.11), 0.35);
      return { list: L };
    },

    cables(d, r) {
      const L = [];
      const { x, y, w, h } = d;
      const s = P();
      const n = 3 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const ya = y + r() * h * 0.2;
        const yb = y + r() * h * 0.2;
        addCable(s, x, ya, x + w, yb, h * (0.3 + r() * 0.5));
      }
      part(L, s, T_METAL, 1.5); // thin: drawn as hairlines (wide strokes are costly)
      return { list: L };
    },

    cage(d, r) {
      const L = [];
      const cw = d.w;
      const top = d.h * 0.32;
      const ch = d.h - top;
      const xf = { x: d.x + cw * 0.5, y: d.y, swing: 0.035, spd: 0.6 + r() * 0.4, ph: r() * 6.28 };
      const chain = P();
      chain.moveTo(0, 0);
      chain.lineTo(0, top);
      const frame = P();
      frame.moveTo(-cw * 0.5, top + ch * 0.25);
      frame.quadraticCurveTo(-cw * 0.5, top, 0, top);
      frame.quadraticCurveTo(cw * 0.5, top, cw * 0.5, top + ch * 0.25);
      frame.moveTo(-cw * 0.5, top + ch);
      frame.lineTo(cw * 0.5, top + ch);
      frame.moveTo(-cw * 0.5, top + ch * 0.25);
      frame.lineTo(cw * 0.5, top + ch * 0.25);
      const bars = P();
      const nb = Math.max(4, Math.floor(cw / 9));
      for (let i = 0; i <= nb; i++) {
        const bx = -cw * 0.5 + (cw * i) / nb;
        bars.moveTo(bx, top + ch * 0.25 - Math.cos(((i / nb) * 2 - 1) * 1.2) * ch * 0.22);
        bars.lineTo(bx, top + ch);
      }
      const inside = P();
      if (r() < 0.6) {
        // something long dead inside
        inside.moveTo(-cw * 0.25, top + ch * 0.95);
        inside.quadraticCurveTo(0, top + ch * 0.55, cw * 0.2, top + ch * 0.95);
        inside.moveTo(-cw * 0.1 + 4, top + ch * 0.7);
        inside.arc(-cw * 0.1, top + ch * 0.7, 4, 0, Math.PI * 2);
      }
      part(L, chain, T_METAL, 2.2, 1, xf);
      part(L, inside, T_BONE, 2, 0.8, xf);
      part(L, bars, T_METAL, Math.max(1.4, cw * 0.035), 1, xf);
      part(L, frame, T_RUST, Math.max(2, cw * 0.06), 1, xf);
      return { list: L };
    },

    lamp(d, r) {
      const L = [];
      const { x, y, w, h } = d;
      const arm = P();
      const housing = P();
      const glass = P();
      const left = r() < 0.5;
      const cx = x + w * 0.5;
      const cy = y + h * 0.55;
      arm.moveTo(left ? x : x + w, y + h * 0.1);
      arm.lineTo(cx, y + h * 0.1);
      arm.lineTo(cx, cy - h * 0.2);
      housing.moveTo(cx - w * 0.22, cy - h * 0.2);
      housing.lineTo(cx + w * 0.22, cy - h * 0.2);
      housing.lineTo(cx + w * 0.34, cy);
      housing.lineTo(cx - w * 0.34, cy);
      housing.closePath();
      glass.moveTo(cx + w * 0.16, cy + h * 0.06);
      glass.arc(cx, cy + h * 0.06, w * 0.16, 0, Math.PI * 2);
      part(L, arm, T_METAL, Math.max(2, w * 0.06));
      part(L, housing, T_METAL);
      const flick = d.flicker === true ? 1 : finite(d.flicker, 0);
      const parts = { list: L, light: null };
      if (flick > 0) {
        parts.light = { x: cx, y: cy + h * 0.06, r: finite(d.radius, 150), flicker: U.clamp(flick, 0, 1), glass, seed: r() * 1000 };
      } else {
        part(L, glass, T_DARK);
      }
      return parts;
    },

    tower(d, r) {
      const L = [];
      const neck = P();
      const fill = P();
      const win = P();
      const lights = [];
      addInvertedTower(neck, fill, win, lights, r, d.x + d.w * 0.5, d.y + d.h * 0.12, d.w * 0.8, d.h * 0.88, 0.1);
      part(L, neck, T_SHADE);
      part(L, fill, T_BASE);
      part(L, win, T_GLOW, 0, 0.12);
      return { list: L, pointLights: lights };
    },

    cliff(d, r, ctx2, refLayerX) {
      const L = [];
      const { x, y, w, h } = d;
      const faceRight = x + w * 0.5 < refLayerX;
      const body = P();
      const strata = P();
      const step = 50 + r() * 60;
      if (faceRight) {
        body.moveTo(x, y);
        body.lineTo(x + w * 0.8, y);
        for (let yy = y; yy < y + h; yy += step) body.lineTo(x + w * (0.6 + r() * 0.4), yy + step * 0.5);
        body.lineTo(x + w * 0.7, y + h);
        body.lineTo(x, y + h);
      } else {
        body.moveTo(x + w * 0.2, y);
        body.lineTo(x + w, y);
        body.lineTo(x + w, y + h);
        body.lineTo(x + w * 0.3, y + h);
        for (let yy = y + h; yy > y; yy -= step) body.lineTo(x + w * (r() * 0.4), yy - step * 0.5);
      }
      body.closePath();
      for (let yy = y + step; yy < y + h; yy += step * (0.8 + r())) {
        strata.moveTo(x + w * 0.05, yy);
        strata.lineTo(x + w * 0.65, yy + (r() - 0.5) * 30);
      }
      part(L, body, T_BASE);
      part(L, strata, T_DARK, 2, 0.6);
      return { list: L };
    },

    bones(d, r) {
      const L = [];
      const { x, y, w, h } = d;
      const bone = P();
      const dark = P();
      const n = Math.max(3, Math.floor(w / Math.max(28, h * 0.35)));
      const vy = y + h * 0.3;
      for (let i = 0; i < n; i++) {
        const vx = x + ((i + 0.5) / n) * w;
        const vr = Math.min(h * 0.18, (w / n) * 0.42) * (0.8 + r() * 0.4);
        bone.moveTo(vx + vr, vy);
        bone.arc(vx, vy, vr, 0, Math.PI * 2);
        // spinous process + a hanging rib
        triUp(bone, vx - vr * 0.35, vy - vr * 0.6, vr * 0.7, vr * 1.6);
        dark.moveTo(vx + vr * 0.35, vy);
        dark.arc(vx, vy, vr * 0.35, 0, Math.PI * 2);
        if (r() < 0.75) {
          const rb = P();
          rb.moveTo(vx, vy + vr * 0.6);
          rb.quadraticCurveTo(vx + (r() - 0.5) * vr * 4, vy + h * 0.45, vx + (r() - 0.5) * vr * 2, y + h * (0.75 + r() * 0.25));
          part(L, rb, T_BONE, Math.max(2, vr * 0.35), 0.85);
        }
      }
      part(L, bone, T_BONE);
      part(L, dark, T_DARK, 0, 0.7);
      return { list: L };
    },

    sign(d, r, ctx2) {
      const L = [];
      const { x, y, w, h } = d;
      const plate = P();
      const border = P();
      const rivets = P();
      const stain = P();
      plate.rect(x, y, w, h);
      border.rect(x + 3, y + 3, w - 6, h - 6);
      for (const [rx, ry] of [[x + 7, y + 7], [x + w - 7, y + 7], [x + 7, y + h - 7], [x + w - 7, y + h - 7]]) {
        rivets.moveTo(rx + 2.2, ry);
        rivets.arc(rx, ry, 2.2, 0, Math.PI * 2);
      }
      for (let i = 0; i < 4; i++) {
        const sx = x + r() * w;
        stain.rect(sx, y + h * 0.4 + r() * h * 0.4, 3 + r() * 5, h * (0.3 + r() * 0.6));
      }
      part(L, plate, T_RUST);
      part(L, stain, T_DARK, 0, 0.35);
      part(L, border, T_DARK, 1.6, 0.6);
      part(L, rivets, T_METAL);
      const text = typeof d.text === 'string' ? d.text.toUpperCase() : '';
      let textPart = null;
      if (text && ctx2) textPart = layoutText(ctx2, text, x + 10, y + 8, w - 20, h - 16);
      return { list: L, text: textPart };
    },

    machinery(d, r) {
      const L = [];
      const { x, y, w, h } = d;
      const housing = P();
      const rods = P();
      housing.rect(x, y + h * 0.55, w, h * 0.45);
      housing.rect(x + w * 0.08, y + h * 0.48, w * 0.84, h * 0.07);
      const n = 1 + Math.floor(r() * 2.5);
      for (let i = 0; i < n; i++) {
        const gr = Math.min(w / (n * 2.2), h * 0.42) * (0.75 + r() * 0.25);
        const gx = x + ((i + 0.5) / n) * w;
        const gy = y + h * 0.48 - gr * 0.55;
        const gear = P();
        const teeth = Math.max(8, Math.floor(gr / 5));
        for (let t = 0; t < teeth; t++) {
          const a0 = (t / teeth) * Math.PI * 2;
          const a1 = a0 + (Math.PI / teeth) * 0.9;
          gear.lineTo(Math.cos(a0) * gr, Math.sin(a0) * gr);
          gear.lineTo(Math.cos(a0) * gr * 1.14, Math.sin(a0) * gr * 1.14);
          gear.lineTo(Math.cos(a1) * gr * 1.14, Math.sin(a1) * gr * 1.14);
          gear.lineTo(Math.cos(a1) * gr, Math.sin(a1) * gr);
        }
        gear.closePath();
        const hub = P();
        ring(hub, 0, 0, gr * 0.62);
        hub.moveTo(gr * 0.18, 0);
        hub.arc(0, 0, gr * 0.18, 0, Math.PI * 2);
        for (let s = 0; s < 4; s++) {
          const a = (s / 4) * Math.PI * 2 + 0.4;
          hub.moveTo(Math.cos(a) * gr * 0.18, Math.sin(a) * gr * 0.18);
          hub.lineTo(Math.cos(a) * gr * 0.62, Math.sin(a) * gr * 0.62);
        }
        const turning = r() < 0.35;
        const xf = { x: gx, y: gy, rot: turning ? (r() < 0.5 ? -1 : 1) * (0.04 + r() * 0.06) : 0, ph: r() * 6.28 };
        part(L, gear, T_METAL, 0, 1, xf);
        part(L, hub, T_DARK, Math.max(1.5, gr * 0.07), 0.9, xf);
        rods.moveTo(gx, gy);
        rods.lineTo(gx + (r() - 0.5) * w * 0.4, y + h * 0.6);
      }
      part(L, housing, T_METAL);
      part(L, rods, T_RUST, Math.max(2, h * 0.025));
      return { list: L };
    },
  };

  function voussLine(path, p, u, v0, t) {
    const cx = 0.5;
    const dx = u - cx;
    path.moveTo(p.X(u), p.Y(v0));
    path.lineTo(p.X(u - dx * t * 1.4), p.Y(v0 + t * 0.9));
  }

  /** One procedural "Lanternwright" glyph inside a g×g cell. */
  function glyph(path, r, x, y, g) {
    const strokes = 2 + Math.floor(r() * 3);
    path.moveTo(x + g * 0.5, y);
    path.lineTo(x + g * 0.5, y + g); // every glyph has a spine (they wrote downward)
    for (let s = 0; s < strokes; s++) {
      const k = r();
      const yy = y + r() * g;
      if (k < 0.3) {
        path.moveTo(x + g * 0.5, yy);
        path.lineTo(x + (r() < 0.5 ? 0 : g), yy + g * 0.25);
      } else if (k < 0.55) {
        path.moveTo(x + g * 0.15, yy);
        path.lineTo(x + g * 0.85, yy);
      } else if (k < 0.8) {
        const rr = g * 0.16;
        path.moveTo(x + g * 0.5 + rr, yy);
        path.arc(x + g * 0.5, yy, rr, 0, Math.PI * 2);
      } else {
        path.moveTo(x + g * 0.5, yy);
        path.quadraticCurveTo(x + g, yy, x + g * 0.8, yy + g * 0.3);
      }
    }
  }

  const SIGN_FONT = 'Georgia, "Times New Roman", serif';
  /** Wraps text into a box; picks the largest font size that fits. Done once per sign. */
  function layoutText(ctx, text, x, y, w, h) {
    const words = text.split(/\s+/).filter(Boolean);
    for (let size = Math.min(26, Math.max(8, h * 0.4)); size >= 6; size -= 1) {
      const font = `600 ${size}px ${SIGN_FONT}`;
      ctx.font = font;
      const lines = [];
      let line = '';
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > w && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      const lh = size * 1.18;
      let widest = 0;
      for (const l of lines) widest = Math.max(widest, ctx.measureText(l).width);
      if (lines.length * lh <= h && widest <= w) {
        return { lines, font, size, lh, x: x + w * 0.5, y: y + (h - lines.length * lh) * 0.5 + size * 0.85 };
      }
    }
    return null;
  }

  // ===========================================================================
  // Renderer
  // ===========================================================================
  class Renderer {
    /** @param {HTMLCanvasElement} canvas */
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
      this.cssW = canvas.clientWidth || canvas.width || 1;
      this.cssH = canvas.clientHeight || canvas.height || 1;
      this.dpr = 1;
      this.time = 0;
      this.stats = { ms: 0, avgMs: 0, decor: 0, solids: 0, lights: 0 };
      this._lastTime = -1;
      this._errorLogged = false;

      // Scratch storage (reused every frame).
      this._rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
      this._rect2 = { x0: 0, y0: 0, x1: 0, y1: 0 };
      this._pt = { x: 0, y: 0 };
      this._pt2 = { x: 0, y: 0 };
      this._solids = [];
      this._hazards = [];
      this._anchors = [];
      this._decor = [];
      this._visAnchors = [];
      this._tmp = [];
      this._c0 = [0, 0, 0];
      this._c1 = [0, 0, 0];
      this._c2 = [0, 0, 0];
      this._lights = [];
      for (let i = 0; i < MAX_LIGHTS; i++) this._lights.push({ x: 0, y: 0, r: 0, a: 0, glow: 0, beam: 0, w: 0, h: 0, lantern: 0 });
      this._lightCount = 0;
      this._lantern = { fl: 1, strength: 1 };
      this._creatureOpts = { time: 0, quality: 'high', threat: 0, highContrast: false };

      // Theme state.
      this.th = {
        fog: [32, 38, 43],
        light: [111, 163, 181],
        accent: [224, 160, 80],
        fogDensity: 0.5,
        darkness: 0.5,
        depth: 0,
        a: 0,
        b: 0,
        t: 0,
      };
      this._pal = { far: new Array(TONE_COUNT), deep: new Array(TONE_COUNT), mid: new Array(TONE_COUNT), near: new Array(TONE_COUNT), world: {} };
      this._col = {}; // misc per-frame colour strings

      // Caches.
      this._level = null;
      this._themes = [];
      this._solidCache = new WeakMap();
      this._decorCache = new WeakMap();
      this._hazCache = new WeakMap();
      this._megaFar = new Map();
      this._megaDeep = new Map();
      this._nearProc = new Map();
      this._fogTex = null;
      this._fogTexKey = -1;
      this._seed = 1337;

      // Player pose state.
      this._pAng = 0;
      this._runPhase = 0;
      this._lanternSwing = 0;
      this._lanternVel = 0;
      this._prevVX = 0;

      // Bus-driven pulses.
      this._bus = null;
      this._unsub = [];
      this._attachPulse = { anchor: null, t: -10 };
      this._joltT = -10;
      this._joltAmp = 0;

      this._buildSprites();
      this.resize(this.cssW, this.cssH, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    }

    _buildSprites() {
      this._lightSprite = radialSprite(256, [
        [0, 255, 255, 255, 1],
        [0.32, 255, 255, 255, 0.94],
        [0.55, 255, 255, 255, 0.66],
        [0.76, 255, 255, 255, 0.3],
        [0.9, 255, 255, 255, 0.09],
        [1, 255, 255, 255, 0],
      ]);
      // Big enough that every on-screen use is drawn at <= ~1.5x with smoothing
      // OFF (smoothed scaling is the most expensive 2D operation on software raster).
      this._warmSprite = radialSprite(512, glowStops(MAT.amber, 0.5));
      this._coldSprite = radialSprite(256, glowStops(MAT.cyan, 0.55));
      this._paleSprite = radialSprite(512, glowStops(STILL_LIGHT, 0.6));
      this._beamWhite = beamSprite([255, 255, 255], 1);
    }

    /**
     * Resizes the backing store (CSS size × dpr) and rebuilds screen-size caches.
     * @param {number} cssW
     * @param {number} cssH
     * @param {number} dpr
     */
    resize(cssW, cssH, dpr) {
      this.cssW = Math.max(1, finite(cssW, this.cssW));
      this.cssH = Math.max(1, finite(cssH, this.cssH));
      this.dpr = U.clamp(finite(dpr, this.dpr || 1), 0.25, 4);
      const bw = Math.max(1, Math.round(this.cssW * this.dpr));
      const bh = Math.max(1, Math.round(this.cssH * this.dpr));
      if (this.canvas.width !== bw) this.canvas.width = bw;
      if (this.canvas.height !== bh) this.canvas.height = bh;
      // Effective dpr after rounding keeps CSS→backing mapping exact.
      this.dprX = bw / this.cssW;
      this.dprY = bh / this.cssH;
      // Third-res darkness buffer: soft by nature, so it is upscaled once per
      // frame WITHOUT smoothing (per-texel steps stay below ~1 grey level).
      const k = U.clamp(Math.max(1 / 3, 200 / Math.min(this.cssW, this.cssH)), 1 / 3, 0.5);
      this._darkK = k;
      this._dark = makeCanvas(this.cssW * k, this.cssH * k);
      this._darkCtx = this._dark.getContext('2d');
      this._vignette = edgeCanvas(this._dark.width, this._dark.height, [0, 0, 0], 0.3, 1);
      // Threat edge tint: rust offset one way, bone the other (a chromatic
      // fringe), pre-combined at buffer resolution with a pad so the per-frame
      // jitter is a cheap integer-offset 1:1 blit.
      {
        const pad = TINT_PAD;
        const bw2 = this._dark.width + pad * 2;
        const bh2 = this._dark.height + pad * 2;
        const rust = edgeCanvas(96, 64, [150, 40, 24], 0.72, 0.5);
        const bone = edgeCanvas(96, 64, MAT.glow, 0.72, 0.45);
        const t = makeCanvas(bw2, bh2);
        const tg = t.getContext('2d');
        const o = Math.max(2, Math.round(this._dark.width * 0.004));
        tg.globalAlpha = 0.6;
        tg.drawImage(rust, -o, 0, bw2, bh2);
        tg.globalAlpha = 0.42;
        tg.drawImage(bone, o, 0, bw2, bh2);
        this._tint = t;
      }
      this._fogTex = null;
      if (this.ctx) {
        this.ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in this.ctx) this.ctx.imageSmoothingQuality = 'low';
      }
    }

    // -------------------------------------------------------------------------
    // Frame entry
    // -------------------------------------------------------------------------
    /**
     * Draws one frame.
     * @param {AT.Game} game
     * @param {number} [alpha] physics interpolation factor (player.rx/ry already use it)
     */
    render(game, alpha) {
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      const ctx = this.ctx;
      if (!ctx || !game) return;
      void alpha;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.setLineDash(DASH_NONE);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      try {
        this._frame(game);
      } catch (err) {
        if (!this._errorLogged) {
          this._errorLogged = true;
          if (typeof console !== 'undefined') console.error('[AT] renderer error', err);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.setLineDash(DASH_NONE);
      }
      if (t0) {
        const ms = performance.now() - t0;
        this.stats.ms = ms;
        this.stats.avgMs = this.stats.avgMs ? this.stats.avgMs * 0.95 + ms * 0.05 : ms;
      }
    }

    _frame(game) {
      const ctx = this.ctx;
      const cam = game.camera;
      const level = game.level;
      const now = finite(game.realTime, typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
      let dt = now - this._lastTime;
      if (!(dt >= 0 && dt < 0.25)) dt = 1 / 60;
      this._lastTime = now;
      this.time = now;
      this._dt = dt;

      const settings = game.settings || AT.SETTINGS_DEFAULTS || {};
      const reduced = !!settings.reducedEffects;
      const hc = !!settings.highContrast;
      this._reduced = reduced;
      this._hc = hc;

      if (!cam || !level) {
        ctx.fillStyle = '#07080a';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this._drawScreenOverlays(game, cam, settings);
        return;
      }
      this._syncCamera(cam);
      this._bindBus(game.bus);
      this._prepareLevel(level);

      const threat = U.clamp(finite(game.threat && game.threat.value, 0), 0, 1);
      const beat = U.clamp(finite(game.threat && game.threat.beatPulse, 0), 0, 1);
      this._threat = threat;
      this._computeTheme(cam, level, threat);
      this._lightCount = 0;

      const pl = game.player;
      const showPlayer = !!pl && !game.hidePlayer && game.state !== 'menu';
      this._showPlayer = showPlayer;

      const co = this._creatureOpts;
      co.time = now;
      co.quality = reduced ? 'low' : 'high';
      co.threat = threat;
      co.highContrast = hc;

      // 1-3: backdrop layers
      this._drawBackground(ctx);
      if (!reduced) this._drawMega(ctx, cam, level, true);
      this._drawMega(ctx, cam, level, false);
      this._drawDecorLayer(ctx, cam, level, 'far');
      this._callCreature(game, 'renderFar', true);
      this._drawFog(ctx, cam, P_FOG_A, reduced ? 0.7 : 1, 0, reduced ? 1 : 2);
      this._drawDecorLayer(ctx, cam, level, 'mid');
      if (!reduced) this._drawFog(ctx, cam, P_FOG_B, 0.55, 1, 1);
      if (game.particles) this._safe(() => game.particles.render(ctx, cam, 'back'));

      // Light holes must be known before the solid-darkness pass.
      this._collectWorldLights(game, cam, level);
      this._querySolids(cam, level);
      this._buildDarkness(cam, level);

      // 4: gameplay layer
      cam.applyTransform(ctx, 1);
      this._drawSolids(ctx, cam, level, game);
      cam.applyTransform(ctx, 1);
      this._drawGateAndLamp(ctx, level, game);
      this._drawHazards(ctx, cam, level);
      this._drawAnchors(ctx, cam, level, game);
      if (showPlayer && pl.alive !== false) {
        this._drawRope(ctx, game);
        this._drawPlayer(ctx, game);
      }
      this._callCreature(game, 'render', false);
      if (game.particles) this._safe(() => game.particles.render(ctx, cam, 'front'));

      // 5: foreground occluders
      this._drawDecorLayer(ctx, cam, level, 'near');
      if (!reduced) this._drawNearProc(ctx, cam, level);

      // 6: lighting
      this._applyDarkness(ctx, threat, beat, reduced);
      this._drawGlows(ctx, cam);

      // 7: above darkness (always readable)
      this._drawSolidEdgesAbove(ctx, cam, level);
      this._drawTargetCue(ctx, game, cam, hc);
      this._drawAnchorMarkers(ctx, game, cam, hc);
      this._callCreature(game, 'renderGlow', false);

      // 8: screen space
      this._drawScreenOverlays(game, cam, settings);
      this.stats.lights = this._lightCount;
    }

    _safe(fn) {
      try {
        fn();
      } catch (err) {
        if (!this._safeLogged) {
          this._safeLogged = true;
          if (typeof console !== 'undefined') console.error('[AT] render sub-step failed', err);
        }
      }
      const ctx = this.ctx;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    _callCreature(game, method, screenSpace) {
      const cr = game.creature;
      if (!cr || typeof cr[method] !== 'function') return;
      const ctx = this.ctx;
      const cam = game.camera;
      ctx.save();
      if (screenSpace) ctx.setTransform(this.dprX, 0, 0, this.dprY, 0, 0);
      else cam.applyTransform(ctx, 1);
      try {
        cr[method](ctx, cam, this._creatureOpts);
      } catch (err) {
        if (!this._creatureLogged) {
          this._creatureLogged = true;
          if (typeof console !== 'undefined') console.error(`[AT] creature.${method} failed`, err);
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.setLineDash(DASH_NONE);
    }

    /** Keeps the camera's screen/dpr in sync with the actual backing store. */
    _syncCamera(cam) {
      if (cam.screenW !== this.cssW || cam.screenH !== this.cssH) {
        if (typeof cam.resize === 'function') cam.resize(this.cssW, this.cssH, this.dprX, cam.isTouch);
      }
      if (cam.dpr !== this.dprX) cam.dpr = this.dprX;
    }

    _bindBus(bus) {
      if (bus === this._bus) return;
      for (const off of this._unsub) {
        try {
          off();
        } catch {
          /* ignore */
        }
      }
      this._unsub.length = 0;
      this._bus = bus || null;
      if (!bus || typeof bus.on !== 'function') return;
      this._unsub.push(
        bus.on('grapple:attach', (e) => {
          this._attachPulse.anchor = e.anchor || null;
          this._attachPulse.t = this.time;
        }),
      );
      this._unsub.push(
        bus.on('rope:jolt', (e) => {
          this._joltT = this.time;
          this._joltAmp = U.clamp(finite(e.speed, 700) / 1400, 0.25, 1);
        }),
      );
    }

    _prepareLevel(level) {
      if (level === this._level) return;
      this._level = level;
      this._solidCache = new WeakMap();
      this._decorCache = new WeakMap();
      this._hazCache = new WeakMap();
      this._seed = (U.hash((finite(level.width, 1800) * 31 + (level.sections ? level.sections.length : 0)) | 0) * 1e6) | 0;
      this._megaFar.clear();
      this._megaDeep.clear();
      this._nearProc.clear();
      const def = { fog: '#20262b', light: '#6fa3b5', accent: '#e0a050', fogDensity: 0.5, darkness: 0.5 };
      const secs = Array.isArray(level.sections) ? level.sections : [];
      this._themes = secs.map((s) => {
        const t = Object.assign({}, def, s && s.theme);
        return {
          fog: hexToRgb(t.fog, [32, 38, 43]),
          light: hexToRgb(t.light, MAT.cyan),
          accent: hexToRgb(t.accent, MAT.amber),
          fogDensity: U.clamp(finite(t.fogDensity, 0.5), 0, 1),
          darkness: U.clamp(finite(t.darkness, 0.5), 0, 1),
        };
      });
      if (this._themes.length === 0) {
        this._themes.push({ fog: [32, 38, 43], light: MAT.cyan.slice(), accent: MAT.amber.slice(), fogDensity: 0.5, darkness: 0.5 });
      }
      const b = level.bounds || { x0: 0, x1: finite(level.width, 1800), y0: 0, y1: 15000 };
      this._bounds = b;
      this._centerX = (finite(b.x0, 0) + finite(b.x1, 1800)) * 0.5;
      const par = level.parallax || {};
      this._pFar = finite(par.far, P_FAR_DEFAULT);
      this._pMid = finite(par.mid, P_MID_DEFAULT);
      this._pNear = finite(par.near, P_NEAR_DEFAULT);
    }

    // -------------------------------------------------------------------------
    // Theme & palettes
    // -------------------------------------------------------------------------
    _computeTheme(cam, level, threat) {
      const th = this.th;
      const themes = this._themes;
      const secs = Array.isArray(level.sections) ? level.sections : [];
      const n = themes.length;
      let i = 0;
      if (typeof level.sectionIndexAt === 'function') i = U.clamp(level.sectionIndexAt(cam.y) | 0, 0, n - 1);
      let a = i;
      let b = i;
      let t = 0;
      const s = secs[i];
      if (s) {
        if (i < n - 1 && cam.y > s.y1 - THEME_BLEND) {
          b = i + 1;
          t = U.smoothstep(s.y1 - THEME_BLEND, s.y1 + THEME_BLEND, cam.y);
        } else if (i > 0 && cam.y < s.y0 + THEME_BLEND) {
          a = i - 1;
          t = U.smoothstep(s.y0 - THEME_BLEND, s.y0 + THEME_BLEND, cam.y);
        }
      }
      const A = themes[a];
      const B = themes[b];
      mix(th.fog, A.fog, B.fog, t);
      mix(th.light, A.light, B.light, t);
      mix(th.accent, A.accent, B.accent, t);
      th.fogDensity = U.lerp(A.fogDensity, B.fogDensity, t);
      th.darkness = U.lerp(A.darkness, B.darkness, t);
      th.a = a;
      th.b = b;
      th.t = t;
      const bd = this._bounds;
      th.depth = U.clamp((cam.y - finite(bd.y0, 0)) / Math.max(1, finite(bd.y1, 15000) - finite(bd.y0, 0)), 0, 1);
      // Luminance floor: deep themes may use near-black fog; lift it (hue kept)
      // so the haze always stays brighter than the silhouettes in front of it —
      // "understand the geometry", never a black screen.
      const lum = th.fog[0] * 0.3 + th.fog[1] * 0.59 + th.fog[2] * 0.11;
      const floor = FOG_LUM_FLOOR;
      if (lum < floor) {
        const k = floor / Math.max(lum, 1);
        th.fog[0] = Math.min(255, th.fog[0] * k + (floor - lum) * 0.15);
        th.fog[1] = Math.min(255, th.fog[1] * k + (floor - lum) * 0.15);
        th.fog[2] = Math.min(255, th.fog[2] * k + (floor - lum) * 0.15);
      }

      const c0 = this._c0;
      const c1 = this._c1;
      const fog = th.fog;
      const dk = 1 - th.depth * 0.22; // deeper = darker (themes carry the rest)
      const col = this._col;

      // Background: luminous haze at the top of the view, deep murk below.
      // (the top carries the faint cold light from impossibly far above, which
      // fades as we descend)
      const up = (1 - th.depth) * 0.6 + 0.12;
      col.bgTopArr = col.bgTopArr || [0, 0, 0];
      col.bgMidArr = col.bgMidArr || [0, 0, 0];
      col.bgBotArr = col.bgBotArr || [0, 0, 0];
      mix(c0, fog, th.light, 0.1 + up * 0.22);
      scl(col.bgTopArr, c0, (1.6 + up * 0.5) * dk);
      scl(col.bgMidArr, fog, 1.25 * dk);
      scl(col.bgBotArr, fog, 0.62 * dk);

      // Layer palettes: material → lit level → mixed toward the fog (atmospheric perspective).
      const fogLum = this._c2;
      scl(fogLum, fog, 1.42 * dk);
      this._fillPal(this._pal.deep, fogLum, 0.5, 0.86, dk);
      scl(fogLum, fog, 1.22 * dk);
      this._fillPal(this._pal.far, fogLum, 0.55, 0.74, dk);
      scl(fogLum, fog, 1.12 * dk);
      this._fillPal(this._pal.mid, fogLum, 0.72, 0.62, dk);
      this._fillNearPal(this._pal.near, fog);
      // opaque "dissolved" tones for the megastructure (base mixed toward the backdrop)
      const mid3 = col.bgMidArr;
      col.deepNeck = css(mix(c1, mid3, hexToArr(this._pal.deep[T_BASE], this._c0), 0.4));
      col.deepBody = css(mix(c1, mid3, hexToArr(this._pal.deep[T_BASE], this._c0), 0.8));
      col.farNeck = css(mix(c1, mid3, hexToArr(this._pal.far[T_BASE], this._c0), 0.5));
      this._fillWorldPal(this._pal.world, fog, th.light, dk);

      // Fog/haze colours
      mix(c0, fog, th.light, 0.18);
      scl(c0, c0, 2.0 * dk);
      col.hazeArr = col.hazeArr || [0, 0, 0];
      col.hazeArr[0] = c0[0];
      col.hazeArr[1] = c0[1];
      col.hazeArr[2] = c0[2];
      // Darkness colour: near-black, faintly tinted by the section fog.
      scl(c1, fog, 0.18);
      col.darkArr = col.darkArr || [0, 0, 0];
      col.darkArr[0] = c1[0];
      col.darkArr[1] = c1[1];
      col.darkArr[2] = c1[2];
      // Open air darkens moderately (the haze stays legible); solids darken much
      // more outside the light, so they read as silhouettes against it.
      col.darkAlpha = U.clamp(0.24 + th.darkness * 0.3 + th.depth * 0.05 + threat * 0.06, 0.15, 0.62);
      const solidTotal = U.clamp(0.58 + th.darkness * 0.32 + threat * 0.04, 0.5, 0.9);
      col.solidAlpha = U.clamp((solidTotal - col.darkAlpha) / (1 - col.darkAlpha), 0, 1);
      // masonry interiors: base × last depth band × the solid darkness, pre-applied
      const wa = col.solidAlpha;
      const wpal = this._pal.world;
      scl(c0, wpal.wallArr, 0.28);
      col.wallInterior = css(mix(c0, c0, col.darkArr, wa));
      scl(c0, hexToArr(wpal.stone, c0), 0.28);
      col.stoneInterior = css(mix(c0, c0, col.darkArr, wa));
    }

    _fillPal(pal, fogLum, lightK, fogMix, dk) {
      const c = this._c1;
      for (let i = 0; i < PAL_RECIPE.length; i++) {
        const rec = PAL_RECIPE[i];
        scl(c, rec[1], lightK * rec[2] * dk);
        mix(c, c, fogLum, fogMix);
        pal[rec[0]] = css(c);
      }
    }

    _fillNearPal(pal, fog) {
      const c = this._c1;
      scl(c, fog, 0.16);
      const base = css(c);
      scl(c, fog, 0.28);
      const rim = css(c);
      for (let i = 0; i < TONE_COUNT; i++) pal[i] = base;
      pal[T_RIM] = rim;
      pal[T_GLOW] = rim;
      pal[T_TEXT] = rim;
    }

    _fillWorldPal(w, fog, light, dk) {
      const c = this._c1;
      const k = 0.92 + dk * 0.08;
      mix(c, MAT.stone, fog, 0.18);
      scl(c, c, 0.86 * k);
      w.wall = css(c);
      w.wallArr = w.wallArr || [0, 0, 0];
      w.wallArr[0] = c[0];
      w.wallArr[1] = c[1];
      w.wallArr[2] = c[2];
      mix(c, MAT.stone, fog, 0.1);
      scl(c, c, 1.08 * k);
      w.stone = css(c);
      mix(c, [74, 70, 63], fog, 0.12);
      w.crumble = css(c);
      mix(c, MAT.iron, fog, 0.12);
      w.metal = css(c);
      mix(c, [62, 50, 40], fog, 0.12);
      w.wood = css(c);
      scl(c, MAT.stoneDark, 0.55);
      w.seam = css(c);
      scl(c, MAT.stoneDark, 0.35);
      w.shade = css(c);
      mix(c, MAT.bone, light, 0.3);
      scl(c, c, 1.05);
      w.rim = css(c);
      mix(c, MAT.phos, light, 0.2);
      w.edge = css(c);
      w.verd = css(MAT.verd);
      w.rust = css(MAT.rust);
      mix(c, MAT.growth, fog, 0.15);
      w.growth = css(c);
      w.bone = css(MAT.bone);
      w.phos = css(MAT.phos);
      w.amber = css(MAT.amber);
      w.glow = css(MAT.glow);
      mix(c, MAT.rust, [40, 20, 14], 0.35);
      w.hazBase = css(c);
      w.steel = css([118, 118, 112]);
      w.tip = css([222, 214, 196]);
    }

    // -------------------------------------------------------------------------
    // 1. Background — a vertical gradient built from solid bands (a gradient fill
    // costs ~10x more than solid fills on software raster; 48 bands keep each
    // step under one grey level).
    // -------------------------------------------------------------------------
    _drawBackground(ctx) {
      const col = this._col;
      const top = col.bgTopArr;
      const mid = col.bgMidArr;
      const bot = col.bgBotArr;
      const c = this._c2;
      const bands = 48;
      const bw = this.canvas.width;
      const bh = this.canvas.height;
      // The light at the bottom: deep in the descent, a faint pale haze rises
      // from below (the Still Lamp), silhouetting everything in front of it.
      const abyss = U.smoothstep(0.55, 1, this.th.depth) * 0.2;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      let y0 = 0;
      for (let i = 0; i < bands; i++) {
        const t = (i + 0.5) / bands;
        if (t < 0.45) mix(c, top, mid, t / 0.45);
        else mix(c, mid, bot, (t - 0.45) / 0.55);
        if (abyss > 0 && t > 0.45) mix(c, c, STILL_LIGHT, abyss * Math.pow((t - 0.45) / 0.55, 1.6));
        const y1 = Math.round(((i + 1) / bands) * bh);
        ctx.fillStyle = css(c);
        ctx.fillRect(0, y0, bw, y1 - y0);
        y0 = y1;
      }
    }

    // -------------------------------------------------------------------------
    // 2. Procedural megastructure
    // -------------------------------------------------------------------------
    _drawMega(ctx, cam, level, deep) {
      const p = deep ? P_DEEP : this._pFar;
      const chunkH = deep ? DEEP_CHUNK : FAR_CHUNK;
      const cache = deep ? this._megaDeep : this._megaFar;
      const pal = deep ? this._pal.deep : this._pal.far;
      const vr = cam.visibleRect(0, p, this._rect);
      const k0 = Math.floor((vr.y0 - 1400) / chunkH);
      const k1 = Math.floor((vr.y1 + 200) / chunkH);
      const centerX = this._centerX * p;
      const span = 1500;
      const hair = 1 / (cam.scale * this.dprX);
      cam.applyTransform(ctx, p);
      // Evict far-away chunks (keeps memory bounded on long descents).
      if (cache.size > 24) {
        for (const key of cache.keys()) {
          if (key < k0 - 4 || key > k1 + 4) cache.delete(key);
        }
      }
      for (let k = k0; k <= k1; k++) {
        let ch = cache.get(k);
        if (!ch) {
          ch = buildMegaChunk(k, chunkH, centerX, span, this._seed + (deep ? 101 : 0), deep);
          cache.set(k, ch);
        }
        // necks / distant bits are half-dissolved in the haze (pre-mixed with the
        // backdrop colour so the fills stay opaque — about 2x cheaper than alpha)
        ctx.fillStyle = deep ? this._col.deepNeck : this._col.farNeck;
        ctx.fill(ch.fills[0]);
        ctx.fillStyle = deep ? this._col.deepBody : pal[T_BASE];
        ctx.fill(ch.fills[1]);
        // cables: thin lines at this distance (hairlines are the cheap path)
        ctx.strokeStyle = pal[T_METAL];
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = Math.max(hair, deep ? 2 : 1.4);
        ctx.stroke(ch.strokes[0]);
        ctx.fillStyle = pal[T_GLOW];
        ctx.globalAlpha = deep ? 0.05 : 0.07;
        ctx.fill(ch.windows);
        ctx.globalAlpha = 1;
      }
      // Lights & beams (additive), after silhouettes.
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = false;
      const t = this.time;
      for (let k = k0; k <= k1; k++) {
        const ch = cache.get(k);
        if (!ch) continue;
        const L = ch.lights;
        for (let i = 0; i < L.length; i += 4) {
          const fl = 0.55 + 0.45 * U.noise1(t * 0.3 + L[i + 3], 3);
          const r = L[i + 2] * (deep ? 7 : 6);
          ctx.globalAlpha = fl * (deep ? 0.22 : 0.3);
          ctx.drawImage((i / 4) % 3 === 0 ? this._warmSprite : this._coldSprite, L[i] - r, L[i + 1] - r, r * 2, r * 2);
        }
        const B = ch.beams;
        for (let i = 0; i < B.length; i += 4) {
          const a = 0.1 + 0.04 * U.noise1(t * 0.1 + i, 9);
          const sx = (B[i] - B[i + 2] * 0.5 - cam.x * p) * cam.scale + this.cssW * 0.5;
          const sy = (B[i + 1] - cam.y * p) * cam.scale + this.cssH * 0.5;
          this._drawBeamFast(ctx, this.th.light, a, sx, sy, B[i + 2] * cam.scale, B[i + 3] * cam.scale);
          cam.applyTransform(ctx, p);
        }
      }
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    /**
     * A soft vertical light beam in SCREEN space (CSS px). Every draw is an
     * exact 1:1 integer blit of a cached tile (the only cheap image path on CPU
     * raster): a fade-in cap and a fade-out cap rendered at their exact device
     * size, and a 256-px body tile repeated down the visible middle.
     */
    _drawBeamFast(ctx, colArr, alpha, x, y, w, h) {
      const W = this.cssW;
      const H = this.cssH;
      if (x >= W || x + w <= 0 || y >= H || y + h <= 0 || !(alpha > 0)) return;
      const dw = Math.max(2, Math.min(4095, Math.round(w * this.dprX)));
      const dx = Math.round(x * this.dprX);
      const dy = Math.round(y * this.dprY);
      const dh = Math.max(3, Math.round(h * this.dprY));
      const fi = Math.max(1, Math.min(8191, Math.round(dh * 0.18)));
      const fo = Math.max(1, Math.min(8191, Math.round(dh * 0.3)));
      const t = this._beamTiles(colArr, dw, fi, fo);
      const ch = this.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha;
      this._blitV(ctx, t.fadeIn, dx, dy, fi, ch);
      const bodyH = dh - fi - fo;
      if (bodyH > 0) {
        // repeat the body tile over the visible part only
        let y0 = Math.max(dy + fi, 0);
        const y1 = Math.min(dy + fi + bodyH, ch);
        while (y0 < y1) {
          const n = Math.min(256, y1 - y0);
          ctx.drawImage(t.body, 0, 0, dw, n, dx, y0, dw, n);
          y0 += n;
        }
      }
      this._blitV(ctx, t.fadeOut, dx, dy + dh - fo, fo, ch);
      ctx.globalAlpha = 1;
    }

    /** 1:1 blit of the vertically visible part of an image placed at (dx, dy). */
    _blitV(ctx, img, dx, dy, h, canvasH) {
      const y0 = Math.max(dy, 0);
      const y1 = Math.min(dy + h, canvasH);
      if (y1 <= y0) return;
      ctx.drawImage(img, 0, y0 - dy, img.width, y1 - y0, dx, y0, img.width, y1 - y0);
    }

    /** Beam tiles (body + exact-size fade caps), cached by size and quantised colour. */
    _beamTiles(colArr, dw, fi, fo) {
      const q = key3(colArr) & 0xf0f0f0;
      const c12 = ((q >> 20) << 8) | (((q >> 12) & 15) << 4) | ((q >> 4) & 15);
      const key = ((dw * 8192 + fi) * 8192 + fo) * 4096 + c12;
      if (!this._beamTileCache) this._beamTileCache = new Map();
      let t = this._beamTileCache.get(key);
      if (!t) {
        if (this._beamTileCache.size > 16) this._beamTileCache.clear();
        const r = (q >> 16) & 255;
        const gg = (q >> 8) & 255;
        const b = q & 255;
        const make = (h, fade) => {
          const c = makeCanvas(dw, h);
          const g = c.getContext('2d');
          const gr = g.createLinearGradient(0, 0, dw, 0);
          gr.addColorStop(0, `rgba(${r},${gg},${b},0)`);
          gr.addColorStop(0.28, `rgba(${r},${gg},${b},0.45)`);
          gr.addColorStop(0.5, `rgba(${r},${gg},${b},0.85)`);
          gr.addColorStop(0.72, `rgba(${r},${gg},${b},0.45)`);
          gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
          g.fillStyle = gr;
          g.fillRect(0, 0, dw, h);
          if (fade) {
            g.globalCompositeOperation = 'destination-in';
            const v = g.createLinearGradient(0, 0, 0, h);
            v.addColorStop(0, `rgba(0,0,0,${fade > 0 ? 0 : 1})`);
            v.addColorStop(0.5, 'rgba(0,0,0,0.5)');
            v.addColorStop(1, `rgba(0,0,0,${fade > 0 ? 1 : 0})`);
            g.fillStyle = v;
            g.fillRect(0, 0, dw, h);
          }
          return c;
        };
        t = { body: make(256, 0), fadeIn: make(fi, 1), fadeOut: make(fo, -1) };
        this._beamTileCache.set(key, t);
      }
      return t;
    }

    /**
     * Builds (or reuses) the fog band texture, pre-tinted with the current haze
     * colour at DEVICE resolution so every use is an exact 1:1 blit (the only
     * cheap image draw on software raster). Rebuilt only when the quantised haze
     * colour or the canvas size changes.
     */
    _fogTexture() {
      const key = key3(this._col.hazeArr) & 0xf0f0f0;
      const W = Math.max(64, Math.ceil(this.canvas.width * 1.5));
      const H = Math.max(16, Math.round(FOG_BAND_CSS * this.dprY));
      if (this._fogTex && this._fogTexKey === key && this._fogTex.width === W && this._fogTex.height === H) return this._fogTex;
      const c = this._fogTex && this._fogTex.width === W && this._fogTex.height === H ? this._fogTex : makeCanvas(W, H);
      const g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, W, H);
      const r = (key >> 16) & 255;
      const gg = (key >> 8) & 255;
      const b = key & 255;
      const rnd = U.rng(4242);
      const squash = 0.42;
      for (let i = 0; i < 9; i++) {
        const px = rnd() * W;
        const pw = W * (0.12 + rnd() * 0.2);
        const a = 0.45 + rnd() * 0.5;
        for (let wrap = -1; wrap <= 1; wrap++) {
          const cx = px + wrap * W;
          if (cx + pw < 0 || cx - pw > W) continue;
          g.setTransform(1, 0, 0, squash, 0, H * 0.5 * (1 - squash));
          const gr = g.createRadialGradient(cx, H * 0.5, 0, cx, H * 0.5, pw);
          gr.addColorStop(0, `rgba(${r},${gg},${b},${a})`);
          gr.addColorStop(0.5, `rgba(${r},${gg},${b},${a * 0.45})`);
          gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
          g.fillStyle = gr;
          g.fillRect(cx - pw, H * 0.5 - pw, pw * 2, pw * 2);
        }
      }
      // a continuous thin veil so bands never break into separate blobs
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = `rgba(${r},${gg},${b},0.22)`;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'destination-in';
      const vg = g.createLinearGradient(0, 0, 0, H);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(0.5, 'rgba(0,0,0,1)');
      vg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = vg;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
      this._fogTex = c;
      this._fogTexKey = key;
      return c;
    }

    /** Drifting fog sheets in their own parallax band (cached texture, 1:1 integer blits). */
    _drawFog(ctx, cam, p, strength, salt, maxBands) {
      const dens = this.th.fogDensity;
      if (dens <= 0.02) return;
      const tex = this._fogTexture();
      const s = cam.scale;
      const H = this.cssH;
      const vr = cam.visibleRect(220, p, this._rect);
      const b0 = Math.floor(vr.y0 / FOG_SPACING);
      const b1 = Math.floor(vr.y1 / FOG_SPACING);
      const t = this.time;
      const texW = tex.width; // device px
      const bw = this.canvas.width;
      const bandH = FOG_BAND_CSS;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      let drawn = 0;
      for (let b = b0; b <= b1 && drawn < maxBands; b++) {
        const h1 = U.hash(b * 3 + salt * 977);
        if (h1 > 0.62) continue;
        const h2 = U.hash(b * 7 + 11 + salt * 31);
        const h3 = U.hash(b * 13 + 5 + salt * 7);
        const yL = b * FOG_SPACING + h2 * FOG_SPACING;
        const sy = (yL - cam.y * p) * s + H * 0.5 - bandH * 0.5;
        if (sy > H || sy + bandH < 0) continue;
        const a = (0.08 + h1 * 0.12) * dens * 1.6 * strength;
        ctx.globalAlpha = a > 0.3 ? 0.3 : a;
        // horizontal drift (+ the layer's own parallax), wrapped around the texture
        const drift = ((t * (5 + h2 * 9) * (h3 > 0.5 ? 1 : -1) + h1 * 4000) * s - cam.x * p * s) * this.dprX;
        let x = Math.round(drift % texW);
        if (x > 0) x -= texW;
        const y = Math.round(sy * this.dprY);
        for (; x < bw; x += texW) ctx.drawImage(tex, x, y);
        drawn++;
      }
      ctx.globalAlpha = 1;
    }

    // -------------------------------------------------------------------------
    // Decor layers
    // -------------------------------------------------------------------------
    _layerP(layer) {
      return layer === 'far' ? this._pFar : layer === 'mid' ? this._pMid : this._pNear;
    }

    _decorParts(d) {
      let parts = this._decorCache.get(d);
      if (parts === undefined) {
        const build = DECOR_BUILDERS[d.type];
        parts = null;
        if (build && isFinite(d.x) && isFinite(d.y) && isFinite(d.w) && isFinite(d.h)) {
          const r = U.rng(seedOf(d) >>> 0);
          const p = finite(d.parallax, this._layerP(d.layer));
          try {
            parts = build(d, r, this.ctx, this._centerX * p);
          } catch (err) {
            parts = null;
            if (typeof console !== 'undefined') console.warn('[AT] decor build failed', d.type, err);
          }
        }
        this._decorCache.set(d, parts);
      }
      return parts;
    }

    _drawDecorLayer(ctx, cam, level, layer) {
      if (typeof level.decorInRect !== 'function') return;
      const p = this._layerP(layer);
      const vr = cam.visibleRect(DECOR_MARGIN, p, this._rect);
      const list = level.decorInRect(vr.x0, vr.y0, vr.x1, vr.y1, layer, this._decor);
      if (!list || list.length === 0) return;
      const pal = layer === 'far' ? this._pal.far : layer === 'mid' ? this._pal.mid : this._pal.near;
      const near = layer === 'near';
      const s = cam.scale;
      const W = this.cssW;
      cam.applyTransform(ctx, p);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      const t = this.time;
      const hair = 1 / (s * this.dprX); // one device px in layer units
      for (let i = 0; i < list.length; i++) {
        const d = list[i];
        const parts = this._decorParts(d);
        if (!parts) continue;
        let layerAlpha = near ? 0.94 : 1;
        if (near) {
          // Fade occluders that cover the central play column.
          const sx0 = (d.x - cam.x * p) * s + W * 0.5;
          const sx1 = sx0 + d.w * s;
          const c0 = W * 0.3;
          const c1 = W * 0.7;
          const ov = Math.max(0, Math.min(sx1, c1) - Math.max(sx0, c0)) / (c1 - c0);
          layerAlpha = 0.94 - ov * 0.62;
        }
        this._drawParts(ctx, parts.list, pal, layerAlpha, t, hair, layer === 'far' ? -1 : 6);
        if (parts.text && !near) this._drawSignText(ctx, parts.text, pal);
        if (parts.beam) this._drawBeam(ctx, cam, d, p, layer);
        if (parts.light && !near) this._lampLight(ctx, cam, d, parts, p, pal);
        if (parts.pointLights && parts.pointLights.length) {
          ctx.globalCompositeOperation = 'source-over';
          const L = parts.pointLights;
          for (let k = 0; k < L.length; k += 4) {
            const r = L[k + 2] * 6;
            ctx.globalAlpha = 0.25 * (0.6 + 0.4 * U.noise1(t * 0.3 + L[k + 3], 4));
            ctx.drawImage(this._warmSprite, L[k] - r, L[k + 1] - r, r * 2, r * 2);
          }
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this.stats.decor = list.length;
    }

    _drawParts(ctx, list, pal, layerAlpha, t, hair, detailMax) {
      // detailMax < 0: a distant layer — every stroke is a hairline and every
      // fill opaque (big far silhouettes are the costliest pixels in a frame)
      const far = detailMax < 0;
      const dmax = hair * (detailMax || 4);
      for (let j = 0; j < list.length; j++) {
        const pt = list[j];
        const xf = pt.xf;
        if (xf) {
          ctx.save();
          ctx.translate(xf.x, xf.y);
          let ang = 0;
          if (xf.swing) ang += Math.sin(t * xf.spd + xf.ph) * xf.swing;
          if (xf.rot) ang += t * xf.rot + xf.ph;
          if (ang) ctx.rotate(ang);
        }
        // (translucent glows — window slits etc. — keep their alpha)
        ctx.globalAlpha = far && pt.w === 0 && pt.a >= 0.5 ? layerAlpha : pt.a * layerAlpha;
        if (pt.w > 0) {
          ctx.strokeStyle = pal[pt.tone];
          // fine detail → hairline (fast path); structural strokes keep their width
          ctx.lineWidth = hair && (far || pt.w < hair * 2.5 || (DETAIL_TONE[pt.tone] && pt.w < dmax)) ? hair : pt.w;
          ctx.stroke(pt.path);
        } else {
          ctx.fillStyle = pal[pt.tone];
          ctx.fill(pt.path);
        }
        if (xf) ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    _drawSignText(ctx, tp, pal) {
      ctx.font = tp.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = pal[T_TEXT];
      ctx.globalAlpha = 0.72;
      for (let i = 0; i < tp.lines.length; i++) ctx.fillText(tp.lines[i], tp.x, tp.y + i * tp.lh);
      ctx.globalAlpha = 1;
    }

    _drawBeam(ctx, cam, d, p, layer) {
      const colArr = d.color ? this._beamColor(d.color) : this.th.light;
      const s = cam.scale;
      const sx = (d.x - cam.x * p) * s + this.cssW * 0.5;
      const sy = (d.y - cam.y * p) * s + this.cssH * 0.5;
      this._drawBeamFast(ctx, colArr, layer === 'near' ? 0.07 : 0.13, sx, sy, d.w * s, d.h * s);
      cam.applyTransform(ctx, p); // restore the layer transform for the next item
      // Cut through the darkness too (screen space).
      this._addLight(sx + d.w * s * 0.5, sy, d.w * s, 0.5, 0, 1, d.h * s);
    }

    _beamColor(str) {
      if (!this._beamColors) this._beamColors = new Map();
      let c = this._beamColors.get(str);
      if (!c) {
        c = hexToRgb(str, MAT.cyan);
        this._beamColors.set(str, c);
      }
      return c;
    }

    _lampLight(ctx, cam, d, parts, p, pal) {
      const L = parts.light;
      const t = this.time;
      // Flicker: mostly steady, with occasional dropouts (dead work-lights).
      const step = Math.floor(t * 9 + L.seed);
      const drop = U.hash(step) < 0.16 * L.flicker ? 0.12 : 1;
      const k = (0.75 + 0.25 * U.noise1(t * 6 + L.seed, 2)) * drop;
      ctx.fillStyle = k > 0.5 ? this._pal.world.amber || pal[T_GLOW] : pal[T_DARK];
      ctx.globalAlpha = 0.6 + 0.4 * k;
      ctx.fill(L.glass);
      ctx.globalAlpha = 1;
      const s = cam.scale;
      const sx = (L.x - cam.x * p) * s + this.cssW * 0.5;
      const sy = (L.y - cam.y * p) * s + this.cssH * 0.5;
      this._addLight(sx, sy, L.r * s * (0.85 + 0.15 * k), 0.75 * k, 1, 0, 0);
    }

    /**
     * A copy of `src` resampled once to exactly radius r (device or buffer px),
     * cached per slot and rebuilt only when r changes by more than ~3%.
     */
    _exactSprite(slot, r, src) {
      if (!this._exact) this._exact = {};
      const size = Math.max(4, Math.round(r * 2));
      let e = this._exact[slot];
      if (!e || Math.abs(e.size - size) > Math.max(2, size * 0.03) || e.src !== src) {
        const c = makeCanvas(size, size);
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.drawImage(src, 0, 0, size, size);
        e = { size, src, c };
        this._exact[slot] = e;
      }
      return e.c;
    }

    _addLight(x, y, r, a, glow, beam, h, priority) {
      // Decor lights leave a few slots free for the lantern and the Still Lamp.
      const cap = priority ? MAX_LIGHTS : MAX_LIGHTS - 4;
      if (this._lightCount >= cap || !(r > 0) || !(a > 0)) return;
      const W = this.cssW;
      const H = this.cssH;
      if (beam) {
        if (x + r < 0 || x - r > W || y > H || y + h < 0) return;
      } else if (x + r < 0 || x - r > W || y + r < 0 || y - r > H) {
        return;
      }
      const L = this._lights[this._lightCount++];
      L.x = x;
      L.y = y;
      L.r = r;
      L.a = a;
      L.glow = glow;
      L.beam = beam;
      L.w = r;
      L.h = h;
      L.lantern = 0;
    }

    _drawNearProc(ctx, cam, level) {
      const p = P_NEAR_PROC;
      const vr = cam.visibleRect(200, p, this._rect);
      const k0 = Math.floor((vr.y0 - 700) / NEAR_CHUNK);
      const k1 = Math.floor(vr.y1 / NEAR_CHUNK);
      const b = this._bounds;
      // Occluders live beyond the shaft walls, at the very edges of the frame.
      const leftX = finite(b.x0, 0) * p + (this._centerX * p - this._centerX) - 40;
      const rightX = finite(b.x1, 1800) * p + (this._centerX * p - this._centerX) + 40;
      if (this._nearProc.size > 16) {
        for (const key of this._nearProc.keys()) if (key < k0 - 3 || key > k1 + 3) this._nearProc.delete(key);
      }
      cam.applyTransform(ctx, p);
      const pal = this._pal.near;
      ctx.fillStyle = pal[T_BASE];
      ctx.strokeStyle = pal[T_BASE];
      ctx.lineWidth = 7;
      ctx.globalAlpha = 0.9;
      for (let k = k0; k <= k1; k++) {
        let ch = this._nearProc.get(k);
        if (!ch) {
          ch = buildNearChunk(k, this._seed, leftX, rightX);
          this._nearProc.set(k, ch);
        }
        ctx.fill(ch.fill);
        ctx.stroke(ch.stroke);
      }
      ctx.globalAlpha = 1;
      void level;
    }

    // -------------------------------------------------------------------------
    // Lighting
    // -------------------------------------------------------------------------
    _lanternInfo(game) {
      const pl = game.player;
      const t = this.time;
      const thr = this._threat || 0;
      const fl = 1 + (U.noise1(t * 2.3, 5) * 0.035 + U.noise1(t * 9.1, 6) * 0.015) * (1 + thr * 1.8);
      let strength = 1;
      if (!pl || !this._showPlayer) strength = 0;
      else if (pl.alive === false) strength = U.clamp(1 - finite(game.deathFade, 0) * 1.1, 0, 1) * 0.85;
      const out = this._lantern;
      out.fl = fl;
      out.strength = strength;
      return out;
    }

    _collectWorldLights(game, cam, level) {
      const s = cam.scale;
      const pl = game.player;
      const info = this._lanternInfo(game);
      if (info.strength > 0 && pl) {
        const p = cam.worldToScreen(finite(pl.rx, pl.x), finite(pl.ry, pl.y), this._pt);
        this._addLight(p.x, p.y - 4 * s, LANTERN_R * s, info.strength * info.fl, 1, 0, 0, true);
        this._lights[this._lightCount - 1].lantern = 1;
      } else if (!this._showPlayer) {
        // Attract mode / no player: a wide, dim searching light keeps the shaft legible.
        const r = Math.max(cam.viewW, cam.viewH) * 0.55 * s;
        this._addLight(this.cssW * 0.5, this.cssH * 0.45, r, 0.55, 0, 0, 0, true);
      }
      // The Still Lamp — steady, never flickers. Grows during the victory sequence.
      const g = level.goal;
      if (g && isFinite(g.x)) {
        const lx = g.x + g.w * 0.5;
        const ly = g.y + g.h * 0.3;
        const vt = finite(game.victoryT, -1);
        const grow = vt >= 0 ? 1 + Math.min(vt, 3) * 0.45 : 1;
        const p = cam.worldToScreen(lx, ly, this._pt);
        this._addLight(p.x, p.y, 560 * s * grow, 1, 3, 0, 0, true);
      }
    }

    _buildDarkness(cam, level) {
      const d = this._dark;
      const g = this._darkCtx;
      const k = this._darkK;
      const col = this._col;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.imageSmoothingEnabled = false;
      g.globalCompositeOperation = 'copy';
      g.globalAlpha = col.darkAlpha;
      g.fillStyle = css(col.darkArr);
      g.fillRect(0, 0, d.width, d.height);
      // Solids are darker than open air outside the light, so they read as
      // silhouettes against the haze. Painted into this low-res buffer (inset
      // on exposed edges so it never bleeds into the air); the light holes cut
      // below then reveal stone and air together.
      this._solidDarkInBuffer(g, cam, level, col);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < this._lightCount; i++) {
        const L = this._lights[i];
        g.globalAlpha = L.a > 1 ? 1 : L.a;
        if (L.lantern) {
          // exact-size sprite → integer 1:1 blit
          const spr = this._exactSprite('hole', L.r * k, this._lightSprite);
          g.drawImage(spr, Math.round(L.x * k - spr.width * 0.5), Math.round(L.y * k - spr.height * 0.5));
        } else if (L.beam) {
          g.drawImage(this._beamWhite, (L.x - L.w * 0.5) * k, L.y * k, L.w * k, L.h * k);
        } else {
          const r = L.r * k;
          g.drawImage(this._lightSprite, L.x * k - r, L.y * k - r, r * 2, r * 2);
        }
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }

    _solidDarkInBuffer(g, cam, level, col) {
      const list = this._visSolids;
      if (!list || list.length === 0) return;
      const k = this._darkK;
      const sc = cam.scale * k;
      const ox = this.cssW * 0.5 * k - cam.x * sc;
      const oy = this.cssH * 0.5 * k - cam.y * sc;
      const inset = 1.5; // buffer texels
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = col.solidAlpha;
      g.fillStyle = css(col.darkArr);
      g.beginPath();
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.active === false) continue;
        const c = this._solidParts(s, level);
        const r = this._stripRect(s, c);
        let x0 = r.x0 * sc + ox;
        let y0 = r.y0 * sc + oy;
        let x1 = r.x1 * sc + ox;
        let y1 = r.y1 * sc + oy;
        // inset only where the edge is exposed (no light seams between touching solids)
        if (c.left && r.x0 === s.x) x0 += inset;
        if (c.right && r.x1 === s.x + s.w) x1 -= inset;
        if (c.top && r.y0 === s.y) y0 += inset;
        if (c.bottom && r.y1 === s.y + s.h) y1 -= inset;
        if (x1 - x0 > 0.5 && y1 - y0 > 0.5) g.rect(x0, y0, x1 - x0, y1 - y0);
      }
      g.fill();
    }

    /** Visible solids for this frame (shared by the darkness build, drawing and edge passes). */
    _querySolids(cam, level) {
      const list = this._solids;
      list.length = 0;
      this._visSolids = list;
      if (typeof level.querySolids !== 'function') return list;
      const vr = cam.visibleRect(40, 1, this._rect2);
      level.querySolids(vr.x0, vr.y0, vr.x1, vr.y1, list);
      return list;
    }

    _applyDarkness(ctx, threat, beat, reduced) {
      const g = this._darkCtx;
      const d = this._dark;
      // Vignette (threat + heartbeat) and threat edge tint go into the same buffer → one blit.
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = U.clamp(0.4 + threat * 0.3 + beat * threat * 0.18, 0, 1);
      g.drawImage(this._vignette, 0, 0, d.width, d.height);
      if (!reduced && threat > 0.12) {
        // "Distortion": a chromatic edge shimmer — bone on one side, rust on the other.
        const k = U.smoothstep(0.12, 1, threat);
        const jit = (1.5 + beat * 3) * k;
        const wx = Math.round(Math.sin(this.time * 2.1) * jit);
        const wy = Math.round(Math.cos(this.time * 1.3) * jit * 0.5);
        g.globalAlpha = U.clamp(k * (0.3 + beat * 0.3), 0, 1);
        g.drawImage(this._tint, -TINT_PAD + wx, -TINT_PAD + wy);
      }
      g.globalAlpha = 1;
      ctx.setTransform(this.dprX, 0, 0, this.dprY, 0, 0);
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(d, 0, 0, this.cssW, this.cssH);
      ctx.imageSmoothingEnabled = true;
    }

    _drawGlows(ctx) {
      ctx.setTransform(this.dprX, 0, 0, this.dprY, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = false;
      for (let i = 0; i < this._lightCount; i++) {
        const L = this._lights[i];
        if (!L.glow || L.beam) continue;
        const r = L.r * (L.glow === 3 ? 0.7 : 0.85);
        ctx.globalAlpha = L.a * (L.glow === 1 ? 0.16 : L.glow === 3 ? 0.3 : 0.18);
        if (L.lantern || L.glow === 3) {
          const spr = L.lantern ? this._exactSprite('glow', r * this.dprX, this._warmSprite) : this._exactSprite('still', r * this.dprX, this._paleSprite);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(spr, Math.round(L.x * this.dprX - spr.width * 0.5), Math.round(L.y * this.dprY - spr.height * 0.5));
          ctx.setTransform(this.dprX, 0, 0, this.dprY, 0, 0);
          continue;
        }
        const spr = L.glow === 1 ? this._warmSprite : L.glow === 3 ? this._paleSprite : this._coldSprite;
        ctx.drawImage(spr, L.x - r, L.y - r, r * 2, r * 2);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // -------------------------------------------------------------------------
    // 4. World: solids
    // -------------------------------------------------------------------------
    _solidParts(s, level) {
      let c = this._solidCache.get(s);
      if (!c) {
        c = this._buildSolid(s, level);
        this._solidCache.set(s, c);
      }
      return c;
    }

    _buildSolid(s, level) {
      const r = U.rng(seedOf(s) >>> 0);
      const c = { seams: P(), seamFill: P(), hi: P(), shade: P(), iron: P(), verd: P(), growth: P(), growthFill: P(), fringe: P(), cracks: [P(), P(), P()], face: 0, top: true, bottom: true, left: true, right: true };
      const tmp = this._tmp;
      if (typeof level.querySolids === 'function') {
        const touches = (x0, y0, x1, y1) => {
          const list = level.querySolids(x0, y0, x1, y1, tmp);
          for (let i = 0; i < list.length; i++) {
            const o = list[i];
            if (o === s) continue;
            if (o.x < x1 && o.x + o.w > x0 && o.y < y1 && o.y + o.h > y0) return true;
          }
          return false;
        };
        c.top = !touches(s.x + 6, s.y - 3, s.x + s.w - 6, s.y - 0.5);
        c.bottom = !touches(s.x + 6, s.y + s.h + 0.5, s.x + s.w - 6, s.y + s.h + 3);
        c.left = !touches(s.x - 3, s.y + 6, s.x - 0.5, s.y + s.h - 6);
        c.right = !touches(s.x + s.w + 0.5, s.y + 6, s.x + s.w + 3, s.y + s.h - 6);
      }
      const kind = s.kind || 'stone';
      // Walls and big stone masses (e.g. the chamber floor) get coursed masonry.
      c.masonry = kind === 'wall' || ((kind === 'stone' || !kind) && s.h >= 140);
      if (c.masonry) this._buildWall(s, c, r, kind === 'wall');
      else if (kind === 'metal') this._buildMetal(s, c, r);
      else if (kind === 'bridge') this._buildBridge(s, c, r);
      else if (kind === 'grate') this._buildGrate(s, c, r);
      else this._buildStone(s, c, r, kind === 'crumble');
      return c;
    }

    _buildWall(s, c, r, isWall) {
      const cx = s.x + s.w * 0.5;
      let faceX = s.x;
      let reach = s.w;
      let dx0 = s.x;
      if (isWall) {
        c.face = cx < this._centerX ? 1 : -1; // +1: the shaft-facing side is the right edge
        faceX = c.face > 0 ? s.x + s.w : s.x;
        reach = Math.min(s.w, 460); // detail only near the face; deeper is in gradient shadow
        dx0 = c.face > 0 ? s.x + s.w - reach : s.x;
      } else {
        reach = Math.min(s.w, 3000);
      }
      const rowH = 64;
      const r0 = Math.floor(s.y / rowH);
      const r1 = Math.ceil((s.y + s.h) / rowH);
      const dx1 = dx0 + reach;
      const growthK = 0.12 + (s.section || 0) * 0.06; // more living growth the deeper you go
      for (let row = r0; row < r1; row++) {
        const y = row * rowH;
        if (y > s.y + 1 && y < s.y + s.h - 1) c.seamFill.rect(dx0, y - SEAM * 0.5, dx1 - dx0, SEAM);
        const yTop = Math.max(s.y, y);
        const yBot = Math.min(s.y + s.h, y + rowH);
        if (yBot - yTop < 4) continue;
        const hr = U.hash(row * 7919 + 13);
        const spacing = 96 + hr * 80;
        let jx = dx0 - U.hash(row * 31 + 3) * spacing;
        let prev = dx0;
        while (jx < dx1) {
          jx += spacing * (0.7 + U.hash((row * 131 + Math.floor(jx)) | 0) * 0.6);
          const x = Math.min(jx, dx1);
          if (x < dx1 - 4) c.seamFill.rect(x - SEAM * 0.5, yTop, SEAM, yBot - yTop);
          // per-block bevel highlight + random darker blocks
          if (x - prev > 12) {
            c.hi.moveTo(prev + 3, yTop + 2.5);
            c.hi.lineTo(x - 3, yTop + 2.5);
            if (r() < 0.22) c.shade.rect(prev, yTop, x - prev, yBot - yTop);
          }
          prev = x;
        }
        // iron bands across the face every few rows (walls only)
        if (isWall && U.hash(row * 53 + 1) < 0.1 && yBot - yTop > 20) {
          const by = yTop + 6;
          const bw = Math.min(reach, 240);
          const bx0 = c.face > 0 ? s.x + s.w - bw : c.face < 0 ? s.x : s.x + r() * Math.max(0, s.w - bw);
          c.iron.rect(bx0, by, bw, 12);
          for (let rx = bx0 + 10; rx < bx0 + bw - 6; rx += 26) {
            c.verd.moveTo(rx, by + 12);
            c.verd.lineTo(rx + (r() - 0.5) * 3, by + 12 + 16 + r() * 70);
          }
        }
        if (r() < 0.07) {
          // crack zig-zag
          let x = dx0 + r() * reach;
          let yy = yTop + 4;
          c.cracks[0].moveTo(x, yy);
          for (let k = 0; k < 4; k++) {
            x += (r() - 0.5) * 30;
            yy += 8 + r() * 16;
            c.cracks[0].lineTo(x, Math.min(yy, s.y + s.h - 2));
          }
        }
      }
      // living growth: sinuous cords running down the face
      const faceInset = c.face > 0 ? -1 : 1;
      for (let y = s.y + r() * 300; isWall && y < s.y + s.h - 60; y += 260 + r() * 520) {
        if (r() > growthK * 3) continue;
        let x = faceX + faceInset * (8 + r() * 40);
        const len = 160 + r() * 520;
        c.growth.moveTo(x, y);
        let gy = y;
        for (let yy = y; yy < Math.min(y + len, s.y + s.h - 8); yy += 40) {
          const nx = faceX + faceInset * (6 + r() * 60);
          c.growth.quadraticCurveTo(x + faceInset * 18, yy + 20, nx, yy + 40);
          // the cord body as a filled, slightly tapering band (cheap); the
          // centreline path stays for a hairline highlight
          addBand(c.growthFill, x, gy, x + faceInset * 18, yy + 20, nx, yy + 40, 7.5, 6);
          gy = yy + 40;
          x = nx;
        }
      }
      // ragged lower lip where the wall ends above open space
      if (c.bottom) {
        for (let x = s.x + 4; x < s.x + s.w - 10; x += 14 + r() * 22) triDown(c.fringe, x, s.y + s.h, 8 + r() * 10, 6 + r() * 22);
      }
    }

    _buildStone(s, c, r, crumble) {
      const w = s.w;
      const h = s.h;
      // vertical joints
      for (let x = s.x + 40 + r() * 50; x < s.x + w - 20; x += 50 + r() * 60) c.seamFill.rect(x - 1, s.y + 4, 2, h - 5);
      if (h > 46) {
        for (let y = s.y + 44; y < s.y + h - 12; y += 44) c.seamFill.rect(s.x, y - 1, w, 2);
      }
      c.hi.rect(s.x, s.y, w, Math.min(4, h * 0.25));
      c.shade.rect(s.x, s.y + h - Math.min(7, h * 0.3), w, Math.min(7, h * 0.3));
      if (c.bottom) {
        for (let x = s.x + 3; x < s.x + w - 8; x += 9 + r() * 16) triDown(c.fringe, x, s.y + h, 5 + r() * 7, 3 + r() * (crumble ? 14 : 9));
      }
      if (!crumble && r() < 0.5) {
        let x = s.x + r() * w;
        let y = s.y + 4;
        c.cracks[0].moveTo(x, y);
        for (let k = 0; k < 3 && y < s.y + h - 4; k++) {
          x += (r() - 0.5) * 20;
          y += 6 + r() * 10;
          c.cracks[0].lineTo(x, Math.min(y, s.y + h - 2));
        }
      }
      if (crumble) {
        // Three crack stages revealed as load rises (shape-coded fragility).
        for (let stage = 0; stage < 3; stage++) {
          const n = 2 + stage * 2;
          for (let i = 0; i < n; i++) {
            let x = s.x + 8 + r() * (w - 16);
            let y = stage === 0 ? s.y + 2 : s.y + r() * h * 0.5;
            const path = c.cracks[stage];
            path.moveTo(x, y);
            for (let k = 0; k < 4; k++) {
              x += (r() - 0.5) * 24;
              y += 4 + r() * (h * 0.3);
              path.lineTo(x, Math.min(y, s.y + h - 1));
            }
          }
        }
        // eroded, chipped top corners
        triDown(c.shade, s.x - 1, s.y - 0.5, 9, 6);
        triDown(c.shade, s.x + w - 8, s.y - 0.5, 9, 6);
      }
    }

    _buildMetal(s, c, r) {
      const w = s.w;
      const h = s.h;
      const fl = Math.min(5, h * 0.22);
      c.hi.rect(s.x, s.y, w, fl);
      c.shade.rect(s.x, s.y + h - fl, w, fl);
      if (h >= 26) {
        // truss web
        const cell = Math.max(24, h);
        let up = true;
        for (let x = s.x; x < s.x + w - 2; x += cell) {
          const x2 = Math.min(s.x + w, x + cell);
          c.seams.moveTo(x, up ? s.y + fl : s.y + h - fl);
          c.seams.lineTo(x2, up ? s.y + h - fl : s.y + fl);
          up = !up;
        }
      }
      for (let x = s.x + 8; x < s.x + w - 4; x += 16) {
        c.iron.moveTo(x + 1.4, s.y + fl * 0.5 + 0.5);
        c.iron.arc(x, s.y + fl * 0.5 + 0.5, 1.4, 0, Math.PI * 2);
      }
      for (let i = 0; i < Math.ceil(w / 90); i++) {
        const x = s.x + r() * w;
        c.verd.moveTo(x, s.y + h - fl);
        c.verd.lineTo(x + (r() - 0.5) * 2, s.y + h + 4 + r() * 18);
      }
    }

    _buildBridge(s, c, r) {
      const w = s.w;
      const h = s.h;
      const deck = Math.min(9, h * 0.4);
      for (let x = s.x; x < s.x + w - 2; x += 18 + r() * 8) {
        c.hi.rect(x + 1, s.y, Math.min(17, s.x + w - x - 1), deck);
      }
      c.shade.rect(s.x, s.y + h - Math.min(6, h * 0.25), w, Math.min(6, h * 0.25));
      for (let x = s.x + 6; x < s.x + w - 4; x += 38) {
        c.seamFill.rect(x - 1.5, s.y + deck, 3, h - deck);
        c.seams.moveTo(x, s.y + deck);
        c.seams.lineTo(Math.min(x + 38, s.x + w - 2), s.y + h - 2);
      }
    }

    _buildGrate(s, c) {
      const w = s.w;
      const h = s.h;
      const t = Math.min(5, h * 0.25);
      c.hi.rect(s.x, s.y, w, t);
      c.shade.rect(s.x, s.y + h - t, w, t);
      for (let x = s.x + 6; x < s.x + w - 2; x += 9) c.seamFill.rect(x - 1.3, s.y + t, 2.6, h - t * 2);
    }

    _drawSolids(ctx, cam, level, game) {
      if (typeof level.querySolids !== 'function') return;
      const vr = cam.visibleRect(40, 1, this._rect);
      const list = this._visSolids;
      void vr;
      const pal = this._pal.world;
      const t = this.time;
      const s1 = 1 / Math.max(0.05, cam.scale); // one CSS px in world units
      const hair = s1 / this.dprX; // one device px
      const crumbleTime = finite(game.diff && game.diff.crumbleTime, 0.9);
      // Walls first (big masses), then platforms on top.
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          if (s.active === false) continue;
          const c = this._solidParts(s, level);
          if (pass === 0 ? !c.masonry : c.masonry) continue;
          let shook = false;
          if (s.kind === 'crumble' && s.load > 0) {
            const k = U.clamp(s.load / (crumbleTime * finite(s.life, 1)), 0, 1);
            ctx.save();
            ctx.translate(Math.sin(t * 71) * k * 2.2, Math.cos(t * 53) * k * 1.2);
            shook = true;
          }
          this._drawSolid(ctx, s, c, pal, s1, crumbleTime, hair);
          if (shook) ctx.restore();
        }
      }
      this.stats.solids = list.length;
    }

    _drawSolid(ctx, s, c, pal, px, crumbleTime, hair) {
      const kind = s.kind || 'stone';
      const x = s.x;
      const y = s.y;
      const w = s.w;
      const h = s.h;
      if (c.masonry) {
        // Deep interior (beyond the lantern's reach): one opaque, pre-darkened fill;
        // only the exposed strip gets texture, depth shading and the darkness pass.
        const ir = this._interiorRect(s, c);
        ctx.fillStyle = kind === 'wall' ? pal.wall : pal.stone;
        if (ir) {
          const st = this._stripRect(s, c);
          ctx.fillRect(st.x0, st.y0, st.x1 - st.x0, st.y1 - st.y0);
          ctx.fillStyle = kind === 'wall' ? this._col.wallInterior : this._col.stoneInterior;
          ctx.fillRect(ir.x0, ir.y0, ir.x1 - ir.x0, ir.y1 - ir.y0);
        } else {
          ctx.fillRect(x, y, w, h);
        }
        ctx.fillStyle = pal.shade;
        ctx.globalAlpha = 0.35;
        ctx.fill(c.shade);
        ctx.globalAlpha = 1;
        ctx.fillStyle = pal.seam;
        ctx.fill(c.seamFill);
        ctx.strokeStyle = pal.rim;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = hair;
        ctx.stroke(c.hi);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = pal.seam;
        ctx.stroke(c.cracks[0]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = pal.metal;
        ctx.fill(c.iron);
        ctx.strokeStyle = pal.verd;
        ctx.globalAlpha = 0.7;
        ctx.stroke(c.verd);
        ctx.globalAlpha = 1;
        ctx.fillStyle = pal.growth;
        ctx.fill(c.growthFill);
        ctx.strokeStyle = pal.bone;
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = hair;
        ctx.stroke(c.growth);
        ctx.globalAlpha = 1;
        this._depthShade(ctx, s, c);
        ctx.fillStyle = kind === 'wall' ? pal.wall : pal.stone;
        ctx.fill(c.fringe);
      } else {
        const base = kind === 'metal' || kind === 'grate' ? pal.metal : kind === 'bridge' ? pal.wood : kind === 'crumble' ? pal.crumble : pal.stone;
        if (kind === 'grate' || kind === 'bridge') {
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = pal.shade;
          ctx.fillRect(x, y, w, h);
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = base;
          ctx.fillRect(x, y, w, h);
        }
        ctx.fillStyle = kind === 'bridge' ? pal.wood : pal.rim;
        ctx.globalAlpha = kind === 'bridge' ? 1 : 0.35;
        ctx.fill(c.hi);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = pal.shade;
        ctx.fill(c.shade);
        ctx.globalAlpha = 1;
        ctx.fillStyle = kind === 'grate' || kind === 'bridge' ? base : pal.seam;
        ctx.fill(c.seamFill);
        ctx.strokeStyle = kind === 'bridge' ? base : pal.seam;
        ctx.lineWidth = kind === 'bridge' ? 3 : Math.max(1.8, px);
        ctx.stroke(c.seams);
        if (kind === 'metal') {
          ctx.fillStyle = pal.rim;
          ctx.globalAlpha = 0.45;
          ctx.fill(c.iron);
          ctx.strokeStyle = pal.verd;
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = hair;
          ctx.stroke(c.verd);
          ctx.globalAlpha = 1;
        }
        // cracks: crumble reveals more as it is loaded
        let stages = 1;
        if (kind === 'crumble') {
          const k = U.clamp(finite(s.load, 0) / (crumbleTime * finite(s.life, 1)), 0, 1);
          stages = k > 0.6 ? 3 : k > 0.15 ? 2 : 1;
          ctx.strokeStyle = pal.rim;
          ctx.globalAlpha = 0.6 + k * 0.4;
          ctx.lineWidth = k > 0.6 ? Math.max(hair * 2, px) : hair;
        } else {
          ctx.strokeStyle = pal.seam;
          ctx.lineWidth = hair;
        }
        for (let i = 0; i < stages; i++) ctx.stroke(c.cracks[i]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = kind === 'crumble' ? pal.crumble : base;
        if (kind !== 'grate' && kind !== 'bridge') ctx.fill(c.fringe);
        // outline: crisp collision silhouette
        ctx.strokeStyle = pal.seam;
        ctx.lineWidth = Math.max(1.5, px * 1.2);
        ctx.strokeRect(x, y, w, h);
      }
      // lit exposed top edge (standable surfaces read clearly)
      if (c.top) {
        ctx.strokeStyle = pal.rim;
        ctx.globalAlpha = kind === 'wall' ? 0.55 : 0.8;
        ctx.lineWidth = Math.max(2, px * 1.5);
        ctx.beginPath();
        ctx.moveTo(x, y + 1);
        ctx.lineTo(x + w, y + 1);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (c.face) {
        // the shaft-facing edge: a cool, crisp lip
        const fx = c.face > 0 ? x + w - 1.5 : x + 1.5;
        ctx.strokeStyle = pal.rim;
        ctx.globalAlpha = 0.42;
        ctx.lineWidth = Math.max(2.5, px * 1.6);
        ctx.beginPath();
        ctx.moveTo(fx, y);
        ctx.lineTo(fx, y + h);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    /**
     * World rect of a masonry solid's deep interior (further than INTERIOR from
     * its exposed face), or null. Returns a shared scratch object.
     */
    _interiorRect(s, c) {
      if (!c.masonry) return null;
      const o = this._ir || (this._ir = { x0: 0, y0: 0, x1: 0, y1: 0 });
      if (c.face > 0) {
        const x1 = s.x + s.w - INTERIOR;
        if (x1 <= s.x + 4) return null;
        o.x0 = s.x;
        o.x1 = x1;
        o.y0 = s.y;
        o.y1 = s.y + s.h;
      } else if (c.face < 0) {
        const x0 = s.x + INTERIOR;
        if (x0 >= s.x + s.w - 4) return null;
        o.x0 = x0;
        o.x1 = s.x + s.w;
        o.y0 = s.y;
        o.y1 = s.y + s.h;
      } else {
        const y0 = s.y + INTERIOR;
        if (y0 >= s.y + s.h - 4) return null;
        o.x0 = s.x;
        o.x1 = s.x + s.w;
        o.y0 = y0;
        o.y1 = s.y + s.h;
      }
      return o;
    }

    /** The exposed strip of a solid (the whole solid when it has no interior). Shared scratch. */
    _stripRect(s, c) {
      const o = this._sr || (this._sr = { x0: 0, y0: 0, x1: 0, y1: 0 });
      o.x0 = s.x;
      o.y0 = s.y;
      o.x1 = s.x + s.w;
      o.y1 = s.y + s.h;
      if (this._interiorRect(s, c)) {
        if (c.face > 0) o.x0 = s.x + s.w - INTERIOR;
        else if (c.face < 0) o.x1 = s.x + INTERIOR;
        else o.y1 = s.y + INTERIOR;
      }
      return o;
    }

    /**
     * Masonry sinks into shadow away from its exposed face (walls: sideways from
     * the shaft-facing edge; slabs: downward from the top). Stepped solid bands
     * instead of a gradient — the block seams hide the steps.
     */
    _depthShade(ctx, s, c) {
      ctx.fillStyle = '#000';
      const steps = 6;
      const depth = 390;
      const st = depth / steps;
      // the last band is the interior when one exists (drawn pre-darkened instead)
      const last = this._interiorRect(s, c) ? steps - 1 : steps;
      for (let i = 1; i <= last; i++) {
        const a = 0.72 * (i / steps) * (0.55 + 0.45 * (i / steps));
        ctx.globalAlpha = a;
        const d0 = i * st - st * 0.5;
        const len = i === steps ? 1e5 : st;
        if (c.face > 0) {
          const x1 = s.x + s.w - d0;
          const x0 = Math.max(s.x, x1 - len);
          if (x1 > x0) ctx.fillRect(x0, s.y, x1 - x0, s.h);
        } else if (c.face < 0) {
          const x0 = s.x + d0;
          const x1 = Math.min(s.x + s.w, x0 + len);
          if (x1 > x0) ctx.fillRect(x0, s.y, x1 - x0, s.h);
        } else {
          const y0 = s.y + d0;
          const y1 = Math.min(s.y + s.h, y0 + len);
          if (y1 > y0) ctx.fillRect(s.x, y0, s.w, y1 - y0);
        }
      }
      ctx.globalAlpha = 1;
    }

    /** Faint edge lines drawn above the darkness: geometry stays readable in the dark. */
    _drawSolidEdgesAbove(ctx, cam) {
      const list = this._visSolids;
      if (!list || list.length === 0) return;
      cam.applyTransform(ctx, 1);
      const px = 1 / Math.max(0.05, cam.scale);
      ctx.strokeStyle = this._pal.world.edge;
      // a hairline (1 device px) is the cheap path; high contrast gets a bold line
      ctx.lineWidth = this._hc ? Math.max(1.2, px * 1.5) : px / this.dprX;
      ctx.globalAlpha = this._hc ? 0.5 : 0.22;
      ctx.beginPath();
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.active === false) continue;
        const c = this._solidCache.get(s);
        if (!c) continue;
        if (c.top) {
          ctx.moveTo(s.x, s.y + 0.5);
          ctx.lineTo(s.x + s.w, s.y + 0.5);
        }
        if (c.face) {
          const fx = c.face > 0 ? s.x + s.w : s.x;
          ctx.moveTo(fx, s.y);
          ctx.lineTo(fx, s.y + s.h);
        } else if (s.kind !== 'wall') {
          if (c.left) {
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(s.x, s.y + s.h);
          }
          if (c.right) {
            ctx.moveTo(s.x + s.w, s.y);
            ctx.lineTo(s.x + s.w, s.y + s.h);
          }
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // -------------------------------------------------------------------------
    // Gate + the Still Lamp
    // -------------------------------------------------------------------------
    _drawGateAndLamp(ctx, level, game) {
      const pal = this._pal.world;
      const gate = level.gate;
      if (gate && isFinite(gate.x) && isFinite(gate.w)) {
        const horiz = gate.w >= gate.h;
        const t = Math.max(4, Math.min(gate.w, gate.h) * 0.14);
        ctx.fillStyle = pal.metal;
        ctx.strokeStyle = pal.metal;
        ctx.lineWidth = Math.max(3, Math.min(gate.w, gate.h) * 0.08);
        ctx.beginPath();
        if (horiz) {
          for (let x = gate.x + 8; x < gate.x + gate.w - 4; x += 16) {
            ctx.moveTo(x, gate.y);
            ctx.lineTo(x, gate.y + gate.h);
          }
        } else {
          for (let y = gate.y + 8; y < gate.y + gate.h - 4; y += 16) {
            ctx.moveTo(gate.x, y);
            ctx.lineTo(gate.x + gate.w, y);
          }
        }
        ctx.stroke();
        ctx.fillRect(gate.x, gate.y, horiz ? gate.w : t, horiz ? t : gate.h);
        ctx.fillRect(horiz ? gate.x : gate.x + gate.w - t, horiz ? gate.y + gate.h - t : gate.y, horiz ? gate.w : t, horiz ? t : gate.h);
        ctx.strokeStyle = pal.seam;
        ctx.lineWidth = 2;
        ctx.strokeRect(gate.x, gate.y, gate.w, gate.h);
      }
      const g = level.goal;
      if (g && isFinite(g.x)) {
        // The Still Lamp: a tall cage of pale iron around a flame that does not move.
        const cx = g.x + g.w * 0.5;
        const cy = g.y + g.h * 0.3;
        ctx.strokeStyle = pal.metal;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 900);
        ctx.lineTo(cx, cy - 46);
        ctx.moveTo(cx - 22, cy - 34);
        ctx.lineTo(cx - 22, cy + 34);
        ctx.moveTo(cx + 22, cy - 34);
        ctx.lineTo(cx + 22, cy + 34);
        ctx.moveTo(cx - 8, cy - 40);
        ctx.lineTo(cx - 8, cy + 40);
        ctx.moveTo(cx + 8, cy - 40);
        ctx.lineTo(cx + 8, cy + 40);
        ctx.stroke();
        ctx.fillStyle = pal.metal;
        ctx.beginPath();
        ctx.moveTo(cx - 30, cy - 34);
        ctx.lineTo(cx + 30, cy - 34);
        ctx.lineTo(cx, cy - 50);
        ctx.closePath();
        ctx.moveTo(cx - 30, cy + 34);
        ctx.lineTo(cx + 30, cy + 34);
        ctx.lineTo(cx, cy + 50);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#f4ead2';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 18);
        ctx.quadraticCurveTo(cx + 9, cy + 2, cx, cy + 14);
        ctx.quadraticCurveTo(cx - 9, cy + 2, cx, cy - 18);
        ctx.fill();
      }
      void game;
    }

    // -------------------------------------------------------------------------
    // Hazards — readable danger SHAPES (spikes, rebar, saw blades), not colour alone.
    // -------------------------------------------------------------------------
    _hazParts(hz, level) {
      let c = this._hazCache.get(hz);
      if (!c) {
        c = this._buildHazard(hz, level);
        this._hazCache.set(hz, c);
      }
      return c;
    }

    _buildHazard(hz, level) {
      const r = U.rng(seedOf(hz) >>> 0);
      const { x, y, w, h } = hz;
      const c = { base: P(), metal: P(), tips: P(), rust: P(), discs: null };
      // Which way do the points face? Into open space: up for floor strips, toward
      // the shaft centre for tall wall strips, down for ceiling strips.
      let dir = 'up';
      if (h > w * 1.4) dir = x + w * 0.5 < this._centerX ? 'right' : 'left';
      else if (typeof level.querySolids === 'function') {
        const above = level.querySolids(x + 2, y - 4, x + w - 2, y - 1, this._tmp);
        let solidAbove = false;
        for (let i = 0; i < above.length; i++) if (above[i].y + above[i].h <= y + 1 && above[i].y + above[i].h >= y - 4) solidAbove = true;
        const below = level.querySolids(x + 2, y + h + 1, x + w - 2, y + h + 4, this._tmp);
        if (solidAbove && below.length === 0) dir = 'down';
      }
      c.dir = dir;
      const kind = hz.kind || 'spikes';
      const along = dir === 'up' || dir === 'down' ? w : h;
      const depth = dir === 'up' || dir === 'down' ? h : w;
      // map (a along, b out-from-base) → world
      const M = (a, b) => {
        if (dir === 'up') return [x + a, y + h - b];
        if (dir === 'down') return [x + a, y + b];
        if (dir === 'right') return [x + b, y + a];
        return [x + w - b, y + a];
      };
      const poly = (path, pts) => {
        // ensure positive winding by computing area
        let area = 0;
        for (let i = 0; i < pts.length; i++) {
          const p0 = pts[i];
          const p1 = pts[(i + 1) % pts.length];
          area += p0[0] * p1[1] - p1[0] * p0[1];
        }
        const n = pts.length;
        for (let i = 0; i < n; i++) {
          const p = pts[area >= 0 ? i : n - 1 - i];
          if (i === 0) path.moveTo(p[0], p[1]);
          else path.lineTo(p[0], p[1]);
        }
        path.closePath();
      };
      if (kind === 'blades') {
        const R = Math.min(along / 2, depth * 0.62);
        const n = Math.max(1, Math.round(along / (R * 2.1)));
        c.discs = [];
        for (let i = 0; i < n; i++) {
          const a = (along * (i + 0.5)) / n;
          const ctr = M(a, depth * 0.45);
          const disc = P();
          const teeth = Math.max(10, Math.round(R / 3));
          for (let t = 0; t < teeth; t++) {
            const a0 = (t / teeth) * Math.PI * 2;
            const a1 = a0 + (Math.PI * 2) / teeth;
            disc.lineTo(Math.cos(a0) * R * 0.82, Math.sin(a0) * R * 0.82);
            disc.lineTo(Math.cos(a0 + 0.25 / teeth) * R, Math.sin(a0 + 0.25 / teeth) * R);
            disc.lineTo(Math.cos(a1) * R * 0.82, Math.sin(a1) * R * 0.82);
          }
          disc.closePath();
          const hub = P();
          ring(hub, 0, 0, R * 0.22);
          c.discs.push({ x: ctr[0], y: ctr[1], path: disc, hub, spd: (i % 2 ? -1 : 1) * (5 + r() * 2) });
        }
        // housing slot the blades spin in
        poly(c.base, [M(0, 0), M(along, 0), M(along, depth * 0.22), M(0, depth * 0.22)]);
      } else if (kind === 'rebar') {
        // rubble mound with bent, sharpened bars
        const mound = [M(0, 0)];
        for (let a = 0; a <= along; a += Math.max(8, along / 8)) mound.push(M(a, depth * (0.12 + r() * 0.2)));
        mound.push(M(along, 0));
        poly(c.base, mound);
        const n = Math.max(3, Math.round(along / 13));
        for (let i = 0; i < n; i++) {
          const a = (along * (i + 0.3 + r() * 0.4)) / n;
          const lean = (r() - 0.5) * 0.7;
          const len = depth * (0.65 + r() * 0.35);
          const p0 = M(a, depth * 0.15);
          const bend = M(a + lean * len * 0.5, len * 0.6);
          const tip = M(a + lean * len * (0.6 + r() * 0.4), len);
          c.metal.moveTo(p0[0], p0[1]);
          c.metal.lineTo(bend[0], bend[1]);
          c.metal.lineTo(tip[0], tip[1]);
          c.tips.moveTo(tip[0] + 2, tip[1]);
          c.tips.arc(tip[0], tip[1], 2, 0, Math.PI * 2);
        }
      } else {
        // spikes: tall triangles with pale tips
        const n = Math.max(2, Math.round(along / 15));
        const sw = along / n;
        poly(c.base, [M(0, 0), M(along, 0), M(along, depth * 0.16), M(0, depth * 0.16)]);
        for (let i = 0; i < n; i++) {
          const a0 = i * sw;
          const hgt = depth * (0.72 + r() * 0.28);
          poly(c.metal, [M(a0 + sw * 0.06, depth * 0.1), M(a0 + sw * 0.94, depth * 0.1), M(a0 + sw * 0.5, hgt)]);
          poly(c.tips, [M(a0 + sw * 0.36, hgt * 0.78), M(a0 + sw * 0.64, hgt * 0.78), M(a0 + sw * 0.5, hgt)]);
        }
        for (let i = 0; i < 3; i++) poly(c.rust, [M(r() * along, depth * 0.1), M(r() * along, depth * 0.1), M(r() * along, depth * 0.3)]);
      }
      return c;
    }

    _drawHazards(ctx, cam, level) {
      if (typeof level.queryHazards !== 'function') return;
      const vr = cam.visibleRect(40, 1, this._rect);
      const list = level.queryHazards(vr.x0, vr.y0, vr.x1, vr.y1, this._hazards);
      const pal = this._pal.world;
      const t = this.time;
      const px = 1 / Math.max(0.05, cam.scale);
      for (let i = 0; i < list.length; i++) {
        const hz = list[i];
        if (hz.active === false) continue;
        const c = this._hazParts(hz, level);
        ctx.fillStyle = pal.hazBase;
        ctx.fill(c.base);
        if (c.discs) {
          for (let k = 0; k < c.discs.length; k++) {
            const d = c.discs[k];
            ctx.save();
            ctx.translate(d.x, d.y);
            ctx.rotate(t * d.spd);
            ctx.fillStyle = pal.steel;
            ctx.fill(d.path);
            ctx.strokeStyle = pal.tip;
            ctx.lineWidth = Math.max(1.2, px);
            ctx.globalAlpha = 0.8;
            ctx.stroke(d.path);
            ctx.globalAlpha = 1;
            ctx.fillStyle = pal.hazBase;
            ctx.fill(d.hub);
            ctx.restore();
          }
        } else if (hz.kind === 'rebar') {
          ctx.strokeStyle = pal.rust;
          ctx.lineWidth = 3.2;
          ctx.stroke(c.metal);
          ctx.strokeStyle = pal.tip;
          ctx.lineWidth = 1.2;
          ctx.globalAlpha = 0.5;
          ctx.stroke(c.metal);
          ctx.globalAlpha = 1;
          ctx.fillStyle = pal.tip;
          ctx.fill(c.tips);
        } else {
          ctx.fillStyle = pal.steel;
          ctx.fill(c.metal);
          ctx.fillStyle = pal.rust;
          ctx.globalAlpha = 0.6;
          ctx.fill(c.rust);
          ctx.globalAlpha = 1;
          ctx.fillStyle = pal.tip;
          ctx.fill(c.tips);
          ctx.strokeStyle = pal.shade;
          ctx.lineWidth = Math.max(1, px);
          ctx.stroke(c.metal);
        }
      }
    }

    // -------------------------------------------------------------------------
    // Anchors (world layer art; glyph markers are drawn later above the darkness)
    // -------------------------------------------------------------------------
    _collectAnchors(cam, level) {
      const out = this._visAnchors;
      out.length = 0;
      if (typeof level.anchorsNear !== 'function') return out;
      const R = Math.hypot(cam.viewW, cam.viewH) * 0.5 + 40;
      const list = level.anchorsNear(cam.x, cam.y, R, this._anchors);
      const vr = cam.visibleRect(30, 1, this._rect2);
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a.x < vr.x0 || a.x > vr.x1 || a.y < vr.y0 || a.y > vr.y1) continue;
        out.push(a);
      }
      return out;
    }

    _anchorShake(a, grapple) {
      let k = 0;
      if (a.kind === 'fragile') {
        if (grapple && grapple.anchor === a && typeof grapple.anchorStress === 'function') k = grapple.anchorStress();
        else if (a.load > 0) k = 0.15;
      }
      return k;
    }

    _drawAnchors(ctx, cam, level, game) {
      const list = this._collectAnchors(cam, level);
      const pal = this._pal.world;
      const grapple = game.grapple;
      const t = this.time;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const k = this._anchorShake(a, grapple);
        const ox = k > 0 ? Math.sin(t * 63 + i) * k * 2.4 : 0;
        const oy = k > 0 ? Math.cos(t * 47 + i) * k * 1.6 : 0;
        const x = a.x + ox;
        const y = a.y + oy;
        // mounting plate
        ctx.fillStyle = pal.metal;
        ctx.fillRect(x - 7, y - 12, 14, 7);
        ctx.fillStyle = pal.rust;
        ctx.fillRect(x - 7, y - 6, 14, 1.5);
        if (a.broken) {
          // snapped stub
          ctx.strokeStyle = pal.metal;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x, y - 5);
          ctx.lineTo(x + 1.5, y - 1);
          ctx.lineTo(x - 1, y + 1);
          ctx.stroke();
          continue;
        }
        if (a.kind === 'hook') {
          ctx.strokeStyle = pal.metal;
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.moveTo(x, y - 6);
          ctx.lineTo(x, y + 3);
          ctx.quadraticCurveTo(x, y + 9, x + 5, y + 8);
          ctx.quadraticCurveTo(x + 8, y + 6, x + 7, y + 1);
          ctx.stroke();
          ctx.strokeStyle = pal.rim;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.6;
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else if (a.kind === 'fragile') {
          // corroded knob, cracked — it will not hold for long
          ctx.fillStyle = pal.crumble;
          ctx.beginPath();
          ctx.moveTo(x - 6, y - 5);
          ctx.lineTo(x + 6, y - 5);
          ctx.lineTo(x + 7, y + 1);
          ctx.lineTo(x + 2, y + 6);
          ctx.lineTo(x - 5, y + 4);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = pal.rim;
          ctx.lineWidth = 1.1;
          ctx.globalAlpha = 0.7;
          ctx.beginPath();
          ctx.moveTo(x - 3, y - 5);
          ctx.lineTo(x, y);
          ctx.lineTo(x - 2, y + 4);
          ctx.moveTo(x, y);
          ctx.lineTo(x + 5, y + 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else {
          ctx.strokeStyle = pal.metal;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x, y + 1, 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = pal.rim;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.arc(x, y + 1, 6, Math.PI * 1.1, Math.PI * 1.9);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    /** Shape-coded phosphor markers: ring = circle, hook = triangle, fragile = cracked diamond. */
    _drawAnchorMarkers(ctx, game, cam, hc) {
      const list = this._visAnchors;
      if (list.length === 0) return;
      const pl = game.player;
      const grapple = game.grapple;
      const range = finite(game.diff && game.diff.aimRange, 560);
      const t = this.time;
      const s = cam.scale;
      const pal = this._pal.world;
      const base = U.clamp(ANCHOR_MARK_WORLD * s, 5.5, 10) * (hc ? 1.3 : 1);
      const havePlayer = pl && this._showPlayer && pl.alive !== false;
      const px = havePlayer ? finite(pl.rx, pl.x) : 0;
      const py = havePlayer ? finite(pl.ry, pl.y) : 0;
      ctx.setTransform(this.dprX, 0, 0, this.dprY, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const pulse = this._attachPulse;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a.broken) continue;
        const k = this._anchorShake(a, grapple);
        const sp = cam.worldToScreen(a.x + (k > 0 ? Math.sin(t * 63 + i) * k * 2.4 : 0), a.y + (k > 0 ? Math.cos(t * 47 + i) * k * 1.6 : 0), this._pt);
        const inRange = havePlayer && (a.x - px) * (a.x - px) + (a.y - py) * (a.y - py) <= range * range;
        const isAttached = grapple && grapple.anchor === a;
        const isTarget = grapple && grapple.target === a && !grapple.anchor;
        let alpha = havePlayer ? (inRange ? 0.92 : 0.38) : 0.5;
        if (isAttached) alpha = 1;
        let r = base * (inRange || isTarget ? 1 : 0.82);
        if (pulse.anchor === a) {
          const pt = t - pulse.t;
          if (pt >= 0 && pt < 0.45) r *= 1 + (1 - pt / 0.45) * 0.6;
        }
        // breathing so they feel alive, not UI
        r *= 1 + Math.sin(t * 2 + i * 1.7) * 0.04;
        this._markerShape(ctx, a.kind, sp.x, sp.y, r, alpha, hc, isAttached, pal, k);
      }
      ctx.globalAlpha = 1;
    }

    _markerShape(ctx, kind, x, y, r, alpha, hc, filled, pal, stress) {
      const path = () => {
        ctx.beginPath();
        if (kind === 'hook') {
          // downward-pointing triangle (a hook tip)
          ctx.moveTo(x - r, y - r * 0.7);
          ctx.lineTo(x + r, y - r * 0.7);
          ctx.lineTo(x, y + r);
          ctx.closePath();
        } else if (kind === 'fragile') {
          ctx.moveTo(x, y - r * 1.1);
          ctx.lineTo(x + r, y);
          ctx.lineTo(x, y + r * 1.1);
          ctx.lineTo(x - r, y);
          ctx.closePath();
        } else {
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      };
      ctx.globalAlpha = alpha;
      if (hc) {
        path();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        if (filled) {
          ctx.fillStyle = '#fff';
          ctx.fill();
        }
      } else {
        path();
        ctx.strokeStyle = pal.phos;
        ctx.lineWidth = 1.7;
        ctx.stroke();
        if (filled) {
          ctx.fillStyle = pal.phos;
          ctx.globalAlpha = alpha * 0.45;
          ctx.fill();
          ctx.globalAlpha = alpha;
        }
      }
      // inner glyph detail (also shape information)
      ctx.strokeStyle = hc ? (filled ? '#000' : '#fff') : pal.phos;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = hc ? 2 : 1.3;
      ctx.beginPath();
      if (kind === 'fragile') {
        // the crack — wider as it is stressed
        const o = (stress || 0) * r * 0.25;
        ctx.moveTo(x - r * 0.15 - o, y - r * 0.8);
        ctx.lineTo(x + r * 0.2, y - r * 0.1);
        ctx.lineTo(x - r * 0.2 + o, y + r * 0.25);
        ctx.lineTo(x + r * 0.05, y + r * 0.8);
        ctx.stroke();
      } else if (kind === 'hook') {
        ctx.moveTo(x, y - r * 0.35);
        ctx.lineTo(x, y + r * 0.35);
        ctx.stroke();
      } else {
        ctx.arc(x, y, Math.max(1.3, r * 0.26), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // -------------------------------------------------------------------------
    // Targeting cue (brackets + faint dashed arc) — hidden while attached
    // -------------------------------------------------------------------------
    _drawTargetCue(ctx, game, cam, hc) {
      const g = game.grapple;
      const pl = game.player;
      if (!g || !pl || !this._showPlayer || pl.alive === false) return;
      if (game.state !== 'playing' && game.state !== undefined) return;
      const target = g.target;
      if (!target || g.anchor || target.broken) return;
      const t = this.time;
      const s = cam.scale;
      const a = cam.worldToScreen(target.x, target.y, this._pt);
      const p = cam.worldToScreen(finite(pl.rx, pl.x), finite(pl.ry, pl.y), this._pt2);
      const pal = this._pal.world;
      ctx.setTransform(this.dprX, 0, 0, this.dprY, 0, 0);
      // dashed arc from the player to the target
      const dx = a.x - p.x;
      const dy = a.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 30) {
        const ux = dx / d;
        const uy = dy / d;
        const start = Math.min(16 * Math.max(1, s), d * 0.3);
        const end = d - U.clamp(ANCHOR_MARK_WORLD * s, 5.5, 10) * 2.1;
        if (end > start) {
          const sx = p.x + ux * start;
          const sy = p.y + uy * start;
          const ex = p.x + ux * end;
          const ey = p.y + uy * end;
          // bow the line slightly upward (a thrown line's arc)
          const bow = d * 0.08;
          const nx = uy;
          const ny = -ux;
          const flip = ny > 0 ? -1 : 1;
          const cx = (sx + ex) * 0.5 + nx * bow * flip;
          const cy = (sy + ey) * 0.5 + ny * bow * flip;
          ctx.setLineDash(DASH_CUE);
          ctx.lineDashOffset = -t * 22;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(cx, cy, ex, ey);
          if (hc) {
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 4;
            ctx.globalAlpha = 0.8;
            ctx.stroke();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.95;
            ctx.stroke();
          } else {
            ctx.strokeStyle = pal.phos;
            ctx.lineWidth = 1.3;
            ctx.globalAlpha = 0.34;
            ctx.stroke();
          }
          ctx.setLineDash(DASH_NONE);
          ctx.lineDashOffset = 0;
        }
      }
      // corner brackets
      const r = U.clamp(ANCHOR_MARK_WORLD * s, 5.5, 10) * (hc ? 1.3 : 1);
      const hs = r * 2 + 1.5 + Math.sin(t * 5) * 1.2;
      const arm = Math.max(4, hs * 0.45);
      ctx.beginPath();
      for (let q = 0; q < 4; q++) {
        const sx = q === 0 || q === 3 ? -1 : 1;
        const sy = q < 2 ? -1 : 1;
        const cx = a.x + sx * hs;
        const cy = a.y + sy * hs;
        ctx.moveTo(cx - sx * arm, cy);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx, cy - sy * arm);
      }
      if (hc) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 5;
        ctx.globalAlpha = 1;
        ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else {
        ctx.strokeStyle = pal.phos;
        ctx.lineWidth = 1.8;
        ctx.globalAlpha = 0.95;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // -------------------------------------------------------------------------
    // Rope
    // -------------------------------------------------------------------------
    _handPos(pl, out) {
      // Hand sits above the head along the body axis (body is aligned with the rope when hanging).
      const ang = this._pAng;
      const lx = 0;
      const ly = -15;
      out.x = finite(pl.rx, pl.x) + lx * Math.cos(ang) - ly * Math.sin(ang);
      out.y = finite(pl.ry, pl.y) + lx * Math.sin(ang) + ly * Math.cos(ang);
      return out;
    }

    _drawRope(ctx, game) {
      const g = game.grapple;
      const pl = game.player;
      if (!g || !pl) return;
      const hc = this._hc;
      const pal = this._pal.world;
      const cam = game.camera;
      const px1 = 1 / Math.max(0.05, cam.scale);
      const t = this.time;
      if (g.anchor) {
        const an = g.anchor;
        const hand = this._handPos(pl, this._pt2);
        const shakeK = this._anchorShake(an, g);
        const ax = an.x + (shakeK > 0 ? Math.sin(t * 63) * shakeK * 2.4 : 0);
        const ay = an.y + 1 + (shakeK > 0 ? Math.cos(t * 47) * shakeK * 1.6 : 0);
        const ext = U.clamp(finite(g.extend, 1), 0, 1);
        const tipX = hand.x + (ax - hand.x) * ext;
        const tipY = hand.y + (ay - hand.y) * ext;
        const d = Math.hypot(finite(pl.rx, pl.x) - an.x, finite(pl.ry, pl.y) - an.y);
        const L = finite(g.ropeLength, d);
        const slack = L - d;
        const tension = U.clamp((finite(pl.tension, 0) - 1400) / 5200, 0, 1);
        const taut = slack < 2.5 && ext >= 1;
        ctx.beginPath();
        ctx.moveTo(hand.x, hand.y);
        if (ext < 1) {
          ctx.lineTo(tipX, tipY);
        } else if (!taut) {
          // slack: sag under gravity (control point at twice the sag depth)
          const sag = Math.min(Math.sqrt(Math.max(0, L * L - d * d)) * 0.5, 160);
          ctx.quadraticCurveTo((hand.x + ax) * 0.5, (hand.y + ay) * 0.5 + sag * 2, ax, ay);
        } else {
          // taut; a hard catch makes it thrum for a moment
          const jt = t - this._joltT;
          if (jt >= 0 && jt < 0.35) {
            const amp = this._joltAmp * 9 * (1 - jt / 0.35) * Math.sin(jt * 70);
            const dx = ax - hand.x;
            const dy = ay - hand.y;
            const dl = Math.hypot(dx, dy) || 1;
            ctx.quadraticCurveTo((hand.x + ax) * 0.5 - (dy / dl) * amp, (hand.y + ay) * 0.5 + (dx / dl) * amp, ax, ay);
          } else {
            ctx.lineTo(ax, ay);
          }
        }
        const wk = taut ? tension : 0;
        const width = Math.max(1.5 + wk * 1.3, px1 * (1.3 + wk));
        if (hc) {
          ctx.strokeStyle = '#000';
          ctx.lineWidth = width + px1 * 3;
          ctx.stroke();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = width + px1;
          ctx.stroke();
        } else {
          const c = this._c0;
          mix(c, [118, 104, 84], MAT.phos, taut ? 0.25 + tension * 0.6 : 0.1);
          ctx.strokeStyle = css(c);
          ctx.lineWidth = width;
          ctx.stroke();
        }
        if (ext < 1) {
          // the thrown head
          ctx.fillStyle = hc ? '#fff' : pal.metal;
          ctx.beginPath();
          ctx.arc(tipX, tipY, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
      const m = g.miss;
      if (m && isFinite(m.dirX)) {
        // whiff: whip out along the aim and recoil, with a travelling ripple
        const T = (AT.CONFIG && AT.CONFIG.rope && AT.CONFIG.rope.missTime) || 0.24;
        const ph = U.clamp(finite(m.t, 0) / T, 0, 1);
        const reach = ph < 0.4 ? 1 - (1 - ph / 0.4) * (1 - ph / 0.4) : 1 - ((ph - 0.4) / 0.6) * ((ph - 0.4) / 0.6);
        const len = finite(m.len, 400) * reach;
        if (len < 4) return;
        const hand = this._handPos(pl, this._pt2);
        const nx = -m.dirY;
        const ny = m.dirX;
        ctx.beginPath();
        ctx.moveTo(hand.x, hand.y);
        const N = 10;
        for (let i = 1; i <= N; i++) {
          const f = i / N;
          const wave = Math.sin(f * 7 - ph * 22) * 9 * f * (1 - ph);
          ctx.lineTo(hand.x + m.dirX * len * f + nx * wave, hand.y + m.dirY * len * f + ny * wave);
        }
        ctx.strokeStyle = hc ? '#fff' : '#76684f';
        ctx.globalAlpha = 0.85 * (1 - ph * 0.5);
        ctx.lineWidth = Math.max(1.4, px1 * 1.3);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // -------------------------------------------------------------------------
    // Player — a small cloaked descender with an amber lantern
    // -------------------------------------------------------------------------
    _drawPlayer(ctx, game) {
      const pl = game.player;
      const g = game.grapple;
      const dt = Math.min(this._dt || 1 / 60, 0.05);
      const t = this.time;
      const x = finite(pl.rx, pl.x);
      const y = finite(pl.ry, pl.y);
      const vx = finite(pl.vx, 0);
      const vy = finite(pl.vy, 0);
      const f = pl.facing < 0 ? -1 : 1;
      const an = g && g.anchor;
      const hanging = !!an && !pl.grounded;
      const stagger = finite(pl.stagger, 0) > 0;

      // Body angle: along the rope when hanging, a lean into motion otherwise.
      let target;
      if (hanging) target = U.clamp(Math.atan2(-(x - an.x), y - an.y), -1.4, 1.4);
      else if (!pl.grounded) target = U.clamp(vx / 1600, -0.32, 0.32);
      else target = U.clamp(vx / 2400, -0.12, 0.12);
      if (stagger) target += Math.sin(t * 22) * 0.08;
      let da = target - this._pAng;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      this._pAng += da * (1 - Math.exp(-14 * dt));

      // Lantern pendulum (driven by horizontal acceleration).
      const ax = (vx - this._prevVX) / Math.max(dt, 1e-3);
      this._prevVX = vx;
      const acc = U.clamp(-ax * 0.00035 - this._lanternSwing * 38, -60, 60);
      this._lanternVel += acc * dt;
      this._lanternVel *= Math.exp(-2.6 * dt);
      this._lanternSwing = U.clamp(this._lanternSwing + this._lanternVel * dt, -0.9, 0.9);

      const pal = this._pal.world;
      const hc = this._hc;
      const speed = Math.hypot(vx, vy);
      const crouch = stagger ? 3 : 0;

      ctx.save();
      ctx.translate(x, y + crouch);
      ctx.rotate(this._pAng);

      // ---- legs
      let fx1;
      let fy1;
      let fx2;
      let fy2;
      if (pl.grounded && Math.abs(vx) > 25 && !stagger) {
        this._runPhase += (Math.abs(vx) * dt) / 15;
        const s1 = Math.sin(this._runPhase);
        fx1 = s1 * 6;
        fy1 = 14 - Math.max(0, Math.cos(this._runPhase)) * 3;
        fx2 = -s1 * 6;
        fy2 = 14 - Math.max(0, -Math.cos(this._runPhase)) * 3;
      } else if (hanging) {
        // tucked: knees up, feet forward
        fx1 = f * 6;
        fy1 = 9;
        fx2 = f * 2;
        fy2 = 11;
      } else if (!pl.grounded && vy > 420) {
        const fl = Math.sin(t * 18) * 1.5;
        fx1 = -6 + fl;
        fy1 = 13;
        fx2 = 6 - fl;
        fy2 = 12;
      } else if (stagger) {
        fx1 = -7;
        fy1 = 11;
        fx2 = 7;
        fy2 = 11;
      } else {
        fx1 = -3.5;
        fy1 = 14;
        fx2 = 3.5;
        fy2 = 14;
      }
      ctx.strokeStyle = '#120f0d';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(-2.5, 4);
      ctx.lineTo(fx1, fy1);
      ctx.moveTo(2.5, 4);
      ctx.lineTo(fx2, fy2);
      ctx.stroke();

      // ---- cloak (trails against velocity; flares when falling)
      const lvx = vx * Math.cos(this._pAng) + vy * Math.sin(this._pAng);
      const trail = U.clamp(-lvx / 120, -7, 7);
      const flare = U.clamp((vy - 300) / 220, 0, 4) * (hanging ? 0.3 : 1);
      const flap = Math.sin(t * 13 + speed * 0.01) * U.clamp(speed / 700, 0, 1) * 1.6;
      ctx.beginPath();
      ctx.moveTo(-4.5, -8);
      ctx.lineTo(4.5, -8);
      ctx.quadraticCurveTo(8 + flare, -1, 9 + flare + trail * 0.6, 8 + flap - flare * 0.8);
      ctx.lineTo(4 + trail, 6 + flap * 0.5);
      ctx.lineTo(0 + trail, 9 - flap);
      ctx.lineTo(-4 + trail, 6 + flap * 0.5);
      ctx.lineTo(-9 - flare + trail * 0.6, 8 - flap - flare * 0.8);
      ctx.quadraticCurveTo(-8 - flare, -1, -4.5, -8);
      ctx.closePath();
      ctx.fillStyle = '#17130f';
      ctx.fill();
      if (hc) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else {
        // warm rim on the lantern side
        ctx.strokeStyle = pal.amber;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // ---- hood + head (no face: a dark opening)
      ctx.fillStyle = '#1d1813';
      ctx.beginPath();
      ctx.moveTo(-f * 9, -9.5); // hood point trailing back
      ctx.quadraticCurveTo(-f * 6, -18, 0, -18.5);
      ctx.quadraticCurveTo(f * 6.5, -18, f * 6, -11);
      ctx.quadraticCurveTo(f * 5, -6.5, 0, -7);
      ctx.closePath();
      ctx.fill();
      if (hc) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
      ctx.fillStyle = '#050403';
      ctx.beginPath();
      ctx.ellipse(f * 2.6, -12, 2.4, 3.2, 0, 0, Math.PI * 2);
      ctx.fill();

      // ---- arms: rope arm reaching up the line when hanging/attached
      ctx.strokeStyle = '#17130f';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      if (an) {
        ctx.moveTo(0, -7);
        ctx.lineTo(0.5, -15);
      } else {
        ctx.moveTo(-f * 3, -6);
        ctx.lineTo(-f * 6, 1);
      }
      ctx.moveTo(f * 3, -6);
      ctx.lineTo(f * 6, -1);
      ctx.stroke();

      // ---- lantern (hangs from the free hand, swings)
      const la = this._lanternSwing - this._pAng * 0.7; // keep roughly world-vertical
      const lx = f * 6.5;
      const ly = -1;
      const llen = 5;
      const cx = lx + Math.sin(la) * llen;
      const cy = ly + Math.cos(la) * llen;
      ctx.strokeStyle = '#3a3128';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(cx, cy - 2.5);
      ctx.stroke();
      ctx.fillStyle = '#2b241c';
      ctx.fillRect(cx - 3, cy - 3, 6, 7.5);
      const flick = 0.85 + U.noise1(t * 7, 21) * 0.15;
      ctx.fillStyle = pal.amber;
      ctx.globalAlpha = flick;
      ctx.fillRect(cx - 2, cy - 1.5, 4, 4.5);
      ctx.fillStyle = '#fff2d2';
      ctx.fillRect(cx - 0.9, cy - 0.3, 1.8, 2.2);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // -------------------------------------------------------------------------
    // Screen-space overlays: death fade, flash, reticle, touch controls
    // -------------------------------------------------------------------------
    _drawScreenOverlays(game, cam, settings) {
      const ctx = this.ctx;
      const W = this.cssW;
      const H = this.cssH;
      ctx.setTransform(this.dprX || 1, 0, 0, this.dprY || 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      // deathFade is the game's general fade-to-black (1 = black: attract loop,
      // restart, respawn; death itself settles around 0.6).
      const fade = U.clamp(finite(game.deathFade, 0), 0, 1);
      if (fade > 0) {
        ctx.globalAlpha = fade;
        ctx.fillStyle = '#040304';
        ctx.fillRect(0, 0, W, H);
      }
      const flash = U.clamp(finite(game.flash, 0), 0, 1);
      if (flash > 0) {
        ctx.globalAlpha = flash * (settings && settings.reducedEffects ? 0.3 : 0.5);
        ctx.fillStyle = '#efe4cc';
        ctx.fillRect(0, 0, W, H);
      }
      ctx.globalAlpha = 1;
      const playing = game.state === 'playing';
      if (!cam || game.state === 'menu') return;
      const input = game.input;
      if (playing && input) this._drawReticle(ctx, game, cam, input);
      if (input && typeof input.getTouchOverlay === 'function' && (playing || game.state === 'dead')) {
        let ov = null;
        try {
          ov = input.getTouchOverlay();
        } catch {
          ov = null;
        }
        if (ov && ov.visible) this._drawTouch(ctx, ov, game);
      }
    }

    _drawReticle(ctx, game, cam, input) {
      const hc = this._hc;
      const src = input.lastSource;
      const aim = input.intent && input.intent.aim;
      const g = game.grapple;
      const pl = game.player;
      if (!pl || pl.alive === false) return;
      const locked = !!(g && g.target && !g.anchor);
      const t = this.time;
      const ink = hc ? '#fff' : this._pal.world.phos;
      if (aim && aim.mode === 'dir' && (src === 'keyboard' || src === 'gamepad')) {
        // directional aim: a chevron orbiting the player
        const la = g && g.lastAim ? g.lastAim : { x: aim.dx, y: aim.dy };
        const l = Math.hypot(la.x, la.y) || 1;
        const ux = la.x / l;
        const uy = la.y / l;
        const p = cam.worldToScreen(finite(pl.rx, pl.x), finite(pl.ry, pl.y), this._pt);
        const R = 46 + Math.sin(t * 4) * 2;
        const cx = p.x + ux * R;
        const cy = p.y + uy * R;
        const nx = -uy;
        const ny = ux;
        ctx.beginPath();
        ctx.moveTo(cx - ux * 6 + nx * 7, cy - uy * 6 + ny * 7);
        ctx.lineTo(cx + ux * 5, cy + uy * 5);
        ctx.lineTo(cx - ux * 6 - nx * 7, cy - uy * 6 - ny * 7);
        this._strokeInk(ctx, ink, hc, locked ? 2.4 : 1.8, locked ? 0.95 : 0.7);
        return;
      }
      if (src !== 'mouse' && src !== 'keyboard') return;
      const m = input.mouse;
      if (!m || !m.inside || !isFinite(m.x) || !isFinite(m.y)) return;
      const x = m.x;
      const y = m.y;
      ctx.beginPath();
      if (locked) {
        // locked: a small diamond + dot
        const r = 6;
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        this._strokeInk(ctx, ink, hc, 1.8, 0.95);
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = ink;
        ctx.fill();
      } else {
        // free: ring with four ticks
        const r = 8;
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.moveTo(x - r - 5, y);
        ctx.lineTo(x - r - 1.5, y);
        ctx.moveTo(x + r + 1.5, y);
        ctx.lineTo(x + r + 5, y);
        ctx.moveTo(x, y - r - 5);
        ctx.lineTo(x, y - r - 1.5);
        ctx.moveTo(x, y + r + 1.5);
        ctx.lineTo(x, y + r + 5);
        this._strokeInk(ctx, ink, hc, 1.5, g && g.anchor ? 0.45 : 0.8);
      }
    }

    _strokeInk(ctx, ink, hc, w, a) {
      if (hc) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = w + 3;
        ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = w + 0.6;
        ctx.stroke();
      } else {
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = w + 2;
        ctx.globalAlpha = a * 0.5;
        ctx.stroke();
        ctx.globalAlpha = a;
        ctx.strokeStyle = ink;
        ctx.lineWidth = w;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    _drawTouch(ctx, ov, game) {
      const hc = this._hc;
      const ink = hc ? '#ffffff' : '#e8dcc0';
      const ls = ov.leftStick;
      if (ls) this._drawStick(ctx, ls, ink, hc, 'move', null);
      const as = ov.aimStick;
      if (as) this._drawStick(ctx, as, ink, hc, 'aim', as);
      const gt = ov.grappleTouches;
      if (gt && gt.length) {
        const attached = !!(game.grapple && game.grapple.anchor);
        for (let i = 0; i < gt.length; i++) {
          const p = gt[i];
          if (!isFinite(p.x) || !isFinite(p.y)) continue;
          const r = 30;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          for (let q = 0; q < 4; q++) {
            const a = (q * Math.PI) / 2 + Math.PI / 4;
            ctx.moveTo(p.x + Math.cos(a) * (r + 3), p.y + Math.sin(a) * (r + 3));
            ctx.lineTo(p.x + Math.cos(a) * (r + 9), p.y + Math.sin(a) * (r + 9));
          }
          if (attached) ctx.setLineDash(DASH_NONE);
          else ctx.setLineDash(DASH_RING);
          this._strokeInk(ctx, ink, hc, attached ? 2.2 : 1.6, 0.6);
          ctx.setLineDash(DASH_NONE);
        }
      }
    }

    _drawStick(ctx, st, ink, hc, kind, aimSt) {
      const active = !!st.active;
      const bx = active ? st.baseX : st.ghostX;
      const by = active ? st.baseY : st.ghostY;
      if (!isFinite(bx) || !isFinite(by)) return;
      const R = finite(st.radius, 60);
      const baseA = active ? 0.5 : 0.22;
      // base disc (subtle dark backing helps on bright scenes) + ring
      ctx.globalAlpha = active ? 0.22 : 0.1;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(bx, by, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx, by, R, 0, Math.PI * 2);
      this._strokeInk(ctx, ink, hc, 1.6, baseA);
      if (kind === 'aim') {
        // fire threshold ring (dashed) + progress arc toward it
        ctx.setLineDash(DASH_RING);
        ctx.beginPath();
        ctx.arc(bx, by, R * 0.8, 0, Math.PI * 2);
        this._strokeInk(ctx, ink, hc, 1.2, active ? 0.45 : 0.18);
        ctx.setLineDash(DASH_NONE);
        const fr = U.clamp(finite(aimSt.fireRatio, 0), 0, 1);
        if (active && fr > 0) {
          ctx.beginPath();
          ctx.arc(bx, by, R * 0.8, -Math.PI / 2, -Math.PI / 2 + fr * Math.PI * 2);
          this._strokeInk(ctx, ink, hc, aimSt.armed ? 3.2 : 2.2, 0.9);
        }
      } else {
        // four chevrons: move ← →, reel ↑ ↓
        const c = R * 0.62;
        const s = Math.max(4, R * 0.1);
        ctx.beginPath();
        ctx.moveTo(bx - c + s, by - s);
        ctx.lineTo(bx - c, by);
        ctx.lineTo(bx - c + s, by + s);
        ctx.moveTo(bx + c - s, by - s);
        ctx.lineTo(bx + c, by);
        ctx.lineTo(bx + c - s, by + s);
        ctx.moveTo(bx - s, by - c + s);
        ctx.lineTo(bx, by - c);
        ctx.lineTo(bx + s, by - c + s);
        ctx.moveTo(bx - s, by + c - s);
        ctx.lineTo(bx, by + c);
        ctx.lineTo(bx + s, by + c - s);
        this._strokeInk(ctx, ink, hc, 1.4, active ? 0.4 : 0.28);
        const jf = U.clamp(finite(st.jumpFlash, 0), 0, 1);
        if (jf > 0) {
          // flick-jump acknowledged: the up chevron flares
          ctx.beginPath();
          ctx.moveTo(bx - s * 1.6, by - c + s * 1.6);
          ctx.lineTo(bx, by - c - s * 0.4);
          ctx.lineTo(bx + s * 1.6, by - c + s * 1.6);
          this._strokeInk(ctx, ink, hc, 2.6, jf);
        }
      }
      if (kind === 'aim' && active && aimSt.previewing && (aimSt.dirX || aimSt.dirY)) {
        // aim preview: a tick on the ring pointing where the tether will go
        const dl = Math.hypot(aimSt.dirX, aimSt.dirY) || 1;
        const ux = aimSt.dirX / dl;
        const uy = aimSt.dirY / dl;
        ctx.beginPath();
        ctx.moveTo(bx + ux * (R + 4), by + uy * (R + 4));
        ctx.lineTo(bx + ux * (R + 14), by + uy * (R + 14));
        this._strokeInk(ctx, ink, hc, 2.4, 0.85);
      }
      if (!active) {
        if (kind === 'aim') {
          // ghost: a small crosshair says "aim here"
          ctx.beginPath();
          ctx.moveTo(bx - 7, by);
          ctx.lineTo(bx + 7, by);
          ctx.moveTo(bx, by - 7);
          ctx.lineTo(bx, by + 7);
          this._strokeInk(ctx, ink, hc, 1.4, 0.3);
        }
        return;
      }
      const kx = finite(st.knobX, bx);
      const ky = finite(st.knobY, by);
      const kr = R * 0.4;
      const armed = kind === 'aim' && aimSt.armed;
      ctx.globalAlpha = armed ? 0.55 : 0.3;
      ctx.fillStyle = armed ? (hc ? '#fff' : '#e0a050') : ink;
      ctx.beginPath();
      ctx.arc(kx, ky, kr, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(kx, ky, kr, 0, Math.PI * 2);
      this._strokeInk(ctx, ink, hc, armed ? 2.6 : 1.8, 0.85);
      if (armed) {
        // armed glyph: a hook triangle inside the knob (shape, not just colour)
        ctx.beginPath();
        ctx.moveTo(kx - kr * 0.45, ky - kr * 0.3);
        ctx.lineTo(kx + kr * 0.45, ky - kr * 0.3);
        ctx.lineTo(kx, ky + kr * 0.5);
        ctx.closePath();
        this._strokeInk(ctx, hc ? '#000' : '#1a140d', false, 1.8, 0.9);
      }
    }
  }


  AT.Renderer = Renderer;
})((window.AT = window.AT || {}));
