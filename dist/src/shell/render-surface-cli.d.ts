/**
 * renderSurfaceCli — USESTEADY_ROUTING_SURFACE_DESIGN_V1 (Phase 3C).
 *
 * The CLI peer of `ui/src/components/workflow/renderSurfaceWeb.tsx`. Given a
 * RoutingSurface engine object, returns the terminal lines that present it. Both
 * renderers consume the SAME object, so the CLI and web cannot diverge on what a
 * routing outcome means — only on presentation bytes.
 *
 * Zero authority (Invariant 1): this is a pure RoutingSurface -> string[] mapping.
 * It never executes, approves, or gates. Authority stays with Safety / Approval /
 * Decision Basis / Execution gate.
 *
 * Total over SurfaceType: every one of the six variants renders truthful, non-empty
 * content (asserted by scripts/cert-render-surface-cli.ts). The `safety` and
 * `system_will` branches mirror the CLI's existing copy (`[blocked]` block and the
 * `SYSTEM WILL` / `-> headline` approval header) so the eventual entry wiring is
 * behavior-identical.
 */
import type { RoutingSurface } from "../workflow/routing-surface.js";
export declare function renderSurfaceCli(surface: RoutingSurface): readonly string[];
//# sourceMappingURL=render-surface-cli.d.ts.map