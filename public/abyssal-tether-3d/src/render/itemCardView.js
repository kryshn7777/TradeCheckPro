/* THE LANTERN (ABYSSAL TETHER 3D) — itemCardView.js
 * ITEM CARDS (docs/abyssal-tether-3d/plans/ITEM_CARDS.md): the name card standing over the collectible the player looks at. The owner:
 * "there must be like some sort of name ... a text that says bandage in a unique card. It should not be floating in the space ... the
 * text should be in the background" (on a plate).
 *
 * ONE mesh, ONE draw call: a worn slate tag (the card quad) on a thin iron wire stake (a second quad in the same geometry) standing on the
 * item, both cut from ONE canvas texture (512 x 256: the card in the top 208 rows, the wire's strip below). The canvas is redrawn ONLY when
 * the card's content changes (kind, platform wording, bag full). Unlit MeshBasicMaterial, toneMapped off so the plate keeps a fixed
 * minimum brightness in the darkest sections (its colours are muted: a printed card, not a glowing sign), fog on (it fades with the
 * world far off), depthTest on (never through a wall), no depth write. No extra sampler on any lit material.
 *
 * Placement: the stake rises from the prop's top; the card stands above it, turned about the VERTICAL axis only to face the eye (the
 * headset camera is never touched), leaning back a few degrees with a small settled roll per item. Its width follows the distance
 * (K x d, clamped [WMIN, WMAX]) so the name keeps a constant minimum angular size (>= 28 px on Quest at 0.8-2 m). Fades in / out in
 * 0.15 s; a slight breathing sway unless reduced effects.
 *
 *   const v = new ItemCardView(scene, { makeCanvas? })
 *   v.update(dt, t, eye, reduced)   t = { on, kind, x, y, z, id } (sim/itemGaze.js target), card = { name, hint, accent, icon } from
 *                                    v.setCard(card, hint, key) beforehand; eye = { x, y, z }
 *   v.stats  { redraws, alpha, width, key }    v.dispose()
 * No allocation per frame (the canvas work happens on a content change only).
 */
import * as THREE from 'three';

export const CARD = Object.freeze({
  cw: 512, // canvas
  ch: 256,
  rows: 208, // canvas rows of the card (the rest: the wire's strip)
  k: 0.22, // card width per metre of distance
  wmin: 0.24, // m
  wmax: 0.8,
  lift: 0.24, // m: the card's lower edge above the item centre
  stakeFrom: 0.11, // m: the wire starts at the prop's top
  stakeW: 0.007, // m
  lean: 0.12, // rad: leaning back
  fade: 0.15, // s
});

const ASPECT = CARD.rows / CARD.cw;
const V_CARD = 1 - CARD.rows / CARD.ch; // the card's lower v (flipY: v=1 is the canvas top)
const STRIP_TOP = CARD.rows + 10; // canvas row where the wire's strip begins
const U0 = 4 / CARD.cw;
const U1 = 12 / CARD.cw;
const V_S0 = 2 / CARD.ch;
const V_S1 = (CARD.ch - STRIP_TOP - 2) / CARD.ch;

/** A deterministic LCG (no Math.random). */
function lcg(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hashStr(str) {
  let h = 2166136261;
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hexRgb(hex) {
  const n = parseInt(String(hex || '#999999').slice(1), 16) || 0x999999;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (c, d, t) => [Math.round(c[0] + (d[0] - c[0]) * t), Math.round(c[1] + (d[1] - c[1]) * t), Math.round(c[2] + (d[2] - c[2]) * t)];

function chamfer(g, x, y, w, h, c) {
  g.beginPath();
  g.moveTo(x + c, y);
  g.lineTo(x + w - c, y);
  g.lineTo(x + w, y + c);
  g.lineTo(x + w, y + h - c);
  g.lineTo(x + w - c, y + h);
  g.lineTo(x + c, y + h);
  g.lineTo(x, y + h - c);
  g.lineTo(x, y + c);
  g.closePath();
}

const FONT = "Georgia, 'Times New Roman', serif";

/** The icon glyphs, centred at (cx, cy), about s px across, in `col`. */
function drawIcon(g, icon, cx, cy, s, col, dark) {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = col;
  g.strokeStyle = col;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const u = s / 100;
  switch (icon) {
    case 'aid': {
      chamfer(g, -44 * u, -30 * u, 88 * u, 66 * u, 8 * u);
      g.fill();
      g.lineWidth = 7 * u;
      g.beginPath();
      g.moveTo(-16 * u, -30 * u);
      g.lineTo(-16 * u, -42 * u);
      g.lineTo(16 * u, -42 * u);
      g.lineTo(16 * u, -30 * u);
      g.stroke();
      g.fillStyle = dark;
      g.fillRect(-7 * u, -20 * u, 14 * u, 46 * u);
      g.fillRect(-23 * u, -4 * u, 46 * u, 14 * u);
      break;
    }
    case 'bandage': {
      g.beginPath();
      g.arc(-8 * u, -4 * u, 34 * u, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = dark;
      g.beginPath();
      g.arc(-8 * u, -4 * u, 12 * u, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = col;
      g.beginPath(); // the loose tail
      g.moveTo(14 * u, 22 * u);
      g.lineTo(48 * u, 30 * u);
      g.lineTo(46 * u, 42 * u);
      g.lineTo(6 * u, 32 * u);
      g.closePath();
      g.fill();
      g.strokeStyle = dark;
      g.lineWidth = 3 * u;
      g.beginPath();
      g.arc(-8 * u, -4 * u, 23 * u, 0, Math.PI * 2);
      g.stroke();
      break;
    }
    case 'syringe': {
      g.rotate(-Math.PI / 4);
      chamfer(g, -12 * u, -30 * u, 24 * u, 52 * u, 3 * u);
      g.fill();
      g.fillRect(-2 * u, 22 * u, 4 * u, 22 * u); // needle
      g.fillRect(-4 * u, -44 * u, 8 * u, 14 * u); // rod
      g.fillRect(-14 * u, -50 * u, 28 * u, 6 * u); // thumb plate
      g.fillRect(-22 * u, -32 * u, 44 * u, 5 * u); // flange
      g.fillStyle = dark;
      for (let i = 0; i < 4; i++) g.fillRect(-12 * u, (-18 + i * 10) * u, 10 * u, 2.5 * u);
      break;
    }
    case 'cell': {
      chamfer(g, -20 * u, -34 * u, 40 * u, 74 * u, 5 * u);
      g.fill();
      g.fillRect(-8 * u, -44 * u, 16 * u, 10 * u);
      g.fillStyle = dark;
      g.fillRect(-20 * u, -6 * u, 40 * u, 16 * u);
      g.fillStyle = col;
      g.beginPath(); // a bolt in the band
      g.moveTo(3 * u, -4 * u);
      g.lineTo(-6 * u, 3 * u);
      g.lineTo(0, 3 * u);
      g.lineTo(-3 * u, 9 * u);
      g.lineTo(6 * u, 1 * u);
      g.lineTo(0, 1 * u);
      g.closePath();
      g.fill();
      break;
    }
    case 'knocker': {
      g.lineWidth = 9 * u;
      g.beginPath();
      g.arc(0, -6 * u, 26 * u, 0, Math.PI * 2);
      g.stroke();
      for (let i = 0; i < 8; i++) {
        g.save();
        g.rotate((i * Math.PI) / 4);
        g.fillRect(-5 * u, -46 * u, 10 * u, 12 * u);
        g.restore();
      }
      g.beginPath();
      g.arc(0, -6 * u, 8 * u, 0, Math.PI * 2);
      g.fill();
      g.fillRect(-4 * u, 18 * u, 8 * u, 26 * u); // the handle
      break;
    }
    case 'grenade': {
      g.beginPath();
      g.ellipse(0, 8 * u, 28 * u, 34 * u, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(-12 * u, -34 * u, 24 * u, 12 * u);
      g.lineWidth = 6 * u;
      g.beginPath(); // the lever
      g.moveTo(10 * u, -32 * u);
      g.quadraticCurveTo(30 * u, -26 * u, 30 * u, 4 * u);
      g.stroke();
      g.beginPath(); // the ring
      g.arc(-20 * u, -36 * u, 8 * u, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = dark;
      g.lineWidth = 3 * u;
      for (let i = -1; i <= 1; i++) {
        g.beginPath();
        g.moveTo(-28 * u, (8 + i * 14) * u);
        g.lineTo(28 * u, (8 + i * 14) * u);
        g.stroke();
      }
      break;
    }
    case 'revolver': {
      g.fillRect(-46 * u, -18 * u, 62 * u, 13 * u); // barrel
      g.beginPath();
      g.ellipse(4 * u, 0, 18 * u, 14 * u, 0, 0, Math.PI * 2); // cylinder
      g.fill();
      g.beginPath(); // the grip
      g.moveTo(14 * u, -10 * u);
      g.lineTo(32 * u, -8 * u);
      g.lineTo(44 * u, 34 * u);
      g.lineTo(26 * u, 38 * u);
      g.lineTo(14 * u, 10 * u);
      g.closePath();
      g.fill();
      g.lineWidth = 4 * u;
      g.beginPath(); // trigger guard
      g.arc(10 * u, 16 * u, 9 * u, 0, Math.PI);
      g.stroke();
      g.fillStyle = dark;
      g.fillRect(-2 * u, -4 * u, 14 * u, 3 * u);
      break;
    }
    case 'fuel': {
      chamfer(g, -28 * u, -28 * u, 56 * u, 66 * u, 9 * u);
      g.fill();
      g.fillRect(-8 * u, -40 * u, 16 * u, 12 * u);
      g.fillStyle = dark;
      g.fillRect(-28 * u, -2 * u, 56 * u, 12 * u);
      break;
    }
    default: {
      chamfer(g, -34 * u, -26 * u, 68 * u, 60 * u, 4 * u);
      g.fill();
      g.fillStyle = dark;
      g.fillRect(-34 * u, -6 * u, 68 * u, 6 * u);
      g.fillRect(-4 * u, -26 * u, 8 * u, 60 * u);
    }
  }
  g.restore();
}

/** Fits `text` into maxW: condenses up to 18 %, then shrinks the font down to `min`. Returns [size, squash]. */
function fit(g, text, weight, size, min, maxW) {
  let sz = size;
  for (;;) {
    g.font = `${weight} ${sz}px ${FONT}`;
    const w = g.measureText(text).width || 0;
    if (w <= maxW) return [sz, 1];
    if (w * 0.82 <= maxW) return [sz, maxW / w];
    if (sz <= min) return [sz, Math.max(0.5, maxW / w)];
    sz -= 2;
  }
}

/** Splits a long name into two lines at the space nearest its middle (or returns it whole). */
function splitName(name) {
  const words = name.split(' ');
  if (words.length < 2) return [name];
  let best = 1;
  let bestD = 1e9;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const d = Math.abs(a - (name.length - a - 1));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

function fillSquashed(g, text, x, y, squash) {
  if (squash >= 0.999) {
    g.fillText(text, x, y);
    return;
  }
  g.save();
  g.translate(x, y);
  g.scale(squash, 1);
  g.fillText(text, 0, 0);
  g.restore();
}

/** Draws the whole canvas for one card. `seed` keeps the wear the same for a kind. */
export function drawCard(g, card, hint, seed) {
  const W = CARD.cw;
  const R = CARD.rows;
  const acc = hexRgb(card.accent);
  const ink = [241, 233, 214]; // the name: old paper white
  const rnd = lcg(seed);
  g.clearRect(0, 0, W, CARD.ch);
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  // ---- the plate: a dark slate tag with chamfered corners ----
  const px = 6;
  const py = 6;
  const pw = W - 12;
  const ph = R - 12;
  chamfer(g, px, py, pw, ph, 18);
  const grad = g.createLinearGradient(0, py, 0, py + ph);
  grad.addColorStop(0, '#30353a');
  grad.addColorStop(0.55, '#24282c');
  grad.addColorStop(1, '#1a1d20');
  g.fillStyle = grad;
  g.fill();
  // worn grain inside the plate (speckles + a few scratches), clipped
  g.save();
  chamfer(g, px, py, pw, ph, 18);
  g.clip();
  for (let i = 0; i < 520; i++) {
    const x = px + rnd() * pw;
    const y = py + rnd() * ph;
    const l = rnd() < 0.5;
    g.fillStyle = l ? `rgba(200,195,180,${(0.03 + rnd() * 0.06).toFixed(3)})` : `rgba(0,0,0,${(0.08 + rnd() * 0.12).toFixed(3)})`;
    const s = 1 + rnd() * 2.2;
    g.fillRect(x, y, s, s);
  }
  g.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    const x = px + rnd() * pw;
    const y = py + rnd() * ph;
    g.strokeStyle = `rgba(210,205,190,${(0.05 + rnd() * 0.07).toFixed(3)})`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 90, y + (rnd() - 0.5) * 14);
    g.stroke();
  }
  // darkened, scuffed corners
  const vg = g.createRadialGradient(W / 2, R / 2, R * 0.35, W / 2, R / 2, W * 0.6);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.38)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, R);
  g.restore();
  // the worn rim: a pale bevelled edge (broken in a few places) and a dark outer line
  chamfer(g, px, py, pw, ph, 18);
  g.lineWidth = 4;
  g.strokeStyle = '#0c0d0e';
  g.stroke();
  chamfer(g, px + 3, py + 3, pw - 6, ph - 6, 16);
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(150,146,134,0.55)';
  g.setLineDash([46 + Math.round(rnd() * 30), 4 + Math.round(rnd() * 8), 90, 6, 30 + Math.round(rnd() * 20), 5]);
  g.stroke();
  g.setLineDash([]);
  // the accent frame, inset
  chamfer(g, px + 11, py + 11, pw - 22, ph - 22, 11);
  g.lineWidth = 2.5;
  g.strokeStyle = rgba(acc, 0.85);
  g.stroke();
  // rivets
  g.fillStyle = 'rgba(120,116,106,0.9)';
  for (const [x, y] of [
    [px + 22, py + 22],
    [px + pw - 22, py + 22],
    [px + 22, py + ph - 22],
    [px + pw - 22, py + ph - 22],
  ]) {
    g.beginPath();
    g.arc(x, y, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  // ---- the icon block ----
  const ix = 30;
  const iy = 32;
  const iw = 102;
  const ih = R - 64;
  chamfer(g, ix, iy, iw, ih, 8);
  g.fillStyle = rgba(mix(acc, [0, 0, 0], 0.72), 0.95);
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = rgba(acc, 0.55);
  g.stroke();
  drawIcon(g, card.icon, ix + iw / 2, iy + ih / 2 + 2, 84, rgba(mix(acc, ink, 0.25), 1), rgba(mix(acc, [0, 0, 0], 0.72), 1));
  // ---- the name ----
  const tx = 150;
  const tw = W - tx - 30;
  const name = String(card.name || '').toUpperCase();
  g.fillStyle = rgba(ink, 1);
  const one = fit(g, name, 700, 56, 48, tw);
  let nameBottom;
  if (one[1] >= 0.82 || splitName(name).length === 1) {
    g.font = `700 ${one[0]}px ${FONT}`;
    fillSquashed(g, name, tx, 96, one[1]);
    nameBottom = 96;
  } else {
    const [a, b] = splitName(name);
    const fa = fit(g, a, 700, 48, 40, tw);
    const fb = fit(g, b, 700, 48, 40, tw);
    const sz = Math.min(fa[0], fb[0]);
    g.font = `700 ${sz}px ${FONT}`;
    fillSquashed(g, a, tx, 72, Math.min(fa[1], 1));
    fillSquashed(g, b, tx, 72 + sz + 2, Math.min(fb[1], 1));
    nameBottom = 72 + sz + 2;
  }
  // a short accent rule under the name
  g.fillStyle = rgba(acc, 0.9);
  g.fillRect(tx, nameBottom + 14, 64, 3);
  g.fillStyle = rgba(acc, 0.35);
  g.fillRect(tx + 68, nameBottom + 15, tw - 68, 1);
  // ---- the hint ----
  const hf = fit(g, hint, 400, 27, 21, tw);
  g.font = `400 ${hf[0]}px ${FONT}`;
  g.fillStyle = 'rgba(196,188,170,1)';
  fillSquashed(g, hint, tx, Math.max(nameBottom + 50, 166), hf[1]);
  // the clip where the wire holds the card (bottom centre)
  g.fillStyle = '#3d3a35';
  g.fillRect(W / 2 - 10, R - 14, 20, 12);
  g.fillStyle = '#5a564e';
  g.fillRect(W / 2 - 10, R - 14, 20, 2);
  // ---- the wire's strip (below the card, sampled by the stake quad) ----
  g.fillStyle = '#2b2925';
  g.fillRect(0, STRIP_TOP, 16, CARD.ch - STRIP_TOP);
  g.fillStyle = '#56524a';
  g.fillRect(6, STRIP_TOP, 3, CARD.ch - STRIP_TOP);
}

export class ItemCardView {
  /**
   * @param {THREE.Scene|THREE.Object3D|null} scene
   * @param {{makeCanvas?:(w:number,h:number)=>HTMLCanvasElement}} [opts]
   */
  constructor(scene, opts = {}) {
    this.scene = scene || null;
    const make = opts.makeCanvas || ((w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    });
    this.canvas = make(CARD.cw, CARD.ch);
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.name = 'itemCardTexture';
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthTest: true,
      depthWrite: false,
      fog: true,
      toneMapped: false,
      side: THREE.DoubleSide,
      alphaTest: 0.02,
    });
    this.material.name = 'itemCard';
    const geo = new THREE.BufferGeometry();
    this._pos = new Float32Array(8 * 3);
    const uv = new Float32Array([
      // card: bl, br, tr, tl
      0, V_CARD, 1, V_CARD, 1, 1, 0, 1,
      // stake: bl, br, tr, tl
      U0, V_S0, U1, V_S0, U1, V_S1, U0, V_S1,
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    this.geometry = geo;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'itemCard';
    this.mesh.frustumCulled = false; // (its box changes with the card's width; one tiny mesh)
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    this.mesh.rotation.order = 'YXZ';
    if (this.scene) this.scene.add(this.mesh);
    this.alpha = 0;
    this.key = null; // the content shown on the canvas
    this._want = null; // the content wanted next
    this._card = null;
    this._hint = '';
    this._width = 0;
    this._roll = 0;
    this._clock = 0;
    this._at = { x: 0, y: 0, z: 0, id: null };
    this.stats = { redraws: 0, alpha: 0, width: 0, key: null, visible: false };
    this._layout(CARD.wmin);
  }

  /** The content for the next show: a card object (data/itemCards.js cardFor), its hint line, and a key naming that content. */
  setCard(card, hint, key) {
    if (key === this._want) return;
    this._want = key;
    this._card = card;
    this._hint = hint;
  }

  _redraw() {
    drawCard(this.g, this._card, this._hint, hashStr(this._want) ^ 0x9e3779b9);
    this.texture.needsUpdate = true;
    this.key = this._want;
    this.stats.redraws++;
    this.stats.key = this.key;
  }

  /** Writes the card + stake vertices for a card `w` metres wide (local space: y up, the card faces +z). */
  _layout(w) {
    this._width = w;
    const P = this._pos;
    const h = w * ASPECT;
    const hw = w / 2;
    const y0 = CARD.lift;
    const ct = Math.cos(CARD.lean);
    const st = Math.sin(CARD.lean);
    const y1 = y0 + h * ct;
    const z1 = -h * st;
    // card
    P[0] = -hw; P[1] = y0; P[2] = 0;
    P[3] = hw; P[4] = y0; P[5] = 0;
    P[6] = hw; P[7] = y1; P[8] = z1;
    P[9] = -hw; P[10] = y1; P[11] = z1;
    // stake: from the prop's top to a little inside the card's lower edge
    const sw = CARD.stakeW / 2;
    const s0 = CARD.stakeFrom;
    const s1 = y0 + 0.012;
    P[12] = -sw; P[13] = s0; P[14] = 0.002;
    P[15] = sw; P[16] = s0; P[17] = 0.002;
    P[18] = sw; P[19] = s1; P[20] = 0.002;
    P[21] = -sw; P[22] = s1; P[23] = 0.002;
    this.geometry.attributes.position.needsUpdate = true;
    this.stats.width = w;
  }

  /**
   * @param {number} dt
   * @param {{on:boolean,x:number,y:number,z:number,id:*}|null} t the gaze target
   * @param {{x:number,y:number,z:number}} eye
   * @param {boolean} reduced reduced effects: no sway
   */
  update(dt, t, eye, reduced) {
    const step = dt > 0 && dt < 1 ? dt : 0;
    this._clock += step;
    const on = !!(t && t.on && this._want !== null);
    // a new card or a new item while one is up: fade the old one out first, then swap
    const A = this._at;
    const moved = on && (t.id !== A.id || t.x !== A.x || t.y !== A.y || t.z !== A.z);
    const swap = on && (this._want !== this.key || moved);
    const goal = on && !swap ? 1 : 0;
    const rate = step / CARD.fade;
    if (this.alpha < goal) this.alpha = Math.min(goal, this.alpha + rate);
    else if (this.alpha > goal) this.alpha = Math.max(goal, this.alpha - rate);
    if (swap && this.alpha <= 0) {
      if (this._want !== this.key) this._redraw();
      A.id = t.id;
      A.x = t.x;
      A.y = t.y;
      A.z = t.z;
      this._roll = (((hashStr(t.id) % 7) | 0) - 3) * 0.009;
    }
    const vis = this.alpha > 0.001;
    this.mesh.visible = vis;
    this.material.opacity = this.alpha;
    this.stats.alpha = this.alpha;
    this.stats.visible = vis;
    if (!vis || !eye) return;
    const dx = eye.x - A.x;
    const dz = eye.z - A.z;
    const dy = eye.y - A.y;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let w = d * CARD.k;
    w = w < CARD.wmin ? CARD.wmin : w > CARD.wmax ? CARD.wmax : w;
    if (Math.abs(w - this._width) > 0.002) this._layout(w);
    const sway = reduced ? 0 : Math.sin(this._clock * 1.3 + this._roll * 40) * 0.006;
    this.mesh.position.set(A.x, A.y, A.z);
    this.mesh.rotation.set(0, Math.atan2(dx, dz), this._roll + sway);
  }

  /** The width the card takes at distance d (the clamps; tests). */
  static widthAt(d) {
    const w = d * CARD.k;
    return w < CARD.wmin ? CARD.wmin : w > CARD.wmax ? CARD.wmax : w;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.disposed = true;
  }
}
