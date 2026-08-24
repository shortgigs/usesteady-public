/**
 * Deterministic ucp.intent.v1 root for raw operator input.
 *
 * Content-addressed id from mapIntentToEnvelope; persisted once per store so
 * getChain() can resolve a provenance chain. Shared by the portal Understand
 * bridge and the CLI FS fast path.
 */
export declare function ensureUcpIntentRoot(storeDir: string, input: string): {
    readonly ucpRootId: string;
};
//# sourceMappingURL=ensure-intent-root.d.ts.map