/**
 * Execution Return Bridge (EXECUTION_RETURN_BRIDGE_V1) - frozen wire types.
 *
 * Direction: Core -> Portal. These types describe the ONLY interface between the
 * two lanes: the `ucp.execution_return.v1` JSON payload. Core never imports
 * Portal code and Portal never imports Core code; this wire shape is the
 * contract (see docs/product/execution-return-bridge-contract-v1.md).
 *
 * Privacy (INV-ERB-P2): there is deliberately NO field for file contents or
 * diffs. The type system itself prevents content from ever being placed on the
 * wire - only resource paths + change-types + counts exist here.
 *
 * Evolution: additive only (new OPTIONAL fields). Any breaking change requires a
 * new schema id `ucp.execution_return.v2` and a v2 contract - never an in-place
 * edit of these types.
 */
/** Frozen schema discriminator. Literal type - any other value is a bug. */
export const EXECUTION_RETURN_SCHEMA = "ucp.execution_return.v1";
/**
 * Recommended cap on `affected_resources` entries (contract "Bounds & rules").
 * When a run touches more than this, the payload carries the first N and sets
 * `affected_resources_truncated: true` with the true count in
 * `affected_resources_total`.
 */
export const AFFECTED_RESOURCES_LIMIT = 200;
//# sourceMappingURL=types.js.map