/**
 * Bounded retry ceiling per job kind (INV-QWORK-4).
 */

import type { BackgroundJobKind } from "../jobs/types.js";

export const WORKER_MAX_ATTEMPTS_BY_JOB_KIND: Readonly<Record<BackgroundJobKind, number>> = {
  replay_notify:    3,
  retry_transport:  5,
};
