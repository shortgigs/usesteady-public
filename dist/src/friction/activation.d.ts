/**
 * src/friction/activation.ts
 *
 * Lightweight activation metric capture for the onboarding funnel.
 *
 * Three events, three numbers:
 *   onboarding_started     → user hit the first screen
 *   example_approved       → user pressed a / Enter on the example
 *   second_prompt_entered  → user typed a real request after onboarding
 *
 * Transport:
 *   1. Local JSONL  — ~/.usesteady/activation.jsonl  (always works, no auth)
 *   2. HTTP POST    — https://usesteady.dev/api/activation (fire-and-forget)
 *
 * Contract:
 *   - Never throws. All errors are silently swallowed.
 *   - Never blocks. All I/O is async and detached from the main path.
 *   - No GitHub token required. No user data. No file paths.
 */
export type ActivationEventName = "onboarding_started" | "example_approved" | "second_prompt_entered";
/**
 * Generate a new onboarding session ID.
 * Call once at the start of runOnboarding() and thread through all events.
 */
export declare function newActivationSession(): string;
/**
 * Capture one activation event.
 *
 * @param event     The event name.
 * @param sessionId UUID from newActivationSession() — links events from one run.
 * @param ms        Milliseconds since onboarding_started (omit for the first event).
 */
export declare function captureActivation(event: ActivationEventName, sessionId: string, ms?: number): void;
//# sourceMappingURL=activation.d.ts.map