/**
 * Governed Decision Server — fresh, projection-only Portal host (Phase E4).
 *
 * Canonical design: docs/architecture/USESTEADY_GOVERNED_DECISION_SURFACE_V1.md
 *
 * A small, fresh server that mounts the E3 transport (registerGovernedRoutes) and
 * serves the single-file projection-only UI. It deliberately does NOT reuse the
 * legacy server.ts / React app — this is a clean surface over the kernel.
 *
 * ── Posture ───────────────────────────────────────────────────────────────────
 *
 *   Local, single-user (binds 127.0.0.1), mirroring the existing localhost app
 *   model. The approver defaults to "portal". Per the E3 header, before any
 *   network-reachable, multi-user deployment the mounting layer MUST add
 *   authentication, per-request tenant-scoped storage, and a server-bound approver
 *   from the authenticated identity. This file is the LOCAL host only.
 *
 *   Usage:  npx tsx src/governed-decision/server.ts
 *           (GOVERNED_PORT, GOVERNED_STORE_DIR, GOVERNED_APPROVER override)
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { registerGovernedRoutes, type GovernedApiDeps } from "./http.js";
import { makeSandboxedFsExecutor, makeFsRealityProbe, makeBoundaryJsonlSink } from "./runner.js";
import { DEFAULT_CURSOR_POLICY } from "../shell/defaults.js";

export function createGovernedServer(deps: GovernedApiDeps = {}): express.Express {
  const app = express();
  app.use(express.json({ limit: "64kb" }));

  // Serve the fresh projection-only UI (single static file; no build step).
  const here = dirname(fileURLToPath(import.meta.url));
  const uiPath = join(here, "web", "index.html");
  app.get("/", (_req, res) => {
    res.type("html").send(readFileSync(uiPath, "utf8"));
  });

  // Mount the E3 transport. Authority still lives only in the human ratify call.
  registerGovernedRoutes(app, deps);
  return app;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    // Normalize both paths before comparing: on Windows `argv[1]` is frequently a
    // relative or differently-cased path, so a strict string compare against the
    // resolved module URL would fail and the documented entrypoint would never
    // start a server.
    const self = resolve(fileURLToPath(import.meta.url));
    const invoked = resolve(entry);
    return process.platform === "win32"
      ? self.toLowerCase() === invoked.toLowerCase()
      : self === invoked;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const port = Number(process.env["GOVERNED_PORT"] ?? 4173);
  const storeDir = process.env["GOVERNED_STORE_DIR"];
  const approver = process.env["GOVERNED_APPROVER"];

  // Execution is OFF by default and is purely an OPERATOR/SERVER decision: it is
  // enabled only when BOTH GOVERNED_EXECUTE=1 and GOVERNED_WORKSPACE=<root> are
  // set in the server's environment. It is never derived from request input, so a
  // client can never turn on actuation. Without both, execution stays unavailable.
  const executeEnabled = process.env["GOVERNED_EXECUTE"] === "1";
  const workspace = process.env["GOVERNED_WORKSPACE"];
  let executor: GovernedApiDeps["executor"];
  let realityProbe: GovernedApiDeps["realityProbe"];
  if (executeEnabled) {
    if (workspace === undefined || workspace.trim().length === 0) {
      // eslint-disable-next-line no-console
      console.error(
        "[governed] GOVERNED_EXECUTE=1 requires GOVERNED_WORKSPACE=<root>; execution stays disabled",
      );
    } else {
      executor = makeSandboxedFsExecutor(workspace);
      // Pair an INDEPENDENT reality probe over the SAME workspace: observation
      // verifies on disk exactly what was actuated (reality's final veto).
      realityProbe = makeFsRealityProbe(workspace);
      // eslint-disable-next-line no-console
      console.log(`[governed] execution ENABLED (sandboxed) + reality probe -> ${resolve(workspace)}`);
    }
  }

  // Evidence pre-state sensor (L3.S1): bind the basis to the SAME workspace the
  // executor actuates, whenever one is named — even if execution stayed disabled
  // the workspace names the reality this server's decisions are about.
  const basisWorkspace = workspace !== undefined && workspace.trim().length > 0 ? workspace : undefined;

  // Synthetic ratifier seat (S1 / INV-SO-3): permitted ONLY when the operator
  // sets GOVERNED_SYNTHETIC_RATIFIER=1 in the SERVER environment — never derived
  // from request input (same pattern as GOVERNED_EXECUTE). Without it, a
  // persona-namespaced approver blocks every ratification on this surface.
  const allowSyntheticRatifier = process.env["GOVERNED_SYNTHETIC_RATIFIER"] === "1";
  if (allowSyntheticRatifier) {
    // eslint-disable-next-line no-console
    console.log("[governed] synthetic (persona) ratifier ENABLED — build lane only");
  }

  const sinkDir = storeDir ?? join(homedir(), ".usesteady", "governed-decisions");
  const app = createGovernedServer({
    ...(storeDir !== undefined ? { storeDir } : {}),
    ...(approver !== undefined ? { approver } : {}),
    ...(allowSyntheticRatifier ? { allowSyntheticRatifier } : {}),
    ...(executor !== undefined ? { executor } : {}),
    ...(realityProbe !== undefined ? { realityProbe } : {}),
    ...(basisWorkspace !== undefined ? { basisWorkspace } : {}),
    // Process-local receiving-boundary sink. Server-bound; request input
    // cannot select or forge it.
    boundarySink: makeBoundaryJsonlSink(join(sinkDir, "boundary-observations.jsonl")),
    // OCD policy sensor (L3.S2): this local host enforces the same default
    // policy the CLI shell does — record it in the basis (server-bound, never
    // from request input).
    basisPolicy: DEFAULT_CURSOR_POLICY,
  });
  app.listen(port, "127.0.0.1", () => {
    // eslint-disable-next-line no-console
    console.log(`[governed] projection-only Portal on http://127.0.0.1:${port}`);
  });
}
