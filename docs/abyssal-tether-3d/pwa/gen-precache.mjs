#!/usr/bin/env node
/* ABYSSAL TETHER 3D: precache list generator (DRAFT tooling, Node >= 18, no dependencies).
 *
 * Walks a built copy of the game, hashes every file, sorts each into the CORE tier (downloaded
 * at service-worker install) or the LAZY tier (cached on first use / WARM), and writes a
 * ready-to-serve sw.js by injecting that list between the @@PRECACHE markers of sw.draft.js.
 *
 * It only READS --root and --template and only WRITES --out (and --json if given). Point
 * --out at the deploy output (e.g. dist/abyssal-tether-3d/sw.js), never at the sources.
 *
 * Usage:
 *   node gen-precache.mjs --root dist/abyssal-tether-3d --template docs/abyssal-tether-3d/pwa/sw.draft.js \
 *     --out dist/abyssal-tether-3d/sw.js --version 1.0.0+42 [--lazy "<glob>"]... [--exclude "<glob>"]... \
 *     [--json precache-report.json] [--max-core-mb 40]
 *
 * Globs are matched against paths relative to --root with "/" separators:
 *   "*" = any run of characters except "/", "**" = anything including "/", "?" = one character.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

// Files that never belong in the cache (the worker itself, tooling, source maps, docs, store
// metadata, keystores if anyone ever drops one in the tree by mistake).
const DEFAULT_EXCLUDE = [
  'sw.js',
  '**/*.map',
  '**/.DS_Store',
  '**/README*',
  '**/LICENSE*',
  '**/*.md',
  '**/*.keystore',
  '**/*.jks',
  '.well-known/**',
  'assets/models/mason_hero.glb', // hero/marketing model: not loaded by the runtime today
];

// Content the player does not need for the first minutes of Chapter 1. Today the whole build is
// ~8 MB so everything else is CORE. When chapters 2-5 land, put their packs under
// assets/chapters/chN/ and they become LAZY automatically.
const DEFAULT_LAZY = ['assets/chapters/ch2/**', 'assets/chapters/ch3/**', 'assets/chapters/ch4/**', 'assets/chapters/ch5/**', 'assets/video/**'];

function parseArgs(argv) {
  const out = { lazy: [], exclude: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    if (a === '--root') out.root = next();
    else if (a === '--template') out.template = next();
    else if (a === '--out') out.out = next();
    else if (a === '--version') out.version = next();
    else if (a === '--lazy') out.lazy.push(next());
    else if (a === '--exclude') out.exclude.push(next());
    else if (a === '--json') out.json = next();
    else if (a === '--max-core-mb') out.maxCoreMb = Number(next());
    else if (a === '--shell') out.shell = next();
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

async function walk(dir, root, out = []) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) await walk(p, root, out);
    else if (ent.isFile()) out.push(relative(root, p).split(sep).join('/'));
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.root || !args.template || !args.out || !args.version) {
    console.log('usage: node gen-precache.mjs --root <dir> --template <sw.draft.js> --out <sw.js> --version <ver> [--lazy glob]... [--exclude glob]... [--json file] [--max-core-mb N] [--shell index.html]');
    process.exit(args.help ? 0 : 2);
  }
  const root = resolve(args.root);
  const outPath = resolve(args.out);
  if (outPath === resolve(args.template)) throw new Error('--out must not overwrite the template');
  if (!/^[0-9A-Za-z.+_-]{1,64}$/.test(args.version)) throw new Error('--version: use [0-9A-Za-z.+_-], max 64 chars');

  const exclude = [...DEFAULT_EXCLUDE, ...args.exclude].map(globToRegExp);
  const lazy = [...DEFAULT_LAZY, ...args.lazy].map(globToRegExp);
  const shell = args.shell || 'index.html';

  const files = (await walk(root, root)).filter((f) => !exclude.some((r) => r.test(f))).sort();
  if (!files.includes(shell)) throw new Error(`shell ${shell} not found under ${root}`);

  const core = [];
  const lazyList = [];
  let coreBytes = 0;
  let lazyBytes = 0;
  for (const f of files) {
    const buf = await readFile(join(root, f));
    const rev = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const entry = { url: f, rev };
    if (lazy.some((r) => r.test(f))) {
      lazyList.push(entry);
      lazyBytes += buf.length;
    } else {
      core.push(entry);
      coreBytes += buf.length;
    }
  }

  const manifest = { version: args.version, shell, core, lazy: lazyList };
  const template = await readFile(resolve(args.template), 'utf8');
  const marker = /\/\* @@PRECACHE_START@@ \*\/[\s\S]*?\/\* @@PRECACHE_END@@ \*\//;
  if (!marker.test(template)) throw new Error('template is missing the @@PRECACHE_START@@ / @@PRECACHE_END@@ markers');
  const banner = `/* GENERATED by gen-precache.mjs from sw.draft.js - version ${args.version} - do not edit. */\n`;
  const sw = banner + template.replace(marker, `/* @@PRECACHE_START@@ */ ${JSON.stringify(manifest, null, 2)} /* @@PRECACHE_END@@ */`);
  await writeFile(outPath, sw);

  const mb = (b) => (b / 1048576).toFixed(2);
  const report = { version: args.version, coreFiles: core.length, coreMB: Number(mb(coreBytes)), lazyFiles: lazyList.length, lazyMB: Number(mb(lazyBytes)), out: outPath };
  if (args.json) await writeFile(resolve(args.json), JSON.stringify({ ...report, core, lazy: lazyList }, null, 2));
  console.log(JSON.stringify(report));
  if (Number.isFinite(args.maxCoreMb) && coreBytes > args.maxCoreMb * 1048576) {
    console.error(`core tier is ${mb(coreBytes)} MB > --max-core-mb ${args.maxCoreMb}: move later-chapter content to the lazy tier`);
    process.exit(1);
  }
  const outStat = await stat(outPath);
  if (!outStat.size) throw new Error('wrote an empty sw.js');
}

main().catch((err) => {
  console.error(`gen-precache: ${err.message}`);
  process.exit(1);
});
