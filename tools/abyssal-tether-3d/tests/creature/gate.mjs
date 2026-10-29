// The Mason hunts only while the player is hurt (Creature3D.setHuntGate / setHurt; game.js feeds Health3D.low): healthy = the unseen,
// non-lethal dormant mode in every section; hurt = it arrives and hunts; well again = it holds T.huntHold s, then withdraws up the
// masonry and leaves play; a scripted override (S7 escape) and the skitterlings are never gated; a respawn forgets the scent.
//   node gate.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, CREATURE_TUNING } = await import(srcUrl('sim/creature3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const T = CREATURE_TUNING;
const SEC = 4; // S5: a hunting section on every difficulty

function make(seed, { gate = true, diff = 'normal', variant } = {}) {
  const L = new Level3D(LEVEL_DATA_3D, DIFFICULTY[diff].levelVariant);
  const bus = new EventBus();
  const c = new Creature3D(L, DIFFICULTY[diff], bus, { seed, variant });
  if (gate) c.setHuntGate(true);
  const cp = L.sections[SEC].checkpoint;
  const p = { x: cp.x, y: cp.y, z: cp.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: false };
  c.reset(p);
  c.setSection(SEC, L.sections[SEC], p);
  return { L, c, p, t: 0 };
}
function run(w, secs, hurt) {
  for (let i = 0; i < Math.round(secs * 60); i++) {
    w.t += 1 / 60;
    if (hurt !== undefined) w.c.setHurt(hurt);
    w.c.update(1 / 60, w.p, w.t);
    if (w.c.caughtPlayer) {
      w.c.caughtPlayer = false;
      w.dead = true;
    }
  }
}

for (const diff of ['normal', 'nightmare', 'abyss']) {
  // the same section without the gate hunts
  const open = make(3, { gate: false, diff });
  run(open, 20, false);
  ok(open.c.inPlay && open.c.lethal, `${diff}: without the gate the S5 Mason is in play and lethal`);

  // healthy: never in play, never lethal, never kills, however long
  const w = make(3, { diff });
  run(w, 120, false);
  ok(!w.c.inPlay && !w.c.lethal && !w.dead && w.c.mode === 'dormant', `${diff}: healthy for 120 s: not in play, not lethal, no kill (mode ${w.c.mode})`);
}

{
  // hurt: it arrives and hunts; stays through the hold; then withdraws and leaves play
  const w = make(7);
  run(w, 5, false);
  ok(!w.c.inPlay, 'healthy: out of play');
  run(w, 1, true);
  ok(w.c.inPlay && w.c.lethal && w.c.mode !== 'dormant', 'hurt: it is in play, lethal and hunting at once');
  run(w, 20, true);
  ok(w.c.inPlay, 'hurt for 20 s: it is still hunting');
  w.c.setHurt(false);
  run(w, T.huntHold - 2, false);
  ok(w.c.inPlay && w.c.lethal, 'well again: it still holds the hunt for the scent window');
  run(w, 4, false);
  ok(w.c._withdraw || !w.c.inPlay, 'the scent window over: it withdraws (or has left)');
  ok(!w.c.lethal, 'withdrawing: no longer lethal');
  run(w, T.withdrawMax + 2, false);
  ok(!w.c.inPlay && w.c.mode === 'dormant', 'it leaves play within the withdraw limit');
  // hurt again: it comes back
  run(w, 1, true);
  ok(w.c.inPlay && w.c.lethal, 'hurt again: the hunt starts again');
}

{
  // a respawn (full health) forgets the scent
  const w = make(9);
  run(w, 3, true);
  ok(w.c.inPlay, 'hurt: hunting before the death');
  w.c.onRespawn(w.p);
  run(w, 0.5, false);
  ok(!w.c.inPlay || !w.c.lethal, 'after the respawn at full health it is not hunting');
}

{
  // a scripted override is a story beat: it hunts at full health
  const w = make(11);
  run(w, 3, false);
  ok(!w.c.inPlay, 'healthy: out of play before the override');
  w.c.setOverride({ mode: 'escape', lethal: true }, SEC);
  run(w, 3, false);
  ok(w.c.inPlay && w.c.mode === 'escape', 'an override (the S7 escape) hunts at full health');
}

{
  // the small ones are never gated
  const w = make(13, { variant: 'skitterling' });
  ok(w.c._gate === false, 'a skitterling ignores setHuntGate');
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
