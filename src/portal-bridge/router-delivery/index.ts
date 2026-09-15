/**
 * Router Delivery Bridge (D.S1 - WORK_ITEM_LIFECYCLE_WIRING_V1 Lane D) - public
 * surface.
 *
 * Core (Runtime) -> Portal side-channel that emits ONE delivery fact - run id,
 * executor kind, delivered-at - as the `usesteady.router-delivery/v1` wire
 * payload at the Router's delivery moment (an approved decision being handed
 * to the server-bound executor), so the Portal lifecycle rail's
 * `router_delivery` stage renders from a stored record. Delivery is not
 * verification (INV-WL-1); DEFAULT OFF; never-throws (INV-DS1-2).
 */

export {
  ROUTER_DELIVERY_SCHEMA,
  type RouterDeliveryPayloadV1,
  type RouterDeliveryBody,
  type RouterDeliveryProvenanceLinks,
} from "./types.js";
export {
  routerDeliveryFromHandoff,
  attachDeliveryHash,
  validateRouterDeliveryPayload,
  type RouterDeliveryHandoff,
  type RouterDeliveryLinks,
  type PayloadValidation,
} from "./build-payload.js";
export {
  resolveRouterDeliveryReporting,
  normalizeRouterDeliveriesBaseUrl,
  ROUTER_DELIVERIES_TOGGLE_ENV,
  ROUTER_DELIVERIES_URL_ENV,
  PORTAL_TOKEN_ENV,
  type RouterDeliveryReportingConfig,
  type RouterDeliveryReportingDisabledReason,
} from "./opt-in.js";
export { sendRouterDelivery, type SendResult, type SendOptions } from "./transport.js";
export {
  reportRouterDeliveryToPortal,
  type ReportRouterDeliveryResult,
  type ReportRouterDeliveryOptions,
} from "./report-delivery.js";
