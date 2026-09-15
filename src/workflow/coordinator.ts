import type { ClaudeAgentPlugin, ClaudeGateDeps } from "../claude/delivery-gate.js";
import type { CursorEditorPlugin } from "../cursor/delivery-gate.js";
import type { RepositoryProvenanceFact } from "../constitution/index.js";
import type { RealityProbe } from "../governed-decision/stages/observation.js";
import type { OutcomeVerification } from "./outcome-verification.js";
import type { FsPlugin, WorkflowPlugins, WorkflowRun } from "./types.js";
import { executeFsEffect } from "./fs-effect-boundary.js";
import { executeCursorEffect } from "./cursor-effect-boundary.js";
import { executeClaudeEffect } from "./claude-effect-boundary.js";
import {
  observePreparedSessionEffect,
  prepareClaudeObservation,
  prepareCursorObservation,
  unverifiedAcceptedSession,
} from "./session-outcome-observation.js";
import { deliverWorkflowTask as deliverWorkflowTaskLegacy } from "./coordinator-legacy.js";

export * from "./coordinator-legacy.js";

export function withEffectDecisionFsBoundary(plugin: FsPlugin): FsPlugin {
  return {
    async executeFsOp(op) {
      const outcome = await executeFsEffect(plugin, op);
      const report = outcome.executorReport;
      if (outcome.kind === "non_semantic_failure") return report;
      if (outcome.decision.kind === "accepted") {
        return {
          kind: "accepted",
          ...(report.detail !== undefined ? { detail: report.detail } : {}),
          ...(report.stdout !== undefined ? { stdout: report.stdout } : {}),
          ...(report.stderr !== undefined ? { stderr: report.stderr } : {}),
          ...(report.exitCode !== undefined ? { exitCode: report.exitCode } : {}),
          ...(outcome.decision.resultingContentSha256 !== undefined
            ? { resultingContentSha256: outcome.decision.resultingContentSha256 }
            : {}),
        };
      }
      return {
        kind: "failed",
        ...(outcome.decision.detail !== undefined ? { detail: outcome.decision.detail } : {}),
        ...(report.stdout !== undefined ? { stdout: report.stdout } : {}),
        ...(report.stderr !== undefined ? { stderr: report.stderr } : {}),
        ...(report.exitCode !== undefined ? { exitCode: report.exitCode } : {}),
        errorCode: outcome.decision.code,
      };
    },
  };
}

export function withEffectDecisionCursorBoundary(
  plugin: CursorEditorPlugin,
  workspaceRoot?: string,
  onVerification?: (verification: OutcomeVerification) => void,
): CursorEditorPlugin {
  return {
    async receive(request) {
      // Capture the approved deterministic pre-state BEFORE the executor call.
      // This observer is independent of the adapter and shares no write helpers.
      const prepared = prepareCursorObservation(request, workspaceRoot);
      const outcome = await executeCursorEffect(plugin, request);
      if (outcome.kind === "non_semantic_failure") return outcome.safeResponse;
      if (outcome.kind === "decision" && outcome.decision.kind === "accepted") {
        onVerification?.(
          prepared !== null
            ? observePreparedSessionEffect(prepared)
            : unverifiedAcceptedSession(
                "cursor",
                "delivery accepted, but no unique contained deterministic file post-state was available for independent observation.",
              ),
        );
      }
      return outcome.cursorResponse;
    },
  };
}

/**
 * Claude advisories and scope questions remain their existing evidence/control
 * flows. Accepted and known deterministic refusals cross EffectDecision. Unknown
 * provider/model/tool failures remain non-semantic and are projected back to a
 * safe Claude execution-error response without inventing governed refusal codes.
 *
 * A Claude `accepted` response is delivery/session acceptance, not completion
 * authority. We still perform an independent readback when the approved request
 * exposes a unique deterministic local file transition. A matching post-state is
 * verified evidence; a non-match remains `unknown` because generic acceptance
 * does not promise synchronous completion.
 */
export function withEffectDecisionClaudeBoundary(
  plugin: ClaudeAgentPlugin,
  workspaceRoot?: string,
  onVerification?: (verification: OutcomeVerification) => void,
): ClaudeAgentPlugin {
  return {
    async receive(request) {
      const prepared = prepareClaudeObservation(request, workspaceRoot);
      const outcome = await executeClaudeEffect(plugin, request);
      if (outcome.kind === "non_semantic_failure") return outcome.safeResponse;
      if (outcome.kind === "decision" && outcome.decision.kind === "accepted") {
        onVerification?.(
          prepared !== null
            ? observePreparedSessionEffect(prepared)
            : unverifiedAcceptedSession(
                "claude",
                "managed-session delivery accepted, but no independently observable deterministic local file completion was available.",
              ),
        );
      }
      return outcome.claudeResponse;
    },
  };
}

function attachSessionVerification(
  delivered: WorkflowRun,
  deliveredIndex: number,
  verification: OutcomeVerification | undefined,
): WorkflowRun {
  if (verification === undefined) return delivered;
  const task = delivered.tasks[deliveredIndex];
  if (task === undefined || task.outcome !== "accepted") return delivered;
  return {
    ...delivered,
    tasks: delivered.tasks.map((candidate, index) =>
      index === deliveredIndex
        ? { ...candidate, outcomeVerification: verification }
        : candidate,
    ),
  };
}

export async function deliverWorkflowTask(
  run: WorkflowRun,
  plugins: WorkflowPlugins,
  storeDir: string,
  deps?: ClaudeGateDeps,
  constitution?: {
    repositoryProvenance?: RepositoryProvenanceFact | null;
    workspaceRoot?: string;
    realityProbe?: RealityProbe;
  },
): Promise<WorkflowRun> {
  const deliveredIndex = run.currentIndex;
  let sessionVerification: OutcomeVerification | undefined;
  const recordSessionVerification = (verification: OutcomeVerification): void => {
    sessionVerification = verification;
  };

  const governedPlugins: WorkflowPlugins = {
    ...plugins,
    ...(plugins.fs ? { fs: withEffectDecisionFsBoundary(plugins.fs) } : {}),
    ...(plugins.cursor
      ? {
          cursor: withEffectDecisionCursorBoundary(
            plugins.cursor,
            constitution?.workspaceRoot,
            recordSessionVerification,
          ),
        }
      : {}),
    ...(plugins.claude
      ? {
          claude: withEffectDecisionClaudeBoundary(
            plugins.claude,
            constitution?.workspaceRoot,
            recordSessionVerification,
          ),
        }
      : {}),
  };

  const delivered = await deliverWorkflowTaskLegacy(run, governedPlugins, storeDir, deps, constitution);
  return attachSessionVerification(delivered, deliveredIndex, sessionVerification);
}
