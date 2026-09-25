function compactRoleKey(value = '') {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function normalizeRoleKey(role = '') {
  return compactRoleKey(role);
}
