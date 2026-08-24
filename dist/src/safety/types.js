/**
 * Safety Gate types.
 *
 * SafetyResult now carries inspection fields so callers can determine
 * exactly which detector fired and which input phrase triggered it —
 * without needing to re-run detectors or read source code.
 *
 * Fields:
 *   detectorId      — id of the detector that produced this result (injected by gate)
 *   matchedPattern  — human-readable label of the specific phrase that matched
 *   note            — plain-English explanation of why this is blocked
 */
export {};
//# sourceMappingURL=types.js.map