/**
 * Portal Authority Assertions V1/V2 — durable evidence writer (Core).
 *
 * Appends one JSON line per consumed Portal-mediated authority assertion to
 * `<storeDir>/portal-authority-evidence.jsonl`. The assertion is preserved
 * VERBATIM (never collapsed back into a plain approver string) so a later
 * verifier can independently establish: this exact assertion was signed by the
 * trusted Portal authority key and bound to this exact governed decision.
 *
 * Best-effort and never-throw: evidence persistence must never block, advance,
 * or approve anything (same posture as the bridge itself).
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  AUTHORITY_ASSERTION_V2_SCHEMA,
  RETIREMENT_AUTHORITY_ASSERTION_V3_SCHEMA,
} from "./types.js";

export const PORTAL_AUTHORITY_EVIDENCE_FILE = "portal-authority-evidence.jsonl";

export type PortalAuthorityEvidenceRecord = {
  readonly recorded_at: string;
  readonly path: "pending_approval" | "governed_handoff";
  readonly verification: "portal_signed_verified" | "self_asserted" | "verification_failed";
  readonly reason?: string;
  /** Denormalized from the assertion payload when parseable (diagnostic). */
  readonly decision_id?: string | null;
  readonly organization_id?: string | null;
  readonly run_id?: string | null;
  readonly thread_id?: string | null;
  readonly step_index?: number | null;
  readonly decision?: string | null;
  readonly decided_at?: string | null;
  readonly authority_subject_id?: string | null;
  readonly key_id?: string | null;
  /** Feature 3.1 v2-only diagnostic fields; never authority inputs. */
  readonly origin_id?: string;
  readonly decision_origin_hash?: string;
  /**
   * P3 Phase 2 (diagnostic denormalization): the signed supersession relation
   * and the exact position refs, when the assertion carried them. Both facts —
   * the model's position and the human's supersession — survive independently;
   * the full advisory evidence lives in the ucp.model_advisory.v1 envelope.
   */
  readonly decision_relation?: string | null;
  readonly model_position_ids?: readonly string[];
  readonly retirement_basis_relations?: readonly {
    readonly model_position_id: string;
    readonly position_hash: string;
    readonly evidence_basis_id: string;
    readonly evidence_basis_hash: string;
  }[];
  /** The full assertion envelope, preserved verbatim. */
  readonly assertion?: unknown;
};

export function portalAuthorityEvidencePath(storeDir: string): string {
  return join(storeDir, PORTAL_AUTHORITY_EVIDENCE_FILE);
}

export function appendPortalAuthorityEvidence(
  storeDir: string,
  record: PortalAuthorityEvidenceRecord,
): void {
  try {
    const {
      origin_id: _suppliedOriginId,
      decision_origin_hash: _suppliedOriginHash,
      ...baseRecord
    } = record;
    const assertion = record.assertion as
      | {
          readonly schema?: unknown;
          readonly payload?: {
            readonly decision_origin?: { readonly origin_id?: unknown };
            readonly decision_origin_hash?: unknown;
          };
        }
      | undefined;
    const originId = assertion?.payload?.decision_origin?.origin_id;
    const originHash = assertion?.payload?.decision_origin_hash;
    const v3Relations =
      assertion?.schema === RETIREMENT_AUTHORITY_ASSERTION_V3_SCHEMA
        ? (
            assertion as {
              readonly payload?: {
                readonly decision_origin?: {
                  readonly retirement_basis_relations?: readonly {
                    readonly model_position?: {
                      readonly model_position_id?: unknown;
                      readonly position_hash?: unknown;
                    };
                    readonly resolving_evidence?: {
                      readonly evidence_basis_id?: unknown;
                      readonly evidence_basis_hash?: unknown;
                    };
                  }[];
                };
              };
            }
          ).payload?.decision_origin?.retirement_basis_relations
        : undefined;
    const relationDiagnostics = v3Relations?.map((relation) => ({
      model_position_id: relation.model_position?.model_position_id as string,
      position_hash: relation.model_position?.position_hash as string,
      evidence_basis_id: relation.resolving_evidence?.evidence_basis_id as string,
      evidence_basis_hash: relation.resolving_evidence?.evidence_basis_hash as string,
    }));
    const persistedRecord =
      record.verification === "portal_signed_verified" &&
      (assertion?.schema === AUTHORITY_ASSERTION_V2_SCHEMA ||
        assertion?.schema === RETIREMENT_AUTHORITY_ASSERTION_V3_SCHEMA) &&
      typeof originId === "string" &&
      typeof originHash === "string"
        ? {
            ...baseRecord,
            origin_id: originId,
            decision_origin_hash: originHash,
            ...(relationDiagnostics !== undefined
              ? { retirement_basis_relations: relationDiagnostics }
              : {}),
          }
        : baseRecord;
    mkdirSync(storeDir, { recursive: true });
    appendFileSync(
      portalAuthorityEvidencePath(storeDir),
      `${JSON.stringify(persistedRecord)}\n`,
      "utf8",
    );
  } catch {
    /* evidence side-channel must never affect the approval path */
  }
}
