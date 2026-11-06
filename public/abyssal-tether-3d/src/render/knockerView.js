/* THE LANTERN (ABYSSAL TETHER 3D) — knockerView.js
 * What the KNOCKER (sim/knocker3d.js) looks like: a squat brass clockwork drum on an iron band, an iron striker arm with a
 * hammer head over a brass anvil plate, a wind-up key on its flank and a small amber glass bead on its crown.
 *
 *   ONE InstancedMesh (one draw call, at most KNOCKER.maxProps = 3 instances: the one in the air / clacking + the spent
 *   props still lying where they stopped) with a lit, graded MeshStandardMaterial through the engine's shared look
 *   (materials.js patchMaterial, as a client: rim + wetness + the grade; nothing of the grade is touched here), chained with
 *   a small patch of its own: per instance aState = (key angle, glow, -, -): the wind-up key's vertices (aPart.x = 1) turn
 *   about the key's axis in the vertex shader, and the amber glint (aPart.y = emissive mask: strongest on the bead, a
 *   little on the brass) pulses on each knock as a per-instance EMISSIVE. No light, no texture, no sampler of its own.
 *   It tumbles in flight about the axis across its throw (slot.spin), lies along its throw's heading at rest.
 *   ~190 triangles per knocker (3 x 190 = 570 <= 800). Instance data rewritten in place: no allocation per frame.
 *
 *   THE AIM ARC (desktop, only while G is held): one faint amber Line through KNOCKER-flight samples (sim predictArc), ending
 *   where it would first touch a solid. Hidden (0 draw calls) the rest of the time.
 *
 *   new KnockerView(game)     game: { renderer.scene, knocker (Knocker3D), level }
 *   .update(dt, game)         once per frame
 *   .setArc(points, n)        the aim preview (Float32Array of xyz, n samples; n = 0 hides it)
 *   .stats                    { instances, triangles, arc }
 */
import * as THREE from 'three';
import { KNOCKER, KSTATE } from '../sim/knocker3d.js';
import { patchMaterial } from './materials.js';

export const KNOCKER_VIEW = Object.freeze({ maxInstances: KNOCKER.maxProps, arcMax: 48, scale: 1.4, restLift: 0.026 * 1.4 - KNOCKER.radius }); // scale: drawn 1.4x life size so the 9 cm drum reads at a few metres in the dark

const BRASS = [0.72, 0.52, 0.22];
const BRASS_DK = [0.5, 0.34, 0.14];
const IRON = [0.16, 0.16, 0.17];
const BEAD = [0.95, 0.55, 0.16];

/**
 * The knocker's geometry as flat arrays (metres, origin at the drum's centre, +Y up, the key on +X). Pure THREE geometry
 * code, built once: { pos, nor, col, part (x: key, y: glow mask), idx, verts, tris }. The pickups view draws the same shape.
 */
export function knockerTemplate() {
  const parts = [];
  const add = (geo, color, key = 0, glow = 0, rx = 0, rz = 0, tx = 0, ty = 0, tz = 0) => {
    if (rx) geo.rotateX(rx);
    if (rz) geo.rotateZ(rz);
    geo.translate(tx, ty, tz);
    parts.push({ geo, color, key, glow });
  };
  // the drum: brass body, a darker brass lid, an iron band round its waist
  add(new THREE.CylinderGeometry(0.046, 0.05, 0.05, 10, 1), BRASS, 0, 0.18);
  add(new THREE.CylinderGeometry(0.04, 0.046, 0.012, 10, 1), BRASS_DK, 0, 0.12, 0, 0, 0, 0.031, 0);
  add(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 10, 1, true), IRON, 0, 0, 0, 0, 0, -0.008, 0);
  // the anvil plate and the striker: an iron arm on a pivot post, a hammer head over the plate
  add(new THREE.BoxGeometry(0.03, 0.006, 0.026), BRASS, 0, 0.25, 0, 0, -0.016, 0.04, 0);
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.026, 6, 1), IRON, 0, 0, 0, 0, 0.024, 0.048, 0);
  add(new THREE.BoxGeometry(0.06, 0.008, 0.01), IRON, 0, 0, 0, 0.18, -0.002, 0.058, 0);
  add(new THREE.BoxGeometry(0.018, 0.016, 0.018), IRON, 0, 0, 0, 0, -0.03, 0.052, 0);
  // the wind-up key on the flank (+X): a shaft and a flat bow; aPart.x marks it (it turns)
  add(new THREE.CylinderGeometry(0.005, 0.005, 0.026, 6, 1), IRON, 1, 0, 0, Math.PI / 2, 0.058, 0, 0);
  add(new THREE.BoxGeometry(0.006, 0.034, 0.02), BRASS_DK, 1, 0.1, 0, 0, 0.073, 0, 0);
  // the amber glass bead on the crown: the glint
  add(new THREE.OctahedronGeometry(0.009, 0), BEAD, 0, 1, 0, 0, 0.022, 0.044, 0.018);
  let verts = 0;
  let nIdx = 0;
  for (const p of parts) {
    verts += p.geo.attributes.position.count;
    nIdx += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
  }
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const col = new Float32Array(verts * 3);
  const part = new Float32Array(verts * 2);
  const idx = new Uint16Array(nIdx);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const g = p.geo;
    const pa = g.attributes.position;
    const na = g.attributes.normal;
    for (let i = 0; i < pa.count; i++) {
      pos[(vo + i) * 3] = pa.getX(i);
      pos[(vo + i) * 3 + 1] = pa.getY(i);
      pos[(vo + i) * 3 + 2] = pa.getZ(i);
      nor[(vo + i) * 3] = na.getX(i);
      nor[(vo + i) * 3 + 1] = na.getY(i);
      nor[(vo + i) * 3 + 2] = na.getZ(i);
      col[(vo + i) * 3] = p.color[0];
      col[(vo + i) * 3 + 1] = p.color[1];
      col[(vo + i) * 3 + 2] = p.color[2];
      part[(vo + i) * 2] = p.key;
      part[(vo + i) * 2 + 1] = p.glow;
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = vo + g.index.getX(i);
    else for (let i = 0; i < pa.count; i++) idx[io + i] = vo + i;
    io += g.index ? g.index.count : pa.count;
    vo += pa.count;
    g.dispose();
  }
  return { pos, nor, col, part, idx, verts, tris: nIdx / 3 };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class KnockerView {
  constructor(game) {
    this.game = game;
    this.scene = game.renderer.scene;
    this.t = 0;
    const tpl = knockerTemplate();
    this.trianglesEach = tpl.tris;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(tpl.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(tpl.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(tpl.col, 3));
    g.setAttribute('aPart', new THREE.BufferAttribute(tpl.part, 2));
    g.setIndex(new THREE.BufferAttribute(tpl.idx, 1));
    g.computeBoundingSphere();
    const N = KNOCKER_VIEW.maxInstances;
    this._aState = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
    this._aState.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aState', this._aState);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.45, emissive: 0x000000 });
    mat.name = 'knocker';
    patchMaterial(mat, { lit: true, grade: true, wetK: 0.3 }); // the shared look (rim, wetness, the grade) as a client
    const base = mat.onBeforeCompile;
    const baseKey = String(mat.customProgramCacheKey());
    mat.onBeforeCompile = (shader, renderer) => {
      base(shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aPart;\nattribute vec4 aState;\nvarying float vKnGlow;')
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
  float knC = cos( aState.x );
  float knS = sin( aState.x );
  if ( aPart.x > 0.5 ) objectNormal = vec3( objectNormal.x, knC * objectNormal.y - knS * objectNormal.z, knS * objectNormal.y + knC * objectNormal.z );`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  if ( aPart.x > 0.5 ) transformed = vec3( transformed.x, knC * transformed.y - knS * transformed.z, knS * transformed.y + knC * transformed.z );
  vKnGlow = aState.y * aPart.y;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vKnGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vec3( 1.0, 0.58, 0.18 ) * ( 4.0 * vKnGlow );');
    };
    mat.customProgramCacheKey = () => baseKey + '|at3d-knocker';
    this.mesh = new THREE.InstancedMesh(g, mat, N);
    this.mesh.name = 'knockers';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    // the aim arc (desktop G held)
    const ag = new THREE.BufferGeometry();
    this._arcPos = new THREE.BufferAttribute(new Float32Array(KNOCKER_VIEW.arcMax * 3), 3);
    this._arcPos.setUsage(THREE.DynamicDrawUsage);
    ag.setAttribute('position', this._arcPos);
    ag.setDrawRange(0, 0);
    const am = new THREE.LineBasicMaterial({ color: 0xffb860, transparent: true, opacity: 0.32, depthWrite: false, fog: true, toneMapped: false });
    am.name = 'knockerArc';
    this.arc = new THREE.Line(ag, am);
    this.arc.name = 'knockerArc';
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.arc.renderOrder = 5;
    this.scene.add(this.arc);
    this.stats = { instances: 0, triangles: 0, arc: 0 };
  }

  /** The aim preview: n xyz samples from `pts` (0 hides it). */
  setArc(pts, n) {
    const m = Math.min(n | 0, KNOCKER_VIEW.arcMax);
    if (m < 2 || !pts) {
      this.arc.visible = false;
      this.stats.arc = 0;
      return;
    }
    const a = this._arcPos.array;
    for (let i = 0; i < m * 3; i++) a[i] = pts[i];
    this._arcPos.needsUpdate = true;
    this.arc.geometry.setDrawRange(0, m);
    this.arc.visible = true;
    this.stats.arc = m;
  }

  update(dt, game) {
    const g = game || this.game;
    this.t += dt;
    const k = g.knocker;
    const mesh = this.mesh;
    let n = 0;
    if (k && !g.hidePlayer) {
      const st = this._aState.array;
      for (let i = 0; i < k.slots.length && n < KNOCKER_VIEW.maxInstances; i++) {
        const s = k.slots[i];
        if (s.state === KSTATE.FREE) continue;
        // pose: lying along the throw's heading; in flight it tumbles about the axis across the throw
        _q.setFromAxisAngle(_up, s.yaw);
        if (s.state === KSTATE.FLIGHT && s.spin !== 0) {
          _ax.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
          _q2.setFromAxisAngle(_ax, -s.spin);
          _q.premultiply(_q2);
        }
        const lift = s.state === KSTATE.FLIGHT || s.state === KSTATE.HELD ? 0 : KNOCKER_VIEW.restLift;
        _p.set(s.x, s.y + lift, s.z);
        const sc = (s.fade > 0 ? s.fade : 0) * KNOCKER_VIEW.scale;
        _s.set(sc, sc, sc);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(n, _m);
        st[n * 4] = s.key;
        st[n * 4 + 1] = s.state === KSTATE.CLACK || s.state === KSTATE.WINDUP ? 0.12 + s.glow : s.glow;
        st[n * 4 + 2] = 0;
        st[n * 4 + 3] = 0;
        n++;
      }
      if (n > 0) {
        mesh.instanceMatrix.needsUpdate = true;
        this._aState.needsUpdate = true;
      }
    }
    mesh.count = n;
    this.stats.instances = n;
    this.stats.triangles = n * this.trianglesEach;
  }

  dispose() {
    for (const o of [this.mesh, this.arc]) {
      if (o.parent) o.parent.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
  }
}
