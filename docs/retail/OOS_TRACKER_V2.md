# Reliance Retail OOS Tracker Version 2

Approved by QPMS Super Admin, 2026-10-30.

Quotation Excel uploads extract the unique Quotation Number and every line item. Group by quotation number. Preserve original workbooks, uploader, timestamps and immutable audit history. Revised workbooks for the same number are reworks: retain all versions and increment the rework count. Replaying a saved version must never overwrite later corrections.

| Installed code | Approved display |
| --- | --- |
| QUOTED | Quot Shared - Waiting for PO |
| PO_RECORDED | Commercial Confirmation |
| COMMERCIALLY_CONFIRMED | PO Received - Fund Yet to Raise |
| FUND_RECORDED | Fund recorded |
| PAYMENT_RECORDED | Payment recorded |
| DELIVERED | Delivered |

OOS MIS manually enters the client PO number/date, then advances forward only, subject to existing authorized state permissions and independent commercial review. Preserve later installed stage names/order; no additional approval stages. References record evidence only, never create financial transactions.

Rework must preserve advanced PO/payment/delivery status and details. Installed migration 20261030140000 permits rework before PO only. Advanced-stage rework is BLOCKED pending a separately reviewed additive database change. Never reset status or rerun that migration as a workaround.

Provide quotation drill-down, line items, rework/audit history, state/store/zone/FO filters and Excel export. Missing Zone/FO/AOP does not exclude verified stores. Provisional identities remain non-operational. Do not infer missing business rules.
