// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * Shared SCM reality-probe verdict core.
 *
 * The verdict logic (which ops were claimed ran, where they landed, agree/
 * disagree/unknown) is identical across providers; only the READ differs. Each
 * provider supplies its own independent reader, so the providers do NOT share the
 * actuator's blind spots (the independence discipline), while the hard-won verdict
 * rules (path normalization parity, content compare, fail-into-disagree) live in
 * exactly one place — no per-provider drift.
 */

import { createHash } from "node:crypto";
import type { ExecutionPayload, ExecutableOperation } from "../governed-decision/types.js";
import type { RealityProbe, RealityProbeResult } from "../governed-decision/stages/observation.js";
import { safeRepoPath, deriveScmBranch } from "./scm-executor.js";

/**
 * Independently read the file's content at `headBranch`. Returns the exact UTF-8
 * content, or null when absent. Throws on real (non-404) errors. `safePath` is
 * already normalized by the core to match where the executor committed.
 */
export type ScmFileReader = (safePath: string, headBranch: string) => Promise<string | null>;

/**
 * Build an async {@link RealityProbe} from a provider-specific reader. Verifies
 * that every claimed-ran file op landed on the content-addressed head branch:
 * `create_file` by byte-exact content compare, `replace_in_file` (L4.S2) by
 * hashing the head-branch content against the approved `expectedPostSha256`
 * (content addressing — the same post-state anchor the FS reality probe uses,
 * so the verdict is byte-exact without the probe ever re-deriving the
 * replacement itself), and `rename_file` (R2) by the same two-half check the
 * FS reality probe uses: the SOURCE must be absent on the head branch AND the
 * DESTINATION must be present with content hashing to the approved
 * `expectedPriorSha256` — a source still present is a copy, a destination
 * absent or drifted is not the approved move; either half failing is a
 * disagreement, never a partial pass.
 */
export function buildScmRealityProbe(read: ScmFileReader, branchPrefix?: string): RealityProbe {
  return async (execution: ExecutionPayload): Promise<RealityProbeResult> => {
    const results = execution.results ?? [];
    const claimedRan: readonly ExecutableOperation[] = results
      .filter((r) => r.status === "ran")
      .map((r) => r.op);
    const claimedFiles = claimedRan.filter(
      (op) =>
        op.kind === "create_file" || op.kind === "replace_in_file" || op.kind === "rename_file",
    );

    if (claimedFiles.length === 0) {
      // NO_SILENT_CONTENT_OMISSION honesty (#1024 spirit): when approved
      // content-bearing create_file ops failed before actuation, "unknown /
      // nothing to verify" softens a known miss — intended bytes are absent.
      // Disagree so Portal trust pulse cannot look like "not yet checked".
      const failedContentBearing = results.filter(
        (r) =>
          r.status === "failed" &&
          r.op.kind === "create_file" &&
          r.op.content.length > 0,
      );
      if (failedContentBearing.length > 0) {
        return {
          realityVerdict: "disagree",
          detail:
            `approved content-bearing create(s) were not actuated ` +
            `(${failedContentBearing.length}); intended bytes absent on the branch`,
        };
      }
      return {
        realityVerdict: "unknown",
        detail: "no actuated file operations were reported, so there is nothing to verify on the branch",
      };
    }

    // Re-derive the head branch the actuator committed to, from the SAME op list
    // (every result carries its op, in order), so the probe needs no shared id.
    const headBranch = deriveScmBranch(results.map((r) => r.op), branchPrefix);

    const mismatches: string[] = [];
    for (const op of claimedFiles) {
      if (op.kind === "rename_file") {
        // Two-half verification, both paths normalized with the executor's own
        // rule (WHERE-it-landed parity — a mismatched normalization would query
        // the wrong path and report a false disagreement).
        const safeFrom = safeRepoPath(op.path);
        const safeTo = safeRepoPath(op.toPath);
        if (safeFrom === null || safeTo === null) {
          mismatches.push(`${op.path} -> ${op.toPath}: unsafe path, cannot verify`);
          continue;
        }
        try {
          const src = await read(safeFrom, headBranch);
          if (src !== null) {
            mismatches.push(`${op.path}: rename source still present on the head branch`);
          }
          const dst = await read(safeTo, headBranch);
          if (dst === null) {
            mismatches.push(`${op.toPath}: rename destination absent on the head branch`);
          } else if (
            createHash("sha256").update(dst, "utf8").digest("hex") !== op.expectedPriorSha256
          ) {
            mismatches.push(
              `${op.toPath}: rename destination content does not hash to the approved source pin`,
            );
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          mismatches.push(`${op.path} -> ${op.toPath}: could not verify (${message})`);
        }
        continue;
      }
      if (op.kind !== "create_file" && op.kind !== "replace_in_file") continue; // narrowing
      // Normalize with the SAME function the executor used to choose the commit
      // path. The reality READ stays independent (provider reader); but the
      // WHERE-it-landed must match exactly, or the probe would query the wrong
      // path and report a false disagreement (mirrors the FS probe's rule:
      // matching where-it-lands is a correctness requirement, not a shared check).
      const safe = safeRepoPath(op.path);
      if (safe === null) {
        mismatches.push(`${op.path}: unsafe path, cannot verify`);
        continue;
      }
      try {
        const actual = await read(safe, headBranch);
        if (actual === null) {
          mismatches.push(`${op.path}: absent on the head branch`);
        } else if (op.kind === "create_file") {
          // Byte-exact vs the approved op body. A content-bearing create that
          // lands empty (or any other drift) is disagreement — never a hollow
          // "matching content" agree that rubber-stamps a no-op / whitespace PR.
          if (actual !== op.content) {
            mismatches.push(`${op.path}: content differs from the approved operation`);
          }
        } else if (
          createHash("sha256").update(actual, "utf8").digest("hex") !== op.expectedPostSha256
        ) {
          mismatches.push(`${op.path}: content does not hash to the approved post-state`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        mismatches.push(`${op.path}: could not verify (${message})`);
      }
    }

    if (mismatches.length > 0) {
      return {
        realityVerdict: "disagree",
        detail: `reality disagrees with ${mismatches.length}/${claimedFiles.length} claimed file(s): ${mismatches.join("; ")}`,
      };
    }

    // Honest agree detail: empty creates are presence checks, not content
    // fidelity. Replay / institutional memory must not read "matching content"
    // when every claimed create was a 0-byte touch.
    const createOps = claimedFiles.filter((op) => op.kind === "create_file");
    const allEmptyCreates =
      createOps.length > 0 && createOps.every((op) => op.kind === "create_file" && op.content === "");
    return {
      realityVerdict: "agree",
      detail: allEmptyCreates
        ? `all ${claimedFiles.length} claimed empty file(s) present on ${headBranch}`
        : `all ${claimedFiles.length} claimed file(s) present on ${headBranch} with matching content`,
    };
  };
}
