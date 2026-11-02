const fail=(statusCode,message)=>Object.assign(Error(message),{statusCode});
export async function linkedFoCleaningSource(client,profile,scheduleId){
 const {data,error}=await client.rpc('rpc_retail_cleaning_link_source',{p_actor:profile.id,p_schedule:scheduleId});
 if(error){if(error.code==='42501')throw fail(403,'Outside authorized cleaning scope.');throw fail(503,'Verified FO completion evidence is unavailable.');}return data;
}
export async function linkFoCleaning(client,profile,scheduleId,input){
 if(!['ADMIN','QPMSADMIN'].includes(String(profile.role||'').toUpperCase().replace(/[^A-Z0-9]/g,''))||profile.is_active!==true)throw fail(403,'Existing active Admin required to confirm linkage.');
 if(!/^[a-f0-9-]{36}$/i.test(input.source_id||''))throw fail(400,'Existing verified FO submission ID required.');
 const {data,error}=await client.rpc('rpc_retail_cleaning_link_fo',{p_actor:profile.id,p_schedule:scheduleId,p_source:input.source_id});
 if(error)throw fail(error.code==='42501'?403:error.code==='40001'?409:['PGRST202','42883'].includes(error.code)?503:400,error.code==='42501'?'Link is outside authorized schedule/FO scope.':error.code==='PGRST202'?'Verified linking awaits the reviewed database capability.':'Link was not saved: verify approval, exact store/date/FO and stored before/after evidence.');
 return {saved:true,schedule_id:scheduleId,submission_id:data.id};
}
export async function signLinkedFoCleaningEvidence(client,profile,scheduleId){
 const source=await linkedFoCleaningSource(client,profile,scheduleId);if(!source)throw fail(403,'Verified link unavailable.');
 return signVerifiedFoCleaningSource(client,source);
}
export async function signVerifiedFoCleaningSource(client,source,expires=600){
 const bucket='fo-activity-uploads';
 const info=await client.storage.getBucket(bucket);if(info.error||info.data?.public!==false)throw fail(503,'Legacy evidence bucket must be private before report links are issued.');
 const prefix=`${source.employee_code}/${source.deep_cleaning_date}/deep_cleaning/${source.id.slice(3)}/`,uploads=source.uploads||[];
 if(uploads.length>100)throw fail(413,'Too many evidence objects.');
 for(const row of uploads){
  const path=String(row.file_url||'').replace(/^fo-activity-uploads\//,'');
  if(row.storage_bucket!==bucket||!path.startsWith(prefix)||path.split('/').some(p=>['.','..'].includes(p)||p.includes('\\'))||!['image/jpeg','image/png','image/webp'].includes(row.file_type))throw fail(409,'Evidence path is outside this verified submission.');
  // Keep the dedicated Deep Cleaning verifier restricted to its own bucket.
  const slash=path.lastIndexOf('/'),name=path.slice(slash+1);
  const result=await client.storage.from(bucket).list(path.slice(0,slash),{limit:100,search:name});
  if(result.error)throw fail(503,'Stored evidence could not be verified.');
  const object=(result.data||[]).find(item=>item.name===name);
  const size=Number(object?.size??object?.metadata?.size??object?.metadata?.contentLength);
  if(!object||!Number.isFinite(size)||size!==Number(row.file_size))throw fail(409,'Stored evidence is missing or its size no longer matches.');
 }
 return Promise.all(uploads.map(async row=>{const path=row.file_url.slice(bucket.length+1),signed=await client.storage.from(bucket).createSignedUrl(path,expires);if(signed.error)throw signed.error;return {id:row.id,type:row.upload_role==='deep_cleaning_before'?'before':'after',name:row.file_name,mime_type:row.file_type,url:signed.data.signedUrl};}));
}
