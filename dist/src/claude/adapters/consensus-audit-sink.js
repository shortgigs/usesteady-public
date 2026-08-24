/**
 * Consensus audit durable sink (P4).
 *
 * ── What this module is ───────────────────────────────────────────────────────
 *
 *   The append-only durable home for ConsensusAuditRecord. Before P4 the
 *   multi-LLM adapter wrote each record to process.stderr only — a diagnostic
 *   stream, not evidence: ephemeral, not replayable, lost on process exit.
 *   INV-ML-6 requires a record for every receive() call; this module makes
 *   that record durable.
 *
 * ── What this module is NOT ───────────────────────────────────────────────────
 *
 *   - NOT a behavior change. Consensus rules, hashes, response selection, and
 *     the returned ClaudeDeliveryResponse are byte-behaviorally unchanged.
 *     The stderr diagnostic line is still written by the caller.
 *   - NOT an authority. The sink records; it never affects gating, consensus,
 *     delivery, or execution.
 *   - NOT a lossless guarantee. Writes are best-effort at the call site: a
 *     sink failure is swallowed and never affects the response path.
 *
 * ── File ──────────────────────────────────────────────────────────────────────
 *
 *   <storeDir>/consensus-audit.jsonl — one JSON object per line, append-only,
 *   never rewritten, never truncated by this module.
 *
 *   Directory resolution order:
 *     1. USESTEADY_CONSENSUS_AUDIT_DIR (explicit override; tests use this)
 *     2. resolveStoreDir() — the standard UCP store dir (env-overridable via
 *        USESTEADY_STORE_DIR, default os.tmpdir()/usesteady-ucp)
 */
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { resolveStoreDir } from "../../shell/defaults.js";
export const CONSENSUS_AUDIT_LOG_FILENAME = "consensus-audit.jsonl";
export const CONSENSUS_AUDIT_DIR_ENV = "USESTEADY_CONSENSUS_AUDIT_DIR";
/** Resolve the directory holding the durable consensus audit log. */
export function resolveConsensusAuditDir() {
    const override = process.env[CONSENSUS_AUDIT_DIR_ENV];
    if (override !== undefined && override.length > 0)
        return override;
    return resolveStoreDir();
}
/** Absolute path of the durable consensus audit log for a directory. */
export function consensusAuditLogPath(dir) {
    return join(dir, CONSENSUS_AUDIT_LOG_FILENAME);
}
/**
 * appendConsensusAuditRecord — append one record as a single JSON line.
 *
 * Throws on I/O failure; the caller (writeAudit) wraps this in best-effort
 * semantics. Synchronous by design: the audit write must complete before the
 * response is returned so the durable record never trails the decision it
 * documents.
 */
export function appendConsensusAuditRecord(dir, record) {
    mkdirSync(dir, { recursive: true });
    appendFileSync(consensusAuditLogPath(dir), JSON.stringify(record) + "\n", "utf8");
}
//# sourceMappingURL=consensus-audit-sink.js.map