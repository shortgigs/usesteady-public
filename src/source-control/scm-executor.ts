// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * SCM executor bridge — adapts the kernel's approved `ExecutableOperation[]` into
 * a single pull/merge request via a `SourceControlProvider`, returning an honest
 * `ExecutorOutcome` so the execution stage's `ranWhatWasApproved` certification
 * stays structural and truthful.
 *
 * ── Faithfulness rules (so certification is honest) ────────────────────────────
 *
 *   - `create_file` ops become file changes committed in ONE PR, in approved
 *     order. If the PR is opened successfully, those ops are reported `ran`.
 *   - `replace_in_file` ops (L4.S2) become hash-pinned `update` changes when the
 *     provider declares the `updateFiles` capability; otherwise each is
 *     pre-failed honestly. The provider enforces the destructive-op scrutiny
 *     (must-exist at the pinned base commit + prior-content hash gate); a path
 *     the provider skipped is reported `failed` with the provider's reason.
 *   - `rename_file` ops (R2) become hash-pinned `rename` changes when the
 *     provider declares the `renameFiles` capability; otherwise each is
 *     pre-failed honestly (a create-at-destination without removing the source
 *     would be a copy nobody approved, not a rename). A rename occupies TWO
 *     tree paths — the deleted source and the written destination — so both
 *     participate in the duplicate-target check, and both must be safe repo
 *     paths. The provider enforces the source pre-state hash gate and the
 *     destination no-clobber at the pinned base commit.
 *   - `create_dir` ops cannot be represented in a git commit (an empty directory
 *     has no tracked object). Rather than fabricate a `.gitkeep` that nobody
 *     approved, the executor reports each `create_dir` as `failed` with an honest
 *     detail. If any op fails, `ranOps` no longer equals the approved ops and the
 *     execution stage certifies `ranWhatWasApproved: false` — the drift is
 *     captured, not concealed.
 *   - Any unsafe repo path (absolute, traversal, backslash, empty segment) is
 *     refused lexically BEFORE contacting the provider; that op is `failed`.
 *   - If the provider throws, every would-run op is reported `failed` with the
 *     provider error message (the token is never part of that message).
 *
 *   `deterministic` is always `false`: this actuator performs uncontrolled
 *   network IO.
 *
 * ── Authority ──────────────────────────────────────────────────────────────────
 *
 *   None. This bridge runs only what the execution stage hands it (the ratified,
 *   fingerprint-bound ops). It adds no operation and reorders nothing.
 */

import { createHash } from "node:crypto";
import { posix } from "node:path";
import type { ExecutableOperation, ExecutionOpResult } from "../governed-decision/types.js";
import type { DeterministicExecutor, ExecutorOutcome } from "../governed-decision/stages/execution.js";
import type { SourceControlProvider, ScmFileChange } from "./provider.js";

export const DEFAULT_BRANCH_PREFIX = "usesteady/";

export type ScmActuationConfig = {
  readonly provider: SourceControlProvider;
  /**
   * Prefix for the content-addressed head branch (default `usesteady/`). The
   * actual branch is `prefix + deriveScmBranch(approvedOps)`, so the SCM reality
   * probe (constructed separately) derives the SAME branch from the execution
   * results without any shared decision id. Distinct op sets get distinct
   * branches; identical op sets collide deterministically and fail closed on the
   * second actuation (acceptable: the single-ratification constraint upstream
   * prevents re-ratifying the same thread).
   */
  readonly branchPrefix?: string;
  /** Target branch; omitted -> provider default branch. */
  readonly baseBranch?: string;
  readonly title?: string;
  readonly body?: string;
  readonly commitMessage?: string;
};

/**
 * Deterministically derive a head branch name from the approved operations.
 * Content-addressed (SHA-256 over kind/path/identifying content, order-
 * sensitive) so the executor and the reality probe independently arrive at the
 * same branch.
 *
 * INVARIANT: the probe core (`scm-reality-core.ts`) re-derives the branch by
 * calling THIS function over `execution.results[].op` — if you change the hash
 * basis here, both sides change together (single definition, no drift). Every
 * op-kind-specific field that distinguishes two operations must be folded in,
 * or two distinct op sets would collide on one branch.
 */
export function deriveScmBranch(
  ops: readonly ExecutableOperation[],
  prefix: string = DEFAULT_BRANCH_PREFIX,
): string {
  const h = createHash("sha256");
  for (const op of ops) {
    h.update(op.kind);
    h.update("\0");
    h.update(op.path);
    h.update("\0");
    if (op.kind === "create_file") h.update(op.content);
    if (op.kind === "replace_in_file") {
      h.update(op.find);
      h.update("\0");
      h.update(op.replaceWith);
      h.update("\0");
      h.update(op.expectedPriorSha256);
      h.update("\0");
      h.update(op.expectedPostSha256);
    }
    if (op.kind === "rename_file") {
      h.update(op.toPath);
      h.update("\0");
      h.update(op.expectedPriorSha256);
    }
    h.update("\0\0");
  }
  return `${prefix}${h.digest("hex").slice(0, 16)}`;
}

/**
 * Lexically validate AND normalize a repo-relative path. Returns the normalized
 * repo path (forward slashes) on success, or `null` if it is unsafe.
 *
 * Normalization mirrors the FS executor's `relSafeParts` (resolve + relative) so
 * the SCM bridge accepts exactly what the filesystem actuator accepts — kernel
 * parity. POSIX resolution is used (not the platform `path`) so the produced git
 * path always uses `/`, regardless of the host OS:
 *   - `./docs/x.md`  -> `docs/x.md`     (leading `./` stripped)
 *   - `a/../utils`   -> `utils`         (non-escaping `..` collapsed)
 *   - `../escape`    -> null            (escapes the repo root)
 *   - `/etc/passwd`  -> null            (absolute)
 *   - `a\b`          -> null            (backslash: invalid in a git path)
 *
 * No filesystem access — purely structural, because the actuator commits via REST
 * and never touches a local working tree.
 */
export function safeRepoPath(path: string): string | null {
  if (typeof path !== "string" || path.trim().length === 0) return null;
  if (path.includes("\\")) return null; // backslash is not a valid git path separator
  if (posix.isAbsolute(path)) return null; // refuse absolute (leading "/")
  if (/^[A-Za-z]:/.test(path)) return null; // refuse drive-letter absolute
  const target = posix.resolve("/__root__", path);
  const rel = posix.relative("/__root__", target);
  if (rel.length === 0) return null; // resolves to the repo root itself
  if (rel === ".." || rel.startsWith("../") || posix.isAbsolute(rel)) return null; // escape
  const parts = rel.split("/").filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  for (const seg of parts) {
    if (seg === "..") return null; // defense in depth
  }
  return parts.join("/");
}

/**
 * Build an async `DeterministicExecutor` that actuates the approved ops as one PR.
 */
export function makeScmExecutor(config: ScmActuationConfig): DeterministicExecutor {
  return async (approvedOps: readonly ExecutableOperation[]): Promise<ExecutorOutcome> => {
    if (!config.provider.capabilities.openPullRequest) {
      return {
        ranOps: [],
        results: approvedOps.map((op) => ({
          op: { ...op },
          status: "failed" as const,
          detail: `provider ${config.provider.id} does not support openPullRequest`,
        })),
        deterministic: false,
      };
    }

    // Normalize each op's path(s) once (kernel-parity normalization). A rename
    // carries a second path — its destination — normalized with the same rule.
    const normalized = approvedOps.map((op) => ({
      op,
      safe: safeRepoPath(op.path),
      safeTo: op.kind === "rename_file" ? safeRepoPath(op.toPath) : null,
    }));

    // Count NORMALIZED committable paths. A git tree keeps one entry per path,
    // so two ops touching the same resolved path cannot both faithfully land in
    // one commit (the last would silently win). Marking both ran would be a
    // false certification — so duplicates are failed honestly. A rename touches
    // TWO tree paths (deleted source + written destination); both count, but
    // only when the provider can actually actuate renames — a pre-failed rename
    // never reaches the commit, so its paths must not poison other ops.
    const canRename = config.provider.capabilities.renameFiles;
    const fileCount = new Map<string, number>();
    const bump = (p: string) => fileCount.set(p, (fileCount.get(p) ?? 0) + 1);
    for (const { op, safe, safeTo } of normalized) {
      if ((op.kind === "create_file" || op.kind === "replace_in_file") && safe !== null) {
        bump(safe);
      }
      if (op.kind === "rename_file" && canRename) {
        if (safe !== null) bump(safe);
        if (safeTo !== null) bump(safeTo);
      }
    }

    // Partition: collect committable file changes; pre-fail dirs, unsafe paths,
    // unsupported updates, and duplicate-target file ops.
    const files: ScmFileChange[] = [];
    const safeByOp = new Map<ExecutableOperation, string>();
    const preResults = new Map<ExecutableOperation, ExecutionOpResult>();

    for (const { op, safe, safeTo } of normalized) {
      if (safe === null) {
        preResults.set(op, { op: { ...op }, status: "failed", detail: `unsafe repo path refused: ${op.path}` });
        continue;
      }
      if (op.kind === "create_dir") {
        preResults.set(op, {
          op: { ...op },
          status: "failed",
          detail: "provider does not track empty directories; no file to commit",
        });
        continue;
      }
      if (op.kind === "replace_in_file" && !config.provider.capabilities.updateFiles) {
        // Capability-typed refusal (never branch on provider id): a provider
        // that has not implemented hash-pinned updates gets none — the op is
        // failed honestly, never approximated with a blind overwrite.
        preResults.set(op, {
          op: { ...op },
          status: "failed",
          detail: `provider ${config.provider.id} does not support hash-pinned update operations; not actuated`,
        });
        continue;
      }
      if (op.kind === "rename_file" && !canRename) {
        // Same capability-typed honesty as update: failed verbatim, never
        // approximated (a create-at-destination without removing the source
        // would be a copy nobody approved, not a rename).
        preResults.set(op, {
          op: { ...op },
          status: "failed",
          detail: `provider ${config.provider.id} does not support rename operations; not actuated`,
        });
        continue;
      }
      if ((fileCount.get(safe) ?? 0) > 1) {
        preResults.set(op, {
          op: { ...op },
          status: "failed",
          detail: `duplicate target path in a single commit is ambiguous; not actuated: ${safe}`,
        });
        continue;
      }
      if (op.kind === "delete_file") {
        // A1 residual: SCM delete is NOT implemented in this slice (INV-A1-4).
        // Capability-typed honesty: the op is failed verbatim, never
        // approximated (e.g. committing an empty file or a tombstone nobody
        // approved would be fabrication).
        preResults.set(op, {
          op: { ...op },
          status: "failed",
          detail: `provider ${config.provider.id} does not support delete operations; not actuated`,
        });
        continue;
      }
      if (op.kind === "rename_file") {
        // R2: both paths must be safe, and the DESTINATION participates in the
        // duplicate-target check too (the rename writes there; another op
        // writing the same resolved path in one commit would be ambiguous).
        if (safeTo === null) {
          preResults.set(op, {
            op: { ...op },
            status: "failed",
            detail: `unsafe repo path refused: ${op.toPath}`,
          });
          continue;
        }
        if ((fileCount.get(safeTo) ?? 0) > 1) {
          preResults.set(op, {
            op: { ...op },
            status: "failed",
            detail: `duplicate target path in a single commit is ambiguous; not actuated: ${safeTo}`,
          });
          continue;
        }
        files.push({
          kind: "rename",
          path: safe,
          toPath: safeTo,
          expectedPriorSha256: op.expectedPriorSha256,
        });
        safeByOp.set(op, safe);
        continue;
      }
      if (op.kind === "replace_in_file") {
        files.push({
          kind: "update",
          path: safe,
          find: op.find,
          replaceWith: op.replaceWith,
          expectedPriorSha256: op.expectedPriorSha256,
          expectedPostSha256: op.expectedPostSha256,
        });
      } else {
        if (op.kind !== "create_file") {
          preResults.set(op, { op: { ...op }, status: "failed", detail: "unsupported SCM operation: " + op.kind + "; not actuated" });
          continue;
        }
        files.push({ kind: "create", path: safe, content: op.content });
      }
      safeByOp.set(op, safe);
    }

    // Nothing committable -> no PR. Report every op's pre-result (all failed).
    if (files.length === 0) {
      return {
        ranOps: [],
        results: approvedOps.map((op) => preResults.get(op) ?? {
          op: { ...op },
          status: "failed" as const,
          detail: "no committable file change",
        }),
        deterministic: false,
      };
    }

    try {
      const pr = await config.provider.openPullRequest({
        headBranch: deriveScmBranch(approvedOps, config.branchPrefix),
        ...(config.baseBranch !== undefined ? { baseBranch: config.baseBranch } : {}),
        title: config.title ?? "UseSteady governed change",
        body: config.body ?? "Actuated by UseSteady after human ratification.",
        commitMessage: config.commitMessage ?? "UseSteady governed change",
        files,
      });

      // Only paths the provider actually committed count as ran. A path the
      // provider refused is reported failed per-op with the provider's honest
      // reason (create no-clobber conflict; update target absent, changed since
      // approval, or already at the post-state), keeping ranWhatWasApproved
      // honest.
      const committed = new Set(pr.committedPaths);
      const skipReason = new Map((pr.skippedPaths ?? []).map((s) => [s.path, s.reason]));
      const ranOps: ExecutableOperation[] = [];
      const results: ExecutionOpResult[] = approvedOps.map((op) => {
        const pre = preResults.get(op);
        if (pre !== undefined) return pre;
        const safe = safeByOp.get(op)!;
        if (committed.has(safe)) {
          ranOps.push({ ...op });
          return {
            op: { ...op },
            status: "ran" as const,
            detail: `committed to ${config.provider.id} PR #${pr.number} (${pr.url}) on ${pr.headBranch} @ ${pr.commitSha}`,
          };
        }
        return {
          op: { ...op },
          status: "failed" as const,
          detail: `${skipReason.get(safe) ?? "path already exists on the base branch; create-only op not actuated"}: ${safe}`,
        };
      });

      return { ranOps, results, deterministic: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // PR failed: every would-run file op is failed; pre-failed ops keep their detail.
      return {
        ranOps: [],
        results: approvedOps.map((op) => preResults.get(op) ?? {
          op: { ...op },
          status: "failed" as const,
          detail: `source-control actuation failed: ${message}`,
        }),
        deterministic: false,
      };
    }
  };
}
