// WP-BAG checks (Node): the bag's apply times, cancel on damage / death / input, capacities, refusals, the adrenaline
// timing and the physics speed multiplier (gravity and fall damage unchanged), the heal API, deterministic and fair
// supply spawns, pickup radius / hand reach / full bag, checkpoint snapshots, the lantern charge, and the VR bag gesture.
//   node unit.mjs [--root DIR]   (prints PASS/FAIL per check, exit 1 on a failure)
import { srcUrl } from '../../verify/root.mjs';
const { CONFIG, DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Health3D, dropSpeed, fallDamage } = await import(srcUrl('sim/health3d.js'));
const { Inventory3D, ITEM, lanternLevel } = await import(srcUrl('sim/inventory3d.js'));
const { Pickups3D, pickSupplies, checkFairness } = await import(srcUrl('sim/pickups3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { makeBagGesture, updateBagGesture, radialSlot, BAG_ZONE } = await import(srcUrl('input/bagGesture.js'));
const B = CONFIG.bag;
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const DT = 1 / 72;
const mk = () => {
  const bus = new EventBus();
  const ev = [];
  for (const t of ['bag:change', 'bag:apply', 'bag:cancel', 'bag:done', 'bag:refuse', 'bag:effect', 'lantern:low', 'lantern:empty', 'health:heal', 'health:recover', 'pickup:collect', 'pickup:full']) bus.on(t, (p) => ev.push([t, p]));
  const health = new Health3D(DIFFICULTY.normal, bus);
  const inv = new Inventory3D(bus);
  return { bus, ev, health, inv };
};
/** Steps the bag for `secs`; returns the time at which `until()` first held (or -1). */
const run = (inv, health, secs, until) => {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    inv.update(DT, health, true);
    if (until && until()) return (i + 1) * DT;
  }
  return -1;
};
const hurt = (health, hp) => {
  health.setHp(hp);
  health.sinceHurt = -1e9; // no regeneration muddies the numbers
  health.regenRate = 0;
};

// 1. Apply times and effects.
{
  const rows = [];
  for (const [kind, name, dur, healBy] of [
    [ITEM.FIRST_AID, 'first aid', 5, 1],
    [ITEM.BANDAGE, 'bandage', 1.5, 0.2],
    [ITEM.ADRENALINE, 'adrenaline', 0.6, 0.1],
  ]) {
    const { health, inv } = mk();
    hurt(health, 0.2);
    inv.add(kind, 1);
    const started = inv.use(kind, health);
    const t = run(inv, health, dur + 1, () => !inv.applying.active);
    const gained = health.hp - 0.2;
    rows.push(`${name} ${t.toFixed(2)} s +${(gained * 100).toFixed(0)}`);
    ok(started && Math.abs(t - dur) <= DT * 1.01 && inv.counts[kind] === 0, `${name}: applies in ${dur} s (took ${t.toFixed(3)} s), the item is consumed`);
    ok(near(gained, Math.min(healBy, 0.8), 1e-9), `${name}: heals ${(healBy * 100).toFixed(0)} hp (capped at full): +${(gained * 100).toFixed(1)}`);
  }
  const { health, inv } = mk();
  inv.lanternCharge = 0.2;
  inv.add(ITEM.BATTERY, 1);
  inv.use(ITEM.BATTERY, health);
  const t = run(inv, health, 2, () => !inv.applying.active);
  ok(Math.abs(t - 1) <= DT * 1.01 && near(inv.lanternCharge, 0.2 + 0.5 - B.lanternDrain * t, 2e-4), `battery: 1 s, +50 % lantern charge (0.20 -> ${inv.lanternCharge.toFixed(3)})`);
  // While applying nothing else starts, and the heal lands only at the end.
  const g = mk();
  hurt(g.health, 0.3);
  g.inv.add(ITEM.FIRST_AID, 1);
  g.inv.add(ITEM.BANDAGE, 1);
  g.inv.use(ITEM.FIRST_AID, g.health);
  run(g.inv, g.health, 4.9);
  ok(near(g.health.hp, 0.3) && g.inv.use(ITEM.BANDAGE, g.health) === false && g.inv.lastRefusal === 'busy', 'first aid heals only when the 5 s are up; a second use is refused while busy');
  ok(g.ev.some((e) => e[0] === 'bag:apply' && e[1].dur === 5), 'bag:apply carries the duration');
}

// 2. The heal API: respects max hp, emits health:heal, nothing when dead or full.
{
  const { health, ev } = mk();
  hurt(health, 0.5);
  const g1 = health.heal(0.2);
  ok(near(g1, 0.2) && near(health.hp, 0.7) && ev.some((e) => e[0] === 'health:heal' && near(e[1].amount, 0.2) && near(e[1].hp, 0.7)), 'heal(0.2) adds 20 hp and emits health:heal {amount, hp}');
  const g2 = health.heal(1);
  ok(near(g2, 0.3) && health.hp === 1, 'heal never exceeds full health (returns the gain actually made)');
  const n = ev.length;
  ok(health.heal(0.5) === 0 && ev.length === n, 'healing at full health gains nothing and emits nothing');
  health.heal(0.3, true);
  const hm = mk();
  hurt(hm.health, 0.4);
  hm.health.heal(0.2, true);
  ok(!hm.ev.some((e) => e[0] === 'health:heal'), 'silent heals (checkpoints) do not emit');
  const d = mk();
  hurt(d.health, 0.1);
  d.health.die();
  ok(d.health.heal(1) === 0 && d.health.hp === 0, 'a dead player cannot be healed');
  const l = mk();
  l.health.damage(0.7, 'fall', 12);
  ok(l.health.low, 'low at 30 hp');
  l.health.heal(0.3);
  ok(!l.health.low && l.ev.some((e) => e[0] === 'health:recover'), 'healing past the low threshold ends the low state (health:recover)');
}

// 3. Cancel: damage, death, input, an inactive run; the item is kept.
{
  for (const [why, fn] of [
    ['damage', (h) => h.damage(0.05, 'fall', 8)],
    ['dead', (h) => h.die()],
    ['cancel', (h, inv) => inv.cancel('cancel')],
  ]) {
    const { health, inv, ev } = mk();
    hurt(health, 0.4);
    inv.add(ITEM.FIRST_AID, 1);
    inv.use(ITEM.FIRST_AID, health);
    run(inv, health, 2);
    const mid = inv.applying.active;
    fn(health, inv);
    inv.update(DT, health, true);
    const c = ev.find((e) => e[0] === 'bag:cancel');
    ok(mid && !inv.applying.active && inv.counts[ITEM.FIRST_AID] === 1 && c && (why === 'cancel' || c[1].reason === why) && health.hp <= 0.4, `cancelled by ${why} after 2 s: the kit is kept, nothing healed`);
  }
  const { health, inv } = mk();
  hurt(health, 0.4);
  inv.add(ITEM.BANDAGE, 1);
  inv.use(ITEM.BANDAGE, health);
  inv.update(DT, health, false);
  ok(!inv.applying.active && inv.counts[ITEM.BANDAGE] === 1, 'an inactive run (paused / dead state) cancels the channel');
  // The fall that hurts you cancels it even when it is the very frame it would complete? Damage first wins.
  const f = mk();
  hurt(f.health, 0.4);
  f.inv.add(ITEM.BANDAGE, 1);
  f.inv.use(ITEM.BANDAGE, f.health);
  run(f.inv, f.health, 1.45);
  f.health.damage(0.05, 'wall', 9);
  f.inv.update(0.2, f.health, true);
  ok(f.inv.counts[ITEM.BANDAGE] === 1 && !f.inv.applying.active, 'damage just before the end still cancels');
}

// 4. Caps and refusals.
{
  const { health, inv } = mk();
  const added = [inv.add(ITEM.FIRST_AID, 5), inv.add(ITEM.BANDAGE, 9), inv.add(ITEM.ADRENALINE, 4), inv.add(ITEM.BATTERY, 7)];
  ok(added.join() === '1,5,2,3' && Array.from(inv.counts).join() === '1,5,2,3', 'bag capacities: first aid 1, bandage 5, adrenaline 2, battery 3');
  ok(!inv.canAdd(ITEM.FIRST_AID) && inv.add(ITEM.FIRST_AID) === 0, 'a full slot takes no more');
  ok(inv.use(ITEM.BANDAGE, health) === false && inv.lastRefusal === 'full', 'no bandage is wasted at full health');
  ok(inv.use(ITEM.BATTERY, health) === false && inv.lastRefusal === 'full', 'no battery is wasted on a full lantern');
  hurt(health, 0.5);
  inv.use(ITEM.ADRENALINE, health);
  run(inv, health, 1);
  ok(inv.adrenaline.active && inv.use(ITEM.ADRENALINE, health) === false && inv.lastRefusal === 'active', 'a second shot while the first works is refused');
  const e = mk();
  ok(e.inv.use(ITEM.BANDAGE, e.health) === false && e.inv.lastRefusal === 'empty', 'an empty slot refuses');
  e.inv.select(3);
  e.inv.cycle(1);
  ok(e.inv.selected === 0, 'cycling wraps 3 -> 0');
  e.inv.cycle(-1);
  ok(e.inv.selected === 3, '... and back');
}

// 5. Adrenaline: +10 hp, x2 for 10 s exactly.
{
  const { health, inv, ev } = mk();
  hurt(health, 0.5);
  inv.add(ITEM.ADRENALINE, 1);
  inv.use(ITEM.ADRENALINE, health);
  const inj = run(inv, health, 2, () => inv.adrenaline.active);
  ok(Math.abs(inj - 0.6) <= DT * 1.01 && near(health.hp, 0.6) && inv.speedMul === 2, `adrenaline: injection 0.6 s, +10 hp, speed x2 (at ${inj.toFixed(2)} s)`);
  const t0 = inj;
  const off = run(inv, health, 12, () => !inv.adrenaline.active);
  ok(Math.abs(off - 10) <= DT * 1.5 && inv.speedMul === 1 && ev.some((e) => e[0] === 'bag:effect' && e[1].on === false), `the boost lasts 10 s (ended after ${off.toFixed(2)} s) and the multiplier returns to 1`);
  inv.add(ITEM.ADRENALINE, 1);
  inv.use(ITEM.ADRENALINE, health);
  run(inv, health, 0.7);
  inv.restore();
  ok(inv.speedMul === 1 && !inv.adrenaline.active && t0 > 0, 'a respawn (restore) clears the effect');
}

// 6. Physics: x2 on run / air speed caps and acceleration; gravity and fall damage unchanged.
{
  const level = new Level3D(undefined, 'normal');
  const run1 = (mul) => {
    const bus = new EventBus();
    const ph = new Physics3D(level, DIFFICULTY.normal, bus);
    const th = new TetherSystem(level, DIFFICULTY.normal, bus, {});
    const p = new Player3D(-4, 0.4, 8.5);
    for (let i = 0; i < 100; i++) ph.step(p, th, {}, CONFIG.PHYSICS_DT);
    p.speedMul = mul;
    let peak = 0;
    let t60 = 0;
    for (let i = 0; i < 360; i++) {
      ph.step(p, th, { move: { x: -1, z: 0 } }, CONFIG.PHYSICS_DT);
      peak = Math.max(peak, Math.hypot(p.vx, p.vz));
      if (i === 23) t60 = Math.hypot(p.vx, p.vz);
    }
    return { peak, t60, grounded: p.grounded };
  };
  const a = run1(1);
  const b = run1(2);
  ok(near(a.peak, CONFIG.player.runMaxSpeed, 0.05) && near(b.peak, CONFIG.player.runMaxSpeed * 2, 0.1), `run speed cap x2: ${a.peak.toFixed(2)} -> ${b.peak.toFixed(2)} m/s`);
  ok(b.t60 > a.t60 * 1.35, `acceleration is higher too (after 0.1 s: ${a.t60.toFixed(2)} -> ${b.t60.toFixed(2)} m/s)`);
  const fall = (mul) => {
    const bus = new EventBus();
    const ph = new Physics3D(level, DIFFICULTY.normal, bus);
    const th = new TetherSystem(level, DIFFICULTY.normal, bus, {});
    const p = new Player3D(-4, 2, -7);
    p.speedMul = mul;
    for (let i = 0; i < 240 * 0.5; i++) ph.step(p, th, {}, CONFIG.PHYSICS_DT);
    return { vy: p.vy, dmg: ph.health.totalDamage };
  };
  const f1 = fall(1);
  const f2 = fall(2);
  ok(near(f1.vy, f2.vy, 1e-9), `gravity is unchanged (vy ${f1.vy.toFixed(3)} = ${f2.vy.toFixed(3)} after 0.5 s)`);
  const land = (mul) => {
    const bus = new EventBus();
    const ph = new Physics3D(level, DIFFICULTY.normal, bus);
    const th = new TetherSystem(level, DIFFICULTY.normal, bus, {});
    const p = new Player3D(-4, 0.4 + 5, -7); // a ~5 m drop onto the sill? the sill is 5 m below the lip
    p.speedMul = mul;
    for (let i = 0; i < 240 * 3; i++) ph.step(p, th, {}, CONFIG.PHYSICS_DT);
    return ph.health.totalDamage;
  };
  ok(near(land(1), land(2), 1e-9), `fall damage is unchanged by the boost (${(land(1) * 100).toFixed(1)} hp either way)`);
  ok(near(fallDamage(dropSpeed(5), 17, 0.35), fallDamage(dropSpeed(5), 17, 0.35)), 'fall damage curve untouched');
}

// 7. Supplies: authored data, deterministic seeded picks, ~1/3, rarity, caps and the fairness guarantees.
{
  const level = new Level3D(undefined, 'normal');
  const sup = LEVEL_DATA_3D.supplies;
  const perSec = level.sections.map(() => 0);
  for (const s of sup) perSec[level.sectionIndexAt(s.y)]++;
  ok(Array.isArray(sup) && perSec.every((n) => n >= 6 && n <= 10), `supplies authored: ${sup.length} spots, ${perSec.join('/')} per section (6-10 each)`);
  const spots = sup.map((s) => ({ x: s.x, y: s.y, z: s.z, section: level.sectionIndexAt(s.y), tier: s.tier, w: s.w }));
  const a = pickSupplies(spots, 12345, { sections: 8 });
  const b = pickSupplies(spots, 12345, { sections: 8 });
  const c = pickSupplies(spots, 12346, { sections: 8 });
  ok(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c), 'the same seed gives the same supplies, another seed another layout');
  const kinds = [0, 0, 0, 0];
  let total = 0;
  let unfair = 0;
  let maxFA = 0;
  let faPerSecMax = 0;
  let adrPerSecMax = 0;
  let minPerSec = 99;
  let maxPerSec = 0;
  const N = 400;
  for (let seed = 1; seed <= N; seed++) {
    const p = pickSupplies(spots, seed * 7919, { sections: 8 });
    total += p.length;
    if (checkFairness(spots, p, 8).length) unfair++;
    const fa = [0, 0, 0, 0, 0, 0, 0, 0];
    const ad = [0, 0, 0, 0, 0, 0, 0, 0];
    const cnt = [0, 0, 0, 0, 0, 0, 0, 0];
    let faTotal = 0;
    for (const e of p) {
      kinds[e.kind]++;
      cnt[spots[e.spot].section]++;
      if (e.kind === ITEM.FIRST_AID) {
        fa[spots[e.spot].section]++;
        faTotal++;
      }
      if (e.kind === ITEM.ADRENALINE) ad[spots[e.spot].section]++;
    }
    maxFA = Math.max(maxFA, faTotal);
    faPerSecMax = Math.max(faPerSecMax, ...fa);
    adrPerSecMax = Math.max(adrPerSecMax, ...ad);
    minPerSec = Math.min(minPerSec, ...cnt);
    maxPerSec = Math.max(maxPerSec, ...cnt);
  }
  const mean = total / N;
  ok(mean > sup.length * 0.28 && mean < sup.length * 0.42, `about a third of the spots hold an item: ${mean.toFixed(1)} of ${sup.length}`);
  ok(unfair === 0, `fairness: a battery in every group of three sections and a healing item in each half, in all ${N} seeds`);
  ok(kinds[ITEM.BANDAGE] > kinds[ITEM.ADRENALINE] && kinds[ITEM.BATTERY] > kinds[ITEM.ADRENALINE] && kinds[ITEM.ADRENALINE] > kinds[ITEM.FIRST_AID], `rarity: bandage ${kinds[1]}, battery ${kinds[3]} > adrenaline ${kinds[2]} > first aid ${kinds[0]}`);
  ok(maxFA <= B.maxFirstAid && faPerSecMax <= 1 && adrPerSecMax <= 1, `at most ${B.maxFirstAid} first aid kits a run and one first aid / one adrenaline per section (max ${maxFA})`);
  ok(minPerSec >= 1 && maxPerSec <= 5, `${minPerSec}-${maxPerSec} items per section`);
  // Pickups3D reproduces the same run from the same seed.
  const bus = new EventBus();
  const p1 = new Pickups3D(level, bus);
  p1.reset(777);
  const p2 = new Pickups3D(level, bus);
  p2.reset(777);
  ok(p1.items.length > 10 && JSON.stringify(p1.items.map((i) => [i.id, i.kind])) === JSON.stringify(p2.items.map((i) => [i.id, i.kind])), `Pickups3D.reset(seed) is deterministic (${p1.items.length} items)`);
}

// 8. Pickup radius, hand reach, a full bag, checkpoint snapshots.
{
  const level = new Level3D(undefined, 'normal');
  const bus = new EventBus();
  const ev = [];
  bus.on('pickup:collect', (e) => ev.push(['collect', e]));
  bus.on('pickup:full', (e) => ev.push(['full', e]));
  const pk = new Pickups3D(level, bus);
  pk.reset(5);
  pk.items.length = 0;
  const inv = new Inventory3D(bus);
  const P = { x: 0, y: 0, z: 0 };
  pk.spawnAt(ITEM.BANDAGE, 0.91, 0, 0);
  pk.update(DT, P, inv);
  ok(inv.counts[ITEM.BANDAGE] === 0, 'an item 0.91 m away is not collected');
  pk.items[0].x = 0.89;
  pk.update(DT, P, inv);
  ok(inv.counts[ITEM.BANDAGE] === 1 && pk.items[0].taken && ev.some((e) => e[0] === 'collect' && e[1].kind === ITEM.BANDAGE), 'an item 0.89 m away is collected by walking / swinging through (0.9 m)');
  pk.spawnAt(ITEM.BATTERY, 3, 0, 0);
  const hand = { x: 3.3, y: 0, z: 0, grip: 0.2, ok: true };
  pk.update(DT, P, inv, hand, null);
  ok(inv.counts[ITEM.BATTERY] === 0, 'a hand within 0.35 m without the grip does not collect');
  hand.grip = 0.9;
  hand.x = 3.4;
  pk.update(DT, P, inv, hand, null);
  ok(inv.counts[ITEM.BATTERY] === 0, 'a hand 0.4 m away with the grip does not collect');
  hand.x = 3.3;
  pk.update(DT, P, inv, hand, null);
  ok(inv.counts[ITEM.BATTERY] === 1 && ev.some((e) => e[0] === 'collect' && e[1].hand === 1), 'a hand within 0.35 m with the grip collects (hand reach)');
  // full bag: stays, one pickup:full per approach
  inv.add(ITEM.FIRST_AID, 1);
  pk.spawnAt(ITEM.FIRST_AID, 0.5, 0, 0);
  for (let i = 0; i < 5; i++) pk.update(DT, P, inv);
  ok(inv.counts[ITEM.FIRST_AID] === 1 && !pk.items[2].taken && ev.filter((e) => e[0] === 'full').length === 1, 'a full slot leaves the pickup lying there and says so once');
  P.x = 5;
  pk.update(DT, P, inv);
  P.x = 0;
  pk.update(DT, P, inv);
  ok(ev.filter((e) => e[0] === 'full').length === 2, '... and again on the next approach');
  // checkpoint snapshot / respawn
  const pk2 = new Pickups3D(level, bus);
  pk2.reset(9);
  pk2.items.length = 0;
  const inv2 = new Inventory3D(bus);
  pk2.spawnAt(ITEM.BANDAGE, 0, 0, 0);
  pk2.spawnAt(ITEM.BANDAGE, 10, 0, 0);
  pk2.update(DT, { x: 0, y: 0, z: 0 }, inv2);
  inv2.snapshot();
  pk2.snapshot();
  pk2.update(DT, { x: 10, y: 0, z: 0 }, inv2);
  inv2.lanternCharge = 0.3;
  ok(inv2.counts[ITEM.BANDAGE] === 2 && pk2.remaining === 0, 'two bandages collected (one before the checkpoint, one after)');
  inv2.restore();
  pk2.restore();
  ok(inv2.counts[ITEM.BANDAGE] === 1 && pk2.items[0].taken && !pk2.items[1].taken && near(inv2.lanternCharge, 1), 'a respawn restores the checkpoint bag and puts the later pickup back');
  inv2.add(ITEM.FIRST_AID, 1);
  inv2.reset();
  ok(inv2.total === 0 && inv2.lanternCharge === 1, 'a new run empties the bag and refills the lantern');
}

// 9. Lantern charge: drain, never dark, low warning, battery.
{
  const { health, inv, ev } = mk();
  let low = -1;
  let empty = -1;
  let prevF = 2;
  let monotone = true;
  let t = 0;
  for (let i = 0; i < 1500 * 10; i++) {
    inv.update(0.1, health, true);
    t += 0.1;
    if (inv.lanternFactor > prevF + 1e-12) monotone = false;
    prevF = inv.lanternFactor;
    if (low < 0 && inv.lanternLow) low = t;
    if (empty < 0 && inv.lanternCharge <= 0) empty = t;
  }
  ok(inv.lanternCharge === 0 && empty > 1200 && empty <= 1500, `a 25-minute descent without batteries ends dark of charge (empty after ${(empty / 60).toFixed(1)} min)`);
  ok(inv.lanternFactor === B.lanternFloor && lanternLevel(0) === B.lanternFloor && lanternLevel(1) === 1 && lanternLevel(-1) === B.lanternFloor, 'the lantern never goes dark: 25 % light at zero charge');
  ok(monotone && lanternLevel(0.6) === 1 && lanternLevel(0.3) > 0.5 && lanternLevel(0.3) < 0.9, 'the light falls smoothly below 60 % charge');
  ok(near(low, (1 - B.lanternLow) / B.lanternDrain, 0.2) && ev.filter((e) => e[0] === 'lantern:low').length === 1 && ev.filter((e) => e[0] === 'lantern:empty').length === 1, `low-battery warning once at 15 % (after ${(low / 60).toFixed(1)} min), empty once`);
  inv.add(ITEM.BATTERY, 2);
  inv.use(ITEM.BATTERY, health);
  run(inv, health, 1.2);
  ok(inv.lanternCharge > 0.49 && inv.lanternCharge < 0.51 && !inv.lanternLow && inv.lanternFactor > 0.9, `a battery on an empty lantern: 50 % charge (${(inv.lanternCharge * 100).toFixed(1)} %), bright again`);
  const paused = inv.lanternCharge;
  inv.update(100, health, false);
  ok(inv.lanternCharge === paused, 'the charge does not drain while the run is not live');
}

// 10. The VR bag gesture.
{
  const g = makeBagGesture();
  const counts = Int8Array.from([1, 3, 2, 3]);
  const S = { live: true, applying: false, hx: 0, hy: 1.7, hz: 0, yaw: 0, hands: [{ ok: true, x: -0.3, y: 1.4, z: -0.3, grip: 0 }, { ok: true, x: 0.5, y: 1.4, z: -0.3, grip: 0 }], counts };
  updateBagGesture(g, S);
  ok(g.zone === -1 && !g.entered && near(g.px, BAG_ZONE.right) && near(g.py, 1.7 - BAG_ZONE.down), 'the bag zone sits 0.22 m right and 0.45 m below the head (yaw 0)');
  S.hands[1].x = 0.25;
  S.hands[1].y = 1.3;
  S.hands[1].z = 0.05;
  updateBagGesture(g, S);
  ok(g.zone === 1 && g.entered, 'a hand within 0.25 m of the zone enters it (edge)');
  updateBagGesture(g, S);
  ok(!g.entered, '... once');
  S.hands[1].grip = 1;
  updateBagGesture(g, S);
  ok(g.open && g.hand === 1 && g.gripping && near(g.ax, 0.25), 'grip in the zone opens the radial at the hand');
  S.hands[1].x = 0.25 + 0.1; // to the right: adrenaline (slot 2)
  updateBagGesture(g, S);
  ok(g.hover === 2, 'moving the hand right hovers the adrenaline shot');
  S.hands[1].grip = 0;
  updateBagGesture(g, S);
  ok(g.chosen === 2 && !g.open, 'releasing the grip chooses it');
  S.hands[1].x = 0.25;
  S.hands[1].grip = 1;
  updateBagGesture(g, S);
  S.hands[1].y = 1.3 + 0.1; // up: bandage
  updateBagGesture(g, S);
  ok(g.hover === 1, 'up hovers the bandage');
  S.hands[1].y = 1.3 - 0.1;
  updateBagGesture(g, S);
  ok(g.hover === 3, 'down hovers the battery');
  S.hands[1].x = 0.25 - 0.1;
  S.hands[1].y = 1.3;
  updateBagGesture(g, S);
  ok(g.hover === 0, 'left hovers the first aid kit');
  counts[0] = 0;
  updateBagGesture(g, S);
  ok(g.hover === -1, 'an empty slot cannot be chosen');
  counts[0] = 1;
  S.hands[1].x = 0.25;
  updateBagGesture(g, S);
  S.hands[1].grip = 0;
  updateBagGesture(g, S);
  ok(g.chosen === -1 && !g.open, 'releasing without pointing just closes it');
  S.applying = true;
  S.hands[1].grip = 1;
  updateBagGesture(g, S);
  ok(g.cancel && !g.open, 'grip at the bag while applying cancels the apply');
  S.applying = false;
  S.hands[1].grip = 0;
  updateBagGesture(g, S);
  const yawed = { ...S, yaw: Math.PI / 2, hands: [{ ok: false, x: 0, y: 0, z: 0, grip: 0 }, { ok: true, x: -0.05, y: 1.3, z: -0.22, grip: 0 }] };
  // yaw pi/2 faces -X: right = (cos, 0, -sin) = (0, 0, -1): the zone is at z = -0.22
  const g2 = makeBagGesture();
  updateBagGesture(g2, yawed);
  ok(near(g2.pz, -BAG_ZONE.right, 1e-9) && g2.zone === 1, 'the zone follows the head yaw');
  ok(radialSlot(0.02, 0.02) === -1 && radialSlot(-0.1, 0.02) === 0 && radialSlot(0.1, -0.02) === 2 && radialSlot(0.01, 0.1) === 1 && radialSlot(0, -0.1) === 3, 'radial sectors: left aid kit, up bandage, right adrenaline, down battery, a dead centre');
  S.live = false;
  S.hands[1].grip = 1;
  updateBagGesture(g, S);
  ok(!g.open && g.zone === -1, 'the gesture is inert when the run is not live');
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
