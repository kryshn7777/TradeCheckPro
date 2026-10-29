#!/usr/bin/env node
/* ABYSSAL TETHER 3D: precache list generator (adopted from docs/abyssal-tether-3d/pwa/gen-precache.mjs).
 * Node >= 18, no dependencies.
 *
 * Walks a built copy of the game, hashes every file, sorts each into the CORE tier (downloaded at service-worker
 * install, all or nothing) or the LAZY tier (cached on first use / WARM), and writes a ready-to-serve sw.js by
 * injecting that list between the @@PRECACHE markers of sw.template.js.
 *
 * It only READS --root and --template and only WRITES --out (and --json when given).
 *
 *   node tools/abyssal-tether-3d/release/gen-precache.mjs --root public/abyssal-tether-3d \
 *     --template tools/abyssal-tether-3d/release/sw.template.js --out public/abyssal-tether-3d/sw.js \
 *     --version 1.0.0+{hash} [--lazy "<glob>"]... [--exclude "<glob>"]... [--json report.json] [--max-core-mb 60]
 *
 * "{hash}" in --version is replaced by the first 8 hex characters of the SHA-256 over the sorted
 * "path:revision" list, so the version changes exactly when some precached byte changes.
 * Globs are matched against paths relative to --root with "/" separators:
 *   "*" = any run of characters except "/", "**" = anything including "/", "?" = one character.
 *
 * Programmatic use (build-release.mjs, tests): import { generate } from './gen-precache.mjs'.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Files that never belong in the cache: the worker itself, tooling, source maps, docs, store metadata, keystores if
// anyone ever drops one in the tree by mistake, preview renders and the marketing model.
export const DEFAULT_EXCLUDE = [
  'sw.js',
  'sw.template.js',
  '_headers',
  '**/*.map',
  '**/.DS_Store',
  '**/README*',
  '**/LICENSE*',
  '**/*.md',
  '**/*.py',
  '**/*.blend',
  '**/*.keystore',
  '**/*.jks',
  '.well-known/**',
  'assets/models/mason_hero.glb', // hero/marketing model: not loaded by the runtime
  'assets/models/**/*.png', // Blender preview renders next to the GLBs
];

// Content the player does not need for the first minutes of Chapter I. Today the whole build is CORE; when chapters
// II-V land, their packs go under assets/chapters/chN/ and become LAZY automatically.
// assets/models/holdfast.glb (4.2 MB): the Holdfast first appears in S2 and loads in the background (render/holdfastView.js); the core tier hit the
// 80 MB cap with it. Lazy = cached on first use (the install's WARM pass fetches it); without it the patch simply stays the plain studs.
// assets/models/dresser.glb (~2 MB): THE DRESSER v2 first appears in S3 and loads in the background (render/dresserView.js); without it
// the procedural Dresser stays.
export const DEFAULT_LAZY = ['assets/chapters/ch2/**', 'assets/chapters/ch3/**', 'assets/chapters/ch4/**', 'assets/chapters/ch5/**', 'assets/video/**', 'assets/models/holdfast.glb', 'assets/models/dresser.glb'];

export function globToRegExp(glob) {
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

/**
 * @returns {Promise<{version:string, manifest:object, report:object, core:object[], lazy:object[], sw:string}>}
 */
export async function generate({ root, template, out = null, version, lazy = [], exclude = [], shell = 'index.html', maxCoreMb = NaN, json = null }) {
  root = resolve(root);
  if (!/^[0-9A-Za-z.+_{}-]{1,64}$/.test(version || '')) throw new Error('--version: use [0-9A-Za-z.+_-] (and {hash}), max 64 chars');
  const excludeRe = [...DEFAULT_EXCLUDE, ...exclude].map(globToRegExp);
  const lazyRe = [...DEFAULT_LAZY, ...lazy].map(globToRegExp);

  const files = (await walk(root, root)).filter((f) => !excludeRe.some((r) => r.test(f))).sort();
  if (!files.includes(shell)) throw new Error(`shell ${shell} not found under ${root}`);

  // JPEG/PNG fallbacks of a texture that also ships as .ktx2 are only needed where the Basis transcoder cannot run:
  // they are LAZY (cached on first use) so the install does not download every texture twice.
  const fileSet = new Set(files);
  const isFallback = (f) => /\.(jpe?g|png)$/i.test(f) && fileSet.has(f.replace(/\.[^./]+$/, '.ktx2'));

  const core = [];
  const lazyList = [];
  let coreBytes = 0;
  let lazyBytes = 0;
  for (const f of files) {
    const buf = await readFile(join(root, f));
    const rev = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    const entry = { url: f, rev };
    if (lazyRe.some((r) => r.test(f)) || isFallback(f)) {
      lazyList.push(entry);
      lazyBytes += buf.length;
    } else {
      core.push(entry);
      coreBytes += buf.length;
    }
  }
  const hash = createHash('sha256')
    .update([...core, ...lazyList].map((e) => `${e.url}:${e.rev}`).join('\n'))
    .digest('hex')
    .slice(0, 8);
  const finalVersion = version.replace('{hash}', hash);

  const manifest = { version: finalVersion, shell, core, lazy: lazyList };
  const tpl = await readFile(resolve(template), 'utf8');
  const marker = /\/\* @@PRECACHE_START@@ \*\/[\s\S]*?\/\* @@PRECACHE_END@@ \*\//;
  if (!marker.test(tpl)) throw new Error('template is missing the @@PRECACHE_START@@ / @@PRECACHE_END@@ markers');
  const banner = `/* GENERATED by tools/abyssal-tether-3d/release/gen-precache.mjs from sw.template.js - version ${finalVersion} - do not edit. */\n`;
  const sw = banner + tpl.replace(marker, () => `/* @@PRECACHE_START@@ */ ${JSON.stringify(manifest, null, 2)} /* @@PRECACHE_END@@ */`);
  if (out) {
    if (resolve(out) === resolve(template)) throw new Error('--out must not overwrite the template');
    await writeFile(resolve(out), sw);
    const st = await stat(resolve(out));
    if (!st.size) throw new Error('wrote an empty sw.js');
  }
  const mb = (b) => Number((b / 1048576).toFixed(2));
  const report = { version: finalVersion, hash, coreFiles: core.length, coreMB: mb(coreBytes), lazyFiles: lazyList.length, lazyMB: mb(lazyBytes), out: out ? resolve(out) : null };
  if (json) await writeFile(resolve(json), JSON.stringify({ ...report, core, lazy: lazyList }, null, 2));
  if (Number.isFinite(maxCoreMb) && coreBytes > maxCoreMb * 1048576) {
    const err = new Error(`core tier is ${mb(coreBytes)} MB > --max-core-mb ${maxCoreMb}: move later-chapter content to the lazy tier`);
    err.report = report;
    throw err;
  }
  return { version: finalVersion, manifest, report, core, lazy: lazyList, sw };
}

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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help || !args.root || !args.template || !args.out || !args.version) {
      console.log('usage: node gen-precache.mjs --root <dir> --template <sw.template.js> --out <sw.js> --version <ver|1.0.0+{hash}> [--lazy glob]... [--exclude glob]... [--json file] [--max-core-mb N] [--shell index.html]');
      process.exit(args.help ? 0 : 2);
    }
    const r = await generate(args);
    console.log(JSON.stringify(r.report));
  } catch (err) {
    console.error(`gen-precache: ${err.message}`);
    process.exit(1);
  }
}
