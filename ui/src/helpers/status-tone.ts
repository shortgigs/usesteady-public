/**
 * Status tone system — the single source of truth for UseSteady's status colors.
 *
 * Design intent (calm, GitHub-style):
 *   - Neutral-forward. Color is reserved for real signal; everything else is gray.
 *   - Chips are LIGHT: a soft background tint + readable text. No heavy borders,
 *     no rings, no glow. Compact and easy to scan.
 *   - A small, fixed palette. Four semantic tones + one brand accent. New status
 *     surfaces import from here — never hand-roll status colors in components.
 *
 *   success  emerald   completed / accepted / low risk
 *   warning  amber     skipped / needs-attention / medium risk
 *   danger   red       failed / rejected / high risk
 *   neutral  gray      idle / stopped / pending / unknown
 *   accent   cyan      active / in-progress (brand color — used sparingly)
 *
 * This intentionally retires the previous loud values (bright yellow, orange,
 * and the stray non-emerald greens) in favour of muted, consistent tones.
 */

export type StatusTone = "success" | "warning" | "danger" | "neutral" | "accent";

type ToneTokens = {
  /** Light GitHub-style chip body: soft bg tint + readable text. No border/ring. */
  readonly chip: string;
  /** Text-only emphasis (inline status words, labels). */
  readonly text: string;
  /** Solid status dot (timeline / list markers). */
  readonly dot: string;
  /** Left accent border for scan-level row emphasis. */
  readonly leftBorder: string;
};

export const STATUS_TONE: Record<StatusTone, ToneTokens> = {
  success: {
    chip:       "bg-emerald-500/10 text-emerald-300",
    text:       "text-emerald-300",
    dot:        "bg-emerald-500",
    leftBorder: "border-l-emerald-500/60",
  },
  warning: {
    chip:       "bg-amber-500/10 text-amber-300",
    text:       "text-amber-300",
    dot:        "bg-amber-500",
    leftBorder: "border-l-amber-500/50",
  },
  danger: {
    chip:       "bg-red-500/10 text-red-300",
    text:       "text-red-300",
    dot:        "bg-red-500",
    leftBorder: "border-l-red-500/70",
  },
  neutral: {
    chip:       "bg-gray-500/10 text-gray-400",
    text:       "text-gray-400",
    dot:        "bg-gray-500",
    leftBorder: "border-l-gray-700",
  },
  accent: {
    chip:       "bg-[#00D4FF]/10 text-[#00D4FF]",
    text:       "text-[#00D4FF]",
    dot:        "bg-[#00D4FF]",
    leftBorder: "border-l-[#00D4FF]/50",
  },
};

/**
 * Canonical light status chip (GitHub-style): rounded, compact, soft tint.
 * Prefer this over composing chip classes by hand so every chip stays uniform.
 */
export function statusChipClass(tone: StatusTone): string {
  return `inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[tone].chip}`;
}
