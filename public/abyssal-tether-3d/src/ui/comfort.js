/* ABYSSAL TETHER 3D — comfort.js
 * WP-UX: the two pieces of the settings that live in the 3D view, as ONE head-locked quad (one draw call) plus the
 * renderer hooks the Display settings drive.
 *
 *   ComfortOverlay  a plane 0.3 m in front of the eyes (a child of the head camera, like the death fade) with a tiny
 *                   shader: a clear centre whose radius closes with the comfort level (vignette), and an additive lift of
 *                   the darkest pixels (the black level from the calibration screen). Premultiplied blending makes both
 *                   one pass: out = lift + scene * (1 - vignetteAlpha). Invisible (not drawn) at the defaults.
 *                   The vignette is OFF by default; settings.vignette is its strength (0..1). It closes while the
 *                   player is fast (a long fall, a swing), faster on the rope, and while the stick smooth-turns; a snap
 *                   turn gives it a short pulse. It opens slowly so it never pops.
 *   applyDisplay    qualityTier / renderScale / brightness onto the renderer (renderer3d.js public API only):
 *                   setQualityTier(), setXRRenderScale(), renderer.toneMappingExposure.
 *
 * Per-frame work allocates nothing. Draw calls: +1 while visible.
 */
import * as THREE from 'three';
import { DITHER_GLSL } from '../render/vrShade.js';
import { blackLift, exposureMul, followLevel, vignetteLevel, vignetteShape, xrScaleFor, SNAP_FULL_RATE } from './uxLogic.js';

const DIST = 0.3; // m in front of the eyes
const HALF = 1.6; // plane half-size: tan(79 degrees) at DIST, wider than any headset view
const ORDER = 990; // after the VR panel (950) and the hands (960/961), before the fade mesh (9999)
const PULSE = 0.28; // s: the snap-turn pulse

const VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy / ${DIST.toFixed(3)};
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
const FRAG = /* glsl */ `
uniform float uHole;
uniform float uSoft;
uniform float uOpacity;
uniform float uLift;
varying vec2 vP;
${DITHER_GLSL}
void main() {
  float a = smoothstep( uHole, uHole + uSoft, length( vP ) ) * uOpacity;
  vec3 lift = vec3( uLift ) + ( uLift > 0.0 ? atDither3( gl_FragCoord.xy ) * ( 0.45 / 255.0 / 12.92 ) : vec3( 0.0 ) );
  gl_FragColor = vec4( max( lift, vec3( 0.0 ) ), a );
  #include <colorspace_fragment>
}`;

export class ComfortOverlay {
  /** @param {object} game Game3D (renderer.camera, settings, player, tethers, intent, state, bus) */
  constructor(game) {
    this.game = game;
    this.mesh = null;
    this.level = 0; // smoothed 0..1 motion level (before the strength setting)
    this.pulse = 0;
    this.intensity = 0;
    this._shape = { hole: 2, soft: 0.4, opacity: 0 };
    this._offs = [];
    const bus = game && game.bus;
    if (bus && typeof bus.on === 'function') {
      const off = bus.on('comfort:snap', () => {
        this.pulse = PULSE;
      });
      if (typeof off === 'function') this._offs.push(off);
    }
  }

  _build() {
    const g = this.game;
    const cam = g && g.renderer && g.renderer.camera;
    if (!cam || !cam.isObject3D) return null;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uHole: { value: 2 }, uSoft: { value: 0.4 }, uOpacity: { value: 0 }, uLift: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), mat);
    mesh.name = 'UX.comfort';
    mesh.position.z = -DIST;
    mesh.renderOrder = ORDER;
    mesh.frustumCulled = false;
    mesh.visible = false;
    cam.add(mesh);
    this.mesh = mesh;
    return mesh;
  }

  /** Per frame. `turnNorm` is the smooth-turn stick deflection (0 when snapping / desktop). */
  update(dt) {
    const g = this.game;
    const s = g && g.settings;
    if (!s) return;
    const lift = blackLift(s.blackLevel);
    const strength = typeof s.vignette === 'number' ? s.vignette : 0;
    let target = 0;
    const playing = g.state === 'playing' && g.player && g.player.alive !== false;
    if (strength > 0.001 && playing) {
      const p = g.player;
      const speed = Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0);
      const roped = !!(g.tethers && g.tethers.attached);
      const it = g.intent;
      let turnNorm = 0;
      if (s.turnMode !== 'snap' && it && typeof it.turnRate === 'number' && isFinite(it.turnRate)) {
        turnNorm = it.turnRate / (SNAP_FULL_RATE * Math.max(0.25, s.turnSpeed || 1));
      }
      target = vignetteLevel(speed, turnNorm, roped);
    }
    this.level = followLevel(this.level, target, dt);
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - dt);
    const pulseK = strength > 0.001 ? (this.pulse / PULSE) * 0.55 : 0;
    this.intensity = Math.max(this.level * strength, pulseK * strength);
    vignetteShape(this.intensity, this._shape);
    const on = this._shape.opacity > 0.004 || lift > 0;
    if (!this.mesh) {
      if (!on) return;
      if (!this._build()) return;
    }
    const m = this.mesh;
    if (m.visible !== on) m.visible = on;
    if (!on) return;
    const u = m.material.uniforms;
    u.uHole.value = this._shape.hole;
    u.uSoft.value = this._shape.soft;
    u.uOpacity.value = this._shape.opacity;
    u.uLift.value = lift / 12.92; // linear value whose sRGB encoding is the requested display-space lift
  }

  dispose() {
    for (const off of this._offs) off();
    this._offs.length = 0;
    const m = this.mesh;
    if (m) {
      if (m.parent) m.parent.remove(m);
      m.geometry.dispose();
      m.material.dispose();
      this.mesh = null;
    }
  }
}

/**
 * Pushes the Display settings onto the renderer. Cheap and idempotent: compares with what it applied last, so it can be
 * called on every settings:changed. `live` re-pins a tier without rebuilding the reflection probe (after the governor stepped).
 * @returns {object} what changed {tier, scale, exposure}
 */
export function applyDisplay(game, st, live) {
  const out = { tier: false, scale: false, exposure: false };
  const r = game && game.renderer;
  const s = game && game.settings;
  if (!r || !s) return out;
  const tier = s.qualityTier || 'auto';
  if (st.tier === undefined && tier === 'auto') st.tier = 'auto'; // nothing pinned yet: leave the renderer's own pick alone
  if (live || tier !== st.tier) {
    st.tier = tier;
    if (typeof r.setQualityTier === 'function') {
      try {
        r.setQualityTier(tier === 'auto' ? null : tier, live ? { live: true } : undefined);
        out.tier = true;
      } catch {
        /* optional hook */
      }
    }
    st.scale = NaN; // the tier call rewrote the XR scale: set ours again
  }
  const auto = r.lighting && typeof r.lighting.tier === 'string' ? r.lighting.tier : 'quest';
  const scale = xrScaleFor(tier, typeof s.renderScale === 'number' ? s.renderScale : 1, auto);
  if (scale !== st.scale) {
    st.scale = scale;
    if (typeof r.setXRRenderScale === 'function') {
      try {
        r.setXRRenderScale(scale);
        out.scale = true;
      } catch {
        /* optional hook */
      }
    }
  }
  const gl = r.renderer;
  if (gl && typeof gl.toneMappingExposure === 'number') {
    if (!(st.baseExposure > 0)) st.baseExposure = gl.toneMappingExposure / (st.expMul || 1);
    const mul = exposureMul(s.brightness);
    if (mul !== st.expMul) {
      st.expMul = mul;
      gl.toneMappingExposure = st.baseExposure * mul;
      out.exposure = true;
    }
  }
  return out;
}
