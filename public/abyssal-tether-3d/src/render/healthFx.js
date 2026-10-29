/* ABYSSAL TETHER 3D — healthFx.js
 * What being hurt looks like: a head-locked red screen-edge vignette and the ECG screen.
 *
 *   HealthFx(game)            game: { renderer.camera, settings, bus, state, health, xrActive, hidePlayer }
 *   .update(dt, game)         once per frame (Game3D._updateViews)
 *   .ecgTexture               THREE.CanvasTexture 256x128 (mipmapped), a green / amber / red phosphor ECG:
 *                             scrolling PQRST trace at the heart rate, bpm numeral, hp bar; red + jittery when low;
 *                             a flatline once dead. Redrawn at <= 30 Hz, only while a run is on screen.
 *   .ecgCanvas, .ecgFrame     the canvas behind it and a counter that changes on every redraw (the DOM HUD copies it)
 *   .makeEcgPlane(w, h)       a ready THREE.Mesh (MeshBasicMaterial, toneMapped false) showing ecgTexture, for a wrist
 *   .vignette                 the screen-space overlay mesh (child of the camera), .strength (0..1 as drawn)
 *   .dispose()
 *
 * The vignette is ONE draw call and no post-processing pass: a single clip-space triangle (the vertex shader writes
 * gl_Position straight from the vertex, so it covers every eye's viewport exactly with zero parallax, in stereo too),
 * depth test off, alpha blended, renderOrder 880 (above the world and the particles, below the death fade 900, the
 * VR UI panels 950 and the hands in XR 960). Its shader is compiled at load (the mesh exists, visible, when the
 * game precompiles the scene) and nothing is allocated per frame.
 *
 * Strength follows hp: nothing at or above vignetteStart (60 hp), rising to a full red rim at zero; below the low
 * threshold (35 hp) it pulses with the heartbeat, bounded (alpha +-14 %, rim radius +-0.05); a damage hit adds a
 * short red flash (peak alpha <= 0.34, one hit per cooldown, so never a strobe). Comfort: no motion, no shake.
 * settings.reducedEffects: a static tint (no pulse, no flash).
 */

import * as THREE from 'three';
import { CONFIG, U } from '../sim/config3d.js';
import { LowHealthText } from './lowHealthText.js';

const H = CONFIG.health;

const RENDER_ORDER = 880;
const ECG_W = 256;
const ECG_H = 128;
const ECG_HZ = 30; // texture refresh rate (max)
const ECG_SPEED = 92; // px / s the trace sweeps
const PLOT_X0 = 6;
const PLOT_X1 = ECG_W - 6;
const PLOT_W = PLOT_X1 - PLOT_X0;
const PLOT_Y = 80; // baseline
const PLOT_AMP = 30; // px for an R wave
const GAP = 14; // px erased ahead of the sweep head
const BANDS = [
  { from: 0, to: 70, a: 1, w: 3.2 }, // the trace in three age bands: phosphor fading behind the sweep head
  { from: 70, to: 150, a: 0.72, w: 2.8 },
  { from: 150, to: PLOT_W - GAP, a: 0.42, w: 2.4 },
];
const MAX_FLASH = 0.34;
const PULSE_ALPHA = 0.14;
const PULSE_RADIUS = 0.05;

const VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uVig;     // 0..1 rim strength
uniform float uHaze;    // 0..1 centre darkening / desaturation
uniform float uFlash;   // 0..1 damage flash
uniform float uGrip;    // 0..1 failing grip (WP-CLIMB): a cold, dark tunnel closes in
uniform vec2 uRange;    // rim start / end radius in NDC
varying vec2 vNdc;
void main() {
  float r = length(vNdc);
  float e = smoothstep(uRange.x, uRange.y, r);
  e = e * e * (3.0 - 2.0 * e);
  // Rim: dark blood red, strongest in the corners. Haze: a dim grey lifts nothing and flattens colour.
  vec3 rimCol = mix(vec3(0.020, 0.0015, 0.002), vec3(0.30, 0.004, 0.006), smoothstep(0.0, 0.7, e));
  float rimA = clamp(e * uVig * 0.9, 0.0, 0.9);
  float hazeA = uHaze * 0.24 * (0.45 + 0.55 * e);
  vec3 hazeCol = vec3(0.020, 0.012, 0.012);
  float a = rimA + hazeA * (1.0 - rimA);
  vec3 c = (rimCol * rimA + hazeCol * hazeA * (1.0 - rimA)) / max(a, 1e-4);
  // Damage flash over everything: a red wash, heavier at the rim.
  float fa = uFlash * (0.30 + 0.70 * e);
  c = mix(c, vec3(0.62, 0.012, 0.012), fa / max(a + fa * (1.0 - a), 1e-4));
  a = a + fa * (1.0 - a);
  // Failing grip: the edges of the view go dark and cold (not red: that is health).
  float ga = clamp(e * uGrip * 0.7, 0.0, 0.7);
  c = mix(c, vec3(0.012, 0.022, 0.03), ga / max(a + ga * (1.0 - a), 1e-4));
  a = a + ga * (1.0 - a);
  // Interleaved-gradient dither: no banding in the dark gradient.
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  a = clamp(a + (n - 0.5) / 255.0, 0.0, 1.0);
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

/** The PQRST complex of one beat at phase p in [0,1): P, Q, R, S, T as gaussians. */
function ecgWave(p) {
  const g = (c, s, a) => {
    const d = (p - c) / s;
    return a * Math.exp(-d * d);
  };
  return g(0.13, 0.026, 0.13) + g(0.235, 0.0075, -0.13) + g(0.262, 0.0085, 1.0) + g(0.29, 0.009, -0.27) + g(0.49, 0.05, 0.27);
}

/** Cheap deterministic noise in [-1,1] for the ECG jitter. */
function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/** Heartbeat envelope 0..1 (lub at phase 0, softer dub at 0.3). */
function beatEnv(p) {
  const a = p < 0.5 ? p : p - 1;
  const b = p - 0.3;
  return Math.exp(-(a / 0.05) * (a / 0.05)) + 0.55 * Math.exp(-(b / 0.06) * (b / 0.06));
}

export class HealthFx {
  /** @param {object} game Game3D (renderer.camera, settings, bus are read) */
  constructor(game) {
    this.game = game;
    this.camera = game.renderer.camera;
    this.settings = game.settings || {};

    // ---- vignette -----------------------------------------------------------------------------
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uVig: { value: 0 },
        uHaze: { value: 0 },
        uFlash: { value: 0 },
        uGrip: { value: 0 },
        uRange: { value: new THREE.Vector2(0.55, 1.35) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.vignette = new THREE.Mesh(geo, this.material);
    this.vignette.name = 'healthVignette';
    this.vignette.renderOrder = RENDER_ORDER;
    this.vignette.frustumCulled = false;
    this.vignette.visible = true; // visible until the first update: the scene precompile compiles its program
    this.camera.add(this.vignette);
    // the scary line shown while health is low (head-locked, one quad)
    this.text = new LowHealthText(this.camera);

    // ---- ECG ------------------------------------------------------------------------------------
    this.ecgCanvas = document.createElement('canvas');
    this.ecgCanvas.width = ECG_W;
    this.ecgCanvas.height = ECG_H;
    this._g = this.ecgCanvas.getContext('2d', { alpha: false });
    this.ecgTexture = new THREE.CanvasTexture(this.ecgCanvas);
    this.ecgTexture.name = 'ecgTexture';
    this.ecgTexture.colorSpace = THREE.SRGBColorSpace;
    this.ecgTexture.generateMipmaps = true;
    this.ecgTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.ecgTexture.magFilter = THREE.LinearFilter;
    this.ecgTexture.anisotropy = 4;
    this.ecgFrame = 0;
    this._ecgMat = null;

    // ---- state (no allocation after this) ------------------------------------------------------
    this.strength = 0; // vignette strength as drawn (0..1)
    this._vig = 0;
    this._haze = 0;
    this._flash = 0;
    this._grip = 0; // failing-grip tunnel strength as drawn (0..1)
    this._pulseAmp = 0;
    this._phase = 0; // heartbeat phase of the vignette pulse (cycles)
    this._xr = false;
    this._ys = new Float32Array(PLOT_W); // sweep columns
    this._head = 0; // sweep position (px)
    this._beat = 0; // ecg cardiac phase (cycles)
    this._ecgAcc = 1;
    this._idleDrawn = true;
    this._ecgT = 0;
    this._lowAmt = 0; // 0..1 how red / jittery the trace is
    this._color = [70, 255, 138]; // current trace colour (rgb 0..255)
    this._st = null;
    this._dead = false;
    this._deadT = 0;
    this._lastFlashAt = -1;
    this._unsub = [];

    const bus = game.bus;
    if (bus && typeof bus.on === 'function') {
      this._unsub.push(
        bus.on('health:damage', (e) => this._onDamage(e)),
        bus.on('game:start', () => this.reset()),
        bus.on('game:restart', () => this.reset()),
        bus.on('game:respawn', () => this.reset()),
        bus.on('game:menu', () => this.reset()),
      );
    }
    this._drawEcg(0, true);
    this.ecgTexture.needsUpdate = true;
  }

  get reduced() {
    return !!(this.settings && this.settings.reducedEffects);
  }

  /** A fresh start: full health look, calm trace. */
  reset() {
    if (this.text) this.text.reset();
    this._grip = 0;
    this._vig = 0;
    this._haze = 0;
    this._flash = 0;
    this._pulseAmp = 0;
    this._lowAmt = 0;
    this._dead = false;
    this._deadT = 0;
    this._ys.fill(0);
    this._color[0] = 70;
    this._color[1] = 255;
    this._color[2] = 138;
  }

  _onDamage(e) {
    if (this.reduced) return;
    const amt = e && typeof e.amount === 'number' ? e.amount : 0.1;
    const f = Math.min(MAX_FLASH, 0.1 + amt * 0.85);
    if (f > this._flash) this._flash = f;
  }

  /** A mesh showing the ECG texture for a wrist screen. Shares one material; call once per screen. */
  makeEcgPlane(width = 0.06, height = 0.03) {
    if (!this._ecgMat) {
      this._ecgMat = new THREE.MeshBasicMaterial({ map: this.ecgTexture, toneMapped: false, fog: false });
      this._ecgMat.name = 'ecgScreen';
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this._ecgMat);
    m.name = 'ecgScreen';
    m.frustumCulled = false;
    return m;
  }

  /**
   * @param {number} dt seconds (frame)
   * @param {object} game reads state, health, xrActive, hidePlayer
   */
  update(dt, game) {
    const g = game || this.game;
    const hp = g.health;
    const state = g.state;
    const inRun = (state === 'playing' || state === 'dead' || state === 'paused' || state === 'victory') && !g.hidePlayer && !!hp;
    const reduced = this.reduced;
    this._xr = !!g.xrActive;
    const dts = dt > 0.1 ? 0.1 : dt;

    // ---- vignette targets ---------------------------------------------------------------------
    const dead = !!(hp && hp.dead);
    let target = 0;
    let haze = 0;
    let pulseTarget = 0;
    let bpm = H.bpmCalm;
    if (inRun) {
      const hurt = hp.hurt; // 0 at >= 50 hp .. 1 at 0
      target = Math.pow(hurt, 0.78);
      haze = hurt * hurt;
      pulseTarget = hp.low && !dead ? 1 : 0;
      bpm = hp.heartbeatRate || H.bpmCalm;
    }
    if (dead) {
      target = 1;
      haze = 1;
    }
    const k = 1 - Math.exp(-dts * (target > this._vig ? 6 : 2.5));
    this._vig += (target - this._vig) * k;
    this._haze += (haze - this._haze) * k;
    this._pulseAmp += (pulseTarget - this._pulseAmp) * (1 - Math.exp(-dts * 3));

    // heartbeat pulse of the rim (bounded; none when reduced)
    this._phase += (dts * Math.max(40, bpm)) / 60;
    this._phase -= Math.floor(this._phase);
    const pulse = reduced ? 0 : beatEnv(this._phase) * this._pulseAmp;
    // flash decays
    if (this._flash > 0) this._flash = reduced ? 0 : Math.max(0, this._flash - dts * 0.85);

    // failing grip (sim/climb3d.js warn 0..1): the rim darkens as the strength runs out; a slow bounded breath unless reduced
    const cl = g.climb;
    const gTarget = inRun && cl && !dead ? cl.warn : 0;
    this._grip += (gTarget - this._grip) * (1 - Math.exp(-dts * (gTarget > this._grip ? 5 : 2)));
    const gripPulse = reduced ? 0 : 0.12 * Math.sin(this._ecgT * 6.5) * this._grip;

    const vig = U.clamp(this._vig * (1 + PULSE_ALPHA * pulse), 0, 1);
    this.strength = vig;
    const u = this.material.uniforms;
    u.uVig.value = vig;
    u.uHaze.value = this._haze;
    u.uFlash.value = this._flash;
    u.uGrip.value = U.clamp(this._grip * (0.85 + gripPulse), 0, 1);
    // Lenses crop the corners of the eye buffer: start the rim a little further in when presenting.
    const r0 = (this._xr ? 0.5 : 0.6) - PULSE_RADIUS * pulse;
    const r1 = this._xr ? 1.22 : 1.4;
    u.uRange.value.set(r0, r1);
    this.vignette.visible = vig > 0.004 || this._flash > 0.004 || this._haze > 0.004 || this._grip > 0.004;
    // THE DRESSER hunting you (you are whole): the line comes in chalk (lowHealthText.js; never with low health)
    const dr = g.dresser;
    const chalk = !!(dr && !dr.isNull && dr.hunting);
    const measuring = chalk && !!dr.measuring;
    this.text.update(dts, { low: !!(hp && hp.low), dead, playing: state === 'playing' && inRun, hp: hp ? hp.hp : 1, bpm, reduced, chalk, measuring });

    // ---- ECG ------------------------------------------------------------------------------------
    this._ecgAcc += dts;
    this._ecgT += dts;
    if (this._ecgAcc >= 1 / (reduced ? 15 : ECG_HZ)) {
      const step = Math.min(this._ecgAcc, 0.25);
      this._ecgAcc = 0;
      if (inRun) {
        this._idleDrawn = false;
        this._drawEcg(step, false, hp);
      } else if (!this._idleDrawn) {
        this._idleDrawn = true;
        this._drawEcg(0, true, null);
      }
    }
  }

  // -----------------------------------------------------------------------------------------------
  // ECG drawing
  // -----------------------------------------------------------------------------------------------

  /** Canvas style strings for a trace colour, rebuilt only when the colour changes (no string churn at 30 Hz). */
  _styles(r, g, b) {
    const key = (r << 16) | (g << 8) | b;
    let st = this._st;
    if (st && st.key === key) return st;
    const c = `${r},${g},${b}`;
    st = this._st = {
      key,
      grid: `rgba(${c},0.10)`,
      axis: `rgba(${c},0.22)`,
      bands: [`rgba(${c},${BANDS[0].a})`, `rgba(${c},${BANDS[1].a})`, `rgba(${c},${BANDS[2].a})`],
      head: `rgb(${Math.min(255, r + 80)},${Math.min(255, g + 80)},${Math.min(255, b + 80)})`,
      solid: `rgb(${c})`,
      a75: `rgba(${c},0.75)`,
      a60: `rgba(${c},0.6)`,
      a80: `rgba(${c},0.8)`,
      a90: `rgba(${c},0.9)`,
      frame: `rgba(${c},0.35)`,
    };
    return st;
  }

  _drawEcg(step, idle, hp) {
    const ctx = this._g;
    const W = ECG_W;
    const Hh = ECG_H;
    const reduced = this.reduced;
    const hpv = hp ? hp.hp : 1;
    const dead = !!(hp && hp.dead);
    const bpm = hp ? (dead ? 0 : hp.heartbeatRate) : H.bpmCalm;
    const low = hp ? hp.low : false;

    // Colour: phosphor green when healthy, amber in between, red when low.
    const lowT = dead ? 1 : U.clamp((0.55 - hpv) / 0.25, 0, 1); // 0 at >= 55 hp, 1 at <= 30 hp
    this._lowAmt += (lowT - this._lowAmt) * Math.min(1, step * 6 + (idle ? 1 : 0));
    const amber = U.clamp((0.85 - hpv) / 0.3, 0, 1) * (1 - this._lowAmt);
    const gR = 70 + 185 * amber;
    const gG = 255 - 80 * amber;
    const gB = 138 - 80 * amber;
    const tR = gR + (255 - gR) * this._lowAmt;
    const tG = gG + (52 - gG) * this._lowAmt;
    const tB = gB + (58 - gB) * this._lowAmt;
    const col = this._color;
    col[0] = tR;
    col[1] = tG;
    col[2] = tB;

    // Sweep: advance the head, fill the new columns with the trace at the current heart rate.
    const ys = this._ys;
    if (!idle && step > 0) {
      const dx = ECG_SPEED * step;
      const n = Math.max(1, Math.round(dx));
      const cycles = (bpm / 60) * step;
      const jit = reduced || dead ? 0 : this._lowAmt * 0.075 + (low ? 0.02 : 0);
      for (let i = 1; i <= n; i++) {
        this._beat += cycles / n;
        // an irregular rhythm when low: the rate wobbles, every so often a beat comes early
        if (jit > 0.02) this._beat += (hash1(Math.floor(this._ecgT * 3) + 7) * 0.18 * cycles) / n;
        this._beat -= Math.floor(this._beat);
        const col0 = (Math.floor(this._head) + i) % PLOT_W;
        let y = dead ? 0 : ecgWave(this._beat);
        if (jit > 0) y += hash1(this._head * 3.1 + i * 17.3 + this._ecgT * 61) * jit * (y > 0.5 ? 0.5 : 1);
        else if (!dead) y += hash1(this._head + i * 7.7) * 0.012;
        if (dead) y += hash1(this._head + i * 5.1) * 0.01 * Math.max(0, 1 - this._deadT);
        ys[col0] = y;
      }
      this._head = (this._head + dx) % PLOT_W;
      if (dead) this._deadT += step;
    }
    if (idle) {
      ys.fill(0);
      this._head = 0;
    }

    // Background + grid
    ctx.fillStyle = '#020a06';
    ctx.fillRect(0, 0, W, Hh);
    const st = this._styles(tR | 0, tG | 0, tB | 0);
    ctx.strokeStyle = st.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = PLOT_X0; x <= PLOT_X1; x += 16) {
      ctx.moveTo(x + 0.5, 46);
      ctx.lineTo(x + 0.5, 108);
    }
    for (let y = 46; y <= 108; y += 16) {
      ctx.moveTo(PLOT_X0, y + 0.5);
      ctx.lineTo(PLOT_X1, y + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = st.axis;
    ctx.beginPath();
    ctx.moveTo(PLOT_X0, PLOT_Y + 0.5);
    ctx.lineTo(PLOT_X1, PLOT_Y + 0.5);
    ctx.stroke();

    // Trace in three age bands (phosphor fade behind the sweep head).
    const head = Math.floor(this._head);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let b = 2; b >= 0; b--) {
      const band = BANDS[b];
      ctx.strokeStyle = st.bands[b];
      ctx.lineWidth = band.w;
      ctx.beginPath();
      let prevC = -1;
      for (let age = Math.min(PLOT_W - GAP, band.to + 1); age >= band.from; age--) {
        const c = (((head - age) % PLOT_W) + PLOT_W) % PLOT_W;
        const x = PLOT_X0 + c + 0.5;
        const y = PLOT_Y - ys[c] * PLOT_AMP;
        if (prevC < 0 || c < prevC) ctx.moveTo(x, y); // the ring wraps: do not join the right edge to the left
        else ctx.lineTo(x, y);
        prevC = c;
      }
      ctx.stroke();
    }
    // Sweep head dot
    const hy = PLOT_Y - ys[head % PLOT_W] * PLOT_AMP;
    ctx.fillStyle = st.head;
    ctx.beginPath();
    ctx.arc(PLOT_X0 + head + 0.5, hy, 2.6, 0, Math.PI * 2);
    ctx.fill();

    // Header: heart glyph (pulses with the beat), bpm numeral, label
    const pulse = dead ? 0 : beatEnv(this._beat);
    const hs = 1 + 0.22 * Math.min(1, pulse);
    ctx.save();
    ctx.translate(26, 24);
    ctx.scale(hs, hs);
    ctx.fillStyle = st.solid;
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.bezierCurveTo(-16, -3, -8, -15, 0, -6);
    ctx.bezierCurveTo(8, -15, 16, -3, 0, 9);
    ctx.fill();
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'right';
    ctx.fillStyle = st.solid;
    ctx.font = '700 38px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText(dead ? '--' : String(Math.round(bpm)), W - 52, 36);
    ctx.font = '600 13px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.fillStyle = st.a75;
    ctx.textAlign = 'left';
    ctx.fillText(dead ? 'FLAT' : 'BPM', W - 46, 34);
    ctx.fillStyle = st.a60;
    ctx.font = '600 12px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText(dead ? 'NO SIGNAL' : low ? 'CRITICAL' : hpv < 0.8 ? 'INJURED' : 'STABLE', 52, 14);

    // Health bar
    const bx = 8;
    const by = 112;
    const bw = W - 16 - 56;
    ctx.strokeStyle = st.a80;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw, 10);
    ctx.fillStyle = st.solid;
    ctx.fillRect(bx + 2, by + 2, Math.max(0, (bw - 3) * U.clamp(hpv, 0, 1)), 7);
    ctx.fillStyle = st.a90;
    ctx.fillRect(bx + 0.5 + bw * H.lowEnter, by - 2, 1.5, 14); // low threshold tick
    ctx.font = '700 15px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(hpv * 100)), W - 6, by + 10);

    // CRT scanlines + a dim frame
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 1; y < Hh; y += 3) ctx.fillRect(0, y, W, 1);
    ctx.strokeStyle = st.frame;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, Hh - 2);

    this.ecgFrame++;
    this.ecgTexture.needsUpdate = true;
  }

  dispose() {
    for (const off of this._unsub) {
      try {
        off();
      } catch {
        /* already gone */
      }
    }
    this._unsub.length = 0;
    if (this.vignette.parent) this.vignette.parent.remove(this.vignette);
    this.vignette.geometry.dispose();
    this.material.dispose();
    this.text.dispose();
    this.ecgTexture.dispose();
    if (this._ecgMat) this._ecgMat.dispose();
  }
}
