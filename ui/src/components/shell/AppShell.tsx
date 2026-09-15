/**
 * Workspace shell chassis.
 *
 * Four-wheel layout:
 *   Sidebar  — persistent left nav (collapsible, icon-rail on mobile)
 *   TopBar   — thin title/breadcrumb bar + Cmd+K trigger (S2)
 *   Content  — scrolls independently; the frame stays fixed
 *   StatusBar — bottom bar with workspace root + connection indicator
 *
 * S2: CommandPalette is mounted here (inside the Router context so
 * useNavigate works). The global Ctrl/Cmd+K keydown listener is registered
 * once on mount and cleaned up on unmount.
 *
 * This is the single mounting point for the shell. App.tsx wraps <Routes>
 * in <AppShell>. No page component needs to know about the shell.
 */

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { Sidebar, useSidebarState } from "./Sidebar.js";
import { TopBar } from "./TopBar.js";
import { StatusBar } from "./StatusBar.js";
import { CommandPalette } from "./CommandPalette.js";

// ADMIN_ENABLED is read at module load time from Vite env.
// Pattern mirrors App.tsx to avoid double-loading the env flag.
const ADMIN_ENABLED = import.meta.env.VITE_ADMIN === "1";

type Props = {
  children: ReactNode;
};

export function AppShell({ children }: Props) {
  const { collapsed, toggle } = useSidebarState();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Stable callbacks so CommandPalette's item memo doesn't thrash
  const handleOpenPalette = useCallback(() => setPaletteOpen(true), []);
  const handleClosePalette = useCallback(() => setPaletteOpen(false), []);

  // Global Ctrl/Cmd+K + Escape hotkeys — registered once, cleaned up on unmount.
  // Using a ref for paletteOpen so the listener never needs to be re-registered.
  const paletteOpenRef = useRef(false);
  paletteOpenRef.current = paletteOpen;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (e.key === "Escape" && paletteOpenRef.current) {
        // Close palette via Escape regardless of which element has focus
        setPaletteOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950">
      <Sidebar collapsed={collapsed} onToggle={toggle} adminEnabled={ADMIN_ENABLED} />

      {/* Right column: top bar + scrollable content + status bar */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar onOpenPalette={handleOpenPalette} />

        {/* Content region — scrolls independently */}
        <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin">
          {children}
        </div>

        <StatusBar />
      </div>

      {/* Command palette — mounted at chassis level, inside Router context */}
      <CommandPalette
        isOpen={paletteOpen}
        onClose={handleClosePalette}
        onToggleSidebar={toggle}
        adminEnabled={ADMIN_ENABLED}
      />
    </div>
  );
}
