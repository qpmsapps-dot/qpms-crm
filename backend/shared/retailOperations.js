import {reportingState,STATE_OPTIONS,validDate} from './retailAttendance.js';

export function operationMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw Error('Select a reporting month.');
  return validDate(`${month}-01`);
}
export function maintenanceWindow(month,kind,today) {
  const first=operationMonth(month);validDate(today);
  if(!['CM','PM'].includes(kind))throw Error('Select CM or PM.');
  const [year,number]=month.split('-').map(Number);
  const start=kind==='CM'?first:`${month}-16`;
  const end=kind==='CM'?`${month}-15`:`${month}-${new Date(Date.UTC(year,number,0)).getUTCDate()}`;
  return {start,end,open:today>=start&&today<=end,status:today<start?'Upcoming':today>end?'Closed — no additions, edits or deletion':'Open'};
}
function selected(stores,{state='',store=''}={}) {
  return stores.filter(s=>(!state||reportingState(s.state)===reportingState(state))&&(!store||s.id===store));
}
export function maintenanceReport(source,month,filter={}) {
  const stores=selected(source.stores,filter),calls=new Map(source.calls.map(c=>[`${c.retail_store_id}:${c.kind}`,c]));
  const modules={};
  for(const kind of ['CM','PM']) {
    const rows=stores.filter(s=>s.status==='Active'||calls.has(`${s.id}:${kind}`)).map(s=>{
      const call=calls.get(`${s.id}:${kind}`);
      return {...s,reporting_state:reportingState(s.state),completed:Boolean(call),completed_on:call?.completed_on??null,completed_at:call?.completed_at??null,completed_by:call?.completed_by??null,record_id:call?.id??null};
    });
    const states=STATE_OPTIONS.map(state=>{const group=rows.filter(s=>s.reporting_state===state),completed=group.filter(s=>s.completed).length;return {state,eligible:group.length,completed,remaining:group.length-completed};});
    modules[kind.toLowerCase()]={status:'ready',rows:states.filter(s=>!filter.state||s.state===reportingState(filter.state)),stores:rows,window:maintenanceWindow(month,kind,source.today),total:{eligible:rows.length,completed:rows.filter(s=>s.completed).length,remaining:rows.filter(s=>!s.completed).length}};
  }
  return {month,today:source.today,stores,events:source.events.filter(e=>source.calls.some(c=>c.id===e.entity_id&&stores.some(s=>s.id===c.retail_store_id))),modules};
}
export function thermographyReport(source,month,filter={}) {
  const stores=selected(source.stores,filter),byId=new Map(stores.map(s=>[s.id,s]));
  const rows=source.thermography.filter(t=>byId.has(t.retail_store_id)).map(t=>({...t,store:byId.get(t.retail_store_id),reporting_state:reportingState(byId.get(t.retail_store_id).state),approval_overdue:t.status==='Completed'&&source.today>t.approval_due_on}));
  const count=group=>({scheduled:group.filter(t=>t.status==='Scheduled').length,awaiting:group.filter(t=>t.status==='Completed').length,approved:group.filter(t=>t.status==='Client Approved').length,overdue:group.filter(t=>t.approval_overdue).length,approved_late:group.filter(t=>t.approved_late).length});
  return {month,today:source.today,stores,rows,total:count(rows),states:STATE_OPTIONS.map(state=>({state,...count(rows.filter(t=>t.reporting_state===state))})).filter(s=>!filter.state||s.state===reportingState(filter.state)),events:source.events.filter(e=>rows.some(t=>t.id===e.entity_id))};
}
