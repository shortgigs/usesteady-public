/**
 * Workflow spec safety gate — single-authority safety for the web entry path.
 *
 * USESTEADY Trust Surface Model, Phase 2 (single-authority safety).
 *
 * The CLI runs `runSafetyGate` on the verbatim NL of every entry surface
 * (draft, json, nl) before any SYSTEM WILL preview is shown. The web
 * `POST /api/workflow/start` historically ran NO safety gate at all, so the
 * approval boundary depended on the entry path. This module closes that gap:
 * it applies the SAME `runSafetyGate` to a `WorkflowSpec` so both surfaces
 * share one safety authority.
 *
 * Shared-module discipline (mirrors `clarify-surface.ts`): `server.ts` and the
 * test/cert import THIS function, so the safety decision exercised in tests is
 * the exact decision the web surface makes.
 *
 * Authority: this is the safety gate (a constraint authority), not a routing
 * descriptor. It returns a verdict; it never executes, approves, or mutates.
 * Safety verdicts are evaluated on the user's verbatim intent (`task.input`)
 * and on any explicit `command`, matching the CLI's verbatim-NL gating surface.
 */
import { runSafetyGate } from "../safety/safety-gate.js";
/**
 * Canonical per-operation safety strings for a task's STRUCTURED fields.
 *
 * Closes the structured-op bypass (p2-fastpath): the verbatim `input` may be
 * benign while a structured op carries the real action (e.g. a JSON spec with
 * `operationType: "delete_file"` + a `../../etc` target). This synthesizes the
 * canonical verb+path phrasing the same detectors recognize for NL — mirroring
 * the CLI `--json` path's `safetyInputs` — so structured ops get the SAME
 * single safety authority. Raw path tokens (targetFiles, newPath) are also
 * gated so path-traversal in any path field is caught regardless of verb.
 *
 * Deliberately does NOT gate file CONTENT (`content`, replace values): those
 * are data, not operations. Gating them would over-block legitimate file
 * bodies (e.g. docs that mention "rm -rf"), eroding the safety signal.
 */
function canonicalOpSafetyStrings(task) {
    const out = [];
    const target = task.targetFiles?.[0];
    switch (task.operationType) {
        case "delete_file":
            if (target)
                out.push(`delete ${target}`);
            break;
        case "create_dir":
            if (target)
                out.push(`create folder ${target}`);
            break;
        case "write_file":
            if (target)
                out.push(`create file ${target}`);
            break;
        case "append_file":
            if (target)
                out.push(`append to ${target}`);
            break;
        case "prepend_file":
            if (target)
                out.push(`prepend to ${target}`);
            break;
        case "rename":
            if (target)
                out.push(`rename ${target} to ${task.newPath ?? ""}`.trim());
            break;
        case "replace":
            if (task.structuredReplace)
                out.push(`replace in ${task.structuredReplace.filePath}`);
            break;
        case "run_command":
            // `command` is gated directly by the caller; nothing extra to synthesize.
            break;
        default:
            break;
    }
    // Always gate raw path tokens so traversal (../) in any path field is caught.
    for (const f of task.targetFiles ?? [])
        out.push(f);
    if (typeof task.newPath === "string" && task.newPath.trim().length > 0) {
        out.push(task.newPath);
    }
    if (task.structuredReplace)
        out.push(task.structuredReplace.filePath);
    return out;
}
/**
 * Gate every task in a spec through the shared `runSafetyGate`, returning the
 * FIRST blocking verdict (fail-closed, deterministic by task order). Each task
 * is gated on its verbatim `input` and, when present, its explicit `command`.
 *
 * Returns `{ verdict: "allow" }` only when no task blocks on any surface.
 */
export function gateWorkflowSpecSafety(spec) {
    for (let i = 0; i < spec.tasks.length; i++) {
        const task = spec.tasks[i];
        if (!task)
            continue;
        const candidates = [task.input];
        if (typeof task.command === "string" && task.command.trim().length > 0) {
            candidates.push(task.command);
        }
        // p2-fastpath: also gate canonical strings synthesized from STRUCTURED
        // fields so a benign `input` can't smuggle a dangerous structured op past
        // the single safety authority.
        candidates.push(...canonicalOpSafetyStrings(task));
        for (const candidate of candidates) {
            const result = runSafetyGate(candidate);
            if (result.verdict === "block") {
                return {
                    verdict: "block",
                    ...(result.reason !== undefined ? { reason: result.reason } : {}),
                    ...(result.detectorId !== undefined ? { detectorId: result.detectorId } : {}),
                    ...(result.matchedPattern !== undefined ? { matchedPattern: result.matchedPattern } : {}),
                    ...(result.note !== undefined ? { note: result.note } : {}),
                    blockedTaskIndex: i,
                    blockedInput: candidate,
                };
            }
        }
    }
    return { verdict: "allow" };
}
//# sourceMappingURL=spec-safety-gate.js.map