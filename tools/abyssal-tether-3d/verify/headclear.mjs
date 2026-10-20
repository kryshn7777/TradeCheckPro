// Head clearance audit (player height contract, CONTRACT3D §8 "Rig and eye height").
//
// With true 1:1 scale the head sits `eyeAboveBody()` (VIEW.standEye − radius = 1.24 m) above the collision-sphere
// centre. The bot never sees that point, so this walks every route the harness proves (full runs on every line of
// the fork, section routes, alternate lines, recovery scenarios) and checks the HEAD point on every physics step:
//
//   * head vs every active solid (Level3D.querySolids): the distance to the nearest box surface (0 = inside);
//   * head vs the rope anchor while hanging: the head must stay below the anchor (anchor.y − head.y ≥ margin).
//
//   node tools/abyssal-tether-3d/verify/headclear.mjs [--variant normal|nightmare|abyss|all] [--eye 1.62] [--near 0.1] [--info 0.25] [--json FILE] [--strict]
//
// Prints every spot where the head is inside or within --near metres of geometry (variant, route, section, time,
// solid id, position) and the closest hanging approach to an anchor; --info adds the 'near' list (default 0.25 m).
// Exit code 1 with --strict when any spot is within --near. Not part of verify.mjs's gate list; run it after level data edits.
import fs from 'node:fs';
import { Sim, CONFIG, GAME_ROOT } from './sim.mjs';
import { Bot } from './bot.mjs';
import { CHAPTERS, chapterIds, variantKeys } from './chapters.mjs';
import { argValue, hasFlag } from './root.mjs';
import { srcUrl } from './root.mjs';

const { VIEW } = await import(srcUrl('sim/config3d.js'));

const argv = process.argv.slice(2);
const VARIANTS = variantKeys(argValue(argv, '--variant', 'all'));
const EYE = parseFloat(argValue(argv, '--eye', String(VIEW.standEye)));
const NEAR = parseFloat(argValue(argv, '--near', '0.1'));
const INFO = parseFloat(argValue(argv, '--info', '0.25'));
const HEAD_UP = EYE - CONFIG.player.radius; // head above the sphere centre
const ANCHOR_MARGIN = parseFloat(argValue(argv, '--anchor-margin', '0.1'));
const ANCHOR_REACH = parseFloat(argValue(argv, '--anchor-reach', '0.15'));

/** One finding per (variant, route, solid): the closest approach. */
function makeAudit() {
  return { solids: new Map(), anchors: new Map() };
}

function instrumentHead(sim, tag, audit, level) {
  const scratch = [];
  const phys = sim.physics;
  const step = phys.step;
  const R = INFO + 0.05;
  phys.step = function (...args) {
    const r = step.apply(this, args);
    if (sim.ghost) return r;
    const p = sim.player;
    const hx = p.x;
    const hy = p.y + HEAD_UP;
    const hz = p.z;
    const list = level.querySolids(hx - R, hy - R, hz - R, hx + R, hy + R, hz + R, scratch);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.active === false) continue;
      const dx = hx - Math.min(Math.max(hx, b.minX), b.maxX);
      const dy = hy - Math.min(Math.max(hy, b.minY), b.maxY);
      const dz = hz - Math.min(Math.max(hz, b.minZ), b.maxZ);
      const inside = hx > b.minX && hx < b.maxX && hy > b.minY && hy < b.maxY && hz > b.minZ && hz < b.maxZ;
      const d = inside ? 0 : Math.hypot(dx, dy, dz);
      if (d > INFO) continue;
      const key = `${tag}|${b.id}`;
      const prev = audit.solids.get(key);
      if (!prev || d < prev.d) {
        audit.solids.set(key, {
          tag,
          solid: b.id,
          kind: b.kind,
          section: level.sectionIndexAt(hy),
          d,
          t: +sim.t.toFixed(2),
          head: [+hx.toFixed(2), +hy.toFixed(2), +hz.toFixed(2)],
          body: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
          speed: +Math.hypot(p.vx, p.vy, p.vz).toFixed(1),
          grounded: !!p.grounded,
        });
      }
    }
    // Rope anchors: while a rope is taut the head must not reach the anchor, and when the player hangs (anchor within
    // ~30° of straight up) the head must stay below it. A swing through the horizontal puts the anchor beside the
    // body, where the head is above the anchor's height by nature: that is not hanging and is not flagged.
    for (const h of ['left', 'right']) {
      const rope = sim.tethers.hands[h].rope;
      if (!rope.attached || !rope.anchor) continue;
      const a = rope.anchor;
      const dist = Math.hypot(a.x - p.x, a.y - p.y, a.z - p.z);
      if (dist - rope.length < -0.2) continue; // slack rope: not hanging on it
      const headDist = Math.hypot(a.x - hx, a.y - hy, a.z - hz);
      const hang = (a.y - p.y) / (dist || 1) >= 0.85;
      const gap = a.y - hy; // + = head below the anchor
      const score = hang ? Math.min(gap, headDist) : headDist; // what is worst about this frame
      const key = `${tag}|${a.id}`;
      const prev = audit.anchors.get(key);
      if (!prev || score < prev.score) {
        audit.anchors.set(key, { tag, anchor: a.id, section: level.sectionIndexAt(hy), score, hang, gap, headDist, dist: +dist.toFixed(2), len: +rope.length.toFixed(2), t: +sim.t.toFixed(2), head: [+hx.toFixed(2), +hy.toFixed(2), +hz.toFixed(2)], anchorPos: [a.x, a.y, a.z] });
      }
    }
    return r;
  };
}

function runOne(ch, v, tag, start, route, audit) {
  const level = ch.makeLevel(v);
  const sim = new Sim(level, v, {});
  sim.spawn(start.x, start.y, start.z);
  instrumentHead(sim, tag, audit, level);
  const bot = new Bot(sim, route, {});
  const r = bot.runRoute();
  return { ok: r.ok && r.deaths === 0, r };
}

const all = { eye: EYE, headAboveBody: HEAD_UP, near: NEAR, info: INFO, root: GAME_ROOT, variants: {} };
let worst = Infinity;
let nearCount = 0;
for (const cid of chapterIds(argValue(argv, '--chapter', 'ch1'))) {
  const ch = CHAPTERS[cid];
  const R = ch.routes;
  for (const v of VARIANTS) {
    const audit = makeAudit();
    const level = ch.makeLevel(v);
    const lines = R.FORK ? [[R.FORK.risky, 'risky'], [R.FORK.safe, 'safe']] : [[null, 'main']];
    for (const [line, label] of lines) {
      const route = [];
      for (const k of R.SECTION_ROUTE) for (const st of R.ROUTES[R.FORK && k === R.FORK.key ? line : k]) route.push(st);
      runOne(ch, v, `full-${label}`, level.spawn, route, audit);
    }
    for (const key of Object.keys(R.ROUTES)) runOne(ch, v, `sec-${key}`, level.sections[R.ROUTE_START[key]].checkpoint, R.ROUTES[key], audit);
    for (const [key, route] of Object.entries(R.ALT_ROUTES || {})) runOne(ch, v, `alt-${key}`, level.sections[R.ALT_START[key]].checkpoint, route, audit);
    for (const [name, sc] of Object.entries(R.SCENARIOS || {})) {
      if (!sc.variants.includes(v)) continue;
      const route = typeof sc.route === 'function' ? sc.route(v) : sc.route;
      runOne(ch, v, `scn-${name}`, sc.start(level), route, audit);
    }
    // Collapse tags per solid: keep the closest approach and the list of routes that reach it.
    const bySolid = new Map();
    for (const e of audit.solids.values()) {
      const o = bySolid.get(e.solid);
      if (!o) bySolid.set(e.solid, Object.assign({}, e, { routes: [e.tag] }));
      else {
        o.routes.push(e.tag);
        if (e.d < o.d) Object.assign(o, e, { routes: o.routes });
      }
    }
    const solids = [...bySolid.values()].sort((a, b) => a.d - b.d);
    const bestA = new Map();
    for (const e of audit.anchors.values()) {
      const o = bestA.get(e.anchor);
      if (!o || e.score < o.score) bestA.set(e.anchor, Object.assign({}, e, { routes: o ? o.routes.concat(e.tag) : [e.tag] }));
      else o.routes.push(e.tag);
    }
    const anchors = [...bestA.values()].sort((a, b) => a.score - b.score);
    all.variants[`${cid}/${v}`] = { solids, anchors: anchors.slice(0, 40) };
    console.log(`\n## ${cid} ${v}: head ${EYE.toFixed(2)} m above the feet (${HEAD_UP.toFixed(2)} m above the sphere centre)`);
    const nearList = solids.filter((s) => s.d <= NEAR);
    console.log(`  head inside / within ${NEAR} m of geometry: ${nearList.length} solid(s)`);
    for (const s of nearList) {
      console.log(`   d=${s.d.toFixed(3)} ${s.solid} (${s.kind}) S${s.section + 1} t=${s.t}s head=${s.head} body=${s.body} v=${s.speed} grounded=${s.grounded} [${s.routes.slice(0, 4).join(',')}${s.routes.length > 4 ? ',…' : ''}]`);
    }
    const infoList = solids.filter((s) => s.d > NEAR);
    if (infoList.length) {
      console.log(`  within ${INFO} m (info): ${infoList.length}`);
      for (const s of infoList.slice(0, 20)) console.log(`   d=${s.d.toFixed(3)} ${s.solid} (${s.kind}) S${s.section + 1} t=${s.t}s head=${s.head}`);
    }
    const bad = anchors.filter((a) => (a.hang && a.gap < ANCHOR_MARGIN) || a.headDist < ANCHOR_REACH);
    console.log(`  taut rope: head within ${ANCHOR_REACH} m of its anchor, or (hanging) not ≥ ${ANCHOR_MARGIN} m below it: ${bad.length} anchor(s); closest of all:`);
    for (const a of (bad.length ? bad : anchors.slice(0, 5))) console.log(`   headDist=${a.headDist.toFixed(2)} gap=${a.gap.toFixed(2)} ${a.hang ? 'hanging' : 'swinging'} anchor ${a.anchor} S${a.section + 1} t=${a.t}s head=${a.head} dist=${a.dist} len=${a.len}`);
    for (const s of solids) worst = Math.min(worst, s.d);
    nearCount += nearList.length + bad.length;
  }
}
console.log(`\nclosest head-to-geometry distance over all routes: ${worst === Infinity ? '> ' + INFO : worst.toFixed(3)} m; spots to fix: ${nearCount}`);
const jsonOut = argValue(argv, '--json', null);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(all, null, 1));
process.exitCode = hasFlag(argv, '--strict') && nearCount ? 1 : 0;
