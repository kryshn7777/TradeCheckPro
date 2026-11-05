#!/usr/bin/env node
/* THE LANTERN: render the opening cinematic from the REAL game (docs/abyssal-tether-3d/plans/OPENING_CINEMATIC.md section 0).
 *
 * The film is a pure timeline (src/sim/openingCinematic.js), so a headless page can play it deterministically: the game is frozen,
 * every frame holds the film at t = from + k / fps (AT3D.debug.opening.hold), runs one presentation frame and reads the canvas.
 *
 *   node tools/abyssal-tether-3d/release/render-opening.mjs --stills [--times 4,12.5,...]     one PNG per shot + a contact sheet
 *   node tools/abyssal-tether-3d/release/render-opening.mjs --video [--from 0] [--to 4] [--fps 24]   frames -> H.264 MP4 (+ the score)
 *   node tools/abyssal-tether-3d/release/render-opening.mjs --video --full                     the whole film (hours in software GL)
 *   options: --w 1280 --h 720 --out tools/abyssal-tether-3d/release/out --no-audio --root public/abyssal-tether-3d
 *
 * The soundtrack is rendered OFFLINE in the page with the game's own audio code (audio/openingSfx.js OpeningScore on an
 * OfflineAudioContext: every cue and narration line at its film time), written as a WAV and muxed by ffmpeg (AAC 192 kb/s).
 * Software WebGL is slow (a 1280 x 720 frame takes seconds): keep one browser, and expect the full length to take hours.
 * Output (git-ignored): out/opening-stills/*.png, out/opening-contact.png, out/opening-frames/, out/the-lantern-opening.mp4
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch, newPage, sleep, until } from './lib/browser.mjs';
import { createStaticServer } from './lib/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (n) => argv.includes(n);
const W = +arg('--w', 1280);
const H = +arg('--h', 720);
const FPS = +arg('--fps', 24);
const OUT = path.resolve(REPO, arg('--out', 'tools/abyssal-tether-3d/release/out'));
const ROOT = path.resolve(REPO, arg('--root', 'public/abyssal-tether-3d'));
const STILLS = has('--stills');
const VIDEO = has('--video');
const FULL = has('--full');
const AUDIO = !has('--no-audio');
const XR_NOTE = 'desktop camera (a headset sees the static vantages: see OPENING_CINEMATIC.md section 5)';
if (!STILLS && !VIDEO) {
  console.log('usage: render-opening.mjs --stills [--times a,b,..] | --video [--from s] [--to s] [--fps n] [--full]');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

/** One moment per shot (the composed frame of each) + the title and the hand-off. */
const SHOT_TIMES = [
  [5.5, '01 EMBER'],
  [13.4, '02 THE LIGHT WE KEPT'],
  [15.45, '02b the gutter'],
  [23.0, '03 THE LOWERING'],
  [31.0, '04 THE WINDOW'],
  [35.5, '04b the window, later'],
  [40.8, '05 THE THRESHOLD'],
  [46.2, '05b THE DOOR'],
  [53.5, '06 THE KNOCK'],
  [60.6, '07 BEFORE THE LAMP'],
  [64.3, '07b the lunge'],
  [69.0, '08 THE LANTERN'],
  [79.6, '09 THE WAKING'],
  [84.0, '10 the hand-off'],
];

const srv = await createStaticServer({ root: ROOT, prefix: '/', prodHeaders: false }).start();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await newPage(ctx, { viewport: { width: W, height: H } });
page.on('crash', () => {
  console.error('PAGE CRASHED (out of memory?): lower --w / --h');
  process.exit(2);
});
await page.addInitScript(() => {
  const css = document.createElement('style');
  css.textContent = '#ui-root,.at3d-ui,#boot,#at-fatal,#at3d-gpu-banner,[id^=at3d-panel]{display:none!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(css));
});
const t0 = Date.now();
await page.goto(srv.base + '?sw=0&gov=off&perfdiag=off&watchdog=off&comms=off&hunt=always&hints=off', { waitUntil: 'domcontentloaded' });
await until(() => page.evaluate(() => !!(window.AT3D && window.AT3D.game && window.AT3D.game.booted)), { timeout: 400000, label: 'boot' });
await until(() => page.evaluate(() => window.AT3D.game.handsView && window.AT3D.game.handsView.gearState === 'ready'), { timeout: 240000, label: 'the gauntlet lantern (player_arms.glb)' }).catch(() => console.log('  note: the gear GLB is not in: the hero lantern is the procedural stand-in'));
await sleep(2500);
console.log(`booted in ${((Date.now() - t0) / 1000).toFixed(0)} s; ${XR_NOTE}`);

const started = await page.evaluate(() => {
  const G = window.AT3D.game;
  const D = window.AT3D.debug;
  const ok = D.opening.play('normal');
  D.freeze(true); // the run waits: only our frames advance the film
  return ok;
});
if (!started) throw new Error('the opening did not start (state is not intro)');

/** Hold the film at t, run one presentation frame (and `warm` more before it: the lazy level dressing near a new camera), read it. */
async function frameAt(t, dt, warm) {
  const b64 = await page.evaluate(
    ({ t, dt, warm }) => {
      const G = window.AT3D.game;
      G._openingHold = t;
      for (let i = 0; i < warm; i++) G._frame(dt, false);
      G._frame(dt, false);
      G._render(dt);
      return G.renderer.renderer.domElement.toDataURL('image/png').split(',')[1];
    },
    { t, dt, warm },
  );
  return Buffer.from(b64, 'base64');
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' '));
}

try {
  if (STILLS) {
    const dir = path.join(OUT, 'opening-stills');
    fs.mkdirSync(dir, { recursive: true });
    const custom = arg('--times', null);
    const list = custom ? custom.split(',').map((x) => [+x, `t ${x}`]) : SHOT_TIMES;
    const files = [];
    for (const [t, label] of list) {
      const s0 = Date.now();
      const png = await frameAt(t, 1 / 60, 30);
      const f = path.join(dir, `opening-${String(t.toFixed(2)).padStart(5, '0')}.png`);
      fs.writeFileSync(f, png);
      files.push([f, label, t]);
      console.log(`  ${path.relative(REPO, f)}  ${label}  (${((Date.now() - s0) / 1000).toFixed(0)} s)`);
    }
    // the contact sheet: 4 across, each still at 480 px with its label and time
    const cols = 4;
    const tw = 480;
    const th = Math.round((tw * H) / W);
    const inputs = [];
    const chains = [];
    files.forEach(([f, label, t], i) => {
      inputs.push('-i', f);
      const txt = `${label}  ${t.toFixed(1)} s`.replace(/[:']/g, ' ');
      chains.push(`[${i}:v]scale=${tw}:${th},drawtext=text='${txt}':x=10:y=h-26:fontsize=17:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=5[v${i}]`);
    });
    const n = files.length;
    const layout = files.map((_, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|');
    const sheet = path.join(OUT, 'opening-contact.png');
    ffmpeg([...inputs, '-filter_complex', `${chains.join(';')};${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${n}:layout=${layout}:fill=black`, '-frames:v', '1', sheet]);
    console.log(`contact sheet: ${path.relative(REPO, sheet)}`);
  }

  if (VIDEO) {
    const from = FULL ? 0 : +arg('--from', 0);
    const to = FULL ? 84 : +arg('--to', from + 4);
    const dir = path.join(OUT, 'opening-frames');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const n = Math.max(1, Math.round((to - from) * FPS));
    const dt = 1 / FPS;
    const v0 = Date.now();
    for (let k = 0; k < n; k++) {
      const png = await frameAt(from + k * dt, dt, k === 0 ? 30 : 0);
      fs.writeFileSync(path.join(dir, `f${String(k).padStart(5, '0')}.png`), png);
      if (k % FPS === 0 || k === n - 1) console.log(`  frame ${k + 1}/${n}  t ${(from + k * dt).toFixed(2)} s  (${((Date.now() - v0) / 1000 / (k + 1)).toFixed(1)} s a frame)`);
    }
    const mp4 = path.join(OUT, FULL ? 'the-lantern-opening.mp4' : `the-lantern-opening-${from}-${to}s.mp4`);
    let wav = null;
    if (AUDIO) {
      // the soundtrack: the game's own score code on an OfflineAudioContext, every cue and line at its film time
      const b64 = await page.evaluate(
        async ({ from, to }) => {
          const mod = await import(new URL('src/audio/openingSfx.js', location.href).href);
          const sr = 48000;
          const len = Math.ceil((to - from + 2.5) * sr);
          const off = new OfflineAudioContext(2, len, sr);
          const master = off.createGain();
          master.gain.value = 0.9;
          const comp = off.createDynamicsCompressor();
          comp.threshold.value = -10;
          comp.ratio.value = 4;
          master.connect(comp);
          comp.connect(off.destination);
          const sc = new mod.OpeningScore(off, { score: master, sfx: master, voice: master });
          await sc.loadVoice(new URL('assets/audio/opening/', location.href).href);
          sc.scheduleAll(from, to);
          const buf = await off.startRendering();
          // 16-bit PCM WAV
          const ch = [buf.getChannelData(0), buf.getChannelData(1)];
          const n = Math.min(buf.length, Math.ceil((to - from) * sr));
          const ab = new ArrayBuffer(44 + n * 4);
          const v = new DataView(ab);
          const str = (o, s) => {
            for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
          };
          str(0, 'RIFF');
          v.setUint32(4, 36 + n * 4, true);
          str(8, 'WAVEfmt ');
          v.setUint32(16, 16, true);
          v.setUint16(20, 1, true);
          v.setUint16(22, 2, true);
          v.setUint32(24, sr, true);
          v.setUint32(28, sr * 4, true);
          v.setUint16(32, 4, true);
          v.setUint16(34, 16, true);
          str(36, 'data');
          v.setUint32(40, n * 4, true);
          let o = 44;
          for (let i = 0; i < n; i++) {
            for (let c = 0; c < 2; c++) {
              const x = Math.max(-1, Math.min(1, ch[c][i]));
              v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
              o += 2;
            }
          }
          let s = '';
          const u8 = new Uint8Array(ab);
          for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
          return btoa(s);
        },
        { from, to },
      );
      wav = path.join(OUT, `opening-score-${from}-${to}s.wav`);
      fs.writeFileSync(wav, Buffer.from(b64, 'base64'));
      console.log(`  soundtrack: ${path.relative(REPO, wav)}`);
    }
    const args = ['-framerate', String(FPS), '-i', path.join(dir, 'f%05d.png')];
    if (wav) args.push('-i', wav);
    args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
    if (wav) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    args.push(mp4);
    ffmpeg(args);
    console.log(`video: ${path.relative(REPO, mp4)}  (${n} frames at ${FPS} fps, ${W} x ${H}${wav ? ', with the score' : ''})`);
  }
  if (page.errors.length) console.log('page errors:\n  ' + page.errors.slice(0, 12).join('\n  '));
} finally {
  await browser.close();
  await srv.stop();
}
