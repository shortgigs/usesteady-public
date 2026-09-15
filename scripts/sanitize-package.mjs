#!/usr/bin/env node
// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * scripts/sanitize-package.mjs
 *
 * Release-safety gate: strip private-ops artifacts out of dist/ BEFORE
 * `npm pack` / `npm publish`. Hooked into the `prepack` npm lifecycle
 * so it runs on EVERY pack and publish, from any machine — local dev,
 * CI, release pipeline.
 *
 * ── Why this script exists (alpha.42 validation finding) ──────────────
 *
 * Two source files in `src/shell/cli/` are private-ops-only and are
 * tracked in `.gitignore`:
 *
 *   - src/shell/cli/friction-admin.ts   (GitHub-issues admin CLI)
 *   - src/shell/cli/payout-mercury.ts   (payout ledger admin CLI)
 *
 * Their headers explicitly declare: "This file is gitignored and
 * intentionally absent from the public npm package."
 *
 * They are correctly excluded from git (CI never sees them). However,
 * `package.json` ships `"files": ["dist/", ...]` — a directory
 * whitelist. Per npm's whitelist semantics, individual-file exclusions
 * in `.npmignore` DO NOT override a top-level whitelist directory.
 * So when `npm pack` runs on a dev machine that has the private .ts
 * sources present, the compiler has already produced
 * `dist/src/shell/cli/friction-admin.js` (and .d.ts, .js.map, .d.ts.map)
 * and those leak into the published tarball.
 *
 * The leak was caught during alpha.42 release validation by
 * `npm pack --dry-run`:
 *
 *    npm notice  661 B   dist/src/shell/cli/friction-admin.d.ts
 *    npm notice  235 B   dist/src/shell/cli/friction-admin.d.ts.map
 *    npm notice 13.0 kB  dist/src/shell/cli/friction-admin.js
 *    npm notice 12.1 kB  dist/src/shell/cli/friction-admin.js.map
 *
 * The compiled friction-admin.js even carries a
 * `readline.createInterface({ input: process.stdin, ... })` call that
 * bypasses the M5 SessionController, i.e. the exact pattern the
 * `check-stdin-ownership` gate was designed to catch.
 *
 * ── What this script does ─────────────────────────────────────────────
 *
 *   1. Walk `dist/` and delete every file whose basename matches a
 *      private-ops pattern. The set is explicit and small:
 *
 *        friction-admin.js
 *        friction-admin.d.ts
 *        friction-admin.js.map
 *        friction-admin.d.ts.map
 *        payout-mercury.js
 *        payout-mercury.d.ts
 *        payout-mercury.js.map
 *        payout-mercury.d.ts.map
 *
 *      Any future private-ops artifact must be added here AND to
 *      `.npmignore` (defense-in-depth).
 *
 *   2. Re-scan `dist/` after deletion. If any private-ops artifact
 *      survives, exit with code 1 and print a fail-closed message.
 *      This turns an accidental leak into a hard publish failure
 *      instead of a silent ship.
 *
 *   3. Print a one-line summary on success so `npm publish` logs
 *      record what was cleaned.
 *
 * ── Invariants this script preserves ──────────────────────────────────
 *
 *   - Idempotent: safe to run repeatedly. Missing files are a no-op.
 *   - Never touches `src/` or any tracked file. The only mutations
 *     are `rm` inside `dist/`, which is always rebuilt by `npm run build`.
 *   - Never touches non-matching files. The allowlist of basenames is
 *     explicit; no glob wildcards, no prefix matching, no recursive
 *     directory deletion.
 *   - Fails closed. If the post-cleanup scan finds even one leftover
 *     file, exit 1. No soft warnings. No opt-out flag.
 *
 * ── Long-term policy ──────────────────────────────────────────────────
 *
 * This script is an immediate defense-in-depth measure (alpha.42 plan,
 * Option 2). The long-term policy is Option 1: publish only from CI,
 * where the private sources do not exist and the leak is impossible by
 * construction. This script stays in place as belt-and-suspenders even
 * after CI-only publish is enforced.
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *
 *   npm run sanitize:package    # run directly (ad-hoc)
 *   npm pack                    # runs automatically via `prepack`
 *   npm publish                 # runs automatically via `prepack`
 *
 * Exit codes:
 *   0  clean (either nothing to clean, or cleanup succeeded and
 *      verification passed)
 *   1  verification failed — a private-ops artifact survived cleanup
 *      (should not happen; indicates a new leak vector)
 */

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative, sep as pathSep, basename }  from "node:path";
import { fileURLToPath }                             from "node:url";

const HERE      = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(HERE, "..");
const DIST_DIR  = join(REPO_ROOT, "dist");

/**
 * Explicit basename allowlist. Any file inside dist/ whose basename
 * matches one of these entries is a private-ops leak and must be
 * removed before pack. Keep this list EXPLICIT — no prefix matching,
 * no regex, no wildcards. Any new private-ops module has to be added
 * here AND in .npmignore. If you forget either, this script's
 * post-cleanup verify (step 2) will catch it at pack-time.
 */
const PRIVATE_OPS_BASENAMES = new Set([
  "friction-admin.js",
  "friction-admin.d.ts",
  "friction-admin.js.map",
  "friction-admin.d.ts.map",
  "payout-mercury.js",
  "payout-mercury.d.ts",
  "payout-mercury.js.map",
  "payout-mercury.d.ts.map",
]);

/** @param {string} dir @returns {string[]} absolute file paths */
function walkFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st  = statSync(abs);
    if (st.isDirectory()) {
      out.push(...walkFiles(abs));
    } else if (st.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

/** @param {string} abs */
function relativeDisplay(abs) {
  return relative(REPO_ROOT, abs).split(pathSep).join("/");
}

function main() {
  // No dist/ at all? Nothing to sanitize. This happens if `prepack`
  // runs before `prepublishOnly`'s build (it doesn't, per the npm
  // lifecycle ordering) or if someone manually ran this script before
  // building. Either way a no-op is the safe, idempotent behavior —
  // the actual pack will fail anyway on missing `files` entries.
  if (!existsSync(DIST_DIR)) {
    process.stdout.write("sanitize-package: dist/ not present — nothing to clean.\n");
    return;
  }

  const removed = [];

  // Pass 1: delete private-ops artifacts.
  for (const abs of walkFiles(DIST_DIR)) {
    if (PRIVATE_OPS_BASENAMES.has(basename(abs))) {
      rmSync(abs, { force: true });
      removed.push(relativeDisplay(abs));
    }
  }

  // Pass 2: verify cleanup. Walk dist/ again and assert none of the
  // banned basenames survived. This is the fail-closed guard: if a
  // future change in the compiler, the pack lifecycle, or file-system
  // semantics causes a private-ops artifact to slip through, this
  // turns it into an exit-1 at pack time rather than a silent ship.
  const leftovers = walkFiles(DIST_DIR)
    .filter(abs => PRIVATE_OPS_BASENAMES.has(basename(abs)))
    .map(relativeDisplay);

  if (leftovers.length > 0) {
    process.stderr.write(
      "sanitize-package: FAIL — private-ops artifacts survived cleanup.\n"
      + "The following files were expected to be removed from dist/ but remain:\n\n",
    );
    for (const f of leftovers) process.stderr.write(`  ${f}\n`);
    process.stderr.write(
      "\n"
      + "This indicates a release-safety regression. Investigate before packing.\n"
      + "DO NOT publish until this script exits 0.\n",
    );
    process.exit(1);
  }

  if (removed.length === 0) {
    process.stdout.write("sanitize-package: ok (no private-ops artifacts present).\n");
    return;
  }

  process.stdout.write(
    `sanitize-package: removed ${removed.length} private-ops artifact${removed.length === 1 ? "" : "s"} from dist/:\n`,
  );
  for (const f of removed) process.stdout.write(`  - ${f}\n`);
}

main();
