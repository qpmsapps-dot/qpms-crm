import { Copy, Plus, Trash2 } from 'lucide-react';
import { SERVICE_SCOPE_OPTIONS } from '../../services/siteAssessmentV2.js';

const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-qpms-400 focus:ring-4 focus:ring-qpms-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-qpms-500/10';
const labelClass = 'text-xs font-bold text-slate-600 dark:text-slate-300';

function Field({ label, value, onChange, type = 'text', multiline = false, disabled = false }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {multiline ? <textarea className={`${inputClass} min-h-24 resize-y`} value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value)} /> : <input className={inputClass} type={type} value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value)} />}
    </label>
  );
}

function Select({ label, value, options, onChange, disabled = false }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <select className={inputClass} value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function SectionCard({ title, description, children }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/60"><div className="mb-4"><h4 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h4>{description ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p> : null}</div>{children}</section>;
}

function ContactFields({ contact, index, onChange, disabled }) {
  return <div className="grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800 md:grid-cols-2">
    <div className="md:col-span-2"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Contact {index + 1}{index === 0 ? ' - Primary' : ''}</p></div>
    <Field label="Name" value={contact.name} disabled={disabled} onChange={(value) => onChange({ name: value })} />
    <Field label="Designation" value={contact.designation} disabled={disabled} onChange={(value) => onChange({ designation: value })} />
    <Field label="Phone / Mobile" value={contact.phone || contact.mobile} disabled={disabled} onChange={(value) => onChange({ phone: value, mobile: value })} />
    <Field label="Fax" value={contact.fax} disabled={disabled} onChange={(value) => onChange({ fax: value })} />
    <Field label="Email" value={contact.email} type="email" disabled={disabled} onChange={(value) => onChange({ email: value })} />
  </div>;
}

export function ClientSiteSection({ survey, onFieldChange, onContactChange, photoEvidence = {}, onAddPhotos, readOnly = false }) {
  const client = survey.client_site || {};
  const contacts = client.contacts || [];
  return <div className="space-y-4">
    <SectionCard title="Client and site details" description="Lead and profile values are prefilled and remain editable only where the workflow permits correction.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Field label="Survey Date" type="date" value={client.survey_date} disabled={readOnly} onChange={(value) => onFieldChange('survey_date', value)} />
        <Field label="Client Name" value={client.client_name} disabled={readOnly} onChange={(value) => onFieldChange('client_name', value)} />
        <Field label="Client Legal Name" value={client.client_legal_name} disabled={readOnly} onChange={(value) => onFieldChange('client_legal_name', value)} />
        <Field label="Site Address" value={client.site_address || client.address} disabled={readOnly} onChange={(value) => onFieldChange('site_address', value)} />
        <Field label="Site Location" value={client.site_location} disabled={readOnly} onChange={(value) => onFieldChange('site_location', value)} />
        <Field label="Site Managed From" value={client.managed_from} disabled={readOnly} onChange={(value) => onFieldChange('managed_from', value)} />
        <Field label="State" value={client.state} disabled={readOnly} onChange={(value) => onFieldChange('state', value)} />
        <Field label="City" value={client.city} disabled={readOnly} onChange={(value) => onFieldChange('city', value)} />
        <Field label="Zone" value={client.zone} disabled={readOnly} onChange={(value) => onFieldChange('zone', value)} />
        <Field label="Industry / Nature of Business" value={client.industry} disabled={readOnly} onChange={(value) => onFieldChange('industry', value)} />
        <Field label="Client Working Timings" value={client.client_working_timings} disabled={readOnly} onChange={(value) => onFieldChange('client_working_timings', value)} />
        <Field label="Client Working Days" value={client.client_working_days} disabled={readOnly} onChange={(value) => onFieldChange('client_working_days', value)} />
        <Field label="QPMS Service Timings" value={client.qpms_service_timings} disabled={readOnly} onChange={(value) => onFieldChange('qpms_service_timings', value)} />
        <Field label="Built-up Area (SFT)" type="number" value={client.built_up_area} disabled={readOnly} onChange={(value) => onFieldChange('built_up_area', value)} />
        <Field label="Floor-Plate Area (SFT)" type="number" value={client.floor_plate_area} disabled={readOnly} onChange={(value) => onFieldChange('floor_plate_area', value)} />
        <Field label="Number of Floors" type="number" value={client.number_of_floors} disabled={readOnly} onChange={(value) => onFieldChange('number_of_floors', value)} />
        <Field label="Per-Floor Area (SFT)" type="number" value={client.per_floor_area} disabled={readOnly} onChange={(value) => onFieldChange('per_floor_area', value)} />
        <Field label="Occupants / Staff" type="number" value={client.occupants_staff} disabled={readOnly} onChange={(value) => onFieldChange('occupants_staff', value)} />
        <Field label="Floating Footfall" type="number" value={client.floating_footfall} disabled={readOnly} onChange={(value) => onFieldChange('floating_footfall', value)} />
      </div>
    </SectionCard>
    <SectionCard title="Surveyor details" description="Taken from the authenticated profile when available.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Survey Done By" value={client.surveyor?.name} disabled={readOnly} onChange={(value) => onFieldChange('surveyor', { ...client.surveyor, name: value })} />
        <Field label="Designation" value={client.surveyor?.designation} disabled={readOnly} onChange={(value) => onFieldChange('surveyor', { ...client.surveyor, designation: value })} />
        <Field label="Phone" value={client.surveyor?.phone} disabled={readOnly} onChange={(value) => onFieldChange('surveyor', { ...client.surveyor, phone: value })} />
        <Field label="Employee Code" value={client.surveyor?.employee_code} disabled={readOnly} onChange={(value) => onFieldChange('surveyor', { ...client.surveyor, employee_code: value })} />
      </div>
    </SectionCard>
    <SectionCard title="Contacts">
      <div className="space-y-3">{contacts.map((contact, index) => <ContactFields key={`${contact.name}-${index}`} contact={contact} index={index} disabled={readOnly} onChange={(patch) => onContactChange(index, patch)} />)}</div>
      {!readOnly ? <button type="button" className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-qpms-300 dark:border-slate-700 dark:text-slate-200" onClick={() => onContactChange(null, { add: true })}><Plus className="h-4 w-4" /> Add contact</button> : null}
    </SectionCard>
    <SectionCard title="Site photographs" description="Existing image evidence remains available. Document categories are reserved for the attachment phase.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{['Entrance', 'Service Area', 'Equipment Scope', 'Washroom', 'Waste Disposal Area'].map((category) => <label key={category} className="rounded-xl border border-dashed border-slate-300 p-3 text-sm font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">{category}<input className="mt-2 block w-full text-xs" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={readOnly || !onAddPhotos} onChange={(event) => { if (event.target.files?.length) onAddPhotos(category, [...event.target.files]); event.target.value = ''; }} />{(photoEvidence[category] || []).length ? <span className="mt-1 block text-xs text-emerald-600">{photoEvidence[category].length} image(s) attached</span> : null}</label>)}</div>
    </SectionCard>
  </div>;
}

function ConditionalField({ condition, children }) { return condition ? children : null; }

export function FacilityRequirementsSection({ survey, onFieldChange, readOnly = false }) {
  const facility = survey.facility_requirements || {};
  const set = (key, value) => onFieldChange(key, value);
  const toggle = (key, value, clear = []) => { set(key, value); if (value !== 'Yes') clear.forEach((field) => set(field, '')); };
  return <div className="space-y-4">
    <SectionCard title="Service scope" description="Prefilled from the lead where available. Detailed technical matrices remain in legacy details/review." >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{SERVICE_SCOPE_OPTIONS.map((option) => <label key={option} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"><input type="checkbox" checked={(facility.service_scope || []).includes(option)} disabled={readOnly} onChange={(event) => { const next = new Set(facility.service_scope || []); if (event.target.checked) next.add(option); else next.delete(option); onFieldChange('service_scope', SERVICE_SCOPE_OPTIONS.filter((item) => next.has(item))); }} />{option}</label>)}</div>
      {(facility.service_scope || []).includes('Other Services') ? <Field label="Other Services Description" value={facility.other_services_description} disabled={readOnly} onChange={(value) => set('other_services_description', value)} /> : null}
    </SectionCard>
    <SectionCard title="Facility and service requirements" description="Dependent fields are cleared when their parent requirement is set to No.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Select label="Waste Segregation Required" value={facility.waste_segregation_required} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => set('waste_segregation_required', value)} />
        <Field label="Waste Disposal Type" value={facility.waste_disposal_type} disabled={readOnly} onChange={(value) => set('waste_disposal_type', value)} />
        <Select label="Designated Disposal Area" value={facility.designated_disposal_area} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => set('designated_disposal_area', value)} />
        <Select label="External Waste Disposal" value={facility.external_waste_disposal_required} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => toggle('external_waste_disposal_required', value, ['external_disposal_frequency', 'external_contractor_rate'])} />
        <ConditionalField condition={facility.external_waste_disposal_required === 'Yes'}><Field label="External Disposal Frequency" value={facility.external_disposal_frequency} disabled={readOnly} onChange={(value) => set('external_disposal_frequency', value)} /></ConditionalField>
        <ConditionalField condition={facility.external_waste_disposal_required === 'Yes'}><Field label="External Contractor Rate" type="number" value={facility.external_contractor_rate} disabled={readOnly} onChange={(value) => set('external_contractor_rate', value)} /></ConditionalField>
        <Select label="Pantry Service Required" value={facility.pantry_service_required} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => set('pantry_service_required', value)} />
        <Field label="Number of Pantries" type="number" value={facility.number_of_pantries} disabled={readOnly} onChange={(value) => set('number_of_pantries', value)} />
        <Field label="Total Pantry Area" type="number" value={facility.total_pantry_area} disabled={readOnly} onChange={(value) => set('total_pantry_area', value)} />
        <Select label="Water Bodies Present" value={facility.water_bodies_present} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => toggle('water_bodies_present', value, ['water_body_details', 'water_body_maintenance'])} />
        <ConditionalField condition={facility.water_bodies_present === 'Yes'}><Field label="Water-body Details" value={facility.water_body_details} disabled={readOnly} onChange={(value) => set('water_body_details', value)} multiline /></ConditionalField>
        <ConditionalField condition={facility.water_bodies_present === 'Yes'}><Select label="Water-body Maintenance" value={facility.water_body_maintenance} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => set('water_body_maintenance', value)} /></ConditionalField>
        <Select label="External Façade Glass Present" value={facility.facade_glass_present} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => toggle('facade_glass_present', value, ['facade_glass_area', 'facade_cleaning_frequency', 'boom_lift_available'])} />
        <ConditionalField condition={facility.facade_glass_present === 'Yes'}><Field label="Façade Glass Area" type="number" value={facility.facade_glass_area} disabled={readOnly} onChange={(value) => set('facade_glass_area', value)} /></ConditionalField>
        <ConditionalField condition={facility.facade_glass_present === 'Yes'}><Field label="Façade Cleaning Frequency" value={facility.facade_cleaning_frequency} disabled={readOnly} onChange={(value) => set('facade_cleaning_frequency', value)} /></ConditionalField>
        <ConditionalField condition={facility.facade_glass_present === 'Yes'}><Select label="Boom Lift Available" value={facility.boom_lift_available} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => set('boom_lift_available', value)} /></ConditionalField>
        <Select label="Pest Control Required" value={facility.pest_control_required} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => toggle('pest_control_required', value, ['pest_control_service_type', 'pest_control_frequency'])} />
        <ConditionalField condition={facility.pest_control_required === 'Yes'}><Field label="Pest-control Service Type" value={facility.pest_control_service_type} disabled={readOnly} onChange={(value) => set('pest_control_service_type', value)} /></ConditionalField>
        <ConditionalField condition={facility.pest_control_required === 'Yes'}><Field label="Pest-control Frequency" value={facility.pest_control_frequency} disabled={readOnly} onChange={(value) => set('pest_control_frequency', value)} /></ConditionalField>
        <Select label="Specialized Cleaning Required" value={facility.specialized_cleaning_required} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => toggle('specialized_cleaning_required', value, ['specialized_cleaning_frequency'])} />
        <ConditionalField condition={facility.specialized_cleaning_required === 'Yes'}><Field label="Specialized Cleaning Services" value={facility.specialized_cleaning_services} disabled={readOnly} onChange={(value) => set('specialized_cleaning_services', value)} /></ConditionalField>
        <ConditionalField condition={facility.specialized_cleaning_required === 'Yes'}><Field label="Specialized Cleaning Frequency" value={facility.specialized_cleaning_frequency} disabled={readOnly} onChange={(value) => set('specialized_cleaning_frequency', value)} /></ConditionalField>
        <Select label="Neighbouring Manpower Available" value={facility.neighbouring_manpower_availability} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => set('neighbouring_manpower_availability', value)} />
        <Field label="Manpower Sourcing Area" value={facility.manpower_sourcing_area} disabled={readOnly} onChange={(value) => set('manpower_sourcing_area', value)} />
        <Select label="Staff Transportation Required" value={facility.staff_transportation_required} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => set('staff_transportation_required', value)} />
        <Field label="Estimated Transport Cost" type="number" value={facility.estimated_transport_cost} disabled={readOnly} onChange={(value) => set('estimated_transport_cost', value)} />
        <Select label="Union Activity" value={facility.union_activity} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => set('union_activity', value)} />
        <Select label="Retain Existing Staff" value={facility.retain_existing_staff} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => toggle('retain_existing_staff', value, ['existing_salary_structure'])} />
        <ConditionalField condition={facility.retain_existing_staff === 'Yes'}><Field label="Existing Salary Structure" value={facility.existing_salary_structure} disabled={readOnly} onChange={(value) => set('existing_salary_structure', value)} multiline /></ConditionalField>
        <Select label="National/Festival Holiday Service" value={facility.national_festival_holiday_service} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => set('national_festival_holiday_service', value)} />
        <Select label="Nearby Recruitment Restrictions" value={facility.nearby_recruitment_restrictions} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => set('nearby_recruitment_restrictions', value)} />
        <Select label="Special PPE Required" value={facility.special_ppe_required} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => toggle('special_ppe_required', value, ['ppe_details'])} />
        <ConditionalField condition={facility.special_ppe_required === 'Yes'}><Field label="PPE Details" value={facility.ppe_details} disabled={readOnly} onChange={(value) => set('ppe_details', value)} multiline /></ConditionalField>
        <Select label="Medical Verification Required" value={facility.medical_verification_required} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => set('medical_verification_required', value)} />
        <Select label="Police Verification Required" value={facility.police_verification_required} options={['Yes', 'No']} disabled={readOnly} onChange={(value) => set('police_verification_required', value)} />
        <Select label="Wage Category" value={facility.wage_category} options={['Central', 'State']} disabled={readOnly} onChange={(value) => set('wage_category', value)} />
      </div>
    </SectionCard>
  </div>;
}

function RowActions({ onDuplicate, onRemove, canRemove = true }) {
  return <div className="flex items-center gap-1"><button type="button" title="Duplicate row" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onDuplicate}><Copy className="h-4 w-4" /></button>{canRemove ? <button type="button" title="Remove row" className="rounded-lg p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10" onClick={onRemove}><Trash2 className="h-4 w-4" /></button> : null}</div>;
}

function EquipmentTable({ title, rows, onChange, onAdd, onDuplicate, onRemove, readOnly }) {
  return <SectionCard title={title}><div className="space-y-3">{rows.map((row, index) => <div key={row.id || index} className="grid gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800 md:grid-cols-5"><Field label="Description" value={row.description || row.name} disabled={readOnly} onChange={(value) => onChange(index, { description: value, name: value })} /><Field label="Quantity" type="number" value={row.quantity} disabled={readOnly} onChange={(value) => onChange(index, { quantity: Math.max(0, Number(value || 0)) })} /><Field label="Brand / Capacity" value={row.brandCapacity || row.brand} disabled={readOnly} onChange={(value) => onChange(index, { brandCapacity: value, brand: value })} /><Field label="Ownership / Responsibility" value={row.ownership || row.scopeResponsibility} disabled={readOnly} onChange={(value) => onChange(index, { ownership: value, scopeResponsibility: value })} /><div><span className={labelClass}>Actions</span><div className="mt-1.5"><RowActions onDuplicate={() => onDuplicate(index)} onRemove={() => onRemove(index)} /></div></div><div className="md:col-span-5"><Field label="Remarks" value={row.remarks} disabled={readOnly} onChange={(value) => onChange(index, { remarks: value })} /></div></div>)}</div>{!readOnly ? <button type="button" className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold dark:border-slate-700" onClick={onAdd}><Plus className="h-4 w-4" /> Add Row</button> : null}</SectionCard>;
}

function ManpowerTable({ title, rows, onChange, onAdd, onDuplicate, onRemove, readOnly, suggested = false }) {
  return <SectionCard title={title}><div className="space-y-3">{rows.map((row, index) => <div key={row.id || index} className="grid gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800 md:grid-cols-4"><Field label="Location / Floor / Area" value={row.location} disabled={readOnly} onChange={(value) => onChange(index, { location: value })} /><Field label={suggested ? 'Department' : 'Designation'} value={suggested ? row.department : row.designation} disabled={readOnly} onChange={(value) => onChange(index, suggested ? { department: value } : { designation: value })} /><Field label="Designation" value={row.designation} disabled={readOnly} onChange={(value) => onChange(index, { designation: value })} /><Field label="Shift Name" value={row.shiftName || row.shiftType} disabled={readOnly} onChange={(value) => onChange(index, { shiftName: value, shiftType: value })} /><Field label="Start" type="time" value={row.startTime} disabled={readOnly} onChange={(value) => onChange(index, { startTime: value })} /><Field label="End" type="time" value={row.endTime} disabled={readOnly} onChange={(value) => onChange(index, { endTime: value })} /><Field label="Head Count" type="number" value={row.headCount ?? row.count} disabled={readOnly} onChange={(value) => onChange(index, { headCount: Math.max(0, Number(value || 0)), count: Math.max(0, Number(value || 0)) })} /><Field label="Monthly Take-home Salary" type="number" value={row.monthlyTakeHomeSalary ?? row.salary} disabled={readOnly} onChange={(value) => onChange(index, { monthlyTakeHomeSalary: Math.max(0, Number(value || 0)), salary: Math.max(0, Number(value || 0)) })} /><Field label="Remarks" value={row.remarks} disabled={readOnly} onChange={(value) => onChange(index, { remarks: value })} /><div><span className={labelClass}>Actions</span><div className="mt-1.5"><RowActions onDuplicate={() => onDuplicate(index)} onRemove={() => onRemove(index)} /></div></div></div>)}</div>{!readOnly ? <button type="button" className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold dark:border-slate-700" onClick={onAdd}><Plus className="h-4 w-4" /> Add Row</button> : null}</SectionCard>;
}

export function MpdPreview({ rows = [] }) {
  const groups = rows.reduce((result, row) => { const key = `${row.location || 'Unspecified'}|${row.shiftName || row.shiftType || 'Unspecified'}|${row.designation || 'Unspecified'}`; result[key] = (result[key] || 0) + Number(row.headCount ?? row.count ?? 0); return result; }, {});
  return <SectionCard title="MPD preview" description="Suggested manpower is the normalized MPD source for the future workbook export."><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800"><th className="p-2">Location</th><th className="p-2">Shift</th><th className="p-2">Designation</th><th className="p-2 text-right">Head Count</th></tr></thead><tbody>{Object.entries(groups).map(([key, count]) => { const [location, shift, designation] = key.split('|'); return <tr key={key} className="border-b border-slate-100 dark:border-slate-900"><td className="p-2">{location}</td><td className="p-2">{shift}</td><td className="p-2">{designation}</td><td className="p-2 text-right">{count}</td></tr>; })}</tbody></table></div>{!Object.keys(groups).length ? <p className="text-sm text-slate-500">Add suggested manpower rows to preview MPD.</p> : null}</SectionCard>;
}

export function EquipmentManpowerSection({ survey, onArrayChange, onAdd, onRemove, onDuplicate, onCopy, readOnly = false }) {
  const data = survey.equipment_manpower || {};
  const currentEquipment = data.current_equipment || [];
  const suggestedEquipment = data.suggested_equipment || [];
  const currentManpower = data.current_manpower || [];
  const suggestedManpower = data.suggested_manpower || [];
  const equipmentTotal = (rows) => rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const manpowerTotal = (rows) => rows.reduce((sum, row) => sum + Number(row.headCount ?? row.count ?? 0), 0);
  return <div className="space-y-4">
    <div className="grid gap-3 md:grid-cols-4"><div className="rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-900">Current equipment: <b>{equipmentTotal(currentEquipment)}</b></div><div className="rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-900">Suggested equipment: <b>{equipmentTotal(suggestedEquipment)}</b></div><div className="rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-900">Current head count: <b>{manpowerTotal(currentManpower)}</b></div><div className="rounded-xl bg-slate-100 p-3 text-sm dark:bg-slate-900">Suggested head count: <b>{manpowerTotal(suggestedManpower)}</b></div></div>
    <EquipmentTable title="Current Equipment" rows={currentEquipment} readOnly={readOnly} onChange={(index, patch) => onArrayChange('current_equipment', index, patch)} onAdd={() => onAdd('current_equipment')} onRemove={(index) => onRemove('current_equipment', index)} onDuplicate={(index) => onDuplicate('current_equipment', index)} />
    <div className="flex justify-end"><button type="button" disabled={readOnly} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold dark:border-slate-700" onClick={() => onCopy('equipment')}><Copy className="h-3.5 w-3.5" /> Copy current to suggested</button></div>
    <EquipmentTable title="Suggested Equipment" rows={suggestedEquipment} readOnly={readOnly} onChange={(index, patch) => onArrayChange('suggested_equipment', index, patch)} onAdd={() => onAdd('suggested_equipment')} onRemove={(index) => onRemove('suggested_equipment', index)} onDuplicate={(index) => onDuplicate('suggested_equipment', index)} />
    <ManpowerTable title="Current Manpower" rows={currentManpower} readOnly={readOnly} onChange={(index, patch) => onArrayChange('current_manpower', index, patch)} onAdd={() => onAdd('current_manpower')} onRemove={(index) => onRemove('current_manpower', index)} onDuplicate={(index) => onDuplicate('current_manpower', index)} />
    <div className="flex justify-end"><button type="button" disabled={readOnly} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold dark:border-slate-700" onClick={() => onCopy('manpower')}><Copy className="h-3.5 w-3.5" /> Copy current to suggested</button></div>
    <ManpowerTable title="Suggested Manpower" rows={suggestedManpower} suggested readOnly={readOnly} onChange={(index, patch) => onArrayChange('suggested_manpower', index, patch)} onAdd={() => onAdd('suggested_manpower')} onRemove={(index) => onRemove('suggested_manpower', index)} onDuplicate={(index) => onDuplicate('suggested_manpower', index)} />
    <MpdPreview rows={suggestedManpower} />
  </div>;
}

export function CommercialReviewSection({ survey, onFieldChange, readOnly = false }) {
  const commercial = survey.commercial_inputs || {};
  const field = (label, key, type = 'text') => <Field label={label} type={type} value={commercial[key]} disabled={readOnly} onChange={(value) => onFieldChange(key, value)} />;
  return <div className="space-y-4">
    <SectionCard title="Commercial inputs" description="Commercial, HR and Finance fields remain editable by the authorized workflow stage."><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {field('Minimum Wage Category', 'minimum_wage_category')}{field('Zone', 'zone')}{field('Existing Salary Payslip', 'existing_salary_payslip')}{field('Leave Wage', 'leave_wage', 'number')}{field('Bonus', 'bonus', 'number')}{field('Food Allowance', 'food_allowance', 'number')}{field('Food Deduction', 'food_deduction', 'number')}{field('Transport Allowance', 'transport_allowance', 'number')}{field('Transport Deduction', 'transport_deduction', 'number')}{field('Accommodation Allowance', 'accommodation_allowance', 'number')}{field('Accommodation Deduction', 'accommodation_deduction', 'number')}{field('Other Deductions', 'other_deductions', 'number')}{field('Reliever Method', 'reliever_method')}{field('National/Festival Holiday Costing', 'national_festival_holiday_costing')}{field('ESI / WCI', 'esi_wci')}{field('SEZ / Non-SEZ', 'sez_status')}{field('OT Payout Rule', 'ot_payout_rule')}{field('Uniform Cost', 'uniform_cost', 'number')}{field('Additional PPE Cost', 'additional_ppe_cost', 'number')}{field('Medical Verification Cost', 'medical_verification_cost', 'number')}{field('Police Verification Cost', 'police_verification_cost', 'number')}{field('Machinery Proposed Cost', 'machinery_proposed_cost', 'number')}{field('Cleaning Materials / Chemicals Cost', 'cleaning_materials_cost', 'number')}{field('Consumables / Toiletries Cost', 'consumables_cost', 'number')}{field('Pest Control / Deep Cleaning / SST Cost', 'sst_cost', 'number')}{field('Existing Vendor Details', 'existing_vendor_details')}{field('Salary Payment Terms', 'salary_payment_terms')}{field('Invoice Payment Terms', 'invoice_payment_terms')}{field('Attendance Cycle Start', 'attendance_cycle_start')}{field('Attendance Cycle End', 'attendance_cycle_end')}{field('Management Fee / Margin', 'management_fee', 'number')}{field('Other Commercial Remarks', 'other_commercial_remarks')}
    </div></SectionCard>
    <SectionCard title="Read-only survey summary"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><Field label="Client" value={survey.client_site?.client_name} disabled onChange={() => {}} /><Field label="Contacts" value={(survey.client_site?.contacts || []).map((contact) => contact.name).filter(Boolean).join(', ')} disabled onChange={() => {}} /><Field label="Area" value={survey.client_site?.built_up_area} disabled onChange={() => {}} /><Field label="Occupants" value={survey.client_site?.occupants_staff} disabled onChange={() => {}} /><Field label="Working Days" value={survey.client_site?.client_working_days} disabled onChange={() => {}} /><Field label="Suggested Manpower" value={(survey.equipment_manpower?.suggested_manpower || []).length} disabled onChange={() => {}} /></div></SectionCard>
    <SectionCard title="Review summary"><div className="grid gap-2 text-sm text-slate-600 dark:text-slate-300"><p>Client & Site: {survey.client_site?.client_name || 'Incomplete'}</p><p>Facility scope: {(survey.facility_requirements?.service_scope || []).join(', ') || 'Not selected'}</p><p>Current manpower rows: {(survey.equipment_manpower?.current_manpower || []).length}</p><p>Suggested manpower rows: {(survey.equipment_manpower?.suggested_manpower || []).length}</p><p>Missing information is shown in the section validation summary before submission.</p></div></SectionCard>
    <SectionCard title="Document categories"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{['Site Photograph', 'Machinery Photograph', 'Floor Plan', 'Existing Salary Payslip', 'Existing Salary Structure', 'Existing Vendor Document', 'PPE Document', 'Client Document', 'Other'].map((category) => <div key={category} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">{category}<span className="mt-1 block font-normal text-slate-500">Coming in attachment phase</span></div>)}</div></SectionCard>
  </div>;
}
