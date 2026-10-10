/**
 * Claude Execution — Phase 8C public API.
 *
 * Consumer pattern:
 *   const prep = prepareClaudeExecution(intake, intentId, responseId, policy, toolPolicy);
 *   // show prep to H; H may accept conflicts or reject
 *   const approved = approveClaudeArtifact(prep.artifact, Date.now());
 *   const result = await deliverClaudeExecution(approved, plugin, storeDir);
 *   // route on result.kind
 */

export type {
  ClaudePreparationResult,
  ClaudePreparationDisplay,
  ClaudeExecutionResult,
  ClaudeExecutionDisplay,
} from "./claude-execution-coordinator.js";

export {
  prepareClaudeExecution,
  deliverClaudeExecution,
} from "./claude-execution-coordinator.js";
