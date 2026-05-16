#!/usr/bin/env node
/**
 * scripts/verify-relative-links.mjs
 *
 * Lightweight routing guard for usesteady-public.
 *
 * Scans every .md file in docs/ and the root README for markdown-style
 * relative links and image sources. For each, checks:
 *
 *   1. The target file exists on disk (relative to the .md file).
 *   2. The link does not reference any of the forbidden hosts/paths.
 *
 * Forbidden:
 *   - shortgigs/usesteady-core         (private repo)
 *   - shortgigsfounder/usesteady       (legacy/wrong org)
 *   - localhost / 127.0.0.1            (not portable to public)
 *   - file://                          (operator-local path)
 *
 * No dependencies. Runs against the working tree.
 *
 * Exit code 0 if everything resolves; 1 otherwise.
 *
 * Run: `node scripts/verify-relative-links.mjs`
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");

const FORBIDDEN_HOSTS = [
  /https?:\/\/github\.com\/shortgigs\/usesteady-core(\/|$|")/,
  /https?:\/\/github\.com\/shortgigsfounder\/usesteady(\/|$|")/,
  /https?:\/\/localhost(:\d+)?(\/|$|")/,
  /https?:\/\/127\.0\.0\.1(:\d+)?(\/|$|")/,
  /(?<![A-Za-z])file:\/\//,
];

/**
 * Markdown link patterns we want to inspect.
 *   - inline links/images:  `[text](target)`, `![alt](target)`
 *   - HTML <a href="...">    and <img src="...">
 *
 * Reference-style links (`[text][ref]` + later `[ref]: target`) are
 * uncommon in this repo and skipped.
 */
const PATTERNS = [
  /!?\[[^\]]*\]\(([^)\s]+)\)/g,
  /<a\s+[^>]*href="([^"]+)"/g,
  /<img\s+[^>]*src="([^"]+)"/g,
];

const errors = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function checkFile(mdPath) {
  const body  = readFileSync(mdPath, "utf8");
  const here  = dirname(mdPath);
  const rel   = mdPath.substring(ROOT.length + 1).replace(/\\/g, "/");

  for (const pat of PATTERNS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(body)) !== null) {
      const raw = m[1].trim();

      // Forbidden hosts.
      for (const fpat of FORBIDDEN_HOSTS) {
        if (fpat.test(raw)) {
          errors.push(`  ${rel}: forbidden link target -> ${raw}`);
        }
      }

      // External and anchor-only links are not file-resolvability checked.
      if (
        raw.startsWith("http://")  ||
        raw.startsWith("https://") ||
        raw.startsWith("mailto:")  ||
        raw.startsWith("#")        ||
        raw.startsWith("tel:")
      ) continue;

      // Strip in-page anchors and query strings.
      const cleanRaw = raw.replace(/[#?].*$/, "");
      if (cleanRaw.length === 0) continue;

      const targetPath = resolve(here, cleanRaw);
      if (!existsSync(targetPath)) {
        errors.push(`  ${rel}: dangling relative link -> ${raw}  (resolved: ${targetPath.substring(ROOT.length + 1)})`);
      }
    }
  }
}

process.stdout.write("verify-relative-links.mjs\n");
process.stdout.write(`  ROOT = ${ROOT}\n`);

const mdFiles = walk(ROOT);
process.stdout.write(`  scanning ${mdFiles.length} .md file(s)\n\n`);

for (const f of mdFiles) checkFile(f);

if (errors.length === 0) {
  process.stdout.write("ok: all markdown links resolve and no forbidden host references found.\n");
  process.exit(0);
}

process.stdout.write(`failed: ${errors.length} issue(s) found:\n`);
for (const e of errors) process.stdout.write(`${e}\n`);
process.exit(1);
