export const industryOptions = ['Manufacturing', 'Educational', 'Retail', 'Commercial', 'Electronics', 'Hospital'];
export const sourceOptions = ['LinkedIn', 'Website', 'Campaign', 'Referral', 'Direct Visit', 'Email', 'Phone Enquiry'];
export const stateOptions = ['Tamil Nadu', 'Kerala', 'Karnataka', 'Telangana', 'Andhra Pradesh - 1', 'Andhra Pradesh - 2'];
export const priorityOptions = ['High', 'Medium', 'Low'];
export const serviceScopeOptions = ['Soft Services', 'Hard Services', 'Security Services', 'Pest Control Services', 'Landscaping Services', 'Waste Management', 'Other Services'];

export const initialLeadForm = {
  company: '', industry: '', source: '', location: '', state: '', city: '',
  contacts: [{ id: 'contact-1', name: '', designation: '', phone: '', email: '', isPrimary: true }],
  priority: '', serviceScope: [], remarks: '', assigned_bd_email: '', assigned_bd_profile_id: '', pre_sales_owner_profile_id: '',
};

export function normalizeContacts(contacts, lead = {}) {
  const fallback = [{ id: `contact-${lead.id || 1}`, name: lead.contact || lead.contact_person_name || '', designation: lead.designation || lead.contact_person_designation || '', phone: lead.phone || lead.contact_number || '', email: lead.email || lead.email_id || '', isPrimary: true }];
  const source = Array.isArray(contacts) && contacts.length ? contacts : fallback;
  const deduped = source.reduce((items, contact) => {
    const name = contact.name || contact.contact_person_name || '';
    const designation = contact.designation || contact.contact_person_designation || '';
    const phone = contact.phone || contact.contact_number || '';
    const email = contact.email || contact.email_id || '';
    const key = String(contact.id || email || phone).trim().toLowerCase();
    const matchKey = key || `${String(name).trim().toLowerCase()}|${String(designation).trim().toLowerCase()}`;
    if (matchKey && items.some((item) => item.__matchKey === matchKey)) return items;
    return [...items, { ...contact, name, designation, phone, email, __matchKey: matchKey }];
  }, []);
  const primaryIndex = Math.max(deduped.findIndex((contact) => contact.isPrimary || contact.is_primary), 0);
  return deduped.map((contact, index) => ({ id: contact.id || `contact-${index + 1}`, name: contact.name || '', designation: contact.designation || '', phone: contact.phone || '', email: contact.email || '', isPrimary: index === primaryIndex }));
}

export function normalizeServiceScope(scope) {
  let items;
  if (Array.isArray(scope)) items = scope;
  else if (scope && typeof scope === 'object') items = Object.entries(scope).filter(([, value]) => value === true || value?.selected).map(([key]) => key);
  else items = String(scope || '').split(',');
  const unique = [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
  return [...serviceScopeOptions.filter((service) => unique.includes(service)), ...unique.filter((service) => !serviceScopeOptions.includes(service))];
}

export function formatServiceScope(scope) {
  const items = normalizeServiceScope(scope);
  return items.length ? items.join('\n') : '';
}

export function leadToFormValues(lead = {}) {
  return {
    ...initialLeadForm,
    company: lead.client_name || lead.company_name || lead.company || '', industry: lead.industry_type || lead.industry || '',
    source: lead.lead_source || lead.source || '', location: lead.site_location || lead.location || '', state: lead.state || '', city: lead.city || '',
    contacts: normalizeContacts(lead.contacts, lead), priority: lead.lead_priority || lead.priority || '',
    serviceScope: normalizeServiceScope(lead.service_scope || lead.serviceScope), remarks: lead.remarks || '',
    assigned_bd_email: lead.assigned_bd_email || '', assigned_bd_profile_id: lead.assigned_bd_profile_id || '',
    pre_sales_owner_profile_id: lead.pre_sales_owner_profile_id || lead.owner_profile_id || '',
  };
}

export function leadFormToApiPayload(form) {
  return { company: form.company, industry: form.industry, source: form.source, location: form.location, state: form.state, city: form.city, contacts: normalizeContacts(form.contacts), priority: form.priority, serviceScope: normalizeServiceScope(form.serviceScope), remarks: form.remarks };
}

export function validateLeadForm(form) {
  const errors = {};
  ['company', 'industry', 'location', 'state', 'city', 'source', 'priority'].forEach((key) => { if (!String(form[key] || '').trim()) errors[key] = 'Required'; });
  normalizeContacts(form.contacts).forEach((contact) => {
    if (!contact.name.trim()) errors[`${contact.id}.name`] = 'Contact name is required';
    if (!contact.phone.trim()) errors[`${contact.id}.phone`] = 'Contact number is required';
    if (contact.phone && (!/^[+()\-\s0-9]+$/.test(contact.phone) || contact.phone.replace(/\D/g, '').length < 7 || contact.phone.replace(/\D/g, '').length > 15)) errors[`${contact.id}.phone`] = 'Enter a valid phone number';
    if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) errors[`${contact.id}.email`] = 'Enter a valid email';
  });
  return errors;
}
