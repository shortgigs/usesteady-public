import type { ApplyFixViewModel } from "../types.js";

type Props = {
  view: ApplyFixViewModel;
};

export function ApplyFixExplanation({ view }: Props) {
  return (
    <section aria-labelledby="apply-fix-explanation-heading" className="space-y-4">
      <h2
        id="apply-fix-explanation-heading"
        className="text-xs font-semibold uppercase tracking-wider text-gray-500"
      >
        Explanation
      </h2>

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">Target scope</p>
        {view.target_scope.length === 0 ? (
          <p className="text-sm text-gray-500">No target scope listed.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {view.target_scope.map((scope) => (
              <li
                key={scope}
                className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-300 font-mono"
              >
                {scope}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-gray-500">Risk notes</p>
        {view.risk_notes.length === 0 ? (
          <p className="text-sm text-gray-500">No risk notes recorded.</p>
        ) : (
          <ul className="space-y-1.5">
            {view.risk_notes.map((note) => (
              <li
                key={note}
                className="text-sm text-amber-200/80 border-l-2 border-amber-700/40 pl-3"
              >
                {note}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
