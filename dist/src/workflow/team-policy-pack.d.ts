/**
 * src/workflow/team-policy-pack.ts
 *
 * Team policy pack v1 — read-only workspace metadata.
 *
 * Loads `<workspace>/.usesteady/policy.json` for display in inspect and
 * run banners. Zero authority: no enforcement, routing, or approval
 * changes.
 */
export type TeamPolicyPackV1 = {
    readonly policy_id: string;
    readonly owner: string;
    readonly version: string;
};
export type TeamPolicyLoadResult = {
    readonly kind: "absent";
} | {
    readonly kind: "ok";
    readonly policy: TeamPolicyPackV1;
} | {
    readonly kind: "invalid";
    readonly reason: string;
};
export declare function teamPolicyPathFor(workspaceRoot: string): string;
/**
 * Read-only load of the workspace team policy pack. Never throws.
 * Malformed files return `invalid`; missing file returns `absent`.
 */
export declare function loadTeamPolicyPack(workspaceRoot: string): TeamPolicyLoadResult;
/** Text lines for workflow inspect (includes unreadable policy notice). */
export declare function renderTeamPolicyInspectLines(result: TeamPolicyLoadResult): readonly string[];
/** Text lines for run banner — metadata only when policy file is valid. */
export declare function renderTeamPolicyRunBannerLines(result: TeamPolicyLoadResult): readonly string[];
/** @deprecated Use renderTeamPolicyInspectLines or renderTeamPolicyRunBannerLines. */
export declare function renderTeamPolicyTextLines(result: TeamPolicyLoadResult): readonly string[];
export declare function teamPolicyMetadata(result: TeamPolicyLoadResult): TeamPolicyPackV1 | null;
//# sourceMappingURL=team-policy-pack.d.ts.map