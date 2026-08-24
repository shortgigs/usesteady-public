/**
 * Chain integrity verification (P0-4 algorithm) - single shared implementation.
 *
 * Computes the cumulative hash + Merkle root over an ORDERED list of decision-chain
 * envelope ids. This is the ONE source of the algorithm: both the provenance
 * endpoint (`server.ts`) and the execution-return bridge (P0-57) use it, so the
 * digest a buyer recomputes in-browser can never drift from what Core publishes.
 *
 * Algorithm (do not change without updating the Portal recompute + parity tests):
 *   cumulative_hash = sha256( utf8( id0 + id1 + ... ) )            -> hex
 *   merkle_root     = Merkle tree over leaves sha256(id) (raw bytes),
 *                     pairwise sha256(left || right), odd node duplicated, root hex
 */
export type ChainVerification = {
    readonly entry_ids: readonly string[];
    readonly cumulative_hash: string;
    readonly merkle_root: string;
    readonly algorithm: "sha256";
};
/**
 * Compute the integrity block for a non-empty ordered id list.
 * Returns null for an empty list (no chain => no verification), mirroring the
 * `decision_chain.length > 0` guard at the provenance endpoint.
 */
export declare function computeChainVerification(ids: readonly string[]): ChainVerification | null;
//# sourceMappingURL=chain-verification.d.ts.map