// ITEM CARDS (Node, no browser; plans/ITEM_CARDS.md): sim/itemGaze.js (the cone, the range, the distance weight, hysteresis, the 0.2 s
// dwell, the 0.3 s grace, an item collected hides at once, occlusion through a callback, busy states, determinism, no allocation per
// frame), data/itemCards.js (a card for every bag kind of the enum + the fuel can, the generic fallback from ITEM_NAMES, the platform
// hint lines), render/itemCardView.js (one mesh = one draw call, an unlit fogged depth-tested material, the canvas redrawn only when the
// content changes, the yaw-only billboard, the width clamps, fades, dispose), itemCardGlue.js (the pool from the pickups + the fuel
// cans, the eye from the rig + camera, busy, the setting + ?itemcards=off) and the setting's default / sanitise round trip.
//   node item-card.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
import { register } from 'node:module';
import { srcUrl, VENDOR_THREE_URL } from '../../verify/root.mjs';
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;

// a recording 2D context (no DOM): every fillText and the number of clears (= redraws)
function mockCanvas(w, h) {
  const texts = [];
  const counter = { clears: 0, calls: 0 };
  const grad = { addColorStop() {} };
  const stack = [];
  const off = { x: 0, y: 0 };
  const ctx = new Proxy(
    { texts, counter, font: '10px serif' },
    {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'measureText') return (s) => ({ width: String(s).length * (parseFloat(/(\d+(?:\.\d+)?)px/.exec(t.font)?.[1] || 10) * 0.62) });
        if (k === 'fillText') return (s, x, y) => texts.push({ s: String(s), x: x + off.x, y: y + off.y, font: t.font });
        if (k === 'save') return () => stack.push([off.x, off.y]);
        if (k === 'restore') return () => {
          const v = stack.pop() || [0, 0];
          off.x = v[0];
          off.y = v[1];
        };
        if (k === 'translate') return (x, y) => {
          off.x += x;
          off.y += y;
        };
        if (k === 'clearRect') return () => {
          counter.clears++;
          texts.length = 0;
        };
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
        return () => {
          counter.calls++;
        };
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    },
  );
  return { width: w, height: h, getContext: () => ctx, ctx };
}
let lastCanvas = null;
globalThis.document = {
  createElement: () => {
    lastCanvas = mockCanvas(0, 0);
    return lastCanvas;
  },
};

const THREE = await import(`${VENDOR_THREE_URL}three.module.min.js`);
const { ItemGaze, GAZE, levelOccluder } = await import(srcUrl('sim/itemGaze.js'));
const { ITEM_CARDS, FUEL_CARD, cardFor, cardHint } = await import(srcUrl('data/itemCards.js'));
const INV = await import(srcUrl('sim/inventory3d.js'));
const { ItemCardView, CARD } = await import(srcUrl('render/itemCardView.js'));
const { ItemCardGlue, itemCardsUrlOff, itemCardsOn } = await import(srcUrl('itemCardGlue.js'));
const { SETTINGS_DEFAULTS, sanitizeUxSettings } = await import(srcUrl('sim/config3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 72;
const ctx = (over = {}) => Object.assign({ ex: 0, ey: 1.6, ez: 0, fx: 0, fy: 0, fz: -1, busy: false }, over);
/** The forward from the eye toward (x, y, z). */
const toward = (c, x, y, z) => {
  c.fx = x - c.ex;
  c.fy = y - c.ey;
  c.fz = z - c.ez;
  return c;
};
const run = (gz, c, list, seconds, occ) => {
  let T = null;
  for (let t = 0; t < seconds - 1e-9; t += DT) T = gz.update(DT, c, list, list.length, occ);
  return T;
};

// ---- gaze: cone, range, distance weight ----------------------------------------------------------------------------------------------
{
  const A = { x: 0, y: 1.0, z: -2, kind: 1, id: 'a' };
  const gz = new ItemGaze();
  const c = toward(ctx(), A.x, A.y, A.z);
  ok(gz.update(DT, c, [A], 1).on === false, 'nothing on the first frame (the dwell)');
  const T = run(gz, c, [A], 0.25);
  ok(T.on && T.kind === 1 && T.id === 'a' && Math.abs(T.dist - Math.hypot(0, 0.6, 2)) < 1e-6, 'looking at a bandage 2 m off for 0.25 s: it is the target (kind, id, distance)');
  const off = new ItemGaze();
  const c2 = ctx();
  const ang = (deg) => {
    const d = Math.hypot(0.6, 2);
    // a forward rotated `deg` sideways from the line to A
    const bx = 0;
    const by = -0.6 / d;
    const bz = -2 / d;
    const r = (deg * Math.PI) / 180;
    c2.fx = bx * Math.cos(r) + Math.sin(r);
    c2.fy = by * Math.cos(r);
    c2.fz = bz * Math.cos(r);
    return c2;
  };
  const coneAt2m = GAZE.coneDeg + (Math.atan(GAZE.itemRadius / Math.hypot(0.6, 2)) * 180) / Math.PI;
  ok(run(off, ang(coneAt2m - 1), [A], 0.3).on, `${(coneAt2m - 1).toFixed(1)} degrees off the item (inside the ${coneAt2m.toFixed(1)} degree cone at 2 m): shown`);
  off.reset();
  ok(!run(off, ang(coneAt2m + 1.5), [A], 0.6).on, `${(coneAt2m + 1.5).toFixed(1)} degrees off: not shown`);
  const far = { x: 0, y: 1.6, z: -(GAZE.range + 0.3), kind: 3, id: 'far' };
  const gf = new ItemGaze();
  ok(!run(gf, toward(ctx(), far.x, far.y, far.z), [far], 0.6).on, `beyond ${GAZE.range} m: never shown`);
  const near6 = { x: 0, y: 1.6, z: -(GAZE.range - 0.3), kind: 3, id: 'n6' };
  ok(run(new ItemGaze(), toward(ctx(), near6.x, near6.y, near6.z), [near6], 0.3).on, `${GAZE.range - 0.3} m: shown`);
  // two items on almost the same line: the nearer one wins
  const N = { x: 0, y: 1.6, z: -1.5, kind: 0, id: 'near' };
  const F = { x: 0.05, y: 1.6, z: -4.5, kind: 3, id: 'farther' };
  const gw = new ItemGaze();
  ok(run(gw, toward(ctx(), 0.02, 1.6, -3), [F, N], 0.3).id === 'near', 'two items on one line: the nearer wins (the distance weight)');
}

// ---- gaze: hysteresis (no flicker), dwell, grace, collected ---------------------------------------------------------------------------
{
  const L = { x: -0.18, y: 1.0, z: -2, kind: 1, id: 'L' };
  const R = { x: 0.18, y: 1.0, z: -2, kind: 3, id: 'R' };
  const list = [L, R];
  const gz = new ItemGaze();
  const c = toward(ctx(), L.x, L.y, L.z);
  run(gz, c, list, 0.3);
  ok(gz.target.id === 'L', 'between two neighbours: looking at the left one shows it');
  // the look sweeps back and forth across the midpoint (a small jitter): the shown one never flips
  let flips = 0;
  let last = gz.target.id;
  for (let i = 0; i < 600; i++) {
    const x = 0.02 * Math.sin(i * 0.9); // jitter around the middle, +-0.02 m at 2 m
    toward(c, x, 1.0, -2);
    const T = gz.update(DT, c, list, 2);
    if (T.on && T.id !== last) {
      flips++;
      last = T.id;
    }
  }
  ok(flips === 0 && gz.target.id === 'L', `a look jittering across the midpoint for 600 frames: ${flips} flips (the shown one keeps its wider cone + bonus)`);
  // a decisive look at the right one: it takes over after the dwell
  toward(c, R.x, R.y, R.z);
  let t = 0;
  while (gz.target.id !== 'R' && t < 2) {
    gz.update(DT, c, list, 2);
    t += DT;
  }
  ok(gz.target.id === 'R' && t >= GAZE.dwell - 1e-6 && t < GAZE.dwell + 3 * DT, `a clear look at the other: it replaces the shown one after the dwell (${t.toFixed(3)} s)`);
  // grace: look away, the card stays 0.3 s, then hides
  c.fx = 1;
  c.fy = 0;
  c.fz = 0;
  t = 0;
  while (gz.target.on && t < 2) {
    gz.update(DT, c, list, 2);
    t += DT;
  }
  ok(t >= GAZE.grace - 1e-6 && t < GAZE.grace + 3 * DT, `looking away: it stays for the grace and hides (${t.toFixed(3)} s)`);
  // a glance shorter than the dwell shows nothing
  const g2 = new ItemGaze();
  const c2 = toward(ctx(), L.x, L.y, L.z);
  run(g2, c2, list, GAZE.dwell * 0.6);
  c2.fx = 1;
  c2.fy = 0;
  c2.fz = 0;
  run(g2, c2, list, 0.5);
  ok(g2.stats.shows === 0, 'a glance shorter than the dwell never shows a card');
  // collected: the item leaves the list -> hidden at once (no grace)
  const g3 = new ItemGaze();
  const c3 = toward(ctx(), L.x, L.y, L.z);
  run(g3, c3, [L], 0.3);
  const T = g3.update(DT, c3, [], 0);
  ok(g3.target.on === true || T.on === false, 'sanity');
  ok(T.on === false, 'the item collected (gone from the list): the card hides the same frame');
}

// ---- gaze: occlusion, busy -------------------------------------------------------------------------------------------------------------
{
  const A = { x: 0, y: 1.0, z: -3, kind: 0, id: 'A' };
  const B = { x: 0.15, y: 1.0, z: -3.3, kind: 3, id: 'B' };
  let asked = 0;
  const wallOnA = (ex, ey, ez, x, y, z) => {
    asked++;
    return x === A.x && z === A.z;
  };
  const gz = new ItemGaze();
  const c = toward(ctx(), A.x, A.y, A.z);
  run(gz, c, [A], 0.5, wallOnA);
  ok(!gz.target.on && gz.stats.occluded > 0, 'an item behind a wall (the occlusion callback says so): no card');
  run(gz, c, [A, B], 0.5, wallOnA);
  ok(gz.target.on && gz.target.id === 'B', 'the best hidden, the second in the cone visible: the second shows');
  ok(asked <= 2 * Math.ceil(1 / DT) + 4, `the callback is asked at most twice a frame (${asked} calls in ${Math.ceil(1 / DT)} frames)`);
  // the level occluder through raycast(...)
  const solid = { t: 0 };
  const lvl = { raycast: (ox, oy, oz, dx, dy, dz, max, out) => (solid.t > 0 && solid.t < max ? Object.assign(out, { t: solid.t }) : null) };
  const occ = levelOccluder(() => lvl);
  solid.t = 1.2;
  const blocked = occ(0, 1.6, 0, 0, 1, -3);
  solid.t = 3.05; // the item's own ledge, inside the margin
  const ledge = occ(0, 1.6, 0, 0, 1, -3);
  solid.t = 0;
  ok(blocked && !ledge && !occ(0, 1.6, 0, 0, 1, -3) && !levelOccluder(() => null)(0, 0, 0, 1, 1, 1), 'levelOccluder: a solid between = occluded; a hit within the margin of the item (its ledge) or no hit = visible; no level = visible');
  const gb = new ItemGaze();
  run(gb, c, [A], 0.5);
  ok(gb.target.on, 'not busy: shown');
  gb.update(DT, Object.assign({}, c, { busy: true }), [A], 1);
  ok(!gb.target.on && !gb.pending, 'busy (dead / menu / applying / cinematic): hidden at once, nothing pending');
  const gz2 = new ItemGaze();
  ok(!run(gz2, ctx({ fx: 0, fy: 0, fz: 0 }), [A], 0.5).on, 'a zero forward: nothing');
}

// ---- gaze: determinism and no allocation ------------------------------------------------------------------------------------------------
{
  const items = [];
  for (let i = 0; i < 40; i++) items.push({ x: Math.sin(i * 1.7) * 4, y: 1 + Math.cos(i * 0.9), z: -1 - (i % 7) * 0.7, kind: i % 7, id: `i${i}` });
  const trace = () => {
    const gz = new ItemGaze();
    const c = ctx();
    const out = [];
    for (let f = 0; f < 3000; f++) {
      const a = f * 0.004;
      c.fx = Math.sin(a) * 0.9;
      c.fy = -0.3 + 0.2 * Math.sin(a * 3);
      c.fz = -Math.cos(a);
      const T = gz.update(DT, c, items, items.length);
      out.push(T.on ? T.id : '-');
    }
    return out.join(',');
  };
  const a = trace();
  const b = trace();
  ok(a === b && /i\d/.test(a), 'deterministic: the same look path picks the same items frame for frame');
  const gz = new ItemGaze();
  const c = ctx();
  for (let f = 0; f < 20000; f++) gz.update(DT, c, items, items.length); // warm the JIT
  const h0 = process.memoryUsage().heapUsed;
  for (let f = 0; f < 400000; f++) {
    const a2 = f * 0.003;
    c.fx = Math.sin(a2);
    c.fz = -Math.cos(a2);
    gz.update(DT, c, items, items.length);
  }
  const grew = process.memoryUsage().heapUsed - h0;
  ok(grew < 3 * 1024 * 1024, `ItemGaze.update: 400,000 frames over 40 items, heap +${(grew / 1024).toFixed(0)} KB (no allocation per frame)`);
}

// ---- the cards table -----------------------------------------------------------------------------------------------------------------
{
  const kinds = Object.values(INV.ITEM);
  const missing = kinds.filter((k) => !ITEM_CARDS[k]);
  ok(missing.length === 0, `every bag kind of the ITEM enum (${kinds.length}: ${Object.keys(INV.ITEM).join(', ')}) has a card${missing.length ? ` (missing: ${missing})` : ''}`);
  const all = [...kinds, 5, 6, FUEL_CARD];
  const good = all.every((k) => {
    const c = ITEM_CARDS[k];
    return c && c.name && c.hint && /^#[0-9a-f]{6}$/i.test(c.accent) && c.icon && c.use && c.use.vr && c.use.desktop && c.use.touch;
  });
  ok(good, 'every card (0..6 + the fuel can) has a name, a hint, an accent #rrggbb, an icon id and a use line per platform');
  const accents = new Set(all.map((k) => ITEM_CARDS[k].accent));
  const icons = new Set(all.map((k) => ITEM_CARDS[k].icon));
  ok(accents.size === all.length && icons.size === all.length, 'each kind is unique: its own accent colour and its own icon');
  ok(cardFor(INV.ITEM.BANDAGE).name === INV.ITEM_NAMES[INV.ITEM.BANDAGE] && cardFor(INV.ITEM.FIRST_AID).name === INV.ITEM_NAMES[0], 'names come from ITEM_NAMES where it has the kind');
  ok(ITEM_CARDS[5].name === 'Grenade' && /scares the Mason off/.test(ITEM_CARDS[5].hint) && ITEM_CARDS[6].name === 'Service revolver' && /hit scares the Mason off/.test(ITEM_CARDS[6].hint), 'kind 5 = Grenade, 6 = Service revolver (placeholder hints)');
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'Flare'];
  const gen = cardFor(8, names);
  ok(gen.generic && gen.name === 'Flare' && gen.hint && gen.icon === 'box' && cardFor(40).name === 'Supplies', 'an unknown kind: a generic card named from ITEM_NAMES ("Supplies" without a name)');
  ok(cardFor(1) === cardFor(1), 'cardFor is cached (the same object for a kind)');
  const b = cardFor(1);
  ok(cardHint(b, 'desktop') === 'Heals a little (1.5 s) · press 2 to apply' && cardHint(b, 'vr') === 'Heals a little (1.5 s) · hip + grip to apply' && cardHint(b, 'touch') === 'Heals a little (1.5 s) · tap BAG to apply', 'the bandage hint per platform: press 2 / hip + grip / tap BAG (the tutorial wording)');
  ok(/G/.test(cardHint(cardFor(4), 'desktop')) && /KNOCK/.test(cardHint(cardFor(4), 'touch')) && /both triggers/.test(cardHint(cardFor(FUEL_CARD), 'vr')) && /J in a fall/.test(cardHint(cardFor(FUEL_CARD), 'desktop')), 'the knocker (G / BAG, then KNOCK) and the fuel can (both triggers / J in a fall) use their real inputs');
  ok(/no room/.test(cardHint(b, 'vr', true)) && /tank/.test(cardHint(cardFor(FUEL_CARD), 'vr', true)), 'a full bag (a full tank) says so instead');
  const B = (await import(srcUrl('sim/config3d.js'))).CONFIG.bag;
  ok(B.heal[0] === 1 && B.applyTime[0] === 5 && B.applyTime[1] === 1.5 && B.adrenalineTime === 10 && B.adrenalineMul === 2 && B.batteryRestore === 0.5, 'the hints match CONFIG.bag (full heal 5 s, bandage 1.5 s, 2x for 10 s, half a lantern)');
}

// ---- the view -------------------------------------------------------------------------------------------------------------------------
{
  const scene = new THREE.Scene();
  const v = new ItemCardView(scene, { makeCanvas: (w, h) => mockCanvas(w, h) });
  const g = v.g;
  ok(scene.children.length === 1 && v.mesh.isMesh && v.geometry.index.count === 12 && v.geometry.attributes.position.count === 8, 'ONE mesh (one draw call): the card + its wire stake in one geometry (8 vertices, 4 triangles)');
  const m = v.material;
  ok(m.isMeshBasicMaterial && m.fog === true && m.depthTest === true && m.depthWrite === false && m.toneMapped === false && m.transparent, 'unlit MeshBasic (no lit sampler), fogged, depth-tested (never through a wall), no depth write, fixed brightness');
  ok(v.canvas.width === CARD.cw && v.canvas.height === CARD.ch && v.texture.isCanvasTexture, `one ${CARD.cw} x ${CARD.ch} canvas texture`);
  const eye = { x: 0, y: 1.6, z: 0 };
  const T = { on: true, kind: 1, id: 'b1', x: 0, y: 0.5, z: -1.5 };
  v.setCard(cardFor(1), cardHint(cardFor(1), 'desktop'), 17);
  for (let i = 0; i < 30; i++) v.update(DT, T, eye, false);
  ok(v.stats.redraws === 1 && g.counter.clears === 1, 'shown: the canvas drawn once');
  const names = g.texts.map((t) => t.s);
  ok(names.includes('BANDAGE') && names.some((s) => /Heals a little/.test(s)), `the card reads BANDAGE and its hint (${names.join(' | ')})`);
  const nameT = g.texts.find((t) => t.s === 'BANDAGE');
  const px = parseFloat(/(\d+)px/.exec(nameT.font)[1]);
  ok(px >= 52, `the name is large (${px} px on the canvas)`);
  ok(v.alpha === 1 && v.mesh.visible, 'faded in (0.15 s)');
  for (let i = 0; i < 300; i++) v.update(DT, T, eye, false);
  v.setCard(cardFor(1), 'x', 17); // the same key: no redraw
  for (let i = 0; i < 30; i++) v.update(DT, T, eye, false);
  ok(v.stats.redraws === 1, `300 more frames + the same content again: still ${v.stats.redraws} redraw`);
  // yaw only, facing the eye
  const yaw = Math.atan2(eye.x - T.x, eye.z - T.z);
  ok(Math.abs(v.mesh.rotation.y - yaw) < 1e-9 && v.mesh.rotation.x === 0 && Math.abs(v.mesh.rotation.z) < 0.05, 'billboards about the vertical axis only (x = 0, a settled roll under 3 degrees)');
  const eye2 = { x: 1.5, y: 3.6, z: -1.5 }; // above and to the side
  v.update(DT, T, eye2, true);
  ok(Math.abs(v.mesh.rotation.y - Math.atan2(1.5, 0)) < 1e-9 && v.mesh.rotation.x === 0, 'an eye above it: still only a yaw (it never tips toward the camera or rolls the view)');
  const z0 = v.mesh.rotation.z;
  v.update(DT, T, eye2, true);
  ok(v.mesh.rotation.z === z0, 'reduced effects: no sway');
  // width clamps, a constant minimum angular size
  ok(ItemCardView.widthAt(0.3) === CARD.wmin && ItemCardView.widthAt(50) === CARD.wmax && Math.abs(ItemCardView.widthAt(1.5) - 1.5 * CARD.k) < 1e-9, `width = ${CARD.k} x distance within [${CARD.wmin}, ${CARD.wmax}] m`);
  const ppd = 25; // Quest 3 pixels per degree (centre)
  const pxAt = (d) => {
    const w = ItemCardView.widthAt(d);
    const hM = (px / CARD.cw) * w; // the name's cap height in metres (the canvas is 512 wide)
    return ((Math.atan(hM / d) * 180) / Math.PI) * ppd;
  };
  ok([0.8, 1.2, 1.5, 2].every((d) => pxAt(d) >= 28), `the name stays >= 28 px in VR at 0.8 / 1.2 / 1.5 / 2 m (${[0.8, 1.2, 1.5, 2].map((d) => pxAt(d).toFixed(0)).join(' / ')} px)`);
  const pos = v.geometry.attributes.position.array;
  v.update(DT, Object.assign({}, T), { x: 0, y: 0.5, z: -1.5 + 4 }, false);
  ok(Math.abs(pos[3] - pos[0] - ItemCardView.widthAt(4)) < 1e-6 && Math.abs(pos[13] - CARD.stakeFrom) < 1e-9, 'farther away the card widens; the stake still starts at the prop');
  // a new kind: fade out, redraw once, fade in
  v.setCard(cardFor(3), cardHint(cardFor(3), 'desktop'), 33);
  const T2 = { on: true, kind: 3, id: 'c1', x: 1, y: 0.5, z: -1.5 };
  let minA = 1;
  for (let i = 0; i < 40; i++) {
    v.update(DT, T2, eye, false);
    minA = Math.min(minA, v.alpha);
  }
  ok(v.stats.redraws === 2 && minA === 0 && v.alpha === 1 && g.texts.some((t) => t.s === 'LANTERN') && g.texts.some((t) => t.s === 'BATTERY'), 'a new kind: the old card fades out, the canvas is redrawn once, the new one fades in');
  // the same content on another item: moves (fade) but no redraw
  const T3 = Object.assign({}, T2, { id: 'c2', x: -1 });
  for (let i = 0; i < 40; i++) v.update(DT, T3, eye, false);
  ok(v.stats.redraws === 2 && v.mesh.position.x === -1, 'another item of the same kind: the card moves there without a redraw');
  for (let i = 0; i < 30; i++) v.update(DT, { on: false }, eye, false);
  ok(!v.mesh.visible && v.alpha === 0, 'no target: faded out and hidden (0 draw calls)');
  // a long name wraps to two lines, both >= 46 px
  v.setCard(cardFor(2), cardHint(cardFor(2), 'vr'), 99);
  for (let i = 0; i < 30; i++) v.update(DT, { on: true, kind: 2, id: 'a', x: 0, y: 0, z: -1 }, eye, false);
  const lines = g.texts.filter((t) => t.s === 'ADRENALINE' || t.s === 'SHOT');
  ok(lines.length === 2 && lines.every((t) => parseFloat(/(\d+)px/.exec(t.font)[1]) >= 44), `"ADRENALINE SHOT" wraps to two big lines (${lines.map((t) => t.font).join(', ')})`);
  ok(g.texts.every((t) => t.x >= 0 && t.x < CARD.cw && t.y > 0 && t.y < CARD.rows), 'every text sits on the card (inside the plate rows)');
  // no allocation per frame while shown
  const T4 = { on: true, kind: 2, id: 'a', x: 0, y: 0, z: -1 };
  for (let i = 0; i < 20000; i++) v.update(DT, T4, eye, false);
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 300000; i++) {
    eye.x = Math.sin(i * 0.001) * 2;
    v.update(DT, T4, eye, false);
  }
  const grew = process.memoryUsage().heapUsed - h0;
  ok(grew < 3 * 1024 * 1024, `ItemCardView.update: 300,000 frames with the eye moving, heap +${(grew / 1024).toFixed(0)} KB`);
  let disposed = 0;
  v.texture.addEventListener('dispose', () => disposed++);
  v.material.addEventListener('dispose', () => disposed++);
  v.geometry.addEventListener('dispose', () => disposed++);
  v.dispose();
  ok(disposed === 3 && scene.children.length === 0, 'dispose: texture, material and geometry released, the mesh removed');
}

// ---- the glue (a stand-in game) -------------------------------------------------------------------------------------------------------
{
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  rig.add(camera);
  camera.position.set(0, 1.6, 0);
  const handlers = {};
  const items = [
    { id: 'b', kind: 1, x: 0, y: 0.4, z: -1.5, taken: false },
    { id: 'k', kind: 0, x: 3, y: 0.4, z: -1.5, taken: false },
  ];
  const game = {
    state: 'playing',
    victoryT: -1,
    player: { alive: true },
    settings: { itemCards: true },
    renderer: { scene, rig, camera },
    pickups: { items },
    jet: { enabled: true, fuel: 0.5, cans: [{ id: 'can', x: -3, y: 0.4, z: -1.5, taken: false }] },
    bag: { applying: { active: false }, counts: new Int8Array(5), canAdd: () => true },
    level: null,
    input: { touch: { active: false } },
    bus: { on: (e, f) => (handlers[e] = f) },
  };
  const ic = new ItemCardGlue(game);
  const look = (x, y, z) => {
    // the desktop look: the rig's yaw + the camera's pitch
    const e = new THREE.Vector3(0, 1.6, 0);
    const d = new THREE.Vector3(x, y, z).sub(e);
    rig.rotation.y = Math.atan2(-d.x, -d.z);
    camera.rotation.set(Math.atan2(d.y, Math.hypot(d.x, d.z)), 0, 0);
  };
  const frames = (n) => {
    for (let i = 0; i < n; i++) ic.update(DT);
  };
  look(0, 0.4, -1.5);
  frames(30);
  let s = ic.debugState();
  ok(s.target && s.target.id === 'b' && s.name === 'Bandage' && /press 2/.test(s.hint) && s.view && s.view.visible && s.candidates === 3, `the glue: looking down at the bandage 1.5 m off shows its card (${s.name}: "${s.hint}", ${s.candidates} candidates incl. the fuel can)`);
  ok(scene.getObjectByName('itemCard') && scene.children.length === 1, 'the view is built on first use: one mesh in the scene');
  look(-3, 0.4, -1.5);
  frames(40);
  s = ic.debugState();
  ok(s.target && s.target.kind === FUEL_CARD && s.name === 'Jetpack fuel' && /J in a fall/.test(s.hint), 'the jetpack fuel can has its card too');
  game.xrActive = true;
  frames(40);
  s = ic.debugState();
  ok(/both triggers/.test(s.hint), 'in a headset the hint names the controller input');
  game.xrActive = false;
  game.jet.fuel = 1;
  frames(5);
  ok(/tank is already full/.test(ic.debugState().hint), 'a full tank: the fuel can says so');
  game.jet.fuel = 0.5;
  look(0, 0.4, -1.5);
  frames(40);
  game.bag.applying.active = true;
  frames(1);
  ok(!ic.debugState().target, 'applying an item: no card');
  game.bag.applying.active = false;
  frames(40);
  game.state = 'paused';
  frames(1);
  ok(!ic.debugState().target, 'paused / a menu: no card');
  game.state = 'playing';
  game.opening = {};
  frames(40);
  ok(!ic.debugState().target, 'the opening film: no card');
  game.opening = null;
  game.player.alive = false;
  frames(40);
  ok(!ic.debugState().target, 'dead: no card');
  game.player.alive = true;
  frames(40);
  ok(ic.debugState().target, 'alive and playing again: the card is back');
  items[0].taken = true;
  frames(1);
  ok(!ic.debugState().target, 'the bandage collected: its card goes the same frame');
  items[0].taken = false;
  game.settings.itemCards = false;
  frames(40);
  ok(!ic.debugState().target && ic.debugState().enabled === false, 'the setting off: no card');
  game.settings.itemCards = true;
  // camera never written: the glue reads it only
  const before = [rig.rotation.y, camera.rotation.x, camera.rotation.y, camera.rotation.z, camera.position.x, camera.position.y];
  frames(60);
  const after = [rig.rotation.y, camera.rotation.x, camera.rotation.y, camera.rotation.z, camera.position.x, camera.position.y];
  ok(before.every((v, i) => v === after[i]), 'the glue never moves the rig or the camera');
  // no allocation per frame (the pool, the context, the key)
  for (let i = 0; i < 20000; i++) ic.update(DT);
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 200000; i++) ic.update(DT);
  const grew = process.memoryUsage().heapUsed - h0;
  ok(grew < 3 * 1024 * 1024, `ItemCardGlue.update: 200,000 frames, heap +${(grew / 1024).toFixed(0)} KB (no allocation per frame)`);
  ok(typeof handlers['player:death'] === 'function' && typeof handlers['game:start'] === 'function', 'resets on a new run / restart / menu / death');
  ic.dispose();
}

// ---- the setting and the URL switch -------------------------------------------------------------------------------------------------
{
  ok(SETTINGS_DEFAULTS.itemCards === true, 'settings.itemCards defaults to ON');
  const keys = Object.keys(SETTINGS_DEFAULTS);
  ok(keys.indexOf('itemCards') === keys.indexOf('frameRate') + 1, 'appended at the end of the WP-UX block (after frameRate)');
  const s1 = sanitizeUxSettings(Object.assign({}, SETTINGS_DEFAULTS, { itemCards: false }));
  const s2 = sanitizeUxSettings(JSON.parse(JSON.stringify(s1)));
  const s3 = sanitizeUxSettings(Object.assign({}, SETTINGS_DEFAULTS, { itemCards: 'garbage' }));
  const s4 = sanitizeUxSettings({});
  ok(s1.itemCards === false && s2.itemCards === false && s3.itemCards === true && s4.itemCards === true, 'sanitise: off survives a JSON round trip; junk and a missing key (old saves) are on');
  ok(itemCardsUrlOff('?itemcards=off') && itemCardsUrlOff('?a=1&itemcards=0') && !itemCardsUrlOff('?itemcards=on') && !itemCardsUrlOff(''), '?itemcards=off (or 0) switches them off; anything else leaves the setting in charge');
  ok(itemCardsOn(true, false) && itemCardsOn(undefined, false) && !itemCardsOn(false, false) && !itemCardsOn(true, true), 'on = the setting (default on) and not the URL switch');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
