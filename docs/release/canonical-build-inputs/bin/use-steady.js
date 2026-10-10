#!/usr/bin/env node
/**
 * usesteady — bin wrapper.
 *
 * Imports the compiled CLI entry point from dist/.
 * No tsx or TypeScript runtime needed — tsc produces plain JS.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Governed-decision namespace (A1) — separate from legacy workflow CLI. */
const GOVERNED_COMMANDS = new Set([
  "decide",
  "ratify",
  "show",
  "lineage",
  "decisions",
]);

const subcommand = process.argv[2];
const governedEntry = resolve(__dirname, "../dist/src/governed-decision/cli-entry.js");
const proofEntry = resolve(__dirname, "../dist/src/proof/cli-entry.js");
const legacyEntry = resolve(__dirname, "../dist/src/shell/cli/use-steady.js");

if (subcommand === "proof") {
  await import(pathToFileURL(proofEntry).href);
} else if (subcommand !== undefined && GOVERNED_COMMANDS.has(subcommand)) {
  await import(pathToFileURL(governedEntry).href);
} else {
  await import(pathToFileURL(legacyEntry).href);
}
