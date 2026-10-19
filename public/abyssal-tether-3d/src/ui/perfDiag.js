/* ABYSSAL TETHER 3D — perfDiag.js
 * Desktop performance safety net (inactive inside a WebXR session, where the
 * headset drives its own frame loop and resolution):
 *  - detects software rendering / an integrated GPU and tells the player how
 *    to get the browser onto their real graphics card;
 *  - adaptive resolution: lowers the render pixel ratio while the frame rate
 *    is low and raises it again when there is headroom;
 *  - an optional overlay (add ?perf to the URL, or press F3): fps, frame
 *    time, draw calls, triangles, render resolution and the GPU in use.
 */

const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const INTEGRATED_GPU = /intel|\buhd\b|\biris\b|radeon\(tm\) (graphics|vega)|\bvega \d+ graphics/i;

const WINDOW_SEC = 1; // fps sampling window
const LOW_FPS = 45; // below this, lower the resolution
const HIGH_FPS = 57; // above this for a few windows, raise it again
const MIN_RATIO = 0.5;
const STEP_DOWN = 0.8;
const STEP_UP = 1.15;
const SLOW_HINT_FPS = 30; // sustained fps below this (at minimum resolution) shows the GPU tip

/** Reads the unmasked GPU name, or the generic renderer string. */
function gpuName(gl) {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return String(name || 'unknown');
  } catch {
    return 'unknown';
  }
}

function el(tag, css, text) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text) e.textContent = text;
  return e;
}

const FIX_STEPS = [
  'Chrome / Edge: Settings → System → turn on “Use graphics acceleration when available”, then restart the browser.',
  'Laptops with NVIDIA or AMD graphics: Windows Settings → System → Display → Graphics → choose your browser → “High performance”, then restart it.',
  'To check: open chrome://gpu — WebGL should say “Hardware accelerated” and the renderer should name your graphics card.',
];

/** A dismissible banner explaining how to get onto the real GPU. */
function showGpuBanner(title, gpu) {
  if (document.getElementById('at3d-gpu-banner')) return;
  const box = el(
    'div',
    'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483000;max-width:min(680px,calc(100vw - 32px));' +
      'background:rgba(14,16,18,0.96);border:1px solid #e0a050;border-radius:6px;padding:14px 18px 12px;color:#e8dcc0;' +
      'font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,0.6);',
  );
  box.id = 'at3d-gpu-banner';
  box.setAttribute('role', 'alert');
  box.appendChild(el('div', 'font-weight:600;color:#e0a050;margin-bottom:6px;', title));
  box.appendChild(el('div', 'opacity:0.75;margin-bottom:8px;', `Graphics in use: ${gpu}`));
  const ul = el('ul', 'margin:0 0 10px;padding-left:18px;');
  for (const s of FIX_STEPS) ul.appendChild(el('li', 'margin:2px 0;', s));
  box.appendChild(ul);
  const btn = el('button', 'min-height:36px;padding:6px 16px;border:1px solid #e0a050;background:transparent;color:#e8dcc0;font:inherit;cursor:pointer;border-radius:4px;', 'Got it');
  btn.type = 'button';
  btn.addEventListener('click', () => box.remove());
  box.appendChild(btn);
  document.body.appendChild(box);
}

/**
 * Installs the diagnostics on a booted Game3D. Safe to call once; never throws.
 * @param {object} game Game3D (game.renderer.renderer is the THREE.WebGLRenderer)
 */
export function installPerfDiag(game) {
  try {
    const r3d = game && game.renderer;
    const renderer = r3d && r3d.renderer;
    if (!renderer || typeof renderer.getContext !== 'function') return null;
    const gl = renderer.getContext();
    const gpu = gpuName(gl);
    const maxRatio = () => Math.min(window.devicePixelRatio || 1, 2);
    const state = { gpu, fps: 0, frameMs: 0, worstMs: 0, ratio: renderer.getPixelRatio(), software: SOFTWARE_GPU.test(gpu), integrated: INTEGRATED_GPU.test(gpu) };
    game.perfDiag = state;

    if (state.software) {
      showGpuBanner('Your browser is drawing 3D without your graphics card, so the game will run very slowly.', gpu);
    }

    // ---- overlay ---------------------------------------------------------------
    const params = new URLSearchParams(window.location.search);
    let overlay = null;
    const toggleOverlay = (on) => {
      if (on && !overlay) {
        overlay = el(
          'div',
          'position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:2147482000;pointer-events:none;' +
            'background:rgba(0,0,0,0.7);color:#cfe;padding:4px 10px;border-radius:4px;font:12px/1.4 ui-monospace,Consolas,monospace;white-space:pre;',
        );
        document.body.appendChild(overlay);
      } else if (!on && overlay) {
        overlay.remove();
        overlay = null;
      }
    };
    toggleOverlay(params.has('perf'));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        toggleOverlay(!overlay);
      }
    });

    // ---- sampling + adaptive resolution ----------------------------------------
    let last = performance.now();
    let winStart = last;
    let frames = 0;
    let worst = 0;
    let goodWindows = 0;
    let slowWindows = 0;
    let hinted = state.software;
    let overlayT = 0;
    let target = renderer.getPixelRatio();

    const tick = (now) => {
      const dt = now - last;
      last = now;
      frames++;
      if (dt > worst) worst = dt;
      const xr = renderer.xr && renderer.xr.isPresenting;
      if (now - winStart >= WINDOW_SEC * 1000) {
        const fps = (frames * 1000) / (now - winStart);
        state.fps = fps;
        state.frameMs = (now - winStart) / Math.max(frames, 1);
        state.worstMs = worst;
        frames = 0;
        winStart = now;
        const playing = game.state === 'playing' || game.state === 'menu';
        if (!xr && playing && !document.hidden) {
          // A window resize resets the ratio to the device's; keep the adaptive one.
          target = Math.min(target, maxRatio());
          if (fps < LOW_FPS && target > MIN_RATIO + 1e-3) {
            target = Math.max(MIN_RATIO, target * STEP_DOWN);
            goodWindows = 0;
          } else if (fps > HIGH_FPS) {
            goodWindows++;
            if (goodWindows >= 3 && target < maxRatio() - 1e-3) {
              target = Math.min(maxRatio(), target * STEP_UP);
              goodWindows = 0;
            }
          } else {
            goodWindows = 0;
          }
          if (Math.abs(renderer.getPixelRatio() - target) > 1e-3) renderer.setPixelRatio(target);
          state.ratio = target;
          // Still slow at minimum resolution: the browser is probably not using the real GPU.
          if (fps < SLOW_HINT_FPS && state.ratio <= MIN_RATIO + 1e-3) slowWindows++;
          else slowWindows = 0;
          if (!hinted && slowWindows >= 4) {
            hinted = true;
            showGpuBanner(
              state.integrated
                ? 'The game is running on your laptop’s built-in graphics and is too slow.'
                : 'The game is running very slowly in this browser.',
              gpu,
            );
          }
        }
        worst = 0;
      }
      if (overlay && now - overlayT > 250) {
        overlayT = now;
        const info = renderer.info && renderer.info.render ? renderer.info.render : { calls: 0, triangles: 0 };
        const c = renderer.domElement;
        overlay.textContent =
          `${state.fps.toFixed(0)} fps  ${state.frameMs.toFixed(1)} ms (worst ${state.worstMs.toFixed(0)})  |  ${info.calls} calls  ${(info.triangles / 1000).toFixed(0)}k tris  |  ` +
          `${c.width}×${c.height} @${renderer.getPixelRatio().toFixed(2)}${xr ? '  [XR]' : ''}\n${gpu}`;
      }
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
    return state;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[AT3D] perf diagnostics unavailable', err);
    return null;
  }
}
