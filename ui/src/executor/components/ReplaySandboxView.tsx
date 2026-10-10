import { Link } from "react-router-dom";

import type { ReplaySandboxBundle } from "../types.js";
import {
  REPLAY_SANDBOX_AUTHORITY_DISCLAIMER,
  REPLAY_SANDBOX_BANNER,
} from "../types.js";

type Props = {
  readonly replay_sandbox: ReplaySandboxBundle;
};

const STATE_LABEL = {
  candidate: "Candidate (simulation only)",
  blocked:   "Blocked",
  expired:   "Expired",
} as const;

export function ReplaySandboxView({ replay_sandbox }: Props) {
  const { candidate, projection, envelope, checks, audit_records } = replay_sandbox;
  const jobId = projection.source_job_id;
  const inspectHref = `/dashboard/executions/${encodeURIComponent(jobId)}/inspect`;
  const replayHistoryHref = `/dashboard/executions/${encodeURIComponent(jobId)}/replay-execution-history`;

  return (
    <div aria-label="Replay sandbox">
      <div
        role="status"
        className="rounded-lg border border-cyan-900/50 bg-cyan-950/30 p-4 text-sm text-cyan-100 mb-6"
      >
        <p className="font-medium">{REPLAY_SANDBOX_BANNER}</p>
        <p className="mt-2 text-xs text-cyan-200/80">{REPLAY_SANDBOX_AUTHORITY_DISCLAIMER}</p>
      </div>

      <section className="rounded-lg border border-gray-800/80 bg-gray-900/40 p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-200">Replay candidate</h2>
        <dl className="mt-3 grid gap-2 text-xs text-gray-400">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-gray-600">Sandbox ID</dt>
            <dd className="font-mono break-all text-gray-300">{candidate.replay_sandbox_id}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-gray-600">Execution ID</dt>
            <dd className="font-mono text-gray-300">{candidate.execution_id}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-gray-600">Capability</dt>
            <dd className="font-mono text-gray-300">{candidate.reconstructed_capability_id}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-gray-600">Replay state</dt>
            <dd className="text-gray-300">{STATE_LABEL[candidate.replay_state]}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-gray-600">Version</dt>
            <dd className="font-mono text-gray-300">{candidate.replay_version}</dd>
          </div>
        </dl>
        {replay_sandbox.unavailable_reason !== undefined && (
          <p className="mt-3 text-xs text-amber-200/90">{replay_sandbox.unavailable_reason}</p>
        )}
      </section>

      <section className="rounded-lg border border-gray-800/80 bg-gray-900/40 p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-200">Isolation envelope</h2>
        <p className="mt-2 text-xs text-gray-400">
          Status: {envelope.envelope_status} · non_authoritative:{" "}
          {envelope.non_authoritative ? "true" : "false"}
        </p>
        <p className="mt-1 font-mono text-xs text-gray-500 break-all">
          {envelope.sandbox_workspace_ref}
        </p>
      </section>

      <section className="rounded-lg border border-gray-800/80 bg-gray-900/40 p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-200">Sandbox checks</h2>
        <ul className="mt-3 space-y-2">
          {checks.map((check) => (
            <li
              key={check.check_id}
              className="text-xs text-gray-400 border-b border-gray-800/60 pb-2 last:border-0"
            >
              <span className={check.pass ? "text-emerald-400" : "text-amber-400"}>
                {check.pass ? "PASS" : "NOTE"}
              </span>{" "}
              {check.label}
              {check.note !== undefined && (
                <span className="block text-gray-500 mt-0.5">{check.note}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-gray-800/80 bg-gray-900/40 p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-200">Audit lineage</h2>
        <ul className="mt-3 space-y-1 text-xs font-mono text-gray-500">
          {audit_records.map((a) => (
            <li key={a.audit_id}>
              {a.event_kind}
              {a.note !== undefined ? ` — ${a.note}` : ""}
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-gray-500">
        <Link to={inspectHref} className="text-cyan-400/80 hover:text-cyan-300 underline">
          Inspect lineage →
        </Link>
        {" · "}
        <Link to={replayHistoryHref} className="text-cyan-400/80 hover:text-cyan-300 underline">
          Replay execution history →
        </Link>
        {" · read-only — simulation only; no production controls"}
      </p>
    </div>
  );
}
