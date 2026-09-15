/**
 * Router Delivery Bridge (D.S1 - WORK_ITEM_LIFECYCLE_WIRING_V1 Lane D) - frozen
 * wire types.
 *
 * Direction: Core (Runtime) -> Portal. This is the FOURTH Core->Portal
 * side-channel (after the Execution Return, Decision Record, and Candidate
 * Plan bridges). It carries ONE fact: approved work was handed to an executor
 * - run id, executor kind, delivered-at. Persisted separately from the
 * execution result and from every verification read, so the Portal's
 * lifecycle rail can render the `router_delivery` stage from a stored record
 * instead of honest Unavailable.
 *
 * INV-WL-1 (the reason this record exists AS ITS OWN KIND): Router delivery
 * is not verification. No verification claim, chip, or metric may ever derive
 * from this record - it is a delivery fact, not evidence that anything
 * succeeded. The Portal-side store is structurally unreadable by verification
 * projections (proved by a dedicated boundary test in usesteady-ops).
 *
 * INV-DS1-3 (payload minimalism): run id, executor kind, delivered-at - plus
 * transport necessities (schema, hash, provenance links). No ops, no plan, no
 * result, no self-reported success. The Router adds nothing, changes nothing,
 * decides nothing.
 *
 * Contract: this wire shape IS the contract (Core never imports Portal code
 * and vice versa; the Portal mirrors the validator in
 * lib/portal/routerDelivery/validate.ts). Any breaking change requires a new
 * schema id (`usesteady.router-delivery/v2`), never an in-place edit.
 *
 * Hash parity (mirrors INV-DEC-012): `delivery_hash` is sha256 over the
 * canonical serialization of the payload WITHOUT `delivery_hash`, using the
 * SAME stableStringify as src/ucp/hashes.ts. The body is built UNDEFINED-FREE
 * so the Portal's recompute reproduces the digest after the JSON round-trip.
 */

/** Frozen schema discriminator. Literal type - any other value is a bug. */
export const ROUTER_DELIVERY_SCHEMA = "usesteady.router-delivery/v1" as const;

export type RouterDeliveryProvenanceLinks = {
  readonly run_id: string;
  readonly ucp_root_id?: string;
};

/**
 * The frozen `usesteady.router-delivery/v1` wire payload (Core -> Portal).
 * Field names are snake_case to match the wire contract exactly. Optional
 * fields are OMITTED (never set to `undefined`) so the object is
 * undefined-free and the canonical hash survives the JSON round-trip.
 */
export type RouterDeliveryPayloadV1 = {
  readonly schema: typeof ROUTER_DELIVERY_SCHEMA;
  /**
   * The reviewed DRAFT's content-addressed recordId. Single-ratification means
   * one handoff per thread, so this doubles as the idempotency key: a retried
   * ratify (idempotent executor) re-emits the same record_id and the Portal
   * skips it.
   */
  readonly record_id: string;
  /** Wall-clock ISO moment the approved ops were handed to the executor. */
  readonly delivered_at: string;
  /**
   * WHICH executor kind received the work (server-bound backend name, e.g.
   * "fs", "scm-github", "scm-gitlab"). A routing fact, not a result.
   */
  readonly executor_kind: string;
  readonly delivery_hash: string;
  readonly provenance_links: RouterDeliveryProvenanceLinks;
};

/** The payload WITHOUT its `delivery_hash` - the exact object the digest covers. */
export type RouterDeliveryBody = Omit<RouterDeliveryPayloadV1, "delivery_hash">;
