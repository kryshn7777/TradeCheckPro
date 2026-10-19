# ABYSSAL TETHER

A browser-playable vertical traversal-horror prototype. Descend the Underspire — a colossal cathedral-machine
built downward into the earth — on a single grappling tether, while something that has grown into the
architecture hunts you from above.

Plain HTML5 + CSS + vanilla JavaScript, rendered on one Canvas 2D. No build step, no dependencies, no server.
Plays on desktop (mouse + keyboard, or gamepad) and on phones/tablets with dedicated touch controls.

## Launch

**Easiest:** double-click `index.html` (works from `file://` — the game uses classic scripts, not ES modules).

**Local static server** (recommended on some browsers for consistent audio/storage behaviour):

```bash
# from this folder
npx http-server . -p 8080      # or: python3 -m http.server 8080
# then open http://localhost:8080
```

**Inside the TradeCheckPro site:** the folder lives in `public/`, so `npm run dev` serves it at
`/abyssal-tether/index.html` and `npm run build` copies it to `dist/abyssal-tether/` (deployed with the site to
GitHub Pages — handy for playing on a phone).

**On a phone:** open the deployed URL (or your machine's LAN address while serving locally), rotate to landscape for
the best view (portrait works too), and tap **Descend**. Add it to your home screen for a full-screen experience.

## Controls

### Mouse + keyboard

| Action | Input |
|---|---|
| Aim the tether | Move the mouse (soft targeting picks the best-aligned marked anchor) |
| Fire / hold the tether | Hold **left click** |
| Let go | Release left click |
| Swing / air control | **A / D** |
| Reel in (shorten) · hop when standing | **W** |
| Reel out (lengthen) · brake | **S** |
| Keyboard-only aiming | **Arrow keys** aim, **Space** fires/holds the tether |
| Pause | **Esc** or **P** |
| Restart run (instant) | **R** |
| Continue after death | **Enter** / **Space** / click |

### Touch (phones & tablets)

| Action | Input |
|---|---|
| Swing / reel | **Left thumb**: drag anywhere in the lower-left area — a floating stick appears under your thumb. Left/right swings, up reels in, down reels out. Flick up while standing to hop. |
| Fire the tether | **Right hand**: touch and hold a marked anchor (or near it — targeting is forgiving). |
| Let go | Lift your finger. |
| Chain to the next anchor | While still holding, touch the next anchor with another finger. |
| Pause | The **II** button (top-right). |

Settings offer two alternative touch schemes:

* **Aim stick** — a floating right-hand stick: push to preview the target, push to the rim to fire, lift to let go
  (your thumb never covers the anchor).
* **Toggle grapple** — tap to attach, tap again to release (or tap another anchor to switch). Useful for one-handed
  play.

Haptic feedback (Android/Chrome) can be turned off in Settings.

### Gamepad

Left stick swing/reel · right stick aim · **RT/RB/X** tether · **A** hop · **Start** pause · **Back** restart.

## Modes

| Mode | What changes |
|---|---|
| **Normal** | The intended descent. Generous aim assist, recovery anchors, checkpoints every section. |
| **Nightmare** | Faster, more aggressive predator, tighter aim cone/range, fewer recovery anchors, more dangerous geometry, checkpoints every other section. |
| **Abyss** | For speedrunners. Minimal assist, almost no recovery, the most aggressive predator, no checkpoints. |
| **Sandbox** | No predator, falls are never lethal, warp to any section from the pause menu. Times are not recorded. |

Best times, deaths and deepest point per difficulty are stored in `localStorage`, together with settings.

## Accessibility

Keyboard-only play, gamepad support, adjustable stick/aim sensitivity and aim assist, reduced visual effects,
reduced screen shake, high-contrast shape-coded grapple indicators (ring = circle, hook = triangle, fragile =
cracked diamond — never colour alone), pause at any time (the game also pauses when the tab/app is hidden).

## Architecture

```
index.html, style.css     DOM shell: canvas + menus/HUD overlays, mobile viewport/safe-area handling
game.js                   Game: state machine, fixed-step loop, wiring, checkpoints, triggers, debug API
js/config.js              tuning constants, difficulty presets, math utils, EventBus, Storage (localStorage)
js/level-data.js          the descent as pure data (sections, solids, hazards, anchors, decor, triggers, hints)
js/level.js               Level: variant filtering, y-bucketed spatial queries, line of sight, checkpoints
js/physics.js             Player, GrappleSystem (soft targeting, attach/release), Physics (rope + collisions)
js/camera.js              Camera: follow with downward look-ahead, parallax transforms, shake
js/input.js               InputManager: mouse, keyboard, gamepad, multi-touch sticks → one intent per frame
js/particles.js           ParticleSystem: pooled dust/ash/debris/sparks
js/threat.js              ThreatSystem: continuous 0..1 danger feeding audio + visuals (never displayed)
js/creature.js            Creature: state machine, stamina waves, procedural limbs/body, rendering
js/audio.js               AudioManager: fully procedural Web Audio soundscape, spatialised creature
js/render.js              Renderer: layered parallax scene, fog, lantern lighting, rope, overlays
js/ui.js                  UI: menus, HUD, settings, death/victory screens
```

Modules communicate through a small event bus (`grapple:attach`, `player:land`, `creature:burst`, …), so the
simulation never depends on audio, particles or UI. The simulation files are DOM-free and run under Node for
tooling. Physics runs at a fixed 240 Hz with an accumulator, capped frame delta and velocity clamps.

A debug/test hook is exposed as `window.AT.debug` (state snapshot, teleport, scripted input, deterministic
stepping, warp).
