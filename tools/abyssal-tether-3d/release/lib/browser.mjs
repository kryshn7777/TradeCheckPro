// Playwright helpers for the release tests (ESM wrapper around ../../e2e/playwright.cjs).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const pw = require(path.join(HERE, '..', '..', 'e2e', 'playwright.cjs'));
const XR_MOCK = path.join(HERE, '..', '..', 'e2e', 'page', 'xr-mock.js');

export const XR_MOCK_PATH = XR_MOCK;

/** Launches headless Chromium with software WebGL (what the e2e uses). */
export async function launch(extraArgs = []) {
  const { chromium } = pw.loadPlaywright();
  return chromium.launch({ headless: true, args: [...pw.CHROMIUM_ARGS, ...extraArgs] });
}

/**
 * A fresh page that collects console errors / page errors.
 * @param {import('playwright').Browser|import('playwright').BrowserContext} owner
 */
export async function newPage(owner, { viewport = { width: 1280, height: 720 }, xr = false } = {}) {
  const page = await owner.newPage({ viewport });
  const errors = [];
  const logs = [];
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error') errors.push(m.text());
    logs.push(`[${t}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message ? e.message : String(e))));
  if (xr) await page.addInitScript({ path: XR_MOCK });
  page.errors = errors;
  page.logs = logs;
  return page;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls fn() in Node until it returns truthy (or throws on timeout). */
export async function until(fn, { timeout = 15000, every = 100, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await sleep(every);
  }
}

/** PASS/FAIL recorder shared by the release test scripts. */
export function makeChecker(title) {
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail });
    const d = detail === undefined ? '' : '  - ' + (typeof detail === 'string' ? detail : JSON.stringify(detail));
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d}`);
    return !!ok;
  };
  const finish = () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${title}: ${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join('; '));
    return failed.length ? 1 : 0;
  };
  return { check, finish, results };
}
