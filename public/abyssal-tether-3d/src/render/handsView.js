/* ABYSSAL TETHER 3D — handsView.js
 * The player's hands: an original brass-and-iron tether launcher per hand
 * (barrel, claw muzzle, rope spool, raked grip, bracer cuff), a short fading
 * aim laser per hand that snaps to that hand's current target (else runs
 * along the aim ray toward the wall it hits), a shape-coded reticle at the
 * target (right = ring, left = diamond brackets; never colour alone), a dim
 * dot where an untargeted aim meets a wall (hollow when beyond tether range)
 * and, on the left bracer, a small swinging lantern whose glass core is the
 * socket for Renderer3D's lantern light (setLanternParent).
 *
 * The shipped look is the Blender-built GLB (assets/models/player_arms.glb, see
 * handsGear.js): HD gloved forearms with a strapped-on brass/iron launcher
 * (skinned, 4 finger poses blended from the controller's trigger/grip analog
 * values, drum / gauge needle / trigger lever / recoil slide animated, the grapple
 * head leaving the muzzle with the line, the carried lantern). It loads async and
 * the procedural launchers above stay as the fallback until it arrives (or if it
 * fails). The rope origin is the GLB muzzle (HandsView.muzzlePosition).
 *
 * Draw calls (per eye): 2 arms + 2 launchers + 1 lantern + 1 batched FX mesh
 * (+ 2 loose grapple heads while a line is out) = 6..8; the procedural fallback: 4.
 * No per-frame allocation; the FX batch is one dynamic BufferGeometry.
 *
 * Usage (Game):
 *   this.hands = new HandsView(this.renderer, this.input);   // Renderer3D + InputManager
 *   … each frame, after the rig follows the player, before render:
 *   this.hands.update(dt, this);
 * Reads game.state, game.tethers.hands[h].{target, rope}, game.level.raycast,
 * game.diff.aimRange and game.tethers.anchorStress(h) when present.
 */

import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PMREMGenerator,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../sim/config3d.js';
import { GEAR_TUNING, GEAR_URL, HandGear, loadGearGLTF, readPoses } from './handsGear.js';

const HANDS = ['left', 'right'];

export const HANDS_TUNING = {
  laserLength: 2.4, // visible beam length before it has fully faded (m)
  laserWidth: 0.0055, // half-width at the muzzle (m)
  laserWidthEnd: 0.0025,
  laserAlphaXR: 0.62,
  laserAlphaDesktop: 0.3,
  reticleAngular: 0.036, // reticle half-size / distance (≈2°): frames the anchor marker
  reticleMin: 0.42, // never smaller than an anchor marker (m)
  reticleMax: 1.4,
  wallDotAngular: 0.007,
  reticlePull: 0.3, // reticle drawn this far in front of the anchor (toward the hand)
  rayMax: 60, // wall raycast distance (m)
  fadeRate: 14, // laser/reticle fade (1/s)
  wristLift: { x: 0, y: 0.03, z: 0 }, // wrist-HUD mount above the palm (clears the bracer plate)
  lanternRope: 0.05, // hook → lantern body (m)
  lanternDamp: 2.2, // pendulum damping (1/s)
  // --- GLB arms + launchers (handsGear.js) -------------------------------------------
  gear: true, // false = procedural launchers only
  gearUrl: GEAR_URL,
  wristLiftGear: { x: 0, y: 0.083, z: 0.115 }, // wrist-HUD mount above the strapped-on launcher, behind the drum
  desktopGear: { x: 0, y: 0.03, z: 0.03, rx: 0, ry: 0, rz: 0, scale: 1.3 }, // arm model offset on the desktop virtual hand
  gearLight: 0.2, // × direct light on the gear (the lantern sits a few cm from the hands)
  gearEnv: 1.2, // image-based light on the metal (a dim lit-room reflection), × the scene's ambient
  gearGlowIdle: 0.45, // emissive intensity of the pilot lamp / gauge phosphor
  gripRest: 0.62, // resting-finger-on-the-grip-button reads as a half-closed hand
  headScaleMax: 8, // loose grapple head enlarges with distance like the rope does (ropeView R_PER_M)
};

// Palette (sRGB hex → linear via Color). Glow tints match the anchor highlights
// (left = cool verdigris, right = warm amber).
const PAL = {
  brass: '#9c7434',
  brassDark: '#6b4d22',
  iron: '#3a3a3f',
  ironDark: '#1f1f23',
  grip: '#3b2a1c',
  glowLeft: '#56f0c4',
  glowRight: '#ffad4a',
  lanternGlass: '#ffb661',
};

const FX_COLOR = {
  left: [0.42, 1.0, 0.82],
  right: [1.0, 0.7, 0.3],
  ui: [0.85, 0.92, 1.0],
};

const ZERO_OFFSET = Object.freeze({ x: 0, y: 0, z: 0 });

/**
 * XR draw order of the launchers + lantern: after the VR UI panels/notes (945–954,
 * no depth test) and the fade sphere (900), so a hand raised in front of a panel
 * stays in front of it and the pause/death fade never blacks out the controllers
 * you point with. They are still depth-tested against the world (which writes
 * depth; panels, notes and the fade do not). Desktop keeps 0 (fades with the world).
 */
export const HANDS_RENDER_ORDER_XR = 960;

const SHAPE_BEAM = 0;
const SHAPE_RING = 1;
const SHAPE_DIAMOND = 2;
const SHAPE_DOT = 3;
const SHAPE_HOLLOW = 4;

// -----------------------------------------------------------------------------
// Launcher geometry (socket space: −Z = barrel / aim, +Y = up, origin = palm)
// -----------------------------------------------------------------------------

const _c = new Color();

function linear(hex) {
  _c.set(hex); // converted to the linear working space by three's colour management
  return [_c.r, _c.g, _c.b];
}

/** Adds constant per-vertex colour + glow (x: hand glow, y: lantern glow) to a part. */
function part(geom, hex, glowA = 0, glowB = 0) {
  const g = geom;
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const glw = new Float32Array(n * 2);
  const [r, gg, b] = linear(hex);
  for (let i = 0; i < n; i++) {
    col[i * 3] = r;
    col[i * 3 + 1] = gg;
    col[i * 3 + 2] = b;
    glw[i * 2] = glowA;
    glw[i * 2 + 1] = glowB;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('glow', new BufferAttribute(glw, 2));
  return g;
}

/** Cylinder along Z (radiusTop at −Z), centred at (x, y, z). */
function cylZ(rFront, rBack, len, seg, x, y, z) {
  return new CylinderGeometry(rFront, rBack, len, seg, 1, false).rotateX(-Math.PI / 2).translate(x, y, z);
}

/** Cylinder along X, centred at (x, y, z). */
function cylX(r, len, seg, x, y, z) {
  return new CylinderGeometry(r, r, len, seg, 1, false).rotateZ(Math.PI / 2).translate(x, y, z);
}

/**
 * One hand's launcher. Shape-coded per hand: the right claw has 3 prongs and a
 * ring sight, the left 4 prongs and a diamond sight.
 */
export function buildLauncherGeometry(hand, muzzle) {
  const my = muzzle.y;
  const mz = muzzle.z;
  const glowHex = hand === 'left' ? PAL.glowLeft : PAL.glowRight;
  const parts = [];

  // Barrel (iron) from just in front of the spool to the muzzle, two brass bands.
  const bFront = mz + 0.016;
  const bBack = -0.012;
  const bLen = bBack - bFront;
  parts.push(part(cylZ(0.0145, 0.0168, bLen, 14, 0, my, (bFront + bBack) / 2), PAL.iron));
  parts.push(part(cylZ(0.0182, 0.0182, 0.008, 14, 0, my, bFront + bLen * 0.22), PAL.brass));
  parts.push(part(cylZ(0.0186, 0.0186, 0.008, 14, 0, my, bFront + bLen * 0.7), PAL.brassDark));
  // Muzzle collar + glowing lens.
  parts.push(part(new TorusGeometry(0.0168, 0.0052, 7, 18).translate(0, my, mz + 0.012), PAL.brass));
  parts.push(part(cylZ(0.0112, 0.0112, 0.004, 14, 0, my, mz + 0.012), glowHex, 1, 0));
  // Claw prongs around the muzzle.
  const prongs = hand === 'left' ? 4 : 3;
  for (let i = 0; i < prongs; i++) {
    const a = (i / prongs) * Math.PI * 2 + (hand === 'left' ? Math.PI / 4 : Math.PI / 2);
    const g = new BoxGeometry(0.0055, 0.0045, 0.03)
      .rotateX(0.38)
      .translate(0, 0.0175, 0)
      .rotateZ(a - Math.PI / 2)
      .translate(0, my, mz + 0.004);
    parts.push(part(g, PAL.ironDark));
  }
  // Charge window along the top of the barrel (glows with the hand's state).
  parts.push(part(new BoxGeometry(0.0042, 0.003, 0.05).translate(0, my + 0.0158, mz + 0.075), glowHex, 1, 0));
  // Sight: ring (right) or diamond (left).
  if (hand === 'left') {
    parts.push(part(new BoxGeometry(0.009, 0.009, 0.003).rotateZ(Math.PI / 4).translate(0, my + 0.024, mz + 0.03), PAL.brass));
  } else {
    parts.push(part(new TorusGeometry(0.0062, 0.0017, 5, 12).translate(0, my + 0.024, mz + 0.03), PAL.brass));
  }
  parts.push(part(new BoxGeometry(0.003, 0.008, 0.006).translate(0, my + 0.017, mz + 0.03), PAL.brassDark));
  // Rope spool behind the barrel: drum + iron side plates + glowing gauge on the outer plate.
  parts.push(part(cylX(0.026, 0.03, 18, 0, my, 0.006), PAL.brassDark));
  parts.push(part(cylX(0.031, 0.004, 18, 0.017, my, 0.006), PAL.iron));
  parts.push(part(cylX(0.031, 0.004, 18, -0.017, my, 0.006), PAL.iron));
  parts.push(part(cylX(0.009, 0.003, 10, hand === 'left' ? -0.0205 : 0.0205, my, 0.006), glowHex, 0.8, 0));
  // Raked, leather-wrapped grip with a brass pommel; trigger + guard in front of it.
  const rake = -0.26;
  parts.push(part(new CylinderGeometry(0.0125, 0.0145, 0.082, 8).scale(1, 1, 1.25).rotateX(rake).translate(0, -0.026, -0.004), PAL.grip));
  for (let i = 0; i < 3; i++) {
    const yy = -0.004 - i * 0.022;
    parts.push(part(new TorusGeometry(0.0142, 0.0016, 4, 10).rotateX(Math.PI / 2).scale(1, 1, 1.25).translate(0, yy, -0.004 + yy * Math.tan(-rake) * 0.9), PAL.ironDark));
  }
  parts.push(part(new CylinderGeometry(0.0155, 0.012, 0.012, 8).scale(1, 1, 1.25).rotateX(rake).translate(0, -0.071, 0.008), PAL.brass));
  parts.push(part(new BoxGeometry(0.006, 0.016, 0.008).rotateX(-0.2).translate(0, my - 0.027, -0.04), PAL.brass));
  parts.push(
    part(
      new TorusGeometry(0.019, 0.0026, 5, 12, Math.PI)
        .rotateY(Math.PI / 2)
        .rotateX(Math.PI)
        .translate(0, my - 0.014, -0.032),
      PAL.brassDark,
    ),
  );
  // Bracer: a curved iron plate over the back of the wrist with brass rims.
  const cy = -0.008;
  const arc = Math.PI * 1.15;
  const arcStart = Math.PI - arc / 2; // theta 0 maps to −Y after the rotation: centre the plate on +Y (back of the hand)
  parts.push(part(new CylinderGeometry(0.043, 0.04, 0.052, 14, 1, true, arcStart, arc).rotateX(Math.PI / 2).translate(0, cy, 0.1), PAL.iron));
  for (const z of [0.074, 0.126]) {
    parts.push(
      part(
        new TorusGeometry(z < 0.1 ? 0.0405 : 0.0435, 0.0042, 5, 14, arc)
          .rotateZ(Math.PI / 2 - arc / 2)
          .translate(0, cy, z),
        PAL.brass,
      ),
    );
  }
  for (let i = -1; i <= 1; i++) {
    const a = Math.PI / 2 + i * 0.75;
    parts.push(part(new CylinderGeometry(0.0032, 0.0032, 0.003, 6).rotateZ(Math.PI / 2 - a).translate(Math.cos(a) * 0.044, cy + Math.sin(a) * 0.044, 0.1), PAL.brassDark));
  }
  // Bracket joining bracer and spool.
  parts.push(part(new BoxGeometry(0.012, 0.01, 0.05).translate(0, my - 0.004, 0.05), PAL.iron));
  if (hand === 'left') {
    // Lantern hook on the outer side of the cuff.
    parts.push(part(new TorusGeometry(0.0075, 0.0018, 5, 10).rotateY(Math.PI / 2).translate(-0.047, cy - 0.034, 0.098), PAL.iron));
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** The hanging lantern (local −Y = hanging direction; origin = hook). */
export function buildLanternGeometry() {
  const parts = [];
  parts.push(part(new TorusGeometry(0.006, 0.0015, 4, 8).translate(0, -0.006, 0), PAL.iron)); // bail
  parts.push(part(new ConeGeometry(0.02, 0.016, 10).translate(0, -0.02, 0), PAL.brass)); // cap
  parts.push(part(new CylinderGeometry(0.0125, 0.0135, 0.034, 10).translate(0, -0.046, 0), PAL.lanternGlass, 0, 1)); // glass
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    parts.push(part(new BoxGeometry(0.0028, 0.04, 0.0028).translate(Math.cos(a) * 0.0165, -0.046, Math.sin(a) * 0.0165), PAL.ironDark));
  }
  parts.push(part(new CylinderGeometry(0.018, 0.016, 0.007, 10).translate(0, -0.068, 0), PAL.brassDark)); // base
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** MeshStandardMaterial + per-vertex glow (emissive += vColor · (glow.x·uGlowA + glow.y·uGlowB + uSelf)). */
function makeLauncherMaterial() {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.55, side: DoubleSide });
  // Transparent (alpha stays 1) only so renderOrder can place the hands after the
  // UI and the fade (see HANDS_RENDER_ORDER_XR); forceSinglePass avoids the extra
  // back-face pass three gives transparent DoubleSide materials.
  mat.transparent = true;
  mat.forceSinglePass = true;
  const uniforms = { uGlowA: { value: 0.6 }, uGlowB: { value: 0 }, uSelf: { value: 0.05 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlowA = uniforms.uGlowA;
    shader.uniforms.uGlowB = uniforms.uGlowB;
    shader.uniforms.uSelf = uniforms.uSelf;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 glow;\nvarying vec2 vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGlow = glow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGlow;\nuniform float uGlowA;\nuniform float uGlowB;\nuniform float uSelf;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * (vGlow.x * uGlowA + vGlow.y * uGlowB + uSelf);',
      );
  };
  mat.customProgramCacheKey = () => 'at3d-launcher-glow';
  mat.userData.glow = uniforms;
  return mat;
}

// -----------------------------------------------------------------------------
// Batched lasers + reticles (one draw call)
// -----------------------------------------------------------------------------

const FX_VERT = /* glsl */ `
attribute vec4 aColor;
attribute vec3 aShape;
varying vec4 vColor;
varying vec3 vShape;
void main() {
  vColor = aColor;
  vShape = aShape;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FX_FRAG = /* glsl */ `
varying vec4 vColor;
varying vec3 vShape;
float band(float x, float a, float b, float s) {
  return smoothstep(a - s, a, x) * (1.0 - smoothstep(b, b + s, x));
}
void main() {
  vec2 p = vShape.xy;
  float id = vShape.z;
  float r = length(p);
  float s = max(fwidth(r) * 1.25, 0.015);
  float a = 0.0;
  if (id < 0.5) {
    // beam: x 0..1 along (fades out), y -1..1 across
    float along = 1.0 - clamp(p.x, 0.0, 1.0);
    a = along * along * (1.0 - smoothstep(0.3, 1.0, abs(p.y)));
  } else if (id < 1.5) {
    // right hand: ring broken into four arcs
    float gap = smoothstep(0.1, 0.24, abs(abs(p.x) - abs(p.y)) / max(r, 1e-3));
    a = band(r, 0.76, 0.9, s) * gap;
  } else if (id < 2.5) {
    // left hand: diamond corner brackets
    float d = abs(p.x) + abs(p.y);
    float sd = max(fwidth(d) * 1.25, 0.015);
    float corner = 1.0 - smoothstep(0.24, 0.34, min(abs(p.x), abs(p.y)));
    a = band(d, 0.8, 0.94, sd) * corner;
  } else if (id < 3.5) {
    a = 1.0 - smoothstep(0.32, 0.55, r);
  } else {
    a = band(r, 0.48, 0.68, s);
  }
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`;

const MAX_QUADS = 10;

class FxBatch {
  constructor() {
    this.pos = new Float32Array(MAX_QUADS * 4 * 3);
    this.col = new Float32Array(MAX_QUADS * 4 * 4);
    this.shp = new Float32Array(MAX_QUADS * 4 * 3);
    const idx = new Uint16Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) {
      const v = q * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
    }
    const g = new BufferGeometry();
    this.aPos = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.aCol = new BufferAttribute(this.col, 4).setUsage(DynamicDrawUsage);
    this.aShp = new BufferAttribute(this.shp, 3).setUsage(DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aShape', this.aShp);
    g.setIndex(new BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.material = new ShaderMaterial({
      vertexShader: FX_VERT,
      fragmentShader: FX_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide, // beam ribbons are built facing away from the head; never cull them
      fog: false,
      toneMapped: false,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.name = 'AT3D-hands-fx';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
    this.mesh.matrixAutoUpdate = false;
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  _vert(i, x, y, z, rgb, a, u, v, id) {
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.col[i * 4] = rgb[0];
    this.col[i * 4 + 1] = rgb[1];
    this.col[i * 4 + 2] = rgb[2];
    this.col[i * 4 + 3] = a;
    this.shp[i * 3] = u;
    this.shp[i * 3 + 1] = v;
    this.shp[i * 3 + 2] = id;
  }

  /** Ribbon from s to e (unit side vector), widths w0 → w1. */
  beam(s, e, side, w0, w1, rgb, a) {
    if (this.n >= MAX_QUADS || a <= 0.002) return;
    const i = this.n++ * 4;
    this._vert(i, s.x + side.x * w0, s.y + side.y * w0, s.z + side.z * w0, rgb, a, 0, 1, SHAPE_BEAM);
    this._vert(i + 1, s.x - side.x * w0, s.y - side.y * w0, s.z - side.z * w0, rgb, a, 0, -1, SHAPE_BEAM);
    this._vert(i + 2, e.x - side.x * w1, e.y - side.y * w1, e.z - side.z * w1, rgb, a, 1, -1, SHAPE_BEAM);
    this._vert(i + 3, e.x + side.x * w1, e.y + side.y * w1, e.z + side.z * w1, rgb, a, 1, 1, SHAPE_BEAM);
  }

  /** Screen-aligned square at c with half-size h (right / up are unit camera axes). */
  sprite(c, right, up, h, rgb, a, id) {
    if (this.n >= MAX_QUADS || a <= 0.002) return;
    const i = this.n++ * 4;
    const rx = right.x * h;
    const ry = right.y * h;
    const rz = right.z * h;
    const ux = up.x * h;
    const uy = up.y * h;
    const uz = up.z * h;
    this._vert(i, c.x - rx - ux, c.y - ry - uy, c.z - rz - uz, rgb, a, -1, -1, id);
    this._vert(i + 1, c.x + rx - ux, c.y + ry - uy, c.z + rz - uz, rgb, a, 1, -1, id);
    this._vert(i + 2, c.x + rx + ux, c.y + ry + uy, c.z + rz + uz, rgb, a, 1, 1, id);
    this._vert(i + 3, c.x - rx + ux, c.y - ry + uy, c.z - rz + uz, rgb, a, -1, 1, id);
  }

  end() {
    this.geometry.setDrawRange(0, this.n * 6);
    if (this.n > 0) {
      this.aPos.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.aShp.needsUpdate = true;
    }
    this.mesh.visible = this.n > 0;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// -----------------------------------------------------------------------------
// Gear environment: a tiny lit-room reflection for the metals (PMREM, built once)
// -----------------------------------------------------------------------------

/**
 * Metal needs something to reflect: the shaft has no environment map, so the
 * brass/iron would be black outside the lantern's pin highlight. A small warm
 * "room" (dim vault dome, two lamp boxes, a cool floor bounce) is prefiltered
 * once and set on the gear materials only; its strength follows the scene's
 * ambient light so the hands do not glow in a pitch-black chamber.
 */
export const GEAR_ENV = {
  top: '#8a8f98',
  mid: '#34363a',
  bot: '#2a3034',
  lampA: [3.0, 3.0, 3.0],
  lampB: [1.5, 1.5, 1.5],
  strip: [0.7, 1.0, 1.2],
};

export function buildGearEnvironment(renderer, E = GEAR_ENV) {
  const sc = new Scene();
  const geo = new SphereGeometry(6, 24, 12);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const top = new Color(E.top);
  const mid = new Color(E.mid);
  const bot = new Color(E.bot);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 6;
    if (y > 0) c.copy(mid).lerp(top, Math.pow(y, 0.8));
    else c.copy(mid).lerp(bot, Math.pow(-y, 0.8));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
  sc.add(new Mesh(geo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, toneMapped: false })));
  const box = (w, h, d, rgb, x, y, z) => {
    const m = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial({ color: new Color(rgb[0], rgb[1], rgb[2]), toneMapped: false }));
    m.position.set(x, y, z);
    sc.add(m);
  };
  box(2.6, 0.12, 1.4, E.lampA, -1.2, 4.2, 1.6);
  box(0.2, 1.6, 0.9, E.lampB, 4.4, 1.0, -1.4);
  box(3.2, 0.1, 0.5, E.strip, 0, -3.6, -2.0);
  const pm = new PMREMGenerator(renderer);
  const rt = pm.fromScene(sc, 0.03);
  pm.dispose();
  for (const o of sc.children) {
    if (o.material) o.material.dispose();
    if (o.geometry) o.geometry.dispose();
  }
  return rt;
}

// -----------------------------------------------------------------------------
// HandsView
// -----------------------------------------------------------------------------

function makeHandFx() {
  return { laser: 0, reticle: 0, dot: 0, target: null, hollow: false };
}

export class HandsView {
  /**
   * @param {Renderer3D|{scene, camera, rig, setLanternParent?}} renderer3d
   * @param {InputManager} input
   * @param {object} [opts] { manageLantern: true }
   */
  constructor(renderer3d, input, opts = {}) {
    this.r3 = renderer3d || {};
    this.input = input;
    this.tuning = Object.assign({}, HANDS_TUNING, opts.tuning || {});
    this.manageLantern = opts.manageLantern !== false;
    this.camera = this.r3.camera || (input && input.camera) || null;
    this.scene = this.r3.scene || null;
    this.visible = true;
    // UI3D draws the menu pointer (ray + dot over its panels). Ours is only a
    // fallback for a game running without UI3D (game.ui.isNull), or when set true.
    this.showUIPointer = false;
    this._order = -1;
    this._time = 0;
    this._lanternMode = '';
    this._wrist = { left: null, right: null };

    const muzzle = (input && input.tuning && input.tuning.muzzle) || { x: 0, y: 0.03, z: -0.17 };
    this.materials = {};
    this.launchers = {};
    this.fx = {};
    for (const h of HANDS) {
      const mat = makeLauncherMaterial();
      const mesh = new Mesh(buildLauncherGeometry(h, muzzle), mat);
      mesh.name = `AT3D-launcher-${h}`;
      mesh.frustumCulled = false; // tiny and always near the head
      this.materials[h] = mat;
      this.launchers[h] = mesh;
      this.fx[h] = makeHandFx();
      const sock = input && input.handSocket ? input.handSocket(h) : null;
      if (sock) sock.add(mesh);
    }

    // Lantern: hangs from the left bracer's hook and swings (simple Verlet pendulum).
    this.lanternMaterial = makeLauncherMaterial();
    this.lanternMaterial.userData.glow.uGlowB.value = 2.4;
    this.lantern = new Mesh(buildLanternGeometry(), this.lanternMaterial);
    this.lantern.name = 'AT3D-lantern';
    this.lantern.frustumCulled = false;
    this._hookLocal = new Vector3(-0.047, -0.042, 0.098);
    this.lantern.position.copy(this._hookLocal);
    /** Lantern light socket: the glass core. */
    this.lanternSocket = new Object3D();
    this.lanternSocket.name = 'AT3D-lantern-socket';
    this.lanternSocket.position.set(0, -0.046, 0);
    this.lantern.add(this.lanternSocket);
    if (input && input.handSocket) input.handSocket('left').add(this.lantern);
    this._bob = new Vector3();
    this._bobPrev = new Vector3();
    this._bobInit = false;

    this.batch = new FxBatch();
    if (this.scene) this.scene.add(this.batch.mesh);

    // GLB gear (arms + launchers + lantern + loose grapple heads): see _loadGear.
    this.gear = null; // { left: HandGear, right: HandGear }
    this._disposed = false;
    this._lanternFallback = null;
    this.gearState = this.tuning.gear ? 'loading' : 'off'; // off | loading | ready | failed
    this.gearError = null;
    this.gearReady = null; // Promise, resolves true/false
    this._gearEnv = null;
    this._gearLight = { value: this.tuning.gearLight };
    this._gearMats = null; // { left, right, lantern }
    this._heads = { left: null, right: null };
    this._pad = {
      left: { squeeze: 0, trigger: 0, point: 0, cap: false },
      right: { squeeze: 0, trigger: 0, point: 0, cap: false },
    };
    this._rig = {
      left: { paid: 0, hadRope: false, headOut: false, rewind: 0, speed: 0 },
      right: { paid: 0, hadRope: false, headOut: false, rewind: 0, speed: 0 },
    };
    this._mz = { left: new Vector3(), right: new Vector3() }; // world muzzle (rope origin), this frame
    this._mzOk = { left: false, right: false };
    this._gearXr = null;
    this._lanternFlick = 1;
    this._tip = new Vector3();
    this._tdir = new Vector3();
    this._fwd = new Vector3(0, 0, -1);
    if (this.tuning.gear) this.gearReady = this._loadGear(this.tuning.gearUrl);

    // scratch
    this._ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: -1 };
    this._hit = { t: 0, solid: null, x: 0, y: 0, z: 0 };
    this._head = new Matrix4();
    this._m = new Matrix4();
    this._q = new Quaternion();
    this._q2 = new Quaternion();
    this._hp = new Vector3(); // head position
    this._camR = new Vector3();
    this._camU = new Vector3();
    this._s = new Vector3();
    this._e = new Vector3();
    this._d = new Vector3();
    this._side = new Vector3();
    this._tmp = new Vector3();
    this._down = new Vector3(0, -1, 0);
    this._lp = new Vector3(); // lantern-only scratch
    this._ls = new Vector3();
  }

  /** Object3D the launcher of `hand` is drawn on (the GLB side root once loaded, else the procedural mesh). */
  launcher(hand) {
    if (this.gear && this.gear[hand]) return this.gear[hand].root;
    return this.launchers[hand] || null;
  }

  /**
   * World position of a hand's launcher muzzle: where the rope starts (RopeView) and the
   * laser leaves. Valid for the current frame's sockets. Returns false (out untouched)
   * while the procedural fallback is showing or the hand is not tracked, so the caller
   * falls back to InputManager.handPose().
   */
  muzzlePosition(hand, out) {
    const g = this.gear && this.gear[hand];
    if (!g || !this.input || !this.input.handTracked(hand)) return false;
    if (!g.muzzleWorld(out)) return false;
    return true;
  }

  /**
   * Mount for a wrist HUD (UI3D looks this up): rides the hand socket, lifted so a
   * panel placed ~(0, 0.03, 0.085) on it floats just above the bracer plate instead
   * of cutting through it. Hidden with the hand when tracking is lost.
   */
  wristMount(hand) {
    const h = hand === 'right' ? 'right' : 'left';
    let m = this._wrist[h];
    if (!m) {
      m = new Object3D();
      m.name = `AT3D-wrist-${h}`;
      m.position.copy(this.gear ? this.tuning.wristLiftGear : this.tuning.wristLift);
      this._wrist[h] = m;
    }
    const sock = this.input && this.input.handSocket ? this.input.handSocket(h) : null;
    if (sock && m.parent !== sock) sock.add(m);
    return m;
  }

  setVisible(v) {
    this.visible = !!v;
  }

  // ---------------------------------------------------------------------------
  // GLB gear
  // ---------------------------------------------------------------------------

  _loadGear(url) {
    if (typeof window === 'undefined' || typeof fetch !== 'function') {
      this.gearState = 'failed';
      return Promise.resolve(false);
    }
    return loadGearGLTF(url)
      .then((gltf) => {
        this._applyGear(gltf);
        return true;
      })
      .catch((err) => {
        this.gearState = 'failed';
        this.gearError = err;
        if (typeof console !== 'undefined') console.warn('[AT3D] arm/launcher model unavailable, procedural hands only', err);
        return false;
      });
  }

  /** The GLB arrived: build both sides, swap the lantern, hide the procedural stand-ins. */
  _applyGear(gltf) {
    if (this._disposed) return;
    const inp = this.input;
    const root = gltf.scene;
    let baseMat = null;
    root.traverse((o) => {
      if (!baseMat && o.isMesh && o.material) baseMat = Array.isArray(o.material) ? o.material[0] : o.material;
    });
    if (!baseMat) throw new Error('player_arms.glb has no mesh material');
    const poses = readPoses(gltf.animations);
    // One material per hand (the emissive tint differs), one for the lantern; textures are shared.
    const makeMat = (hex) => {
      const m = baseMat.clone();
      m.side = FrontSide;
      m.transparent = true; // alpha stays 1: only so renderOrder places the hands after the VR UI (see HANDS_RENDER_ORDER_XR)
      m.forceSinglePass = true;
      m.emissive = new Color(hex);
      m.emissiveIntensity = this.tuning.gearGlowIdle;
      // The lantern is a few centimetres from the hands (and the hands are the brightest thing in a dark
      // shaft): scale the direct light on the gear so the leather and brass are not blown out by it.
      const lightU = this._gearLight;
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uGearLight = lightU;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uGearLight;')
          .replace(
            '#include <lights_fragment_end>',
            '#include <lights_fragment_end>\n\treflectedLight.directDiffuse *= uGearLight;\n\treflectedLight.directSpecular *= uGearLight;',
          );
      };
      m.customProgramCacheKey = () => 'at3d-gear-light';
      if (this._gearEnv) {
        m.envMap = this._gearEnv.texture;
        m.envMapIntensity = this.tuning.gearEnv;
      }
      m.needsUpdate = true;
      return m;
    };
    const r = this.r3 && this.r3.renderer;
    if (r && typeof r.getContext === 'function') {
      try {
        this._gearEnv = buildGearEnvironment(r);
      } catch (err) {
        this._gearEnv = null;
        if (typeof console !== 'undefined') console.warn('[AT3D] gear environment map unavailable', err);
      }
    }
    const mats = { left: makeMat(PAL.glowLeft), right: makeMat(PAL.glowRight), lantern: makeMat(PAL.lanternGlass) };
    // The wrist ECG screens: unlit, one material per hand (the GLB's placeholder trace until healthFx binds its texture).
    const ecgSrc = this._findMaterial(root, 'Arm_ECG_Screen');
    this._ecgPlaceholder = ecgSrc ? ecgSrc.emissiveMap || ecgSrc.map || null : null;
    const gear = {};
    for (const h of HANDS) {
      const node = root.getObjectByName(h === 'left' ? 'Arm_L' : 'Arm_R');
      if (!node) throw new Error(`player_arms.glb: Arm_${h === 'left' ? 'L' : 'R'} missing`);
      node.parent.remove(node);
      gear[h] = new HandGear(h, node, poses, mats[h], GEAR_TUNING);
      if (gear[h].ecgMesh) {
        const em = new MeshBasicMaterial({ map: this._ecgPlaceholder, toneMapped: false, fog: false });
        em.transparent = true; // alpha stays 1: draw order only (see HANDS_RENDER_ORDER_XR)
        em.forceSinglePass = true;
        em.name = 'Arm_ECG_Screen';
        gear[h].ecgMesh.material = em;
      }
      const sock = inp && inp.handSocket ? inp.handSocket(h) : null;
      if (sock) sock.add(node);
      node.visible = false;
    }
    // Loose grapple heads (world space; shown only while a line is out).
    const head = root.getObjectByName('GrappleHead');
    if (head) {
      head.parent.remove(head);
      for (const h of HANDS) {
        const m = head.clone();
        m.name = `AT3D-grapple-head-${h}`;
        m.material = mats[h];
        m.frustumCulled = false;
        m.visible = false;
        m.matrixAutoUpdate = true;
        this._heads[h] = m;
        if (this.scene) this.scene.add(m);
      }
    }
    // The carried lantern: the GLB model replaces the procedural one (same pendulum, same light socket).
    const lan = root.getObjectByName('Lantern');
    const hook = gear.left.hook;
    if (lan && hook) {
      lan.parent.remove(lan);
      lan.traverse((o) => {
        if (o.isMesh) {
          o.material = mats.lantern;
          o.frustumCulled = false;
        }
      });
      if (this.lantern.parent) this.lantern.parent.remove(this.lantern);
      this._lanternFallback = this.lantern;
      this.lantern = lan;
      this.lantern.name = 'AT3D-lantern';
      this._hookLocal.copy(hook.position);
      lan.position.copy(this._hookLocal);
      gear.left.root.add(lan);
      const sock = lan.getObjectByName('Lantern_Socket');
      if (sock) this.lanternSocket = sock;
      this._bobInit = false;
      this._lanternMode = ''; // re-parent the light into the new glass
    }
    this._gearMats = mats;
    this.gear = gear;
    for (const h of HANDS) this.launchers[h].visible = false;
    if (this._lanternFallback) this._lanternFallback.visible = false;
    this._order = -1; // re-apply render orders to the new meshes
    for (const h of HANDS) {
      const m = this._wrist[h];
      if (m) m.position.copy(this.tuning.wristLiftGear);
    }
    this.gearState = 'ready';
    // Compile the programs and upload the atlas now (menu time), not on first sight mid-descent.
    if (this.r3 && typeof this.r3.precompile === 'function') {
      try {
        this.r3.precompile();
      } catch {
        /* optimisation only */
      }
    }
  }

  _findMaterial(root, name) {
    let found = null;
    root.traverse((o) => {
      if (!found && o.isMesh && o.material && o.material.name === name) found = o.material;
    });
    return found;
  }

  /**
   * healthFx (another module, may arrive after us) publishes a CanvasTexture with the ECG trace:
   * bind it to the GLB screens (and the plane on the procedural fallback hands) once it exists.
   */
  _bindEcg(game) {
    const hfx = game ? game.healthFx : null;
    if (!hfx || !hfx.ecgTexture) return;
    const tex = hfx.ecgTexture;
    if (this._ecgTex !== tex) {
      this._ecgTex = tex;
      if (this.gear) {
        for (const h of HANDS) {
          const mesh = this.gear[h].ecgMesh;
          if (!mesh) continue;
          mesh.material.map = tex;
          mesh.material.needsUpdate = true;
          // glTF UVs have their origin top-left (textures there are flipY = false); a CanvasTexture is flipY = true: flip v once
          if (tex.flipY && !mesh.userData.ecgFlipped) {
            const uv = mesh.geometry.attributes.uv;
            for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
            uv.needsUpdate = true;
            mesh.userData.ecgFlipped = true;
          }
        }
      }
    }
    if (!this._ecgPlanes && typeof hfx.makeEcgPlane === 'function') {
      this._ecgPlanes = {};
      for (const h of HANDS) {
        let m = null;
        try {
          m = hfx.makeEcgPlane(0.07, 0.035);
        } catch {
          m = null;
        }
        if (!m) continue;
        m.name = `AT3D-ecg-${h}`;
        m.frustumCulled = false;
        m.renderOrder = this._order > 0 ? this._order : 0;
        // lies on the bracer plate, tilted toward the eye; baseline along the forearm
        m.position.set(h === 'left' ? 0.012 : -0.012, 0.056, 0.1);
        m.rotation.set(-Math.PI / 2 + 0.45, 0, h === 'left' ? -0.0 : 0.0);
        m.rotateZ(Math.PI / 2);
        this._ecgPlanes[h] = m;
      }
    }
  }

  /** Per-hand analog inputs: XR gamepad (read-only) or the desktop intents. */
  _readPad(hand, xr, st) {
    const P = this._pad[hand];
    const T = this.tuning;
    let squeeze = 0.85;
    let trigger = 0;
    let point = 0;
    if (xr) {
      let gp = null;
      const sess = this.r3 && this.r3.renderer && this.r3.renderer.xr && this.r3.renderer.xr.getSession ? this.r3.renderer.xr.getSession() : null;
      const srcs = sess ? sess.inputSources : null;
      if (srcs) {
        for (let i = 0; i < srcs.length; i++) {
          if (srcs[i].handedness === hand && srcs[i].gamepad) {
            gp = srcs[i].gamepad;
            break;
          }
        }
      }
      if (gp && gp.buttons) {
        const bt = gp.buttons[0];
        const bs = gp.buttons[1];
        trigger = bt ? Math.max(bt.value || 0, bt.pressed ? 1 : 0) : 0;
        squeeze = bs ? Math.max(bs.value || 0, bs.pressed ? 1 : 0) : 0;
        const tTouch = !!(bt && bt.touched);
        const sTouch = !!(bs && bs.touched);
        if (tTouch || sTouch) P.cap = true; // this controller senses resting fingers
        if (P.cap) {
          if (sTouch) squeeze = Math.max(squeeze, T.gripRest);
          if (!tTouch && trigger < 0.02 && squeeze > 0.5) point = 1; // index lifted off the trigger: pointing
        }
      } else {
        squeeze = 0.7;
        trigger = st && st.held ? 1 : 0;
      }
    } else {
      const ih = this.input.intent && this.input.intent.hands ? this.input.intent.hands[hand] : null;
      trigger = (st && st.held) || (ih && ih.held) ? 1 : 0;
      squeeze = Math.max(0.82, ih ? ih.yank || 0 : 0);
    }
    P.squeeze = squeeze;
    P.trigger = trigger;
    P.point = point;
    return P;
  }

  /** Poses the fingers, runs the launcher mechanics and places the loose grapple head. */
  _updateGear(hand, dt, game, tethers, xr, showHands) {
    const G = this.gear[hand];
    const T = this.tuning;
    const R = this._rig[hand];
    const st = tethers && tethers.hands ? tethers.hands[hand] : null;
    const rope = st ? st.rope : null;
    const attached = !!(rope && rope.anchor) && !!showHands;
    const miss = !!(st && st.miss) && !attached && !!showHands;
    const pad = this._readPad(hand, xr, st);
    G.poseFingers(dt, pad.squeeze, pad.trigger, pad.point);

    // line state → mechanics
    const extend = st && typeof st.extend === 'number' ? Math.min(1, Math.max(0, st.extend)) : 1;
    let paid = 0;
    let pay = 0;
    if (attached) {
      const len = isFinite(rope.length) ? rope.length : 0;
      paid = len * (extend < 1 ? extend : 1);
      if (R.hadRope && dt > 0) pay = (paid - R.paid) / dt;
      R.rewind = 0;
    } else if (R.hadRope) {
      R.rewind = 0.28; // the line was let go: the spring drum winds the cable back
    }
    if (R.rewind > 0) {
      pay = -9 * (R.rewind / 0.28);
      R.rewind = Math.max(0, R.rewind - dt);
    }
    R.speed += (pay - R.speed) * (1 - Math.exp(-30 * dt));
    R.paid = paid;
    R.hadRope = attached;
    const out = attached || miss;
    if (out !== R.headOut) {
      R.headOut = out;
      G.setHeadOut(out, attached ? 1 : 0.8);
    }
    const g = (CONFIG.player && CONFIG.player.gravity) || 9.81;
    G.animate(dt, {
      trigger: pad.trigger,
      tension: attached && isFinite(rope.tension) ? rope.tension : 0,
      pay: R.speed,
      slip: attached && isFinite(rope.slipSpeed) ? Math.max(0, rope.slipSpeed) : 0,
      gravity: g,
    });

    // The muzzle (rope origin) of this frame, then the loose head at the tip of the line.
    this._mzOk[hand] = G.root.visible ? G.muzzleWorld(this._mz[hand]) : false;
    const prop = this._heads[hand];
    if (!prop) return;
    if (!(out && this._mzOk[hand])) {
      prop.visible = false;
      return;
    }
    const M = this._mz[hand];
    const tip = this._tip;
    const dir = this._tdir;
    if (attached) {
      const a = rope.anchor;
      dir.set(a.x - M.x, a.y - M.y, a.z - M.z);
      const d = dir.length() || 1e-6;
      dir.multiplyScalar(1 / d);
      const e = Math.max(0.0, extend);
      tip.copy(M).addScaledVector(dir, d * e);
    } else {
      // missed shot: the line's end as RopeView drew it last frame
      const rv = this.r3 && this.r3.ropeView;
      const strand = rv && rv.strands ? rv.strands[hand] : null;
      if (!strand || !strand.mesh.visible) {
        prop.visible = false;
        return;
      }
      const c = strand.centre;
      const n = c.length - 3;
      tip.set(c[n], c[n + 1], c[n + 2]);
      dir.subVectors(tip, M);
      const d = dir.length();
      if (d < 0.05) {
        prop.visible = false;
        return;
      }
      dir.multiplyScalar(1 / d);
    }
    // grows with distance from the eye like the rope tube does, so a far head still reads
    const eye = this._hp;
    const dh = Math.sqrt((tip.x - eye.x) ** 2 + (tip.y - eye.y) ** 2 + (tip.z - eye.z) ** 2);
    const sc = Math.min(T.headScaleMax, 1 + Math.max(0, dh - 0.6) * 0.2);
    prop.scale.setScalar(sc);
    prop.quaternion.setFromUnitVectors(this._fwd, dir);
    prop.position.copy(tip).addScaledVector(dir, -0.0395 * sc);
    prop.visible = true;
  }

  /**
   * Per frame, after the Game moved the rig and before render.
   * @param {number} dt
   * @param {object} game Game3D (or any object with the fields listed above)
   */
  update(dt, game) {
    const inp = this.input;
    if (!inp) return;
    const step = isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    this._time += step;
    if (!this.scene && this.r3 && this.r3.scene) {
      this.scene = this.r3.scene;
      this.scene.add(this.batch.mesh);
    }
    const xr = inp.xrActive;
    const state = game && game.state ? game.state : 'playing';
    const inRun = state === 'playing' || state === 'paused' || state === 'dead';
    const showHands = this.visible && (xr || inRun);
    const gear = this.gear;
    for (const h of HANDS) {
      const m = this.launchers[h];
      const sock = inp.handSocket(h);
      if (m.parent !== sock && sock) sock.add(m);
      m.visible = showHands && !gear;
      if (gear) {
        const r = gear[h].root;
        if (sock && r.parent !== sock) sock.add(r);
        r.visible = showHands;
      }
    }
    if (gear && xr !== this._gearXr) this._placeGear(xr);
    this._bindEcg(game);
    if (this._ecgPlanes) {
      for (const h of HANDS) {
        const pl = this._ecgPlanes[h];
        if (!pl) continue;
        const sock = inp.handSocket(h);
        if (sock && pl.parent !== sock) sock.add(pl);
        pl.visible = showHands && !gear; // the GLB screens replace the plane once the model is up
        if (pl.renderOrder !== (xr ? HANDS_RENDER_ORDER_XR : 0)) pl.renderOrder = xr ? HANDS_RENDER_ORDER_XR : 0;
      }
    }
    this.lantern.visible = showHands;
    const order = xr ? HANDS_RENDER_ORDER_XR : 0;
    if (order !== this._order) {
      this._order = order;
      for (const h of HANDS) this.launchers[h].renderOrder = order;
      this.lantern.renderOrder = order;
      if (gear) {
        const setOrder = (o) => {
          o.renderOrder = order;
        };
        for (const h of HANDS) {
          gear[h].root.traverse(setOrder);
          if (this._heads[h]) this._heads[h].renderOrder = order;
        }
        this.lantern.traverse(setOrder);
      }
    }
    this._updateLanternParent(xr);

    // Head (current frame) for billboards.
    inp.headMatrix(this._head);
    const he = this._head.elements;
    this._hp.set(he[12], he[13], he[14]);
    this._camR.set(he[0], he[1], he[2]).normalize();
    this._camU.set(he[4], he[5], he[6]).normalize();

    this._updateLantern(step);

    const tethers = game ? game.tethers : null;
    if (gear) for (const h of HANDS) this._updateGear(h, step, game, tethers, xr, showHands);
    const playing = state === 'playing' && !inp.uiMode && (!game || !game.player || game.player.alive !== false);
    const batch = this.batch;
    batch.begin();
    for (const h of HANDS) this._updateHand(h, step, game, tethers, playing, xr && showHands, showHands);
    const uiPointer = this.showUIPointer || !game || !game.ui || !!game.ui.isNull;
    if (xr && inp.uiMode && uiPointer && this.visible) this._uiPointer();
    batch.end();
    // keep the batch in world space
    if (this.batch.mesh.parent && this.batch.mesh.parent !== this.scene && this.scene) this.scene.add(this.batch.mesh);
    this.batch.mesh.matrixWorld.identity();
  }

  _updateLanternParent(xr) {
    if (!this.manageLantern || !this.r3 || typeof this.r3.setLanternParent !== 'function') return;
    const leftOk = xr && this.input.handTracked('left');
    const mode = leftOk ? 'hand' : 'camera';
    if (mode === this._lanternMode) return;
    const target = leftOk ? this.lanternSocket : this.camera || this.r3.camera;
    if (!target) return;
    try {
      if (leftOk) {
        // The light sits in our lantern's glass; its own bulb mesh would double the glass.
        this.r3.setLanternParent(target, ZERO_OFFSET, { bulb: false });
      } else {
        this.r3.setLanternParent(target);
      }
      this._lanternMode = mode;
    } catch {
      this._lanternMode = mode; // don't retry every frame
    }
  }

  /** Verlet pendulum: the lantern hangs from the hook and swings with hand motion. */
  _updateLantern(dt) {
    const L = this.lantern;
    const parent = L.parent;
    if (!parent || !L.visible) {
      this._bobInit = false;
      return;
    }
    parent.updateWorldMatrix(true, false);
    const hook = this._tmp.copy(this._hookLocal).applyMatrix4(parent.matrixWorld);
    const len = this.tuning.lanternRope;
    if (!this._bobInit || this._bob.distanceToSquared(hook) > 1 || dt <= 0) {
      this._bob.copy(hook).y -= len;
      this._bobPrev.copy(this._bob);
      this._bobInit = true;
    } else {
      const k = Math.exp(-this.tuning.lanternDamp * dt);
      const vx = (this._bob.x - this._bobPrev.x) * k;
      const vy = (this._bob.y - this._bobPrev.y) * k;
      const vz = (this._bob.z - this._bobPrev.z) * k;
      this._bobPrev.copy(this._bob);
      this._bob.x += vx;
      this._bob.y += vy - 9.8 * dt * dt;
      this._bob.z += vz;
    }
    const d = this._d.subVectors(this._bob, hook);
    const dl = d.length() || 1e-6;
    d.multiplyScalar(1 / dl);
    this._bob.copy(hook).addScaledVector(d, len);
    // World orientation: local −Y along d; convert to the parent's frame.
    this._q.setFromUnitVectors(this._down, d);
    parent.matrixWorld.decompose(this._lp, this._q2, this._ls);
    this._q2.invert();
    L.quaternion.multiplyQuaternions(this._q2, this._q);
    // Flicker the glass a little.
    const t = this._time;
    const fl = 0.86 + 0.08 * Math.sin(t * 13.1) + 0.06 * Math.sin(t * 29.7 + 1.3);
    this.lanternMaterial.userData.glow.uGlowB.value = 2.4 * fl;
    if (this._gearMats) this._gearMats.lantern.emissiveIntensity = 1.5 * fl;
  }

  /** Desktop: the arm model sits on the virtual hand with a small offset; XR: identity on the grip socket. */
  _placeGear(xr) {
    this._gearXr = xr;
    const D = this.tuning.desktopGear;
    for (const h of HANDS) {
      const r = this.gear[h].root;
      if (xr) {
        r.position.set(0, 0, 0);
        r.rotation.set(0, 0, 0);
        r.scale.setScalar(1);
      } else {
        const sg = h === 'left' ? -1 : 1;
        r.position.set(D.x * sg, D.y, D.z);
        r.rotation.set(D.rx, D.ry * sg, D.rz * sg);
        r.scale.setScalar(D.scale);
      }
    }
  }

  _updateHand(hand, dt, game, tethers, playing, xrShow, showHands) {
    const T = this.tuning;
    const inp = this.input;
    const st = tethers && tethers.hands ? tethers.hands[hand] : null;
    const rope = st ? st.rope : null;
    const attached = !!(rope && rope.anchor);
    const target = st && st.target && !st.target.broken ? st.target : null;
    const f = this.fx[hand];
    const glow = this.materials[hand].userData.glow;
    const t = this._time;

    // Launcher glow: pilot light, brighter + pulsing on a target, strained when attached.
    let g = 0.55;
    if (attached) {
      const tension = rope.tension || 0;
      g = 1.3 + Math.min(1, tension / 40) * 2.4;
      const stress = tethers.anchorStress ? tethers.anchorStress(hand) : 0;
      if (stress > 0.35) g *= 0.55 + 0.45 * Math.abs(Math.sin(t * (18 + stress * 40)));
    } else if (playing && target) {
      g = 2.1 + 0.5 * Math.sin(t * 9);
    }
    if (!playing && !attached) g = 0.45;
    glow.uGlowA.value = g;
    if (this.gear) {
      // GLB lamp + gauge phosphor: idle pilot, brighter on a target / under load (no bloom: keep it readable, not blown)
      const e = this.tuning.gearGlowIdle * (0.5 + g * 0.55);
      this._gearMats[hand].emissiveIntensity = Math.min(3.2, e);
    }

    // Laser / reticle visibility targets.
    const pose = showHands && playing && !attached ? inp.handPose(hand) : null;
    const ray = pose ? inp.aimRay(hand, this._ray) : null;
    let wantLaser = 0;
    let wantReticle = 0;
    let wantDot = 0;
    const s = this._s;
    const e = this._e;
    const d = this._d;
    let laserLen = 0;
    if (pose && ray) {
      if (this._mzOk[hand]) s.copy(this._mz[hand]);
      else s.set(pose.x, pose.y, pose.z);
      if (target) {
        d.set(target.x - s.x, target.y - s.y, target.z - s.z);
        const dist = d.length() || 1e-6;
        d.multiplyScalar(1 / dist);
        laserLen = Math.min(dist, T.laserLength);
        wantLaser = 1;
        wantReticle = 1;
        f.target = target;
      } else {
        // Along the aim ray; find the wall it meets for the dot.
        d.set(ray.dx, ray.dy, ray.dz);
        let hitT = -1;
        const level = game && game.level;
        if (level && typeof level.raycast === 'function') {
          const hit = level.raycast(ray.ox, ray.oy, ray.oz, ray.dx, ray.dy, ray.dz, T.rayMax, this._hit);
          if (hit) hitT = hit.t;
        }
        // Desktop aims from the view centre: point the beam from the hand at the hit.
        if (hitT > 0) {
          e.set(ray.ox + ray.dx * hitT, ray.oy + ray.dy * hitT, ray.oz + ray.dz * hitT);
          if (!inp.xrActive) {
            d.subVectors(e, s);
            const dl = d.length() || 1e-6;
            d.multiplyScalar(1 / dl);
          }
          const range = game && game.diff && game.diff.aimRange ? game.diff.aimRange : 32;
          f.hollow = hitT > range;
          f.dotX = e.x;
          f.dotY = e.y;
          f.dotZ = e.z;
          f.dotDist = this._hp.distanceTo(e);
          wantDot = inp.xrActive || hand === 'right' ? 1 : 0; // desktop: both hands share one aim → one dot
          laserLen = Math.min(s.distanceTo(e), T.laserLength);
        } else {
          laserLen = T.laserLength;
        }
        wantLaser = xrShow ? 0.55 : 0;
      }
    }
    const k = 1 - Math.exp(-T.fadeRate * dt);
    f.laser += (wantLaser - f.laser) * k;
    f.reticle += (wantReticle - f.reticle) * (wantReticle ? 1 : k);
    f.dot += (wantDot - f.dot) * k;
    if (!pose) {
      if (!showHands || !playing || attached) {
        f.laser = 0;
        f.reticle = 0;
        f.dot = 0;
        f.target = null;
      }
      return;
    }

    const rgb = FX_COLOR[hand];
    const B = this.batch;
    // Beam
    const alpha = (inp.xrActive ? T.laserAlphaXR : T.laserAlphaDesktop) * f.laser;
    if (alpha > 0.003 && laserLen > 0.02) {
      e.copy(s).addScaledVector(d, laserLen);
      const side = this._side.subVectors(s, this._hp).cross(d);
      const sl = side.length();
      if (sl > 1e-6) side.multiplyScalar(1 / sl);
      else side.copy(this._camR);
      B.beam(s, e, side, T.laserWidth, T.laserWidthEnd, rgb, alpha);
    }
    // Reticle at the target (pulled toward the hand so it sits in front of the marker);
    // fades out at the last target when the aim leaves it.
    const rt = target || (f.target && !f.target.broken ? f.target : null);
    if (f.reticle > 0.01 && rt) {
      const c = this._tmp.set(rt.x, rt.y, rt.z);
      const toHand = this._side.subVectors(s, c);
      const tl = toHand.length();
      if (tl > T.reticlePull * 2) c.addScaledVector(toHand, T.reticlePull / tl);
      const dist = this._hp.distanceTo(c);
      const hsz = Math.min(T.reticleMax, Math.max(T.reticleMin, dist * T.reticleAngular));
      B.sprite(c, this._camR, this._camU, hsz, rgb, 0.95 * f.reticle, hand === 'left' ? SHAPE_DIAMOND : SHAPE_RING);
    }
    // Wall dot where an untargeted aim lands (hollow beyond tether range).
    if (f.dot > 0.01 && !target && f.dotDist > 0) {
      const c = this._tmp.set(f.dotX, f.dotY, f.dotZ);
      // nudge toward the head so it never z-fights the wall (depth test is off anyway)
      const hsz = Math.max(0.012, f.dotDist * this.tuning.wallDotAngular) * (f.hollow ? 1.6 : 1);
      const a = (f.hollow ? 0.28 : 0.42) * f.dot * (inp.xrActive ? 1 : 0.85);
      B.sprite(c, this._camR, this._camU, hsz, rgb, a, f.hollow ? SHAPE_HOLLOW : SHAPE_DOT);
    }
  }

  /** XR panel pointer: a short neutral beam from the UI hand. */
  _uiPointer() {
    const inp = this.input;
    const hand = inp.uiHand === 'left' ? 'left' : 'right';
    if (!inp.handTracked(hand)) return;
    const ray = inp.aimRay(hand, this._ray);
    if (!ray) return;
    const pose = inp.handPose(hand);
    const s = this._s.set(pose.x, pose.y, pose.z);
    const d = this._d.set(ray.dx, ray.dy, ray.dz);
    const e = this._e.copy(s).addScaledVector(d, 1.4);
    const side = this._side.subVectors(s, this._hp).cross(d);
    const sl = side.length();
    if (sl > 1e-6) side.multiplyScalar(1 / sl);
    else side.copy(this._camR);
    this.batch.beam(s, e, side, 0.004, 0.002, FX_COLOR.ui, 0.5);
  }

  dispose() {
    this._disposed = true;
    if (this.gear) {
      for (const h of HANDS) {
        const g = this.gear[h];
        if (g.root.parent) g.root.parent.remove(g.root);
        g.root.traverse((o) => {
          if (o.isMesh && o.geometry) o.geometry.dispose();
          if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();
        });
        const p = this._heads[h];
        if (p && p.parent) p.parent.remove(p);
      }
      const hp = this._heads.left;
      if (hp && hp.geometry) hp.geometry.dispose();
      if (this.lantern && this.lantern !== this._lanternFallback) {
        if (this.lantern.parent) this.lantern.parent.remove(this.lantern);
        this.lantern.traverse((o) => {
          if (o.isMesh && o.geometry) o.geometry.dispose();
        });
      }
      for (const k of Object.keys(this._gearMats || {})) this._gearMats[k].dispose();
      if (this._gearEnv) this._gearEnv.dispose();
    }
    for (const h of HANDS) {
      const m = this.launchers[h];
      if (m.parent) m.parent.remove(m);
      m.geometry.dispose();
      this.materials[h].dispose();
    }
    if (this.lantern.parent) this.lantern.parent.remove(this.lantern);
    this.lantern.geometry.dispose();
    this.lanternMaterial.dispose();
    if (this.batch.mesh.parent) this.batch.mesh.parent.remove(this.batch.mesh);
    this.batch.dispose();
  }
}

