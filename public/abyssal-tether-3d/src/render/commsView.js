/* ABYSSAL TETHER 3D — commsView.js (EXPEDITION: the radio subtitles and the CONTINUITY restore overlay; plans/COMMS.md)
 * ONE head-locked quad (a child of the camera, the render/lowHealthText.js pattern: the same on the desktop and in the headset),
 * two canvas textures, one material: +1 draw call only while something shows, nothing at all otherwise.
 *   subtitle mode   the transmission on air (sim/comms3d.js CommsDirector.current): the speaker's shape + name in its colour
 *                   (never colour alone), the signal bars, the line in at most two rows, lower centre, ~1.4 deg letters at
 *                   1.4 m; it moves lower while a VR hint card is up. Glitches (static speckle and a small tear, a dimmed
 *                   dropout, a scrambled name for the voice that is not quite the speaker) follow the line's own glitch
 *                   events (<= 3 Hz, the text always stays readable); Settings › Access › Signal glitches OFF or Reduced
 *                   effects: none of that, a plain panel.
 *   restore mode    while dead (game.restore, planRestore): CONTINUITY · vitals lost at N m · the cause · RESTORE IN PROGRESS
 *                   · the sync bar · RESTORE COMPLETE · RESTORE N · the last line; a calm fade in and out, never a strobe
 *                   (the redraws are capped at 10 Hz and only change text / the bar).
 * The canvas is redrawn per line / per change, never per frame; update() allocates nothing (strings only when it redraws).
 * Pure view code: update(dt, game) reads game.state, comms, restore, deathT, settings, xrActive, ui._hint, diff.
 */
import * as THREE from 'three';
import { glitchOn, syncAt, SPEAKERS } from '../sim/comms3d.js';

const SUB = { cw: 1024, ch: 256, w: 0.95, dist: 1.4, y: -0.37, yLow: -0.58 };
const RES = { cw: 1024, ch: 512, w: 1.15, dist: 1.6, y: -0.02 };
const ORDER = 986; // after the low-health line (985), before the comfort vignette (990); over the death fade (900)
const F_UI = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif";
const F_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
const COL = { text: '#f4efe4', dim: '#c9c4b8', faint: '#8b9396', cyan: '#8fd3c8', cyanDim: '#5f8c86', rust: '#c98466', amber: '#e0a050', warm: '#f2e6c9', red: '#d8705e' };
const FADE_IN = 0.2;
const FADE_OUT = 0.35;
const RES_REDRAW = 0.1; // s between two restore redraws (10 Hz cap)

function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** The speaker's shape (diamond / circle / triangle / square / cross) at (cx, cy). */
function shape(g, kind, cx, cy, r, color) {
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.beginPath();
  if (kind === 'diamond') {
    g.moveTo(cx, cy - r - 2);
    g.lineTo(cx + r + 2, cy);
    g.lineTo(cx, cy + r + 2);
    g.lineTo(cx - r - 2, cy);
    g.closePath();
    g.fill();
  } else if (kind === 'circle') {
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'triangle') {
    g.moveTo(cx, cy - r - 2);
    g.lineTo(cx + r + 2, cy + r);
    g.lineTo(cx - r - 2, cy + r);
    g.closePath();
    g.fill();
  } else if (kind === 'square') {
    g.rect(cx - r, cy - r, r * 2, r * 2);
    g.fill();
  } else {
    g.moveTo(cx - r, cy - r);
    g.lineTo(cx + r, cy + r);
    g.moveTo(cx + r, cy - r);
    g.lineTo(cx - r, cy + r);
    g.stroke();
  }
}

/** Five signal bars (right-aligned at x), or NO SIGNAL. */
function bars(g, x, base, n) {
  if (n <= 0) {
    g.font = `700 20px ${F_MONO}`;
    g.textAlign = 'right';
    g.fillStyle = COL.red;
    g.fillText('NO SIGNAL', x, base);
    g.textAlign = 'left';
    return;
  }
  for (let i = 0; i < 5; i++) {
    const h = 6 + i * 4.5;
    g.fillStyle = i < n ? COL.cyan : 'rgba(255,255,255,0.16)';
    g.fillRect(x - (5 - i) * 11, base - h, 7, h);
  }
}

export class CommsView {
  /** @param {THREE.Object3D} camera the head camera (the quad is its child) */
  constructor(camera) {
    this.camera = camera;
    const doc = typeof document !== 'undefined' ? document : null;
    const mk = (cw, ch) => {
      if (!doc) return { canvas: null, g: null, tex: null, cw, ch };
      const canvas = doc.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false; // ~1 texel per pixel at its distance: no mips, a cheaper upload per line
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      return { canvas, g: canvas.getContext('2d'), tex, cw, ch };
    };
    this.sub = mk(SUB.cw, SUB.ch);
    this.res = mk(RES.cw, RES.ch);
    // the same parameters as the UI panels' material (ui3d.js mkMat): the program is shared, nothing compiles on the first line
    this.material = new THREE.MeshBasicMaterial({
      map: this.sub.tex,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.name = 'commsPanel';
    this.mesh.renderOrder = ORDER;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    if (camera && typeof camera.add === 'function') camera.add(this.mesh);
    this.mode = null; // null | 'sub' | 'restore'
    this.alpha = 0;
    this._clock = 0;
    this._subKey = -1;
    this._resKey = -1;
    this._resStage = -1;
    this._drawAt = -10;
    this._bars0 = 5;
    this._n = -1;
    this.draws = 0; // canvas redraws (tests: per line / per change, never per frame)
    this._layout('sub', 1, false);
  }

  _layout(mode, scale, low) {
    const m = this.mesh;
    if (mode === 'restore') {
      m.scale.set(RES.w * scale, ((RES.w * RES.ch) / RES.cw) * scale, 1);
      m.position.set(0, RES.y, -RES.dist);
    } else {
      m.scale.set(SUB.w * scale, ((SUB.w * SUB.ch) / SUB.cw) * scale, 1);
      m.position.set(0, low ? SUB.yLow : SUB.y, -SUB.dist);
    }
  }

  _setMode(mode) {
    this.mode = mode;
    const map = mode === 'restore' ? this.res.tex : this.sub.tex;
    if (map && this.material.map !== map) this.material.map = map; // both non-null: no program change
    this._subKey = -1;
    this._resKey = -1;
    this._resStage = -1;
  }

  /**
   * @param {number} dt seconds
   * @param {object} game Game3D (state, comms, restore, deathT, settings, xrActive, ui)
   */
  update(dt, game) {
    const g = game || {};
    const d = dt > 0 ? (dt > 0.1 ? 0.1 : dt) : 0;
    this._clock += d;
    const s = g.settings || {};
    const st = g.state;
    const cm = g.comms || null;
    const R = g.restore || null;
    const fx = s.signalGlitches !== false && !s.reducedEffects;
    const scale = clamp(typeof s.textScale === 'number' && isFinite(s.textScale) ? s.textScale : 1, 0.9, 1.5);
    let want = null;
    if (R && R.active && st === 'dead') want = 'restore'; // (Abyss: the death panel takes over when it ends: R.active false)
    else if (cm && cm.current && st === 'playing') want = 'sub';

    if (want !== this.mode) {
      // the old content fades out first (a calm switch, never a cut to a new picture)
      this.alpha = Math.max(0, this.alpha - d / 0.22);
      this.material.opacity = this.alpha;
      if (this.alpha > 0.003 && this.mode) return;
      this.mesh.visible = false;
      this._setMode(want);
      if (!want) return;
    }
    if (!want) {
      this.mesh.visible = false;
      return;
    }
    if (want === 'restore') {
      const t = typeof g.deathT === 'number' ? g.deathT : 0;
      const a = clamp((t - 0.15) / 0.6, 0, 1);
      this.alpha = a * a * (3 - 2 * a) * 0.97;
      this._layout('restore', scale, false);
      this._restoreDraw(R, t, !!g.xrActive);
    } else {
      const tx = cm.current;
      if (tx.n !== this._n) {
        this._n = tx.n;
        this._bars0 = cm.bars;
      }
      const fi = clamp(tx.t / FADE_IN, 0, 1);
      const fo = clamp((tx.dur - tx.t) / FADE_OUT, 0, 1);
      this.alpha = Math.min(fi, fo) * 0.98;
      const hintUp = !!(g.xrActive && g.ui && g.ui._hint && g.ui._hint.on);
      this._layout('sub', scale, hintUp);
      const so = fx && glitchOn(tx, 'static');
      const dr = glitchOn(tx, 'dropout');
      const lb = fx && glitchOn(tx, 'label');
      const key = tx.n * 16 + (so ? 1 : 0) + (dr ? 2 : 0) + (lb ? 4 : 0) + (fx ? 8 : 0);
      if (key !== this._subKey) {
        this._subKey = key;
        this._subDraw(tx, so, dr && fx, lb, dr ? 0 : this._bars0);
      }
    }
    this.material.opacity = this.alpha;
    this.mesh.visible = this.alpha > 0.003;
  }

  // ---- the subtitle -------------------------------------------------------------------------------------------------------
  _subDraw(tx, staticOn, dropOn, labelOn, nBars) {
    this.draws++;
    const c = this.sub;
    const g = c.g;
    if (!g) return;
    const W = c.cw;
    const H = c.ch;
    g.clearRect(0, 0, W, H);
    const italic = tx.kind === 'offmic' || tx.kind === 'echo';
    let size = 40;
    let font = `${italic ? 'italic ' : ''}500 ${size}px ${F_UI}`;
    g.font = font;
    let rows = this._wrap(g, tx.text, 900);
    if (rows.length > 2) {
      size = 34;
      font = `${italic ? 'italic ' : ''}500 ${size}px ${F_UI}`;
      g.font = font;
      rows = this._wrap(g, tx.text, 900);
    }
    let tw = 0;
    for (const r of rows) tw = Math.max(tw, g.measureText(r).width);
    const sp = SPEAKERS[tx.speaker] || SPEAKERS.UPLINK;
    let label = tx.label;
    let lcol = tx.color;
    let lshape = tx.shape;
    if (labelOn) {
      // the voice that is not quite the speaker: the name will not hold still
      label = label.length > 3 ? label.slice(0, 2) + '?' + label.slice(3) : '?';
      lcol = COL.red;
      lshape = 'cross';
    }
    const suffix = tx.kind === 'offmic' ? '  OFF MIC' : '';
    g.font = `650 26px ${F_UI}`;
    const lw = g.measureText(label + suffix).width;
    const boxW = Math.min(W - 16, Math.max(tw, lw + 110 + 70) + 72);
    const boxH = 58 + rows.length * (size + 12) + 14;
    const x0 = Math.round((W - boxW) / 2);
    const y0 = Math.round((H - boxH) / 2);
    rr(g, x0, y0, boxW, boxH, 14);
    g.fillStyle = 'rgba(4,7,9,0.82)';
    g.fill();
    g.fillStyle = lcol || sp.color;
    g.fillRect(x0, y0 + 10, 6, boxH - 20);
    // the name row: shape, name (colour + shape), the signal bars
    shape(g, lshape, x0 + 38, y0 + 33, 10, lcol || sp.color);
    g.font = `650 26px ${F_UI}`;
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillStyle = lcol || sp.color;
    g.fillText(label, x0 + 60, y0 + 43);
    if (suffix) {
      g.fillStyle = COL.faint;
      g.fillText(suffix, x0 + 60 + g.measureText(label).width, y0 + 43);
    }
    bars(g, x0 + boxW - 24, y0 + 44, nBars);
    // the line
    g.font = font;
    g.globalAlpha = dropOn ? 0.55 : 1;
    g.fillStyle = italic ? COL.dim : COL.text;
    const tear = staticOn ? (tx.n % 2 ? 7 : -7) : 0;
    const tearRow = tx.n % rows.length;
    for (let i = 0; i < rows.length; i++) g.fillText(rows[i], x0 + 36 + (i === tearRow ? tear : 0), y0 + 58 + size + i * (size + 12) - 6);
    g.globalAlpha = 1;
    if (staticOn) {
      // static: fine speckle over the panel (deterministic per line), the text stays on top and readable
      for (let k = 0; k < 520; k++) {
        const r1 = hash1(tx.n * 3.17 + k * 1.913);
        const r2 = hash1(tx.n * 5.31 + k * 0.717);
        g.fillStyle = r1 > 0.5 ? 'rgba(220,235,232,0.22)' : 'rgba(0,0,0,0.35)';
        g.fillRect(x0 + r1 * boxW, y0 + r2 * boxH, 2 + hash1(k * 2.3) * 3, 1 + hash1(k * 4.1) * 2);
      }
    }
    if (c.tex) c.tex.needsUpdate = true;
  }

  _wrap(g, text, maxW) {
    const words = String(text).split(' ');
    const out = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (cur && g.measureText(next).width > maxW) {
        out.push(cur);
        cur = w;
      } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  }

  // ---- the restore ----------------------------------------------------------------------------------------------------------
  _restoreDraw(R, t, xr) {
    const T = R.timing;
    const stage = t >= T.last ? 5 : t >= T.complete ? 4 : t >= T.syncStart ? 3 : t >= T.progress ? 2 : t >= T.cause ? 1 : 0;
    const pct = stage >= 3 ? syncAt(R, t) : 0;
    const prompt = t >= 0.6 ? 1 : 0;
    const key = stage * 1000 + pct * 2 + prompt;
    if (key === this._resKey) return;
    if (stage === this._resStage && this._clock - this._drawAt < RES_REDRAW) return;
    this._resKey = key;
    this._resStage = stage;
    this._drawAt = this._clock;
    this.draws++;
    const c = this.res;
    const g = c.g;
    if (!g) return;
    const W = c.cw;
    const H = c.ch;
    g.clearRect(0, 0, W, H);
    rr(g, 24, 24, W - 48, H - 48, 18);
    g.fillStyle = 'rgba(2,7,8,0.8)';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(143,211,200,0.3)';
    g.stroke();
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.font = `700 30px ${F_MONO}`;
    g.fillStyle = COL.cyan;
    g.fillText(R.header, 64, 82);
    g.textAlign = 'right';
    g.font = `500 20px ${F_MONO}`;
    g.fillStyle = COL.cyanDim;
    g.fillText('PERENNIAL  DEEP RECOVERY', W - 64, 80);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(143,211,200,0.25)';
    g.fillRect(64, 100, W - 128, 2);
    if (stage >= 1) {
      g.font = `600 32px ${F_MONO}`;
      g.fillStyle = COL.text;
      g.fillText(R.vitals, 64, 152);
      g.font = `500 26px ${F_MONO}`;
      g.fillStyle = COL.rust;
      g.fillText(R.causeLine, 64, 192);
    }
    if (stage >= 2) {
      g.font = `600 28px ${F_MONO}`;
      g.fillStyle = COL.cyan;
      g.fillText(R.progress, 64, 252);
    }
    if (stage >= 3) {
      const bx = 64;
      const bw = W - 128 - 190;
      g.strokeStyle = 'rgba(143,211,200,0.6)';
      g.lineWidth = 2;
      g.strokeRect(bx + 0.5, 272.5, bw, 18);
      g.fillStyle = COL.cyan;
      g.fillRect(bx + 3, 275, Math.max(0, (bw - 5) * (pct / 100)), 13);
      g.textAlign = 'right';
      g.font = `600 28px ${F_MONO}`;
      g.fillStyle = COL.text;
      g.fillText(`SYNC ${pct}%`, W - 64, 292);
      g.textAlign = 'left';
    }
    if (stage >= 4) {
      g.font = `700 36px ${F_MONO}`;
      g.fillStyle = COL.warm;
      g.fillText(R.complete, 64, 360);
      g.textAlign = 'right';
      g.font = `700 32px ${F_MONO}`;
      g.fillStyle = COL.amber;
      g.fillText(R.countLine, W - 64, 360);
      g.textAlign = 'left';
    }
    if (stage >= 5) {
      g.font = `italic 400 30px ${F_UI}`;
      g.fillStyle = '#b9c4c2';
      g.fillText(R.last, 64, 410);
    }
    if (prompt) {
      g.font = `500 22px ${F_UI}`;
      g.fillStyle = '#6f7f7d';
      const p = R.canRespawn ? (xr ? 'A or trigger: skip   ·   hold X: restart descent' : 'Click or Enter: skip   ·   R: restart descent') : xr ? 'A or trigger: begin again' : 'Click or Enter: begin again';
      g.fillText(p, 64, 462);
    }
    if (c.tex) c.tex.needsUpdate = true;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    if (this.sub.tex) this.sub.tex.dispose();
    if (this.res.tex) this.res.tex.dispose();
  }
}
