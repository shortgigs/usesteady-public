/**
 * Workspace shell — command palette (S2).
 *
 * Global keyboard-first navigator. Opens on Cmd+K / Ctrl+K (registered by
 * AppShell). Fuzzy-filters over the full route registry and a small action
 * registry. Keyboard-first: ArrowUp/Down + Enter to activate, Esc to close.
 * Mouse hover + click also work.
 *
 * Accessibility: role="dialog", aria-modal, focus moves to input on open.
 * No new dependencies — substring/fuzzy match is inline.
 */

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";

// ─── Types ────────────────────────────────────────────────────────────────────

type PaletteItem = {
  id: string;
  label: string;
  group: string;
  hint?: string;
  execute: () => void;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onToggleSidebar: () => void;
  adminEnabled: boolean;
};

// ─── Fuzzy matcher ────────────────────────────────────────────────────────────

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  // Sequential character fuzzy: every char in q appears in order in t
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ─── Icons (inline SVG — no new dep) ─────────────────────────────────────────

function IconSearch() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="w-4 h-4 text-gray-500 flex-none"
      aria-hidden="true"
    >
      <circle cx="6.5" cy="6.5" r="4" />
      <path d="M14 14l-3.5-3.5" />
    </svg>
  );
}

// ─── CommandPalette ───────────────────────────────────────────────────────────

export function CommandPalette({
  isOpen,
  onClose,
  onToggleSidebar,
  adminEnabled,
}: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Helper: navigate then close
  const nav = useCallback(
    (path: string) => () => {
      navigate(path);
      onClose();
    },
    [navigate, onClose],
  );

  // Command registry — recomputed only when stable deps change
  const items = useMemo<PaletteItem[]>(() => {
    const base: PaletteItem[] = [
      {
        id: "new-run",
        label: "New run",
        group: "Run",
        hint: "/",
        execute: nav("/"),
      },
      {
        id: "history",
        label: "History",
        group: "Run",
        hint: "/history",
        execute: nav("/history"),
      },
      {
        id: "apply-fix",
        label: "Apply fix",
        group: "Run",
        hint: "/apply-fix",
        execute: nav("/apply-fix"),
      },
      {
        id: "exec-dashboard",
        label: "Executions dashboard",
        group: "Executions",
        hint: "/dashboard/executions",
        execute: nav("/dashboard/executions"),
      },
      {
        id: "exec-health",
        label: "Health",
        group: "Executions",
        hint: "/dashboard/executions/health",
        execute: nav("/dashboard/executions/health"),
      },
      {
        id: "exec-diagnostics",
        label: "Diagnostics",
        group: "Executions",
        hint: "/dashboard/executions/diagnostics",
        execute: nav("/dashboard/executions/diagnostics"),
      },
      {
        id: "governance",
        label: "Governance",
        group: "Governance",
        hint: "/dashboard/executions/governance",
        execute: nav("/dashboard/executions/governance"),
      },
      {
        id: "toggle-sidebar",
        label: "Toggle sidebar",
        group: "Actions",
        hint: "Show / hide the sidebar",
        execute: () => {
          onToggleSidebar();
          onClose();
        },
      },
    ];

    if (adminEnabled) {
      base.push({
        id: "admin",
        label: "Admin",
        group: "Admin",
        hint: "/admin",
        execute: nav("/admin"),
      });
    }

    return base;
  }, [nav, onToggleSidebar, onClose, adminEnabled]);

  // Filtered list
  const filtered = useMemo<PaletteItem[]>(() => {
    const q = query.trim();
    if (!q) return items;
    return items.filter(
      (item) =>
        fuzzyMatch(q, item.label) ||
        fuzzyMatch(q, item.group) ||
        (item.hint != null && fuzzyMatch(q, item.hint)),
    );
  }, [items, query]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered]);

  // Focus input and reset query on open
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      // rAF to ensure the element is mounted and visible before focusing
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Keyboard handler on the panel
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        filtered[selectedIndex]?.execute();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, selectedIndex, onClose],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg mx-4 bg-gray-900 border border-gray-700/60
                   rounded-xl shadow-2xl shadow-black/60 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Search input row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/60">
          <IconSearch />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands..."
            className="flex-1 bg-transparent text-sm text-gray-100
                       placeholder-gray-600 outline-none"
            aria-label="Command search"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd
            className="hidden md:inline-flex items-center px-1.5 py-0.5 rounded
                       text-[10px] font-mono text-gray-600 border border-gray-700/60
                       bg-gray-800/40 select-none"
          >
            Esc
          </kbd>
        </div>

        {/* Results list */}
        {filtered.length > 0 ? (
          <ul
            ref={listRef}
            className="max-h-72 overflow-y-auto py-1 scrollbar-thin"
            role="listbox"
            aria-label="Commands"
          >
            {filtered.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <li
                  key={item.id}
                  role="option"
                  aria-selected={isSelected}
                  className={[
                    "flex items-center gap-3 px-4 py-2.5 cursor-pointer text-sm",
                    "transition-colors duration-75 select-none",
                    isSelected
                      ? "bg-[#00D4FF]/10 text-[#00D4FF]"
                      : "text-gray-300 hover:bg-gray-800/60 hover:text-gray-100",
                  ].join(" ")}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => item.execute()}
                >
                  <span
                    className="flex-none text-[10px] font-semibold uppercase
                               tracking-wider text-gray-600 w-20 truncate"
                  >
                    {item.group}
                  </span>
                  <span className="flex-1 font-medium truncate">{item.label}</span>
                  {item.hint != null && (
                    <span
                      className={[
                        "text-[11px] font-mono truncate max-w-[140px]",
                        isSelected ? "text-[#00D4FF]/60" : "text-gray-600",
                      ].join(" ")}
                    >
                      {item.hint}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-gray-600">
            No commands match&nbsp;
            <span className="text-gray-400">"{query}"</span>
          </div>
        )}

        {/* Footer hint bar */}
        <div
          className="flex items-center gap-4 px-4 py-2 border-t border-gray-800/40
                     text-[10px] text-gray-700 select-none"
        >
          <span>
            <kbd className="font-mono">↑↓</kbd>
            {" "}navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd>
            {" "}select
          </span>
          <span>
            <kbd className="font-mono">Esc</kbd>
            {" "}close
          </span>
        </div>
      </div>
    </div>
  );
}
