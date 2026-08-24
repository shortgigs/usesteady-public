import { createCommandEnvelope } from "../envelope.js";
/**
 * Map a validated JsonOp-like object to a ucp.command.v1 envelope.
 *
 * Shadow-only in this phase: the envelope is persisted for observability/parity
 * while live execution continues through the existing workflow path.
 */
export function mapJsonOpToCommandEnvelope(op, refs) {
    return createCommandEnvelope({
        kind: op.type,
        ...(op.from !== undefined ? { from: op.from } : {}),
        ...(op.to !== undefined ? { to: op.to } : {}),
        ...(op.file !== undefined ? { file: op.file } : {}),
    }, refs);
}
//# sourceMappingURL=map-json-op-command.js.map