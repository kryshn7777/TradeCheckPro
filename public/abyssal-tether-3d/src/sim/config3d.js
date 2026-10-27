/* ABYSSAL TETHER 3D — config3d.js
 * Tuning (metres, seconds; three.js convention: +Y is up, the descent goes
 * toward -Y), difficulty presets, small vector/maths helpers, an event bus
 * and localStorage persistence. Pure ES module, no three.js dependency, so
 * the simulation runs unchanged in Node for tooling.
 */

const DEG = Math.PI / 180;

export const CONFIG = {
  PHYSICS_DT: 1 / 240,
  MAX_FRAME_DT: 0.1,
  MAX_STEPS_PER_FRAME: 30,

  player: {
    radius: 0.38, // collision sphere around the chest
    eyeHeight: 0.5, // head above the body centre when not in XR
    gravity: 13.5, // a touch heavier than Earth: snappier swings
    maxSpeed: 48,
    maxFallSpeed: 38,
    runAccel: 40,
    runMaxSpeed: 5.5,
    groundFriction: 9,
    overspeedFriction: 2.2,
    brakeFactor: 2.4,
    airAccel: 7,
    airMaxSpeed: 7.5,
    airDrag: 0.03, // linear horizontal air brake while free (no rope pulling)
    // Quadratic air drag, a = -dragQuad |v| v, applied in the air with or without a rope: realistic
    // for a body in a harness (k = rho Cd A / 2m ~ 0.005 /m). Terminal fall speed
    // sqrt(gravity / dragQuad) = 52 m/s = 1.37 x maxFallSpeed, so the maxFallSpeed clamp stays the ceiling
    // (at 38 m/s the drag is 7.2 m/s^2, 53 % of gravity: a long fall visibly stops gaining speed).
    dragQuad: 0.005,
    jumpSpeed: 5.6,
    coyoteTime: 0.1,
    jumpBuffer: 0.12,
    hardLandingSpeed: 10.5,
    staggerTime: 0.35,
    staggerControl: 0.35,
    groundNormalY: 0.55, // contact normal.y above this = standing
    lethalNormalY: 0.3, // only floor-ish impacts can kill
    wallHitFxSpeed: 4,
    fallDeathMargin: 60,
  },

  rope: {
    minLength: 1.6, // the head sits ~1.25 m above the body centre: it must stay below the anchor
    // Slip clutch + elastic catch (physics3d.js Rope3D.pull). Loads are in units of player.gravity
    // and include gravity along the line; tension is a force per unit mass (m/s^2).
    maxTensionG: 4.2, // the winch's holding load: beyond it the line pays out
    catchPeakG: 5.5, // ceiling of the transient load of a catch (elastic zone and fast slip), so a 20 m fall stops in ~4 m
    slipBrakeG: 0.3, // extra clutch load per m/s of outward radial speed while slipping (fall arrest), up to catchPeakG
    strainAtMax: 0.03, // elastic strain of the line at maxTensionG (stiffness = load / (strain x length))
    catchDamping: 1.7, // damping ratio of the catch spring-damper at catch speeds (>= 1: no rebound; overdamped recoil)
    restDamping: 0.2, // ... and for small stretch rates (a steady swing breathes a little: keep its energy)
    catchDampingSpeed: 5, // m/s of stretch rate at which the damping reaches catchDamping
    slipFxSmooth: 0.05, // s: smoothing of the reported pay-out speed (feedback only)
    slipFxMin: 0.6, // m/s of line paying out that counts as slipping (rope:slip)
    slipFxSpeed: 8, // m/s of pay-out that is intensity 1
    slipFxPeriod: 0.16, // s between rope:slip events while a slip goes on
    maxLengthBonus: 4,
    reelInSpeed: 9.5,
    reelOutSpeed: 11,
    yankSpeed: 17, // grip on a tethered hand: hard pull
    pumpAccel: 9.5,
    reelSpinCap: 1.02,
    releaseBoost: 1.04,
    releaseBoostMinSpeed: 8,
    // The shot is a projectile: the hook flies from the muzzle to the target and the line attaches when it ARRIVES
    // (TetherSystem.fire / step). Flight time = distance / flightSpeed, clamped to [flightMin, flightMax].
    flightSpeed: 85, // m/s: hook flight speed (a 20 m shot takes 0.24 s, the farthest 0.38 s)
    flightMin: 0.05, // s: even a point-blank shot is visibly in flight
    flightMax: 0.45, // s: the longest flight (the farthest shots are a little faster than flightSpeed)
    attachRamp: 0.2, // s: after the hook bites, the line's pull builds from 0 to full (smoothstep): no snap
    attachRampSpeed: 5, // m/s of outward speed that doubles the ramp's rate (a fast fall is arrested at once: 20 m/s = 5x)
    missTime: 0.24,
    grappleBuffer: 0.2,
    tautSlack: 0.04,
    joltFxSpeed: 12,
  },

  targeting: {
    stickiness: 0.18,
    losEndClearance: 0.6,
    minAimLength: 1e-3,
  },

  // Health and fall damage (sim/health3d.js). hp is 0..1 (100 hp). Per-difficulty values live in
  // DIFFICULTY[k].health (fall threshold, regeneration, hazard damage, wall scale).
  health: {
    lowEnter: 0.35, // hp at or below this is "low": the heartbeat, the ECG turns red, the pulse starts
    lowExit: 0.5, // ... until hp climbs back to this (hysteresis)
    vignetteStart: 0.6, // the red screen-edge vignette fades in below this hp (full rim at 0)
    fallExp: 2, // landing damage = ((v/vLethal - threshold) / (1 - threshold))^fallExp: 0 at the threshold, 1 (dead) at the lethal speed
    wallThreshold: 0.5, // side impacts: no damage below this fraction of the lethal speed
    wallMax: 0.45, // ... damage at the lethal speed (the normal-component speed)
    wallExp: 2,
    wallCap: 0.7, // ... and the most a single wall hit can take
    wallSpeedCap: 1.5, // speed ratio at which the wall curve stops growing
    hitCooldown: 0.35, // s: one landing is not counted twice (a bigger second hit pays only the excess)
    hazardCooldown: 1.2, // s between hazard (spikes / blades / rebar) hits
    bpmCalm: 60, // heartbeat at full health
    bpmMax: 140, // ... near zero hp
    bpmExp: 1.5,
    adrenalineBpm: 25, // extra bpm right after a hit, fading over adrenalineTime
    adrenalineTime: 4,
    checkpointHeal: 1, // hp restored on reaching a new checkpoint (fraction of full)
  },

  // Grip climbing (sim/climb3d.js): authored climb zones (level data `climb`), hand-delta locomotion in VR (hold GRIP with a
  // hand inside reach of a zone: the hand is anchored there and moving it pulls the body the other way; let go and the pull
  // velocity is kept = a throw), cling-and-climb on the desktop (hold F; W/S/A/D climb, Space hops off). Grip STAMINA (0..1)
  // drains while hanging unsupported, faster while moving and on wet zones, refills on solid ground; empty = the hands slip.
  climb: {
    reachVR: 0.24, // m from the hand (palm) to a climb zone that can be gripped
    reachDesk: 0.62, // m from the body centre (the wall is ~0.38 away) on the desktop
    hoverReachVR: 0.36, // handhold highlight appears a little before the grab works
    track: 90, // 1/s: stiffness of the pull (v = stretch x track); 90 -> the body is on the hand within ~2 physics steps
    maxPull: 9, // m/s: cap of the pull velocity (a hand thrown at a wall cannot catapult the body, nor hurt it)
    maxStretch: 0.7, // m: a gripped hand this far from its hold (the body is blocked) lets go
    throwSmooth: 0.07, // s: low-pass of the pull velocity (what a release inherits)
    throwGain: 1.12, // x the smoothed pull velocity at release
    throwMax: 11, // m/s
    gripOn: 0.62, // grip squeeze that grabs (hysteresis: let go below gripOff)
    gripOff: 0.4,
    // stamina (1 = full), per second
    hangDrain: 0.03, // hanging by a hand in the air (~33 s from full)
    moveDrain: 0.05, // extra while the body moves at moveRef m/s (climbing; VR: pulling)
    moveRef: 1.4,
    twoHand: 0.62, // x the drain with both hands on holds (authored holds only: two hands on edges are no steadier)
    edgeMul: 1.5, // x the drain on a procedural EDGE hold (any exposed solid edge): low-grade; authored zones keep their rate
    edgeLink: 0.7, // m: two edge holds this close are one continuous run (the verifier's 'max continuous edge climb')
    mantleBelow: 0.6, // m: a lip mantle starts when the body centre is within this below the lip (VR: and pulled up)
    mantleVy: 0.5, // m/s: VR pull speed (low-passed) that counts as pulling over the lip
    mantleHead: 0.25, // m: desktop - the head (eye) this near the lip height (or above) allows W / Space to mantle
    mantleUp: 3.4, // m/s climbing over the lip
    mantleIn: 2.2, // m/s onto the ledge
    mantleTime: 1.1, // s: a mantle that has not finished by now is abandoned
    wetMul: 1.7, // x on a wet zone
    regenGround: 0.4, // standing on solid ground (a full refill in ~2.5 s)
    regenAir: 0.05, // swinging on a rope / falling (a slow breath)
    regenGrip: 0.12, // gripping while standing (resting on a ledge)
    minStart: 0.08, // stamina needed to take a hold
    resumeAt: 0.25, // after the hands slipped (empty), stamina needed before gripping again
    slipLock: 0.8, // s after a slip before a hold can be taken
    warnAt: 0.28, // below this stamina the hold strains (haptics, strain sound, vignette)
    // desktop cling
    deskUp: 1.5, // m/s climbing up
    deskDown: 2.2,
    deskSide: 1.2,
    deskHold: 0.44, // m: body centre to the wall surface while clinging (radius + a hand's width)
    deskSnap: 9, // 1/s: how fast the body settles to the hold distance
    hopUp: 6.2, // Space while clinging (desktop) / A while gripping (VR)
    hopOut: 2.6,
    hopLock: 0.25, // s after a hop before the next hold
    scrapePeriod: 0.3, // s between 'climb:scrape' events while moving over a zone
    strainPeriod: 1.1, // s between 'climb:strain' events at the start of the warning (shortens to strainFast)
    strainFast: 0.45,
    moveSound: 0.3, // m/s of body speed that counts as moving for scrapes
  },

  // Player bag (sim/inventory3d.js, sim/pickups3d.js): consumables, the adrenaline speed boost and the lantern charge.
  // Arrays are indexed by item: 0 FIRST_AID, 1 BANDAGE, 2 ADRENALINE, 3 BATTERY.
  bag: {
    caps: [1, 5, 2, 3], // how many of each the bag holds
    applyTime: [5, 1.5, 0.6, 1], // s a use is channelled (cancelled by damage / death / the cancel input)
    heal: [1, 0.2, 0.1, 0], // fraction of full health restored when the channel completes
    adrenalineTime: 10, // s of the speed boost
    adrenalineMul: 2, // x run / air speed caps, acceleration, reel and pump speed (gravity and fall damage unchanged)
    batteryRestore: 0.5, // lantern charge a battery restores (0..1)
    lanternDrain: 0.0007, // charge per second while playing: full to empty in ~24 min
    lanternFloor: 0.25, // the lantern never goes dark: this fraction of its light at zero charge
    lanternDimFrom: 0.6, // below this charge the light starts to fall (smoothstep to the floor at zero)
    lanternLow: 0.15, // 'low battery' warning level
    fullHp: 0.995, // heals are refused above this hp (nothing to heal)
    pickupRadius: 0.9, // m from the body centre: walking / swinging through collects
    handRadius: 0.35, // m: a hand reaching a pickup collects it with the grip pressed
    handGrip: 0.5, // grip value that counts as pressed for a hand pickup
    supplyFraction: 1 / 3, // share of the authored supply spots that hold an item in a run
    supplySpacing: 4, // m: two spots of one section closer than this are not both chosen (when avoidable)
    maxFirstAid: 3, // per run
  },
};

export const DIFFICULTY = {
  normal: {
    key: 'normal',
    darkness: 0.3, // 0..1: how much darker the world is (render/renderer3d.js: ambient, fog, key, baked light, lamps; the lantern is untouched)
    label: 'Normal',
    blurb: 'The intended descent. Generous aim assist, recovery anchors, a patient predator.',
    levelVariant: 'normal',
    aimRange: 32,
    aimConeDeg: 12,
    rayAssist: 2.4, // metres from the aim ray that still count as "aimed at"
    lethalImpact: 17,
    impactsLethal: true,
    fragileTime: 1.5,
    crumbleTime: 0.9,
    checkpoints: 'all',
    recordTimes: true,
    creature: { enabled: true, speed: 1.0, aggression: 1.0, staminaDrain: 1.0, staminaRegen: 1.0, killRadius: 2.6 },
    health: { fallThreshold: 0.35, regenDelay: 6, regenRate: 0.05, hazardDamage: 0.6, wallScale: 1 },
    climb: { drainMul: 1 },
  },
  nightmare: {
    key: 'nightmare',
    darkness: 0.72,
    label: 'Nightmare',
    blurb: 'Faster hunters (the small ones far faster, and one more that climbs up from below), a much darker shaft, tighter aim, fewer recovery anchors, nastier geometry.',
    levelVariant: 'nightmare',
    aimRange: 29,
    aimConeDeg: 8,
    rayAssist: 1.8,
    lethalImpact: 15.5,
    impactsLethal: true,
    fragileTime: 1.05,
    crumbleTime: 0.65,
    checkpoints: 'alternate',
    recordTimes: true,
    creature: { enabled: true, speed: 1.18, aggression: 1.3, staminaDrain: 0.9, staminaRegen: 1.25, killRadius: 2.9 },
    health: { fallThreshold: 0.33, regenDelay: 9, regenRate: 0.03, hazardDamage: 0.75, wallScale: 1.1 },
    climb: { drainMul: 1.1 },
  },
  abyss: {
    key: 'abyss',
    darkness: 0.85,
    label: 'Abyss',
    blurb: 'For speedrunners. Minimal assist, almost no recovery, no checkpoints.',
    levelVariant: 'abyss',
    aimRange: 27,
    aimConeDeg: 6,
    rayAssist: 1.3,
    lethalImpact: 14.5,
    impactsLethal: true,
    fragileTime: 0.8,
    crumbleTime: 0.5,
    checkpoints: 'none',
    recordTimes: true,
    creature: { enabled: true, speed: 1.34, aggression: 1.6, staminaDrain: 0.8, staminaRegen: 1.5, killRadius: 3.1 },
    health: { fallThreshold: 0.3, regenDelay: 12, regenRate: 0.02, hazardDamage: 1, wallScale: 1.25 },
    climb: { drainMul: 1.25 },
  },
  sandbox: {
    key: 'sandbox',
    darkness: 0,
    label: 'Sandbox',
    blurb: 'No predator, no lethal falls. Practise the tethers at your own pace.',
    levelVariant: 'normal',
    aimRange: 32,
    aimConeDeg: 12,
    rayAssist: 2.4,
    lethalImpact: 17,
    impactsLethal: false,
    fragileTime: 1.5,
    crumbleTime: 0.9,
    checkpoints: 'all',
    recordTimes: false,
    creature: { enabled: false, speed: 0, aggression: 0, staminaDrain: 1, staminaRegen: 1, killRadius: 0 },
    health: { fallThreshold: 0.35, regenDelay: 6, regenRate: 0.05, hazardDamage: 1, wallScale: 1 },
    climb: { drainMul: 0.5 },
  },
};
for (const key of Object.keys(DIFFICULTY)) DIFFICULTY[key].aimCone = DIFFICULTY[key].aimConeDeg * DEG;
export const DIFFICULTY_ORDER = ['normal', 'nightmare', 'abyss'];

export const SETTINGS_DEFAULTS = {
  volume: 0.8,
  aimAssist: 1.0, // 0.6..1.4 scales cone + ray assist
  turnSpeed: 1.0, // smooth-turn rate multiplier (0.5..2)
  mouseSensitivity: 1.0, // desktop look (0.3..3)
  dominantHand: 'right',
  haptics: true,
  showBody: true, // draw the player's own body (jacket, belt, legs, boots, backpack) when looking down
  lastDifficulty: 'normal',
  // Player height (CONTRACT3D §8 "Rig and eye height"). Old saved settings lack these keys and migrate to the defaults.
  heightMode: 'standing', // 'standing' = real height 1:1; 'seated' = eyes lifted by heightCal to a standing eye height
  heightCal: 0, // metres added in Seated mode, set by the calibration press (standEye − measured eye height)
  heightOffset: 0, // fine trim, ±VIEW.offsetMax in VIEW.offsetStep steps (VR and desktop)
  heightMeasured: 0, // eye height above the real floor at the last calibration press (0 = never), shown in the panel
  // ---- WP-UX (ui/uxLogic.js documents every key; ranges in UX_LIMITS, validation in sanitizeUxSettings) ----
  musicVolume: 0.8, // 0..1, times the master volume (audio/music3d.js reads it)
  sfxVolume: 1.0, // 0..1, times the master volume (every non-music sound)
  hapticStrength: 1.0, // 0.25..1.5 multiplier on every controller pulse (input haptic())
  captions: false, // subtitle-style captions for the sounds that warn you (ui/captions.js)
  colorSafe: false, // shape + word cues next to colour for health, grip, bag and warnings
  textScale: 1.0, // 0.9..1.5: VR panels, notes and captions get physically larger; the desktop UI font grows
  vignette: 0, // 0..1 comfort vignette strength while moving fast, swinging or turning (0 = off, the default)
  turnMode: 'smooth', // 'smooth' | 'snap'
  snapAngle: 45, // degrees per snap step: 30 | 45 | 60 | 90
  qualityTier: 'auto', // 'auto' | 'low' | 'quest' | 'high' (render tier pin; auto = the governor and the device decide)
  renderScale: 1.0, // 0.7..1.3: multiplier on the tier's XR framebuffer scale, read when a VR session starts
  brightness: 1.0, // 0.6..1.6 exposure multiplier (calibration screen)
  blackLevel: 0, // 0..1 lifts the darkest pixels by up to 6/255 (calibration screen)
  brightnessChecked: false, // the calibration screen has been seen (the menu stops suggesting it)
  reducedEffects: false, // fog cards, dust, debris and the wet film thinned; the frame-rate governor never goes below its level 3 (platform/governor.js)
  tutorialHints: true, // the short first-run hints (grip, reel, bag) that fade once learned (ui/tutorial.js)
  // WP-GFX-PARITY: the headset frame rate. '72' (default) | '90' | 'auto' (90 Hz when the session supports it, back to 72 on the first
  // sustained overrun). platform/governor.js reads it at session start and on settings:changed (setFrameRate); UX row hook = `frameRate`.
  frameRate: '72',
  // ---- WP-TOUCH (input/touchLogic.js + input/touchInput.js): the phone / tablet touch layer ----
  touchControls: 'auto', // 'auto' (coarse pointer, or the first touch on a hybrid) | 'on' | 'off'
  touchLookSens: 1.0, // 0.3..3 drag-to-look and gyro sensitivity
  touchInvertY: false, // invert the vertical look
  touchGyro: false, // gyroscope look (asks for motion permission on iOS)
  touchScale: 1.0, // 0.9..1.5 size of the on-screen buttons (the base size is >= 56 px)
  touchMirror: false, // mirror the layout: stick on the right, buttons on the left
  touchLauncher: 'two', // 'two' = one fire button per hand | 'toggle' = one fire button + an L/R chip
  touchRopeMode: 'hold', // 'hold' = rope attached while the button is held | 'latch' = tap to attach, tap again to let go
};

/** Limits and allowed values of the WP-UX settings (the single source for the UI, sanitizeUxSettings and the tests). */
export const UX_LIMITS = {
  volume: [0, 1],
  musicVolume: [0, 1],
  sfxVolume: [0, 1],
  hapticStrength: [0.25, 1.5],
  textScale: [0.9, 1.5],
  vignette: [0, 1],
  renderScale: [0.7, 1.3],
  brightness: [0.6, 1.6],
  blackLevel: [0, 1],
  snapAngles: [30, 45, 60, 90],
  turnModes: ['smooth', 'snap'],
  qualityTiers: ['auto', 'low', 'quest', 'high'],
  frameRates: ['72', '90', 'auto'],
  touchControls: ['auto', 'on', 'off'],
  touchLookSens: [0.3, 3],
  touchScale: [0.9, 1.5],
  touchLaunchers: ['two', 'toggle'],
  touchRopeModes: ['hold', 'latch'],
};

/** Clamps / snaps the WP-TOUCH keys of a settings object in place. Returns the object. */
export function sanitizeTouchSettings(s) {
  const D = SETTINGS_DEFAULTS;
  const L = UX_LIMITS;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  s.touchLookSens = Math.min(L.touchLookSens[1], Math.max(L.touchLookSens[0], num(s.touchLookSens, D.touchLookSens)));
  s.touchScale = Math.min(L.touchScale[1], Math.max(L.touchScale[0], num(s.touchScale, D.touchScale)));
  if (L.touchControls.indexOf(s.touchControls) < 0) s.touchControls = D.touchControls;
  if (L.touchLaunchers.indexOf(s.touchLauncher) < 0) s.touchLauncher = D.touchLauncher;
  if (L.touchRopeModes.indexOf(s.touchRopeMode) < 0) s.touchRopeMode = D.touchRopeMode;
  s.touchInvertY = s.touchInvertY === true;
  s.touchGyro = s.touchGyro === true;
  s.touchMirror = s.touchMirror === true;
  return s;
}

/** Clamps / snaps the WP-UX keys of a settings object in place (after load, restore or apply). Returns the object. */
export function sanitizeUxSettings(s) {
  const D = SETTINGS_DEFAULTS;
  const L = UX_LIMITS;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  for (const k of ['volume', 'musicVolume', 'sfxVolume', 'hapticStrength', 'textScale', 'vignette', 'renderScale', 'brightness', 'blackLevel']) {
    const [lo, hi] = L[k];
    s[k] = Math.min(hi, Math.max(lo, num(s[k], D[k])));
  }
  if (L.turnModes.indexOf(s.turnMode) < 0) s.turnMode = D.turnMode;
  if (L.qualityTiers.indexOf(s.qualityTier) < 0) s.qualityTier = D.qualityTier;
  const a = num(s.snapAngle, D.snapAngle);
  let best = L.snapAngles[0];
  for (const c of L.snapAngles) if (Math.abs(c - a) < Math.abs(best - a)) best = c;
  s.snapAngle = best;
  s.captions = s.captions === true;
  s.colorSafe = s.colorSafe === true;
  s.brightnessChecked = s.brightnessChecked === true;
  s.tutorialHints = s.tutorialHints !== false;
  s.reducedEffects = s.reducedEffects === true;
  s.frameRate = s.frameRate === 'auto' ? 'auto' : String(s.frameRate) === '90' ? '90' : '72';
  sanitizeTouchSettings(s);
  return s;
}

/**
 * Player height tuning. The collision sphere (CONFIG.player.radius) rests on the floor, so the ground under the
 * player's feet is `body.y − radius` and a standing person's eyes are `eye − radius` above the sphere centre.
 * XR (local-floor) maps the real floor onto that ground: rig.y = body.y − radius + lift, real eye height = game eye height.
 */
export const VIEW = {
  standEye: 1.62, // eye height above the feet (m): the desktop camera, the Seated reference, the 'local' space assumption
  offsetMax: 0.3, // fine trim limit (m)
  offsetStep: 0.025,
  calMin: -0.5, // limits of the Seated calibration offset (m)
  calMax: 1.2,
  calCountdown: 3, // seconds between the Calibrate press and the measurement
  measureMin: 0.6, // plausible eye heights (m above the real floor) for a calibration
  measureMax: 2.3,
};

/** Eye height above the collision-sphere centre for a person standing 1:1 (1.62 − 0.38 = 1.24 m). */
export function eyeAboveBody() {
  return VIEW.standEye - CONFIG.player.radius;
}

/**
 * The settings a calibration press stores for a measured eye height (m above the real floor), or null when the
 * reading is implausible. Standing records the measurement only (the rig is 1:1); Seated also stores the offset that
 * lifts the eyes to VIEW.standEye.
 */
export function heightCalibration(mode, eye) {
  if (typeof eye !== 'number' || !(eye >= VIEW.measureMin && eye <= VIEW.measureMax)) return null;
  const out = { heightMeasured: +eye.toFixed(3) };
  if (mode === 'seated') out.heightCal = +Math.min(VIEW.calMax, Math.max(VIEW.calMin, VIEW.standEye - eye)).toFixed(3);
  return out;
}

/** Clamps / snaps the player-height keys of a settings object in place (validation after load or apply). */
export function sanitizeHeightSettings(s) {
  const D = SETTINGS_DEFAULTS;
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  if (s.heightMode !== 'standing' && s.heightMode !== 'seated') s.heightMode = D.heightMode;
  s.heightCal = Math.min(VIEW.calMax, Math.max(VIEW.calMin, num(s.heightCal, D.heightCal)));
  const o = Math.round(num(s.heightOffset, D.heightOffset) / VIEW.offsetStep) * VIEW.offsetStep;
  s.heightOffset = Math.min(VIEW.offsetMax, Math.max(-VIEW.offsetMax, +o.toFixed(4)));
  const m = num(s.heightMeasured, D.heightMeasured);
  s.heightMeasured = m >= VIEW.measureMin && m <= VIEW.measureMax ? m : 0;
  return s;
}

// -----------------------------------------------------------------------------
// Maths helpers (plain {x,y,z} objects; no allocation in hot paths when `out` is passed)
// -----------------------------------------------------------------------------
export const U = {
  DEG,
  clamp: (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v),
  lerp: (a, b, t) => a + (b - a) * t,
  damp: (cur, target, rate, dt) => target + (cur - target) * Math.exp(-rate * dt),
  approach(cur, target, maxDelta) {
    return cur < target ? Math.min(cur + maxDelta, target) : Math.max(cur - maxDelta, target);
  },
  smoothstep(a, b, v) {
    const t = U.clamp((v - a) / (b - a || 1), 0, 1);
    return t * t * (3 - 2 * t);
  },
  len: (x, y, z) => Math.hypot(x, y, z),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  /** Unsigned angle between two vectors (radians). */
  angle(ax, ay, az, bx, by, bz) {
    const la = Math.hypot(ax, ay, az);
    const lb = Math.hypot(bx, by, bz);
    if (la < 1e-9 || lb < 1e-9) return Math.PI;
    return Math.acos(U.clamp((ax * bx + ay * by + az * bz) / (la * lb), -1, 1));
  },
  /** Box (min/max) overlap with a sphere. */
  sphereBox(cx, cy, cz, r, b) {
    const qx = U.clamp(cx, b.minX, b.maxX);
    const qy = U.clamp(cy, b.minY, b.maxY);
    const qz = U.clamp(cz, b.minZ, b.maxZ);
    const dx = cx - qx;
    const dy = cy - qy;
    const dz = cz - qz;
    return dx * dx + dy * dy + dz * dz < r * r;
  },
  /**
   * Slab test: segment p0→p1 against a box shrunk by `inset`.
   * Returns the entry parameter t in [0,1] or -1.
   */
  segmentBox(x0, y0, z0, x1, y1, z1, b, inset) {
    const pad = inset || 0;
    let t0 = 0;
    let t1 = 1;
    const o = [x0, y0, z0];
    const d = [x1 - x0, y1 - y0, z1 - z0];
    const mn = [b.minX + pad, b.minY + pad, b.minZ + pad];
    const mx = [b.maxX - pad, b.maxY - pad, b.maxZ - pad];
    for (let i = 0; i < 3; i++) {
      if (mx[i] <= mn[i]) return -1;
      if (Math.abs(d[i]) < 1e-12) {
        if (o[i] < mn[i] || o[i] > mx[i]) return -1;
      } else {
        let ta = (mn[i] - o[i]) / d[i];
        let tb = (mx[i] - o[i]) / d[i];
        if (ta > tb) {
          const tmp = ta;
          ta = tb;
          tb = tmp;
        }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) return -1;
      }
    }
    return t0;
  },
  rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  formatTime(seconds) {
    if (seconds == null || !isFinite(seconds)) return '--:--.--';
    const s = Math.max(0, seconds);
    const m = Math.floor(s / 60);
    const sec = s - m * 60;
    return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(2)}`;
  },
  /** Depth in metres below the spawn height (y = 0). */
  depthMeters: (y) => Math.max(0, Math.round(-y)),
};

// -----------------------------------------------------------------------------
// Event bus
// -----------------------------------------------------------------------------
export class EventBus {
  constructor() {
    this._h = Object.create(null);
  }
  on(type, fn) {
    (this._h[type] || (this._h[type] = [])).push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const list = this._h[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  emit(type, payload) {
    const list = this._h[type];
    if (!list || !list.length) return;
    for (const fn of list.slice()) {
      try {
        fn(payload || {}, type);
      } catch (err) {
        if (typeof console !== 'undefined') console.error(`[AT3D] listener for "${type}" failed`, err);
      }
    }
  }
  clear() {
    this._h = Object.create(null);
  }
}

// -----------------------------------------------------------------------------
// Persistence (defensive; storage may be unavailable)
// -----------------------------------------------------------------------------
const PREFIX = 'abyssalTether3d.v1.';
function ls() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
export const Storage = {
  get(key, fallback) {
    const s = ls();
    if (!s) return fallback;
    try {
      const raw = s.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    const s = ls();
    if (!s) return false;
    try {
      s.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  loadSettings() {
    const saved = Storage.get('settings', null);
    const out = Object.assign({}, SETTINGS_DEFAULTS);
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(SETTINGS_DEFAULTS)) {
        if (k in saved && typeof saved[k] === typeof SETTINGS_DEFAULTS[k]) out[k] = saved[k];
      }
    }
    if (!DIFFICULTY[out.lastDifficulty]) out.lastDifficulty = 'normal';
    sanitizeHeightSettings(out);
    sanitizeUxSettings(out);
    return out;
  },
  saveSettings: (s) => Storage.set('settings', s),
  getBest(diffKey) {
    const v = Storage.get(`best.${diffKey}`, null);
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : null;
  },
  submitTime(diffKey, seconds) {
    const previous = Storage.getBest(diffKey);
    const isNew = previous == null || seconds < previous;
    if (isNew) Storage.set(`best.${diffKey}`, seconds);
    return { best: isNew ? seconds : previous, previous, isNew };
  },
  recordDepth(diffKey, meters) {
    const cur = Storage.get(`deepest.${diffKey}`, 0);
    if (meters > cur) Storage.set(`deepest.${diffKey}`, meters);
    return Math.max(cur, meters);
  },
};
