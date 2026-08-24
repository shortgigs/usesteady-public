/**
 * src/friction/github-auth.ts
 *
 * GitHub Device Flow OAuth — no browser redirect needed.
 *
 * Flow:
 *  1. POST /login/device/code  → get device_code + user_code + verification_uri
 *  2. Show user_code to the user; they visit verification_uri and enter it
 *  3. Poll /login/oauth/access_token until user approves or timeout
 *  4. Exchange token for GitHub user profile
 *  5. Store token in ~/.usesteady/auth.json
 *
 * Required GitHub OAuth App settings:
 *   - Client ID: set via USESTEADY_GITHUB_CLIENT_ID env var or ~/.usesteady/config.json
 *   - Scopes: user:email (read public profile + email)
 *   - Device flow: enabled in GitHub App / OAuth App settings
 *
 * Register a free GitHub OAuth App at:
 *   https://github.com/settings/developers → "New OAuth App"
 *   Set Authorization callback URL to: http://localhost (unused for device flow)
 *   Enable "Device Authorization flow" checkbox
 */
import type { AuthToken } from "./types.js";
/**
 * Run the GitHub device-flow OAuth dance interactively.
 *
 * Prints the user code and verification URL to stdout, then polls
 * until the user approves. Stores the resulting token in
 * ~/.usesteady/auth.json and returns the AuthToken.
 *
 * @param onCode   called with { userCode, verificationUri } when ready to display
 * @param onWaiting called each poll cycle while waiting for user
 */
export declare function runDeviceFlow(opts?: {
    onCode?: (info: {
        userCode: string;
        verificationUri: string;
    }) => void;
    onWaiting?: () => void;
}): Promise<AuthToken>;
//# sourceMappingURL=github-auth.d.ts.map