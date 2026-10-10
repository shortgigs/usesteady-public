/**
 * InfoTooltip — reusable hover tooltip for positioning copy.
 *
 * Pure presentational. No authority, no callbacks.
 * Uses CSS-only hover (no JS state) for simplicity and reliability.
 */

type Props = {
  /** Short label shown on the trigger icon. Defaults to "?". */
  label?:    string;
  /** Tooltip body content. */
  children:  React.ReactNode;
  /** Which side the tooltip opens. Defaults to "bottom". */
  side?:     "top" | "bottom" | "left" | "right";
};

export function InfoTooltip({ label = "?", children, side = "bottom" }: Props) {
  const positionClass =
    side === "top"    ? "bottom-full left-1/2 -translate-x-1/2 mb-2"
    : side === "left"  ? "right-full top-1/2 -translate-y-1/2 mr-2"
    : side === "right" ? "left-full top-1/2 -translate-y-1/2 ml-2"
    : /* bottom */       "top-full left-1/2 -translate-x-1/2 mt-2";

  return (
    <div className="group relative inline-flex items-center">
      <button
        type="button"
        aria-label="More information"
        className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:w-4 sm:h-4
                   rounded-full bg-gray-800 border border-gray-700
                   text-[9px] font-bold text-gray-500
                   flex items-center justify-center
                   hover:border-gray-500 hover:text-gray-300
                   transition-colors cursor-default select-none"
      >
        {label}
      </button>

      <div className={`pointer-events-none absolute ${positionClass}
                       w-64 rounded-xl bg-gray-800 border border-gray-700
                       px-4 py-3 shadow-2xl z-50
                       opacity-0 group-hover:opacity-100
                       transition-opacity duration-150`}>
        {children}
      </div>
    </div>
  );
}
