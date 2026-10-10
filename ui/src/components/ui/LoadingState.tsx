/**
 * LoadingState — shared loading-panel primitive.
 *
 * A consistent spinner + label for every in-progress fetch. The spinner uses
 * the electric-cyan brand accent (#00D4FF) so active states are visually
 * distinct from the neutral-gray idle style. Centered by default (h-full);
 * pass `className` to override the container when the panel is inline (e.g.
 * inside a content block that does not fill the viewport height).
 *
 * Do not hand-roll per-panel loading states — import this instead.
 */

type Props = {
  /** Human-readable progress label. */
  label?:     string;
  /** Overrides the outer container class. Default: centered flex, h-full. */
  className?: string;
};

export function LoadingState({
  label     = "Loading…",
  className = "flex items-center justify-center h-full",
}: Props) {
  return (
    <div className={className}>
      <div className="flex items-center gap-3 text-gray-400 text-sm">
        <span className="size-4 border-2 border-gray-700 border-t-[#00D4FF] rounded-full animate-spin flex-none" />
        {label}
      </div>
    </div>
  );
}
