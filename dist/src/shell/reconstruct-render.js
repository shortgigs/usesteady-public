/**
 * Reconstruct shell rendering — pure text + JSON projection.
 * No I/O. No store reads. No authority.
 */
const EM_DASH = "\u2014";
export function renderReconstructHelpText() {
    return ("usesteady reconstruct — rebuild what happened from a UCP root (read-only)\n\n" +
        "  usesteady reconstruct <ucp_root_id>\n" +
        "  usesteady reconstruct --ucp-root-id <ucp_root_id>\n" +
        "  usesteady reconstruct <ucp_root_id> --output json\n\n" +
        "  Reads the local UCP store only. No Portal. No network.\n" +
        "  Set USESTEADY_STORE_DIR for durable certification runs.\n\n");
}
export function renderReconstructJson(report) {
    return JSON.stringify(report, null, 2) + "\n";
}
function truncate(value, max) {
    if (value.length <= max)
        return value;
    return value.slice(0, max - 1) + "\u2026";
}
export function renderReconstructText(report) {
    const lines = [];
    lines.push("RECONSTRUCT (read-only)");
    lines.push(`  UCP root:  ${report.ucp_root_id}`);
    lines.push(`  Store:     ${report.store_dir}`);
    lines.push(`  Status:    ${report.status.toUpperCase()}`);
    lines.push("");
    if (report.status === "not_found") {
        lines.push("  No envelope found for this UCP root in the store.");
        lines.push("");
        return lines.join("\n");
    }
    if (report.intent_input !== null) {
        lines.push(`  Intent:    ${truncate(report.intent_input, 72)}`);
    }
    lines.push(`  Chain:     ${report.chain.envelope_count} envelope(s)`);
    for (const entry of report.chain.entries) {
        lines.push(`    - ${entry.type}  ${entry.id.slice(0, 16)}\u2026`);
    }
    if (report.chain_verification !== null) {
        const cv = report.chain_verification;
        lines.push("");
        lines.push("  Integrity (P0-4):");
        lines.push(`    cumulative_hash: ${cv.cumulative_hash.slice(0, 16)}\u2026`);
        lines.push(`    merkle_root:     ${cv.merkle_root.slice(0, 16)}\u2026`);
    }
    if (report.workflow !== null) {
        const w = report.workflow;
        lines.push("");
        lines.push(`  Workflow:  ${w.workflowName} (${w.workflowRunId})`);
        lines.push(`  Final:     ${w.finalOutcome} (${w.taskCount} task(s))`);
        for (const task of w.tasks) {
            const input = task.input !== null ? truncate(task.input, 40) : EM_DASH;
            lines.push(`    Task ${task.taskIndex + 1}: ${task.outcome}  ${input}`);
        }
    }
    if (report.replay !== null) {
        const r = report.replay;
        lines.push("");
        lines.push("  Replay:");
        lines.push(`    verdict:   ${r.replayReportVerdict ?? EM_DASH}`);
        lines.push(`    checksum:  ${r.checksum ?? EM_DASH}`);
        lines.push(`    artifact:  ${r.artifactPresent ? "present" : "missing"}`);
    }
    if (report.gaps.length > 0) {
        lines.push("");
        lines.push("  Gaps:");
        for (const gap of report.gaps) {
            lines.push(`    - ${gap}`);
        }
    }
    lines.push("");
    lines.push("  Reconstruction is read-only. It does not execute, approve, or replay.");
    lines.push("");
    return lines.join("\n");
}
//# sourceMappingURL=reconstruct-render.js.map