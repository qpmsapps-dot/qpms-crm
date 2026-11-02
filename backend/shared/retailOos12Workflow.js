// Business schema only. Database permissions and immutable evidence decide authority.
export const OOS12_ROLES={commercial:['COMMERCIAL','COMMERCIALTEAM','COMMERCIALREVIEWER'],finance:['FINANCE','FINANCETEAM','FINANCEREVIEWER','FINANCEGM','CFO'],branch:['BRANCHHEAD'],operations:['OPERATIONS','OPERATIONSTEAM','OPERATIONSMANAGER']};
const compact=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export function isOos12Specialist(profile){return ['RELIANCE','RELIANCERETAIL'].includes(compact(profile?.business))&&Object.values(OOS12_ROLES).flat().includes(compact(profile?.role));}
export const OOS12_FIELDS={
 OOS12_PO_PENDING_COMMERCIAL:['po_number','po_date'],
 OOS12_PO_RECEIVED:['confirmation_ref'],
 OOS12_FUND_RAISED:['fund_request_ref','fund_request_date','fund_request_amount'],
 OOS12_FUND_DELIVERED:['payment_ref','payment_date','payment_amount'],
 OOS12_FUND_RECEIVED:['receipt_ref','receipt_date'],
 OOS12_WIP:['handover_ref','handover_date'],
 OOS12_WORK_DONE:['work_completion_ref','completion_date'],
 OOS12_DOCUMENT_SUBMITTED:['documents_ref','submission_date'],
 OOS12_DOCUMENT_RECEIVED:['acknowledgement_ref','received_date'],
 OOS12_JMS_CREATED:['jms_number','jms_date'],
 OOS12_INVOICE_RAISED:['invoice_number','invoice_date','invoice_amount'],
};
export function requireOos12Environment(environment){if(environment.RETAIL_OOS_MUTATIONS_FROZEN!=='false'||environment.RETAIL_MIS_OOS_WRITES_ENABLED!=='true')throw Object.assign(Error('OOS writes are frozen or await approved activation.'),{statusCode:503});}
