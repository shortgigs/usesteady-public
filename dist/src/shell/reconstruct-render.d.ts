/**
 * Reconstruct shell rendering — pure text + JSON projection.
 * No I/O. No store reads. No authority.
 */
import type { ReconstructReport } from "./cli/reconstruct.js";
export declare function renderReconstructHelpText(): string;
export declare function renderReconstructJson(report: ReconstructReport): string;
export declare function renderReconstructText(report: ReconstructReport): string;
//# sourceMappingURL=reconstruct-render.d.ts.map