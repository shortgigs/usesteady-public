/**
 * Workflow Health render — read-only text (INV-DIAG-IMPL-2).
 */
import { suggestedActionForCode } from "./suggested-actions.js";
function suggestedActionMatchesCode(action, code) {
    return action === suggestedActionForCode(code);
}
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
export function renderWorkflowHealthSection(record) {
    const lines = [
        "",
        "  --- Workflow Health (observations only) ---",
        `  Status: ${capitalize(record.overall)}`,
        "",
    ];
    const warnings = record.observations.filter((o) => o.severity === "warn");
    const errors = record.observations.filter((o) => o.severity === "error");
    if (warnings.length > 0) {
        lines.push("  Warnings:");
        for (const o of warnings) {
            lines.push(`    - ${o.code}: ${o.message}`);
        }
        lines.push("");
    }
    if (errors.length > 0) {
        lines.push("  Errors:");
        for (const o of errors) {
            lines.push(`    - ${o.code}: ${o.message}`);
        }
        lines.push("");
    }
    if (record.overall === "healthy") {
        lines.push("  No workflow health warnings or errors.");
        lines.push("");
    }
    if (record.suggested_actions.length > 0) {
        lines.push("  Suggested actions (advisory only):");
        for (const action of record.suggested_actions) {
            lines.push(`    - ${action}`);
        }
        lines.push("");
    }
    lines.push("  Diagnostics observe only — they do not fix, gate, or mutate state.");
    lines.push("");
    return lines.join("\n");
}
export function renderEntitlementHealthSummary(record) {
    const entitlement = record.observations.filter((o) => o.class === "entitlement");
    const lines = [
        "",
        "  --- Entitlement health (observations only) ---",
    ];
    if (record.effective_state) {
        lines.push(`  effective_state.branch: ${record.effective_state.branch}`);
        lines.push(`  effective_state.state:  ${record.effective_state.state}`);
        if (record.effective_state.detail) {
            lines.push(`  note: ${record.effective_state.detail}`);
        }
    }
    if (entitlement.length === 0) {
        lines.push("  No entitlement-class observations.");
    }
    else {
        for (const o of entitlement) {
            lines.push(`  [${o.severity}] ${o.code}: ${o.message}`);
        }
    }
    const entitlementActions = record.suggested_actions.filter((action) => entitlement.some((o) => suggestedActionMatchesCode(action, o.code)));
    if (entitlementActions.length > 0) {
        lines.push("");
        lines.push("  Suggested actions (advisory only):");
        for (const action of entitlementActions) {
            lines.push(`    - ${action}`);
        }
    }
    lines.push("");
    return lines.join("\n");
}
//# sourceMappingURL=render.js.map