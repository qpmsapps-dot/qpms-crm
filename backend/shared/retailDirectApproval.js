export const SUPER_ADMIN_IDENTITY_REASON='Super Admin authorized Reliance Retail Store Master activation.';
export function isDirectIdentityEvidence(proposal,evidence){
 return !!(evidence?.approval_mode==='SUPER_ADMIN_DIRECT'&&evidence.reason===SUPER_ADMIN_IDENTITY_REASON&&/^[1-9]\d*$/.test(String(evidence.direct_receipt_id||''))&&evidence.reference==='SUPER_ADMIN_DIRECT:'+evidence.direct_receipt_id&&evidence.evidence_kind==='CONFIRMED_SOURCE_FILE'&&evidence.evidence_sha256===proposal?.changes?.activation_review?.source_sha256&&/^[a-f0-9-]{36}$/i.test(evidence.authority_grant_id||''));
}
