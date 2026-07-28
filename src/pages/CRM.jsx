import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck2, Check, CheckCircle2, Eye, FileText, Mail, Pencil, Plus, Save, Send, Trash2, X } from 'lucide-react';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Toast from '../components/Toast.jsx';
import { useWorkflow } from '../context/workflow-context.js';
import { useAuth } from '../context/auth-context.js';
import { canManageLeads, canViewBdTeam, isFinanceLeadership, isManagement } from '../data/mockUsers.js';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { sendLeadMomEmail } from '../services/mailService.js';
import { getLeadManagementAssignees } from '../services/api.js';
import { canAssignLead, canCreateLead, normalizeCanonicalRole } from '../utils/authRoles.js';

function formatContactSummary(lead) {
  const contacts = normalizeContacts(lead.contacts, lead);
  const primary = getPrimaryContact({ ...lead, contacts });
  const remaining = Math.max(contacts.length - 1, 0);
  return remaining ? `${primary.name} + ${remaining} more` : primary.name;
}

const initialLeadForm = {
  company: '',
  industry: '',
  source: '',
  location: '',
  state: '',
  city: '',
  contacts: [
    { id: 'contact-1', name: '', designation: '', phone: '', email: '', isPrimary: true },
  ],
  priority: '',
  serviceScope: [],
  remarks: '',
  assigned_bd_email: '',
  assigned_bd_profile_id: '',
};

const initialMomDraft = {
  to: '',
  cc: 'bdhead@qpms.in, coo@qpms.in',
  additionalRecipients: '',
  subject: '',
  discussionSummary: '',
  serviceScopeDiscussion: '',
  serviceScope: [],
  nextFollowUpDate: '',
  scheduledVisitDate: '',
  scheduledVisitTime: '',
  siteVisitRemarks: '',
  remarks: '',
  sent: false,
};

const industryOptions = ['Manufacturing', 'Educational', 'Retail', 'Commercial', 'Electronics', 'Hospital'];
const sourceOptions = ['LinkedIn', 'Website', 'Campaign', 'Referral', 'Direct Visit', 'Email', 'Phone Enquiry'];
const stateOptions = ['Tamil Nadu', 'Kerala', 'Karnataka', 'Telangana', 'Andhra Pradesh - 1', 'Andhra Pradesh - 2'];
const priorityOptions = ['High', 'Medium', 'Low'];
const statusOptions = ['Active', 'Pending', 'Escalated', 'Completed'];
const serviceScopeOptions = ['Soft Services', 'Hard Services', 'Security Services', 'Pest Control Services', 'Landscaping Services', 'Waste Management', 'Other Services'];
const schedulingValidationMessage = 'Please provide either Site Visit Schedule Date & Time or Next Follow-up Date before sending the Minutes of Meeting.';

function normalizeContacts(contacts, lead = {}) {
  const fallback = [{ id: `contact-${lead.id || 1}`, name: lead.contact || '', designation: lead.designation || '', phone: lead.phone || '', email: lead.email || '', isPrimary: true }];
  const source = Array.isArray(contacts) && contacts.length ? contacts : fallback;
  const deduped = source.reduce((items, contact) => {
    const key = String(contact.id || contact.email || contact.phone || '').trim().toLowerCase();
    const fallbackKey = `${String(contact.name || '').trim().toLowerCase()}|${String(contact.designation || '').trim().toLowerCase()}`;
    const matchKey = key || fallbackKey;
    if (matchKey && items.some((item) => item.__matchKey === matchKey)) return items;
    return [...items, { ...contact, __matchKey: matchKey }];
  }, []);
  const primaryIndex = Math.max(deduped.findIndex((contact) => contact.isPrimary), 0);
  return deduped.map((contact, index) => ({
    id: contact.id || `contact-${Date.now()}-${index}`,
    name: contact.name || '',
    designation: contact.designation || '',
    phone: contact.phone || '',
    email: contact.email || '',
    isPrimary: index === primaryIndex,
  }));
}

function getPrimaryContact(lead) {
  const contacts = normalizeContacts(lead.contacts, lead);
  return contacts.find((contact) => contact.isPrimary) || contacts[0];
}

function normalizeServiceScope(scope) {
  let items;
  if (Array.isArray(scope)) {
    items = scope;
  } else if (scope && typeof scope === 'object') {
    items = Object.entries(scope)
      .filter(([, value]) => value === true || value?.selected)
      .map(([key]) => key);
  } else {
    items = String(scope || '').split(',');
  }
  const unique = [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
  return [
    ...serviceScopeOptions.filter((service) => unique.includes(service)),
    ...unique.filter((service) => !serviceScopeOptions.includes(service)),
  ];
}

function formatServiceScope(scope) {
  const items = normalizeServiceScope(scope);
  return items.length ? items.join('\n') : '';
}

function leadMomSubject(clientName) {
  return `Lead Minutes of Meeting - ${clientName || 'Client'} - myQPMS`;
}

function hasCompleteSiteVisitSchedule(mom) {
  return Boolean(mom?.scheduledVisitDate && mom?.scheduledVisitTime);
}

function hasSchedulingOrFollowUp(mom) {
  return hasCompleteSiteVisitSchedule(mom) || Boolean(mom?.nextFollowUpDate);
}

function ButtonContent({ loading, icon: Icon, children }) {
  return (
    <>
      {loading ? <span className="button-spinner" aria-hidden="true" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      <span>{children}</span>
    </>
  );
}

function TextField({ label, value, onChange, type = 'text', required = false, multiline = false, disabled = false, error = '', inputRef }) {
  const className =
    `mt-2 w-full rounded-xl border bg-white px-3.5 py-3 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-qpms-300 focus:shadow-[0_0_0_4px_rgba(79,130,251,0.14)] disabled:bg-slate-50 disabled:text-slate-500 dark:bg-slate-950 dark:text-slate-200 dark:disabled:bg-slate-900 ${error ? 'border-rose-300 shadow-[0_0_0_3px_rgba(225,29,72,0.10)] dark:border-rose-500/60' : 'border-slate-200 dark:border-slate-800'}`;

  return (
    <label className="block">
      <span className="text-sm font-semibold leading-5 text-slate-700 dark:text-slate-300">{label}</span>
      {multiline ? (
        <textarea
          className={`${className} min-h-24 resize-none leading-6`}
          value={value || ''}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          disabled={disabled}
          ref={inputRef}
          aria-invalid={Boolean(error)}
        />
      ) : (
        <input
          className={className}
          type={type}
          value={value || ''}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          disabled={disabled}
          ref={inputRef}
          aria-invalid={Boolean(error)}
        />
      )}
      {error ? <p className="field-error">{error}</p> : null}
    </label>
  );
}

function SelectField({ label, value, onChange, options, placeholder, required = false, disabled = false, error = '' }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold leading-5 text-slate-700 dark:text-slate-300">{label}</span>
      <select
        className={`mt-2 w-full rounded-xl border bg-white px-3.5 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-qpms-300 focus:shadow-[0_0_0_4px_rgba(79,130,251,0.14)] disabled:bg-slate-50 disabled:text-slate-500 dark:bg-slate-950 dark:text-slate-200 dark:disabled:bg-slate-900 ${error ? 'border-rose-300 shadow-[0_0_0_3px_rgba(225,29,72,0.10)] dark:border-rose-500/60' : 'border-slate-200 dark:border-slate-800'}`}
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
        aria-invalid={Boolean(error)}
      >
        <option value="">{placeholder || `Select ${label.toLowerCase()}`}</option>
        {options.map((option) => {
          const optionValue = typeof option === 'string' ? option : option.value;
          const optionLabel = typeof option === 'string' ? option : option.label;
          return (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          );
        })}
      </select>
      {error ? <p className="field-error">{error}</p> : null}
    </label>
  );
}

function FormSection({ title, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/45">
      <h3 className="text-sm font-bold uppercase tracking-normal text-slate-500 dark:text-slate-400">{title}</h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

function ServiceScopeSelector({ value, onChange, disabled = false }) {
  const selected = normalizeServiceScope(value);
  const legacyOptions = selected.filter((item) => !serviceScopeOptions.includes(item));
  const visibleOptions = [...serviceScopeOptions, ...legacyOptions];

  function toggle(item) {
    if (disabled) return;
    const next = selected.includes(item)
      ? selected.filter((current) => current !== item)
      : [...selected, item];
    onChange(next);
  }

  return (
    <div className="md:col-span-2">
      <div className="grid gap-3 sm:grid-cols-2">
        {visibleOptions.map((item) => {
          const active = selected.includes(item);
          const isLegacy = legacyOptions.includes(item);
          return (
            <label
              key={item}
              className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                active
                  ? 'border-qpms-300 bg-qpms-50 text-qpms-800 shadow-sm dark:border-qpms-500/40 dark:bg-qpms-500/15 dark:text-qpms-100'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-qpms-200 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-qpms-500/30'
              } ${disabled ? 'cursor-default opacity-75' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                checked={active}
                disabled={disabled}
                onChange={() => toggle(item)}
                className="h-5 w-5 shrink-0 accent-qpms-600"
              />
              <span>{item}{isLegacy ? ' (Legacy)' : ''}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function ContactPersonsEditor({ contacts, onChange, disabled = false, errors = {} }) {
  const normalizedContacts = normalizeContacts(contacts);

  function updateContact(contactId, patch) {
    let nextContacts = normalizedContacts.map((contact) =>
      contact.id === contactId ? { ...contact, ...patch } : contact,
    );

    if (patch.isPrimary) {
      nextContacts = nextContacts.map((contact) => ({ ...contact, isPrimary: contact.id === contactId }));
    }

    if (nextContacts.length === 1) {
      nextContacts = [{ ...nextContacts[0], isPrimary: true }];
    }

    onChange(nextContacts);
  }

  function addContact() {
    onChange([
      ...normalizedContacts,
      { id: `contact-${normalizedContacts.length + 1}`, name: '', designation: '', phone: '', email: '', isPrimary: false },
    ]);
  }

  function removeContact(contactId) {
    const remaining = normalizedContacts.filter((contact) => contact.id !== contactId);
    if (!remaining.length) return;
    onChange(remaining.length === 1 ? [{ ...remaining[0], isPrimary: true }] : remaining.some((contact) => contact.isPrimary) ? remaining : remaining.map((contact, index) => ({ ...contact, isPrimary: index === 0 })));
  }

  return (
    <div className="md:col-span-2">
      <div className="space-y-3">
        {normalizedContacts.map((contact, index) => (
          <div key={contact.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-slate-900 dark:text-white">Contact Person {index + 1}</p>
                {contact.isPrimary ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Primary</span> : null}
              </div>
              {!disabled && normalizedContacts.length > 1 ? (
                <button type="button" onClick={() => removeContact(contact.id)} className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/25 dark:hover:bg-rose-500/10">
                  Remove
                </button>
              ) : null}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label="Contact Person Name" value={contact.name} onChange={(value) => updateContact(contact.id, { name: value })} required disabled={disabled} error={errors[`${contact.id}.name`]} />
              <TextField label="Designation" value={contact.designation} onChange={(value) => updateContact(contact.id, { designation: value })} disabled={disabled} />
              <TextField label="Contact Number" type="tel" value={contact.phone} onChange={(value) => updateContact(contact.id, { phone: value })} required disabled={disabled} error={errors[`${contact.id}.phone`]} />
              <TextField label="Email ID" type="email" value={contact.email} onChange={(value) => updateContact(contact.id, { email: value })} disabled={disabled} error={errors[`${contact.id}.email`]} />
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900">
              <span className="text-sm font-semibold text-slate-600 dark:text-slate-300">Is Primary Contact?</span>
              <button
                type="button"
                disabled={disabled || contact.isPrimary}
                onClick={() => updateContact(contact.id, { isPrimary: true })}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${contact.isPrimary ? 'bg-qpms-600 text-white' : 'bg-white text-slate-600 shadow-sm hover:text-qpms-700 dark:bg-slate-950 dark:text-slate-300'}`}
              >
                {contact.isPrimary ? 'Yes' : 'Set Primary'}
              </button>
            </div>
          </div>
        ))}
      </div>
      {!disabled ? (
        <button type="button" onClick={addContact} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <Plus className="h-4 w-4" /> Add Contact Person
        </button>
      ) : null}
    </div>
  );
}

function ContactPersonsList({ contacts, lead }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {normalizeContacts(contacts, lead).map((contact) => (
        <div key={contact.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-950 dark:text-white">{contact.name || 'Unnamed contact'}</p>
              <p className="mt-1 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">{contact.designation || 'Designation pending'}</p>
            </div>
            {contact.isPrimary ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Primary</span> : null}
          </div>
          <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300">{contact.phone || 'Phone pending'}</p>
          <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-300">{contact.email || 'Email pending'}</p>
        </div>
      ))}
    </div>
  );
}

function buildLeadDemoSteps(lead, siteVisit) {
  const reviewStatus = siteVisit?.reviewStatus || {};
  const hasLead = Boolean(lead);
  const hasMom = Boolean(lead?.mom || ['Lead MOM Sent', 'MOM Sent', 'Site Visit Scheduled', 'Converted'].includes(lead?.stage));
  const hasVisit = Boolean(siteVisit || ['Converted', 'Converted to Assessment'].includes(lead?.status));
  const hasAssessment = Boolean(siteVisit?.assessmentId || siteVisit?.survey || ['Assessment Submitted', 'Pending Review', 'Ready for Proposal'].includes(siteVisit?.status));
  const commercialDone = reviewStatus['Commercial Review'] === 'Approved' || ['Ready for Proposal', 'Proposal Generated', 'Proposal Sent'].includes(siteVisit?.status);
  const financeDone = reviewStatus['Finance Review'] === 'Approved' || ['Ready for Proposal', 'Proposal Generated', 'Proposal Sent'].includes(siteVisit?.status);
  const hrDone = reviewStatus['HR Validation'] === 'Approved' || ['Ready for Proposal', 'Proposal Generated', 'Proposal Sent'].includes(siteVisit?.status);
  const proposalDone = Boolean(siteVisit?.proposal) || ['Proposal Generated', 'Proposal Sent'].includes(siteVisit?.status);
  return [
    { label: 'Lead', done: hasLead },
    { label: 'Site Visit', done: hasVisit || hasMom },
    { label: 'Assessment', done: hasAssessment },
    { label: 'Commercial', done: commercialDone },
    { label: 'Finance', done: financeDone },
    { label: 'HR', done: hrDone },
    { label: 'Proposal', done: proposalDone },
  ].map((step, index, list) => ({
    ...step,
    active: !step.done && list.slice(0, index).every((item) => item.done),
  }));
}

function LeadWorkflowStepper({ lead, siteVisit }) {
  const steps = buildLeadDemoSteps(lead, siteVisit);
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/50">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-950 dark:text-white">Demo Approval Timeline</h3>
          <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
            {'Lead -> Site Visit -> Assessment -> Commercial -> Finance -> HR -> Proposal'}
          </p>
        </div>
        <StatusBadge status={siteVisit?.status || lead?.status || 'Active'} />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className={[
              'rounded-xl border px-3 py-2.5 text-center text-xs font-bold transition',
              step.done
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200'
                : step.active
                  ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
                  : 'border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
            ].join(' ')}
          >
            <div className="mx-auto mb-1 grid h-6 w-6 place-items-center rounded-full bg-white shadow-sm dark:bg-slate-950">
              {step.done ? <Check className="h-3.5 w-3.5" /> : <span>{index + 1}</span>}
            </div>
            {step.label}
          </div>
        ))}
      </div>
    </section>
  );
}

function createLeadMomDraft(lead) {
  const primaryContact = getPrimaryContact(lead);
  const serviceScope = normalizeServiceScope(lead.serviceScope || lead.service_scope);
  const otherEmails = normalizeContacts(lead.contacts, lead)
    .filter((contact) => !contact.isPrimary && contact.email)
    .map((contact) => contact.email)
    .join(', ');

  return {
    ...initialMomDraft,
    to: primaryContact?.email || '',
    additionalRecipients: otherEmails,
    subject: leadMomSubject(lead.company),
    discussionSummary: `Initial discussion completed with ${primaryContact?.name || 'client contact'} for ${lead.company || 'the client'} regarding myQPMS facility management support.`,
    serviceScopeDiscussion: formatServiceScope(serviceScope),
    serviceScope,
    nextFollowUpDate: lead.followUp === 'Not scheduled' ? '' : lead.followUp || '',
    scheduledVisitDate: lead.scheduledVisitDate || '',
    scheduledVisitTime: lead.scheduledVisitTime || '',
    siteVisitRemarks: lead.siteVisitRemarks || '',
    remarks: lead.remarks || 'Lead MOM prepared from desktop application.',
  };
}

export default function CRM() {
  const { leads, siteVisits, addLead, updateLead, deleteLead, saveLeadMomDraft, sendLeadMom, backendStatus, workflowError } = useWorkflow();
  const { user } = useAuth();
  const canEditLeads = canManageLeads(user);
  const canCreateLeads = canCreateLead(user);
  const canAssignLeads = canAssignLead(user);
  const isBdExecutive = normalizeCanonicalRole(user?.rawRole || user?.role) === 'BD Executive';
  const canDeleteLeads = Boolean(user?.metadata?.lead_delete_enabled)
    && ['Admin', 'QPMS Admin', 'Developer'].includes(user?.role);
  const canMonitorLeads = canEditLeads || isFinanceLeadership(user);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [leadForm, setLeadForm] = useState(initialLeadForm);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [draftLead, setDraftLead] = useState(null);
  const [isEditingLead, setIsEditingLead] = useState(false);
  const [isMomOpen, setIsMomOpen] = useState(false);
  const [momDraft, setMomDraft] = useState(initialMomDraft);
  const [showMomPreview, setShowMomPreview] = useState(false);
  const [toast, setToast] = useState(null);
  const [leadPendingDelete, setLeadPendingDelete] = useState(null);
  const [leadFormErrors, setLeadFormErrors] = useState({});
  const [pendingAction, setPendingAction] = useState('');
  const [highlightedLeadId, setHighlightedLeadId] = useState(null);
  const [leadQueueFilter, setLeadQueueFilter] = useState('active');
  const [leadSearch, setLeadSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [liveAssignees, setLiveAssignees] = useState([]);
  const momSectionRef = useRef(null);
  const momFirstFieldRef = useRef(null);
  usePageTitle('Lead Management');

  const roleVisibleLeads = useMemo(() => {
    if (canViewBdTeam(user)) return leads;
    return leads.filter((lead) => lead.assigned_bd_email === user?.email || lead.created_by_user_id === user?.id);
  }, [leads, user]);

  const visibleLeads = useMemo(() => {
    const isConverted = (lead) => ['Converted', 'Converted to Assessment'].includes(lead.status) || ['Converted', 'Site Visit Scheduled'].includes(lead.stage);
    let rows = leadQueueFilter === 'converted'
      ? roleVisibleLeads.filter(isConverted)
      : leadQueueFilter === 'archived'
        ? roleVisibleLeads.filter((lead) => ['Archived', 'Lost'].includes(lead.status) || lead.stage === 'Lost')
        : roleVisibleLeads.filter((lead) => !isConverted(lead) && !['Archived', 'Lost'].includes(lead.status) && lead.stage !== 'Lost');
    const query = leadSearch.trim().toLowerCase();
    if (query) {
      rows = rows.filter((lead) => [
        lead.leadId,
        lead.company,
        lead.city,
        lead.state,
        lead.executive,
        ...normalizeContacts(lead.contacts, lead).flatMap((contact) => [contact.name, contact.phone]),
      ].join(' ').toLowerCase().includes(query));
    }
    if (stateFilter) rows = rows.filter((lead) => lead.state === stateFilter);
    if (assigneeFilter) rows = rows.filter((lead) => lead.assigned_bd_executive === assigneeFilter);
    if (priorityFilter) rows = rows.filter((lead) => lead.priority === priorityFilter);
    if (stageFilter) rows = rows.filter((lead) => lead.stage === stageFilter);
    if (statusFilter) rows = rows.filter((lead) => lead.status === statusFilter);
    return rows;
  }, [assigneeFilter, leadQueueFilter, leadSearch, priorityFilter, roleVisibleLeads, stageFilter, stateFilter, statusFilter]);

  const selectedLead = visibleLeads.find((lead) => lead.id === selectedLeadId);
  const selectedLeadVisit = siteVisits.find((visit) => String(visit.leadId) === String(selectedLeadId));

  const leadColumns = useMemo(
    () => [
      { key: 'leadId', label: 'Lead ID' },
      { key: 'company', label: 'Company Name' },
      { key: 'contact', label: 'Primary Contact', render: (row) => formatContactSummary(row) },
      { key: 'source', label: 'Lead Source' },
      { key: 'executive', label: 'Assigned BD Executive' },
      { key: 'stage', label: 'Lead Stage' },
      { key: 'status', label: 'Status', render: (row) => <StatusBadge status={row.status} /> },
      {
        key: 'actions',
        label: 'Actions',
        render: (row) => (
          <div className="flex items-center justify-center gap-2">
            <button type="button" onClick={(event) => { event.stopPropagation(); openLeadDrawer(row); }} className="focus-ring rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:text-qpms-700 dark:border-slate-800 dark:text-slate-300" aria-label={`Open ${row.company}`}>
              <Eye className="h-4 w-4" />
            </button>
            {canDeleteLeads ? (
              <button type="button" onClick={(event) => { event.stopPropagation(); setLeadPendingDelete(row); }} className="focus-ring rounded-lg border border-rose-200 p-2 text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/30 dark:hover:bg-rose-500/10" aria-label={`Delete ${row.company}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ),
      },
    ],
    [canDeleteLeads],
  );

  const stats = useMemo(
    () => [
      ['Total leads', backendStatus === 'error' && leads.length === 0 ? '--' : visibleLeads.length],
      ['New leads', backendStatus === 'error' && leads.length === 0 ? '--' : visibleLeads.filter((lead) => lead.stage === 'New Lead').length],
      ['Converted leads', backendStatus === 'error' && leads.length === 0 ? '--' : roleVisibleLeads.filter((lead) => ['Converted', 'Converted to Assessment'].includes(lead.status) || ['Converted', 'Site Visit Scheduled'].includes(lead.stage)).length],
      ['Active leads', backendStatus === 'error' && leads.length === 0 ? '--' : visibleLeads.filter((lead) => lead.status === 'Active').length],
    ],
    [backendStatus, leads.length, roleVisibleLeads, visibleLeads],
  );

  useEffect(() => {
    if (!canAssignLeads) {
      setLiveAssignees([]);
      return undefined;
    }
    let active = true;
    getLeadManagementAssignees()
      .then((result) => {
        if (active) setLiveAssignees(result.assignees || []);
      })
      .catch((error) => {
        if (active) console.warn('[myQPMS Lead Management] Unable to load BD assignees', error.message);
      });
    return () => { active = false; };
  }, [canAssignLeads]);

  useEffect(() => {
    if (!isFormOpen && !selectedLead && !leadPendingDelete) return undefined;
    function handleEscape(event) {
      if (event.key !== 'Escape') return;
      if (leadPendingDelete) {
        setLeadPendingDelete(null);
      } else if (isFormOpen) {
        closeLeadForm();
      } else if (selectedLead) {
        closeLeadDrawer();
      }
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isFormOpen, leadPendingDelete, selectedLead]);

  useEffect(() => {
    if (!isMomOpen) return;
    window.setTimeout(() => {
      momSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      momFirstFieldRef.current?.focus();
    }, 80);
  }, [isMomOpen]);

  useEffect(() => {
    if (!highlightedLeadId) return undefined;
    const row = document.querySelector(`[data-row-id="${window.CSS?.escape ? window.CSS.escape(String(highlightedLeadId)) : highlightedLeadId}"]`);
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row?.focus();
    const timer = window.setTimeout(() => setHighlightedLeadId(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightedLeadId, visibleLeads]);

  function showToast(message, type = 'success') {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3000);
  }

  function updateLeadForm(key, value) {
    setLeadForm((current) => ({ ...current, [key]: value }));
    setLeadFormErrors((current) => {
      if (key !== 'contacts') return { ...current, [key]: '' };
      return Object.fromEntries(Object.entries(current).filter(([field]) => !field.includes('.')));
    });
  }

  function updateDraftLead(key, value) {
    setDraftLead((current) => ({ ...current, [key]: value }));
  }

  function cancelLeadChanges() {
    setDraftLead({ ...selectedLead });
    setIsEditingLead(false);
  }

  function updateMomDraft(key, value) {
    setMomDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === 'serviceScope') next.serviceScopeDiscussion = formatServiceScope(value);
      return next;
    });
  }

  function closeLeadForm() {
    setIsFormOpen(false);
    setLeadForm(initialLeadForm);
    setLeadFormErrors({});
  }

  function validateLeadForm() {
    const errors = {};
    ['company', 'industry', 'location', 'state', 'city', 'source', 'priority'].forEach((key) => {
      if (!String(leadForm[key] || '').trim()) errors[key] = 'Required';
    });

    normalizeContacts(leadForm.contacts).forEach((contact) => {
      if (!contact.name.trim()) errors[`${contact.id}.name`] = 'Contact name is required';
      if (!contact.phone.trim()) errors[`${contact.id}.phone`] = 'Contact number is required';
      if (contact.phone && (!/^[+()\-\s0-9]+$/.test(contact.phone) || contact.phone.replace(/\D/g, '').length < 7 || contact.phone.replace(/\D/g, '').length > 15)) errors[`${contact.id}.phone`] = 'Enter a valid phone number';
      if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) errors[`${contact.id}.email`] = 'Enter a valid email';
    });

    return errors;
  }

  function openLeadDrawer(lead) {
    setSelectedLeadId(lead.id);
    setDraftLead({ ...lead });
    setMomDraft(lead.mom || createLeadMomDraft(lead));
    setIsEditingLead(false);
    setIsMomOpen(false);
    setShowMomPreview(false);
  }

  function closeLeadDrawer() {
    setSelectedLeadId(null);
    setDraftLead(null);
    setIsEditingLead(false);
    setIsMomOpen(false);
    setShowMomPreview(false);
  }

  async function handleCreateLead(event) {
    event.preventDefault();
    const contacts = normalizeContacts(leadForm.contacts);
    const validationErrors = validateLeadForm();
    if (Object.keys(validationErrors).length) {
      setLeadFormErrors(validationErrors);
      showToast('Please fix the highlighted lead fields', 'warning');
      return;
    }
    const submissionKey = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `web-${Date.now()}`;
    try {
      setPendingAction('createLead');
      const baseSubmission = { ...leadForm, contacts, serviceScope: normalizeServiceScope(leadForm.serviceScope), idempotencyKey: submissionKey };
      let createdLead;
      try {
        createdLead = await addLead(baseSubmission, user);
      } catch (error) {
        const detail = error?.response?.data;
        if (detail?.code !== 'possible_duplicate_lead') throw error;
        const matches = (detail.duplicates || []).map((lead) => lead.restricted
          ? lead.message
          : `${lead.lead_code || lead.id}: ${lead.client_name} - ${lead.site_location}`).join('\n');
        const confirmed = window.confirm(`Possible duplicate lead found:\n\n${matches}\n\nCreate this as a separate lead?`);
        if (!confirmed) return;
        const reason = window.prompt('Reason this is a separate lead/site:')?.trim();
        if (!reason) throw new Error('Duplicate override reason is required.');
        createdLead = await addLead({ ...baseSubmission, duplicateOverride: true, duplicateOverrideReason: reason }, user);
      }
      showToast('Lead created successfully', 'success');
      closeLeadForm();
      setHighlightedLeadId(createdLead.id);
    } catch (error) {
      showToast(`Lead create failed: ${error.message}`, 'error');
    } finally {
      setPendingAction('');
    }
  }

  async function saveLeadChanges() {
    try {
      setPendingAction('updateLead');
      await updateLead(selectedLeadId, draftLead);
      setIsEditingLead(false);
      showToast('Lead updated successfully', 'success');
    } catch (error) {
      showToast(`Lead update failed: ${error.message}`, 'error');
    } finally {
      setPendingAction('');
    }
  }

  function openMomEditor() {
    const sourceLead = draftLead || selectedLead;
    const nextDraft = selectedLead?.mom
      ? {
          ...selectedLead.mom,
          subject: selectedLead.mom.subject?.startsWith('Lead MOM -') ? leadMomSubject(sourceLead?.company) : selectedLead.mom.subject || leadMomSubject(sourceLead?.company),
          serviceScope: normalizeServiceScope(selectedLead.mom.serviceScope || sourceLead?.serviceScope || sourceLead?.service_scope),
          serviceScopeDiscussion: selectedLead.mom.serviceScopeDiscussion || formatServiceScope(sourceLead?.serviceScope || sourceLead?.service_scope),
        }
      : createLeadMomDraft(sourceLead);
    setMomDraft(nextDraft);
    setIsMomOpen(true);
    setShowMomPreview(false);
  }

  async function handleSaveMomDraft() {
    setPendingAction('saveMomDraft');
    try {
      showToast('Saving...', 'info');
      await Promise.resolve(saveLeadMomDraft(selectedLeadId, momDraft));
      showToast('Saved successfully', 'success');
    } catch (error) {
      showToast(`Failed to save: ${error.message}`, 'error');
    } finally {
      setPendingAction('');
    }
  }

  async function handleSendMom() {
    if (!hasSchedulingOrFollowUp(momDraft)) {
      showToast(schedulingValidationMessage, 'warning');
      return;
    }
    if (hasCompleteSiteVisitSchedule(momDraft) && siteVisits.some((visit) => String(visit.leadId) === String(selectedLeadId))) {
      showToast('Assessment already created for this lead.', 'warning');
      return;
    }

    try {
      setPendingAction('sendMom');
      const result = await sendLeadMomEmail(momDraft, selectedLead);
      sendLeadMom(selectedLeadId, { ...momDraft, calendarInviteSent: Boolean(result?.calendarInviteSent) });
      setIsMomOpen(false);
      setShowMomPreview(false);
      showToast(
        result?.simulated
          ? 'MOM recorded. Email simulation used because SMTP is unavailable.'
          : hasCompleteSiteVisitSchedule(momDraft) ? 'Lead moved to Site Visit & Estimation' : 'Lead Minutes of Meeting sent successfully',
        result?.simulated ? 'warning' : 'success',
      );
    } catch (error) {
      showToast(`Email failed: ${error.response?.data?.message || error.message}`, 'error');
    } finally {
      setPendingAction('');
    }
  }

  async function handleConfirmDeleteLead() {
    if (!leadPendingDelete) return;
    try {
      setPendingAction('deleteLead');
      await deleteLead(leadPendingDelete.id, user);
      if (selectedLeadId === leadPendingDelete.id) closeLeadDrawer();
      setLeadPendingDelete(null);
      showToast('Lead deleted successfully', 'success');
    } catch (error) {
      showToast(`Lead delete failed: ${error.message}`, 'error');
    } finally {
      setPendingAction('');
    }
  }

  if (!canMonitorLeads) {
    return (
      <div className="space-y-7">
        <PageHeader title="Lead Management" />
        <section className="enterprise-card p-8 text-center">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Use your approval dashboard to review records pending with your team.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <PageHeader
        title="Lead Management"
        actions={canCreateLeads ? (
          <button
            type="button"
            onClick={() => setIsFormOpen(true)}
            className="focus-ring inline-flex items-center gap-2 rounded-xl bg-qpms-600 px-4 py-2.5 text-sm font-semibold leading-5 text-white shadow-lg shadow-qpms-600/20 hover:bg-qpms-700"
          >
            New Lead <Plus className="h-4 w-4" />
          </button>
        ) : null}
      />

      <Toast message={toast?.message || workflowError} type={toast?.type || (workflowError ? 'error' : 'success')} />

      <section className="enterprise-card-compact flex flex-wrap items-center justify-between gap-3 p-3">
        <div>
          <p className="text-sm font-bold text-slate-950 dark:text-white">Lead Queue</p>
        </div>
        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
          {[
            ['active', 'Active Leads'],
            ['converted', 'Converted Leads'],
            ['archived', 'Archived Leads'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setLeadQueueFilter(id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${leadQueueFilter === id ? 'bg-white text-qpms-700 shadow-sm dark:bg-slate-800 dark:text-qpms-200' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="enterprise-card-compact grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
        <input aria-label="Search leads" value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Search client, city, contact..." className="rounded-xl border border-slate-200 px-3 py-2 text-sm xl:col-span-2 dark:border-slate-700 dark:bg-slate-950" />
        <select aria-label="Filter by state" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
          <option value="">All states</option>
          {[...new Set(roleVisibleLeads.map((lead) => lead.state).filter(Boolean))].sort().map((state) => <option key={state}>{state}</option>)}
        </select>
        <select aria-label="Filter by assigned BD" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
          <option value="">All assignees</option>
          {liveAssignees.map((assignee) => <option key={assignee.id} value={assignee.full_name}>{assignee.full_name} — {assignee.employee_code}</option>)}
        </select>
        <select aria-label="Filter by priority" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="">All priorities</option>{priorityOptions.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="Filter by stage" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="">All stages</option>{[...new Set(roleVisibleLeads.map((lead) => lead.stage).filter(Boolean))].sort().map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="">All statuses</option>{[...new Set(roleVisibleLeads.map((lead) => lead.status).filter(Boolean))].sort().map((value) => <option key={value}>{value}</option>)}</select>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="enterprise-card-compact p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide leading-5 text-slate-500 dark:text-slate-400">{label}</p>
            <p className="mt-2 text-3xl font-bold leading-none text-slate-950 dark:text-white">{value}</p>
          </div>
        ))}
      </section>

      <DataTable
        columns={leadColumns}
        rows={visibleLeads}
        onRowClick={openLeadDrawer}
        highlightedRowId={highlightedLeadId}
        emptyMessage={leadQueueFilter === 'active' ? 'No active leads. Create a lead or switch to Converted Leads.' : 'No records in this lead view.'}
      />

      {isFormOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm" onClick={closeLeadForm}>
          <div className="modal-surface max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-white/70 bg-white p-5 shadow-[0_30px_100px_rgba(15,23,42,0.28)] dark:border-slate-800 dark:bg-slate-900 sm:p-6" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-5 dark:border-slate-800">
              <div>
                <h2 className="text-2xl font-semibold leading-tight text-slate-950 dark:text-white">Add New Lead</h2>
              </div>
              <button
                type="button"
                onClick={closeLeadForm}
                className="focus-ring rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:text-slate-950 dark:border-slate-800 dark:text-slate-300 dark:hover:text-white"
                aria-label="Close add lead form"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form className="mt-6 space-y-5" onSubmit={handleCreateLead} noValidate>
              <FormSection title="Client Details">
                <TextField label="Client / Company Name" value={leadForm.company} onChange={(value) => updateLeadForm('company', value)} required error={leadFormErrors.company} />
                <SelectField label="Industry" value={leadForm.industry} onChange={(value) => updateLeadForm('industry', value)} options={industryOptions} placeholder="Select Industry" required error={leadFormErrors.industry} />
                <TextField label="Site Location" value={leadForm.location} onChange={(value) => updateLeadForm('location', value)} required error={leadFormErrors.location} />
                <SelectField label="State" value={leadForm.state} onChange={(value) => updateLeadForm('state', value)} options={stateOptions} required error={leadFormErrors.state} />
                <TextField label="City" value={leadForm.city} onChange={(value) => updateLeadForm('city', value)} required error={leadFormErrors.city} />
              </FormSection>

              <FormSection title="Contact Details">
                <ContactPersonsEditor contacts={leadForm.contacts} onChange={(contacts) => updateLeadForm('contacts', contacts)} errors={leadFormErrors} />
              </FormSection>

              <FormSection title="Lead Information">
                <SelectField label="Lead Source" value={leadForm.source} onChange={(value) => updateLeadForm('source', value)} options={sourceOptions} required error={leadFormErrors.source} />
                <SelectField label="Lead Priority" value={leadForm.priority} onChange={(value) => updateLeadForm('priority', value)} options={priorityOptions} required error={leadFormErrors.priority} />
                {isBdExecutive ? (
                  <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">
                    This lead will be assigned to you.
                  </p>
                ) : null}
                {canAssignLeads ? (
                  <SelectField
                    label="Assign to BD Executive"
                    value={leadForm.assigned_bd_profile_id}
                    onChange={(value) => updateLeadForm('assigned_bd_profile_id', value)}
                    options={liveAssignees.map((assignee) => ({
                      value: assignee.id,
                      label: `${assignee.full_name} — ${assignee.employee_code}`,
                    }))}
                    placeholder="Unassigned"
                  />
                ) : null}
                <div className="md:col-span-2">
                  <TextField label="Remarks" value={leadForm.remarks} onChange={(value) => updateLeadForm('remarks', value)} multiline />
                </div>
              </FormSection>

              <FormSection title="Scope of Services">
                <ServiceScopeSelector value={leadForm.serviceScope} onChange={(value) => updateLeadForm('serviceScope', value)} />
              </FormSection>

              <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 dark:border-slate-800 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeLeadForm} className="focus-ring rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white">
                  Cancel
                </button>
                <button type="submit" disabled={pendingAction === 'createLead'} className="focus-ring inline-flex items-center gap-2 rounded-xl bg-qpms-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-qpms-600/20 transition hover:bg-qpms-700">
                  <ButtonContent loading={pendingAction === 'createLead'}>Create Lead</ButtonContent>
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {selectedLead && draftLead ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-sm" onClick={closeLeadDrawer}>
          <aside className="modal-surface h-full w-full max-w-3xl overflow-y-auto border-l border-slate-200 bg-white shadow-[0_30px_100px_rgba(15,23,42,0.28)] dark:border-slate-800 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 p-5 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-qpms-600 dark:text-qpms-300">Lead Detail</p>
                  <h2 className="mt-1 text-2xl font-semibold leading-tight text-slate-950 dark:text-white">{selectedLead.company}</h2>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Lead collection and Lead MOM workspace.</p>
                </div>
                <button
                  type="button"
                  onClick={closeLeadDrawer}
                  className="focus-ring rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:text-slate-950 dark:border-slate-800 dark:text-slate-300 dark:hover:text-white"
                  aria-label="Close lead detail"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                {canEditLeads ? (
                  <button type="button" onClick={() => setIsEditingLead(true)} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white">
                    <Pencil className="h-4 w-4" /> Edit Lead
                  </button>
                ) : null}
                {isEditingLead ? (
                  <>
                    <button type="button" onClick={cancelLeadChanges} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white">
                      <X className="h-4 w-4" /> Cancel
                    </button>
                    <button type="button" onClick={saveLeadChanges} className="focus-ring inline-flex items-center gap-2 rounded-xl bg-qpms-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-qpms-600/20 transition hover:bg-qpms-700">
                      <Save className="h-4 w-4" /> Save Changes
                    </button>
                  </>
                ) : null}
                {canEditLeads && !isManagement(user) ? (
                  <button type="button" onClick={openMomEditor} className="focus-ring inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-950/20 transition hover:bg-slate-800 dark:bg-white dark:text-slate-950">
                    <FileText className="h-4 w-4" /> Create Lead MOM
                  </button>
                ) : null}
              </div>
            </div>

            <div className="space-y-5 p-5">
              <LeadWorkflowStepper lead={selectedLead} siteVisit={selectedLeadVisit} />

              <FormSection title="Client Details">
                <TextField label="Client / Company Name" value={draftLead.company} onChange={(value) => updateDraftLead('company', value)} disabled={!isEditingLead} />
                <SelectField
                  label="Industry"
                  value={draftLead.industry}
                  onChange={(value) => updateDraftLead('industry', value)}
                  options={!draftLead.industry || industryOptions.includes(draftLead.industry)
                    ? industryOptions
                    : [...industryOptions, { value: draftLead.industry, label: `${draftLead.industry} (Legacy)` }]}
                  placeholder="Select Industry"
                  disabled={!isEditingLead}
                />
                <TextField label="Site Location" value={draftLead.location} onChange={(value) => updateDraftLead('location', value)} disabled={!isEditingLead} />
                <SelectField label="State" value={draftLead.state} onChange={(value) => updateDraftLead('state', value)} options={stateOptions} disabled={!isEditingLead} />
                <TextField label="City" value={draftLead.city} onChange={(value) => updateDraftLead('city', value)} disabled={!isEditingLead} />
              </FormSection>

              <FormSection title="Contact Details">
                {isEditingLead ? (
                  <ContactPersonsEditor contacts={draftLead.contacts} onChange={(contacts) => updateDraftLead('contacts', contacts)} />
                ) : (
                  <div className="md:col-span-2">
                    <ContactPersonsList contacts={draftLead.contacts} lead={draftLead} />
                  </div>
                )}
              </FormSection>

              <FormSection title="Lead Information">
                <SelectField label="Lead Source" value={draftLead.source} onChange={(value) => updateDraftLead('source', value)} options={sourceOptions} disabled={!isEditingLead} />
                <SelectField label="Lead Priority" value={draftLead.priority} onChange={(value) => updateDraftLead('priority', value)} options={priorityOptions} disabled={!isEditingLead} />
                {canAssignLeads ? (
                  <SelectField
                    label="Assigned BD Executive"
                    value={draftLead.assigned_bd_profile_id || ''}
                    onChange={(value) => setDraftLead((current) => ({
                      ...current,
                      assigned_bd_profile_id: value,
                      ...(value ? {} : { assigned_bd_email: '', assigned_bd_executive: '', executive: 'Unassigned' }),
                    }))}
                    options={liveAssignees.map((assignee) => ({
                      value: assignee.id,
                      label: `${assignee.full_name} — ${assignee.employee_code}`,
                    }))}
                    placeholder={draftLead.assigned_bd_executive || 'Unassigned'}
                    disabled={!isEditingLead}
                  />
                ) : (
                  <TextField label="Assigned BD Executive" value={draftLead.assigned_bd_executive || 'Unassigned'} disabled />
                )}
                <SelectField label="Status" value={draftLead.status} onChange={(value) => updateDraftLead('status', value)} options={statusOptions} disabled={!isEditingLead} />
                <TextField label="Created By" value={draftLead.created_by_name || '--'} onChange={() => {}} disabled />
                <div className="md:col-span-2">
                  <TextField label="Remarks" value={draftLead.remarks} onChange={(value) => updateDraftLead('remarks', value)} multiline disabled={!isEditingLead} />
                </div>
              </FormSection>

              <FormSection title="Scope of Services">
                <ServiceScopeSelector value={draftLead.serviceScope || draftLead.service_scope} onChange={(value) => updateDraftLead('serviceScope', value)} disabled={!isEditingLead} />
              </FormSection>

              <section className="enterprise-card p-5">
                <h3 className="text-[17px] font-semibold leading-6 text-slate-950 dark:text-white">Activity Timeline</h3>
                <div className="mt-4 space-y-3">
                  {(selectedLead.activity || []).map((item, index) => (
                    <div key={`${item}-${index}`} className="flex gap-3">
                      <div className="mt-2 h-2.5 w-2.5 rounded-full bg-qpms-500" />
                      <p className="text-sm font-medium leading-6 text-slate-600 dark:text-slate-300">{item}</p>
                    </div>
                  ))}
                </div>
              </section>

              {isMomOpen ? (
                <section ref={momSectionRef} className="enterprise-card active-workspace p-5">
                  <div className="flex items-center gap-2">
                    <Mail className="h-5 w-5 text-qpms-600" />
                    <h3 className="text-[17px] font-semibold leading-6 text-slate-950 dark:text-white">Lead MOM Email Editor</h3>
                  </div>
                  <div className="mt-5 grid gap-4">
                    <TextField label="To" value={momDraft.to} onChange={(value) => updateMomDraft('to', value)} inputRef={momFirstFieldRef} />
                    <TextField label="Additional Contact Recipients" value={momDraft.additionalRecipients} onChange={(value) => updateMomDraft('additionalRecipients', value)} />
                    <TextField label="CC" value={momDraft.cc} onChange={(value) => updateMomDraft('cc', value)} />
                    <TextField label="Subject" value={momDraft.subject} onChange={(value) => updateMomDraft('subject', value)} />
                    <TextField label="Discussion Summary" value={momDraft.discussionSummary} onChange={(value) => updateMomDraft('discussionSummary', value)} multiline />
                    <div>
                      <span className="text-sm font-semibold leading-5 text-slate-700 dark:text-slate-300">Service Scope</span>
                      <div className="mt-2">
                        <ServiceScopeSelector value={momDraft.serviceScope} onChange={(value) => updateMomDraft('serviceScope', value)} />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-qpms-100 bg-qpms-50/70 p-4 dark:border-qpms-500/20 dark:bg-qpms-500/10">
                      <div className="flex items-start gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-qpms-600 shadow-sm dark:bg-slate-950">
                          <CalendarCheck2 className="h-5 w-5" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-slate-950 dark:text-white">Scheduling / Follow-up</h4>
                          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                            Provide either a scheduled site visit date & time or a next follow-up date before sending.
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <TextField label="Scheduled Site Visit Date" type="date" value={momDraft.scheduledVisitDate} onChange={(value) => updateMomDraft('scheduledVisitDate', value)} />
                        <TextField label="Scheduled Site Visit Time" type="time" value={momDraft.scheduledVisitTime} onChange={(value) => updateMomDraft('scheduledVisitTime', value)} />
                        <TextField label="Next Follow-up Date" type="date" value={momDraft.nextFollowUpDate} onChange={(value) => updateMomDraft('nextFollowUpDate', value)} />
                        <div className="md:col-span-2">
                          <TextField label="Site Visit Remarks" value={momDraft.siteVisitRemarks} onChange={(value) => updateMomDraft('siteVisitRemarks', value)} multiline />
                        </div>
                      </div>
                      {hasCompleteSiteVisitSchedule(momDraft) ? (
                        <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Calendar invite will be attached.
                        </span>
                      ) : momDraft.nextFollowUpDate ? (
                        <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Follow-up date will be included in mail.
                        </span>
                      ) : null}
                    </div>
                    <TextField label="Remarks" value={momDraft.remarks} onChange={(value) => updateMomDraft('remarks', value)} multiline />
                  </div>

                  {showMomPreview ? (
                    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-slate-800 dark:bg-slate-950/55 dark:text-slate-300">
                      <p className="font-bold text-slate-950 dark:text-white">{momDraft.subject}</p>
                      <p className="mt-3 whitespace-pre-line">{momDraft.discussionSummary}</p>
                      <p className="mt-3 font-bold text-slate-950 dark:text-white">Service Scope:</p>
                      <p className="whitespace-pre-line">{formatServiceScope(momDraft.serviceScope) || '-'}</p>
                      {hasCompleteSiteVisitSchedule(momDraft) ? (
                        <p className="mt-3">
                          Scheduled Site Visit Date & Time: {momDraft.scheduledVisitDate} at {momDraft.scheduledVisitTime}
                        </p>
                      ) : (
                        <p className="mt-3">Next Follow-up Date: {momDraft.nextFollowUpDate || '-'}</p>
                      )}
                      <p className="mt-3 whitespace-pre-line">{momDraft.siteVisitRemarks || 'No site visit remarks added.'}</p>
                      <p className="mt-3 whitespace-pre-line">{momDraft.remarks}</p>
                    </div>
                  ) : null}

                  <div className="sticky bottom-0 mt-5 flex flex-wrap gap-3 border-t border-slate-100 bg-white/95 pt-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
                    <button type="button" onClick={handleSaveMomDraft} disabled={pendingAction === 'saveMomDraft'} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white">
                      <ButtonContent loading={pendingAction === 'saveMomDraft'} icon={Save}>Save Draft</ButtonContent>
                    </button>
                    <button type="button" onClick={() => setShowMomPreview((value) => !value)} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:text-white">
                      <FileText className="h-4 w-4" /> Preview Email
                    </button>
                    <button
                      type="button"
                      onClick={handleSendMom}
                      disabled={pendingAction === 'sendMom'}
                      className="focus-ring inline-flex items-center gap-2 rounded-xl bg-qpms-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-qpms-600/20 hover:bg-qpms-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ButtonContent loading={pendingAction === 'sendMom'} icon={Send}>Send MOM</ButtonContent>
                    </button>
                  </div>
                </section>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {leadPendingDelete ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/60 px-4 backdrop-blur-sm" onClick={() => setLeadPendingDelete(null)}>
          <div className="modal-surface w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.28)] dark:border-slate-800 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-500/15">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Delete Lead?</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  Are you sure you want to delete this lead? This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setLeadPendingDelete(null)} className="focus-ring rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                Cancel
              </button>
              <button type="button" onClick={handleConfirmDeleteLead} disabled={pendingAction === 'deleteLead'} className="focus-ring inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-600/20 transition hover:bg-rose-700">
                <ButtonContent loading={pendingAction === 'deleteLead'}>Delete Lead</ButtonContent>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
