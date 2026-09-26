import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import OpportunityNotifications from '../components/preSales/OpportunityNotifications.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/preSales/PreSalesUi.jsx';
import { useAuth } from '../context/auth-context.js';
import { usePageTitle } from '../hooks/usePageTitle.js';
import {
  assignSiteSurveyOperationsManager,
  getAssignedOperationsSiteSurveys,
  getBranchHeadSiteSurveys,
  getBranchOperationsManagers,
} from '../services/preSalesApi.js';
import { normalizeCanonicalRole } from '../utils/authRoles.js';
import { formatDateTime } from '../utils/preSalesFormat.js';

export default function SiteSurveyRequests() {
  const { user } = useAuth();
  const role = normalizeCanonicalRole(user?.rawRole || user?.role);
  const isBranchHead = role === 'Branch Head';
  const [state, setState] = useState({ loading: true, error: '', items: [] });
  const [assignment, setAssignment] = useState({ siteVisitId: '', options: [], selected: '', loading: false, error: '' });
  usePageTitle('Site Survey Requests');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const response = isBranchHead
        ? await getBranchHeadSiteSurveys()
        : await getAssignedOperationsSiteSurveys();
      setState({ loading: false, error: '', items: response.items || [] });
    } catch (error) {
      setState({ loading: false, error: error.message, items: [] });
    }
  }, [isBranchHead]);

  useEffect(() => { void load(); }, [load]);

  async function openAssignment(siteVisitId) {
    setAssignment({ siteVisitId, options: [], selected: '', loading: true, error: '' });
    try {
      const response = await getBranchOperationsManagers(siteVisitId);
      setAssignment({ siteVisitId, options: response.items || [], selected: '', loading: false, error: '' });
    } catch (error) {
      setAssignment({ siteVisitId, options: [], selected: '', loading: false, error: error.message });
    }
  }

  async function assign() {
    if (!assignment.selected) {
      setAssignment((current) => ({ ...current, error: 'Select an Operations Manager.' }));
      return;
    }
    setAssignment((current) => ({ ...current, loading: true, error: '' }));
    try {
      await assignSiteSurveyOperationsManager(assignment.siteVisitId, assignment.selected);
      setAssignment({ siteVisitId: '', options: [], selected: '', loading: false, error: '' });
      await load();
    } catch (error) {
      setAssignment((current) => ({ ...current, loading: false, error: error.message }));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={isBranchHead ? 'Site Survey Requests' : 'Assigned Site Surveys'}
        subtitle={isBranchHead
          ? 'Assign routed requests only to Operations Managers in your reporting hierarchy.'
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
                <p className="mt-1 text-sm text-slate-500">{item.site_location || 'Location not recorded'}</p>
                {item.mom ? <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700"><p className="font-bold text-slate-900">{item.mom.subject || 'BD Meeting MOM'}</p><p className="mt-1">{item.mom.requirement_discussed || item.mom.scope_summary || 'Requirement summary not recorded.'}</p>{item.mom.survey_notes ? <p className="mt-1 text-slate-500">Survey notes: {item.mom.survey_notes}</p> : null}</div> : null}
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                  <span className="rounded-full bg-slate-100 px-3 py-1">{item.status}</span>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">{item.pending_with}</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1">Updated {formatDateTime(item.updated_at)}</span>
                </div>
              </div>
              {isBranchHead && !item.assigned_operations_manager_profile_id ? (
                <button type="button" onClick={() => openAssignment(item.id)} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white">Assign Operations Manager</button>
              ) : (
                <Link to={`/site-visit/${encodeURIComponent(item.id)}`} className="rounded-xl bg-blue-700 px-4 py-2.5 text-center text-sm font-bold text-white">Open Site Visit</Link>
              )}
            </article>
          ))}
        </section>
      )}
      {assignment.siteVisitId ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4">
          <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-slate-950">Assign Operations Manager</h2>
            <p className="mt-1 text-sm text-slate-500">Only validated direct reports are available.</p>
            <select
              value={assignment.selected}
              onChange={(event) => setAssignment((current) => ({ ...current, selected: event.target.value, error: '' }))}
              className="mt-5 w-full rounded-xl border border-slate-200 px-3 py-2.5"
            >
              <option value="">Select Operations Manager</option>
              {assignment.options.map((person) => <option key={person.id} value={person.id}>{person.full_name} — {person.employee_code}</option>)}
            </select>
            {assignment.error ? <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{assignment.error}</p> : null}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setAssignment({ siteVisitId: '', options: [], selected: '', loading: false, error: '' })} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold">Cancel</button>
              <button type="button" disabled={assignment.loading} onClick={assign} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{assignment.loading ? 'Assigning...' : 'Assign'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
