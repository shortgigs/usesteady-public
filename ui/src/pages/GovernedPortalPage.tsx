/**
 * Governed Decision Portal (E4) — a PROJECTION-ONLY surface over the E3 API.
 *
 * Canonical posture (USESTEADY_KERNEL_CANONICAL_ARCHITECTURE_V1): the Portal is a
 * projection. It never invents authority and never fabricates a value. Every
 * record section is rendered with its gauge tag — Connected, Derived, or
 * Unavailable — exactly as the kernel projects it. The only write this surface
 * performs is the human ratification (Approve / Reject), which is the product's
 * sole authority signal; the machine's draft is a proposal with no authority.
 *
 * If the governed routes are not mounted (GOVERNED_PORTAL is unset on the dev
 * server), list/create calls fail and the page says so honestly — it does not
 * pretend the surface exists.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDraft,
  getRecord,
  listThreads,
  ratifyThread,
  type EpistemicObject,
  type GovernedRecordPayload,
  type ProjectedSection,
  type ThreadSummary,
} from "../api/governed.js";

// ─── Gauge tag (the gauge law, rendered) ──────────────────────────────────────

function GaugeTag({ status }: { status: ProjectedSection["status"] }) {
  const styles: Record<ProjectedSection["status"], string> = {
    connected: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    derived: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
    unavailable: "bg-gray-700/30 text-gray-400 border-gray-600/40",
  };
  return (
    <span
      data-testid={`gauge-${status}`}
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function EpistemicTag({ status }: { status: EpistemicObject["status"] }) {
  const certified = status === "REALITY_OBSERVED";
  const unknown = status === "UNKNOWN";
  const cls = certified
    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
    : unknown
      ? "bg-gray-700/30 text-gray-400 border-gray-600/40"
      : "bg-violet-500/10 text-violet-300 border-violet-500/30";
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ${cls}`}>
      {status}
    </span>
  );
}

// ─── Section row ──────────────────────────────────────────────────────────────

function SectionRow({ section }: { section: ProjectedSection }) {
  return (
    <div className="flex flex-col gap-1 border-b border-gray-800/60 py-2" data-testid={`section-${section.stage}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-300">
          {section.stage}
        </span>
        <GaugeTag status={section.status} />
      </div>
      {section.status === "unavailable" ? (
        <p className="text-xs italic text-gray-500">{section.reason}</p>
      ) : (
        <p className="break-words font-mono text-xs text-gray-200">{section.display}</p>
      )}
      {section.status === "derived" && section.derivedFrom.length > 0 && (
        <p className="text-[10px] text-cyan-500/70">
          derived from: {section.derivedFrom.join(", ")}
        </p>
      )}
    </div>
  );
}

// ─── Record detail ────────────────────────────────────────────────────────────

function RecordDetail({
  payload,
  onRatify,
  ratifying,
}: {
  payload: GovernedRecordPayload;
  onRatify: (decision: "approved" | "rejected") => void;
  ratifying: boolean;
}) {
  const { envelope, projection, epistemic } = payload;
  const isDraft = envelope.kind === "draft";

  // Ratifiable is DERIVED from the projection, not invented: a draft is only
  // ratifiable once the kernel has bound a constitution stamp (which requires a
  // connected understanding). When the constitution section is unavailable there
  // is no fingerprint to ratify, so the kernel would refuse — we say so honestly
  // rather than offer an authority action that always fails.
  const constitution = projection.sections.find((s) => s.stage === "constitution");
  const ratifiable = constitution !== undefined && constitution.status !== "unavailable";

  return (
    <div data-testid="record-detail">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-widest text-cyan-500/80">
            {isDraft ? "Draft — machine proposal" : "Final — ratified"}
          </p>
          <h2 className="break-words text-lg font-bold text-white">{projection.humanIntent.goal}</h2>
          <p className="mt-0.5 font-mono text-[10px] text-gray-500">{projection.recordId}</p>
        </div>
      </div>

      {projection.priorObservationRef && (
        <p className="mb-3 rounded border border-cyan-900/50 bg-cyan-950/20 px-2 py-1 font-mono text-[10px] text-cyan-300">
          loop: basis fed by prior observation {projection.priorObservationRef.slice(0, 12)}…
        </p>
      )}

      <div className="rounded-lg border border-gray-800 bg-gray-950/40 px-4">
        {projection.sections.map((s) => (
          <SectionRow key={s.stage} section={s} />
        ))}
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Epistemic objects
        </p>
        <div className="flex flex-col gap-1.5">
          {epistemic.map((o) => (
            <div
              key={o.kind}
              className="flex items-start justify-between gap-2 rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5"
            >
              <div className="min-w-0">
                <span className="text-xs font-semibold capitalize text-gray-200">{o.kind}</span>
                {o.statement && (
                  <p className="break-words text-[11px] text-gray-400">{o.statement}</p>
                )}
              </div>
              <EpistemicTag status={o.status} />
            </div>
          ))}
        </div>
      </div>

      {isDraft && !ratifiable && (
        <div
          data-testid="not-ratifiable"
          className="mt-5 rounded-lg border border-gray-700/50 bg-gray-900/40 p-3 text-xs text-gray-400"
        >
          This draft cannot be ratified: the kernel could not bind a constitution stamp
          (understanding is unavailable). There is nothing to ratify — revise the goal so the
          deterministic parser can classify it.
        </div>
      )}

      {isDraft && ratifiable && (
        <div className="mt-5 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3">
          <p className="mb-2 text-xs text-amber-200">
            Human ratification — the sole authority signal. The machine proposed; you decide.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              data-testid="ratify-approve"
              disabled={ratifying}
              onClick={() => onRatify("approved")}
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 sm:w-auto"
            >
              Approve
            </button>
            <button
              type="button"
              data-testid="ratify-reject"
              disabled={ratifying}
              onClick={() => onRatify("rejected")}
              className="w-full rounded-md border border-gray-600 px-4 py-2 text-sm font-semibold text-gray-200 transition-colors hover:bg-gray-800 disabled:opacity-50 sm:w-auto"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Create form ──────────────────────────────────────────────────────────────

function CreateForm({ onCreated }: { onCreated: (p: GovernedRecordPayload) => void }) {
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const trimmed = goal.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const payload = await createDraft({ goal: trimmed });
      setGoal("");
      onCreated(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [goal, onCreated]);

  return (
    <div className="mb-4 rounded-lg border border-gray-800 bg-gray-950/40 p-3">
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-400">
        New governed decision
      </label>
      <textarea
        data-testid="goal-input"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="State the goal — e.g. create a docs/ folder"
        rows={2}
        className="w-full resize-none rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-base text-gray-100 placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
      />
      {error && <p className="mt-1 text-xs text-amber-300">{error}</p>}
      <button
        type="button"
        data-testid="create-draft"
        disabled={busy || goal.trim().length === 0}
        onClick={() => void submit()}
        className="mt-2 rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
      >
        {busy ? "Proposing…" : "Propose draft"}
      </button>
    </div>
  );
}

// ─── Thread list ──────────────────────────────────────────────────────────────

function ThreadRow({
  thread,
  active,
  onSelect,
}: {
  thread: ThreadSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const ratified = thread.ratifiedDecision !== null;
  return (
    <button
      type="button"
      data-testid="thread-row"
      onClick={onSelect}
      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
        active
          ? "border-cyan-500/50 bg-cyan-500/10"
          : "border-gray-800 bg-gray-950/40 hover:bg-gray-900/60"
      }`}
    >
      <p className="truncate text-sm font-medium text-gray-100">{thread.goal}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wider text-gray-500">
        {ratified ? (
          <span
            className={
              thread.ratifiedDecision === "approved" ? "text-emerald-400" : "text-gray-400"
            }
          >
            ratified · {thread.ratifiedDecision}
          </span>
        ) : (
          <span className="text-amber-400">draft · awaiting ratification</span>
        )}
      </p>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function GovernedPortalPage() {
  const [threads, setThreads] = useState<readonly ThreadSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GovernedRecordPayload | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [ratifying, setRatifying] = useState(false);

  // Mirror of the currently-selected threadId, readable synchronously inside
  // async callbacks. Guards against a stale ratify/select response clobbering a
  // newer selection (the operator can switch threads mid-request).
  const selectedThreadRef = useRef<string | null>(null);
  useEffect(() => {
    selectedThreadRef.current = selected?.envelope.threadId ?? null;
  }, [selected]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await listThreads();
      setThreads(res.threads);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Monotonic request id so out-of-order getRecord responses cannot clobber a
  // newer selection (rapid thread switching).
  const selectSeqRef = useRef(0);

  // Select the most informative record of a thread: the final if ratified, else
  // the draft. Always re-fetched fresh so we project current stored truth.
  const selectThread = useCallback(async (thread: ThreadSummary) => {
    const recordId = thread.finalRecordId ?? thread.draftRecordId;
    if (!recordId) return;
    const seq = ++selectSeqRef.current;
    setSelectError(null);
    try {
      const payload = await getRecord(recordId);
      if (seq === selectSeqRef.current) setSelected(payload);
    } catch (e) {
      if (seq === selectSeqRef.current) {
        setSelectError(e instanceof Error ? e.message : String(e));
        setSelected(null);
      }
    }
  }, []);

  const handleCreated = useCallback(
    (payload: GovernedRecordPayload) => {
      // Invalidate any in-flight selectThread so it can't overwrite the new draft.
      ++selectSeqRef.current;
      setSelected(payload);
      void refresh();
    },
    [refresh],
  );

  const handleRatify = useCallback(
    async (decision: "approved" | "rejected") => {
      if (!selected) return;
      // Capture the thread being ratified. The operator can switch threads while
      // the request is in flight; a stale response must NOT clobber a newer
      // selection. Functional updates apply the result only when the current
      // selection is still this thread.
      const ratifiedThreadId = selected.envelope.threadId;
      setRatifying(true);
      setSelectError(null);
      try {
        const finalPayload = await ratifyThread(ratifiedThreadId, decision);
        if (selectedThreadRef.current === ratifiedThreadId) {
          // Invalidate any in-flight selectThread so it can't overwrite the final.
          ++selectSeqRef.current;
          setSelected(finalPayload);
        }
        await refresh();
      } catch (e) {
        // Only surface the error if the operator is still looking at this thread.
        if (selectedThreadRef.current === ratifiedThreadId) {
          setSelectError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        setRatifying(false);
      }
    },
    [selected, refresh],
  );

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <header className="mb-6">
        <p className="mb-1 text-xs uppercase tracking-widest text-cyan-500/80">
          Constitutional execution kernel
        </p>
        <h1 className="text-2xl font-bold text-white">Governed decisions</h1>
        <p className="mt-2 text-sm text-gray-400">
          A projection of the kernel. Models propose, humans ratify, the core certifies. Every
          value is Connected, Derived, or Unavailable — never invented.
        </p>
      </header>

      <div className="flex flex-col gap-6 md:flex-row">
        {/* Left: create + thread list */}
        <div className="md:w-72 md:flex-none">
          <CreateForm onCreated={handleCreated} />

          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Threads
          </p>

          {loading && (
            <p className="text-sm text-gray-500" role="status">
              Loading…
            </p>
          )}

          {listError && (
            <div
              data-testid="list-error"
              className="rounded border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-100"
            >
              <p>Governed surface unavailable: {listError}</p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="mt-2 text-cyan-400 underline hover:text-cyan-300"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !listError && threads.length === 0 && (
            <p className="text-sm text-gray-500" data-testid="empty-threads">
              No decisions yet. Propose one above.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            {threads.map((t) => (
              <ThreadRow
                key={t.threadId}
                thread={t}
                active={selected?.envelope.threadId === t.threadId}
                onSelect={() => void selectThread(t)}
              />
            ))}
          </div>
        </div>

        {/* Right: selected record projection */}
        <div className="min-w-0 flex-1">
          {selectError && (
            <p className="mb-3 text-xs text-amber-300">{selectError}</p>
          )}
          {selected ? (
            <RecordDetail payload={selected} onRatify={(d) => void handleRatify(d)} ratifying={ratifying} />
          ) : (
            <p className="text-sm text-gray-600" data-testid="no-selection">
              Select a thread, or propose a new decision, to see its projection.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
