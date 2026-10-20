// Compares two verify reports (or two traces files) leaf by leaf: every value in the
// baseline must be present and equal in the candidate (numbers within --tol).
// Keys only the candidate has are listed as additions, not differences.
//
//   node compare.mjs <baseline.json> <candidate.json> [--tol 0] [--ignore meta,budget,…] [--max 40]
//
// Uses: proving a harness change keeps every number (parity), and the Chapter I
// regression read-out (V14) against baselines/verify-ch1.json before / after a change.
// Exit code 1 when anything differs.
import fs from 'node:fs';
import { argValue, positional, isMain } from './args.mjs';

/** Default: run metadata, timings and the newer sections are not compared. */
export const DEFAULT_IGNORE = ['meta', 'budget', 'checks', 'determinism'];

export function compareReports(base, cand, { tol = 0, ignore = DEFAULT_IGNORE } = {}) {
  const diffs = [];
  const added = [];
  let leaves = 0;
  const walk = (a, b, p) => {
    if (a !== null && typeof a === 'object') {
      if (b === null || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {
        diffs.push([p, a, b]);
        return;
      }
      for (const k of Object.keys(a)) {
        if (!p && ignore.includes(k)) continue;
        walk(a[k], b[k], p ? `${p}.${k}` : k);
      }
      for (const k of Object.keys(b)) if (!(k in a) && !(!p && ignore.includes(k))) added.push(p ? `${p}.${k}` : k);
      return;
    }
    leaves++;
    if (typeof a === 'number' && typeof b === 'number') {
      if (!(Math.abs(a - b) <= tol) && !(Number.isNaN(a) && Number.isNaN(b))) diffs.push([p, a, b]);
    } else if (a !== b) diffs.push([p, a, b]);
  };
  walk(base, cand, '');
  return { leaves, diffs, added, ok: diffs.length === 0 };
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const [fa, fb] = positional(argv);
  if (!fa || !fb) {
    console.log('usage: node compare.mjs <baseline.json> <candidate.json> [--tol 0] [--ignore meta,budget,checks,determinism] [--max 40]');
    process.exit(2);
  }
  const tol = +argValue(argv, '--tol', 0) || 0;
  const ig = argValue(argv, '--ignore', null);
  const ignore = ig === null ? DEFAULT_IGNORE : ig.split(',').filter(Boolean);
  const max = +argValue(argv, '--max', 40) || 40;
  const r = compareReports(JSON.parse(fs.readFileSync(fa, 'utf8')), JSON.parse(fs.readFileSync(fb, 'utf8')), { tol, ignore });
  console.log(`compared ${r.leaves} values (tol ${tol}; ignored: ${ignore.join(', ') || 'none'})`);
  for (const [p, a, b] of r.diffs.slice(0, max)) console.log(`  DIFF ${p}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  if (r.diffs.length > max) console.log(`  … ${r.diffs.length - max} more`);
  if (r.added.length) console.log(`  new in candidate (not compared): ${r.added.length} key(s), e.g. ${r.added.slice(0, 8).join(', ')}`);
  console.log(r.ok ? 'IDENTICAL' : `${r.diffs.length} DIFFERENCE(S)`);
  process.exitCode = r.ok ? 0 : 1;
}
