import type { FsChange } from "../understand/interpretation/types.js";
import { EFFECT_REFUSAL_CODES } from "./effect-decision.js";
import type { EffectDecision, EffectRefusalCode } from "./effect-decision.js";

type FsEffectDiagnostics = {
  readonly detail?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
};

/** Validated report variants. Legacy producers are validated at runtime. */
export type FsEffectExecutorReport = FsEffectDiagnostics & (
  | {
      readonly kind: "accepted";
      readonly errorCode?: never;
      readonly resultingContentSha256?: string;
    }
  | {
      readonly kind: "failed";
      readonly errorCode?: EffectRefusalCode;
      readonly resultingContentSha256?: never;
    }
);

export type FsEffectExecutor = {
  // A TypeScript annotation on an adapter is not runtime validation.
  executeFsOp(op: FsChange): Promise<unknown>;
};

type NonSemanticReport = FsEffectDiagnostics & {
  readonly kind: "failed";
  readonly errorCode?: never;
  readonly resultingContentSha256?: never;
};

type ValidationIssue =
  | "invalid_shape"
  | "invalid_kind"
  | "invalid_diagnostics"
  | "invalid_error_code"
  | "contradictory_report";

export type FsEffectBoundaryOutcome =
  | {
      readonly kind: "decision";
      readonly decision: EffectDecision;
      readonly executorReport: FsEffectExecutorReport;
    }
  | {
      readonly kind: "non_semantic_failure";
      readonly detail?: string;
      // Always a safe failure projection, NEVER the unvalidated input. The
      // coordinator may consume this field without accepting a malformed report.
      readonly executorReport: NonSemanticReport;
      readonly validationIssue?: ValidationIssue;
      /** Evidence only; not a decision, a success report, or durable storage. */
      readonly rawExecutorReport?: unknown;
    };

const REPORT_FIELDS = [
  "kind", "detail", "stdout", "stderr", "exitCode", "errorCode",
  "resultingContentSha256",
] as const;

/** Snapshot own data fields once; do not execute report getters. */
function readReportFields(report: unknown): Record<string, unknown> | null {
  if (report === null || typeof report !== "object") return null;
  try {
    if (Array.isArray(report)) return null;
    const prototype = Object.getPrototypeOf(report);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const fields: Record<string, unknown> = Object.create(null);
    for (const key of REPORT_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(report, key);
      if (descriptor !== undefined && !("value" in descriptor)) return null;
      fields[key] = descriptor?.value;
    }
    return fields;
  } catch {
    // A hostile/revoked proxy is not an executor data record.
    return null;
  }
}

function diagnostics(fields: Record<string, unknown>): FsEffectDiagnostics {
  return {
    ...(typeof fields.detail === "string" ? { detail: fields.detail } : {}),
    ...(typeof fields.stdout === "string" ? { stdout: fields.stdout } : {}),
    ...(typeof fields.stderr === "string" ? { stderr: fields.stderr } : {}),
    ...(typeof fields.exitCode === "number" && Number.isSafeInteger(fields.exitCode)
      ? { exitCode: fields.exitCode } : {}),
  };
}

function invalidReport(
  report: unknown,
  issue: ValidationIssue,
  fields: Record<string, unknown> = {},
): FsEffectBoundaryOutcome {
  const diagnostic = diagnostics(fields);
  const detail = `Invalid filesystem executor report (${issue}). Outcome is uncertain; ` +
    "this is not success and does not prove that no side effect occurred." +
    (diagnostic.detail !== undefined ? ` Executor detail: ${diagnostic.detail}` : "");
  return {
    kind: "non_semantic_failure",
    validationIssue: issue,
    detail,
    rawExecutorReport: report,
    executorReport: Object.freeze({ ...diagnostic, kind: "failed", detail }),
  };
}

/**
 * Classify data, not authority. Never infer a refusal from diagnostic text.
 * Validated snapshots prevent later producer mutation from changing a decision.
 * The content hash is passed through, not recomputed or independently verified.
 */
export function classifyFsEffectReport(report: unknown): FsEffectBoundaryOutcome {
  const fields = readReportFields(report);
  if (fields === null) return invalidReport(report, "invalid_shape");
  if (fields.kind !== "accepted" && fields.kind !== "failed") {
    return invalidReport(report, "invalid_kind", fields);
  }
  for (const key of ["detail", "stdout", "stderr", "resultingContentSha256"] as const) {
    if (fields[key] !== undefined && typeof fields[key] !== "string") {
      return invalidReport(report, "invalid_diagnostics", fields);
    }
  }
  if (fields.exitCode !== undefined &&
      (typeof fields.exitCode !== "number" || !Number.isSafeInteger(fields.exitCode))) {
    return invalidReport(report, "invalid_diagnostics", fields);
  }
  if ((fields.kind === "accepted" &&
       (fields.errorCode !== undefined || (fields.exitCode !== undefined && fields.exitCode !== 0))) ||
      (fields.kind === "failed" && fields.resultingContentSha256 !== undefined)) {
    return invalidReport(report, "contradictory_report", fields);
  }

  const diagnostic = diagnostics(fields);
  if (fields.kind === "accepted") {
    const hash = typeof fields.resultingContentSha256 === "string"
      ? { resultingContentSha256: fields.resultingContentSha256 } : {};
    return {
      kind: "decision",
      decision: Object.freeze({ kind: "accepted", ...hash }),
      executorReport: Object.freeze({ ...diagnostic, kind: "accepted", ...hash }),
    };
  }

  if (fields.errorCode === undefined) {
    return {
      kind: "non_semantic_failure",
      ...(diagnostic.detail !== undefined ? { detail: diagnostic.detail } : {}),
      executorReport: Object.freeze({ ...diagnostic, kind: "failed" }),
    };
  }
  const code = EFFECT_REFUSAL_CODES.find(known => known === fields.errorCode);
  if (code === undefined) return invalidReport(report, "invalid_error_code", fields);
  return {
    kind: "decision",
    decision: Object.freeze({
      kind: "refused",
      code,
      ...(diagnostic.detail !== undefined ? { detail: diagnostic.detail } : {}),
    }),
    executorReport: Object.freeze({ ...diagnostic, kind: "failed", errorCode: code }),
  };
}

/** One invocation, same operation and method receiver; no retry or new approval. */
export async function executeFsEffect(
  executor: FsEffectExecutor,
  op: FsChange,
): Promise<FsEffectBoundaryOutcome> {
  // Rejections/throws still propagate unchanged. Do not invent a report or
  // classify an exception as proof of a semantic refusal/no side effect.
  return classifyFsEffectReport(await executor.executeFsOp(op));
}
