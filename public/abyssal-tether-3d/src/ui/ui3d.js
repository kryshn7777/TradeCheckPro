/* ABYSSAL TETHER 3D — ui3d.js
 * UI3D: every screen of the game, in two presentations.
 *
 *   Desktop (and the 2D page on the Quest before entering VR): a DOM overlay
 *   built here (markup + a scoped, injected <style>) in the 2D game's art
 *   direction — carved title with a "VR" mark, Begin descent, Difficulty
 *   (blurbs + best times), Sandbox, Controls (Quest + desktop), Settings
 *   (volume, aim assist, turn speed, mouse sensitivity, dominant hand,
 *   haptics), 'Enter VR' (only when immersive-vr is supported; otherwise how
 *   to play on a Quest), pause, death and victory screens; a small HUD (time,
 *   depth, section, a shape-coded tether glyph per hand, depth gauge), a
 *   crosshair, "click to look" prompt, hints, section title cards and toasts.
 *   Fully keyboard navigable (Tab trap, arrows, Enter/Space, Esc = back).
 *
 *   In VR: the same screens on one world-space panel — a CanvasTexture
 *   rendered at 2x (logical 1024×768 on a 1.28 × 0.96 m plane, every glyph
 *   ≥ 28 logical px) ~1.6 m in front of the head, re-centred when a screen
 *   opens, parented to the rig so it travels with the player — pointed at with
 *   intent.ui.ray and clicked with intent.ui.click (hover frame + ray + dot
 *   are separate meshes, so hovering never re-uploads the texture); a wrist
 *   HUD on the left controller (time, depth, section, a tether glyph per hand);
 *   tag-along hint / section-title / toast cards that lazily follow the head.
 *
 * The UI never runs game logic: it calls Game3D's public methods (contract
 * §8: start, restart, respawn, pause, resume, quitToMenu, applySettings,
 * enterVR) defensively and listens on the bus. Per-frame work is allocation
 * free; canvases are redrawn only when their content changes.
 *
 * Section records (LEVEL_FUN_PLAN item 12, P6): a Records screen (best split, medal and the next medal's time per section
 * and difficulty, from the schema-3 save and data/par-3d.js; ui/medals.js), the split line "I · 1:12.4 · SILVER" on the
 * next section's title card (a toast when no card shows; at the goal a toast), and the run's splits on the victory panel.
 * In VR all of it is drawn on the existing panel / title / toast canvases: no new mesh, no new draw call.
 *
 * Public API: new UI3D(game); init(); show(name|null, info); update(dt);
 * current; vrMode; showHint(textOrHint, seconds); hideHint();
 * showSectionTitle(name, subtitle, index); showToast(text, seconds);
 * showDeath(info); showVictory(info); refreshMenu(); syncSettings();
 * recenter(); setForceVR(bool) (render the VR presentation outside XR —
 * previews/tests); dispose().
 */
import * as THREE from 'three';
import { DIFFICULTY, DIFFICULTY_ORDER, SETTINGS_DEFAULTS, Storage, U, VIEW, heightCalibration } from '../sim/config3d.js';
import { ITEM_NAMES } from '../sim/inventory3d.js';
import { BUILD } from '../platform/buildInfo.js';
import { CaptionTracker, KIND_SHAPE, SECTOR_NAMES } from './captions.js';
import { ComfortOverlay, applyDisplay } from './comfort.js';
import { Tutorial } from './tutorial.js';
import { fmtMul, fmtOff, fmtPct, textScaleOf } from './uxLogic.js';
import { MEDAL_COLOR, MEDAL_LABEL, fmtSplit, medalTally, recordRows, splitLine, tallyLine, targetText } from './medals.js';
import { PAR_3D } from '../data/par-3d.js';

// =============================================================================
// Constants
// =============================================================================
const SCREENS = ['menu', 'difficulty', 'controls', 'settings', 'about', 'calibrate', 'records', 'pause', 'death', 'victory'];
const SUB_SCREENS = { difficulty: true, controls: true, settings: true, about: true, calibrate: true, records: true };
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const HANDS = ['left', 'right'];

const HUD_INTERVAL = 0.1; // s between DOM HUD text refreshes
const WRIST_INTERVAL = 0.2; // s between wrist HUD redraws (only when the text changed)
const SECTION_LABEL_TIME = 6; // s the HUD section label stays lit
const TITLE_TIME = 4.7; // s a section title card stays up
const TITLE_CUT = 1.0; // s: a title card still up when the S4 sighting starts fades out this fast
const DEATH_FALLBACK = 1.4; // s after player:death before the UI shows the death screen itself
const DEATH_ARM = 0.38; // s: stray clicks right as the death screen opens are ignored
const CLICK_DEBOUNCE = 0.15; // s between two VR panel clicks
const DEDUPE = 1.5; // s: same title/toast requested twice (bus + game call) shows once

// VR panel: logical canvas size, pixel ratio and world size (metres).
const CW = 1024;
const CH = 768;
const PX = 2;
const PANEL_W = 1.28;
const PANEL_H = 0.96;
const PANEL_DIST = 1.6;
const PANEL_DROP = 0.1; // panel centre below the eyes
const PANEL_PITCH_MIN = -0.6; // rad: a panel opened while looking down sits at most this far below the horizon …
const PANEL_PITCH_MAX = 0.35; // … or this far above it
const RECENTER_ANGLE = 70 * U.DEG; // switching screens re-centres when the panel is this far off
// Wrist HUD (left grip space): logical canvas, size, mount offset and tilt.
const WRIST_CW = 320;
const WRIST_CH = 160;
const WRIST_W = 0.13;
const WRIST_OFFSET = [0, 0.032, 0.085]; // above the grip, back toward the forearm
const WRIST_TILT = -Math.PI / 2 + 0.6; // lying on the wrist, tilted toward the eyes
// Tag-along notes.
const NOTE_DIST = 1.5;
const NOTE_LAG = 22 * U.DEG; // the cards start following once the head turns this far
const HINT = { cw: 1024, ch: 192, w: 1.2, dy: -0.36 };
const TITLE = { cw: 1024, ch: 288, w: 1.2, dy: 0.2 };
const TOAST = { cw: 512, ch: 80, w: 0.6, dy: 0.42 };
const CAPTION = { cw: 1024, ch: 208, w: 1.2, dy: -0.64 }; // subtitle lines, under the hint card
const RENDER_ORDER = 950; // UI draws over the world and the death fade (keep the fade sphere < 900)

const COL = {
  ink: '#ddd5c4',
  ink2: '#b3ac9e',
  ink3: '#868074',
  ink4: '#5e5b54',
  phosphor: '#e8dcc0',
  amber: '#e0a050',
  amber2: '#b67a3a',
  verdigris: '#6a9c90',
  rust: '#c27a5c',
  title: '#cfc5b1',
  titleB: '#b8ae9a',
  warm: '#fbe7c2',
  line: 'rgba(232,220,192,0.11)',
  line2: 'rgba(232,220,192,0.2)',
  line3: 'rgba(232,220,192,0.34)',
};
const HAND_COL = { left: COL.verdigris, right: COL.amber };
const F_DISPLAY = "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Noto Serif', 'DejaVu Serif', serif";
const F_UI = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif";

/** Fallback death copy by cause (the game may pass its own `message`). */
const DEATH_COPY = {
  impact: { kicker: 'The ground came too fast', message: 'The floor keeps what falls. It kept you.' },
  hazard: { kicker: 'Old iron', message: 'The ironwork was waiting. It has waited for others.' },
  fall: { kicker: 'No floor', message: 'The dark had no bottom, only those who fell before.' },
  creature: { kicker: 'Closer than it sounded', message: 'It wears you now.' },
};

const pct = fmtPct;
const mul = fmtMul;
const mTxt = (v) => `${v.toFixed(2)} m`;
const cm = (v) => `${v < -1e-6 ? '−' : v > 1e-6 ? '+' : ''}${+(Math.abs(v) * 100).toFixed(1)} cm`;
/** Settings tabs (VR: one tab per page of rows; desktop: one heading per tab). */
const TABS = [
  { id: 'comfort', label: 'Comfort', title: 'Comfort and movement' },
  { id: 'display', label: 'Display', title: 'Display' },
  { id: 'audio', label: 'Sound', title: 'Sound and haptics' },
  { id: 'access', label: 'Access', title: 'Accessibility and hands' },
  { id: 'touch', label: 'Touch', title: 'Touch controls (phone and tablet)', desktopOnly: true },
];
/** The VR panel has no touch page. */
const VR_TABS = TABS.filter((t) => !t.desktopOnly);
/**
 * Settings schema (keys of SETTINGS_DEFAULTS). `tab` places a row; `desktop` rows are hidden in VR; `vr` rows (links) are
 * hidden on the desktop; `page` rows live on a sub page in VR ('height' = the Player height page, 'calibrate' = the Brightness
 * screen). Numeric `choice` options keep their number type. The comfort options are OFF / smooth by default (the owner's design
 * is full-speed swings and falls; they are there for the players who need them).
 */
const SETTINGS_SCHEMA = [
  { key: 'vignette', tab: 'comfort', type: 'range', label: 'Comfort vignette', desc: 'Darkens the edge of your view while you move fast, swing or turn. Off by default.', min: 0, max: 1, step: 0.1, fmt: fmtOff },
  { key: 'turnMode', tab: 'comfort', type: 'choice', label: 'Turning', desc: 'Smooth turning with the right stick, or snap in steps.', options: [['smooth', 'Smooth'], ['snap', 'Snap']] },
  { key: 'snapAngle', tab: 'comfort', type: 'choice', label: 'Snap angle', desc: 'Degrees per snap step.', options: [[30, '30°'], [45, '45°'], [60, '60°'], [90, '90°']] },
  { key: 'turnSpeed', tab: 'comfort', type: 'range', label: 'Turn speed', desc: 'Right-stick smooth turning in VR.', min: 0.5, max: 2, step: 0.05, fmt: mul },
  { key: 'mouseSensitivity', tab: 'comfort', type: 'range', label: 'Mouse sensitivity', desc: 'Mouse look on desktop.', min: 0.3, max: 3, step: 0.05, fmt: mul, desktop: true },
  {
    key: 'heightMode',
    tab: 'comfort',
    type: 'choice',
    label: 'Seated or standing',
    desc: 'Standing: your real height, 1:1. Seated: lifts your eyes to a standing eye height.',
    options: [['standing', 'Standing'], ['seated', 'Seated']],
  },
  { key: 'windSqualls', tab: 'comfort', type: 'toggle', label: 'Wind squalls', desc: 'Gusts in the deep shaft push you gently while you swing or hang. Off: still air.' },
  { key: 'heightOffset', tab: 'comfort', type: 'range', label: 'Fine height', desc: 'Raise or lower your eyes a little.', page: 'height', min: -VIEW.offsetMax, max: VIEW.offsetMax, step: VIEW.offsetStep, fmt: cm },
  { type: 'height', tab: 'comfort', page: 'height' },
  { type: 'link', tab: 'comfort', vr: true, label: 'Player height', action: 'height-page', value: 1 },

  { key: 'qualityTier', tab: 'display', type: 'choice', label: 'Graphics quality', desc: 'Auto lets the headset keep 72 frames a second. Pick Low for the lightest picture.', options: [['auto', 'Auto'], ['low', 'Low'], ['quest', 'Quest'], ['high', 'High']] },
  { key: 'renderScale', tab: 'display', type: 'range', label: 'Render scale', desc: 'Sharper or lighter. Applies when you next enter VR.', min: 0.7, max: 1.3, step: 0.05, fmt: pct },
  { key: 'reducedEffects', tab: 'display', type: 'toggle', label: 'Reduced effects', desc: 'Thinner fog, dust and debris; a calmer picture.' },
  { key: 'textScale', tab: 'display', type: 'range', label: 'Text size', desc: 'Makes menus, hints and captions larger.', min: 0.9, max: 1.5, step: 0.05, fmt: pct },
  { key: 'showBody', tab: 'display', type: 'toggle', label: 'Show body', desc: 'Your own body and backpack when you look down.' },
  { key: 'bloodWriting', tab: 'display', type: 'toggle', label: 'Blood writing', desc: 'Darker, personal messages written in blood on the walls. Disturbing.' },
  { key: 'brightness', tab: 'display', type: 'range', label: 'Brightness', desc: 'Overall exposure of the world.', page: 'calibrate', min: 0.6, max: 1.6, step: 0.05, fmt: pct },
  { key: 'blackLevel', tab: 'display', type: 'range', label: 'Black level', desc: 'Lifts the darkest shadows. Raise it until square 2 below is just visible.', page: 'calibrate', min: 0, max: 1, step: 0.05, fmt: fmtOff },
  { type: 'patches', tab: 'display', page: 'calibrate' },
  { type: 'link', tab: 'display', vr: true, label: 'Brightness and black level', action: 'calibrate' },

  { key: 'volume', tab: 'audio', type: 'range', label: 'Master volume', min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'musicVolume', tab: 'audio', type: 'range', label: 'Music', min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'sfxVolume', tab: 'audio', type: 'range', label: 'Effects', desc: 'The world, the rope and the creature.', min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'haptics', tab: 'audio', type: 'toggle', label: 'Haptics', desc: 'Pulses on attach, rope tension, landings and danger.' },
  { key: 'hapticStrength', tab: 'audio', type: 'range', label: 'Haptic strength', min: 0.25, max: 1.5, step: 0.05, fmt: pct },

  { key: 'captions', tab: 'access', type: 'toggle', label: 'Captions', desc: 'Text for the sounds that warn you: where it came from, how close.' },
  { key: 'colorSafe', tab: 'access', type: 'toggle', label: 'Colour-safe cues', desc: 'Shapes and words next to colour for health, grip, the bag and warnings.' },
  { key: 'tutorialHints', tab: 'access', type: 'toggle', label: 'Tutorial hints', desc: 'Short hints for grip, reel and the bag until you have used them.' },
  { key: 'aimAssist', tab: 'access', type: 'range', label: 'Aim assist', desc: 'How generously a tether picks an anchor near your aim.', min: 0.6, max: 1.4, step: 0.05, fmt: pct },
  { key: 'touchControls', tab: 'touch', type: 'choice', label: 'Touch controls', desc: 'Auto shows the on-screen controls on phones and tablets (and on the first touch on a laptop).', options: [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], desktop: true },
  { key: 'touchLookSens', tab: 'touch', type: 'range', label: 'Look sensitivity', desc: 'Dragging the right side of the screen, and the gyroscope.', min: 0.3, max: 3, step: 0.05, fmt: mul, desktop: true },
  { key: 'touchInvertY', tab: 'touch', type: 'toggle', label: 'Invert vertical look', desc: 'Drag up to look down.', desktop: true },
  { key: 'touchGyro', tab: 'touch', type: 'toggle', label: 'Gyroscope look', desc: 'Tilt the device to look around. iOS asks for motion permission.', desktop: true },
  { key: 'touchLauncher', tab: 'touch', type: 'choice', label: 'Rope buttons', desc: 'One button per hand, or one button with an L / R switch.', options: [['two', 'Two buttons'], ['toggle', 'One + switch']], desktop: true },
  { key: 'touchRopeMode', tab: 'touch', type: 'choice', label: 'Rope behaviour', desc: 'Hold to stay attached, or tap to attach and tap again to let go.', options: [['hold', 'Hold'], ['latch', 'Tap to toggle']], desktop: true },
  { key: 'touchMirror', tab: 'touch', type: 'toggle', label: 'Left-handed layout', desc: 'Mirrors the screen: stick on the right, buttons on the left.', desktop: true },
  { key: 'touchScale', tab: 'touch', type: 'range', label: 'Button size', desc: 'Scales every on-screen button.', min: 0.9, max: 1.5, step: 0.05, fmt: pct, desktop: true },
  { key: 'dominantHand', tab: 'access', type: 'choice', label: 'Dominant hand', desc: 'The hand that points at menus, and the side of your bag.', options: [['left', 'Left'], ['right', 'Right']] },
];
const DIR_ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const PATCH_LEVELS = [0.004, 0.012, 0.02, 0.03, 0.045, 0.065, 0.09, 0.13]; // fractions of white
const HEIGHT_KEYS = ['heightMode', 'heightCal', 'heightOffset', 'heightMeasured'];

/** [keys, full description, short VR description]. */
const CONTROLS_QUEST = [
  [['Trigger'], 'Fire that hand’s tether at its highlighted anchor. Hold to stay attached, release to let go.', 'Tether · hold on · release'],
  [['Grip'], 'Hand at a chalk-studded surface or any ledge edge / corner: hold to grab it (edges tire the grip faster; pull down at a ledge lip to climb over), then move the hand to pull yourself; alternate hands to climb, let go to launch, A hops off. Grip strength runs out. Elsewhere, on a tethered hand: yank that rope in hard.', 'Grab · climb · yank rope'],
  [['Left stick'], 'Move, pump the swing, steer in the air — relative to where you look.', 'Move · swing · air control'],
  [['Right stick ← →'], 'Smooth turn.', 'Smooth turn'],
  [['Right stick ↑ ↓'], 'Reel every attached tether in / out.', 'Reel in / let out'],
  [['A'], 'Jump.', 'Jump'],
  [['B', '≡'], 'Pause · back out of a menu.', 'Pause · back'],
  [['X'], 'Hold to restart the run while paused or after a fall.', 'Hold: restart (paused / fallen)'],
  [['Y'], 'Hold to re-centre your body under your head and re-measure your height (stand or sit as you will play).', 'Hold: re-centre'],
  [['Left stick click'], 'Brake on the ground.', 'Brake'],
  [['Hand to hip + Grip'], 'Reach a hand to your right hip (below the chest) and squeeze the grip: a ring of bag items opens. Point at one and let go to apply it. Squeeze again at the hip, or tap X, to stop.', 'Hip + grip: bag · tap X: stop'],
];
const CONTROLS_DESKTOP = [
  [['Mouse'], 'Look around. Click the view first to capture the mouse.'],
  [['Left button'], 'Right-hand tether: hold to stay attached, release to let go.'],
  [['Right button'], 'Left-hand tether.'],
  [['W', 'A', 'S', 'D'], 'Move, pump the swing, steer in the air.'],
  [['Space'], 'Jump · reel in while tethered.'],
  [['Shift'], 'Reel out.'],
  [['C'], 'Brake on the ground.'],
  [['F'], 'Hold near a chalk-studded surface or any ledge edge / corner to cling to it (W A S D climb, W or Space at a ledge lip climbs over, otherwise Space hops off; grip strength runs out, standing on the ground refills it). Elsewhere: yank both ropes.'],
  [['Esc'], 'Pause.'],
  [['R'], 'Restart the run.'],
  [['Enter'], 'Confirm · continue after a fall.'],
  [['1', '2', '3', '4'], 'Bag: apply the first aid kit, bandage, adrenaline shot or lantern battery.'],
  [['Wheel', 'G'], 'Bag: select the previous / next item · apply the selected item.'],
  [['X'], 'Stop applying a bag item (taking damage stops it too).'],
];

const CONTROLS_TOUCH = [
  [['Left thumb'], 'Drag anywhere on the left half: a stick appears under your thumb. Move, pump the swing, steer in the air.'],
  [['Right thumb'], 'Drag anywhere on the right half to look. Dragging from a rope or grip button looks while you hold it.'],
  [['ROPE R', 'ROPE L'], 'Fire that hand’s tether at the highlighted anchor. Hold to stay attached, release to let go (or tap to toggle, see Settings, Touch).'],
  [['REEL', 'LET OUT'], 'Hold to reel every attached tether in / let rope out.'],
  [['JUMP'], 'Jump. While clinging: hop off, or climb over a ledge lip.'],
  [['GRIP'], 'Hold near chalk marks or a ledge edge to cling, then use the stick to climb or traverse. Elsewhere: yank the ropes.'],
  [['BAG'], 'Open the bag, tap an item to apply it, tap X to stop applying.'],
  [['II'], 'Pause.'],
];

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]';

// =============================================================================
// Small helpers (DOM helpers run on user actions / screen changes, never per frame)
// =============================================================================
function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}
function fmtTime(t) {
  return U.formatTime(t);
}
function fmtMeters(m) {
  return `${Math.max(0, Math.round(m || 0))} m`;
}
function make(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}
function isVisible(el) {
  return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
}
/** Fills `el` with `text`, turning `[Key]` tokens into <kbd> elements (no innerHTML). */
function setRichText(el, text) {
  el.textContent = '';
  const parts = String(text).split(/(\[[^\]]{1,24}\])/);
  for (const part of parts) {
    if (!part) continue;
    if (part.length > 2 && part[0] === '[' && part[part.length - 1] === ']') el.appendChild(make('kbd', null, part.slice(1, -1)));
    else el.appendChild(document.createTextNode(part));
  }
}
function restartAnimation(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // style flush so the CSS animation restarts (rare: section change)
  el.classList.add(cls);
}
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ---- canvas painting ---------------------------------------------------------
function rr(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.lineTo(x + w - k, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + k);
  ctx.lineTo(x + w, y + h - k);
  ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  ctx.lineTo(x + k, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - k);
  ctx.lineTo(x, y + k);
  ctx.quadraticCurveTo(x, y, x + k, y);
  ctx.closePath();
}
function spacing(ctx, em) {
  try {
    ctx.letterSpacing = em ? `${em}em` : '0px';
  } catch {
    // older canvas: no tracking
  }
}
/** Text with optional tracking (em); `maxW` (optional) condenses it to fit whatever font the device has. */
function txt(ctx, s, x, y, font, color, align, track, maxW) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'alphabetic';
  spacing(ctx, track || 0);
  if (maxW > 0) ctx.fillText(s, x, y, maxW);
  else ctx.fillText(s, x, y);
  spacing(ctx, 0);
}
function measure(ctx, s, font, track) {
  ctx.font = font;
  spacing(ctx, track || 0);
  const w = ctx.measureText(s).width;
  spacing(ctx, 0);
  return w;
}
/** Word wrap at the current font. */
function wrapLines(ctx, s, maxW, font) {
  ctx.font = font;
  const words = String(s).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (!w) continue;
    const test = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(test).width > maxW) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
/** Largest font size (≤ size, ≥ min) at which `s` fits `maxW`. */
function fitSize(ctx, s, maxW, size, min, fontFn, track) {
  let px = size;
  while (px > min && measure(ctx, s, fontFn(px), track) > maxW) px -= 2;
  return px;
}
function ellipsize(ctx, s, maxW, font) {
  ctx.font = font;
  if (ctx.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
function diamond(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
}
/** Shape-coded tether glyph (idle dashed ring / target ring + brackets / attached solid ring / fragile cracked diamond). */
function tetherGlyph(ctx, cx, cy, s, state, color, stress) {
  ctx.save();
  ctx.lineWidth = Math.max(2, s * 0.09);
  ctx.strokeStyle = state === 'idle' ? COL.ink3 : color;
  ctx.fillStyle = color;
  const r = s * 0.22;
  const ry = cy - s * 0.2;
  if (state === 'fragile') {
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin((stress || 0) * 30);
    diamond(ctx, cx, ry, r * 1.25);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#0b0c0d';
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.35, ry - r * 0.75);
    ctx.lineTo(cx + r * 0.15, ry - r * 0.15);
    ctx.lineTo(cx - r * 0.25, ry + r * 0.2);
    ctx.lineTo(cx + r * 0.2, ry + r * 0.8);
    ctx.stroke();
  } else if (state === 'attached') {
    ctx.beginPath();
    ctx.arc(cx, ry, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b0c0d';
    ctx.beginPath();
    ctx.arc(cx, ry, r * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
  } else {
    if (state === 'idle') ctx.setLineDash([s * 0.07, s * 0.06]);
    ctx.beginPath();
    ctx.arc(cx, ry, state === 'target' ? r * 0.8 : r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (state === 'target') {
      const b = r * 1.35;
      const k = r * 0.5;
      ctx.beginPath();
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        ctx.moveTo(cx + sx * b, ry + sy * (b - k));
        ctx.lineTo(cx + sx * b, ry + sy * b);
        ctx.lineTo(cx + sx * (b - k), ry + sy * b);
      }
      ctx.stroke();
    }
  }
  // The line down to the lantern-diamond (the player).
  ctx.strokeStyle = state === 'idle' ? COL.ink3 : color;
  ctx.lineWidth = Math.max(1.5, s * (state === 'attached' || state === 'fragile' ? 0.08 : 0.05));
  if (state === 'idle' || state === 'target') ctx.setLineDash([s * 0.05, s * 0.07]);
  ctx.beginPath();
  ctx.moveTo(cx, ry + r * 1.3);
  ctx.lineTo(cx, cy + s * 0.2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = state === 'idle' ? COL.ink3 : color;
  diamond(ctx, cx, cy + s * 0.31, s * 0.1);
  if (state === 'attached' || state === 'fragile') ctx.fill();
  else ctx.stroke();
  ctx.restore();
}

/** Tether glyph SVG for the DOM HUD (states toggled by CSS on [data-state]). */
const GLYPH_SVG = `<svg viewBox="0 0 28 28" aria-hidden="true" focusable="false">
<g class="t-idle"><circle cx="14" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.4 2.2"/><path d="M14 12.5v6.5" stroke="currentColor" stroke-width="1.4" stroke-dasharray="1.4 2.2"/><path d="M14 19.5l3.5 3.5-3.5 3.5-3.5-3.5z" fill="none" stroke="currentColor" stroke-width="1.4"/></g>
<g class="t-target"><circle cx="14" cy="7" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 3.5V1h2.5M20.5 3.5V1H18M7.5 10.5V13H10M20.5 10.5V13H18" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M14 12.5v6.5" stroke="currentColor" stroke-width="1.4" stroke-dasharray="1.4 2.2"/><path d="M14 19.5l3.5 3.5-3.5 3.5-3.5-3.5z" fill="none" stroke="currentColor" stroke-width="1.4"/></g>
<g class="t-attached"><circle cx="14" cy="7" r="4.6" fill="currentColor"/><circle cx="14" cy="7" r="1.6" fill="#0b0c0d"/><path d="M14 11.5v8" stroke="currentColor" stroke-width="2.2"/><path d="M14 19l4 4-4 4-4-4z" fill="currentColor"/></g>
<g class="t-fragile"><path d="M14 1.5l5.5 5.5-5.5 5.5-5.5-5.5z" fill="currentColor"/><path d="M12.6 3.6l2.2 2.3-1.7 1.5 1.9 2.6" fill="none" stroke="#0b0c0d" stroke-width="1.2"/><path d="M14 12.5v7" stroke="currentColor" stroke-width="2.2"/><path d="M14 19l4 4-4 4-4-4z" fill="currentColor"/></g>
</svg>`;

const BACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';
const HEADSET_SVG =
  '<svg viewBox="0 0 32 20" aria-hidden="true" focusable="false"><path d="M3 4.5C3 3.1 4.1 2 5.5 2h21C27.9 2 29 3.1 29 4.5v9c0 1.4-1.1 2.5-2.5 2.5h-6l-2.3-3.2a2.7 2.7 0 0 0-4.4 0L11.5 16h-6A2.5 2.5 0 0 1 3 13.5z"/><circle cx="10" cy="8.5" r="2.4"/><circle cx="22" cy="8.5" r="2.4"/></svg>';

// =============================================================================
// Markup + styles (desktop overlay)
// =============================================================================
function backBtn() {
  return `<button class="btn-back" type="button" data-action="back" aria-label="Back">${BACK_SVG}<span>Back</span></button>`;
}
function glyphSpan(hand) {
  const label = hand === 'left' ? 'Left tether: idle' : 'Right tether: idle';
  return `<span class="tglyph" data-hand="${hand}" data-state="idle" role="img" aria-label="${label}">${GLYPH_SVG}<i>${hand === 'left' ? 'L' : 'R'}</i></span>`;
}

const MARKUP = `
<div class="hud" aria-hidden="false">
  <div class="hud-box">
    <div class="hud-row">${glyphSpan('left')}<span class="hud-time">0:00.00</span>${glyphSpan('right')}</div>
    <div class="hud-row hud-sub"><span class="hud-depth">0 m</span><span class="hud-dot" aria-hidden="true">·</span><span class="hud-diff">Normal</span></div>
    <div class="hud-best" hidden></div>
    <div class="hud-section"></div>
    <div class="hud-status" hidden aria-label="Status"></div>
    <canvas class="hud-ecg" width="256" height="128" aria-label="Heart monitor"></canvas>
    <canvas class="hud-bag" width="256" height="128" aria-label="Bag"></canvas>
  </div>
  <div class="hud-gauge" aria-hidden="true"><div class="hud-gauge-ticks"></div><div class="hud-gauge-marker"></div></div>
</div>
<div class="crosshair" aria-hidden="true"><i></i></div>
<div class="bag-apply" aria-hidden="true"><span class="bag-apply-label"></span><b><i></i></b></div>
<div class="capture" role="status">Click to look around <span>·</span> <kbd>Esc</kbd> pauses</div>
<button class="btn-pause" type="button" data-action="pause" aria-label="Pause"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg></button>
<div class="section-card" aria-live="polite"><div class="section-num"></div><div class="section-name"></div><div class="section-rule" aria-hidden="true"></div><div class="section-sub"></div><div class="section-split"></div></div>
<div class="captions" aria-live="off" hidden></div>
<div class="hint" role="status" aria-live="polite"></div>
<div class="toast" role="status" aria-live="polite"><span class="toast-glyph" aria-hidden="true"></span><span class="toast-text"></span></div>
<div class="xr-note" role="status"><span class="xr-note-glyph" aria-hidden="true">${HEADSET_SVG}</span><span>Playing in VR — the menus are in the headset.</span></div>

<section class="screen screen-menu" data-screen="menu" hidden aria-label="Main menu">
  <div class="menu-wrap">
    <header class="title-block">
      <p class="kicker">The Underspire</p>
      <h1 class="game-title"><span class="title-word title-a">Abyssal</span><span class="title-tether" aria-hidden="true"><i></i><b></b><i></i></span><span class="title-word title-b"><span class="title-b-text">Tether</span><span class="vr-mark">VR</span></span></h1>
      <p class="tagline">A lantern, a line, and a long way down. No one has climbed back.</p>
    </header>
    <nav class="menu-actions" aria-label="Main menu">
      <button class="btn btn-primary btn-continue" type="button" data-action="continue-run" hidden data-autofocus><span class="btn-label">Continue</span><span class="btn-sub menu-continue-sub"></span></button>
      <button class="btn btn-primary btn-start" type="button" data-action="start" data-autofocus><span class="btn-label menu-start-label">Begin descent</span><span class="btn-sub menu-start-sub">Normal</span></button>
      <button class="btn btn-vr" type="button" data-action="enter-vr" hidden><span class="btn-vr-icon" aria-hidden="true">${HEADSET_SVG}</span><span class="btn-label">Enter VR</span><span class="btn-sub">Put on the headset · Meta Quest</span></button>
      <button class="btn menu-diff" type="button" data-action="difficulty"><span class="btn-label">Difficulty</span></button>
      <button class="btn" type="button" data-action="sandbox"><span class="btn-label">Sandbox</span><span class="btn-sub">No predator</span></button>
      <button class="btn" type="button" data-action="controls"><span class="btn-label">Controls</span></button>
      <button class="btn" type="button" data-action="settings"><span class="btn-label">Settings</span></button>
      <button class="btn menu-about" type="button" data-action="about"><span class="btn-label">About</span><span class="btn-sub menu-about-sub" hidden>Update ready</span></button>
      <button class="btn menu-records" type="button" data-action="records"><span class="btn-label">Records</span><span class="btn-sub menu-records-sub" hidden></span></button>
    </nav>
    <div class="menu-foot">
      <button class="menu-update" type="button" data-action="apply-update" hidden><span aria-hidden="true">◆</span> Update ready — restart to apply</button>
      <dl class="best-strip" aria-label="Best times"></dl>
      <p class="vr-note" hidden></p>
      <p class="menu-hint">Click to look · hold <kbd>Left</kbd>/<kbd>Right</kbd> mouse for each hand’s tether · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> swing · <kbd>Space</kbd> reel in</p>
    </div>
  </div>
</section>

<section class="screen" data-screen="difficulty" hidden aria-labelledby="at3d-diff-title">
  <div class="panel panel-wide">
    <div class="panel-head">${backBtn()}<h2 id="at3d-diff-title">Choose your descent</h2></div>
    <div class="panel-body"><div class="diff-grid"></div><p class="panel-note">Best times and deepest points are kept on this device.</p></div>
  </div>
</section>

<section class="screen" data-screen="controls" hidden aria-labelledby="at3d-ctl-title">
  <div class="panel panel-wide">
    <div class="panel-head">${backBtn()}<h2 id="at3d-ctl-title">Controls</h2></div>
    <div class="panel-body">
      <div class="ctl-cols">
        <div class="ctl-col"><h3 class="group-title">Meta Quest controllers</h3><ul class="bind-list ctl-quest"></ul></div>
        <div class="ctl-col ctl-col-touch"><h3 class="group-title">Touch screen</h3><ul class="bind-list ctl-touch"></ul></div>
        <div class="ctl-col ctl-col-desktop"><h3 class="group-title">Mouse &amp; keyboard</h3><ul class="bind-list ctl-desktop"></ul></div>
      </div>
      <p class="panel-note">Full-speed swings and falls are the experience, and smooth turning is the default. A comfort vignette, snap turning, seated play, captions and more are in Settings. Take a break whenever you need one — the game pauses with <kbd>B</kbd> / <kbd>≡</kbd> or <kbd>Esc</kbd>.</p>
    </div>
  </div>
</section>

<section class="screen" data-screen="settings" hidden aria-labelledby="at3d-set-title">
  <div class="panel panel-wide">
    <div class="panel-head">${backBtn()}<h2 id="at3d-set-title">Settings</h2></div>
    <div class="panel-body settings-body"></div>
  </div>
</section>

<section class="screen" data-screen="about" hidden aria-labelledby="at3d-about-title">
  <div class="panel panel-wide">
    <div class="panel-head">${backBtn()}<h2 id="at3d-about-title">About</h2></div>
    <div class="panel-body about-body">
      <p class="kicker">The Underspire · Chapter I · free</p>
      <dl class="about-list">
        <div><dt>Version</dt><dd class="about-version"></dd></div>
        <div><dt>Update</dt><dd><span class="about-update"></span> <button class="btn btn-ghost btn-inline" type="button" data-action="apply-update" hidden><span class="btn-label">Restart to update</span></button></dd></div>
        <div><dt>Privacy</dt><dd><a class="about-privacy" target="_blank" rel="noopener noreferrer"></a></dd></div>
        <div><dt>Support</dt><dd><a class="about-support" target="_blank" rel="noopener noreferrer"></a></dd></div>
        <div><dt>Your data</dt><dd>Settings, best times and one saved run stay on this device. The game has no account and sends nothing about you.</dd></div>
      </dl>
      <h3 class="group-title">Credits</h3>
      <p class="about-credits"></p>
      <div class="set-actions"><button class="btn btn-ghost about-erase" type="button" data-action="erase-data"><span class="btn-label">Erase saved data</span></button></div>
    </div>
  </div>
</section>

<section class="screen" data-screen="records" hidden aria-labelledby="at3d-rec-title">
  <div class="panel panel-wide">
    <div class="panel-head">${backBtn()}<h2 id="at3d-rec-title">Section records</h2></div>
    <div class="panel-body">
      <div class="rec-tabs" role="group" aria-label="Difficulty"></div>
      <table class="rec-table"><thead><tr><th scope="col"><span class="sr">Section number</span></th><th scope="col">Section</th><th scope="col">Best</th><th scope="col">Medal</th><th scope="col">Next</th></tr></thead><tbody></tbody></table>
      <p class="panel-note rec-tally"></p>
      <p class="panel-note">Medals per section: gold within the par (the time of the verified route), silver within 1.4 × par, brass within 2 ×. Whole sections only, from entering one to entering the next; falls count.</p>
    </div>
  </div>
</section>

<section class="screen screen-pause" data-screen="pause" hidden aria-labelledby="at3d-pause-title">
  <div class="panel panel-pause">
    <div class="panel-head panel-head-center"><h2 id="at3d-pause-title">Paused</h2><p class="run-line pause-stats"></p></div>
    <div class="panel-body">
      <div class="pause-cols">
        <div class="pause-actions">
          <button class="btn btn-vr btn-vr-return" type="button" data-action="enter-vr" hidden><span class="btn-vr-icon" aria-hidden="true">${HEADSET_SVG}</span><span class="btn-label">Return to VR</span><span class="btn-sub">Continue this run in the headset</span></button>
          <button class="btn btn-primary" type="button" data-action="resume" data-autofocus><span class="btn-label">Resume</span></button>
          <button class="btn pause-respawn" type="button" data-action="respawn"><span class="btn-label">Restart section</span><span class="btn-sub">Back to the last checkpoint</span></button>
          <button class="btn" type="button" data-action="restart"><span class="btn-label">Restart descent</span><span class="btn-sub">From the top</span></button>
          <button class="btn" type="button" data-action="settings"><span class="btn-label">Settings</span></button>
          <button class="btn" type="button" data-action="controls"><span class="btn-label">Controls</span></button>
          <button class="btn btn-ghost" type="button" data-action="quit"><span class="btn-label">Quit to menu</span><span class="btn-sub">Your progress is saved</span></button>
        </div>
        <div class="pause-warp" hidden><h3 class="group-title">Warp to section</h3><div class="warp-grid"></div></div>
      </div>
    </div>
  </div>
</section>

<section class="screen screen-death" data-screen="death" hidden aria-labelledby="at3d-death-msg">
  <div class="death-wrap">
    <p class="death-kicker"></p>
    <h2 id="at3d-death-msg" class="death-msg"></h2>
    <p class="death-stats"></p>
    <div class="death-actions">
      <button class="btn btn-vr btn-vr-return" type="button" data-action="enter-vr" hidden><span class="btn-vr-icon" aria-hidden="true">${HEADSET_SVG}</span><span class="btn-label">Return to VR</span><span class="btn-sub">Put the headset back on</span></button>
      <button class="btn btn-primary death-continue" type="button" data-action="continue" data-autofocus><span class="btn-label">Continue</span><span class="btn-sub death-continue-sub">from the last checkpoint</span></button>
      <button class="btn" type="button" data-action="restart"><span class="btn-label">Restart descent</span></button>
      <button class="btn btn-ghost" type="button" data-action="quit"><span class="btn-label">Menu</span></button>
    </div>
    <p class="death-prompt"><kbd>Enter</kbd> continue · <kbd>R</kbd> restart</p>
  </div>
</section>

<section class="screen screen-victory" data-screen="victory" hidden aria-labelledby="at3d-victory-title">
  <div class="panel panel-victory">
    <div class="panel-body">
      <div class="victory-lamp" aria-hidden="true"></div>
      <p class="kicker">Chapter I · The Underspire</p>
      <h2 id="at3d-victory-title" class="victory-title">You reached the bottom</h2>
      <div class="victory-time"><span class="victory-time-label">Descent time</span><span class="victory-time-value v-time">0:00.00</span><span class="badge-new v-new" hidden>★ New best</span></div>
      <dl class="stat-grid">
        <div><dt>Falls</dt><dd class="v-deaths">0</dd></div>
        <div><dt>Lowest health</dt><dd class="v-health">100%</dd></div>
        <div><dt>Items used</dt><dd class="v-items">0</dd></div>
        <div><dt>Best</dt><dd class="v-best">—</dd></div>
        <div><dt>Difficulty</dt><dd class="v-diff">Normal</dd></div>
      </dl>
      <p class="panel-note victory-note v-note"></p>
      <div class="v-splits-wrap" hidden><h3 class="group-title">Sections</h3><ol class="v-splits"></ol></div>
      <div class="teaser">
        <p class="teaser-kicker">Chapters II–V · coming soon</p>
        <p class="teaser-names"><span>II Lamphold</span><span>III The Mere</span><span>IV The Keeping</span><span>V The Still Flame</span></p>
        <p class="teaser-line">The Underspire goes deeper than the light does. So did the Masons.</p>
      </div>
      <div class="victory-actions">
        <button class="btn btn-primary" type="button" data-action="restart" data-autofocus><span class="btn-label">Descend again</span></button>
        <button class="btn" type="button" data-action="menu"><span class="btn-label">Menu</span></button>
      </div>
    </div>
  </div>
</section>`;

const CSS = `
.at3d-ui{--u:clamp(14px,calc(7px + 0.4vmin + 0.35vmax),26px);--bg:#08090a;--stone-600:#30363a;--ink:#ddd5c4;--ink-2:#b3ac9e;--ink-3:#868074;--ink-4:#5e5b54;--phosphor:#e8dcc0;--amber:#e0a050;--amber-2:#b67a3a;--verdigris:#3f6b63;--verdigris-2:#6a9c90;--line:rgba(232,220,192,.11);--line-2:rgba(232,220,192,.2);--line-3:rgba(232,220,192,.34);--panel-a:rgba(21,24,25,.95);--panel-b:rgba(10,11,12,.97);--focus:#f2e6c9;--fd:${F_DISPLAY};--fu:${F_UI};--tap:44px;--ease:cubic-bezier(.2,.7,.2,1);--gut:16px;
position:fixed;inset:0;z-index:20;pointer-events:none;font-family:var(--fu);font-size:calc(var(--u) * var(--ts,1));line-height:1.4;color:var(--ink);-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.at3d-ui *,.at3d-ui *::before,.at3d-ui *::after{box-sizing:border-box}
.at3d-ui [hidden]{display:none!important}
.at3d-ui button,.at3d-ui input{font:inherit;color:inherit}
.at3d-ui kbd{display:inline-flex;align-items:center;justify-content:center;min-width:1.6em;padding:.08em .42em;margin:0 .1em;font:600 .82em/1.3 var(--fu);color:var(--phosphor);background:linear-gradient(180deg,#2a2f31,#1b1f21);border:1px solid var(--line-3);border-bottom-width:2px;border-radius:3px;white-space:nowrap}
.at3d-ui :focus{outline:none}
.at3d-ui :focus-visible{outline:2px solid var(--focus);outline-offset:3px}
.at3d-ui .kicker{margin:0;font:400 .86em/1.2 var(--fd);font-variant:small-caps;letter-spacing:.42em;text-transform:lowercase;color:var(--amber);opacity:.85}
.at3d-ui .group-title{display:flex;align-items:center;gap:.6em;margin:0 0 .6em;font:400 .95em/1.2 var(--fd);font-variant:small-caps;letter-spacing:.2em;text-transform:lowercase;color:var(--ink-2)}
.at3d-ui .group-title::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--line-2),transparent)}
.at3d-ui .panel-note{margin:.9em 0 0;font-size:.82em;color:var(--ink-3)}
.at3d-ui .btn{position:relative;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:.12em;width:100%;min-height:max(var(--tap),2.85em);padding:.5em 1.05em;margin:0;text-align:left;color:var(--ink);background:linear-gradient(180deg,rgba(38,43,45,.94),rgba(22,25,27,.94));border:1px solid var(--line-2);border-radius:3px;box-shadow:inset 0 1px 0 rgba(255,240,210,.05),0 2px 0 rgba(0,0,0,.45);cursor:pointer;transition:border-color .16s,color .16s,transform .08s}
.at3d-ui .btn::before{content:'';position:absolute;left:-1px;top:20%;bottom:20%;width:3px;background:var(--amber);transform:scaleY(0);transition:transform .18s var(--ease)}
.at3d-ui .btn-label{font:650 .95em/1.15 var(--fu);letter-spacing:.08em;text-transform:uppercase}
.at3d-ui .btn-sub{font:500 .74em/1.2 var(--fu);letter-spacing:.02em;color:var(--ink-3)}
.at3d-ui .btn:active{transform:translateY(1px)}
.at3d-ui .btn:focus-visible::before,.at3d-ui .btn.is-current::before{transform:scaleY(1)}
.at3d-ui .btn:focus-visible,.at3d-ui .diff-card:focus-visible,.at3d-ui .warp-btn:focus-visible{border-color:rgba(224,160,80,.7)}
@media (hover:hover){.at3d-ui .btn:hover{border-color:rgba(224,160,80,.5);color:#fff3dc}.at3d-ui .btn:hover::before{transform:scaleY(1)}}
.at3d-ui .btn-primary{border-color:rgba(224,160,80,.62);background:linear-gradient(180deg,rgba(74,52,27,.95),rgba(36,26,16,.96))}
.at3d-ui .btn-primary .btn-label{color:#fbe7c2}
.at3d-ui .btn-primary .btn-sub{color:rgba(240,210,160,.72)}
.at3d-ui .btn-ghost{background:transparent;box-shadow:none;border-color:var(--line)}
.at3d-ui .btn-ghost .btn-label{color:var(--ink-2)}
.at3d-ui .btn-vr{border-color:rgba(106,156,144,.7);background:linear-gradient(180deg,rgba(28,48,45,.95),rgba(14,24,23,.96));padding-left:3.6em}
.at3d-ui .btn-vr .btn-label{color:#d6efe8}
.at3d-ui .btn-vr .btn-sub{color:rgba(190,225,215,.7)}
.at3d-ui .btn-vr::before{background:var(--verdigris-2)}
.at3d-ui .btn-vr-icon{position:absolute;left:1em;top:50%;width:1.9em;transform:translateY(-50%);color:#bfe3d9}
.at3d-ui .btn-vr-icon svg{display:block;width:100%;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linejoin:round}
.at3d-ui .btn-back{display:inline-flex;align-items:center;gap:.25em;min-height:var(--tap);min-width:var(--tap);padding:0 .7em 0 .35em;margin:0;color:var(--ink-2);background:transparent;border:1px solid transparent;border-radius:3px;font:600 .78em var(--fu);letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
.at3d-ui .btn-back svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
@media (hover:hover){.at3d-ui .btn-back:hover{color:var(--phosphor);border-color:var(--line)}}
.at3d-ui .screen{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:var(--gut);pointer-events:auto;background:radial-gradient(ellipse at 50% 50%,rgba(4,5,6,.5),rgba(4,5,6,.8));animation:at3d-in .26s var(--ease) both}
.at3d-ui .screen>.panel,.at3d-ui .screen>.menu-wrap,.at3d-ui .screen>.death-wrap{animation:at3d-rise .34s var(--ease) both}
@keyframes at3d-in{from{opacity:0}to{opacity:1}}
@keyframes at3d-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.at3d-ui .panel{position:relative;display:flex;flex-direction:column;width:min(40em,100%);max-height:100%;min-height:0;background:linear-gradient(180deg,var(--panel-a),var(--panel-b));border:1px solid var(--line-2);border-radius:4px;box-shadow:0 30px 90px rgba(0,0,0,.65),inset 0 1px 0 rgba(255,240,210,.05)}
.at3d-ui .panel::before,.at3d-ui .panel::after{content:'';position:absolute;width:18px;height:18px;pointer-events:none;border-color:rgba(224,160,80,.55);border-style:solid}
.at3d-ui .panel::before{top:-1px;left:-1px;border-width:2px 0 0 2px}
.at3d-ui .panel::after{right:-1px;bottom:-1px;border-width:0 2px 2px 0}
.at3d-ui .panel-wide{width:min(54em,100%)}
.at3d-ui .panel-head{position:relative;display:flex;align-items:center;gap:.5em;flex:none;padding:.55em 1em .55em .55em;border-bottom:1px solid var(--line)}
.at3d-ui .panel-head h2{flex:1;margin:0;padding-right:3em;text-align:center;font:400 1.35em/1.15 var(--fd);font-variant:small-caps;letter-spacing:.16em;text-transform:lowercase;color:var(--phosphor)}
.at3d-ui .panel-head-center{flex-direction:column;gap:.2em;padding:.9em 1em .7em}
.at3d-ui .panel-head-center h2{padding-right:0;font-size:1.6em}
.at3d-ui .run-line{margin:0;font-size:.82em;letter-spacing:.06em;color:var(--ink-3);font-variant-numeric:tabular-nums}
.at3d-ui .panel-body{flex:1 1 auto;min-height:0;padding:1em 1.1em 1.15em;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--stone-600) transparent}
.at3d-ui .screen-menu{background:radial-gradient(ellipse 70% 60% at 50% 46%,rgba(5,6,7,.72),rgba(5,6,7,.32) 62%,rgba(5,6,7,.1)),linear-gradient(180deg,rgba(5,6,7,.55),transparent 22%,transparent 78%,rgba(5,6,7,.6))}
.at3d-ui .menu-wrap{display:flex;flex-direction:column;align-items:center;gap:clamp(1em,3.4vh,2.1em);width:min(31em,100%);max-height:100%;min-height:0;padding:6px;overflow-y:auto;scrollbar-width:none}
.at3d-ui .title-block{display:flex;flex-direction:column;align-items:center;gap:.55em;text-align:center}
.at3d-ui .game-title{display:flex;flex-direction:column;align-items:center;margin:0;font-size:1em;font-family:var(--fd);font-weight:700;line-height:.92;text-transform:uppercase;color:#cfc5b1;text-shadow:0 -1px 0 rgba(0,0,0,.95),0 1px 0 rgba(255,236,200,.16),0 2px 1px rgba(0,0,0,.5),0 12px 34px rgba(0,0,0,.9)}
.at3d-ui .title-word{display:block;white-space:nowrap}
.at3d-ui .title-a{font-size:clamp(2.4em,10vmin,5.6em);letter-spacing:.1em;margin-right:-.1em}
.at3d-ui .title-b{position:relative;font-size:clamp(1.4em,5.2vmin,2.9em);color:#b8ae9a}
.at3d-ui .title-b-text{letter-spacing:.62em;margin-right:-.62em}
.at3d-ui .vr-mark{position:absolute;left:100%;top:50%;transform:translate(.8em,-52%);padding:.12em .32em .08em;font:800 .5em/1 var(--fu);letter-spacing:.08em;color:var(--amber);border:2px solid var(--amber);border-radius:4px;text-shadow:none;box-shadow:0 0 14px rgba(224,160,80,.35),inset 0 0 8px rgba(224,160,80,.18)}
.at3d-ui .title-tether{display:flex;align-items:center;justify-content:center;width:100%;height:1.3em;margin:.32em 0 .34em}
.at3d-ui .title-tether i{flex:1;max-width:7.5em;height:1px;background:linear-gradient(90deg,transparent,rgba(232,220,192,.45))}
.at3d-ui .title-tether i:last-child{background:linear-gradient(270deg,transparent,rgba(232,220,192,.45))}
.at3d-ui .title-tether b{width:.62em;height:.62em;margin:0 .7em;background:var(--amber);transform:rotate(45deg);box-shadow:0 0 0 3px rgba(224,160,80,.16),0 0 18px rgba(224,160,80,.55);animation:at3d-lamp 4.8s ease-in-out infinite}
@keyframes at3d-lamp{0%,100%{opacity:.85}50%{opacity:1}}
.at3d-ui .tagline{margin:0;font:italic 400 1em/1.35 var(--fd);color:var(--ink-2);letter-spacing:.03em}
.at3d-ui .menu-actions{display:grid;grid-template-columns:1fr 1fr;gap:.55em;width:100%}
.at3d-ui .menu-actions .btn-start,.at3d-ui .menu-actions .btn-vr{grid-column:1/-1}
.at3d-ui .menu-actions .btn-start{min-height:max(52px,3.4em);align-items:center;text-align:center}
.at3d-ui .menu-actions .btn-start .btn-label{font-size:1.08em;letter-spacing:.16em}
.at3d-ui .menu-actions .btn:not(.btn-start):not(.btn-vr){align-items:center;text-align:center}
.at3d-ui .menu-foot{display:flex;flex-direction:column;align-items:center;gap:.5em;width:100%}
.at3d-ui .best-strip{display:flex;justify-content:center;flex-wrap:wrap;gap:.35em 1.3em;margin:0;font-variant-numeric:tabular-nums}
.at3d-ui .best-strip>div{display:flex;align-items:baseline;gap:.45em}
.at3d-ui .best-strip dt{font:600 .68em var(--fu);letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3)}
.at3d-ui .best-strip dd{margin:0;font:600 .88em var(--fu);color:var(--ink)}
.at3d-ui .best-strip dd.is-empty{color:var(--ink-4)}
.at3d-ui .menu-hint,.at3d-ui .vr-note{margin:0;font-size:.76em;color:var(--ink-3);text-align:center;line-height:1.7}
.at3d-ui .vr-note{color:#9cbdb4;border:1px solid rgba(106,156,144,.35);border-radius:3px;padding:.45em .8em;background:rgba(14,24,23,.5)}
.at3d-ui .vr-note b{color:#d6efe8;font-weight:650}
.at3d-ui .diff-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.7em}
.at3d-ui .diff-card{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:.45em;min-height:var(--tap);padding:.95em 1em .9em;margin:0;text-align:left;color:var(--ink);background:linear-gradient(180deg,rgba(34,38,40,.92),rgba(18,20,22,.94));border:1px solid var(--line-2);border-radius:3px;cursor:pointer;transition:border-color .16s,transform .08s}
.at3d-ui .diff-card:active{transform:translateY(1px)}
@media (hover:hover){.at3d-ui .diff-card:hover{border-color:rgba(224,160,80,.55)}}
.at3d-ui .diff-card.is-last{border-color:rgba(224,160,80,.45)}
.at3d-ui .diff-glyph{display:flex;gap:.3em;height:.75em}
.at3d-ui .diff-glyph i{width:.62em;height:.62em;margin-top:.06em;border:1.5px solid var(--ink-3);transform:rotate(45deg)}
.at3d-ui .diff-glyph i.on{background:var(--amber);border-color:var(--amber)}
.at3d-ui .diff-name{font:700 1.3em/1.1 var(--fd);font-variant:small-caps;letter-spacing:.12em;text-transform:lowercase;color:var(--phosphor)}
.at3d-ui .diff-blurb{font-size:.84em;line-height:1.4;color:var(--ink-2)}
.at3d-ui .diff-stats{display:flex;flex-direction:column;gap:.1em;margin-top:auto;padding-top:.55em;width:100%;border-top:1px solid var(--line);font-variant-numeric:tabular-nums}
.at3d-ui .diff-best{font-size:.86em;color:var(--ink-3)}
.at3d-ui .diff-best b{font-weight:650;color:var(--ink)}
.at3d-ui .diff-meta{font-size:.74em;color:var(--ink-4)}
.at3d-ui .diff-tag{position:absolute;top:.75em;right:.8em;font:650 .62em var(--fu);letter-spacing:.14em;text-transform:uppercase;color:var(--amber)}
.at3d-ui .ctl-cols{display:grid;grid-template-columns:1fr 1fr;gap:1.3em}
.at3d-ui .ctl-col-touch{display:none}
html.touch-on .at3d-ui .ctl-col-touch{display:block;order:-1}
html.touch-on .at3d-ui .ctl-col-desktop{display:none}
html.touch-on .at3d-ui .ctl-cols{grid-template-columns:1fr 1fr}
@media (max-width:760px){html.touch-on .at3d-ui .ctl-cols{grid-template-columns:1fr}}
.at3d-ui .bind-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.at3d-ui .bind-list li{display:grid;grid-template-columns:minmax(6.5em,auto) 1fr;gap:.8em;align-items:baseline;padding:.42em 0;border-bottom:1px solid var(--line);font-size:.86em}
.at3d-ui .bind-list li:last-child{border-bottom:0}
.at3d-ui .bind-keys{white-space:nowrap}
.at3d-ui .bind-what{color:var(--ink-2)}
.at3d-ui .settings-body{display:flex;flex-direction:column;gap:1.15em}
.at3d-ui .set-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);align-items:center;gap:.4em 1em;padding:.45em 0;border-bottom:1px solid var(--line)}
.at3d-ui .set-row:last-child{border-bottom:0}
.at3d-ui .set-label{display:flex;flex-direction:column;gap:.1em;min-width:0}
.at3d-ui .set-name{font-weight:600;font-size:.92em}
.at3d-ui .set-desc{margin:0;font-size:.76em;line-height:1.35;color:var(--ink-3)}
.at3d-ui .set-control{display:flex;align-items:center;justify-content:flex-end;min-width:0;gap:.4em}
.at3d-ui .range-wrap{display:flex;align-items:center;gap:.7em;width:100%}
.at3d-ui .range-wrap output{flex:none;min-width:3.4em;text-align:right;font:650 .86em var(--fu);font-variant-numeric:tabular-nums;color:var(--phosphor)}
.at3d-ui input[type=range]{--fill:50%;flex:1;min-width:0;height:var(--tap);margin:0;background:transparent;cursor:pointer;-webkit-appearance:none;appearance:none}
.at3d-ui input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:3px;background:linear-gradient(90deg,var(--amber-2) 0 var(--fill),var(--stone-600) var(--fill) 100%)}
.at3d-ui input[type=range]::-moz-range-track{height:6px;border-radius:3px;background:var(--stone-600)}
.at3d-ui input[type=range]::-moz-range-progress{height:6px;border-radius:3px;background:var(--amber-2)}
.at3d-ui input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;margin-top:-8px;border-radius:50%;background:var(--phosphor);border:3px solid #1a1d1f;box-shadow:0 0 0 1px var(--line-3)}
.at3d-ui input[type=range]::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:var(--phosphor);border:3px solid #1a1d1f}
.at3d-ui input[type=range]:focus-visible{outline-offset:0}
.at3d-ui .seg{display:inline-flex;border:1px solid var(--line-2);border-radius:3px;overflow:hidden}
.at3d-ui .seg button{min-height:var(--tap);min-width:4.2em;padding:0 .9em;border:0;border-right:1px solid var(--line);background:rgba(22,25,27,.9);color:var(--ink-2);font:650 .8em var(--fu);letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.at3d-ui .seg button:last-child{border-right:0}
.at3d-ui .seg button[aria-pressed=true]{background:linear-gradient(180deg,rgba(74,52,27,.95),rgba(36,26,16,.96));color:#fbe7c2;box-shadow:inset 0 -2px 0 var(--amber)}
.at3d-ui .set-actions{display:flex;justify-content:flex-end}
.at3d-ui .set-actions .btn{width:auto;align-items:center}
.at3d-ui .height-actions{flex-wrap:wrap}
.at3d-ui .height-actions .btn{width:auto;align-items:center;text-align:center}
.at3d-ui .btn.is-disabled{opacity:.55}
.at3d-ui .panel-pause{width:min(44em,100%)}
.at3d-ui .pause-cols{display:flex;gap:1.2em}
.at3d-ui .pause-actions{display:grid;grid-template-columns:1fr;gap:.5em;flex:1;min-width:0}
.at3d-ui .pause-actions .btn{align-items:center;text-align:center}
.at3d-ui .pause-warp{flex:1;min-width:0}
.at3d-ui .warp-grid{display:grid;grid-template-columns:1fr 1fr;gap:.4em}
.at3d-ui .warp-btn{display:flex;align-items:baseline;gap:.5em;min-height:var(--tap);padding:.4em .7em;text-align:left;background:rgba(22,25,27,.9);border:1px solid var(--line-2);border-radius:3px;cursor:pointer;font-size:.82em}
.at3d-ui .warp-btn.is-current{border-color:rgba(224,160,80,.55)}
.at3d-ui .warp-num{font:700 1em var(--fd);color:var(--amber);min-width:2.2em}
.at3d-ui .warp-name{color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.at3d-ui .screen-death{cursor:pointer;background:radial-gradient(ellipse 80% 70% at 50% 50%,rgba(12,6,5,.42),rgba(6,3,3,.86)),linear-gradient(180deg,rgba(40,14,8,.15),rgba(0,0,0,.3));animation-duration:.5s}
.at3d-ui .death-wrap{display:flex;flex-direction:column;align-items:center;gap:.6em;width:min(34em,100%);max-height:100%;padding:6px;overflow-y:auto;text-align:center;cursor:default}
.at3d-ui .death-kicker{margin:0;font:400 .8em var(--fd);font-variant:small-caps;letter-spacing:.38em;text-transform:lowercase;color:#c27a5c}
.at3d-ui .death-msg{margin:0;font:400 clamp(1.5em,5.4vmin,2.6em)/1.15 var(--fd);letter-spacing:.03em;color:var(--phosphor);text-shadow:0 4px 24px rgba(0,0,0,.9)}
.at3d-ui .death-stats{margin:0 0 .4em;font-size:.82em;letter-spacing:.08em;color:var(--ink-3);font-variant-numeric:tabular-nums}
.at3d-ui .death-actions{display:grid;grid-template-columns:1fr 1fr;gap:.5em;width:min(22em,100%)}
.at3d-ui .death-actions .btn{align-items:center;text-align:center}
.at3d-ui .death-actions .btn-primary,.at3d-ui .death-actions .btn-vr{grid-column:1/-1}
.at3d-ui .death-prompt{margin:.4em 0 0;font-size:.78em;color:var(--ink-3);animation:at3d-pulse 2.6s ease-in-out infinite}
@keyframes at3d-pulse{0%,100%{opacity:.65}50%{opacity:1}}
.at3d-ui .screen-victory{background:radial-gradient(ellipse 70% 70% at 50% 40%,rgba(40,28,12,.35),rgba(4,5,6,.86))}
.at3d-ui .panel-victory{width:min(44em,100%);overflow:hidden}
.at3d-ui .panel-victory .panel-body{display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:1.4em}
.at3d-ui .victory-lamp{width:.9em;height:.9em;margin-bottom:.9em;background:var(--amber);transform:rotate(45deg);box-shadow:0 0 0 4px rgba(224,160,80,.12),0 0 30px 6px rgba(224,160,80,.45),0 0 90px 30px rgba(224,160,80,.12);animation:at3d-lamp 3.6s ease-in-out infinite}
.at3d-ui .victory-title{margin:.35em 0 .9em;font:400 clamp(1.5em,4.6vmin,2.3em)/1.15 var(--fd);color:var(--phosphor)}
.at3d-ui .victory-time{display:flex;flex-direction:column;align-items:center;gap:.1em;margin-bottom:.9em}
.at3d-ui .victory-time-label{font:650 .68em var(--fu);letter-spacing:.2em;text-transform:uppercase;color:var(--ink-3)}
.at3d-ui .victory-time-value{font:600 clamp(2.1em,7vmin,3.4em)/1.05 var(--fu);font-variant-numeric:tabular-nums;letter-spacing:.02em;color:#fbe7c2}
.at3d-ui .badge-new{display:inline-flex;align-items:center;gap:.35em;margin-top:.3em;padding:.2em .6em;font:750 .72em var(--fu);letter-spacing:.16em;text-transform:uppercase;color:#1a1206;background:var(--amber);border-radius:2px}
.at3d-ui .stat-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:.5em;width:100%;margin:0}
.at3d-ui .stat-grid>div{padding:.5em .4em;background:rgba(255,240,210,.03);border:1px solid var(--line);border-radius:3px}
.at3d-ui .stat-grid dt{font:650 .62em/1.25 var(--fu);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.at3d-ui .stat-grid dd{margin:.15em 0 0;font:600 .98em var(--fu);font-variant-numeric:tabular-nums;color:var(--ink)}
.at3d-ui .stat-grid dd small{display:block;font-size:.72em;font-weight:500;color:var(--ink-3)}
.at3d-ui .victory-note:empty{display:none}
.at3d-ui .victory-actions{display:grid;grid-template-columns:1.4fr 1fr;gap:.55em;width:min(28em,100%);margin-top:1.1em}
.at3d-ui .victory-actions .btn{align-items:center;text-align:center}
.at3d-ui .hud{position:absolute;top:10px;left:12px;right:12px;display:none;justify-content:space-between;align-items:flex-start;pointer-events:none}
.at3d-ui.in-run .hud{display:flex}
.at3d-ui .hud-box{display:flex;flex-direction:column;gap:.15em;padding:.45em .7em;background:rgba(8,9,10,.55);border:1px solid var(--line);border-radius:3px;text-shadow:0 1px 3px rgba(0,0,0,.9)}
.at3d-ui .hud-row{display:flex;align-items:center;gap:.5em}
.at3d-ui .hud-time{font:650 1.05em var(--fu);font-variant-numeric:tabular-nums;color:var(--phosphor);min-width:4.6em;text-align:center}
.at3d-ui .hud-sub{font-size:.8em;color:var(--ink-2);justify-content:center}
.at3d-ui .hud-dot{color:var(--ink-4)}
.at3d-ui .hud-best{font-size:.72em;color:var(--ink-3);text-align:center;font-variant-numeric:tabular-nums}
.at3d-ui .hud-section{font:400 .82em var(--fd);font-variant:small-caps;letter-spacing:.14em;color:var(--amber);text-align:center;opacity:0;transition:opacity .6s}
.at3d-ui .hud-section.is-on{opacity:.9}
.at3d-ui .hud-ecg{display:block;width:9.4em;height:auto;aspect-ratio:2/1;margin-top:.3em;border-radius:2px;background:#020a06}
.at3d-ui .hud-bag{display:block;width:9.4em;height:auto;aspect-ratio:2/1;margin-top:.3em;border-radius:2px;background:#020a06}
.at3d-ui .bag-apply{position:absolute;left:50%;top:calc(50% + 2.6em);transform:translateX(-50%);display:none;flex-direction:column;align-items:center;gap:.3em;min-width:14em;padding:.4em .8em;font:650 .76em var(--fu);letter-spacing:.14em;text-transform:uppercase;color:var(--amber);background:rgba(8,9,10,.7);border:1px solid rgba(224,160,80,.45);border-radius:2px;pointer-events:none}
.at3d-ui .bag-apply b{display:block;width:100%;height:6px;border:1px solid rgba(224,160,80,.7)}
.at3d-ui .bag-apply i{display:block;height:100%;width:var(--p,0%);background:var(--amber)}
.at3d-ui.in-run.screen-none .bag-apply.is-on{display:flex}
.at3d-ui .tglyph{position:relative;display:inline-flex;width:1.75em;height:1.75em}
.at3d-ui .tglyph[data-hand=left]{color:#8fc1b4}
.at3d-ui .tglyph[data-hand=right]{color:#f0b468}
.at3d-ui .tglyph[data-state=idle]{color:var(--ink-3)}
.at3d-ui .tglyph svg{width:100%;height:100%}
.at3d-ui .tglyph g{display:none}
.at3d-ui .tglyph[data-state=idle] .t-idle,.at3d-ui .tglyph[data-state=target] .t-target,.at3d-ui .tglyph[data-state=attached] .t-attached,.at3d-ui .tglyph[data-state=fragile] .t-fragile{display:inline}
.at3d-ui .tglyph i{position:absolute;bottom:-.35em;font:700 .5em var(--fu);font-style:normal;color:var(--ink-3)}
.at3d-ui .tglyph[data-hand=left] i{left:-.2em}
.at3d-ui .tglyph[data-hand=right] i{right:-.2em}
.at3d-ui .hud-gauge{position:relative;width:6px;height:min(46vh,22em);margin-top:3.2em;background:rgba(232,220,192,.08);border:1px solid var(--line);border-radius:3px}
.at3d-ui .hud-gauge-ticks i{position:absolute;left:-3px;right:-3px;height:1px;background:var(--line-3)}
.at3d-ui .hud-gauge-marker{--p:0;position:absolute;left:50%;top:calc(var(--p) * 100%);width:.7em;height:.7em;background:var(--amber);transform:translate(-50%,-50%) rotate(45deg);box-shadow:0 0 10px rgba(224,160,80,.6)}
.at3d-ui .btn-pause{position:absolute;top:10px;right:calc(12px + 1.6em);display:none;align-items:center;justify-content:center;width:var(--tap);height:var(--tap);padding:0;color:var(--ink-2);background:rgba(12,13,14,.6);border:1px solid var(--line-2);border-radius:50%;cursor:pointer;pointer-events:auto}
.at3d-ui .btn-pause svg{width:20px;height:20px;fill:currentColor}
.at3d-ui.in-run.screen-none .btn-pause{display:inline-flex}
.at3d-ui .crosshair{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border:1.5px solid rgba(232,220,192,.45);border-radius:50%;display:none}
.at3d-ui .crosshair i{position:absolute;left:50%;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;background:var(--phosphor);border-radius:50%}
.at3d-ui.in-run.screen-none.locked .crosshair{display:block}
.at3d-ui .capture{position:absolute;left:50%;top:58%;transform:translateX(-50%);padding:.5em 1em;font-size:.86em;color:var(--ink);background:rgba(8,9,10,.78);border:1px solid var(--line-2);border-radius:3px;display:none;white-space:nowrap}
.at3d-ui .capture span{color:var(--ink-4)}
.at3d-ui.playing.screen-none.unlocked .capture{display:block}
.at3d-ui .section-card{position:absolute;z-index:15;top:19%;left:50%;display:flex;flex-direction:column;align-items:center;gap:.3em;width:min(36em,calc(100% - 32px));text-align:center;pointer-events:none;opacity:0;visibility:hidden;transform:translateX(-50%)}
.at3d-ui .section-card.is-on{visibility:visible;animation:at3d-card ${TITLE_TIME - 0.1}s ease both}
@keyframes at3d-card{0%{opacity:0;transform:translate(-50%,8px)}14%{opacity:1;transform:translate(-50%,0)}78%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-4px)}}
.at3d-ui .section-card.is-on.is-cut{animation:at3d-card-cut ${TITLE_CUT}s ease both}
@keyframes at3d-card-cut{0%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-4px)}}
.at3d-ui .section-num{font:400 .82em var(--fd);letter-spacing:.5em;margin-right:-.5em;color:var(--amber)}
.at3d-ui .section-name{font:700 clamp(1.6em,6vmin,3em)/1.1 var(--fd);letter-spacing:.12em;text-transform:uppercase;color:#d8cfbd;text-shadow:0 -1px 0 rgba(0,0,0,.9),0 1px 0 rgba(255,236,200,.12),0 8px 30px rgba(0,0,0,.95)}
.at3d-ui .section-rule{width:5.5em;height:1px;margin:.25em 0;background:linear-gradient(90deg,transparent,rgba(224,160,80,.8),transparent)}
.at3d-ui .section-sub{font:italic 400 1em/1.3 var(--fd);color:var(--ink-2);text-shadow:0 2px 12px rgba(0,0,0,.95)}
.at3d-ui .section-sub:empty,.at3d-ui .section-num:empty,.at3d-ui .section-split:empty{display:none}
.at3d-ui .section-split{margin-top:.2em;font:650 .82em var(--fu);letter-spacing:.16em;font-variant-numeric:tabular-nums;color:var(--amber);text-shadow:0 2px 12px rgba(0,0,0,.95)}
.at3d-ui .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.at3d-ui .rec-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5em;margin-bottom:.8em}
.at3d-ui .rec-tabs .btn{align-items:center;text-align:center;min-height:max(var(--tap),2.4em)}
.at3d-ui .rec-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;table-layout:fixed}
.at3d-ui .rec-table th{padding:.3em .4em;font:650 .66em var(--fu);letter-spacing:.14em;text-transform:uppercase;text-align:left;color:var(--ink-3);border-bottom:1px solid var(--line-2)}
.at3d-ui .rec-table th:first-child{width:2.6em}
.at3d-ui .rec-table td{padding:.45em .4em;border-bottom:1px solid var(--line);font-size:.9em;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.at3d-ui .rec-table td:first-child{font:700 1em var(--fd);color:var(--amber)}
.at3d-ui .rec-table td.is-empty{color:var(--ink-4)}
.at3d-ui .medal{display:inline-flex;align-items:center;gap:.4em;font-weight:650}
.at3d-ui .medal i{flex:none;width:.7em;height:.7em;border-radius:50%;background:var(--mc,#666);box-shadow:0 0 0 2px rgba(0,0,0,.4) inset}
.at3d-ui .v-splits-wrap{width:100%;margin-top:.9em;text-align:left}
.at3d-ui .v-splits{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.25em 1.2em;margin:0;padding:0;list-style:none;font-variant-numeric:tabular-nums;font-size:.86em}
.at3d-ui .v-splits li{display:flex;align-items:baseline;gap:.6em;min-width:0}
.at3d-ui .v-splits b{font:700 1em var(--fd);color:var(--amber);min-width:2.2em}
.at3d-ui .v-splits span{flex:1;min-width:0;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.at3d-ui .v-splits em{font-style:normal;color:var(--ink)}
@media (max-width:760px){.at3d-ui .rec-table th:nth-child(5),.at3d-ui .rec-table td:nth-child(5){display:none}.at3d-ui .v-splits{grid-template-columns:1fr}}
.at3d-ui .hint{position:absolute;z-index:15;left:50%;bottom:calc(10px + 2.4em);max-width:min(34em,calc(100% - 3em));padding:.55em 1em;font-size:.95em;line-height:1.4;text-align:center;color:var(--ink);background:rgba(8,9,10,.8);border:1px solid var(--line-2);border-left:3px solid var(--verdigris-2);border-radius:3px;pointer-events:none;opacity:0;visibility:hidden;transform:translate(-50%,8px);transition:opacity .3s,transform .3s var(--ease),visibility 0s linear .3s}
.at3d-ui .hint.is-on{opacity:1;visibility:visible;transform:translate(-50%,0);transition:opacity .3s,transform .3s var(--ease)}
.at3d-ui .toast{position:absolute;z-index:15;top:calc(10px + .3em);left:50%;display:flex;align-items:center;gap:.55em;max-width:calc(100% - 9em);padding:.4em .9em;font:650 .76em var(--fu);letter-spacing:.16em;text-transform:uppercase;color:var(--phosphor);background:rgba(8,9,10,.74);border:1px solid rgba(224,160,80,.45);border-radius:2px;pointer-events:none;opacity:0;visibility:hidden;transform:translate(-50%,-6px);transition:opacity .3s,transform .3s var(--ease),visibility 0s linear .3s}
.at3d-ui .toast.is-on{opacity:1;visibility:visible;transform:translate(-50%,0);transition:opacity .3s,transform .3s var(--ease)}
.at3d-ui .toast-glyph{flex:none;width:.55em;height:.55em;background:var(--amber);transform:rotate(45deg)}
.at3d-ui:not(.screen-none) .hint,.at3d-ui:not(.screen-none) .toast,.at3d-ui:not(.screen-none) .section-card.is-on{visibility:hidden}
.at3d-ui .xr-note{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:none;align-items:center;gap:.7em;padding:.8em 1.2em;color:#d6efe8;background:rgba(8,9,10,.85);border:1px solid rgba(106,156,144,.5);border-radius:4px}
.at3d-ui .xr-note-glyph{width:2em;color:#bfe3d9}
.at3d-ui .xr-note-glyph svg{display:block;width:100%;fill:none;stroke:currentColor;stroke-width:1.6}
.at3d-ui.is-xr .xr-note{display:flex}
.at3d-ui.is-xr .screen,.at3d-ui.is-xr .hud,.at3d-ui.is-xr .hint,.at3d-ui.is-xr .toast,.at3d-ui.is-xr .section-card,.at3d-ui.is-xr .crosshair,.at3d-ui.is-xr .capture,.at3d-ui.is-xr .btn-pause{display:none!important}
.at3d-ui .menu-update{display:flex;align-items:center;justify-content:center;gap:.5em;min-height:var(--tap);padding:.3em 1em;color:#fbe7c2;background:rgba(74,52,27,.55);border:1px solid rgba(224,160,80,.6);border-radius:3px;font:650 .8em var(--fu);letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
.at3d-ui .menu-update span{color:var(--amber)}
.at3d-ui .btn-inline{display:inline-flex;width:auto;min-height:var(--tap);margin-left:.6em;align-items:center;vertical-align:middle}
.at3d-ui .menu-about-sub{color:var(--amber)}
.at3d-ui .about-body{display:flex;flex-direction:column;gap:.7em}
.at3d-ui .about-list{display:flex;flex-direction:column;margin:0}
.at3d-ui .about-list>div{display:grid;grid-template-columns:7em 1fr;gap:.8em;align-items:baseline;padding:.45em 0;border-bottom:1px solid var(--line);font-size:.9em}
.at3d-ui .about-list dt{font:650 .74em var(--fu);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.at3d-ui .about-list dd{margin:0;color:var(--ink-2);word-break:break-word}
.at3d-ui .about-list a{color:var(--phosphor);text-decoration-color:var(--line-3)}
.at3d-ui .about-credits{margin:0;font-size:.86em;line-height:1.55;color:var(--ink-2)}
.at3d-ui .btn.is-armed{border-color:rgba(194,122,92,.8)}
.at3d-ui .patches{display:block;width:100%;height:auto;margin-top:.4em;border-radius:3px;background:#000}
.at3d-ui .teaser{width:100%;margin:1em 0 0;padding:.75em .9em;text-align:center;border:1px solid var(--line-2);border-radius:3px;background:linear-gradient(180deg,rgba(255,240,210,.045),rgba(255,240,210,.01))}
.at3d-ui .teaser p{margin:0}
.at3d-ui .teaser-kicker{font:400 .86em var(--fd);font-variant:small-caps;letter-spacing:.34em;text-transform:lowercase;color:var(--amber)}
.at3d-ui .teaser-names{display:flex;flex-wrap:wrap;justify-content:center;gap:.2em 1.2em;margin-top:.45em!important;font:700 .9em var(--fd);letter-spacing:.06em;color:var(--ink)}
.at3d-ui .teaser-line{margin-top:.4em!important;font:italic 400 .86em var(--fd);color:var(--ink-3)}
.at3d-ui .hud-status{display:flex;gap:.7em;justify-content:center;font:650 .74em var(--fu);letter-spacing:.06em;color:var(--ink);font-variant-numeric:tabular-nums}
.at3d-ui .hud-status span{display:inline-flex;align-items:center;gap:.3em}
.at3d-ui .hud-status svg{width:1em;height:1em;fill:none;stroke:currentColor;stroke-width:2}
.at3d-ui .hud-status em{font-style:normal;font-size:.8em;color:var(--ink-3)}
.at3d-ui .hud-status b{font-weight:700}
.at3d-ui .hud-status .warn{color:#ffd9a0;text-decoration:underline}
.at3d-ui .captions{position:absolute;z-index:15;left:50%;bottom:calc(10px + 6.2em);display:flex;flex-direction:column;align-items:center;gap:.3em;width:min(34em,calc(100% - 3em));transform:translateX(-50%);pointer-events:none}
.at3d-ui .cap{display:flex;align-items:center;gap:.6em;max-width:100%;padding:.3em .8em;font-size:.95em;line-height:1.3;color:#fff;background:rgba(0,0,0,.82);border-radius:3px;border-left:3px solid var(--ink-3)}
.at3d-ui .cap[data-sev="2"]{font-weight:700;border-left-color:var(--amber)}
.at3d-ui .cap i{flex:none;width:.7em;height:.7em;background:currentColor}
.at3d-ui .cap i.diamond{transform:rotate(45deg)}
.at3d-ui .cap i.circle{border-radius:50%}
.at3d-ui .cap .cap-dir{flex:none;min-width:2.4em;font:650 .7em var(--fu);letter-spacing:.06em;text-transform:uppercase;color:var(--ink-2)}
.at3d-ui.is-xr .captions{display:none!important}
@media (max-width:760px){.at3d-ui .diff-grid,.at3d-ui .ctl-cols{grid-template-columns:1fr}.at3d-ui .stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.at3d-ui .pause-cols{flex-direction:column}.at3d-ui .set-row{grid-template-columns:1fr}.at3d-ui .set-control{justify-content:flex-start}.at3d-ui .hud-gauge{display:none}.at3d-ui .menu-hint{display:none}}
@media (max-height:560px){.at3d-ui .menu-wrap{gap:.7em}.at3d-ui .tagline,.at3d-ui .menu-hint{display:none}}
@media (prefers-reduced-motion:reduce){.at3d-ui .screen,.at3d-ui .screen>*{animation:none!important}}
`;

// =============================================================================
// UI3D
// =============================================================================
export class UI3D {
  /** @param {Game3D} game */
  constructor(game) {
    this.game = game || null;
    /** Current screen name, or null while the game view is unobstructed. */
    this.current = null;
    this._ready = false;
    this._pending = undefined;
    this._returnTo = 'menu';
    this._opener = null;
    this._modality = 'none';
    this._vrSupported = false;
    this._vrChecked = false;
    this._hadXR = false; // an immersive session has run (and ended) on this page
    this._forceVR = false;
    this._xr = false;
    this._clock = 0;
    this._deathInfo = null;
    this._victoryInfo = null;
    this._deathArmedAt = 0;
    this._deathTimer = -1;
    this._warpLevel = null;
    this._ctl = Object.create(null);
    this._listeners = [];
    this._busOff = [];
    this._lastTitle = { text: '', t: -10 };
    this._lastToast = { text: '', t: -10 };
    // Section records (P6): the difficulty shown on the Records screen, this run's splits, a split waiting for its title card.
    this._recDiff = null;
    this._runSplits = [];
    this._pendingSplit = null;

    // HUD caches (compared before every DOM write).
    this._hud = { acc: HUD_INTERVAL, inRun: null, time: '', depthM: -1, gauge: -1, section: -1, sectionT: 0, diffKey: '', level: null, tl: '', tr: '', cls: -1, ecg: -1, bag: -1, apply: -1, applyKind: -1 };
    // Notes (hint / section title / toast), shared by DOM and VR.
    this._hint = { text: '', src: null, vr: false, t: 0, on: false, dirty: false, tutorial: false };
    this._title = { name: '', sub: '', num: '', split: '', t: 0, dirty: false };
    this._toast = { text: '', t: 0, dirty: false };

    // VR state (built lazily).
    this._vr = null;
    this._vrDirty = true;
    this._vrSetPage = 0; // VR settings: 0 = general, 1 = player height
    this._vrTab = 0; // VR settings: index into TABS
    this._armed = ''; // a destructive button pressed once ('erase-data'): the second press within 4 s does it
    this._armedT = 0;
    this._eraseMsg = '';
    this._xrScaleApplied = { tier: undefined, scale: NaN, baseExposure: 0, expMul: 1 };
    this._textScale = 1;
    this._capRev = -1;
    this._capShown = 0;
    this._statusKey = '';
    this._tut = null;
    this._caps = null;
    this._comfort = null;
    this._updateReady = false;
    this._cal = null; // height calibration countdown { t } while running
    this._calMsg = ''; // result / error line of the last calibration press
    this._heightKey = ''; // the status text last painted (a change repaints the panel)
    this._heightDom = null; // DOM status line + buttons of the settings screen
    this._regions = [];
    this._hover = null;
    this._lastClickAt = -10;
    this._needRecenter = true;
    this._capDirty = true;
    this._wristAcc = WRIST_INTERVAL;
    this._wristKey = '';
    this._gripCheckT = 0;
    this._grip = null;
    // Scratch (allocation-free per frame).
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._head = { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0, ok: false };
    this._ctrlLostShown = false;
    this._prevBack = false;
    this._prevConfirm = false;
    this._noteYaw = 0;
    this._noteYawSet = false;
  }

  // ------------------------------------------------------------------ setup
  /** Builds the DOM overlay, binds input + bus, checks VR support, shows the menu. */
  init() {
    if (this._ready) return;
    if (typeof document === 'undefined') return;
    this._injectStyle();
    this.root = this._findRoot();
    this.root.classList.add('at3d-ui');
    this.root.insertAdjacentHTML('beforeend', MARKUP);
    const q = (sel) => this.root.querySelector(sel);
    this.screens = Object.create(null);
    for (const name of SCREENS) this.screens[name] = q(`.screen[data-screen="${name}"]`);
    this.dom = {
      hudTime: q('.hud-time'),
      hudDepth: q('.hud-depth'),
      hudDiff: q('.hud-diff'),
      hudBest: q('.hud-best'),
      hudSection: q('.hud-section'),
      hudEcg: q('.hud-ecg'), // heart monitor: a copy of healthFx.ecgCanvas (the same picture as the wrist screen in VR)
      hudBag: q('.hud-bag'), // the bag: a copy of bagFx.iconCanvas (the same picture as the wrist screen in VR)
      bagApply: q('.bag-apply'),
      bagApplyLabel: q('.bag-apply-label'),
      bagApplyFill: q('.bag-apply i'),
      glyph: { left: q('.tglyph[data-hand="left"]'), right: q('.tglyph[data-hand="right"]') },
      gaugeMarker: q('.hud-gauge-marker'),
      gaugeTicks: q('.hud-gauge-ticks'),
      sectionCard: q('.section-card'),
      sectionNum: q('.section-num'),
      sectionName: q('.section-name'),
      sectionSub: q('.section-sub'),
      hint: q('.hint'),
      toast: q('.toast'),
      toastText: q('.toast-text'),
      startSub: q('.menu-start-sub'),
      startLabel: q('.menu-start-label'),
      startBtn: q('.btn-start'),
      continueBtn: q('.btn-continue'),
      continueSub: q('.menu-continue-sub'),
      diffBtn: q('.menu-diff'),
      aboutSub: q('.menu-about-sub'),
      updateBtn: q('.menu-update'),
      hudStatus: q('.hud-status'),
      captions: q('.captions'),
      aboutVersion: q('.about-version'),
      aboutUpdate: q('.about-update'),
      aboutUpdateBtn: q('.about-body [data-action="apply-update"]'),
      aboutPrivacy: q('.about-privacy'),
      aboutSupport: q('.about-support'),
      aboutCredits: q('.about-credits'),
      aboutErase: q('.about-erase'),
      vHealth: q('.v-health'),
      vItems: q('.v-items'),
      vrBtn: q('.menu-actions [data-action="enter-vr"]'),
      vrReturn: [...this.root.querySelectorAll('.btn-vr-return')],
      vrNote: q('.vr-note'),
      bestStrip: q('.best-strip'),
      diffGrid: q('.diff-grid'),
      ctlQuest: q('.ctl-quest'),
      ctlDesktop: q('.ctl-desktop'),
      ctlTouch: q('.ctl-touch'),
      settingsBody: q('.settings-body'),
      pauseStats: q('.pause-stats'),
      pauseRespawn: q('.pause-respawn'),
      pauseWarp: q('.pause-warp'),
      warpGrid: q('.warp-grid'),
      deathKicker: q('.death-kicker'),
      deathMsg: q('.death-msg'),
      deathStats: q('.death-stats'),
      deathContinue: q('.death-continue'),
      deathContinueSub: q('.death-continue-sub'),
      deathPrompt: q('.death-prompt'),
      vTime: q('.v-time'),
      vNew: q('.v-new'),
      vBest: q('.v-best'),
      vDeaths: q('.v-deaths'),
      vDiff: q('.v-diff'),
      vNote: q('.v-note'),
      vSplitsWrap: q('.v-splits-wrap'),
      vSplits: q('.v-splits'),
      sectionSplit: q('.section-split'),
      recTabs: q('.rec-tabs'),
      recBody: q('.rec-table tbody'),
      recTally: q('.rec-tally'),
      recordsSub: q('.menu-records-sub'),
    };
    this._buildBestStrip();
    this._buildDifficultyCards();
    this._buildControls();
    this._buildSettings();
    this._buildAbout();
    this._buildCaptionLines();
    this._bindDom();
    this._bindBus();
    this._startUx();
    this.syncSettings();
    this._checkVR();
    this._ready = true;
    this.refreshMenu();
    const game = this.game || {};
    let first = this._pending;
    if (first === undefined) first = !game.state || game.state === 'menu' ? 'menu' : null;
    const info = this._pendingInfo;
    this.current = undefined; // force a full apply
    this.show(first, info);
  }

  _injectStyle() {
    if (document.getElementById('at3d-ui-style')) return;
    const st = document.createElement('style');
    st.id = 'at3d-ui-style';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /** The game shell's UI root (#ui / #ui-root / [data-ui-root]); created when missing. */
  _findRoot() {
    const el = document.getElementById('ui') || document.getElementById('ui-root') || document.querySelector('[data-ui-root]');
    if (el) return el;
    const div = document.createElement('div');
    div.id = 'ui';
    document.body.appendChild(div);
    return div;
  }

  _on(target, type, fn, opts) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn, opts]);
  }

  _bindDom() {
    this._on(this.root, 'click', (e) => this._onClick(e));
    this._on(this.root, 'input', (e) => this._onInput(e));
    this._on(window, 'keydown', (e) => this._onKeyDown(e), true);
    this._on(window, 'pointerdown', () => (this._modality = 'pointer'), true);
    this._on(document, 'pointerlockchange', () => this._syncRootClasses());
  }

  _bindBus() {
    const bus = this.game && this.game.bus;
    if (!bus || typeof bus.on !== 'function') return;
    const on = (type, fn) => {
      const off = bus.on(type, (p) => {
        try {
          fn(p || {});
        } catch (err) {
          if (typeof console !== 'undefined') console.error(`[AT3D] UI handler for ${type} failed`, err);
        }
      });
      if (typeof off === 'function') this._busOff.push(off);
    };
    on('settings:changed', () => this.syncSettings());
    on('game:start', () => {
      this._runSplits.length = 0;
      this._pendingSplit = null;
      this._resetHud();
      this.hideHint();
      this._deathTimer = -1;
      if (this.current !== null) this.show(null);
    });
    on('game:restart', () => {
      this._runSplits.length = 0;
      this._pendingSplit = null;
      this._resetHud();
      this.hideHint();
      this._deathTimer = -1;
      if (this.current !== null) this.show(null);
    });
    on('game:respawn', () => {
      this._deathTimer = -1;
      if (this.current === 'death' || this.current === 'pause') this.show(null);
    });
    on('game:pause', () => {
      if (this.current === null) this.show('pause');
    });
    on('game:resume', () => {
      if (this.current !== null && this.current !== 'menu' && this.current !== 'victory') this.show(null);
    });
    on('game:menu', () => {
      this.hideHint();
      this._deathTimer = -1;
      if (this.current !== 'menu') this.show('menu');
    });
    on('player:death', () => {
      this.hideHint();
      this._deathTimer = DEATH_FALLBACK;
    });
    on('game:victory', (p) => {
      this.hideHint();
      this._deathTimer = -1;
      if (this.current !== 'victory') this.showVictory(this._victoryFrom(p));
    });
    // A section played whole (game.js 'split', sim/splits3d.js): its line goes on the next section's title card, or a toast.
    on('split', (p) => this._onSplit(p));
    on('section:enter', (p) => {
      const sp = this._pendingSplit;
      this._pendingSplit = null;
      if (p.first && p.section) this.showSectionTitle(p.section.name, p.section.subtitle, num(p.index, -1), sp && sp.index === num(p.index, -1) - 1 ? sp.line : '');
      else if (sp) this.showToast(sp.line, 3.2);
    });
    on('creature:sighting', () => {
      // The first sight of the creature must not sit behind a title card ('IV The
      // Listening Vault' is often still up on a fast route): fade it out quickly.
      const t = this._title;
      if (t.t <= TITLE_CUT) return;
      t.t = TITLE_CUT; // VR: opacity follows t.t / 1 s from here
      if (this.dom) this.dom.sectionCard.classList.add('is-cut');
    });
    on('checkpoint', () => this.showToast('Checkpoint', 2.2));
    on('hint', (p) => this.showHint(p.hint && typeof p.hint === 'object' ? p.hint : p.text || p, num(p.duration, num(p.seconds, 0))));
    on('continue:changed', () => this.refreshMenu());
    on('app:update-ready', () => {
      this._updateReady = true;
      this.refreshMenu();
      if (this.current === 'about') this._fillAbout();
    });
    on('xr:recenter', () => this.recenter());
    on('xr:recentered', () => this.recenter());
    on('input:recenter', () => this.recenter());
  }

  /** Is an immersive-vr session supported here? Shows 'Enter VR' or the how-to note. */
  _checkVR() {
    const done = (ok) => {
      this._vrChecked = true;
      this._vrSupported = !!ok;
      this._syncVRBlock();
      // Pay for the VR canvases / meshes while still on the 2D page, not on the first immersive frame.
      if (ok && !this._vr) {
        const build = () => {
          try {
            this._ensureVR();
            if (this._vr && !this.vrMode) this._hideVR();
          } catch (err) {
            if (typeof console !== 'undefined') console.warn('[AT3D] VR UI prebuild failed', err);
          }
        };
        if (typeof requestIdleCallback === 'function') requestIdleCallback(build, { timeout: 2000 });
        else setTimeout(build, 300);
      }
    };
    try {
      const input = this.game && this.game.input;
      let p = null;
      if (input && typeof input.isVRSupported === 'function') p = input.isVRSupported();
      else if (typeof navigator !== 'undefined' && navigator.xr && typeof navigator.xr.isSessionSupported === 'function') {
        p = navigator.xr.isSessionSupported('immersive-vr');
      }
      if (p && typeof p.then === 'function') p.then(done, () => done(false));
      else done(!!p);
    } catch {
      done(false);
    }
  }

  _syncVRBlock() {
    const d = this.dom;
    if (!d) return;
    const vr = this._vrSupported;
    d.vrBtn.hidden = !vr;
    // Pause / death: a way back into the headset that keeps the run (the session can end
    // mid-run through Exit VR, the Quest browser or the system). After a session ended it is
    // the screen's first choice; before any session it reads 'Enter VR'.
    for (const b of d.vrReturn) {
      b.hidden = !vr;
      const lab = b.querySelector('.btn-label');
      if (lab) lab.textContent = this._hadXR ? 'Return to VR' : 'Enter VR';
      if (vr && this._hadXR && b.closest('.pause-actions')) b.setAttribute('data-autofocus', '');
      else b.removeAttribute('data-autofocus');
    }
    // Menu: in a headset's own browser (the Quest Browser's 2D page) Enter VR is the primary
    // action — 'Begin descent' starts a flat mouse-and-keyboard run a controller cannot play.
    // A desktop browser that merely has a VR runtime installed keeps Begin descent first.
    const start = d.startBtn;
    if (start && d.vrBtn.parentNode === start.parentNode) {
      if (this._vrFirst()) {
        if (d.vrBtn.nextElementSibling !== d.continueBtn) start.parentNode.insertBefore(d.vrBtn, d.continueBtn);
        d.vrBtn.classList.add('btn-primary');
        d.vrBtn.setAttribute('data-autofocus', '');
        start.classList.remove('btn-primary');
        start.removeAttribute('data-autofocus');
      } else {
        if (start.nextElementSibling !== d.vrBtn) start.parentNode.insertBefore(d.vrBtn, start.nextElementSibling);
        d.vrBtn.classList.remove('btn-primary');
        d.vrBtn.removeAttribute('data-autofocus');
        start.classList.add('btn-primary');
        start.setAttribute('data-autofocus', '');
      }
    }
    if (this._ready) this.refreshMenu();
    const secure = typeof window === 'undefined' || window.isSecureContext !== false;
    d.vrNote.hidden = this._vrSupported || !this._vrChecked;
    if (!this._vrSupported) {
      d.vrNote.textContent = '';
      d.vrNote.append(
        make('b', null, 'Play in VR: '),
        document.createTextNode('open this page in the Meta Quest Browser on your headset and press Enter VR.'),
      );
      if (!secure) d.vrNote.append(document.createTextNode(' WebXR needs HTTPS — use the published site.'));
      d.vrNote.append(document.createTextNode(' On this device, play with mouse and keyboard.'));
    }
  }

  /** VR supported AND this is a standalone headset's browser (Quest / Pico / Wolvic). */
  _vrFirst() {
    if (!this._vrSupported) return false;
    const ua = typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : '';
    return /OculusBrowser|Quest|Pico|Wolvic|\bVR\b/.test(ua);
  }

  // ------------------------------------------------------------------ screens
  /**
   * Shows a screen by name, or the bare game view with `null`.
   * @param {'menu'|'title'|'difficulty'|'controls'|'settings'|'pause'|'death'|'victory'|null} name
   * @param {object} [info] death: {cause, deaths, canRespawn, depthMeters, time, message};
   *   victory: {time, best, previous, isNew, deaths, deepestMeters, difficultyKey, label}
   */
  show(name, info) {
    if (name === undefined || name === 'none' || name === 'game') name = null;
    if (name === 'title' || name === 'main') name = 'menu';
    if (name === 'end') name = 'victory';
    if (name !== null && SCREENS.indexOf(name) < 0) {
      if (typeof console !== 'undefined') console.warn(`[AT3D] UI.show: unknown screen "${name}"`);
      return;
    }
    if (!this._ready) {
      this._pending = name;
      this._pendingInfo = info;
      this.current = name;
      return;
    }
    if (name === 'calibrate' && !this.vrMode) name = 'settings'; // the desktop shows the sliders inline
    if (name === 'death') this._fillDeath(info);
    else if (name === 'victory') this._fillVictory(info);
    else if (name === 'about') this._fillAbout();
    else if (name === 'records') this._fillRecords();

    const prev = this.current;
    const game = this.game || {};
    if (SUB_SCREENS[name] && prev !== name) {
      if (prev === 'menu' || prev === 'pause') this._returnTo = prev;
      else this._returnTo = game.state === 'paused' ? 'pause' : 'menu';
      const active = document.activeElement;
      this._opener = prev === 'menu' || prev === 'pause' ? { screen: prev, el: active && this.screens[prev].contains(active) ? active : null } : null;
    }
    this.current = name;
    this._disarm();
    for (const n of SCREENS) {
      const el = this.screens[n];
      if (el && el.hidden === (n === name)) el.hidden = n !== name;
    }
    if (name === 'menu') this.refreshMenu();
    else if (name === 'difficulty') this._refreshDifficulty();
    else if (name === 'settings') this.syncSettings();
    if (name === 'calibrate' && !this._settings().brightnessChecked) this._applySettings({ brightnessChecked: true });
    if (name !== 'settings') {
      this._vrSetPage = 0;
      if (this._cal) {
        this._cal = null;
        this._calMsg = '';
      }
    }
    if (name === 'pause') this._preparePause();
    else if (name === 'death') this._deathArmedAt = this._clock + DEATH_ARM;
    if (name !== null) this._deathTimer = -1;
    this._syncRootClasses();

    if (name === null) {
      const active = document.activeElement;
      if (active && active !== document.body && this.root.contains(active) && typeof active.blur === 'function') active.blur();
    } else {
      // Desktop: free the mouse for the DOM menus — except on the death screen, which keeps
      // the pointer captured so a click (or Enter) rises again at once (Game3D's rule).
      if (!this._xr && name !== 'death') this._releasePointer();
      if (prev !== name) this._focusInitial(name, prev);
    }
    // VR: a newly opened panel re-centres in front of the head.
    this._vrDirty = true;
    this._hover = null;
    if (name !== null && (prev === null || prev === undefined || prev !== name)) {
      if (prev === null || prev === undefined) this._needRecenter = true;
      else this._recenterIfAway = true;
    }
  }

  _syncRootClasses() {
    if (!this.root) return;
    const g = this.game || {};
    const st = g.state;
    const inRun = st === 'playing' || st === 'paused' || st === 'dead' || st === 'victory';
    const locked = typeof document !== 'undefined' && !!document.pointerLockElement;
    // Numeric key (no per-frame string building): screen index + 4 flags.
    const cls = (SCREENS.indexOf(this.current) + 2) * 16 + (inRun ? 8 : 0) + (st === 'playing' ? 4 : 0) + (locked ? 2 : 0) + (this._xr ? 1 : 0);
    if (cls === this._hud.cls) return;
    this._hud.cls = cls;
    const c = this.root.classList;
    for (const n of SCREENS) c.toggle(`screen-${n}`, this.current === n);
    c.toggle('screen-none', this.current === null);
    c.toggle('in-run', inRun);
    c.toggle('playing', st === 'playing');
    c.toggle('locked', locked);
    c.toggle('unlocked', !locked);
    c.toggle('is-xr', this._xr);
    this.root.dataset.screen = this.current || 'none';
  }

  _focusInitial(name, prev) {
    const screen = this.screens[name];
    if (!screen || this._xr) return;
    if (this._modality === 'none' && name !== 'death') return;
    if (this._opener && this._opener.screen === name && SUB_SCREENS[prev]) {
      const el = this._opener.el;
      this._opener = null;
      if (el && screen.contains(el) && isVisible(el)) {
        el.focus({ preventScroll: true });
        return;
      }
    }
    let target = null;
    for (const el of screen.querySelectorAll('[data-autofocus]')) {
      if (isVisible(el) && !el.disabled) {
        target = el;
        break;
      }
    }
    if (!target) target = this._focusables(screen)[0] || null;
    if (target) target.focus({ preventScroll: true });
  }

  _back() {
    if (this._xr && this.current === 'settings' && this._vrSetPage) {
      this._vrSetPage = 0;
      this._vrDirty = true;
      return;
    }
    if (this.current === 'calibrate') {
      this.show('settings');
      return;
    }
    const state = this.game && this.game.state;
    let target = this._returnTo || 'menu';
    if (state === 'paused') target = 'pause';
    else if (state === 'menu' || !state) target = 'menu';
    else if (state === 'playing') target = null;
    this.show(target);
  }

  // ------------------------------------------------------------------ menu / difficulty
  _defaultDifficulty() {
    const s = this.game && this.game.settings;
    const last = s && s.lastDifficulty;
    return last && DIFFICULTY_ORDER.indexOf(last) >= 0 ? last : 'normal';
  }

  /** Best times on the menu, the Begin sub-label and the difficulty cards. */
  refreshMenu() {
    if (!this.dom) return;
    const key = this._defaultDifficulty();
    const diff = DIFFICULTY[key];
    const best = Storage.getBest(key);
    const cont = this._continueInfo();
    const d = this.dom;
    // Continue (the saved run) leads when there is one; 'New descent' then opens the difficulty chooser instead of starting at once.
    d.continueBtn.hidden = !cont;
    d.diffBtn.hidden = !!cont;
    if (cont) {
      d.continueSub.textContent = this._continueLine(cont);
      d.startLabel.textContent = 'New descent';
      d.startBtn.dataset.action = 'difficulty';
      d.startBtn.classList.remove('btn-primary');
      d.startSub.textContent = 'Choose a difficulty · replaces the saved run';
      d.startBtn.removeAttribute('data-autofocus');
      d.continueBtn.setAttribute('data-autofocus', '');
    } else {
      d.startLabel.textContent = 'Begin descent';
      d.startBtn.dataset.action = 'start';
      d.continueBtn.removeAttribute('data-autofocus');
      if (!this._vrFirst()) d.startBtn.classList.add('btn-primary');
    }
    d.updateBtn.hidden = !this._updateReady || this._xr;
    d.aboutSub.hidden = !this._updateReady;
    // With VR first on the menu, the flat run says what it is.
    if (cont) {
      // (sub-label set above)
    } else if (this._vrFirst()) this.dom.startSub.textContent = `Flat screen · mouse & keyboard · ${diff.label}`;
    else this.dom.startSub.textContent = best != null ? `${diff.label} · best ${fmtTime(best)}` : diff.label;
    if (this._bestCells) {
      for (const k of DIFFICULTY_ORDER) {
        const dd = this._bestCells[k];
        const b = Storage.getBest(k);
        dd.textContent = b != null ? fmtTime(b) : '—';
        dd.classList.toggle('is-empty', b == null);
      }
    }
    if (d.recordsSub) {
      const line = tallyLine(medalTally(this._recordRowsFor(key)));
      d.recordsSub.textContent = line ? `${diff.label} · ${line.split(' · ').slice(0, 2).join(' · ')}` : '';
      d.recordsSub.hidden = !line;
    }
    this._refreshDifficulty();
    this._vrDirty = true;
  }

  /** The saved run for the Continue button (game.canContinue / save.continueInfo), or null. */
  _continueInfo() {
    const g = this.game || {};
    try {
      if (typeof g.canContinue === 'function' && !g.canContinue()) return null;
      const info = g.save && typeof g.save.continueInfo === 'function' ? g.save.continueInfo() : null;
      return info && typeof info === 'object' ? info : null;
    } catch {
      return null;
    }
  }

  _continueLine(info) {
    const sec = info.sectionName ? info.sectionName : `Section ${(info.section | 0) + 1}`;
    return `${info.label || 'Normal'} · ${sec} · ${fmtTime(num(info.time, 0))}`;
  }

  _buildBestStrip() {
    const dl = this.dom.bestStrip;
    dl.textContent = '';
    this._bestCells = Object.create(null);
    for (const k of DIFFICULTY_ORDER) {
      const wrap = make('div');
      const dd = make('dd', 'is-empty', '—');
      wrap.append(make('dt', null, DIFFICULTY[k].label), dd);
      dl.appendChild(wrap);
      this._bestCells[k] = dd;
    }
  }

  _buildDifficultyCards() {
    const grid = this.dom.diffGrid;
    grid.textContent = '';
    this._diffCards = Object.create(null);
    DIFFICULTY_ORDER.forEach((k, i) => {
      const d = DIFFICULTY[k];
      const b = make('button', 'diff-card');
      b.type = 'button';
      b.dataset.action = 'start-diff';
      b.dataset.diff = k;
      const glyph = make('span', 'diff-glyph');
      for (let j = 0; j < 3; j++) glyph.appendChild(make('i', j <= i ? 'on' : null));
      const tag = make('span', 'diff-tag', 'Last');
      tag.hidden = true;
      const stats = make('span', 'diff-stats');
      const best = make('span', 'diff-best');
      const meta = make('span', 'diff-meta');
      stats.append(best, meta);
      b.append(glyph, tag, make('span', 'diff-name', d.label), make('span', 'diff-blurb', d.blurb), stats);
      grid.appendChild(b);
      this._diffCards[k] = { b, tag, best, meta };
    });
  }

  _refreshDifficulty() {
    if (!this._diffCards) return;
    const last = this._defaultDifficulty();
    for (const k of DIFFICULTY_ORDER) {
      const c = this._diffCards[k];
      const best = Storage.getBest(k);
      const deep = num(Storage.get(`deepest.${k}`, 0), 0);
      c.best.textContent = '';
      c.best.append('Best ', make('b', null, best != null ? fmtTime(best) : '—'));
      c.meta.textContent = deep > 0 ? `Deepest ${fmtMeters(deep)}` : 'Not yet descended';
      c.tag.hidden = k !== last;
      c.b.classList.toggle('is-last', k === last);
      c.b.setAttribute('aria-label', `${DIFFICULTY[k].label}. ${DIFFICULTY[k].blurb} Best ${best != null ? fmtTime(best) : 'none'}.`);
    }
  }

  // ------------------------------------------------------------------ controls
  _buildControls() {
    const fill = (ul, rows) => {
      ul.textContent = '';
      for (const [keys, what] of rows) {
        const li = make('li');
        const k = make('span', 'bind-keys');
        keys.forEach((key, i) => {
          if (i) k.append(' ');
          k.appendChild(make('kbd', null, key));
        });
        li.append(k, make('span', 'bind-what', what));
        ul.appendChild(li);
      }
    };
    fill(this.dom.ctlQuest, CONTROLS_QUEST);
    fill(this.dom.ctlDesktop, CONTROLS_DESKTOP);
    fill(this.dom.ctlTouch, CONTROLS_TOUCH);
  }

  // ------------------------------------------------------------------ settings
  _settings() {
    const g = this.game;
    return g && g.settings ? g.settings : SETTINGS_DEFAULTS;
  }

  _buildSettings() {
    const body = this.dom.settingsBody;
    body.textContent = '';
    for (const tab of TABS) {
      const group = make('div', 'set-group');
      group.appendChild(make('h3', 'group-title', tab.title));
      body.appendChild(group);
      for (const def of SETTINGS_SCHEMA) {
        if (def.tab !== tab.id || def.vr) continue;
        if (def.type === 'height') {
          this._buildHeightBlock(group);
          continue;
        }
        if (def.type === 'patches') {
          const c = make('canvas', 'patches');
          c.width = 936;
          c.height = 120;
          c.setAttribute('role', 'img');
          c.setAttribute('aria-label', 'Black level test: eight dark squares; the second should be just visible.');
          group.appendChild(c);
          this._patchesCanvas = c;
          continue;
        }
        const row = make('div', 'set-row');
        const label = make('div', 'set-label');
        const id = `at3d-set-${def.key}`;
        const name = make('label', 'set-name', def.label);
        name.htmlFor = id;
        label.appendChild(name);
        if (def.desc) label.appendChild(make('p', 'set-desc', def.desc));
        const ctl = make('div', 'set-control');
        if (def.type === 'range') {
          const wrap = make('div', 'range-wrap');
          const input = make('input');
          input.type = 'range';
          input.id = id;
          input.min = String(def.min);
          input.max = String(def.max);
          input.step = String(def.step);
          input.dataset.key = def.key;
          const out = make('output');
          out.htmlFor = id;
          wrap.append(input, out);
          ctl.appendChild(wrap);
          this._ctl[def.key] = { def, input, out };
        } else {
          const seg = make('div', 'seg');
          seg.setAttribute('role', 'group');
          seg.setAttribute('aria-label', def.label);
          const opts = def.type === 'toggle' ? [[true, 'On'], [false, 'Off']] : def.options;
          const btns = [];
          for (const [value, text] of opts) {
            const b = make('button', null, text);
            b.type = 'button';
            b.dataset.action = 'set';
            b.dataset.key = def.key;
            b.dataset.value = String(value);
            if (btns.length === 0) b.id = id;
            seg.appendChild(b);
            btns.push([value, b]);
          }
          ctl.appendChild(seg);
          this._ctl[def.key] = { def, btns };
        }
        row.append(label, ctl);
        group.appendChild(row);
      }
    }
    const actions = make('div', 'set-actions');
    const reset = make('button', 'btn btn-ghost');
    reset.type = 'button';
    reset.dataset.action = 'reset-settings';
    reset.appendChild(make('span', 'btn-label', 'Reset to defaults'));
    actions.appendChild(reset);
    body.appendChild(actions);
  }

  /** DOM: the measured eye height, Calibrate and Reset buttons (the player-height block of the settings screen). */
  _buildHeightBlock(parent) {
    const row = make('div', 'set-row set-height');
    const label = make('div', 'set-label');
    label.appendChild(make('span', 'set-name', 'Calibrate'));
    const status = make('p', 'set-desc height-status');
    status.setAttribute('aria-live', 'polite');
    label.appendChild(status);
    const ctl = make('div', 'set-control height-actions');
    const calibrate = make('button', 'btn btn-primary');
    calibrate.type = 'button';
    calibrate.dataset.action = 'calibrate-height';
    calibrate.appendChild(make('span', 'btn-label', 'Calibrate'));
    const reset = make('button', 'btn btn-ghost');
    reset.type = 'button';
    reset.dataset.action = 'reset-height';
    reset.appendChild(make('span', 'btn-label', 'Reset height'));
    ctl.append(calibrate, reset);
    row.append(label, ctl);
    parent.appendChild(row);
    this._heightDom = { status, calibrate };
  }

  // ------------------------------------------------------------------ player height
  _input() {
    const g = this.game || {};
    return g.input || null;
  }

  /** The eye height the headset reports right now (m above the real floor), or NaN outside VR. */
  _liveEye() {
    const inp = this._input();
    if (!this._xr || !inp || typeof inp.measureEyeHeight !== 'function') return NaN;
    try {
      return inp.measureEyeHeight();
    } catch {
      return NaN;
    }
  }

  /** What the height panel shows: { head, line1, line2, msg } (also the repaint key). */
  _heightInfo() {
    const s = this._settings();
    const seated = s.heightMode === 'seated';
    const trim = num(s.heightOffset, 0);
    const live = this._liveEye();
    const measured = num(s.heightMeasured, 0);
    const lift = (seated ? num(s.heightCal, 0) : 0) + trim;
    let head;
    let line1;
    let line2;
    if (live > 0) {
      head = mTxt(live);
      line1 = 'Your eyes now, above the real floor';
      line2 = `In the game your eyes sit at ${mTxt(live + lift)}${seated ? ` (seated +${(num(s.heightCal, 0) * 100).toFixed(0)} cm)` : ''}`;
    } else {
      head = measured > 0 ? mTxt(measured) : '— —';
      line1 = measured > 0 ? 'Measured at the last calibration' : 'Not measured yet. Put the headset on to calibrate';
      line2 = `Desktop eyes: ${mTxt(VIEW.standEye + trim)} above the feet`;
    }
    let msg = '';
    if (this._cal) msg = `Hold still… ${Math.max(1, Math.ceil(this._cal.t))}`;
    else if (this._calMsg) msg = this._calMsg;
    else if (seated && num(s.heightCal, 0) === 0 && measured <= 0) msg = 'Sit as you will play, then press Calibrate';
    return { head, line1, line2, msg };
  }

  /** Refreshes the DOM status line and flags the VR panel when the text changed. */
  _refreshHeight() {
    const h = this._heightInfo();
    const key = `${h.head}|${h.line1}|${h.line2}|${h.msg}|${this._cal ? 1 : 0}|${this._xr ? 1 : 0}`;
    if (key === this._heightKey) return;
    this._heightKey = key;
    const d = this._heightDom;
    if (d) {
      d.status.textContent = `Eye height ${h.head}. ${h.line1}. ${h.line2}.${h.msg ? ` ${h.msg}.` : ''}`;
      const cb = d.calibrate.querySelector('.btn-label');
      if (cb) cb.textContent = this._cal ? 'Cancel' : this._xr ? 'Calibrate: stand (or sit) normally and press' : 'Calibrate (in VR)';
      d.calibrate.setAttribute('aria-disabled', String(!this._xr && !this._cal));
      d.calibrate.classList.toggle('is-disabled', !this._xr && !this._cal);
    }
    if (this.current === 'settings') this._vrDirty = true;
  }

  /** Calibrate press: a short countdown so the pose is natural, then the headset's eye height is read. */
  _startCalibration() {
    if (this._cal) {
      this._cal = null;
      this._calMsg = 'Calibration cancelled';
      this._refreshHeight();
      return;
    }
    if (!this._xr) {
      this._calMsg = 'Put the headset on: Enter VR, then open Settings';
      this._refreshHeight();
      return;
    }
    this._calMsg = '';
    this._cal = { t: VIEW.calCountdown };
    this._refreshHeight();
  }

  _updateCalibration(dt) {
    const c = this._cal;
    if (c) {
      c.t -= dt;
      if (c.t <= 0) {
        this._cal = null;
        this._finishCalibration();
      }
    }
    this._heightPoll = (this._heightPoll || 0) - dt;
    if (this._heightPoll <= 0 || c) {
      this._heightPoll = 0.2;
      if (this.current === 'settings' || this._cal || this._calMsg) this._refreshHeight();
    }
  }

  _finishCalibration() {
    const s = this._settings();
    const eye = this._liveEye();
    const partial = heightCalibration(s.heightMode, eye);
    if (!partial) {
      this._calMsg = 'No reading. Keep the headset on and try again';
      this._refreshHeight();
      return;
    }
    this._applySettings(partial);
    const seated = s.heightMode === 'seated';
    this._calMsg = seated ? `Seated: eyes lifted ${(partial.heightCal * 100).toFixed(0)} cm to ${mTxt(eye + partial.heightCal + num(s.heightOffset, 0))}` : `Standing: eyes at ${mTxt(eye)}, your real height`;
    const inp = this._input();
    if (inp && typeof inp.haptic === 'function') inp.haptic('both', 0.4, 60);
    this._refreshHeight();
  }

  _resetHeight() {
    this._cal = null;
    this._calMsg = '';
    const partial = {};
    for (const k of HEIGHT_KEYS) partial[k] = SETTINGS_DEFAULTS[k];
    this._applySettings(partial);
    this._refreshHeight();
  }

  /** Copies the live settings into every control (DOM + VR). */
  syncSettings() {
    if (!this.dom) return;
    const s = this._settings();
    this._refreshHeight();
    this._syncUx(s);
    for (const key of Object.keys(this._ctl)) {
      const c = this._ctl[key];
      const v = key in s ? s[key] : SETTINGS_DEFAULTS[key];
      if (c.input) {
        const val = U.clamp(num(v, c.def.min), c.def.min, c.def.max);
        if (document.activeElement !== c.input || Math.abs(parseFloat(c.input.value) - val) > 1e-6) c.input.value = String(val);
        c.input.style.setProperty('--fill', `${(((val - c.def.min) / (c.def.max - c.def.min)) * 100).toFixed(1)}%`);
        c.out.textContent = c.def.fmt(val);
      } else {
        for (const [value, b] of c.btns) b.setAttribute('aria-pressed', String(value === v));
      }
    }
    this._vrDirty = true;
  }

  _applySetting(key, value) {
    const def = SETTINGS_SCHEMA.find((d) => d.key === key);
    if (!def) return;
    let v = value;
    if (def.type === 'range') v = U.clamp(Math.round(num(+value, def.min) / def.step) * def.step, def.min, def.max);
    else if (def.type === 'toggle') v = value === true || value === 'true';
    else {
      if (typeof def.options[0][0] === 'number') v = Number(value);
      if (!def.options.some((o) => o[0] === v)) return;
    }
    v = def.type === 'range' ? +v.toFixed(4) : v;
    this._applySettings({ [key]: v });
  }

  _applySettings(partial) {
    const g = this.game || {};
    let done = false;
    if (typeof g.applySettings === 'function') {
      try {
        g.applySettings(partial);
        done = true;
      } catch (err) {
        if (typeof console !== 'undefined') console.error('[AT3D] game.applySettings failed', err);
      }
    }
    if (!done) {
      const s = g.settings || (g.settings = Object.assign({}, SETTINGS_DEFAULTS));
      Object.assign(s, partial);
      Storage.saveSettings(s);
      if (g.bus && typeof g.bus.emit === 'function') g.bus.emit('settings:changed', { settings: s, changed: partial });
    }
    this.syncSettings();
  }

  _resetSettings() {
    const partial = {};
    for (const def of SETTINGS_SCHEMA) if (def.key) partial[def.key] = SETTINGS_DEFAULTS[def.key];
    for (const k of HEIGHT_KEYS) partial[k] = SETTINGS_DEFAULTS[k];
    this._cal = null;
    this._calMsg = '';
    this._applySettings(partial);
  }

  // ------------------------------------------------------------------ WP-UX: comfort, display, captions, hints, about
  _startUx() {
    const g = this.game || {};
    this._comfort = new ComfortOverlay(g);
    this._caps = new CaptionTracker({ captions: () => this._settings().captions === true, status: () => this._settings().colorSafe === true });
    this._caps.attach(g.bus);
    this._tut = new Tutorial(g, this);
    this._tut.attach();
  }

  /** Text scale, display tier / exposure, colour-safe strip and captions visibility follow the live settings. */
  _syncUx(s) {
    const ts = textScaleOf(s);
    if (ts !== this._textScale) {
      this._textScale = ts;
      this.root.style.setProperty('--ts', String(ts));
      this._scaleVR();
    }
    applyDisplay(this.game, this._xrScaleApplied);
    this.dom.hudStatus.hidden = s.colorSafe !== true;
    this._statusKey = '';
    this._wristKey = '';
    if (s.captions !== true && s.colorSafe !== true && this._caps) this._caps.clear();
    this._paintPatchesDom();
  }

  /** VR: panel, notes and captions grow with settings.textScale (notes are capped so a card still fits the view). */
  _scaleVR() {
    const vr = this._vr;
    if (!vr) return;
    vr.panel.scale.setScalar(this._textScale);
    vr.notes.scale.setScalar(Math.min(this._textScale, 1.3));
    this._vrDirty = true;
  }

  _privacyUrl() {
    return this._pageUrl('../privacy/', 'Published with the store build');
  }

  _supportUrl() {
    return this._pageUrl('../support/', 'Published with the store build');
  }

  _pageUrl(rel, fallback) {
    if (BUILD.channel !== 'release' || typeof location === 'undefined') return fallback;
    try {
      return new URL(rel, location.href).href;
    } catch {
      return fallback;
    }
  }

  _buildAbout() {
    const d = this.dom;
    d.aboutCredits.textContent =
      'Created by the Abyssal Tether team. The world, the creature, the score and every sound are original: the sound is synthesised live, there are no samples. Built with three.js (MIT licence) and Blender. Chapters II–V are coming.';
  }

  _versionLine() {
    const c = BUILD.commit ? ` (${String(BUILD.commit).slice(0, 7)})` : '';
    return `${BUILD.version}${c} · ${BUILD.channel === 'release' ? 'store build' : 'development build'}`;
  }

  /** The update row text for About (DOM + VR). */
  _updateLine() {
    const u = this.game && this.game.updates;
    if (this._updateReady || (u && u.ready)) return this._xr ? 'Update ready. It installs the next time you start the game.' : 'Update ready. Restart to apply it.';
    if (u && u.registered) return 'You have the latest version.';
    return 'Running from the page.';
  }

  _fillAbout() {
    const d = this.dom;
    if (!d) return;
    d.aboutVersion.textContent = this._versionLine();
    d.aboutUpdate.textContent = this._updateLine();
    const u = this.game && this.game.updates;
    d.aboutUpdateBtn.hidden = !((this._updateReady || (u && u.ready)) && !this._xr);
    for (const [el, url] of [[d.aboutPrivacy, this._privacyUrl()], [d.aboutSupport, this._supportUrl()]]) {
      el.textContent = url;
      if (/^https?:/.test(url)) el.href = url;
      else el.removeAttribute('href');
    }
    this._disarm();
    this._vrDirty = true;
  }

  _applyUpdate() {
    const u = this.game && this.game.updates;
    if (!u || !(u.ready || this._updateReady)) return;
    if (this._xr) {
      this.showToast('Installs on next launch', 3);
      return;
    }
    let ok = false;
    try {
      ok = !!u.apply();
    } catch {
      ok = false;
    }
    if (!ok) this.showToast('Update will install on next launch', 3);
  }

  _disarm() {
    if (!this._armed) return;
    this._armed = '';
    this._armedT = 0;
    if (this.dom && this.dom.aboutErase) {
      this.dom.aboutErase.classList.remove('is-armed');
      this.dom.aboutErase.querySelector('.btn-label').textContent = 'Erase saved data';
    }
    this._vrDirty = true;
  }

  /** Two presses within 4 s: wipes settings, best times and the saved run from this device (Privacy.4: deleting your data). */
  _eraseData() {
    if (this._armed !== 'erase-data') {
      this._armed = 'erase-data';
      this._armedT = 4;
      if (this.dom && this.dom.aboutErase) {
        this.dom.aboutErase.classList.add('is-armed');
        this.dom.aboutErase.querySelector('.btn-label').textContent = 'Press again to erase';
      }
      this._vrDirty = true;
      return;
    }
    this._disarm();
    const g = this.game || {};
    try {
      if (g.save && g.save.store && typeof g.save.store.reset === 'function') g.save.store.reset();
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[AT3D] save reset failed', err);
    }
    try {
      if (typeof localStorage !== 'undefined') {
        const rm = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.indexOf('abyssalTether3d.') === 0) rm.push(k);
        }
        for (const k of rm) localStorage.removeItem(k);
      }
    } catch {
      /* storage blocked: nothing to erase */
    }
    this._resetSettings();
    if (this._tut) this._tut.reset();
    this._applySettings({ brightnessChecked: false });
    this.refreshMenu();
    this.showToast('Saved data erased', 3);
  }

  // ---- DOM captions + colour-safe status strip ------------------------------------------------------------------
  _buildCaptionLines() {
    const box = this.dom.captions;
    box.textContent = '';
    this._capDom = [];
    for (let i = 0; i < 3; i++) {
      const row = make('div', 'cap');
      row.hidden = true;
      const icon = make('i');
      const dir = make('span', 'cap-dir');
      const text = make('span', 'cap-text');
      row.append(icon, dir, text);
      box.appendChild(row);
      this._capDom.push({ row, icon, dir, text });
    }
    const st = this.dom.hudStatus;
    st.textContent = '';
    const mk = (cls, path, label) => {
      const span = make('span', cls);
      span.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`);
      span.append(make('em', null, label), make('b', null, '—'));
      st.appendChild(span);
      return span;
    };
    this._statusDom = {
      hp: mk('st-hp', 'M5 1h2v4h4v2H7v4H5V7H1V5h4z', 'HP'),
      grip: mk('st-grip', 'M6 1.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9zM6 4v4', 'GRIP'),
      bag: mk('st-bag', 'M2 3h8v7H2zM4 3V1.5h4V3', 'BAG'),
    };
  }

  _dirGlyph(l) {
    if (l.sector < 0) return l.vert > 0 ? '▲' : l.vert < 0 ? '▼' : '';
    return DIR_ARROWS[l.sector] + (l.vert > 0 ? '▲' : l.vert < 0 ? '▼' : '');
  }

  _updateCaptionsDom() {
    const caps = this._caps;
    const lines = caps.lines;
    let any = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const dom = this._capDom[i];
      dom.row.hidden = !l.on;
      if (!l.on) continue;
      any = true;
      dom.row.dataset.sev = String(l.sev);
      dom.icon.className = KIND_SHAPE[l.kind] || 'square';
      dom.dir.textContent = this._dirGlyph(l);
      dom.text.textContent = l.text;
    }
    this.dom.captions.hidden = !any;
  }

  /** HP / grip / bag as numbers next to their shapes (colour-safe strip), DOM HUD. Called at the HUD interval. */
  _updateStatusDom(g) {
    if (this._settings().colorSafe !== true) return;
    const st = this._statusValues(g);
    const key = `${st.hp}|${st.grip}|${st.bag}`;
    if (key === this._statusKey) return;
    this._statusKey = key;
    const D = this._statusDom;
    D.hp.querySelector('b').textContent = String(st.hp);
    D.grip.querySelector('b').textContent = String(st.grip);
    D.bag.querySelector('b').textContent = String(st.bag);
    D.hp.classList.toggle('warn', st.hp < 40);
    D.grip.classList.toggle('warn', st.grip < 25);
  }

  _statusValues(g) {
    const hp = g.health && typeof g.health.hp === 'number' ? Math.round(g.health.hp * 100) : 100;
    const cl = g.physics && g.physics.climb;
    const grip = cl && typeof cl.stamina === 'number' ? Math.round(cl.stamina * 100) : 100;
    let bag = 0;
    if (g.bag && g.bag.counts) for (let i = 0; i < g.bag.counts.length; i++) bag += g.bag.counts[i];
    const out = this._stv || (this._stv = { hp: 100, grip: 100, bag: 0 });
    out.hp = hp;
    out.grip = grip;
    out.bag = bag;
    return out;
  }

  // ---- black level patches (DOM canvas; the VR calibrate screen paints the same picture) ----------------------------
  _paintPatchesDom() {
    const c = this._patchesCanvas;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._paintPatches(ctx, 0, 0, c.width, c.height);
  }

  /** Eight squares from 0.5 % to 10 % of white on black: the second should be just visible, the first not at all. */
  _paintPatches(ctx, x, y, w, h) {
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, w, h);
    const n = PATCH_LEVELS.length;
    const gap = 12;
    const sw = (w - gap * (n + 1)) / n;
    const sh = h - 44;
    for (let i = 0; i < n; i++) {
      const v = Math.round(PATCH_LEVELS[i] * 255);
      const px = x + gap + i * (sw + gap);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(px, y + 10, sw, sh);
      txt(ctx, String(i + 1), px + sw / 2, y + h - 12, `650 26px ${F_UI}`, '#9a948a', 'center', 0);
    }
  }

  // ------------------------------------------------------------------ pause / death / victory
  _canRespawn() {
    const g = this.game || {};
    const diff = g.diff || DIFFICULTY[g.difficultyKey] || DIFFICULTY.normal;
    return !!(diff.checkpoints && diff.checkpoints !== 'none');
  }

  _runLine() {
    const g = this.game || {};
    const diff = g.diff || DIFFICULTY[g.difficultyKey] || DIFFICULTY.normal;
    const bits = [diff.label, fmtTime(g.time || 0)];
    if (g.player) bits.push(fmtMeters(U.depthMeters(num(g.player.y, 0))));
    if (g.difficultyKey !== 'sandbox') bits.push(`${g.deaths || 0} death${g.deaths === 1 ? '' : 's'}`);
    return bits.join(' · ');
  }

  _sections() {
    const g = this.game || {};
    return g.level && Array.isArray(g.level.sections) ? g.level.sections : null;
  }

  /** True once the goal is reached (the gate slam is playing): respawn / warp no longer apply. */
  _victoryRunning() {
    const g = this.game || {};
    return typeof g.victoryT === 'number' && g.victoryT >= 0;
  }

  _preparePause() {
    const g = this.game || {};
    const won = this._victoryRunning();
    this.dom.pauseStats.textContent = this._runLine();
    this.dom.pauseRespawn.hidden = won || !(this._canRespawn() && g.player);
    const sections = g.difficultyKey === 'sandbox' && !won ? this._sections() : null;
    this.dom.pauseWarp.hidden = !sections;
    if (sections) {
      if (this._warpLevel !== g.level) {
        const grid = this.dom.warpGrid;
        grid.textContent = '';
        sections.forEach((s, i) => {
          const b = make('button', 'warp-btn');
          b.type = 'button';
          b.dataset.action = 'warp';
          b.dataset.section = String(i);
          b.append(make('span', 'warp-num', ROMAN[i] || String(i + 1)), make('span', 'warp-name', s.name || `Section ${i + 1}`));
          b.setAttribute('aria-label', `Warp to section ${i + 1}: ${s.name || ''}`);
          grid.appendChild(b);
        });
        this._warpLevel = g.level;
      }
      const cur = g.sectionIndex | 0;
      const btns = this.dom.warpGrid.children;
      for (let i = 0; i < btns.length; i++) btns[i].classList.toggle('is-current', i === cur);
    }
  }

  /** Death info, completed from game state where the caller left gaps. */
  _deathFrom(info) {
    const g = this.game || {};
    const i = info && typeof info === 'object' ? info : {};
    const p = g.player || {};
    const cause = i.cause || p.deathCause || 'impact';
    return {
      cause,
      deaths: num(i.deaths, num(g.deaths, 0)),
      canRespawn: typeof i.canRespawn === 'boolean' ? i.canRespawn : this._canRespawn(),
      depthMeters: num(i.depthMeters, U.depthMeters(num(p.y, 0))),
      time: num(i.time, num(g.time, 0)),
      message: i.message || null,
      // X restarts only when held (InputManager): older prompt wording says 'X to restart'.
      prompt: typeof i.prompt === 'string' && i.prompt ? i.prompt.replace(/(^|·\s*)X to restart/, '$1hold X to restart') : null,
    };
  }

  _fillDeath(info) {
    const i = this._deathFrom(info);
    this._deathInfo = i;
    const copy = DEATH_COPY[i.cause] || DEATH_COPY.impact;
    const d = this.dom;
    d.deathKicker.textContent = copy.kicker;
    d.deathMsg.textContent = i.message || copy.message;
    d.deathStats.textContent = `Deaths ${i.deaths} · ${fmtMeters(i.depthMeters)} · ${fmtTime(i.time)}`;
    d.deathContinue.querySelector('.btn-label').textContent = i.canRespawn ? 'Continue' : 'Begin again';
    d.deathContinueSub.textContent = i.canRespawn ? 'from the last checkpoint' : 'no checkpoints on this difficulty';
    if (i.prompt) setRichText(d.deathPrompt, i.prompt);
    else {
      d.deathPrompt.textContent = '';
      d.deathPrompt.append(make('kbd', null, 'Click'), ' or ', make('kbd', null, 'Enter'), i.canRespawn ? ' rise again · ' : ' begin again · ', make('kbd', null, 'R'), ' restart');
    }
  }

  /** Shows the death screen (2D-compatible entry point). */
  showDeath(info) {
    this.hideHint();
    this.show('death', info);
  }

  _victoryFrom(p) {
    const g = this.game || {};
    const key = g.difficultyKey || 'normal';
    const diff = DIFFICULTY[key] || DIFFICULTY.normal;
    const time = num(p && p.time, num(g.time, 0));
    const best = diff.recordTimes ? Storage.getBest(key) : null;
    return {
      time,
      best,
      previous: p && typeof p.previous === 'number' ? p.previous : null,
      isNew: p && typeof p.isNew === 'boolean' ? p.isNew : best != null && Math.abs(best - time) < 1e-6,
      deaths: num(p && p.deaths, num(g.deaths, 0)),
      deepestMeters: num(p && p.deepestMeters, U.depthMeters(num(g.deepest, g.player ? g.player.y : 0))),
      difficultyKey: key,
      label: diff.label,
      falls: num(p && p.falls, num(p && p.deaths, num(g.deaths, 0))),
      lowestHp: num(p && p.lowestHp, g.health && typeof g.health.minHp === 'number' ? g.health.minHp : 1),
      itemsUsed: num(p && p.itemsUsed, this._itemsUsed(g)),
    };
  }

  /** Bag items applied this run (inventory stats), for the end card. */
  _itemsUsed(g) {
    const u = g && g.bag && g.bag.stats ? g.bag.stats.used : null;
    let n = 0;
    if (u) for (let i = 0; i < u.length; i++) n += u[i];
    return n;
  }

  _fillVictory(info) {
    const g = this.game || {};
    const i = Object.assign(this._victoryFrom(info), info && typeof info === 'object' ? info : {});
    const key = i.difficultyKey || g.difficultyKey || 'normal';
    const diff = DIFFICULTY[key] || DIFFICULTY.normal;
    i.recorded = diff.recordTimes !== false && key !== 'sandbox';
    i.label = i.label || diff.label;
    this._victoryInfo = i;
    const d = this.dom;
    d.vTime.textContent = fmtTime(i.time);
    d.vNew.hidden = !(i.recorded && i.isNew);
    d.vDeaths.textContent = String(i.falls != null ? i.falls : i.deaths || 0);
    d.vHealth.textContent = pct(U.clamp(num(i.lowestHp, 1), 0, 1));
    d.vItems.textContent = String(i.itemsUsed | 0);
    d.vDiff.textContent = i.label;
    if (!i.recorded) {
      d.vBest.textContent = '—';
      d.vNote.textContent = 'Sandbox descents are not timed for the records.';
    } else {
      d.vBest.textContent = fmtTime(i.best != null ? i.best : i.time);
      d.vNote.textContent = '';
    }
    this._fillVictorySplits();
  }

  // ------------------------------------------------------------------ section records (LEVEL_FUN_PLAN item 12, P6)
  /**
   * game.js 'split' { index, section, time, par, medal, recorded, difficulty }: kept for the victory panel; its line waits
   * for the next section's title card (section:enter follows in the same call), or shows as a toast at the goal.
   */
  _onSplit(p) {
    const index = num(p.index, -1);
    if (index < 0 || !(p.time > 0)) return;
    const prev = p.recorded ? this._records(p.difficulty)[p.section] : null;
    const isNew = !!p.recorded && (!prev || !(prev.best > 0) || p.time < prev.best - 1e-6);
    const medal = p.recorded ? p.medal || null : null;
    const line = splitLine(index, p.time, medal, isNew && !!prev);
    const sp = { index, id: p.section, time: p.time, medal, par: num(p.par, 0) || null, isNew, line };
    this._runSplits[index] = sp;
    const secs = this._sections();
    if (secs && index >= secs.length - 1) this.showToast(line, 3.6); // the last section: no title card follows
    else this._pendingSplit = sp;
  }

  /** save.sectionRecords(diff) (schema 3), or {}. */
  _records(diff) {
    const g = this.game || {};
    try {
      const r = g.save && typeof g.save.sectionRecords === 'function' ? g.save.sectionRecords(diff) : null;
      return r && typeof r === 'object' ? r : {};
    } catch {
      return {};
    }
  }

  /** The Records screen's difficulty: the one chosen there, else the last played. */
  _recordsDiff() {
    const k = this._recDiff || this._defaultDifficulty();
    return DIFFICULTY_ORDER.indexOf(k) >= 0 ? k : 'normal';
  }

  /** Rows of the Records screen for difficulty `diff` (ui/medals.js recordRows). */
  _recordRowsFor(diff) {
    const secs = this._sections() || Object.keys(PAR_3D.normal || {}).map((id) => ({ id }));
    return recordRows(secs, this._records(diff), PAR_3D[diff] || null);
  }

  /** DOM: the Records screen (difficulty buttons, one row per section, the medal tally). */
  _fillRecords() {
    const d = this.dom;
    if (!d || !d.recBody) return;
    const diff = this._recordsDiff();
    if (!d.recTabs.childElementCount) {
      for (const k of DIFFICULTY_ORDER) {
        const b = make('button', 'btn rec-tab');
        b.type = 'button';
        b.dataset.action = 'rec-tab';
        b.dataset.diff = k;
        b.append(make('span', 'btn-label', DIFFICULTY[k].label));
        d.recTabs.appendChild(b);
      }
    }
    for (const b of d.recTabs.children) {
      const on = b.dataset.diff === diff;
      b.classList.toggle('btn-primary', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const rows = this._recordRowsFor(diff);
    d.recBody.textContent = '';
    for (const r of rows) {
      const tr = make('tr');
      const best = make('td', r.best == null ? 'is-empty' : null, r.best == null ? '—' : fmtSplit(r.best));
      const medal = make('td', r.medal ? null : 'is-empty');
      if (r.medal) {
        const m = make('span', 'medal');
        const dot = make('i');
        dot.style.setProperty('--mc', MEDAL_COLOR[r.medal]);
        m.append(dot, make('span', null, MEDAL_LABEL[r.medal]));
        medal.appendChild(m);
      } else medal.textContent = '—';
      tr.append(make('td', null, r.numeral), make('td', null, r.name), best, medal, make('td', null, targetText(r)));
      d.recBody.appendChild(tr);
    }
    d.recTally.textContent = tallyLine(medalTally(rows)) || `No whole section played on ${DIFFICULTY[diff].label} yet.`;
  }

  /** DOM: this run's splits on the victory panel (hidden when none was whole). */
  _fillVictorySplits() {
    const d = this.dom;
    if (!d || !d.vSplits) return;
    const list = this._runSplits.filter(Boolean);
    d.vSplitsWrap.hidden = list.length === 0;
    d.vSplits.textContent = '';
    const secs = this._sections() || [];
    for (const sp of list) {
      const li = make('li');
      const name = (secs[sp.index] && secs[sp.index].name) || `Section ${sp.index + 1}`;
      li.append(make('b', null, ROMAN[sp.index] || String(sp.index + 1)), make('span', null, name), make('em', null, fmtSplit(sp.time)));
      if (sp.medal) {
        const m = make('span', 'medal');
        const dot = make('i');
        dot.style.setProperty('--mc', MEDAL_COLOR[sp.medal]);
        m.append(dot, make('span', null, MEDAL_LABEL[sp.medal]));
        li.appendChild(m);
      }
      d.vSplits.appendChild(li);
    }
  }

  /** Shows the victory screen (2D-compatible entry point). */
  showVictory(info) {
    this.hideHint();
    this.show('victory', info);
    this.refreshMenu();
  }

  // ------------------------------------------------------------------ hints, cards, toasts
  /**
   * Contextual hint. Accepts a string or a level hint {text, desktop?}: the VR
   * wording (`text`) whenever an XR session is presenting (checked live, not
   * cached), the desktop wording otherwise when present. `[Key]` tokens render
   * as keycaps. When XR starts / ends while a hint is up, the wording is re-picked.
   */
  showHint(hint, seconds) {
    const text = this._hintWording(hint);
    if (!text) return;
    const h = this._hint;
    h.src = hint && typeof hint === 'object' ? hint : null;
    h.tutorial = false;
    h.vr = this._forceVR || this._xrActive();
    h.text = String(text);
    h.t = seconds > 0 ? seconds : 5;
    h.on = true;
    h.dirty = true;
    if (this.dom) {
      setRichText(this.dom.hint, h.text);
      this.dom.hint.classList.add('is-on');
    }
  }

  _hintWording(hint) {
    if (!hint) return '';
    if (typeof hint !== 'object') return String(hint);
    const vr = this._forceVR || this._xrActive();
    if (vr) return hint.text || hint.desktop || '';
    if (hint.touch && this._touchOn()) return hint.touch;
    return hint.desktop || hint.text || '';
  }

  /** WP-TOUCH: the touch layer is active (input/touchInput.js sets the class on <html>). */
  _touchOn() {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('touch-on');
  }

  hideHint() {
    const h = this._hint;
    h.on = false;
    h.t = 0;
    if (this.dom) this.dom.hint.classList.remove('is-on');
  }

  /** Large carved section title card (index from the level when omitted); `split` = the last section's split line (P6). */
  showSectionTitle(name, subtitle, index, split) {
    if (!name) return;
    if (this._lastTitle.text === name && this._clock - this._lastTitle.t < DEDUPE) return;
    this._lastTitle.text = name;
    this._lastTitle.t = this._clock;
    let idx = typeof index === 'number' ? index : -1;
    const sections = this._sections();
    if (idx < 0 && sections) idx = sections.findIndex((s) => s && s.name === name);
    const t = this._title;
    t.name = String(name);
    t.sub = subtitle ? String(subtitle) : '';
    t.num = idx >= 0 ? `— ${ROMAN[idx] || idx + 1} —` : '';
    t.split = split ? String(split) : '';
    t.t = TITLE_TIME;
    t.dirty = true;
    if (this.dom) {
      const d = this.dom;
      d.sectionNum.textContent = t.num;
      d.sectionName.textContent = t.name;
      d.sectionSub.textContent = t.sub;
      if (d.sectionSplit) d.sectionSplit.textContent = t.split;
      d.sectionCard.classList.remove('is-cut');
      restartAnimation(d.sectionCard, 'is-on');
    }
  }

  /** Small top-centre notice, e.g. "Checkpoint". */
  showToast(text, seconds) {
    if (!text) return;
    if (this._lastToast.text === text && this._clock - this._lastToast.t < DEDUPE) return;
    this._lastToast.text = text;
    this._lastToast.t = this._clock;
    const t = this._toast;
    t.text = String(text);
    t.t = seconds > 0 ? seconds : 2;
    t.dirty = true;
    if (this.dom) {
      this.dom.toastText.textContent = t.text;
      this.dom.toast.classList.add('is-on');
    }
  }

  // ------------------------------------------------------------------ actions
  _onClick(e) {
    const target = e.target;
    const btn = target && target.closest ? target.closest('[data-action]') : null;
    if (!btn || !this.root.contains(btn)) {
      if (this.current === 'death' && target && target.closest && target.closest('.screen-death')) this._continueFromDeath(true);
      return;
    }
    if (btn.disabled) return;
    this._emitClick();
    this._unlockAudio();
    this._action(btn.dataset.action, btn.dataset, false);
  }

  _onInput(e) {
    const el = e.target;
    if (!el || el.type !== 'range' || !el.dataset.key) return;
    this._applySetting(el.dataset.key, parseFloat(el.value));
  }

  /**
   * Runs a UI action (DOM button or VR panel region).
   * @param {string} action
   * @param {object} data dataset-like {diff, section, key, value}
   * @param {boolean} fromVR
   */
  _action(action, data, fromVR) {
    const game = this.game || {};
    const d = data || {};
    switch (action) {
      case 'start':
        this._startRun(this._defaultDifficulty(), fromVR);
        break;
      case 'start-diff':
        this._startRun(d.diff, fromVR);
        break;
      case 'sandbox':
        this._startRun('sandbox', fromVR);
        break;
      case 'difficulty':
      case 'controls':
      case 'settings':
      case 'about':
      case 'records':
        this.show(action);
        break;
      case 'rec-tab':
        if (DIFFICULTY_ORDER.indexOf(d.diff) >= 0) {
          this._recDiff = d.diff;
          this._fillRecords();
          this._vrDirty = true;
        }
        break;
      case 'calibrate':
        if (this.vrMode) this.show('calibrate');
        else {
          this.show('settings');
          const c = this._ctl.brightness;
          if (c && c.input && !fromVR) c.input.focus();
        }
        break;
      case 'continue-run':
        this._continueRun(fromVR);
        break;
      case 'apply-update':
        this._applyUpdate();
        break;
      case 'erase-data':
        this._eraseData();
        break;
      case 'tab':
        this._vrTab = Math.max(0, Math.min(VR_TABS.length - 1, parseInt(d.value, 10) || 0));
        this._vrSetPage = 0;
        this._vrDirty = true;
        break;
      case 'cal-reset':
        this._applySettings({ brightness: SETTINGS_DEFAULTS.brightness, blackLevel: SETTINGS_DEFAULTS.blackLevel });
        break;
      case 'back':
        this._back();
        break;
      case 'pause':
        if (game.state === 'playing') {
          this._call('pause');
          if (game.state === 'paused' && this.current !== 'pause') this.show('pause');
        }
        break;
      case 'resume':
        if (game.state === 'paused') {
          this._call('resume');
          if (game.state === 'playing' && this.current !== null) this.show(null);
          if (!fromVR) this._lockPointer();
        }
        break;
      case 'respawn':
        if (game.state === 'paused' || game.state === 'dead') {
          this._call('respawn');
          if (game.state === 'playing' && this.current !== null) this.show(null);
          if (!fromVR) this._lockPointer();
        }
        break;
      case 'continue':
        this._continueFromDeath(false, fromVR);
        break;
      case 'restart':
        if (game.state === 'paused' || game.state === 'dead' || game.state === 'victory') {
          this._call('restart');
          if (game.state === 'playing' && this.current !== null) this.show(null);
          if (!fromVR) this._lockPointer();
        }
        break;
      case 'quit':
      case 'menu':
        this._call('quitToMenu');
        if (this.current !== 'menu') this.show('menu');
        break;
      case 'warp': {
        const i = parseInt(d.section, 10);
        if (isFinite(i) && game.difficultyKey === 'sandbox') {
          this._warp(i);
          if (game.state === 'paused') this._action('resume', null, fromVR);
        }
        break;
      }
      case 'set': {
        const key = d.key;
        let value = d.value;
        const c = this._ctl[key];
        if (c && c.def.type === 'toggle') value = value === true || value === 'true';
        this._applySetting(key, value);
        break;
      }
      case 'nudge': {
        const c = this._ctl[d.key];
        if (c && c.def.type === 'range') this._applySetting(d.key, num(this._settings()[d.key], c.def.min) + num(+d.value, 0) * c.def.step);
        break;
      }
      case 'slide': {
        const c = this._ctl[d.key];
        if (c && c.def.type === 'range') this._applySetting(d.key, c.def.min + U.clamp(num(+d.value, 0), 0, 1) * (c.def.max - c.def.min));
        break;
      }
      case 'reset-settings':
        this._resetSettings();
        break;
      case 'calibrate-height':
        this._startCalibration();
        break;
      case 'reset-height':
        this._resetHeight();
        break;
      case 'height-page':
        this._vrSetPage = parseInt(d.value, 10) === 1 ? 1 : 0;
        this._vrDirty = true;
        break;
      case 'enter-vr':
        this._enterVR();
        break;
      case 'exit-vr':
        this._exitVR();
        break;
      default:
        break;
    }
  }

  _continueRun(fromVR) {
    const game = this.game || {};
    const ok = this._call('continueRun');
    if (ok === false || ok === undefined) {
      this.showToast('Nothing to continue', 2.5);
      this.refreshMenu();
      return;
    }
    if (game.state === 'playing' && this.current !== null) this.show(null);
    if (!fromVR) this._lockPointer();
  }

  _startRun(key, fromVR) {
    const k = DIFFICULTY[key] ? key : 'normal';
    this._call('start', k);
    const game = this.game || {};
    if (game.state === 'playing' && this.current !== null) this.show(null);
    if (!fromVR) this._lockPointer();
  }

  _continueFromDeath(fromBackgroundTap, fromVR) {
    const game = this.game || {};
    if (game.state !== 'dead') return;
    if (fromBackgroundTap && this._clock < this._deathArmedAt) return;
    const canRespawn = this._deathInfo ? this._deathInfo.canRespawn : this._canRespawn();
    this._call(canRespawn ? 'respawn' : 'restart');
    if (game.state === 'playing' && this.current !== null) this.show(null);
    if (!fromVR) this._lockPointer();
  }

  _warp(i) {
    const g = this.game || {};
    if (typeof g.warp === 'function') this._call('warp', i);
    else if (typeof g.warpToSection === 'function') this._call('warpToSection', i);
    else {
      const dbg = typeof window !== 'undefined' && window.AT3D && window.AT3D.debug;
      if (dbg && typeof dbg.warp === 'function') {
        try {
          dbg.warp(i);
        } catch (err) {
          if (typeof console !== 'undefined') console.error('[AT3D] warp failed', err);
        }
      }
    }
  }

  _enterVR() {
    const g = this.game || {};
    let p;
    if (typeof g.enterVR === 'function') p = this._call('enterVR');
    else if (g.input && typeof g.input.enterVR === 'function') {
      try {
        p = g.input.enterVR();
      } catch (err) {
        p = Promise.reject(err);
      }
    }
    if (p && typeof p.then === 'function') {
      p.then(
        (ok) => {
          if (ok === false) this.showToast('VR could not start', 3);
        },
        (err) => {
          if (typeof console !== 'undefined') console.warn('[AT3D] enterVR failed', err);
          this.showToast('VR could not start', 3);
        },
      );
    }
  }

  _exitVR() {
    const g = this.game || {};
    if (typeof g.exitVR === 'function') {
      this._call('exitVR');
      return;
    }
    try {
      if (g.input && typeof g.input.exitVR === 'function') {
        g.input.exitVR();
        return;
      }
      const r = this._three();
      const s = r && r.xr && typeof r.xr.getSession === 'function' ? r.xr.getSession() : null;
      if (s && typeof s.end === 'function') {
        const p = s.end();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[AT3D] exitVR failed', err);
    }
  }

  /** Calls a public Game method defensively (a failure must not wedge the UI). */
  _call(method, arg) {
    const game = this.game;
    if (!game || typeof game[method] !== 'function') return undefined;
    try {
      return arguments.length > 1 ? game[method](arg) : game[method]();
    } catch (err) {
      if (typeof console !== 'undefined') console.error(`[AT3D] game.${method} failed`, err);
      return undefined;
    }
  }

  _emitClick() {
    const bus = this.game && this.game.bus;
    if (bus && typeof bus.emit === 'function') bus.emit('ui:click', {});
  }

  _unlockAudio() {
    const audio = this.game && this.game.audio;
    if (audio && typeof audio.unlock === 'function') {
      try {
        audio.unlock();
      } catch {
        /* audio is optional */
      }
    }
  }

  _canvas() {
    const r = this._three();
    return r && r.domElement ? r.domElement : null;
  }

  /** Desktop: (re)capture the mouse after a menu click (a user gesture). */
  _lockPointer() {
    if (this._xr || typeof document === 'undefined' || document.pointerLockElement) return;
    const g = this.game || {};
    const input = g.input;
    try {
      if (input && typeof input.lockPointer === 'function') {
        input.lockPointer();
        return;
      }
      const c = this._canvas();
      if (c && typeof c.requestPointerLock === 'function') {
        const p = c.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch {
      // pointer lock unavailable — the capture prompt explains the click
    }
  }

  _releasePointer() {
    try {
      if (typeof document !== 'undefined' && document.pointerLockElement && typeof document.exitPointerLock === 'function') document.exitPointerLock();
    } catch {
      // ignore
    }
  }

  // ------------------------------------------------------------------ keyboard
  _onKeyDown(e) {
    if (!this._ready || e.ctrlKey || e.metaKey || e.altKey) return;
    this._modality = 'keyboard';
    if (this._xr) return;
    const container = this.current ? this.screens[this.current] : null;
    if (!container) return; // gameplay: the input module owns the keyboard
    const key = e.key;
    const active = document.activeElement;
    const onControl = !!(active && active !== container && container.contains(active) && active.matches(FOCUSABLE));

    if (key === 'Escape' || key === 'Esc') {
      e.preventDefault();
      e.stopPropagation();
      if (SUB_SCREENS[this.current]) {
        this._emitClick();
        this._back();
      } else if (this.current === 'pause') {
        this._action('resume', null, false);
      }
      return;
    }
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      if (!onControl && !e.repeat && key === 'Enter') {
        // Nothing focused yet: Enter runs the screen's primary action.
        const primary = container.querySelector('[data-autofocus]');
        if (primary && isVisible(primary)) {
          e.preventDefault();
          e.stopPropagation();
          primary.click();
          return;
        }
      }
      if (onControl) {
        // The focused control owns this key — don't also feed the game a confirm/jump edge.
        e.stopPropagation();
        if (e.repeat) e.preventDefault();
      }
      return;
    }
    if (key === 'Tab') {
      this._trapTab(e, container);
      return;
    }
    const dir = key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : key === 'ArrowDown' || key === 'ArrowRight' ? 1 : 0;
    if (!dir) return;
    // Range sliders keep Left / Right for their value.
    if (onControl && active.type === 'range' && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const list = this._focusables(container);
    if (!list.length) return;
    let i = onControl ? list.indexOf(active) : -1;
    if (i < 0) i = dir > 0 ? -1 : 0;
    const next = list[(i + dir + list.length) % list.length];
    if (next) next.focus({ preventScroll: false });
  }

  _focusables(container) {
    const out = [];
    for (const n of container.querySelectorAll(FOCUSABLE)) {
      if (n.disabled || n.tabIndex < 0 || n.closest('[hidden]')) continue;
      if (!isVisible(n)) continue;
      out.push(n);
    }
    return out;
  }

  _trapTab(e, container) {
    const list = this._focusables(container);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (!container.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
    e.stopPropagation();
  }

  // ------------------------------------------------------------------ per frame
  /** True while the VR presentation is used (an immersive session, or forced for previews/tests). */
  get vrMode() {
    return this._xr || this._forceVR;
  }

  /** Renders the VR presentation outside XR (previews / automated tests). */
  setForceVR(on) {
    this._forceVR = !!on;
    this._needRecenter = true;
    this._vrDirty = true;
  }

  /** Re-centres the VR panel / notes in front of the head on the next frame. */
  recenter() {
    this._needRecenter = true;
    this._noteYawSet = false;
  }

  _three() {
    const R = this.game && this.game.renderer;
    if (!R) return null;
    return R.renderer && R.renderer.isWebGLRenderer ? R.renderer : R.isWebGLRenderer ? R : R.renderer || null;
  }

  _xrActive() {
    const g = this.game || {};
    if (g.input && g.input.xrActive) return true;
    const r = this._three();
    return !!(r && r.xr && r.xr.isPresenting);
  }

  update(dt) {
    if (!this._ready) return;
    const step = dt > 0 && dt < 1 ? dt : 0;
    this._clock += step;
    const g = this.game || {};
    this._updateCalibration(step);
    if (this._comfort) this._comfort.update(step);
    if (this._tut) this._tut.update(step);
    if (this._armedT > 0) {
      this._armedT -= step;
      if (this._armedT <= 0) this._disarm();
    }
    this._updateCaps(step);

    // XR session started / ended.
    const xr = this._xrActive();
    if (xr !== this._xr) {
      this._xr = xr;
      this._needRecenter = true;
      this._noteYawSet = false;
      this._vrDirty = true;
      this._hud.cls = -1;
      if (!xr && !this._hadXR) {
        // A session has ended: the pause / death screens now offer 'Return to VR' first.
        this._hadXR = true;
        this._syncVRBlock();
        if (this.current === 'pause' || this.current === 'death') this._focusInitial(this.current, null);
      }
      if (xr) {
        this._unlockAudio();
        const active = document.activeElement;
        if (active && this.root.contains(active) && typeof active.blur === 'function') active.blur();
      }
    }
    this._syncRootClasses();

    // A hint up in one presentation's wording switches when the presentation changes.
    const hs = this._hint;
    if (hs.on && hs.src && hs.vr !== (this._forceVR || xr)) {
      hs.vr = this._forceVR || xr;
      const t = this._hintWording(hs.src);
      if (t && t !== hs.text) {
        hs.text = t;
        hs.dirty = true;
        if (this.dom) setRichText(this.dom.hint, t);
      }
    }

    // Death screen fallback (the game normally calls show('death', info) after its fade).
    if (this._deathTimer >= 0) {
      this._deathTimer -= step;
      if (this._deathTimer < 0 && g.state === 'dead' && this.current !== 'death') this.showDeath(null);
    }

    // Note timers (shared by DOM and VR).
    const h = this._hint;
    if (h.on && (g.state === 'playing' || !g.state)) {
      h.t -= step;
      if (h.t <= 0) this.hideHint();
    }
    if (this._title.t > 0) this._title.t = Math.max(0, this._title.t - step);
    if (this._toast.t > 0) {
      this._toast.t = Math.max(0, this._toast.t - step);
      if (this._toast.t === 0 && this.dom) this.dom.toast.classList.remove('is-on');
    }

    if (!xr) this._updateHud(g, step);

    // (input.setUIMode is driven by Game3D from its state — trigger clicks panels while one is up.)

    if (this.vrMode) this._updateVR(step);
    else if (this._vr && this._vr.visible) this._hideVR();
  }

  /** World-space head pose of the camera (x, y, z, yaw) for caption directions. */
  _worldHead() {
    const H = this._headW || (this._headW = { x: 0, y: 0, z: 0, yaw: 0, ok: false });
    const R = this.game && this.game.renderer;
    const cam = R && R.camera;
    if (!cam || !cam.matrixWorld) {
      H.ok = false;
      return H;
    }
    const e = cam.matrixWorld.elements;
    H.x = e[12];
    H.y = e[13];
    H.z = e[14];
    H.yaw = Math.atan2(e[8], e[10]);
    H.ok = isFinite(H.x + H.y + H.z + H.yaw);
    return H;
  }

  _updateCaps(step) {
    const caps = this._caps;
    if (!caps) return;
    caps.update(step, this._worldHead());
    if (caps.rev !== this._capRev) {
      this._capRev = caps.rev;
      this._capDirty = true;
      if (!this._xr && this._capDom) this._updateCaptionsDom();
    }
  }

  // ------------------------------------------------------------------ desktop HUD
  _resetHud() {
    const h = this._hud;
    h.acc = HUD_INTERVAL;
    h.time = '';
    h.depthM = -1;
    h.gauge = -1;
    h.section = -1;
    h.sectionT = 0;
    h.diffKey = '';
    h.tl = '';
    h.tr = '';
    if (this.dom) this.dom.hudSection.classList.remove('is-on');
    this._wristKey = '';
  }

  _tetherState(hand) {
    const T = this.game && this.game.tethers;
    const st = T && T.hands ? T.hands[hand] : null;
    if (!st) return 'idle';
    const an = st.rope ? st.rope.anchor : null;
    if (an) return an.kind === 'fragile' ? 'fragile' : 'attached';
    return st.target ? 'target' : 'idle';
  }

  _updateHud(g, step) {
    const h = this._hud;
    const st = g.state;
    const inRun = st === 'playing' || st === 'paused' || st === 'dead' || st === 'victory';
    if (inRun !== h.inRun) {
      h.inRun = inRun;
      if (!inRun) this._resetHud();
      h.inRun = inRun;
    }
    if (!inRun) return;
    if (h.sectionT > 0) {
      h.sectionT -= step;
      if (h.sectionT <= 0) this.dom.hudSection.classList.remove('is-on');
    }
    // Tether glyphs: cheap string compares every frame, DOM writes only on change.
    const tl = this._tetherState('left');
    if (tl !== h.tl) {
      h.tl = tl;
      this.dom.glyph.left.dataset.state = tl;
      this.dom.glyph.left.setAttribute('aria-label', `Left tether: ${tl}`);
    }
    const tr = this._tetherState('right');
    if (tr !== h.tr) {
      h.tr = tr;
      this.dom.glyph.right.dataset.state = tr;
      this.dom.glyph.right.setAttribute('aria-label', `Right tether: ${tr}`);
    }
    const fx = g.healthFx;
    if (fx && fx.ecgFrame !== h.ecg && this.dom.hudEcg) {
      h.ecg = fx.ecgFrame;
      if (!this._ecgCtx) this._ecgCtx = this.dom.hudEcg.getContext('2d');
      if (this._ecgCtx) this._ecgCtx.drawImage(fx.ecgCanvas, 0, 0);
    }
    const bfx = g.bagFx;
    if (bfx && bfx.iconFrame !== h.bag && this.dom.hudBag) {
      h.bag = bfx.iconFrame;
      if (!this._bagCtx) this._bagCtx = this.dom.hudBag.getContext('2d');
      if (this._bagCtx) this._bagCtx.drawImage(bfx.iconCanvas, 0, 0);
    }
    // Apply progress next to the crosshair (the channel of a first aid kit lasts 5 s: it must be seen).
    const ap = g.bag ? g.bag.applying : null;
    const pq = ap && ap.active ? Math.round((ap.t / ap.dur) * 50) : -1;
    if (pq !== h.apply || (ap && ap.active && ap.kind !== h.applyKind)) {
      h.apply = pq;
      h.applyKind = ap && ap.active ? ap.kind : -1;
      const on = pq >= 0;
      this.dom.bagApply.classList.toggle('is-on', on);
      if (on) {
        this.dom.bagApplyLabel.textContent = `Applying ${ITEM_NAMES[ap.kind] || ''} · ${Math.max(0, ap.dur - ap.t).toFixed(1)} s`;
        this.dom.bagApply.style.setProperty('--p', `${pq * 2}%`);
      }
    }
    h.acc += step;
    if (h.acc < HUD_INTERVAL) return;
    h.acc = 0;
    this._updateStatusDom(g);
    const t = fmtTime(g.time || 0);
    if (t !== h.time) {
      h.time = t;
      this.dom.hudTime.textContent = t;
    }
    const p = g.player;
    if (p) {
      const m = U.depthMeters(num(p.y, 0));
      if (m !== h.depthM) {
        h.depthM = m;
        this.dom.hudDepth.textContent = `${m} m`;
      }
      const level = g.level;
      if (level && level.bounds) {
        if (h.level !== level) this._buildGaugeTicks(level);
        const bottom = this._levelBottom(level);
        const frac = bottom < 0 ? U.clamp(num(p.y, 0) / bottom, 0, 1) : 0;
        if (Math.abs(frac - h.gauge) > 0.002) {
          h.gauge = frac;
          this.dom.gaugeMarker.style.setProperty('--p', frac.toFixed(4));
        }
      }
    }
    if (g.difficultyKey !== h.diffKey) {
      h.diffKey = g.difficultyKey;
      const d = DIFFICULTY[h.diffKey];
      this.dom.hudDiff.textContent = d ? d.label : '';
      const best = d && d.recordTimes !== false ? Storage.getBest(h.diffKey) : null;
      this.dom.hudBest.hidden = best == null;
      if (best != null) this.dom.hudBest.textContent = `Best ${fmtTime(best)}`;
    }
    const si = g.sectionIndex | 0;
    if (si !== h.section) {
      h.section = si;
      const sec = this._sections() ? this._sections()[si] : null;
      if (sec) {
        this.dom.hudSection.textContent = `${ROMAN[si] || si + 1} · ${sec.name}`;
        this.dom.hudSection.classList.add('is-on');
        h.sectionT = SECTION_LABEL_TIME;
      }
    }
  }

  _levelBottom(level) {
    if (level.goal && typeof level.goal.minY === 'number') return Math.min(-1, level.goal.minY);
    return Math.min(-1, num(level.bounds.minY, -560));
  }

  _buildGaugeTicks(level) {
    const h = this._hud;
    h.level = level;
    const box = this.dom.gaugeTicks;
    box.textContent = '';
    const bottom = this._levelBottom(level);
    if (!Array.isArray(level.sections)) return;
    for (let i = 1; i < level.sections.length; i++) {
      const y = num(level.sections[i].yTop, NaN);
      if (!(y === y)) continue;
      const tick = make('i');
      tick.style.top = `${(U.clamp(y / bottom, 0, 1) * 100).toFixed(2)}%`;
      box.appendChild(tick);
    }
  }

  // ===========================================================================
  // VR presentation
  // ===========================================================================
  _ensureVR() {
    if (this._vr) return this._vr;
    const R = this.game && this.game.renderer;
    const scene = R && R.scene;
    if (!scene || !scene.isObject3D) return null;
    const r = this._three();
    const aniso = r && r.capabilities && typeof r.capabilities.getMaxAnisotropy === 'function' ? Math.min(8, r.capabilities.getMaxAnisotropy()) : 4;
    const mkCanvas = (cw, ch, mip) => {
      const canvas = document.createElement('canvas');
      canvas.width = cw * PX;
      canvas.height = ch * PX;
      const ctx = canvas.getContext('2d');
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = aniso;
      tex.generateMipmaps = !!mip;
      tex.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      return { canvas, ctx, tex, cw, ch };
    };
    const mkMat = (map, opts) =>
      new THREE.MeshBasicMaterial(
        Object.assign({ map, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, side: THREE.FrontSide }, opts || {}),
      );
    const mkPlane = (c, w, order, opts) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, (w * c.ch) / c.cw), mkMat(c.tex, opts));
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = true;
      return mesh;
    };

    const vr = { visible: false };
    // Main panel (parented to the rig so it travels with the player).
    vr.root = new THREE.Group();
    vr.root.name = 'UI3D.panelRoot';
    vr.panelC = mkCanvas(CW, CH, true);
    vr.panel = mkPlane(vr.panelC, PANEL_W, RENDER_ORDER);
    vr.panel.name = 'UI3D.panel';
    vr.root.add(vr.panel);
    // Hover frame: fill + 4 borders + notch in one vertex-coloured mesh (no texture re-upload on hover).
    vr.hover = this._makeHoverMesh();
    vr.panel.add(vr.hover);
    // Pointer dot on the panel and the UI ray (thin box from the controller).
    vr.dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.0075, 20),
      new THREE.MeshBasicMaterial({ color: 0xf2e6c9, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
    );
    vr.dot.renderOrder = RENDER_ORDER + 3;
    vr.dot.visible = false;
    vr.panel.add(vr.dot);
    vr.ray = new THREE.Mesh(
      new THREE.BoxGeometry(0.0022, 0.0022, 1).translate(0, 0, -0.5),
      new THREE.MeshBasicMaterial({ color: 0xe8dcc0, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
    );
    // Over the panel up to the hit point (the panel writes no depth), still under the
    // hands (HANDS_RENDER_ORDER_XR 960), so the launcher covers the start of the ray.
    vr.ray.renderOrder = RENDER_ORDER + 4;
    vr.ray.visible = false;
    vr.ray.frustumCulled = false;
    vr.ray.name = 'UI3D.ray';
    scene.add(vr.ray);

    // Tag-along notes.
    vr.notes = new THREE.Group();
    vr.notes.name = 'UI3D.notes';
    vr.hintC = mkCanvas(HINT.cw, HINT.ch, true);
    vr.hint = mkPlane(vr.hintC, HINT.w, RENDER_ORDER - 5);
    vr.titleC = mkCanvas(TITLE.cw, TITLE.ch, true);
    vr.title = mkPlane(vr.titleC, TITLE.w, RENDER_ORDER - 5);
    vr.toastC = mkCanvas(TOAST.cw, TOAST.ch, true);
    vr.toast = mkPlane(vr.toastC, TOAST.w, RENDER_ORDER - 5);
    vr.captionC = mkCanvas(CAPTION.cw, CAPTION.ch, true);
    vr.caption = mkPlane(vr.captionC, CAPTION.w, RENDER_ORDER - 6);
    vr.hint.position.set(0, HINT.dy, 0);
    vr.title.position.set(0, TITLE.dy, 0);
    vr.toast.position.set(0, TOAST.dy, 0);
    vr.caption.position.set(0, CAPTION.dy, 0);
    vr.hint.visible = vr.title.visible = vr.toast.visible = vr.caption.visible = false;
    vr.notes.add(vr.hint, vr.title, vr.toast, vr.caption);

    // Wrist HUD (depth-tested: the hand / controller may cover it, like a real watch).
    // Mipmapped: ~1.6× minified at arm's length, the small text would shimmer otherwise
    // (it repaints at most every 0.2 s, so the mip rebuild is cheap).
    vr.wristC = mkCanvas(WRIST_CW, WRIST_CH, true);
    // Order 961: after the hands (960), so its 8 % see-through shows the bracer, not the
    // world behind it, and after the fade sphere (900), like the hands it is not darkened.
    vr.wrist = mkPlane(vr.wristC, WRIST_W, 961, { depthTest: true, depthWrite: true, transparent: true, alphaTest: 0.02 });
    vr.wrist.name = 'UI3D.wrist';
    vr.wristMount = new THREE.Group();
    vr.wristMount.name = 'UI3D.wristMount';
    vr.wrist.position.set(WRIST_OFFSET[0], WRIST_OFFSET[1], WRIST_OFFSET[2]);
    vr.wrist.rotation.set(WRIST_TILT, 0, 0);
    vr.wristMount.add(vr.wrist);
    vr.wristMount.visible = false;

    vr.root.visible = false;
    vr.notes.visible = false;
    this._vr = vr;
    this._attachVR();
    this._scaleVR();
    return vr;
  }

  /** (Re)parents the panel root / notes to the rig (or the scene) and the wrist mount to the left grip. */
  _attachVR() {
    const vr = this._vr;
    const R = this.game && this.game.renderer;
    if (!vr || !R) return;
    const parent = R.rig && R.rig.isObject3D ? R.rig : R.scene;
    if (vr.root.parent !== parent) parent.add(vr.root);
    if (vr.notes.parent !== parent) parent.add(vr.notes);
    const grip = this._grip;
    const wparent = grip || parent;
    if (vr.wristMount.parent !== wparent) {
      wparent.add(vr.wristMount);
      if (grip) {
        vr.wristMount.position.set(0, 0, 0);
        vr.wristMount.quaternion.identity();
      }
    }
  }

  _hideVR() {
    const vr = this._vr;
    if (!vr) return;
    vr.visible = false;
    vr.root.visible = false;
    vr.notes.visible = false;
    vr.ray.visible = false;
    vr.wristMount.visible = false;
  }

  _makeHoverMesh() {
    const quads = 6;
    const pos = new Float32Array(quads * 4 * 3);
    const col = new Float32Array(quads * 4 * 4);
    const idx = [];
    for (let i = 0; i < quads; i++) {
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setIndex(idx);
    const amber = new THREE.Color(COL.amber);
    const fillC = new THREE.Color('#f0c890');
    // [r,g,b,a] per quad: fill, top, bottom, left, right, notch.
    const quadCol = [
      [fillC.r, fillC.g, fillC.b, 0.1],
      [amber.r, amber.g, amber.b, 0.95],
      [amber.r, amber.g, amber.b, 0.95],
      [amber.r, amber.g, amber.b, 0.95],
      [amber.r, amber.g, amber.b, 0.95],
      [amber.r, amber.g, amber.b, 1],
    ];
    for (let i = 0; i < quads; i++) for (let v = 0; v < 4; v++) col.set(quadCol[i], (i * 4 + v) * 4);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
    );
    mesh.renderOrder = RENDER_ORDER + 1;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.position.z = 0.001;
    return mesh;
  }

  /** Lays the hover frame over a region (logical px). */
  _setHoverFrame(r) {
    const mesh = this._vr.hover;
    if (!r) {
      mesh.visible = false;
      return;
    }
    const sx = PANEL_W / CW;
    const sy = PANEL_H / CH;
    const x0 = (r.x - CW / 2) * sx;
    const x1 = (r.x + r.w - CW / 2) * sx;
    const y0 = (CH / 2 - (r.y + r.h)) * sy;
    const y1 = (CH / 2 - r.y) * sy;
    const b = 0.0035;
    const pos = mesh.geometry.attributes.position.array;
    const quad = (i, ax, ay, bx, by) => {
      const o = i * 12;
      pos[o] = ax;
      pos[o + 1] = ay;
      pos[o + 2] = 0;
      pos[o + 3] = bx;
      pos[o + 4] = ay;
      pos[o + 5] = 0;
      pos[o + 6] = bx;
      pos[o + 7] = by;
      pos[o + 8] = 0;
      pos[o + 9] = ax;
      pos[o + 10] = by;
      pos[o + 11] = 0;
    };
    quad(0, x0, y0, x1, y1);
    quad(1, x0 - b, y1, x1 + b, y1 + b);
    quad(2, x0 - b, y0 - b, x1 + b, y0);
    quad(3, x0 - b, y0, x0, y1);
    quad(4, x1, y0, x1 + b, y1);
    const ny = (y1 - y0) * 0.22;
    quad(5, x0, y0 + ny, x0 + b * 2.2, y1 - ny);
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
    mesh.visible = true;
  }

  /** Finds an XR grip Object3D for `hand` exposed by the input / hands modules (optional). */
  _findGrip(hand) {
    const g = this.game || {};
    // HandsView.wristMount (lifted above the bracer) first, then any grip / hand socket the input exposes.
    const cands = [g.handsView || g.hands, g.renderer && g.renderer.hands, g.input, g.input && (g.input.xr || g.input.xrInput)];
    for (const c of cands) {
      if (!c) continue;
      try {
        for (const fn of ['wristMount', 'gripObject', 'getGrip', 'gripFor', 'handSocket']) {
          if (typeof c[fn] === 'function') {
            const o = c[fn](hand);
            if (o && o.isObject3D) return o;
          }
        }
        if (c.grips && c.grips[hand] && c.grips[hand].isObject3D) return c.grips[hand];
      } catch {
        // keep looking
      }
    }
    return null;
  }

  _inScene(obj) {
    let o = obj;
    for (let i = 0; o && i < 64; i++) {
      if (o.isScene) return true;
      o = o.parent;
    }
    return false;
  }

  /** Head pose in `parent` space → this._head (position + horizontal yaw). */
  _headIn(parent) {
    const R = this.game && this.game.renderer;
    const cam = R && R.camera;
    const H = this._head;
    if (!cam || !cam.matrixWorld) {
      H.ok = false;
      return H;
    }
    const m = this._m;
    // Fresh world matrices (in XR three.js decomposes the head pose into the camera's
    // position/quaternion, so recomposing here is exact).
    cam.updateWorldMatrix(true, false);
    if (parent && parent.matrixWorld) {
      this._m2.copy(parent.matrixWorld).invert();
      m.multiplyMatrices(this._m2, cam.matrixWorld);
    } else {
      m.copy(cam.matrixWorld);
    }
    m.decompose(this._v, this._q, this._s);
    H.x = this._v.x;
    H.y = this._v.y;
    H.z = this._v.z;
    // Forward (−Z): its pitch, then flattened to a yaw.
    this._v2.set(0, 0, -1).applyQuaternion(this._q);
    H.pitch = Math.asin(U.clamp(this._v2.y, -1, 1));
    const fl = Math.hypot(this._v2.x, this._v2.z);
    if (fl > 0.15) H.yaw = Math.atan2(-this._v2.x, -this._v2.z);
    H.ok = isFinite(H.x + H.y + H.z + H.yaw);
    return H;
  }

  _placePanel(H) {
    const p = this._vr.panel;
    // yaw θ: forward = (−sin θ, 0, −cos θ); the panel's +Z faces back at the head. It also
    // follows the head's pitch (clamped): deaths and falls happen looking down, and a
    // panel at eye level would open 60° above the gaze, outside the headset's view.
    const pt = U.clamp(H.pitch || 0, PANEL_PITCH_MIN, PANEL_PITCH_MAX);
    const cp = Math.cos(pt);
    p.position.set(H.x - Math.sin(H.yaw) * cp * PANEL_DIST, H.y + Math.sin(pt) * PANEL_DIST - PANEL_DROP, H.z - Math.cos(H.yaw) * cp * PANEL_DIST);
    p.rotation.set(pt, H.yaw, 0, 'YXZ');
    p.updateMatrixWorld(true);
  }

  _updateVR(dt) {
    const vr = this._ensureVR();
    if (!vr) return;
    const g = this.game || {};
    vr.visible = true;
    // Wrist mount lookup (HandsView.wristMount / an input grip): once a second; only a mount
    // that is actually in the scene graph counts (it is re-parented when the XR hand appears).
    this._gripCheckT -= dt;
    if (this._gripCheckT <= 0) {
      this._gripCheckT = 1;
      const grip = this._findGrip('left');
      this._grip = grip && this._inScene(grip) ? grip : null;
    }
    this._attachVR();

    const parent = vr.root.parent;
    const H = this._headIn(parent);

    // ---- main panel ---------------------------------------------------------
    const panelUp = this.current !== null;
    vr.root.visible = panelUp;
    if (panelUp && H.ok) {
      if (this._needRecenter) {
        this._needRecenter = false;
        this._recenterIfAway = false;
        this._placePanel(H);
      } else if (this._recenterIfAway) {
        this._recenterIfAway = false;
        if (Math.abs(wrapAngle(H.yaw - vr.panel.rotation.y)) > RECENTER_ANGLE) this._placePanel(H);
      }
    }
    if (panelUp && this.current === 'pause' && this._controllersLost() !== this._ctrlLostShown) this._vrDirty = true;
    if (panelUp && this._vrDirty) {
      this._vrDirty = false;
      this._paintPanel();
      vr.panelC.tex.needsUpdate = true;
      this._hover = null;
      this._setHoverFrame(null);
    }
    if (panelUp) this._vrPointer();
    else {
      vr.ray.visible = false;
      if (this._hover) {
        this._hover = null;
        this._setHoverFrame(null);
      }
    }
    // Quest habits: B goes back out of a sub-panel, A selects the hovered button. Rising
    // edges of the intent flags only (a frozen debug frame re-reads the last intent).
    const it = this._intent();
    const back = !!(it && it.backPressed);
    const confirm = !!(it && it.confirmPressed);
    const backEdge = back && !this._prevBack;
    const confirmEdge = confirm && !this._prevConfirm;
    this._prevBack = back;
    this._prevConfirm = confirm;
    if (panelUp && this.current !== null) {
      if (backEdge && SUB_SCREENS[this.current]) {
        // (Game3D's B toggles pause only on the 'pause' screen, so this cannot also resume.)
        this._emitClick();
        this._back();
      } else if (confirmEdge && this._hover && this._hover.act !== 'slide' && this.current !== 'death' && this._clock - this._lastClickAt > CLICK_DEBOUNCE) {
        // (The death panel is excluded: Game3D already rises again on A there.)
        this._lastClickAt = this._clock;
        const r = this._hover;
        this._activateRegion(r, r.x + r.w / 2);
      }
    }

    // ---- notes ------------------------------------------------------------------
    this._updateNotes(dt, H, panelUp);

    // ---- wrist HUD --------------------------------------------------------------
    this._updateWrist(dt, g);
  }

  /** XR: a controller is missing or replaced by a tracked hand (the InputManager pauses the run). */
  _controllersLost() {
    const inp = this.game && this.game.input;
    return !!(this._xr && inp && inp.controllersLost);
  }

  // ---- pointer ---------------------------------------------------------------------
  _intent() {
    const g = this.game || {};
    if (g.intent) return g.intent;
    const inp = g.input;
    return inp ? inp.intent || inp.lastIntent || null : null;
  }

  _vrPointer() {
    const vr = this._vr;
    const intent = this._intent();
    const ray = intent && intent.ui ? intent.ui.ray : null;
    let hit = null;
    if (ray && isFinite(ray.ox + ray.oy + ray.oz + ray.dx + ray.dy + ray.dz)) {
      const panel = vr.panel;
      panel.updateWorldMatrix(true, false);
      const inv = this._m.copy(panel.matrixWorld).invert();
      const o = this._v.set(ray.ox, ray.oy, ray.oz).applyMatrix4(inv);
      const d = this._v2.set(ray.dx, ray.dy, ray.dz).transformDirection(inv);
      if (d.z < -1e-4 && o.z > 0) {
        const t = -o.z / d.z;
        const lx = o.x + d.x * t;
        const ly = o.y + d.y * t;
        if (Math.abs(lx) <= PANEL_W / 2 && Math.abs(ly) <= PANEL_H / 2) {
          hit = this._v3.set(lx, ly, 0.002);
          const px = (lx / PANEL_W + 0.5) * CW;
          const py = (0.5 - ly / PANEL_H) * CH;
          const region = this._regionAt(px, py);
          this._setHover(region);
          vr.dot.position.copy(hit);
          vr.dot.visible = true;
          // Ray: from the controller to the hit (world).
          hit.applyMatrix4(panel.matrixWorld);
          this._aimRay(ray, hit.distanceTo(this._v.set(ray.ox, ray.oy, ray.oz)), 0.75);
          if (intent.ui.click && this._clock - this._lastClickAt > CLICK_DEBOUNCE) {
            this._lastClickAt = this._clock;
            if (region) this._activateRegion(region, px);
          }
          return;
        }
      }
    }
    vr.dot.visible = false;
    this._setHover(null);
    if (ray && isFinite(ray.ox + ray.oy + ray.oz + ray.dx + ray.dy + ray.dz)) this._aimRay(ray, 2.5, 0.25);
    else vr.ray.visible = false;
  }

  _aimRay(ray, len, opacity) {
    const m = this._vr.ray;
    m.position.set(ray.ox, ray.oy, ray.oz);
    this._v2.set(ray.dx, ray.dy, ray.dz).normalize();
    this._q.setFromUnitVectors(this._v3.set(0, 0, -1), this._v2);
    m.quaternion.copy(this._q);
    m.scale.set(1, 1, Math.max(0.01, len));
    m.material.opacity = opacity;
    m.visible = true;
  }

  _regionAt(px, py) {
    const list = this._regions;
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r;
    }
    return null;
  }

  _setHover(region) {
    if (region === this._hover) return;
    this._hover = region;
    this._setHoverFrame(region);
    if (region) {
      const g = this.game || {};
      const s = this._settings();
      if (g.input && typeof g.input.haptic === 'function' && s.haptics !== false) {
        try {
          // The hand that is actually pointing (a click with the other trigger moves the pointer there).
          const hand = g.input.uiHand === 'left' || g.input.uiHand === 'right' ? g.input.uiHand : s.dominantHand === 'left' ? 'left' : 'right';
          g.input.haptic(hand, 0.12, 12);
        } catch {
          // optional
        }
      }
    }
  }

  _activateRegion(r, px) {
    this._emitClick();
    this._unlockAudio();
    const data = { diff: r.diff, section: r.section, key: r.key, value: r.value };
    if (r.act === 'slide') data.value = (px - r.x) / r.w;
    this._action(r.act, data, true);
  }

  // ---- painting the panel ----------------------------------------------------------------
  _region(x, y, w, h, act, extra) {
    const r = { x, y, w, h, act, diff: null, section: null, key: null, value: null };
    if (extra) Object.assign(r, extra);
    this._regions.push(r);
    return r;
  }

  _paintPanel() {
    const c = this._vr.panelC;
    const ctx = c.ctx;
    this._regions.length = 0;
    ctx.setTransform(PX, 0, 0, PX, 0, 0);
    ctx.clearRect(0, 0, CW, CH);
    const s = this.current;
    try {
      if (s === 'menu') this._paintMenu(ctx);
      else if (s === 'difficulty') this._paintDifficulty(ctx);
      else if (s === 'controls') this._paintControls(ctx);
      else if (s === 'settings') this._paintSettings(ctx);
      else if (s === 'about') this._paintAbout(ctx);
      else if (s === 'calibrate') this._paintCalibrate(ctx);
      else if (s === 'records') this._paintRecords(ctx);
      else if (s === 'pause') this._paintPause(ctx);
      else if (s === 'death') this._paintDeath(ctx);
      else if (s === 'victory') this._paintVictory(ctx);
    } catch (err) {
      if (typeof console !== 'undefined') console.error('[AT3D] VR panel paint failed', err);
    }
  }

  _frame(ctx, tone) {
    const g = ctx.createLinearGradient(0, 0, 0, CH);
    if (tone === 'death') {
      g.addColorStop(0, 'rgba(26,12,10,0.94)');
      g.addColorStop(1, 'rgba(8,4,4,0.97)');
    } else if (tone === 'victory') {
      g.addColorStop(0, 'rgba(34,27,16,0.95)');
      g.addColorStop(1, 'rgba(10,10,10,0.97)');
    } else {
      g.addColorStop(0, 'rgba(21,24,25,0.95)');
      g.addColorStop(1, 'rgba(10,11,12,0.97)');
    }
    rr(ctx, 3, 3, CW - 6, CH - 6, 10);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COL.line2;
    ctx.stroke();
    // Riveted iron corner brackets.
    ctx.strokeStyle = tone === 'death' ? 'rgba(194,122,92,0.6)' : 'rgba(224,160,80,0.6)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(4, 44);
    ctx.lineTo(4, 4);
    ctx.lineTo(44, 4);
    ctx.moveTo(CW - 4, CH - 44);
    ctx.lineTo(CW - 4, CH - 4);
    ctx.lineTo(CW - 44, CH - 4);
    ctx.stroke();
  }

  _header(ctx, title) {
    this._btn(ctx, this._region(20, 18, 150, 64, 'back'), '‹  Back', null, { ghost: true, size: 28 });
    txt(ctx, title.toUpperCase(), CW / 2, 62, `400 38px ${F_DISPLAY}`, COL.phosphor, 'center', 0.16);
    const g = ctx.createLinearGradient(40, 0, CW - 40, 0);
    g.addColorStop(0, 'rgba(232,220,192,0)');
    g.addColorStop(0.5, 'rgba(232,220,192,0.22)');
    g.addColorStop(1, 'rgba(232,220,192,0)');
    ctx.fillStyle = g;
    ctx.fillRect(40, 98, CW - 80, 2);
  }

  /** Button: label (+ optional sub-label); o = {primary, ghost, vr, current, size, align}. */
  _btn(ctx, r, label, sub, o) {
    const opt = o || {};
    ctx.save();
    rr(ctx, r.x, r.y, r.w, r.h, 6);
    if (!opt.ghost) {
      const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
      if (opt.primary) {
        g.addColorStop(0, 'rgba(74,52,27,0.97)');
        g.addColorStop(1, 'rgba(36,26,16,0.98)');
      } else if (opt.vr) {
        g.addColorStop(0, 'rgba(28,48,45,0.97)');
        g.addColorStop(1, 'rgba(14,24,23,0.98)');
      } else {
        g.addColorStop(0, 'rgba(40,45,47,0.96)');
        g.addColorStop(1, 'rgba(22,25,27,0.97)');
      }
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = opt.primary ? 'rgba(224,160,80,0.7)' : opt.vr ? 'rgba(106,156,144,0.75)' : opt.ghost ? COL.line2 : COL.line3;
    ctx.stroke();
    if (opt.current) {
      ctx.fillStyle = COL.amber;
      ctx.fillRect(r.x - 1, r.y + r.h * 0.2, 5, r.h * 0.6);
    }
    const size = opt.size || 30;
    const color = opt.primary ? COL.warm : opt.vr ? '#d6efe8' : opt.ghost ? COL.ink2 : COL.ink;
    const align = opt.align || 'center';
    const tx = align === 'left' ? r.x + 24 : r.x + r.w / 2;
    const font = `650 ${size}px ${F_UI}`;
    const lab = label.toUpperCase();
    const fit = fitSize(ctx, lab, r.w - 24, size, 28, (px) => `650 ${px}px ${F_UI}`, 0.06);
    if (sub) {
      txt(ctx, lab, tx, r.y + r.h / 2 - 4, `650 ${fit}px ${F_UI}`, color, align, 0.06);
      const sf = `500 28px ${F_UI}`;
      txt(ctx, ellipsize(ctx, sub, r.w - 28, sf), tx, r.y + r.h / 2 + 30, sf, opt.primary ? 'rgba(240,210,160,0.8)' : COL.ink3, align, 0);
    } else {
      txt(ctx, lab, tx, r.y + r.h / 2 + size * 0.36, fit === size ? font : `650 ${fit}px ${F_UI}`, color, align, 0.06);
    }
    ctx.restore();
  }

  _paintMenu(ctx) {
    this._frame(ctx);
    const cx = CW / 2;
    txt(ctx, 'THE UNDERSPIRE', cx, 62, `400 28px ${F_DISPLAY}`, COL.amber, 'center', 0.42);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    txt(ctx, 'ABYSSAL', cx + 8, 158, `700 100px ${F_DISPLAY}`, COL.title, 'center', 0.1);
    ctx.restore();
    // The tether between the words: line, lamp, line.
    const ly = 186;
    for (const sgn of [-1, 1]) {
      const g = ctx.createLinearGradient(cx + sgn * 190, 0, cx + sgn * 26, 0);
      g.addColorStop(0, 'rgba(232,220,192,0)');
      g.addColorStop(1, 'rgba(232,220,192,0.5)');
      ctx.fillStyle = g;
      ctx.fillRect(Math.min(cx + sgn * 190, cx + sgn * 26), ly - 1, 164, 2);
    }
    ctx.save();
    ctx.shadowColor = 'rgba(224,160,80,0.8)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = COL.amber;
    diamond(ctx, cx, ly, 10);
    ctx.fill();
    ctx.restore();
    const tf = `700 50px ${F_DISPLAY}`;
    const tw = measure(ctx, 'TETHER', tf, 0.62);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    txt(ctx, 'TETHER', cx - tw / 2 + 15, 252, tf, COL.titleB, 'left', 0.62);
    ctx.restore();
    // The "VR" mark.
    const bx = cx + tw / 2 + 4;
    rr(ctx, bx, 214, 66, 44, 6);
    ctx.lineWidth = 3;
    ctx.strokeStyle = COL.amber;
    ctx.stroke();
    ctx.fillStyle = 'rgba(224,160,80,0.12)';
    ctx.fill();
    txt(ctx, 'VR', bx + 33, 247, `800 30px ${F_UI}`, COL.amber, 'center', 0.06);
    txt(ctx, 'A lantern, a line, and a long way down. No one has climbed back.', cx, 304, `italic 400 30px ${F_DISPLAY}`, COL.ink2, 'center', 0, CW - 80);

    const key = this._defaultDifficulty();
    const best = Storage.getBest(key);
    const sub = best != null ? `${DIFFICULTY[key].label} · best ${fmtTime(best)}` : DIFFICULTY[key].label;
    const cont = this._continueInfo();
    const x0 = 212;
    const w = 600;
    const hw = (w - 16) / 2;
    if (cont) {
      this._btn(ctx, this._region(x0, 330, w, 104, 'continue-run'), 'Continue', this._continueLine(cont), { primary: true, size: 34 });
      this._btn(ctx, this._region(x0, 448, hw, 84, 'difficulty'), 'New descent', null, {});
    } else {
      this._btn(ctx, this._region(x0, 330, w, 104, 'start'), 'Begin descent', sub, { primary: true, size: 34 });
      this._btn(ctx, this._region(x0, 448, hw, 84, 'difficulty'), 'Difficulty', null, {});
    }
    this._btn(ctx, this._region(x0 + hw + 16, 448, hw, 84, 'sandbox'), 'Sandbox', 'No predator', {});
    const th = (w - 24) / 3;
    this._btn(ctx, this._region(x0, 546, th, 76, 'settings'), 'Settings', null, { size: 28 });
    this._btn(ctx, this._region(x0 + th + 12, 546, th, 76, 'controls'), 'Controls', null, { size: 28 });
    this._btn(ctx, this._region(x0 + (th + 12) * 2, 546, th, 76, 'about'), 'About', null, { size: 28 });
    if (this._updateReady) {
      ctx.fillStyle = COL.amber;
      diamond(ctx, x0 + (th + 12) * 2 + th - 18, 546 + 18, 9);
      ctx.fill();
    }
    // Records (LEVEL_FUN_PLAN P6): the best times ride on the button that opens the section records.
    const bests = DIFFICULTY_ORDER.map((k) => {
      const b = Storage.getBest(k);
      return `${DIFFICULTY[k].label} ${b != null ? fmtTime(b) : '—'}`;
    });
    this._btn(ctx, this._region(x0, 634, w, 88, 'records'), 'Records', bests.join('  ·  '), { size: 30 });
    if (this._updateReady) txt(ctx, 'Update ready: it installs next time you start the game', cx, 752, `500 28px ${F_UI}`, COL.amber, 'center', 0.02);
    else if (!this._settings().brightnessChecked) txt(ctx, 'A dark game: check Settings › Display › Brightness', cx, 752, `500 28px ${F_UI}`, COL.ink3, 'center', 0.02);
    else txt(ctx, 'Point and pull the trigger', cx, 752, `500 28px ${F_UI}`, COL.ink4, 'center', 0.02);
    if (this._xr) this._btn(ctx, this._region(CW - 168, 18, 148, 60, 'exit-vr'), 'Exit VR', null, { ghost: true, size: 28 });
  }

  _paintDifficulty(ctx) {
    this._frame(ctx);
    this._header(ctx, 'Choose your descent');
    const last = this._defaultDifficulty();
    const gap = 20;
    const cw = (CW - 48 - gap * 2) / 3;
    const y = 122;
    const h = 568;
    DIFFICULTY_ORDER.forEach((k, i) => {
      const d = DIFFICULTY[k];
      const x = 24 + i * (cw + gap);
      const r = this._region(x, y, cw, h, 'start-diff', { diff: k });
      ctx.save();
      rr(ctx, r.x, r.y, r.w, r.h, 6);
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, 'rgba(36,40,42,0.96)');
      g.addColorStop(1, 'rgba(18,20,22,0.97)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = k === last ? 'rgba(224,160,80,0.55)' : COL.line3;
      ctx.stroke();
      ctx.restore();
      for (let j = 0; j < 3; j++) {
        diamond(ctx, x + 34 + j * 30, y + 40, 10);
        if (j <= i) {
          ctx.fillStyle = COL.amber;
          ctx.fill();
        } else {
          ctx.lineWidth = 2;
          ctx.strokeStyle = COL.ink3;
          ctx.stroke();
        }
      }
      if (k === last) txt(ctx, 'LAST', x + cw - 22, y + 50, `650 28px ${F_UI}`, COL.amber, 'right', 0.12);
      const nm = d.label.toUpperCase();
      // The card's name must fit on any headset's font set (Quest has no Georgia):
      // shrink first, then drop the tracking, then condense as a last resort.
      const nameW = cw - 44;
      let ns = fitSize(ctx, nm, nameW, 40, 26, (px) => `700 ${px}px ${F_DISPLAY}`, 0.08);
      let tr = 0.08;
      if (measure(ctx, nm, `700 ${ns}px ${F_DISPLAY}`, tr) > nameW) {
        tr = 0;
        ns = fitSize(ctx, nm, nameW, 40, 26, (px) => `700 ${px}px ${F_DISPLAY}`, 0);
      }
      txt(ctx, nm, x + 22, y + 108, `700 ${ns}px ${F_DISPLAY}`, COL.phosphor, 'left', tr, nameW);
      const bf = `400 28px ${F_UI}`;
      const lines = wrapLines(ctx, d.blurb, cw - 44, bf).slice(0, 7);
      lines.forEach((ln, li) => txt(ctx, ln, x + 22, y + 158 + li * 36, bf, COL.ink2, 'left', 0));
      ctx.fillStyle = COL.line;
      ctx.fillRect(x + 22, y + h - 118, cw - 44, 2);
      const best = Storage.getBest(k);
      const deep = num(Storage.get(`deepest.${k}`, 0), 0);
      txt(ctx, 'Best', x + 22, y + h - 70, `500 28px ${F_UI}`, COL.ink3, 'left', 0);
      txt(ctx, best != null ? fmtTime(best) : '—', x + 92, y + h - 70, `650 30px ${F_UI}`, best != null ? COL.ink : COL.ink4, 'left', 0);
      txt(ctx, deep > 0 ? `Deepest ${fmtMeters(deep)}` : 'Not yet descended', x + 22, y + h - 28, `500 28px ${F_UI}`, COL.ink4, 'left', 0);
    });
    txt(ctx, 'Best times are kept on this headset.', CW / 2, 740, `500 28px ${F_UI}`, COL.ink3, 'center', 0);
  }

  _keycaps(ctx, keys, x, y, size) {
    let cx = x;
    const f = `650 ${size}px ${F_UI}`;
    for (const k of keys) {
      const w = measure(ctx, k, f, 0) + 24;
      rr(ctx, cx, y - size - 6, w, size + 18, 5);
      const g = ctx.createLinearGradient(0, y - size - 6, 0, y + 12);
      g.addColorStop(0, '#2a2f31');
      g.addColorStop(1, '#1b1f21');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COL.line3;
      ctx.stroke();
      txt(ctx, k, cx + w / 2, y + 2, f, COL.phosphor, 'center', 0);
      cx += w + 10;
    }
    return cx;
  }

  _paintControls(ctx) {
    this._frame(ctx);
    this._header(ctx, 'Controls');
    txt(ctx, 'META QUEST TOUCH CONTROLLERS', 44, 148, `400 28px ${F_DISPLAY}`, COL.ink2, 'left', 0.16);
    const rowH = CONTROLS_QUEST.length > 8 ? 54 : 64; // 10 rows: 212 + 9 × 54 = 698, above the footer
    CONTROLS_QUEST.forEach(([keys, , short], i) => {
      const y = 212 + i * rowH;
      this._keycaps(ctx, keys, 44, y, 28);
      txt(ctx, short, 420, y, `400 30px ${F_UI}`, COL.ink, 'left', 0);
      if (i < CONTROLS_QUEST.length - 1) {
        // Midway between this row's keycap (bottom y + 12) and the next one's (top y + rowH − 34).
        ctx.fillStyle = COL.line;
        ctx.fillRect(44, y + Math.round((rowH - 22) / 2), CW - 88, 1);
      }
    });
    txt(ctx, 'Comfort options are in Settings. Pause any time.', CW / 2, 740, `italic 400 28px ${F_DISPLAY}`, COL.ink3, 'center', 0);
  }

  _paintSettings(ctx) {
    this._frame(ctx);
    const page = this._vrSetPage === 1;
    this._header(ctx, page ? 'Player height' : 'Settings');
    const s = this._settings();
    if (page) {
      this._paintHeightPage(ctx, s, 94);
      return;
    }
    const gap = 12;
    const tw = (CW - 88 - gap * (VR_TABS.length - 1)) / VR_TABS.length;
    VR_TABS.forEach((t, i) => {
      this._btn(ctx, this._region(44 + i * (tw + gap), 112, tw, 64, 'tab', { value: i }), t.label, null, { primary: i === this._vrTab, size: 28 });
    });
    const tab = VR_TABS[this._vrTab] || VR_TABS[0];
    const rows = SETTINGS_SCHEMA.filter((d) => d.tab === tab.id && !d.desktop && !d.page && (d.key || d.type === 'link'));
    // six rows (Comfort since P6's Wind squalls, Display since Blood writing) still fit above the panel's foot: 80 px a row instead of 88
    const rowH = rows.filter((d) => d.key).length > 5 ? 80 : 88;
    let y = 190;
    for (const def of rows) {
      if (def.type === 'link') {
        this._btn(ctx, this._region(44, y + 4, CW - 88, 72, def.action, { value: def.value }), `${def.label}  ›`, null, { size: 30 });
        y += 84;
      } else {
        this._paintSettingRow(ctx, def, y, rowH, s);
        y += rowH;
      }
    }
    if (tab.id === 'access') this._btn(ctx, this._region(CW / 2 - 200, y + 14, 400, 70, 'reset-settings'), 'Reset to defaults', null, { ghost: true, size: 28 });
  }

  /** One settings row at y: label + value, then a − slider + for ranges or option buttons (rows of 80 px are squeezed). */
  _paintSettingRow(ctx, def, y, rowH, s) {
    const v = def.key in s ? s[def.key] : SETTINGS_DEFAULTS[def.key];
    const tight = rowH < 88;
    const bt = tight ? 8 : 14; // button top within the row
    const bh = tight ? 64 : 68;
    txt(ctx, def.label, 44, y + (tight ? 38 : 42), `600 30px ${F_UI}`, COL.ink, 'left', 0);
    if (def.type === 'range') {
      const val = U.clamp(num(v, def.min), def.min, def.max);
      txt(ctx, def.fmt(val), 44, y + (tight ? 72 : 78), `650 28px ${F_UI}`, COL.phosphor, 'left', 0);
      this._btn(ctx, this._region(500, y + bt, 68, bh, 'nudge', { key: def.key, value: -1 }), '−', null, { size: 36 });
      const tx = 588;
      const tw = 280;
      const r = this._region(tx, y + bt, tw, bh, 'slide', { key: def.key });
      const f = (val - def.min) / (def.max - def.min);
      rr(ctx, tx, r.y + 28, tw, 12, 6);
      ctx.fillStyle = '#30363a';
      ctx.fill();
      rr(ctx, tx, r.y + 28, Math.max(12, tw * f), 12, 6);
      ctx.fillStyle = COL.amber2;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tx + tw * f, r.y + 34, 15, 0, Math.PI * 2);
      ctx.fillStyle = COL.phosphor;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#1a1d1f';
      ctx.stroke();
      this._btn(ctx, this._region(888, y + bt, 68, bh, 'nudge', { key: def.key, value: 1 }), '+', null, { size: 36 });
    } else {
      const opts = def.type === 'toggle' ? [[true, 'On'], [false, 'Off']] : def.options;
      const many = opts.length > 2;
      const bw = many ? (480 - 8 * (opts.length - 1)) / opts.length : 176;
      opts.forEach(([value, label], j) => {
        const on = value === v;
        const bx = many ? 500 + j * (bw + 8) : 588 + j * 188;
        this._btn(ctx, this._region(bx, y + bt, bw, bh, 'set', { key: def.key, value }), label, null, { primary: on, size: 28 });
      });
    }
    ctx.fillStyle = COL.line;
    ctx.fillRect(44, y + rowH - 2, CW - 88, 1);
  }

  /** VR settings page 2: Standing / Seated, the fine trim, the eye height readout, Calibrate and Reset. */
  _paintHeightPage(ctx, s, rowH) {
    const defs = SETTINGS_SCHEMA.filter((d) => d.key && (d.page === 'height' || d.key === 'heightMode'));
    defs.forEach((def, i) => this._paintSettingRow(ctx, def, 112 + i * rowH, rowH, s));
    const h = this._heightInfo();
    const y0 = 112 + defs.length * rowH + 10;
    txt(ctx, 'EYE HEIGHT', 44, y0 + 30, `400 24px ${F_DISPLAY}`, COL.ink3, 'left', 0.16);
    txt(ctx, h.head, 44, y0 + 98, `650 64px ${F_UI}`, COL.phosphor, 'left', 0);
    txt(ctx, h.line1, 340, y0 + 56, `500 26px ${F_UI}`, COL.ink2, 'left', 0);
    txt(ctx, h.line2, 340, y0 + 94, `500 26px ${F_UI}`, COL.ink3, 'left', 0);
    const by = 636;
    if (h.msg) txt(ctx, h.msg, CW / 2, by - 18, `650 30px ${F_UI}`, this._cal ? COL.amber : COL.verdigris, 'center', 0.02);
    const label = this._cal ? `Hold still… ${Math.max(1, Math.ceil(this._cal.t))}` : 'Calibrate';
    const sub = this._cal ? 'Press again to cancel' : this._xr ? 'Stand (or sit) normally, then press' : 'Put the headset on to calibrate';
    this._btn(ctx, this._region(44, by, 640, 90, 'calibrate-height'), label, sub, { primary: !this._cal, size: 30 });
    this._btn(ctx, this._region(704, by, 276, 90, 'reset-height'), 'Reset height', null, { ghost: true, size: 28 });
  }

  _paintAbout(ctx) {
    this._frame(ctx);
    this._header(ctx, 'About');
    const cx = CW / 2;
    txt(ctx, 'ABYSSAL TETHER', cx, 160, `700 46px ${F_DISPLAY}`, COL.title, 'center', 0.12);
    txt(ctx, 'CHAPTER I · THE UNDERSPIRE · FREE', cx, 198, `400 28px ${F_DISPLAY}`, COL.amber, 'center', 0.2);
    const lab = `650 28px ${F_UI}`;
    const val = `500 28px ${F_UI}`;
    const row = (y, label, text, color) => {
      txt(ctx, label, 44, y, lab, COL.ink3, 'left', 0.1);
      txt(ctx, ellipsize(ctx, text, CW - 330, val), 290, y, val, color || COL.ink, 'left', 0);
    };
    row(262, 'VERSION', this._versionLine());
    const u = this.game && this.game.updates;
    const ready = this._updateReady || (u && u.ready);
    txt(ctx, 'UPDATE', 44, 318, lab, COL.ink3, 'left', 0.1);
    const ul = wrapLines(ctx, this._updateLine(), CW - 330, val);
    ul.slice(0, 2).forEach((ln, i) => txt(ctx, ln, 290, 318 + i * 36, val, ready ? COL.amber : COL.ink, 'left', 0));
    if (ready && !this._xr) this._btn(ctx, this._region(CW - 260, 288, 216, 60, 'apply-update'), 'Restart', null, { size: 28 });
    row(410, 'PRIVACY', this._privacyUrl());
    row(458, 'SUPPORT', this._supportUrl());
    txt(ctx, 'No account. Nothing about you leaves this headset.', 44, 514, val, COL.ink2, 'left', 0);
    const credits = 'Created by the Abyssal Tether team. Original world, creature, score and sound (synthesised live). Built with three.js (MIT) and Blender.';
    wrapLines(ctx, credits, CW - 88, `400 28px ${F_UI}`)
      .slice(0, 3)
      .forEach((ln, i) => txt(ctx, ln, 44, 568 + i * 36, `400 28px ${F_UI}`, COL.ink3, 'left', 0));
    const armed = this._armed === 'erase-data';
    this._btn(ctx, this._region(CW / 2 - 220, 690, 440, 62, 'erase-data'), armed ? 'Press again to erase' : 'Erase saved data', null, { ghost: !armed, primary: armed, size: 28 });
  }

  _paintCalibrate(ctx) {
    this._frame(ctx);
    this._header(ctx, 'Brightness');
    this._btn(ctx, this._region(CW - 190, 18, 170, 64, 'cal-reset'), 'Reset', null, { ghost: true, size: 28 });
    const cx = CW / 2;
    txt(ctx, 'Raise Black level until square 2 is just visible,', cx, 142, `500 28px ${F_UI}`, COL.ink2, 'center', 0);
    txt(ctx, 'while square 1 stays black.', cx, 178, `500 28px ${F_UI}`, COL.ink2, 'center', 0);
    this._paintPatches(ctx, 44, 196, CW - 88, 124);
    // A window onto the world behind the panel, so Brightness can be judged on the real picture.
    const wy = 338;
    const wh = 150;
    ctx.clearRect(44, wy, CW - 88, wh);
    ctx.lineWidth = 2;
    ctx.strokeStyle = COL.line3;
    ctx.strokeRect(44, wy, CW - 88, wh);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 8;
    txt(ctx, 'The world, as it looks now', cx, wy + wh - 16, `500 28px ${F_UI}`, COL.ink, 'center', 0);
    ctx.restore();
    const s = this._settings();
    const defs = SETTINGS_SCHEMA.filter((d) => d.key && d.page === 'calibrate');
    defs.forEach((def, i) => this._paintSettingRow(ctx, def, 504 + i * 94, 94, s));
  }

  /** VR: the section records of one difficulty (P6): difficulty tabs, then one row per section: numeral, name, best, medal, next. */
  _paintRecords(ctx) {
    this._frame(ctx);
    this._header(ctx, 'Section records');
    const diff = this._recordsDiff();
    const gap = 12;
    const tw = (CW - 88 - gap * 2) / 3;
    DIFFICULTY_ORDER.forEach((k, i) => {
      this._btn(ctx, this._region(44 + i * (tw + gap), 112, tw, 62, 'rec-tab', { diff: k }), DIFFICULTY[k].label, null, { primary: k === diff, size: 28 });
    });
    const rows = this._recordRowsFor(diff);
    const y0 = 200;
    const rh = Math.min(62, Math.floor(470 / Math.max(1, rows.length)));
    const hf = `650 28px ${F_UI}`;
    txt(ctx, 'BEST', 520, y0, hf, COL.ink3, 'left', 0.12);
    txt(ctx, 'MEDAL', 652, y0, hf, COL.ink3, 'left', 0.12);
    txt(ctx, 'NEXT', 812, y0, hf, COL.ink3, 'left', 0.12);
    const vf = `650 30px ${F_UI}`;
    const nf = `500 28px ${F_UI}`;
    rows.forEach((r, i) => {
      const y = y0 + 16 + i * rh;
      const by = y + rh / 2 + 10;
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,240,210,0.03)';
        ctx.fillRect(36, y, CW - 72, rh);
      }
      txt(ctx, r.numeral, 50, by, `700 30px ${F_DISPLAY}`, COL.amber, 'left', 0);
      txt(ctx, ellipsize(ctx, r.name, 380, nf), 128, by, nf, COL.ink2, 'left', 0);
      txt(ctx, r.best == null ? '—' : fmtSplit(r.best), 520, by, vf, r.best == null ? COL.ink4 : COL.ink, 'left', 0);
      if (r.medal) {
        ctx.beginPath();
        ctx.arc(664, by - 10, 11, 0, Math.PI * 2);
        ctx.fillStyle = MEDAL_COLOR[r.medal];
        ctx.fill();
        txt(ctx, MEDAL_LABEL[r.medal], 684, by, `650 28px ${F_UI}`, COL.ink, 'left', 0);
      } else txt(ctx, '—', 652, by, vf, COL.ink4, 'left', 0);
      const t = targetText(r);
      txt(ctx, ellipsize(ctx, t, CW - 44 - 812, `500 28px ${F_UI}`), 812, by, `500 28px ${F_UI}`, r.next ? COL.ink3 : COL.ink4, 'left', 0);
    });
    const tally = tallyLine(medalTally(rows)) || `No whole section played on ${DIFFICULTY[diff].label} yet`;
    txt(ctx, ellipsize(ctx, tally, CW - 88, `500 28px ${F_UI}`), CW / 2, 710, `500 28px ${F_UI}`, COL.ink2, 'center', 0.02);
    txt(ctx, 'Gold ≤ par · silver ≤ 1.4 × · brass ≤ 2 ×   (par: the verified route)', CW / 2, 748, `500 28px ${F_UI}`, COL.ink4, 'center', 0, CW - 60);
  }

  _paintPause(ctx) {
    this._frame(ctx);
    const g = this.game || {};
    const won = this._victoryRunning();
    const sandbox = g.difficultyKey === 'sandbox';
    const sections = sandbox && !won ? this._sections() : null;
    txt(ctx, 'PAUSED', CW / 2, 78, `400 48px ${F_DISPLAY}`, COL.phosphor, 'center', 0.16);
    this._ctrlLostShown = this._controllersLost();
    if (this._ctrlLostShown) txt(ctx, 'Pick up both controllers to continue', CW / 2, 124, `650 30px ${F_UI}`, COL.amber, 'center', 0.02);
    else txt(ctx, this._runLine(), CW / 2, 124, `500 28px ${F_UI}`, COL.ink3, 'center', 0.04);
    const items = [['resume', 'Resume', { primary: true }]];
    if (!won && this._canRespawn() && g.player) items.push(['respawn', 'Restart section', {}]);
    items.push(['restart', 'Restart descent', {}], ['settings', 'Settings', {}], ['controls', 'Controls', {}], ['quit', 'Quit to menu', { ghost: true }]);
    const bw = sections ? 440 : 520;
    const bx = sections ? 40 : (CW - bw) / 2;
    const bh = items.length > 5 ? 78 : 86;
    items.forEach(([act, label, o], i) => {
      this._btn(ctx, this._region(bx, 158 + i * (bh + 12), bw, bh, act), label, null, Object.assign({ size: 30 }, o));
    });
    if (sections) {
      const wx = 508;
      txt(ctx, 'WARP TO SECTION', wx, 186, `400 28px ${F_DISPLAY}`, COL.ink2, 'left', 0.16);
      const cur = g.sectionIndex | 0;
      const ww = (CW - wx - 40 - 12) / 2;
      sections.slice(0, 10).forEach((sec, i) => {
        const col = i % 2;
        const row = (i / 2) | 0;
        const r = this._region(wx + col * (ww + 12), 210 + row * 102, ww, 90, 'warp', { section: String(i) });
        ctx.save();
        rr(ctx, r.x, r.y, r.w, r.h, 6);
        ctx.fillStyle = 'rgba(22,25,27,0.95)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = i === cur ? 'rgba(224,160,80,0.6)' : COL.line2;
        ctx.stroke();
        ctx.restore();
        txt(ctx, ROMAN[i] || String(i + 1), r.x + 18, r.y + 40, `700 30px ${F_DISPLAY}`, COL.amber, 'left', 0);
        const nf = `500 28px ${F_UI}`;
        txt(ctx, ellipsize(ctx, sec.name || `Section ${i + 1}`, r.w - 36, nf), r.x + 18, r.y + 76, nf, COL.ink2, 'left', 0);
      });
    }
    if (this._xr) this._btn(ctx, this._region(CW - 168, 18, 148, 60, 'exit-vr'), 'Exit VR', null, { ghost: true, size: 28 });
  }

  _paintDeath(ctx) {
    this._frame(ctx, 'death');
    const i = this._deathInfo || this._deathFrom(null);
    const copy = DEATH_COPY[i.cause] || DEATH_COPY.impact;
    const cx = CW / 2;
    txt(ctx, copy.kicker.toUpperCase(), cx, 130, `400 28px ${F_DISPLAY}`, COL.rust, 'center', 0.3);
    const mf = `400 54px ${F_DISPLAY}`;
    const lines = wrapLines(ctx, i.message || copy.message, CW - 160, mf).slice(0, 2);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 20;
    lines.forEach((ln, k) => txt(ctx, ln, cx, 212 + k * 64, mf, COL.phosphor, 'center', 0.02));
    ctx.restore();
    const sy = 212 + lines.length * 64 + 8;
    txt(ctx, `Deaths ${i.deaths}  ·  ${fmtMeters(i.depthMeters)}  ·  ${fmtTime(i.time)}`, cx, sy, `500 28px ${F_UI}`, COL.ink3, 'center', 0.06);
    const bw = 540;
    const bx = (CW - bw) / 2;
    const by = sy + 40;
    this._btn(ctx, this._region(bx, by, bw, 104, 'continue'), i.canRespawn ? 'Continue' : 'Begin again', i.canRespawn ? 'from the last checkpoint' : 'no checkpoints on this difficulty', {
      primary: true,
      size: 34,
    });
    const hw = (bw - 16) / 2;
    this._btn(ctx, this._region(bx, by + 118, hw, 80, 'restart'), 'Restart descent', null, {});
    this._btn(ctx, this._region(bx + hw + 16, by + 118, hw, 80, 'quit'), 'Menu', null, { ghost: true });
    const pr = i.prompt || (i.canRespawn ? 'A (or point + trigger) to rise again · hold X to restart' : 'A (or point + trigger) to begin again');
    const pf = `500 ${fitSize(ctx, pr, CW - 80, 28, 22, (px) => `500 ${px}px ${F_UI}`, 0.02)}px ${F_UI}`;
    txt(ctx, pr, cx, Math.min(CH - 30, by + 250), pf, COL.ink3, 'center', 0.02);
  }

  /** The end card after Chapter I: the result, then the hook (no purchase button, no store link: it is a teaser). */
  _paintVictory(ctx) {
    this._frame(ctx, 'victory');
    const i = this._victoryInfo || this._victoryFrom(null);
    const cx = CW / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(224,160,80,0.9)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = COL.amber;
    diamond(ctx, cx, 44, 13);
    ctx.fill();
    ctx.restore();
    txt(ctx, 'CHAPTER I · THE UNDERSPIRE', cx, 100, `400 28px ${F_DISPLAY}`, COL.amber, 'center', 0.34);
    txt(ctx, 'You reached the bottom', cx, 154, `400 48px ${F_DISPLAY}`, COL.phosphor, 'center', 0.02);
    txt(ctx, 'DESCENT TIME', cx, 200, `650 28px ${F_UI}`, COL.ink3, 'center', 0.2);
    txt(ctx, fmtTime(i.time), cx, 278, `650 78px ${F_UI}`, COL.warm, 'center', 0.02);
    const recorded = i.recorded !== false && i.difficultyKey !== 'sandbox';
    if (recorded && i.isNew) {
      const bf = `750 28px ${F_UI}`;
      const bw = measure(ctx, '★ NEW BEST', bf, 0.14) + 32;
      rr(ctx, cx - bw / 2, 292, bw, 42, 4);
      ctx.fillStyle = COL.amber;
      ctx.fill();
      txt(ctx, '★ NEW BEST', cx, 323, bf, '#1a1206', 'center', 0.14);
    }
    const cells = [
      ['FALLS', String(i.falls != null ? i.falls : i.deaths || 0)],
      ['LOWEST HP', pct(U.clamp(num(i.lowestHp, 1), 0, 1))],
      ['ITEMS USED', String(i.itemsUsed | 0)],
      [recorded ? 'BEST' : i.label ? i.label.toUpperCase() : 'MODE', recorded ? fmtTime(i.best != null ? i.best : i.time) : '—'],
    ];
    const gap = 12;
    const cw = (CW - 48 - gap * 3) / 4;
    cells.forEach(([dt, dd], k) => {
      const x = 24 + k * (cw + gap);
      const y = 352;
      rr(ctx, x, y, cw, 112, 5);
      ctx.fillStyle = 'rgba(255,240,210,0.04)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COL.line2;
      ctx.stroke();
      txt(ctx, dt, x + cw / 2, y + 40, `650 28px ${F_UI}`, COL.ink3, 'center', 0.04, cw - 12);
      const vf = `650 ${fitSize(ctx, dd, cw - 16, 44, 28, (px) => `650 ${px}px ${F_UI}`, 0)}px ${F_UI}`;
      txt(ctx, dd, x + cw / 2, y + 90, vf, COL.ink, 'center', 0);
    });
    // This run's section splits (P6): a 4 x 2 grid, the teaser squeezed under it.
    const splits = this._runSplits.filter(Boolean);
    if (splits.length) {
      this._paintVictorySplits(ctx, splits, 478);
      txt(ctx, 'CHAPTERS II–V · COMING SOON', cx, 640, `400 28px ${F_DISPLAY}`, COL.amber, 'center', 0.2, CW - 100);
      this._btn(ctx, this._region((CW - 680) / 2, 676, 400, 76, 'restart'), 'Descend again', null, { primary: true, size: 32 });
      this._btn(ctx, this._region((CW - 680) / 2 + 416, 676, 264, 76, 'menu'), 'Menu', null, {});
      return;
    }
    // The hook.
    const ty = 484;
    rr(ctx, 24, ty, CW - 48, 168, 8);
    const tg = ctx.createLinearGradient(0, ty, 0, ty + 168);
    tg.addColorStop(0, 'rgba(255,240,210,0.07)');
    tg.addColorStop(1, 'rgba(255,240,210,0.015)');
    ctx.fillStyle = tg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(224,160,80,0.45)';
    ctx.stroke();
    txt(ctx, 'CHAPTERS II–V · COMING SOON', cx, ty + 46, `400 32px ${F_DISPLAY}`, COL.amber, 'center', 0.2, CW - 100);
    const names = 'II  LAMPHOLD    III  THE MERE    IV  THE KEEPING    V  THE STILL FLAME';
    const nf = fitSize(ctx, names, CW - 80, 30, 28, (px) => `700 ${px}px ${F_DISPLAY}`, 0.04);
    txt(ctx, names, cx, ty + 98, `700 ${nf}px ${F_DISPLAY}`, COL.phosphor, 'center', 0.04, CW - 80);
    txt(ctx, 'It goes deeper than the light does. So did the Masons.', cx, ty + 142, `italic 400 28px ${F_DISPLAY}`, COL.ink2, 'center', 0, CW - 80);
    const bw = 680;
    const bx = (CW - bw) / 2;
    this._btn(ctx, this._region(bx, 670, 400, 82, 'restart'), 'Descend again', null, { primary: true, size: 32 });
    this._btn(ctx, this._region(bx + 416, 670, bw - 416, 82, 'menu'), 'Menu', null, {});
  }

  /** VR victory: up to 8 section splits in two rows of four cells (numeral, time, medal dot + word). */
  _paintVictorySplits(ctx, splits, y0) {
    const gap = 10;
    const cw = (CW - 48 - gap * 3) / 4;
    const ch = 64;
    for (const sp of splits) {
      const col = sp.index % 4;
      const row = (sp.index / 4) | 0;
      if (row > 1) continue;
      const x = 24 + col * (cw + gap);
      const y = y0 + row * (ch + gap);
      rr(ctx, x, y, cw, ch, 5);
      ctx.fillStyle = 'rgba(255,240,210,0.04)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = sp.medal ? 'rgba(224,160,80,0.4)' : COL.line2;
      ctx.stroke();
      txt(ctx, ROMAN[sp.index] || String(sp.index + 1), x + 14, y + 42, `700 28px ${F_DISPLAY}`, COL.amber, 'left', 0);
      txt(ctx, fmtSplit(sp.time), x + 74, y + 42, `650 28px ${F_UI}`, COL.ink, 'left', 0);
      if (sp.medal) {
        ctx.beginPath();
        ctx.arc(x + cw - 22, y + 32, 11, 0, Math.PI * 2);
        ctx.fillStyle = MEDAL_COLOR[sp.medal];
        ctx.fill();
      }
    }
  }

  // ---- notes ---------------------------------------------------------------------------------
  _updateNotes(dt, H, panelUp) {
    const vr = this._vr;
    const h = this._hint;
    const t = this._title;
    const ts = this._toast;
    const showHint = h.on && !panelUp;
    const showTitle = t.t > 0 && !panelUp;
    const showToast = ts.t > 0 && !panelUp && !showTitle; // (draw-call budget: title and toast share a slot)
    const caps = this._caps;
    let capLines = 0;
    if (caps) for (let i = 0; i < caps.lines.length; i++) if (caps.lines[i].on) capLines++;
    const showCaps = capLines > 0 && !panelUp;
    vr.notes.visible = (showHint || showTitle || showToast || showCaps) && H.ok;
    if (!vr.notes.visible) return;
    // Lazy follow: position locked to the head, yaw catches up once the head turns away.
    if (!this._noteYawSet) {
      this._noteYaw = H.yaw;
      this._noteYawSet = true;
    }
    const diff = wrapAngle(H.yaw - this._noteYaw);
    if (Math.abs(diff) > NOTE_LAG) this._noteYaw = wrapAngle(this._noteYaw + diff * (1 - Math.exp(-4 * dt)));
    const n = vr.notes;
    n.position.set(H.x - Math.sin(this._noteYaw) * NOTE_DIST, H.y, H.z - Math.cos(this._noteYaw) * NOTE_DIST);
    n.rotation.set(0, this._noteYaw, 0);

    if (h.dirty && showHint) {
      h.dirty = false;
      this._paintHint();
    }
    vr.hint.visible = showHint;
    if (showHint) vr.hint.material.opacity = U.clamp(h.t / 0.4, 0, 1);

    if (t.dirty && showTitle) {
      t.dirty = false;
      this._paintTitle();
    }
    vr.title.visible = showTitle;
    if (showTitle) {
      const age = TITLE_TIME - t.t;
      vr.title.material.opacity = U.clamp(Math.min(age / 0.65, t.t / 1.0), 0, 1);
    }

    if (ts.dirty && showToast) {
      ts.dirty = false;
      this._paintToast();
    }
    vr.toast.visible = showToast;
    if (showToast) vr.toast.material.opacity = U.clamp(Math.min(ts.t / 0.3, 1), 0, 1);

    vr.caption.visible = showCaps;
    if (showCaps && this._capDirty) {
      this._capDirty = false;
      this._paintCaptions();
    }
  }

  /** Subtitle lines: [shape] [direction] [text] in a dark pill each, newest-first order of the slots, up to 3. */
  _paintCaptions() {
    const c = this._vr.captionC;
    const ctx = c.ctx;
    ctx.setTransform(PX, 0, 0, PX, 0, 0);
    ctx.clearRect(0, 0, c.cw, c.ch);
    const lh = 64;
    let row = 0;
    const lines = this._caps.lines;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.on) continue;
      const f = `${l.sev >= 2 ? 700 : 500} 32px ${F_UI}`;
      const tw = measure(ctx, l.text, f, 0);
      const hasDir = l.sector >= 0 || l.vert !== 0;
      const w = Math.min(c.cw - 20, tw + 96 + (hasDir ? 64 : 0));
      const x = (c.cw - w) / 2;
      const y = 6 + row * lh;
      rr(ctx, x, y, w, lh - 8, 10);
      ctx.fillStyle = 'rgba(0,0,0,0.86)';
      ctx.fill();
      if (l.sev >= 2) {
        ctx.fillStyle = COL.amber;
        ctx.fillRect(x, y + 6, 6, lh - 20);
      }
      const cy = y + (lh - 8) / 2;
      this._kindShape(ctx, l.kind, x + 34, cy, 11);
      let tx = x + 62;
      if (hasDir) {
        this._dirDial(ctx, x + 90, cy, 19, l.sector, l.vert, l.near);
        tx = x + 124;
      }
      txt(ctx, l.text, tx, cy + 11, f, '#ffffff', 'left', 0, w - (tx - x) - 14);
      row++;
    }
    c.tex.needsUpdate = true;
  }

  /** Shape-coded source kind: diamond = creature, square = the world, circle = you, triangle = a status warning. */
  _kindShape(ctx, kind, cx, cy, r) {
    ctx.fillStyle = '#f2e6c9';
    ctx.strokeStyle = '#f2e6c9';
    ctx.lineWidth = 3;
    if (kind === 'creature') {
      diamond(ctx, cx, cy, r + 3);
      ctx.fill();
    } else if (kind === 'status') {
      ctx.beginPath();
      ctx.moveTo(cx, cy - r - 2);
      ctx.lineTo(cx + r + 3, cy + r);
      ctx.lineTo(cx - r - 3, cy + r);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.fillRect(cx - 1.5, cy - 4, 3, 7);
      ctx.fillRect(cx - 1.5, cy + 5, 3, 3);
    } else if (kind === 'player') {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }

  /** A small compass: a ring with a wedge toward the sound (0 = ahead = up), a bar above / below for vertical, bold when near. */
  _dirDial(ctx, cx, cy, r, sector, vert, near) {
    ctx.save();
    ctx.strokeStyle = '#f2e6c9';
    ctx.fillStyle = '#f2e6c9';
    ctx.lineWidth = near ? 4 : 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (sector >= 0) {
      const a = sector * (Math.PI / 4);
      const sx = Math.sin(a);
      const sy = -Math.cos(a);
      ctx.beginPath();
      ctx.moveTo(cx + sx * (r + 5), cy + sy * (r + 5));
      ctx.lineTo(cx + sy * -7 + sx * (r - 8), cy + sx * 7 + sy * (r - 8));
      ctx.lineTo(cx + sy * 7 + sx * (r - 8), cy - sx * 7 + sy * (r - 8));
      ctx.closePath();
      ctx.fill();
    }
    if (vert !== 0) {
      ctx.beginPath();
      if (vert > 0) {
        ctx.moveTo(cx, cy - 6);
        ctx.lineTo(cx + 6, cy + 4);
        ctx.lineTo(cx - 6, cy + 4);
      } else {
        ctx.moveTo(cx, cy + 6);
        ctx.lineTo(cx + 6, cy - 4);
        ctx.lineTo(cx - 6, cy - 4);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Splits hint text into measured tokens (words and `[Key]` keycaps) and
   * wraps them greedily to `maxW` → lines of tokens.
   */
  _wrapRich(ctx, s, maxW, size) {
    const f = `400 ${size}px ${F_UI}`;
    const kf = `650 ${size - 2}px ${F_UI}`;
    const space = measure(ctx, ' ', f, 0);
    const re = /\[([^\]]{1,24})\]|(\S+)/g;
    const lines = [];
    let line = [];
    let lw = 0;
    let m;
    while ((m = re.exec(String(s))) !== null) {
      const key = m[1] != null;
      const text = key ? m[1] : m[2];
      const w = key ? measure(ctx, text, kf, 0) + 22 : measure(ctx, text, f, 0);
      const add = line.length ? space + w : w;
      if (line.length && lw + add > maxW) {
        lines.push({ tokens: line, w: lw });
        line = [];
        lw = 0;
      }
      lw += line.length ? space + w : w;
      line.push({ key, text, w });
    }
    if (line.length) lines.push({ tokens: line, w: lw });
    return { lines, space, f, kf };
  }

  /** Draws one wrapped line of tokens centred on (cx, y). */
  _richLine(ctx, line, wr, cx, y, size) {
    let x = cx - line.w / 2;
    line.tokens.forEach((tk, i) => {
      if (i) x += wr.space;
      if (tk.key) {
        rr(ctx, x + 2, y - size + 2, tk.w - 4, size + 10, 5);
        ctx.fillStyle = '#23282a';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = COL.line3;
        ctx.stroke();
        txt(ctx, tk.text, x + tk.w / 2, y, wr.kf, COL.phosphor, 'center', 0);
      } else {
        txt(ctx, tk.text, x, y, wr.f, COL.ink, 'left', 0);
      }
      x += tk.w;
    });
  }

  _paintHint() {
    const c = this._vr.hintC;
    const ctx = c.ctx;
    ctx.setTransform(PX, 0, 0, PX, 0, 0);
    ctx.clearRect(0, 0, c.cw, c.ch);
    const size = 30;
    const wr = this._wrapRich(ctx, this._hint.text, c.cw - 120, size);
    const shown = wr.lines.slice(0, 3);
    const lh = 44;
    const bh = shown.length * lh + 30;
    const by = (c.ch - bh) / 2;
    rr(ctx, 8, by, c.cw - 16, bh, 8);
    ctx.fillStyle = 'rgba(8,9,10,0.84)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COL.line2;
    ctx.stroke();
    ctx.fillStyle = COL.verdigris;
    ctx.fillRect(8, by + 6, 6, bh - 12);
    shown.forEach((ln, i) => this._richLine(ctx, ln, wr, c.cw / 2, by + 15 + size + i * lh, size));
    c.tex.needsUpdate = true;
  }

  _paintTitle() {
    const c = this._vr.titleC;
    const ctx = c.ctx;
    const t = this._title;
    ctx.setTransform(PX, 0, 0, PX, 0, 0);
    ctx.clearRect(0, 0, c.cw, c.ch);
    const cx = c.cw / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.95)';
    ctx.shadowBlur = 18;
    if (t.num) txt(ctx, t.num, cx + 8, 44, `400 30px ${F_DISPLAY}`, COL.amber, 'center', 0.5);
    const name = t.name.toUpperCase();
    const size = fitSize(ctx, name, c.cw - 60, 64, 36, (px) => `700 ${px}px ${F_DISPLAY}`, 0.12);
    txt(ctx, name, cx + 4, 124, `700 ${size}px ${F_DISPLAY}`, '#d8cfbd', 'center', 0.12);
    ctx.restore();
    const g = ctx.createLinearGradient(cx - 110, 0, cx + 110, 0);
    g.addColorStop(0, 'rgba(224,160,80,0)');
    g.addColorStop(0.5, 'rgba(224,160,80,0.85)');
    g.addColorStop(1, 'rgba(224,160,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 110, 150, 220, 2);
    if (t.sub) {
      const sf = `italic 400 32px ${F_DISPLAY}`;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.95)';
      ctx.shadowBlur = 14;
      wrapLines(ctx, t.sub, c.cw - 80, sf)
        .slice(0, t.split ? 1 : 2)
        .forEach((ln, i) => txt(ctx, ln, cx, 200 + i * 40, sf, COL.ink2, 'center', 0));
      ctx.restore();
    }
    if (t.split) {
      // the section just left (P6): "I · 1:12.4 · SILVER" under the subtitle (the same canvas: no new mesh)
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.95)';
      ctx.shadowBlur = 12;
      txt(ctx, t.split, cx, 262, `650 30px ${F_UI}`, COL.amber, 'center', 0.14, c.cw - 60);
      ctx.restore();
    }
    c.tex.needsUpdate = true;
  }

  _paintToast() {
    const c = this._vr.toastC;
    const ctx = c.ctx;
    ctx.setTransform(PX, 0, 0, PX, 0, 0);
    ctx.clearRect(0, 0, c.cw, c.ch);
    const label = this._toast.text.toUpperCase();
    const f = `650 30px ${F_UI}`;
    const w = Math.min(c.cw - 8, measure(ctx, label, f, 0.16) + 90);
    const x = (c.cw - w) / 2;
    rr(ctx, x, 8, w, c.ch - 16, 4);
    ctx.fillStyle = 'rgba(8,9,10,0.82)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(224,160,80,0.55)';
    ctx.stroke();
    ctx.fillStyle = COL.amber;
    diamond(ctx, x + 34, c.ch / 2, 9);
    ctx.fill();
    txt(ctx, label, x + 58, c.ch / 2 + 11, f, COL.phosphor, 'left', 0.16);
    c.tex.needsUpdate = true;
  }

  // ---- wrist HUD -------------------------------------------------------------------------------
  _updateWrist(dt, g) {
    const vr = this._vr;
    const st = g.state;
    const inRun = st === 'playing' || st === 'paused' || st === 'dead';
    let posed = !!this._grip;
    if (!posed && inRun) posed = this._poseWristFromHand(g);
    vr.wristMount.visible = inRun && posed;
    if (!vr.wristMount.visible) return;
    this._wristAcc += dt;
    const tl = this._tetherState('left');
    const tr = this._tetherState('right');
    const fragile = tl === 'fragile' || tr === 'fragile';
    if (this._wristAcc < (fragile ? 0.05 : WRIST_INTERVAL) && this._wristKey) return;
    this._wristAcc = 0;
    const time = fmtTime(g.time || 0);
    const depth = g.player ? U.depthMeters(num(g.player.y, 0)) : 0;
    const si = g.sectionIndex | 0;
    const safe = this._settings().colorSafe === true;
    const stv = safe ? this._statusValues(g) : null;
    const key = `${time.slice(0, -1)}|${depth}|${si}|${tl}|${tr}|${fragile ? (this._clock * 20) | 0 : 0}${safe ? `|${stv.hp}|${stv.grip}|${stv.bag}` : ''}`;
    if (key === this._wristKey) return;
    this._wristKey = key;
    this._paintWrist(g, time, depth, si, tl, tr);
  }

  /** Without a grip object: place the mount from input.handPose('left') (world) in its parent's space. */
  _poseWristFromHand(g) {
    const input = g.input;
    if (!input || typeof input.handPose !== 'function') return false;
    let p = null;
    try {
      p = input.handPose('left');
    } catch {
      p = null;
    }
    if (!p || !isFinite(p.x + p.y + p.z + p.qx + p.qy + p.qz + p.qw)) return false;
    const mount = this._vr.wristMount;
    const parent = mount.parent;
    this._v.set(p.x, p.y, p.z);
    this._q.set(p.qx, p.qy, p.qz, p.qw);
    if (parent && parent.matrixWorld) {
      parent.updateWorldMatrix(true, false);
      this._m.compose(this._v, this._q, this._s.set(1, 1, 1));
      this._m2.copy(parent.matrixWorld).invert();
      this._m.premultiply(this._m2);
      this._m.decompose(mount.position, mount.quaternion, this._s);
    } else {
      mount.position.copy(this._v);
      mount.quaternion.copy(this._q);
    }
    return true;
  }

  _paintWrist(g, time, depth, si, tl, tr) {
    const c = this._vr.wristC;
    const ctx = c.ctx;
    ctx.setTransform(PX, 0, 0, PX, 0, 0);
    ctx.clearRect(0, 0, c.cw, c.ch);
    rr(ctx, 3, 3, c.cw - 6, c.ch - 6, 12);
    ctx.fillStyle = 'rgba(10,11,12,0.92)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COL.line3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(224,160,80,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(4, 24);
    ctx.lineTo(4, 4);
    ctx.lineTo(24, 4);
    ctx.stroke();
    const T = g.tethers;
    const stressL = T && typeof T.anchorStress === 'function' ? num(T.anchorStress('left'), 0) : 0;
    const stressR = T && typeof T.anchorStress === 'function' ? num(T.anchorStress('right'), 0) : 0;
    tetherGlyph(ctx, 40, 52, 56, tl, HAND_COL.left, stressL + this._clock);
    tetherGlyph(ctx, c.cw - 40, 52, 56, tr, HAND_COL.right, stressR + this._clock);
    txt(ctx, 'L', 40, 106, `700 18px ${F_UI}`, COL.ink3, 'center', 0);
    txt(ctx, 'R', c.cw - 40, 106, `700 18px ${F_UI}`, COL.ink3, 'center', 0);
    txt(ctx, time.slice(0, -1), c.cw / 2, 62, `700 40px ${F_UI}`, COL.warm, 'center', 0.02);
    txt(ctx, `${depth} m`, c.cw / 2, 102, `650 30px ${F_UI}`, COL.phosphor, 'center', 0.02);
    const sec = this._sections() ? this._sections()[si] : null;
    if (this._settings().colorSafe === true) {
      // Colour-safe strip: a shape and a number per resource (the section name gives way to it).
      const st = this._statusValues(g);
      const items = [
        [st.hp < 40, 'HP', st.hp, 0],
        [st.grip < 25, 'GRIP', st.grip, 1],
        [false, 'BAG', st.bag, 2],
      ];
      items.forEach(([warn, name, value, shape], k) => {
        const x = 18 + k * 100;
        ctx.strokeStyle = warn ? '#ffd9a0' : COL.ink2;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 3;
        const cy = 134;
        if (shape === 0) {
          ctx.fillRect(x + 5, cy - 10, 6, 20);
          ctx.fillRect(x - 2, cy - 3, 20, 6);
        } else if (shape === 1) {
          ctx.beginPath();
          ctx.arc(x + 8, cy, 9, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeRect(x, cy - 9, 17, 18);
        }
        txt(ctx, warn ? `${value}!` : String(value), x + 24, cy + 8, `700 22px ${F_UI}`, warn ? '#ffd9a0' : COL.phosphor, 'left', 0);
        txt(ctx, name, x + 24, cy + 28, `600 14px ${F_UI}`, COL.ink3, 'left', 0.06);
      });
    } else if (sec) {
      const label = `${ROMAN[si] || si + 1} · ${sec.name}`;
      const size = fitSize(ctx, label, c.cw - 24, 22, 16, (px) => `400 ${px}px ${F_DISPLAY}`, 0.04);
      txt(ctx, label, c.cw / 2, 142, `400 ${size}px ${F_DISPLAY}`, COL.amber, 'center', 0.04);
    }
    c.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ teardown
  dispose() {
    for (const [target, type, fn, opts] of this._listeners) {
      try {
        target.removeEventListener(type, fn, opts);
      } catch {
        // ignore
      }
    }
    this._listeners.length = 0;
    for (const off of this._busOff) off();
    this._busOff.length = 0;
    const vr = this._vr;
    if (vr) {
      for (const obj of [vr.root, vr.notes, vr.ray, vr.wristMount]) {
        if (obj.parent) obj.parent.remove(obj);
        obj.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            if (o.material.map) o.material.map.dispose();
            o.material.dispose();
          }
        });
      }
      this._vr = null;
    }
    this._ready = false;
  }
}
