import { useEffect, useState } from 'react';
import { siteSurveyTat } from '../../../backend/shared/siteSurveyTat.js';
import { formatDateTime } from '../../utils/preSalesFormat.js';

export default function SiteSurveyTat({ item }) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return ()=>clearInterval(timer);},[]);
  const tat=siteSurveyTat(item,now);if(!tat)return null;
  const duration=(ms)=>`${Math.floor(ms/3600000)}h ${Math.floor(ms%3600000/60000)}m`;
  return <dl className="mt-4 grid gap-3 rounded-xl bg-blue-50 p-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
    {[
      ['Current owner',item.pending_with==='Branch Head'?item.assigned_branch_head_name:item.assigned_operations_manager_name||item.assigned_branch_head_name||item.pending_with],
      ['Assignment status',tat.assignment_status.replaceAll('_',' ')],['Survey status',tat.survey_status],
      ['Assigned',formatDateTime(tat.assigned_at)],['Assignment deadline',formatDateTime(tat.assignment_deadline)],
      ['TAT deadline',formatDateTime(tat.deadline)],['72-hour deadline',formatDateTime(tat.overdue_deadline)],
      [tat.overdue_ms?'Overdue by':'Remaining',duration(tat.overdue_ms||tat.remaining_ms||0)],
      ['Escalation',tat.escalation_status],['Submitted',formatDateTime(tat.submitted_at)],
    ].map(([label,value])=><div key={label}><dt className="font-semibold text-slate-500">{label}</dt><dd>{value||'Not recorded'}</dd></div>)}
  </dl>;
}
