/**
 * Cursor Stub Adapter — in-process transport adapter for testing and development.
 *
 * ── Role ───────────────────────────────────────────────────────────────────────
 *
 *   The stub adapter is the first concrete implementation of CursorEditorPlugin.
 *   It is also the proof that the mechanism-agnostic contract works — the same
 *   delivery gate operates identically whether the plugin returns a response
 *   immediately (stub) or asynchronously (real Cursor IPC/plugin).
 *
 * ── Transport proof ────────────────────────────────────────────────────────────
 *
 *   CursorStubAdapter proves all three delivery paths:
 *     - accepted:                   stub returns CursorAccepted
 *     - refused_due_to_scope:       stub returns CursorRefusedDueToScope
 *     - refused_due_to_execution_error: stub returns CursorRefusedDueToExecutionError
 *
 *   The gate does not change behavior based on which adapter is used.
 *   The stub is the simplest valid adapter — a configured response, returned immediately.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────────
 *
 *   In tests:
 *     const plugin  = CursorStubAdapter.accepted();
 *     const gate    = new CursorDeliveryGate(plugin, storeDir);
 *     const result  = await gate.deliver(approvedArtifact);
 *     expect(result.outcome).toBe("accepted");
 *
 *   For a configurable sequence of responses (e.g., scope refusal then accept):
 *     const plugin = CursorStubAdapter.sequence([
 *       CursorStubAdapter.scopeRefusal({ questionKind: "need_file_path", ... }),
 *       CursorStubAdapter.acceptedResponse(),
 *     ]);
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   This is not a fake Cursor. It does not apply edits, read files, or produce
 *   real diffs. It is purely for proving that the delivery gate contract is
 *   exercised correctly.
 *
 *   For a real Cursor adapter, implement CursorEditorPlugin with your transport
 *   of choice (function call, IPC, file drop). The delivery gate does not change.
 *
 * See: docs/cursor-delivery-contract.md — mechanism selection rationale
 *      src/cursor/delivery-gate.ts — CursorEditorPlugin interface
 */

import type { CursorEditorPlugin } from "../delivery-gate.js";
import type { CursorDeliveryRequest } from "../types.js";
import type {
  CursorResponse,
  CursorAccepted,
  CursorRefusedDueToScope,
  CursorRefusedDueToExecutionError,
  CursorScopeQuestion,
  CursorExecutionErrorCode,
} from "../types.js";

// ─── Stub adapter ────────────────────────────────────────────────────────────

/**
 * A configurable in-process CursorEditorPlugin.
 *
 * Configured at construction with a fixed response or a sequence of responses.
 * Returns responses immediately (no async delay).
 */
export class CursorStubAdapter implements CursorEditorPlugin {
  private readonly responses: CursorResponse[];
  private callIndex = 0;

  constructor(responses: CursorResponse[]) {
    if (responses.length === 0) throw new Error("CursorStubAdapter: responses must not be empty");
    this.responses = responses;
  }

  async receive(request: CursorDeliveryRequest): Promise<CursorResponse> {
    const response = this.responses[this.callIndex];
    if (response === undefined) {
      throw new Error(
        `CursorStubAdapter: no response configured for call index ${this.callIndex} (deliveryId=${request.deliveryId})`,
      );
    }
    this.callIndex++;
    return response;
  }

  /** How many times receive() has been called. */
  get callCount(): number { return this.callIndex; }

  // ── Factory methods ────────────────────────────────────────────────────────

  /** Adapter that always returns "accepted". */
  static accepted(overrides?: Partial<CursorAccepted>): CursorStubAdapter {
    return new CursorStubAdapter([CursorStubAdapter.acceptedResponse(overrides)]);
  }

  /** Adapter that returns a scope refusal with the given question. */
  static refusedScope(question: CursorScopeQuestion, overrides?: Partial<CursorRefusedDueToScope>): CursorStubAdapter {
    return new CursorStubAdapter([CursorStubAdapter.scopeRefusalResponse(question, overrides)]);
  }

  /** Adapter that returns an execution error with the given code. */
  static refusedError(errorCode: CursorExecutionErrorCode, detail?: string): CursorStubAdapter {
    return new CursorStubAdapter([CursorStubAdapter.executionErrorResponse(errorCode, detail)]);
  }

  /** Adapter that returns responses in sequence. Throws if exhausted. */
  static sequence(responses: CursorResponse[]): CursorStubAdapter {
    return new CursorStubAdapter(responses);
  }

  // ── Response builders ─────────────────────────────────────────────────────

  static acceptedResponse(overrides?: Partial<CursorAccepted>): CursorAccepted {
    return {
      kind:        "accepted",
      deliveryId:  "stub-delivery-id",
      artifactId:  "stub-artifact-id",
      receivedAt:  Date.now(),
      ...overrides,
    };
  }

  static scopeRefusalResponse(
    question:  CursorScopeQuestion,
    overrides?: Partial<CursorRefusedDueToScope>,
  ): CursorRefusedDueToScope {
    return {
      kind:          "refused_due_to_scope",
      deliveryId:    "stub-delivery-id",
      artifactId:    "stub-artifact-id",
      receivedAt:    Date.now(),
      scopeQuestion: question,
      ...overrides,
    };
  }

  static executionErrorResponse(
    errorCode: CursorExecutionErrorCode,
    detail    = "Stub execution error.",
  ): CursorRefusedDueToExecutionError {
    return {
      kind:       "refused_due_to_execution_error",
      deliveryId: "stub-delivery-id",
      artifactId: "stub-artifact-id",
      receivedAt: Date.now(),
      errorCode,
      detail,
    };
  }
}
