/**
 * renderSurfaceWeb — USESTEADY_ROUTING_SURFACE_DESIGN_V1 (Phase 3B).
 *
 * The web renderer's dispatch over the RoutingSurface engine object. Given a
 * RoutingSurface, returns the web frame that presents it — making the web a
 * function of the engine object rather than of ad-hoc response fields.
 *
 * Scope (Phase 3B): owns the PRE-EXECUTION, run-less routing surfaces that have
 * standalone frame components — `safety` and `clarify`. Returns `null` for:
 *   - `system_will` / `system_suggests` — these ARE the run: ShellFrame +
 *     WorkflowFramePanel remain authoritative (UI-W1..W7; ShellFrame
 *     behavior-identical). The dispatcher does not reinterpret execution display.
 *   - `reflection` — page-owned (ConfirmUnderstandingGate + the confirm-gate
 *     state and SSE-strip ref capture live in WorkflowPage). Left as-is to keep
 *     behavior identical.
 *   - `work_plan` — not emitted on the start path today.
 *
 * Zero authority: this only selects a renderer; it never executes, approves, or
 * gates. Authority stays with Safety / Approval / Decision Basis / Execution gate.
 */

import type { ReactNode } from "react";
import type { RoutingSurface } from "../../api/types.js";
import { SafetyBlockFrame } from "../frames/SafetyBlockFrame.js";
import { ClarifyFrame } from "../frames/ClarifyFrame.js";

export type SurfaceHandlers = {
  /** Answer a slot-fill clarify prompt (re-submits start with the answer). */
  readonly onClarifyAnswer: (answer: string) => void;
  /** Dismiss the current surface back to the idle entry screen. */
  readonly onCancel: () => void;
};

/**
 * Returns the web frame for a routing-outcome surface, or null when the surface
 * is owned by the run flow (ShellFrame) or the page (reflection). A null return
 * means "this dispatcher does not render this surface — fall through to the run
 * flow / page-owned rendering".
 */
export function renderSurfaceWeb(
  surface: RoutingSurface,
  handlers: SurfaceHandlers,
): ReactNode | null {
  switch (surface.type) {
    case "safety":
      return (
        <SafetyBlockFrame
          block={{
            reason: surface.reason,
            note: surface.note,
            blockedInput: surface.blockedInput,
            ...(surface.matchedPattern !== undefined ? { matchedPattern: surface.matchedPattern } : {}),
            ...(surface.detectorId !== undefined ? { detectorId: surface.detectorId } : {}),
          }}
          onCancel={handlers.onCancel}
        />
      );

    case "clarify":
      // Only slot_fill clarify has a web frame today; commitment-mode clarify
      // (business-intent pre-commitment) is not surfaced on the web entry path.
      if (surface.clarify.mode === "slot_fill") {
        return (
          <ClarifyFrame
            prompt={{
              kind: surface.clarify.kind,
              slot: surface.clarify.slot,
              prompt: surface.clarify.prompt,
              originalInput: surface.clarify.originalInput,
            }}
            onAnswer={handlers.onClarifyAnswer}
            onCancel={handlers.onCancel}
          />
        );
      }
      return null;

    // Run-flow- or page-owned surfaces — not rendered by this dispatcher.
    case "system_will":
    case "system_suggests":
    case "reflection":
    case "work_plan":
    default:
      return null;
  }
}
