const OCR_CORRECTIONS = [
  ['End Floorocrinology', 'Endocrinology'],
  ['Ultra Sound Floor', 'Ultrasound'],
  ['Registration and Floor Billing', 'Registration and Billing'],
  ['Registration and Floor Verification', 'Registration and Verification'],
  ['Chand Floorra', 'Chandra'],
  ['Sand Flooreep', 'Sandeep'],
];

const BLOCK_ALIASES = new Map([
  ['millennium', 'Millennium'],
  ['mil', 'Millennium'],
  ['millinum', 'Millennium'],
  ['speciality', 'Speciality'],
  ['specialty', 'Speciality'],
  ['spl', 'Speciality'],
]);

const AMBIGUOUS_BLOCK_KEYS = new Set([
  'emergency and physiotherapy block',
  'emergency physiotherapy block',
  'trauma block',
  'emd',
  'old building',
  'npr',
]);

export function cleanNimsValue(value, maxLength = 500) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function applyNimsOcrCorrections(value) {
  let current = cleanNimsValue(value);
  const corrections = [];
  for (const [from, to] of OCR_CORRECTIONS) {
    const pattern = new RegExp(escapeRegExp(from), 'gi');
    if (pattern.test(current)) {
      current = current.replace(pattern, to);
      corrections.push({ from, to });
    }
  }
  return { value: current, corrections };
}

export function normaliseNimsKey(value) {
  return cleanNimsValue(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nimsCode(prefix, ...parts) {
  const body = parts
    .map((part) => normaliseNimsKey(part).replace(/\s+/g, '_').toUpperCase())
    .filter(Boolean)
    .join('_');
  return `${prefix}_${body || 'UNKNOWN'}`.slice(0, 120);
}

export function normaliseNimsBlock(value) {
  const original = cleanNimsValue(value);
  const corrected = applyNimsOcrCorrections(original);
  const key = normaliseNimsKey(corrected.value);
  const alias = BLOCK_ALIASES.get(key);
  const ambiguous = AMBIGUOUS_BLOCK_KEYS.has(key);
  return {
    original,
    value: alias || corrected.value,
    normalisedKey: normaliseNimsKey(alias || corrected.value),
    aliasApplied: alias && alias !== corrected.value ? { from: original, to: alias } : null,
    corrections: corrected.corrections,
    ambiguous,
    ambiguousReason: ambiguous
      ? 'Block name requires manual NIMS confirmation before merging aliases or routing.'
      : '',
  };
}

export function normaliseNimsText(value) {
  const original = cleanNimsValue(value);
  const corrected = applyNimsOcrCorrections(original);
  return {
    original,
    value: corrected.value,
    normalisedKey: normaliseNimsKey(corrected.value),
    corrections: corrected.corrections,
  };
}

export function normaliseNimsVerificationStatus(value) {
  const key = normaliseNimsKey(value);
  if (key === 'verified') return 'verified';
  if (key === 'rejected') return 'rejected';
  if (key === 'inactive') return 'inactive';
  return 'draft';
}

export function floorNumberFromName(value) {
  const key = normaliseNimsKey(value);
  if (!key) return null;
  if (key.includes('ground')) return 0;
  const explicit = key.match(/(^|\s)(-?\d+)(st|nd|rd|th)?(\s|$)/);
  if (explicit) return Number(explicit[2]);
  const words = new Map([
    ['basement', -1],
    ['first', 1],
    ['second', 2],
    ['third', 3],
    ['fourth', 4],
    ['fifth', 5],
    ['sixth', 6],
    ['seventh', 7],
    ['eighth', 8],
    ['ninth', 9],
    ['tenth', 10],
  ]);
  for (const [word, number] of words) {
    if (key.includes(word)) return number;
  }
  return null;
}

export function isLikelyPersonName(value) {
  const text = cleanNimsValue(value);
  return /^(dr|mr|mrs|ms|prof)\.?\s+/i.test(text) || /\b(dr|prof)\.?\b/i.test(text);
}

export function nimsAliasRowsForBlock(block) {
  const key = normaliseNimsKey(block);
  if (['millennium', 'millennium block', 'mil', 'mil block', 'millinum', 'millinum block'].includes(key)) {
    return ['Millennium', 'MIL', 'Millinum'];
  }
  if (['speciality', 'speciality block', 'specialty', 'specialty block', 'spl', 'spl block'].includes(key)) {
    return ['Speciality', 'Specialty', 'SPL'];
  }
  return [];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const nimsOcrCorrections = OCR_CORRECTIONS.map(([from, to]) => ({ from, to }));
