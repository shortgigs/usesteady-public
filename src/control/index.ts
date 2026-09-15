/**
 * src/control — ControlEnvelope module.
 *
 * Meta-governance layer for agent build requests.
 * Prevents runtime/architecture drift before any file is written.
 *
 * Public API surface (V1):
 *
 *   Types:
 *     ControlEnvelope          — the primary contract type
 *     CompileInput             — input to compileControlEnvelope()
 *     DriftScanResult          — result of drift detection
 *     PhaseConstraints         — active constraints for the current phase
 *     ForbiddenRuntimeTerm     — union of all forbidden term literals
 *
 *   Compiler:
 *     compileControlEnvelope() — assemble the envelope from all five layers
 *     formatControlEnvelope()  — render the SYSTEM WILL display block
 *
 *   Drift detection:
 *     detectForbiddenTerms()            — scan any text
 *     detectForbiddenTermsInPlan()      — scan summary + files arrays
 *     detectForbiddenTermsInRequest()   — scan raw request text
 *     FORBIDDEN_RUNTIME_TERMS           — the hardcoded forbidden term set
 *
 *   Constraints:
 *     loadPhaseConstraints()            — load active phase constraints
 *     readCurrentPhaseFromRoadmap()     — extract phase label from ROADMAP.md
 *
 *   Narrowing helpers:
 *     isBlocked()       — true if envelope must not proceed
 *     isApproved()      — true if approved by human
 *     isPending()       — true if awaiting approval
 *     hasDriftConflict() — true if drift was detected
 */

export type {
  ControlEnvelope,
} from "./types.js";

export {
  isBlocked,
  isApproved,
  isPending,
  hasDriftConflict,
} from "./types.js";

export type {
  CompileInput,
} from "./compiler.js";

export {
  compileControlEnvelope,
  formatControlEnvelope,
} from "./compiler.js";

export type {
  DriftScanResult,
} from "./drift-detector.js";

export {
  detectForbiddenTerms,
  detectForbiddenTermsInPlan,
  detectForbiddenTermsInRequest,
  toDriftField,
} from "./drift-detector.js";

export type {
  PhaseConstraints,
  ForbiddenRuntimeTerm,
} from "./constraints.js";

export {
  FORBIDDEN_RUNTIME_TERMS,
  loadPhaseConstraints,
  readCurrentPhaseFromRoadmap,
} from "./constraints.js";
