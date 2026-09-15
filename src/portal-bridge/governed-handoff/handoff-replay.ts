/**
 * W-E1 / INV-RRC-3 — Governed handoff kernel replay + durable UCP root.
 *
 * Brands 80 gap: scm-github (and FS) ratify reported execution-return without
 * `replayRef` and without ensuring the Portal-supplied UCP root existed in the
 * handoff storeDir. Portal then persisted `replay_ref=null` / `chain_count=0`.
 *
 * This module builds a real kernel.v1 artifact from FINAL execution results,
 * persists it under storeDir, and best-effort ensures the UCP root envelope is
 * present in that same store so `getChain` / `usesteady reconstruct` can find it.
 *
 * Does NOT invent UseSteady CERT levels (INV-RRC-2, INV-RRC-4).
 */

import { getEnvelopeById, getChain } from "../../ucp/persistence/query.js";
import { persistEnvelope } from "../../ucp/persistence/write.js";
import { ensureUcpIntentRoot } from "../../ucp/ensure-intent-root.js";
import { DEFAULT_STORE_DIR, resolveStoreDir } from "../../shell/defaults.js";
import { buildKernelArtifact } from "../../kernel/artifact.js";
import { persistKernelArtifact } from "../../kernel/persist.js";
import type { KernelArtifact, KernelResult } from "../../kernel/types.js";
import type { WorkflowSpec, WorkflowTaskSpec } from "../../workflow/types.js";
import type { ExecutableOperation } from "../../governed-decision/types.js";
import type { ExecutionReturnReplayRef } from "../execution-return/types.js";

export type HandoffExecutionOutcome = "success" | "failure" | "partial";

export type HandoffReplayBuildResult = {
  readonly artifact: KernelArtifact | null;
  readonly replayRef: ExecutionReturnReplayRef | null;
  /** Present when success required a replayRef but artifact build failed. */
  readonly replayOmitReason: string | null;
  readonly chainCount: number;
  readonly rootPresent: boolean;
};

type ExecutionResultRow = {
  readonly status?: unknown;
  readonly op?: ExecutableOperation | null;
};

function readOp(raw: unknown): ExecutableOperation | null {
  if (!raw || typeof raw !== "object") return null;
  const op = (raw as ExecutionResultRow).op;
  if (!op || typeof op !== "object" || typeof (op as { kind?: unknown }).kind !== "string") {
    return null;
  }
  return op;
}

/**
 * Map a governed ExecutableOperation into a WorkflowTaskSpec for kernel.v1 IR.
 * Pin hashes are intentionally omitted from IR (checksum covers path/content
 * fields the human approved for actuation, not draft-time sensor digests).
 */
export function workflowTaskFromExecutableOp(
  op: ExecutableOperation,
  index: number,
): WorkflowTaskSpec {
  const label = `Step ${index + 1}`;
  switch (op.kind) {
    case "create_dir":
      return {
        input: `create folder ${op.path}`,
        label,
        operationType: "create_dir",
        targetFiles: [op.path],
      };
    case "create_file":
      return {
        input: `create file ${op.path}`,
        label,
        operationType: "write_file",
        targetFiles: [op.path],
        content: op.content,
      };
    case "replace_in_file":
      return {
        input: `replace in ${op.path}`,
        label,
        structuredReplace: {
          oldValue: op.find,
          newValue: op.replaceWith,
          filePath: op.path,
        },
      };
    case "delete_file":
      return {
        input: `delete ${op.path}`,
        label,
        operationType: "delete_file",
        targetFiles: [op.path],
      };
    case "rename_file":
      return {
        input: `rename ${op.path} to ${op.toPath}`,
        label,
        operationType: "rename",
        targetFiles: [op.path],
        newPath: op.toPath,
      };
    case "human_attest":
      return { input: op.statement, label };
    case "document_record":
      return { input: op.statement, label };
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
}

export function workflowSpecFromExecutionResults(
  workflowName: string,
  results: readonly unknown[],
): WorkflowSpec {
  const tasks: WorkflowTaskSpec[] = [];
  for (let i = 0; i < results.length; i += 1) {
    const op = readOp(results[i]);
    if (op === null) {
      tasks.push({
        input: `handoff step ${i + 1}`,
        label: `Step ${i + 1}`,
      });
      continue;
    }
    tasks.push(workflowTaskFromExecutableOp(op, i));
  }
  if (tasks.length === 0) {
    tasks.push({
      input: workflowName.trim().length > 0 ? workflowName.trim() : "governed handoff",
      label: "Step 1",
    });
  }
  return {
    name:
      workflowName.trim().length > 0
        ? workflowName.trim().slice(0, 200)
        : "governed-handoff",
    tasks,
  };
}

export function kernelResultFromExecutionResults(
  results: readonly unknown[],
  outcome: HandoffExecutionOutcome,
): KernelResult {
  const total = Math.max(results.length, 1);
  let executed = 0;
  let failedAt: number | null = null;
  for (let i = 0; i < results.length; i += 1) {
    const row = results[i] as ExecutionResultRow | undefined;
    if (row?.status === "ran") {
      executed += 1;
    } else if (failedAt === null && results.length > 0) {
      failedAt = i + 1;
    }
  }
  const success = outcome === "success";
  return {
    success,
    error: success ? null : "execution_error",
    executed_steps: results.length === 0 && success ? 1 : executed,
    failed_at_step: success ? null : failedAt,
    total_steps: results.length === 0 && success ? 1 : total,
  };
}

/**
 * Build a kernel.v1 artifact from FINAL governed execution results.
 * Pure. Returns null when the IR/result pair cannot be assembled.
 */
export function buildKernelArtifactFromGovernedExecution(input: {
  readonly workflowName: string;
  readonly results: readonly unknown[];
  readonly outcome: HandoffExecutionOutcome;
}): KernelArtifact | null {
  try {
    const ir = workflowSpecFromExecutionResults(input.workflowName, input.results);
    const result = kernelResultFromExecutionResults(input.results, input.outcome);
    return buildKernelArtifact(ir, result);
  } catch {
    return null;
  }
}

/**
 * Ensure the Portal/workflow UCP root envelope exists in `storeDir`.
 *
 * Understand persists under USESTEADY_STORE_DIR / DEFAULT_STORE_DIR; handoff
 * getChain uses the governed storeDir — copy the root (+ chain) when present
 * elsewhere. Never invents a content-addressed id for a foreign root.
 */
export function ensureHandoffUcpRootDurable(input: {
  readonly storeDir: string;
  readonly ucpRootId: string;
  readonly goalFallback?: string | null;
}): { readonly chainCount: number; readonly rootPresent: boolean } {
  const { storeDir, ucpRootId } = input;
  if (getEnvelopeById(storeDir, ucpRootId) !== null) {
    return { chainCount: getChain(storeDir, ucpRootId).length, rootPresent: true };
  }

  const candidates = new Set<string>();
  try {
    candidates.add(resolveStoreDir());
  } catch {
    /* ignore */
  }
  candidates.add(DEFAULT_STORE_DIR);
  candidates.delete(storeDir);

  for (const src of candidates) {
    try {
      const root = getEnvelopeById(src, ucpRootId);
      if (root === null) continue;
      persistEnvelope(storeDir, root);
      for (const env of getChain(src, ucpRootId)) {
        if (env.id === ucpRootId) continue;
        if (getEnvelopeById(storeDir, env.id) === null) {
          persistEnvelope(storeDir, env);
        }
      }
      if (getEnvelopeById(storeDir, ucpRootId) !== null) {
        return {
          chainCount: getChain(storeDir, ucpRootId).length,
          rootPresent: true,
        };
      }
    } catch {
      /* try next candidate store */
    }
  }

  const goal =
    typeof input.goalFallback === "string" ? input.goalFallback.trim() : "";
  if (goal.length > 0) {
    try {
      const ensured = ensureUcpIntentRoot(storeDir, goal);
      // Only accept when the content-addressed id matches the Portal root —
      // otherwise we would report a foreign chain under the wrong join key.
      if (ensured.ucpRootId === ucpRootId) {
        return {
          chainCount: getChain(storeDir, ucpRootId).length,
          rootPresent: true,
        };
      }
    } catch {
      /* fail-closed: leave root missing */
    }
  }

  return {
    chainCount: getChain(storeDir, ucpRootId).length,
    rootPresent: false,
  };
}

/**
 * Build + persist kernel artifact; ensure durable UCP root; produce P0-55 replayRef.
 *
 * Portal-facing reconstructable stays success-only (same as CLI P0-55).
 * Artifact is persisted for every terminal outcome when build succeeds (B2).
 * Side-channel safe: never throws.
 */
export function buildAndPersistHandoffReplay(input: {
  readonly storeDir: string;
  readonly ucpRootId: string;
  readonly workflowName: string;
  readonly results: readonly unknown[];
  readonly outcome: HandoffExecutionOutcome;
  readonly goalFallback?: string | null;
}): HandoffReplayBuildResult {
  let artifact: KernelArtifact | null = null;
  let replayOmitReason: string | null = null;

  try {
    artifact = buildKernelArtifactFromGovernedExecution({
      workflowName: input.workflowName,
      results: input.results,
      outcome: input.outcome,
    });
  } catch {
    artifact = null;
  }

  if (artifact !== null) {
    try {
      persistKernelArtifact(artifact, input.storeDir);
    } catch {
      // Persistence failure: do not claim reconstructable without on-disk artifact.
      if (input.outcome === "success") {
        replayOmitReason = "kernel_artifact_persist_failed";
        artifact = null;
      }
    }
  } else if (input.outcome === "success") {
    replayOmitReason = "kernel_artifact_build_failed";
  }

  let chainCount = 0;
  let rootPresent = false;
  try {
    const ensured = ensureHandoffUcpRootDurable({
      storeDir: input.storeDir,
      ucpRootId: input.ucpRootId,
      goalFallback: input.goalFallback ?? null,
    });
    chainCount = ensured.chainCount;
    rootPresent = ensured.rootPresent;
  } catch {
    try {
      chainCount = getChain(input.storeDir, input.ucpRootId).length;
      rootPresent = getEnvelopeById(input.storeDir, input.ucpRootId) !== null;
    } catch {
      chainCount = 0;
      rootPresent = false;
    }
  }

  // P0-55: reconstructable iff success AND we have a persisted checksum.
  // On success always emit a replayRef (fail-closed false when artifact missing)
  // so Portal never sees silent omission (INV-RRC-3).
  const successWithArtifact =
    input.outcome === "success" &&
    artifact !== null &&
    typeof artifact.checksum === "string" &&
    artifact.checksum.trim().length > 0;

  let replayRef: ExecutionReturnReplayRef | null = null;
  if (input.outcome === "success") {
    replayRef = successWithArtifact
      ? { reconstructable: true, checksum: artifact!.checksum }
      : { reconstructable: false, checksum: null };
  } else if (artifact !== null) {
    replayRef = { reconstructable: false, checksum: null };
  }

  return {
    artifact,
    replayRef,
    replayOmitReason:
      input.outcome === "success" && !successWithArtifact
        ? replayOmitReason ?? "kernel_artifact_unavailable"
        : null,
    chainCount,
    rootPresent,
  };
}
