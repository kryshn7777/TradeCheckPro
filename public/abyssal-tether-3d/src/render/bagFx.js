/* ABYSSAL TETHER 3D — bagFx.js
 * What the bag looks like: a 256x128 phosphor icon strip (the wrist display / desktop HUD copy) and the VR radial.
 *
 *   BagFx(game)              game: { renderer.scene, bag (Inventory3D), input, intent, settings, state, hidePlayer, xrActive }
 *   .update(dt, game)        once per frame (Game3D._updateViews)
 *   .makeIconTexture()       THREE.CanvasTexture 256x128 (mipmapped): four item icons (first aid kit, bandage, adrenaline
 *                            syringe, battery) with their counts, the selected slot framed, the lantern charge bar, the
 *                            apply progress bar and the active adrenaline timer. The same instance every call. Redrawn
 *                            at <= 20 Hz and only when something it shows changed, only while a run is on screen.
 *   .iconCanvas, .iconFrame  the canvas behind it and a counter that changes on every redraw (the DOM HUD copies it)
 *   .makeIconPlane(w, h)     a ready THREE.Mesh (MeshBasicMaterial, toneMapped false) showing it, for a wrist screen
 *   .radialMesh              the VR radial (a 0.34 m quad, one draw call, hidden unless the gesture is open), a child of
 *                            the scene: four icons around the hand, the one under the hand lit
 *   .dispose()
 *
 * The icons are drawn as SILHOUETTES (a cross-box kit, a roll with a tail, a syringe, a cell) in one phosphor colour:
 * readable without colour, the same shapes as the world props (pickupsView.js).
 */

import * as THREE from 'three';
import { CONFIG, U } from '../sim/config3d.js';
import { ITEM_COUNT, ITEM_NAMES, ITEM } from '../sim/inventory3d.js';
import { BAG_ZONE } from '../input/bagGesture.js';

const B = CONFIG.bag;
const W = 256;
const H = 128;
const RS = 256; // radial canvas size
const HZ = 20;
const RADIAL_M = 0.337; // quad width in metres: RS px * (BAG_ZONE.radial / RADIAL_R)
const RADIAL_R = 76; // px: icon distance from the radial centre
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const PHOS = '#8fffb4';
const PHOS_DIM = 'rgba(143,255,180,0.30)';
const AMBER = '#ffbd5e';
const RED = '#ff5a52';

/** Draws one item silhouette centred at (cx, cy) in a box of `s` px, stroke/fill colour `col`. */
export function drawItemIcon(ctx, kind, cx, cy, s, col, lw = 3) {
  ctx.save();
  ctx.translate(cx, cy);
  const k = s / 56;
  ctx.scale(k, k);
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineWidth = lw / k;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (kind === ITEM.FIRST_AID) {
    // case with a handle and a cross
    ctx.beginPath();
    ctx.roundRect(-24, -12, 48, 34, 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-9, -12);
    ctx.lineTo(-9, -19);
    ctx.lineTo(9, -19);
    ctx.lineTo(9, -12);
    ctx.stroke();
    ctx.fillRect(-3.5, -6, 7, 22);
    ctx.fillRect(-11, 1.5, 22, 7);
  } else if (kind === ITEM.BANDAGE) {
    // a roll seen end-on with a loose tail
    ctx.beginPath();
    ctx.arc(-8, -2, 15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-8, -2, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-8, 13);
    ctx.lineTo(22, 13);
    ctx.lineTo(22, 21);
    ctx.lineTo(-8, 21);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(14, 13);
    ctx.lineTo(14, 21);
    ctx.stroke();
  } else if (kind === ITEM.ADRENALINE) {
    // a syringe on the diagonal: needle down-left, plunger up-right
    ctx.rotate(-Math.PI / 4);
    ctx.beginPath();
    ctx.roundRect(-16, -6, 32, 12, 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(-30, 0); // needle
    ctx.moveTo(16, 0);
    ctx.lineTo(28, 0); // plunger rod
    ctx.stroke();
    ctx.fillRect(27, -8, 4, 16); // thumb plate
    ctx.fillRect(-16, -10, 3.5, 20); // finger flange
    ctx.fillRect(-6, -2, 14, 4); // liquid
  } else {
    // a cell with a terminal and a bolt
    ctx.beginPath();
    ctx.roundRect(-13, -16, 26, 40, 4);
    ctx.stroke();
    ctx.fillRect(-5, -23, 10, 6);
    ctx.beginPath();
    ctx.moveTo(3, -10);
    ctx.lineTo(-6, 3);
    ctx.lineTo(0, 3);
    ctx.lineTo(-3, 17);
    ctx.lineTo(7, 0);
    ctx.lineTo(1, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export class BagFx {
  /** @param {object} game Game3D */
  constructor(game) {
    this.game = game;
    this.scene = game.renderer.scene;

    this.iconCanvas = document.createElement('canvas');
    this.iconCanvas.width = W;
    this.iconCanvas.height = H;
    this._g = this.iconCanvas.getContext('2d', { alpha: false });
    this.iconTexture = new THREE.CanvasTexture(this.iconCanvas);
    this.iconTexture.name = 'bagIconTexture';
    this.iconTexture.colorSpace = THREE.SRGBColorSpace;
    this.iconTexture.generateMipmaps = true;
    this.iconTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.iconTexture.magFilter = THREE.LinearFilter;
    this.iconTexture.anisotropy = 4;
    this.iconFrame = 0;
    this._iconMat = null;

    this.radialCanvas = document.createElement('canvas');
    this.radialCanvas.width = RS;
    this.radialCanvas.height = RS;
    this._rg = this.radialCanvas.getContext('2d');
    this.radialTexture = new THREE.CanvasTexture(this.radialCanvas);
    this.radialTexture.name = 'bagRadialTexture';
    this.radialTexture.colorSpace = THREE.SRGBColorSpace;
    this.radialTexture.generateMipmaps = false;
    this.radialTexture.minFilter = THREE.LinearFilter;
    this.radialTexture.magFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({ map: this.radialTexture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    mat.name = 'bagRadial';
    this.radialMesh = new THREE.Mesh(new THREE.PlaneGeometry(RADIAL_M, RADIAL_M), mat);
    this.radialMesh.name = 'bagRadial';
    this.radialMesh.renderOrder = 955;
    this.radialMesh.frustumCulled = false;
    this.radialMesh.visible = false;
    this.scene.add(this.radialMesh);

    this._acc = 1;
    this._key = '';
    this._idle = false;
    this._t = 0;
    this._rKey = '';
    this._rAcc = 1;
    this._draw(true);
    this.iconTexture.needsUpdate = true;
    this._drawRadial(-1, null);
    this.radialTexture.needsUpdate = true;
  }

  makeIconTexture() {
    return this.iconTexture;
  }

  /** A mesh showing the icon strip for a wrist screen. Shares one material. */
  makeIconPlane(width = 0.06, height = 0.03) {
    if (!this._iconMat) {
      this._iconMat = new THREE.MeshBasicMaterial({ map: this.iconTexture, toneMapped: false, fog: false });
      this._iconMat.name = 'bagScreen';
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this._iconMat);
    m.name = 'bagScreen';
    m.frustumCulled = false;
    return m;
  }

  update(dt, game) {
    const g = game || this.game;
    const bag = g.bag;
    const st = g.state;
    const inRun = !!bag && (st === 'playing' || st === 'dead' || st === 'paused') && !g.hidePlayer;
    this._t += dt;
    this._acc += dt;
    if (this._acc >= 1 / HZ) {
      this._acc = 0;
      if (inRun) {
        this._idle = false;
        this._draw(false);
      } else if (!this._idle) {
        this._idle = true;
        this._draw(true);
      }
    }
    // ---- the VR radial ----
    const vr = g.intent && g.intent.bag ? g.intent.bag.vr : null;
    const mesh = this.radialMesh;
    if (vr && vr.open && inRun && g.input && typeof g.input.headPose === 'function') {
      const hp = g.input.headPose();
      mesh.position.set(vr.ax, vr.ay, vr.az);
      // a little toward the head so it floats in front of the hand, and lifted so the hand stays visible below it
      const dx = hp.x - vr.ax;
      const dy = hp.y - vr.ay;
      const dz = hp.z - vr.az;
      const l = Math.hypot(dx, dy, dz) || 1;
      mesh.position.x += (dx / l) * 0.04;
      mesh.position.y += (dy / l) * 0.04;
      mesh.position.z += (dz / l) * 0.04;
      mesh.lookAt(hp.x, hp.y, hp.z);
      mesh.visible = true;
      this._rAcc += dt;
      const key = `${vr.hover}|${bag.selected}|${bag.counts[0]}${bag.counts[1]}${bag.counts[2]}${bag.counts[3]}`;
      if (key !== this._rKey && this._rAcc >= 1 / 30) {
        this._rKey = key;
        this._rAcc = 0;
        this._drawRadial(vr.hover, bag);
        this.radialTexture.needsUpdate = true;
      }
    } else if (mesh.visible) {
      mesh.visible = false;
      this._rKey = '';
    }
  }

  // -----------------------------------------------------------------------------------------------
  // The icon strip
  // -----------------------------------------------------------------------------------------------

  _draw(idle) {
    const bag = this.game.bag;
    const ctx = this._g;
    const counts = bag ? bag.counts : null;
    const sel = bag ? bag.selected : 1;
    const ap = bag ? bag.applying : null;
    const ef = bag ? bag.adrenaline : null;
    const charge = bag ? bag.lanternCharge : 1;
    const blink = bag && charge <= B.lanternLow ? (Math.floor(this._t * 2) & 1) : 0;
    const prog = ap && ap.active ? Math.min(1, ap.t / ap.dur) : 0;
    const key = idle
      ? 'idle'
      : `${counts[0]}${counts[1]}${counts[2]}${counts[3]}|${sel}|${ap.active ? ap.kind + ':' + Math.round(prog * 64) : '-'}|${ef.active ? Math.ceil(ef.t * 10) : '-'}|${Math.round(charge * 200)}|${blink}|${this.game.state}`;
    if (key === this._key) return;
    this._key = key;

    ctx.fillStyle = '#020a06';
    ctx.fillRect(0, 0, W, H);
    // cells
    for (let i = 0; i < ITEM_COUNT; i++) {
      const x0 = 4 + i * 62;
      const n = idle ? 0 : counts[i];
      const on = n > 0;
      const isSel = !idle && i === sel;
      ctx.strokeStyle = isSel ? PHOS : 'rgba(143,255,180,0.16)';
      ctx.lineWidth = isSel ? 2.5 : 1;
      ctx.strokeRect(x0 + 0.5, 4.5, 58, 66);
      drawItemIcon(ctx, i, x0 + 29, 36, 46, on ? PHOS : PHOS_DIM, 3);
      ctx.fillStyle = on ? PHOS : PHOS_DIM;
      ctx.font = `700 12px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(i + 1), x0 + 5, 7);
      ctx.font = `700 22px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(n), x0 + 55, 67);
      // being applied: a bright fill sweeping up the cell
      if (ap && ap.active && ap.kind === i) {
        ctx.fillStyle = 'rgba(143,255,180,0.22)';
        const h = 66 * prog;
        ctx.fillRect(x0 + 1, 4 + 66 - h, 58, h);
      }
    }
    // lantern charge
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const lowCol = charge <= B.lanternLow ? (blink ? RED : AMBER) : PHOS;
    ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = lowCol;
    ctx.fillText(charge <= 0.001 ? 'LAMP DIM' : charge <= B.lanternLow ? 'LAMP LOW' : 'LAMP', 6, 87);
    ctx.strokeStyle = lowCol;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(78.5, 77.5, 128, 11);
    ctx.fillRect(80, 79, Math.max(0, 125 * U.clamp(charge, 0, 1)), 8);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(charge * 100)}%`, W - 6, 87);
    // status: applying / adrenaline
    ctx.textAlign = 'left';
    let y = 106;
    if (ap && ap.active) {
      ctx.fillStyle = AMBER;
      ctx.font = `700 12px ${FONT}`;
      ctx.fillText(`APPLYING ${ITEM_NAMES[ap.kind].toUpperCase()}`, 6, y);
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.max(0, ap.dur - ap.t).toFixed(1)}s`, W - 6, y);
      ctx.strokeStyle = AMBER;
      ctx.strokeRect(6.5, y + 4.5, W - 13, 7);
      ctx.fillRect(8, y + 6, (W - 16) * prog, 4);
      y = 0;
    }
    if (ef && ef.active) {
      const yy = y ? 106 : 124;
      ctx.textAlign = 'left';
      ctx.fillStyle = PHOS;
      ctx.font = `700 12px ${FONT}`;
      ctx.fillText(`SPEED x${B.adrenalineMul}`, 6, yy);
      ctx.textAlign = 'right';
      ctx.fillText(`${ef.t.toFixed(1)}s`, W - 6, yy);
      ctx.strokeStyle = PHOS;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(78.5, yy - 8.5, 100, 7);
      ctx.fillRect(80, yy - 7, 97 * U.clamp(ef.t / ef.dur, 0, 1), 4);
    } else if (!(ap && ap.active) && !idle) {
      ctx.fillStyle = 'rgba(143,255,180,0.38)';
      ctx.font = `600 11px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(bag && bag.total > 0 ? `${ITEM_NAMES[sel].toUpperCase()}` : 'BAG EMPTY', 6, 112);
    }
    // CRT scanlines + a dim frame, as on the ECG
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let yy = 1; yy < H; yy += 3) ctx.fillRect(0, yy, W, 1);
    ctx.strokeStyle = 'rgba(143,255,180,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    this.iconFrame++;
    this.iconTexture.needsUpdate = true;
  }

  // -----------------------------------------------------------------------------------------------
  // The radial
  // -----------------------------------------------------------------------------------------------

  _drawRadial(hover, bag) {
    const ctx = this._rg;
    ctx.clearRect(0, 0, RS, RS);
    const c = RS / 2;
    ctx.fillStyle = 'rgba(2,10,6,0.62)';
    ctx.beginPath();
    ctx.arc(c, c, 118, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(143,255,180,0.35)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // slots: left 0, up 1, right 2, down 3
    const pos = [
      [-1, 0],
      [0, -1],
      [1, 0],
      [0, 1],
    ];
    for (let i = 0; i < ITEM_COUNT; i++) {
      const x = c + pos[i][0] * RADIAL_R;
      const y = c + pos[i][1] * RADIAL_R;
      const n = bag ? bag.counts[i] : 0;
      const hot = i === hover;
      if (hot) {
        ctx.fillStyle = 'rgba(143,255,180,0.30)';
        ctx.beginPath();
        ctx.arc(x, y, 38, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = PHOS;
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      drawItemIcon(ctx, i, x, y - 4, hot ? 58 : 50, n > 0 ? PHOS : PHOS_DIM, 3.5);
      ctx.fillStyle = n > 0 ? PHOS : PHOS_DIM;
      ctx.font = `700 22px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(n), x + (pos[i][0] === 0 ? 0 : pos[i][0] * 0), y + 34);
    }
    ctx.fillStyle = PHOS;
    ctx.font = `700 15px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(hover >= 0 ? ITEM_NAMES[hover].toUpperCase() : 'POINT + RELEASE', c, c);
    ctx.textBaseline = 'alphabetic';
  }

  dispose() {
    if (this.radialMesh.parent) this.radialMesh.parent.remove(this.radialMesh);
    this.radialMesh.geometry.dispose();
    this.radialMesh.material.dispose();
    this.radialTexture.dispose();
    this.iconTexture.dispose();
    if (this._iconMat) this._iconMat.dispose();
  }
}

export { RADIAL_M, BAG_ZONE };
