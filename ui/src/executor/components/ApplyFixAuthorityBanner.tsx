import { PREVIEW_AUTHORITY_BANNER } from "../types.js";

export function ApplyFixAuthorityBanner() {
  return (
    <div
      role="status"
      className="rounded-lg border border-cyan-800/40 bg-cyan-950/30 px-4 py-3
                 flex items-start gap-3 focus-within:ring-2 focus-within:ring-cyan-500/40"
      tabIndex={0}
    >
      <span className="text-cyan-400 text-sm shrink-0" aria-hidden>
        ◈
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-cyan-100">{PREVIEW_AUTHORITY_BANNER}</p>
        <p className="text-xs text-cyan-200/70 mt-0.5">
          Presentation only. No handler execution, persistence, or queue work occurred.
        </p>
      </div>
    </div>
  );
}
