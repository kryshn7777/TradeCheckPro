// Where the game lives, for every Abyssal Tether 3D tool (verify, e2e, tests).
//
// Default: the game folder of the checkout this file belongs to, found relative to
// this script (tools/abyssal-tether-3d/verify → <repo>/public/abyssal-tether-3d), so
// the harness runs from any clone or worktree. Override with `--root <dir>` (or the
// AT3D_ROOT environment variable); <dir> may be a repository root, the game folder
// (public/abyssal-tether-3d) or its src/ folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { argValue } from './args.mjs';

export { argValue, hasFlag, positional, isMain } from './args.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The repository this copy of the tools belongs to. */
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
export const TOOLS_DIR = path.resolve(HERE, '..');

const isGame = (dir) => fs.existsSync(path.join(dir, 'src', 'sim', 'config3d.js'));

/** Resolves the game folder (the one holding index.html, src/, vendor/). Throws with a hint when not found. */
export function resolveGameRoot(argv = process.argv.slice(2), env = process.env) {
  const given = argValue(argv, '--root', null) || env.AT3D_ROOT || null;
  const base = path.resolve(given || REPO_ROOT);
  const candidates = [base, path.join(base, 'public', 'abyssal-tether-3d'), path.dirname(base)];
  for (const c of candidates) if (isGame(c)) return c;
  throw new Error(`Abyssal Tether 3D not found at ${base}${given ? ' (--root / AT3D_ROOT)' : ''}: expected <repo>/public/abyssal-tether-3d/src/sim/config3d.js`);
}

export const GAME_ROOT = resolveGameRoot();
export const SRC_DIR = path.join(GAME_ROOT, 'src');
/** file:// URL of a module under the game's src/ (for dynamic import). */
export const srcUrl = (rel) => pathToFileURL(path.join(SRC_DIR, rel)).href;
/** file:// URL of the vendored three.js folder (with a trailing slash). */
export const VENDOR_THREE_URL = pathToFileURL(path.join(GAME_ROOT, 'vendor', 'three') + path.sep).href;
