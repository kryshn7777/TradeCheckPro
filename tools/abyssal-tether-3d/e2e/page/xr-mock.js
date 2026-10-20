/* Mock WebXR (immersive-vr) for headless tests: navigator.xr, XRSession, XRFrame,
 * XRWebGLLayer, two xr-standard controllers. Renders both eyes side by side into the
 * default framebuffer (baseLayer.framebuffer = null). Controlled through window.__xr. */
(() => {
  const S = (window.__xr = {
    head: { x: 0.25, y: 1.6, z: -0.1, yaw: 0.7 }, // pose in the local-floor space
    ctrl: {
      left: { x: -0.2, y: 1.3, z: -0.35, yaw: 0, pitch: 0 },
      right: { x: 0.2, y: 1.3, z: -0.35, yaw: 0, pitch: 0 },
    },
    haptics: [],
    session: null,
    frames: 0,
    requested: [],
  });

  function quatYawPitch(yaw, pitch) {
    // q = qYaw * qPitch
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
    const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
  }
  function matFrom(p, q) {
    const { x, y, z, w } = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    return new Float32Array([
      1 - (yy + zz), xy + wz, xz - wy, 0,
      xy - wz, 1 - (xx + zz), yz + wx, 0,
      xz + wy, yz - wx, 1 - (xx + yy), 0,
      p.x, p.y, p.z, 1,
    ]);
  }
  function transform(p, q) {
    return { position: { x: p.x, y: p.y, z: p.z, w: 1 }, orientation: q, matrix: matFrom(p, q) };
  }
  function perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }

  class Space {
    constructor(kind, hand) {
      this.kind = kind;
      this.hand = hand;
    }
  }

  function makeSource(hand) {
    const buttons = [];
    for (let i = 0; i < 6; i++) buttons.push({ pressed: false, touched: false, value: 0 });
    return {
      handedness: hand,
      targetRayMode: 'tracked-pointer',
      targetRaySpace: new Space('ray', hand),
      gripSpace: new Space('grip', hand),
      profiles: ['oculus-touch-v3', 'generic-trigger-squeeze-thumbstick'],
      gamepad: {
        mapping: 'xr-standard',
        connected: true,
        buttons,
        axes: [0, 0, 0, 0],
        hapticActuators: [{ pulse: (v, ms) => (S.haptics.push([hand, Math.round(v * 100) / 100, ms]), Promise.resolve(true)) }],
      },
    };
  }

  class MockFrame {
    constructor(session) {
      this.session = session;
    }
    getViewerPose() {
      const h = S.head;
      const q = quatYawPitch(h.yaw, 0);
      const right = { x: Math.cos(h.yaw), z: -Math.sin(h.yaw) };
      const proj = perspective((90 * Math.PI) / 180, 1832 / 1920, 0.05, 400);
      const views = ['left', 'right'].map((eye, i) => {
        const o = (i === 0 ? -1 : 1) * 0.032;
        return { eye, projectionMatrix: proj, transform: transform({ x: h.x + right.x * o, y: h.y, z: h.z + right.z * o }, q) };
      });
      return { views, transform: transform(h, q), emulatedPosition: false };
    }
    getPose(space) {
      if (!space || !space.hand) return null;
      const c = S.ctrl[space.hand];
      return { transform: transform(c, quatYawPitch(c.yaw, c.pitch)), emulatedPosition: false };
    }
  }

  class MockSession extends EventTarget {
    constructor(mode, init) {
      super();
      this.mode = mode;
      this.init = init;
      this.renderState = { baseLayer: null, depthNear: 0.1, depthFar: 1000, inlineVerticalFieldOfView: null };
      this.inputSources = [];
      this.visibilityState = 'visible';
      this.enabledFeatures = ['local-floor'];
      this.environmentBlendMode = 'opaque';
      this._ended = false;
      this._raf = new Map();
      this._id = 0;
    }
    updateRenderState(s) {
      Object.assign(this.renderState, s);
    }
    requestReferenceSpace(type) {
      S.requested.push(type);
      setTimeout(() => this._addSources(), 30);
      return Promise.resolve(new Space('ref:' + type));
    }
    _addSources() {
      if (this.inputSources.length || this._ended) return;
      const added = [makeSource('left'), makeSource('right')];
      this.inputSources.push(...added);
      const ev = new Event('inputsourceschange');
      ev.added = added;
      ev.removed = [];
      ev.session = this;
      this.dispatchEvent(ev);
    }
    requestAnimationFrame(cb) {
      const id = ++this._id;
      const h = window.requestAnimationFrame((t) => {
        this._raf.delete(id);
        if (this._ended) return;
        S.frames++;
        cb(t, new MockFrame(this));
      });
      this._raf.set(id, h);
      return id;
    }
    cancelAnimationFrame(id) {
      const h = this._raf.get(id);
      if (h !== undefined) window.cancelAnimationFrame(h);
      this._raf.delete(id);
    }
    setVisibility(v) {
      this.visibilityState = v;
      this.dispatchEvent(new Event('visibilitychange'));
    }
    end() {
      if (this._ended) return Promise.resolve();
      this._ended = true;
      this.dispatchEvent(new Event('end'));
      return Promise.resolve();
    }
  }

  window.XRWebGLLayer = class {
    constructor(session, gl) {
      this.framebuffer = null;
      this.framebufferWidth = gl.drawingBufferWidth;
      this.framebufferHeight = gl.drawingBufferHeight;
      this.antialias = true;
      this.ignoreDepthValues = false;
      this.fixedFoveation = 0;
    }
    getViewport(view) {
      const w = Math.floor(this.framebufferWidth / 2);
      return { x: view.eye === 'left' ? 0 : w, y: 0, width: w, height: this.framebufferHeight };
    }
    static getNativeFramebufferScaleFactor() {
      return 1;
    }
  };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (C) C.prototype.makeXRCompatible = function () {
      return Promise.resolve();
    };
  }
  const xr = new EventTarget();
  xr.isSessionSupported = (mode) => Promise.resolve(mode === 'immersive-vr');
  xr.requestSession = (mode, init) => {
    const s = new MockSession(mode, init);
    S.session = s;
    return Promise.resolve(s);
  };
  Object.defineProperty(navigator, 'xr', { value: xr, configurable: true });
})();
