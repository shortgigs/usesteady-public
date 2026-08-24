/**
 * src/friction/config.ts
 *
 * Reads and writes ~/.usesteady/config.json and ~/.usesteady/auth.json.
 *
 * These files hold the configurable collection endpoint and the GitHub
 * OAuth token. Neither the endpoint URL nor the token is hardcoded in
 * the public source — users (and alpha testers) receive them out-of-band.
 */
import type { AuthToken, FrictionConfig } from "./types.js";
export declare function readConfig(): FrictionConfig;
export declare function writeConfig(config: FrictionConfig): void;
export declare function readAuth(): AuthToken | null;
export declare function writeAuth(token: AuthToken): void;
export declare function clearAuth(): void;
//# sourceMappingURL=config.d.ts.map