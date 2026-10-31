export function scopedFaultExportRows(tickets){
 return [['Ticket No','Store Code','Store Name','State','Stage','Ageing Days','Ageing Bucket','Created At','Updated At','Supervisor','Remarks'],...tickets.map(t=>[t.ticketNumber,t.storeId,t.storeName,t.groupedState,t.ifmsStage,t.ageingDays,t.ageingBucket,t.createdAt,t.updatedAt,t.supName,t.remarks])];
}
