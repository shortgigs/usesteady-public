// Copyright 2026 Shortgigs LLC. Licensed under the Apache License, Version 2.0.
/**
 * src/shell/cli/friction-report.ts
 *
 * `usesteady report` — interactive friction report CLI.
 *
 * Usage:
 *   usesteady report                   # guided interactive prompt
 *   usesteady report --auth            # re-authenticate with GitHub
 *   usesteady report --status          # show queue stats
 *
 * This is a public module (open source). No private collection URLs
 * or admin credentials appear here — everything private lives in
 * the private ops repo.
 */
import { readAuth, readConfig } from "../../friction/config.js";
import { runDeviceFlow } from "../../friction/github-auth.js";
import { captureManualReport } from "../../friction/auto-capture.js";
import { flushQueue } from "../../friction/client.js";
import { queueStats } from "../../friction/queue.js";
import { SessionController } from "../../session/controller.js";
// ─── Helpers ──────────────────────────────────────────────────────────────────
function print(msg) {
    process.stdout.write(msg + "\n");
}
// Controller-based line read. Every prompt in the friction-report flow is
// purpose-tagged "friction_report" per design §7.5 so telemetry can
// differentiate intake reads from credential / NL / approval reads.
function ask(rl, question) {
    return rl.requestInput({ purpose: "friction_report", prompt: question, until: "line" });
}
function clearLine() {
    process.stdout.write("\r\x1B[K");
}
// ─── Auth ─────────────────────────────────────────────────────────────────────
async function ensureAuth() {
    const existing = readAuth();
    if (existing?.githubToken && existing?.githubLogin) {
        return existing.githubLogin;
    }
    print("");
    print("  To submit a friction report, connect your GitHub account.");
    print("  This lets Shortgigs LLC identify you for payout and notify you of decisions.");
    print("");
    let waitDots = 0;
    const token = await runDeviceFlow({
        onCode: ({ userCode, verificationUri }) => {
            print(`  1. Open: ${verificationUri}`);
            print(`  2. Enter code: ${userCode}`);
            print("");
            print("  Waiting for authorization...");
        },
        onWaiting: () => {
            clearLine();
            waitDots = (waitDots + 1) % 4;
            process.stdout.write(`  Waiting${"...".slice(0, waitDots + 1)}  `);
        },
    });
    clearLine();
    print(`\n  Authenticated as @${token.githubLogin}`);
    if (token.githubEmail)
        print(`  Email: ${token.githubEmail}`);
    print("");
    return token.githubLogin;
}
async function selectKind(rl) {
    print("  What kind of friction are you reporting?");
    print("");
    print("    1. Something in the UI confused or blocked me");
    print("    2. Install or startup problem (npm install, usesteady ui)");
    print("    3. Something else");
    print("");
    const answer = (await ask(rl, "  Choice [1-3]: ")).trim();
    switch (answer) {
        case "1": return "ux-block";
        case "2": return "install-error";
        default: return "manual-cli";
    }
}
// ─── Main report flow ─────────────────────────────────────────────────────────
export async function runReport(args) {
    const isAuth = args.includes("--auth");
    const isStatus = args.includes("--status");
    // ── Status mode ──
    if (isStatus) {
        const stats = queueStats();
        print("");
        print("  Friction queue status:");
        print(`    Pending:   ${stats.pending}`);
        print(`    Submitted: ${stats.submitted}`);
        print(`    Failed:    ${stats.failed}`);
        print("");
        return;
    }
    // ── Re-auth mode ──
    if (isAuth) {
        await ensureAuth();
        return;
    }
    print("");
    print("  UseSteady — Friction Report");
    print("  ─────────────────────────────────────────");
    print("");
    print("  Friction reports help improve UseSteady.");
    print("  Verified reports earn a payout from Shortgigs LLC.");
    print("");
    // ── Ensure GitHub auth ──
    let githubLogin;
    try {
        githubLogin = await ensureAuth();
    }
    catch (err) {
        process.stderr.write(`\n  Auth failed: ${String(err)}\n\n`);
        process.exit(1);
    }
    // M5 §13 commit 7 (entry 5): friction-report now runs through a one-shot
    // SessionController instead of a locally-constructed readline.Interface.
    // This is the last interactive-entry migration in the M5 sequence; commit
    // 8 then lands the CI grep guard to assert no further createInterface
    // sites exist in src/ outside controller.ts.
    const rl = new SessionController({
        mode: "one_shot",
        autoYes: false,
    });
    try {
        // ── Kind selection ──
        const kind = await selectKind(rl);
        // ── Description ──
        print("");
        print("  Describe the friction in 1-3 sentences.");
        print("  What did you expect? What happened instead?");
        print("");
        const notes = (await ask(rl, "  > ")).trim();
        if (!notes) {
            print("\n  No description entered. Cancelled.\n");
            rl.shutdown();
            return;
        }
        rl.shutdown();
        // ── Enqueue ──
        const id = captureManualReport({ kind, notes, context: {} });
        print("");
        print("  Report queued locally.");
        print(`  ID: ${id}`);
        print("");
        print("  Submitting to Shortgigs LLC...");
        const config = readConfig();
        const n = await flushQueue(config);
        if (n > 0) {
            print(`  Submitted. @${githubLogin} will be notified of the decision via GitHub.`);
        }
        else {
            print("  Could not submit right now — saved locally and will retry automatically.");
            print("  Run `usesteady report --status` to check queue.");
        }
        print("");
    }
    catch (err) {
        rl.shutdown();
        process.stderr.write(`\n  Report failed: ${String(err)}\n\n`);
        process.exit(1);
    }
}
//# sourceMappingURL=friction-report.js.map