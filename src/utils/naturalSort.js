const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function naturalLabelCompare(a, b) {
  return naturalCollator.compare(String(a || ''), String(b || ''));
}

export function naturalOptionCompare(a, b) {
  return naturalLabelCompare(a?.label, b?.label) ||
    String(a?.value || '').localeCompare(String(b?.value || ''));
}
