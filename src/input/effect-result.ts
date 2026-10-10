/**
 * src/input/effect-result.ts
 *
 * P-EFFECT-RESULT — Create Content Correctness (C-EFFECT-RESULT).
 *
 * What was requested → what SYSTEM WILL disclosed → what was authorized
 * → what the executor applied → what the resulting filesystem contains
 * → what evidence reports must correspond.
 *
 * This module is the create-payload correspondence helper. It does not
 * widen the public JSON create parser (ADV-V2-037 stays separate: that
 * is input → proposal loss). It does not change append / prepend /
 * replace. It does not claim audit durability, tamper evidence, or
 * actor attribution.
 *
 * Empty `""` is an authorized zero-length payload. Omitted / undefined
 * content is not the same fact and must not be disclosed or evidenced
 * as empty.
 */

import { createHash } from "node:crypto";
import type { ApprovedContentBind } from "../understand/interpretation/types.js";

export function bindApprovedContent(utf8: string): ApprovedContentBind {
  return { utf8 };
}

export function sha256Utf8Bytes(utf8: string): string {
  return createHash("sha256").update(utf8, "utf8").digest("hex");
}

export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export type CreateContentDisclosure =
  | { readonly kind: "unspecified" }
  | { readonly kind: "empty" }
  | { readonly kind: "payload"; readonly utf8: string };

/**
 * SYSTEM WILL disclosure for a create payload. Empty and unspecified
 * are different kinds — they must not collapse.
 */
export function discloseCreateContent(content: string | undefined): CreateContentDisclosure {
  if (content === undefined) return { kind: "unspecified" };
  if (content.length === 0) return { kind: "empty" };
  return { kind: "payload", utf8: content };
}

export function authorizedCreateUtf8(op: {
  readonly content: string;
  readonly approvedContent?: ApprovedContentBind;
}): { ok: true; utf8: string } | { ok: false; detail: string } {
  if (op.approvedContent !== undefined && op.approvedContent.utf8 !== op.content) {
    return {
      ok: false,
      detail: "Execute content does not match the approval-bound create payload.",
    };
  }
  return { ok: true, utf8: op.approvedContent?.utf8 ?? op.content };
}

export type CreateCorrespondence =
  | { readonly ok: true; readonly actualSha256: string }
  | {
      readonly ok: false;
      readonly reason: "mismatch" | "unread";
      readonly detail: string;
      readonly actualSha256?: string;
    };

/**
 * Byte-exact compare of the authorized UTF-8 payload against the
 * bytes actually present after write. Hashes are of `actual`, never
 * of an earlier representation.
 */
export function correspondCreateBytes(
  authorizedUtf8: string,
  actual: Buffer,
): CreateCorrespondence {
  const expected = Buffer.from(authorizedUtf8, "utf8");
  const actualSha256 = sha256Buffer(actual);
  if (actual.length !== expected.length || !actual.equals(expected)) {
    return {
      ok: false,
      reason: "mismatch",
      detail:
        "Authorized create payload does not match the resulting bytes " +
        `(authorizedSha256=${sha256Utf8Bytes(authorizedUtf8)} actualSha256=${actualSha256}).`,
      actualSha256,
    };
  }
  return { ok: true, actualSha256 };
}

export type CreateWriteHooks = {
  readonly write: (abs: string, utf8: string) => void;
  readonly read: (abs: string) => Buffer;
  readonly unlink: (abs: string) => void;
};

/**
 * Write the authorized payload, then establish correspondence from a
 * read-back. Injected hooks exist so a negative control can write the
 * wrong bytes and prove this function refuses rather than trusting
 * write success.
 *
 * On failure the created path is unlinked so a mismatched file is not
 * left looking like a successful create.
 */
export function applyAuthorizedCreate(input: {
  readonly abs: string;
  readonly readAbs?: string;
  readonly authorizedUtf8: string;
  readonly hooks: CreateWriteHooks;
}): CreateCorrespondence {
  const { abs, authorizedUtf8, hooks } = input;
  const readAbs = input.readAbs ?? abs;
  hooks.write(abs, authorizedUtf8);
  let actual: Buffer;
  try {
    actual = hooks.read(readAbs);
  } catch (err) {
    try { hooks.unlink(abs); } catch { /* restore attempt */ }
    return {
      ok: false,
      reason: "unread",
      detail: `Could not read back created file to establish correspondence: ${String(err)}`,
    };
  }
  const check = correspondCreateBytes(authorizedUtf8, actual);
  if (!check.ok) {
    try { hooks.unlink(abs); } catch { /* restore attempt */ }
    return check;
  }
  return check;
}
