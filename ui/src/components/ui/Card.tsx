/**
 * Base Card component — three elevation levels.
 * UI Redesign: default / elevated / sunken variants.
 */

import type { ReactNode } from "react";

type Elevation = "default" | "elevated" | "sunken";

type Props = {
  children:   ReactNode;
  className?: string;
  padded?:    boolean;
  elevation?: Elevation;
};

const ELEVATION_CLASSES: Record<Elevation, string> = {
  default:  "bg-gray-900 border border-gray-800",
  elevated: "bg-gray-900 border border-gray-700 shadow-lg shadow-black/30",
  sunken:   "bg-gray-950 border border-gray-800/60",
};

export function Card({
  children,
  className = "",
  padded    = true,
  elevation = "default",
}: Props) {
  return (
    <div className={`
      rounded-xl ${ELEVATION_CLASSES[elevation]}
      ${padded ? "p-5" : ""}
      ${className}
    `}>
      {children}
    </div>
  );
}

export function CardHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-800">
      {children}
    </div>
  );
}

export function CardSection({
  title,
  children,
}: {
  title?:   string;
  children: ReactNode;
}) {
  return (
    <div className="mt-4">
      {title && (
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
          {title}
        </p>
      )}
      {children}
    </div>
  );
}
