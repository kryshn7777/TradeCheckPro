// Golden traces of the web build's physics for the C++ port to reproduce (docs/abyssal-tether-3d/plans/UNREAL_PORT.md): scripted scenarios
// on the Chapter I level (Normal), the player's state after EVERY fixed step.
//   node unreal/tools/golden-traces.mjs   ->   unreal/golden/physics-basic.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = pathToFileURL(path.join(HERE, '..', '..', 'public', 'abyssal-tether-3d', 'src') + path.sep).href;
const { CONFIG, DIFFICULTY, EventBus } = await import(SRC + 'sim/config3d.js');
const { Player3D, TetherSystem, Physics3D } = await import(SRC + 'sim/physics3d.js');
const { Level3D } = await import(SRC + 'sim/level3d.js');

const DT = CONFIG.PHYSICS_DT;
const FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz'];

function scenario(name, start, script) {
  const level = new Level3D(undefined, 'normal');
  const bus = new EventBus();
  const events = [];
  for (const t of ['player:jump', 'player:land']) bus.on(t, (p) => events.push([t, rows.length, p && typeof p.impact === 'number' ? p.impact : null]));
  const phys = new Physics3D(level, DIFFICULTY.normal, bus);
  const th = new TetherSystem(level, DIFFICULTY.normal, bus, {});
  const p = new Player3D(start[0], start[1], start[2]);
  const rows = [];
  let i = 0;
  for (const seg of script) {
    for (let n = 0; n < seg.steps; n++, i++) {
      phys.step(p, th, seg.intent || {}, DT);
      rows.push(FIELDS.map((f) => p[f]).concat([p.grounded ? 1 : 0]));
    }
  }
  return { name, start, steps: rows.length, fields: FIELDS.concat(['grounded']), rows, events };
}

const spawn = [-4, 0.4, 8.5];
const out = {
  meta: { dt: DT, variant: 'normal', note: 'player state after every fixed step; events: [type, step index, impact]' },
  scenarios: [
    scenario('settle', spawn, [{ steps: 200 }]),
    scenario('walk-x', spawn, [{ steps: 100 }, { steps: 360, intent: { move: { x: -1, z: 0 } } }]),
    scenario('walk-then-stop', spawn, [{ steps: 100 }, { steps: 200, intent: { move: { x: -1, z: 0 } } }, { steps: 200 }]),
    scenario('walk-then-brake', spawn, [{ steps: 100 }, { steps: 200, intent: { move: { x: -1, z: 0 } } }, { steps: 200, intent: { brake: true } }]),
    scenario('jump', spawn, [{ steps: 100 }, { steps: 1, intent: { jumpPressed: true } }, { steps: 400 }]),
    scenario('run-jump', spawn, [{ steps: 100 }, { steps: 120, intent: { move: { x: -1, z: 0 } } }, { steps: 1, intent: { move: { x: -1, z: 0 }, jumpPressed: true } }, { steps: 400, intent: { move: { x: -1, z: 0 } } }]),
    scenario('fall', [-4, 12, 8.5], [{ steps: 600 }]),
  ],
};
fs.mkdirSync(path.join(HERE, '..', 'golden'), { recursive: true });
fs.writeFileSync(path.join(HERE, '..', 'golden', 'physics-basic.json'), JSON.stringify(out));
for (const s of out.scenarios) console.log(s.name.padEnd(16), s.steps, 'steps; end', s.rows[s.rows.length - 1].map((v) => +v.toFixed(3)).join(' '), '| events', s.events.length);
