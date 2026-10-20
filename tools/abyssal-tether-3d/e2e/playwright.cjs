// Finds Playwright for the browser tests: a local install (npm i -D playwright), else
// the global one (npm i -g playwright; the same as running with NODE_PATH=$(npm root -g)).
// Chromium must be installed for it: npx playwright install chromium.
const { execSync } = require('child_process');
const path = require('path');

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    /* not local / not on NODE_PATH */
  }
  try {
    const groot = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return require(path.join(groot, 'playwright'));
  } catch {
    /* not global either */
  }
  console.error('playwright not found: npm i -D playwright (or npm i -g playwright), then npx playwright install chromium');
  process.exit(2);
}

/** Flags for headless Chromium with software WebGL (what the tests were tuned on). */
const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

module.exports = { loadPlaywright, CHROMIUM_ARGS };
