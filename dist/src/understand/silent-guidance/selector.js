/**
 * Silent Guidance Mode Selector.
 *
 * Inspects the raw input for shape-level signals and returns the most
 * appropriate guidance template mode.
 *
 * ── Contracts ────────────────────────────────────────────────────────────────
 *
 *   1. Only called when bridgeSilenceReason === "no_interpreter_claimed".
 *   2. Deterministic: same input → same mode, always.
 *   3. Returns a mode — never null. "unknown" is the safe fallback.
 *   4. Does NOT classify intent. Does NOT produce category/confidence.
 *   5. Does NOT guess tools, services, file paths, or values.
 *   6. Does NOT affect mode, signal, intentState, or any decision.
 *   7. Regex match priority: investigation → operation → content_iteration → unknown.
 *      First match wins. This ordering prevents cross-domain false positives.
 *
 * ── Pattern philosophy ────────────────────────────────────────────────────────
 *
 *   Patterns are narrow, not broad.  Better to fall through to "unknown"
 *   (which still shows improved guidance over the old code-patch default)
 *   than to claim a mode incorrectly.
 *
 *   Each pattern targets high-signal, low-ambiguity tokens:
 *   - "debug" is always QA; "deploy" is always ops; "tagline" is always content.
 *   - Ambiguous terms like "improve", "fix", "check" are deliberately excluded
 *     unless combined with a domain-specific qualifier.
 */
// ── Pattern sets ───────────────────────────────────────────────────────────────
/**
 * QA, debugging, bug reproduction, smoke testing, mocking.
 * Also covers analytical investigation verbs: analyze, monitor, verify.
 * Extended with diagnostic verbs: inspect, trace, diagnose, troubleshoot.
 *
 * ── Expansion (Sessions 4–5) ──────────────────────────────────────────────────
 *
 *   Added analyz\w+ (analyze, analyzes, analyzing, analysing — any stem form).
 *   Added monitor: "monitor the error rate" → investigation, not ops.
 *   Added verify:  "verify the deployment health" → investigation.
 *
 *   These cleared C1 (≥ 2 cross-persona recurrences) and C3 (clear category)
 *   in Session 5 before being added. C2 still fails — interpreter remains NO-GO.
 *
 *   Priority: investigation runs before operation. When "monitor the ingestion
 *   pipeline" is tested, `monitor\b` fires here instead of `pipeline\b` in
 *   OPERATION_RE. That is the correct outcome.
 *
 * ── Expansion (Session 6) ─────────────────────────────────────────────────────
 *
 *   Added inspect:        3/3 recurrences across 3 personas (Dan, Syd, Pat).
 *   Added trac(?:e|ing):  "trace the query" / "tracing the call" — investigation.
 *   Added diagnos\w+:     diagnose, diagnosing, diagnosis, diagnostic.
 *                         4 cross-persona recurrences (Syd, Pat, Donna, Maya).
 *   Added troubleshoot\w*: troubleshoot, troubleshooting.
 *                          1 occurrence in Session 6 (Syd), eligible by C3 alone;
 *                          diagnose+troubleshoot share semantic class, so combined
 *                          C1 passes. Both fail C2 — no interpreter candidate.
 *
 *   Note on "debug": debug is already in this pattern (added in v1). After the
 *   Session 6 config_change fix (removing bare "debug" from CONFIG_NOUNS_RE),
 *   "debug the X" inputs are now bridge-silent and correctly route here.
 *   No change to the debug token was needed.
 */
const INVESTIGATION_RE = /\b(?:debug|bug|repro(?:duce)?|flak[iy]|smoke[\s-]test|mock(?:ing)?|test\s+(?:coverage|fixtures?|cases?)|coverage\s+report(?:ing)?|analyz\w+|monitor|verify|inspect|trac(?:e|ing)|diagnos\w+|troubleshoot\w*)\b/i;
/**
 * Infrastructure ops, deployments, pipelines, schema changes, migrations.
 * Also covers export, sync, scale (extended nouns), launch, roll-out.
 *
 * ── Expansion (Sessions 4–5) ──────────────────────────────────────────────────
 *
 *   scale — extended to cover workers, fleet, replicas, pods, instances, nodes.
 *     Previously only matched service/app/cluster; Sessions 4–5 confirmed the
 *     broader noun set recurs across DevOps and SRE personas.
 *
 *   export\b — standalone is sufficient; context is always data/artifact movement.
 *     4 cross-persona recurrences (Sam, Nia, Fay, Kai) cleared C1+C3.
 *
 *   sync\b  — data/state synchronisation; 2 cross-persona recurrences (Leo, Kai).
 *
 *   launch\b + roll[\s-]out\b — product/feature deployment verbs.
 *     'deploy' was already covered; 'launch' and 'roll-out' were not.
 *     Note: 'launch the new feature' previously false-fired config_change via
 *     the 'feature' noun. That noun was removed from CONFIG_NOUNS_RE (see
 *     config-intent.interpreter.ts). Adding 'launch\b' here is now safe.
 *
 * ── Expansion (Session 7 — CRM/ticket vocabulary) ─────────────────────────────
 *
 *   Evidence gate results (Session 7 report):
 *     suspend    C1 ✓ (4 personas)  C2 ✓ (non-execute)  C3 → ops
 *     assign     C1 ✓ (4 personas)  C2 ✓                C3 → ops
 *     escalate   C1 ✓ (4 personas)  C2 ✓                C3 → ops
 *     merge      C1 ✓ (3 personas)  C2 ✓                C3 → ops
 *     lock       C1 ✓ (2 personas)  C2 ✓                C3 → ops
 *
 *   Patterns added:
 *     suspend\b      — account / user / service suspension
 *     assign\b       — ticket / case assignment
 *     escalat\w+     — escalate, escalating, escalation
 *     merge\b        — ticket, case, account, or record merge
 *     lock\b         — account / ticket lock
 *
 * ── Expansion (Session 7 — Ops lifecycle vocabulary) ──────────────────────────
 *
 *   Evidence gate results (Session 7 report):
 *     rotate    C1 ✓ (4 personas)  C2 ✓  C3 → ops
 *     upgrade   C1 ✓ (4 personas)  C2 ✓  C3 → ops
 *     provision C1 ✓ (4 personas)  C2 ✓  C3 → ops
 *     failover  C1 ✓ (3 personas)  C2 ✓  C3 → ops
 *     patch     C1 ✓ (3 personas)  C2 ✓  C3 → ops
 *     drain     C1 ✓ (2 personas)  C2 ✓  C3 → ops
 *
 *   Patterns added:
 *     rotat\w+\s+(?:(?:\w[\w-]*)\s+){0,3}(?:keys?|secrets?|credentials?|tokens?|certs?|certificates?|api[\s-]keys?)
 *       — DELIBERATELY SCOPED to credential/key rotation only.
 *         Allows up to 3 qualifier words between "rotate" and the credential
 *         noun so that "rotate the TLS certificates" and "rotate expired API keys"
 *         both match, while "rotate customer passwords" does not match (passwords
 *         is not a credential noun in this list — it is a data record noun covered
 *         by the bulk_data_exfiltration safety detector which runs first).
 *
 *     upgrade\b      — service, cluster, dependency upgrade
 *     provision\w*   — provision, provisioning, provisioned
 *     failover\b     — explicit, unambiguous
 *     drain\b        — drain node, drain traffic, drain queue
 *     patch\b        — ops security/service patch (NOT the structured change command
 *                      `patch <file> search=…`; that format is consumed by the
 *                      completion layer before the selector is ever called)
 */
const OPERATION_RE = /\b(?:deploy(?:ment)?|rollback|restart|reboot|pipeline|migrat(?:e|ions?)|health[\s-]check|launch|roll[\s-]out|export|sync|add\s+(?:a\s+|an\s+)?(?:column|index)|update\s+the\s+schema|schema\s+change|run\s+(?:the\s+)?(?:pipeline|job|server|service|migrations?)|optimize\s+(?:the\s+)?(?:query|queries|slow\s+query)|scale\s+(?:the\s+)?(?:service|app|cluster|workers?|fleet|replicas?|pods?|instances?|nodes?)|suspend|assign|escalat\w+|merge|lock|rotat\w+\s+(?:(?:\w[\w-]*)\s+){0,3}(?:keys?|secrets?|credentials?|tokens?|certs?|certificates?|api[\s-]keys?)|upgrade|provision\w*|failover|drain|patch)\b/i;
/**
 * Copy, UX text, product descriptions, taglines, user flows.
 * Only high-signal content/product vocabulary — avoids over-matching.
 */
const CONTENT_ITERATION_RE = /\b(tagline\b|compelling\b|testimonial(?:s)?\b|onboarding\b|user[\s-]flow\b|checkout[\s-]flow\b|product[\s-]description\b|improve\s+the\s+(?:user|product|content|copy|experience|flow|ux)\b|make\b.{0,25}\bmore\s+(?:compelling|engaging)\b)\b/i;
/**
 * Boundary — multi-step feature development, architectural redesigns, or tasks
 * explicitly outside UseSteady's five frozen operations.
 *
 * These patterns mirror the boundaryRule in completion/rules.ts exactly so that
 * the Phase 4C template selection agrees with the completion layer's assessment.
 *
 * Priority note: boundary runs AFTER investigation/operation/content_iteration.
 * If "rewrite the deployment pipeline" matches operation, it stays operation.
 * The pure architectural/test-authoring verbs are what boundary is for.
 */
const BOUNDARY_RE = /\b(?:redesign|rearchitect)\b|\brewrite\s+(?:the|all|everything|from\s+scratch)\b|\b(?:write|add|generate)\s+(?:unit\s+)?(?:tests?|specs?|test\s+cases?)\s+(?:for|in|to)\b|\b(?:implement|build|set\s+up|scaffold)\s+(?:a|an|the)\b|\badd\s+a\s+new\s+\w+|\bmake\s+(?:it|the|my|everything)\s+(?:faster|better|smarter|more\s+efficient|more\s+performant)\b/i;
// ── Selector ──────────────────────────────────────────────────────────────────
/**
 * Select the appropriate silent guidance template mode for a bridge-silent flow.
 *
 * Priority (first match wins):
 *   1. investigation     — QA / debugging signals
 *   2. operation         — infra / schema / pipeline signals
 *   3. content_iteration — copy / UX / product signals
 *   4. boundary          — out-of-scope multi-step / architectural work
 *   5. unknown           — safe fallback (still better than code-patch default)
 *
 * "code_patch" is never returned here; it applies only when an interpreter
 * already fired (bridgeFired === true), meaning the request is already
 * enriched and needs no silent mode template.
 */
export function selectSilentGuidanceMode(input) {
    if (INVESTIGATION_RE.test(input))
        return "investigation";
    if (OPERATION_RE.test(input))
        return "operation";
    if (CONTENT_ITERATION_RE.test(input))
        return "content_iteration";
    if (BOUNDARY_RE.test(input))
        return "boundary";
    return "unknown";
}
//# sourceMappingURL=selector.js.map