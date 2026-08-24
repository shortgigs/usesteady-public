/**
 * Change command parser.
 *
 * Supported formats — text replacement:
 *   replace "X" with "Y" in <file>
 *   patch <file> search="X" replace="Y"
 *
 * Supported formats — filesystem operations:
 *   create (folder|directory) <path>
 *   create file <path>
 *   rename <path> to <newPath>
 *   (delete|remove) (file|folder|directory)? <path>
 *
 * Returns null for any other input shape.
 */
import type { ParsedChange } from "./types.js";
export declare function parseChange(rawInput: string): ParsedChange | null;
/** Extract the filename from a path without importing node:path. */
export declare function basename(filePath: string): string;
//# sourceMappingURL=parser.d.ts.map