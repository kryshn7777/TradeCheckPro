/* ABYSSAL TETHER 3D — prologueView.js
 * The picture of the opening story (sim/prologue3d.js): one canvas page, one quad, over the black fade. A library page that types
 * itself out in a serif face, a depth gauge down its left edge, a ring of ancient marks behind the text that wakes as the record
 * darkens, dust, and at the end the record tears (slice glitch, static) mid-sentence.
 *
 *   PrologueView(camera, scene)
 *   .update(dt, pro, opts)   pro = Prologue3D; opts = { xr, reduced, aspect }. Redrawn at <= 30 Hz.
 *   .dispose()
 *
 * Desktop: the quad is a child of the camera, sized to fit the view (16:9, letterboxed in a wider window). In a headset it is a
 * world-locked panel 2.2 m in front of the head when the story began (a head-locked page of text is the thing that makes a view
 * uncomfortable): it stays where it is, and eases round to the front again if the head has been turned away from it for a second.
 * One draw call (the quad); the canvas is 1280 x 720 and uploaded only when redrawn. renderOrder 10001: over the fade (9999).
 * Reduced effects: no glitch slices, no static, no flicker; the typewriter and the colours stay.
 */

import * as THREE from 'three';
import { PAGES, TIMING } from '../sim/prologue3d.js';

const W = 1280;
const H = 720;
const REDRAW_S = 1 / 30;
const PANEL_D = 2.2; // m: the VR panel's distance
const PANEL_W = 2.6; // m
const RECENTER_DEG = 38;
const RECENTER_AFTER = 1.0; // s of looking away

const SERIF = 'Georgia, "Times New Roman", serif';
const MONO = 'ui-monospace, Menlo, Consolas, "Courier New", monospace';

// the three colours the record passes through: cold library white, a tired amber, ember red
const C0 = [186, 214, 222];
const C1 = [226, 204, 150];
const C2 = [222, 84, 52];
const ACC0 = [106, 178, 164];
const ACC1 = [214, 160, 80];
const ACC2 = [190, 36, 28];

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function tone3(c0, c1, c2, tone) {
  const t = Math.min(4, Math.max(0, tone)) / 4;
  return t < 0.5 ? mix(c0, c1, t * 2) : mix(c1, c2, (t - 0.5) * 2);
}
function rgba(c, a) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}
function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const KIND = {
  meta: { font: `600 20px ${MONO}`, ls: 3, lh: 30, gapAfter: 8 },
  body: { font: `400 33px ${SERIF}`, ls: 0, lh: 44, gapAfter: 14 },
  cut: { font: `400 33px ${SERIF}`, ls: 0, lh: 44, gapAfter: 14 },
  head: { font: `700 50px ${SERIF}`, ls: 1, lh: 62, gapAfter: 16 },
};

export class PrologueView {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene || null;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.name = 'prologue';
    this.mesh.renderOrder = 10001;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this._parent = null;
    this._wrapCache = new Map();
    this._lastDraw = -1;
    this._t = 0;
    this._xr = false;
    // the VR panel's placement
    this._placed = false;
    this._yaw = 0;
    this._away = 0;
    this._p = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.info = { drawCalls: 0, redraws: 0 };
  }

  _attach(xr) {
    const want = xr && this.scene ? this.scene : this.camera;
    if (this._parent !== want) {
      if (this._parent) this._parent.remove(this.mesh);
      want.add(this.mesh);
      this._parent = want;
      this._placed = false;
    }
  }

  _place(dt, xr, aspect) {
    const m = this.mesh;
    if (!xr) {
      const cam = this.camera;
      const d = 1;
      const vh = 2 * d * Math.tan(((cam.fov || 70) * Math.PI) / 360);
      const vw = vh * (aspect > 0.2 ? aspect : 16 / 9);
      const h = Math.min(vh, (vw * 9) / 16);
      m.position.set(0, 0, -d);
      m.quaternion.identity();
      m.scale.set((h * 16) / 9, h, 1);
      return;
    }
    const cam = this.camera;
    cam.updateWorldMatrix(true, false);
    cam.getWorldPosition(this._p);
    cam.getWorldDirection(this._f);
    const headYaw = Math.atan2(-this._f.x, -this._f.z);
    if (!this._placed) {
      this._yaw = headYaw;
      this._placed = true;
      this._away = 0;
    }
    let dy = headYaw - this._yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    if (Math.abs(dy) > (RECENTER_DEG * Math.PI) / 180) this._away += dt;
    else this._away = Math.max(0, this._away - dt * 2);
    if (this._away > RECENTER_AFTER) this._yaw += dy * (1 - Math.exp(-2.2 * dt)); // eases round to the front
    const sy = Math.sin(this._yaw);
    const cy = Math.cos(this._yaw);
    m.position.set(this._p.x - sy * PANEL_D, this._p.y - 0.04, this._p.z - cy * PANEL_D);
    this._e.set(0, this._yaw, 0);
    m.quaternion.setFromEuler(this._e);
    m.scale.set(PANEL_W, (PANEL_W * 9) / 16, 1);
  }

  /**
   * @param {number} dt
   * @param {import('../sim/prologue3d.js').Prologue3D|null} pro
   * @param {{xr?:boolean, reduced?:boolean, aspect?:number}} [opts]
   */
  update(dt, pro, opts) {
    const o = opts || {};
    const on = !!pro && pro.active;
    this.mesh.visible = on;
    this.info.drawCalls = on ? 1 : 0;
    if (!on) return;
    const xr = !!o.xr;
    this._attach(xr);
    this._t += dt > 0 ? Math.min(dt, 0.1) : 0;
    this._place(dt > 0 ? Math.min(dt, 0.1) : 0, xr, o.aspect || 16 / 9);
    if (this._t - this._lastDraw >= REDRAW_S || this._lastDraw < 0) {
      this._lastDraw = this._t;
      this._draw(pro, !!o.reduced, xr);
      this.texture.needsUpdate = true;
      this.info.redraws++;
    }
  }

  _wrap(ctx, key, text, font, ls, maxW) {
    let w = this._wrapCache.get(key);
    if (w) return w;
    ctx.font = font;
    ctx.letterSpacing = `${ls}px`;
    const words = text.split(' ');
    w = [];
    let cur = '';
    for (const word of words) {
      const test = cur ? `${cur} ${word}` : word;
      if (cur && ctx.measureText(test).width > maxW) {
        w.push(cur);
        cur = word;
      } else cur = test;
    }
    if (cur) w.push(cur);
    this._wrapCache.set(key, w);
    return w;
  }

  _draw(pro, reduced, xr) {
    const ctx = this.ctx;
    const t = this._t;
    const tone = pro.tone;
    const col = tone3(C0, C1, C2, tone);
    const acc = tone3(ACC0, ACC1, ACC2, tone);
    const fade = Math.min(1, pro.pageIn) * (1 - pro.pageOut);
    const P = PAGES[pro.page];
    const title = P.id === 'title';

    // ---- the page: black, a vignette of faint light, dust --------------------------------------------------------------
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#020303';
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.58, H * 0.5, 40, W * 0.58, H * 0.5, 620);
    g.addColorStop(0, rgba(acc, 0.1 + 0.06 * pro.wake));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 38; i++) {
      const x = hash(i * 3.1) * W;
      const y = (((hash(i * 5.7) * H - t * (6 + hash(i) * 14)) % H) + H) % H;
      ctx.fillStyle = rgba(col, 0.05 + 0.1 * hash(i * 9.3));
      ctx.fillRect(x, y, 2, 2);
    }

    // ---- the ring of ancient marks behind the text, waking with the record -------------------------------------------
    this._ring(ctx, pro, t, col, acc, reduced);

    // ---- the frame of the book page ---------------------------------------------------------------------------------
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(acc, 0.34 * fade);
    ctx.strokeRect(78, 56, W - 156, H - 112);
    const k = 26;
    ctx.strokeStyle = rgba(acc, 0.8 * fade);
    ctx.beginPath();
    for (const [x, y, sx, sy] of [[78, 56, 1, 1], [W - 78, 56, -1, 1], [78, H - 56, 1, -1], [W - 78, H - 56, -1, -1]]) {
      ctx.moveTo(x + sx * k, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * k);
    }
    ctx.stroke();

    // ---- the depth gauge down the left edge -------------------------------------------------------------------------
    if (!title) this._gauge(ctx, pro, t, col, acc, fade, reduced);

    // ---- the text ---------------------------------------------------------------------------------------------------
    const maxW = title ? 900 : 800;
    const x0 = title ? W / 2 : 250;
    // lay the whole page out first (so typing never moves a line)
    const lay = [];
    let total = 0;
    for (let i = 0; i < P.lines.length; i++) {
      const L = P.lines[i];
      const K = KIND[L.k];
      const wr = this._wrap(ctx, `${P.id}:${i}`, L.t, K.font, K.ls, maxW);
      lay.push({ L, K, wr });
      total += wr.length * K.lh + K.gapAfter;
    }
    let y = Math.round(H / 2 - total / 2) + (title ? 0 : 6) + 28;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = title ? 'center' : 'left';
    const flick = !reduced && pro.glitch > 0 ? 1 - 0.25 * pro.glitch * hash(Math.floor(t * 14)) : 1;
    for (let i = 0; i < lay.length; i++) {
      const { L, K, wr } = lay[i];
      const nChars = pro.chars[i];
      ctx.font = K.font;
      ctx.letterSpacing = `${K.ls}px`;
      let used = 0;
      let caretDone = false;
      for (let r = 0; r < wr.length; r++) {
        y += K.lh;
        const row = wr[r];
        const take = Math.max(0, Math.min(row.length, nChars - used));
        if (take > 0) {
          const txt = row.slice(0, take);
          const c = L.k === 'meta' ? acc : col;
          const a = (L.k === 'meta' ? 0.82 : 0.96) * fade * flick;
          if (!reduced && pro.glitch > 0.05) {
            ctx.fillStyle = rgba([255, 40, 30], pro.glitch * 0.35 * fade);
            ctx.fillText(txt, x0 - 3 * pro.glitch, y);
            ctx.fillStyle = rgba([40, 220, 255], pro.glitch * 0.22 * fade);
            ctx.fillText(txt, x0 + 3 * pro.glitch, y);
          }
          ctx.fillStyle = rgba(c, a);
          ctx.fillText(txt, x0, y);
          // the caret rides the end of the text being typed
          if (!caretDone && nChars < L.t.length && nChars <= used + row.length && Math.floor(t * 2.4) % 2 === 0) {
            caretDone = true;
            const wdt = ctx.measureText(txt).width;
            ctx.fillStyle = rgba(acc, 0.9 * fade);
            ctx.fillRect(title ? x0 + wdt / 2 + 6 : x0 + wdt + 4, y - K.lh * 0.74, 3, K.lh * 0.78);
          }
        }
        used += row.length + 1;
      }
      y += K.gapAfter;
    }
    // the title page: a thin rule under the name
    if (title && pro.chars[0] > 0) {
      ctx.fillStyle = rgba(acc, 0.5 * fade);
      ctx.fillRect(W / 2 - 220, H / 2 + 62, 440, 2);
    }

    // ---- the tear: slices of the page slide sideways, then static, then nothing --------------------------------------
    if (!reduced && pro.glitch > 0.05) this._tear(ctx, pro, t);
    if (!reduced && pro.cut >= 0 && pro.cut < TIMING.cutStatic) this._static(ctx, pro, t);

    // ---- the prompt ---------------------------------------------------------------------------------------------------
    if (pro.t > 2) {
      ctx.textAlign = 'right';
      ctx.font = `600 18px ${MONO}`;
      ctx.letterSpacing = '2px';
      ctx.fillStyle = rgba(col, 0.3 + 0.12 * Math.sin(t * 2.2));
      ctx.fillText(xr ? 'TRIGGER · NEXT     B · SKIP' : 'ANY KEY · NEXT     ESC · SKIP', W - 100, H - 78);
    }
    ctx.letterSpacing = '0px';
  }

  /** The ring of marks: three rings, 24 ticks of uneven length turning slowly, an ember at the centre, a crack at the cut. */
  _ring(ctx, pro, t, col, acc, reduced) {
    const cx = 930;
    const cy = 360;
    const R = 250;
    const wake = pro.wake;
    const a = 0.05 + 0.34 * wake;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineWidth = 2;
    for (let r = 0; r < 3; r++) {
      ctx.strokeStyle = rgba(acc, a * (1 - r * 0.22));
      ctx.beginPath();
      ctx.arc(0, 0, R - r * 46, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.rotate(t * (0.035 + 0.09 * wake));
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      const len = 14 + hash(i * 2.3) * 40;
      const r0 = R + 8;
      ctx.strokeStyle = rgba(acc, a * (0.5 + 0.5 * hash(i * 7.1)));
      ctx.lineWidth = 2 + (hash(i * 4.4) > 0.8 ? 2 : 0);
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
      ctx.lineTo(Math.cos(ang) * (r0 + len), Math.sin(ang) * (r0 + len));
      ctx.stroke();
    }
    // inner marks: short arcs that only the ring remembers
    ctx.rotate(-t * (0.07 + 0.18 * wake));
    for (let i = 0; i < 9; i++) {
      const a0 = hash(i * 1.7) * Math.PI * 2;
      ctx.strokeStyle = rgba(acc, a * 0.9);
      ctx.beginPath();
      ctx.arc(0, 0, R - 92 - (i % 3) * 18, a0, a0 + 0.3 + hash(i * 3.3) * 0.7);
      ctx.stroke();
    }
    // the ember at the centre
    const pulse = reduced ? 1 : 0.85 + 0.15 * Math.sin(t * (2 + 5 * wake));
    const eg = ctx.createRadialGradient(0, 0, 2, 0, 0, 90 + 70 * wake);
    eg.addColorStop(0, rgba(mix(ACC1, ACC2, wake), (0.18 + 0.5 * wake) * pulse));
    eg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.arc(0, 0, 160, 0, Math.PI * 2);
    ctx.fill();
    // the crack, once the entry is torn
    if (pro.cut >= 0) {
      const grow = Math.min(1, pro.cut / 0.7);
      ctx.strokeStyle = rgba([230, 90, 50], 0.85 * (1 - Math.max(0, pro.cut - 0.9)));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const n = Math.floor(14 * grow);
      let x = 0;
      let y = 0;
      for (let i = 1; i <= n; i++) {
        x += 20 + hash(i * 3.9) * 14;
        y += (hash(i * 8.1) - 0.5) * 46;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The depth gauge: a ruler, a marker that follows the descent, and a number that is lost at the addendum. */
  _gauge(ctx, pro, t, col, acc, fade, reduced) {
    const x = 160;
    const y0 = 150;
    const y1 = 570;
    ctx.strokeStyle = rgba(acc, 0.5 * fade);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
    for (let i = 0; i <= 30; i++) {
      const y = y0 + ((y1 - y0) * i) / 30;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (i % 5 === 0 ? 20 : 9), y);
      ctx.stroke();
    }
    const f = Math.min(1, pro.depth / 556);
    const my = y0 + (y1 - y0) * f;
    ctx.fillStyle = rgba(col, 0.95 * fade);
    ctx.beginPath();
    ctx.moveTo(x - 4, my);
    ctx.lineTo(x - 24, my - 9);
    ctx.lineTo(x - 24, my + 9);
    ctx.closePath();
    ctx.fill();
    ctx.font = `600 22px ${MONO}`;
    ctx.letterSpacing = '2px';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let label = `${String(Math.round(pro.depth)).padStart(3, '0')} M`;
    if (pro.depthLost) {
      const jitter = !reduced && Math.floor(t * 9) % 5 === 0;
      label = jitter ? '5?6 M' : '--- M';
    }
    ctx.fillStyle = rgba(pro.depthLost ? [222, 84, 52] : col, 0.9 * fade);
    ctx.fillText(label, x - 36, y1 + 38);
    ctx.fillStyle = rgba(acc, 0.55 * fade);
    ctx.fillText('THE MARK', x - 36, y1 + 66);
  }

  /** Sideways slices of what has been drawn (the record slipping), a few per redraw, more as the glitch rises. */
  _tear(ctx, pro, t) {
    const n = 1 + Math.floor(pro.glitch * 4);
    const seed = Math.floor(t * 12);
    for (let i = 0; i < n; i++) {
      const y = 120 + hash(seed * 3.1 + i) * (H - 240);
      const h = 6 + hash(seed * 7.7 + i) * 26;
      const dx = (hash(seed * 1.3 + i * 5) - 0.5) * 120 * pro.glitch;
      ctx.drawImage(this.canvas, 0, y, W, h, dx, y, W, h);
    }
  }

  /** The static that follows the torn line: scattered grey blocks and scan bars, thinning out over the last third. */
  _static(ctx, pro, t) {
    const k = 1 - Math.max(0, (pro.cut - TIMING.cutStatic * 0.66) / (TIMING.cutStatic * 0.34));
    const n = Math.floor(420 * k);
    const seed = Math.floor(t * 30);
    for (let i = 0; i < n; i++) {
      const x = hash(seed * 1.7 + i * 2.1) * W;
      const y = hash(seed * 4.3 + i * 5.9) * H;
      const s = 2 + hash(i * 3.7 + seed) * 10;
      const v = 90 + hash(i + seed) * 150;
      ctx.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},${(0.12 + 0.5 * hash(i * 9.1 + seed)) * k})`;
      ctx.fillRect(x, y, s * 2.6, s * 0.8);
    }
    for (let i = 0; i < 5; i++) {
      const y = hash(seed * 2.2 + i) * H;
      ctx.fillStyle = `rgba(230,230,230,${0.1 * k})`;
      ctx.fillRect(0, y, W, 2 + hash(seed + i) * 5);
    }
  }

  dispose() {
    if (this._parent) this._parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this._wrapCache.clear();
  }
}
