// Exports the engine-independent game data of the web build to JSON for the Unreal port (docs/abyssal-tether-3d/plans/UNREAL_PORT.md):
// the constants (CONFIG), the difficulties and the Chapter I level data, plus a summary the C++ tests check their parse against.
//   node unreal/tools/export-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', '..', 'public', 'abyssal-tether-3d', 'src');
const OUT = path.join(HERE, '..', 'data');
const { CONFIG, DIFFICULTY } = await import(pathToFileURL(path.join(SRC, 'sim', 'config3d.js')).href);
const { LEVEL_DATA_3D } = await import(pathToFileURL(path.join(SRC, 'data', 'level-data-3d.js')).href);

const write = (name, obj) => {
  const s = JSON.stringify(obj, null, 1);
  fs.writeFileSync(path.join(OUT, name), s + '\n');
  return s.length;
};
const sizes = {
  config: write('config.json', CONFIG),
  difficulty: write('difficulty.json', DIFFICULTY),
  level: write('level-ch1.json', LEVEL_DATA_3D),
};
const counts = {};
for (const [k, v] of Object.entries(LEVEL_DATA_3D)) if (Array.isArray(v)) counts[k] = v.length;
write('summary.json', { counts, physicsDt: CONFIG.PHYSICS_DT, gravity: CONFIG.player.gravity, runMaxSpeed: CONFIG.player.runMaxSpeed, difficulties: Object.keys(DIFFICULTY) });
console.log('exported', JSON.stringify(sizes), 'bytes;', JSON.stringify(counts));
