/**
 * usesteady quickstart -- guided first-run onboarding text.
 *
 * Pure module. No I/O, no process.exit, no execution. Importing this
 * module cannot read stdin, write the filesystem, spawn a process, or
 * talk to a model. It exists to render a single-screen orientation that
 * gets a brand-new user from install to first safe workflow in under five
 * minutes.
 *
 * Determinism: the exported function is pure and returns identical bytes
 * across runs for a given build. There is no template interpolation, no
 * environment-dependent text, no clock-based output.
 *
 * Authority:
 *   - This module does not interact with the planner, the safety gate,
 *     the executor, the model-insertion path, or any approval surface.
 *   - Quickstart only PRINTS instructions. It never starts a workflow,
 *     never approves anything, never reads stdin, never writes files.
 *   - Every command suggested in the text goes through the existing
 *     CLI dispatcher; nothing new is granted authority by quickstart.
 *
 * Source of truth:
 *   - For the operation catalog, the text directs the user to
 *     `usesteady capabilities` (src/shell/cli/capabilities.ts).
 *   - For starter workflows, the text directs the user to
 *     `usesteady templates` (src/shell/cli/templates.ts).
 *   - For full CLI usage, the text directs the user to
 *     `usesteady help`.
 *   No content is duplicated; quickstart is a curated entry point, not
 *   a second source of truth.
 *
 * Design: docs/product/useability-and-guided-execution-track.md (Product
 * Capability Track) -- onboarding clarity. Surface added in the first
 * implementation slice of "first successful workflow in under 5 minutes."
 */
/**
 * Render the quickstart guide as a human-readable text block. Bytes are
 * identical across runs for a given build. Always succeeds.
 */
export declare function renderQuickstartText(): string;
//# sourceMappingURL=quickstart.d.ts.map