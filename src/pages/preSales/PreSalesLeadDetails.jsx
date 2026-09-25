import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BriefcaseBusiness, Mail, MapPin, Pencil, Phone } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import AddCallUpdateForm from '../../components/preSales/AddCallUpdateForm.jsx';
import OpportunityProgress from '../../components/preSales/OpportunityProgress.jsx';
import { EmptyState, ErrorState, LeadPriorityBadge, LeadStageBadge, LoadingState } from '../../components/preSales/PreSalesUi.jsx';
import { useAuth } from '../../context/auth-context.js';
import { feedbackLabel } from '../../../shared/preSalesConstants.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { formatDateTime } from '../../utils/preSalesFormat.js';
import { canAssignLead, canEditPreSalesLead } from '../../utils/authRoles.js';
import {
  addCallUpdate,
  assignPreSalesOwner,
  completeFollowup,
  createHandoff,
  createMeeting,
  getBdHandoffAssignees,
  getCallHistory,
  getFollowups,
  getHandoffs,
  getMeetings,
  getPreSalesLead,
  getPreSalesOwners,
  rescheduleFollowup,
  updateMeeting,
} from '../../services/preSalesApi.js';

const tabs = ['Overview', 'Call History', 'Follow-ups', 'Meetings & MOM', 'Documents', 'Handover', 'Opportunity Progress'];

export default function PreSalesLeadDetails() {
  const { leadId } = useParams();
  const { user } = useAuth();
  usePageTitle('Lead Details');
  const [leadState, setLeadState] = useState({ loading: true, error: '', lead: null, owners: [] });
  const [activeTab, setActiveTab] = useState('Overview');
  const [tabState, setTabState] = useState({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const loadLead = useCallback(async () => {
    setLeadState((current) => ({ ...current, loading: true, error: '' }));
    try { const [response, ownerResponse] = await Promise.all([getPreSalesLead(leadId), getPreSalesOwners()]); setLeadState({ loading: false, error: '', lead: response.lead, owners: ownerResponse.items || [] }); }
    catch (error) { setLeadState({ loading: false, error: error.message, lead: null, owners: [] }); }
  }, [leadId]);
  useEffect(() => { void loadLead(); }, [loadLead]);

  const loadTab = useCallback(async (tab) => {
    setTabState((current) => ({ ...current, [tab]: { loading: true, loaded: false, error: '', items: [] } }));
    try {
      let response = { items: [] };
      if (tab === 'Call History') response = await getCallHistory(leadId);
      if (tab === 'Follow-ups') response = await getFollowups({ lead_id: leadId });
      if (tab === 'Meetings & MOM') response = await getMeetings(leadId);
      if (tab === 'Handover') {
        const [handoffs, assignees] = await Promise.all([getHandoffs(leadId), getBdHandoffAssignees()]);
        response = { items: handoffs.items, assignees: assignees.items };
      }
      setTabState((current) => ({ ...current, [tab]: { loading: false, loaded: true, error: '', items: response.items || [], assignees: response.assignees || [] } }));
    } catch (error) {
      setTabState((current) => ({ ...current, [tab]: { loading: false, loaded: false, error: error.message, items: [] } }));
    }
  }, [leadId]);
  useEffect(() => { if (!['Overview', 'Documents', 'Opportunity Progress'].includes(activeTab)) void loadTab(activeTab); }, [activeTab, loadTab]);

  async function saveCall(payload) {
    setSaving(true); setNotice('');
    try { await addCallUpdate(leadId, payload); setNotice('Call update saved.'); await Promise.all([loadLead(), loadTab('Call History', true), loadTab('Follow-ups', true), loadTab('Meetings & MOM', true)]); }
    finally { setSaving(false); }
  }

  if (leadState.loading) return <LoadingState label="Loading lead details..." />;
  if (leadState.error) return <ErrorState message={leadState.error} onRetry={loadLead} />;
  const lead = leadState.lead;
  const permissions = lead.permissions || {};
  const contact = lead.primary_contact || lead.contacts?.[0] || {};
  return <div className="space-y-6"><Link to="/pre-sales/leads" className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-blue-700"><ArrowLeft className="h-4 w-4" /> Back to Leads</Link>{permissions.access_mode === 'read_only' ? <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">View only — this opportunity has been handed over to Business Development.</p> : null}<header className="enterprise-card p-6"><div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start"><div><div className="flex flex-wrap items-center gap-2"><LeadStageBadge value={lead.pre_sales_stage} /><LeadPriorityBadge value={lead.lead_priority} /></div><h1 className="mt-4 text-3xl font-bold text-slate-950">{contact.contact_person_name || lead.client_name}</h1><p className="mt-1 text-lg text-slate-500">{lead.client_name}</p><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600"><span className="inline-flex items-center gap-2"><BriefcaseBusiness className="h-4 w-4" />{lead.industry_type || 'Industry not recorded'}</span><span className="inline-flex items-center gap-2"><Phone className="h-4 w-4" />{contact.contact_number || 'No phone'}</span><span className="inline-flex items-center gap-2"><Mail className="h-4 w-4" />{contact.email_id || 'No email'}</span><span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4" />{[lead.site_location, lead.city, lead.state].filter(Boolean).join(', ') || 'No location'}</span></div></div><div className="flex flex-wrap gap-3">{permissions.can_edit_pre_sales && canEditPreSalesLead(user) ? <Link to={`/pre-sales/leads/${lead.id}/edit`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700"><Pencil className="h-4 w-4" /> Edit Lead</Link> : null}<button type="button" disabled={!permissions.can_handover} onClick={() => setActiveTab('Handover')} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">Move to Handover</button></div></div><div className="mt-6 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-4"><Summary label="Owner" value={lead.owner_name} /><Summary label="Next Action" value={lead.next_action || 'Not scheduled'} /><Summary label="Lead Created" value={formatDateTime(lead.created_at)} /><Summary label="Last Updated" value={formatDateTime(lead.last_update)} /></div>{permissions.can_edit_pre_sales && leadState.owners.length > 1 ? <OwnerAssignment owners={leadState.owners} current={lead.owner_profile_id} onAssign={async (ownerId) => { await assignPreSalesOwner(lead.id, ownerId); await loadLead(); setNotice('Pre-Sales owner assigned.'); }} /> : null}</header>{notice ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</p> : null}<div className="overflow-x-auto"><div className="inline-flex min-w-full gap-1 rounded-2xl bg-slate-100 p-1">{tabs.map((tab) => <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-bold ${activeTab === tab ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}>{tab}</button>)}</div></div><div className="grid gap-6 xl:grid-cols-[1fr_360px]"><main><TabContent tab={activeTab} lead={lead} permissions={permissions} state={tabState[activeTab]} reload={() => loadTab(activeTab, true)} setNotice={setNotice} onCompleteFollowup={async (id) => { await completeFollowup(id, {}); await loadTab('Follow-ups', true); setNotice('Follow-up completed.'); }} onRescheduleFollowup={async (id) => { const value = window.prompt('New date and time (YYYY-MM-DDTHH:mm)'); if (!value) return; await rescheduleFollowup(id, { scheduled_at: new Date(value).toISOString() }); await loadTab('Follow-ups', true); setNotice('Follow-up rescheduled.'); }} onCreateMeeting={async (payload) => { await createMeeting(leadId, payload); await loadTab('Meetings & MOM', true); await loadLead(); setNotice('Meeting scheduled.'); }} onCompleteMeeting={async (id, requirement) => { await updateMeeting(id, { meeting_status: 'completed', requirement_identified: requirement }); await loadTab('Meetings & MOM', true); await loadLead(); setNotice('Meeting completed.'); }} onCreateHandoff={async (payload) => { await createHandoff(leadId, payload); await loadTab('Handover', true); await loadLead(); setNotice('Handover created for BD acceptance.'); }} /></main>{activeTab !== 'Opportunity Progress' ? <aside className="enterprise-card h-fit p-5 xl:sticky xl:top-24"><h2 className="text-lg font-bold text-slate-950">Add Call Update</h2><p className="mt-1 text-sm text-slate-500">Record the outcome and schedule the next action.</p><div className="mt-5"><AddCallUpdateForm onSubmit={saveCall} saving={saving} allowed={permissions.can_add_call_update} /></div></aside> : null}</div></div>;
}

function TabContent({ tab, lead, permissions, state, reload, setNotice, onCompleteFollowup, onRescheduleFollowup, onCreateMeeting, onCompleteMeeting, onCreateHandoff }) {
  if (tab === 'Overview') return <Overview lead={lead} />;
  if (tab === 'Opportunity Progress') return <OpportunityProgress leadId={lead.id} />;
  if (tab === 'Documents') return <EmptyState title="Documents coming in the next phase." description="No lead-document backend exists yet; no sample documents are shown." />;
  if (!state || state.loading) return <LoadingState label={`Loading ${tab.toLowerCase()}...`} />;
  if (state.error) return <ErrorState message={state.error} onRetry={reload} />;
  if (tab === 'Call History') return <CallHistory items={state.items} />;
  if (tab === 'Follow-ups') return <Followups items={state.items} editable={permissions.can_manage_followups} onComplete={onCompleteFollowup} onReschedule={onRescheduleFollowup} />;
  if (tab === 'Meetings & MOM') return <Meetings items={state.items} editable={permissions.can_manage_meetings} leadMom={lead.lead_mom || []} onCreate={onCreateMeeting} onComplete={onCompleteMeeting} setNotice={setNotice} />;
  if (tab === 'Handover') return <Handover items={state.items} editable={permissions.can_handover} assignees={state.assignees} lead={lead} onCreate={onCreateHandoff} />;
  return null;
}

function Overview({ lead }) {
  const contact = lead.primary_contact || lead.contacts?.[0] || {};
  return <div className="grid gap-5 md:grid-cols-2"><Card title="Company Details"><Rows rows={[['Company', lead.client_name], ['Industry', lead.industry_type], ['Lead Source', lead.lead_source], ['Business', lead.business], ['Branch', lead.branch], ['Address', lead.site_location], ['City', lead.city], ['State', lead.state]]} /></Card><Card title="Primary Contact"><Rows rows={[['Name', contact.contact_person_name], ['Designation', contact.contact_person_designation], ['Phone', contact.contact_number], ['Official Email', contact.email_id]]} /></Card><Card title="Lead Information"><Rows rows={[['Priority', lead.lead_priority], ['Owner', lead.owner_name], ['Created By', lead.created_by_name], ['Created', formatDateTime(lead.created_at)], ['Status', lead.status], ['Remarks', lead.remarks]]} /></Card><Card title="Activity Timeline">{lead.activity_logs?.length ? <div className="space-y-3">{lead.activity_logs.map((item) => <div key={item.id} className="border-l-2 border-blue-200 pl-3"><p className="font-semibold text-slate-800">{item.activity_message || item.activity_type}</p><p className="text-xs text-slate-500">{formatDateTime(item.created_at)} · {item.created_by || 'System'}</p></div>)}</div> : <p className="text-sm text-slate-500">No activity yet.</p>}</Card></div>;
}

function CallHistory({ items }) {
  if (!items.length) return <EmptyState title="No call history yet." />;
  return <Card title="Call History"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="pb-3">Date & Time</th><th className="pb-3">Feedback</th><th className="pb-3">Notes</th><th className="pb-3">Next Action</th><th className="pb-3">Updated By</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item) => <tr key={item.id}><td className="py-3">{formatDateTime(item.created_at)}</td><td className="py-3"><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{feedbackLabel(item.feedback_type)}</span></td><td className="py-3">{item.notes}</td><td className="py-3">{item.next_action || formatDateTime(item.followup_at)}</td><td className="py-3">{item.created_by_name}</td></tr>)}</tbody></table></div></Card>;
}

function Followups({ items, editable, onComplete, onReschedule }) {
  if (!items.length) return <EmptyState title="No follow-ups scheduled." />;
  return <Card title="Follow-ups"><div className="space-y-3">{items.map((item) => { const overdue = item.status === 'pending' && new Date(item.scheduled_at) < new Date(); return <div key={item.id} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-100 p-4 sm:flex-row sm:items-center"><div><p className="font-semibold text-slate-900">{item.followup_type}</p><p className={`mt-1 text-sm ${overdue ? 'font-semibold text-rose-600' : 'text-slate-500'}`}>{formatDateTime(item.scheduled_at)} · {item.status}</p><p className="mt-1 text-sm text-slate-600">{item.remarks}</p></div>{editable && item.status === 'pending' ? <div className="flex gap-2"><button type="button" onClick={() => onComplete(item.id)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Complete</button><button type="button" onClick={() => onReschedule(item.id)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold">Reschedule</button></div> : null}</div>; })}</div></Card>;
}

function Meetings({ items, editable, leadMom, onCreate, onComplete }) {
  const [form, setForm] = useState({ date: '', time: '', meeting_mode: 'in_person', location_or_link: '', meeting_notes: '' });
  async function submit(event) { event.preventDefault(); if (!form.date || !form.time) return; await onCreate({ scheduled_at: new Date(`${form.date}T${form.time}`).toISOString(), meeting_mode: form.meeting_mode, location_or_link: form.location_or_link, meeting_notes: form.meeting_notes }); setForm({ date: '', time: '', meeting_mode: 'in_person', location_or_link: '', meeting_notes: '' }); }
  if (!editable) return <ReadOnlyMeetings items={items} leadMom={leadMom} />;
  return <div className="space-y-5"><Card title="Schedule Meeting"><form onSubmit={submit} className="grid gap-3 sm:grid-cols-2"><Input label="Date" type="date" value={form.date} onChange={(value) => setForm({ ...form, date: value })} /><Input label="Time" type="time" value={form.time} onChange={(value) => setForm({ ...form, time: value })} /><label className="text-sm font-semibold">Mode<select value={form.meeting_mode} onChange={(event) => setForm({ ...form, meeting_mode: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"><option value="in_person">In person</option><option value="video">Video</option><option value="phone">Phone</option></select></label><Input label="Location / Link" value={form.location_or_link} onChange={(value) => setForm({ ...form, location_or_link: value })} /><div className="sm:col-span-2"><Input label="Meeting Notes" value={form.meeting_notes} onChange={(value) => setForm({ ...form, meeting_notes: value })} /></div><button className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white sm:col-span-2">Schedule Meeting</button></form></Card><Card title="Meeting History">{items.length ? <div className="space-y-3">{items.map((item) => <div key={item.id} className="rounded-xl border border-slate-100 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{formatDateTime(item.scheduled_at)} · {item.meeting_mode}</p><p className="mt-1 text-sm text-slate-500">{item.location_or_link || 'No location/link'} · {item.meeting_status}</p><p className="mt-2 text-sm">{item.meeting_notes}</p></div>{item.meeting_status !== 'completed' ? <div className="flex gap-2"><button type="button" onClick={() => onComplete(item.id, true)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Complete: Requirement Found</button><button type="button" onClick={() => onComplete(item.id, false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold">Complete: Follow-up</button></div> : null}</div></div>)}</div> : <p className="text-sm text-slate-500">No meetings yet.</p>}</Card><Card title="Existing Lead MOM">{leadMom.length ? <Rows rows={[['Status', leadMom[0].mom_status], ['Subject', leadMom[0].subject], ['Discussion', leadMom[0].discussion_summary], ['Sent', formatDateTime(leadMom[0].sent_at)]]} /> : <p className="text-sm text-slate-500">No existing Lead MOM. Multiple MOM history remains a later phase.</p>}</Card></div>;
}

function Handover({ items, editable, assignees = [], lead, onCreate }) {
  const [form, setForm] = useState({ to_profile_id: '', qualification_summary: '', handoff_notes: '' });
  const eligible = lead.status === 'Qualified' || lead.pre_sales_stage === 'pending_bd_handover';
  const pending = items.some((item) => item.handoff_status === 'pending');
  async function submit(event) { event.preventDefault(); await onCreate(form); setForm({ to_profile_id: '', qualification_summary: '', handoff_notes: '' }); }
  if (!editable) return <HandoverHistory items={items} readOnly />;
  return <div className="space-y-5"><Card title="Handover to Business Development">{!eligible ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">Qualify the lead before creating a handover.</p> : pending ? <p className="rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-800">Pending BD Acceptance</p> : <form onSubmit={submit} className="space-y-3"><label className="block text-sm font-semibold">BD Owner<select required value={form.to_profile_id} onChange={(event) => setForm({ ...form, to_profile_id: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"><option value="">Select BD owner</option>{assignees.map((item) => <option key={item.id} value={item.id}>{item.full_name} — {item.employee_code}</option>)}</select></label><Input label="Qualification Summary" value={form.qualification_summary} onChange={(value) => setForm({ ...form, qualification_summary: value })} /><Input label="Handover Notes" value={form.handoff_notes} onChange={(value) => setForm({ ...form, handoff_notes: value })} /><button className="w-full rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white">Create Pending Handover</button></form>}</Card><Card title="Handover History">{items.length ? <div className="space-y-3">{items.map((item) => <div key={item.id} className="rounded-xl border border-slate-100 p-4"><p className="font-semibold capitalize">{item.handoff_status}</p><p className="mt-1 text-sm text-slate-600">{item.qualification_summary}</p><p className="mt-1 text-xs text-slate-500">{formatDateTime(item.created_at)} · {item.to_profile?.full_name || 'BD owner'}</p>{item.rejection_reason ? <p className="mt-2 text-sm text-rose-600">{item.rejection_reason}</p> : null}</div>)}</div> : <p className="text-sm text-slate-500">No handover history.</p>}</Card></div>;
}

function Card({ title, children }) { return <section className="enterprise-card p-5"><h2 className="mb-4 text-lg font-bold text-slate-950">{title}</h2>{children}</section>; }
function ReadOnlyMeetings({ items, leadMom }) { return <div className="space-y-5"><Card title="Meeting History">{items.length ? <div className="space-y-3">{items.map((item) => <div key={item.id} className="rounded-xl border border-slate-100 p-4"><p className="font-semibold">{formatDateTime(item.scheduled_at)} · {item.meeting_mode}</p><p className="mt-1 text-sm text-slate-500">{item.location_or_link || 'No location/link'} · {item.meeting_status}</p><p className="mt-2 text-sm">{item.meeting_notes}</p></div>)}</div> : <p className="text-sm text-slate-500">No meetings yet.</p>}</Card><Card title="Existing Lead MOM">{leadMom.length ? <Rows rows={[["Status", leadMom[0].mom_status], ["Subject", leadMom[0].subject], ["Discussion", leadMom[0].discussion_summary], ["Sent", formatDateTime(leadMom[0].sent_at)]]} /> : <p className="text-sm text-slate-500">No existing Lead MOM.</p>}</Card></div>; }
function HandoverHistory({ items, readOnly = false }) { return <Card title="Handover History">{readOnly ? <p className="mb-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">You have read-only access to handover history.</p> : null}{items.length ? <div className="space-y-3">{items.map((item) => <div key={item.id} className="rounded-xl border border-slate-100 p-4"><p className="font-semibold capitalize">{item.handoff_status}</p><p className="mt-1 text-sm text-slate-600">{item.qualification_summary}</p><p className="mt-1 text-xs text-slate-500">{formatDateTime(item.created_at)} · {item.to_profile?.full_name || 'BD owner'}</p>{item.rejection_reason ? <p className="mt-2 text-sm text-rose-600">{item.rejection_reason}</p> : null}</div>)}</div> : <p className="text-sm text-slate-500">No handover history.</p>}</Card>; }
function Rows({ rows }) { return <dl className="space-y-3">{rows.map(([label, value]) => <div key={label} className="grid grid-cols-[130px_1fr] gap-3 text-sm"><dt className="font-semibold text-slate-500">{label}</dt><dd className="text-slate-800">{value || '—'}</dd></div>)}</dl>; }
function Summary({ label, value }) { return <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-sm font-semibold text-slate-800">{value || '—'}</p></div>; }
function Input({ label, type = 'text', value, onChange }) { return <label className="block text-sm font-semibold text-slate-700">{label}<input required={label === 'Qualification Summary'} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>; }
function OwnerAssignment({ owners, current, onAssign }) { const { user } = useAuth(); const [value, setValue] = useState(current || ''); if (!canAssignLead(user)) return null; return <div className="mt-5 flex flex-col gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:items-end"><label className="flex-1 text-sm font-semibold text-slate-700">Pre-Sales Owner<select value={value} onChange={(event) => setValue(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"><option value="">Select owner</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.full_name} — {owner.employee_code}</option>)}</select></label><button type="button" disabled={!value || value === current} onClick={() => onAssign(value)} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">Assign Owner</button></div>; }
