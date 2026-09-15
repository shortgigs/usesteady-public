/**
 * Change Interpretation types.
 *
 * ── Scope (v1) ────────────────────────────────────────────────────────────────
 *   1. Tailwind / CSS color changes
 *   2. Text literal changes (button labels, headings, UI copy)
 *   3. Simple config value changes (port, URL, boolean, key-value)
 *
 * ── Role of interpretation ────────────────────────────────────────────────────
 *   Interpretation is ADVISORY.
 *   It does not change the execute/guide/refuse decision — that is locked
 *   before interpretation runs.
 *   It describes WHAT the human will experience from the change, not WHETHER
 *   the change is allowed.
 *
 * ── ParsedChange ──────────────────────────────────────────────────────────────
 *   All interpretation operates on a parsed representation of a structured
 *   change command (replace "X" with "Y" in file, or patch file search="X" replace="Y").
 *   Interpretation returns null for any input that cannot be parsed into this form.
 *
 * ── InterpretationRule ────────────────────────────────────────────────────────
 *   Registry-driven, priority-ordered, deterministic.
 *   Same shape as Safety and Completion rules — ownership, priority, traceability.
 */

export type InterpretationCategory =
  | "tailwind_color_change"
  | "css_color_change"
  | "text_literal_change"
  | "config_value_change";

export type InterpretationResult = {
  readonly summary: string;
  readonly impact: readonly string[];
  readonly confidence: "high" | "medium" | "low";
  readonly category: InterpretationCategory;
};

/**
 * Parsed representation of a text replacement command.
 * Both `replace "X" with "Y" in <file>` and `patch <file> search="X" replace="Y"`
 * reduce to this shape.
 */
export type ReplaceChange = {
  readonly oldValue: string;
  readonly newValue: string;
  readonly filePath?: string;
  readonly approvedEffective?: ApprovedEffectiveBind;
};

/**
 * Filesystem operation — deterministic primitives that bypass the intake pipeline.
 *
 * These are explicit operations with no ambiguity — the user states exactly what
 * to do. They do not go through safety/completeness intake; they go straight to
 * human approval and then execution.
 */
/**
 * P-F01 — identity stamped at bind/preview, compared at execute.
 * `rel` is what SYSTEM WILL names. `abs` is the receiver that must
 * still resolve at effect time. The supplied path on the op is what
 * execute re-resolves; it is not rewritten to `rel`.
 */
export type ApprovedEffectiveBind = {
  readonly abs: string;
  readonly rel: string;
  /** Serializable OS object identity captured before approval; never refreshed at delivery. */
  readonly receiver?: ApprovedReceiverIdentity;
};

export type ApprovedReceiverIdentity =
  | { readonly kind: "absent" }
  | {
      readonly kind: "file" | "directory";
      readonly dev: string;
      readonly ino: string;
      readonly birthtimeNs: string;
    };

/**
 * P-EFFECT-RESULT — create payload stamped at bind/preview.
 * `utf8` is the authorized bytes SYSTEM WILL disclosed. Execute writes
 * this payload and requires the resulting file to contain exactly these
 * bytes. Distinct from ADV-V2-037 (input → proposal loss).
 */
export type ApprovedContentBind = {
  readonly utf8: string;
};

export type FsChange =
  | { readonly operationType: "create_dir";  readonly dirPath: string; readonly approvedEffective?: ApprovedEffectiveBind }
  | { readonly operationType: "write_file";  readonly filePath: string; readonly content: string; readonly approvedEffective?: ApprovedEffectiveBind; readonly approvedContent?: ApprovedContentBind }
  | { readonly operationType: "append_file"; readonly filePath: string; readonly content: string; readonly approvedEffective?: ApprovedEffectiveBind }
  | { readonly operationType: "prepend_file"; readonly filePath: string; readonly content: string; readonly approvedEffective?: ApprovedEffectiveBind }
  | { readonly operationType: "rename";      readonly filePath: string; readonly newPath: string; readonly approvedEffectiveFrom?: ApprovedEffectiveBind; readonly approvedEffectiveTo?: ApprovedEffectiveBind }
  | { readonly operationType: "delete_file"; readonly filePath: string; readonly approvedEffective?: ApprovedEffectiveBind }
  | { readonly operationType: "run_command"; readonly command: string };

/**
 * Parsed representation of any structured command — replacement or filesystem op.
 */
export type ParsedChange = ReplaceChange | FsChange;

/** Type guard: true when pc is a filesystem operation (not a text replacement). */
export function isFsChange(pc: ParsedChange): pc is FsChange {
  return "operationType" in pc;
}

/**
 * An InterpretationRule classifies a ReplaceChange into a category and produces
 * a human-readable description.
 *
 * Rules MUST:
 *   - Be deterministic (same parsed input → same output)
 *   - Return null if the change is outside their scope
 *   - Never infer intent beyond what the old/new values demonstrate
 *
 * Priority: lower number = runs first.
 *
 * Note: rules only apply to ReplaceChange. FsChange operations have no
 * interpretation rules — their intent is fully explicit in the operation type.
 */
export type InterpretationRule = {
  readonly id: string;
  readonly priority: number;
  matches(parsed: ReplaceChange): boolean;
  interpret(parsed: ReplaceChange): InterpretationResult | null;
};
