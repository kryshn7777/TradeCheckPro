// Command-line helpers shared by the Abyssal Tether 3D tools (no game import here).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Flags that take a value (everything else starting with '-' is a boolean flag). */
const VALUE_FLAGS = new Set(['--root', '--chapter', '--variant', '--route', '--out', '--port', '--hesitate', '--frames', '--runs', '--seed', '--device-factor']);

/** `--name value` or `--name=value`; `def` when absent. */
export function argValue(argv, name, def) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === name) return i + 1 < argv.length ? argv[i + 1] : def;
    if (a.startsWith(name + '=')) return a.slice(name.length + 1);
  }
  return def;
}

export function hasFlag(argv, ...names) {
  return argv.some((a) => names.includes(a));
}

/** Positional arguments (flags and the values of value-taking flags removed). */
export function positional(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('-')) {
      if (VALUE_FLAGS.has(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/** True when the module at `metaUrl` is the script node was started with. */
export function isMain(metaUrl) {
  return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(metaUrl);
}
