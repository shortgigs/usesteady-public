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

export type SafetyVerdict = "allow" | "block";

export type SafetyReason =
  | "destructive_mass_action"
  | "bulk_data_exfiltration"
  | "credential_or_secret_access"
  | "evasion_or_rule_bypass"
  | "arbitrary_script_execution";

export type SafetyResult = {
  readonly verdict: SafetyVerdict;
  readonly reason?: SafetyReason;
  readonly detectorId?: string;
  readonly matchedPattern?: string;
  readonly note?: string;
};

/**
 * A SafetyDetector examines an input string and returns a blocking SafetyResult
 * if it detects a pattern it covers, or null if the input is outside its scope.
 *
 * Detectors set `matchedPattern` on their results.
 * The gate injects `detectorId` from `detector.id` — detectors do not self-report their id.
 */
export type SafetyDetector = {
  readonly id: string;
  readonly priority: number;
  supports(input: string): boolean;
  detect(input: string): SafetyResult | null;
};
