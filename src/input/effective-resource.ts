/**
 * src/input/effective-resource.ts
 *
 * P-F01 — Effective Resource + Preview/Effect Correspondence.
 *
 * Before authority is granted, determine the filesystem receiver that would
 * actually take the effect. Lexical containment (#36) remains the first net.
 * This module walks existing path prefixes with lstat/realpath so a
 * workspace-relative name that hops through a POSIX/file symlink cannot
 * smuggle an outside destination past SYSTEM WILL or the executor.
 *
 * Fail-closed: if the effective destination cannot be established safely
 * (ELOOP, unreadable hop, workspace root unresolvable, or a regular file with
 * multiple hardlink names), refuse before effect.
 *
 * Explicit non-claims (do not collapse these into this module):
 *   - Windows junction / reparse-point remediation (ADV-V2-009)
 *   - ADV-V2-010
 *   - P-MED / F-02 (run-id / audit / resume)
 *   - .72 satisfaction or a named successor release
 *
 * Phillip F-01 is the acceptance case (POSIX/file symlink hop), not the
 * implementation specification. Canonicalization of the supplied spelling
 * alone is not closure — SYSTEM WILL must name the same receiver the
 * executor will write.
 *
 * This module must not import `src/kernel/*` (M3 boundary).
 */

import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, posix, relative, sep } from "node:path";
import type { Operation } from "./ir.js";
import type { ValidateError } from "./cli-error.js";
import type { ApprovedEffectiveBind, ApprovedReceiverIdentity, FsChange, ReplaceChange } from "../understand/interpretation/types.js";
import type { WorkflowTaskSpec } from "../workflow/types.js";
import { bindApprovedContent } from "./effect-result.js";
import { validateProtectedPath } from "../safety/filename-safety.js";

/**
 * Locked wording — must stay byte-identical to
 * `OUTSIDE_WORKSPACE_MSG` in feasibility-validator.ts.
 */
export const OUTSIDE_WORKSPACE_MSG =
  "Path is outside the workspace. Use a relative path inside the current workspace.";

export const EFFECTIVE_RESOURCE_UNRESOLVED_MSG =
  "Effective destination could not be safely established. Refusing before effect.";

export const EFFECTIVE_RESOURCE_CHANGED_MSG =
  "Approved receiver is not the execution-time receiver. Fresh preview and approval are required.";

export const EFFECTIVE_RESOURCE_MULTI_LINK_MSG =
  "Effective destination has multiple filesystem names. Refusing before effect.";

export const EFFECTIVE_RESOURCE_RECEIVER_REQUIRED_MSG =
  "Existing-object effect requires the approval-bound receiver identity. Fresh preview and approval are required.";

/**
 * `mutate` — append / prepend / delete / rename-from / structured replace.
 * A missing or invalid receiver is unresolved. This is not an atomic
 * namespace lock; the caller still has a check-to-system-call interval.
 *
 * `create` — write_file / create_dir / rename-to. Path-only is allowed
 * so the adapter can still emit `target_exists` for an occupied name.
 * That is not an overwrite exception and not a bound-receiver authorization.
 */
export type EffectReceiverMode = "mutate" | "create";

export type EffectiveResourceFs = {
  /** Inspect the entry itself. Only ENOENT means an absent destination. */
  readonly lstatSync: (path: string) => {
    isSymbolicLink(): boolean;
    isFile?(): boolean;
    nlink?: number;
  };
  readonly realpathSync: (path: string) => string;
  /** Exact integer metadata; a missing provider cannot establish an existing receiver. */
  readonly identityStatSync?: (path: string) => {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    readonly dev: bigint;
    readonly ino: bigint;
    readonly nlink: bigint;
    readonly birthtimeNs: bigint;
  };
};

const defaultEffectiveFs: EffectiveResourceFs = {
  lstatSync,
  realpathSync: (path: string): string => realpathSync(path),
  identityStatSync: (path: string) => lstatSync(path, { bigint: true }),
};

/** Metadata only. This does not lock the namespace or authorize an effect. */
function receiverIdentity(abs: string, fs: EffectiveResourceFs): ApprovedReceiverIdentity | null {
  try {
    if (fs.identityStatSync === undefined) {
      // Still distinguish real absence for projected create destinations.
      fs.lstatSync(abs);
      return null;
    }
    const st = fs.identityStatSync(abs);
    if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) return null;
    if (typeof st.dev !== "bigint" || typeof st.ino !== "bigint" ||
        typeof st.nlink !== "bigint" || typeof st.birthtimeNs !== "bigint" ||
        st.dev < 0n || st.ino <= 0n || st.nlink < 1n || st.birthtimeNs < 0n) return null;
    if (st.isFile() && st.nlink !== 1n) return null;
    return {
      kind: st.isFile() ? "file" : "directory",
      dev: st.dev.toString(),
      ino: st.ino.toString(),
      birthtimeNs: st.birthtimeNs.toString(),
    };
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "ENOENT" ? { kind: "absent" } : null;
  }
}

function receiverIdentitiesEqual(a: ApprovedReceiverIdentity, b: ApprovedReceiverIdentity): boolean {
  if (a.kind === "absent" || b.kind === "absent") return a.kind === b.kind;
  return a.kind === b.kind && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}

function validReceiverIdentity(value: unknown): value is ApprovedReceiverIdentity {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "absent") return true;
  if (record.kind !== "file" && record.kind !== "directory") return false;
  return [record.dev, record.ino, record.birthtimeNs].every(
    field => typeof field === "string" && /^(0|[1-9][0-9]*)$/.test(field),
  ) && record.ino !== "0";
}

export type EffectiveResourceOk = {
  readonly ok: true;
  readonly supplied: string;
  readonly effectiveAbs: string;
  readonly effectiveRel: string;
  readonly followedLink: boolean;
};

export type EffectiveResourceFail = {
  readonly ok: false;
  readonly reason: "lexical_escape" | "alias_escape" | "protected_resource" | "unresolved";
  readonly supplied: string;
  readonly effectiveAbs?: string;
  readonly message: string;
};

export type EffectiveResourceResult = EffectiveResourceOk | EffectiveResourceFail;

function toPosixRel(rel: string): string {
  return rel.split(sep).join("/");
}

/**
 * True when `candidate` is the workspace realpath or a descendant of it.
 * Cross-drive `path.relative` returns an absolute path — treated as outside.
 */
export function isResolvedInsideWorkspace(wsReal: string, candidate: string): boolean {
  const rel = relative(wsReal, candidate);
  if (rel === "") return true;
  if (isAbsolute(rel)) return false;
  const posixRel = toPosixRel(rel);
  if (posixRel === "..") return false;
  if (posixRel.startsWith("../")) return false;
  return true;
}

function unresolved(supplied: string): EffectiveResourceFail {
  return {
    ok: false,
    reason: "unresolved",
    supplied,
    message: `${EFFECTIVE_RESOURCE_UNRESOLVED_MSG} (path: ${supplied})`,
  };
}

function multiLinkUnresolved(
  supplied: string,
  effectiveAbs: string,
  nlink: number,
): EffectiveResourceFail {
  return {
    ok: false,
    reason: "unresolved",
    supplied,
    effectiveAbs,
    message: `${EFFECTIVE_RESOURCE_MULTI_LINK_MSG} (path: ${supplied}, links: ${nlink})`,
  };
}

function lexicalEscapes(p: string): boolean {
  if (typeof p !== "string" || p.length === 0) return true;
  if (isAbsolute(p)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (/^[a-zA-Z]:(?![\\/])/.test(p)) return true;
  if (p.startsWith("\\\\") || p.startsWith("//")) return true;
  const normalized = posix.normalize(p.replace(/\\/g, "/"));
  return normalized === ".." || normalized.startsWith("../");
}

function lexicalEscape(supplied: string): EffectiveResourceFail {
  return {
    ok: false,
    reason: "lexical_escape",
    supplied,
    message: `${OUTSIDE_WORKSPACE_MSG} (path: ${supplied})`,
  };
}

function aliasEscape(supplied: string, effectiveAbs: string): EffectiveResourceFail {
  return {
    ok: false,
    reason: "alias_escape",
    supplied,
    effectiveAbs,
    message: `${OUTSIDE_WORKSPACE_MSG} (path: ${supplied} → effective: ${effectiveAbs})`,
  };
}

function effectiveResult(
  supplied: string,
  effectiveAbs: string,
  effectiveRel: string,
  followedLink: boolean,
): EffectiveResourceResult {
  // A lexical spelling can be innocuous while an existing parent alias points
  // at a protected in-workspace receiver (for example `alias -> .git`).
  // Protected-path policy therefore has to run on the effective receiver too.
  // Scope this additional check to alias-following paths so direct `.git/...`
  // keeps the existing raw protected-path code path and diagnostics.
  if (followedLink) {
    const protectedResult = validateProtectedPath(effectiveRel);
    if (!protectedResult.ok) {
      return {
        ok: false,
        reason: "protected_resource",
        supplied,
        effectiveAbs,
        message:
          `Path resolves through an alias to a protected resource ` +
          `(path: ${supplied} → effective: ${effectiveRel}). ${protectedResult.detail}`,
      };
    }
  }
  return {
    ok: true,
    supplied,
    effectiveAbs,
    effectiveRel,
    followedLink,
  };
}

function segmentsOf(supplied: string): string[] {
  return supplied.replace(/\\/g, "/").split("/").filter(part => part.length > 0 && part !== ".");
}

/**
 * Resolve the effective filesystem receiver for a lexically relative path.
 *
 * Walks existing prefixes. A symlink hop is followed via realpath; if the
 * hop lands outside the workspace realpath, this is `alias_escape`.
 * Existing regular-file receivers with `nlink > 1` are refused because
 * path-based canonicalization cannot prove where every other hardlink name
 * lives; claiming workspace containment would therefore be unsound.
 * Missing trailing segments (create of a new name) are joined onto the
 * last contained prefix — they do not skip the hop check on ancestors.
 */
export function resolveEffectiveResource(
  workspaceRoot: string,
  supplied: string,
  fs: EffectiveResourceFs = defaultEffectiveFs,
): EffectiveResourceResult {
  if (typeof supplied !== "string" || supplied.length === 0) {
    return unresolved(supplied ?? "");
  }
  if (lexicalEscapes(supplied)) {
    return lexicalEscape(supplied);
  }

  let wsReal: string;
  try {
    wsReal = fs.realpathSync(workspaceRoot);
  } catch {
    return unresolved(supplied);
  }

  const parts = segmentsOf(supplied);
  if (parts.length === 0) {
    return {
      ok: true,
      supplied,
      effectiveAbs: wsReal,
      effectiveRel: ".",
      followedLink: false,
    };
  }

  let current = wsReal;
  let followedLink = false;

  for (let i = 0; i < parts.length; i++) {
    const next = join(current, parts[i]!);
    let entry: {
      isSymbolicLink(): boolean;
      isFile?(): boolean;
      nlink?: number;
    };
    try {
      entry = fs.lstatSync(next);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        return unresolved(supplied);
      }
      // lstat does not follow the final entry. A dangling/cyclic alias
      // therefore cannot enter this genuine-absence projection branch.
      const projected = join(current, ...parts.slice(i));
      if (!isResolvedInsideWorkspace(wsReal, projected)) {
        return aliasEscape(supplied, projected);
      }
      const rel = toPosixRel(relative(wsReal, projected));
      const effectiveRel = rel === "" ? "." : rel;
      return effectiveResult(supplied, projected, effectiveRel, followedLink);
    }

    if (entry.isSymbolicLink()) {
      followedLink = true;
      let target: string;
      try {
        target = fs.realpathSync(next);
      } catch {
        return unresolved(supplied);
      }
      if (!isResolvedInsideWorkspace(wsReal, target)) {
        return aliasEscape(supplied, target);
      }
      current = target;
      continue;
    }

    const isFinalEntry = i === parts.length - 1;
    const isRegularFile = typeof entry.isFile === "function" && entry.isFile();
    const linkCount = typeof entry.nlink === "number" ? entry.nlink : 1;
    if (isFinalEntry && isRegularFile && linkCount > 1) {
      return multiLinkUnresolved(supplied, next, linkCount);
    }

    try {
      current = fs.realpathSync(next);
    } catch {
      return unresolved(supplied);
    }
    if (!isResolvedInsideWorkspace(wsReal, current)) {
      return aliasEscape(supplied, current);
    }
  }

  const rel = toPosixRel(relative(wsReal, current));
  const effectiveRel = rel === "" ? "." : rel;
  return effectiveResult(supplied, current, effectiveRel, followedLink);
}

export function normalizeEffectiveAbs(abs: string): string {
  return abs.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function effectiveIdentitiesEqual(a: string, b: string): boolean {
  return normalizeEffectiveAbs(a) === normalizeEffectiveAbs(b);
}

/**
 * Re-resolve `supplied` at execute time and require it to be the same
 * receiver that was stamped at bind. A new contained hop is still a miss.
 */
export function checkApprovedEffectiveCorrespondence(
  workspaceRoot: string,
  supplied: string,
  approved: string | ApprovedEffectiveBind,
  fs: EffectiveResourceFs = defaultEffectiveFs,
):
  | { readonly ok: true; readonly effectiveAbs: string }
  | {
      readonly ok: false;
      readonly code: "outside_workspace" | "prohibited_path" | "effective_resource_unresolved" | "effective_resource_changed";
      readonly message: string;
    } {
  const resolved = resolveEffectiveResource(workspaceRoot, supplied, fs);
  if (!resolved.ok) {
    if (resolved.reason === "unresolved") {
      return { ok: false, code: "effective_resource_unresolved", message: resolved.message };
    }
    if (resolved.reason === "protected_resource") {
      return { ok: false, code: "prohibited_path", message: resolved.message };
    }
    return { ok: false, code: "outside_workspace", message: resolved.message };
  }
  const approvedAbs = typeof approved === "string" ? approved : approved.abs;
  if (!effectiveIdentitiesEqual(resolved.effectiveAbs, approvedAbs)) {
    return {
      ok: false,
      code: "effective_resource_changed",
      message: `${EFFECTIVE_RESOURCE_CHANGED_MSG} (path: ${supplied} approved: ${approvedAbs} execution: ${resolved.effectiveAbs})`,
    };
  }
  const current = receiverIdentity(resolved.effectiveAbs, fs);
  const receiver = typeof approved === "string" ? undefined : approved.receiver;
  if (receiver !== undefined && !validReceiverIdentity(receiver)) {
    return { ok: false, code: "effective_resource_unresolved", message: EFFECTIVE_RESOURCE_UNRESOLVED_MSG };
  }
  if (current === null || (receiver === undefined && current.kind !== "absent")) {
    return { ok: false, code: "effective_resource_unresolved", message: EFFECTIVE_RESOURCE_UNRESOLVED_MSG };
  }
  if (receiver !== undefined && !receiverIdentitiesEqual(receiver, current)) {
    return { ok: false, code: "effective_resource_changed", message: EFFECTIVE_RESOURCE_CHANGED_MSG };
  }
  return { ok: true, effectiveAbs: resolved.effectiveAbs };
}

export type EffectReceiverCheck =
  | { readonly ok: true; readonly effectiveAbs: string }
  | {
      readonly ok: false;
      readonly code: "outside_workspace" | "prohibited_path" | "effective_resource_unresolved" | "effective_resource_changed";
      readonly message: string;
    };

/**
 * Effect-boundary receiver check. Does not lock the directory entry or
 * claim the interval between this return and the later system call.
 */
export function checkEffectReceiverIdentity(
  workspaceRoot: string,
  supplied: string,
  approved: string | ApprovedEffectiveBind | undefined,
  mode: EffectReceiverMode,
  fs: EffectiveResourceFs = defaultEffectiveFs,
): EffectReceiverCheck {
  if (approved !== undefined) {
    return checkApprovedEffectiveCorrespondence(workspaceRoot, supplied, approved, fs);
  }
  const resolved = resolveEffectiveResource(workspaceRoot, supplied, fs);
  if (!resolved.ok) {
    if (resolved.reason === "unresolved") {
      return { ok: false, code: "effective_resource_unresolved", message: resolved.message };
    }
    if (resolved.reason === "protected_resource") {
      return { ok: false, code: "prohibited_path", message: resolved.message };
    }
    return { ok: false, code: "outside_workspace", message: resolved.message };
  }
  if (mode === "mutate") {
    return { ok: false, code: "effective_resource_unresolved", message: EFFECTIVE_RESOURCE_RECEIVER_REQUIRED_MSG };
  }
  return { ok: true, effectiveAbs: resolved.effectiveAbs };
}

/** True when a path-bearing op must carry a bind before H can approve. */
export function fsChangeMissingRequiredReceiver(op: FsChange): boolean {
  switch (op.operationType) {
    case "run_command":
      return false;
    case "rename":
      return op.approvedEffectiveFrom === undefined || op.approvedEffectiveTo === undefined;
    default:
      return op.approvedEffective === undefined;
  }
}

export function bindReplaceChange(
  parsed: ReplaceChange,
  workspaceRoot: string,
  fs?: EffectiveResourceFs,
):
  | { readonly ok: true; readonly parsed: ReplaceChange }
  | { readonly ok: false; readonly code: "outside_workspace" | "prohibited_path" | "effective_resource_unresolved"; readonly message: string } {
  if (parsed.filePath === undefined || parsed.approvedEffective !== undefined) {
    return { ok: true, parsed };
  }
  const bound = bindOnePath(workspaceRoot, parsed.filePath, fs);
  if (!bound.ok) return bound;
  return { ok: true, parsed: { ...parsed, approvedEffective: bound.bind } };
}

export function displayBoundPath(supplied: string, bind: ApprovedEffectiveBind | undefined): string {
  return bind?.rel ?? supplied;
}

export function applyEffectivePath(
  workspaceRoot: string,
  supplied: string,
  fs?: EffectiveResourceFs,
): string {
  const resolved = resolveEffectiveResource(workspaceRoot, supplied, fs);
  return resolved.ok ? resolved.effectiveRel : supplied;
}

/**
 * Rewrite structured preview/execute paths to the effective receiver.
 * Leaves `input` untouched so "You asked:" stays the raw request.
 * Safe to call only after validate has passed, or as a best-effort
 * preview rewrite (unresolved paths are left unchanged; the executor
 * refuses them).
 */
export function applyEffectivePathsToTaskSpec(
  task: WorkflowTaskSpec,
  workspaceRoot: string,
  fs?: EffectiveResourceFs,
): WorkflowTaskSpec {
  let next: WorkflowTaskSpec = task;
  if (task.targetFiles !== undefined) {
    next = {
      ...next,
      targetFiles: task.targetFiles.map(p => applyEffectivePath(workspaceRoot, p, fs)),
    };
  }
  if (task.newPath !== undefined) {
    next = { ...next, newPath: applyEffectivePath(workspaceRoot, task.newPath, fs) };
  }
  if (task.structuredReplace !== undefined) {
    next = {
      ...next,
      structuredReplace: {
        ...task.structuredReplace,
        filePath: applyEffectivePath(workspaceRoot, task.structuredReplace.filePath, fs),
      },
    };
  }
  return next;
}

export type BindFsChangeResult =
  | { readonly ok: true; readonly op: FsChange }
  | { readonly ok: false; readonly code: "outside_workspace" | "prohibited_path" | "effective_resource_unresolved"; readonly message: string };

export function bindOnePath(
  workspaceRoot: string,
  supplied: string,
  fs?: EffectiveResourceFs,
): { ok: true; bind: ApprovedEffectiveBind } | { ok: false; code: Extract<BindFsChangeResult, { ok: false }>["code"]; message: string } {
  const resolved = resolveEffectiveResource(workspaceRoot, supplied, fs);
  if (resolved.ok) {
    const receiver = receiverIdentity(resolved.effectiveAbs, fs ?? defaultEffectiveFs);
    if (receiver === null) {
      return { ok: false, code: "effective_resource_unresolved", message: EFFECTIVE_RESOURCE_UNRESOLVED_MSG };
    }
    return { ok: true, bind: { abs: resolved.effectiveAbs, rel: resolved.effectiveRel, receiver } };
  }
  if (resolved.reason === "unresolved") {
    return { ok: false, code: "effective_resource_unresolved", message: resolved.message };
  }
  if (resolved.reason === "protected_resource") {
    return { ok: false, code: "prohibited_path", message: resolved.message };
  }
  return { ok: false, code: "outside_workspace", message: resolved.message };
}

/**
 * Stamp approval-bound identities. Supplied paths stay on the op so
 * execute can re-resolve the same hop. SYSTEM WILL reads `rel`.
 */
export function bindEffectiveFsChange(
  op: FsChange,
  workspaceRoot: string,
  fs?: EffectiveResourceFs,
): BindFsChangeResult {
  if (!fsChangeMissingRequiredReceiver(op)) {
    return { ok: true, op };
  }
  switch (op.operationType) {
    case "run_command":
      return { ok: true, op };
    case "create_dir": {
      const bound = bindOnePath(workspaceRoot, op.dirPath, fs);
      if (!bound.ok) return bound;
      return { ok: true, op: { ...op, approvedEffective: bound.bind } };
    }
    case "write_file": {
      const bound = bindOnePath(workspaceRoot, op.filePath, fs);
      if (!bound.ok) return bound;
      return {
        ok: true,
        op: {
          ...op,
          approvedEffective: bound.bind,
          approvedContent: bindApprovedContent(op.content),
        },
      };
    }
    case "append_file":
    case "prepend_file":
    case "delete_file": {
      const bound = bindOnePath(workspaceRoot, op.filePath, fs);
      if (!bound.ok) return bound;
      return { ok: true, op: { ...op, approvedEffective: bound.bind } };
    }
    case "rename": {
      const from = bindOnePath(workspaceRoot, op.filePath, fs);
      if (!from.ok) return from;
      const to = bindOnePath(workspaceRoot, op.newPath, fs);
      if (!to.ok) return to;
      return {
        ok: true,
        op: { ...op, approvedEffectiveFrom: from.bind, approvedEffectiveTo: to.bind },
      };
    }
  }
}

function pathFieldsOf(op: Operation): readonly { field: string; path: string }[] {
  switch (op.type) {
    case "create":
      return [{ field: "file", path: op.args.path }];
    case "create_dir":
      return [{ field: "path", path: op.args.path }];
    case "delete":
      return [{ field: "file", path: op.args.path }];
    case "rename":
      return [
        { field: "from", path: op.args.from },
        { field: "to", path: op.args.to },
      ];
    case "replace":
      return [{ field: "file", path: op.args.file }];
    case "append":
      return [{ field: "file", path: op.args.file }];
    case "prepend":
      return [{ field: "file", path: op.args.file }];
    case "run":
      return [];
  }
}

/**
 * Validator-stage effective-resource check. Lexical containment must already
 * have passed. Returns the first hop/unresolved/protected-resource refusal,
 * or null.
 */
export function checkEffectiveResourceForOp(
  op: Operation,
  workspaceRoot: string,
  fs?: EffectiveResourceFs,
): Omit<ValidateError, "index"> | null {
  for (const { field, path } of pathFieldsOf(op)) {
    const resolved = resolveEffectiveResource(workspaceRoot, path, fs ?? defaultEffectiveFs);
    if (resolved.ok) continue;
    if (resolved.reason === "lexical_escape") {
      return {
        stage: "validate",
        code: "outside_workspace",
        message: `${OUTSIDE_WORKSPACE_MSG} (${field}: ${path})`,
        operation: op,
      };
    }
    if (resolved.reason === "alias_escape") {
      return {
        stage: "validate",
        code: "outside_workspace",
        message: `${OUTSIDE_WORKSPACE_MSG} (${field}: ${path} → effective: ${resolved.effectiveAbs ?? "unknown"})`,
        operation: op,
      };
    }
    if (resolved.reason === "protected_resource") {
      return {
        stage: "validate",
        code: "prohibited_path",
        message: resolved.message,
        operation: op,
      };
    }
    return {
      stage: "validate",
      code: "effective_resource_unresolved",
      message: resolved.message,
      operation: op,
    };
  }
  return null;
}
