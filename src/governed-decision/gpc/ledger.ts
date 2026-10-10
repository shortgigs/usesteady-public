/**
 * Append-only capsule ledger — institutional memory (not the filesystem).
 * Durable under org sandbox: /data/orgs/<uuid>/capsules/capsule-ledger.jsonl
 */

import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Capsule, VerifiedProjectionRecord } from "./types.js";

export type LedgerEntry =
  | { readonly kind: "capsule"; readonly payload: Capsule }
  | { readonly kind: "verified_projection"; readonly payload: VerifiedProjectionRecord };

export class CapsuleLedger {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) {
      writeFileSync(path, "", "utf8");
    }
  }

  appendCapsule(capsule: Capsule): void {
    const existing = this.getCapsule(capsule.capsule_id);
    if (existing !== null) {
      if (stableCapsuleEqual(existing, capsule)) {
        return; // idempotent
      }
      throw new Error(
        `IMMUTABILITY VIOLATION: capsule ${capsule.capsule_id.slice(0, 12)} already sealed with different bytes`,
      );
    }
    this.append({ kind: "capsule", payload: capsule });
  }

  appendVerified(record: VerifiedProjectionRecord): void {
    this.append({ kind: "verified_projection", payload: record });
  }

  getCapsule(capsuleId: string): Capsule | null {
    for (const entry of this.iter()) {
      if (entry.kind === "capsule" && entry.payload.capsule_id === capsuleId) {
        return entry.payload;
      }
    }
    return null;
  }

  listVerified(capsuleId?: string): VerifiedProjectionRecord[] {
    const out: VerifiedProjectionRecord[] = [];
    for (const entry of this.iter()) {
      if (entry.kind !== "verified_projection") continue;
      if (capsuleId !== undefined && entry.payload.capsule_id !== capsuleId) {
        continue;
      }
      out.push(entry.payload);
    }
    return out;
  }

  private append(entry: LedgerEntry): void {
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, "utf8");
  }

  private *iter(): Generator<LedgerEntry> {
    const text = readFileSync(this.path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      yield JSON.parse(line) as LedgerEntry;
    }
  }
}

function stableCapsuleEqual(a: Capsule, b: Capsule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
