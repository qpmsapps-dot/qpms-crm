const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function pct(part, total, digits = 1) {
  if (!total) return 0;
  return Number(((Number(part || 0) / total) * 100).toFixed(digits));
}

export function formatReportDate(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

export function formatIndiaDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

export function performanceClassName(value) {
  if (value === 'Excellent') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (value === 'Good') return 'bg-sky-50 text-sky-700 ring-sky-200';
  if (value === 'Critical') return 'bg-rose-50 text-rose-700 ring-rose-200';
  if (value === 'Needs Attention') return 'bg-amber-50 text-amber-700 ring-amber-200';
  return 'bg-slate-50 text-slate-600 ring-slate-200';
}

export function compareHierarchy(a = {}, b = {}) {
  return (
    Number(a.sortOrder ?? 9999) - Number(b.sortOrder ?? 9999) ||
    collator.compare(a.blockName || a.floorName || a.locationName || a.name || '', b.blockName || b.floorName || b.locationName || b.name || '') ||
    String(a.blockId || a.floorId || a.locationId || a.key || '').localeCompare(String(b.blockId || b.floorId || b.locationId || b.key || ''))
  );
}

export function respondentName(row = {}) {
  const candidates = [
    row.respondentName,
    row.respondent_name,
    row.name,
    row.metadata?.respondentName,
    row.metadata?.respondent_name,
    row.answers?.respondentName,
    row.answers?.respondent_name,
    row.answers?.name,
  ];
  const found = candidates.find((value) => typeof value === 'string' && value.trim());
  return found ? found.trim() : 'Anonymous';
}

export function hasProvidedName(row = {}) {
  return respondentName(row) !== 'Anonymous';
}

export function commentExcerpt(value, max = 92) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'No comment provided.';
  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text;
}

export function ratingDistributionFromBlocks(blocks = []) {
  const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const block of blocks) {
    counts[5] += Number(block.fiveStar || 0);
    counts[4] += Number(block.fourStar || 0);
    counts[3] += Number(block.threeStar || 0);
    counts[2] += Number(block.twoStar || 0);
    counts[1] += Number(block.oneStar || 0);
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    label: `${rating} Star`,
    count: counts[rating],
    percentage: pct(counts[rating], total, 2),
  }));
}

function isPositiveChecklistValue(value) {
  if (value === true) return true;
  if (typeof value === 'number') return value > 0;
  if (typeof value !== 'string') return false;
  return ['yes', 'true', 'available', 'clean', 'good', 'satisfactory', 'ok', 'present', 'positive'].includes(value.trim().toLowerCase());
}

function isKnownChecklistValue(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return true;
  if (typeof value !== 'string') return false;
  return ['yes', 'no', 'true', 'false', 'available', 'not available', 'clean', 'unclean', 'good', 'bad', 'satisfactory', 'unsatisfactory', 'ok', 'present', 'absent', 'positive', 'negative'].includes(value.trim().toLowerCase());
}

export function checklistRowsFromResponses(responses = []) {
  const map = new Map();
  for (const response of responses) {
    const answers = response.answers && typeof response.answers === 'object' && !Array.isArray(response.answers) ? response.answers : null;
    if (!answers) continue;
    for (const [key, value] of Object.entries(answers)) {
      if (!isKnownChecklistValue(value)) continue;
      if (!map.has(key)) map.set(key, { key, item: key.replace(/[_-]+/g, ' '), answered: 0, positive: 0, negative: 0 });
      const row = map.get(key);
      row.answered += 1;
      if (isPositiveChecklistValue(value)) row.positive += 1;
      else row.negative += 1;
    }
  }
  return Array.from(map.values()).map((row) => ({
    ...row,
    percentage: pct(row.positive, row.answered, 1),
  })).sort((a, b) => collator.compare(a.item, b.item));
}

export function reportMetrics(data = {}) {
  const summary = data.summary || {};
  const responses = [
    ...(data.recentFeedback || []),
    ...(data.recentNeedsAttention || []),
  ];
  const deduped = Array.from(new Map(responses.map((row, index) => [row.id || `${row.submittedAt || row.submitted_at || index}-${row.locationId || index}`, row])).values());
  const namedCount = deduped.filter(hasProvidedName).length;
  const checklistRows = checklistRowsFromResponses(deduped);
  const answeredChecklistResponses = deduped.filter((row) => row.answers && typeof row.answers === 'object' && Object.keys(row.answers).length).length;
  const total = Number(summary.totalResponses || 0);
  return {
    total,
    averageRating: Number(summary.averageRating || 0),
    fiveStarPercentage: Number(summary.fiveStarPercentage || 0),
    fiveStarCount: Number(summary.fiveStarCount || 0),
    needsAttention: Number(summary.belowFourCount || 0),
    namedCount,
    namedPercentage: pct(namedCount, total, 1),
    checklistRows,
    checklistAnswered: answeredChecklistResponses,
    checklistCompletion: pct(answeredChecklistResponses, total, 1),
  };
}
