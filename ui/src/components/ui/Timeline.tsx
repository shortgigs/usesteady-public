/**
 * Timeline — shared vertical-timeline primitive.
 *
 * Single source of truth for UseSteady's vertical timeline visual language:
 * rail connector, status dot (tone-driven), title, optional timestamp, and
 * optional detail/children slot.
 *
 * Design rules:
 *   - Uses STATUS_TONE from helpers/status-tone.ts — no ad-hoc colors.
 *   - Gray-950 base; electric cyan (#00D4FF / accent tone) for active steps.
 *   - Accessible list semantics: <ol> with role/aria-label on the container.
 *   - Small, generic API. Pass `items` to <Timeline> or compose with
 *     <Timeline.Item> children for more control.
 *
 * Usage:
 *   // Array-prop form
 *   <Timeline items={[{ id, title, tone, timestamp, detail }]} aria-label="…" />
 *
 *   // Children form
 *   <Timeline aria-label="…">
 *     <Timeline.Item id="a" title="Step A" tone="success" timestamp="12:01:00" />
 *     <Timeline.Item id="b" title="Step B" tone="neutral" detail={<p>…</p>} />
 *   </Timeline>
 */

import type { ReactNode } from "react";
import { STATUS_TONE } from "../../helpers/status-tone.js";
import type { StatusTone } from "../../helpers/status-tone.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type TimelineItem = {
  /** Stable React key. */
  id: string;
  /** Primary label — may be a ReactNode for rich content. */
  title: ReactNode;
  /** Status tone drives the dot color. Defaults to "neutral". */
  tone?: StatusTone;
  /** Optional pre-formatted timestamp string (displayed mono, secondary). */
  timestamp?: string;
  /** Secondary content below the title row. */
  detail?: ReactNode;
  /**
   * Optional icon node rendered inside the dot area.
   * When provided the tone dot is replaced by this element.
   */
  icon?: ReactNode;
};

// ─── Timeline.Item ────────────────────────────────────────────────────────────

type ItemProps = TimelineItem & {
  /** When true the vertical rail connector below the dot is hidden. */
  isLast?: boolean;
};

function Item({ title, tone = "neutral", timestamp, detail, icon, isLast }: ItemProps) {
  const dotClass = STATUS_TONE[tone].dot;

  return (
    <li className="relative pl-6 pb-4 last:pb-0">
      {/* Vertical rail */}
      {!isLast && (
        <span
          className="absolute left-[7px] top-3.5 bottom-0 w-px bg-gray-800"
          aria-hidden="true"
        />
      )}

      {/* Status dot or custom icon */}
      {icon !== undefined ? (
        <span className="absolute left-0 top-1" aria-hidden="true">
          {icon}
        </span>
      ) : (
        <span
          className={`absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full shrink-0 ${dotClass}`}
          aria-hidden="true"
        />
      )}

      {/* Content */}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {timestamp !== undefined && (
            <time className="font-mono text-[10px] text-gray-500 shrink-0 tabular-nums">
              {timestamp}
            </time>
          )}
          <span className="text-sm text-gray-200 min-w-0">{title}</span>
        </div>
        {detail !== undefined && (
          <div className="mt-0.5 text-xs text-gray-500 min-w-0">{detail}</div>
        )}
      </div>
    </li>
  );
}

// ─── Timeline (container) ─────────────────────────────────────────────────────

type TimelineProps = {
  /** Items to render. When supplied, children are ignored. */
  items?: TimelineItem[];
  /** Accessible label for the list. */
  "aria-label"?: string;
  children?: ReactNode;
};

export function Timeline({ items, children, "aria-label": ariaLabel }: TimelineProps) {
  return (
    <ol className="list-none m-0 p-0" aria-label={ariaLabel}>
      {items !== undefined
        ? items.map((item, i) => (
            <Item key={item.id} {...item} isLast={i === items.length - 1} />
          ))
        : children}
    </ol>
  );
}

/** Static sub-component for children composition. */
Timeline.Item = Item;
