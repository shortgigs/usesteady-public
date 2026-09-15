/**
 * Bounded TTL policy per job kind (INV-REXEC-4).
 */

import type { BackgroundJobKind } from "../jobs/types.js";

export const AUTHORITY_TTL_MS_BY_JOB_KIND: Readonly<Record<BackgroundJobKind, number>> = {
  replay_notify:    300_000,
  retry_transport:  600_000,
};
