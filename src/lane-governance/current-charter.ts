/** Verify a retained prospective approval bundle before projecting current charter authority.
 * Source is a retained founder conversation event, not a generated kernel FINAL.
 * These checks establish local consistency, not independent identity authentication.
 */
import {canonicalJson, type StoredLaneCharter} from './charter.js';
import {sha256,prospectiveRecordErrors,type ProspectiveCharter} from './prospective-charter.js';
export const APPROVED_CHARTER_MANIFEST='8152a2a536bcc89bfd2b32a2469724c78cce8fdcca7341ca5a04baddbc918521';
export function projectProspectiveCharter(p:ProspectiveCharter,receiptBytes:Buffer,sourceBytes:Buffer,manifestBytes:Buffer,now:string): StoredLaneCharter {
 if(sha256(sourceBytes)!=='728872aa499aa9b7242124a6fa25a49c99b86e754ea76f9e4b7869d83b96909e')throw Error('Approval source changed');
 if(sha256(manifestBytes)!==APPROVED_CHARTER_MANIFEST)throw Error('Unapproved manifest');
 const source=JSON.parse(sourceBytes.toString());const receipt=JSON.parse(receiptBytes.toString());const manifest=JSON.parse(manifestBytes.toString());
 const approved=source.approved?.find((r:string[])=>r[0]===p.charter.laneId);
 const entry=manifest.proposals.find((r:any)=>r.id===p.charter.laneId);
 if(source.kind!=='usesteady.retained-founder-approval/v1'||source.manifestSha256!==APPROVED_CHARTER_MANIFEST||source.authority!=='PROSPECTIVE_ONLY'||source.historicalRatificationStatus!=='NOT_ESTABLISHED'||!approved||approved[1]!==p.proposalSha256||approved[2]!==p.contentSha256||entry?.proposalSha256!==p.proposalSha256||entry?.contentSha256!==p.contentSha256)throw Error('Approval does not bind object');
 const errors=prospectiveRecordErrors(p,receipt,{...source,proposalSha256:p.proposalSha256},now);
 if(errors.length)throw Error(errors.join('; '));
 return {charter:p.charter,contentSha256:p.contentSha256,ratification:{kind:'prospective-founder-human-final/v1',receiptSha256:sha256(receiptBytes),sourceReference:source.reference,proposalSha256:p.proposalSha256,authority:'PROSPECTIVE_ONLY',historicalRatificationStatus:'NOT_ESTABLISHED',approver:source.approver,approverKind:'human',ratifiedAt:source.timestamp,recordedAt:receipt.recordedAt}};
}
export function matchesProspectiveProjection(stored:unknown,p:ProspectiveCharter,r:Buffer,s:Buffer,m:Buffer,now:string):boolean {
 return canonicalJson(stored)===canonicalJson(projectProspectiveCharter(p,r,s,m,now));
}