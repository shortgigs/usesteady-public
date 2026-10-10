import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ClaudeDeliveryRequest } from "../claude/types.js";
import type { CursorDeliveryRequest } from "../cursor/types.js";
import type { OutcomeVerification } from "./outcome-verification.js";

export type PreparedSessionFileObservation = {
  readonly runtime: "cursor" | "claude";
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly expectedPostSha256: string;
};

function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function containedTarget(workspaceRoot: string, relativePath: string): string | null {
  if (relativePath.trim().length === 0 || isAbsolute(relativePath)) return null;
  const root = resolve(workspaceRoot);
  const target = resolve(root, relativePath);
  const rel = relative(root, target);
  if (rel === "" || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) return null;
  try {
    const st = lstatSync(target);
    if (!st.isFile() || st.isSymbolicLink()) return null;
    const real = realpathSync(target);
    const realRel = relative(root, real);
    if (realRel === "" || realRel === ".." || realRel.startsWith(".." + sep) || isAbsolute(realRel)) return null;
  } catch {
    return null;
  }
  return target;
}

function prepare(
  runtime: "cursor" | "claude",
  workspaceRoot: string | undefined,
  filePath: string | undefined,
  oldValue: string | undefined,
  newValue: string | undefined,
): PreparedSessionFileObservation | null {
  if (workspaceRoot === undefined || filePath === undefined || oldValue === undefined || newValue === undefined) return null;
  if (oldValue.length === 0) return null;
  const target = containedTarget(workspaceRoot, filePath);
  if (target === null) return null;

  let before: string;
  try {
    before = readFileSync(target, "utf8");
  } catch {
    return null;
  }

  const first = before.indexOf(oldValue);
  if (first < 0 || before.indexOf(oldValue, first + oldValue.length) >= 0) return null;
  const after = before.slice(0, first) + newValue + before.slice(first + oldValue.length);
  return {
    runtime,
    relativePath: filePath,
    absolutePath: target,
    expectedPostSha256: sha256Utf8(after),
  };
}

export function prepareCursorObservation(
  request: CursorDeliveryRequest,
  workspaceRoot?: string,
): PreparedSessionFileObservation | null {
  const rawRequest: unknown = request;
  if (!isRecord(rawRequest)) return null;
  const artifact = isRecord(rawRequest["artifact"]) ? rawRequest["artifact"] : undefined;
  const changeSpec = isRecord(artifact?.["changeSpec"]) ? artifact["changeSpec"] : undefined;
  const parsed = isRecord(changeSpec?.["parsedChange"]) ? changeSpec["parsedChange"] : undefined;
  return prepare(
    "cursor",
    workspaceRoot,
    stringField(parsed, "filePath"),
    stringField(parsed, "oldValue"),
    stringField(parsed, "newValue"),
  );
}

export function prepareClaudeObservation(
  request: ClaudeDeliveryRequest,
  workspaceRoot?: string,
): PreparedSessionFileObservation | null {
  const rawRequest: unknown = request;
  if (!isRecord(rawRequest)) return null;
  const artifact = isRecord(rawRequest["artifact"]) ? rawRequest["artifact"] : undefined;
  const taskSpec = isRecord(artifact?.["taskSpec"]) ? artifact["taskSpec"] : undefined;
  const parsed = isRecord(taskSpec?.["parsedChange"]) ? taskSpec["parsedChange"] : undefined;
  return prepare(
    "claude",
    workspaceRoot,
    stringField(parsed, "filePath"),
    stringField(parsed, "oldValue"),
    stringField(parsed, "newValue"),
  );
}

/**
 * Independently read reality after a runtime reports acceptance.
 * Matching post-state is evidence. Non-match remains unknown because generic
 * Cursor/Claude acceptance may represent delivery/session acceptance rather
 * than synchronous effect completion.
 */
export function observePreparedSessionEffect(
  prepared: PreparedSessionFileObservation,
): OutcomeVerification {
  try {
    const st = lstatSync(prepared.absolutePath);
    if (!st.isFile() || st.isSymbolicLink()) {
      return {
        executorReport: "accepted",
        status: "unknown",
        observation: "unknown",
        realityVerdict: "unknown",
        intendedVsActual: "unknown",
        observationDetail: `${prepared.runtime} accepted, but the immediate independent readback is not a regular file; completion timing is not guaranteed by the generic runtime contract.`,
      };
    }
    const actual = readFileSync(prepared.absolutePath, "utf8");
    if (sha256Utf8(actual) !== prepared.expectedPostSha256) {
      return {
        executorReport: "accepted",
        status: "unknown",
        observation: "unknown",
        realityVerdict: "unknown",
        intendedVsActual: "unknown",
        observationDetail: `${prepared.runtime} accepted, but immediate independent filesystem readback does not yet match the approved deterministic post-state; acceptance is not treated as completion proof.`,
      };
    }
    return {
      executorReport: "accepted",
      status: "verified",
      observation: "agree",
      realityVerdict: "agree",
      intendedVsActual: "match",
      observationDetail: `${prepared.runtime} accepted and independent filesystem readback matched the approved deterministic post-state.`,
    };
  } catch (err) {
    return {
      executorReport: "accepted",
      status: "unknown",
      observation: "unknown",
      realityVerdict: "unknown",
      intendedVsActual: "unknown",
      observationDetail: err instanceof Error ? err.message : String(err),
    };
  }
}

export function unverifiedAcceptedSession(
  runtime: "cursor" | "claude",
  reason: string,
): OutcomeVerification {
  return {
    executorReport: "accepted",
    status: "unverified",
    observation: "not_observed",
    observationDetail: `${runtime}: ${reason}`,
  };
}
