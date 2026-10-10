/**
 * EmptyState — shared empty-panel primitive.
 *
 * Provides a consistent visual treatment for every panel that has no data.
 * Tone: neutral, dark-theme, using the shell visual language (gray-950,
 * electric-cyan accent, Geist). Keep the shell chassis consistent — do not
 * hand-roll per-panel empty states; import and configure this instead.
 */

import type { ReactNode } from "react";

type Props = {
  /** Emoji or short symbol rendered in the icon well. Defaults to the folder glyph. */
  icon?:        string;
  /** Required primary label (bold, gray-400). Keep short. */
  title:        string;
  /** Optional secondary text. Keep to 1–2 lines; constrained to max-w-[220px]. */
  description?: string;
  /** Optional action slot — e.g. a <Button> or <a> CTA. */
  action?:      ReactNode;
};

export function EmptyState({ icon = "📂", title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8 gap-5">
      <div className="w-10 h-10 rounded-xl bg-gray-900 border border-gray-800
                      flex items-center justify-center text-xl">
        {icon}
      </div>
      <div>
        <p className="text-gray-400 text-sm font-semibold">{title}</p>
        {description && (
          <p className="text-gray-600 text-xs mt-3 leading-relaxed max-w-[220px]">
            {description}
          </p>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
