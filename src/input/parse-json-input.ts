/**
 * src/input/parse-json-input.ts
 *
 * JSON input boundary for --json / batch surfaces (usesteady-public#79).
 *
 * ECMAScript JSON.parse silently applies last-write-wins when an object
 * contains duplicate keys. This module rejects duplicate keys in the
 * same object before parse so the operator sees a deterministic failure
 * instead of a silently discarded earlier value.
 *
 * Scope: JSON boundary only. No workflow, intake, or IR changes.
 */

export type JsonInputParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: "invalid_json"; readonly message: string };

/**
 * Parse JSON input for CLI --json / batch, refusing duplicate object keys.
 */
export function parseJsonInput(text: string): JsonInputParseResult {
  const duplicateKey = findDuplicateJsonObjectKey(text);
  if (duplicateKey !== null) {
    return {
      ok: false,
      code: "invalid_json",
      message: `Duplicate JSON key "${duplicateKey}" is not allowed.`,
    };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      message: "input is not valid JSON",
    };
  }
}

/**
 * Return the first duplicate key name found in any JSON object, or null.
 * Nested objects are scoped independently; the same key in different
 * objects is allowed.
 */
export function findDuplicateJsonObjectKey(text: string): string | null {
  const scanner = new JsonDuplicateKeyScanner(text);
  return scanner.scan();
}

// ─── Scanner ─────────────────────────────────────────────────────────────────

class JsonDuplicateKeyScanner {
  private i = 0;

  constructor(private readonly text: string) {}

  scan(): string | null {
    this.skipWs();
    if (this.i >= this.text.length) return null;
    return this.readValue();
  }

  private readValue(): string | null {
    this.skipWs();
    const ch = this.text[this.i];
    if (ch === "{") return this.readObject();
    if (ch === "[") return this.readArray();
    if (ch === '"') {
      this.readJsonString();
      return null;
    }
    if (ch === "t" || ch === "f" || ch === "n") {
      this.readLiteral();
      return null;
    }
    this.readNumber();
    return null;
  }

  private readObject(): string | null {
    this.i++; // {
    this.skipWs();
    if (this.peek() === "}") {
      this.i++;
      return null;
    }

    const keys = new Set<string>();
    while (true) {
      this.skipWs();
      if (this.peek() !== '"') return null;
      const key = this.readJsonString();
      if (keys.has(key)) return key;
      keys.add(key);

      this.skipWs();
      if (this.peek() !== ":") return null;
      this.i++; // :

      const nested = this.readValue();
      if (nested !== null) return nested;

      this.skipWs();
      if (this.peek() === "}") {
        this.i++;
        return null;
      }
      if (this.peek() === ",") {
        this.i++;
        continue;
      }
      return null;
    }
  }

  private readArray(): string | null {
    this.i++; // [
    this.skipWs();
    if (this.peek() === "]") {
      this.i++;
      return null;
    }

    while (true) {
      const nested = this.readValue();
      if (nested !== null) return nested;

      this.skipWs();
      if (this.peek() === "]") {
        this.i++;
        return null;
      }
      if (this.peek() === ",") {
        this.i++;
        continue;
      }
      return null;
    }
  }

  private readLiteral(): void {
    if (this.text.startsWith("true", this.i)) this.i += 4;
    else if (this.text.startsWith("false", this.i)) this.i += 5;
    else if (this.text.startsWith("null", this.i)) this.i += 4;
  }

  private readNumber(): void {
    if (this.peek() === "-") this.i++;
    while (this.i < this.text.length && /[0-9]/.test(this.text[this.i]!)) this.i++;
    if (this.peek() === ".") {
      this.i++;
      while (this.i < this.text.length && /[0-9]/.test(this.text[this.i]!)) this.i++;
    }
    if (this.peek() === "e" || this.peek() === "E") {
      this.i++;
      if (this.peek() === "+" || this.peek() === "-") this.i++;
      while (this.i < this.text.length && /[0-9]/.test(this.text[this.i]!)) this.i++;
    }
  }

  private readJsonString(): string {
    this.i++; // opening "
    let out = "";
    while (this.i < this.text.length) {
      const ch = this.text[this.i]!;
      if (ch === '"') {
        this.i++;
        return out;
      }
      if (ch === "\\") {
        this.i++;
        const esc = this.text[this.i];
        if (esc === undefined) break;
        if (esc === "u") {
          const hex = this.text.slice(this.i + 1, this.i + 5);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            this.i += 4;
          } else {
            out += "\\u";
          }
        } else {
          out += unescapeJsonChar(esc);
        }
        this.i++;
        continue;
      }
      out += ch;
      this.i++;
    }
    return out;
  }

  private peek(): string {
    return this.text[this.i] ?? "";
  }

  private skipWs(): void {
    while (this.i < this.text.length && /\s/.test(this.text[this.i]!)) this.i++;
  }
}

function unescapeJsonChar(esc: string): string {
  switch (esc) {
    case '"':  return '"';
    case "\\": return "\\";
    case "/":  return "/";
    case "b":  return "\b";
    case "f":  return "\f";
    case "n":  return "\n";
    case "r":  return "\r";
    case "t":  return "\t";
    default:   return esc;
  }
}
