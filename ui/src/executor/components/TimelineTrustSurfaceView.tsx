import { Link } from "react-router-dom";
import type { TimelineTrustSurfaceView } from "../types.js";
import { TimelineTrustEventCard } from "./TimelineTrustEventCard.js";

type Props = {
  readonly view: TimelineTrustSurfaceView;
};

const STATUS_LABEL: Record<
  TimelineTrustSurfaceView["projection"]["trust_status"],
  string
> = {
  available:   "Available",
  partial:     "Partial",
  unavailable: "Unavailable",
};

const SURFACE_TITLES: Record<
  TimelineTrustSurfaceView["surfaces"][number],
  string
> = {
  ordered_execution_stages:       "Ordered execution stages",
  stage_timing:                   "Stage timing",
  authority_checkpoints:          "Authority checkpoints",
  mutation_checkpoints:           "Mutation checkpoints",
  halt_boundaries:                "Halt boundaries",
  projection_lineage_references:  "Projection lineage references",
};

export function TimelineTrustSurfaceView({ view }: Props) {
  const { projection, events, timeline } = view;

  const authorityEvents = events.filter(
    (e) => e.kind === "stage_marker" && e.label.includes("Authority"),
  );
  const mutationEvents = events.filter(
    (e) => e.kind === "stage_marker" && e.label.includes("Mutation"),
  );
  const haltEvents = events.filter(
    (e) => e.kind === "refusal_point" || e.label.includes("Halt"),
  );
  const lineageEvents = events.filter((e) => e.kind === "lineage_anchor");

  return (
    <div aria-label="Timeline trust surface">
      <header className="mb-6">
        <Link
          to="/dashboard/executions"
          className="text-xs text-cyan-400 hover:text-cyan-300 mb-2 inline-block"
        >
          ← Recent executions
        </Link>
        <h2 className="text-xl font-semibold text-gray-100">
          Execution timeline — {projection.execution_id}
        </h2>
        <p className="mt-2 text-xs text-gray-500">
          Descriptive only — timeline does not re-execute lineage.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Status: {STATUS_LABEL[projection.trust_status]} · {projection.event_count}{" "}
          events · <span className="font-mono">{projection.trust_timeline_id}</span>
        </p>
        {view.unavailable_reason !== undefined && (
          <p className="mt-2 text-xs text-amber-200/90">{view.unavailable_reason}</p>
        )}
      </header>

      <div className="space-y-6">
        <section aria-labelledby="timeline-trust-stages">
          <h3
            id="timeline-trust-stages"
            className="text-sm font-semibold text-gray-200 mb-2"
          >
            {SURFACE_TITLES.ordered_execution_stages}
          </h3>
          <ol className="list-none m-0 p-0 space-y-2">
            {events
              .filter((e) => e.kind === "stage_marker" || e.kind === "state_transition")
              .map((event) => (
                <TimelineTrustEventCard key={event.event_id} event={event} />
              ))}
          </ol>
        </section>

        {authorityEvents.length > 0 && (
          <section aria-labelledby="timeline-trust-authority">
            <h3
              id="timeline-trust-authority"
              className="text-sm font-semibold text-gray-200 mb-2"
            >
              {SURFACE_TITLES.authority_checkpoints}
            </h3>
            <ol className="list-none m-0 p-0 space-y-2">
              {authorityEvents.map((event) => (
                <TimelineTrustEventCard key={event.event_id} event={event} />
              ))}
            </ol>
          </section>
        )}

        {mutationEvents.length > 0 && (
          <section aria-labelledby="timeline-trust-mutation">
            <h3
              id="timeline-trust-mutation"
              className="text-sm font-semibold text-gray-200 mb-2"
            >
              {SURFACE_TITLES.mutation_checkpoints}
            </h3>
            <ol className="list-none m-0 p-0 space-y-2">
              {mutationEvents.map((event) => (
                <TimelineTrustEventCard key={event.event_id} event={event} />
              ))}
            </ol>
          </section>
        )}

        {haltEvents.length > 0 && (
          <section aria-labelledby="timeline-trust-halt">
            <h3
              id="timeline-trust-halt"
              className="text-sm font-semibold text-gray-200 mb-2"
            >
              {SURFACE_TITLES.halt_boundaries}
            </h3>
            <ol className="list-none m-0 p-0 space-y-2">
              {haltEvents.map((event) => (
                <TimelineTrustEventCard key={event.event_id} event={event} />
              ))}
            </ol>
          </section>
        )}

        <section aria-labelledby="timeline-trust-decisions">
          <h3
            id="timeline-trust-decisions"
            className="text-sm font-semibold text-gray-200 mb-2"
          >
            Decision points
          </h3>
          <ol className="list-none m-0 p-0 space-y-2">
            {events
              .filter((e) => e.kind === "decision_point" || e.kind === "refusal_point")
              .map((event) => (
                <TimelineTrustEventCard key={event.event_id} event={event} />
              ))}
          </ol>
        </section>

        {lineageEvents.length > 0 && (
          <section aria-labelledby="timeline-trust-lineage">
            <h3
              id="timeline-trust-lineage"
              className="text-sm font-semibold text-gray-200 mb-2"
            >
              {SURFACE_TITLES.projection_lineage_references}
            </h3>
            <ol className="list-none m-0 p-0 space-y-2">
              {lineageEvents.map((event) => (
                <TimelineTrustEventCard key={event.event_id} event={event} />
              ))}
            </ol>
          </section>
        )}

        <section className="text-xs text-gray-600 border-t border-gray-800/60 pt-4">
          <p>
            Stage timing: {timeline.entries.length} stage(s) · terminal{" "}
            {timeline.terminal_stage}
          </p>
          <p className="mt-1 font-mono">
            trace:{projection.trace_reference} · history:
            {projection.decision_history_reference}
          </p>
        </section>
      </div>

      <nav className="mt-8 flex flex-wrap gap-3 text-xs">
        <Link
          to={`/dashboard/executions/${encodeURIComponent(projection.execution_id)}/history`}
          className="text-cyan-400/80 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 inline-flex items-center"
        >
          Decision history →
        </Link>
        <Link
          to={`/dashboard/executions/${encodeURIComponent(projection.execution_id)}/inspect`}
          className="text-cyan-400/80 hover:text-cyan-300 underline-offset-2 hover:underline min-h-11 inline-flex items-center"
        >
          Inspect lineage →
        </Link>
      </nav>
    </div>
  );
}
