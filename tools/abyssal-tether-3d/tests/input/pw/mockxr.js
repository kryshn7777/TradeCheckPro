// Mock WebXR Device API (enough for three.js r170's WebXRManager): navigator.xr, XRSession,
// XRWebGLLayer (default framebuffer), viewer/input poses, gamepads with haptic actuators.
(() => {
  const S = (window.__xr = { requests: [], session: null, pulses: [], sources: {}, head: { p: [0, 1.6, 0], q: [0, 0, 0, 1] } });
  function compose(p, q) {
    const [x, y, z, w] = q; const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return new Float32Array([1 - (yy + zz), xy + wz, xz - wy, 0, xy - wz, 1 - (xx + zz), yz + wx, 0, xz + wy, yz - wx, 1 - (xx + yy), 0, p[0], p[1], p[2], 1]);
  }
  function persp(fovDeg, aspect, near, far) {
    const f = 1 / Math.tan((fovDeg * Math.PI) / 360); const nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function rotY(v, q) { // rotate vector by quaternion
    const [x, y, z, w] = q; const [vx, vy, vz] = v;
    const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz;
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  }
  class MockSpace { constructor(name) { this.name = name; this.p = [0, 1.2, -0.3]; this.q = [0, 0, 0, 1]; this.tracked = true; } }
  class MockRefSpace extends EventTarget { constructor(type) { super(); this.type = type; } getOffsetReferenceSpace() { return this; } }
  class MockFrame {
    constructor(session) { this.session = session; }
    getViewerPose() {
      const h = S.head; const proj = persp(96, 1, 0.05, 400);
      const views = ['left', 'right'].map((eye) => { const off = rotY([eye === 'left' ? -0.032 : 0.032, 0, 0], h.q); const p = [h.p[0] + off[0], h.p[1] + off[1], h.p[2] + off[2]];
        return { eye, transform: { matrix: compose(p, h.q), position: { x: p[0], y: p[1], z: p[2] } }, projectionMatrix: proj, recommendedViewportScale: null }; });
      return { transform: { matrix: compose(h.p, h.q) }, views, emulatedPosition: false };
    }
    getPose(space) { if (!space || !space.tracked) return null; return { transform: { matrix: compose(space.p, space.q) }, emulatedPosition: false }; }
    getJointPose() { return null; }
  }
  class MockSession extends EventTarget {
    constructor(mode, init) { super(); this.mode = mode; this.init = init; this.renderState = { depthNear: 0.1, depthFar: 1000, baseLayer: null, inlineVerticalFieldOfView: null };
      this.inputSources = []; this.visibilityState = 'visible'; this.enabledFeatures = ['local-floor', 'hand-tracking']; this._raf = new Map(); this._id = 0; this.ended = false; this.environmentBlendMode = 'opaque'; this.frames = 0; }
    updateRenderState(s) { Object.assign(this.renderState, s); }
    requestReferenceSpace(type) { S.refType = type; return Promise.resolve((S.ref = new MockRefSpace(type))); }
    requestAnimationFrame(cb) { const id = ++this._id; const h = window.requestAnimationFrame((t) => { this._raf.delete(id); if (!this.ended) { this.frames++; cb(t, new MockFrame(this)); } }); this._raf.set(id, h); return id; }
    cancelAnimationFrame(id) { const h = this._raf.get(id); if (h) window.cancelAnimationFrame(h); this._raf.delete(id); }
    end() { if (this.ended) return Promise.resolve(); this.ended = true; for (const h of this._raf.values()) window.cancelAnimationFrame(h); this._raf.clear(); this.dispatchEvent(new Event('end')); return Promise.resolve(); }
    addSources(list) { this.inputSources.push(...list); const ev = new Event('inputsourceschange'); ev.added = list; ev.removed = []; ev.session = this; this.dispatchEvent(ev); }
    removeSources(list) { this.inputSources = this.inputSources.filter((s) => !list.includes(s)); const ev = new Event('inputsourceschange'); ev.added = []; ev.removed = list; ev.session = this; this.dispatchEvent(ev); }
    fire(source, type) { const ev = new Event(type); ev.inputSource = source; ev.frame = new MockFrame(this); this.dispatchEvent(ev); }
    setVisibility(v) { this.visibilityState = v; this.dispatchEvent(new Event('visibilitychange')); }
  }
  function makeSource(handedness) {
    const b = () => ({ pressed: false, touched: false, value: 0 });
    return { handedness, targetRayMode: 'tracked-pointer', targetRaySpace: new MockSpace(handedness + '-ray'), gripSpace: new MockSpace(handedness + '-grip'), profiles: ['meta-quest-touch-plus', 'generic-trigger-squeeze-thumbstick'], hand: null,
      gamepad: { id: '', index: -1, connected: true, mapping: 'xr-standard', buttons: [b(), b(), b(), b(), b(), b(), b()], axes: [0, 0, 0, 0],
        hapticActuators: [{ type: 'vibration', pulse(i, ms) { S.pulses.push([handedness, i, ms]); return Promise.resolve(true); } }] } };
  }
  S.makeSource = makeSource;
  S.press = (hand, index, value) => { const g = S.sources[hand].gamepad; g.buttons[index].value = value; g.buttons[index].pressed = value > 0.5; g.buttons[index].touched = value > 0; };
  S.stick = (hand, x, y) => { const g = S.sources[hand].gamepad; g.axes[2] = x; g.axes[3] = y; };
  S.pose = (hand, p, q) => { const s = S.sources[hand]; for (const sp of [s.targetRaySpace, s.gripSpace]) { sp.p = p.slice(); sp.q = (q || [0, 0, 0, 1]).slice(); } };
  S.connect = () => { S.sources.left = makeSource('left'); S.sources.right = makeSource('right'); S.pose('left', [-0.22, 1.25, -0.32]); S.pose('right', [0.22, 1.25, -0.32]); S.session.addSources([S.sources.right, S.sources.left]); };
  const xr = new EventTarget();
  xr.isSessionSupported = (mode) => Promise.resolve(mode === 'immersive-vr');
  xr.requestSession = (mode, init) => {
    S.requests.push({ mode, init: JSON.parse(JSON.stringify(init || {})), userActivation: navigator.userActivation ? navigator.userActivation.isActive : null });
    const s = new MockSession(mode, init); S.session = s; return Promise.resolve(s);
  };
  Object.defineProperty(Navigator.prototype, 'xr', { get() { return xr; }, configurable: true });
  window.XRWebGLLayer = class { constructor() { this.framebuffer = null; this.framebufferWidth = 1600; this.framebufferHeight = 800; this.antialias = true; this.ignoreDepthValues = false; this.fixedFoveation = 0; }
    getViewport(view) { return view.eye === 'left' ? { x: 0, y: 0, width: 800, height: 800 } : { x: 800, y: 0, width: 800, height: 800 }; } };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (C) C.prototype.makeXRCompatible = function () { return Promise.resolve(); };
})();
