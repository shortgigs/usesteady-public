import type { CommandEnvelope, UCPRefs } from "../types.js";
export type JsonOpLike = {
    readonly type: "replace" | "rename" | "create" | "delete" | "run" | "append" | "prepend";
    readonly from?: string;
    readonly to?: string;
    readonly file?: string;
};
/**
 * Map a validated JsonOp-like object to a ucp.command.v1 envelope.
 *
 * Shadow-only in this phase: the envelope is persisted for observability/parity
 * while live execution continues through the existing workflow path.
 */
export declare function mapJsonOpToCommandEnvelope(op: JsonOpLike, refs?: UCPRefs): CommandEnvelope;
//# sourceMappingURL=map-json-op-command.d.ts.map