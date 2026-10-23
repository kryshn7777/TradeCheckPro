// Chapter registry for the harness (`--chapter ch1|…|all`).
//
// ch1 is today's level (LEVEL_DATA_3D, the 556 m descent) until the chapter framework
// (ENGINE_EXTENSIONS E04: src/data/chapters/*.js exporting CHAPTER) lands. A new chapter
// is one entry here: its level factory and its routes module (same shape as
// routes.mjs). The harness runs every check of §8 that applies to the systems the
// chapter's data actually uses.
import fs from 'node:fs';
import { Level3D, LEVEL_DATA_3D } from './sim.mjs';
import * as CH1 from './routes.mjs';

/**
 * AT3D_DECOR=<file>: a JSON list of boxes ([minX, minY, minZ, maxX, maxY, maxZ]) or { boxes } from the browser (the colliding kit dressing,
 * `game.level.decorSolids`), added to every level so the bots play the routes with the dressing solid, like the game does.
 */
function withDecor(level) {
  const f = typeof process !== 'undefined' && process.env && process.env.AT3D_DECOR;
  if (f) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    level.addDecorColliders(Array.isArray(j) ? j : j.boxes);
  }
  return level;
}

export const VARIANTS = ['normal', 'nightmare', 'abyss'];

export const CHAPTERS = {
  ch1: {
    id: 'ch1',
    name: 'Chapter I: The Descent',
    data: LEVEL_DATA_3D,
    /** Level3D for a variant. ch1: the default data, exactly as Game3D builds it today. */
    makeLevel: (variant) => withDecor(new Level3D(undefined, variant)),
    routes: CH1,
  },
};

/** `--chapter` value → chapter ids (throws on an unknown id). */
export function chapterIds(arg = 'all') {
  if (!arg || arg === 'all') return Object.keys(CHAPTERS);
  const ids = arg.split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of ids) if (!CHAPTERS[id]) throw new Error(`unknown chapter '${id}' (known: ${Object.keys(CHAPTERS).join(', ')}, all)`);
  return ids;
}

/** `--variant` value → variant keys (throws on an unknown key). */
export function variantKeys(arg = 'all') {
  if (!arg || arg === 'all') return VARIANTS.slice();
  const vs = arg.split(',').map((s) => s.trim()).filter(Boolean);
  for (const v of vs) if (!VARIANTS.includes(v)) throw new Error(`unknown variant '${v}' (known: ${VARIANTS.join(', ')}, all)`);
  return vs;
}
