#!/usr/bin/env tsx
/**
 * usesteady — CLI entry point.
 *
 * Input source contract (deterministic):
 *   Exactly one direct input source is allowed per invocation:
 *     --prompt "..."
 *     --json "..."
 *     piped stdin
 *   Mixed direct sources fail explicitly.
 *
 * Dispatch order after source validation:
 *   1. direct source path (prompt/json/stdin)
 *   2. positional argv request
 *   3. interactive session / known subcommands
 *
 * Execution modes:
 *   interactive   readline loop, TTY required
 *   run           usesteady run spec.json --yes  — zero prompts, CI-safe
 *   draft         usesteady "rename X to Y"      — preview then approve
 *   json          usesteady --json '{...}' --yes — structured, machine-readable
 *   batch         usesteady batch ops.json --yes — JSON array, same execution path
 *
 * Flags (global, stripped before subcommand parsing):
 *   --prompt "…"   (-p)   Provide input explicitly (any environment)
 *   --json   "…"   (-j)   Provide a structured JSON operation or array
 *   --output json  (-o)   Write machine-readable JSON result to stdout (requires --yes)
 *   --yes                  Auto-approve all prompts (non-interactive)
 *   --report-to-portal     Opt-in: report run outcome to the Portal (default off)
 *   --help, -h             Show usage
 *   --version, -v          Print version and exit
 *
 * Exit codes:
 *   0   Success (operation completed or help shown)
 *   1   Operation failed (execution error, safety block)
 *   2   Input contract/parsing error (conflicting sources, bad JSON, unknown type)
 *   3   Workflow stopped by user after approval flow starts
 *
 * --output json error enum (failure shape: { success: false, error: "<code>" }):
 *   CLI-layer (input contract / safety / CLI orchestration):
 *     conflicting_input_sources     More than one direct input source provided.
 *     invalid_json                  --json/--batch payload was not valid JSON.
 *     invalid_op                    JSON parsed but op type or fields unusable.
 *     unsupported_or_unparsed_steps Draft clause did not resolve to a
 *                                   supported deterministic op. No mutation.
 *     no_tasks_found                Input produced zero executable tasks.
 *     safety_block                  Safety gate refused the request or a clause.
 *     execution_error               Generic non-classified workflow failure.
 *     unknown                       Result file missing or unparseable.
 *   Adapter-layer (surfaced from the validator OR the cursor execution
 *   result so consumers get the precise refusal reason. Stage may differ
 *   between validate and execute for the same root cause; the public
 *   `error` field is identical per §6.5.1 rule 3):
 *     file_not_found                Target file does not exist.
 *                                   Surfaced by:
 *                                     - delete on missing path (M3 validator,
 *                                       deliberate refinement per §6.5.2;
 *                                       was execution_error before M3)
 *                                     - replace on missing target file
 *                                       (executor — content-dependent)
 *     old_value_not_found           'from' text not present in target file.
 *     ambiguous_match               'from' text appears more than once.
 *     target_exists                 Refused to overwrite an existing
 *                                   destination on a create op. No mutation.
 *                                   Surfaced by both the M3 validator
 *                                   (path-level pre-flight) and the
 *                                   executor (TOCTOU defense-in-depth).
 *     merge_conflict                Refused unsafe edit. Covers:
 *                                     - symlink target (write/append/prepend/
 *                                       rename/delete/replace)
 *                                     - binary file (NUL byte detected)
 *                                     - post-write content mismatch
 *                                   All paths: no mutation performed.
 *     parse_error                   Clause parsed but did not resolve to a
 *                                   supported operation type.
 *     scope_outside_allowed         Target file is outside write_safe_globs
 *                                   (cursor-session boundary; only fires
 *                                   when allowedFiles is non-empty).
 *     prohibited_pattern_match      Target file matches a prohibited pattern.
 *     delivery_timeout              Adapter delivery exceeded timeout budget.
 *     invalid_path                  Path contains a null byte (0x00). Refused
 *                                   at the validate stage by the M3
 *                                   FeasibilityValidator, before preview /
 *                                   approval / any fs probe. No mutation.
 *                                   Covers create / delete / rename (from
 *                                   and to) / replace.file / append.file /
 *                                   prepend.file / create_dir. Added in
 *                                   S1 / friction #26 — pre-fix behavior
 *                                   was a raw Node TypeError
 *                                   [ERR_INVALID_ARG_VALUE] from
 *                                   fs.writeFileSync, surfaced as the
 *                                   catchall execution_error AFTER the
 *                                   parent directory had been created.
 *     outside_workspace             Path resolves outside the workspace
 *                                   root. Refused at the validate stage
 *                                   by the FeasibilityValidator, before
 *                                   preview / approval / any fs probe.
 *                                   Covers POSIX absolute (/etc/x), Windows
 *                                   drive-rooted (C:\x or C:/x), Windows
 *                                   drive-relative (C:foo), UNC
 *                                   (\\srv\share\x or //srv/share/x), and
 *                                   `..`-traversal-after-normalize
 *                                   (a/../../etc). Same code is also
 *                                   surfaced from the executor as
 *                                   defense-in-depth at every fs case
 *                                   in CursorInProcessAdapter — same
 *                                   posture K4-I3 takes for replay.
 *                                   Distinct from scope_outside_allowed:
 *                                   workspace_root is the structural
 *                                   process-level boundary; allowedFiles
 *                                   is a per-cursor-session narrowing
 *                                   inside that boundary. Added in
 *                                   S2 / friction #36 — pre-fix behavior
 *                                   on the JSON / batch surfaces was
 *                                   silent fs mutation outside the
 *                                   workspace at exit-0 success, with
 *                                   no safety block, no error code, and
 *                                   no telemetry signal.
 *     invalid_filename_chars        Filename contains invisible (zero-
 *                                   width), bidirectional override, or
 *                                   control codepoints, or canonicalizes
 *                                   (NFKC) to a different string. Refused
 *                                   at the validate stage by the
 *                                   FeasibilityValidator AND re-checked
 *                                   at the executor as defense-in-depth.
 *                                   Scoped to filename-creating ops only
 *                                   (create / create_dir / rename.to);
 *                                   delete / rename.from / replace.file
 *                                   accept pre-existing bad-name files so
 *                                   the user can clean them up. Added in
 *                                   Cluster B Iteration 2 / friction
 *                                   shortgigs/usesteady-public#50 —
 *                                   pre-fix behavior accepted a U+202E
 *                                   in a filename at exit 0 because
 *                                   Cluster B Iteration 1's containment
 *                                   check (pathEscapesWorkspace) only
 *                                   caught BIDI used to mask traversal,
 *                                   not BIDI in a contained filename.
 *     invalid_replacement_chars     Replace operation's replacement text
 *                                   contains invisible (zero-width),
 *                                   bidirectional override, or control
 *                                   codepoints. Newlines, tabs, and CR
 *                                   are explicitly allowed so multi-line
 *                                   edits remain supported. Refused at
 *                                   the executor (CursorInProcessAdapter)
 *                                   before the file is read or rewritten.
 *                                   Added in Cluster B Iteration 2 /
 *                                   friction shortgigs/usesteady-public#52
 *                                   — pre-fix behavior accepted a U+202E
 *                                   in replacement text and wrote it
 *                                   verbatim to disk at exit 0.
 *     invalid_filename_reserved_name
 *                                   Filename's basename (case-
 *                                   insensitively, after trimming
 *                                   Windows-silently-stripped trailing
 *                                   dots and spaces) resolves to a
 *                                   Windows reserved device name:
 *                                   CON, PRN, AUX, NUL, COM0-COM9, or
 *                                   LPT0-LPT9. Refused cross-platform
 *                                   (not Windows-only) because a
 *                                   repository containing this filename
 *                                   cannot be cloned, archived, or
 *                                   extracted on Windows — even when
 *                                   authored on Linux or macOS. Refused
 *                                   at validate AND executor stages.
 *                                   Scoped to filename-creating ops only
 *                                   (create / create_dir / rename.to);
 *                                   delete / rename.from accept pre-
 *                                   existing reserved-name files for
 *                                   cleanup, mirroring Iteration 2's
 *                                   policy. Added in Cluster B Iteration
 *                                   3 — proactive hardening, not friction-
 *                                   driven. See
 *                                   docs/adr/ADR-cluster-b-iteration-3-
 *                                   filename-hardening.md.
 *     prohibited_path               Path lands inside a protected
 *                                   location and the tool refuses to
 *                                   operate on it. V1 protected set is
 *                                   any `.git` segment in the path --
 *                                   the Git repository's internal
 *                                   directory (HEAD, hooks/, config,
 *                                   refs/, objects/). Refused at
 *                                   validate AND executor stages for
 *                                   every path-bearing op including
 *                                   delete and rename, so `.git/HEAD`
 *                                   is never read, stat'd, or
 *                                   unlinked. Distinct from
 *                                   `invalid_filename_chars` (filename
 *                                   shape) because the path is well-
 *                                   formed and inside the workspace;
 *                                   the LOCATION is off-limits. To
 *                                   edit repository state, use `git`
 *                                   directly. Regular workspace files
 *                                   like `.gitignore` and
 *                                   `.gitattributes` are not protected
 *                                   -- only the `.git` directory
 *                                   segment matches. Added in Cluster
 *                                   B Iteration 4 / friction
 *                                   shortgigs/usesteady-public#60
 *                                   (create_dir into .git/hooks) and
 *                                   #67 (silent delete of .git/HEAD).
 *                                   See docs/adr/ADR-cluster-b-
 *                                   iteration-4-protected-paths.md.
 */
export {};
//# sourceMappingURL=use-steady.d.ts.map