import express from 'express';
import PDFDocument from 'pdfkit';
import { adminKmApprovalAuthorization } from '../services/foKmRecalculationAuthorizationService.js';

const MONTH_START = '2026-10-01';
const MONTH_END = '2026-10-31';
const STATES = new Set(['AP', 'KA', 'KL', 'TN', 'TG']);
const TN_BUSINESSES = new Set(['Reliance Retail', 'Standalone', 'DME']);
const money = n => Number(n || 0).toFixed(2);
const normalize = s => String(s || '').split(/\s+/).join('').toUpperCase();
const safe = s => String(s ?? '').split(String.fromCharCode(13)).join(' ').split(String.fromCharCode(10)).join(' ').slice(0, 110);
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i*n,(i+1)*n));

async function allRows(client, table, columns, apply = q => q) {
  const rows = [];
  for (let offset = 0; offset < 30000; offset += 1000) {
    const { data, error } = await apply(client.from(table).select(columns).range(offset, offset + 999));
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export function createOctoberClaimsExportRouter({ requireAuth, getClient }) {
  const router = express.Router();
  router.get('/october-2026.pdf', requireAuth, async (req, res) => {
    try {
      adminKmApprovalAuthorization(req.profile, req.authUser, 'October 2026 claims PDF export');
      const state = String(req.query.state || '').trim().toUpperCase();
      const business = String(req.query.business || '').trim();
      const employee = normalize(req.query.employee || '');
      if (state && !STATES.has(state)) return res.status(400).json({ message: 'Invalid state' });
      if (business && !TN_BUSINESSES.has(business) && business.length > 80) return res.status(400).json({ message: 'Invalid business' });
      const client = getClient();
      const [attendances, profiles, adjustments] = await Promise.all([
        allRows(client, 'fo_attendance', 'employee_code,attendance_date,eligible_km,petrol_amount', q => q.gte('attendance_date',MONTH_START).lte('attendance_date',MONTH_END).order('employee_code')),
        allRows(client, 'profiles', 'employee_code,full_name,state,business'),
        allRows(client, 'fo_oct2026_claim_adjustments', 'employee_code,claim_month,adjustment_type,requested_km,status', q => q.eq('claim_month',MONTH_START)),
      ]);
      const profileByCode = new Map();
      for (const p of profiles) {
        const key = normalize(p.employee_code);
        if (key && !profileByCode.has(key)) profileByCode.set(key, p);
      }
      const adjustmentByCode = new Map(adjustments.map(a => [normalize(a.employee_code), a]));
      const byEmployee = new Map();
      for (const a of attendances) {
        const key = normalize(a.employee_code);
        if (!key) continue;
        if (!byEmployee.has(key)) byEmployee.set(key, { key, employee_code: a.employee_code, km: 0, petrol: 0 });
        const row = byEmployee.get(key);
        row.km += Number(a.eligible_km || 0);
        row.petrol += Number(a.petrol_amount || 0);
      }
      // Read-only joined attendance/review/decision view: one row per attendance.
      // Do not add unposted Admin decisions to official or proposed claim KM.
      const reportRows = await allRows(client, 'fo_oct2026_missing_km_report',
        'attendance_id,employee_code,review_cases,pending_cases,clarification_cases,admin_approved_cases,admin_approved_km');
      const reviewByEmployee = new Map();
      for (const rr of reportRows) {
        const key = normalize(rr.employee_code);
        const item = reviewByEmployee.get(key) || { reviews:0, pending:0, clarification:0, approved:0, approvedKm:0 };
        item.reviews += Number(rr.review_cases||0);
        item.pending += Number(rr.pending_cases||0);
        item.clarification += Number(rr.clarification_cases||0);
        item.approved += Number(rr.admin_approved_cases||0);
        item.approvedKm += Number(rr.admin_approved_km||0);
        reviewByEmployee.set(key,item);
      }
      const groups = new Map();
      for (const row of byEmployee.values()) {
        const p = profileByCode.get(row.key) || {};
        const st = String(p.state || 'UNMAPPED').toUpperCase();
        const bs = String(p.business || 'UNMAPPED');
        if (state && st !== state) continue;
        if (business && bs !== business) continue;
        if (employee && !row.key.includes(employee)) continue;
        const a = adjustmentByCode.get(row.key);
        const original = Number(row.km.toFixed(2));
        const proposed = a?.adjustment_type === 'SET_TOTAL' ? Number(a.requested_km)
          : a?.adjustment_type === 'ADD_KM' ? original + Number(a.requested_km) : original;
        const groupKey = st === 'TN' ? st + ' / ' + bs : st;
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push({ ...row, name: p.full_name || '', original, proposed, status: a?.status || 'NO ADJUSTMENT', review: reviewByEmployee.get(row.key) || { reviews:0,pending:0,clarification:0,approved:0,approvedKm:0 } });
      }
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 35, bufferPages: true });
      res.type('application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="QPMS_Oct2026_Consolidated_Claims.pdf"');
      doc.pipe(res);
      const drawHeader = (group, page) => {
        doc.font('Helvetica-Bold').fontSize(16).text('QPMS | CONSOLIDATED TRAVEL CLAIMS',35,28);
        doc.font('Helvetica').fontSize(10).text('October 01–31, 2026   |   ' + safe(group) + '   |   Page ' + page,35,52);
        doc.fontSize(9).text('Provisional claims export — adjustments are NOT posted to official payable KM.',35,69);
        doc.moveTo(35,88).lineTo(807,88).strokeColor('#999').stroke();
        doc.font('Helvetica-Bold').fontSize(9);
        const cols = [[35,'Employee Code'],[155,'Employee Name'],[345,'Original KM'],[440,'Proposed KM'],[545,'Difference KM'],[650,'Original Petrol'],[745,'Status']];
        for (const [x,t] of cols) doc.text(t,x,98,{width:x===155?185:110});
      };
      if (!groups.size) {
        drawHeader('No matching records',1);
        doc.font('Helvetica').text('No October attendance records match the selected filters.',35,135);
      }
      let first = true;
      for (const [group, records] of [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]))) {
        records.sort((a,b)=>a.employee_code.localeCompare(b.employee_code));
        const pages = chunks(records, 23);
        for (let i=0;i<pages.length;i++) {
          if (!first) doc.addPage();
          first=false;
          drawHeader(group,i+1);
          let y=124;
          doc.font('Helvetica').fontSize(8);
          for (const r of pages[i]) {
            const values = [[35,r.employee_code,115],[155,r.name,185],[345,money(r.original),90],[440,money(r.proposed),95],[545,money(r.proposed-r.original),100],[650,money(r.petrol),90],[745,r.status,65]];
            for (const [x,v,w] of values) doc.text(safe(v),x,y,{width:w,ellipsis:true,lineBreak:false});
            y+=21;
            doc.moveTo(35,y-6).lineTo(807,y-6).strokeColor('#e5e7eb').stroke();
          }
          if (i===pages.length-1) {
            const reviewTotals = records.reduce((n,r)=>({
              reviews:n.reviews+r.review.reviews,
              pending:n.pending+r.review.pending,
              clarification:n.clarification+r.review.clarification,
              approved:n.approved+r.review.approved,
              approvedKm:n.approvedKm+r.review.approvedKm,
            }),{reviews:0,pending:0,clarification:0,approved:0,approvedKm:0});
            doc.font('Helvetica').fontSize(9).text(
              'Missing KM review cases: ' + reviewTotals.reviews +
              ' | Pending: ' + reviewTotals.pending +
              ' | Clarification: ' + reviewTotals.clarification +
              ' | Admin approved: ' + reviewTotals.approved +
              ' (' + money(reviewTotals.approvedKm) + ' KM, not posted)',35,y+30);

            doc.font('Helvetica-Bold').fontSize(10).text(
              'Group totals: Original ' + money(records.reduce((n,r)=>n+r.original,0)) +
              ' KM  |  Proposed ' + money(records.reduce((n,r)=>n+r.proposed,0)) +
              ' KM  |  Original Petrol INR ' + money(records.reduce((n,r)=>n+r.petrol,0)),35,y+10);
          }
        }
      }
      doc.end();
    } catch (error) {
      if (res.headersSent) return res.destroy(error);
      res.status(error.statusCode || (error.code === '42501' ? 403 : 503)).json({
        ok: false, message: error.statusCode === 403 || error.code === '42501'
          ? 'Admin access required' : 'October PDF export unavailable; no financial data was changed.',
      });
    }
  });
  return router;
}
