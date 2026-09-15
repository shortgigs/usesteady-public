/** Prospective preparation only. No persistence, ratification issuance, or lane admission. */
import { createHash } from 'node:crypto';
import { canonicalJson, charterContentSha256, validateLaneCharter } from './charter.js';

export const HISTORICAL_GAP = 'Historical human FINAL ratification evidence was not established. This object requests prospective authority only; it does not establish prior approval.';
export const W_E6_INVARIANT = 'Independent reality probe verifies recorded document facts against execution records, not delivery self-report alone';
export const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');

export function prepareProspectiveCharter(historicalBytes: Buffer, replaceE6 = false, preparedAt = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(preparedAt)) || new Date(preparedAt).toISOString() !== preparedAt) throw new Error('Invalid preparation timestamp');
  const historical = JSON.parse(historicalBytes.toString('utf8'));
  const body = structuredClone(historical.charter);
  const originalLaneId: string = body.laneId;
  if (replaceE6) {
    if (originalLaneId !== 'w-e6' || body.invariants[4] !== 'Independent reality probe verifies the recorded document fact against the execution record (not the delivery self-report alone)') throw new Error('Unexpected w-e6 source');
    body.laneId = 'w-e6-r1';
    body.invariants[4] = W_E6_INVARIANT;
  }
  const validation = validateLaneCharter(body);
  if (!validation.ok) throw new Error(validation.errors.join('; '));
  const charter = validation.charter;
  if (!charter.productionLane) throw new Error('This packet is restricted to production charters');
  const excludedMetadata = Object.fromEntries(Object.entries(body).filter(([key]) => !(key in charter)));
  const object = {
    kind: 'usesteady.prospective-charter-preparation/v1',
    status: 'PENDING_HUMAN_FINAL',
    productionAdmission: 'BLOCKED',
    preparedAt,
    originalLaneId,
    revision: replaceE6 ? 'replacement-r1' : 'prospective-r1',
    historicalObjectSha256: sha256(historicalBytes),
    historicalRatificationStatus: 'NOT_ESTABLISHED',
    historicalGap: HISTORICAL_GAP,
    charter,
    contentSha256: charterContentSha256(charter),
    excludedMetadata,
    canonicalizationDisclosure: 'Only the validated charter body is governed by contentSha256. Excluded metadata is preserved in the historical object and this proposal identity; it is not part of the canonical charter body.',
    ratification: null,
  } as const;
  return { ...object, proposalSha256: sha256(canonicalJson(object)) };
}
export type ProspectiveCharter = ReturnType<typeof prepareProspectiveCharter>;

/** Display template only: null fields MUST be filled from a later actual human FINAL. */
export function prospectiveRecordTemplate(p: ProspectiveCharter) {
  return {
    kind: 'usesteady.prospective-charter-ratification/v1',
    proposalSha256: p.proposalSha256,
    charterId: p.charter.laneId,
    revision: p.revision,
    contentSha256: p.contentSha256,
    historicalObjectSha256: p.historicalObjectSha256,
    historicalRatificationStatus: 'NOT_ESTABLISHED',
    historicalGap: HISTORICAL_GAP,
    authority: 'PROSPECTIVE_ONLY',
    approverKind: 'human',
    approver: null,
    ratifiedAt: null,
    effectiveFrom: null,
    recordedAt: null,
    humanFinalReference: null,
    decision: null,
  };
}

/** Consistency check only, NOT authentication and NOT a Gate-1 receipt converter.
 * The caller must independently establish the actual human event. No function
 * here writes a receipt or admits a lane; fabricated JSON is never proof of H.
 */
export function prospectiveRecordErrors(p: ProspectiveCharter, record: Record<string, unknown>, humanFinal: {
  proposalSha256: string; approver: string; approverKind: string; timestamp: string;
  reference: string; decision: string;
} | null, verificationTime: string): string[] {
  const errors: string[] = [];
  const iso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (!iso(p.preparedAt) || !iso(verificationTime)) errors.push('invalid preparation/verification time');
  if (p.kind !== 'usesteady.prospective-charter-preparation/v1' || p.status !== 'PENDING_HUMAN_FINAL' || p.productionAdmission !== 'BLOCKED' || p.ratification !== null || p.historicalRatificationStatus !== 'NOT_ESTABLISHED' || p.historicalGap !== HISTORICAL_GAP || p.charter.productionLane !== true) errors.push('preparation is not an unratified prospective object');
  if (!/^[a-f0-9]{64}$/.test(p.historicalObjectSha256) || (p.originalLaneId !== 'w-e6' && (p.charter.laneId !== p.originalLaneId || p.revision !== 'prospective-r1'))) errors.push('source/revision relationship invalid');
  const { proposalSha256, ...payload } = p;
  const validation = validateLaneCharter(p.charter);
  if (!validation.ok || canonicalJson(validation.charter) !== canonicalJson(p.charter) || charterContentSha256(p.charter) !== p.contentSha256 || sha256(canonicalJson(payload)) !== proposalSha256) errors.push('proposal identity/body mismatch');
  if (p.originalLaneId === 'w-e6' && (p.charter.laneId !== 'w-e6-r1' || p.revision !== 'replacement-r1')) errors.push('old w-e6 identity forbidden');
  const template = prospectiveRecordTemplate(p);
  const dynamic = new Set(['approver','ratifiedAt','effectiveFrom','recordedAt','humanFinalReference','decision']);
  if (Object.keys(record).sort().join('|') !== Object.keys(template).sort().join('|')) errors.push('record field inventory mismatch');
  for (const [key,value] of Object.entries(template)) if (!dynamic.has(key) && record[key] !== value) errors.push(`record ${key} mismatch`);
  if (!humanFinal) return [...errors, 'actual human FINAL required; hash alone is not authority'];
  const validTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(humanFinal.timestamp) && !Number.isNaN(Date.parse(humanFinal.timestamp)) && new Date(humanFinal.timestamp).toISOString() === humanFinal.timestamp;
  const recorded = typeof record.recordedAt === 'string' ? record.recordedAt : '';
  if (!Number.isFinite(Date.parse(recorded)) || new Date(recorded).toISOString() !== recorded || !Number.isFinite(Date.parse(verificationTime)) || Date.parse(p.preparedAt) > Date.parse(humanFinal.timestamp) || Date.parse(humanFinal.timestamp) > Date.parse(recorded) || Date.parse(recorded) > Date.parse(verificationTime)) errors.push('prospective time ordering invalid');
  if (!validTime || humanFinal.approverKind !== 'human' || !humanFinal.approver.trim() || humanFinal.approver.startsWith('persona:') || !humanFinal.reference.trim() || humanFinal.decision !== 'approved' || humanFinal.proposalSha256 !== p.proposalSha256) errors.push('human FINAL relationship invalid');
  if (record.approver !== humanFinal.approver || record.ratifiedAt !== humanFinal.timestamp || record.effectiveFrom !== humanFinal.timestamp || record.humanFinalReference !== humanFinal.reference || record.decision !== 'approved') errors.push('record does not match actual human event');
  return errors;
}