const ACTIVE_BLOCKS = [
  'Admin Block',
  'Core Block',
  'Emergency Block',
  'Millennium Block',
  'Radiation Block',
  'Speciality Block',
  'OPD Block',
  'Oncology Block',
  'Extra Mural',
];

const LEGACY_ACTIVE_BLOCKS = [
  'Admin Block',
  'OPD Block',
  'Oncology Block',
  'Speciality Block',
  'Millennium Block',
  'Core Block',
  'Extra Mural',
];

const ROUTING_TYPE_RANK = {
  primary: 1,
  backup: 2,
  overall_fallback: 3,
  operations_fallback: 4,
};

export const nimsActiveBlockNames = ACTIVE_BLOCKS;
export const nimsLegacyActiveBlockNames = LEGACY_ACTIVE_BLOCKS;

export const nimsSupervisorRoster = [
  { name: 'Ch Ramu', shift: '8 AM-4 PM', responsibility: 'Overall / Administration', assignmentType: 'overall_fallback', draftOnly: true },
  { name: 'L. V. Sai', shift: '8 AM-4 PM', responsibility: 'OPD Block; Admin Block; Oncology Block', blocks: ['OPD Block', 'Admin Block', 'Oncology Block'], assignmentType: 'primary' },
  { name: 'M. Praveen', shift: '8 AM-4 PM', responsibility: 'Speciality Block', blocks: ['Speciality Block'], assignmentType: 'primary', priority: 10 },
  { name: 'Sastri', shift: '8 AM-4 PM', responsibility: 'Speciality Block; Trauma Block; Campus', blocks: ['Speciality Block'], skippedBlocks: ['Trauma Block'], assignmentType: 'backup', priority: 20, draftFallback: true },
  { name: 'B. Anil', shift: '7 AM-3 PM', responsibility: 'Trauma Block', skippedBlocks: ['Trauma Block'], draftOnly: true },
  { name: 'Shiva', shift: '2 PM-8 PM', responsibility: 'Speciality Block; Trauma Block', blocks: ['Speciality Block'], skippedBlocks: ['Trauma Block'], assignmentType: 'primary' },
  { name: 'Venkata Krishna Reddy', shift: '8 PM-8 AM', responsibility: 'All Blocks / Night', blocks: ACTIVE_BLOCKS, assignmentType: 'primary', priority: 10 },
  { name: 'A Ravi', shift: '7 AM-3 PM', responsibility: 'NPR Blocks; Old Building', skippedBlocks: ['NPR Blocks', 'Old Building'], draftOnly: true },
  { name: 'K Srinivas', shift: '8 AM-4 PM', responsibility: 'Campus; Waiting Halls', draftOnly: true },
  { name: 'V Lenin', shift: '8 AM-4 PM', responsibility: 'Millennium Block', blocks: ['Millennium Block'], assignmentType: 'primary' },
  { name: 'V Anji Reddy', shift: '12 Noon-8 PM', responsibility: 'NPR Blocks; Old Building; Millennium Block', blocks: ['Millennium Block'], skippedBlocks: ['NPR Blocks', 'Old Building'], assignmentType: 'primary' },
  { name: 'Y Nikhil', shift: '8 PM-8 AM', responsibility: 'All Blocks / Night', blocks: ACTIVE_BLOCKS, assignmentType: 'backup', priority: 20 },
  { name: 'M Srinivas', shift: '12 Noon-8 PM', responsibility: 'Millennium Block; Overall', blocks: ['Millennium Block'], assignmentType: 'backup', priority: 20, draftFallback: true },
];

export function normalizeRoutingText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function minutesSinceMidnight(value) {
  const text = normalizeRoutingText(value).toLowerCase();
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) throw new Error(`Unsupported shift time: ${value}`);
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3];
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour === 24) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error(`Unsupported shift time: ${value}`);
  return hour * 60 + minute;
}

export function parseShiftWindow(label) {
  const normalized = normalizeRoutingText(label).replace(/\s*-\s*/g, '-').replace(/–/g, '-');
  const [rawStart, rawEnd] = normalized.split('-');
  if (!rawStart || !rawEnd) throw new Error(`Unsupported shift label: ${label}`);
  const startMinutes = minutesSinceMidnight(rawStart.replace(/^12\s*noon$/i, '12 PM'));
  const endMinutes = minutesSinceMidnight(rawEnd.replace(/^12\s*noon$/i, '12 PM'));
  return {
    label,
    shiftCode: normalized.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
    startMinutes,
    endMinutes,
    crossesMidnight: endMinutes <= startMinutes,
  };
}

export function isShiftActive(shift, date = new Date()) {
  const current = date.getHours() * 60 + date.getMinutes();
  if (shift.crossesMidnight) return current >= shift.startMinutes || current < shift.endMinutes;
  return current >= shift.startMinutes && current < shift.endMinutes;
}

export function assignmentSpecificity(assignment) {
  return (assignment.departmentId ? 4 : 0)
    + (assignment.blockId ? 2 : 0)
    + (assignment.categoryId ? 1 : 0);
}

export function assignmentPrecedence(assignment) {
  if (assignment.departmentId && assignment.blockId && assignment.categoryId) return 1;
  if (assignment.blockId && assignment.categoryId) return 2;
  if (assignment.blockId && assignment.assignmentType === 'primary') return 3;
  if (assignment.blockId && assignment.assignmentType === 'backup') return 4;
  if (!assignment.blockId && ['primary', 'backup'].includes(assignment.assignmentType)) return 5;
  if (!assignment.blockId && assignment.assignmentType === 'overall_fallback') return 6;
  if (assignment.assignmentType === 'operations_fallback') return 7;
  return 50;
}

export function chooseSupervisorAssignment(assignments, context) {
  const now = context.now || new Date();
  const candidates = (assignments || []).filter((assignment) => {
    if (!assignment || assignment.isActive === false) return false;
    if (assignment.verificationStatus !== 'verified') return false;
    if (!assignment.userId || assignment.userActive === false) return false;
    if (assignment.clientId !== context.clientId) return false;
    if (assignment.effectiveFrom && new Date(assignment.effectiveFrom) > now) return false;
    if (assignment.effectiveTo && new Date(assignment.effectiveTo) <= now) return false;
    if (assignment.blockId && assignment.blockId !== context.blockId) return false;
    if (assignment.departmentId && assignment.departmentId !== context.departmentId) return false;
    if (assignment.categoryId && assignment.categoryId !== context.categoryId) return false;
    if (assignment.shift && !isShiftActive(assignment.shift, now)) return false;
    return true;
  });
  if (!candidates.length) {
    return {
      assigned: false,
      reason: 'no_verified_active_shift_assignment',
      assignment: null,
    };
  }
  candidates.sort((a, b) => {
    const precedence = assignmentPrecedence(a) - assignmentPrecedence(b);
    if (precedence) return precedence;
    const priority = Number(a.routingPriority || 100) - Number(b.routingPriority || 100);
    if (priority) return priority;
    const type = (ROUTING_TYPE_RANK[a.assignmentType] || 99) - (ROUTING_TYPE_RANK[b.assignmentType] || 99);
    if (type) return type;
    const specificity = assignmentSpecificity(b) - assignmentSpecificity(a);
    if (specificity) return specificity;
    return String(a.userId).localeCompare(String(b.userId));
  });
  const selected = candidates[0];
  return {
    assigned: true,
    userId: selected.userId,
    assignment: selected,
    reason: [
      selected.departmentId ? 'department' : null,
      selected.blockId ? 'block' : 'all_block',
      selected.categoryId ? 'category' : null,
      selected.assignmentType,
      selected.shift?.label || null,
    ].filter(Boolean).join('_'),
  };
}

export function nimsRosterCoverageMatrix({ roster = nimsSupervisorRoster, blocks = ACTIVE_BLOCKS } = {}) {
  const windows = [
    { label: '7 AM-8 AM', at: new Date('2026-07-21T07:30:00+05:30') },
    { label: '8 AM-12 Noon', at: new Date('2026-07-21T10:00:00+05:30') },
    { label: '12 Noon-2 PM', at: new Date('2026-07-21T13:00:00+05:30') },
    { label: '2 PM-3 PM', at: new Date('2026-07-21T14:30:00+05:30') },
    { label: '3 PM-4 PM', at: new Date('2026-07-21T15:30:00+05:30') },
    { label: '4 PM-8 PM', at: new Date('2026-07-21T18:00:00+05:30') },
    { label: '8 PM-8 AM', at: new Date('2026-07-21T22:00:00+05:30') },
  ];
  return blocks.map((block) => ({
    block,
    windows: windows.map((window) => {
      const matching = roster.filter((row) => (row.blocks || []).includes(block)
        && isShiftActive(parseShiftWindow(row.shift), window.at));
      const verified = matching.filter((row) => !row.draftOnly && !row.draftFallback);
      const draftFallback = matching.filter((row) => row.draftFallback || row.draftOnly);
      const primary = verified.find((row) => row.assignmentType === 'primary');
      const backup = verified.find((row) => row.assignmentType === 'backup');
      return {
        window: window.label,
        primary: primary?.name || null,
        backup: backup?.name || null,
        fallback: draftFallback.map((row) => row.name),
        status: primary ? 'primary' : backup ? 'backup' : draftFallback.length ? 'draft_fallback_only' : 'gap',
      };
    }),
  }));
}

export function rosterImportPlan({ roster = nimsSupervisorRoster, knownUsersByName = new Map(), blocksByName = new Map() } = {}) {
  const rows = [];
  const unmatchedUsers = [];
  const ambiguousBlocks = [];
  for (const source of roster) {
    const user = knownUsersByName.get(source.name.toLowerCase());
    if (!user) unmatchedUsers.push(source.name);
    for (const block of source.blocks || []) {
      const blockRecord = blocksByName.get(block.toLowerCase());
      if (!blockRecord) ambiguousBlocks.push({ name: source.name, block });
      rows.push({
        sourceName: source.name,
        userId: user?.id || null,
        blockName: block,
        blockId: blockRecord?.id || null,
        shift: parseShiftWindow(source.shift),
        assignmentType: source.assignmentType || 'primary',
        verificationStatus: user && blockRecord && !source.draftOnly && !source.draftFallback ? 'draft' : 'draft',
        isAutoAssignable: false,
        skippedBlocks: source.skippedBlocks || [],
        sourceReference: `Phase 2C provided roster: ${source.responsibility}`,
      });
    }
    for (const skipped of source.skippedBlocks || []) {
      ambiguousBlocks.push({ name: source.name, block: skipped, reason: 'not_selectable_or_ambiguous' });
    }
  }
  return { rows, unmatchedUsers: [...new Set(unmatchedUsers)], ambiguousBlocks };
}
