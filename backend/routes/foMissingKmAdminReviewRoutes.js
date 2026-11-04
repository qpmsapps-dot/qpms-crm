import express from 'express';
import { adminKmApprovalAuthorization } from '../services/foKmRecalculationAuthorizationService.js';

const october = date => String(date || '') >= '2026-10-01' && String(date || '') <= '2026-10-31';
const invalid = (message, statusCode = 422) => Object.assign(new Error(message), { statusCode });

export function createMissingKmAdminReviewRouter({ requireAuth, getClient }) {
  const router = express.Router();
  router.get('/october-missing-km/reviews', requireAuth, async (req, res) => {
    try {
      adminKmApprovalAuthorization(req.profile, req.authUser, 'October missing KM review');
      const client = getClient();
      const { data: attendance, error: ae } = await client.from('fo_attendance')
        .select('id,attendance_date,eligible_km,petrol_amount')
        .gte('attendance_date', '2026-10-01').lte('attendance_date', '2026-10-31').range(0, 2999);
      if (ae) throw ae;
      const attendanceById = new Map((attendance || []).map(a => [a.id, a]));
      const ids = [...attendanceById.keys()];
      if (!ids.length) return res.json({ ok: true, rows: [] });
      const rows = [];
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await client.from('fo_missing_km_reviews')
          .select('id,attendance_id,employee_code,status,review_type,suggested_missing_km,approved_missing_km,checkout_distance_meters,filtered_gps_km,google_route_km,reason_code,requested_clarification,review_remarks')
          .in('attendance_id', ids.slice(i,i+100));
        if (error) throw error;
        rows.push(...(data || []));
      }
      const decisions = [];
      for (let i=0; i<rows.length; i+=100) {
        const { data,error } = await client.from('fo_missing_km_admin_decisions')
          .select('review_id,decision,approved_additional_km,verified_already_included_km,justification,evidence_reference,decided_at')
          .in('review_id', rows.slice(i,i+100).map(r=>r.id));
        if (error) throw error;
        decisions.push(...(data||[]));
      }
      const byReview = new Map(decisions.map(d=>[d.review_id,d]));
      res.json({ok:true, rows:rows.map(r=>({...r,attendance:attendanceById.get(r.attendance_id),admin_decision:byReview.get(r.id)||null})),
        note:'Admin decisions are reconciliation approvals, not posted payable KM.'});
    } catch(error) { res.status(error.statusCode||503).json({ok:false,message:error.statusCode?error.message:'Missing KM reviews unavailable'}); }
  });
  router.post('/october-missing-km/reviews/:id/decision', requireAuth, async (req,res)=>{
    try {
      const actor = adminKmApprovalAuthorization(req.profile, req.authUser, 'October missing KM decision');
      const id = String(req.params.id||'');
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw invalid('Invalid review ID',400);
      const action = String(req.body?.decision||'');
      const km = Number(req.body?.approved_additional_km||0);
      const included = req.body?.verified_already_included_km;
      const justification = String(req.body?.justification||'').trim();
      const evidence = String(req.body?.evidence_reference||'').trim();
      if (!['approved_for_reconciliation','rejected'].includes(action) || !Number.isFinite(km) || km<0 || km>500 || Math.round(km*100)!==km*100 ||
        (action==='rejected'&&km!==0) || (action==='approved_for_reconciliation'&&(km===0||included==null||!Number.isFinite(Number(included))||Number(included)<0)) ||
        justification.length<20 || evidence.length<5) throw invalid('Provide a documented decision, verified included KM and supporting evidence.');
      const client=getClient();
      const {data:review,error:re}=await client.from('fo_missing_km_reviews').select('id,attendance_id,employee_code,suggested_missing_km').eq('id',id).single();
      if(re)throw re;
      const {data:attendance,error:ae}=await client.from('fo_attendance').select('attendance_date').eq('id',review.attendance_id).single();
      if(ae)throw ae;
      if(!october(attendance.attendance_date))throw invalid('Only October 2026 cases are supported.');
      if(action==='approved_for_reconciliation' && km>Number(review.suggested_missing_km||0)) throw invalid('Approved KM exceeds suggested evidence; investigate separately.');
      const {data,error}=await client.from('fo_missing_km_admin_decisions').insert({
        review_id:id,attendance_id:review.attendance_id,employee_code:review.employee_code,
        decision:action,approved_additional_km:km,
        verified_already_included_km:action==='approved_for_reconciliation'?Number(included):null,
        justification,evidence_reference:evidence,approved_by:actor.userId,
      }).select('review_id,decision,approved_additional_km,decided_at').single();
      if(error){if(error.code==='23505')throw invalid('Decision already exists; no duplicate approval was recorded.',409);throw error;}
      res.status(201).json({ok:true,decision:data,posted_to_payable_km:false});
    } catch(error){res.status(error.statusCode||503).json({ok:false,message:error.statusCode?error.message:'Decision could not be recorded; no KM posted'});}
  });
  return router;
}
