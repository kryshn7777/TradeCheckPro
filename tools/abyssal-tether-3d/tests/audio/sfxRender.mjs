// Offline renderer for the designed SFX (src/audio/sfxDesign.js): a tiny pure-JS synth that renders a resolved Plan the
// way SfxEngine._schedule builds it on WebAudio: the same oscillators, the same three seeded noise buffers (makeNoise's
// shaping), WebAudio-spec biquads (k-rate coefficients per 128-sample block, as kRate() sets them), the same envelopes
// (linear attack, hold, setTargetAtTime decay), frequency sweeps, tick trains and tremolo. No reverb, panner or master chain:
// it measures the voice itself, before the bus (peak / RMS / duration), and can write 16-bit mono WAVs.
import fs from 'node:fs';

export const SR = 48000;
const BLOCK = 128;

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The game's makeNoise() (audio3d.js) on a seeded stream: white, pink (Kellet), brown; de-trended, peak 0.95. */
function makeNoise(seconds, kind, rnd) {
  const len = Math.floor(SR * seconds);
  const d = new Float32Array(len);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = rnd() * 2 - 1;
    if (kind === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = b0 + b1 + b2 + w * 0.1848;
    } else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last;
    } else d[i] = w;
  }
  if (kind !== 'white') {
    const drift = d[len - 1] - d[0];
    let mean = 0;
    for (let i = 0; i < len; i++) {
      d[i] -= (drift * i) / (len - 1);
      mean += d[i];
    }
    mean /= len;
    for (let i = 0; i < len; i++) d[i] -= mean;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < len; i++) d[i] *= 0.95 / peak;
  return d;
}

const rnd = seeded(0x5eed);
export const NOISE = [makeNoise(2, 'white', rnd), makeNoise(3, 'pink', rnd), makeNoise(4, 'brown', rnd)];

/** WebAudio BiquadFilterNode coefficients (spec): bandpass Q linear, lowpass / highpass Q in dB. */
function coeffs(type, f, Q, out) {
  const w0 = (2 * Math.PI * Math.min(f, SR * 0.4999)) / SR;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  let b0;
  let b1;
  let b2;
  let a0;
  let a1;
  let a2;
  if (type === 'bandpass') {
    const alpha = sw / (2 * Math.max(Q, 1e-4));
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * cw;
    a2 = 1 - alpha;
  } else {
    const alpha = sw / (2 * Math.pow(10, Q / 20));
    a0 = 1 + alpha;
    a1 = -2 * cw;
    a2 = 1 - alpha;
    if (type === 'lowpass') {
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = (1 - cw) / 2;
    } else {
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = (1 + cw) / 2;
    }
  }
  out[0] = b0 / a0;
  out[1] = b1 / a0;
  out[2] = b2 / a0;
  out[3] = a1 / a0;
  out[4] = a2 / a0;
}

const FT = ['bandpass', 'lowpass', 'highpass'];
const WAVE = ['sine', 'triangle', 'square', 'sawtooth'];

function osc(wave, ph) {
  const p = ph - Math.floor(ph);
  switch (wave) {
    case 1:
      return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
    case 2:
      return p < 0.5 ? 1 : -1;
    case 3:
      return 2 * p - 1;
    default:
      return Math.sin(2 * Math.PI * p);
  }
}

/** env() of sfxDesign.js as a function of time. */
function envAt(t, t0, peak, a, h, d) {
  if (t < t0) return 0;
  const u = t - t0;
  if (u < a) return (peak * u) / a;
  if (u < a + h) return peak;
  return peak * Math.exp(-(u - a - h) / d);
}

/**
 * Renders a resolved plan (sfxDesign.resolveRecipe) into a Float32Array (the voice output before the bus: × plan.level).
 */
export function renderPlan(plan, tail = 0.05) {
  const n = Math.ceil((plan.dur + tail) * SR);
  const out = new Float32Array(n);
  const c = new Float64Array(5);
  for (let li = 0; li < plan.n; li++) {
    const L = plan.layers[li];
    if (L.type === 1) {
      // tone
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        if (t < L.at) continue;
        const u = t - L.at;
        const f = L.f2 + (L.f - L.f2) * Math.exp(-u / L.sw);
        ph += f / SR;
        out[i] += osc(L.wave, ph) * envAt(t, L.at, L.g, L.a, L.h, L.d) * trem(L, u);
      }
    } else if (L.type === 2) {
      // noise → biquad → envelope
      const buf = NOISE[L.src];
      let x1 = 0;
      let x2 = 0;
      let y1 = 0;
      let y2 = 0;
      let pos = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        if (t < L.at) continue;
        const u = t - L.at;
        if ((i & (BLOCK - 1)) === 0 || i === Math.ceil(L.at * SR)) coeffs(FT[L.ftype], L.f2 + (L.f - L.f2) * Math.exp(-u / L.sw), L.q, c);
        const j = pos | 0;
        const fr = pos - j;
        const x = buf[j % buf.length] * (1 - fr) + buf[(j + 1) % buf.length] * fr;
        pos += L.rate;
        const y = c[0] * x + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        out[i] += y * envAt(t, L.at, L.g, L.a, L.h, L.d) * trem(L, u);
      }
    } else if (L.type === 3) {
      // modal partials
      for (let p = 0; p < L.np; p++) {
        let ph = 0;
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          if (t < L.at) continue;
          ph += L.pf[p] / SR;
          out[i] += Math.sin(2 * Math.PI * ph) * envAt(t, L.at, L.pg[p], L.a, 0, L.pd[p]);
        }
      }
    } else if (L.type === 4) {
      // tick train: one noise → bandpass (frequency stepped per tick) → gain driven by setTargetAtTime events
      const buf = NOISE[L.src];
      let x1 = 0;
      let x2 = 0;
      let y1 = 0;
      let y2 = 0;
      let pos = 0;
      let g = 0;
      let target = 0;
      let tc = 0.001;
      let ev = 0; // next event index: 2 per tick (rise at tt, fall at tt + 3 ms)
      const start = Math.floor(L.tt[0] * SR);
      coeffs('bandpass', L.tf[0], L.q, c);
      for (let i = start; i < n; i++) {
        const t = i / SR;
        while (ev < L.nt * 2) {
          const k = ev >> 1;
          const te = ev & 1 ? L.tt[k] + 0.003 : L.tt[k];
          if (te > t) break;
          if (ev & 1) {
            target = 0;
            tc = L.d;
          } else {
            target = L.tg[k];
            tc = 0.0007;
            coeffs('bandpass', L.tf[k], L.q, c);
          }
          ev++;
        }
        g += (target - g) * (1 - Math.exp(-1 / (SR * tc)));
        const j = pos | 0;
        const x = buf[j % buf.length];
        pos += L.rate;
        const y = c[0] * x + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        out[i] += y * g;
      }
    }
  }
  for (let i = 0; i < n; i++) out[i] *= plan.level;
  return out;
}

function trem(L, u) {
  if (!(L.lfoDepth > 0 && L.lfoRate > 0)) return 1;
  return 1 - L.lfoDepth * 0.5 + L.lfoDepth * 0.5 * Math.sin(2 * Math.PI * L.lfoRate * u);
}

/** Peak, overall RMS, the loudest 50 ms RMS window, the audible duration (to −50 dB of the peak) and a NaN flag. */
export function measure(buf) {
  let peak = 0;
  let sum = 0;
  let nan = false;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    if (!Number.isFinite(v)) nan = true;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  const W = Math.floor(SR * 0.05);
  let w = 0;
  let best = 0;
  for (let i = 0; i < buf.length; i++) {
    w += buf[i] * buf[i];
    if (i >= W) w -= buf[i - W] * buf[i - W];
    if (w > best) best = w;
  }
  const floor = peak * 0.00316;
  let last = 0;
  for (let i = buf.length - 1; i >= 0; i--) {
    if (Math.abs(buf[i]) > floor) {
      last = i;
      break;
    }
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, buf.length)), rms50: Math.sqrt(Math.max(0, best) / W), audible: last / SR, nan };
}

export const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

/** 16-bit PCM mono WAV. */
export function writeWav(path, buf) {
  const n = buf.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(path, b);
}

export { WAVE };
