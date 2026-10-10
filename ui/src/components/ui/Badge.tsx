/**
 * Base Badge component.
 * Pure presentational — no authority, no callbacks.
 * Status colors come from the single source of truth in `status-tone.ts`
 * (calm, GitHub-style light chips). Variants map to semantic tones here.
 * Polish: status icons for accepted (✓), pending/active (pulsing dot).
 */

import { type BadgeVariant, BADGE_VARIANT_TONE } from "../../helpers/task-status.js";
import { STATUS_TONE } from "../../helpers/status-tone.js";

function BadgeIcon({ variant }: { variant: BadgeVariant }) {
  if (variant === "accepted") {
    return (
      <svg className="w-2.5 h-2.5 flex-none" viewBox="0 0 10 10" fill="none">
        <path d="M1.5 5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (variant === "failed") {
    return <span className="leading-none text-[9px] flex-none">✕</span>;
  }
  if (variant === "pending") {
    return (
      <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-pulse flex-none" />
    );
  }
  if (variant === "active") {
    return (
      <span className="w-1.5 h-1.5 rounded-full bg-[#00D4FF] animate-pulse flex-none" />
    );
  }
  return null;
}

type Props = {
  label:    string;
  variant:  BadgeVariant;
  size?:    "sm" | "md";
};

export function Badge({ label, variant, size = "sm" }: Props) {
  const sizeClass = size === "md"
    ? "px-2.5 py-1 text-xs gap-1.5"
    : "px-2 py-0.5 text-[11px] gap-1";

  return (
    <span className={`
      inline-flex items-center rounded-md font-medium
      ${sizeClass} ${STATUS_TONE[BADGE_VARIANT_TONE[variant]].chip}
    `}>
      <BadgeIcon variant={variant} />
      {label}
    </span>
  );
}
