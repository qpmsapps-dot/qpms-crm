import { Plus } from 'lucide-react';

import {
  industryOptions,
  normalizeContacts,
  normalizeServiceScope,
  priorityOptions,
  serviceScopeOptions,
  sourceOptions,
  stateOptions,
} from './leadFormModel.js';

export function ButtonContent({ loading, icon: Icon, children }) {
  return <>{loading ? <span className="button-spinner" aria-hidden="true" /> : Icon ? <Icon className="h-4 w-4" /> : null}<span>{children}</span></>;
}

export function TextField({ label, value, onChange, type = 'text', required = false, multiline = false, disabled = false, error = '', inputRef }) {
  const className = `mt-2 w-full rounded-xl border bg-white px-3.5 py-3 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-qpms-300 focus:shadow-[0_0_0_4px_rgba(79,130,251,0.14)] disabled:bg-slate-50 disabled:text-slate-500 dark:bg-slate-950 dark:text-slate-200 dark:disabled:bg-slate-900 ${error ? 'border-rose-300 shadow-[0_0_0_3px_rgba(225,29,72,0.10)] dark:border-rose-500/60' : 'border-slate-200 dark:border-slate-800'}`;
  return <label className="block"><span className="text-sm font-semibold leading-5 text-slate-700 dark:text-slate-300">{label}</span>{multiline ? <textarea className={`${className} min-h-24 resize-none leading-6`} value={value || ''} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled} ref={inputRef} aria-invalid={Boolean(error)} /> : <input className={className} type={type} value={value || ''} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled} ref={inputRef} aria-invalid={Boolean(error)} />}{error ? <p className="field-error">{error}</p> : null}</label>;
}

export function SelectField({ label, value, onChange, options, placeholder, required = false, disabled = false, error = '' }) {
  return <label className="block"><span className="text-sm font-semibold leading-5 text-slate-700 dark:text-slate-300">{label}</span><select className={`mt-2 w-full rounded-xl border bg-white px-3.5 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-qpms-300 focus:shadow-[0_0_0_4px_rgba(79,130,251,0.14)] disabled:bg-slate-50 disabled:text-slate-500 dark:bg-slate-950 dark:text-slate-200 dark:disabled:bg-slate-900 ${error ? 'border-rose-300 shadow-[0_0_0_3px_rgba(225,29,72,0.10)] dark:border-rose-500/60' : 'border-slate-200 dark:border-slate-800'}`} value={value || ''} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled} aria-invalid={Boolean(error)}><option value="">{placeholder || `Select ${label.toLowerCase()}`}</option>{options.map((option) => { const optionValue = typeof option === 'string' ? option : option.value; const optionLabel = typeof option === 'string' ? option : option.label; return <option key={optionValue} value={optionValue}>{optionLabel}</option>; })}</select>{error ? <p className="field-error">{error}</p> : null}</label>;
}

export function FormSection({ title, children }) {
  return <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/45"><h3 className="text-sm font-bold uppercase tracking-normal text-slate-500 dark:text-slate-400">{title}</h3><div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div></section>;
}

export function ServiceScopeSelector({ value, onChange, disabled = false }) {
  const selected = normalizeServiceScope(value);
  const legacyOptions = selected.filter((item) => !serviceScopeOptions.includes(item));
  const visibleOptions = [...serviceScopeOptions, ...legacyOptions];
  const toggle = (item) => { if (!disabled) onChange(selected.includes(item) ? selected.filter((current) => current !== item) : [...selected, item]); };
  return <div className="md:col-span-2"><div className="grid gap-3 sm:grid-cols-2">{visibleOptions.map((item) => { const active = selected.includes(item); return <label key={item} className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${active ? 'border-qpms-300 bg-qpms-50 text-qpms-800 shadow-sm dark:border-qpms-500/40 dark:bg-qpms-500/15 dark:text-qpms-100' : 'border-slate-200 bg-white text-slate-600 hover:border-qpms-200 hover:text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-qpms-500/30'} ${disabled ? 'cursor-default opacity-75' : 'cursor-pointer'}`}><input type="checkbox" checked={active} disabled={disabled} onChange={() => toggle(item)} className="h-5 w-5 shrink-0 accent-qpms-600" /><span>{item}{legacyOptions.includes(item) ? ' (Legacy)' : ''}</span></label>; })}</div></div>;
}

export function LeadContactEditor({ contacts, onChange, disabled = false, errors = {} }) {
  const normalized = normalizeContacts(contacts);
  const updateContact = (contactId, patch) => {
    let next = normalized.map((contact) => contact.id === contactId ? { ...contact, ...patch } : contact);
    if (patch.isPrimary) next = next.map((contact) => ({ ...contact, isPrimary: contact.id === contactId }));
    if (next.length === 1) next = [{ ...next[0], isPrimary: true }];
    onChange(next);
  };
  const addContact = () => onChange([...normalized, { id: `contact-${normalized.length + 1}`, name: '', designation: '', phone: '', email: '', isPrimary: false }]);
  const removeContact = (contactId) => {
    const remaining = normalized.filter((contact) => contact.id !== contactId);
    if (!remaining.length) return;
    onChange(remaining.length === 1 ? [{ ...remaining[0], isPrimary: true }] : remaining.some((contact) => contact.isPrimary) ? remaining : remaining.map((contact, index) => ({ ...contact, isPrimary: index === 0 })));
  };
  return <div className="md:col-span-2"><div className="space-y-3">{normalized.map((contact, index) => <div key={contact.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/70"><div className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><p className="text-sm font-bold text-slate-900 dark:text-white">Contact Person {index + 1}</p>{contact.isPrimary ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Primary</span> : null}</div>{!disabled && normalized.length > 1 ? <button type="button" onClick={() => removeContact(contact.id)} className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 transition hover:bg-rose-50">Remove</button> : null}</div><div className="grid gap-4 md:grid-cols-2"><TextField label="Contact Person Name" value={contact.name} onChange={(value) => updateContact(contact.id, { name: value })} required disabled={disabled} error={errors[`${contact.id}.name`]} /><TextField label="Designation" value={contact.designation} onChange={(value) => updateContact(contact.id, { designation: value })} disabled={disabled} /><TextField label="Contact Number" type="tel" value={contact.phone} onChange={(value) => updateContact(contact.id, { phone: value })} required disabled={disabled} error={errors[`${contact.id}.phone`]} /><TextField label="Email ID" type="email" value={contact.email} onChange={(value) => updateContact(contact.id, { email: value })} disabled={disabled} error={errors[`${contact.id}.email`]} /></div><div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900"><span className="text-sm font-semibold text-slate-600 dark:text-slate-300">Is Primary Contact?</span><button type="button" disabled={disabled || contact.isPrimary} onClick={() => updateContact(contact.id, { isPrimary: true })} className={`rounded-full px-3 py-1 text-xs font-bold transition ${contact.isPrimary ? 'bg-qpms-600 text-white' : 'bg-white text-slate-600 shadow-sm hover:text-qpms-700 dark:bg-slate-950 dark:text-slate-300'}`}>{contact.isPrimary ? 'Yes' : 'Set Primary'}</button></div></div>)}</div>{!disabled ? <button type="button" onClick={addContact} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm"><Plus className="h-4 w-4" /> Add Contact Person</button> : null}</div>;
}

export default function LeadForm({ values, errors = {}, onChange, onSubmit, onCancel, submitting = false, submitLabel = 'Save Lead', assignmentLabel = '', assignmentKey = '', assignmentOptions = [], assignmentPlaceholder = 'Unassigned', assignmentEnabled = false, selfAssignmentMessage = '' }) {
  return <form className="space-y-5" onSubmit={onSubmit} noValidate><FormSection title="Client Details"><TextField label="Client / Company Name" value={values.company} onChange={(value) => onChange('company', value)} required error={errors.company} /><SelectField label="Industry" value={values.industry} onChange={(value) => onChange('industry', value)} options={industryOptions} placeholder="Select Industry" required error={errors.industry} /><TextField label="Site Location" value={values.location} onChange={(value) => onChange('location', value)} required error={errors.location} /><SelectField label="State" value={values.state} onChange={(value) => onChange('state', value)} options={stateOptions} required error={errors.state} /><TextField label="City" value={values.city} onChange={(value) => onChange('city', value)} required error={errors.city} /></FormSection><FormSection title="Contact Details"><LeadContactEditor contacts={values.contacts} onChange={(contacts) => onChange('contacts', contacts)} errors={errors} /></FormSection><FormSection title="Lead Information"><SelectField label="Lead Source" value={values.source} onChange={(value) => onChange('source', value)} options={sourceOptions} required error={errors.source} /><SelectField label="Lead Priority" value={values.priority} onChange={(value) => onChange('priority', value)} options={priorityOptions} required error={errors.priority} />{selfAssignmentMessage ? <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">{selfAssignmentMessage}</p> : null}{assignmentEnabled && assignmentKey ? <SelectField label={assignmentLabel} value={values[assignmentKey]} onChange={(value) => onChange(assignmentKey, value)} options={assignmentOptions} placeholder={assignmentPlaceholder} /> : null}<div className="md:col-span-2"><TextField label="Remarks" value={values.remarks} onChange={(value) => onChange('remarks', value)} multiline /></div></FormSection><FormSection title="Scope of Services"><ServiceScopeSelector value={values.serviceScope} onChange={(value) => onChange('serviceScope', value)} /></FormSection><div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 dark:border-slate-800 sm:flex-row sm:justify-end"><button type="button" onClick={onCancel} className="focus-ring rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm">Cancel</button><button type="submit" disabled={submitting} className="focus-ring inline-flex items-center gap-2 rounded-xl bg-qpms-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-qpms-600/20 disabled:opacity-60"><ButtonContent loading={submitting}>{submitLabel}</ButtonContent></button></div></form>;
}
