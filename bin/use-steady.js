#!/usr/bin/env node
/**
 * usesteady — public distribution bin wrapper.
 *
 * Imports the compiled public CLI entry from dist/.
 * Governed-decision verbs are not a public route.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicEntry = resolve(__dirname, "../dist/src/shell/cli/use-steady.js");

await import(pathToFileURL(publicEntry).href);
