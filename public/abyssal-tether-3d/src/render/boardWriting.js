/* ABYSSAL TETHER 3D — boardWriting.js
 * The Keepers' boards beyond the plaques: the carved inscriptions of data/board-writing-3d.js (LEVEL_DATA_3D.boards, read
 * from `level.data.boards`), always on. Story bible: docs/abyssal-tether-3d/plans/DARK_STORY_BIBLE.md.
 *
 * Not decor: the plaques (`plaque` / `tablet` decor) are slabs merged into the decor bands plus one text quad each; these
 * are text quads only, cut straight into a wall, a floor or a ceiling, so the bake, the lightmap / GI hashes, the dressing,
 * the colliders, anchors, climb zones and the verify counts never see them.
 *
 * Cost (render/textAtlasGroups.js): one canvas atlas and ONE merged mesh per group (a section, or `group` when set), built
 * a cell per frame only while the head is within 40 m of the group and freed beyond 70 m; drawn (one call) only while one of
 * its boards is within BOARD_DIST x the detail scale (the plaques' distance). The material is the plaques' (unlit
 * MeshBasicMaterial, the phosphor-filled carving reads in the dark like every plate) plus a polygon offset; 1.6 cm off a wall
 * or a ceiling, 3 cm above a floor (over the carved floor inlays and the blood).
 *
 * Styles: 'plate' (a dark slate plate set in the wall, bevel and rule, like the plaques), 'cut' (letters cut straight into the
 * stone), 'scratch' (scratched by hand: thin strokes, no glow), 'fresh' (new-cut pale stone and chalk dust: the Dresser's
 * hand), 'outline' (the life-size figure at the bottom). Markup: ~struck~ (cut through by a later hand), #gouged# (chiselled
 * out: only its width remains), {n} (n tally strokes).
 */

import * as THREE from 'three';
import { TextAtlasGroups } from './textAtlasGroups.js';
import { BOARD_ASPECT } from '../data/board-writing-3d.js';

export const BOARD_CELL_W = 1024;
/** A board is in view while the head is within this many metres (x the view's detail scale): the plaques' PLAQUE_DIST. */
export const BOARD_DIST = 22;
/** Metres off the face (plus the polygon offset): above the blood (1.4 / 2.6 cm) and the floor inlays (1.4 / 1.8 cm). */
export const BOARD_OFF = Object.freeze({ wall: 0.016, floor: 0.03, ceil: 0.016 });
const FONT = "Georgia, 'Times New Roman', serif";

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rngOf(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Width / height of a board. */
export function boardAspect(e) {
  const a = Number(e && e.aspect);
  return a > 0 ? a : BOARD_ASPECT;
}
/** Its atlas cell (px): 1024 wide (384 for a tall one), the board's shape. */
export function boardCellSize(e) {
  const a = boardAspect(e);
  const w = a >= 1 ? BOARD_CELL_W : 384; // the tall figure: 384 x 768
  return [w, Math.round(w / a)];
}

/** World-space quad of one board: { c (centre), r (right), u (text up), n (normal), hw, hh }. */
export function boardQuad(e) {
  const w = Math.max(0.2, Number(e.w) || 2.4);
  const hw = w / 2;
  const hh = w / boardAspect(e) / 2;
  const yaw = Number(e.yaw) || 0;
  const sx = -Math.sin(yaw);
  const sz = -Math.cos(yaw);
  if (e.face === 'floor') {
    // the reader faces (sx, sz): the text's top is the far side, its right the reader's right
    return { c: [e.x, e.y + BOARD_OFF.floor, e.z], r: [-sz, 0, sx], u: [sx, 0, sz], n: [0, 1, 0], hw, hh };
  }
  if (e.face === 'ceil') {
    // the reader faces (sx, sz) and looks up and ahead: the text's top is the far side, its right their right (seen from
    // below this is the quad's back: the material is double-sided)
    return { c: [e.x, e.y - BOARD_OFF.ceil, e.z], r: [-sz, 0, sx], u: [sx, 0, sz], n: [0, -1, 0], hw, hh };
  }
  // a wall: the board faces (sx, sz) out of it (the plaque convention); the reader's right is (sz, 0, -sx)
  return { c: [e.x + sx * BOARD_OFF.wall, e.y, e.z + sz * BOARD_OFF.wall], r: [sz, 0, -sx], u: [0, 1, 0], n: [sx, 0, sz], hw, hh };
}

/** Lines of tokens: { s, k } with k 'n' (plain), 's' (struck), 'g' (gouged); { k: 't', n } a tally. */
export function parseBoard(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = [];
    let k = 'n';
    let buf = '';
    const push = () => {
      for (const w of buf.split(/\s+/)) if (w) line.push({ s: w, k });
      buf = '';
    };
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '~' || ch === '#') {
        push();
        const t = ch === '~' ? 's' : 'g';
        k = k === t ? 'n' : t;
        continue;
      }
      if (ch === '{') {
        const j = raw.indexOf('}', i);
        if (j > i) {
          push();
          line.push({ s: '', k: 't', n: Math.max(1, Math.min(60, parseInt(raw.slice(i + 1, j), 10) || 1)) });
          i = j;
          continue;
        }
      }
      buf += ch;
    }
    push();
    out.push(line);
  }
  return out;
}
/** The plain words a reader sees (no markup): what the tests count. */
export function boardPlain(text) {
  return parseBoard(text)
    .map((l) => l.filter((t) => t.k === 'n' || t.k === 's').map((t) => t.s).join(' '))
    .join(' ');
}

function fontOf(style, fs) {
  return `${style === 'scratch' ? 400 : style === 'fresh' ? 700 : 600} ${Math.round(fs)}px ${FONT}`;
}
function tokW(ctx, t, fs) {
  if (t.k === 't') {
    const sp = fs * 0.2;
    return Math.floor(t.n / 5) * sp * 5.6 + (t.n % 5) * sp;
  }
  return ctx.measureText(t.s).width;
}

/** Word-wraps and shrinks the text to fit the cell: { fs, rows: [[token]], widths }. */
export function fitBoard(ctx, lines, W, H, style = 'plate') {
  let fs = H * 0.4;
  let rows = [];
  let widths = [];
  for (let iter = 0; iter < 30; iter++) {
    ctx.font = fontOf(style, fs);
    const sp = ctx.measureText(' ').width;
    rows = [];
    widths = [];
    for (const line of lines) {
      let cur = [];
      let cw = 0;
      for (const t of line) {
        const w = tokW(ctx, t, fs);
        if (cur.length && cw + sp + w > W * 0.86) {
          rows.push(cur);
          widths.push(cw);
          cur = [];
          cw = 0;
        }
        cw += (cur.length ? sp : 0) + w;
        cur.push(t);
      }
      rows.push(cur);
      widths.push(cw);
    }
    const widest = Math.max(1, ...widths);
    if (rows.length * fs * 1.22 <= H * (style === 'plate' ? 0.74 : 0.84) && widest <= W * 0.88) break;
    fs *= 0.92;
  }
  return { fs, rows, widths };
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawPlate(ctx, W, H, rng) {
  ctx.fillStyle = 'rgba(13,14,15,0.84)';
  rr(ctx, 4, 4, W - 8, H - 8, 7);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,246,226,0.10)'; // bevel: lit top / left
  ctx.beginPath();
  ctx.moveTo(8, H - 8);
  ctx.lineTo(8, 8);
  ctx.lineTo(W - 8, 8);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; // shadowed bottom / right
  ctx.beginPath();
  ctx.moveTo(W - 8, 8);
  ctx.lineTo(W - 8, H - 8);
  ctx.lineTo(8, H - 8);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(232,220,192,0.42)'; // the rule, as on the plaques
  ctx.lineWidth = 3;
  ctx.strokeRect(17, 17, W - 34, H - 34);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; // a few chips off the rim
  for (let i = 0; i < 5; i++) {
    const x = 10 + rng() * (W - 20);
    const top = rng() < 0.5;
    ctx.beginPath();
    ctx.arc(x, top ? 6 : H - 6, 3 + rng() * 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGouge(ctx, x, y, w, fs, rng) {
  const h = fs * 0.78;
  const n = Math.max(6, Math.round(w / (fs * 0.35)));
  ctx.beginPath();
  for (let i = 0; i <= n; i++) ctx[i ? 'lineTo' : 'moveTo'](x + (w * i) / n, y - h / 2 + (rng() - 0.5) * fs * 0.16);
  for (let i = n; i >= 0; i--) ctx.lineTo(x + (w * i) / n + (rng() - 0.5) * fs * 0.06, y + h / 2 + (rng() - 0.5) * fs * 0.16);
  ctx.closePath();
  ctx.fillStyle = 'rgba(6,5,4,0.93)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(214,200,172,0.28)'; // the chisel's bite at the edges
  ctx.lineWidth = Math.max(1, fs * 0.03);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(214,200,172,0.12)';
  for (let i = 0; i < n; i++) {
    const cx = x + rng() * w;
    ctx.beginPath();
    ctx.moveTo(cx, y - h * 0.3);
    ctx.lineTo(cx + fs * 0.12, y + h * 0.3);
    ctx.stroke();
  }
}

function drawTally(ctx, x, y, n, fs, col, rng) {
  const sp = fs * 0.2;
  const h = fs * 0.8;
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1.5, fs * 0.075);
  ctx.lineCap = 'round';
  let cx = x;
  for (let i = 0; i < n; i++) {
    const inGroup = i % 5;
    if (inGroup === 4) {
      ctx.beginPath(); // the fifth stroke crosses the four
      ctx.moveTo(cx - sp * 4.3, y + h * 0.35);
      ctx.lineTo(cx + sp * 0.2, y - h * 0.3);
      ctx.stroke();
      cx += sp * 1.6;
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(cx + (rng() - 0.5) * sp * 0.3, y - h / 2);
    ctx.lineTo(cx + (rng() - 0.5) * sp * 0.3, y + h / 2);
    ctx.stroke();
    cx += sp;
  }
}

function drawRows(ctx, fit, W, H, style, rng) {
  const { fs, rows, widths } = fit;
  const n = rows.length;
  ctx.font = fontOf(style, fs);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const sp = ctx.measureText(' ').width;
  const ink = style === 'fresh' ? '#f2ebda' : style === 'scratch' ? 'rgba(226,219,202,0.82)' : style === 'cut' ? '#d8cba9' : '#e8dcc0';
  let drawn = 0;
  rows.forEach((row, i) => {
    const y = H / 2 + (i - (n - 1) / 2) * fs * 1.22 + (style === 'scratch' ? (rng() - 0.5) * fs * 0.12 : 0);
    let x = (W - widths[i]) / 2;
    if (style === 'scratch') {
      ctx.save();
      ctx.translate(W / 2, y);
      ctx.rotate((rng() - 0.5) * 0.03);
      ctx.translate(-W / 2, -y);
    }
    row.forEach((t, j) => {
      const w = tokW(ctx, t, fs);
      if (t.k === 'g') drawGouge(ctx, x, y, w, fs, rng);
      else if (t.k === 't') drawTally(ctx, x, y, t.n, fs, ink, rng);
      else {
        ctx.save();
        if (t.k === 's') ctx.globalAlpha = 0.55;
        if (style === 'scratch') {
          ctx.lineWidth = Math.max(1.4, fs * 0.045);
          ctx.strokeStyle = ink;
          ctx.strokeText(t.s, x, y);
          ctx.globalAlpha *= 0.35;
          ctx.strokeText(t.s, x + fs * 0.03, y + fs * 0.02);
        } else {
          if (style === 'cut' || style === 'fresh') {
            ctx.fillStyle = 'rgba(0,0,0,0.62)'; // the cut's shadowed wall
            ctx.fillText(t.s, x + fs * 0.035, y + fs * 0.05);
          }
          if (style === 'plate' || style === 'cut') {
            ctx.shadowColor = style === 'plate' ? 'rgba(184,240,224,0.55)' : 'rgba(184,240,224,0.3)';
            ctx.shadowBlur = fs * (style === 'plate' ? 0.22 : 0.12);
          }
          ctx.fillStyle = ink;
          ctx.fillText(t.s, x, y);
        }
        ctx.restore();
        drawn++;
        if (t.k === 's') {
          // struck through by a later hand: the line runs on over the space to a struck neighbour
          const next = row[j + 1];
          const len = w + (next && next.k === 's' ? sp : 0);
          ctx.save();
          ctx.strokeStyle = ink;
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = Math.max(2, fs * 0.075);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x - fs * 0.04, y + (rng() - 0.5) * fs * 0.1);
          ctx.lineTo(x + len + fs * 0.02, y + (rng() - 0.5) * fs * 0.1);
          ctx.stroke();
          ctx.restore();
        }
      }
      x += w + sp;
    });
    if (style === 'scratch') ctx.restore();
  });
  if (style === 'fresh') {
    ctx.fillStyle = 'rgba(244,238,224,0.22)'; // chalk dust fallen from the cut
    for (let i = 0; i < 140; i++) {
      const px = rng() * W;
      const py = H * 0.5 + (rng() + rng() - 0.5) * H * 0.5;
      ctx.fillRect(px, py, 1 + rng() * 2.5, 1 + rng() * 2.5);
    }
  }
  return drawn;
}

// The figure at the bottom (style 'outline'): a climber facing out of the wall in a 512 x 1024 frame, the lantern raised in
// its left hand (the reader's right), a launcher held down and forward in its right (the reader's left): the pose of a body
// that has hung from two tethers for an hour.
const FIGURE = [
  [234, 170], [176, 196], [150, 214], [128, 290], [112, 370], [98, 452], [70, 458], [66, 560], [132, 566], [140, 470], [150, 382],
  [176, 300], [186, 420], [180, 520], [172, 650], [176, 770], [170, 900], [140, 992], [232, 996], [236, 900], [240, 770],
  [256, 612], [272, 770], [276, 900], [280, 996], [372, 992], [342, 900], [336, 770], [340, 650], [332, 520], [326, 420],
  [336, 300], [394, 344], [398, 300], [402, 182], [402, 146], [452, 146], [456, 178], [452, 252], [440, 372], [362, 214],
  [336, 196], [278, 170],
];
const HEAD = [256, 112, 50, 62]; // cx, cy, rx, ry

function figurePath(ctx, tf) {
  ctx.beginPath();
  FIGURE.forEach(([x, y], i) => {
    const [px, py] = tf(x, y);
    ctx[i ? 'lineTo' : 'moveTo'](px, py);
  });
  ctx.closePath();
  const [hx, hy] = tf(HEAD[0], HEAD[1]);
  const [ex] = tf(HEAD[0] + HEAD[2], HEAD[1]);
  const [, ey] = tf(HEAD[0], HEAD[1] + HEAD[3]);
  ctx.moveTo(hx + (ex - hx), hy);
  ctx.ellipse(hx, hy, ex - hx, ey - hy, 0, 0, Math.PI * 2);
  // the lantern hanging from the raised hand, and its bail
  const [l0x, l0y] = tf(412, 192);
  const [l1x, l1y] = tf(448, 250);
  ctx.moveTo(l0x, l0y);
  ctx.rect(l0x, l0y, l1x - l0x, l1y - l0y);
}

function drawOutline(ctx, e, W, H, rng) {
  // one scale (a person, not a stretched one): the figure stands on the bottom of the cell, right of the measuring rod
  const s0 = Math.min((W * 0.7) / 390, (H * 0.9) / 946);
  const ox = W * 0.98 - 456 * s0;
  const oy = H * 0.99 - 996 * s0;
  const sx = s0;
  const sy = s0;
  const base = (x, y) => [ox + x * sx, oy + y * sy];
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // forty measurings, none quite the same: faint earlier outlines under the last one
  for (let k = 0; k < 9; k++) {
    const dx = (rng() - 0.5) * W * 0.03;
    const dy = (rng() - 0.5) * H * 0.012;
    const a = (rng() - 0.5) * 0.03;
    const s = 0.97 + rng() * 0.05;
    const tf = (x, y) => {
      const [px, py] = base(x, y);
      const cx = px - W / 2;
      const cy = py - H;
      return [W / 2 + (cx * Math.cos(a) - cy * Math.sin(a)) * s + dx, H + (cx * Math.sin(a) + cy * Math.cos(a)) * s + dy];
    };
    figurePath(ctx, tf);
    ctx.strokeStyle = `rgba(232,228,216,${(0.08 + rng() * 0.1).toFixed(3)})`;
    ctx.lineWidth = 2 + rng() * 2;
    ctx.stroke();
  }
  // the cut: a groove (its shadowed wall), then the chalk along its edge
  figurePath(ctx, (x, y) => {
    const [px, py] = base(x, y);
    return [px + 2.5, py + 3.5];
  });
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 9;
  ctx.stroke();
  figurePath(ctx, base);
  ctx.fillStyle = 'rgba(250,244,230,0.035)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(238,234,222,0.92)';
  ctx.lineWidth = 4.5;
  ctx.setLineDash([26, 5, 11, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  // the measure: a rod up the left side, ticks at each height that was tried, and whose
  const [, footY] = base(0, 996);
  const [, headY] = base(0, 50);
  const rodX = W * 0.25;
  ctx.strokeStyle = 'rgba(238,234,222,0.8)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(rodX, footY);
  ctx.lineTo(rodX, headY);
  ctx.stroke();
  const fs = Math.round(W * 0.055);
  ctx.font = `600 ${fs}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'right';
  for (const m of e.marks || []) {
    const y = footY + (headY - footY) * m[1];
    ctx.beginPath();
    ctx.moveTo(rodX - 8, y);
    ctx.lineTo(rodX + 22, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(238,234,222,0.78)';
    ctx.fillText(String(m[0]), rodX - 12, y);
  }
  // the last tick: level with the top of the head, no name
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(rodX - 10, headY);
  ctx.lineTo(base(256, 50)[0], headY);
  ctx.stroke();
  if (e.text) {
    // the number over its head, cut fresh
    const ty = Math.max(H * 0.035, headY - H * 0.04);
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(W * 0.11)}px ${FONT}`;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(String(e.text), base(256, 0)[0] + 2, ty + 3);
    ctx.fillStyle = '#f2ebda';
    ctx.fillText(String(e.text), base(256, 0)[0], ty);
  }
  return 1;
}

/** Draws one board into its atlas cell (x0, y0, W, H). Returns { fs, rows } for text boards (the tests read the size). */
export function drawBoardCell(ctx, e, x0, y0, W, H) {
  const style = e.style || 'plate';
  const rng = rngOf(hashStr(String(e.id || e.text)));
  ctx.translate(x0, y0);
  if (style === 'outline') {
    drawOutline(ctx, e, W, H, rng);
    return { fs: H, rows: [] };
  }
  if (style === 'plate') drawPlate(ctx, W, H, rng);
  const fit = fitBoard(ctx, parseBoard(e.text), W, H, style);
  fit.drawn = drawRows(ctx, fit, W, H, style, rng);
  return fit;
}

/** The plaques' material (unlit, phosphor carving reads in the dark) with a polygon offset toward the viewer. */
function boardMaterial(tex) {
  return new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide, // a ceiling's board is read from below (its back); walls and floors are never seen from behind
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export class BoardWriting extends TextAtlasGroups {
  /**
   * @param {THREE.Object3D} parent  where the meshes go (LevelView.root)
   * @param {{makeCanvas?: (w: number, h: number) => object}} [opts]  canvas factory (tests); default: a DOM canvas, none in Node
   */
  constructor(parent, opts = {}) {
    super(parent, {
      name: 'boardWriting',
      atlasW: BOARD_CELL_W,
      cellSize: boardCellSize,
      drawCell: drawBoardCell,
      quad: boardQuad,
      material: boardMaterial,
      renderOrder: 5, // with the plaques
      viewDist: BOARD_DIST,
      buildDist: 40,
      dropDist: 70,
      cellsPerFrame: 1,
      makeCanvas: opts.makeCanvas,
    });
  }
}
