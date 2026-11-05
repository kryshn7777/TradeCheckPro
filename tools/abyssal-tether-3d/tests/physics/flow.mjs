// SWING CHAINS (sim/flow3d.js), Node: synthetic bus sequences.
//   - left / right transfers in the air above 5 m/s link (n counts, flow:link per link), the release window is 1.2 s;
//   - too slow, too late, on the ground: no link; a landing / a hold / a death ends the chain (flow:end once, scored only from
//     4 links and 1 m of net descent);
//   - anti-farming: the same hook again / a two-hook ping-pong does not link, a chain without descent pays nothing;
//   - the 4+ reward: +0.03 per link through lantern.addCharge, at most +0.15 per chain; none without a lantern;
//   - Inventory3D.addCharge clamps to full and clears the low flag; the flare rises and decays.
//   node flow.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
import { srcUrl } from '../../verify/root.mjs';
const { EventBus } = await import(srcUrl('sim/config3d.js'));
const { Flow3D, FLOW } = await import(srcUrl('sim/flow3d.js'));
const { Inventory3D } = await import(srcUrl('sim/inventory3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

function rig(withLantern = true) {
  const bus = new EventBus();
  const player = { y: 100, grounded: false, climbing: false };
  const flow = new Flow3D(bus, player);
  const added = [];
  if (withLantern) flow.lantern = { addCharge: (k) => added.push(k) };
  const ev = [];
  for (const t of ['flow:link', 'flow:end']) bus.on(t, (e) => ev.push([t, e]));
  let id = 0;
  const A = (x, y = 100, z = 0) => ({ id: 'a' + id++, x, y, z });
  const attach = (hand, anchor, speed = 8, previous = null) => bus.emit('grapple:attach', { hand, anchor, x: anchor.x, y: anchor.y, z: anchor.z, speed, previous });
  const release = (hand, reason = 'input') => bus.emit('grapple:release', { hand, reason });
  const step = (s) => {
    for (let i = 0; i < Math.round(s * 60); i++) flow.step(1 / 60);
  };
  // a swing step: the other line comes off, a short flight, the next line bites; the body drops `dy` m
  const swing = (hand, anchor, dy = 1, gap = 0.3, speed = 8) => {
    release(hand === 'left' ? 'right' : 'left');
    step(gap);
    player.y -= dy;
    attach(hand, anchor, speed);
  };
  return { bus, player, flow, added, ev, A, attach, release, step, swing };
}
const links = (r) => r.ev.filter((e) => e[0] === 'flow:link');
const ends = (r) => r.ev.filter((e) => e[0] === 'flow:end');

// 1. a left / right chain counts
{
  const r = rig();
  r.attach('right', r.A(0)); // the first line: the chain begins, no link
  ok(r.flow.n === 0 && r.flow.active, 'the first line begins a chain without a link');
  r.attach('left', r.A(6), 8); // the right line is still on: a link
  ok(r.flow.n === 1 && links(r).length === 1 && links(r)[0][1].n === 1 && links(r)[0][1].hand === 'left', 'a second line while the first holds: link 1');
  const hands = ['right', 'left'];
  for (let i = 0; i < 5; i++) r.swing(hands[i % 2], r.A(12 + 6 * i));
  ok(r.flow.n === 6 && links(r).map((e) => e[1].n).join() === '1,2,3,4,5,6', 'five more swing transfers: links 2..6 in order');
  ok(r.flow.flare > 0, 'a link flares the lantern');
  r.player.grounded = true;
  r.step(1 / 60);
  ok(ends(r).length === 1 && ends(r)[0][1].n === 6 && ends(r)[0][1].reason === 'land' && ends(r)[0][1].scored === true, 'standing on the ground ends it: flow:end {n: 6, land, scored}');
  ok(r.flow.n === 0 && !r.flow.active && r.flow.best === 6 && r.flow.links === 6 && r.flow.chains === 1, 'counters: best 6, links 6, one scored chain');
  r.step(2);
  ok(r.flow.flare === 0, 'the flare decays to 0');
}

// 2. what does not link
{
  const r = rig();
  r.attach('right', r.A(0));
  r.attach('left', r.A(6), 4); // 4 m/s: too slow
  ok(r.flow.n === 0, 'a transfer at 4 m/s does not link');
  r.attach('right', r.A(12), 8, { id: 'old' }); // re-hook without letting go (previous set): a link
  ok(r.flow.n === 1, 're-hooking a hand without letting go (previous) links');
  r.release('right');
  r.release('left');
  r.step(1.3);
  ok(ends(r).length === 1 && ends(r)[0][1].reason === 'fall' && !ends(r)[0][1].scored, 'no line for 1.3 s: the chain ends (fall), unscored');
  r.attach('left', r.A(20));
  r.release('left');
  r.step(1.25);
  r.attach('right', r.A(26));
  ok(r.flow.n === 0, 'a line 1.25 s after the release does not link');
  r.release('right');
  r.step(1.0);
  r.attach('left', r.A(32));
  ok(r.flow.n === 1, 'a line 1.0 s after the release links');
  r.player.grounded = true;
  r.attach('right', r.A(40));
  ok(r.flow.n === 0 && ends(r).length === 2, 'a line shot from the ground: no link, the chain ends');
}

// 3. landing / grab / death reset
{
  const r = rig();
  r.attach('right', r.A(0));
  r.attach('left', r.A(6));
  r.swing('right', r.A(12));
  ok(r.flow.n === 2, 'two links');
  r.bus.emit('player:land', { impact: 3 });
  ok(r.flow.n === 0 && ends(r)[0][1].reason === 'land' && !ends(r)[0][1].scored, 'player:land ends it (2 links: not scored)');
  r.attach('right', r.A(20));
  r.attach('left', r.A(26));
  r.bus.emit('climb:grab', { hand: 'left' });
  ok(r.flow.n === 0 && ends(r)[1][1].reason === 'grab', 'climb:grab ends it');
  r.attach('right', r.A(30));
  r.attach('left', r.A(36));
  r.bus.emit('player:death', { cause: 'impact' });
  ok(r.flow.n === 0 && ends(r)[2][1].reason === 'death', 'player:death ends it');
  r.attach('right', r.A(50));
  r.bus.emit('player:land', {});
  ok(r.flow.active && r.flow.n === 0 && ends(r).length === 3, 'a landing before any link keeps the started chain (the swing off a ledge) and emits nothing');
}

// 4. anti-farming
{
  const r = rig();
  const a = r.A(0);
  r.attach('right', a);
  for (let i = 0; i < 6; i++) r.swing(i % 2 ? 'right' : 'left', a);
  ok(r.flow.n === 0, 'the same hook again and again: no links');
  const r2 = rig();
  const p = r2.A(0);
  const q = r2.A(6);
  r2.attach('right', p);
  for (let i = 0; i < 8; i++) r2.swing(i % 2 ? 'right' : 'left', i % 2 ? p : q);
  ok(r2.flow.n === 1, 'a two-hook ping-pong links once');
  const r3 = rig();
  r3.attach('right', r3.A(0));
  r3.attach('left', { id: 'other-id', x: 0.5, y: 100, z: 0.5 });
  ok(r3.flow.n === 0, 'a different anchor id within 1.5 m of the last one counts as the same hook');
  const r4 = rig();
  r4.attach('right', r4.A(0));
  for (let i = 0; i < 8; i++) r4.swing(i % 2 ? 'right' : 'left', r4.A(6 + 6 * i), 0); // level: no descent
  ok(r4.flow.n === 8 && r4.added.length === 0, 'eight links with no descent: counted, but no charge paid');
  r4.player.grounded = true;
  r4.step(1 / 60);
  ok(ends(r4)[0][1].n === 8 && ends(r4)[0][1].scored === false, '... and the chain is not scored');
}

// 5. the reward and its cap
{
  const r = rig();
  r.attach('right', r.A(0));
  for (let i = 0; i < 3; i++) r.swing(i % 2 ? 'right' : 'left', r.A(6 + 6 * i));
  ok(r.flow.n === 3 && r.added.length === 0, 'links 1..3 pay nothing');
  r.swing('right', r.A(30));
  ok(r.added.length === 1 && near(r.added[0], FLOW.chargePerLink), 'link 4 pays +0.03');
  for (let i = 0; i < 10; i++) r.swing(i % 2 ? 'right' : 'left', r.A(40 + 6 * i));
  const total = r.added.reduce((s, k) => s + k, 0);
  ok(near(total, FLOW.chargeCap, 1e-9) && r.added.length === 5, `14 links pay ${total.toFixed(3)} in ${r.added.length} pieces: capped at +0.15 per chain`);
  r.bus.emit('player:land', {});
  r.attach('right', r.A(200));
  for (let i = 0; i < 4; i++) r.swing(i % 2 ? 'right' : 'left', r.A(210 + 6 * i));
  ok(r.added.length === 6, 'a new chain pays again from its own link 4');
  const r2 = rig(false);
  r2.attach('right', r2.A(0));
  for (let i = 0; i < 8; i++) r2.swing(i % 2 ? 'right' : 'left', r2.A(6 + 6 * i));
  ok(r2.flow.n === 8, 'without a lantern (the bag off) chains still count, nothing is paid');
}

// 6. Inventory3D.addCharge with the real bag, end to end
{
  const bus = new EventBus();
  const bag = new Inventory3D(bus);
  bag.lanternCharge = 0.1;
  bag.lanternLow = true;
  const got = bag.addCharge(0.03);
  ok(near(got, 0.03) && near(bag.lanternCharge, 0.13), 'addCharge adds');
  bag.lanternCharge = 0.99;
  ok(near(bag.addCharge(0.03), 0.01) && bag.lanternCharge === 1, 'addCharge clamps to full');
  ok(bag.addCharge(-1) === 0 && bag.addCharge(NaN) === 0, 'non-positive / NaN add nothing');
  bag.lanternCharge = 0.5;
  const player = { y: 0, grounded: false, climbing: false };
  const flow = new Flow3D(bus, player);
  flow.lantern = bag;
  let id = 0;
  const att = (hand) => bus.emit('grapple:attach', { hand, anchor: { id: 'b' + id, x: 6 * id++, y: 0, z: 0 }, speed: 9, previous: null });
  att('right');
  for (let i = 0; i < 10; i++) {
    bus.emit('grapple:release', { hand: i % 2 ? 'left' : 'right', reason: 'input' });
    player.y -= 2;
    att(i % 2 ? 'right' : 'left');
  }
  ok(flow.n === 10 && near(bag.lanternCharge, 0.65, 1e-9), `ten links on the real bag: 0.5 -> ${bag.lanternCharge.toFixed(3)} (+0.15)`);
  flow.dispose();
  att('left');
  ok(flow.n === 10, 'dispose() stops listening');
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
