import type { ApplyFixViewModel } from "../types.js";

type Props = {
  view: ApplyFixViewModel;
};

export function ApplyFixLineage({ view }: Props) {
  if (view.lineage_rows.length === 0) {
    return (
      <section aria-labelledby="apply-fix-lineage-heading" className="space-y-2">
        <h2
          id="apply-fix-lineage-heading"
          className="text-xs font-semibold uppercase tracking-wider text-gray-500"
        >
          Lineage
        </h2>
        <p className="text-sm text-gray-500">No lineage rows in this preview.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="apply-fix-lineage-heading" className="space-y-3">
      <h2
        id="apply-fix-lineage-heading"
        className="text-xs font-semibold uppercase tracking-wider text-gray-500"
      >
        Lineage
      </h2>
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-left text-xs min-w-[520px]">
          <thead className="bg-gray-950/90 text-gray-500 uppercase tracking-wider">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">At</th>
              <th scope="col" className="px-3 py-2 font-semibold">Source</th>
              <th scope="col" className="px-3 py-2 font-semibold">Kind</th>
              <th scope="col" className="px-3 py-2 font-semibold">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/80">
            {view.lineage_rows.map((row, i) => (
              <tr key={`${row.at}-${row.kind}-${i}`} className="hover:bg-gray-900/40">
                <td className="px-3 py-2 font-mono text-gray-400 whitespace-nowrap">{row.at}</td>
                <td className="px-3 py-2 text-gray-300">{row.source}</td>
                <td className="px-3 py-2 text-gray-300">{row.kind}</td>
                <td className="px-3 py-2 text-gray-400">{row.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
