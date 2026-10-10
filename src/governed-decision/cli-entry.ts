/**
 * Governed-decision CLI bin entry — dispatched from bin/use-steady.js when the
 * first argument is a governed subcommand (decide, ratify, show, lineage, decisions).
 *
 * Legacy workflow CLI is never loaded on this path.
 */

import { runGovernedDecisionCli } from "./cli.js";

const code = await runGovernedDecisionCli(process.argv.slice(2), {
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    process.stderr.write(`${line}\n`);
  },
});

process.exitCode = code;
