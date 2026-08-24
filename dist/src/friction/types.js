// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * src/friction/types.ts
 *
 * Shared types for the friction capture pipeline.
 *
 * Design rules:
 *  - All types are plain data (no methods, no class instances).
 *  - Nothing here imports from the workflow domain — friction capture
 *    is a side-channel; it must never block or slow the core path.
 *  - The admin / payout / collection backend types live in the private
 *    the private ops repo and are NOT exported from here.
 */
export const DEFAULT_FRICTION_CONFIG = {
    frictionEndpoint: "https://api.github.com/repos/<your-org>/<your-friction-repo>/issues",
    frictionRepo: "<your-org>/<your-friction-repo>",
};
//# sourceMappingURL=types.js.map