/**
 * Phase 11A-Web: ScopeClarificationFrame component.
 *
 * Renders the scope_question view. Shows candidates; user selects one.
 *
 * UI-W2: Controls map to existing choices only (candidate-bounded selection).
 * WF-S3: If explicit scope exists, system does not ask again.
 *        This frame only appears when no targetFiles eliminated the question.
 */

import { useState }          from "react";
import { Button }            from "../ui/Button.js";
import { Card }              from "../ui/Card.js";
import type { WorkflowRun }  from "../../api/types.js";
import type { FrameViewModel } from "../../adapters/shell-frame.js";
import { taskDisplayLabel }  from "../../helpers/task-status.js";

type Props = {
  run:       WorkflowRun;
  vm:        FrameViewModel;
  onChoose:  (idx: number) => void;
  loading?:  boolean;
};

export function ScopeClarificationFrame({ run, vm, onChoose, loading }: Props) {
  const [selected, setSelected] = useState<number | null>(null);

  const taskIdx = run.currentIndex;
  const spec    = run.tasks[taskIdx]?.spec ?? run.spec.tasks[taskIdx]!;
  const label   = taskDisplayLabel(spec, taskIdx);

  const prompt  = vm.prompt;
  const choices = prompt?.kind === "choose" ? [...prompt.choices] : [];

  function handleSubmit() {
    if (selected !== null) onChoose(selected);
  }

  return (
    <div className="flex flex-col gap-5 max-w-2xl">

      {/* Header */}
      <div>
        <p className="text-xs uppercase tracking-widest font-semibold text-blue-400 mb-1">
          Scope Clarification
        </p>
        <h3 className="text-xl font-bold text-gray-50">{label}</h3>
      </div>

      {/* Explanation */}
      <p className="text-sm text-gray-400">
        {prompt?.question ?? "Which file should this task apply to?"}
      </p>

      {/* Candidate list — bounded to provided choices only */}
      <Card padded={false}>
        <ul className="divide-y divide-gray-800">
          {choices.map((choice, idx) => (
            <li key={idx}>
              <label className="flex items-center gap-3 p-4 cursor-pointer
                                hover:bg-gray-800/50 transition-colors">
                <input
                  type="radio"
                  name="scope-candidate"
                  value={idx}
                  checked={selected === idx}
                  onChange={() => setSelected(idx)}
                  className="accent-indigo-500"
                />
                <span className="font-mono text-sm text-gray-200">{choice}</span>
              </label>
            </li>
          ))}
        </ul>
      </Card>

      {/* Submit */}
      <div>
        <Button
          label="Confirm selection"
          variant="primary"
          size="md"
          onClick={handleSubmit}
          disabled={selected === null}
          loading={loading}
        />
      </div>
    </div>
  );
}
