/**
 * Base Button component.
 * Pure presentational — callbacks are the only authority boundary surface.
 * UI Redesign: icon prop, outline variant, cyan primary (dark text).
 */

import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "outline" | "danger" | "ghost";
type Size    = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:   "bg-gradient-to-r from-[#00D4FF] to-[#0077FF] hover:from-[#00D4FF]/90 hover:to-[#0077FF]/90 text-gray-950 font-semibold shadow-md shadow-[#00D4FF]/20 hover:shadow-lg hover:shadow-[#00D4FF]/30 hover:-translate-y-px active:translate-y-0 active:shadow-sm",
  secondary: "bg-gray-800 hover:bg-gray-700 text-gray-100 ring-1 ring-gray-700 hover:-translate-y-px active:translate-y-0",
  outline:   "border border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-gray-100 hover:border-gray-600 hover:-translate-y-px active:translate-y-0",
  danger:    "bg-red-700 hover:bg-red-600 text-white shadow-sm hover:-translate-y-px active:translate-y-0",
  ghost:     "text-gray-400 hover:text-gray-200 hover:bg-gray-800/70",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm:  "px-3 py-1.5 text-xs gap-1.5",
  md:  "px-4 py-2 text-sm gap-2",
  lg:  "px-5 py-2.5 text-sm gap-2",
};

type Props = {
  label:      string;
  onClick:    () => void;
  variant?:   Variant;
  size?:      Size;
  disabled?:  boolean;
  loading?:   boolean;
  icon?:      ReactNode;
  iconEnd?:   ReactNode;
  className?: string;
  /** Optional native tooltip — useful for explaining why a button is disabled. */
  title?:     string;
  /** Optional aria-label override — announced by screen readers in place of the visible label. */
  ariaLabel?: string;
};

export function Button({
  label,
  onClick,
  variant   = "secondary",
  size      = "md",
  disabled  = false,
  loading   = false,
  icon,
  iconEnd,
  className = "",
  title,
  ariaLabel,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      aria-label={ariaLabel}
      aria-disabled={disabled || loading}
      className={`
        inline-flex items-center rounded-lg font-medium
        transition-all duration-150 cursor-pointer
        disabled:opacity-40 disabled:cursor-not-allowed
        ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}
      `}
    >
      {loading ? (
        <span className="size-3.5 border-2 border-current border-t-transparent rounded-full animate-spin flex-none" />
      ) : icon ? (
        <span className="flex-none">{icon}</span>
      ) : null}
      {label}
      {iconEnd && !loading && (
        <span className="flex-none">{iconEnd}</span>
      )}
    </button>
  );
}
