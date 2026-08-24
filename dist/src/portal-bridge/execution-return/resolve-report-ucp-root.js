/**
 * Resolve the ucp_root_id for --report-to-portal payloads.
 *
 * Portal reports must carry a Core-valid intent root (64-char content hash),
 * never workflowRunId (16-char run identifier).
 *
 * Feature 2.3: the selected root is materialized, strictly persisted when
 * absent, and exactly read back before any certification chain snapshot.
 */
import { computeChainVerification } from "../../ucp/chain-verification.js";
import { mapIntentToEnvelope } from "../../ucp/mappers/map-intent.js";
import { getChain, getEnvelopeById } from "../../ucp/persistence/query.js";
import { persistEnvelopeOrThrow } from "../../ucp/persistence/write.js";
const INTENT_TYPE = "ucp.intent.v1";
export class CertificationReportSnapshotError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "CertificationReportSnapshotError";
        this.code = code;
    }
}
function primaryTaskInput(run) {
    const fromTask = run.tasks.find(t => typeof t.spec.input === "string" && t.spec.input.trim().length > 0)?.spec.input;
    if (fromTask)
        return fromTask;
    return run.spec.tasks[0]?.input ?? "";
}
function selectedReportRoot(run) {
    const fromTask = run.tasks.find(t => typeof t.intentId === "string" && t.intentId.length > 0);
    if (fromTask && typeof fromTask.intentId === "string") {
        const taskInput = typeof fromTask.spec.input === "string" && fromTask.spec.input.trim().length > 0
            ? fromTask.spec.input
            : primaryTaskInput(run);
        return { selectedId: fromTask.intentId, input: taskInput };
    }
    return { selectedId: null, input: primaryTaskInput(run) };
}
/**
 * Existing root-selection identity, plus strict persist + exact read-back.
 * Throws on identity mismatch, persist failure, or read-back mismatch.
 */
export function resolveReportUcpRootId(run, storeDir) {
    const selected = selectedReportRoot(run);
    const envelope = mapIntentToEnvelope(selected.input.trim());
    if (selected.selectedId !== null && envelope.id !== selected.selectedId) {
        throw new CertificationReportSnapshotError("root_identity_mismatch", "selected report root does not match the deterministic intent envelope");
    }
    const rootId = envelope.id;
    const existing = getEnvelopeById(storeDir, rootId);
    if (existing === null) {
        try {
            persistEnvelopeOrThrow(storeDir, envelope);
        }
        catch (err) {
            throw new CertificationReportSnapshotError("root_persist_failed", err instanceof Error ? err.message : String(err));
        }
    }
    const readBack = getEnvelopeById(storeDir, rootId);
    if (readBack === null || readBack.id !== rootId || readBack.type !== INTENT_TYPE) {
        throw new CertificationReportSnapshotError("root_readback_mismatch", "exact report-root read-back failed");
    }
    return rootId;
}
/**
 * One immutable ordered-ID snapshot. Call only after root acknowledgement.
 */
export function captureCertificationChainSnapshot(storeDir, ucpRootId) {
    const chain = getChain(storeDir, ucpRootId);
    const entryIds = Object.freeze(chain.map((env) => env.id).slice());
    if (entryIds.length === 0) {
        throw new CertificationReportSnapshotError("empty_snapshot", "certification chain snapshot is empty");
    }
    if (entryIds[0] !== ucpRootId) {
        throw new CertificationReportSnapshotError("snapshot_root_mismatch", "certification chain snapshot does not begin with the selected root");
    }
    const seen = new Set();
    for (const id of entryIds) {
        if (typeof id !== "string" || id.trim().length === 0) {
            throw new CertificationReportSnapshotError("invalid_snapshot_id", "certification chain snapshot contains an empty id");
        }
        if (seen.has(id)) {
            throw new CertificationReportSnapshotError("duplicate_snapshot_id", "certification chain snapshot contains a duplicate id");
        }
        seen.add(id);
    }
    const chainVerification = computeChainVerification(entryIds);
    if (chainVerification === null) {
        throw new CertificationReportSnapshotError("snapshot_verification_failed", "could not compute certification chain verification");
    }
    if (chainVerification.entry_ids.length !== entryIds.length) {
        throw new CertificationReportSnapshotError("snapshot_count_mismatch", "chain verification length diverged from the copied snapshot");
    }
    return Object.freeze({
        ucpRootId,
        entryIds,
        chainCount: entryIds.length,
        chainVerification,
    });
}
/**
 * Root acknowledgement, then one snapshot. getChain cannot run first.
 */
export function prepareCertificationReportSnapshot(run, storeDir) {
    const ucpRootId = resolveReportUcpRootId(run, storeDir);
    return captureCertificationChainSnapshot(storeDir, ucpRootId);
}
export { primaryTaskInput };
//# sourceMappingURL=resolve-report-ucp-root.js.map