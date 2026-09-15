/**
 * Phase B1: Static workflow templates.
 *
 * These are NOT just time-savers. Each template teaches the UseSteady mental model:
 *   - one clear, isolated change per step
 *   - explicit sequencing rationale
 *   - what "done" looks like for that step
 *
 * Rules:
 *   - Static only. No backend, no network.
 *   - Content is source of truth. Do not auto-generate tasks.
 *   - Templates do not validate execution semantics.
 */

import type { WorkflowTaskSpec } from "../api/types.js";

export type WorkflowTemplate = {
  readonly id:          string;
  readonly label:       string;
  readonly description: string;
  readonly tasks:       readonly (WorkflowTaskSpec & { label?: string })[];
  readonly name:        string;
};

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id:          "safe-refactor",
    label:       "Safe refactor",
    description: "Rename or move code — one isolated change per step",
    name:        "Safe refactor",
    tasks: [
      {
        label:   "Rename the component",
        input:   'Rename component "OldButton" to "Button" in src/components/OldButton.tsx',
        runtime: "cursor",
      },
      {
        label:   "Update all imports",
        input:   'Update all imports referencing "OldButton" to use "Button" across src/',
        runtime: "cursor",
      },
      {
        label:   "Verify no remaining references",
        input:   'Check that no remaining references to "OldButton" exist in src/',
        runtime: "cursor",
      },
    ],
  },
  {
    id:          "config-change",
    label:       "Config change",
    description: "Update a config value with a clear audit trail",
    name:        "Config change",
    tasks: [
      {
        label:   "Locate the config key",
        input:   "Find where FEATURE_FLAG_DARK_MODE is defined in src/config/",
        runtime: "cursor",
      },
      {
        label:   "Update the value",
        input:   "Set FEATURE_FLAG_DARK_MODE to true in src/config/flags.ts",
        runtime: "cursor",
      },
      {
        label:   "Update the corresponding test",
        input:   "Update tests that assert FEATURE_FLAG_DARK_MODE is false to expect true",
        runtime: "cursor",
      },
    ],
  },
  {
    id:          "dependency-update",
    label:       "Dependency update",
    description: "Bump a package version and fix downstream breakage step by step",
    name:        "Dependency update",
    tasks: [
      {
        label:   "Update package version",
        input:   'Update "react" to "^18.3.0" in package.json',
        runtime: "cursor",
      },
      {
        label:   "Fix deprecated API usage",
        input:   "Replace deprecated ReactDOM.render calls with createRoot in src/",
        runtime: "cursor",
      },
      {
        label:   "Update type imports",
        input:   "Update any FC<> or VFC<> type imports to use React.FC in src/",
        runtime: "cursor",
      },
    ],
  },
  {
    id:          "cleanup-pass",
    label:       "Cleanup pass",
    description: "Remove dead code or unused exports in safe, reviewable steps",
    name:        "Cleanup pass",
    tasks: [
      {
        label:   "Remove unused variable",
        input:   "Remove the unused `legacyAdapter` variable from src/adapters/index.ts",
        runtime: "cursor",
      },
      {
        label:   "Remove dead export",
        input:   "Remove the `export { legacyAdapter }` line from src/adapters/index.ts",
        runtime: "cursor",
      },
      {
        label:   "Update barrel file",
        input:   "Remove the legacyAdapter re-export from src/index.ts if it exists",
        runtime: "cursor",
      },
    ],
  },
] as const;
