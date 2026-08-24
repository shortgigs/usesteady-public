/**
 * Safety detector registry.
 *
 * Detectors are sorted by priority ascending (lower number = runs first).
 * The gate iterates in priority order and returns the first blocking match.
 */
import { destructiveDetector } from "./detectors/destructive.detector.js";
import { bulkDataExfilDetector } from "./detectors/bulk-data-exfil.detector.js";
import { secretAccessDetector } from "./detectors/secret-access.detector.js";
import { evasionDetector } from "./detectors/evasion.detector.js";
import { arbitraryExecDetector } from "./detectors/arbitrary-exec.detector.js";
const REGISTERED_DETECTORS = [
    destructiveDetector, // priority 10
    bulkDataExfilDetector, // priority 15
    secretAccessDetector, // priority 20
    evasionDetector,
    arbitraryExecDetector,
].sort((a, b) => a.priority - b.priority);
export function getSafetyDetectors() {
    return REGISTERED_DETECTORS;
}
//# sourceMappingURL=registry.js.map