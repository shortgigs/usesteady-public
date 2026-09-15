/**
 * WorkflowHeader — top bar for active workflow runs.
 * UI Redesign: workspace chip, break-glass badge with icon, refined layout.
 */

import { Badge }          from "../ui/Badge.js";
import { runPhaseBadge }  from "../../helpers/task-status.js";
import type { WorkflowRun } from "../../api/types.js";

type Props = {
  run: WorkflowRun;
};

export function WorkflowHeader({ run }: Props) {
  const badge = runPhaseBadge(run.phase);

  return (
    <header className="flex items-center justify-between px-5 py-3
                        border-b border-gray-800/60 bg-gray-950 flex-none">
      {/* Left: breadcrumb + name */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-gray-700 text-xs font-mono hidden sm:block flex-none">⚒</span>
        <span className="text-gray-700 hidden sm:block">/</span>
        <span className="font-semibold text-gray-100 truncate text-sm">
          {run.spec.name}
        </span>
      </div>

      {/* Right: workspace chip, break-glass, phase badge */}
      <div className="flex items-center gap-2 flex-none ml-4">
        {run.workspaceRoot && (
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1
                           bg-gray-900 border border-gray-800 rounded-md
                           text-[10px] font-mono text-gray-500 truncate max-w-40">
            <span className="text-gray-700">📁</span>
            {run.workspaceRoot.replace(/\\/g, "/").split("/").at(-1)}
          </span>
        )}
        {run.mode === "break_glass" && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                           bg-amber-950/60 border border-amber-800/50
                           text-[10px] font-semibold text-amber-400 uppercase tracking-wider">
            <span>⚡</span>
            Break-glass
          </span>
        )}
        <Badge label={badge.label} variant={badge.variant} size="md" />
      </div>
    </header>
  );
}
