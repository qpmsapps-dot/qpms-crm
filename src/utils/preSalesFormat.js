export function formatDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
