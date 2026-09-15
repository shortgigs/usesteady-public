/**
 * UseSteady Skills v1 — audit logging stub (file 7 of 8).
 *
 * Single responsibility: turn SkillInvocationResult objects into SkillAuditRecord
 * objects and provide an interface for writing those records to a persistence layer.
 *
 * What this file owns:
 *   - Pure record builders (buildAuditRecord, buildAuditRecords) — synchronous,
 *     no I/O, fully deterministic
 *   - The AuditSink interface — the hook for later persistence wiring
 *   - Two built-in sinks: NULL_AUDIT_SINK (testing) and CONSOLE_AUDIT_SINK (dev)
 *
 * What this file does NOT own:
 *   - Deciding which invocations to audit (always all of them)
 *   - Filtering, sampling, or dropping records
 *   - Writing to disk, database, or network directly (that lives in concrete AuditSink implementations)
 *   - Any authority over execution, approval, or policy
 *
 * Persistence compatibility:
 *   SkillAuditRecord is fully JSON-serialisable (no functions, no circular refs,
 *   no non-primitive types beyond Date). Consumers calling JSON.stringify on a
 *   record will get a complete, human-readable snapshot suitable for any store.
 */

import type { InvokeSkillsResult, SkillInvocationResult } from './invocation.js';
import {
  type SkillAuditRecord,
  type TriggerReason,
} from './types.js';

// ---------------------------------------------------------------------------
// Builder options
// ---------------------------------------------------------------------------

/**
 * Options for the audit record builders.
 * All fields are optional — sensible defaults are applied when absent.
 */
export interface BuildAuditOptions {
  /**
   * The timestamp to stamp on every record built in this call.
   * Callers should pass a fixed value when building multiple records for the
   * same invocation batch so all records share the same `invokedAt`.
   * Defaults to `new Date()` when absent.
   */
  readonly invokedAt?: Date;
  /**
   * Map from skill name to its absolute SKILL.md source path.
   * When provided, `sourcePath` is populated on each record.
   * When absent, `sourcePath` is omitted entirely from all records.
   * Build this map from the Skill objects in the registry if you have them.
   */
  readonly sourcePaths?: ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------------------
// Single-record builder
// ---------------------------------------------------------------------------

/**
 * Build one SkillAuditRecord from a SkillInvocationResult and its execution context.
 *
 * The `triggerReason` and `rawInput` come from InvokeSkillsResult; they are
 * passed separately here so this function is also usable outside the batch path.
 *
 * exactOptionalPropertyTypes compliance:
 *   `sourcePath` and `rejectionReason` are physically absent (not set to
 *   undefined) when they have no value — conditional spread achieves this.
 */
export function buildAuditRecord(
  result: SkillInvocationResult,
  triggerReason: TriggerReason,
  rawInput: string,
  options?: BuildAuditOptions,
): SkillAuditRecord {
  const invokedAt     = options?.invokedAt ?? new Date();
  const sourcePath    = options?.sourcePaths?.get(result.skillName);

  // `result.rejectionReason` is `string | undefined` because the field is `?: string`.
  // We check for its presence explicitly rather than comparing to undefined so the
  // conditional spread respects exactOptionalPropertyTypes on the target type.
  const hasRejectionReason = 'rejectionReason' in result;

  return {
    skillName:         result.skillName,
    skillVersion:      result.skillVersion,
    outputSchema:      result.outputSchema,
    rawOutput:         result.rawOutput,
    validationOutcome: result.validationOutcome,
    invokedAt,
    triggerReason,
    rawInput,
    // Optional fields — physically absent when not applicable.
    ...(sourcePath           !== undefined ? { sourcePath }                        : {}),
    ...(hasRejectionReason                 ? { rejectionReason: result.rejectionReason } : {}),
  };
}

// ---------------------------------------------------------------------------
// Batch builder
// ---------------------------------------------------------------------------

/**
 * Build one SkillAuditRecord for each result in an InvokeSkillsResult.
 *
 * All records in the batch share the same `invokedAt` timestamp so they can
 * be correlated as a single invocation event. A fixed timestamp is captured
 * once before the map to avoid per-record clock skew.
 *
 * Returns records in the same order as `invokeResult.results` (priority order).
 */
export function buildAuditRecords(
  invokeResult: InvokeSkillsResult,
  options?: BuildAuditOptions,
): readonly SkillAuditRecord[] {
  // Capture a single timestamp for the whole batch.
  const invokedAt     = options?.invokedAt ?? new Date();
  const sourcePaths   = options?.sourcePaths;

  // Rebuild a concrete options object so buildAuditRecord uses the fixed timestamp.
  const batchOptions: BuildAuditOptions = {
    invokedAt,
    ...(sourcePaths !== undefined ? { sourcePaths } : {}),
  };

  return invokeResult.results.map((result) =>
    buildAuditRecord(
      result,
      invokeResult.triggerReason,
      invokeResult.rawInput,
      batchOptions,
    ),
  );
}

// ---------------------------------------------------------------------------
// AuditSink interface
// ---------------------------------------------------------------------------

/**
 * The persistence hook. Implementations write SkillAuditRecord objects to
 * whatever store is appropriate (file, DB, structured log, HTTP endpoint).
 *
 * Contract:
 *   - Must not mutate the record.
 *   - Must not throw synchronously — wrap errors in the returned Promise.
 *   - Must not block the calling skill invocation path (fire-and-forget is acceptable).
 *   - In v1, third-party sink implementations are not loaded automatically.
 */
export interface AuditSink {
  record(audit: SkillAuditRecord): Promise<void>;
}

// ---------------------------------------------------------------------------
// Built-in sinks
// ---------------------------------------------------------------------------

/**
 * A no-op AuditSink. Use in tests or when audit persistence is not configured.
 * Records are silently discarded. No I/O, no side effects.
 */
export const NULL_AUDIT_SINK: AuditSink = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async record(_audit: SkillAuditRecord): Promise<void> {
    // Intentional no-op.
  },
};

/**
 * A development AuditSink that writes a compact JSON line to stdout.
 * Not for production use — use a structured logging sink there.
 *
 * Output format (one JSON object per line):
 * {
 *   "skill":    "<name>@<version>",
 *   "outcome":  "accepted" | "rejected",
 *   "schema":   "<output_schema>",
 *   "trigger":  "<kind>",
 *   "input":    "<first 80 chars of rawInput>",
 *   "at":       "<ISO 8601 timestamp>",
 *   "reason":   "<rejectionReason>" — only present when rejected
 * }
 */
export const CONSOLE_AUDIT_SINK: AuditSink = {
  async record(audit: SkillAuditRecord): Promise<void> {
    // Build a plain object; JSON.stringify omits undefined values automatically,
    // so `reason` is only present in the output when rejectionReason is defined.
    const entry = {
      skill:   `${audit.skillName}@${audit.skillVersion}`,
      outcome: audit.validationOutcome,
      schema:  audit.outputSchema,
      trigger: audit.triggerReason.kind,
      input:   audit.rawInput.slice(0, 80),
      at:      audit.invokedAt.toISOString(),
      reason:  audit.rejectionReason,          // undefined → omitted by JSON.stringify
      source:  audit.sourcePath,               // undefined → omitted by JSON.stringify
    };
    console.log('[SkillAudit]', JSON.stringify(entry));
  },
};

// ---------------------------------------------------------------------------
// Utility — build a source path map from a registry
// ---------------------------------------------------------------------------

/**
 * Build a ReadonlyMap<string, string> from skill name to source path.
 * Pass the result as `options.sourcePaths` to populate `sourcePath` in
 * audit records.
 *
 * Usage:
 *   const sourcePaths = buildSourcePathMap(registry.all);
 *   const records = buildAuditRecords(result, { sourcePaths });
 *
 * Accepts any iterable of objects with `metadata.name` and `sourcePath`.
 */
export function buildSourcePathMap(
  skills: Iterable<{ readonly metadata: { readonly name: string }; readonly sourcePath: string }>,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const skill of skills) {
    map.set(skill.metadata.name, skill.sourcePath);
  }
  return map;
}
