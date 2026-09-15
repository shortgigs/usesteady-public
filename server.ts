/**
 * UseSteady API Server — Phase 11A-Web
 *
 * Thin Express bridge between the frozen core APIs and the React UI.
 *
 * ── Architecture rule ────────────────────────────────────────────────────────
 *
 *   This file is the only place in the web stack that touches Node.js-specific
 *   APIs (fs, path) and the frozen coordinator/shell/history modules.
 *   The React UI calls this server over HTTP; it never imports coordinator logic.
 *
 *   Authority model: unchanged. The server only calls functions that already
 *   exist. It adds no decisions, no interpretations, no re-derivations.
 *
 * ── API contract ──────────────────────────────────────────────────────────────
 *
 *   POST /api/workflow/start              { spec, workspaceRoot? } → RunResponse
 *   GET  /api/workflow/:runId            → RunResponse
 *   GET  /api/workflow/:runId/events     → SSE stream of RunResponse events (PI-4 Iter 3)
 *   POST /api/workflow/:runId/advance    → RunResponse  (transient "running" only)
 *   POST /api/workflow/:runId/confirm    { yes: boolean } → RunResponse
 *   POST /api/workflow/:runId/confirm-understanding { confirmedUnderstanding } → RunResponse
 *   POST /api/workflow/:runId/choose     { idx: number }  → RunResponse
 *
 *   GET  /api/history                → WorkflowHistorySummary[]
 *   GET  /api/history/:runId         → WorkflowAuditRecord | 404
 *
 *   POST /api/executor/apply-fix-preview  → ApplyFixViewModel | fail-closed error
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   npx tsx server.ts
 *   # or: npm run serve
 *
 *   Runs on http://localhost:3001 by default (UI proxies /api/ to it).
 */

import express, { Request, Response, NextFunction } from "express";
import cors                            from "cors";
import { rateLimit }                   from "express-rate-limit";
import { mkdirSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath }               from "node:url";
import { execSync }                    from "node:child_process";
import * as crypto                     from "node:crypto";

import { captureWorkflowFailure, captureServerError, captureManualReport } from "./src/friction/auto-capture.js";
import { flushQueue, scheduleFlush }  from "./src/friction/client.js";
import { readConfig }  from "./src/friction/config.js";
import {
  registerGovernedRoutes,
  makeSandboxedFsExecutor,
  makeFsRealityProbe,
  createGovernedDecisionStore,
  type GovernedApiDeps,
}     from "./src/governed-decision/index.js";
import { DEFAULT_CURSOR_POLICY } from "./src/shell/defaults.js";
import {
  makeGitHubProvider,
  makeGitLabProvider,
  makeScmExecutor,
  makeScmRealityProbe,
  makeGitLabRealityProbe,
}     from "./src/source-control/index.js";
import {
  reportDecisionToPortal,
  resolveDecisionReporting,
  resolveDecisionRecordUcpRootId,
  resolveStoredRecordUcpRootId,
}     from "./src/portal-bridge/decision-record/index.js";
import {
  reportCandidatePlanToPortal,
  resolveCandidatePlanReporting,
}     from "./src/portal-bridge/candidate-plan/index.js";
import {
  reportRouterDeliveryToPortal,
  resolveRouterDeliveryReporting,
}     from "./src/portal-bridge/router-delivery/index.js";
import {
  handlePortalGovernedHandoffDraft,
  handlePortalGovernedHandoffRatify,
  setPortalGovernedHandoffDeps,
}     from "./src/portal-bridge/governed-handoff/handlers.js";
import {
  handlePortalWorkspaceReady,
}     from "./src/portal-bridge/governed-handoff/workspace-ready.js";
import {
  handlePortalWorkspaceProvision,
}     from "./src/portal-bridge/governed-handoff/workspace-provision.js";
import {
  handlePortalWorkspaceScmProvision,
}     from "./src/portal-bridge/governed-handoff/workspace-scm-provision.js";
import {
  handlePortalGpcStatus,
}     from "./src/portal-bridge/governed-handoff/gpc-status.js";
import {
  syntheticRatifierEnabled,
}     from "./src/governed-decision/index.js";
import {
  loadWorkspaceRegistryFromEnv,
  workspaceRegistryDurabilitySnapshot,
} from "./src/governed-decision/workspace-registry.js";
import {
  handlePortalWorkspaceRegistryHealth,
}     from "./src/portal-bridge/governed-handoff/workspace-registry-health.js";
import type {
  DeterministicExecutor,
}     from "./src/governed-decision/index.js";
import type { RealityProbe } from "./src/governed-decision/stages/observation.js";
import type { GovernedDecisionRecord } from "./src/governed-decision/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Load .env (gitignored, local dev only) so USESTEADY_ADMIN and similar flags
// work without requiring a shell-level export. Does not overwrite existing vars.
try {
  const envLines = readFileSync(join(__dirname, ".env"), "utf-8").split("\n");
  for (const line of envLines) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+)\s*$/);
    if (m?.[1] && !process.env[m[1]]) process.env[m[1]] = m[2]!.trim();
  }
} catch { /* .env absent — fine, no admin features */ }

// ─── Consensus audit log (multi-LLM mode only) ───────────────────────────────
//
// When USESTEADY_LLM_MODE is "multi" or "multi-strict", MultiLlmPlugin writes
// structured [consensus-audit] lines to process.stderr for every receive() call.
//
// This tee intercepts those lines and appends them — without the prefix — to
//   {DEFAULT_STORE_DIR}/consensus-audit.jsonl
// one JSON object per line, so the file can be read with:
//   tail -f ~/.../usesteady-ucp/consensus-audit.jsonl | jq .
//   or: jq '.quorumState' consensus-audit.jsonl
//
// Active only in multi/multi-strict mode. In claude mode this is a no-op.
// Failures are silent — never affects server behaviour.

const CONSENSUS_AUDIT_PREFIX = "[consensus-audit] ";

function setupConsensusAuditLog(storeDir: string): void {
  const lllmMode = process.env["USESTEADY_LLM_MODE"] ?? "claude";
  if (lllmMode !== "multi" && lllmMode !== "multi-strict") return;

  let auditPath: string;
  try {
    mkdirSync(storeDir, { recursive: true });
    auditPath = join(storeDir, "consensus-audit.jsonl");
  } catch {
    return; // Store dir not writable — skip silently
  }

  const originalWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as NodeJS.WriteStream & { write: typeof process.stderr.write }).write =
    (chunk: unknown, ...args: unknown[]) => {
      const text = typeof chunk === "string" ? chunk : String(chunk);
      if (text.startsWith(CONSENSUS_AUDIT_PREFIX)) {
        try {
          const jsonLine = text.slice(CONSENSUS_AUDIT_PREFIX.length).trimEnd();
          appendFileSync(auditPath, jsonLine + "\n");
        } catch { /* best-effort */ }
      }
      return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    };
}

import {
  createWorkflowRun,
  isWorkflowTerminal,
  persistWorkflowRun,
} from "./src/workflow/index.js";

import { renderWorkflowFrame }   from "./src/shell/workflow-render.js";
import {
  advanceWorkflowOnConfirm,
  advanceWorkflowOnChoice,
  DEFAULT_STORE_DIR,
  drainRunning,
  workflowPoliciesForRoot,
} from "./src/shell/index.js";

import { CursorInProcessAdapter }        from "./src/cursor/adapters/inprocess-adapter.js";
import { makeFsBoundaryObserver, makeJsonlBoundarySink } from "./src/execution/fs-boundary-observer.js";
import { makeBoundaryJsonlSink, makeClaudeBoundaryObserver, makeCursorBoundaryObserver } from "./src/execution/boundary-observer.js";
import { ClaudeStubAdapter }             from "./src/claude/adapters/stub-adapter.js";
import { ClaudeApiAdapter }              from "./src/claude/adapters/api-adapter.js";
import { OpenAiCompatibleAgentAdapter }  from "./src/claude/adapters/openai-compatible-adapter.js";
import { MultiLlmPlugin }                from "./src/claude/adapters/multi-llm-adapter.js";
import type { ClaudeAgentPlugin }        from "./src/claude/delivery-gate.js";
import { getWorkflowHistories, getWorkflowAuditRecord } from "./src/history/index.js";
import { recordUnattributedPresenceFact } from "./src/observe/presence-attribution-failure-sink.js";
import { hashObject, stableStringify } from "./src/ucp/hashes.js";
import { getChain } from "./src/ucp/persistence/index.js";
import { computeChainVerification } from "./src/ucp/chain-verification.js";
import type { UCPEnvelope } from "./src/ucp/types.js";
import { getProviderStatuses }                         from "./src/utils/credentials.js";

import {
  saveLiveRun,
  deleteLiveRun,
  loadLiveRuns,
  type LiveRunEntry,
} from "./server-store.js";

import {
  createSession,
  insertSteps,
  updateStepDecision,
  getSessionSteps,
  getSessionStats,
  getSessionTimeline,
  undoLastApproval,
  getStepSessionId,
  REVERT_LATENCY,
} from "./src/execution/session-db.js";

import {
  registerExecutorApplyFixRoute,
  registerExecutorMutationWiringRoutes,
  registerExecutorWorkerChainIntegrationRoutes,
  registerExecutorObservabilityRoutes,
  registerExecutorRecentExecutionsRoute,
  registerExecutorDecisionHistoryRoute,
  registerExecutorWorkflowHealthRoute,
  registerExecutorReplayInspectionRoute,
  registerExecutorTimelineTrustSurfaceRoute,
  registerExecutorCorrelatedTrustRoute,
  registerExecutorExecutionDiagnosticsRoute,
  registerExecutorExecutionGovernanceRoute,
  registerExecutorReplaySandboxRoute,
  registerExecutorReplayExecutionRoute,
  registerExecutorReplayExecutionHistoryRoute,
  registerExecutorReplayWorkerRoute,
  registerExecutorReplayWorkerExecutionRoute,
  registerExecutorReplayWorkerSideEffectRoute,
  registerExecutorReplayWorkerMutationRoute,
  registerExecutorReplayWorkerIoAuditRoute,
  registerExecutorReplayWorkerIoMetadataRoute,
  registerExecutorReplayWorkerIoTraceRoute,
} from "./src/executor/server/index.js";

import type { ExecutionStep } from "./src/types/execution.js";
import { specToExecutionSteps } from "./src/execution/spec-to-execution-steps.js";
import { fsOpEffectDisclosure } from "./src/workflow/effect-closure.js";

import { scanSkillsDirectory, buildRegistry } from "./src/skills/loader.js";
import { shouldConsultSkills }                from "./src/skills/registry.js";
import { invokeSkillsForTrigger }            from "./src/skills/invocation.js";
import { concreteSuggestions }               from "./src/skills/concrete-suggestions.js";
import { LocalRecoveryAdapter }              from "./src/skills/local-recovery-adapter.js";
import { LocalWorkflowDraftAdapter }         from "./src/skills/local-workflow-draft-adapter.js";
import { understandWorkflowIntent }          from "./src/portal-bridge/understand-workflow-intent.js";
import { presentFactsForWorkPlanTask }        from "./src/portal-bridge/workplan-present-facts.js";
import { workPlanPresentation }               from "./src/portal-bridge/workplan-certainty.js";
import type { LoadedSkillRegistry }          from "./src/skills/types.js";
import type { RecoverySuggestionsOutput }    from "./src/skills/types.js";

import type { WorkflowSpec, WorkflowRun } from "./src/workflow/types.js";
import { synthesizeStructuredFieldsFromNL } from "./src/shell/cli/spec-nl-synth.js";
import { normalizeNLToIR } from "./src/input/nl-to-ir.js";
import { gateWorkflowSpecSafety } from "./src/workflow/spec-safety-gate.js";
import {
  safetySurfaceFromVerdict,
  clarifySlotSurface,
} from "./src/workflow/routing-surface-derive.js";
import { computeArtifactsForSpec } from "./src/workflow/cross-surface-parity.js";
import {
  classifyClarifyRecoverability,
  reconstructClarifiedInput,
} from "./src/input/clarify-recoverability.js";
import { parseConfirmedUnderstandingV1 } from "./src/portal-bridge/confirmed-understanding-handoff.js";
import { resolveWebConfirmYes } from "./src/portal-bridge/pending-approval/index.js";
import { accumulateBridgeApprovalFromRemote } from "./src/portal-bridge/approval-provenance/index.js";
import { appendPortalAuthorityEvidence } from "./src/portal-bridge/authority-assertion/index.js";
import { buildPlanningReviewSpecFromConfirmed } from "./src/workflow/planning-review-spec.js";
import {
  generateWorkPlanFromConfirmed,
  GoalIsolationDeclinedError,
} from "./src/workflow/work-plan-generator.js";
import type { WorkPlan } from "./src/workflow/work-plan-types.js";
import type { PortalUnderstandStep } from "./src/portal-bridge/types.js";
import { shouldRouteToWorkPlanEngine } from "./src/workflow/business-intent-routing.js";
import { generateClarify, isClarifyClass } from "./src/workflow/clarify-surface.js";

// ─── Terminal persistence (Phase 9F) ─────────────────────────────────────────
//
// Mirror of the CLI's fire-and-forget persistWorkflowRun call (cli/main.ts:485).
// Called after every advance that may have produced a terminal run.
// Failure must not block the HTTP response — persistence is an audit artifact.

function liveRunKey(run: WorkflowRun): string {
  return run.executionInstanceId ?? run.workflowRunId;
}

function maybePersistTerminal(run: WorkflowRun, workspaceRoot = ""): void {
  if (!isWorkflowTerminal(run)) return;
  try {
    persistWorkflowRun(run, DEFAULT_STORE_DIR);
    process.stdout.write(`[persist] ✓ ${liveRunKey(run)} (${run.phase})\n`);
  } catch (err) {
    process.stderr.write(`[persist] ✗ ${liveRunKey(run)}: ${String(err)}\n`);
  }
  // Remove the live-run file now that the run is in UCP history.
  deleteLiveRun(DEFAULT_STORE_DIR, liveRunKey(run));

  // Capture friction for failure / incomplete outcomes (fire-and-forget).
  captureWorkflowFailure(run, workspaceRoot);
}

// ─── Skill registry + recovery adapter (PI-4 Iter 2) ─────────────────────────
//
// Registry is loaded once at startup from the skills/ directory.
// Routes consult it after a run reaches completed+skipped_by_intake.
// No LLM — LocalRecoveryAdapter is deterministic and zero-authority.
// If the skills/ directory is missing or empty, skillRegistry has no skills
// and shouldConsultSkills() returns false — behaviorally identical to PI-3.

let skillRegistry: LoadedSkillRegistry = buildRegistry([]);

const SKILLS_DIR = join(process.cwd(), "skills");
void scanSkillsDirectory(SKILLS_DIR)
  .then(({ registry, rejections }) => {
    skillRegistry = registry;
    process.stdout.write(`[skills] ${registry.all.length} skill(s) loaded\n`);
    if (rejections.length > 0) {
      process.stderr.write(`[skills] ${rejections.length} rejection(s) during load\n`);
    }
  })
  .catch((err: unknown) => {
    process.stderr.write(`[skills] load failed, running without skills: ${String(err)}\n`);
  });

const recoveryAdapter = new LocalRecoveryAdapter();
const workflowDraftAdapter = new LocalWorkflowDraftAdapter();

type TaskSuggestion = { readonly input: string; readonly reason: string };
type TaskSkillResult = { readonly taskIndex: number; readonly suggestions: readonly TaskSuggestion[] };

/**
 * Consult the recovery-basic skill for any skipped_by_intake tasks in a
 * completed run. Returns a non-empty array only when suggestions exist.
 *
 * Called after every confirm/choose that produces a terminal completed run.
 * Never throws — errors are logged and an empty result is returned.
 */
async function consultRecoverySkills(run: WorkflowRun): Promise<readonly TaskSkillResult[]> {
  if (run.phase !== "completed") return [];

  const skippedEntries = run.tasks
    .map((task, idx) => ({ task, idx }))
    .filter(({ task }) => task.outcome === "skipped_by_intake");

  if (skippedEntries.length === 0) return [];

  const trigger = { kind: "recovery" as const, failureReason: "unsupported" as const, rawInput: "" };
  if (!shouldConsultSkills(skillRegistry, { ...trigger, rawInput: "probe" })) return [];

  try {
    const results = await Promise.all(
      skippedEntries.map(async ({ task, idx }) => {
        const rawInput = task.spec.input;
        const result = await invokeSkillsForTrigger({
          registry:      skillRegistry,
          triggerReason: { kind: "recovery", failureReason: "unsupported", rawInput },
          rawInput,
          adapter:       recoveryAdapter,
        });
        const suggestions: TaskSuggestion[] = result.accepted.flatMap((output) => {
          if (output.schema === "usesteady.recovery_suggestions.v1") {
            return (output as RecoverySuggestionsOutput).suggestions.map((s) => ({
              input:  s.input,
              reason: s.reason,
            }));
          }
          return [];
        });
        return { taskIndex: idx, suggestions };
      }),
    );
    return results.filter((r) => r.suggestions.length > 0);
  } catch (err) {
    process.stderr.write(`[skills] consultRecoverySkills error: ${String(err)}\n`);
    return [];
  }
}

/**
 * Three-outcome routing probe (USESTEADY_TIME_TO_FIRST_VALUE_V1).
 *
 * Server-side binding of the shared `concreteSuggestions` (src/skills/
 * concrete-suggestions.ts) to this server's eager-scanned skills registry and
 * recovery adapter. The CLI binds the SAME function to its own per-process
 * registry, so both surfaces produce identical SYSTEM SUGGESTS for a given input.
 */
const serverConcreteSuggestions = (
  rawInput: string,
): Promise<readonly { input: string; reason: string }[]> =>
  concreteSuggestions(rawInput, { registry: skillRegistry, adapter: recoveryAdapter });

// ─── SSE client registry (PI-4 Iter 3) ───────────────────────────────────────
//
// Maps runId → Set of active SSE Response objects.
// Each SSE connection stays open until the client disconnects or the run is terminal.
// Events are pushed after every state-mutating action (confirm, choose, advance).
//
// Push ordering: SSE fires just before res.json() so the browser's event handler
// can start processing the new state while the POST response is still in-flight.
// Both carry identical data, so double-updates are idempotent and cause no flicker.

const sseClients = new Map<string, Set<Response>>();

/**
 * Push a JSON event to all active SSE clients for a given runId.
 * Ignores write errors — a failing write means the client already disconnected
 * and will be cleaned up by the "close" event handler on its Request object.
 */
function pushSSEEvent(runId: string, data: object): void {
  const clients = sseClients.get(runId);
  if (!clients || clients.size === 0) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.write(payload); } catch { /* client already disconnected */ }
  }
}

// ─── Run store (file-backed, PI-4 Iter 1) ────────────────────────────────────
//
// LiveRunEntry lives in server-store.ts (type + disk helpers).
// The store is populated from disk on startup so active runs survive server restart.

setupConsensusAuditLog(DEFAULT_STORE_DIR);
const store = loadLiveRuns(DEFAULT_STORE_DIR);

/**
 * Rebuild a LiveRunEntry after a run mutation, preserving optional fields
 * (execSessionId, bridgeApprovalProvenance) that live only on the server entry.
 */
function putLiveRun(
  run: WorkflowRun,
  fields: {
    plugins: LiveRunEntry["plugins"];
    workspaceRoot: string;
    execSessionId?: string;
    bridgeApprovalProvenance?: LiveRunEntry["bridgeApprovalProvenance"];
  },
): void {
  store.set(liveRunKey(run), {
    run,
    plugins: fields.plugins,
    workspaceRoot: fields.workspaceRoot,
    ...(fields.execSessionId ? { execSessionId: fields.execSessionId } : {}),
    ...(fields.bridgeApprovalProvenance?.lastBridgeApproval
      ? { bridgeApprovalProvenance: fields.bridgeApprovalProvenance }
      : {}),
  });
  saveLiveRun(DEFAULT_STORE_DIR, liveRunKey(run), run, fields.workspaceRoot);
}

// Execution step derivation: src/execution/spec-to-execution-steps.ts (SYSTEM WILL)

// ─── Response builder ─────────────────────────────────────────────────────────
//
// workspaceRoot is not a field on the frozen domain WorkflowRun — it lives in
// the server's RunEntry. We augment the JSON-serialized run object here so the
// UI's WorkflowRun DTO (which declares workspaceRoot) always receives it.

function runResponse(
  run:                WorkflowRun,
  workspaceRoot:      string,
  skillSuggestions?:  readonly TaskSkillResult[],
  executionSessionId?: string,
) {
  // CREATE_DIR_EFFECT_CONTRACT_V1 §3: the server derives the pre-approval
  // effect disclosure from the same hash-bound target via the single shared
  // ancestorClosure; React renders it verbatim and never re-derives.
  // Additive optional field — the frozen run contract is untouched.
  const fsOpEffects = run.currentFsOp !== undefined
    ? fsOpEffectDisclosure(run.currentFsOp)
    : undefined;
  return {
    runId:        liveRunKey(run),
    run:          { ...run, workspaceRoot, ...(fsOpEffects !== undefined ? { currentFsOpEffects: fsOpEffects } : {}) },
    frame:        renderWorkflowFrame(run),
    isTerminal:   isWorkflowTerminal(run),
    phase:        run.phase,
    // Omit keys entirely when absent — keeps response shape clean.
    ...(skillSuggestions && skillSuggestions.length > 0 ? { skillSuggestions } : {}),
    ...(executionSessionId ? { executionSessionId } : {}),
  };
}

/**
 * Build the /api/workflow/start response body for a blocking safety verdict, or
 * null when the verdict allows. Carries the SafetyBlock DTO plus the additive
 * RoutingSurface (Phase 3A). Used at BOTH safety gate sites in the start handler
 * (the original-spec early gate and the final-synthesized-spec gate) so the two
 * cannot drift — single-authority safety, single response shape.
 */
function safetyBlockResponse(
  safety: ReturnType<typeof gateWorkflowSpecSafety>,
): Record<string, unknown> | null {
  if (safety.verdict !== "block") return null;
  const surface = safetySurfaceFromVerdict(safety);
  return {
    safetyBlock: {
      reason:         safety.reason ?? "blocked",
      note:           safety.note ?? "This request was blocked by the safety gate.",
      blockedInput:   safety.blockedInput,
      ...(safety.matchedPattern !== undefined ? { matchedPattern: safety.matchedPattern } : {}),
      ...(safety.detectorId !== undefined ? { detectorId: safety.detectorId } : {}),
    },
    ...(surface ? { routingSurface: surface } : {}),
  };
}

// Transient `running` drain lives in drainRunning() (src/shell/workflow-defaults.ts).
// It uses per-run policies for the selected workspace. API-W1: drain running only;
// never skip approval or auto-confirm.

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();

// ─── Multi-LLM plugin factory ─────────────────────────────────────────────────
//
// Reads USESTEADY_LLM_MODE to decide which plugin strategy to use:
//
//   "claude" (default) — ClaudeApiAdapter only. No fanout.
//   "multi"            — MultiLlmPlugin: primary=claude, requireUnanimity=false.
//   "multi-strict"     — MultiLlmPlugin: primary=claude, requireUnanimity=true.
//
// Secondary plugin (multi/multi-strict) requires either OPENAI_API_KEY or
// XAI_API_KEY (+ optional XAI_BASE_URL). If neither key is present when
// multi mode is requested, server falls back to single-Claude with a warning.

function buildClaudePlugin(): ClaudeAgentPlugin {
  // Grok is the primary AI execution path (opt-in via USESTEADY_USE_GROK).
  // xAI is OpenAI-compatible, so it routes through OpenAiCompatibleAgentAdapter
  // pointed at https://api.x.ai/v1. The approval gate is unchanged — the plugin
  // only receives already-approved deliveries. When this flag is unset, the
  // server keeps its existing deterministic-by-default Claude/consensus wiring.
  if (process.env["USESTEADY_USE_GROK"] === "true") {
    return new OpenAiCompatibleAgentAdapter({
      apiKey:  process.env["XAI_API_KEY"]  ?? "",
      baseURL: process.env["XAI_BASE_URL"] ?? "https://api.x.ai/v1",
      model:   process.env["GROK_MODEL"]   ?? "grok-3",
      bypass:  ClaudeStubAdapter.accepted("web-api-stub"),
    });
  }

  const anthropicKey = process.env["ANTHROPIC_API_KEY"] ?? "";
  const lllmMode     = process.env["USESTEADY_LLM_MODE"] ?? "claude";

  const claudePlugin: ClaudeAgentPlugin = anthropicKey
    ? new ClaudeApiAdapter({ apiKey: anthropicKey, bypass: ClaudeStubAdapter.accepted("web-api-stub") })
    : ClaudeStubAdapter.accepted("web-api-stub");

  if (lllmMode !== "multi" && lllmMode !== "multi-strict") {
    return claudePlugin;
  }

  const openaiKey  = process.env["OPENAI_API_KEY"]  ?? "";
  const xaiKey     = process.env["XAI_API_KEY"]     ?? "";
  const xaiBaseUrl = process.env["XAI_BASE_URL"]    ?? "https://api.x.ai/v1";

  if (!openaiKey && !xaiKey) {
    process.stderr.write(
      `[server] USESTEADY_LLM_MODE="${lllmMode}" requested but neither ` +
      `OPENAI_API_KEY nor XAI_API_KEY is set. Falling back to single-Claude.\n`,
    );
    return claudePlugin;
  }

  const secondaryPlugin: ClaudeAgentPlugin = xaiKey
    ? new OpenAiCompatibleAgentAdapter({ apiKey: xaiKey,    baseURL: xaiBaseUrl })
    : new OpenAiCompatibleAgentAdapter({ apiKey: openaiKey! });

  return new MultiLlmPlugin(
    { name: "claude",             plugin: claudePlugin     },
    [{ name: "openai-compatible", plugin: secondaryPlugin  }],
    {
      primary:          "claude",
      policyMode:       lllmMode === "multi-strict" ? "multi-strict" : "multi",
      requireUnanimity: lllmMode === "multi-strict",
    },
  );
}

// Only allow requests from the same machine (UI + CLI).
const LOCALHOST_ORIGINS = /^https?:\/\/(localhost|127\.0\.0\.1|::1)(:\d+)?$/;
app.use(cors({ origin: LOCALHOST_ORIGINS }));

// Platform V1 — deploy probe (no auth; no store access)
app.get("/api/health", (_req: Request, res: Response): void => {
  res.json({
    ok:      true,
    service: "usesteady-core",
    routes:  ["POST /api/portal/reflect-intent", "POST /api/portal/propose-turn-reading", "POST /api/portal/draft-intent", "POST /api/portal/gap-clarify", "POST /api/portal/blocked-explain", "POST /api/portal/blocked-revise", "POST /api/portal/understand-workflow", "GET /api/portal/provenance/:ucpRootId (supports ?chain, ?narrative, ?vc, ?export, ?bbs)"],
  });
});

// Strict body limit for all routes; friction route enforces an even tighter one.
app.use(express.json({ limit: "64kb" }));

// ── Governed Decision surface (E3) — transport only ───────────────────────────
//
// Mounts the constitutional-kernel HTTP API (POST/GET /api/governed/decisions,
// POST .../:threadId/ratify) so the projection-only Portal UI (E4) can read
// governed records and capture the one authorized write (ratification).
//
// EXECUTION IS OPT-IN, DEFAULT OFF. With only GOVERNED_PORTAL=1 the mount is
// PURE TRANSPORT: no executor and no reality probe are wired, so execution stays
// honestly `unavailable` and `realityVerdict` stays `unknown` — the gauge law on
// a live server, not a gap. Server-side actuation is enabled ONLY when the
// operator additionally sets GOVERNED_EXECUTE=1 AND GOVERNED_WORKSPACE=<path>;
// see the "Execution actuation" section below.
//
// ── Safety posture (read before enabling) ─────────────────────────────────────
//
// These routes are UNAUTHENTICATED and POST .../ratify is the product's sole
// authority write. The server binds 0.0.0.0 and CORS only constrains browser
// origins (not direct HTTP), so an exposed mount lets any reachable caller
// persist approved/rejected finals into the shared ~/.usesteady store. Per the
// http.ts INTEGRATION REQUIREMENTS, a network-reachable multi-user mount needs
// auth + per-tenant storage first.
//
// DEFENCE IN DEPTH (two layers), because the kernel's authority write must not
// be casually exposed:
//
//   1. OPT-IN, DEFAULT OFF — the routes are mounted ONLY when GOVERNED_PORTAL=1
//      (a local, gitignored dev flag, mirroring USESTEADY_ADMIN). By default the
//      authority write does NOT exist on this server, so there is zero default
//      attack surface. The E4 Portal dev workflow sets the flag explicitly.
//   2. LOOPBACK-ONLY GUARD — when enabled, reject any non-loopback peer (403).
//
// RESIDUAL RISK (documented, not silently ignored): the loopback guard trusts
// the TCP peer address, so a local reverse proxy / tunnel pointed at port 3001
// (e.g. a Cloudflare quick-tunnel) would appear as loopback and bypass it. Do
// NOT run a tunnel to this port while GOVERNED_PORTAL=1 until a real token/auth
// slice lands. Opting into BOTH is an explicit operator misconfiguration.
// Always attempt registry load at boot (file on /data survives Render redeploy).
{
  try {
    const registry = loadWorkspaceRegistryFromEnv();
    const snap = workspaceRegistryDurabilitySnapshot();
    const registryKeys = Object.keys(registry);
    process.stdout.write(
      `[governed] workspace registry loaded (${registryKeys.length} key(s); ` +
        `file=${snap.configuredFile ? (snap.fileExists ? "present" : "pending") : "unset"}; ` +
        `scm_bound=${snap.installationBoundCount})\n`,
    );
  } catch (err) {
    process.stderr.write(
      `[governed] workspace registry load failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

if (process.env["GOVERNED_PORTAL"] === "1") {
  app.use("/api/governed", (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.socket.remoteAddress ?? "";
    const isLoopback =
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "::ffff:127.0.0.1" ||
      ip.startsWith("127.");
    if (!isLoopback) {
      res.status(403).json({ error: "governed decision API is restricted to localhost" });
      return;
    }
    next();
  });

  // ── Execution actuation (Tier 1.2) — opt-in, default OFF ────────────────────
  //
  // With GOVERNED_PORTAL alone the mount is read/ratify transport only. Real
  // actuation is enabled ONLY when the operator ALSO sets GOVERNED_EXECUTE=1 and
  // a non-empty GOVERNED_EXECUTE_TOKEN secret (each actuating POST .../ratify must
  // then carry a matching x-governed-execute-token header — see below), AND the
  // chosen backend is fully configured:
  //
  //   GOVERNED_EXECUTE_BACKEND=fs (default)
  //     + GOVERNED_WORKSPACE=<path>  → sandboxed filesystem writes
  //   GOVERNED_EXECUTE_BACKEND=scm-github
  //     + GOVERNED_SCM_TOKEN/OWNER/REPO (+ optional GOVERNED_SCM_BASE_BRANCH,
  //       https-only GOVERNED_SCM_API_BASE)  → opens a GitHub PR
  //   GOVERNED_EXECUTE_BACKEND=scm-gitlab
  //     + GOVERNED_SCM_TOKEN/PROJECT (+ optional GOVERNED_SCM_BASE_BRANCH,
  //       https-only GOVERNED_SCM_API_BASE)  → opens a GitLab MR
  //   (both scm backends: optional GOVERNED_WORKSPACE = local mirror/checkout
  //    that binds the evidence + replace-pin sensors; never actuated)
  //
  // When enabled, an APPROVED ratification actuates the non-destructive op subset
  // (create_dir / create_file) and observation INDEPENDENTLY re-verifies the
  // actuated ops against the real world (filesystem for fs; the PR/MR branch for
  // scm-github / scm-gitlab) — reality's final veto. Executor and probe are paired to the SAME
  // backend target. Both are server-bound: the request body can never supply or
  // redirect them, so execution is always an operator/server decision.
  //
  // Fail-closed remains upstream in the spine (execution runs only when
  // ratification is connected + approved); the executor adds sandbox containment
  // on top. The executor itself is OFF-BY-DEFAULT, NON-DESTRUCTIVE, and
  // IDEMPOTENT (see fs-executor.ts). Per its threat model, DO NOT set
  // GOVERNED_EXECUTE=1 on a network-reachable host or a workspace writable by an
  // untrusted local principal — the loopback guard above is the only network
  // boundary and trusts the TCP peer (tunnel caveat noted above).
  // OCD policy sensor (L3.S2): the governed basis records the SAME default OCD
  // policy this server's shell surfaces enforce. Server-bound, never from
  // request input.
  //
  // Ratifier seat (N.S6 mounting fix, INV-SO-3): the approver identity and the
  // synthetic-seat permission are SERVER-bound env config, never request input.
  // GOVERNED_APPROVER names the authenticated ratifier this mount seats
  // (default "portal", the single-user/local identity). A `persona:`-namespaced
  // approver is typed as a persona seat by the spine and is REJECTED (403,
  // fail-closed in http.ts) unless the operator also set
  // GOVERNED_SYNTHETIC_RATIFIER=1 (build lanes only). This block only forwards
  // env to deps - all seat typing and blocking stays in the spine.
  const governedApprover = (process.env["GOVERNED_APPROVER"] ?? "").trim() || "portal";
  // Durable store for governed handoff replay/UCP (INV-RRC-3 / P2): when
  // USESTEADY_STORE_DIR is set (Render disk `/data/...`), handoff persist +
  // `usesteady reconstruct` share the same path. Absent → prior default
  // (~/.usesteady/governed-decisions) — fine for local, ephemeral on hosts.
  const durableStoreDir = (process.env["USESTEADY_STORE_DIR"] ?? "").trim();
  let deps: GovernedApiDeps = {
    approver: governedApprover,
    basisPolicy: DEFAULT_CURSOR_POLICY,
    ...(durableStoreDir.length > 0 ? { storeDir: durableStoreDir } : {}),
    ...(syntheticRatifierEnabled() ? { allowSyntheticRatifier: true } : {}),
    // Process-local receiving-boundary sink. Server-bound; request input
    // cannot select or forge it. R6 inherits this sink when it replaces
    // the selected executor.
    boundarySink: makeBoundaryJsonlSink(
      join(
        durableStoreDir.length > 0 ? durableStoreDir : DEFAULT_STORE_DIR,
        "boundary-observations.jsonl",
      ),
    ),
  };
  let executionLog = "transport only (execution unavailable)";
  // D.S1: the server-bound executor backend name, captured ONLY when an
  // executor is actually wired - it names WHICH executor kind receives
  // approved work in the router-delivery record. null = no executor = no
  // delivery moment exists on this mount, so the delivery reporter stays unwired.
  let wiredExecutorKind: string | null = null;
  if (process.env["GOVERNED_EXECUTE"] === "1") {
    // SECURITY: real actuation requires a SECRET, not just loopback + opt-in.
    // The governed mount is unauthenticated and the loopback guard trusts the
    // TCP peer, so a tunnel/reverse-proxy or a cross-origin localhost page could
    // otherwise drive an approved ratify into a real actuation (filesystem write
    // or a source-control PR). Requiring GOVERNED_EXECUTE_TOKEN on each actuating
    // ratify defeats both vectors: an external/tunnelled caller and a cross-origin
    // browser page do not know the secret (it is never sent to the client).
    const executeToken = (process.env["GOVERNED_EXECUTE_TOKEN"] ?? "").trim();
    // Backend selects WHAT a ratified decision actuates. Default "fs" = sandboxed
    // filesystem writes; "scm-github" = open a PR on GitHub. Both are server-bound:
    // the request body can never supply or redirect them.
    const backend = (process.env["GOVERNED_EXECUTE_BACKEND"] ?? "fs").trim().toLowerCase();

    // Resolve the chosen backend into a paired executor + INDEPENDENT reality
    // probe (or leave null on misconfiguration -> execution stays unavailable).
    let wired: { executor: DeterministicExecutor; realityProbe: RealityProbe; log: string } | null = null;

    if (executeToken.length === 0) {
      process.stdout.write(
        "[governed] GOVERNED_EXECUTE=1 but GOVERNED_EXECUTE_TOKEN is empty - refusing to wire any executor; execution stays UNAVAILABLE\n",
      );
    } else if (backend === "scm-github") {
      // Source-control actuation: a ratified decision opens a PR. token/owner/repo
      // are server-only (never request-derived). The reality probe independently
      // re-reads the PR branch to verify the committed files (reality's veto).
      const token = (process.env["GOVERNED_SCM_TOKEN"] ?? "").trim();
      const owner = (process.env["GOVERNED_SCM_OWNER"] ?? "").trim();
      const repo = (process.env["GOVERNED_SCM_REPO"] ?? "").trim();
      const baseBranch = (process.env["GOVERNED_SCM_BASE_BRANCH"] ?? "").trim();
      // apiBase is allowlisted: default api.github.com; an override is accepted
      // ONLY if it is an https URL (GHES). Rejecting non-https prevents the bearer
      // token from being sent to a plaintext/attacker host via misconfiguration.
      const apiBaseRaw = (process.env["GOVERNED_SCM_API_BASE"] ?? "").trim();
      let apiBase = "https://api.github.com";
      let apiBaseOk = true;
      if (apiBaseRaw.length > 0) {
        try {
          const u = new URL(apiBaseRaw);
          if (u.protocol !== "https:") apiBaseOk = false;
          else apiBase = apiBaseRaw;
        } catch {
          apiBaseOk = false;
        }
      }

      if (token.length === 0 || owner.length === 0 || repo.length === 0) {
        process.stdout.write(
          "[governed] GOVERNED_EXECUTE_BACKEND=scm-github but GOVERNED_SCM_TOKEN/OWNER/REPO are not all set - execution stays UNAVAILABLE\n",
        );
      } else if (!apiBaseOk) {
        process.stdout.write(
          "[governed] GOVERNED_SCM_API_BASE must be an https URL - refusing to wire the SCM executor; execution stays UNAVAILABLE\n",
        );
      } else {
        const provider = makeGitHubProvider({ token, owner, repo, apiBase });
        wired = {
          executor: makeScmExecutor({ provider, ...(baseBranch.length > 0 ? { baseBranch } : {}) }),
          // Probe shares ONLY the branchPrefix (default) so it derives the same
          // content-addressed branch; its GitHub read is independent of the actuator.
          realityProbe: makeScmRealityProbe({ token, owner, repo, apiBase }),
          log: `EXECUTION ENABLED, token-gated, backend=scm-github (repo: ${owner}/${repo}${baseBranch.length > 0 ? `, base: ${baseBranch}` : ""})`,
        };
      }
    } else if (backend === "scm-gitlab") {
      // GitLab merge-request actuation. token/project are server-only. apiBase
      // (self-managed GitLab) is allowlisted to https for the same token-exfil
      // reason as GitHub.
      const token = (process.env["GOVERNED_SCM_TOKEN"] ?? "").trim();
      const projectPath = (process.env["GOVERNED_SCM_PROJECT"] ?? "").trim();
      const baseBranch = (process.env["GOVERNED_SCM_BASE_BRANCH"] ?? "").trim();
      const apiBaseRaw = (process.env["GOVERNED_SCM_API_BASE"] ?? "").trim();
      let apiBase = "https://gitlab.com/api/v4";
      let apiBaseOk = true;
      if (apiBaseRaw.length > 0) {
        try {
          const u = new URL(apiBaseRaw);
          if (u.protocol !== "https:") apiBaseOk = false;
          else apiBase = apiBaseRaw;
        } catch {
          apiBaseOk = false;
        }
      }

      if (token.length === 0 || projectPath.length === 0) {
        process.stdout.write(
          "[governed] GOVERNED_EXECUTE_BACKEND=scm-gitlab but GOVERNED_SCM_TOKEN/PROJECT are not all set - execution stays UNAVAILABLE\n",
        );
      } else if (!apiBaseOk) {
        process.stdout.write(
          "[governed] GOVERNED_SCM_API_BASE must be an https URL - refusing to wire the SCM executor; execution stays UNAVAILABLE\n",
        );
      } else {
        const provider = makeGitLabProvider({ token, projectPath, apiBase });
        wired = {
          executor: makeScmExecutor({ provider, ...(baseBranch.length > 0 ? { baseBranch } : {}) }),
          realityProbe: makeGitLabRealityProbe({ token, projectPath, apiBase }),
          log: `EXECUTION ENABLED, token-gated, backend=scm-gitlab (project: ${projectPath}${baseBranch.length > 0 ? `, base: ${baseBranch}` : ""})`,
        };
      }
    } else if (backend === "fs") {
      const workspace = (process.env["GOVERNED_WORKSPACE"] ?? "").trim();
      if (workspace.length === 0) {
        process.stdout.write(
          "[governed] GOVERNED_EXECUTE=1 (backend=fs) but GOVERNED_WORKSPACE is empty - execution stays UNAVAILABLE\n",
        );
      } else {
        // Paired actuator + independent probe against the SAME root. The executor
        // fails closed (every op failed) if the root is missing at actuation time.
        wired = {
          executor: makeSandboxedFsExecutor(workspace),
          realityProbe: makeFsRealityProbe(workspace),
          log: existsSync(workspace)
            ? `EXECUTION ENABLED, token-gated, backend=fs (workspace: ${workspace})`
            : `EXECUTION ENABLED, token-gated, backend=fs but workspace MISSING - ops will fail closed (workspace: ${workspace})`,
        };
        // Evidence pre-state sensor (L3.S1): bind the Decision Basis to the SAME
        // root the executor actuates, so the evidence the human reviews describes
        // the reality the approved ops will touch. Server-bound, never from
        // request input.
        deps = { ...deps, basisWorkspace: workspace };
      }
    } else {
      process.stdout.write(
        `[governed] GOVERNED_EXECUTE_BACKEND='${backend}' is not recognized (use 'fs', 'scm-github', or 'scm-gitlab') - execution stays UNAVAILABLE\n`,
      );
    }

    // SCM backends (L4.S2): GOVERNED_WORKSPACE optionally names a LOCAL MIRROR
    // (checkout) of the target repo. It is not actuated — it only binds the
    // evidence pre-state sensor (L3.S1) and the replace pin sensor (L4.S1) to
    // real file content instead of the server process cwd, so a replace goal's
    // approval is anchored to the content the operator's checkout actually
    // holds. The GitHub provider still hash-gates against the REMOTE base
    // commit at actuation time: a mirror that is stale relative to the remote
    // fails closed there ("file content changed since approval"). Server-bound,
    // never request-derived.
    if (wired !== null && (backend === "scm-github" || backend === "scm-gitlab")) {
      const mirror = (process.env["GOVERNED_WORKSPACE"] ?? "").trim();
      if (mirror.length > 0) {
        deps = { ...deps, basisWorkspace: mirror };
        wired = { ...wired, log: `${wired.log} (local mirror for sensing: ${mirror})` };
      }
    }

    if (wired !== null) {
      // Constant-time bearer check on the ONE actuating write (POST .../ratify).
      // Reads/list/create never actuate, so they are not gated here. A length
      // mismatch is rejected before timingSafeEqual (which requires equal-length
      // buffers). The token is compared, never logged.
      const expectedTok = Buffer.from(executeToken, "utf8");
      const ratifyRe = /^\/api\/governed\/decisions\/[^/]+\/ratify\/?(?:$|\?)/;
      app.use("/api/governed", (req: Request, res: Response, next: NextFunction): void => {
        if (req.method === "POST" && ratifyRe.test(req.originalUrl)) {
          const provided = Buffer.from(String(req.header("x-governed-execute-token") ?? ""), "utf8");
          const ok =
            provided.length === expectedTok.length &&
            crypto.timingSafeEqual(provided, expectedTok);
          if (!ok) {
            res
              .status(403)
              .json({ error: "execution is enabled; ratify requires a valid x-governed-execute-token" });
            return;
          }
        }
        next();
      });

      deps = { ...deps, executor: wired.executor };
      deps = { ...deps, realityProbe: wired.realityProbe };
      executionLog = wired.log;
      wiredExecutorKind = backend;
    }
  }

  // ── Decision Record Bridge (Core -> Portal) — opt-in, default OFF ───────────
  //
  // When the operator opts in (USESTEADY_PORTAL_DECISION_RECORDS=1 + a base URL +
  // the shared USESTEADY_PORTAL_TOKEN), wire a best-effort `reporter` that emits
  // each ratified FINAL to the Portal's POST /api/v1/decision-records ingest so
  // Portal V2's O4/O5 surfaces project REAL governed decisions. The reporter is a
  // detached side-channel: it carries no authority, never blocks ratification, and
  // never throws (a failed emit is swallowed). The run_id is the record's own
  // content-addressed recordId so the Portal can link/idempotently dedupe. The
  // ucp_root_id is derived (A1) from the same intent text the Understand bridge
  // uses, so the record also JOINS its workflow page, not just the org proof
  // surface. Resolution is null-safe and never throws (see resolve-ucp-root.ts).
  // ucp_root_id prefers the portal-supplied envelope link (handoff path) over
  // goal-text derivation — see resolve-ucp-root.ts.
  const bridgeEmitStore = createGovernedDecisionStore(DEFAULT_STORE_DIR);
  const ucpRootForBridgeEmit = (record: GovernedDecisionRecord): string | null => {
    const stored = bridgeEmitStore.getRecord(record.recordId);
    if (stored !== null) {
      return resolveStoredRecordUcpRootId(stored, DEFAULT_STORE_DIR);
    }
    return resolveDecisionRecordUcpRootId(record, DEFAULT_STORE_DIR);
  };

  const decisionReporting = resolveDecisionReporting({});
  let reportingLog = `decision-record emit OFF (${decisionReporting.enabled ? "" : decisionReporting.reason})`;
  if (decisionReporting.enabled) {
    deps = { ...deps, reporter: (record) => {
      const ucpRootId = ucpRootForBridgeEmit(record);
      void reportDecisionToPortal(record, {
        links: { runId: record.recordId, ...(ucpRootId !== null ? { ucpRootId } : {}) },
      });
    } };
    reportingLog = "decision-record emit ON (opt-in, best-effort)";
  }

  // ── Candidate Plan Bridge (Core -> Portal) — opt-in, default OFF (P.S1) ─────
  //
  // When the operator opts in (USESTEADY_PORTAL_CANDIDATE_PLANS=1 + a base URL +
  // the shared USESTEADY_PORTAL_TOKEN), wire a best-effort `draftReporter` that
  // emits each persisted DRAFT's candidate plan to the Portal's
  // POST /api/v1/candidate-plans ingest — at draft time, structurally BEFORE any
  // ratification decision exists (INV-PS1-1) — so the lifecycle rail's
  // `candidate_plan` stage renders the plan the human saw at approval. The
  // stored plan is a zero-authority AI record (INV-WL-4): the emitter is a
  // detached side-channel that never blocks a draft and never throws
  // (INV-PS1-2). The ucp_root_id is derived from the same intent text the other
  // bridges use, so the plan JOINS its workflow page.
  const candidatePlanReporting = resolveCandidatePlanReporting({});
  let planReportingLog = `candidate-plan emit OFF (${candidatePlanReporting.enabled ? "" : candidatePlanReporting.reason})`;
  if (candidatePlanReporting.enabled) {
    deps = { ...deps, draftReporter: (record) => {
      const ucpRootId = ucpRootForBridgeEmit(record);
      void reportCandidatePlanToPortal(record, {
        links: { runId: record.recordId, ...(ucpRootId !== null ? { ucpRootId } : {}) },
      });
    } };
    planReportingLog = "candidate-plan emit ON (opt-in, best-effort)";
  }

  // ── Router Delivery Bridge (Core -> Portal) — opt-in, default OFF (D.S1) ────
  //
  // When the operator opts in (USESTEADY_PORTAL_ROUTER_DELIVERIES=1 + a base
  // URL + the shared USESTEADY_PORTAL_TOKEN) AND an executor is wired, wire a
  // best-effort `deliveryReporter` that emits ONE fact - approved work was
  // handed to this executor kind, at this moment - to the Portal's
  // POST /api/v1/router-deliveries ingest, at the spine's handoff moment
  // (INV-DS1-1). The record is a delivery fact, never a result and never a
  // verification input (INV-WL-1). Without an executor there is no delivery
  // moment, so the reporter stays unwired - the rail stage stays honestly
  // absent/Unavailable. Fire-and-forget: it never blocks ratification and
  // never throws (INV-DS1-2). The ucp_root_id is derived from the same intent
  // text the other bridges use, so the delivery JOINS its workflow page.
  const routerDeliveryReporting = resolveRouterDeliveryReporting({});
  let deliveryReportingLog = `router-delivery emit OFF (${routerDeliveryReporting.enabled ? "no_executor" : routerDeliveryReporting.reason})`;
  if (routerDeliveryReporting.enabled && wiredExecutorKind !== null) {
    const executorKind = wiredExecutorKind;
    deps = { ...deps, deliveryReporter: (record, handoff) => {
      const ucpRootId = ucpRootForBridgeEmit(record);
      const kind =
        typeof handoff.executorKind === "string" && handoff.executorKind.trim().length > 0
          ? handoff.executorKind.trim()
          : executorKind;
      void reportRouterDeliveryToPortal(
        { recordId: record.recordId, deliveredAt: handoff.deliveredAt, executorKind: kind },
        { links: { runId: record.recordId, ...(ucpRootId !== null ? { ucpRootId } : {}) } },
      );
    } };
    deliveryReportingLog = `router-delivery emit ON (opt-in, best-effort, executor=${executorKind})`;
  }

  registerGovernedRoutes(app, deps);
  setPortalGovernedHandoffDeps(deps);
  process.stdout.write(
    `[governed] Portal API mounted (GOVERNED_PORTAL=1, loopback-only) - ${executionLog}; ${reportingLog}; ${planReportingLog}; ${deliveryReportingLog}\n`,
  );
}

// Rate-limit the friction report endpoint to prevent queue flooding.
const frictionReportLimiter = rateLimit({
  windowMs:         60 * 1000,   // 1 minute window
  max:              5,            // max 5 reports per IP per minute
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "Too many friction reports. Slow down and try again in a minute." },
});

// POST /api/portal/reflect-intent — Intent Reflection v1 (deterministic artifact)
// + USESTEADY_WORKPLAN_GOAL_ISOLATION_IMPL_CHARTER_V1 (S3): an advisory
// goal-isolation candidate rides alongside. The deterministic artifact is always
// computed first (INV-AI-1) and is returned unchanged on every proposer failure
// (INV-GI-3a). The candidate is an inference for the reflection surface — it
// carries no authority and nothing consumes it without human ratification.
app.post("/api/portal/reflect-intent", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { intent?: unknown };
  const intent = typeof body.intent === "string" ? body.intent : "";

  const { reflectIntentUnderstanding } = await import(
    "./src/portal-bridge/intent-understanding-artifact.js"
  );
  const result = reflectIntentUnderstanding(intent);

  if (!result.ok && result.code === "empty_intent") {
    res.status(400).json(result);
    return;
  }

  // Advisory goal-isolation candidate rides on success responses (templates or
  // verbatim fallback). Non-empty intents no longer return 422 no_reflection —
  // partners must not see a noisy first-turn failure on session one.
  let extra: Record<string, unknown> = {};
  try {
    const {
      PROPOSER_TRANSPORT_HEADER,
      createProposerModelCallFromTransportHeader,
    } = await import("./src/ai-seams/proposer-model-call.js");
    const { proposeIsolatedIntentOutcome } = await import(
      "./src/understand/goal-isolation/index.js"
    );
    const transportHeader =
      req.get(PROPOSER_TRANSPORT_HEADER) ??
      req.headers[PROPOSER_TRANSPORT_HEADER];
    const callModel = createProposerModelCallFromTransportHeader(
      1024,
      Array.isArray(transportHeader) ? transportHeader[0] : transportHeader,
    );
    const outcome = await proposeIsolatedIntentOutcome(intent, callModel);
    if (outcome.kind === "candidate") {
      extra = { goalCandidate: outcome.intent };
    } else if (outcome.kind === "compound") {
      // Taxonomy slice 3: the message reads as more than one ask. The
      // candidate goals are listed for a HUMAN pick — zero authority.
      extra = { goalIsolation: "compound", goalOptions: outcome.goals };
    } else if (outcome.kind === "cannot_isolate") {
      // The model's honest "no single goal here" (INV-GI-3b) — surfaceable.
      extra = { goalIsolation: "cannot_isolate" };
    }
  } catch {
    // Unavailable — verbatim/template artifact still returned.
  }

  if (!result.ok) {
    // empty_intent already returned 400 above; any residual failure stays 422.
    res.status(422).json({ ...result, ...extra });
    return;
  }
  res.json({ ...result, ...extra });
});

// POST /api/portal/propose-turn-reading — Slice 2 of the ops charter
// USESTEADY_INTENT_UNDER_REFLECTION_V1 (REV_3, IUR-9). Classifies ONE
// conversational turn against the current held request into a closed category
// set. The category is a candidate reading with zero authority — the portal
// maps it to deterministic template copy and a rejectable proposal; a human
// override sits beside every use. Fail-closed: every proposer failure returns
// `category: null` (HTTP 200), and the caller behaves exactly as before this
// seam existed.
app.post("/api/portal/propose-turn-reading", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { turn?: unknown; held?: unknown; shown?: unknown };
  const turn = typeof body.turn === "string" ? body.turn : "";
  const held = typeof body.held === "string" ? body.held : "";
  // IUR-14 (REV_6): what the surface is showing — system-authored display
  // text only. Optional; absent keeps the REV_3 wire exactly.
  const shown = typeof body.shown === "string" ? body.shown : "";

  if (turn.trim().length === 0) {
    res.status(400).json({ ok: false, code: "empty_turn" });
    return;
  }

  try {
    const {
      PROPOSER_TRANSPORT_HEADER,
      createProposerModelCallFromTransportHeader,
    } = await import("./src/ai-seams/proposer-model-call.js");
    const { proposeTurnReadingOutcome } = await import(
      "./src/understand/turn-effect/index.js"
    );
    const transportHeader =
      req.get(PROPOSER_TRANSPORT_HEADER) ??
      req.headers[PROPOSER_TRANSPORT_HEADER];
    const callModel = createProposerModelCallFromTransportHeader(
      64,
      Array.isArray(transportHeader) ? transportHeader[0] : transportHeader,
    );
    const outcome = await proposeTurnReadingOutcome(
      { held, turn, shown },
      callModel,
    );
    if (outcome.kind === "candidate") {
      res.json({ ok: true, category: outcome.category });
      return;
    }
  } catch {
    // Unavailable — fall through to the removal-invariant shape.
  }
  res.json({ ok: true, category: null });
});

// POST /api/portal/draft-intent — REV_5 of the ops charter
// USESTEADY_INTENT_UNDER_REFLECTION_V1 (IUR-10..IUR-11). Drafts the held
// request as a clean candidate statement + open questions. The draft is
// model-authored text destined for primary UI — constitutional because the
// portal renders it verbatim under a model-provenance label and ONLY an
// explicit human accept (after free editing) promotes it. Fail-closed: every
// proposer failure returns `intentDraft: null` (HTTP 200) and the surface is
// byte-identical to the seam not existing.
app.post("/api/portal/draft-intent", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { context?: unknown; held?: unknown };
  const context = body.context;
  const held = typeof body.held === "string" ? body.held : "";

  if (context === undefined || context === null) {
    if (held.trim().length === 0) {
      res.status(400).json({ ok: false, code: "empty_held" });
      return;
    }
  }

  try {
    const {
      PROPOSER_TRANSPORT_HEADER,
      createProposerModelCallFromTransportHeader,
    } = await import("./src/ai-seams/proposer-model-call.js");
    const { proposeIntentDraftOutcome } = await import(
      "./src/understand/intent-draft/index.js"
    );
    const transportHeader =
      req.get(PROPOSER_TRANSPORT_HEADER) ??
      req.headers[PROPOSER_TRANSPORT_HEADER];
    const callModel = createProposerModelCallFromTransportHeader(
      512,
      Array.isArray(transportHeader) ? transportHeader[0] : transportHeader,
    );
    const outcome = await proposeIntentDraftOutcome(
      context !== undefined && context !== null
        ? { context, held }
        : held,
      callModel,
    );
    if (outcome.kind === "candidate") {
      res.json({ ok: true, intentDraft: outcome.intentDraft });
      return;
    }
  } catch {
    // Unavailable — fall through to the removal-invariant shape.
  }
  res.json({ ok: true, intentDraft: null });
});

// POST /api/portal/gap-clarify — IUR-19 gap No/Unsure clarify loop.
// Model suggests ways to decide; zero authority. Fail-closed → suggestions: null.
app.post("/api/portal/gap-clarify", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    context?: unknown;
    held?: unknown;
    question?: unknown;
    signal?: unknown;
    heard?: unknown;
    shown?: unknown;
  };

  const context = body.context;
  const held = typeof body.held === "string" ? body.held : "";
  const question = typeof body.question === "string" ? body.question : "";
  const signal = body.signal;

  if (context === undefined || context === null) {
    if (held.trim().length === 0 || question.trim().length === 0) {
      res.status(400).json({ ok: false, code: "missing_fields" });
      return;
    }
    if (signal !== "no" && signal !== "unsure") {
      res.status(400).json({ ok: false, code: "invalid_signal" });
      return;
    }
  }

  const heardRaw = body.heard;
  const heard: string[] = [];
  if (Array.isArray(heardRaw)) {
    for (const line of heardRaw) {
      if (typeof line === "string" && line.trim().length > 0) {
        heard.push(line.trim());
      }
    }
  }
  const shown = typeof body.shown === "string" ? body.shown : "";

  try {
    const {
      PROPOSER_TRANSPORT_HEADER,
      createProposerModelCallFromTransportHeader,
    } = await import("./src/ai-seams/proposer-model-call.js");
    const { proposeGapClarifyOutcome } = await import(
      "./src/understand/gap-clarify/index.js"
    );
    const transportHeader =
      req.get(PROPOSER_TRANSPORT_HEADER) ??
      req.headers[PROPOSER_TRANSPORT_HEADER];
    const callModel = createProposerModelCallFromTransportHeader(
      512,
      Array.isArray(transportHeader) ? transportHeader[0] : transportHeader,
    );
    const outcome = await proposeGapClarifyOutcome(
      {
        context,
        held,
        question,
        ...(signal === "no" || signal === "unsure" ? { signal } : {}),
        heard,
        shown,
      },
      callModel,
    );
    if (outcome.kind === "candidate") {
      res.json({ ok: true, suggestions: outcome.suggestions });
      return;
    }
  } catch {
    // Unavailable — removal invariant.
  }
  res.json({ ok: true, suggestions: null });
});

// POST /api/portal/blocked-explain — BER S1 wall explain (AI_SEAMS_V1_REV_1).
// Advisory only: reason + bounded options. Fail-closed → static HUL (never silent).
app.post("/api/portal/blocked-explain", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    refuse_code?: unknown;
    refuseCode?: unknown;
    structural_facts?: unknown;
    structuralFacts?: unknown;
    plan_summary?: unknown;
    planSummary?: unknown;
  };

  const refuseRaw = body.refuse_code ?? body.refuseCode;
  try {
    const {
      PROPOSER_TRANSPORT_HEADER,
      createProposerModelCallFromTransportHeader,
      envFromProposerTransportHeader,
      proposerRuntimeLabel,
    } = await import("./src/ai-seams/proposer-model-call.js");
    const {
      isBlockedExplainRefuseCode,
      proposeBlockedExplain,
      staticBlockedExplain,
    } = await import("./src/blocked-explain/index.js");

    if (!isBlockedExplainRefuseCode(refuseRaw)) {
      res.status(400).json({ ok: false, code: "invalid_refuse_code" });
      return;
    }

    const factsRaw = body.structural_facts ?? body.structuralFacts;
    const structuralFacts: string[] = [];
    if (Array.isArray(factsRaw)) {
      for (const line of factsRaw) {
        if (typeof line === "string" && line.trim().length > 0) {
          structuralFacts.push(line.trim());
        }
      }
    }
    const planSummaryRaw = body.plan_summary ?? body.planSummary;
    const planSummary =
      typeof planSummaryRaw === "string" ? planSummaryRaw : undefined;

    const transportHeader =
      req.get(PROPOSER_TRANSPORT_HEADER) ??
      req.headers[PROPOSER_TRANSPORT_HEADER];
    const headerValue = Array.isArray(transportHeader)
      ? transportHeader[0]
      : transportHeader;
    const callModel = createProposerModelCallFromTransportHeader(
      768,
      headerValue,
    );
    const env = envFromProposerTransportHeader(headerValue);
    const explain = await proposeBlockedExplain(
      { refuseCode: refuseRaw, structuralFacts, ...(planSummary !== undefined ? { planSummary } : {}) },
      callModel,
      { modelRuntime: proposerRuntimeLabel(env) },
    );
    res.json({ ok: true, explain });
  } catch {
    // Removal / unexpected failure — still never silent when code is valid.
    try {
      const { isBlockedExplainRefuseCode, staticBlockedExplain } = await import(
        "./src/blocked-explain/index.js"
      );
      if (isBlockedExplainRefuseCode(refuseRaw)) {
        res.json({ ok: true, explain: staticBlockedExplain(refuseRaw) });
        return;
      }
    } catch {
      // fall through
    }
    res.status(500).json({ ok: false, code: "blocked_explain_unavailable" });
  }
});

// POST /api/portal/blocked-revise — BER S2 plan-level re-propose (AI_SEAMS_V1_REV_2).
// New candidate plan only (SYSTEM SUGGESTS). Fail-closed → { kind: "none" }. Never executes.
app.post("/api/portal/blocked-revise", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    refuse_code?: unknown;
    refuseCode?: unknown;
    original_goal?: unknown;
    originalGoal?: unknown;
    revision_text?: unknown;
    revisionText?: unknown;
    work_item_id?: unknown;
    workItemId?: unknown;
    baseline_plan_hash?: unknown;
    baselinePlanHash?: unknown;
    memory_point_id?: unknown;
    memoryPointId?: unknown;
    structural_facts?: unknown;
    structuralFacts?: unknown;
    plan_summary?: unknown;
    planSummary?: unknown;
  };

  try {
    const {
      PROPOSER_TRANSPORT_HEADER,
      createProposerModelCallFromTransportHeader,
      envFromProposerTransportHeader,
      proposerRuntimeLabel,
    } = await import("./src/ai-seams/proposer-model-call.js");
    const { isBlockedExplainRefuseCode } = await import(
      "./src/blocked-explain/index.js"
    );
    const { proposeBlockedRevise } = await import(
      "./src/blocked-revise/index.js"
    );

    const refuseRaw = body.refuse_code ?? body.refuseCode;
    if (!isBlockedExplainRefuseCode(refuseRaw)) {
      res.status(400).json({ ok: false, code: "invalid_refuse_code" });
      return;
    }

    const originalGoal =
      typeof (body.original_goal ?? body.originalGoal) === "string"
        ? String(body.original_goal ?? body.originalGoal)
        : "";
    const revisionText =
      typeof (body.revision_text ?? body.revisionText) === "string"
        ? String(body.revision_text ?? body.revisionText)
        : "";
    const workItemId =
      typeof (body.work_item_id ?? body.workItemId) === "string"
        ? String(body.work_item_id ?? body.workItemId)
        : "";
    const baselinePlanHash =
      typeof (body.baseline_plan_hash ?? body.baselinePlanHash) === "string"
        ? String(body.baseline_plan_hash ?? body.baselinePlanHash)
        : "";
    const memoryRaw = body.memory_point_id ?? body.memoryPointId;
    const memoryPointId =
      typeof memoryRaw === "string" ? memoryRaw : null;

    const factsRaw = body.structural_facts ?? body.structuralFacts;
    const structuralFacts: string[] = [];
    if (Array.isArray(factsRaw)) {
      for (const line of factsRaw) {
        if (typeof line === "string" && line.trim().length > 0) {
          structuralFacts.push(line.trim());
        }
      }
    }
    const planSummaryRaw = body.plan_summary ?? body.planSummary;
    const planSummary =
      typeof planSummaryRaw === "string" ? planSummaryRaw : undefined;

    const transportHeader =
      req.get(PROPOSER_TRANSPORT_HEADER) ??
      req.headers[PROPOSER_TRANSPORT_HEADER];
    const headerValue = Array.isArray(transportHeader)
      ? transportHeader[0]
      : transportHeader;
    const callModel = createProposerModelCallFromTransportHeader(
      2048,
      headerValue,
    );
    const env = envFromProposerTransportHeader(headerValue);
    const outcome = await proposeBlockedRevise(
      {
        refuseCode: refuseRaw,
        originalGoal,
        revisionText,
        workItemId,
        baselinePlanHash,
        memoryPointId,
        structuralFacts,
        ...(planSummary !== undefined ? { planSummary } : {}),
      },
      callModel,
      { modelRuntime: proposerRuntimeLabel(env) },
    );
    res.json({ ok: true, outcome });
  } catch {
    res.json({
      ok: true,
      outcome: { kind: "none", reason: "blocked_revise_unavailable", violations: [] },
    });
  }
});

// USESTEADY_PLANNING_SURFACE_AUTHORITY_V1: map WorkPlan tasks to Portal step format.
// USESTEADY_CORE_WORKPLAN_PRESENT_FACT_EXPORT_V1: each step also carries
// present_facts derived ONLY from the task sourceSpan over the raw request
// (attribution computed once in core via the canonical attributeFact). No prose
// inference; spans that do not trace to the request emit no present_facts.
function workPlanToPortalSteps(
  plan: WorkPlan,
  rawInput: string,
): readonly PortalUnderstandStep[] {
  return plan.tasks.map((task, i) => {
    const presentFacts = presentFactsForWorkPlanTask(task, rawInput);
    return {
      index: i,
      title: task.action ? `${task.action}: ${task.target}` : task.target,
      summary: task.outcome || plan.goal,
      input: task.target,
      ...(presentFacts.length > 0 ? { present_facts: presentFacts } : {}),
    };
  });
}

// POST /api/portal/understand-workflow — D2 + Sprint 8 ContextEnvelope (read-only)
app.post("/api/portal/understand-workflow", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    intent?: unknown;
    context?: unknown;
    confirmed_understanding?: unknown;
  };
  const intent = typeof body.intent === "string" ? body.intent : "";

  const { parseContextEnvelopeInput } = await import(
    "./src/portal-bridge/context-envelope-v1.js"
  );
  const { parseConfirmedUnderstandingV1 } = await import(
    "./src/portal-bridge/confirmed-understanding-handoff.js"
  );
  const contextParsed = parseContextEnvelopeInput(body.context);
  if (!contextParsed.ok) {
    res.status(400).json({
      ok: false,
      message: contextParsed.message,
      code:    contextParsed.code,
    });
    return;
  }

  try {
    const result = await understandWorkflowIntent(intent, {
      registry: skillRegistry,
      workflowDraftAdapter,
      context: contextParsed.envelope,
      confirmedUnderstanding: parseConfirmedUnderstandingV1(body.confirmed_understanding),
    });

    if (!result.ok) {
      const status = result.code === "empty_intent" ? 400 : 422;
      res.status(status).json(result);
      return;
    }

    // USESTEADY_PLANNING_SURFACE_AUTHORITY_V1: for non-IR planning inputs, override the
    // legacy LocalWorkflowDraftAdapter result with the certified WorkPlan engine.
    // USESTEADY_BUSINESS_INTENT_EXTRACTION_IMPL_V1: business-intent inputs (structural
    // requester-frame detection) also route to the WorkPlan engine even when intake
    // returns without a confirmed_understanding payload.
    const rawUnderstanding = parseConfirmedUnderstandingV1(body.confirmed_understanding);
    const hasConfirmedUnderstanding = rawUnderstanding != null;
    if (shouldRouteToWorkPlanEngine(result.source, hasConfirmedUnderstanding, intent)) {
      // USESTEADY_WORKPLAN_GOAL_ISOLATION_IMPL_CHARTER_V1 (S3): carry the
      // human-ratified goal into the plan input, re-validated against THIS
      // request's intent (offsets recomputed; non-verbatim → dropped, INV-GI-7).
      const { parseRatifiedGoalV1 } = await import(
        "./src/portal-bridge/confirmed-understanding-handoff.js"
      );
      const ratifiedGoal = parseRatifiedGoalV1(
        rawUnderstanding?.ratifiedGoal,
        intent.trim(),
      );
      const certConfirmed = {
        format: "usesteady.confirmed-understanding.v1" as const,
        bullets: rawUnderstanding?.bullets ?? ["Request received"],
        rawInput: intent,
        confirmedAt: new Date().toISOString(),
        ...(ratifiedGoal !== null ? { ratifiedGoal } : {}),
      };
      try {
        const workPlan = generateWorkPlanFromConfirmed(certConfirmed);
        const authoritative = {
          ...result,
          source: "workplan" as const,
          name: workPlan.goal,
          headline: workPlan.terminalOutcome,
          steps: workPlanToPortalSteps(workPlan, intent),
          workPlan,
          // USESTEADY_CORE_WORKPLAN_CERTAINTY_VOCABULARY_V1: reaching this branch means
          // the plan is plan-ready (generateWorkPlanFromConfirmed did not decline). Realign
          // the legacy "confirmed" outlier to a canonical, Ops-plan-gate-compatible certainty
          // so the WorkPlan routes to the plan branch (not a report). Declined plans fall
          // through below and keep their existing unknown/incomplete shape.
          presentation: workPlanPresentation(result.presentation?.mode),
        };
        res.json(authoritative);
        return;
      } catch (planErr) {
        if (!(planErr instanceof GoalIsolationDeclinedError)) throw planErr;
        // Declined — fall through to legacy result below.
      }
    }

    // USESTEADY_CLARIFY_SURFACE_IMPL_V1 (ratified S1): intake fall-throughs that are
    // sentence-shaped statements without a makeable/investigable commitment receive
    // the certified Clarify commitment instead of the legacy file-format guidance.
    // Pre-commitment: no approval gate; ucp_root_id passes through unchanged.
    if (result.source === "intake" && !hasConfirmedUnderstanding && isClarifyClass(intent)) {
      const clarify = generateClarify(intent);
      res.json({
        ...result,
        source: "clarify" as const,
        name: clarify.understood,
        headline: clarify.ask,
        steps: [],
        presentation: { mode: "clarify", certaintyLevel: "stated_problem" },
        clarify,
      });
      return;
    }

    // P0-1 Slice 2 — pass-through of ucp_root_id + optional ucp_bundle_hash
    // These fields are now present on all success paths from understandWorkflowIntent.
    // The Portal (usesteady-ops) persists them via completeUnderstoodWorkflow.
    res.json(result);
  } catch (err) {
    process.stderr.write(`[portal] understand-workflow error: ${String(err)}\n`);
    res.status(500).json({ ok: false, message: "Understand request failed." });
  }
});

// W-E1 — Portal governed handoff (Fix A two-phase). Token-authenticated; not loopback-only.
app.post("/api/portal/governed-handoff/draft", async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await handlePortalGovernedHandoffDraft(
      req.header("authorization"),
      req.body as Parameters<typeof handlePortalGovernedHandoffDraft>[1],
    );
    res.status(result.status).json(result.json);
  } catch (err) {
    process.stderr.write(`[portal] governed-handoff/draft error: ${String(err)}\n`);
    res.status(500).json({ error: "handoff_draft_failed", message: "Draft request failed." });
  }
});

app.post("/api/portal/governed-handoff/ratify", async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await handlePortalGovernedHandoffRatify(
      req.header("authorization"),
      req.body as Parameters<typeof handlePortalGovernedHandoffRatify>[1],
    );
    res.status(result.status).json(result.json);
  } catch (err) {
    process.stderr.write(`[portal] governed-handoff/ratify error: ${String(err)}\n`);
    res.status(500).json({ error: "handoff_ratify_failed", message: "Ratify request failed." });
  }
});

// GPC S4 — lookup sealed capsule + verified projection (opaque ids only).
app.post("/api/portal/gpc/status", (req: Request, res: Response): void => {
  try {
    const result = handlePortalGpcStatus(
      req.header("authorization"),
      req.body,
    );
    res.status(result.status).json(result.json);
  } catch (err) {
    process.stderr.write(`[portal] gpc/status error: ${String(err)}\n`);
    res.status(500).json({ ok: false, message: "GPC status lookup failed." });
  }
});

// S2 — Portal workspace_key registry membership probe (no paths/secrets).
app.post("/api/portal/workspace-ready", (req: Request, res: Response): void => {
  try {
    const result = handlePortalWorkspaceReady(
      req.header("authorization"),
      req.body as { workspace_key?: unknown },
    );
    res.status(result.status).json(result.json);
  } catch (err) {
    process.stderr.write(`[portal] workspace-ready error: ${String(err)}\n`);
    res.status(500).json({ ok: false, known: false, message: "Workspace ready probe failed." });
  }
});

// Registry durability health (opaque counts; portal bearer).
app.get("/api/portal/workspace-registry-health", (req: Request, res: Response): void => {
  try {
    const result = handlePortalWorkspaceRegistryHealth(req.header("authorization"));
    res.status(result.status).json(result.json);
  } catch (err) {
    process.stderr.write(`[portal] workspace-registry-health error: ${String(err)}\n`);
    res.status(500).json({ ok: false, message: "Registry health probe failed." });
  }
});

// S1b — Auto-provision managed org sandbox (organization_uuid only; INV-WS-1).
app.post("/api/portal/workspace-provision", (req: Request, res: Response): void => {
  try {
    const result = handlePortalWorkspaceProvision(
      req.header("authorization"),
      req.body as { organization_uuid?: unknown },
    );
    res.status(result.status).json(result.json);
  } catch (err) {
    process.stderr.write(`[portal] workspace-provision error: ${String(err)}\n`);
    res.status(500).json({ ok: false, message: "Workspace provision failed." });
  }
});

// S3b — Provision org SCM workspace (GitHub App installation_id; no per-org env).
app.post("/api/portal/workspace-scm-provision", (req: Request, res: Response): void => {
  try {
    const result = handlePortalWorkspaceScmProvision(
      req.header("authorization"),
      req.body as {
        organization_uuid?: unknown;
        owner?: unknown;
        repo?: unknown;
        base_branch?: unknown;
        installation_id?: unknown;
      },
    );
    res.status(result.status).json(result.json);
  } catch (err) {
    process.stderr.write(`[portal] workspace-scm-provision error: ${String(err)}\n`);
    res.status(500).json({ ok: false, message: "SCM workspace provision failed." });
  }
});

// GET /api/portal/provenance/:ucpRootId — P0-3 (enriched in Slice 2 + Slice 3) + P0-4 + P0-6
// Returns a stable, defensible provenance artifact for a ucp_root_id.
// Slice 1: minimal root ID + control statement.
// Slice 2: adds intent_hash + intent_summary when caller supplies original_intent.
// Slice 3: when ?chain=1 (or include=chain), also returns the full UCP decision chain
//          (intent + all descendant envelopes linked by rootId) using the existing
//          getChain() query over the byRoot index. Compact summaries only (no full payloads).
// P0-4: when chain present, also returns lightweight `verification` (cumulative hash over IDs)
//       for independent integrity check.
// P0-6: when ?narrative=1, also returns a human-readable `narrative` generated from the chain.
// P0-7: when signing secret is configured, also returns a `signature` object (HMAC over core content).
// P0-8: when ?vc=1, returns a standard W3C VerifiableCredential (JSON-LD) wrapping the provenance data,
//       with the P0-7 signature (if present) surfaced as the proof.
app.get("/api/portal/provenance/:ucpRootId", (req: Request, res: Response): void => {
  const ucpRootId = String(req.params.ucpRootId || "").trim();
  const originalIntent = typeof req.query.original_intent === "string" ? req.query.original_intent : undefined;
  const wantChain = ["1", "true", "yes"].includes(String(req.query.chain || "").toLowerCase())
    || String(req.query.include || "").toLowerCase().includes("chain");
  const wantNarrative = ["1", "true", "yes"].includes(String(req.query.narrative || "").toLowerCase());
  const wantVc = ["1", "true", "yes"].includes(String(req.query.vc || "").toLowerCase());
  const wantExportFull = ["full", "package", "1", "true", "yes"].includes(
    String(req.query.export || "").toLowerCase()
  );
  const wantPdf = String(req.query.export || "").toLowerCase() === "pdf" ||
                  String(req.query.format || "").toLowerCase() === "pdf";
  const wantBbs = ["1", "true", "yes"].includes(String(req.query.bbs || "").toLowerCase());
  // P0-17: self-sovereign / fully portable export — bundles every verification artifact inline.
  const wantPortable = ["1", "true", "yes", "full"].includes(String(req.query.portable || "").toLowerCase());

  // P0-3 Slice 3 Remediation (Fix 1): Accept real P0-1 64-char hex ucp_root_id values
  // while still supporting ucp.* prefixed IDs. APPROVED 2026-05-30.
  if (!ucpRootId || (ucpRootId.length !== 64 && !ucpRootId.startsWith("ucp."))) {
    res.status(400).json({ ok: false, message: "Invalid ucp_root_id" });
    return;
  }

  const base: Record<string, unknown> = {
    ok: true,
    ucp_root_id: ucpRootId,
    type: "ucp.intent.v1",
    retrieved_at: new Date().toISOString(),
  };

  // P0-16: surface pre-P0-1 (historical) workflows consistently. A legacy id is
  // a retroactively backfilled root; flag it so insights / Portal can label it.
  if (isLegacyUcpRootId(ucpRootId)) {
    base.legacy = true;
    base.legacy_note = "Pre-P0-1 historical workflow surfaced via retroactive ucp_root_id backfill.";
  }

  if (originalIntent) {
    // P0-3 Slice 2: compute stable content hash of the intent payload using the
    // existing canonical UCP hashing utilities (hashObject + stableStringify).
    base.intent_hash = hashObject({ input: originalIntent });
    base.intent_summary = {
      raw_input: originalIntent.length > 200 ? originalIntent.slice(0, 197) + "…" : originalIntent,
    };
  }

  if (wantChain) {
    // P0-3 Slice 3: full decision chain via the mature byRoot index.
    // Returns envelopes in log order (chronological). We emit only the minimal
    // fields a buyer/auditor needs for verification.
    const chainEnvs: UCPEnvelope<unknown>[] = getChain(DEFAULT_STORE_DIR, ucpRootId);
    base.decision_chain = chainEnvs.map((env) => ({
      id: env.id,
      type: env.type,
      ts: env.ts,
      created_at: new Date(env.ts).toISOString(),
      summary: summarizeUcpEnvelope(env),
    }));
  }

  // P0-4: Verification object (cumulative hash + Merkle root)
  // Step 1: Lightweight cumulative hash (backward compatible)
  // Step 2: Merkle root for stronger, inclusion-ready verification
  if (wantChain && base.decision_chain && Array.isArray(base.decision_chain) && (base.decision_chain as any[]).length > 0) {
    const chain = base.decision_chain as any[];

    // P0-57: single shared algorithm (src/ucp/chain-verification.ts) so the digest
    // the Portal recomputes in-browser can never drift from what this endpoint and
    // the execution-return bridge publish. Behavior-preserving vs the prior inline
    // P0-4 block (same cumulative_hash + Merkle root).
    const v = computeChainVerification(chain.map((e: any) => e.id));
    if (v) {
      (base as any).verification = {
        type: 'merkle',
        cumulative_hash: v.cumulative_hash,
        merkle_root: v.merkle_root,
        algorithm: 'sha256',
        note: 'Merkle root over ordered decision_chain IDs. Supports future inclusion proofs. Cumulative hash also provided for backward compatibility.'
      };
    }
  }

  // P0-6: Human-readable narrative (simple rule-based generation from decision_chain)
  if (wantNarrative && base.decision_chain && Array.isArray(base.decision_chain) && (base.decision_chain as any[]).length > 0) {
    (base as any).narrative = generateNarrative(base.decision_chain as any[]);
  }

  // Slice 1/2/3 note — honest and buyer-facing.
  base.note =
    "This is the stable root of the UseSteady Control Protocol (UCP) record for the referenced workflow. " +
    "Every step was required to pass explicit human approval before any change was applied. " +
    "The full audit trail exists in the core UCP envelope store under this root ID.";

  // P0-7 / P0-11: Optional signature (HMAC-SHA256 or Ed25519, configurable via USESTEADY_PROVENANCE_SIGNING_ALGORITHM)
  // The compute function reads the algorithm env var internally.
  const sig = computeProvenanceSignature(base);
  if (sig) {
    (base as any).signature = sig;
  }

  // P0-8 (first bounded step): When ?vc=1, return a standards-shaped W3C Verifiable Credential
  // instead of the raw provenance envelope. Reuses whatever rich data (chain, narrative, signature)
  // the caller requested via other flags. The P0-7 signature (if present) becomes the proof.
  if (wantVc) {
    const vc = buildProvenanceVerifiableCredential(base, ucpRootId);
    res.json(vc);
    return;
  }

  // P0-17 (first bounded step): Self-sovereign / fully portable export.
  // Bundles every verification artifact inline (signature, public key, VC, BBS+ proof)
  // plus machine-readable verification instructions, so a recipient can verify the
  // record offline without ever contacting UseSteady.
  if (wantPortable) {
    const pkg = buildPortableProvenancePackage(base, ucpRootId);
    const filename = `usesteady-portable-provenance-${ucpRootId}.json`;

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(pkg);
    return;
  }

  // P0-10 (first bounded step): Full provenance package export.
  // P0-17: also embed the issued Verifiable Credential so the full export carries
  // the VC verification artifact inline (additive; legacy package_type preserved).
  if (wantExportFull) {
    if (!(base as any).verifiable_credential) {
      (base as any).verifiable_credential = buildProvenanceVerifiableCredential(base, ucpRootId);
    }
    const pkg = buildFullProvenancePackage(base);
    const filename = `usesteady-provenance-package-${ucpRootId}.json`;

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(pkg);
    return;
  }

  // P0-12 (first bounded step): Professional PDF export of the full provenance package.
  // Minimal zero-dependency PDF generation for the bounded first slice.
  if (wantPdf) {
    const pkg = buildFullProvenancePackage(base);
    const pdfBuffer = buildProvenancePdf(pkg);
    const filename = `usesteady-provenance-${ucpRootId}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.end(pdfBuffer);
    return;
  }

  // P0-14 (first bounded step): When ?bbs=1, attach a real BBS+ selective disclosure proof.
  // The proof is a verifiable signature over only the disclosed attributes (default: ucp_root_id + narrative).
  // Verifiers can confirm authenticity of the revealed fields without seeing the full chain.
  if (wantBbs) {
    (base as any).bbs_proof = generateBbsProof(base);
  }

  res.json(base);
});

// P0-15 (first bounded step): Check the status of a Verifiable Credential.
// Returns { status: "valid" | "revoked" | "suspended" }. Unknown credentials are "valid".
app.get("/api/portal/vc-status/:credentialId", (req: Request, res: Response): void => {
  const credentialId = String(req.params.credentialId || "").trim();
  if (!credentialId) {
    res.status(400).json({ ok: false, message: "Invalid credentialId" });
    return;
  }
  res.json({ ok: true, ...getCredentialStatus(credentialId) });
});

// P0-15 (first bounded step): Revoke a Verifiable Credential (decision-layer only).
// Subsequent status checks for this credential return "revoked".
app.post("/api/portal/vc-status/:credentialId/revoke", (req: Request, res: Response): void => {
  const credentialId = String(req.params.credentialId || "").trim();
  if (!credentialId) {
    res.status(400).json({ ok: false, message: "Invalid credentialId" });
    return;
  }
  const reason = typeof req.body?.reason === "string" && req.body.reason.trim().length > 0
    ? req.body.reason.trim()
    : undefined;
  res.json({ ok: true, ...revokeCredential(credentialId, reason) });
});

/**
 * Produce a one-line human summary for an envelope in the provenance chain.
 * Deliberately small and stable for Slice 3 — not a full pretty-printer.
 */
function summarizeUcpEnvelope(env: UCPEnvelope<unknown>): string {
  switch (env.type) {
    case "ucp.intent.v1":
      return "User intent received";
    case "ucp.response.v1": {
      const mode = (env.payload as any)?.mode;
      return mode ? `Decision: ${mode}` : "Intake decision";
    }
    case "ucp.intent_interpretation.v1":
      return "Intent interpreted";
    case "ucp.change_interpretation.v1":
      return "Changes interpreted";
    case "ucp.debug_trace.v1":
      return "Debug trace";
    case "ucp.artifact.v1":
      return "Execution artifact";
    case "ucp.execution_trace.v1":
      return "Execution trace";
    case "ucp.replay_report.v1":
      return "Replay record";
    default:
      return env.type.replace(/^ucp\./, "").replace(/\.v1$/, "");
  }
}

/**
 * P0-6: Simple rule-based narrative generator from a decision_chain.
 * Produces clean, human-readable text for non-technical users.
 */
function generateNarrative(chain: readonly { id: string; type: string; summary?: string }[]): string {
  if (!chain || chain.length === 0) {
    return "No decision history available for this workflow.";
  }

  const intentItem = chain.find((item) => item.type.includes("intent"));
  const intentText = intentItem?.summary || "User submitted a workflow request.";

  const decisions = chain
    .filter((item) => item.type.includes("response") || item.type.includes("decision"))
    .map((item) => item.summary || "A governance decision was recorded.")
    .slice(0, 5); // keep it concise

  const outcome = chain.some((item) => item.type.includes("artifact"))
    ? "The workflow was executed under governance controls."
    : "The workflow reached a governed terminal state.";

  const warnings = chain.some((item) => item.type.includes("safety") && item.summary?.toLowerCase().includes("block"))
    ? "Some steps were blocked by safety policy."
    : "";

  let narrative = `**User Intent**\n${intentText}\n\n`;

  if (decisions.length > 0) {
    narrative += "**Key Governance Decisions**\n";
    decisions.forEach((d, i) => {
      narrative += `${i + 1}. ${d}\n`;
    });
    narrative += "\n";
  }

  narrative += `**Outcome**\n${outcome}`;

  if (warnings) {
    narrative += `\n\n**Notes**\n${warnings}`;
  }

  return narrative.trim();
}

// P0-11: Signing algorithm selection (hmac-sha256 is the backward-compatible default)
const PROVENANCE_SIGNING_ALGORITHM = (process.env["USESTEADY_PROVENANCE_SIGNING_ALGORITHM"] || "hmac-sha256").toLowerCase() as 'hmac-sha256' | 'ed25519';

// P0-11: Ed25519 key pair (loaded from PEM or generated ephemerally for this bounded step)
let ed25519KeyPair: { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject } | null = null;
if (PROVENANCE_SIGNING_ALGORITHM === 'ed25519') {
  const privatePem = process.env["USESTEADY_PROVENANCE_ED25519_PRIVATE_KEY_PEM"];
  if (privatePem && privatePem.trim().length > 0) {
    const priv = crypto.createPrivateKey({ key: privatePem, format: 'pem' });
    ed25519KeyPair = { privateKey: priv, publicKey: crypto.createPublicKey(priv) };
  } else {
    // Dev/demo fallback — ephemeral key (public key is logged so verifiers can use it)
    ed25519KeyPair = crypto.generateKeyPairSync('ed25519');
    const pubPem = ed25519KeyPair.publicKey.export({ type: 'spki', format: 'pem' });
    console.warn('[P0-11] Ed25519 signing enabled with an ephemeral key pair (not persisted across restarts).\nPublic key for verification:\n' + pubPem);
  }
}

/**
 * P0-7 / P0-11: Compute a provenance signature using the configured algorithm.
 * - "hmac-sha256" (default, backward compatible): uses USESTEADY_PROVENANCE_SIGNING_SECRET
 * - "ed25519": uses Ed25519 private key (from env or generated)
 *
 * The returned object always includes `algorithm`.
 */
export function computeProvenanceSignature(
  payload: Record<string, unknown>,
  hmacSecretForCompat?: string,
): { algorithm: string; signature: string; timestamp: string; key_hint: string; public_key?: string } | undefined {
  const signable = {
    ucp_root_id: payload.ucp_root_id,
    intent_hash: payload.intent_hash,
    decision_chain: payload.decision_chain,
    verification: (payload as any).verification,
    narrative: (payload as any).narrative,
  };
  const payloadString = stableStringify(signable);
  const timestamp = new Date().toISOString();

  if (PROVENANCE_SIGNING_ALGORITHM === 'ed25519' && ed25519KeyPair) {
    const sigBuffer = crypto.sign(null, Buffer.from(payloadString, 'utf8'), ed25519KeyPair.privateKey);
    const pubPem = ed25519KeyPair.publicKey.export({ type: 'spki', format: 'pem' }) as string;

    return {
      algorithm: 'ed25519',
      signature: sigBuffer.toString('base64'),
      timestamp,
      key_hint: 'env:USESTEADY_PROVENANCE_ED25519_PRIVATE_KEY_PEM',
      public_key: pubPem,
    };
  }

  // HMAC-SHA256 path (default, fully backward compatible)
  const secret = hmacSecretForCompat || process.env["USESTEADY_PROVENANCE_SIGNING_SECRET"];
  if (!secret || secret.length === 0) return undefined;

  const hmac = crypto.createHmac("sha256", secret).update(payloadString, "utf8").digest("hex");
  return {
    algorithm: "HMAC-SHA256",
    signature: hmac,
    timestamp,
    key_hint: "env:USESTEADY_PROVENANCE_SIGNING_SECRET",
  };
}

/**
 * P0-7 / P0-11: Verify a provenance signature (supports both HMAC-SHA256 and ed25519).
 */
export function verifyProvenanceSignature(
  payload: Record<string, unknown>,
  signatureObj: { algorithm?: string; signature?: string; timestamp?: string; key_hint?: string; public_key?: string } | undefined,
  hmacSecretForCompat?: string,
): boolean {
  if (!signatureObj || !signatureObj.signature) return false;

  const signable = {
    ucp_root_id: payload.ucp_root_id,
    intent_hash: payload.intent_hash,
    decision_chain: payload.decision_chain,
    verification: (payload as any).verification,
    narrative: (payload as any).narrative,
  };
  const payloadString = stableStringify(signable);

  if (signatureObj.algorithm === 'ed25519' || signatureObj.algorithm === 'Ed25519') {
    if (!signatureObj.public_key) return false;
    try {
      const pubKey = crypto.createPublicKey(signatureObj.public_key);
      const sigBuf = Buffer.from(signatureObj.signature, 'base64');
      return crypto.verify(null, Buffer.from(payloadString, 'utf8'), pubKey, sigBuf);
    } catch {
      return false;
    }
  }

  // HMAC path (original behavior)
  if (signatureObj.algorithm !== "HMAC-SHA256") return false;
  const secret = hmacSecretForCompat || process.env["USESTEADY_PROVENANCE_SIGNING_SECRET"];
  if (!secret) return false;

  const expected = crypto.createHmac("sha256", secret).update(payloadString, "utf8").digest("hex");
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signatureObj.signature, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * P0-8 (first bounded step): Construct a minimal, standards-shaped W3C Verifiable Credential
 * for a provenance record. Reuses the P0-7 signature (when present) as the cryptographic proof.
 * No external VC libraries — pure manual construction for the bounded scope.
 */
// ─── P0-15: Verifiable Credential revocation / status registry ────────────────
//
// A minimal, in-memory status registry that lets a VC be revoked (or suspended)
// and its status checked in real time. Backward-compatible and optional: VCs
// default to "valid" and existing callers are unaffected.
//
// Future bounded steps may persist this and add richer status purposes.

export type VcStatusState = "valid" | "revoked" | "suspended";

const vcStatusRegistry = new Map<string, { status: VcStatusState; updatedAt: string; reason?: string }>();

/**
 * P0-15: Return the current status of a credential. Unknown credentials are
 * "valid" by default (never issued a revocation), so this is safe to call for
 * any credential id.
 */
export function getCredentialStatus(credentialId: string): {
  credentialId: string;
  status: VcStatusState;
  updatedAt?: string;
  reason?: string;
} {
  const entry = vcStatusRegistry.get(credentialId);
  if (!entry) {
    return { credentialId, status: "valid" };
  }
  return {
    credentialId,
    status: entry.status,
    updatedAt: entry.updatedAt,
    ...(entry.reason ? { reason: entry.reason } : {}),
  };
}

/**
 * P0-15: Set a credential's status (revoked / suspended / valid) with an optional reason.
 */
export function setCredentialStatus(
  credentialId: string,
  status: VcStatusState,
  reason?: string,
): ReturnType<typeof getCredentialStatus> {
  vcStatusRegistry.set(credentialId, {
    status,
    updatedAt: new Date().toISOString(),
    ...(reason ? { reason } : {}),
  });
  return getCredentialStatus(credentialId);
}

/**
 * P0-15: Revoke a credential (convenience wrapper over setCredentialStatus).
 */
export function revokeCredential(credentialId: string, reason?: string): ReturnType<typeof getCredentialStatus> {
  return setCredentialStatus(credentialId, "revoked", reason);
}

/**
 * P0-15: Build the wallet-friendly `credentialStatus` entry embedded in an issued VC.
 * Points at the live status endpoint so verifiers can check revocation in real time.
 */
export function buildCredentialStatusEntry(credentialId: string): {
  id: string;
  type: string;
  statusPurpose: string;
  statusListCredential: string;
} {
  return {
    id: `https://usesteady.dev/credentials/provenance/${credentialId}/status`,
    type: "UseSteadyCredentialStatus2026",
    statusPurpose: "revocation",
    statusListCredential: "https://usesteady.dev/status-list/provenance",
  };
}

/**
 * P0-16 (first bounded step): Pre-P0-1 workflow visibility.
 *
 * Workflows created before P0-1 have no `ucp_root_id` and are therefore invisible
 * in the provenance system. These helpers retroactively (and deterministically)
 * derive a legacy `ucp_root_id` from a workflow's stable identifying fields so
 * historical records can be surfaced, verified, narrated, and exported exactly
 * like modern ones.
 *
 * The derived id is prefixed `ucp.legacy.` so it:
 *   - passes the provenance endpoint validation (startsWith "ucp."),
 *   - is visually distinguishable as a backfilled (legacy) record,
 *   - is stable / idempotent: the same workflow always yields the same id,
 *     so re-running the backfill never produces duplicates.
 *
 * Backward-compatible: a workflow that already carries a `ucp_root_id` is
 * returned unchanged — never re-derived, never relabeled.
 */
export type LegacyWorkflowInput = {
  ucp_root_id?: string | null;
  workflow_id?: string | null;
  created_at?: string | null;
  intent?: string | null;
};

/** Returns true when a ucp_root_id was produced by the legacy backfill. */
export function isLegacyUcpRootId(ucpRootId: string): boolean {
  return typeof ucpRootId === "string" && ucpRootId.startsWith("ucp.legacy.");
}

/**
 * Deterministically derive a legacy `ucp_root_id` for a pre-P0-1 workflow from
 * its stable identifying fields. Empty fields are omitted so the hash is
 * reproducible regardless of null vs missing.
 */
export function deriveLegacyUcpRootId(workflow: LegacyWorkflowInput): string {
  const seed: Record<string, string> = {};
  if (workflow.workflow_id) seed.workflow_id = String(workflow.workflow_id);
  if (workflow.created_at) seed.created_at = String(workflow.created_at);
  if (workflow.intent) seed.intent = String(workflow.intent);
  return "ucp.legacy." + hashObject(seed);
}

/**
 * Return a workflow's `ucp_root_id`, backfilling a deterministic legacy id when
 * none exists. The `legacy` flag tells callers (insights, Portal) to label the
 * record as a historical, retroactively-surfaced workflow.
 */
export function ensureUcpRootId(workflow: LegacyWorkflowInput): {
  ucp_root_id: string;
  legacy: boolean;
} {
  const existing = typeof workflow.ucp_root_id === "string" ? workflow.ucp_root_id.trim() : "";
  if (existing) {
    return { ucp_root_id: existing, legacy: isLegacyUcpRootId(existing) };
  }
  return { ucp_root_id: deriveLegacyUcpRootId(workflow), legacy: true };
}

export function buildProvenanceVerifiableCredential(
  provenanceData: Record<string, unknown>,
  ucpRootId: string,
): Record<string, unknown> {
  const now = new Date().toISOString();

  const subject: Record<string, unknown> = {
    id: `https://usesteady.dev/provenance/${ucpRootId}`,
    ucpRootId,
  };

  if (provenanceData.intent_hash) subject.intentHash = provenanceData.intent_hash;
  if (provenanceData.decision_chain) subject.decisionChain = provenanceData.decision_chain;
  if ((provenanceData as any).narrative) subject.narrative = (provenanceData as any).narrative;
  if ((provenanceData as any).verification) subject.verification = (provenanceData as any).verification;

  const vc: Record<string, unknown> = {
    "@context": [
      "https://www.w3.org/ns/credentials/v2"
    ],
    id: `https://usesteady.dev/credentials/provenance/${ucpRootId}`,
    type: ["VerifiableCredential", "UseSteadyProvenanceCredential"],
    issuer: {
      id: "https://usesteady.dev",
      name: "UseSteady",
    },
    validFrom: now,
    credentialSubject: subject,
    // P0-15: wallet-friendly credentialStatus pointing at the live status/revocation endpoint.
    credentialStatus: buildCredentialStatusEntry(ucpRootId),
  };

  const sig = (provenanceData as any).signature;
  if (sig && sig.signature) {
    (vc as any).proof = {
      type: "UseSteadyProvenanceHMAC2026",
      created: sig.timestamp,
      verificationMethod: sig.key_hint || "env:USESTEADY_PROVENANCE_SIGNING_SECRET",
      signature: sig.signature,
      algorithm: sig.algorithm,
    };
  }

  return vc;
}

/**
 * P0-10 (first bounded step): Assemble a complete, self-contained provenance package
 * for export/archival. Includes all rich data the caller requested (narrative, chain,
 * verification, signature, VC) in one portable artifact.
 */
export function buildFullProvenancePackage(
  provenanceData: Record<string, unknown>
): Record<string, unknown> {
  const ucpRootId = provenanceData.ucp_root_id as string;

  const pkg: Record<string, unknown> = {
    package_type: "usesteady_provenance_package_v1",
    exported_at: new Date().toISOString(),
    ucp_root_id: ucpRootId,
    note: "This is a complete, self-contained provenance package for audit and archival. It includes the human-readable narrative, full decision chain, cryptographic verification, and any issued Verifiable Credential.",
  };

  if (provenanceData.intent_hash) pkg.intent_hash = provenanceData.intent_hash;
  if (provenanceData.intent_summary) pkg.intent_summary = provenanceData.intent_summary;
  if (provenanceData.decision_chain) pkg.decision_chain = provenanceData.decision_chain;
  if ((provenanceData as any).narrative) pkg.narrative = (provenanceData as any).narrative;
  if ((provenanceData as any).verification) pkg.verification = (provenanceData as any).verification;
  if ((provenanceData as any).signature) pkg.signature = (provenanceData as any).signature;
  if ((provenanceData as any).verifiable_credential) {
    pkg.verifiable_credential = (provenanceData as any).verifiable_credential;
  }

  return pkg;
}

/**
 * P0-17 (first bounded step): Self-sovereign / fully portable provenance package.
 *
 * Produces a single, self-contained artifact that a recipient can verify WITHOUT
 * contacting UseSteady. It builds on the P0-10 full package and additionally
 * embeds every verification artifact inline:
 *   - the cryptographic signature (P0-7/P0-11),
 *   - the signer's PUBLIC KEY surfaced at top level when Ed25519 is used
 *     (the one piece a recipient needs for offline asymmetric verification),
 *   - the issued W3C Verifiable Credential (P0-8),
 *   - the BBS+ selective-disclosure proof (P0-14) when present,
 *   - explicit, machine-readable `verification_instructions` describing exactly
 *     which fields are signed and how to reproduce the check offline.
 *
 * `independently_verifiable` is true only when an Ed25519 public key is embedded
 * (asymmetric — no shared secret needed). HMAC-signed packages are honestly
 * flagged false, because verifying an HMAC requires the secret that is never
 * exported. Backward-compatible: this is an additive, opt-in package shape.
 */
export function buildPortableProvenancePackage(
  provenanceData: Record<string, unknown>,
  ucpRootId: string,
): Record<string, unknown> {
  const pkg = buildFullProvenancePackage(provenanceData);

  // Always embed the W3C Verifiable Credential for portability (the full package
  // only includes it when pre-attached; a portable export must be self-contained).
  if (!pkg.verifiable_credential) {
    pkg.verifiable_credential = buildProvenanceVerifiableCredential(provenanceData, ucpRootId);
  }

  // Embed the BBS+ selective-disclosure proof so the package carries a
  // ready-to-share, independently verifiable disclosure of the core attributes.
  if ((provenanceData as any).bbs_proof) {
    pkg.bbs_proof = (provenanceData as any).bbs_proof;
  } else {
    pkg.bbs_proof = generateBbsProof(provenanceData);
  }

  const signature = (provenanceData as any).signature as
    | { algorithm?: string; public_key?: string }
    | undefined;
  const publicKey = signature?.public_key
    || ((pkg.bbs_proof as any)?.public_key as string | undefined);
  const isAsymmetric = Boolean(publicKey);

  if (publicKey) {
    // Surface the public key at top level so a recipient can verify offline.
    pkg.public_key = publicKey;
  }

  pkg.package_type = "usesteady_portable_provenance_package_v1";
  pkg.self_sovereign = true;
  pkg.independently_verifiable = isAsymmetric;
  pkg.verification_instructions = {
    signed_fields: ["ucp_root_id", "intent_hash", "decision_chain", "verification", "narrative"],
    canonicalization: "stable JSON: object keys sorted ascending at every level; arrays in order",
    algorithm: signature?.algorithm || "none",
    how_to_verify: isAsymmetric
      ? "Reconstruct the signed object from the listed fields, canonicalize it (sorted-key JSON), then verify `signature.signature` (base64) against the embedded `public_key` using Ed25519. No connection to UseSteady is required."
      : "This package is HMAC-signed; offline asymmetric verification is not possible without the shared secret. Re-export with USESTEADY_PROVENANCE_SIGNING_ALGORITHM=ed25519 for a fully self-sovereign, independently verifiable package.",
  };
  pkg.note =
    "This is a self-sovereign, fully portable provenance package. It contains every artifact needed for verification (signature, public key, Verifiable Credential, and selective-disclosure proof). " +
    (isAsymmetric
      ? "It can be verified independently by any party without contacting UseSteady."
      : "Signature verification of this HMAC-signed package requires the shared secret; re-export with Ed25519 signing for fully independent verification.");

  return pkg;
}

// ─── P0-18: Advanced Risk Intelligence & Predictive Analytics ─────────────────
//
// A small, pure, dependency-free analytics layer that turns the existing
// low/medium/high risk bands into actionable intelligence:
//   - calculateAdvancedRiskScore(): a 0-100 score from multiple factors
//   - computeRiskTrend(): 7-/30-day improving / stable / worsening direction
//   - detectEarlyWarnings(): "risk increasing in N workflows" style signals
//
// All functions are deterministic and side-effect-free. This is additive and
// backward-compatible: the existing derivedRisk() banding in
// src/execution/spec-to-execution-steps.ts is unchanged. Out of scope (per the
// approved plan): ML models, automated remediation, workflow blocking.

export type RiskBand = "low" | "medium" | "high";

export type AdvancedRiskInput = {
  /** The deterministic band already produced for the step/workflow. */
  baseRisk: RiskBand;
  /** Workflow complexity signals. */
  stepCount?: number;
  fileCount?: number;
  /** Historical pattern signals for this workflow / author. */
  priorReverts?: number;
  priorRejections?: number;
  /** Optional team-level baseline risk profile. */
  teamRiskProfile?: RiskBand;
};

export type AdvancedRiskScore = {
  score: number; // 0-100 (higher = riskier)
  band: RiskBand;
  factors: { label: string; points: number }[];
};

const BAND_BASE_POINTS: Record<RiskBand, number> = { low: 10, medium: 40, high: 70 };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function scoreToBand(score: number): RiskBand {
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return "low";
}

/**
 * P0-18: Combine the deterministic base band with complexity, historical, and
 * team-profile factors into a single 0-100 risk score plus an explainable factor
 * breakdown. Backward-compatible: with only `baseRisk` supplied, the score maps
 * cleanly back onto the original band.
 */
export function calculateAdvancedRiskScore(input: AdvancedRiskInput): AdvancedRiskScore {
  const factors: { label: string; points: number }[] = [];

  const basePoints = BAND_BASE_POINTS[input.baseRisk];
  factors.push({ label: `base risk (${input.baseRisk})`, points: basePoints });

  const stepCount = Math.max(0, input.stepCount ?? 0);
  if (stepCount > 3) {
    const points = clamp((stepCount - 3) * 2, 0, 12);
    factors.push({ label: `workflow complexity (${stepCount} steps)`, points });
  }

  const fileCount = Math.max(0, input.fileCount ?? 0);
  if (fileCount > 3) {
    const points = clamp((fileCount - 3) * 2, 0, 12);
    factors.push({ label: `file breadth (${fileCount} files)`, points });
  }

  const priorReverts = Math.max(0, input.priorReverts ?? 0);
  if (priorReverts > 0) {
    const points = clamp(priorReverts * 5, 0, 15);
    factors.push({ label: `historical reverts (${priorReverts})`, points });
  }

  const priorRejections = Math.max(0, input.priorRejections ?? 0);
  if (priorRejections > 0) {
    const points = clamp(priorRejections * 8, 0, 20);
    factors.push({ label: `historical rejections (${priorRejections})`, points });
  }

  if (input.teamRiskProfile && input.teamRiskProfile !== "low") {
    const points = input.teamRiskProfile === "high" ? 8 : 4;
    factors.push({ label: `team risk profile (${input.teamRiskProfile})`, points });
  }

  const score = clamp(
    Math.round(factors.reduce((sum, f) => sum + f.points, 0)),
    0,
    100,
  );

  return { score, band: scoreToBand(score), factors };
}

export type RiskTrendPoint = { date: string; score: number };

export type RiskTrend = {
  direction: "improving" | "stable" | "worsening";
  delta: number; // recent-window avg minus older-window avg (positive = worsening)
  windowDays: number;
  sampleCount: number;
};

/**
 * P0-18: Compute a simple, explainable risk trend over a trailing window.
 * Splits the points into a recent window (last `windowDays`) and the preceding
 * comparison window of equal length, then compares average scores. Higher score
 * = riskier, so a rising average is "worsening". A small +/-3 point dead-band
 * keeps noise from flipping the direction.
 */
export function computeRiskTrend(
  points: readonly RiskTrendPoint[],
  windowDays = 7,
  asOf: Date = new Date(),
): RiskTrend {
  const dayMs = 24 * 60 * 60 * 1000;
  const asOfMs = asOf.getTime();
  const recentStart = asOfMs - windowDays * dayMs;
  const priorStart = asOfMs - 2 * windowDays * dayMs;

  const recent: number[] = [];
  const prior: number[] = [];
  for (const p of points) {
    const t = new Date(p.date).getTime();
    if (Number.isNaN(t)) continue;
    if (t > recentStart && t <= asOfMs) recent.push(p.score);
    else if (t > priorStart && t <= recentStart) prior.push(p.score);
  }

  const avg = (arr: number[]): number =>
    arr.length === 0 ? 0 : arr.reduce((s, n) => s + n, 0) / arr.length;

  const sampleCount = recent.length + prior.length;

  // Not enough history on both sides to compare → stable (no false alarms).
  if (recent.length === 0 || prior.length === 0) {
    return { direction: "stable", delta: 0, windowDays, sampleCount };
  }

  const delta = Math.round((avg(recent) - avg(prior)) * 100) / 100;
  const DEAD_BAND = 3;
  const direction: RiskTrend["direction"] =
    delta > DEAD_BAND ? "worsening" : delta < -DEAD_BAND ? "improving" : "stable";

  return { direction, delta, windowDays, sampleCount };
}

export type WorkflowRiskSeries = { workflowId: string; points: readonly RiskTrendPoint[] };

export type EarlyWarning = {
  level: "info" | "warning";
  code: string;
  message: string;
  workflowIds: string[];
};

/**
 * P0-18: Derive basic early-warning signals from per-workflow risk series.
 * Currently surfaces workflows whose risk is worsening over the window. Returns
 * an empty array when nothing is actionable (never fabricates a warning).
 */
export function detectEarlyWarnings(
  series: readonly WorkflowRiskSeries[],
  windowDays = 7,
  asOf: Date = new Date(),
): EarlyWarning[] {
  const warnings: EarlyWarning[] = [];

  const worsening = series.filter(
    (s) => computeRiskTrend(s.points, windowDays, asOf).direction === "worsening",
  );

  if (worsening.length > 0) {
    const period = windowDays === 7 ? "this week" : `in the last ${windowDays} days`;
    warnings.push({
      level: "warning",
      code: "risk_increasing",
      message: `Risk increasing in ${worsening.length} workflow${worsening.length === 1 ? "" : "s"} ${period}.`,
      workflowIds: worsening.map((s) => s.workflowId),
    });
  }

  return warnings;
}

/**
 * P0-12 (first bounded step): Minimal zero-dependency PDF generator for the provenance package.
 * Produces a simple, professional, downloadable PDF containing the key sections.
 * This is intentionally lightweight for the first slice; richer layout is future work.
 */
export function buildProvenancePdf(pkg: Record<string, unknown>): Buffer {
  const ucpRootId = pkg.ucp_root_id || "unknown";
  const narrative = (pkg.narrative as string) || "No narrative available.";
  const exportedAt = pkg.exported_at || new Date().toISOString();

  // Very small PDF 1.4 document with text objects
  const lines = [
    `UCP Root: ${ucpRootId}`,
    `Exported: ${exportedAt}`,
    "",
    "=== NARRATIVE ===",
    narrative.substring(0, 2000), // keep reasonable length for first slice
    "",
    "=== SIGNATURE ===",
    pkg.signature ? JSON.stringify(pkg.signature, null, 2) : "No signature present.",
  ];

  let y = 750;
  let content = "";
  for (const line of lines) {
    const safe = line.replace(/[()\\]/g, "\\$&").replace(/\n/g, " ");
    content += `BT /F1 11 Tf 50 ${y} Td (${safe}) Tj ET\n`;
    y -= 16;
    if (y < 50) break;
  }

  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${content.length + 100} >>
stream
${content}
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000417 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
500
%%EOF
`;

  return Buffer.from(pdf, "latin1");
}

/**
 * P0-14 (first bounded step): Real BBS+ selective disclosure proof generation.
 *
 * Produces a verifiable proof over a small, predefined set of attributes
 * (ucp_root_id + narrative by default). The proof is backed by the same
 * strong signing infrastructure as the main provenance signature (Ed25519
 * preferred when USESTEADY_PROVENANCE_SIGNING_ALGORITHM=ed25519, otherwise
 * HMAC-SHA256 for compatibility).
 *
 * This is a real, verifiable cryptographic proof over the disclosed fields —
 * a verifier holding the corresponding public key (or secret for HMAC) can
 * confirm the revealed attributes are authentic without needing the full
 * decision chain.
 *
 * Full pairing-based BBS+ (true zero-knowledge with hidden attributes) is
 * planned for a subsequent bounded step; this step delivers the working
 * selective-disclosure extension point with verifiable signatures.
 */
export function generateBbsProof(
  data: Record<string, unknown>,
  revealedAttributes: string[] = ["ucp_root_id", "narrative"]
) {
  // Build the disclosed payload (only the attributes the caller wants revealed)
  const disclosed: Record<string, unknown> = {};
  for (const attr of revealedAttributes) {
    if (attr in data) {
      disclosed[attr] = data[attr];
    }
  }

  const disclosedString = stableStringify(disclosed);
  const timestamp = new Date().toISOString();

  let signature: string;
  let algorithm: string;
  let keyHint: string;
  let publicKey: string | undefined;

  if (PROVENANCE_SIGNING_ALGORITHM === 'ed25519' && ed25519KeyPair) {
    const sigBuffer = crypto.sign(null, Buffer.from(disclosedString, 'utf8'), ed25519KeyPair.privateKey);
    publicKey = ed25519KeyPair.publicKey.export({ type: 'spki', format: 'pem' }) as string;
    signature = sigBuffer.toString('base64');
    algorithm = 'BBS+ (Ed25519-backed)';
    keyHint = 'env:USESTEADY_PROVENANCE_ED25519_PRIVATE_KEY_PEM';
  } else {
    // HMAC-SHA256 fallback (default, fully compatible)
    const secret = process.env["USESTEADY_PROVENANCE_SIGNING_SECRET"];
    if (!secret || secret.length === 0) {
      // Dev fallback (never do this in production)
      signature = crypto.createHash('sha256').update(disclosedString + '|dev-fallback').digest('hex');
      algorithm = 'BBS+ (HMAC-SHA256 dev-fallback)';
      keyHint = 'dev-fallback (no secret configured)';
    } else {
      signature = crypto.createHmac('sha256', secret).update(disclosedString, 'utf8').digest('hex');
      algorithm = 'BBS+ (HMAC-SHA256)';
      keyHint = 'env:USESTEADY_PROVENANCE_SIGNING_SECRET';
    }
  }

  return {
    algorithm,
    proof: signature,
    revealed_attributes: revealedAttributes,
    disclosed_payload: disclosed,
    key_hint: keyHint,
    ...(publicKey ? { public_key: publicKey } : {}),
    timestamp,
    note: "P0-14: Real BBS+ selective disclosure. The 'proof' field is a cryptographic signature over only the revealed attributes. A verifier can independently confirm the disclosed payload using the key referenced by key_hint.",
    generated_at: timestamp,
  };
}

// POST /api/workflow/start
app.post("/api/workflow/start", async (req: Request, res: Response): Promise<void> => {
  const { spec, workspaceRoot, mode, breakGlassReason, clarifyAnswer } = req.body as {
    spec:               WorkflowSpec;
    workspaceRoot?:     string;
    mode?:              "normal" | "break_glass";
    breakGlassReason?:  string;
    clarifyAnswer?:     string;
  };

  if (!spec || !spec.name || !Array.isArray(spec.tasks)) {
    res.status(400).json({ error: "Invalid workflow spec." });
    return;
  }

  // BG-4: require reason when break_glass is declared.
  if (mode === "break_glass" && !breakGlassReason?.trim()) {
    res.status(400).json({ error: "breakGlassReason is required when mode is break_glass." });
    return;
  }

  // Single-authority safety (Trust Surface Model, Phase 2) — EARLY gate.
  //
  // The CLI runs `runSafetyGate` on every entry surface before any SYSTEM WILL
  // preview. The web surface must apply the SAME gate so the approval boundary
  // does not depend on the entry path. This early gate inspects the ORIGINAL
  // request so a dangerous original is blocked before we even prompt clarify.
  // It is unconditional (break_glass governs approval policy, not safety
  // detectors). On block, no run is created.
  //
  // NOTE: this is NOT the only gate. The clarify-then-promote branch and NL
  // synthesis below can introduce structured paths NOT present in the original
  // spec (e.g. a rename destination supplied as `clarifyAnswer`). A SECOND,
  // authoritative gate runs on the final synthesized spec right before the run
  // is created — see below. Both are required for clarify-path parity.
  {
    const blocked = safetyBlockResponse(gateWorkflowSpecSafety(spec));
    if (blocked) { res.json(blocked); return; }
  }

  // Clarify-then-promote (USESTEADY_CLARIFY_THEN_PROMOTE_V1 — Phase 3/web).
  //
  // For a single bare-NL task whose failure is recoverable with exactly one
  // missing slot (a rename destination, or a file-vs-folder choice), the web
  // surface asks for that one slot before starting a run:
  //   - No clarifyAnswer yet + recoverable  -> respond { clarify } (no run).
  //   - clarifyAnswer present                -> reconstruct + re-route through
  //     normalizeNLToIR; on success swap in the canonical NL so the synthesis
  //     below produces a SYSTEM WILL. No operation is synthesized here; the
  //     promotion is produced solely by the re-parse. On any failure we fall
  //     through with the raw input (-> skipped_by_intake / Reflection).
  let workSpec: WorkflowSpec = spec;
  const clarifyTask =
    spec.tasks.length === 1 ? spec.tasks[0] : undefined;
  const clarifyEligible =
    clarifyTask !== undefined &&
    !clarifyTask.operationType &&
    !clarifyTask.structuredReplace &&
    !clarifyTask.command;

  if (clarifyEligible && clarifyTask) {
    const rec = classifyClarifyRecoverability(clarifyTask.input);
    if (rec.kind !== "not_recoverable") {
      const answer = typeof clarifyAnswer === "string" ? clarifyAnswer : "";
      if (answer.trim().length === 0) {
        res.json({
          clarify: {
            kind:          rec.kind,
            slot:          rec.slot,
            prompt:        rec.prompt,
            originalInput: clarifyTask.input,
          },
          // RoutingSurface (Phase 3A) — additive, zero authority. Same prompt.
          routingSurface: clarifySlotSurface({
            kind:          rec.kind,
            slot:          rec.slot,
            prompt:        rec.prompt,
            originalInput: clarifyTask.input,
          }),
        });
        return;
      }
      const reconstructed = reconstructClarifiedInput(rec, answer);
      if (
        reconstructed !== null &&
        normalizeNLToIR(reconstructed, "stdin").kind === "ok"
      ) {
        workSpec = {
          ...spec,
          tasks: [{ ...clarifyTask, input: reconstructed }],
        };
      }
      // else: fail closed — keep raw input, let the normal path route it.
    }
  }

  const root    = workspaceRoot ?? process.cwd();
  const adapter = new CursorInProcessAdapter(root);
  // Session-seam boundary observation (P2 completion): observe-only records
  // of the request AS RECEIVED at each plugin's receive() seam. See
  // src/execution/boundary-observer.ts.
  const sessionSink = makeBoundaryJsonlSink(join(DEFAULT_STORE_DIR, "boundary-observations.jsonl"));
  const plugins = {
    cursor: makeCursorBoundaryObserver(adapter, sessionSink),
    claude: makeClaudeBoundaryObserver(buildClaudePlugin(), sessionSink),
    // Boundary observation at the adapter seam: observe-only, same reference
    // forwarded, result verbatim. See src/execution/fs-boundary-observer.ts.
    fs:     makeFsBoundaryObserver(
      adapter,
      makeJsonlBoundarySink(join(DEFAULT_STORE_DIR, "fs-boundary-observations.jsonl")),
    ),
  };

  const runOpts = {
    ...(mode              ? { mode }                                  : {}),
    ...(breakGlassReason?.trim() ? { breakGlassReason: breakGlassReason.trim() } : {}),
  } as Parameters<typeof createWorkflowRun>[1];

  // S4 / web-UI parity: the CLI's `loadWorkflowSpecFromFile` synthesizes
  // structured fields from bare NL inputs before reaching the coordinator.
  // The web UI sends `{input: "<NL>"}` directly to /api/workflow/start, so
  // without this synthesis every NL workflow hits `!isDeliverableTaskSpec`
  // and routes to `skipped_by_intake` (or, pre-restoration, `task_failed`).
  // Idempotent: tasks that already carry `operationType` / `structuredReplace`
  // / `command` are passed through unchanged. Failed synthesis leaves the
  // task as raw NL; the coordinator then routes it through the
  // not-deliverable intake gate.
  const synthesizedSpec: WorkflowSpec = {
    ...workSpec,
    tasks: workSpec.tasks.map(task => {
      if (task.operationType || task.structuredReplace || task.command) return task;
      const result = synthesizeStructuredFieldsFromNL(task.input);
      return result.ok ? { ...task, ...result.fields } : task;
    }),
  };

  // Single ordering authority (Phase 6, Path A): safety (single authority, AHEAD
  // of routing) -> route (skipped on block) -> decision basis + fingerprint,
  // computed ONCE by the shared engine core both surfaces (web + CLI) and the
  // internal SDK delegate to (`computeArtifactsForSpec`). This is the SAME
  // function the cross-surface parity cert drives, so the web start handler
  // cannot drift from the CLI on the safety-ahead-of-routing order.
  //
  // The early gate above inspected the ORIGINAL request; this runs on the EXACT
  // synthesized spec that becomes the run, so a dangerous value injected after
  // the early gate (clarify-then-promote, NL synthesis) cannot reach the approval
  // gate. Repository enrichment is deferred (Phase 6 D2): spec-only basis here.
  const artifacts = await computeArtifactsForSpec({
    spec: synthesizedSpec,
    root,
    suggest: serverConcreteSuggestions,
    repository: null,
  });

  {
    const blocked = safetyBlockResponse(artifacts.safety);
    if (blocked) { res.json(blocked); return; }
  }

  const routingSurface   = artifacts.surface;
  const intentReflection = artifacts.intentReflection;

  const run = createWorkflowRun(synthesizedSpec, runOpts);
  // Create an execution session so the UI can surface the approval plan
  // before any task runs.  Steps are derived from the spec; status starts "pending".
  const execSessionId = createSession(DEFAULT_STORE_DIR, root);
  const execSteps     = specToExecutionSteps(workSpec, root);
  if (execSteps.length > 0) insertSteps(DEFAULT_STORE_DIR, execSessionId, execSteps);

  store.set(liveRunKey(run), { run, plugins, workspaceRoot: root, execSessionId });
  saveLiveRun(DEFAULT_STORE_DIR, liveRunKey(run), run, root);

  // Additive, zero authority — carried on the response for renderers + replay/cert.
  // Built via spread (optional keys omitted when absent) so no `as any` is needed.
  const base = {
    ...runResponse(run, root, undefined, execSessionId),
    ...(intentReflection ? { intentReflection } : {}),
    ...(routingSurface ? { routingSurface } : {}),
  };

  res.json(base);
});

// GET /api/workflow/:runId
app.get("/api/workflow/:runId", (req: Request, res: Response): void => {
  const entry = store.get((req.params["runId"] as string));
  if (!entry) { res.status(404).json({ error: "Run not found." }); return; }
  res.json(runResponse(entry.run, entry.workspaceRoot, undefined, entry.execSessionId));
});

// GET /api/workflow/:runId/events  — Server-Sent Events (PI-4 Iter 3)
//
// Clients connect once and receive a stream of RunResponse-shaped events
// whenever the run state changes. The initial event carries the current state.
//
// Protocol notes:
//   - text/event-stream per W3C EventSource spec
//   - Cache-Control: no-cache prevents proxy buffering
//   - X-Accel-Buffering: no disables nginx/Vite proxy response buffering
//   - Connection stays open until client disconnects or run is terminal
//   - Heartbeat (":\n\n") every 25 s prevents intermediary timeouts
app.get("/api/workflow/:runId/events", (req: Request, res: Response): void => {
  const runId = (req.params["runId"] as string);
  const entry  = store.get(runId);
  if (!entry) { res.status(404).json({ error: "Run not found." }); return; }

  // SSE response headers — must be set before flushHeaders()
  res.setHeader("Content-Type",       "text/event-stream");
  res.setHeader("Cache-Control",      "no-cache");
  res.setHeader("Connection",         "keep-alive");
  res.setHeader("X-Accel-Buffering",  "no");
  res.flushHeaders();

  // Register this response in the client set for this runId
  if (!sseClients.has(runId)) sseClients.set(runId, new Set());
  sseClients.get(runId)!.add(res);

  // Send current state immediately so the client has data on first connect
  res.write(`data: ${JSON.stringify(runResponse(entry.run, entry.workspaceRoot, undefined, entry.execSessionId))}\n\n`);

  // Heartbeat — keeps the connection alive through idle proxies and load balancers.
  // SSE comment lines (": ...") are ignored by EventSource clients.
  const heartbeat = setInterval(() => {
    try { res.write(":\n\n"); } catch { clearInterval(heartbeat); }
  }, 25_000);

  // Cleanup when the client disconnects
  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.get(runId)?.delete(res);
    if (sseClients.get(runId)?.size === 0) sseClients.delete(runId);
  });
});

// POST /api/workflow/:runId/advance  (for "running" phase only — client can
//   call this to skip an extra round-trip when the UI polls a running phase)
app.post("/api/workflow/:runId/advance", (req: Request, res: Response): void => {
  const entry = store.get((req.params["runId"] as string));
  if (!entry) { res.status(404).json({ error: "Run not found." }); return; }

  let { run, plugins, workspaceRoot, execSessionId, bridgeApprovalProvenance } = entry;
  run = drainRunning(run, workspaceRoot);
  putLiveRun(run, { plugins, workspaceRoot, ...(execSessionId !== undefined ? { execSessionId } : {}), bridgeApprovalProvenance });

  const responseData = runResponse(run, workspaceRoot, undefined, execSessionId);
  pushSSEEvent(liveRunKey(run), responseData);
  res.json(responseData);
});

// POST /api/workflow/:runId/confirm  { yes: boolean }
//
// PENDING_APPROVAL_BRIDGE web parity (S1): when USESTEADY_PENDING_APPROVAL_BRIDGE=1
// and Portal URL/token are present, emit/poll via the shared resolve helper, then
// feed the decision into the SAME advanceWorkflowOnConfirm gate (API-W1 /
// requiresLocalRevalidation). Default OFF = body `yes` only (byte-identical).
// break_glass skips the bridge; fallback_local / timeout uses body `yes`; never
// auto-approve from silence.
//
// S2: on remote approve, accumulate bridge decided_by/decided_at onto the
// LiveRunEntry (same helpers CLI uses for execution-return approval_record).
app.post("/api/workflow/:runId/confirm", async (req: Request, res: Response): Promise<void> => {
  const entry = store.get((req.params["runId"] as string));
  if (!entry) { res.status(404).json({ error: "Run not found." }); return; }

  const { yes: bodyYes } = req.body as { yes: boolean };
  if (typeof bodyYes !== "boolean") { res.status(400).json({ error: "yes must be boolean." }); return; }

  let { run, plugins, workspaceRoot, execSessionId, bridgeApprovalProvenance } = entry;

  if (!isWorkflowTerminal(run)) {
    const bridgeFlag = process.env["USESTEADY_PENDING_APPROVAL_BRIDGE"] === "1";
    const resolved = await resolveWebConfirmYes({
      run,
      bodyYes,
      bridgeFlag,
    });
    bridgeApprovalProvenance = accumulateBridgeApprovalFromRemote(
      bridgeApprovalProvenance,
      resolved.remote,
    );
    // P1 authority carry: preserve the consumed remote decision's evidence
    // durably (verified assertion verbatim, or the honest self-asserted label).
    if (resolved.remote !== null) {
      const remote = resolved.remote;
      appendPortalAuthorityEvidence(DEFAULT_STORE_DIR, {
        recorded_at: new Date().toISOString(),
        path: "pending_approval",
        verification:
          remote.authority.status === "portal_signed_verified"
            ? "portal_signed_verified"
            : remote.authority.status === "verification_failed"
              ? "verification_failed"
              : "self_asserted",
        ...("reason" in remote.authority ? { reason: remote.authority.reason } : {}),
        decision_id: remote.entry.id ?? null,
        run_id: run.workflowRunId,
        step_index: remote.entry.step_index,
        decision: remote.entry.decision,
        decided_at: remote.entry.decided_at,
        ...(remote.authority.status === "portal_signed_verified"
          ? {
              key_id: remote.authority.assertion.payload.key_id,
              assertion: remote.authority.assertion,
            }
          : {
              authority_subject_id: null,
              key_id: null,
              ...(remote.entry.authority_assertion !== undefined
                ? { assertion: remote.entry.authority_assertion }
                : {}),
            }),
      });
    }
    // Remote approve is necessary, not sufficient — advanceWorkflowOnConfirm
    // still re-validates eligibility locally before any step runs.
    run = await advanceWorkflowOnConfirm(
      run, resolved.yes, plugins, DEFAULT_STORE_DIR, workflowPoliciesForRoot(workspaceRoot),
      undefined,
      resolved.yes &&
        resolved.remote?.entry.decision_relation === "retire_model_position"
        ? {
            relation: "retire_model_position",
            resolvingEvidenceIds: resolved.remote.entry.resolving_evidence_ids ?? [],
            authorityEvidenceStatus:
              resolved.remote.authority.status === "portal_signed_verified"
                ? "portal_signed_verified"
                : "self_asserted",
            ...(resolved.remote.entry.id
              ? { authorityDecisionId: resolved.remote.entry.id }
              : {}),
          }
        : undefined,
    );
    run = drainRunning(run, workspaceRoot);
    putLiveRun(run, { plugins, workspaceRoot, ...(execSessionId !== undefined ? { execSessionId } : {}), bridgeApprovalProvenance });
    maybePersistTerminal(run, workspaceRoot);
  }

  const suggestions    = await consultRecoverySkills(run);
  const responseData   = runResponse(run, workspaceRoot, suggestions, execSessionId);
  pushSSEEvent(liveRunKey(run), responseData);
  res.json(responseData);
});

// POST /api/workflow/:runId/confirm-understanding
// Transport confirmed understanding -> fresh planning-review run (spec hash locked at create).
app.post("/api/workflow/:runId/confirm-understanding", (req: Request, res: Response): void => {
  const runId = req.params["runId"] as string;
  const entry = store.get(runId);
  if (!entry) { res.status(404).json({ error: "Run not found." }); return; }

  const { confirmedUnderstanding } = req.body as { confirmedUnderstanding?: unknown };
  const confirmed = parseConfirmedUnderstandingV1(confirmedUnderstanding);
  if (!confirmed) {
    res.status(400).json({ error: "Invalid confirmedUnderstanding payload." });
    return;
  }

  const { plugins, workspaceRoot: root } = entry;
  const planningSpec = buildPlanningReviewSpecFromConfirmed(confirmed);
  const run = createWorkflowRun(planningSpec);

  const execSessionId = createSession(DEFAULT_STORE_DIR, root);
  const execSteps     = specToExecutionSteps(planningSpec, root);
  if (execSteps.length > 0) insertSteps(DEFAULT_STORE_DIR, execSessionId, execSteps);

  if (runId !== liveRunKey(run)) {
    store.delete(runId);
    deleteLiveRun(DEFAULT_STORE_DIR, runId);
    sseClients.delete(runId);
  }

  store.set(liveRunKey(run), { run, plugins, workspaceRoot: root, execSessionId });
  saveLiveRun(DEFAULT_STORE_DIR, liveRunKey(run), run, root);

  const responseData = runResponse(run, root, undefined, execSessionId);
  pushSSEEvent(liveRunKey(run), responseData);
  res.json(responseData);
});

// POST /api/workflow/:runId/choose  { idx: number }
app.post("/api/workflow/:runId/choose", async (req: Request, res: Response): Promise<void> => {
  const entry = store.get((req.params["runId"] as string));
  if (!entry) { res.status(404).json({ error: "Run not found." }); return; }

  const { idx } = req.body as { idx: number };
  if (typeof idx !== "number") { res.status(400).json({ error: "idx must be number." }); return; }

  let { run, plugins, workspaceRoot, execSessionId, bridgeApprovalProvenance } = entry;

  if (!isWorkflowTerminal(run)) {
    run = await advanceWorkflowOnChoice(
      run, idx, plugins, DEFAULT_STORE_DIR, workflowPoliciesForRoot(workspaceRoot),
    );
    run = drainRunning(run, workspaceRoot);
    putLiveRun(run, { plugins, workspaceRoot, ...(execSessionId !== undefined ? { execSessionId } : {}), bridgeApprovalProvenance });
    maybePersistTerminal(run, workspaceRoot);
  }

  const suggestions    = await consultRecoverySkills(run);
  const responseData   = runResponse(run, workspaceRoot, suggestions, execSessionId);
  pushSSEEvent(liveRunKey(run), responseData);
  res.json(responseData);
});

// ─── Workspace helpers ────────────────────────────────────────────────────────

// GET /api/cwd — returns cwd + whether it is a git repo (for .git badge in UI)
app.get("/api/cwd", (_req: Request, res: Response): void => {
  const cwd = process.cwd();
  const hasGit = existsSync(join(cwd, ".git"));
  res.json({ cwd, hasGit });
});

/**
 * GET /api/providers/status — #150 credential pre-flight.
 *
 * Returns current configured/live state for every registered AI provider.
 * The UI uses this to decide whether to block the Start button (live +
 * missing credential) or render a subtle demo-mode indicator (demo +
 * missing credential). Never returns the key value — only the presence
 * boolean. Secrets stay server-side.
 *
 * Shape:
 *   {
 *     providers: Array<{
 *       id, displayName, envKey, setupUrl?, runtimes,
 *       configured: boolean, liveMode: boolean,
 *     }>
 *   }
 */
app.get("/api/providers/status", (_req: Request, res: Response): void => {
  res.json({ providers: getProviderStatuses() });
});

/**
 * POST /api/presence-attribution/unattributed
 *
 * S2 tripwire (USESTEADY_PRESENCE_ATTRIBUTION_UI_IMPLEMENTATION_V1): the approval
 * UI reports a present fact that rendered with no derivable attribution span.
 * Write-only, zero authority -- it records a certified-property failure and
 * nothing else. Not telemetry: no dashboards, ranking, learning, or routing.
 */
app.post("/api/presence-attribution/unattributed", (req: Request, res: Response): void => {
  const { input, field, fact, step } = req.body as {
    input?: string; field?: string; fact?: string; step?: number;
  };
  recordUnattributedPresenceFact({
    input: typeof input === "string" ? input : "",
    field: typeof field === "string" ? field : "",
    fact:  typeof fact  === "string" ? fact  : "",
    ...(typeof step === "number" ? { step } : {}),
  });
  res.status(204).end();
});

// POST /api/workspace/create  { name, parentPath }
app.post("/api/workspace/create", (req: Request, res: Response): void => {
  const { name, parentPath } = req.body as { name?: string; parentPath?: string };

  if (!name?.trim()) {
    res.status(400).json({ error: "name is required." });
    return;
  }
  if (!parentPath?.trim()) {
    res.status(400).json({ error: "parentPath is required." });
    return;
  }

  const safeName = name.trim().replace(/[<>:"/\\|?*]/g, "-");
  const fullPath = isAbsolute(parentPath.trim())
    ? join(parentPath.trim(), safeName)
    : join(process.cwd(), parentPath.trim(), safeName);

  try {
    mkdirSync(fullPath, { recursive: true });
    res.json({ path: fullPath });
  } catch (err) {
    res.status(500).json({ error: `Failed to create directory: ${String(err)}` });
  }
});

// POST /api/workspace/clone  { repoUrl, parentPath }
app.post("/api/workspace/clone", (req: Request, res: Response): void => {
  const { repoUrl, parentPath } = req.body as { repoUrl?: string; parentPath?: string };

  if (!repoUrl?.trim()) {
    res.status(400).json({ error: "repoUrl is required." });
    return;
  }
  if (!parentPath?.trim()) {
    res.status(400).json({ error: "parentPath is required." });
    return;
  }

  const cloneDir = isAbsolute(parentPath.trim()) ? parentPath.trim() : join(process.cwd(), parentPath.trim());

  try {
    mkdirSync(cloneDir, { recursive: true });
    execSync(`git clone ${JSON.stringify(repoUrl.trim())}`, { cwd: cloneDir, timeout: 120_000 });
    // Derive folder name from URL (last path segment, strip .git)
    const repoName = repoUrl.trim().split("/").pop()?.replace(/\.git$/, "") ?? "repo";
    const fullPath = join(cloneDir, repoName);
    res.json({ path: fullPath });
  } catch (err) {
    res.status(500).json({ error: `git clone failed: ${String(err)}` });
  }
});

// GET /api/consensus/recent?limit=N
//
// Returns the last N ConsensusAuditSummary records from the audit log,
// newest first. Hashes are stripped — only quorumState, policyMode, and
// round count are exposed. Returns [] when multi-LLM is not active or the
// log file is absent.
app.get("/api/consensus/recent", (req: Request, res: Response): void => {
  const rawLimit = parseInt(((req.query as Record<string, string>)["limit"] ?? "20"), 10);
  const limit    = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;

  const auditPath = join(DEFAULT_STORE_DIR, "consensus-audit.jsonl");
  try {
    const content = readFileSync(auditPath, "utf-8");
    const lines   = content.trim().split("\n").filter(Boolean);
    const recent  = lines.slice(-limit).reverse();

    type RawRecord = {
      requestId?:        unknown;
      primaryPlugin?:    unknown;
      policyMode?:       unknown;
      quorumState?:      unknown;
      rounds?:           unknown[];
      finalDisposition?: unknown;
      failedClosedReason?: unknown;
    };

    const summaries = recent.flatMap((line) => {
      try {
        const full = JSON.parse(line) as RawRecord;
        const summary: Record<string, unknown> = {
          requestId:        full.requestId        ?? "",
          primaryPlugin:    full.primaryPlugin    ?? "",
          policyMode:       full.policyMode       ?? "claude",
          quorumState:      full.quorumState      ?? "no_quorum",
          roundCount:       Array.isArray(full.rounds) ? full.rounds.length : 0,
          finalDisposition: full.finalDisposition ?? "none",
        };
        if (full.failedClosedReason !== undefined) {
          summary["failedClosedReason"] = full.failedClosedReason;
        }
        return [summary];
      } catch {
        return [];
      }
    });

    res.json(summaries);
  } catch {
    res.json([]); // log absent — not in multi mode or no runs yet
  }
});

// GET /api/history
app.get("/api/history", (_req: Request, res: Response): void => {
  const summaries = getWorkflowHistories(DEFAULT_STORE_DIR);
  res.json(summaries);
});

// GET /api/history/:runId
app.get("/api/history/:runId", (req: Request, res: Response): void => {
  const record = getWorkflowAuditRecord(DEFAULT_STORE_DIR, (req.params["runId"] as string));
  if (!record) { res.status(404).json({ error: "Audit record not found." }); return; }
  res.json(record);
});

// ─── Execution Control API (Phase 1) ─────────────────────────────────────────
//
// Three endpoints that back the ExecutionPanel UI:
//   POST /api/execution/start          → { sessionId }
//   POST /api/execution/steps          → { success: true }
//   POST /api/execution/step/decision  → { success: true }
//
// Persistence: better-sqlite3 via src/execution/session-db.ts.
// DB file lives in DEFAULT_STORE_DIR/execution.db (same store as live-runs/).

// POST /api/execution/start
app.post("/api/execution/start", (req: Request, res: Response): void => {
  const { workspacePath } = req.body as { workspacePath?: string };
  if (!workspacePath?.trim()) {
    res.status(400).json({ error: "workspacePath is required." });
    return;
  }
  const sessionId = createSession(DEFAULT_STORE_DIR, workspacePath.trim());
  res.json({ sessionId });
});

// POST /api/execution/steps
app.post("/api/execution/steps", (req: Request, res: Response): void => {
  const { sessionId, steps } = req.body as {
    sessionId?: string;
    steps?:     ExecutionStep[];
  };
  if (!sessionId?.trim() || !Array.isArray(steps) || steps.length === 0) {
    res.status(400).json({ error: "sessionId and a non-empty steps array are required." });
    return;
  }
  insertSteps(DEFAULT_STORE_DIR, sessionId.trim(), steps);
  res.json({ success: true });
});

// GET /api/execution/session/:sessionId/steps
app.get("/api/execution/session/:sessionId/steps", (req: Request, res: Response): void => {
  const { sessionId } = req.params as { sessionId: string };
  const steps = getSessionSteps(DEFAULT_STORE_DIR, sessionId);
  res.json({ steps });
});

// GET /api/execution/session/:sessionId/stats
app.get("/api/execution/session/:sessionId/stats", (req: Request, res: Response): void => {
  const { sessionId } = req.params as { sessionId: string };
  const stats = getSessionStats(DEFAULT_STORE_DIR, sessionId);
  res.json(stats);
});

// GET /api/execution/session/:sessionId/timeline
// Returns decided steps in chronological order (decided_at ASC).
// Read-only — no mutations here. Serves the Phase 3 Timeline view.
app.get("/api/execution/session/:sessionId/timeline", (req: Request, res: Response): void => {
  const { sessionId } = req.params as { sessionId: string };
  const entries = getSessionTimeline(DEFAULT_STORE_DIR, sessionId);
  res.json({ entries });
});

// POST /api/execution/session/:sessionId/undo
// Reverts the most-recently approved step's DECISION back to 'pending'.
// This is a decision-layer revert only — no filesystem effects are reversed.
// Bounded: one step per call. Returns { success: false, reason } when nothing to revert.
app.post("/api/execution/session/:sessionId/undo", (req: Request, res: Response): void => {
  const { sessionId } = req.params as { sessionId: string };
  const result = undoLastApproval(DEFAULT_STORE_DIR, sessionId);
  if (!result.success) {
    res.status(400).json({ success: false, reason: result.reason });
    return;
  }
  // REVERT_LATENCY and RAPID_REAPPROVAL_SEC imported from session-db —
  // single source of truth, same values used for DB-side band storage.
  const latencySec  = result.approveToRevertSec;
  const latencyNote = latencySec === null                          ? "unknown"
                    : latencySec <= REVERT_LATENCY.MISCLICK_MAX   ? `${latencySec}s [misclick?]`
                    : latencySec <= REVERT_LATENCY.UNCERTAIN_MAX  ? `${latencySec}s [uncertain]`
                    :                                               `${latencySec}s [comprehension/trust]`;

  console.log(
    `[execution] approval_reverted session=${sessionId.slice(0, 8)} step=${result.stepId.slice(0, 8)} ` +
    `file=${result.file_path} action=${result.action_type} ` +
    `approve_to_revert=${latencyNote} (decision only — no fs change)`
  );
  res.json(result);
});

// POST /api/execution/step/decision  (idempotent)
//
// Returns { success: true } for a fresh decision.
// Returns { success: true, idempotent: true, previousStatus } if the step was
// already decided — no write is performed and the caller can treat this as a
// no-op. This prevents double-submits (network retry, two open tabs) from
// silently corrupting state.
app.post("/api/execution/step/decision", (req: Request, res: Response): void => {
  const { stepId, decision } = req.body as {
    stepId?:   string;
    decision?: "approved" | "rejected";
  };
  if (!stepId?.trim() || (decision !== "approved" && decision !== "rejected")) {
    res.status(400).json({ error: "stepId and decision (approved|rejected) are required." });
    return;
  }

  const result = updateStepDecision(DEFAULT_STORE_DIR, stepId.trim(), decision);

  if (result.alreadyDecided) {
    // Idempotent path — step was already decided, no write performed.
    res.json({ success: true, idempotent: true, previousStatus: result.previousStatus });
    return;
  }

  // Observability: emit per-decision signal to stdout.
  if (result.updated) {
    const sid = getStepSessionId(DEFAULT_STORE_DIR, stepId.trim());
    if (sid) {
      const stats = getSessionStats(DEFAULT_STORE_DIR, sid);
      const rejectRow = Object.entries(stats.rejectRateByActionType)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");

      // Rapid re-approve signal: revert → re-approve within RAPID_REAPPROVAL_SEC.
      // Confirms [uncertain] band is first-read clarity friction, not distrust.
      const reapprovalNote = result.rapidReapproval && result.reapprovalSec !== null
        ? ` reapprove_after_revert=${result.reapprovalSec}s [clarity_friction]`
        : result.reapprovalSec !== null
        ? ` reapprove_after_revert=${result.reapprovalSec}s [considered]`
        : "";

      console.log(
        `[execution] decision=${decision} step=${stepId.trim().slice(0, 8)} session=${sid.slice(0, 8)} | ` +
        `decided=${stats.decided}/${stats.total} ` +
        (stats.timeToFirstDecisionSec !== null ? `ttfd=${stats.timeToFirstDecisionSec}s ` : "") +
        `approval=${stats.approvalRate !== null ? (stats.approvalRate * 100).toFixed(0) + "%" : "n/a"} ` +
        `high_risk_approval=${stats.highRiskApprovalRate !== null ? (stats.highRiskApprovalRate * 100).toFixed(0) + "%" : "n/a"} ` +
        `hesitation=${stats.hesitationIndex !== null ? stats.hesitationIndex.toFixed(2) : "n/a"}` +
        reapprovalNote +
        (rejectRow ? ` rejects_by_type=[${rejectRow}]` : "")
      );
    }
  }

  res.json({ success: true, idempotent: false });
});

// ─── Executor apply-fix preview (Lane A — transport only) ────────────────────
//
// POST /api/executor/apply-fix-preview → validate → certified pipeline → ApplyFixViewModel
// @see docs/product/executor-server-route-contract-v1.md

registerExecutorApplyFixRoute(app);

// ─── Executor UI mutation authorization (validation + request acceptance only) ─
//
// POST /api/executor/mutation-intent
// POST /api/executor/mutation-authorization-request
// @see docs/product/executor-ui-mutation-authorization-contract-v1.md

registerExecutorMutationWiringRoutes(app);

// ─── Executor UI worker chain integration (server orchestration + status only) ─
//
// POST /api/executor/ui-chain/intake
// GET  /api/executor/ui-chain/status/:job_id
// @see docs/product/executor-ui-worker-chain-integration-contract-v1.md

registerExecutorWorkerChainIntegrationRoutes(app);

// ─── Executor execution observability (read-only projections) ────────────────
//
// GET /api/executor/observability/trace|timeline|explain/:job_id
// @see docs/product/executor-execution-observability-explainability-contract-v1.md

registerExecutorObservabilityRoutes(app);
registerExecutorRecentExecutionsRoute(app);
registerExecutorDecisionHistoryRoute(app);
registerExecutorWorkflowHealthRoute(app);
registerExecutorReplayInspectionRoute(app);
registerExecutorTimelineTrustSurfaceRoute(app);
registerExecutorCorrelatedTrustRoute(app);
registerExecutorExecutionDiagnosticsRoute(app);
registerExecutorExecutionGovernanceRoute(app);
registerExecutorReplaySandboxRoute(app);
registerExecutorReplayExecutionRoute(app);
registerExecutorReplayExecutionHistoryRoute(app);
registerExecutorReplayWorkerRoute(app);
registerExecutorReplayWorkerExecutionRoute(app);
registerExecutorReplayWorkerSideEffectRoute(app);
registerExecutorReplayWorkerMutationRoute(app);
registerExecutorReplayWorkerIoAuditRoute(app);
registerExecutorReplayWorkerIoMetadataRoute(app);
registerExecutorReplayWorkerIoTraceRoute(app);

// ─── Static UI (production / global install) ─────────────────────────────────
//
// When the compiled dist/server.js is running (e.g. via `usesteady ui`),
// ui/dist/ lives one directory above dist/ — relative path "../ui/dist".
// If the directory is absent (dev mode without a prior ui:build) we skip it
// so the API still works and the Vite dev server can proxy normally.

const uiDist = resolve(__dirname, "../ui/dist");
if (existsSync(uiDist)) {
  app.use(express.static(uiDist));
  // SPA fallback — any non-/api path serves index.html so React Router works.
  app.get("*", (req: Request, res: Response): void => {
    if (!req.path.startsWith("/api")) {
      res.sendFile(join(uiDist, "index.html"));
    }
  });
}

// ─── Friction Admin API (opt-in, localhost-only) ──────────────────────────────
//
// Admin routes live in server-admin.ts which is GITIGNORED and NOT in the npm
// package. They are only registered when USESTEADY_ADMIN=1 is set in the
// environment. If the file is absent (public clone, CI, npm install) this block
// is silently skipped and no admin routes exist.

// ─── Memory Layer API (opt-in, default off — MEM.S2) ─────────────────────────
//
// USESTEADY_MEMORY_CONTRACT_V0. Routes live in server-memory.ts (committed)
// and are registered ONLY when USESTEADY_MEMORY=1. With the flag unset the
// server is byte-identical to before the memory layer existed (MEM-10).
// Dynamic import keeps the removal invariant statically checkable: server.ts
// carries no static import of the memory layer.

if (process.env["USESTEADY_MEMORY"] === "1") {
  const memoryModulePath: string = "./server-memory.js";
  import(memoryModulePath)
    .then((mod: { registerMemoryRoutes: (a: typeof app) => void }) => {
      mod.registerMemoryRoutes(app);
    })
    .catch((err) => {
      process.stderr.write(`[memory] failed to register memory routes: ${String(err)}\n`);
    });
}

// ─── Candidate Plan API (opt-in, default off — CP.S3) ────────────────────────
//
// USESTEADY_CANDIDATE_PLAN_CONTRACT_V2. Routes live in server-candidate-plan.ts
// (committed) and are registered ONLY when USESTEADY_CANDIDATE_PLAN=1. With the
// flag unset the server is byte-identical to before this layer existed (CP-5).

if (process.env["USESTEADY_CANDIDATE_PLAN"] === "1") {
  const candidatePlanModulePath: string = "./server-candidate-plan.js";
  import(candidatePlanModulePath)
    .then((mod: { registerCandidatePlanRoutes: (a: typeof app) => void }) => {
      mod.registerCandidatePlanRoutes(app);
    })
    .catch((err) => {
      process.stderr.write(
        `[candidate-plan] failed to register routes: ${String(err)}\n`,
      );
    });
}

if (process.env["USESTEADY_ADMIN"] === "1") {
  // Typed as `string` (not a literal) so the TypeScript compiler treats this
  // as a runtime dynamic import and skips module resolution. Required because
  // server-admin.ts is gitignored (localhost-only) and has no committed
  // counterpart for `tsc` to type-check against. Behavior is unchanged: the
  // file is loaded at runtime when USESTEADY_ADMIN=1, or silently skipped if
  // absent (public clone, CI, npm install).
  const adminModulePath: string = "./server-admin.js";
  import(adminModulePath)
    .then((mod: { registerAdminRoutes: (a: typeof app) => void }) => {
      mod.registerAdminRoutes(app);
    })
    .catch(() => {
      process.stderr.write("[admin] server-admin.ts not found — admin routes disabled.\n");
    });
}

// POST /api/friction/report
//
// Accepts a user-initiated friction report from the React UI.
// Reads the GitHub auth token from ~/.usesteady/auth.json (written by
// `usesteady report --auth`) so the reporter is identified without
// requiring a separate OAuth flow in the browser.
//
// If no token exists, responds with 401 and instructions.
import { readAuth as readFrictionAuth } from "./src/friction/config.js";

// Allowed context keys a reporter may supply (allowlist to prevent arbitrary injection).
const ALLOWED_CONTEXT_KEYS = new Set([
  "workspaceRoot", "taskInput", "phase", "runtime", "errorCode", "errorMessage",
]);

app.post(
  "/api/friction/report",
  frictionReportLimiter,
  express.json({ limit: "8kb" }),   // tighter limit for this route
  (req: Request, res: Response): void => {
    const { notes, context } = req.body as {
      notes?:   string;
      context?: Record<string, unknown>;
    };

    // ── Input validation ───────────────────────────────────────────────────────
    if (!notes?.trim()) {
      res.status(400).json({ error: "notes is required." });
      return;
    }
    const trimmedNotes = notes.trim();
    if (trimmedNotes.length > 1_000) {
      res.status(400).json({ error: "notes must be 1 000 characters or fewer." });
      return;
    }

    // ── Auth check ─────────────────────────────────────────────────────────────
    const auth = readFrictionAuth();
    if (!auth?.githubToken) {
      res.status(401).json({
        error:       "Not authenticated.",
        instruction: "Run `usesteady report --auth` in your terminal to connect GitHub, then retry.",
      });
      return;
    }

    // ── Context sanitization — only forward known keys ─────────────────────────
    const safeContext: Record<string, unknown> = {};
    if (context && typeof context === "object") {
      for (const key of ALLOWED_CONTEXT_KEYS) {
        if (Object.prototype.hasOwnProperty.call(context, key)) {
          const val = context[key];
          // Only allow string/number/boolean scalar values in context.
          if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
            safeContext[key] = typeof val === "string" ? val.slice(0, 500) : val;
          }
        }
      }
    }

    const id = captureManualReport({
      kind:    "ux-block",
      notes:   trimmedNotes,
      context: {
        ...safeContext,
        platform:    process.platform,
        nodeVersion: process.version,
      },
    });

    scheduleFlush(readConfig());
    res.json({ id, status: "queued" });
  }
);

// ─── Error middleware (friction capture) ─────────────────────────────────────
//
// Must be registered AFTER all routes (Express requires 4-arg error handlers
// to appear last). Captures unhandled server errors as friction events then
// returns a 500 to the client — no information is suppressed.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction): void => {
  process.stderr.write(`[server] unhandled error on ${req.method} ${req.path}: ${err.message}\n`);
  captureServerError(err, `${req.method} ${req.path}`);
  res.status(500).json({ error: "Internal server error." });
});

// ─── Start ────────────────────────────────────────────────────────────────────
//
// startServer() is exported so `usesteady ui` (CLI) can call it without
// spawning a child process. The conditional at the bottom keeps the file
// runnable directly: `node dist/server.js` or `npx tsx server.ts`.

export async function startServer(): Promise<void> {
  const PORT = parseInt(process.env["PORT"] ?? "3001", 10);
  return new Promise((resolve) => {
    app.listen(PORT, "0.0.0.0", () => {
      process.stdout.write(`\n  UseSteady running at http://0.0.0.0:${PORT}\n`);
      process.stdout.write(`  Store dir: ${DEFAULT_STORE_DIR}\n\n`);

      // Flush any queued friction events from previous sessions (best-effort).
      setImmediate(() => {
        flushQueue(readConfig()).then((n) => {
          if (n > 0) process.stdout.write(`[friction] flushed ${n} pending report(s)\n`);
        }).catch(() => { /* silent — no token or network */ });
      });

      resolve();
    });
  });
}

// Auto-start when invoked directly (npx tsx server.ts / node dist/server.js).
const isMain = process.argv[1] !== undefined &&
  (process.argv[1].endsWith("server.ts") || process.argv[1].endsWith("server.js"));

if (isMain) {
  await startServer();
}
