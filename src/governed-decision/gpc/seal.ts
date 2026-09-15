/**
 * sealCapsule — freeze an approved plan into a content-addressed Capsule.
 * Refuses without a non-empty approval_seal (bind ≠ approve).
 */

import {
  contentAddress,
  requireHumanApproval,
  sha256Utf8,
  type ApprovedPlanStub,
  type Capsule,
} from "./types.js";

export function sealCapsule(
  plan: ApprovedPlanStub,
  sealedAt: string = new Date().toISOString(),
): Capsule {
  requireHumanApproval(plan);

  const digests: Record<string, string> = {};
  const bodies: Record<string, string> = {};
  for (const [path, body] of Object.entries(plan.artifacts)) {
    const rel = path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!rel || rel.includes("..")) {
      throw new Error(`invalid artifact path: ${path}`);
    }
    bodies[rel] = body;
    digests[rel] = sha256Utf8(body);
  }

  const dirs = (plan.dirs ?? [])
    .map((d) => d.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
    .filter((d) => d.length > 0 && !d.includes(".."))
    .sort();

  const policy_seals = [...(plan.policy_seals ?? [])];
  const addressPayload = {
    plan_id: plan.plan_id,
    intent_summary: plan.intent_summary,
    artifact_digests: digests,
    dirs,
    policy_seals,
    approval_seal: plan.approval_seal,
  };
  const capsule_id = contentAddress(addressPayload);

  return {
    capsule_id,
    plan_id: plan.plan_id,
    intent_summary: plan.intent_summary,
    artifact_digests: digests,
    artifact_bodies: bodies,
    dirs,
    policy_seals,
    approval_seal: plan.approval_seal,
    sealed_at: sealedAt,
  };
}
