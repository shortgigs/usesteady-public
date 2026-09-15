/**
 * Memory Layer (USESTEADY_MEMORY_CONTRACT_V0, MEM.S1).
 *
 * NOT exported from src/index.ts and NOT imported by any surface — MEM-10
 * (removal invariant): with no adapter configured, every UseSteady surface
 * behaves byte-identically to before this layer existed. Wiring to a
 * surface requires the MEM.S2 slice approval.
 */

export type {
  CurrentWorkingIntentPointer,
  DeletionEvent,
  MemoryPoint,
  MemoryScope,
  ModelResponseRecord,
  RecapOutcome,
  RecapResult,
  WorkItem,
  Zest,
} from "./types.js";
export type { MemoryAdapter } from "./adapter.js";
export { InMemoryMemoryAdapter } from "./adapter.js";
export { FileMemoryAdapter } from "./file-adapter.js";
export type {
  AssignScopeOutcome,
  DeleteOutcome,
  ModelResponseInput,
  PointerOutcome,
  RatificationInput,
  RatifyOutcome,
  ScopeOutcome,
} from "./gate.js";
export {
  assignWorkItemScope,
  createScope,
  deleteMemoryPointForPrivacy,
  ratifyMemoryPoint,
  recapWorkItem,
  setCurrentWorkingIntent,
} from "./gate.js";
export type {
  MemoryEvidenceEvent,
  MemoryEvidenceLine,
  MemoryEvidenceSink,
} from "./evidence.js";
export { fileMemoryEvidenceSink, readMemoryEvidence } from "./evidence.js";
export type { SupabaseMemoryConfig } from "./supabase-adapter.js";
export {
  SupabaseMemoryAdapter,
  readSupabaseMemoryEvidence,
  supabaseMemoryEvidenceSink,
} from "./supabase-adapter.js";
