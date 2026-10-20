/* ABYSSAL TETHER 3D — loadingScene.js
 * The diegetic loading scene (VRC.Quest.Performance.3): a lantern hanging on its tether in the dark, a warm halo,
 * a few drifting motes and a title line, shown in the real scene while the renderer, input and the immersive
 * session start and the heavy content (level view, textures, creature kit, audio, UI) loads behind it.
 * It is head-tracked from the first XR frame because it lives in the same scene the game renders.
 *
 *   const ls = new LoadingScene(THREE, renderer3d)   adds a Group to renderer.scene
 *   ls.setProgress(0..1, 'Lowering the lantern')     the tether pays out as content arrives
 *   ls.update(dt, presenting)                        per frame while loading
 *   ls.dispose()                                     removes it and frees its GPU resources
 *
 * Budget: 6 draw calls, ~300 triangles, one 256x64 canvas texture, one 64x64 halo texture. No per-frame allocation.
 */

const MOTES = 90;

export class LoadingScene {
  constructor(THREE, r3d, { title = 'ABYSSAL TETHER', label = 'Lowering the lantern' } = {}) {
    this.THREE = THREE;
    this.r3d = r3d;
    this.scene = r3d.scene;
    this.camera = r3d.camera;
    this.time = 0;
    this.progress = 0;
    this.shownProgress = 0;
    this.placed = false;
    this.label = label;
    this.title = title;

    const g = (this.group = new THREE.Group());
    g.name = 'LoadingScene';
    g.position.set(0, 0, -2.4);
    this._tmp = new THREE.Vector3();

    // halo: additive radial sprite
    this._haloTex = radialTexture(THREE, 64);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._haloTex, color: 0xffb060, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.halo.scale.set(1.6, 1.6, 1);
    // glass core: a small emissive octahedron (the lantern's diamond)
    this.core = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false, toneMapped: false }));
    this.core.scale.set(0.8, 1.25, 0.8);
    // cage: a slightly larger wireframe diamond
    this.cage = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), new THREE.MeshBasicMaterial({ color: 0x6b5a40, wireframe: true, fog: false, toneMapped: false }));
    this.cage.scale.set(0.8, 1.25, 0.8);
    this.lamp = new THREE.Group();
    this.lamp.add(this.halo, this.core, this.cage);

    // tether: a thin line from far above down to the lantern; it pays out with the progress
    const ropeGeo = new THREE.BufferGeometry();
    ropeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 6, 0]), 3));
    this.rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0xe8dcc0, transparent: true, opacity: 0.55, fog: false }));
    this.rope.frustumCulled = false;

    // motes: a small drifting cloud around the lantern
    const pos = new Float32Array(MOTES * 3);
    this._seed = new Float32Array(MOTES * 3);
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < MOTES; i++) {
      this._seed[i * 3] = rnd() * 6.283;
      this._seed[i * 3 + 1] = rnd();
      this._seed[i * 3 + 2] = 0.4 + rnd() * 1.6;
    }
    const motesGeo = new THREE.BufferGeometry();
    motesGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._motePos = pos;
    this.motes = new THREE.Points(motesGeo, new THREE.PointsMaterial({ color: 0xffc890, size: 0.014, transparent: true, opacity: 0.7, depthWrite: false, fog: false, sizeAttenuation: true }));
    this.motes.frustumCulled = false;

    // title card under the lantern
    this._canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    this.card = null;
    if (this._canvas) {
      this._canvas.width = 512;
      this._canvas.height = 128;
      this._ctx = this._canvas.getContext('2d');
      this._cardTex = new THREE.CanvasTexture(this._canvas);
      this._cardTex.colorSpace = THREE.SRGBColorSpace;
      this.card = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), new THREE.MeshBasicMaterial({ map: this._cardTex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
      this.card.position.set(0, -0.62, 0);
      this._paintCard();
    }

    g.add(this.rope, this.lamp, this.motes);
    if (this.card) g.add(this.card);
    this.scene.add(g);
    this._lampY = 0;
    this._place(false);
  }

  _paintCard() {
    const ctx = this._ctx;
    if (!ctx) return;
    const W = this._canvas.width;
    const H = this._canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e8dcc0';
    ctx.font = '600 44px Georgia, "Times New Roman", serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '8px';
    ctx.fillText(this.title, W / 2, 40);
    ctx.fillStyle = 'rgba(232,220,192,0.6)';
    ctx.font = '400 24px system-ui, sans-serif';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillText(this.label.toUpperCase(), W / 2, 84);
    // progress rail
    const x0 = W * 0.2;
    const x1 = W * 0.8;
    ctx.fillStyle = 'rgba(232,220,192,0.18)';
    ctx.fillRect(x0, 112, x1 - x0, 3);
    ctx.fillStyle = '#e0a050';
    ctx.fillRect(x0, 112, (x1 - x0) * Math.max(0, Math.min(1, this.shownProgress)), 3);
    this._cardTex.needsUpdate = true;
    this._paintedProgress = this.shownProgress;
    this._paintedLabel = this.label;
  }

  setProgress(p, label) {
    this.progress = Math.max(this.progress, Math.max(0, Math.min(1, p)));
    if (label) this.label = label;
  }

  /** In front of the head, at lantern height, the first time the session is presenting (the room is then known). */
  _place(presenting) {
    const g = this.group;
    if (presenting && !this.placed) {
      this.camera.updateMatrixWorld(true);
      const head = this._tmp.setFromMatrixPosition(this.camera.matrixWorld);
      const e = this.camera.matrixWorld.elements;
      // camera looks down its local -Z: world forward = -(third column)
      let fx = -e[8];
      let fz = -e[10];
      const l = Math.hypot(fx, fz) || 1;
      fx /= l;
      fz /= l;
      g.position.set(head.x + fx * 2.2, head.y - 0.1, head.z + fz * 2.2);
      g.rotation.y = Math.atan2(-fx, -fz);
      this.placed = true;
    } else if (!presenting && !this.placed) {
      g.position.set(0, 0, -2.4);
    }
  }

  update(dt, presenting) {
    this.time += dt;
    if (presenting && !this.placed) this._place(true);
    this.shownProgress += (this.progress - this.shownProgress) * (1 - Math.exp(-4 * dt));
    // the lantern is lowered on its tether as content arrives: 0.35 m of travel
    const targetY = 0.35 - this.shownProgress * 0.35;
    this._lampY += (targetY - this._lampY) * (1 - Math.exp(-6 * dt));
    const t = this.time;
    const flick = 0.85 + 0.1 * Math.sin(t * 9.1) + 0.05 * Math.sin(t * 23.7 + 1.3);
    this.lamp.position.set(Math.sin(t * 0.7) * 0.03, this._lampY, 0);
    this.lamp.rotation.z = Math.sin(t * 0.7) * 0.05;
    this.halo.material.opacity = 0.55 * flick + 0.25;
    this.core.rotation.y = t * 0.5;
    this.cage.rotation.y = -t * 0.35;
    // tether runs from 6 m above to the lantern
    const rp = this.rope.geometry.attributes.position;
    rp.setXYZ(0, this.lamp.position.x, this.lamp.position.y + 0.12, 0);
    rp.setXYZ(1, 0, this.lamp.position.y + 6, 0);
    rp.needsUpdate = true;
    // motes drift in a column around the lamp
    const P = this._motePos;
    const S = this._seed;
    for (let i = 0; i < MOTES; i++) {
      const a = S[i * 3] + t * 0.12 * S[i * 3 + 2];
      const rad = 0.25 + S[i * 3 + 2] * 0.45;
      const y = ((S[i * 3 + 1] + t * 0.03 * S[i * 3 + 2]) % 1) * 2.2 - 1.1;
      P[i * 3] = Math.cos(a) * rad;
      P[i * 3 + 1] = this._lampY + y;
      P[i * 3 + 2] = Math.sin(a) * rad;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
    if (this.card && (Math.abs(this.shownProgress - this._paintedProgress) > 0.004 || this.label !== this._paintedLabel)) this._paintCard();
  }

  dispose() {
    this.scene.remove(this.group);
    for (const o of [this.core, this.cage, this.rope, this.motes, this.card]) {
      if (!o) continue;
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }
    this.halo.material.dispose();
    this._haloTex.dispose();
    if (this._cardTex) this._cardTex.dispose();
    this.group.clear();
  }
}

function radialTexture(THREE, size) {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c) return new THREE.Texture();
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const gr = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
