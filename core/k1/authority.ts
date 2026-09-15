import { AuthorityLevel } from "./types.js";

export const AUTHORITY_RANK: Record<AuthorityLevel, number> = {
  source_of_record: 5,
  verified_system_state: 4,
  human_judgment: 3,
  agent_inference: 2,
  unverified: 1,
};

export function compareAuthority(a: AuthorityLevel, b: AuthorityLevel): number {
  return AUTHORITY_RANK[a] - AUTHORITY_RANK[b];
}
