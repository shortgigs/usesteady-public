export type WorkMode = "exploration" | "execution";
export type ClaimSource = "human" | "agent" | "system_state" | "external_source" | "execution_result";
export type AuthorityLevel = "source_of_record" | "verified_system_state" | "human_judgment" | "agent_inference" | "unverified";
export type TruthClaim = {
    id: string;
    statement: string;
    source: ClaimSource;
    authorityLevel: AuthorityLevel;
    evidence?: string[];
    confidence?: number;
};
export type ClaimRelation = "same" | "compatible" | "conflict" | "unknown";
export type ClaimRelationResult = {
    claimA: TruthClaim;
    claimB: TruthClaim;
    relation: ClaimRelation;
    reason: string;
};
export type TruthConflict = {
    id: string;
    claims: TruthClaim[];
    status: "open" | "resolved" | "rejected";
    relation: ClaimRelation;
    resolution?: {
        winningClaimId: string;
        reason: string;
        resolvedBy: "human" | "policy";
    };
    proposal?: ResolutionProposal;
};
export type ResolutionStatus = "resolved_by_source" | "proposal_requires_human_review" | "unresolved";
export type ResolutionProposal = {
    conflictId: string;
    proposedWinningClaimId: string;
    status: ResolutionStatus;
    reason: string;
    authorityDelta: number;
};
export type AuthorityGrant = {
    id: string;
    scope: "exploration" | "execution";
    grantedBy: "human";
    approvedSystemWill: string[];
    approvedClaims: string[];
    unresolvedClaimsAccepted: string[];
    createdAt: string;
};
export type AgentWeightProfile = {
    falsePositiveRisk: number;
    discoveryOpportunity: number;
    evidenceStrictness: number;
    anomalyPreservation: number;
    executionSafety: number;
};
export type K1DecisionPacket = {
    id: string;
    mode: WorkMode;
    intent: string;
    systemWill: string[];
    claims: TruthClaim[];
    conflicts: TruthConflict[];
    weightProfile: AgentWeightProfile;
    approvalRequired: boolean;
    arbitrationRecords?: ArbitrationRecord[];
    executionGateRecord?: ExecutionGateRecord;
};
export type ArbitrationRecord = {
    id: string;
    packetId: string;
    conflictId: string;
    inputClaimIds: string[];
    relation: ClaimRelation;
    proposal?: ResolutionProposal;
    finalStatus: "resolved" | "requires_review" | "blocked";
    decidedBy: "source_policy" | "human_review" | "execution_gate";
    reason: string;
    createdAt: string;
};
export type ExecutionGateRecord = {
    id: string;
    packetId: string;
    result: "allowed" | "blocked";
    reason: string;
    authorityGrantId?: string;
    createdAt: string;
};
//# sourceMappingURL=types.d.ts.map