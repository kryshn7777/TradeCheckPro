# ABYSSAL TETHER 3D (Meta Quest 3, WebXR) — Architecture Contract v1

Owner: lead engineer. Implement exactly these public names/shapes. If you need a contract change,
implement the closest compliant version and list the request in your report.

## Product
Full-3D, first-person port of the finished 2D game (`public/abyssal-tether/`, read its README and
`js/creature.js`, `js/audio.js`, `js/level-data.js` for design intent, pacing numbers, lore, sounds).
Primary target: **Meta Quest 3 Browser, WebXR `immersive-vr`**, 72–90 Hz stereo. Secondary: desktop
browser (mouse + keyboard, pointer lock) for testing and non-VR play. User decisions:
- **Full 3D movement** (not 2.5D): a true 3D shaft; swing in any direction.
- **No comfort options**: smooth turning, no vignette/tunnelling, no snap — the swings and falls are the experience.
- **No Unity**: three.js r170 (vendored at `vendor/three/`), plain ES modules, no bundler, no CDN.
- Creature from Blender: `assets/models/mason_kit.glb` (modular parts) — see
  `tools/abyssal-tether-3d/README.md` for part names/pivots. Rock textures: Poly Haven is blocked from
  this container, so bake original tileable textures in Blender (assets agent); keep a Poly Haven fetch
  script ready for when the network allows it.
- Original IP (same rules as the 2D game): no names, designs, sounds, layouts copied from any game.

## Ground rules
- ES modules (`import`/`export`), served over HTTPS (GitHub Pages) — WebXR requires a secure context.
  `index.html` has an importmap: `"three": "./vendor/three/three.module.min.js"`,
  `"three/addons/": "./vendor/three/addons/"`. Only GLTFLoader + BufferGeometryUtils are vendored; write
  anything else yourself (no VRButton/XRControllerModelFactory — they fetch from CDNs).
- `src/sim/**` and `src/data/**` must not import three.js or touch the DOM (Node-testable:
  `node file.mjs` importing them by absolute path works today for config3d/physics3d).
- Lint: `cd /home/user/TradeCheckPro && npx eslint public/abyssal-tether-3d/` must pass (vendor ignored).
  Unused vars/args are errors except names matching `^[A-Z_]`; `catch {` when the error is unused;
  never name a function `use*`.
- Quest performance budget (whole frame, both eyes): ≤ 150 draw calls, ≤ 350k triangles visible,
  ≤ 1 shadow-casting light (prefer none), no post-processing passes, textures ≤ 2048 (prefer 1024),
  InstancedMesh for repeated geometry, no per-frame allocation in hot loops, no per-frame material
  creation. Use `renderer.setAnimationLoop` (required for XR). Foveation `renderer.xr.setFoveation(1)`.
- Units: metres, seconds. **+Y up**; spawn near y = 0; the descent goes to y ≈ −560. Depth shown to the
  player = −y metres (`U.depthMeters`).

## Files & owners
```
public/abyssal-tether-3d/
  index.html, style.css                         game agent
  vendor/three/…                                lead (done)
  assets/models/mason_kit.glb, mason_hero.glb    lead (done, Blender)
  assets/textures/*.jpg|png + manifest.json      assets agent
  src/main.js                                    game agent (bootstrap)
  src/game.js                                    game agent (Game3D)
  src/sim/config3d.js, src/sim/physics3d.js      lead (done — read them; do not edit)
  src/sim/level3d.js, src/data/level-data-3d.js  level agent
  src/sim/creature3d.js, src/sim/threat3d.js     creature agent
  src/render/creatureView.js                     creature agent
  src/render/renderer3d.js, levelView.js, ropeView.js, fx.js, materials.js   render agent
  src/render/handsView.js                        input agent (controllers, aim lasers, reticles)
  src/input/inputManager.js, xrInput.js, desktopInput.js                    input agent
  src/ui/ui3d.js                                 ui+audio agent (VR panels, wrist HUD, desktop DOM menus)
  src/audio/audio3d.js                           ui+audio agent
tools/abyssal-tether-3d/build_textures.py, fetch_polyhaven.py              assets agent
```

## 1. Sim core (done): `src/sim/config3d.js`, `src/sim/physics3d.js`
- `CONFIG`, `DIFFICULTY` (aimRange 32/29/27 m, aimCone 12/8/6°, rayAssist 2.4/1.8/1.3 m, lethalImpact
  17/15.5/14.5 m/s ≈ free fall 10.7/8.9/7.8 m, creature presets with killRadius in metres),
  `SETTINGS_DEFAULTS`, `U` (maths incl. `segmentBox`, `sphereBox`, `formatTime`, `depthMeters`, `rng`),
  `EventBus`, `Storage`.
- `Player3D` {x,y,z, vx,vy,vz, prevX/Y/Z, rx/ry/rz (render interp, set by Game), radius 0.38, grounded,
  alive, stagger, fallPeak, tension, deathCause, speed, tethered}.
- `Rope3D` per hand {hand, anchor, length, tension}. `TetherSystem(level, diff, bus, settings)`:
  `hands.left|right = {hand, rope, target, held, buffer, extend, attachTime, miss}`, `attached`,
  `anchorOf(hand)`, `findTarget(player, aimRay, hand)`, `updateTargets(player, intent)`,
  `handleInput(player, intent, dt)`, `attach/release/releaseAll`, `anchorStress(hand)`, `maxRopeLength()`.
- `Physics3D(level, diff, bus)`: `step(player, tethers, intent, dt)`, `kill(player, tethers, cause)`.
- Boxes everywhere are `{minX,minY,minZ,maxX,maxY,maxZ}`.

## 2. Intent (built by InputManager each frame; consumed by TetherSystem/Physics3D/Game)
```js
intent = {
  move: { x, z },          // world-space horizontal intent, |move| ≤ 1, already rotated by HEAD yaw
  reel: -1..1,             // + = reel in (all tethered hands)
  jumpPressed, brake,      // edges / level
  turnRate: rad/s,         // smooth turn to apply to the rig yaw this frame (0 on desktop: mouse turns)
  hands: {
    left:  { aim: {ox,oy,oz,dx,dy,dz} | null /* world-space ray, unit dir */, pressed, held, released, yank /*0..1 grip*/ },
    right: { … },
  },
  pausePressed, restartPressed, confirmPressed, backPressed,   // edges
  ui: { ray: {ox,oy,oz,dx,dy,dz} | null, click: bool },        // for VR panels / desktop uses DOM
}
```
Quest mapping: **trigger = that hand's tether** (hold to stay attached, release to let go); **grip on a
tethered hand = yank** that rope; **left stick = move / swing / air control** (relative to head yaw);
**right stick X = smooth turn** (no snap), **right stick Y = reel** (up = in); **A = jump**,
**B / menu (≡) = pause**; hold X (1 s) = restart while paused/dead. Haptics on attach, rope tension, landing, death,
creature lunge. Desktop: pointer-lock mouse look; **LMB = right tether, RMB = left tether** (both aim
along the view centre); WASD move; **Space = jump / reel in when tethered**; Shift = reel out; C = brake;
F = yank both; Esc = pause; R = restart; Enter = confirm.

## 3. Level (`src/sim/level3d.js`, `src/data/level-data-3d.js`)
```
new Level3D(data = LEVEL_DATA_3D, variant = 'normal')
bounds {minX,maxX,minY,maxY,minZ,maxZ}; spawn {x,y,z,yaw}; goal (box); gate (box);
sections[] {index,id,name,subtitle,yTop,yBottom,checkpoint{x,y,z,yaw},theme{fog,light,accent,fogNear,fogFar,ambient},
            creature{mode,lethal,speedMul,burstRate,spawnOffsetY},hints[{y,text,desktop?}],triggers[{y,name,data}]}
solids[] {id, box…, kind:'wall'|'stone'|'metal'|'bridge'|'crumble'|'grate'|'pillar', section, active, load, life, fallen, tag}
hazards[] {id, box…, kind:'rebar'|'spikes'|'blades', active}
anchors[] {id, x,y,z, kind:'ring'|'hook'|'fragile', normal{x,y,z} (mount surface normal), section, tag, broken, load, life}
decor[] {id, type, x,y,z, sx,sy,sz, yaw, section, …}   // renderer draws known types, skips unknown
lights[] {x,y,z,color,intensity,range,flicker?}         // sparse environmental light (renderer may bake/limit)
querySolids(minX,minY,minZ,maxX,maxY,maxZ,out) → out   // y-bucketed, allocation-free, includes inactive
queryHazards(…same…) → out
anchorsNear(x,y,z,r,out) → out                          // superset OK
segmentBlocked(x0,y0,z0,x1,y1,z1,endClearance) → bool   // ACTIVE solids only, inset 0.05, ignore the last endClearance m
raycast(ox,oy,oz,dx,dy,dz,maxDist) → {t,solid} | null   // for laser visuals
sectionIndexAt(y), sectionAt(y), checkpointFor(i, mode 'all'|'alternate'|'none'), inGoal(x,y,z), reset()
```
Variant filtering via `omitIn`/`onlyIn` like the 2D data. Authoring may use centre+size; Level converts.

## 4. Creature (`src/sim/creature3d.js`, `src/sim/threat3d.js`, `src/render/creatureView.js`)
Port the 2D creature's behaviour model (states DORMANT/DISTANT/OBSERVING/APPROACHING/PURSUING/BURST/ATTACK/
RECOVERING, stamina waves, menace-distance stalking, telegraphed lunges with near misses, listen/creep on a
silent player, section modes dormant/sighting/stalk/hunt/frenzy/escape, respawn grace, gate slam on victory,
sandbox inert) to 3D: it crawls along the shaft WALLS (surface-following), head chasing the player.
```
new Creature3D(level, diff, bus, {seed}?)
reset(player), setSection(i, section, player), onRespawn(player), onVictory(gate), update(dt, player, time)
state, stamina, x,y,z, vx,vy,vz, distance, active, lethal, caughtPlayer, sighting, nearMiss, listening,
audio {x,y,z,distance,intensity,movement,state},
body { spine: Float32Array (SEG*3, head→tail world positions), up: Float32Array (SEG*3 surface normals),
       limbs: [{hip:{x,y,z}, foot:{x,y,z}, planted:bool}], frondOpen 0..1, glow 0..1, lunge 0..1 }
ThreatSystem3D: update(dt,{player,creature,tethers,diff}) → value, raw, heartRate, beat, beatPulse
CreatureView(scene, kitGltf): update(creature, dt) — assembles kit parts (instanced or cloned) on body.spine,
  2-bone IK legs (LimbUpper/LimbLower/Hook) to body.limbs, fronds sway/open with frondOpen, pit glow with glow.
```
Kill radius in metres (diff.creature.killRadius). Tune for HUMAN pacing in VR (people look around, hesitate):
careful play survives Normal; stalling ~15 s in a lethal section gets you caught (Normal), ~10 s Nightmare, ~6 s Abyss.

## 5. Renderer (`src/render/*`)
```
new Renderer3D(container, settings)  → .renderer (WebGLRenderer, xr.enabled, sRGB, ACES or AgX tone mapping),
   .scene, .camera (PerspectiveCamera 70°, near 0.05, far 400), .rig (Group: camera child; Game moves the rig)
buildLevel(level, textures)   // LevelView: InstancedMesh per kind, world-scale UVs (tile ~4 m), anchors
update(dt, game)              // fog/theme per section, lantern, env lights, rope, fx, anchor highlights per hand
render()                      // renderer.render(scene, camera)
resize()
```
Lantern = one PointLight carried by the player (left hand in XR, camera on desktop), warm, flickering.
Fog swallows distance (scale!). Far "colossal" structures beyond the shaft walls through openings.
Anchors must read in darkness: emissive phosphor markers, SHAPE-coded (ring / hook / fragile cracked diamond);
each hand's current target highlighted with its own marker (left = cool, right = warm + shape difference).
Ropes: per hand, from the controller to the anchor; sag when slack, taut glow with tension; miss whip.

## 6. Input & hands (`src/input/*`, `src/render/handsView.js`)
```
new InputManager({ renderer, camera, rig, canvas, settings, bus })
update(dt) → intent (above);  endFrame();  mode 'xr'|'desktop';  xrActive;
haptic(hand, intensity 0..1, ms);  enterVR() / exitVR();  isVRSupported() → Promise<bool>
handPose(hand) → {x,y,z, qx,qy,qz,qw} world (XR grip or desktop virtual hands)
```
XR session: `navigator.xr.requestSession('immersive-vr', {optionalFeatures:['local-floor','bounded-floor']})` (no 'hand-tracking': the game needs controllers),
`renderer.xr.setReferenceSpaceType('local-floor')`, `renderer.xr.setSession(session)`. Controllers via
`renderer.xr.getController(i)` / `getControllerGrip(i)` + `inputSource.handedness` + `gamepad` (xr-standard
mapping: buttons[0] trigger, [1] grip, [4] A/X, [5] B/Y; axes[2],[3] thumbstick). HandsView draws simple
original controller/gauntlet meshes, an aim laser (short, fading) per hand to its target or the wall hit,
and a reticle. Desktop: virtual hands near the camera bottom-left/right so ropes have an origin.

## 7. UI & audio (`src/ui/ui3d.js`, `src/audio/audio3d.js`)
```
new UI3D(game) — init(); show(name|null, info); update(dt); handles: desktop DOM overlay (title, start,
  difficulty, sandbox, controls, settings, pause, death, victory, 'Enter VR' button when supported) and
  in-VR panels (CanvasTexture planes in front of the player, pointer via intent.ui.ray + click), wrist HUD
  on the left controller (time, depth, section), hints/section titles as floating text.
new AudioManager3D(bus, settings) — unlock(), setVolume(v), setPaused(b), update(dt, game), stopAll()
  Port the 2D AudioManager's procedural synthesis (copy & adapt from public/abyssal-tether/js/audio.js) to an
  ES module; spatialise the creature (and anchors' clanks, debris) with HRTF PannerNode in world space;
  AudioListener follows the camera's world pose each frame.
```

## 8. Game (`src/game.js`, `src/main.js`, `index.html`, `style.css`)
```
new Game3D(); boot(); start(diffKey); restart(); respawn(); pause(); resume(); quitToMenu();
applySettings(partial); enterVR(); fields: state 'menu'|'playing'|'paused'|'dead'|'victory', difficultyKey,
diff, settings, bus, level, player, tethers, physics, creature, threat, renderer, input, ui, audio,
time, deaths, sectionIndex, deepest, flash, fade
loop via renderer.setAnimationLoop(fn): dt cap; input.update; tethers.updateTargets/handleInput; fixed-step
physics (CONFIG.PHYSICS_DT); creature (caughtPlayer → kill 'creature'); threat; sections/checkpoints/hints/
triggers; goal → victory (gate slam); rig follows player (XR: rig = player − (0, 1.1, 0) so a standing user's
head sits at the body; desktop: camera at body + eyeHeight); renderer.update + render; ui.update; audio.update.
Debug: window.AT3D = { game, debug: { state(), teleport(x,y,z), setInput(partial|null), step(sec), attach(hand,id),
godMode(b), warp(i), freeze(b) } }.
```
Records/settings via `Storage` (separate prefix from 2D). Death in VR: fade to near-black around the head
(a black sphere with opacity) + muffled audio; respawn on trigger/A.
