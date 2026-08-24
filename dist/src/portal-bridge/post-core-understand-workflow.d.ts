/**
 * Best-effort POST to Core's understand-workflow endpoint so the same
 * content-addressed intent root exists on the hosted Core store (Render).
 *
 * Guarded side-channel only — failures never affect local workflow execution.
 */
export declare const USESTEADY_CORE_URL_ENV = "USESTEADY_CORE_URL";
export type PostCoreUnderstandResult = {
    readonly ok: true;
    readonly ucpRootId: string;
} | {
    readonly ok: false;
    readonly reason: string;
};
export declare function postCoreUnderstandWorkflow(input: {
    readonly coreBaseUrl: string;
    readonly intent: string;
    readonly workspaceRoot: string;
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
}): Promise<PostCoreUnderstandResult>;
//# sourceMappingURL=post-core-understand-workflow.d.ts.map