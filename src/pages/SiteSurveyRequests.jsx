import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import OpportunityNotifications from '../components/preSales/OpportunityNotifications.jsx';
import SiteSurveyTat from '../components/preSales/SiteSurveyTat.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/preSales/PreSalesUi.jsx';
import { useAuth } from '../context/auth-context.js';
import { usePageTitle } from '../hooks/usePageTitle.js';
import {
  acceptSiteSurveyAssignment,
  assignSiteSurveyOperationsManager,
  declineSiteSurveyAssignment,
  getAssignedOperationsSiteSurveys,
  getBranchHeadSiteSurveys,
  getBranchOperationsManagers,
} from '../services/preSalesApi.js';
import { isPlatformAdmin, normalizeCanonicalRole } from '../utils/authRoles.js';
import { formatDateTime } from '../utils/preSalesFormat.js';
import { normalizeGoogleMapsLink } from '../utils/googleMapsLink.js';

function formatDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

export default function SiteSurveyRequests() {
  const { user } = useAuth();
  const role = normalizeCanonicalRole(user?.rawRole || user?.role);
  const isBranchHead = role === 'Branch Head';
  const canAssignOperationsManager = isBranchHead || isPlatformAdmin(user);
  const [state, setState] = useState({ loading: true, error: '', items: [] });
  const [assignment, setAssignment] = useState({ siteVisitId: '', assignmentVersion: 0, options: [], selected: '', reassignment: false, reason: '', loading: false, error: '' });
  const [taskAction, setTaskAction] = useState({ siteVisitId: '', type: '', reason: '', loading: false, error: '' });
  usePageTitle('Site Survey Requests');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const response = canAssignOperationsManager
        ? await getBranchHeadSiteSurveys()
        : await getAssignedOperationsSiteSurveys();
      setState({ loading: false, error: '', items: response.items || [] });
    } catch (error) {
      setState({ loading: false, error: error.message, items: [] });
    }
  }, [canAssignOperationsManager]);

  useEffect(() => { void load(); }, [load]);

  async function openAssignment(item) {
    const reassignment = Boolean(item.assigned_operations_manager_profile_id);
    setAssignment({ siteVisitId: item.id, assignmentVersion: item.assignment_version, options: [], selected: '', reassignment, reason: '', loading: true, error: '' });
    try {
      const response = await getBranchOperationsManagers(item.id);
      setAssignment({ siteVisitId: item.id, assignmentVersion: item.assignment_version, options: response.items || [], selected: '', reassignment, reason: '', loading: false, error: '' });
    } catch (error) {
      setAssignment({ siteVisitId: item.id, assignmentVersion: item.assignment_version, options: [], selected: '', reassignment, reason: '', loading: false, error: error.message });
    }
  }

  async function assign() {
    if (!assignment.selected) {
      setAssignment((current) => ({ ...current, error: 'Select an Operations Manager or KAM.' }));
      return;
    }
    if (assignment.reassignment && !assignment.reason.trim()) {
      setAssignment((current) => ({ ...current, error: 'Enter a reason for reassignment.' }));
      return;
    }
    setAssignment((current) => ({ ...current, loading: true, error: '' }));
    try {
      await assignSiteSurveyOperationsManager(assignment.siteVisitId, {
        operations_manager_profile_id: assignment.selected,
        assignment_version: assignment.assignmentVersion,
        reassignment: assignment.reassignment,
        reassignment_reason: assignment.reassignment ? assignment.reason.trim() : null,
      });
      setAssignment({ siteVisitId: '', assignmentVersion: 0, options: [], selected: '', reassignment: false, reason: '', loading: false, error: '' });
      await load();
    } catch (error) {
      setAssignment((current) => ({ ...current, loading: false, error: error.message }));
    }
  }

  async function performTaskAction(item, type, reason = '') {
    setTaskAction({ siteVisitId: item.id, type, reason, loading: true, error: '' });
    try {
      if (type === 'accept') await acceptSiteSurveyAssignment(item.id, item.assignment_version);
      else await declineSiteSurveyAssignment(item.id, item.assignment_version, reason.trim());
      setTaskAction({ siteVisitId: '', type: '', reason: '', loading: false, error: '' });
      await load();
    } catch (error) {
      setTaskAction({ siteVisitId: item.id, type, reason, loading: false, error: error.message });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={canAssignOperationsManager ? 'Site Survey Requests' : 'Assigned Site Surveys'}
        subtitle={canAssignOperationsManager
          ? 'Assign routed requests to active Operations Managers or KAMs in the verified lead State.'
          : 'Complete the Site Visit and assessment tasks assigned to you.'}
      />
      <OpportunityNotifications />
      {state.loading ? <LoadingState /> : state.error ? <ErrorState message={state.error} onRetry={load} /> : !state.items.length ? (
        <EmptyState title="No Site Survey requests are assigned to you." />
      ) : (
        <section className="space-y-3">
          {state.items.map((item) => (
            <article key={item.id} className="enterprise-card flex flex-col justify-between gap-4 p-5 lg:flex-row lg:items-center">
              <div>
                <p className="text-lg font-bold text-slate-950">{item.client_name || item.site_name || 'Site Survey'}</p>
                <p className="mt-1 text-sm text-slate-500">{item.site_address || 'Location not recorded'}</p>
                <dl className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  <div><dt className="font-semibold text-slate-500">Lead Reference</dt><dd>{item.lead_reference || item.lead_id}</dd></div>
                  <div><dt className="font-semibold text-slate-500">MoM Reference</dt><dd>{item.source_lead_mom_id || 'Not recorded'}</dd></div>
                  <div><dt className="font-semibold text-slate-500">Lead State</dt><dd>{item.lead_state || 'Not recorded'}</dd></div>
                  <div><dt className="font-semibold text-slate-500">Preferred Survey Date</dt><dd>{formatDate(item.preferred_survey_date)}</dd></div>
                  <div><dt className="font-semibold text-slate-500">Assigned BD</dt><dd>{item.assigned_bd_name || 'Not recorded'}</dd></div>
                  <div><dt className="font-semibold text-slate-500">Originating Pre-Sales</dt><dd>{item.originating_pre_sales_name || 'Not recorded'}</dd></div>
                  {!isBranchHead ? <div><dt className="font-semibold text-slate-500">Assigned Branch Head</dt><dd>{item.assigned_branch_head_name || 'Not recorded'}</dd></div> : null}
                  {isBranchHead ? <div><dt className="font-semibold text-slate-500">Operations Manager / KAM</dt><dd>{item.assigned_operations_manager_name || 'Not assigned'}</dd></div> : null}
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  {normalizeGoogleMapsLink(item.site_location_link) ? <a href={normalizeGoogleMapsLink(item.site_location_link)} target="_blank" rel="noreferrer" className="rounded-lg border border-blue-200 px-3 py-1.5 text-sm font-bold text-blue-700">Open Site Location</a> : null}
                  {normalizeGoogleMapsLink(item.office_location_link) ? <a href={normalizeGoogleMapsLink(item.office_location_link)} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-700">Open Office Location</a> : null}
                </div>
                <SiteSurveyTat item={item}/>
                {item.mom ? <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700"><p className="font-bold text-slate-900">{item.mom.subject || 'BD Meeting MOM'}</p><p className="mt-1">{item.mom.requirement_discussed || item.mom.scope_summary || 'Requirement summary not recorded.'}</p>{item.mom.survey_notes ? <p className="mt-1 text-slate-500">Survey notes: {item.mom.survey_notes}</p> : null}</div> : null}
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                  <span className="rounded-full bg-slate-100 px-3 py-1">{item.status}</span>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">{item.pending_with}</span>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">{item.acceptance_status?.replaceAll('_', ' ') || 'unassigned'}</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1">Updated {formatDateTime(item.updated_at)}</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {canAssignOperationsManager ? <button type="button" onClick={() => openAssignment(item)} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white">{item.assigned_operations_manager_profile_id ? 'Reassign Operations Manager / KAM' : 'Assign Operations Manager / KAM'}</button> : null}
                {!canAssignOperationsManager && item.acceptance_status === 'pending_acceptance' ? <>
                  <button type="button" disabled={taskAction.loading} onClick={() => void performTaskAction(item, 'accept')} className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">Accept Assignment</button>
                  <button type="button" onClick={() => setTaskAction({ siteVisitId: item.id, type: 'unable', reason: '', loading: false, error: '' })} className="rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-bold text-rose-700">Unable to Attend</button>
                </> : null}
                {item.acceptance_status === 'accepted' ? <Link to={`/site-visit/${encodeURIComponent(item.id)}`} className="rounded-xl bg-blue-700 px-4 py-2.5 text-center text-sm font-bold text-white">Open Site Visit</Link> : null}
              </div>
            </article>
          ))}
        </section>
      )}
      {assignment.siteVisitId ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
          <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-slate-950">{assignment.reassignment ? 'Reassign Operations Manager / KAM' : 'Assign Operations Manager / KAM'}</h2>
            <p className="mt-1 text-sm text-slate-500">Only active employees in the verified lead State are available.</p>
            <select
              value={assignment.selected}
              onChange={(event) => setAssignment((current) => ({ ...current, selected: event.target.value, error: '' }))}
              className="mt-5 w-full rounded-xl border border-slate-200 px-3 py-2.5"
            >
              <option value="">Select Operations Manager / KAM</option>
              {assignment.options.map((person) => <option key={person.id} value={person.id}>{person.full_name} — {person.employee_code} — {person.role}</option>)}
            </select>
            {assignment.reassignment ? <textarea value={assignment.reason} onChange={(event) => setAssignment((current) => ({ ...current, reason: event.target.value, error: '' }))} rows={3} placeholder="Reason for reassignment" className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5" /> : null}
            {assignment.error ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{assignment.error}</p> : null}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setAssignment({ siteVisitId: '', assignmentVersion: 0, options: [], selected: '', reassignment: false, reason: '', loading: false, error: '' })} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold">Cancel</button>
              <button type="button" disabled={assignment.loading} onClick={assign} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{assignment.loading ? 'Saving...' : assignment.reassignment ? 'Reassign' : 'Assign'}</button>
            </div>
          </section>
        </div>
      ) : null}
      {taskAction.type === 'unable' ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
          <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-slate-950">Unable to Attend</h2>
            <p className="mt-1 text-sm text-slate-500">A reason is required. The request will return to the Branch Head for reassignment.</p>
            <textarea value={taskAction.reason} onChange={(event) => setTaskAction((current) => ({ ...current, reason: event.target.value, error: '' }))} rows={4} className="mt-4 w-full rounded-xl border border-slate-200 px-3 py-2.5" />
            {taskAction.error ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{taskAction.error}</p> : null}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setTaskAction({ siteVisitId: '', type: '', reason: '', loading: false, error: '' })} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold">Cancel</button>
              <button type="button" disabled={taskAction.loading || !taskAction.reason.trim()} onClick={() => { const item = state.items.find((candidate) => candidate.id === taskAction.siteVisitId); if (item) void performTaskAction(item, 'unable', taskAction.reason); }} className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{taskAction.loading ? 'Saving...' : 'Confirm'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
