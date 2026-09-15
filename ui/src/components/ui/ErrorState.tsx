/**
 * ErrorState — shared error-panel primitive.
 *
 * Renders an error message using the canonical `danger` status tone from
 * `status-tone.ts`. Optionally renders a retry action. Use this for
 * load-failure states across all primary panels — do not hand-roll per-panel
 * error colors.
 *
 * The tone intentionally matches the `danger` chip (soft red tint, readable
 * text) for calm, scannable error treatment consistent with the shell chassis.
 */

import { STATUS_TONE } from "../../helpers/status-tone.js";

type Props = {
  /** Error message to display. Keep to one sentence where possible. */
  message:    string;
  /** Optional retry callback. When provided, renders a "Retry" text-button. */
  onRetry?:   () => void;
  /** Extra class on the outer container (e.g. margin or width). */
  className?: string;
};

export function ErrorState({ message, onRetry, className = "" }: Props) {
  return (
    <div
      className={`rounded-lg p-4 text-sm border border-red-500/20 ${STATUS_TONE.danger.chip} ${className}`}
    >
      <p>{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 text-xs text-[#00D4FF] hover:text-[#00D4FF]/80
                     underline underline-offset-2 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}
