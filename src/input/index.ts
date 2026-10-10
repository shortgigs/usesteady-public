/**
 * Public surface of the canonical input pipeline.
 *
 * Milestones (per docs/CLI_INPUT_NORMALIZATION_DESIGN.md and epic #218):
 *
 *   - M1: OperationRegistry           — landed in #220.
 *   - M2: IR + JSON/batch adapter     — landed with --json + batch wired,
 *                                       NL parser untouched.
 *   - M3: FeasibilityValidator        — pending.
 *   - M4: InputNormalizer (NL)        — pending.
 *   - M5: SessionController           — pending.
 *
 * Each milestone is its own behavior-scoped PR.
 */

// M1 — Operation registry.
export {
  type OperationType,
  type OperationSchema,
  OPERATION_REGISTRY,
  ALL_OPERATION_TYPES,
  getOperationSchema,
  isKnownOperationType,
  listOperationSummaries,
} from "./op-registry.js";

// M2 — IR contract.
export {
  type Operation,
  type ReplaceOccurrence,
  type IR,
  type IRSource,
  type IRSourceSurface,
} from "./ir.js";

// M2 — JSON / batch adapter.
export {
  type JsonToIRResult,
  jsonOpToIROperation,
  buildIRFromJsonOps,
} from "./json-to-ir.js";

// M2 — transitional IR → DraftTask shim (deleted in M6).
export { irOperationToJsonDraftTask } from "./ir-to-draft.js";

// M3 — CliError discriminated union (forward-declares input/normalize/execute
// variants so M4/M5 do not need to widen the type later; only the validate
// variant is constructed in M3).
export {
  type CliError,
  type CliErrorCode,
  type CliErrorStage,
  type ValidateError,
  type ExecuteError,
  type NormalizeError,
  type InputError,
} from "./cli-error.js";

// M3 — FeasibilityValidator (path-level checks; no file-content reads).
export {
  type ValidatorContext,
  type ValidatorFs,
  validateOperation,
  validateIR,
} from "./feasibility-validator.js";

export {
  resolveEffectiveResource,
  applyEffectivePathsToTaskSpec,
  bindEffectiveFsChange,
  bindReplaceChange,
  fsChangeMissingRequiredReceiver,
  checkEffectiveResourceForOp,
  checkApprovedEffectiveCorrespondence,
  checkEffectReceiverIdentity,
  EFFECTIVE_RESOURCE_UNRESOLVED_MSG,
  EFFECTIVE_RESOURCE_CHANGED_MSG,
  EFFECTIVE_RESOURCE_RECEIVER_REQUIRED_MSG,
} from "./effective-resource.js";

// M4 — NL InputNormalizer (new module; legacy parsers remain as spare wheels
// per design §6.6.1 rule 1 until M6).
export {
  type NLSurface,
  type NLToIRResult,
  normalizeNLToIR,
  detectDuplicatePromptFlag,
} from "./nl-to-ir.js";
