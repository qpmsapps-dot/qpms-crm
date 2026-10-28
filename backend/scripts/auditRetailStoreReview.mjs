// Read-only production queries. Writes only a local review report; never stages/imports data.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { parseStoreReview,validateStoreReview,sha256 } from '../services/retailStoreImportValidation.js';
const root=path.resolve(import.meta.dirname,'../..');
dotenv.config({path:path.join(root,'backend/.env'),quiet:true});
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const source=path.resolve(process.argv[2]||path.join(root,'import_sources/Reliance_Retail_Store_Master_Audit_Upload_Review.xlsx'));
const bytes=fs.readFileSync(source);const parsed=parseStoreReview(bytes,path.basename(source));
const stores=[];for(let i=0;;i+=1000){const {data,error}=await db.from('reliance_retail_store_master').select('id,store_code,store_name,state,status').order('id').range(i,i+999);if(error)throw Error(error.message);stores.push(...data);if(data.length<1000)break;}
const {data:aop,error:aopError}=await db.from('retail_attendance_aop_versions').select('*').is('superseded_at',null);if(aopError)throw Error(aopError.message);
const review=validateStoreReview(parsed,stores,{aop});
const phaseEvidence=[];for(const p of ['artifacts/retail-attendance-phase2-20261028/summary.json','artifacts/retail-attendance-phase3-20261028/summary.json','artifacts/retail-attendance-phase4-20261028/analysis-summary.json','artifacts/retail-attendance-phase5-20261028/identity-manifest.json']){const buffer=fs.readFileSync(path.join(root,p));phaseEvidence.push({path:p,sha256:sha256(buffer)});}
const report={checked_at:new Date().toISOString(),mode:'READ_ONLY',source,source_sha256:parsed.checksum,phaseEvidence,canonical:stores,review,
 limitations:['Live SQL migration history, constraints, RLS catalog and function fingerprints require an authorized SQL connection; REST access alone does not verify them.','No production preview/import/recovery RPC invoked.','No approval is inferred from historical readiness or workbook component values.']};
const out=path.join(root,'artifacts/retail-store-aop-upload-20261028');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'read-only-reconciliation.json'),JSON.stringify(report,null,2));
const frequencies={};for(const r of review.rows)for(const i of r.issues)frequencies[i]=(frequencies[i]||0)+1;
console.log(JSON.stringify({source_sha256:parsed.checksum,canonical:stores.length,states:review.states.map(s=>({...s,proposed_new_codes:s.proposed_new_codes.length})),identity_ready:review.identity_ready,aop_ready:review.aop_ready,issue_rows:frequencies},null,2));
