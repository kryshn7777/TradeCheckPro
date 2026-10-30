/* ABYSSAL TETHER 3D — scrawlFont.js
 * A hand for the writing that is not typeset: the blood on the walls and the scary lines on screen. A stroke font drawn in code (capitals,
 * digits and `. , ' ? ! - :`), so it looks the same on every device: no installed font is needed or used (the web fonts a headset
 * browser falls back to made the scrawl read as Arial in red). Each glyph is a few polylines on a 10-unit-high cell, drawn as a brush
 * stroke: a thick round line that tapers a little, shakes with the hand, and pools a blob where the stroke starts.
 *
 *   scrawlAdvance(ch, fs)               advance of a glyph in px for a font size `fs` (cap height = 0.72 fs); spaces and unknown glyphs too
 *   scrawlGlyph(ctx, ch, fs, col, rng, o)   strokes `ch` with its baseline-left at the context origin (the caller translates / rotates)
 *       o: { alpha = 1, width = 1 (x the brush), tremor = 1, dash = false (a dry, broken chalk stroke), pool = true }
 * Only path calls (beginPath, moveTo, lineTo, quadraticCurveTo, arc, stroke, fill) and setLineDash when present: it runs on a stub.
 */

const E = (cx, cy, rx, ry, n = 14, a0 = 0, a1 = Math.PI * 2) => {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return p;
};

// glyph: [advance width in units, [polylines]]; x to the right, y up from the baseline, caps 10 high
const G = {
  A: [6.4, [[[0, 0], [3.2, 10], [6.4, 0]], [[1.2, 3.6], [5.2, 3.6]]]],
  B: [6, [[[0, 0], [0, 10], [3.6, 10], [5.2, 8.8], [5.2, 6.4], [3.6, 5.2], [0, 5.2]], [[3.6, 5.2], [5.8, 4], [5.8, 1.4], [4, 0], [0, 0]]]],
  C: [6, [[[5.6, 8.4], [4.2, 10], [2, 10], [0.4, 8.6], [0, 5], [0.4, 1.4], [2, 0], [4.2, 0], [5.6, 1.6]]]],
  D: [6.2, [[[0, 0], [0, 10], [2.8, 10], [5, 8.6], [5.8, 5], [5, 1.4], [2.8, 0], [0, 0]]]],
  E: [5.6, [[[5.4, 10], [0, 10], [0, 0], [5.4, 0]], [[0, 5], [4.2, 5]]]],
  F: [5.4, [[[5.4, 10], [0, 10], [0, 0]], [[0, 5.2], [4.2, 5.2]]]],
  G: [6.2, [[[5.6, 8.4], [4.2, 10], [2, 10], [0.4, 8.6], [0, 5], [0.4, 1.4], [2, 0], [4.2, 0], [5.8, 1.6], [5.8, 4.6], [3.4, 4.6]]]],
  H: [6, [[[0, 0], [0, 10]], [[5.6, 0], [5.6, 10]], [[0, 5], [5.6, 5]]]],
  I: [4, [[[2, 0], [2, 10]], [[0.6, 10], [3.4, 10]], [[0.6, 0], [3.4, 0]]]],
  J: [5, [[[4.4, 10], [4.4, 2.4], [3.2, 0.2], [1.6, 0], [0.4, 1.2]]]],
  K: [6, [[[0, 0], [0, 10]], [[5.6, 10], [0, 4.6]], [[1.6, 5.8], [5.8, 0]]]],
  L: [5.2, [[[0, 10], [0, 0], [5, 0]]]],
  M: [7, [[[0, 0], [0, 10], [3.2, 3.6], [6.4, 10], [6.4, 0]]]],
  N: [6.2, [[[0, 0], [0, 10], [5.6, 0], [5.6, 10]]]],
  O: [6.4, [E(3, 5, 3, 5, 16)]],
  P: [5.8, [[[0, 0], [0, 10], [3.6, 10], [5.4, 8.6], [5.4, 6.2], [3.6, 4.8], [0, 4.8]]]],
  Q: [6.4, [E(3, 5, 3, 5, 16), [[3.4, 2.4], [6.2, -0.8]]]],
  R: [6.2, [[[0, 0], [0, 10], [3.6, 10], [5.4, 8.6], [5.4, 6.2], [3.6, 4.8], [0, 4.8]], [[2.8, 4.8], [5.8, 0]]]],
  S: [5.8, [[[5.4, 8.6], [4, 10], [1.8, 10], [0.2, 8.6], [0.4, 6.6], [2.8, 5.2], [5.2, 3.8], [5.6, 1.8], [4.2, 0], [1.8, 0], [0.2, 1.4]]]],
  T: [5.8, [[[0, 10], [5.6, 10]], [[2.8, 10], [2.8, 0]]]],
  U: [6.2, [[[0, 10], [0, 2.8], [1, 0.6], [2.8, 0], [4.6, 0.6], [5.6, 2.8], [5.6, 10]]]],
  V: [6.4, [[[0, 10], [3, 0], [6, 10]]]],
  W: [7.6, [[[0, 10], [1.8, 0], [3.6, 7], [5.4, 0], [7.2, 10]]]],
  X: [6.2, [[[0, 10], [5.8, 0]], [[5.8, 10], [0, 0]]]],
  Y: [6.2, [[[0, 10], [2.9, 5.2], [5.8, 10]], [[2.9, 5.2], [2.9, 0]]]],
  Z: [6, [[[0, 10], [5.6, 10], [0, 0], [5.6, 0]]]],
  0: [5.8, [E(2.8, 5, 2.8, 5, 16), [[1, 2], [4.6, 8]]]],
  1: [4, [[[0.8, 8.2], [2.6, 10], [2.6, 0]]]],
  2: [5.8, [[[0.2, 8.2], [1.4, 10], [3.8, 10], [5.2, 8.6], [5, 6.2], [0, 0], [5.6, 0]]]],
  3: [5.8, [[[0.2, 9], [1.6, 10], [4, 10], [5.2, 8.8], [5, 6.6], [3.2, 5.2], [1.6, 5.2]], [[3.2, 5.2], [5.4, 4], [5.6, 1.6], [4, 0], [1.6, 0], [0, 1.2]]]],
  4: [6, [[[4.4, 0], [4.4, 10], [0, 3.2], [5.8, 3.2]]]],
  5: [5.8, [[[5, 10], [0.8, 10], [0.4, 5.6], [2.6, 6.2], [4.6, 5.6], [5.6, 3.6], [5.2, 1.2], [3.4, 0], [1.4, 0], [0, 1.2]]]],
  6: [5.8, [[[4.8, 10], [2, 9], [0.4, 6.6], [0, 3.6], [0.6, 1], [2.4, 0], [4.4, 0.6], [5.4, 2.6], [4.6, 4.8], [2.6, 5.4], [0.8, 4.6]]]],
  7: [5.6, [[[0, 10], [5.6, 10], [2, 0]]]],
  8: [5.8, [[[2.8, 5.2], [0.8, 6.4], [0.6, 8.6], [2, 10], [3.8, 10], [5, 8.6], [4.8, 6.4], [2.8, 5.2], [0.4, 3.8], [0.2, 1.6], [1.6, 0], [4, 0], [5.4, 1.6], [5.2, 3.8], [2.8, 5.2]]]],
  9: [5.8, [[[0.8, 0], [3.6, 1], [5.2, 3.4], [5.6, 6.4], [5, 9], [3.2, 10], [1.2, 9.4], [0.4, 7.2], [1.2, 5.2], [3, 4.6], [5, 5.4]]]],
  '.': [2.6, [[[1.2, 0], [1.3, 0.9]]]],
  ',': [2.6, [[[1.6, 1], [1.4, 0], [0.5, -1.8]]]],
  "'": [2.2, [[[1.2, 10], [1, 7.4]]]],
  '?': [5, [[[0.2, 8.2], [1.2, 10], [3.4, 10], [4.6, 8.6], [4.2, 6.6], [2.4, 5.2], [2.4, 3.4]], [[2.4, 1], [2.4, 0.1]]]],
  '!': [2.8, [[[1.4, 10], [1.4, 3.2]], [[1.4, 1], [1.4, 0.1]]]],
  '-': [4.4, [[[0.4, 4.8], [4.2, 4.8]]]],
  ':': [2.6, [[[1.2, 7], [1.3, 6.2]], [[1.2, 1], [1.3, 0.2]]]],
};
G['—'] = G['-'];
G['·'] = G['.'];
G['’'] = G["'"];
const GAP = 2.4; // units between glyphs
const SPACE = 3.6; // units for a space
const UNIT = 0.072; // x fs: 10 units = 0.72 fs cap height

function def(ch) {
  return G[ch] || G[ch.toUpperCase()] || null;
}

export function scrawlAdvance(ch, fs) {
  if (ch === ' ') return SPACE * UNIT * fs;
  const d = def(ch);
  return ((d ? d[0] : 5) + GAP) * UNIT * fs;
}

export function scrawlGlyph(ctx, ch, fs, col, rng, o) {
  const d = def(ch);
  if (!d) return;
  const opt = o || {};
  const u = UNIT * fs;
  const brush = fs * 0.118 * (opt.width || 1);
  const shake = (opt.tremor === undefined ? 1 : opt.tremor) * 0.2;
  const r = typeof rng === 'function' ? rng : () => 0.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  const dash = opt.dash && typeof ctx.setLineDash === 'function';
  if (dash) ctx.setLineDash([u * 2.6, u * 0.55]);
  for (const line of d[1]) {
    const pts = line.map((p) => [(p[0] + (r() - 0.5) * shake * 2) * u, -(p[1] + (r() - 0.5) * shake * 2) * u]);
    const n = pts.length;
    // a brush: thick where the stroke starts, thinner toward its end (drawn as two passes: the body, then the thin tail)
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = brush * (pass === 0 ? 1 : 0.8);
      ctx.beginPath();
      const from = pass === 0 ? 0 : Math.floor(n * 0.55);
      const to = pass === 0 ? Math.max(2, Math.ceil(n * 0.6)) : n;
      if (to - from < 2) continue;
      ctx.moveTo(pts[from][0], pts[from][1]);
      if (n >= 7) {
        for (let i = from + 1; i < to - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2;
          const my = (pts[i][1] + pts[i + 1][1]) / 2;
          ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        }
        ctx.lineTo(pts[to - 1][0], pts[to - 1][1]);
      } else {
        for (let i = from + 1; i < to; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.stroke();
    }
    if (opt.pool !== false && !dash) {
      // the ink pools where the finger came down
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], brush * (0.58 + 0.2 * r()), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (dash) ctx.setLineDash([]);
}
