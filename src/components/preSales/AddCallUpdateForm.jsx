import { useMemo, useState } from 'react';
import { FEEDBACK_REQUIRING_FOLLOWUP, PRE_SALES_FEEDBACK, PRE_SALES_FEEDBACK_LABELS } from '../../../shared/preSalesConstants.js';
import { useAuth } from '../../context/auth-context.js';
import { canEditPreSalesLead } from '../../utils/authRoles.js';

const initial = { feedback_type: '', notes: '', next_action: '', followup_date: '', followup_time: '', meeting_required: false, qualified: false, meeting_date: '', meeting_time: '', meeting_mode: 'in_person', location_or_link: '' };

function combine(date, time, defaultTime = '') {
  return date && (time || defaultTime) ? new Date(`${date}T${time || defaultTime}`).toISOString() : null;
}

export default function AddCallUpdateForm({ onSubmit, saving }) {
  const { user } = useAuth();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const needsFollowup = useMemo(() => FEEDBACK_REQUIRING_FOLLOWUP.includes(form.feedback_type) || (form.feedback_type === PRE_SALES_FEEDBACK.INTERESTED && !form.meeting_required), [form.feedback_type, form.meeting_required]);
  const optionalFollowup = form.feedback_type === PRE_SALES_FEEDBACK.NO_REQUIREMENT;
  const notesLabel = form.feedback_type === PRE_SALES_FEEDBACK.INVALID_LEAD ? 'Invalid Reason / Notes *' : 'Notes / Summary *';
  const scheduleLabels = form.feedback_type === PRE_SALES_FEEDBACK.RNR
    ? ['Schedule Call Date *', 'Schedule Call Time *']
    : form.feedback_type === PRE_SALES_FEEDBACK.CALL_BACK
      ? ['Callback Date *', 'Callback Time *']
      : optionalFollowup
        ? ['Renewal / Revisit Date', 'Time']
        : ['Follow-up Date *', 'Follow-up Time *'];
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  if (!canEditPreSalesLead(user)) {
    return <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">You have read-only access to this lead.</p>;
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!form.feedback_type || !form.notes.trim()) return setError('Calling feedback and notes are required.');
    if (needsFollowup && (!form.followup_date || !form.followup_time)) return setError('A future follow-up date and time are required for this outcome.');
    if (form.feedback_type === PRE_SALES_FEEDBACK.INTERESTED && form.meeting_required && (!form.meeting_date || !form.meeting_time)) return setError('Meeting date and time are required.');
    try {
      await onSubmit({
        feedback_type: form.feedback_type,
        notes: form.notes.trim(),
        next_action: form.next_action.trim(),
        followup_at: combine(form.followup_date, form.followup_time, optionalFollowup ? '09:00' : ''),
        meeting_required: form.meeting_required,
        qualified: form.qualified,
        meeting: form.meeting_required ? { scheduled_at: combine(form.meeting_date, form.meeting_time), meeting_mode: form.meeting_mode, location_or_link: form.location_or_link.trim(), meeting_notes: form.notes.trim() } : null,
      });
      setForm(initial);
    } catch (submissionError) {
      setError(submissionError.message);
    }
  }

  return <form onSubmit={submit} className="space-y-4"><label className="block text-sm font-semibold text-slate-700">Calling Feedback *<select value={form.feedback_type} onChange={(event) => update('feedback_type', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"><option value="">Select feedback</option>{Object.entries(PRE_SALES_FEEDBACK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block text-sm font-semibold text-slate-700">{notesLabel}<textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label><label className="block text-sm font-semibold text-slate-700">Next Action<input value={form.next_action} onChange={(event) => update('next_action', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>{form.feedback_type === PRE_SALES_FEEDBACK.INTERESTED ? <><label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.meeting_required} onChange={(event) => update('meeting_required', event.target.checked)} />Meeting required?</label><label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={form.qualified} onChange={(event) => update('qualified', event.target.checked)} />Qualification confirmed</label></> : null}{form.meeting_required ? <div className="grid gap-3 sm:grid-cols-2"><Field label="Meeting Date" type="date" value={form.meeting_date} onChange={(value) => update('meeting_date', value)} /><Field label="Meeting Time" type="time" value={form.meeting_time} onChange={(value) => update('meeting_time', value)} /><label className="block text-sm font-semibold text-slate-700">Meeting Mode<select value={form.meeting_mode} onChange={(event) => update('meeting_mode', event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"><option value="in_person">In person</option><option value="video">Video</option><option value="phone">Phone</option></select></label><Field label="Location / Link" value={form.location_or_link} onChange={(value) => update('location_or_link', value)} /></div> : null}{(needsFollowup || optionalFollowup) && !form.meeting_required ? <div className="grid gap-3 sm:grid-cols-2"><Field label={scheduleLabels[0]} type="date" value={form.followup_date} onChange={(value) => update('followup_date', value)} /><Field label={scheduleLabels[1]} type="time" value={form.followup_time} onChange={(value) => update('followup_time', value)} /></div> : null}{error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p> : null}<button type="submit" disabled={saving} className="w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">{saving ? 'Saving...' : 'Save Call Update'}</button></form>;
}

function Field({ label, type = 'text', value, onChange }) {
  return <label className="block text-sm font-semibold text-slate-700">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>;
}
