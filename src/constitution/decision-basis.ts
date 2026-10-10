/**
 * Constitution Materialization V1 — Decision Basis assembly.
 *
 * Implements USESTEADY_CONSTITUTION_V1 Article I (the Decision Basis) at the
 * smallest possible scope: assemble a Decision Basis from the final
 * WorkflowSpec.
 *
 * ── What this is ──────────────────────────────────────────────────────────────
 *
 *   The Constitution defines the Decision Basis as the closed set of facts a
 *   decision depends on, organized into EIGHT classes (Article I):
 *
 *     1. Proposal
 *     2. Repository
 *     3. Configuration
 *     4. Policies
 *     5. Dependencies
 *     6. Environment
 *     7. Principal Authority
 *     8. Retrieved Evidence Used
 *
 *   Phase 1 derives the basis from a WorkflowSpec alone. A WorkflowSpec carries
 *   only some of these classes (Proposal fully; Configuration and Policies
 *   partially). The remaining classes are present as explicit `null` slots —
 *   not omitted — so the basis shape is the full eight from day one and future
 *   phases populate the null slots (Repository SHA, Dependencies, Environment,
 *   Principal Authority, Retrieved Evidence) without changing the schema.
 *
 * ── Determinism contract (mirrors src/workflow/spec-hash.ts) ──────────────────
 *
 *   - Field order is fixed by this module, not by object construction order.
 *   - Optional fields normalize to `null` so {} and {x: undefined} are identical.
 *   - Readonly arrays are spread to plain arrays for stable serialization.
 *   - Pure: no I/O, no side effects. (Persistence lives in approval-record.ts.)
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   - NOT a verifier (Article V) — it only assembles the basis the verifier and
 *     the fingerprint read.
 *   - NOT authority — assembling a basis grants nothing; approval is unchanged.
 *   - NOT a redesign of WorkflowSpec — it projects the spec, never mutates it.
 */

import type { WorkflowSpec, WorkflowTaskSpec } from "../workflow/types.js";

// ─── Decision Basis shape (Article I — eight classes) ─────────────────────────

/** Class 1 — Proposal: the change being proposed (zero-authority; generated). */
export type ProposalFact = {
  readonly name: string;
  readonly tasks: readonly CanonicalTaskFact[];
};

export type CanonicalTaskFact = {
  readonly input: string;
  readonly runtime: "cursor" | "claude" | null;
  readonly operationType: string | null;
  readonly targetFiles: readonly string[] | null;
  readonly content: string | null;
  readonly newPath: string | null;
  readonly command: string | null;
  readonly structuredReplace: {
    readonly oldValue: string;
    readonly newValue: string;
    readonly filePath: string;
  } | null;
};

/**
 * Class 2 — Repository: the exact repository state the decision depended on.
 *
 * Materialization increment 1 (the first non-spec Decision Basis fact). This is
 * framed as repository *provenance*, not a bare SHA: the constitutional object
 * is the repository state a decision relied on, and the commit is its primary
 * fingerprint today. Framing it as provenance leaves room for future
 * deterministic facts (worktree, submodule pin) without changing the ontology.
 *
 * It is the first fact a WorkflowSpec structurally cannot carry, so the moment
 * it is non-null the basis fingerprint diverges from the spec hash and begins
 * protecting information the spec hash never could (resolves conformance F-C2).
 *
 * Every field normalizes to `null` when unavailable so a non-git workspace
 * produces a stable, deterministic "unavailable" fact rather than a throw.
 */
export type RepositoryProvenanceFact = {
  /** Remote origin URL when present, else the repository toplevel path. */
  readonly identity: string | null;
  /** HEAD commit SHA. */
  readonly commit: string | null;
  /** Working tree has uncommitted changes (null when undeterminable). */
  readonly dirty: boolean | null;
};

/** Class 3 — Configuration: declared settings the proposal depends on. */
export type ConfigurationFact = {
  readonly defaultRuntime: "cursor" | "claude" | null;
  readonly maxRetries: number | null;
};

/** Class 4 — Policies: the rules the proposal must satisfy. */
export type PoliciesFact = {
  readonly ocdAdditionalProhibitedGlobs: readonly string[] | null;
};

/**
 * The Decision Basis — the closed set of facts (Article I, INV-DB-1).
 *
 * Every class is a named slot. Classes a WorkflowSpec does not carry are `null`
 * in Phase 1 — present, not omitted — so the eight-class shape is stable.
 */
export type DecisionBasis = {
  readonly proposal: ProposalFact;
  readonly repository: RepositoryProvenanceFact | null;
  readonly configuration: ConfigurationFact;
  readonly policies: PoliciesFact;
  readonly dependencies: null;
  readonly environment: null;
  readonly principalAuthority: null;
  readonly retrievedEvidenceUsed: null;
};

// ─── Assembly ─────────────────────────────────────────────────────────────────

function canonicalTaskFact(task: WorkflowTaskSpec): CanonicalTaskFact {
  return {
    input:         task.input,
    runtime:       task.runtime ?? null,
    operationType: task.operationType ?? null,
    targetFiles:   task.targetFiles ? [...task.targetFiles] : null,
    content:       task.content ?? null,
    newPath:       task.newPath ?? null,
    command:       task.command ?? null,
    structuredReplace: task.structuredReplace
      ? {
          oldValue: task.structuredReplace.oldValue,
          newValue: task.structuredReplace.newValue,
          filePath: task.structuredReplace.filePath,
        }
      : null,
  };
}

/**
 * Non-spec facts folded into the Decision Basis at assembly time.
 *
 * These are facts a WorkflowSpec structurally cannot carry. They are injected
 * (not captured here) so this module stays pure: capture lives in
 * repository-provenance.ts, and the coordinator threads the captured fact in.
 * Every member defaults to `null`, so `assembleDecisionBasis(spec)` is
 * byte-identical to the spec-only Phase-1 basis.
 */
export type DecisionBasisFacts = {
  readonly repository?: RepositoryProvenanceFact | null;
};

function normalizeRepository(
  r?: RepositoryProvenanceFact | null,
): RepositoryProvenanceFact | null {
  if (!r) return null;
  return { identity: r.identity ?? null, commit: r.commit ?? null, dirty: r.dirty ?? null };
}

/**
 * Assemble a Decision Basis from the final WorkflowSpec and any injected
 * non-spec facts.
 *
 * Pure projection. The same spec content and the same facts always produce the
 * same basis, independent of object key insertion order. Called with no facts
 * (or all-null facts) it is identical to the Phase-1 spec-only basis.
 *
 * @param spec   The approved WorkflowSpec (the Proposal).
 * @param facts  Optional non-spec facts (e.g. captured Repository provenance).
 * @returns      The eight-class Decision Basis.
 */
export function assembleDecisionBasis(
  spec:   WorkflowSpec,
  facts?: DecisionBasisFacts,
): DecisionBasis {
  return {
    proposal: {
      name:  spec.name,
      tasks: spec.tasks.map(canonicalTaskFact),
    },
    repository: normalizeRepository(facts?.repository),
    configuration: {
      defaultRuntime: spec.defaultRuntime ?? null,
      maxRetries:     spec.maxRetries ?? null,
    },
    policies: {
      ocdAdditionalProhibitedGlobs: spec.ocdOverride
        ? [...spec.ocdOverride.additionalProhibitedGlobs]
        : null,
    },
    dependencies:          null,
    environment:           null,
    principalAuthority:    null,
    retrievedEvidenceUsed: null,
  };
}
