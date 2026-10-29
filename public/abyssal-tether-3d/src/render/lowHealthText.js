/* ABYSSAL TETHER 3D — lowHealthText.js
 * While the player's health is low a short, scary line surfaces in front of the eyes, drips, flickers and fades, then another follows
 * a few seconds later ("IT CAN SMELL YOU", "YOU ARE BLEEDING"): the cue that the Mason has been told and is coming (the hunt gate,
 * sim/creature3d.js setHuntGate). One head-locked quad (a child of the camera, so it works the same on the desktop and in the headset),
 * one canvas texture redrawn per line (not per frame), no depth test; +1 draw call only while a line is showing.
 *
 * THE CHALK (sim/dresser3d.js): while the Dresser hunts you (you are WHOLE, ctx.chalk) the lines come in white chalk instead, rough
 * and dusty, steady (no drips, no heartbeat): "YOU LOOK WHOLE", "GOOD STONE"; while it measures you (ctx.measuring) "HOLD STILL. I
 * AM MEASURING.", "A CLEAN CUT". Never both: low health is blood only (a chalk line showing when you are hurt fades out at once).
 *
 * Pure view code: update(dt, ctx) with ctx { low, dead, playing, hp (0..1), bpm, reduced, chalk, measuring }. Deterministic (a
 * seeded sequence, no Math.random), allocation-free per frame. `reduced` (settings.reducedEffects): no flicker, no shake, a plain fade.
 */
import * as THREE from 'three';

const W = 1024;
const H = 256;
const DIST = 1.15; // m in front of the eyes
const WIDTH = 1.45; // m: the quad is about 64 degrees wide at that distance
const ORDER = 985; // after the hands (960 / 961), before the comfort vignette (990) and the fades
const FADE_IN = 0.55;
const FADE_OUT = 1.1;
const HOLD = 2.7;
const GAP_MIN = 2.2;
const GAP_MAX = 4.6;

/** Lines for low health (hp <= lowEnter) and for the last sliver of it. All caps: they are drawn as a scrawl. */
export const LINES_LOW = [
  'IT CAN SMELL YOU',
  'YOU ARE BLEEDING',
  'THE WALL IS LISTENING',
  'IT KNOWS WHERE YOU ARE',
  'KEEP YOUR HEART QUIET',
  'IT IS COMING',
  'THEY BLED HERE TOO',
  'DO NOT LOOK UP',
];
export const LINES_CRITICAL = ['YOU WILL NOT REACH THE BOTTOM', 'IT IS ALMOST HERE', 'LET GO', 'NOBODY IS COMING FOR YOU', 'JOIN THE WALL'];
/** Chalk lines: the Dresser hunting you (you are whole), and while it measures you. */
export const LINES_CHALK = ['YOU LOOK WHOLE', 'GOOD STONE', 'STAND STRAIGHT', 'IT WAS SOMEONE', 'WHOLE BODIES MAKE GOOD BLOCKS', 'SIX HANDS TALL'];
export const LINES_MEASURE = ['HOLD STILL. I AM MEASURING.', 'A CLEAN CUT', 'MEASURE TWICE. CUT ONCE.', 'DO NOT BLEED ON THE STONE'];
const CRITICAL_HP = 0.16;

function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class LowHealthText {
  /** @param {THREE.Object3D} camera the head camera (the quad is its child) */
  constructor(camera) {
    this.camera = camera;
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    this._g = this.canvas ? this.canvas.getContext('2d') : null;
    this.texture = this.canvas ? new THREE.CanvasTexture(this.canvas) : null;
    if (this.texture) this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, WIDTH * (H / W)), this.material);
    this.mesh.name = 'lowHealthText';
    this.mesh.renderOrder = ORDER;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.position.set(0, -0.12, -DIST);
    if (camera && typeof camera.add === 'function') camera.add(this.mesh);
    this._seed = 1;
    this._n = 0; // lines shown so far
    this._last = -1;
    this.line = '';
    this.mode = 'blood'; // 'blood' (low health) | 'chalk' (the Dresser): the current line's look
    this.reset();
  }

  /** A fresh run / respawn: nothing showing, the first low health gets its line at once. */
  reset() {
    this._t = -1; // seconds into the current line (-1: none)
    this._dur = 0;
    this._gap = 0;
    this._wasLow = false;
    this._wasChalk = false;
    this._wasMeasure = false;
    this._clock = 0;
    this.mesh.visible = false;
    this.material.opacity = 0;
  }

  _pick(critical, set0) {
    const set = set0 || (critical ? LINES_CRITICAL : LINES_LOW);
    const base = set === LINES_CRITICAL ? 100 : set === LINES_CHALK ? 200 : set === LINES_MEASURE ? 300 : 0;
    this._seed = (Math.imul(this._seed, 1664525) + 1013904223) >>> 0;
    let i = this._seed % set.length;
    if (base + i === this._last) i = (i + 1) % set.length; // never the same line twice in a row
    this._last = base + i;
    return set[i];
  }

  /** Draws the line in rough white chalk: a dry, broken stroke, a little dust under it, no drips. */
  _drawChalk(text, seed) {
    const g = this._g;
    if (!g) return;
    g.clearRect(0, 0, W, H);
    const n = text.length;
    let size = 100;
    const font = (sz) => `bold ${sz}px "Times New Roman", Georgia, serif`;
    g.font = font(size);
    let total = 0;
    for (let i = 0; i < n; i++) total += g.measureText(text[i]).width + 5;
    if (total > W - 80) {
      size = Math.floor((size * (W - 80)) / total);
      g.font = font(size);
      total = 0;
      for (let i = 0; i < n; i++) total += g.measureText(text[i]).width + 5;
    }
    const base = H * 0.5 + size * 0.3;
    g.textBaseline = 'alphabetic';
    // dust first (under the letters): soft smudges where the hand dragged, specks fallen from the stroke
    for (let k = 0; k < 3; k++) {
      const x = (W - total) / 2 + hash1(seed * 1.3 + k * 4.7) * total;
      const grd = g.createRadialGradient(x, base - size * 0.2, 2, x, base - size * 0.2, size * (0.4 + 0.5 * hash1(k + seed)));
      grd.addColorStop(0, 'rgba(220, 216, 204, 0.035)');
      grd.addColorStop(1, 'rgba(220, 216, 204, 0)');
      g.fillStyle = grd;
      g.fillRect(x - size * 1.6, base - size * 1.4, size * 3.2, size * 2);
    }
    for (let k = 0; k < 220; k++) {
      const x = (W - total) / 2 + hash1(seed * 3.7 + k * 1.31) * total;
      const y = base + 4 + hash1(seed * 5.1 + k * 2.17) * size * 0.55;
      g.fillStyle = `rgba(226, 222, 210, ${(0.08 + 0.22 * hash1(k * 0.7 + seed)).toFixed(3)})`;
      g.fillRect(x, y, 1 + hash1(k * 3.3) * 2, 1 + hash1(k * 4.1) * 2);
    }
    // the letters: several dry passes, each a little off, then the stone's grain breaks them
    let px = (W - total) / 2;
    for (let i = 0; i < n; i++) {
      const ch = text[i];
      const w = g.measureText(ch).width;
      if (ch !== ' ') {
        const r = hash1(seed * 31 + i * 7.13);
        const r2 = hash1(seed * 17 + i * 3.71);
        for (let pass = 0; pass < 4; pass++) {
          g.save();
          g.translate(px + w / 2 + (hash1(i * 9.1 + pass * 3.3) - 0.5) * 3, base + (r2 - 0.5) * size * 0.08 + (hash1(i * 5.7 + pass * 1.9) - 0.5) * 3);
          g.rotate((r - 0.5) * 0.16);
          if (pass < 2) {
            g.lineWidth = Math.max(2, size * 0.035);
            g.strokeStyle = `rgba(232, 229, 219, ${(0.22 + 0.1 * pass).toFixed(2)})`;
            g.strokeText(ch, -w / 2, 0);
          } else {
            g.fillStyle = `rgba(238, 235, 225, ${(0.38 + 0.2 * (pass - 2)).toFixed(2)})`;
            g.fillText(ch, -w / 2, 0);
          }
          g.restore();
        }
      }
      px += w + 5;
    }
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 3400; k++) {
      const x = hash1(seed * 1.7 + k * 0.913) * W;
      const y = hash1(seed * 2.3 + k * 0.577) * H;
      g.fillStyle = `rgba(0, 0, 0, ${(0.35 + 0.6 * hash1(k * 1.9)).toFixed(2)})`;
      g.fillRect(x, y, 1 + hash1(k * 2.9) * 2.5, 1 + hash1(k * 3.7) * 1.5);
    }
    g.globalCompositeOperation = 'source-over';
    if (this.texture) this.texture.needsUpdate = true;
  }

  /** Draws the line as a scrawl: per-letter wobble, a red glow, a dark outline, and drips. */
  _draw(text, seed) {
    const g = this._g;
    if (!g) return;
    g.clearRect(0, 0, W, H);
    const n = text.length;
    let size = 118;
    g.font = `bold ${size}px "Times New Roman", Georgia, serif`;
    let total = 0;
    for (let i = 0; i < n; i++) total += g.measureText(text[i]).width + 7;
    if (total > W - 90) {
      size = Math.floor((size * (W - 90)) / total);
      g.font = `bold ${size}px "Times New Roman", Georgia, serif`;
      total = 0;
      for (let i = 0; i < n; i++) total += g.measureText(text[i]).width + 7;
    }
    const base = H * 0.5 + size * 0.28;
    let x = (W - total) / 2;
    g.textBaseline = 'alphabetic';
    g.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      let px = x;
      for (let i = 0; i < n; i++) {
        const ch = text[i];
        const w = g.measureText(ch).width;
        const r = hash1(seed * 31 + i * 7.13);
        const r2 = hash1(seed * 17 + i * 3.71);
        if (ch !== ' ') {
          g.save();
          g.translate(px + w / 2, base + (r2 - 0.5) * size * 0.14);
          g.rotate((r - 0.5) * 0.22);
          if (pass === 0) {
            g.shadowColor = 'rgba(255, 20, 20, 0.95)';
            g.shadowBlur = 30;
            g.fillStyle = 'rgba(150, 8, 12, 0.9)';
            g.fillText(ch, -w / 2, 0);
          } else {
            g.shadowBlur = 0;
            g.lineWidth = Math.max(3, size * 0.045);
            g.strokeStyle = 'rgba(26, 2, 4, 0.95)';
            g.strokeText(ch, -w / 2, 0);
            g.fillStyle = r > 0.5 ? '#b3111a' : '#8f0c14';
            g.fillText(ch, -w / 2, 0);
            // a wet highlight on the upper edge of the stroke
            g.fillStyle = 'rgba(255, 120, 120, 0.16)';
            g.fillText(ch, -w / 2 - 1.5, -2);
          }
          g.restore();
          if (pass === 1 && hash1(seed * 13 + i * 5.3) > 0.58) {
            const len = 22 + hash1(seed * 7 + i * 9.1) * 62;
            const dx = px + w * (0.25 + 0.5 * hash1(seed * 3 + i * 2.2));
            const top = base - size * 0.05;
            const grad = g.createLinearGradient(0, top, 0, top + len);
            grad.addColorStop(0, 'rgba(140, 8, 12, 0.95)');
            grad.addColorStop(1, 'rgba(90, 4, 8, 0.75)');
            g.fillStyle = grad;
            g.fillRect(dx - 2.5, top, 5, len);
            g.beginPath();
            g.arc(dx, top + len, 4.6, 0, Math.PI * 2);
            g.fill();
          }
        }
        px += w + 7;
      }
    }
    if (this.texture) this.texture.needsUpdate = true;
  }

  /**
   * @param {number} dt seconds (frame)
   * @param {{low:boolean, dead:boolean, playing:boolean, hp:number, bpm:number, reduced:boolean}} c
   */
  update(dt, c) {
    const live = !!c && !c.dead && c.playing;
    const low = live && !!c.low;
    const chalk = live && !low && !!c.chalk; // never both: low health is blood only
    const measuring = chalk && !!c.measuring;
    const on = low || chalk;
    const want = low ? 'blood' : 'chalk';
    this._clock += dt;
    if (low && !this._wasLow) this._gap = 0.6; // the first line comes a moment after the hit
    if (chalk && !this._wasChalk) this._gap = 1.2; // it has seen you
    if (measuring && !this._wasMeasure && this._t < 0) this._gap = Math.min(this._gap, 0.35); // it has started to measure you
    this._wasLow = low;
    this._wasChalk = chalk;
    this._wasMeasure = measuring;
    if (this._t < 0) {
      if (!on) return;
      this._gap -= dt;
      if (this._gap > 0) return;
      this.mode = want;
      this._n++;
      if (want === 'blood') {
        this.line = this._pick(c.hp <= CRITICAL_HP);
        this._draw(this.line, this._n);
      } else {
        this.line = this._pick(false, measuring ? LINES_MEASURE : LINES_CHALK);
        this._drawChalk(this.line, this._n);
      }
      this._t = 0;
      this._dur = FADE_IN + HOLD + FADE_OUT;
      this.mesh.visible = true;
    }
    // health is back (or the line's kind no longer fits: a chalk line when you are hurt): let the line go now
    if ((!on || this.mode !== want) && this._t < this._dur - FADE_OUT) this._t = this._dur - (this.mode === 'blood' ? FADE_OUT : FADE_OUT * 0.4);
    this._t += dt;
    if (this._t >= this._dur) {
      this._t = -1;
      this._gap = GAP_MIN + (GAP_MAX - GAP_MIN) * hash1(this._n * 5.1);
      this.mesh.visible = false;
      this.material.opacity = 0;
      return;
    }
    const t = this._t;
    let a = Math.min(1, t / FADE_IN) * Math.min(1, (this._dur - t) / FADE_OUT);
    a = a * a * (3 - 2 * a);
    const m = this.mesh;
    if (c.reduced || this.mode === 'chalk') {
      // chalk is steady: no flicker, no tremor, no heartbeat (and reducedEffects: a plain fade for the blood too)
      m.scale.setScalar(1);
      m.position.set(0, -0.12, -DIST);
      this.material.opacity = a * 0.92;
      return;
    }
    // flicker: brief dropouts, more of them the lower the health; a tremor and a slow breath
    const k = 1 - Math.min(1, Math.max(0, c.hp / 0.35));
    const f = hash1(Math.floor(this._clock * 17) * 1.37);
    const drop = f > 0.86 - 0.12 * k ? 0.25 : 1;
    this.material.opacity = a * 0.95 * drop;
    const sh = 0.0025 + 0.006 * k;
    const beat = 1 + 0.025 * Math.max(0, Math.sin(this._clock * ((c.bpm || 80) / 60) * Math.PI * 2));
    m.position.set((hash1(this._clock * 31.7) - 0.5) * sh, -0.12 + Math.sin(this._clock * 0.9) * 0.008 + (hash1(this._clock * 43.1) - 0.5) * sh, -DIST);
    m.scale.setScalar(beat);
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    if (this.texture) this.texture.dispose();
  }
}
