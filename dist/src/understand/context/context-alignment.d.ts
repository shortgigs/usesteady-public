/**
 * Context Alignment — semantic classification of input vs. session context.
 *
 * CONTRACT (PRV / Context Alignment boundary):
 *   Context Alignment is SEMANTIC. It handles context-reference patterns that are
 *   too specific or phrase-dependent for PRV's lexical approach.
 *
 *   PRV handles: again, continue, previous, same as
 *   Context Alignment handles: same file, use same, that file, my project, the config
 *
 *   Both layers may detect context-dependency, but for different reasons:
 *     PRV:               "is this input lexically dependent on missing state?"
 *     Context Alignment: "does this input reference a specific artifact that requires context?"
 */
import type { ContextAlignmentResult } from "./types.js";
import type { UnderstandContext } from "../shared/types.js";
export declare function runContextAlignment(input: string, ctx: UnderstandContext): ContextAlignmentResult;
//# sourceMappingURL=context-alignment.d.ts.map