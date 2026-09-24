import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import LeadForm from '../../components/preSales/LeadForm.jsx';
import {
  initialLeadForm,
  leadFormToApiPayload,
  leadToFormValues,
  validateLeadForm,
} from '../../components/preSales/leadFormModel.js';
import { ErrorState, LoadingState, PreSalesBreadcrumbs } from '../../components/preSales/PreSalesUi.jsx';
import { useAuth } from '../../context/auth-context.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import {
  assignPreSalesOwner,
  createPreSalesLead,
  getPreSalesLead,
  getPreSalesOwners,
  updatePreSalesLead,
} from '../../services/preSalesApi.js';
import { canAssignLead, canCreateLead, canEditPreSalesLead } from '../../utils/authRoles.js';

function submissionKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `web-${Date.now()}`;
}

export default function PreSalesLeadFormPage({ mode }) {
  const editing = mode === 'edit';
  const { leadId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canAssign = canAssignLead(user);
  const permitted = editing ? canEditPreSalesLead(user) : canCreateLead(user);
  const [form, setForm] = useState(initialLeadForm);
  const [errors, setErrors] = useState({});
  const [owners, setOwners] = useState([]);
  const [state, setState] = useState({ loading: editing, error: '', saving: false });
  const originalOwner = useRef('');
  const idempotencyKey = useRef(submissionKey());
  usePageTitle(editing ? 'Edit Lead' : 'Add Lead');

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: editing, error: '' }));
    try {
      const [leadResponse, ownerResponse] = await Promise.all([
        editing ? getPreSalesLead(leadId) : Promise.resolve(null),
        canAssign ? getPreSalesOwners() : Promise.resolve({ items: [] }),
      ]);
      if (leadResponse?.lead) {
        const next = leadToFormValues(leadResponse.lead);
        originalOwner.current = next.pre_sales_owner_profile_id;
        setForm(next);
      }
      setOwners(ownerResponse.items || []);
      setState({ loading: false, error: '', saving: false });
    } catch (error) {
      setState({ loading: false, error: error.message, saving: false });
    }
  }, [canAssign, editing, leadId]);

  useEffect(() => { void load(); }, [load]);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (key !== 'contacts') return { ...current, [key]: '' };
      return Object.fromEntries(Object.entries(current).filter(([field]) => !field.includes('.')));
    });
  };

  async function create(payload) {
    try {
      return await createPreSalesLead(payload, idempotencyKey.current);
    } catch (error) {
      if (error.code !== 'possible_duplicate_lead') throw error;
      const matches = (error.details?.duplicates || []).map((lead) => lead.restricted
        ? lead.message
        : `${lead.lead_code || lead.id}: ${lead.client_name} - ${lead.site_location}`).join('\n');
      if (!window.confirm(`Possible duplicate lead found:\n\n${matches}\n\nCreate this as a separate lead?`)) return null;
      const reason = window.prompt('Reason this is a separate lead/site:')?.trim();
      if (!reason) throw new Error('Duplicate override reason is required.');
      return createPreSalesLead({ ...payload, duplicateOverride: true, duplicateOverrideReason: reason }, idempotencyKey.current);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const validationErrors = validateLeadForm(form);
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      setState((current) => ({ ...current, error: 'Please fix the highlighted lead fields.' }));
      return;
    }
    setState((current) => ({ ...current, saving: true, error: '' }));
    try {
      const payload = leadFormToApiPayload(form);
      const response = editing ? await updatePreSalesLead(leadId, payload) : await create(payload);
      if (!response) {
        setState((current) => ({ ...current, saving: false }));
        return;
      }
      const savedLeadId = editing ? leadId : response.leadId || response.lead?.id;
      if (canAssign && form.pre_sales_owner_profile_id && form.pre_sales_owner_profile_id !== originalOwner.current) {
        await assignPreSalesOwner(savedLeadId, form.pre_sales_owner_profile_id);
      }
      navigate(savedLeadId ? `/pre-sales/leads/${savedLeadId}` : '/pre-sales/leads', { replace: true });
    } catch (error) {
      setState((current) => ({ ...current, saving: false, error: error.message }));
    }
  }

  if (!permitted) return <ErrorState message={`You do not have permission to ${editing ? 'edit' : 'create'} Pre-Sales leads.`} />;
  if (state.loading) return <LoadingState label={editing ? 'Loading lead...' : 'Loading lead form...'} />;
  if (editing && state.error && !form.company) return <ErrorState message={state.error} onRetry={load} />;

  const title = editing ? 'Edit Lead' : 'Add Lead';
  return <div className="space-y-6"><PreSalesBreadcrumbs items={[{ label: 'Pre-Sales', to: '/pre-sales' }, { label: 'Leads', to: '/pre-sales/leads' }, { label: title }]} /><header><h1 className="text-3xl font-bold text-slate-950">{title}</h1><p className="mt-2 text-sm text-slate-500">{editing ? 'Update lead and contact information.' : 'Create a new Pre-Sales opportunity.'}</p></header>{state.error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{state.error}</p> : null}<section className="enterprise-card p-5 sm:p-6"><LeadForm values={form} errors={errors} onChange={update} onSubmit={submit} onCancel={() => navigate(editing ? `/pre-sales/leads/${leadId}` : '/pre-sales/leads')} submitting={state.saving} submitLabel={editing ? 'Save Changes' : 'Create Lead'} assignmentLabel="Pre-Sales Owner" assignmentKey="pre_sales_owner_profile_id" assignmentOptions={owners.map((owner) => ({ value: owner.id, label: `${owner.full_name} — ${owner.employee_code}` }))} assignmentEnabled={canAssign} /></section></div>;
}
