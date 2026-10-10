/**
 * ApprovalFrame — the core of the product.
 *
 * "I clearly see what I asked vs what will happen."
 *
 * UI Redesign:
 *   - "You asked" as a sunken card with cyan left accent — highest visual weight
 *   - "System understood" visually subordinate, italic, no uppercase label
 *   - Execution context as a clean info strip
 *   - Approve & run is the dominant action
 *
 * UI-W5: raw input before interpreted summary.
 * UI-W6: weak interpretation → "This step will run exactly as written."
 * WF-A1: anchored to spec.input.
 * WF-A3: Approve & run ≠ already accepted.
 */

import { useEffect }                    from "react";
import { Card }                         from "../ui/Card.js";
import { Button }                       from "../ui/Button.js";
import { Badge }                        from "../ui/Badge.js";
import type { WorkflowRun, FsChange, WorkflowTaskSpec, FsOpEffectDisclosure } from "../../api/types.js";
import type { FrameViewModel }          from "../../adapters/shell-frame.js";
import { shouldShowInterpretation }     from "../../helpers/interpretation.js";
import { taskDisplayLabel, runtimeBadgeLabel, runtimeDescription } from "../../helpers/task-status.js";
import { describeFsOp, describeNonFsStep, runtimeSystemWill } from "../../helpers/intent.js";
import { DiffView } from "../ui/DiffView.js";
import { newFileHunks } from "../../helpers/diff.js";
import {
  attributionLines,
  presentFactsForFsOp,
  presentFactsForReplace,
  type PresentFact,
} from "../../helpers/attribution.js";
import { reportUnattributedPresenceFact } from "../../api/client.js";

// ─── Presence attribution (S1 display + S2 failure tripwire) ──────────────────
//
// USESTEADY_PRESENCE_ATTRIBUTION_UI_IMPLEMENTATION_V1. Rendering-only, zero
// authority: shows WHY each present fact is present (it traces to the request).
// If a fact has no derivable attribution, it renders neutral "source
// unattributed" and reports the failure to the write-only S2 sink (a certified-
// property tripwire -- not telemetry). No tooltips, no panels, no new gates.

function AttributionBlock({
  facts,
  rawInput,
  stepIndex,
}: {
  facts:     readonly PresentFact[];
  rawInput:  string;
  stepIndex?: number;
}) {
  const lines = attributionLines(facts, rawInput);
  const unattributedKey = lines
    .filter((l) => !l.attributed)
    .map((l) => `${l.field}=${l.value}`)
    .join("|");

  useEffect(() => {
    for (const l of lines) {
      if (!l.attributed) {
        reportUnattributedPresenceFact({
          input: rawInput,
          field: l.field,
          fact:  l.value,
          ...(stepIndex !== undefined ? { step: stepIndex } : {}),
        });
      }
    }
    // Fire once per distinct set of unattributed facts (best-effort tripwire).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawInput, unattributedKey]);

  if (facts.length === 0) return null;

  return (
    <div className="mt-2.5 space-y-1" data-testid="attribution-block">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-700">
        Why present
      </p>
      {lines.map((l, i) => (
        <p
          key={i}
          className={`text-[11px] leading-snug ${l.attributed ? "text-gray-500" : "text-gray-600 italic"}`}
          data-testid={l.attributed ? "attribution-line" : "attribution-unattributed"}
        >
          {l.attributed ? (
            <>present because <span className="font-mono text-gray-400">"{l.value}"</span> appears in your request</>
          ) : (
            <>source unattributed</>
          )}
        </p>
      ))}
    </div>
  );
}

// ─── FS operation card ────────────────────────────────────────────────────────

const FS_OP_META: Record<FsChange["operationType"], { icon: string; verb: string; color: string }> = {
  create_dir:  { icon: "📁", verb: "Create directory",  color: "text-[#00D4FF]" },
  write_file:  { icon: "📄", verb: "Create file",        color: "text-[#00D4FF]" },
  rename:      { icon: "✏️",  verb: "Rename",             color: "text-amber-400" },
  delete_file: { icon: "🗑️", verb: "Delete file",        color: "text-red-400"   },
};

function FsOpCard({ op, rawInput, stepIndex, effects }: { op: FsChange; rawInput: string; stepIndex?: number; effects?: FsOpEffectDisclosure }) {
  const meta = FS_OP_META[op.operationType];

  const systemWill = op.operationType === "write_file" && op.content
    ? `Create file: ./${op.filePath} (${op.content.split("\n").length} lines)`
    : describeFsOp(op);

  return (
    <div className="rounded-xl border border-gray-800/60 bg-gray-950
                    border-l-[3px] border-l-[#00D4FF] overflow-hidden">
      {/* YOU ASKED */}
      <div className="px-4 py-3 border-b border-gray-800/60">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-[#00D4FF]/70 mb-1.5">
          You asked
        </p>
        <p className="font-mono text-sm text-gray-100 leading-relaxed">{rawInput}</p>
      </div>

      {/* SYSTEM WILL */}
      <div className="px-4 py-3 bg-gray-900/30">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-600 mb-1.5">
          System will
        </p>
        <div className="flex items-center gap-2.5">
          <span className="text-lg flex-none leading-none">{meta.icon}</span>
          <span className={`text-sm font-medium font-mono ${meta.color}`}>{systemWill}</span>
        </div>
        {/* CREATE_DIR_EFFECT_CONTRACT_V1 §3: server-derived permitted-effect
            disclosure, rendered verbatim. `ancestors: null` = closure
            underivable -> generic disclosure (never an empty list). */}
        {op.operationType === "create_dir" && effects !== undefined && (
          effects.ancestors === null ? (
            <p className="mt-2 text-[11px] text-gray-400 leading-snug">
              May also create missing ancestor directories within the authorized scope.
            </p>
          ) : effects.ancestors.length > 0 ? (
            <p className="mt-2 text-[11px] text-gray-400 leading-snug">
              May also create missing ancestor directories (only inside this workspace, only if they do not already exist):{" "}
              <span className="font-mono text-gray-300">{effects.ancestors.map((a) => `${a}/`).join(", ")}</span>
            </p>
          ) : null
        )}
        {op.operationType === "write_file" && op.content && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold text-gray-600 mb-1.5">
              New file diff
            </p>
            {/* Truthful all-added diff: the file is new (executor refuses
                write_file when the target exists), so "before" is empty and
                every line is genuinely added. See USESTEADY_REAL_DIFF_V1. */}
            <div className="max-h-40 overflow-y-auto">
              <DiffView
                hunks={newFileHunks(op.content)}
                aria-label={`New file diff for ${op.filePath}`}
              />
            </div>
          </div>
        )}
        {op.operationType === "delete_file" && (
          <p className="mt-2 text-[11px] text-red-500/80 leading-snug">
            This cannot be undone. Confirm you want to permanently delete this file.
          </p>
        )}
        <AttributionBlock
          facts={presentFactsForFsOp(op)}
          rawInput={rawInput}
          stepIndex={stepIndex}
        />
      </div>
    </div>
  );
}

// ─── Non-FS step card ─────────────────────────────────────────────────────────

function NonFsCard({
  rawInput,
  spec,
  summary,
  stepIndex,
}: {
  rawInput: string;
  spec:     WorkflowTaskSpec;
  summary:  string | null;
  stepIndex?: number;
}) {
  const concreteDesc = describeNonFsStep(spec);
  const systemWill   = concreteDesc ?? runtimeSystemWill(spec.runtime);
  const isRuntime    = concreteDesc === null;

  return (
    <div className="rounded-xl border border-gray-800/60 bg-gray-950
                    border-l-[3px] border-l-[#00D4FF] overflow-hidden">

      {/* YOU ASKED */}
      <div className="px-4 py-3 border-b border-gray-800/60">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-[#00D4FF]/70 mb-1.5">
          You asked
        </p>
        <p className="font-mono text-sm text-gray-100 whitespace-pre-wrap break-words leading-relaxed">
          {rawInput}
        </p>
      </div>

      {/* SYSTEM WILL */}
      <div className="px-4 py-3 bg-gray-900/30">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-600 mb-1.5">
          System will
        </p>
        <p className={`text-sm font-medium font-mono ${isRuntime ? "text-gray-400" : "text-[#00D4FF]"}`}>
          {systemWill}
        </p>

        {/* Runtime-delegated: surface interpreted summary if meaningful */}
        {isRuntime && summary && (
          <p className="mt-2 text-xs text-gray-500 italic leading-relaxed">
            {summary}
          </p>
        )}

        {/* Replace op: remind user this is reversible */}
        {!isRuntime && (
          <p className="mt-2 text-[11px] text-gray-600 leading-snug">
            Text replacement is applied in-place. Confirm the exact strings above before approving.
          </p>
        )}

        {/* Attribution only for concrete present facts (replace); runtime-delegated
            steps are not certified-path present facts, so they carry no line. */}
        {!isRuntime && (
          <AttributionBlock
            facts={presentFactsForReplace(spec)}
            rawInput={rawInput}
            stepIndex={stepIndex}
          />
        )}
      </div>
    </div>
  );
}

// ─── Main frame ───────────────────────────────────────────────────────────────

type Props = {
  run:        WorkflowRun;
  vm:         FrameViewModel;
  isConflict: boolean;
  onApprove:  () => void;
  onReject:   () => void;
  onSkip?:    () => void;
  onStop?:    () => void;
  loading?:   boolean;
};

export function ApprovalFrame({
  run, vm, isConflict, onApprove, onReject, onSkip, onStop, loading,
}: Props) {
  const taskIdx    = run.currentIndex;
  const totalTasks = run.spec.tasks.length;
  const task       = run.tasks[taskIdx];
  const spec       = task?.spec ?? run.spec.tasks[taskIdx]!;

  const label      = taskDisplayLabel(spec, taskIdx);
  const rawInput   = spec.input;
  const summary    = vm.dual?.understood ?? null;
  const showSummary = shouldShowInterpretation(rawInput, summary);

  return (
    <div className="flex flex-col gap-5 max-w-2xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold text-gray-600 mb-1">
            Step {taskIdx + 1} of {totalTasks}
            {isConflict && (
              <span className="ml-2 text-red-400">· Conflict detected</span>
            )}
          </p>
          <h3 className="text-xl font-bold text-gray-50 leading-tight">{label}</h3>
        </div>
        <Badge
          label={runtimeBadgeLabel(spec.runtime)}
          variant="active"
          size="md"
        />
      </div>

      {/* Primary content — FS op or text replacement */}
      {run.currentFsOp ? (
        <FsOpCard op={run.currentFsOp} rawInput={rawInput} stepIndex={taskIdx} effects={run.currentFsOpEffects} />
      ) : (
        <NonFsCard
          rawInput={rawInput}
          spec={spec}
          summary={showSummary ? summary : null}
          stepIndex={taskIdx}
        />
      )}

      {/* Files in scope */}
      {spec.targetFiles && spec.targetFiles.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-600 mb-1.5">
            Files in scope
          </p>
          <div className="flex flex-wrap gap-1.5">
            {spec.targetFiles.map(f => (
              <span key={f} className="font-mono text-xs bg-gray-800 text-gray-300
                                       rounded-md px-2 py-0.5 ring-1 ring-gray-700/60">
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Conflict details */}
      {isConflict && vm.sections.length > 0 && (
        <Card elevation="sunken" className="border-l-[3px] border-l-red-500">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-red-400 mb-2">
            Conflict details
          </p>
          {vm.sections
            .filter(s => s.lines.some(l => l.trim()))
            .map((s, i) => (
              <div key={i} className="mt-2">
                {s.heading && (
                  <p className="text-xs font-semibold text-gray-500 mb-1">{s.heading}</p>
                )}
                {s.lines.map((l, j) => (
                  <p key={j} className="text-sm text-red-200 font-mono">{l}</p>
                ))}
              </div>
            ))}
        </Card>
      )}

      {/* Execution context */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-700 mb-2">
          Execution context
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1.5">
          <span className="text-xs flex items-center gap-1.5">
            <span className="text-gray-600">Runtime</span>
            <span className="text-gray-400 font-medium">{runtimeBadgeLabel(spec.runtime)}</span>
          </span>
          {run.workspaceRoot && (
            <span className="text-xs flex items-center gap-1.5">
              <span className="text-gray-600">Workspace</span>
              <span className="font-mono text-gray-400">{run.workspaceRoot}</span>
            </span>
          )}
        </div>
        <p className="text-[10px] text-gray-700 mt-1.5">{runtimeDescription(spec.runtime)}</p>
      </div>

      {/* Actions — stacked on mobile, row on sm+ */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <Button
          label="Approve & run"
          variant="primary"
          size="lg"
          onClick={onApprove}
          loading={loading}
          className="w-full sm:w-auto justify-center"
        />
        {onSkip && (
          <Button
            label="Skip step"
            variant="outline"
            size="lg"
            onClick={onSkip}
            disabled={loading}
            className="w-full sm:w-auto justify-center"
          />
        )}
        {onStop && (
          <Button
            label="Stop workflow"
            variant="ghost"
            size="lg"
            onClick={onStop}
            disabled={loading}
            className="w-full sm:w-auto justify-center"
          />
        )}
        {!onSkip && !onStop && (
          <Button
            label="Reject"
            variant="danger"
            size="lg"
            onClick={onReject}
            disabled={loading}
            className="w-full sm:w-auto justify-center"
          />
        )}
      </div>
    </div>
  );
}
