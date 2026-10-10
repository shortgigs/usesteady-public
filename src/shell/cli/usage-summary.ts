/**
 * usesteady usage summary — no governed effect; may persist bookkeeping (P2).
 *
 * Materializes append-only usage-events.jsonl from existing store data,
 * then aggregates. No execution, billing, or hosted dashboard.
 *
 * D12: observed usage only — see usage-events.ts USAGE_D12_BOUNDARY.
 */

import {
  aggregateUsageSummary,
  materializeUsageEvents,
  readUsageEvents,
  renderUsageSummaryText,
} from "./usage-events.js";
import { resolveStoreDir } from "../defaults.js";

export type UsageCommandArgs =
  | { readonly mode: "help" }
  | { readonly mode: "summary" };

export function parseUsageArgs(argv: readonly string[]): UsageCommandArgs | "usage-error" {
  if (argv.length === 0) return "usage-error";

  const positional = argv.filter((tok) => !tok.startsWith("-"));
  if (positional.length !== 1) return "usage-error";
  if (positional[0] === "summary") return { mode: "summary" };
  return "usage-error";
}

export function renderUsageHelpText(): string {
  return (
    "\n  Usage: usesteady usage summary\n" +
    "\n  Local usage summary (no governed effect; may persist bookkeeping).\n" +
    "  Materializes append-only usage-events.jsonl from existing store data,\n" +
    "  then aggregates. That is store bookkeeping, not a workspace mutation.\n" +
    "  Not a no-state-mutation command.\n" +
    "  Reports observed usage only — tokens and cost are unknown unless\n" +
    "  directly recorded in existing store artifacts (no inference).\n" +
    "  Does not execute workflows or require --yes.\n" +
    "  Default audit store is ephemeral (OS temp). Set USESTEADY_STORE_DIR\n" +
    "  to a directory outside the OS temp folder for configured local storage; retention is not guaranteed.\n\n"
  );
}

export type UsageSummaryResult = {
  readonly exitCode: 0 | 2;
  readonly stdout: string;
  readonly stderr: string;
};

export function runUsageSummary(
  storeDir: string = resolveStoreDir(),
): UsageSummaryResult {
  materializeUsageEvents(storeDir);
  const events = readUsageEvents(storeDir);
  const summary = aggregateUsageSummary(events);
  return {
    exitCode: 0,
    stdout:   renderUsageSummaryText(summary),
    stderr:   "",
  };
}

export function runUsageCommand(
  args: UsageCommandArgs,
  options: { readonly storeDir?: string } = {},
): UsageSummaryResult {
  if (args.mode === "help") {
    return { exitCode: 0, stdout: renderUsageHelpText(), stderr: "" };
  }
  return runUsageSummary(options.storeDir);
}
