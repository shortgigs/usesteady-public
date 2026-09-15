/**
 * usesteady quickstart -- guided first-run onboarding text.
 *
 * Pure module. No I/O, no process.exit, no execution. Importing this
 * module cannot read stdin, write the filesystem, spawn a process, or
 * talk to a model. It exists to render a single-screen orientation that
 * gets a brand-new user from install to first safe workflow in under five
 * minutes.
 *
 * Determinism: the exported function is pure and returns identical bytes
 * across runs for a given build. There is no template interpolation, no
 * environment-dependent text, no clock-based output.
 *
 * Authority:
 *   - This module does not interact with the planner, the safety gate,
 *     the executor, the model-insertion path, or any approval surface.
 *   - Quickstart only PRINTS instructions. It never starts a workflow,
 *     never approves anything, never reads stdin, never writes files.
 *   - Every command suggested in the text goes through the existing
 *     CLI dispatcher; nothing new is granted authority by quickstart.
 *
 * Source of truth:
 *   - For the operation catalog, the text directs the user to
 *     `usesteady capabilities` (src/shell/cli/capabilities.ts).
 *   - For starter workflows, the text directs the user to
 *     `usesteady templates` (src/shell/cli/templates.ts).
 *   - For full CLI usage, the text directs the user to
 *     `usesteady help`.
 *   No content is duplicated; quickstart is a curated entry point, not
 *   a second source of truth.
 *
 * Design: docs/product/useability-and-guided-execution-track.md (Product
 * Capability Track) -- onboarding clarity. Surface added in the first
 * implementation slice of "first successful workflow in under 5 minutes."
 */

/**
 * Render the quickstart guide as a human-readable text block. Bytes are
 * identical across runs for a given build. Always succeeds.
 */
export function renderQuickstartText(): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("  UseSteady -- first 5 minutes");
  lines.push("");
  lines.push("  What UseSteady is");
  lines.push("      A command-line tool for governed workflow execution.");
  lines.push("      You describe a change, review the exact operation, and approve");
  lines.push("      it before anything runs. No hidden execution, no surprise");
  lines.push("      actions, nothing happens without your explicit approval.");
  lines.push("");
  lines.push("  ---------------------------------------------------------------");
  lines.push("  Step 1. See what UseSteady can do");
  lines.push("  ---------------------------------------------------------------");
  lines.push("");
  lines.push("      usesteady capabilities");
  lines.push("");
  lines.push("  Prints the full catalog of supported operations. Read-only; this");
  lines.push("  command never executes anything. Add --output json for a");
  lines.push("  machine-readable shape.");
  lines.push("");
  lines.push("  ---------------------------------------------------------------");
  lines.push("  Step 2. Pick a starter template");
  lines.push("  ---------------------------------------------------------------");
  lines.push("");
  lines.push("      usesteady templates");
  lines.push("");
  lines.push("  Prints the list of safe starter workflows. Each one is a small,");
  lines.push("  non-destructive recipe you can copy and customize. To see the");
  lines.push("  full body of one template:");
  lines.push("");
  lines.push("      usesteady templates <name>");
  lines.push("");
  lines.push("  Recommended first template: append-to-file");
  lines.push("");
  lines.push("      usesteady templates append-to-file");
  lines.push("");
  lines.push("  Append is the safest starter: it never overwrites existing");
  lines.push("  content and is reversible by editing the file back.");
  lines.push("");
  lines.push("  ---------------------------------------------------------------");
  lines.push("  Step 3. Customize the template");
  lines.push("  ---------------------------------------------------------------");
  lines.push("");
  lines.push("  Copy the JSON operations from the template output into a file");
  lines.push("  (for example ops.json) and replace the placeholder values with");
  lines.push("  your real values. The file is a JSON array of operations, e.g.:");
  lines.push("");
  lines.push("      [");
  lines.push("        { \"type\": \"append\", \"file\": \"NOTES.md\", \"to\": \"hello from usesteady\\n\" }");
  lines.push("      ]");
  lines.push("");
  lines.push("  ---------------------------------------------------------------");
  lines.push("  Step 4. Run the workflow (with approval)");
  lines.push("  ---------------------------------------------------------------");
  lines.push("");
  lines.push("      usesteady batch ops.json");
  lines.push("");
  lines.push("  UseSteady will:");
  lines.push("");
  lines.push("      1. Show you the exact operation (SYSTEM WILL).");
  lines.push("      2. Wait for your approval before doing anything.");
  lines.push("      3. Only run after you say yes.");
  lines.push("");
  lines.push("  ---------------------------------------------------------------");
  lines.push("  Approval, in plain language");
  lines.push("  ---------------------------------------------------------------");
  lines.push("");
  lines.push("  By default, UseSteady stops and asks you before every operation.");
  lines.push("  You see the exact file, the exact text, the exact change.");
  lines.push("");
  lines.push("      - To approve interactively: type the approve key when prompted.");
  lines.push("      - To skip approval (CI/automation only): add --yes.");
  lines.push("      - --yes means \"I have already reviewed this spec\".");
  lines.push("        Do not use --yes for workflows you have not read.");
  lines.push("");
  lines.push("  ---------------------------------------------------------------");
  lines.push("  Where do workflows execute?");
  lines.push("  ---------------------------------------------------------------");
  lines.push("");
  lines.push("  Operations run locally, in your current working directory, as");
  lines.push("  your user. UseSteady does not:");
  lines.push("");
  lines.push("      - upload your files anywhere;");
  lines.push("      - run a background daemon;");
  lines.push("      - spawn workers that outlive the command;");
  lines.push("      - perform any operation you did not approve.");
  lines.push("");
  lines.push("  A CLI invocation ends when it ends. Its authority ends with it.");
  lines.push("");
  lines.push("  ---------------------------------------------------------------");
  lines.push("  How to stop safely");
  lines.push("  ---------------------------------------------------------------");
  lines.push("");
  lines.push("  At any approval prompt, choose Reject (or press Ctrl+C). The");
  lines.push("  current operation is not applied; UseSteady exits. Operations");
  lines.push("  already approved earlier in the workflow remain applied (they");
  lines.push("  were filesystem changes you authorized one at a time).");
  lines.push("");
  lines.push("  To undo an applied change:");
  lines.push("");
  lines.push("      - For tracked files: git checkout / git revert.");
  lines.push("      - For renames: rename back with the values swapped.");
  lines.push("      - For appends: edit the file to remove the added block.");
  lines.push("");
  lines.push("  ---------------------------------------------------------------");
  lines.push("  Next steps");
  lines.push("  ---------------------------------------------------------------");
  lines.push("");
  lines.push("      usesteady help                Full CLI usage");
  lines.push("      usesteady capabilities        Catalog of operations");
  lines.push("      usesteady templates           List of starter workflows");
  lines.push("      usesteady templates <name>    One template, in detail");
  lines.push("");
  lines.push("  Quickstart is read-only. Running this command does not execute");
  lines.push("  anything; it only prints this guide.");
  lines.push("");
  return lines.join("\n");
}
