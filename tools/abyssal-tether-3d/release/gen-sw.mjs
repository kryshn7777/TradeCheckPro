#!/usr/bin/env node
// Regenerates <game>/sw.js (the service worker with this tree's precache list) in place.
//   npm run at3d:sw            (also runs as `prebuild`, so GitHub Pages / Vercel always deploy a consistent list)
// sw.js is a build artefact (git-ignored): the version is "<release.config version>+<content hash>".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './gen-precache.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'release.config.json'), 'utf8'));
const root = path.resolve(REPO, process.argv[2] || cfg.gameDir);

try {
  const r = await generate({
    root,
    template: path.join(HERE, 'sw.template.js'),
    out: path.join(root, 'sw.js'),
    version: `${cfg.version}+{hash}`,
    maxCoreMb: cfg.maxCoreMB,
  });
  console.log(`at3d sw.js: ${r.report.coreFiles} core files / ${r.report.coreMB} MB, version ${r.report.version}`);
} catch (err) {
  // never fail the site build over the optional game worker: without sw.js the game simply runs online-only
  console.warn(`at3d sw.js NOT generated: ${err.message}`);
}
