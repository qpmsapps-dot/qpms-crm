import { createHash } from 'node:crypto';
import XLSX from 'xlsx';
import { validateExcelContainer, attendanceError } from './retailAttendanceService.js';
import { storeKey, stateLabel, reportingState, validDate, indiaToday } from '../shared/retailAttendance.js';
import { STORE_IDENTITY_REVIEW_EVIDENCE } from '../shared/retailStoreReviewEvidence.js';

export const REVIEW_HEADERS = Object.freeze(['Site Code', 'Store Name / Location', 'City', 'Geographic State', 'Reporting State', 'Format', 'HK Staff', 'HK Supervisor', 'MEPC Shared', 'MEPC Supervisor', 'MEPC Stationed', 'Budget Start', 'Budget End', 'Source Sheet Row', 'Conflict / Closed Evidence', 'Audit Status', 'Approved (YES/NO)', 'Approval Ref', 'Reviewer Notes']);
const text = value => String(value ?? '').trim();
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const geography = value => { const key = stateLabel(value); return key === 'KN' ? 'KA' : key; };
const regions = new Set(['TN', 'PY', 'KA', 'KL', 'TG', 'AP-1', 'AP-2']);
const overlaps = (a, b) => a.effective_from <= (b.effective_to || '9999-12-31') && b.effective_from <= (a.effective_to || '9999-12-31');

// The review template is evidence, never an authority to activate a store or AOP.
export function parseStoreReview(bytes, filename) {
  validateExcelContainer(bytes, filename);
  let book;
  try { book = XLSX.read(bytes, { type: 'buffer', cellFormula: true }); }
  catch { throw attendanceError(400, 'Store review workbook cannot be read.'); }
  const sheet = book.Sheets['STORE UPLOAD REVIEW'];
  if (!sheet?.['!ref']) throw attendanceError(400, 'Missing STORE UPLOAD REVIEW worksheet.');
  const range = XLSX.utils.decode_range(sheet['!ref']);
  if (range.e.r > 10000 || range.e.c > 100) throw attendanceError(400, 'Store review exceeds 10,000 rows or 101 columns.');
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true });
  const headers = grid[0].map(text);
  if (REVIEW_HEADERS.some(h => headers.filter(v => v === h).length !== 1)) throw attendanceError(400, 'Store review headers are missing or duplicated. Use the approved review template.');
  const indexes = REVIEW_HEADERS.map(h => headers.indexOf(h));
  const rows = [];
  for (let r = 1; r < grid.length; r++) {
    if (grid[r].every(v => v === '')) continue;
    const raw = {};
    for (let i = 0; i < REVIEW_HEADERS.length; i++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: indexes[i] })];
      if (cell?.f || cell?.t === 'e') throw attendanceError(400, `Formula or cell error in review field at row ${r + 1}. Upload reviewed literal values.`);
      raw[REVIEW_HEADERS[i]] = grid[r][indexes[i]];
      if (REVIEW_HEADERS[i] === 'Site Code' && cell?.t === 'n') {
        if (!Number.isSafeInteger(cell.v) || cell.v < 0 || cell.v >= 1e15) throw attendanceError(400, `Unsafe numeric Store Code at row ${r + 1}; use literal text.`);
        raw['Site Code'] = XLSX.utils.format_cell(cell);
      }
    }
    // Bind approvals to the complete literal row and exact original workbook.
    const source_row = r + 1;
    const date = value => {
      if (typeof value !== 'number') return text(value);
      const d = XLSX.SSF.parse_date_code(value, { date1904: !!book.Workbook?.WBProps?.date1904 });
      return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : '';
    };
    rows.push({ source_row, row_digest: sha256(JSON.stringify(raw)), raw,
      store_code: storeKey(raw['Site Code']), store_name: text(raw['Store Name / Location']), city: text(raw.City),
      state: geography(raw['Geographic State']), reporting_state: reportingState(raw['Reporting State']),
      store_format: text(raw.Format), effective_from: date(raw['Budget Start']), effective_to: date(raw['Budget End']),
      source_reference: text(raw['Source Sheet Row']), conflict_evidence: text(raw['Conflict / Closed Evidence']),
      audit_status: text(raw['Audit Status']), approval: storeKey(raw['Approved (YES/NO)']), approval_ref: text(raw['Approval Ref']),
      components: Object.fromEntries(['HK Staff', 'HK Supervisor', 'MEPC Shared', 'MEPC Supervisor', 'MEPC Stationed'].map(k => [k, raw[k]])),
    });
  }
  if (!rows.length) throw attendanceError(400, 'No store review rows found.');
  return { checksum: sha256(bytes), sheet: 'STORE UPLOAD REVIEW', headers, rows };
}

// decisions must come from a server-controlled approval registry, never request JSON.
// Identity and AOP use separate scoped approvals and separate readiness results.
export function validateStoreReview(parsed, stores, { decisions = [], aop = [], today = indiaToday(), evidence = STORE_IDENTITY_REVIEW_EVIDENCE } = {}) {
  validDate(today);
  const canonical = new Map();
  for (const s of stores) {
    const key = storeKey(s.store_code);
    if (canonical.has(key)) throw attendanceError(409, 'Duplicate normalized canonical Store Codes. Import is blocked.');
    canonical.set(key, s);
  }
  const counts = new Map();
  for (const r of parsed.rows) counts.set(r.store_code, (counts.get(r.store_code) || 0) + 1);
  const results = parsed.rows.map(row => {
    const issues = [];
    const existing = canonical.get(row.store_code);
    if (!row.store_code) issues.push('MISSING_STORE_CODE');
    if (/[\s/,;|]/.test(row.store_code)) issues.push('COMPOSITE_OR_AMBIGUOUS_STORE_CODE');
    if (!row.store_name) issues.push('MISSING_STORE_NAME');
    if (!regions.has(row.state)) issues.push('INVALID_GEOGRAPHY');
    if (row.reporting_state !== reportingState(row.state)) issues.push('REPORTING_STATE_CONFLICT');
    if (counts.get(row.store_code) > 1) issues.push('DUPLICATE_UPLOAD_CODE');
    if (row.conflict_evidence) issues.push('SOURCE_CONFLICT_REQUIRES_REVIEW');
    if (/CLOSED|INACTIVE|STOPPED/i.test(`${row.conflict_evidence} ${row.audit_status}`)) issues.push('CLOSED_INACTIVE_EVIDENCE');
    if (existing && geography(existing.state) !== row.state) issues.push('CANONICAL_GEOGRAPHY_CONFLICT');
    if (existing && storeKey(existing.store_name) !== storeKey(row.store_name)) issues.push('CANONICAL_NAME_CONFLICT');
    if (existing && storeKey(existing.status) !== 'ACTIVE') issues.push('CANONICAL_INACTIVE');
    for (const e of evidence.filter(e => storeKey(e.store_code) === row.store_code)) {
      if (e.issue) issues.push(e.issue);
    }
    let periodValid = true;
    try { validDate(row.effective_from); validDate(row.effective_to); if (row.effective_to < row.effective_from) throw Error(); }
    catch { periodValid = false; issues.push('INVALID_BUDGET_PERIOD'); }
    if (periodValid && row.effective_to < today) issues.push('EXPIRED_BUDGET_PERIOD');
    if (Object.values(row.components).some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) issues.push('INVALID_AOP_COMPONENT');
    if (row.approval !== 'YES') issues.push('PENDING_WORKBOOK_APPROVAL');
    if (!row.approval_ref) issues.push('MISSING_APPROVAL_REFERENCE');
    const approved = kind => decisions.filter(d => d.kind === kind && d.status === 'APPROVED' && d.file_sha256 === parsed.checksum &&
      d.row_digest === row.row_digest && d.source_row === row.source_row && d.store_code === row.store_code &&
      d.approval_ref === row.approval_ref && d.reviewer_id && /^[a-f0-9]{64}$/.test(d.evidence_sha256 || '') &&
      d.approved_at && Number.isFinite(Date.parse(d.approved_at)) && Date.parse(d.approved_at) <= Date.parse(`${today}T23:59:59+05:30`) &&
      (!d.valid_until || d.valid_until >= today));
    const identity = approved('identity'); const allocations = approved('aop');
    const commonBlocked = issues.some(i => !['INVALID_BUDGET_PERIOD', 'EXPIRED_BUDGET_PERIOD', 'INVALID_AOP_COMPONENT'].includes(i));
    // Existing identities are preserved even if the workbook claims approval.
    const identityReady = !existing && !commonBlocked && identity.length === 1 && identity[0].state === row.state &&
      identity[0].store_name === row.store_name && ['Active', 'Inactive'].includes(identity[0].store_status) &&
      (identity[0].operational_model === 'IDENTITY_ONLY' || identity[0].operational_model === 'SUPERVISOR_ONLY' && !!text(identity[0].supervisor_name));
    const d = allocations.length === 1 ? allocations[0] : null;
    let aopReady = false;
    if (d && existing && storeKey(existing.status) === 'ACTIVE' && !commonBlocked) {
      try {
        validDate(d.effective_from); validDate(d.effective_to);
        aopReady = d.effective_from <= d.effective_to && d.effective_to >= today &&
          ['hk_count', 'mepc_count'].every(k => typeof d[k] === 'number' && Number.isFinite(d[k]) && d[k] >= 0) &&
          d.state === row.state && d.retail_store_id === existing.id;
        if (aop.some(a => a.retail_store_id === existing.id && !a.superseded_at && overlaps(d, a))) { issues.push('OVERLAPPING_AOP'); aopReady = false; }
      } catch { issues.push('INVALID_APPROVED_AOP_PERIOD'); }
    }
    return { ...row, canonical_id: existing?.id || null, canonical_state: existing?.state || null,
      identity_action: existing ? 'PRESERVE_EXISTING' : identityReady ? 'APPROVED_CANDIDATE' : 'PENDING',
      aop_action: aopReady ? 'APPROVED_CANDIDATE' : 'PENDING', issues: [...new Set(issues)],
      identity_decision_id: identityReady ? identity[0].id : null, aop_decision_id: aopReady ? d.id : null };
  });
  const states = [...regions].map(state => {
    const rows = results.filter(r => r.state === state);
    return { state, reporting_state: reportingState(state), existing: stores.filter(s => geography(s.state) === state).length,
      uploaded_rows: rows.length, unique_upload_codes: new Set(rows.map(r => r.store_code).filter(Boolean)).size,
      existing_matches: new Set(rows.filter(r => r.canonical_id).map(r => r.store_code)).size,
      proposed_new_codes: [...new Set(rows.filter(r => !r.canonical_id).map(r => r.store_code).filter(Boolean))].sort(),
      approved_identity_rows: rows.filter(r => r.identity_action === 'APPROVED_CANDIDATE').length,
      approved_aop_rows: rows.filter(r => r.aop_action === 'APPROVED_CANDIDATE').length };
  });
  return { checksum: parsed.checksum, total_rows: results.length, canonical_count: stores.length, states, rows: results,
    unknown_state_rows: results.filter(r => !regions.has(r.state)).length,
    identity_ready: results.filter(r => r.identity_action === 'APPROVED_CANDIDATE').length,
    aop_ready: results.filter(r => r.aop_action === 'APPROVED_CANDIDATE').length };
}
