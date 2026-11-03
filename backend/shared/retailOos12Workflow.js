// Business schema only. Database permissions and immutable evidence decide authority.
// Retained false for callers from the earlier PR candidate; no specialist OOS web authority exists.
export function isOos12Specialist(){return false;}
export const OOS12_CONFIRMATION_FIELDS=['confirming_person_name','confirming_department','confirmation_date','confirmation_reference'];
export const OOS12_FIELDS={
 OOS12_PO_PENDING_COMMERCIAL:['po_number','po_date','po_received_date'],
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
for(const fields of Object.values(OOS12_FIELDS))fields.push(...OOS12_CONFIRMATION_FIELDS);
export function requireOos12Environment(environment){if(environment.RETAIL_OOS_MUTATIONS_FROZEN!=='false'||environment.RETAIL_MIS_OOS_WRITES_ENABLED!=='true')throw Object.assign(Error('OOS writes are frozen or await approved activation.'),{statusCode:503});}
