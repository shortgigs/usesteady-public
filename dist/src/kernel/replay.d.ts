/**
 * Kernel v1 — verification-only replay.
 *
 * ── Scope (PR-K1, locked) ────────────────────────────────────────────────────
 *
 *   This is NOT workflow re-execution. This is artifact integrity verification.
 *
 *   Given a persisted KernelArtifact, recompute
 *     sha256(stableStringify({ ir, result }))
 *   from the stored `ir` and `result` fields and compare it to the stored
 *   `checksum`. If they agree, the artifact is self-consistent. If not, the
 *   artifact has been mutated, corrupted, or was produced by a broken writer.
 *
 *   Full workflow re-execution is deferred to a later kernel PR. This module
 *   does NOT spawn processes, mutate process.argv, import main.js, touch the
 *   workflow coordinator, or perform any side effect other than reading the
 *   artifact file.
 */
import type { ReplayVerdict } from "./types.js";
/**
 * Load a KernelArtifact JSON file and emit a match/mismatch verdict.
 *
 * Throws if the file cannot be read or parsed. A malformed artifact is
 * an error the CLI surfaces; it is NOT silently downgraded to "mismatch".
 */
export declare function runReplay(artifactPath: string): ReplayVerdict;
//# sourceMappingURL=replay.d.ts.map