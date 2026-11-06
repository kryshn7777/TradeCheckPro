// MASON_STRIKES.md (Node): what a creature hit costs. 0.30 a Mason strike / 0.10 a skitterling bite, single-sourced in config3d
// (STRIKE_DAMAGE, read by the skitterling table and PlayerHits), the same on every difficulty; the player:hit payload after the
// health:damage; no kill on a survivable hit; the devour death ('creature', killer mason) at hp 0 from four strikes and the bitten
// one from ten bites; game.js wires it (no physics.kill on a connect, the bite path through PlayerHits); god mode takes nothing.
//   node strike-damage.mjs [--root DIR]
import fs from 'node:fs';
import { srcUrl, SRC_DIR } from '../../verify/root.mjs';
const { DIFFICULTY, EventBus, STRIKE_DAMAGE } = await import(srcUrl('sim/config3d.js'));
const { Health3D } = await import(srcUrl('sim/health3d.js'));
const { PlayerHits } = await import(srcUrl('sim/playerHits.js'));
const { skitterDamage } = await import(srcUrl('sim/skitter3d.js'));
const { CREATURE_VARIANTS } = await import(srcUrl('sim/creature3d.js'));
const { restoreKiller } = await import(srcUrl('sim/comms3d.js'));
const { sceneKind } = await import(srcUrl('sim/deathScene.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const KEYS = ['normal', 'nightmare', 'abyss'];
const near = (a, b) => Math.abs(a - b) < 1e-9;

function world(key) {
  const bus = new EventBus();
  const ev = [];
  for (const e of ['health:damage', 'player:hit', 'player:down']) bus.on(e, (p) => ev.push({ type: e, p }));
  const health = new Health3D(DIFFICULTY[key], bus);
  const H = new PlayerHits(bus);
  const w = { bus, ev, health, H, killed: [] };
  w.ctx = { health, level: null, gripping: false, god: false, kill: (cause) => w.killed.push(cause) };
  w.p = { x: 0, y: 0.38, z: 0, vx: 0, vy: 0, vz: 0, alive: true, grounded: true, climbing: false, radius: 0.38 };
  w.clear = () => {
    // stand up and drop the immunity between hits (the test looks at the damage only)
    H.reset();
  };
  return w;
}

// ---- 1. the numbers, single-sourced -------------------------------------------------------------------------------------------
ok(STRIKE_DAMAGE.mason === 0.3 && STRIKE_DAMAGE.skitter === 0.1 && Object.isFrozen(STRIKE_DAMAGE), 'config3d STRIKE_DAMAGE: mason 0.30, skitter 0.10 (frozen)');
ok(KEYS.every((k) => skitterDamage(k) === STRIKE_DAMAGE.skitter && CREATURE_VARIANTS.skitterling.hitDamage[k] === STRIKE_DAMAGE.skitter), 'the skitterling table reads it: 0.10 on Normal / Nightmare / Abyss');
ok(DIFFICULTY.sandbox.creature.enabled === false, 'Sandbox: no creature at all');

// ---- 2. a Mason strike ---------------------------------------------------------------------------------------------------------
for (const k of KEYS) {
  const w = world(k);
  const src = { x: 3, y: 2, z: 4 };
  const r = w.H.mason(src, w.p, w.ctx);
  const dmg = w.ev.find((e) => e.type === 'health:damage');
  const hit = w.ev.find((e) => e.type === 'player:hit');
  const order = w.ev.findIndex((e) => e.type === 'health:damage') < w.ev.findIndex((e) => e.type === 'player:hit');
  const good =
    r === 'hit' && near(w.health.hp, 0.7) && w.killed.length === 0 && dmg && dmg.p.cause === 'creature' && near(dmg.p.amount, 0.3) && !dmg.p.lethal && order &&
    hit.p.source === 'mason' && near(hit.p.amount, 0.3) && near(hit.p.hp, 0.7) && hit.p.x === 3 && hit.p.y === 2 && hit.p.z === 4 && near(hit.p.dx, -0.6) && near(hit.p.dz, -0.8) && hit.p.down === true;
  ok(good, `${k}: a strike at full hp: health:damage {creature, 0.30} then player:hit {mason, 0.30, hp 0.70, the attacker, dx dz (-0.6, -0.8), down}, no kill`);
  // four from full: 0.70 / 0.40 / 0.10 / dead
  const hp = [w.health.hp];
  for (let i = 0; i < 3; i++) {
    w.clear();
    w.H.mason(src, w.p, w.ctx);
    hp.push(w.health.hp);
  }
  const last = w.ev.filter((e) => e.type === 'player:hit').pop();
  ok(near(hp[1], 0.4) && Math.abs(hp[2] - 0.1) < 1e-9 && hp[3] === 0 && w.killed.length === 1 && w.killed[0] === 'creature' && last.p.down === false && last.p.hp === 0, `${k}: four strikes from full: ${hp.map((v) => v.toFixed(2)).join(' / ')}, the 4th kills ('creature'), its player:hit has down false`);
}
// the killer of a 'creature' death after a Mason strike is the Mason (the devour scene), after a bite within 2 s the skitterling
ok(restoreKiller('creature', 'creature', 0.1) === 'mason' && restoreKiller('creature', 'skitter', 0.5) === 'skitter', "the killer: a strike's 'creature' damage -> mason (devour), a bite's 'skitter' -> skitter (bitten)");
ok(sceneKind('creature', 'mason') === 'devour', 'the death scene of a Mason kill is the devour');

// ---- 3. a skitterling bite -----------------------------------------------------------------------------------------------------
{
  const w = world('nightmare');
  const r = w.H.skitter(skitterDamage('nightmare'), { x: 1, y: 0, z: 0 }, w.p, w.ctx);
  const hit = w.ev.find((e) => e.type === 'player:hit');
  const dmg = w.ev.find((e) => e.type === 'health:damage');
  ok(r === 'hit' && near(w.health.hp, 0.9) && dmg.p.cause === 'skitter' && hit.p.source === 'skitter' && hit.p.down === false && near(w.H.knock.stagger, 0.35) && !w.H.knock.active, 'a bite: 0.10, health:damage {skitter}, player:hit {skitter, down false}, a 0.35 s stumble, no fall');
  let n = 1;
  while (w.killed.length === 0 && n < 20) {
    w.clear();
    w.H.skitter(0.1, { x: 1, y: 0, z: 0 }, w.p, w.ctx);
    n++;
  }
  ok(n === 10 && w.health.hp === 0 && w.killed[0] === 'creature', `ten bites kill exactly (${n}), the existing bite death ('creature' + the skitter damage cause)`);
}

// ---- 4. immunity, god mode, a dead player --------------------------------------------------------------------------------------
{
  const w = world('normal');
  w.H.mason(null, w.p, w.ctx);
  ok(w.H.mason(null, w.p, w.ctx) === 'immune' && w.H.skitter(0.1, null, w.p, w.ctx) === 'immune' && near(w.health.hp, 0.7), 'immune after a strike: neither a strike nor a bite lands');
  const g = world('normal');
  g.health.god = true;
  ok(g.H.mason(null, g.p, g.ctx) === '' && g.health.hp === 1 && g.ev.length === 0, 'god mode: no damage, no events');
  const d = world('normal');
  d.p.alive = false;
  ok(d.H.mason(null, d.p, d.ctx) === '' && d.ev.length === 0, 'a dead player takes nothing');
}

// ---- 5. game.js: the wiring -----------------------------------------------------------------------------------------------------
{
  const src = fs.readFileSync(SRC_DIR + '/game.js', 'utf8');
  ok(/if \(c\.caughtPlayer\) \{\s*c\.caughtPlayer = false;[^]*?hits\.mason\(/.test(src), 'game.js: a Mason connect -> PlayerHits.mason');
  ok(!/c\.caughtPlayer = false;\s*if \(this\.player\.alive && this\.state === 'playing'\) this\.physics\.kill/.test(src), 'game.js: no physics.kill on a connect any more');
  ok(/this\.hits\.skitter\(dmg, g\.lastBite/.test(src) && !/h\.damage\(dmg, 'skitter', 0\)/.test(src), 'game.js: the skitterling bites go through PlayerHits.skitter (with the biter)');
  ok(/this\.knock = this\.hits\.knock/.test(src), 'game.js: game.knock is the Knockdown');
  ok(/c\.immune = hits\.immune/.test(src), 'game.js: the Mason reads the immunity every frame');
  ok(/this\.hits\.applyIntent\(si\)/.test(src), 'game.js: the control lock goes through the step intent');
  ok(/'dressed'\)/.test(src) && /h\.damage\(dmg, 'holdfast', 0\)/.test(src), 'game.js: the Dresser and the Holdfast unchanged');
}

console.log(fails ? `${fails} FAILED` : 'ALL STRIKE DAMAGE CHECKS PASS');
process.exitCode = fails ? 1 : 0;
