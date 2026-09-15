import type { ApplyFixViewModel } from "../types.js";

type Props = {
  view: ApplyFixViewModel;
};

/**
 * Guidance only — no execution CTA (INV-REACT-UI-8).
 */
export function ApplyFixNextStep({ view }: Props) {
  return (
    <section aria-labelledby="apply-fix-next-heading" className="space-y-2">
      <h2
        id="apply-fix-next-heading"
        className="text-xs font-semibold uppercase tracking-wider text-gray-500"
      >
        Next step
      </h2>
      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-4 py-3">
        <p className="text-sm text-gray-300 leading-relaxed">{view.operator_path_note}</p>
        <p className="text-xs text-gray-500 mt-2">
          Use your existing operator confirmation path. This surface does not execute fixes.
        </p>
      </div>
    </section>
  );
}
