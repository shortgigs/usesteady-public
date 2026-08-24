/**
 * Bulk data exfiltration detector.
 *
 * Catches inputs that combine:
 *   - a data-movement verb (export, dump, extract, download, send, pull, get)
 *   - with a bulk-scope qualifier (all, every, entire, full)
 *   - with a sensitive target (customer, user, account + emails, passwords,
 *     credentials, data, PII, records)
 *
 * Also catches standalone high-signal credential-dump phrases regardless
 * of the bulk qualifier.
 *
 * Scope: NARROW. Only fires on language that clearly describes bulk exfiltration
 * of sensitive user data. Does not fire on legitimate analytics queries
 * ("pull the conversion funnel") or single-record lookups.
 *
 * Priority: 15 (between destructive_mass_action:10 and credential_or_secret_access:20)
 */
import type { SafetyDetector } from "../types.js";
export declare const bulkDataExfilDetector: SafetyDetector;
//# sourceMappingURL=bulk-data-exfil.detector.d.ts.map