/**
 * Workspace shell — left sidebar navigation.
 *
 * Persistent across all routes. Collapsible to an icon-rail (state in
 * localStorage). On mobile (< md) the sidebar is always the compact icon-rail
 * regardless of the stored collapse preference.
 */

import { useState, useEffect, useCallback } from "react";
import { NavLink } from "react-router-dom";
import { BrandMark } from "../ui/BrandMark.js";

// ─── Sidebar collapse state (persisted) ───────────────────────────────────────

const SIDEBAR_KEY = "usesteady.sidebar.collapsed";

export function useSidebarState() {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(collapsed));
    } catch {
      // localStorage unavailable — ignore
    }
  }, [collapsed]);

  // useCallback with empty deps: setCollapsed (from useState) is stable, so
  // toggle is stable across re-renders. Consumers can safely depend on it.
  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  return { collapsed, toggle };
}

// ─── Inline SVG icons ──────────────────────────────────────────────────────────

function IconPlus({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function IconClock({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5.5V8l1.5 1.5" />
    </svg>
  );
}

function IconWrench({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M13.2 2.8a3.2 3.2 0 0 0-4.5 4.5L3 13l1 1 5.7-5.7a3.2 3.2 0 0 0 3.5-5.5z" />
    </svg>
  );
}

function IconGrid({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}

function IconActivity({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <polyline points="1,8 4,8 6,3 8,13 10,6 12,8 15,8" />
    </svg>
  );
}

function IconSearch({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="4" />
      <path d="M14 14l-3.5-3.5" />
    </svg>
  );
}

function IconShield({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M8 2L3 4v4c0 3 2.5 5.5 5 6 2.5-.5 5-3 5-6V4L8 2z" />
    </svg>
  );
}

function IconScale({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M8 2v12M4 14h8M3 5l-2 4a2 2 0 0 0 4 0L3 5zm10 0l-2 4a2 2 0 0 0 4 0l-2-4zM3 5h10" />
    </svg>
  );
}

function IconUser({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="8" cy="5" r="3" />
      <path d="M2 14c0-3 2.7-5 6-5s6 2 6 5" />
    </svg>
  );
}

function IconChevronLeft({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M10 12L6 8l4-4" />
    </svg>
  );
}

function IconChevronRight({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M6 12l4-4-4-4" />
    </svg>
  );
}

// ─── Nav item ──────────────────────────────────────────────────────────────────

type NavItemProps = {
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  end?: boolean;
};

function NavItem({ to, icon, label, collapsed, end }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium
         transition-colors duration-100 min-h-[44px] md:min-h-[36px]
         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4FF]/60
         ${
           isActive
             ? "bg-[#00D4FF]/10 text-[#00D4FF]"
             : "text-gray-400 hover:text-gray-100 hover:bg-gray-800/60"
         }`
      }
    >
      <span className="flex-none w-4 h-4 flex items-center justify-center">
        {icon}
      </span>
      <span className={`truncate ${collapsed ? "hidden" : "hidden md:inline"}`}>
        {label}
      </span>
    </NavLink>
  );
}

// ─── Group header ──────────────────────────────────────────────────────────────

function GroupHeader({ label, collapsed }: { label: string; collapsed: boolean }) {
  if (collapsed) return null;
  return (
    <p className="hidden md:block px-3 pt-3 pb-1 text-[10px] font-semibold
                  uppercase tracking-widest text-gray-600 select-none">
      {label}
    </p>
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────────────

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
  adminEnabled: boolean;
};

export function Sidebar({ collapsed, onToggle, adminEnabled }: SidebarProps) {
  // Desktop: w-14 collapsed / w-56 expanded. Mobile: always w-14.
  const widthClass = collapsed ? "w-14" : "w-14 md:w-56";

  return (
    <aside
      className={`flex-none ${widthClass} flex flex-col bg-gray-950
                  border-r border-gray-800/60 transition-[width] duration-200
                  overflow-hidden`}
      aria-label="Main navigation"
    >
      {/* Brand header — same height as TopBar (h-10 / 40px) */}
      <div
        className={`flex items-center gap-2.5 px-3 h-10 flex-none
                    border-b border-gray-800/60
                    ${collapsed ? "justify-center" : ""}`}
      >
        <BrandMark className="w-6 h-6 flex-none" withBackground={false} />
        {!collapsed && (
          <span className="hidden md:block text-sm font-black text-white tracking-tight whitespace-nowrap">
            <span className="font-normal text-gray-400">Use</span>Steady
          </span>
        )}
      </div>

      {/* Nav */}
      <nav
        className="flex-1 overflow-y-auto py-1 px-2 scrollbar-thin"
        aria-label="Navigation"
      >
        {/* ── Run ── */}
        <GroupHeader label="Run" collapsed={collapsed} />
        <div className="flex flex-col gap-0.5">
          <NavItem to="/" icon={<IconPlus />} label="New run" collapsed={collapsed} end />
          <NavItem to="/history" icon={<IconClock />} label="History" collapsed={collapsed} />
          <NavItem to="/apply-fix" icon={<IconWrench />} label="Apply fix" collapsed={collapsed} />
        </div>

        <div className="my-2 border-t border-gray-800/40" />

        {/* ── Executions ── */}
        <GroupHeader label="Executions" collapsed={collapsed} />
        <div className="flex flex-col gap-0.5">
          <NavItem
            to="/dashboard/executions"
            icon={<IconGrid />}
            label="Dashboard"
            collapsed={collapsed}
            end
          />
          <NavItem
            to="/dashboard/executions/health"
            icon={<IconActivity />}
            label="Health"
            collapsed={collapsed}
          />
          <NavItem
            to="/dashboard/executions/diagnostics"
            icon={<IconSearch />}
            label="Diagnostics"
            collapsed={collapsed}
          />
        </div>

        <div className="my-2 border-t border-gray-800/40" />

        {/* ── Governance ── */}
        <GroupHeader label="Governance" collapsed={collapsed} />
        <div className="flex flex-col gap-0.5">
          <NavItem
            to="/dashboard/executions/governance"
            icon={<IconShield />}
            label="Governance"
            collapsed={collapsed}
          />
          <NavItem
            to="/governed"
            icon={<IconScale />}
            label="Governed decisions"
            collapsed={collapsed}
          />
        </div>

        {/* ── Admin (gated) ── */}
        {adminEnabled && (
          <>
            <div className="my-2 border-t border-gray-800/40" />
            <div className="flex flex-col gap-0.5">
              <NavItem
                to="/admin"
                icon={<IconUser />}
                label="Admin"
                collapsed={collapsed}
              />
            </div>
          </>
        )}
      </nav>

      {/* Footer: tagline + collapse toggle */}
      <div className="flex-none border-t border-gray-800/60">
        {!collapsed && (
          <p className="hidden md:block px-3 pt-2 pb-0 text-[10px] text-gray-600
                        leading-relaxed select-none">
            Never runs a step without your approval
          </p>
        )}
        <div className="px-2 py-2">
          <button
            type="button"
            onClick={onToggle}
            className="hidden md:flex w-full items-center justify-center h-8 rounded-md
                       text-gray-600 hover:text-gray-300 hover:bg-gray-800/60
                       transition-colors duration-100
                       focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-[#00D4FF]/60"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
          </button>
        </div>
      </div>
    </aside>
  );
}
