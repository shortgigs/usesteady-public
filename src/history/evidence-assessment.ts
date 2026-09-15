/** Bounded local evidence assessment. No execution authority or persistence writes. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { recomputeEnvelopeIdentity } from "../ucp/envelope.js";
import type { UCPEnvelope } from "../ucp/types.js";

export type EvidenceRequirement = {
  readonly id: string;
  readonly type?: string;
  readonly executionInstanceId?: string;
};
/** Must be retained separately BEFORE assessment; origin/trust is not authenticated here. */
export type ExpectedEvidenceReference = {
  readonly sha256: string;
  readonly byteLength: number;
  readonly lastEnvelopeId: string | null;
};
export type EvidenceAssessmentRequest = {
  readonly required: readonly EvidenceRequirement[];
  readonly expectedReference?: ExpectedEvidenceReference;
  readonly declaredStorage: "temporary" | "configured-local" | "supplied-local-unclassified";
};
export type EvidenceAssessment = {
  readonly scope: "declared-required-envelopes-and-exact-log-bytes";
  readonly correspondence: "CONSISTENT_WITH_SUPPLIED_REFERENCE" | "NOT_ESTABLISHED";
  readonly readability: "readable" | "unavailable";
  readonly requiredSet: "present-and-valid" | "not-established";
  readonly reference: "matched" | "mismatched" | "not-supplied" | "invalid";
  readonly records: readonly { readonly id: string; readonly status: "valid" | "missing" | "invalid" | "binding-mismatch" }[];
  readonly issues: readonly string[];
  readonly declaredStorage: "temporary" | "configured-local" | "supplied-local-unclassified";
  readonly independentCustody: "NOT_ESTABLISHED";
  readonly retentionDuration: "NOT_GUARANTEED";
  readonly restartSurvival: "NOT_ESTABLISHED_BY_THIS_READ";
};
const isHash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const obj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
function validEnvelope(v: unknown): v is UCPEnvelope<unknown> {
  if (!obj(v) || !isHash(v.id) || !isHash(v.hash) || typeof v.type !== "string" || !v.type.startsWith("ucp.") || v.version !== 1 || !Number.isFinite(v.ts) || !obj(v.meta) || typeof v.meta.source !== "string" || v.meta.deterministic !== true || !("payload" in v)) return false;
  if (v.refs !== undefined && (!obj(v.refs) || Object.values(v.refs).some(x => typeof x !== "string"))) return false;
  const identity = recomputeEnvelopeIdentity(v as unknown as UCPEnvelope<unknown>);
  return identity.id === v.id && identity.hash === v.hash;
}
/** Does not infer required evidence or manufacture an expected reference from observed bytes. */
export function assessEvidenceBytes(bytes: Uint8Array, request: EvidenceAssessmentRequest): EvidenceAssessment {
  const issues: string[] = [];
  const seen = new Map<string, unknown>();
  let lastEnvelopeId: string | null = null;
  const raw = Buffer.from(bytes);
  // Reject invalid UTF-8 rather than replacing bytes and then treating the projection as valid.
  let text = "";
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { issues.push("invalid-utf8"); }
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  for (const [index, line] of lines.entries()) {
    try {
      const value: unknown = JSON.parse(line);
      if (!validEnvelope(value)) issues.push(`invalid-envelope:${index + 1}`);
      if (obj(value) && typeof value.id === "string") {
        if (seen.has(value.id)) issues.push(`duplicate-envelope:${value.id}`);
        seen.set(value.id, value);
        lastEnvelopeId = value.id;
      }
    } catch { issues.push(`invalid-json:${index + 1}`); }
  }
  const required = request.required;
  if (!Array.isArray(required) || !required.length || required.some(r => !r || !isHash(r.id) || (r.type !== undefined && !r.type) || (r.executionInstanceId !== undefined && !r.executionInstanceId)) || new Set(required.map(r => r.id)).size !== required.length) issues.push("invalid-required-set");
  const records: EvidenceAssessment["records"] = (Array.isArray(required) ? required : []).map(r => {
    const value = seen.get(r?.id);
    let status: EvidenceAssessment["records"][number]["status"] = "valid";
    if (value === undefined) status = "missing";
    else if (!validEnvelope(value)) status = "invalid";
    else if ((r.type !== undefined && value.type !== r.type) || (r.executionInstanceId !== undefined && (!obj(value.payload) || value.payload.executionInstanceId !== r.executionInstanceId))) status = "binding-mismatch";
    return { id: r?.id, status };
  });
  const requiredSet = issues.length === 0 && records.every(r => r.status === "valid") ? "present-and-valid" : "not-established";
  const ref = request.expectedReference;
  let reference: EvidenceAssessment["reference"] = "not-supplied";
  if (ref !== undefined) {
    if (!ref || !isHash(ref.sha256) || !Number.isSafeInteger(ref.byteLength) || ref.byteLength < 0 || !(ref.lastEnvelopeId === null || isHash(ref.lastEnvelopeId))) reference = "invalid";
    else reference = ref.sha256 === createHash("sha256").update(raw).digest("hex") && ref.byteLength === raw.byteLength && ref.lastEnvelopeId === lastEnvelopeId ? "matched" : "mismatched";
  }
  return {
    scope: "declared-required-envelopes-and-exact-log-bytes",
    correspondence: requiredSet === "present-and-valid" && reference === "matched" ? "CONSISTENT_WITH_SUPPLIED_REFERENCE" : "NOT_ESTABLISHED",
    readability: "readable", requiredSet, reference, records, issues,
    declaredStorage: request.declaredStorage, independentCustody: "NOT_ESTABLISHED", retentionDuration: "NOT_GUARANTEED", restartSurvival: "NOT_ESTABLISHED_BY_THIS_READ",
  };
}
/** Raw read only: deliberately avoids persistence readers which may rebuild an index. */
export function assessLocalEvidence(storeDir: string, request: EvidenceAssessmentRequest, read: (path: string) => Uint8Array = path => readFileSync(path)): EvidenceAssessment {
  try { return assessEvidenceBytes(read(join(storeDir, "envelopes.log")), request); }
  catch {
    return { ...assessEvidenceBytes(new Uint8Array(), request), readability: "unavailable", requiredSet: "not-established", correspondence: "NOT_ESTABLISHED", issues: ["log-read-failed"] };
  }
}
