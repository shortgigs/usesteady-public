/**
 * RoutingSurface — USESTEADY_ROUTING_SURFACE_DESIGN_V1 (Trust Surface Model, Phase 3A).
 *
 * The pre-execution routing outcome as a typed, plain, serializable engine
 * object. It answers ONE question: "What is the truthful way to present this
 * request before execution?"
 *
 * Binding invariants (see docs/product/USESTEADY_ROUTING_SURFACE_DESIGN_V1.md):
 *   1. Zero authority. A RoutingSurface describes; it never decides. The shape
 *      `if (surface.type === "system_will") execute()` is forbidden. Authority
 *      stays where frozen: Safety, Approval, Decision Basis, Execution gate.
 *   2. Serializable + replayable. Every variant is plain JSON — no closures,
 *      class instances, or renderer objects. `isSerializableSurface(s)` must hold.
 *   3. Additive migration. Carried additively on RunResponse; ShellFrame and
 *      existing RunResponse fields stay behavior-identical and are DERIVED from
 *      the surface (Phase 3B/3C). No frozen contract breaks.
 *   4. Not a constitutional object. Lives in src/workflow/, beside WorkflowSpec
 *      and ClarifyCommitment. NEVER in src/constitution/.
 *
 * This is NOT the post-execution "Trust Surface" in src/executor/observability/.
 * That answers "what actually happened after execution"; this answers "how to
 * truthfully present this request before execution". The umbrella name is the
 * "Trust Surface Model"; this concrete engine type is `RoutingSurface`.
 */

import type { FsChange }          from "../understand/interpretation/types.js";
import type { WorkPlan }          from "./work-plan-types.js";
import type { ClarifyCommitment } from "./clarify-surface.js";
import type { SafetyReason }      from "../safety/types.js";

// ─── SurfaceType (six mutually-exclusive routing outcomes) ────────────────────

export type SurfaceType =
  | "system_will"
  | "system_suggests"
  | "reflection"
  | "clarify"
  | "work_plan"
  | "safety";

// ─── Variant payloads ─────────────────────────────────────────────────────────

/**
 * A concrete diff preview for an existing will. Never a standalone routing
 * outcome (Q2) — only ever carried on WillSurface.preview.
 */
export type SurfaceDiffHunk = {
  readonly kind: "added" | "removed" | "context";
  readonly line: string;
};

export type SurfaceDiff = {
  readonly filePath: string;
  readonly hunks: readonly SurfaceDiffHunk[];
};

/**
 * The deterministic operation that WILL run after approval. The `headline` is
 * computed in the engine (Q4) so every renderer shows identical wording.
 *
 * `FsChange` already covers the seven filesystem/command primitives
 * (create_dir, write_file, append_file, prepend_file, rename, delete_file,
 * run_command). The `replace` variant is the only structured op not modelled by
 * `FsChange` (it is carried as `structuredReplace` on the task spec).
 */
export type WillOperation =
  | FsChange
  | {
      readonly operationType: "replace";
      readonly filePath: string;
      readonly oldValue: string;
      readonly newValue: string;
    };

export type WillSurface = {
  readonly type: "system_will";
  readonly operation: WillOperation;
  readonly headline: string;
  readonly preview?: SurfaceDiff;
};

/** Concrete zero-authority alternatives (one-click adopt). */
export type SuggestSurfaceItem = {
  readonly input: string;
  readonly reason: string;
};

export type SuggestSurface = {
  readonly type: "system_suggests";
  readonly suggestions: readonly SuggestSurfaceItem[];
};

/** Could-not-make-a-concrete-proposal understanding artifact. */
export type ReflectionSurface = {
  readonly type: "reflection";
  readonly classification:
    | "initiative"
    | "capability"
    | "program"
    | "refactor"
    | "structure"
    | "primitive"
    | "unknown";
  readonly summary:         string;
  readonly keyPoints:       readonly string[];
  readonly nextStep:        string;
  readonly originalRequest: string;
};

/**
 * Exactly one missing input. clarify is ONE SurfaceType with a `mode` sub-union
 * (Q1): slot-fill (CLARIFY_THEN_PROMOTE) and commitment (ClarifyCommitment) are
 * both "one missing input re-enters understanding"; renderers branch on `mode`.
 */
export type ClarifySlotFill = {
  readonly mode: "slot_fill";
  readonly kind: "missing_destination" | "ambiguous_type";
  readonly slot: "destination" | "file_or_folder";
  readonly prompt: string;
  readonly originalInput: string;
};

export type ClarifyCommitmentMode = {
  readonly mode: "commitment";
  readonly commitment: ClarifyCommitment;
  readonly originalInput: string;
};

export type ClarifySurface = {
  readonly type: "clarify";
  readonly clarify: ClarifySlotFill | ClarifyCommitmentMode;
};

/** Pre-execution work plan artifact (zero authority). */
export type WorkPlanSurface = {
  readonly type: "work_plan";
  readonly workPlan: WorkPlan;
};

/** Single-authority safety block (Phase 2). */
export type SafetySurface = {
  readonly type: "safety";
  readonly reason: SafetyReason | "blocked";
  readonly note: string;
  readonly blockedInput: string;
  readonly matchedPattern?: string;
  readonly detectorId?: string;
};

// ─── The union ────────────────────────────────────────────────────────────────

export type RoutingSurface =
  | WillSurface
  | SuggestSurface
  | ReflectionSurface
  | ClarifySurface
  | WorkPlanSurface
  | SafetySurface;

// ─── Constructors (normalize to plain, serializable values) ──────────────────

/**
 * Drop `undefined`-valued keys so optional fields round-trip through JSON
 * cleanly (JSON.stringify omits them; an explicit `key: undefined` would break
 * structural equality after a round-trip). Used by constructors that carry
 * optional fields.
 */
function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export function willSurface(args: {
  operation: WillOperation;
  headline: string;
  preview?: SurfaceDiff | undefined;
}): WillSurface {
  return omitUndefined({
    type: "system_will",
    operation: args.operation,
    headline: args.headline,
    preview: args.preview,
  }) as WillSurface;
}

export function suggestSurface(
  suggestions: readonly SuggestSurfaceItem[],
): SuggestSurface {
  return { type: "system_suggests", suggestions };
}

export function reflectionSurface(
  args: Omit<ReflectionSurface, "type">,
): ReflectionSurface {
  return { type: "reflection", ...args };
}

export function clarifySurface(
  clarify: ClarifySlotFill | ClarifyCommitmentMode,
): ClarifySurface {
  return { type: "clarify", clarify };
}

export function workPlanSurface(workPlan: WorkPlan): WorkPlanSurface {
  return { type: "work_plan", workPlan };
}

export function safetySurface(args: {
  reason: SafetyReason | "blocked";
  note: string;
  blockedInput: string;
  matchedPattern?: string | undefined;
  detectorId?: string | undefined;
}): SafetySurface {
  return omitUndefined({
    type: "safety",
    reason: args.reason,
    note: args.note,
    blockedInput: args.blockedInput,
    matchedPattern: args.matchedPattern,
    detectorId: args.detectorId,
  }) as SafetySurface;
}

// ─── Serializability + replay (Invariant 2) ──────────────────────────────────

/**
 * Structural-equality check after a JSON round-trip. A RoutingSurface is valid
 * iff it survives `JSON.parse(JSON.stringify(s))` unchanged. This is the
 * machine-checkable form of Invariant 2 (serializable + replayable).
 */
export function isSerializableSurface(surface: RoutingSurface): boolean {
  let json: string;
  try {
    json = JSON.stringify(surface);
  } catch {
    return false;
  }
  return deepEqual(surface, JSON.parse(json));
}

/** Parse a previously-serialized RoutingSurface for replay/certification. */
export function parseRoutingSurface(json: string): RoutingSurface {
  return JSON.parse(json) as RoutingSurface;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every(k => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
  }
  return false;
}
