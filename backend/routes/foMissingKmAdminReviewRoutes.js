import express from 'express';
import {adminKmApprovalAuthorization} from '../services/foKmRecalculationAuthorizationService.js';
import {OCTOBER_START,OCTOBER_END,octoberError,hundredths,octoberReviewRows} from '../services/foOctoberClaimsService.js';
const editable=new Set(['pending','clarification_required']);
export function createMissingKmAdminReviewRouter({requireAuth,getClient}){
 const router=express.Router();
 router.get('/october-missing-km/reviews',requireAuth,async(req,res)=>{
  try{
   adminKmApprovalAuthorization(req.profile,req.authUser,'October missing KM review');
   const rows=await octoberReviewRows(getClient());
   res.json({ok:true,rows,note:'Admin decisions are reconciliation approvals, not posted payable KM.'});
  }catch(error){res.status(error.statusCode||503).json({ok:false,message:error.statusCode?error.message:'Missing KM reviews unavailable'});}
 });
 router.post('/october-missing-km/reviews/:id/decision',requireAuth,async(req,res)=>{
  try{
   const actor=adminKmApprovalAuthorization(req.profile,req.authUser,'October missing KM decision');
   const id=String(req.params.id||'');
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw octoberError('Invalid review ID',400);
   const body=req.body||{},action=body.decision;
   if(!['approved_for_reconciliation','rejected'].includes(action))throw octoberError('Invalid decision.');
   const km=hundredths(body.approved_additional_km);
   const included=action==='approved_for_reconciliation'?hundredths(body.verified_already_included_km,'Verified included KM'):null;
   const justification=typeof body.justification==='string'?body.justification.trim():'';
   const evidence=typeof body.evidence_reference==='string'?body.evidence_reference.trim():'';
   if(km>50000||(action==='rejected'&&km!==0)||(action==='approved_for_reconciliation'&&km===0)||justification.length<20||justification.length>2000||evidence.length<5||evidence.length>500)throw octoberError('Provide a documented decision, valid KM, justification (20-2000 characters) and evidence reference (5-500 characters).');
   const client=getClient();
   const {data:review,error:re}=await client.from('fo_missing_km_reviews').select('id,attendance_id,employee_code,status,suggested_missing_km').eq('id',id).maybeSingle();
   if(re)throw re;if(!review)throw octoberError('Review not found.',404);
   if(!editable.has(review.status))throw octoberError('The original review is already resolved.',409);
   const {data:attendance,error:ae}=await client.from('fo_attendance').select('attendance_date,eligible_km').eq('id',review.attendance_id).single();
   if(ae)throw ae;
   if(attendance.attendance_date<OCTOBER_START||attendance.attendance_date>OCTOBER_END)throw octoberError('Only October 2026 cases are supported.');
   if(action==='approved_for_reconciliation'&&(km>hundredths(review.suggested_missing_km)||included>hundredths(attendance.eligible_km??0)))throw octoberError('Approved KM exceeds suggested evidence or verified included KM exceeds existing payable KM.');
   const {data,error}=await client.from('fo_missing_km_admin_decisions').insert({review_id:id,attendance_id:review.attendance_id,employee_code:review.employee_code,decision:action,approved_additional_km:km/100,verified_already_included_km:included==null?null:included/100,justification,evidence_reference:evidence,approved_by:actor.userId}).select('review_id,decision,approved_additional_km,decided_at').single();
   if(error){if(error.code==='23505')throw octoberError('Decision already exists; no duplicate approval was recorded.',409);if(['23514','P0001'].includes(error.code))throw octoberError('Review evidence changed or decision is invalid; refresh and review again.',409);throw error;}
   res.status(201).json({ok:true,decision:data,posted_to_payable_km:false});
  }catch(error){res.status(error.statusCode||503).json({ok:false,message:error.statusCode?error.message:'Decision could not be recorded; no KM posted'});}
 });
 return router;
}
