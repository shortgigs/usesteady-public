/**
 * Workspace shell — status bar (bottom, always visible, low-noise).
 *
 * Shows workspace root (from localStorage recent paths when available) and a
 * TRUTHFUL connection indicator. The indicator reflects an actual /api/health
 * probe — it never claims "Ready" unless the API server genuinely responds ok.
 * This matters: the product's core value is truthfulness, so the chassis must
 * not fabricate a liveness signal.
 */

import { useState, useEffect } from "react";
import { checkHealth } from "../../api/client.js";

type Connection = "checking" | "online" | "offline";

const HEALTH_POLL_MS = 15_000;

const INDICATOR: Record<Connection, { dot: string; label: string }> = {
  checking: { dot: "bg-gray-600 animate-pulse", label: "Connecting" },
  online:   { dot: "bg-emerald-500/70",          label: "Connected" },
  offline:  { dot: "bg-red-500/70",              label: "Offline" },
};

export function StatusBar() {
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>("checking");

  useEffect(() => {
    try {
      const paths = JSON.parse(
        localStorage.getItem("usesteady:recent-paths") ?? "[]",
      ) as string[];
      setWorkspaceRoot((paths[0] ?? null));
    } catch {
      // localStorage unavailable
    }
  }, []);

  // Real connectivity probe — initial check + periodic re-check.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const probe = async () => {
      const ok = await checkHealth(controller.signal);
      if (!cancelled) setConnection(ok ? "online" : "offline");
    };

    void probe();
    const id = window.setInterval(() => void probe(), HEALTH_POLL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(id);
    };
  }, []);

  const indicator = INDICATOR[connection];

  return (
    <div
      className="flex-none h-6 flex items-center gap-4 px-4
                 bg-gray-950 border-t border-gray-800/40
                 text-[10px] text-gray-600 overflow-hidden"
    >
      {workspaceRoot ? (
        <span className="truncate font-mono">
          <span className="text-gray-700">workspace: </span>
          {workspaceRoot}
        </span>
      ) : (
        <span className="text-gray-700">no workspace selected</span>
      )}

      <span className="ml-auto flex items-center gap-1.5 flex-none">
        <span
          className={`w-1.5 h-1.5 rounded-full ${indicator.dot}`}
          aria-hidden="true"
        />
        <span>{indicator.label}</span>
      </span>
    </div>
  );
}
