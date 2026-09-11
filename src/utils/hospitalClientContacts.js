function searchableContactText(contact = {}) {
  return [contact.full_name, contact.designation, contact.mobile]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
}

export function filterHospitalClientContacts(contacts = [], search = '') {
  const query = String(search || '').trim().toLowerCase();
  if (!query) return contacts;
  return contacts.filter((contact) => searchableContactText(contact).includes(query));
}
