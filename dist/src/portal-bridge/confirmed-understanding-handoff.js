/**
 * Intent → Decomposition handoff v1.
 * USESTEADY_INTENT_TO_DECOMPOSITION_HANDOFF_V1
 *
 * When the user has confirmed understanding, the review-draft planner MUST use
 * those bullets — not the unconfirmed intake path-decomposition scaffold.
 */
import { ensureUcpIntentRoot } from "../ucp/ensure-intent-root.js";
import { DEFAULT_STORE_DIR } from "../shell/defaults.js";
/**
 * Bound mirrored from the goal-isolation proposer (MAX_GOAL_LENGTH): a "goal"
 * that is most of the blob is not isolated, so it cannot be ratified either.
 */
const RATIFIED_GOAL_MAX_LENGTH = 400;
/**
 * Validate a wire ratifiedGoal against the parsed rawInput. Fail-closed to
 * legacy (INV-GI-4): anything not a verbatim substring of rawInput — invented
 * text, stale offsets pointing at revised input, over-length goals — returns
 * null and the field is simply omitted. Claimed offsets are used only as a
 * disambiguation hint when they slice correctly; otherwise the first verbatim
 * occurrence wins. The returned offsets are always locally derived.
 */
export function parseRatifiedGoalV1(raw, rawInput) {
    if (typeof raw !== "object" || raw === null)
        return null;
    const row = raw;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (text.length === 0 || text.length > RATIFIED_GOAL_MAX_LENGTH)
        return null;
    const claimedStart = typeof row.start === "number" ? row.start : -1;
    const start = claimedStart >= 0 && rawInput.slice(claimedStart, claimedStart + text.length) === text
        ? claimedStart
        : rawInput.indexOf(text);
    if (start === -1)
        return null;
    return { text, start, end: start + text.length };
}
const FORBIDDEN_HANDOFF_PHRASES = [
    "specific file or directory path is required",
    "break this request into one specific file change",
];
export function parseConfirmedUnderstandingV1(raw) {
    if (typeof raw !== "object" || raw === null)
        return null;
    const row = raw;
    if (row.format !== "usesteady.confirmed-understanding.v1")
        return null;
    if (!Array.isArray(row.bullets) || row.bullets.length === 0)
        return null;
    const bullets = row.bullets.filter((b) => typeof b === "string" && b.trim().length > 0);
    if (bullets.length === 0)
        return null;
    const rawInput = typeof row.rawInput === "string" ? row.rawInput.trim() : "";
    const confirmedAt = typeof row.confirmedAt === "string" ? row.confirmedAt.trim() : "";
    if (!rawInput || !confirmedAt)
        return null;
    const ratifiedGoal = parseRatifiedGoalV1(row.ratifiedGoal, rawInput);
    return {
        format: "usesteady.confirmed-understanding.v1",
        bullets,
        rawInput,
        confirmedAt,
        ...(ratifiedGoal !== null ? { ratifiedGoal } : {}),
    };
}
function captureUcpProvenance(intent) {
    const { ucpRootId } = ensureUcpIntentRoot(DEFAULT_STORE_DIR, intent);
    return { ucpRootId };
}
function deriveNameFromIntent(intent) {
    const trimmed = intent.trim();
    if (trimmed.length <= 48)
        return trimmed;
    return `${trimmed.slice(0, 45).trim()}…`;
}
function intentClassFromBullets(bullets) {
    const text = bullets.join(" ").toLowerCase();
    if (/research initiative|llm evaluation|no implementation plan/.test(text)) {
        return "research_initiative";
    }
    if (/migration initiative|phased migration/.test(text)) {
        return "program_migration";
    }
    if (/authentication middleware|rate-limit|public api endpoints/.test(text)) {
        return "capability_setup";
    }
    if (/button styling|theme tokens|rebrand/.test(text)) {
        return "refactor_scope";
    }
    if (/utils|date helper|scaffold/.test(text)) {
        return "structure_scaffold";
    }
    return "planning";
}
function headlineForClass(intentClass) {
    switch (intentClass) {
        case "research_initiative":
            return "Planning steps for your confirmed research initiative — no filesystem changes yet.";
        case "program_migration":
            return "Planning steps for your confirmed migration program — scope before file edits.";
        case "capability_setup":
            return "Planning steps for your confirmed capability work — define scope before implementation.";
        case "refactor_scope":
            return "Planning steps for your confirmed refactor scope — confirm targets before edits.";
        case "structure_scaffold":
            return "Planning steps for your confirmed structure work — scaffold plan before paths.";
        default:
            return "Planning steps from your confirmed understanding — review before any file changes.";
    }
}
function stepsFromBullets(bullets) {
    return bullets.map((bullet, index) => ({
        index,
        title: bullet.length > 56 ? `${bullet.slice(0, 53)}…` : bullet,
        summary: bullet,
    }));
}
/** Returns true when text must not appear in a handoff review draft. */
export function isForbiddenHandoffPhrase(text) {
    const lower = text.toLowerCase();
    return FORBIDDEN_HANDOFF_PHRASES.some((p) => lower.includes(p));
}
/**
 * Build review draft from user-confirmed understanding.
 * Skips intake path-decomposition when understanding is already confirmed.
 */
export function buildReviewDraftFromConfirmedUnderstanding(intent, confirmed, context) {
    const trimmed = intent.trim() || confirmed.rawInput.trim();
    if (!trimmed) {
        return { ok: false, message: "Intent is required.", code: "empty_intent" };
    }
    const intentClass = intentClassFromBullets(confirmed.bullets);
    const headline = headlineForClass(intentClass);
    const steps = stepsFromBullets(confirmed.bullets);
    if (steps.length === 0) {
        return {
            ok: false,
            message: "Confirmed understanding has no reviewable planning steps.",
            code: "no_steps",
        };
    }
    const linkage = captureUcpProvenance(trimmed);
    return {
        ok: true,
        source: "intake",
        name: deriveNameFromIntent(trimmed),
        headline,
        steps,
        context,
        presentation: {
            mode: "guide",
            certaintyLevel: "confirmed",
        },
        ucp_root_id: linkage.ucpRootId,
    };
}
//# sourceMappingURL=confirmed-understanding-handoff.js.map