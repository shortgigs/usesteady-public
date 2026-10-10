import type { ReactNode } from "react";

type Props = {
  readonly title: string;
  readonly children: ReactNode;
};

export function ReplayInspectionSection({ title, children }: Props) {
  return (
    <section className="rounded-lg border border-gray-800/80 bg-gray-900/40 p-4">
      <h3 className="text-sm font-semibold text-gray-100 mb-3">{title}</h3>
      {children}
    </section>
  );
}
