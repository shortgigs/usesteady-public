/**
 * Workspace shell — top bar.
 *
 * Thin bar (h-10) showing the current surface title / breadcrumb and the
 * Cmd+K command palette trigger. No nav links — navigation lives in the
 * sidebar (and in the palette).
 *
 * S2: onOpenPalette prop activates the Cmd+K button; palette is mounted in
 * AppShell so it lives inside the Router context.
 */

import { useLocation } from "react-router-dom";

// ─── Route → surface title ────────────────────────────────────────────────────

function surfaceTitle(pathname: string): string {
  if (pathname === "/") return "New Run";
  if (pathname === "/history") return "History";
  if (/^\/history\/.+/.test(pathname)) return "Run Detail";
  if (/^\/execution\/.+/.test(pathname)) return "Execution Review";
  if (pathname === "/apply-fix") return "Apply Fix Preview";
  if (pathname === "/dashboard/executions/health") return "Workflow Health";
  if (pathname === "/dashboard/executions/diagnostics") return "Execution Diagnostics";
  if (pathname === "/dashboard/executions/governance") return "Governance";
  if (/\/replay-execution-history$/.test(pathname)) return "Replay Execution History";
  if (/\/replay-sandbox$/.test(pathname)) return "Replay Sandbox";
  if (/\/timeline$/.test(pathname)) return "Execution Timeline";
  if (/\/correlation$/.test(pathname)) return "Correlated Trust";
  if (/\/inspect$/.test(pathname)) return "Replay Inspection";
  if (/\/dashboard\/executions\/.+\/history$/.test(pathname)) return "Decision History";
  if (pathname === "/dashboard/executions") return "Executions Dashboard";
  if (pathname === "/admin") return "Admin";
  return "UseSteady";
}

// ─── TopBar ───────────────────────────────────────────────────────────────────

type Props = {
  onOpenPalette: () => void;
};

export function TopBar({ onOpenPalette }: Props) {
  const { pathname } = useLocation();
  const title = surfaceTitle(pathname);

  return (
    <header
      className="flex-none h-10 flex items-center justify-between
                 px-4 bg-gray-950 border-b border-gray-800/60"
    >
      {/* Surface breadcrumb */}
      <span className="text-sm font-medium text-gray-300 truncate">{title}</span>

      {/* Cmd+K palette trigger */}
      <button
        type="button"
        onClick={onOpenPalette}
        className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md
                   border border-gray-800 text-[11px] text-gray-500
                   bg-gray-900/50 hover:border-gray-700 hover:text-gray-300
                   hover:bg-gray-800/60 transition-colors duration-100
                   focus-visible:outline-none focus-visible:ring-2
                   focus-visible:ring-[#00D4FF]/60 cursor-pointer select-none"
        aria-label="Open command palette"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <span>⌘K</span>
      </button>
    </header>
  );
}
