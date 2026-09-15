/**
 * Constraint loading for ControlEnvelope — Layer 2.
 *
 * Provides:
 *   - FORBIDDEN_RUNTIME_TERMS  — hardcoded set of terms that signal forbidden
 *                                 runtime/shell drift in any phase
 *   - PHASE_CONSTRAINTS        — per-phase constraint list derived from ROADMAP.md
 *   - loadPhaseConstraints()   — returns the active constraints for the current phase
 *   - CURRENT_PHASE            — extracted from ROADMAP.md at module load time
 *
 * V1 design decision: forbidden terms are hardcoded, not parsed from ROADMAP.md.
 * Dynamic roadmap semantic parsing is deferred to a future version.
 * See: docs/control-envelope-v1-spec.md — Deferred items
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Forbidden runtime terms (hardcoded in V1) ────────────────────────────────
//
// These terms, if found in a proposed plan or SYSTEM WILL description, indicate
// that the agent is introducing a forbidden runtime, shell, or architecture that
// violates the current phase constraints.
//
// Case-insensitive matching is applied at detection time.

export const FORBIDDEN_RUNTIME_TERMS = [
  // Desktop runtimes
  "electron",
  "electron-vite",
  "electronvite",
  "tauri",
  // Forge context (unrelated runtime shell in this workspace)
  "forge",
  // Generic forbidden patterns
  "desktop runtime",
  "new shell",
  "new runtime",
  // Electron-specific APIs (if a plan names these, it is introducing Electron)
  "BrowserWindow",
  "ipcMain",
  "ipcRenderer",
  "contextBridge",
  "app.whenReady",
  "webContents",
] as const;

export type ForbiddenRuntimeTerm = (typeof FORBIDDEN_RUNTIME_TERMS)[number];

// ─── Phase constraint definitions ─────────────────────────────────────────────
//
// Each entry maps a phase/iteration label (substring of the ROADMAP.md heading)
// to its active constraints.
//
// The key is matched case-insensitively against the phase name read from ROADMAP.md.
// The first match wins.

const PHASE_CONSTRAINTS: Record<string, string[]> = {
  "PI-1": [
    "use existing UseSteady web stack only",
    "no new runtime shell",
    "no Electron",
    "no Tauri",
    "no Forge context",
    "no AI/Skills wiring",
    "no autonomous execution",
    "workspace entry and basic workflow only",
    "every change must be E2E testable via a single user flow",
  ],
};

// Fallback constraints applied when no phase-specific entry matches.
const DEFAULT_CONSTRAINTS: string[] = [
  "stay within the current roadmap phase",
  "no new runtime shells",
  "no out-of-scope architecture changes",
];

// ─── ROADMAP.md extraction ────────────────────────────────────────────────────

/**
 * Attempt to extract the current PI/Iteration label from ROADMAP.md.
 *
 * Looks for the first line matching: ## PI-<N> — ...
 * Returns the PI label (e.g. "PI-1") or "unknown" if the file cannot be read
 * or no matching line is found.
 *
 * Kept deliberately simple — full semantic parsing is deferred to V2.
 */
export function readCurrentPhaseFromRoadmap(workspaceRoot: string = process.cwd()): string {
  try {
    const roadmapPath = join(workspaceRoot, "ROADMAP.md");
    const content = readFileSync(roadmapPath, "utf-8");

    // Match the first ## PI-N heading.
    const match = content.match(/^##\s+(PI-\d+)/m);
    if (match?.[1]) return match[1];

    return "unknown";
  } catch {
    return "unknown";
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type PhaseConstraints = {
  phase: string;
  active: string[];
  source: "roadmap" | "baseline" | "manual";
};

/**
 * Load the active constraints for the current phase.
 *
 * Phase is determined by reading ROADMAP.md from the workspace root.
 * Constraints are resolved from PHASE_CONSTRAINTS (hardcoded map).
 * Falls back to DEFAULT_CONSTRAINTS when no matching entry exists.
 *
 * @param workspaceRoot - Absolute path to the workspace root. Defaults to cwd.
 */
export function loadPhaseConstraints(workspaceRoot?: string): PhaseConstraints {
  const phase = readCurrentPhaseFromRoadmap(workspaceRoot);

  // Find the first matching entry (case-insensitive key prefix match).
  const matchingKey = Object.keys(PHASE_CONSTRAINTS).find((key) =>
    phase.toLowerCase().startsWith(key.toLowerCase()),
  );

  const active = matchingKey !== undefined
    ? (PHASE_CONSTRAINTS[matchingKey] ?? DEFAULT_CONSTRAINTS)
    : DEFAULT_CONSTRAINTS;

  return {
    phase,
    active,
    source: "roadmap",
  };
}
