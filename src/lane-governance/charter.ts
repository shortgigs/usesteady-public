/**
 * Lane charter record kind — G1 (LANE_GOVERNANCE_BY_USESTEADY_V1).
 *
 * `usesteady.lane-charter/v1` is the governed record kind that moves lane
 * scope from paper (markdown promises) to physics (deterministic gates).
 * A charter declares — before any session opens on the lane — exactly which
 * paths the lane may touch in each repo, which paths it must never touch,
 * what it depends on, and under what conditions work must stop.
 *
 * ── The three gates this feeds ────────────────────────────────────────────────
 *
 *   Gate 1 — Charter ratification (before the session): the charter body is
 *     content-hashed ({@link charterContentSha256}) and that hash is declared
 *     as an `asserted_artifact` reference on a governed decision record,
 *     ratified through the kernel spine (persona seat in build lanes via S1;
 *     H for production lanes — INV-LG-5). The ratification evidence is then
 *     embedded beside the body in the stored charter file
 *     ({@link StoredLaneCharter}).
 *
 *   Gate 2 — Pre-flight envelope (at session start): preflight.ts evaluates a
 *     session's declared planned files against the ratified charter using
 *     {@link evaluatePathsAgainstCharter}, layered on the frozen
 *     ControlEnvelope compiler (INV-LG-2; INV-CE-1..5 consumed frozen).
 *
 *   Gate 3 — Scope probe at PR: scripts/lane-scope-probe.mjs re-implements
 *     the SAME validation and matching rules independently (no import from
 *     this module — INV-LG-3 requires Gate 3 to be independent of Gates 1-2
 *     and of the agent). The duplication is by design, not an accident.
 *     If matching semantics ever change, BOTH must change and the shared
 *     test vectors in tests/lane-governance/ must lock the agreement.
 *
 * ── Path rule grammar (deterministic, no glob engine) ─────────────────────────
 *
 *   A path rule is either:
 *     - an exact file path:            "scripts/lane-scope-probe.mjs"
 *     - a directory prefix (ends "/"): "src/lane-governance/"
 *   Matching is pure string comparison / prefix testing on "/"-normalized
 *   relative paths. Forbidden rules WIN over allowed rules. There is no
 *   wildcard, no regex, no LLM — set membership only (INV-LG-3).
 *
 * ── Fail-closed validation ────────────────────────────────────────────────────
 *
 *   {@link validateLaneCharter} returns a typed charter or a non-empty error
 *   list. There is no partial acceptance: any malformed field rejects the
 *   whole charter. A charter that cannot be validated cannot open a lane
 *   (INV-LG-1).
 */

import { createHash } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export const LANE_CHARTER_KIND = "usesteady.lane-charter/v1" as const;

/** Per-repo scope declaration. Paths are repo-root-relative, "/"-separated. */
export type LaneRepoScope = {
  /** Repo slug, e.g. "shortgigs/usesteady-core". */
  readonly repo: string;
  /** Path rules the lane MAY touch (exact file or "dir/" prefix). */
  readonly allowedPaths: readonly string[];
  /** Path rules the lane MUST NOT touch. Forbidden wins over allowed. */
  readonly forbiddenPaths: readonly string[];
};

/** The charter BODY — the content that is hashed and ratified. */
export type LaneCharter = {
  readonly kind: typeof LANE_CHARTER_KIND;
  /** Lane identifier; also the branch namespace (`lane/<laneId>/...`). */
  readonly laneId: string;
  readonly title: string;
  /** The frozen artifact that authorizes this lane (e.g. "LANE_GOVERNANCE_BY_USESTEADY_V1"). */
  readonly authorizingArtifact: string;
  /** Invariant codes the lane implements or must uphold. */
  readonly invariants: readonly string[];
  /**
   * Production lanes require a HUMAN-ratified charter (INV-LG-5). Build lanes
   * may be persona-ratified through the S1 seam.
   */
  readonly productionLane: boolean;
  readonly repos: readonly LaneRepoScope[];
  /** Slice/lane dependencies that must be closed before this lane opens. */
  readonly dependencies: readonly string[];
  /** The acceptance gate that closes the lane — proof, not claim. */
  readonly acceptanceGate: string;
  /** Plain-language conditions under which lane work must STOP. */
  readonly stopConditions: readonly string[];
  /** Where the lane's ledger lives (repo-relative doc path or anchor). */
  readonly ledgerRef: string;
};

/** Ratification evidence embedded beside the charter body in the stored file. */
export type CharterRatificationEvidence = {
  /** recordId of the FINAL governed decision record that ratified this charter. */
  readonly recordId: string;
  readonly threadId: string;
  /** e.g. "persona:lane-warden" (build) or the human approver id (production). */
  readonly approver: string;
  readonly approverKind: "human" | "persona";
  readonly ratifiedFingerprint: string;
  readonly ratifiedAt: string;
};

/**
 * The on-disk charter file shape (governance/lane-charters/<laneId>.charter.json):
 * body + content hash + ratification evidence. The hash covers ONLY the body,
 * so the evidence can be embedded after ratification without moving the hash
 * the ratification anchored to.
 */
/** Retained founder conversation approval; never a kernel FINAL citation. */
export type ProspectiveCharterRatificationEvidence = {
  readonly kind: 'prospective-founder-human-final/v1';
  readonly receiptSha256: string;
  readonly sourceReference: string;
  readonly proposalSha256: string;
  readonly authority: 'PROSPECTIVE_ONLY';
  readonly historicalRatificationStatus: 'NOT_ESTABLISHED';
  readonly approver: string;
  readonly approverKind: 'human';
  readonly ratifiedAt: string;
  readonly recordedAt: string;
};
export type StoredLaneCharter = {
  readonly charter: LaneCharter;
  /** SHA-256 (hex) of the canonical JSON of `charter` ({@link charterContentSha256}). */
  readonly contentSha256: string;
  /** Null only while the charter is a draft awaiting Gate 1. */
  readonly ratification: CharterRatificationEvidence | ProspectiveCharterRatificationEvidence | null;
};

export type CharterValidation =
  | { readonly ok: true; readonly charter: LaneCharter }
  | { readonly ok: false; readonly errors: readonly string[] };

// ─── Canonical hashing ────────────────────────────────────────────────────────

/**
 * Canonicalize a JSON value: object keys sorted lexicographically at every
 * level, arrays kept in declared order. Deterministic across engines for the
 * plain-data shapes a charter contains. The scope probe re-implements this
 * byte-for-byte (INV-LG-3 independence).
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
    );
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 (hex) over the canonical JSON of the charter BODY. */
export function charterContentSha256(charter: LaneCharter): string {
  return createHash("sha256").update(canonicalJson(charter), "utf8").digest("hex");
}

/**
 * The `asserted_artifact` reference string a charter-ratification record
 * declares (INV-LG-6 — records are the channel; the record is lineage-linked
 * to the exact charter content it ratified).
 */
export function charterReferenceString(charter: LaneCharter): string {
  return `lane-charter:${charter.laneId}:sha256:${charterContentSha256(charter)}`;
}

// ─── Validation (fail-closed) ─────────────────────────────────────────────────

const LANE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * A path rule is repo-root-relative, "/"-separated, and lexically contained:
 * no leading "/", no drive letters, no "..", no ".", no backslashes, no
 * control characters. An empty rule list is allowed for forbiddenPaths but
 * not for allowedPaths (a lane that may touch nothing is not a lane).
 */
export function isValidPathRule(rule: string): boolean {
  if (rule.length === 0 || rule.length > 300) return false;
  if (rule.includes("\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(rule)) return false;
  if (rule.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(rule)) return false;
  const segments = rule.split("/");
  // A trailing "/" (directory prefix) produces one empty final segment — allowed.
  return segments.every(
    (s, i) => (s.length > 0 || (i === segments.length - 1 && rule.endsWith("/"))) && s !== ".." && s !== ".",
  );
}

function stringArrayErrors(
  raw: unknown,
  field: string,
  opts: { minLength?: number; maxItems: number; maxItemLength: number },
): { values: string[]; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(raw)) {
    return { values: [], errors: [`${field}: must be an array`] };
  }
  if (raw.length > opts.maxItems) {
    errors.push(`${field}: at most ${opts.maxItems} entries`);
  }
  if (opts.minLength !== undefined && raw.length < opts.minLength) {
    errors.push(`${field}: at least ${opts.minLength} entr${opts.minLength === 1 ? "y" : "ies"} required`);
  }
  const values: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || item.trim().length === 0 || item.length > opts.maxItemLength) {
      errors.push(`${field}: every entry must be a non-empty string of at most ${opts.maxItemLength} chars`);
      break;
    }
    values.push(item);
  }
  return { values, errors };
}

/**
 * Validate an unknown value into a {@link LaneCharter}, fail-closed and
 * fail-full: ALL detectable errors are reported together; any error rejects
 * the whole charter. Never throws.
 */
export function validateLaneCharter(raw: unknown): CharterValidation {
  const errors: string[] = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["charter: must be a JSON object"] };
  }
  const c = raw as Record<string, unknown>;

  if (c["kind"] !== LANE_CHARTER_KIND) {
    errors.push(`kind: must be ${JSON.stringify(LANE_CHARTER_KIND)}`);
  }
  const laneId = typeof c["laneId"] === "string" ? c["laneId"] : "";
  if (!LANE_ID_PATTERN.test(laneId)) {
    errors.push("laneId: must match /^[a-z0-9][a-z0-9-]{0,63}$/");
  }
  if (typeof c["title"] !== "string" || c["title"].trim().length === 0 || c["title"].length > 200) {
    errors.push("title: non-empty string of at most 200 chars required");
  }
  if (
    typeof c["authorizingArtifact"] !== "string" ||
    c["authorizingArtifact"].trim().length === 0 ||
    c["authorizingArtifact"].length > 200
  ) {
    errors.push("authorizingArtifact: non-empty string required (INV-LG-1 — charters derive from ratified artifacts)");
  }
  const invariants = stringArrayErrors(c["invariants"], "invariants", {
    minLength: 1,
    maxItems: 32,
    maxItemLength: 120,
  });
  errors.push(...invariants.errors);
  if (typeof c["productionLane"] !== "boolean") {
    errors.push("productionLane: boolean required (INV-LG-5)");
  }

  // repos
  const repos: LaneRepoScope[] = [];
  if (!Array.isArray(c["repos"]) || c["repos"].length === 0 || c["repos"].length > 8) {
    errors.push("repos: array of 1-8 repo scopes required");
  } else {
    for (const [i, entry] of (c["repos"] as unknown[]).entries()) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push(`repos[${i}]: must be an object`);
        continue;
      }
      const r = entry as Record<string, unknown>;
      const repo = typeof r["repo"] === "string" ? r["repo"] : "";
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
        errors.push(`repos[${i}].repo: must be an "owner/name" slug`);
      }
      const allowed = stringArrayErrors(r["allowedPaths"], `repos[${i}].allowedPaths`, {
        minLength: 1,
        maxItems: 64,
        maxItemLength: 300,
      });
      const forbidden = stringArrayErrors(r["forbiddenPaths"], `repos[${i}].forbiddenPaths`, {
        maxItems: 64,
        maxItemLength: 300,
      });
      errors.push(...allowed.errors, ...forbidden.errors);
      for (const rule of [...allowed.values, ...forbidden.values]) {
        if (!isValidPathRule(rule)) {
          errors.push(`repos[${i}]: invalid path rule ${JSON.stringify(rule)}`);
        }
      }
      repos.push({ repo, allowedPaths: allowed.values, forbiddenPaths: forbidden.values });
    }
  }

  const dependencies = stringArrayErrors(c["dependencies"], "dependencies", {
    maxItems: 32,
    maxItemLength: 120,
  });
  errors.push(...dependencies.errors);
  if (
    typeof c["acceptanceGate"] !== "string" ||
    c["acceptanceGate"].trim().length === 0 ||
    c["acceptanceGate"].length > 1000
  ) {
    errors.push("acceptanceGate: non-empty string of at most 1000 chars required");
  }
  const stopConditions = stringArrayErrors(c["stopConditions"], "stopConditions", {
    minLength: 1,
    maxItems: 8,
    maxItemLength: 300,
  });
  errors.push(...stopConditions.errors);
  if (typeof c["ledgerRef"] !== "string" || c["ledgerRef"].trim().length === 0 || c["ledgerRef"].length > 300) {
    errors.push("ledgerRef: non-empty string required");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    charter: {
      kind: LANE_CHARTER_KIND,
      laneId,
      title: c["title"] as string,
      authorizingArtifact: c["authorizingArtifact"] as string,
      invariants: invariants.values,
      productionLane: c["productionLane"] as boolean,
      repos,
      dependencies: dependencies.values,
      acceptanceGate: c["acceptanceGate"] as string,
      stopConditions: stopConditions.values,
      ledgerRef: c["ledgerRef"] as string,
    },
  };
}

// ─── Path matching (pure set membership — INV-LG-3 semantics) ─────────────────

/** Normalize a changed path for matching: backslashes → "/", strip leading "./". */
export function normalizeChangedPath(path: string): string {
  let p = path.replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  return p;
}

/**
 * Does a normalized changed path match one path rule? Exact match for file
 * rules; prefix match for directory rules (rule ends with "/").
 */
export function pathMatchesRule(changedPath: string, rule: string): boolean {
  if (rule.endsWith("/")) return changedPath.startsWith(rule);
  return changedPath === rule;
}

export type PathEvaluation = {
  readonly verdict: "in-charter" | "out-of-charter";
  /** Human-readable violation lines; empty iff verdict is "in-charter". */
  readonly violations: readonly string[];
};

/**
 * Evaluate a set of changed/planned paths against ONE repo's charter scope.
 * Forbidden wins over allowed; a path matching no allowed rule is a
 * violation; the empty path set is trivially in-charter. Deterministic set
 * membership only.
 */
export function evaluatePathsAgainstCharter(
  scope: LaneRepoScope,
  paths: readonly string[],
): PathEvaluation {
  const violations: string[] = [];
  for (const raw of paths) {
    const p = normalizeChangedPath(raw);
    if (p.length === 0) continue;
    const forbiddenHit = scope.forbiddenPaths.find((rule) => pathMatchesRule(p, rule));
    if (forbiddenHit !== undefined) {
      violations.push(`${p}: matches forbidden rule ${JSON.stringify(forbiddenHit)}`);
      continue;
    }
    const allowedHit = scope.allowedPaths.some((rule) => pathMatchesRule(p, rule));
    if (!allowedHit) {
      violations.push(`${p}: matches no allowed rule`);
    }
  }
  return violations.length > 0
    ? { verdict: "out-of-charter", violations }
    : { verdict: "in-charter", violations: [] };
}

/** Find the scope for a repo slug in a charter, or null when not covered. */
export function scopeForRepo(charter: LaneCharter, repoSlug: string): LaneRepoScope | null {
  return charter.repos.find((r) => r.repo === repoSlug) ?? null;
}
