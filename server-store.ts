/**
 * PI-4 Iteration 1: Live-run store — file-backed persistence for active WorkflowRuns.
 *
 * ── Purpose ────────────────────────────────────────────────────────────────────
 *
 *   Replaces the raw in-memory Map in server.ts with a Map that is backed by
 *   one JSON file per active run in {storeDir}/live-runs/{runId}.json.
 *
 *   On server startup, loadLiveRuns() repopulates the in-memory map from disk
 *   so active runs survive server restart or tsx crash.
 *
 * ── File layout ────────────────────────────────────────────────────────────────
 *
 *   {storeDir}/
 *     live-runs/
 *       {runId}.json    # { run: WorkflowRun, workspaceRoot: string }
 *     envelopes.log     # existing UCP log — unchanged by this module
 *     index.json        # existing UCP index — unchanged by this module
 *
 * ── Design invariants ──────────────────────────────────────────────────────────
 *
 *   1. WorkflowPlugins (adapter class instances) are NOT serialized.
 *      On restore, plugins are recreated from workspaceRoot using the same
 *      code path as POST /api/workflow/start.
 *   2. Writes are atomic: write to {runId}.json.tmp, then rename.
 *      A crash mid-write leaves at most a stale .tmp file, never a corrupt .json.
 *   3. A corrupt or missing run file is skipped silently; other runs are unaffected.
 *   4. deleteLiveRun is called after maybePersistTerminal so the live-run file
 *      is cleaned up once the terminal run is in the UCP history log.
 *   5. This module has no authority. It only persists and restores run state.
 *      It never transitions phases, skips approvals, or affects execution.
 */

import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";

import { CursorInProcessAdapter } from "./src/cursor/adapters/inprocess-adapter.js";
import { ClaudeStubAdapter }      from "./src/claude/adapters/stub-adapter.js";

import type { WorkflowRun, WorkflowPlugins } from "./src/workflow/types.js";
import type { BridgeApprovalProvenanceState } from "./src/portal-bridge/approval-provenance/index.js";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * LiveRunEntry — the shape the server holds in memory for each active run.
 *
 * Replaces the server.ts-local RunEntry definition. The only difference
 * from the old RunEntry is that this type is the canonical definition and
 * imported by server.ts rather than defined there.
 *
 * `bridgeApprovalProvenance` (S2) is in-memory only — same lifetime as the
 * live Map entry. It accumulates Portal bridge `decided_by` / `decided_at`
 * across multi-step confirms so web can resolve execution-return approval
 * fields the same way CLI does. Not serialized to live-runs/*.json (plugins
 * are also excluded); restart mid-run falls back to Mode B handoff timestamps.
 */
export type LiveRunEntry = {
  run:             WorkflowRun;
  plugins:         WorkflowPlugins;
  workspaceRoot:   string;
  execSessionId?:  string;
  /** Per-run Portal bridge approval provenance (web confirm S2). */
  bridgeApprovalProvenance?: BridgeApprovalProvenanceState;
};

/** Disk-only shape — plugins are excluded from serialization. */
type LiveRunDisk = {
  run:           WorkflowRun;
  workspaceRoot: string;
};

// ─── Path helpers ─────────────────────────────────────────────────────────────

function liveRunDir(storeDir: string): string {
  return join(storeDir, "live-runs");
}

function liveRunPath(storeDir: string, runId: string): string {
  return join(liveRunDir(storeDir), `${runId}.json`);
}

function ensureLiveRunDir(storeDir: string): void {
  const dir = liveRunDir(storeDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─── Plugin factory (mirrors POST /api/workflow/start) ─────────────────────

function makePlugins(workspaceRoot: string): WorkflowPlugins {
  const adapter = new CursorInProcessAdapter(workspaceRoot);
  return {
    cursor: adapter,
    claude: ClaudeStubAdapter.accepted("web-api-stub"),
    fs:     adapter,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Persist an active run to disk (atomic write).
 *
 * Called after every store.set in server.ts. Never throws — errors are
 * logged to stderr and swallowed so persistence failure cannot block a
 * workflow transition.
 */
export function saveLiveRun(
  storeDir:      string,
  runId:         string,
  run:           WorkflowRun,
  workspaceRoot: string,
): void {
  try {
    ensureLiveRunDir(storeDir);
    const disk: LiveRunDisk = { run, workspaceRoot };
    const tmpPath   = liveRunPath(storeDir, runId) + ".tmp";
    const finalPath = liveRunPath(storeDir, runId);
    writeFileSync(tmpPath, JSON.stringify(disk), "utf8");
    renameSync(tmpPath, finalPath);
  } catch (err) {
    process.stderr.write(`[live-run-store] save failed for ${runId}: ${String(err)}\n`);
  }
}

/**
 * Remove a run's live-run file after it has been persisted to UCP history.
 *
 * Called from maybePersistTerminal in server.ts. Never throws.
 */
export function deleteLiveRun(storeDir: string, runId: string): void {
  try {
    const path = liveRunPath(storeDir, runId);
    if (existsSync(path)) unlinkSync(path);
  } catch (err) {
    process.stderr.write(`[live-run-store] delete failed for ${runId}: ${String(err)}\n`);
  }
}

/**
 * Load all active runs from disk into a Map.
 *
 * Called once at server startup to repopulate the in-memory store.
 * Corrupt or missing files are skipped with a stderr warning.
 * Returns an empty Map if the live-runs directory does not exist.
 */
export function loadLiveRuns(storeDir: string): Map<string, LiveRunEntry> {
  const dir    = liveRunDir(storeDir);
  const result = new Map<string, LiveRunEntry>();

  if (!existsSync(dir)) return result;

  let files: string[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith(".json") && !f.endsWith(".tmp.json"));
  } catch (err) {
    process.stderr.write(`[live-run-store] readdirSync failed: ${String(err)}\n`);
    return result;
  }

  for (const file of files) {
    const runId = file.replace(/\.json$/, "");
    try {
      const raw   = readFileSync(join(dir, file), "utf8");
      const disk  = JSON.parse(raw) as LiveRunDisk;
      const entry: LiveRunEntry = {
        run:           disk.run,
        plugins:       makePlugins(disk.workspaceRoot),
        workspaceRoot: disk.workspaceRoot,
      };
      result.set(runId, entry);
      process.stdout.write(`[live-run-store] restored ${runId} (${disk.run.phase})\n`);
    } catch (err) {
      process.stderr.write(`[live-run-store] skipping corrupt file ${file}: ${String(err)}\n`);
    }
  }

  return result;
}
