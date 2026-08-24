/**
 * usesteady usage summary — read-only local usage + cost visibility (P2).
 *
 * Materializes append-only usage-events.jsonl from existing store data,
 * then aggregates. No execution, billing, or hosted dashboard.
 *
 * D12: observed usage only — see usage-events.ts USAGE_D12_BOUNDARY.
 */
import { aggregateUsageSummary, materializeUsageEvents, readUsageEvents, renderUsageSummaryText, } from "./usage-events.js";
import { resolveStoreDir } from "../defaults.js";
export function parseUsageArgs(argv) {
    if (argv.length === 0)
        return "usage-error";
    const positional = argv.filter((tok) => !tok.startsWith("-"));
    if (positional.length !== 1)
        return "usage-error";
    if (positional[0] === "summary")
        return { mode: "summary" };
    return "usage-error";
}
export function renderUsageHelpText() {
    return ("\n  Usage: usesteady usage summary\n" +
        "\n  Read-only local usage summary from append-only usage-events.jsonl.\n" +
        "  Reports observed usage only — tokens and cost are unknown unless\n" +
        "  directly recorded in existing store artifacts (no inference).\n" +
        "  Does not execute workflows or require --yes.\n\n");
}
export function runUsageSummary(storeDir = resolveStoreDir()) {
    materializeUsageEvents(storeDir);
    const events = readUsageEvents(storeDir);
    const summary = aggregateUsageSummary(events);
    return {
        exitCode: 0,
        stdout: renderUsageSummaryText(summary),
        stderr: "",
    };
}
export function runUsageCommand(args, options = {}) {
    if (args.mode === "help") {
        return { exitCode: 0, stdout: renderUsageHelpText(), stderr: "" };
    }
    return runUsageSummary(options.storeDir);
}
//# sourceMappingURL=usage-summary.js.map