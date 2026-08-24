/**
 * src/friction/posthog.ts
 *
 * Thin wrapper around posthog-node for the CLI.
 *
 * Rules:
 *  - Never throws — all errors are silently swallowed
 *  - Never blocks  — flush() is called on process exit
 *  - Key is read from POSTHOG_KEY env var; if absent, all calls no-op
 *  - Distinct ID defaults to a stable anonymous UUID stored in ~/.usesteady/anon-id
 */
export declare function getAnonId(): string;
/**
 * Identify a real user (call when email/name becomes known, e.g. friction submit).
 * Links future anonymous events to this identity.
 */
export declare function identifyUser(opts: {
    email: string;
    name?: string;
}): void;
/**
 * Capture one event.
 *
 * @param event       snake_case event name
 * @param properties  optional key/value bag
 * @param distinctId  override ID (defaults to stable anon ID)
 */
export declare function capture(event: string, properties?: Record<string, unknown>, distinctId?: string): void;
/**
 * Flush all queued events. Call before process.exit().
 */
export declare function shutdown(): Promise<void>;
//# sourceMappingURL=posthog.d.ts.map