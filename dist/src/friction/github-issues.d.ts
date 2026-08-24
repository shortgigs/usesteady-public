/**
 * src/friction/github-issues.ts
 *
 * Thin GitHub REST API client used by the friction admin reviewer.
 * All operations target the collection repo configured in FrictionConfig.
 */
export interface GitHubIssue {
    readonly number: number;
    readonly title: string;
    readonly body: string;
    readonly html_url: string;
    readonly state: "open" | "closed";
    readonly labels: ReadonlyArray<{
        name: string;
    }>;
    readonly user: {
        login: string;
    };
    readonly created_at: string;
}
/**
 * Fetch all open issues labelled `status/pending` from the collection repo.
 * Pages up to 200 issues (2 pages of 100).
 */
export declare function fetchPendingIssues(repo: string, token: string): Promise<GitHubIssue[]>;
/** Post a comment to an issue. */
export declare function postComment(repo: string, issueNum: number, body: string, token: string): Promise<void>;
/**
 * Remove `removeLabel` from an issue and add `addLabel`.
 * Silently ignores 404 on remove (label may already be absent).
 */
export declare function swapLabel(repo: string, issueNum: number, removeLabel: string, addLabel: string, token: string): Promise<void>;
/** Close an issue (used when rejecting a friction report). */
export declare function closeIssue(repo: string, issueNum: number, token: string): Promise<void>;
/**
 * Extract the structured metadata JSON block from an issue body.
 * Returns null if the body doesn't contain a parseable block.
 */
export declare function parseIssueMetadata(body: string): Record<string, unknown> | null;
/**
 * Extract the submitter email stored in the HTML comment added by the web form.
 * Format:  <!-- submitter-email: user@example.com -->
 * Returns null if absent (e.g. CLI-submitted reports).
 */
export declare function parseSubmitterEmail(body: string): string | null;
/**
 * Extract the plain-text context lines from the issue body.
 * Returns an object with the human-readable fields.
 */
export declare function parseIssueContext(body: string): {
    kind?: string;
    taskInputs?: string[];
    failureNote?: string;
    phase?: string;
    notes?: string;
};
//# sourceMappingURL=github-issues.d.ts.map