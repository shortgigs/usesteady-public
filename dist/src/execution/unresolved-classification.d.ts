import type { WorkflowTaskSpec } from "../workflow/types.js";
export type UnresolvedIntentCategory = "missing_target" | "missing_content" | "missing_command" | "ambiguous_operation";
export declare function classifyUnresolvedIntent(_spec: WorkflowTaskSpec, reason: string): UnresolvedIntentCategory;
export declare function unresolvedReasonMessage(category: UnresolvedIntentCategory): string;
//# sourceMappingURL=unresolved-classification.d.ts.map