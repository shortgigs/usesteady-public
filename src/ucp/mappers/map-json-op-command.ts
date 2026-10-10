import { createCommandEnvelope } from "../envelope.js";
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
export function mapJsonOpToCommandEnvelope(
  op: JsonOpLike,
  refs?: UCPRefs,
): CommandEnvelope {
  return createCommandEnvelope(
    {
      kind: op.type,
      ...(op.from !== undefined ? { from: op.from } : {}),
      ...(op.to !== undefined ? { to: op.to } : {}),
      ...(op.file !== undefined ? { file: op.file } : {}),
    },
    refs,
  );
}

