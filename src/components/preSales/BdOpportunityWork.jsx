import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  acceptHandoff,
  getBdOpportunityWork,
  prepareOpportunityProposal,
  recordProposalOutcome,
  rejectHandoff,
  sendOpportunityProposal,
  submitBdMeetingMom,
} from '../../services/preSalesApi.js';
import { formatDateTime } from '../../utils/preSalesFormat.js';
import { EmptyState, ErrorState, LoadingState } from './PreSalesUi.jsx';
import OpportunityNotifications from './OpportunityNotifications.jsx';
import OpportunityProgress from './OpportunityProgress.jsx';

const initialMom = {
  subject: '',
  attendees: '',
  requirement_discussed: '',
  scope_summary: '',
  key_points: '',
  client_expectations: '',
  follow_up_actions: '',
  remarks: '',
  site_survey_required: '',
  preferred_survey_date: '',
  site_contact: '',
  site_address: '',
  survey_notes: '',
};

const approvalStages = [
  ['tender', 'Tender Review'],
  ['hr', 'HR Approval'],
  ['commercial', 'Commercial Approval'],
  ['finance', 'Finance Approval'],
  ['cfo', 'CFO Approval'],
  ['coo', 'COO Approval'],
];

function latestOpportunityRows(rows) {
  const byLead = new Map();
  for (const row of rows) {
    if (!row.lead_id || byLead.has(row.lead_id)) continue;
    byLead.set(row.lead_id, row);
  }
  return [...byLead.values()];
}

function belongsInMode(item, mode) {
  if (mode === 'handover') return item.handoff_status === 'pending';
  if (mode === 'meetings') return item.handoff_status === 'accepted' && item.meeting && item.mom?.mom_status !== 'Sent';
  if (mode === 'survey') return item.handoff_status === 'accepted' && item.mom?.site_survey_required === true;
  if (mode === 'approvals') return item.handoff_status === 'accepted' && (item.workflow || item.approvals?.length);
  if (mode === 'proposals') return item.handoff_status === 'accepted'
    && (item.proposal || item.mom?.site_survey_required === false || item.workflow?.current_stage_code === 'returned_to_bd');
  return item.handoff_status !== 'rejected';
}

function ageing(createdAt) {
  if (!createdAt) return '—';
  const days = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000));
  return `${days} day${days === 1 ? '' : 's'}`;
}

export default function BdOpportunityWork({ mode = 'all', showNotifications = true }) {
  const [state, setState] = useState({ loading: true, error: '', items: [] });
  const [busyId, setBusyId] = useState('');
  const [momTarget, setMomTarget] = useState(null);
  const [proposalTarget, setProposalTarget] = useState(null);
  const [expandedLeadId, setExpandedLeadId] = useState('');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const response = await getBdOpportunityWork();
      setState({ loading: false, error: '', items: response.items || [] });
    } catch (error) {
      setState({ loading: false, error: error.message, items: [] });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo(
    () => latestOpportunityRows(state.items).filter((item) => belongsInMode(item, mode)),
    [mode, state.items],
  );

  async function decide(item, decision) {
    let reason = '';
    if (decision === 'rejected') {
      reason = window.prompt('Reason for returning this opportunity to Pre-Sales') || '';
      if (!reason.trim()) return;
    }
    setBusyId(item.id);
    try {
      if (decision === 'accepted') await acceptHandoff(item.id);
      else await rejectHandoff(item.id, reason.trim());
      await load();
    } catch (error) {
      setState((current) => ({ ...current, error: error.message }));
    } finally {
      setBusyId('');
    }
  }

  async function decideProposal(item, outcome) {
    const reason = outcome === 'Lost' ? window.prompt('Reason the opportunity was lost') || '' : '';
    if (outcome === 'Lost' && !reason.trim()) return;
    setBusyId(item.id);
    try {
      await recordProposalOutcome(
        item.proposal.id,
        { outcome, reason: reason.trim() || null },
        globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      );
      await load();
    } catch (error) {
      setState((current) => ({ ...current, error: error.message }));
    } finally {
      setBusyId('');
    }
  }

  async function sendProposal(item) {
    setBusyId(item.id);
    try {
      await sendOpportunityProposal(
        item.proposal.id,
        globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      );
      await load();
    } catch (error) {
      setState((current) => ({ ...current, error: error.message }));
    } finally {
      setBusyId('');
    }
  }

  if (state.loading) return <LoadingState />;
  if (state.error) return <ErrorState message={state.error} onRetry={load} />;
  if (!items.length) {
    const emptyTitle = mode === 'handover'
      ? 'No assigned handovers are waiting.'
      : mode === 'meetings'
        ? 'No accepted meetings are awaiting MOM.'
        : 'No assigned opportunities are in this stage.';
    return <div className="space-y-4">{showNotifications ? <OpportunityNotifications /> : null}<EmptyState title={emptyTitle} /></div>;
  }

  return (
    <section className="space-y-4">
      {showNotifications ? <OpportunityNotifications /> : null}
      {items.map((item) => (
        <article key={item.id} className="enterprise-card p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-slate-950">{item.lead?.client_name || 'Client opportunity'}</p>
              <p className="mt-1 text-sm text-slate-500">
                Lead {String(item.lead_id || '').slice(0, 8)} · {item.lead?.state || 'State not recorded'}
              </p>
              <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <Summary label="Pre-Sales Owner" value={item.pre_sales_owner_name} />
                <Summary label="Business" value={item.lead?.business || 'Business to be finalized'} />
                <Summary label="Meeting Date" value={formatDateTime(item.meeting?.scheduled_at)} />
                <Summary label="Meeting Mode" value={item.meeting?.meeting_mode} />
                <Summary label="Site / Location" value={item.meeting?.location_or_link || item.lead?.site_location} />
                <Summary label="MOM Status" value={item.mom?.mom_status || 'Not Started'} />
                <Summary label="Site Survey Required" value={item.mom ? (item.mom.site_survey_required ? 'Yes' : 'No') : 'Pending MOM'} />
                <Summary label="Preferred Survey Date" value={item.mom?.preferred_survey_date} />
                <Summary label="Current Stage" value={item.workflow?.current_stage_code || item.site_visit?.current_stage || item.lead?.pre_sales_stage} />
                <Summary label="Pending With" value={item.workflow?.pending_role || item.site_visit?.pending_with || (item.handoff_status === 'pending' ? 'Business Development' : 'BD Meeting / MOM')} />
                <Summary label="Branch Head" value={item.branch_head_name || 'Not Assigned'} />
                <Summary label="Operations Manager" value={item.operations_manager_name || 'Not Assigned'} />
                <Summary label="Survey Status" value={item.site_visit?.status || (item.mom?.site_survey_required === false ? 'Not Required' : 'Not Started')} />
                <Summary label="Tender Status" value={item.approvals?.some((approval) => String(approval.stage_code || approval.approval_stage).toLowerCase().includes('tender')) ? 'In Progress' : 'Not Started'} />
                <Summary label="Approval Status" value={item.workflow?.approval_status || item.approvals?.at(-1)?.status || 'Not Started'} />
                <Summary label="Proposal Status" value={item.proposal?.proposal_status || 'Not Started'} />
                <Summary label="Last Updated" value={formatDateTime(item.proposal?.updated_at || item.workflow?.updated_at || item.site_visit?.updated_at || item.mom?.updated_at || item.lead?.updated_at || item.created_at)} />
                <Summary label="Ageing" value={ageing(item.accepted_at || item.created_at)} />
              </dl>
              <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                {item.meeting?.requirement_summary || item.qualification_summary || 'No requirement summary recorded.'}
              </p>
              {mode === 'approvals' ? <ApprovalTracking approvals={item.approvals || []} /> : null}
              <button
                type="button"
                onClick={() => setExpandedLeadId((current) => current === item.lead_id ? '' : item.lead_id)}
                className="mt-4 text-sm font-bold text-blue-700"
              >
                {expandedLeadId === item.lead_id ? 'Hide Opportunity Progress' : 'View Opportunity Progress'}
              </button>
            </div>
            {item.handoff_status === 'pending' ? (
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => decide(item, 'rejected')}
                  className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-bold text-rose-700 disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => decide(item, 'accepted')}
                  className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  Accept
                </button>
              </div>
            ) : item.handoff_status === 'accepted' && item.mom?.mom_status !== 'Sent' ? (
              <button
                type="button"
                onClick={() => setMomTarget(item)}
                className="shrink-0 rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white"
              >
                Complete Meeting & Create MOM
              </button>
            ) : !item.proposal && item.mom?.mom_status === 'Sent'
              && (item.mom?.site_survey_required === false || item.workflow?.current_stage_code === 'returned_to_bd') ? (
                <button type="button" onClick={() => setProposalTarget(item)} className="shrink-0 rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white">Prepare Proposal</button>
              ) : item.proposal?.proposal_status === 'Generated' ? (
                <button type="button" disabled={busyId === item.id} onClick={() => sendProposal(item)} className="shrink-0 rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busyId === item.id ? 'Sending...' : 'Send Proposal'}</button>
              ) : item.proposal?.proposal_status === 'Sent' && !item.proposal?.metadata?.final_outcome ? (
              <div className="flex shrink-0 gap-2">
                <button type="button" disabled={busyId === item.id} onClick={() => decideProposal(item, 'Lost')} className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-bold text-rose-700 disabled:opacity-50">Mark Lost</button>
                <button type="button" disabled={busyId === item.id} onClick={() => decideProposal(item, 'Converted')} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Mark Converted</button>
              </div>
            ) : (
              <p className="shrink-0 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">
                {item.proposal?.metadata?.final_outcome || item.proposal?.proposal_status || item.workflow?.approval_status || 'BD follow-up'}
              </p>
            )}
          </div>
          {expandedLeadId === item.lead_id ? <div className="mt-5 border-t border-slate-100 pt-5"><OpportunityProgress leadId={item.lead_id} /></div> : null}
        </article>
      ))}
      {momTarget ? (
        <MomForm
          item={momTarget}
          onCancel={() => setMomTarget(null)}
          onSaved={async () => {
            setMomTarget(null);
            await load();
          }}
        />
      ) : null}
      {proposalTarget ? (
        <ProposalForm
          item={proposalTarget}
          onCancel={() => setProposalTarget(null)}
          onSaved={async () => {
            setProposalTarget(null);
            await load();
          }}
        />
      ) : null}
    </section>
  );
}

function ApprovalTracking({ approvals }) {
  return <section className="mt-4 rounded-xl border border-slate-100 p-4">
    <h3 className="text-sm font-bold text-slate-900">Approval Tracking</h3>
    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {approvalStages.map(([key, label]) => {
        const approval = approvals.find((row) => String(row.stage_code || row.approval_stage || '').toLowerCase().includes(key));
        return <div key={key} className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{approval?.status || 'Not Started'}</p>
          <p className="mt-1 text-xs text-slate-500">Pending With: {approval?.pending_with || '—'}</p>
          <p className="mt-1 text-xs text-slate-500">Updated: {formatDateTime(approval?.decided_at || approval?.updated_at || approval?.requested_at)}</p>
        </div>;
      })}
    </div>
    <p className="mt-3 text-xs text-slate-500">This section is read-only. Reviews remain with their authorized approval roles.</p>
  </section>;
}

function ProposalForm({ item, onCancel, onSaved }) {
  const [form, setForm] = useState({ proposal_number: '', template_name: '', summary: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await prepareOpportunityProposal(
        item.lead_id,
        form,
        globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      );
      await onSaved();
    } catch (submissionError) {
      setError(submissionError.message);
    } finally {
      setSaving(false);
    }
  }
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
    <form onSubmit={submit} className="w-full max-w-xl space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
      <div><h2 className="text-xl font-bold text-slate-950">Prepare Proposal</h2><p className="mt-1 text-sm text-slate-500">{item.lead?.client_name}</p></div>
      <Field label="Proposal Number" value={form.proposal_number} onChange={(value) => setForm((current) => ({ ...current, proposal_number: value }))} />
      <Field label="Template" value={form.template_name} onChange={(value) => setForm((current) => ({ ...current, template_name: value }))} />
      <Area label="Proposal Summary" value={form.summary} onChange={(value) => setForm((current) => ({ ...current, summary: value }))} />
      <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">Preparing the proposal marks it ready for BD review. Sending it is a separate action and does not mark the opportunity as converted.</p>
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}
      <div className="flex justify-end gap-3"><button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold">Cancel</button><button type="submit" disabled={saving} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Preparing...' : 'Mark Proposal Ready'}</button></div>
    </form>
  </div>;
}

function MomForm({ item, onCancel, onSaved }) {
  const [form, setForm] = useState(initialMom);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!form.requirement_discussed.trim()) {
      setError('Requirement discussed is required.');
      return;
    }
    if (!['yes', 'no'].includes(form.site_survey_required)) {
      setError('Select whether a Site Survey is required.');
      return;
    }
    setSaving(true);
    try {
      await submitBdMeetingMom(item.meeting.id, {
        ...form,
        site_survey_required: form.site_survey_required === 'yes',
      });
      await onSaved();
    } catch (submissionError) {
      setError(submissionError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
      <form onSubmit={submit} className="max-h-[92vh] w-full max-w-3xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div>
          <h2 className="text-xl font-bold text-slate-950">Meeting MOM</h2>
          <p className="mt-1 text-sm text-slate-500">{item.lead?.client_name}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Meeting Outcome / Subject" value={form.subject} onChange={(value) => update('subject', value)} />
          <Field label="Attendees" value={form.attendees} onChange={(value) => update('attendees', value)} />
          <Area label="Requirement Discussed *" value={form.requirement_discussed} onChange={(value) => update('requirement_discussed', value)} />
          <Area label="Scope Summary" value={form.scope_summary} onChange={(value) => update('scope_summary', value)} />
          <Area label="Key Points" value={form.key_points} onChange={(value) => update('key_points', value)} />
          <Area label="Client Expectations" value={form.client_expectations} onChange={(value) => update('client_expectations', value)} />
          <Area label="Follow-up / Actions" value={form.follow_up_actions} onChange={(value) => update('follow_up_actions', value)} />
          <Area label="Remarks" value={form.remarks} onChange={(value) => update('remarks', value)} />
        </div>
        <fieldset className="rounded-xl border border-slate-200 p-4">
          <legend className="px-2 text-sm font-bold text-slate-800">Site Survey Required? *</legend>
          <div className="flex gap-5">
            {['yes', 'no'].map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm font-semibold capitalize">
                <input type="radio" name="site-survey" value={value} checked={form.site_survey_required === value} onChange={(event) => update('site_survey_required', event.target.value)} />
                {value}
              </label>
            ))}
          </div>
          {form.site_survey_required === 'yes' ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Preferred Survey Date" type="date" value={form.preferred_survey_date} onChange={(value) => update('preferred_survey_date', value)} />
              <Field label="Site Contact" value={form.site_contact} onChange={(value) => update('site_contact', value)} />
              <Field label="Site Address" value={form.site_address} onChange={(value) => update('site_address', value)} />
              <Area label="Survey Notes / Instructions" value={form.survey_notes} onChange={(value) => update('survey_notes', value)} />
            </div>
          ) : null}
        </fieldset>
        {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Submit MOM'}</button>
        </div>
      </form>
    </div>
  );
}

function Summary({ label, value }) {
  return <div><dt className="font-semibold text-slate-500">{label}</dt><dd className="mt-1 text-slate-900">{value || '—'}</dd></div>;
}

function Field({ label, value, onChange, type = 'text' }) {
  return <label className="block text-sm font-semibold text-slate-700">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>;
}

function Area({ label, value, onChange }) {
  return <label className="block text-sm font-semibold text-slate-700">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>;
}
