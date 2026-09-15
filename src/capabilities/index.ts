export type {
  ExecutionCapabilityId,
  ResolutionBlocked,
  ResolveCapabilityBindingResult,
  RuntimeCapabilityBinding,
  RuntimeCapabilityResolution,
} from "./types.js";

export {
  RUNTIME_CAPABILITY_BINDINGS_V1,
  isKnownExecutionCapabilityId,
} from "./runtime-bindings.js";

export {
  resolveCapabilityBinding,
  resolutionFingerprint,
  type ResolveCapabilityBindingOptions,
} from "./runtime-resolver.js";

export type {
  CapabilityEligibilityInput,
  CapabilityEligibilityLineageEntry,
  CapabilityEligibilityRecord,
  CapabilityEligibilityState,
} from "./eligibility/index.js";

export {
  CAPABILITY_ELIGIBILITY_TTL_MS,
  eligibilityRecordId,
  eligibilityOutcomeFingerprint,
  evaluateCapabilityEligibility,
  isCapabilityEligibilityExpired,
} from "./eligibility/index.js";
