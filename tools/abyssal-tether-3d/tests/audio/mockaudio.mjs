// A strict mock of the Web Audio API for Node: records the graph and throws on what a browser would reject
// (non-finite numbers, negative times, exponential ramps to <= 0, bad connections), so a NaN or a bad envelope in the
// game's audio code surfaces in a test. It renders nothing; AudioContext.currentTime is advanced by the test.
//
//   const ctx = new MockAudioContext(); ctx.stats() -> { created, liveNodes, sources, running, params }

const fin = (v, what) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`non-finite ${what}: ${v}`);
  return v;
};

export class MockParam {
  constructor(owner, name, value) {
    this.owner = owner;
    this.name = name;
    this._v = value;
    this.automationRate = 'a-rate';
    this.events = 0;
  }
  get value() {
    return this._v;
  }
  set value(v) {
    this._v = fin(v, `${this.owner.kind}.${this.name}.value`);
  }
  _t(t, what) {
    fin(t, `${this.owner.kind}.${this.name} ${what} time`);
    if (t < 0) throw new RangeError(`negative time on ${this.name}`);
  }
  setValueAtTime(v, t) {
    fin(v, `${this.name} value`);
    this._t(t, 'setValueAtTime');
    this.events++;
    this._v = v;
    return this;
  }
  linearRampToValueAtTime(v, t) {
    fin(v, `${this.name} ramp value`);
    this._t(t, 'linearRamp');
    this.events++;
    this._v = v;
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    fin(v, `${this.name} expramp value`);
    this._t(t, 'expRamp');
    if (!(v > 0)) throw new RangeError(`exponentialRamp to ${v} on ${this.owner.kind}.${this.name}`);
    this.events++;
    this._v = v;
    return this;
  }
  setTargetAtTime(v, t, tc) {
    fin(v, `${this.name} target`);
    this._t(t, 'setTarget');
    fin(tc, `${this.name} timeConstant`);
    if (tc < 0) throw new RangeError('negative timeConstant');
    this.events++;
    this._v = v;
    return this;
  }
  cancelScheduledValues(t) {
    this._t(t, 'cancel');
    return this;
  }
}

let SEQ = 0;
export class MockNode {
  constructor(ctx, kind, params) {
    this.ctx = ctx;
    this.kind = kind;
    this.id = ++SEQ;
    this.out = new Set();
    this.disconnectedAll = false;
    this.numberOfInputs = 1;
    ctx._created++;
    ctx._nodes.add(this);
    for (const [k, v] of Object.entries(params || {})) this[k] = new MockParam(this, k, v);
  }
  connect(dest) {
    if (!dest || !(dest instanceof MockNode || dest instanceof MockParam)) throw new TypeError('connect: bad destination');
    this.out.add(dest);
    return dest;
  }
  disconnect(dest) {
    if (dest === undefined) {
      this.out.clear();
      this.disconnectedAll = true;
      this.ctx._nodes.delete(this);
      return;
    }
    if (!this.out.delete(dest)) throw new Error('disconnect: not connected'); // InvalidAccessError in browsers
  }
}

class MockSource extends MockNode {
  start(t) {
    if (this.started) throw new Error('InvalidStateError: start called twice');
    if (t !== undefined) fin(t, `${this.kind}.start`);
    this.started = true;
    this.ctx._sources++;
  }
  stop(t) {
    if (!this.started) throw new Error('InvalidStateError: stop before start');
    if (t !== undefined) fin(t, `${this.kind}.stop`);
    this.stopAt = t;
  }
}

export class MockAudioContext {
  constructor() {
    this._created = 0;
    this._sources = 0;
    this._nodes = new Set();
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = 'running';
    this.destination = new MockNode(this, 'destination');
    const P = (n, v) => new MockParam({ kind: 'listener' }, n, v);
    this.listener = { positionX: P('px', 0), positionY: P('py', 0), positionZ: P('pz', 0), forwardX: P('fx', 0), forwardY: P('fy', 0), forwardZ: P('fz', -1), upX: P('ux', 0), upY: P('uy', 1), upZ: P('uz', 0) };
  }
  addEventListener() {}
  suspend() {
    return Promise.resolve();
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  createGain() {
    return new MockNode(this, 'gain', { gain: 1 });
  }
  createBiquadFilter() {
    const n = new MockNode(this, 'biquad', { frequency: 350, Q: 1, gain: 0, detune: 0 });
    n.type = 'lowpass';
    return n;
  }
  createOscillator() {
    const n = new MockSource(this, 'osc', { frequency: 440, detune: 0 });
    n.type = 'sine';
    return n;
  }
  createBufferSource() {
    const n = new MockSource(this, 'buffersource', { playbackRate: 1, detune: 0 });
    n.buffer = null;
    n.loop = false;
    return n;
  }
  createBuffer(ch, len, sr) {
    fin(len, 'buffer length');
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i] };
  }
  createDynamicsCompressor() {
    return new MockNode(this, 'compressor', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 });
  }
  createWaveShaper() {
    const n = new MockNode(this, 'waveshaper');
    n.curve = null;
    n.oversample = 'none';
    return n;
  }
  createStereoPanner() {
    return new MockNode(this, 'stereopanner', { pan: 0 });
  }
  createPanner() {
    const n = new MockNode(this, 'panner', { positionX: 0, positionY: 0, positionZ: 0, orientationX: 1, orientationY: 0, orientationZ: 0 });
    n.panningModel = 'equalpower';
    n.distanceModel = 'inverse';
    return n;
  }
  createDelay(max) {
    fin(max, 'delay max');
    return new MockNode(this, 'delay', { delayTime: 0 });
  }
  createConvolver() {
    const n = new MockNode(this, 'convolver');
    n.buffer = null;
    n.normalize = true;
    return n;
  }
  /** Graph numbers for leak checks. */
  stats() {
    let src = 0;
    for (const n of this._nodes) if (n instanceof MockSource && n.started) src++;
    return { created: this._created, liveNodes: this._nodes.size, startedSources: src, totalStarted: this._sources };
  }
}
