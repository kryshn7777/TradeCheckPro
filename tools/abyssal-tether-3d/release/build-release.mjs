#!/usr/bin/env node
/* ABYSSAL TETHER 3D: release build.   npm run build:at3d-release [-- options]
 *
 * Produces a clean, self-checking folder in dist-at3d/ (git-ignored):
 *
 *   dist-at3d/web/              DEPLOY THIS to the host (atomically: never file by file)
 *     index.html                landing page (store link, support, privacy)
 *     play/                     the game: index.html, manifest.webmanifest, sw.js, icons/, src/, vendor/, assets/
 *     privacy/index.html        privacy policy (outside the service-worker scope on purpose)
 *     support/index.html        support page
 *     _headers                  Cloudflare Pages / Netlify headers (sw.js no-cache, manifest MIME, ...)
 *   dist-at3d/twa/              NEVER deploy: Bubblewrap config + packaging notes for the release machine
 *     twa-manifest.json         filled from release.config.json (placeholders left where the owner must decide)
 *     assetlinks.template.json, build-and-upload.sh, BUBBLEWRAP.md
 *   dist-at3d/BUILD_REPORT.json
 *
 * What the build does to the game copy (the source tree is never modified):
 *   - copies public/abyssal-tether-3d (minus dev-only files), writes src/platform/buildInfo.js with
 *     channel "release" (no ?entitlement= mocks; the service worker registers on every host),
 *   - optional --minify: esbuild per-file transform (no bundling, ES modules stay ES modules),
 *   - generates sw.js with the precache list (SHA-256 per file; version "<version>+<content hash>"),
 *   - fills the privacy / support / landing pages from release.config.json "owner",
 *   - checks: every file referenced by the manifest and index.html exists, no keystore / map / md files shipped,
 *     core precache size under maxCoreMB, buildInfo is the release channel, report any unfilled <PLACEHOLDER>.
 *
 * Options: --out DIR (default dist-at3d)  --version X.Y.Z  --minify  --smoke (then run test-pwa.mjs on the result)
 *          --game-path /play/ (path of the game on the host, for _headers and the TWA manifest)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, globToRegExp, DEFAULT_EXCLUDE } from './gen-precache.mjs';
import { mdToHtml } from './lib/md.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'release.config.json'), 'utf8'));
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(name);

const OUT = path.resolve(REPO, arg('--out', cfg.distDir));
const VERSION = arg('--version', cfg.version);
const GAME_PATH = arg('--game-path', cfg.gamePath);
const GAME_SRC = path.resolve(REPO, cfg.gameDir);
const STORE_DIR = path.join(REPO, 'docs', 'abyssal-tether-3d', 'store');
const PWA_DOCS = path.join(REPO, 'docs', 'abyssal-tether-3d', 'pwa');
const problems = [];
const warnings = [];
const fail = (m) => problems.push(m);
const warn = (m) => warnings.push(m);

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}
function walk(dir, root = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, root, out);
    else if (e.isFile()) out.push(path.relative(root, p).split(path.sep).join('/'));
  }
  return out;
}
const mb = (b) => Number((b / 1048576).toFixed(2));

// ---------------------------------------------------------------------------------------------------------------
console.log(`== at3d release build ${VERSION} -> ${path.relative(REPO, OUT)}`);
rmrf(OUT);
const WEB = path.join(OUT, 'web');
const PLAY = path.join(WEB, GAME_PATH.replace(/^\/|\/$/g, '') || '.');
const TWA = path.join(OUT, 'twa');
fs.mkdirSync(PLAY, { recursive: true });
fs.mkdirSync(TWA, { recursive: true });

// 1. copy the game (minus build artefacts and dev-only files; LICENSE files stay: three.js is MIT) --------------------
const skip = [...DEFAULT_EXCLUDE.filter((p) => !/LICENSE/.test(p)), 'icons/favicon-48.png'].map(globToRegExp);
let copied = 0;
for (const f of walk(GAME_SRC)) {
  if (f === 'icons/favicon-48.png') {
    // referenced by nothing; harmless but not needed
  }
  if (skip.some((r) => r.test(f)) && !/(^|\/)LICENSE/.test(f)) continue;
  const dest = path.join(PLAY, f);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(GAME_SRC, f), dest);
  copied++;
}
console.log(`   copied ${copied} files`);

// 2. build identity -------------------------------------------------------------------------------------------------
let commit = null;
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
  /* not a git checkout */
}
const builtAt = new Date().toISOString();
fs.writeFileSync(
  path.join(PLAY, 'src', 'platform', 'buildInfo.js'),
  `/* Generated by build-release.mjs: the release channel (no URL mock switches). */\nexport const BUILD = ${JSON.stringify({ channel: 'release', version: VERSION, builtAt, commit }, null, 2)};\n`,
);

// 3. optional minify ------------------------------------------------------------------------------------------------
if (flag('--minify')) {
  let esbuild = null;
  try {
    esbuild = createRequire(path.join(REPO, 'package.json'))('esbuild');
  } catch {
    warn('--minify: esbuild not installed, files left readable');
  }
  if (esbuild) {
    let before = 0;
    let after = 0;
    for (const f of walk(PLAY).filter((x) => x.startsWith('src/') && x.endsWith('.js'))) {
      const p = path.join(PLAY, f);
      const code = fs.readFileSync(p, 'utf8');
      const r = esbuild.transformSync(code, { minify: true, format: 'esm', target: 'es2020', legalComments: 'none', keepNames: true });
      fs.writeFileSync(p, r.code);
      before += code.length;
      after += r.code.length;
    }
    console.log(`   minified src/: ${mb(before)} MB -> ${mb(after)} MB`);
  }
}

// 4. service worker -------------------------------------------------------------------------------------------------
const gen = await generate({
  root: PLAY,
  template: path.join(HERE, 'sw.template.js'),
  out: path.join(PLAY, 'sw.js'),
  version: `${VERSION}+{hash}`,
  maxCoreMb: cfg.maxCoreMB,
  json: path.join(OUT, 'precache.json'),
});
console.log(`   sw.js: ${gen.report.coreFiles} core files / ${gen.report.coreMB} MB (lazy ${gen.report.lazyFiles}), version ${gen.report.version}`);

// 5. site pages -----------------------------------------------------------------------------------------------------
const owner = cfg.owner;
const fill = (tpl) =>
  tpl
    .replace(/\{\{STUDIO\}\}/g, owner.studio)
    .replace(/\{\{CONTACT_EMAIL\}\}/g, owner.contactEmail)
    .replace(/\{\{DOMAIN\}\}/g, owner.domain)
    .replace(/\{\{POSTAL_ADDRESS\}\}/g, owner.postalAddress)
    .replace(/\{\{EFFECTIVE_DATE\}\}/g, owner.effectiveDate)
    .replace(/\{\{HOST_NAME\}\}/g, owner.hostName)
    .replace(/\{\{LOG_RETENTION_DAYS\}\}/g, owner.logRetentionDays)
    .replace(/\{\{GAME_PATH\}\}/g, GAME_PATH)
    .replace(/\{\{VERSION\}\}/g, VERSION);
const pages = [
  { src: 'site/index.html', dest: 'index.html' },
  { src: 'PRIVACY_POLICY.md', dest: 'privacy/index.html', md: true },
  { src: 'SUPPORT.md', dest: 'support/index.html', md: true },
];
const unfilled = new Set();
for (const pg of pages) {
  const from = path.join(STORE_DIR, pg.src);
  if (!fs.existsSync(from)) {
    fail(`missing site page source ${path.relative(REPO, from)}`);
    continue;
  }
  let html;
  if (pg.md) {
    const { html: body, title } = mdToHtml(fill(fs.readFileSync(from, 'utf8')));
    html = fill(fs.readFileSync(path.join(STORE_DIR, 'site', 'page.html'), 'utf8')).replace('{{TITLE}}', () => title).replace('{{CONTENT}}', () => body);
  } else html = fill(fs.readFileSync(from, 'utf8'));
  for (const m of html.matchAll(/&lt;[A-Za-z][^<>&]{2,60}&gt;|<(?:STUDIO NAME|support@your-domain|your-domain|postal address[^>]*|YYYY-MM-DD|hosting provider)>/g)) unfilled.add(m[0].replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  const to = path.join(WEB, pg.dest);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, html);
}
if (unfilled.size) warn(`owner placeholders still in the site pages: ${[...unfilled].join(', ')} (edit tools/abyssal-tether-3d/release/release.config.json "owner")`);

// 6. headers --------------------------------------------------------------------------------------------------------
fs.writeFileSync(path.join(WEB, '_headers'), fs.readFileSync(path.join(PWA_DOCS, '_headers.draft'), 'utf8').replace('Hosting headers DRAFT', 'Hosting headers').replace(/__GAME_PATH__/g, GAME_PATH));

// 7. TWA packaging pack ---------------------------------------------------------------------------------------------
const twaTpl = fs
  .readFileSync(path.join(PWA_DOCS, 'twa-manifest.template.json'), 'utf8')
  .replace(/__PACKAGE_ID__/g, cfg.bubblewrap.packageId)
  .replace(/__HORIZON_APP_ID__/g, cfg.bubblewrap.metaAppId)
  .replace(/__DOMAIN__/g, owner.domain)
  .replace(/__GAME_PATH__/g, GAME_PATH)
  .replace(/__KEYSTORE_PATH__/g, cfg.bubblewrap.keystorePath)
  .replace(/__KEY_ALIAS__/g, cfg.bubblewrap.keyAlias)
  .replace(/"launcherName": "[^"]*"/, `"launcherName": "${cfg.bubblewrap.launcherName}"`)
  .replace(/"appVersion": "[^"]*"/, `"appVersion": "${VERSION}"`);
fs.writeFileSync(path.join(TWA, 'twa-manifest.json'), twaTpl);
fs.copyFileSync(path.join(PWA_DOCS, 'assetlinks.template.json'), path.join(TWA, 'assetlinks.template.json'));
fs.copyFileSync(path.join(PWA_DOCS, 'build-and-upload.sh'), path.join(TWA, 'build-and-upload.sh'));
const bw = path.join(STORE_DIR, 'BUBBLEWRAP.md');
if (fs.existsSync(bw)) fs.copyFileSync(bw, path.join(TWA, 'BUBBLEWRAP.md'));
else warn('docs/abyssal-tether-3d/store/BUBBLEWRAP.md missing');

// 8. checks ---------------------------------------------------------------------------------------------------------
const playFiles = walk(PLAY);
for (const f of playFiles) {
  if (/\.(keystore|jks|map|md|py|blend)$/i.test(f)) fail(`dev/secret file shipped: ${f}`);
  if (/^README/i.test(path.basename(f))) fail(`README shipped: ${f}`);
}
const manifest = JSON.parse(fs.readFileSync(path.join(PLAY, 'manifest.webmanifest'), 'utf8'));
for (const ic of manifest.icons || []) if (!fs.existsSync(path.join(PLAY, ic.src))) fail(`manifest icon missing: ${ic.src}`);
if (!manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')) fail('manifest has no 512 maskable icon');
if (!manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')) fail('manifest has no 512 icon');
const indexHtml = fs.readFileSync(path.join(PLAY, 'index.html'), 'utf8');
for (const m of indexHtml.matchAll(/(?:href|src)="((?!https?:|data:|#)[^"]+)"/g)) {
  const rel = m[1].split('?')[0];
  if (!fs.existsSync(path.join(PLAY, rel))) fail(`index.html references a missing file: ${rel}`);
}
if (!/channel: "release"|"channel": "release"/.test(fs.readFileSync(path.join(PLAY, 'src', 'platform', 'buildInfo.js'), 'utf8'))) fail('buildInfo is not the release channel');
const swText = fs.readFileSync(path.join(PLAY, 'sw.js'), 'utf8');
const coreUrls = new Set(gen.core.map((e) => e.url));
for (const must of ['index.html', 'manifest.webmanifest', 'style.css', 'src/main.js', 'src/game.js', 'vendor/three/three.module.min.js', 'icons/icon-512.png']) if (!coreUrls.has(must)) fail(`precache core is missing ${must}`);
if (!swText.includes(gen.report.version)) fail('sw.js does not carry the version');
for (const f of ['privacy/index.html', 'support/index.html']) if (!fs.existsSync(path.join(WEB, f))) fail(`missing ${f}`);

const report = {
  version: VERSION,
  builtAt,
  commit,
  web: path.relative(REPO, WEB),
  gamePath: GAME_PATH,
  files: playFiles.length,
  totalMB: mb(playFiles.reduce((n, f) => n + fs.statSync(path.join(PLAY, f)).size, 0)),
  precache: gen.report,
  minified: flag('--minify'),
  warnings,
  problems,
};
fs.writeFileSync(path.join(OUT, 'BUILD_REPORT.json'), JSON.stringify(report, null, 2));
console.log(`   game folder: ${report.files} files, ${report.totalMB} MB; precache core ${gen.report.coreMB} MB`);
for (const w of warnings) console.log(`   WARNING: ${w}`);
if (problems.length) {
  for (const p of problems) console.error(`   PROBLEM: ${p}`);
  console.error(`\nBUILD FAILED (${problems.length} problem(s))`);
  process.exit(1);
}

if (flag('--smoke')) {
  console.log('== smoke: test-pwa.mjs on the built game');
  const r = spawnSync(process.execPath, [path.join(HERE, 'test-pwa.mjs'), '--dist', PLAY, '--root-host'], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('SMOKE FAILED');
    process.exit(1);
  }
}
console.log(`\nBUILD OK -> ${path.relative(REPO, WEB)}  (deploy this folder atomically; see docs/abyssal-tether-3d/store/BUBBLEWRAP.md)`);
