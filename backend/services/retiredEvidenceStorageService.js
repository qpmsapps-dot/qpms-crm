import {withCombinedReleaseOperation} from './combinedReleaseGate.js';
// A database retirement is permanent: triggers prohibit this path from ever
// becoming evidence again. A stale/retried cleanup can therefore only remove an
// abandoned object, even when another request recreates an upload intent.
export async function removeRetiredEvidenceObject(client, {bucket, path, evidenceId, parentId, ownerId}) {
  const {data: retired, error} = await client.from('evidence_storage_retirements')
    .select('bucket,path,evidence_id,parent_id,owner_id')
    .eq('bucket',bucket).eq('path',path).maybeSingle();
  if(error) throw error;
  if(!retired || retired.bucket!==bucket || retired.path!==path || retired.evidence_id!==evidenceId || retired.parent_id!==parentId || retired.owner_id!==ownerId) {
    throw Object.assign(new Error('Evidence retirement is not confirmed; storage retained.'),{statusCode:409,code:'evidence_retirement_unconfirmed'});
  }
  // The committed tombstone above remains mandatory. Normal Cleaning/Training
  // cleanup is independent of release admission; other buckets keep their gate.
  const remove=()=>client.storage.from(bucket).remove([path]);
  const result=['client-deep-cleaning-uploads','training-evidence'].includes(bucket)
    ? await remove()
    : await withCombinedReleaseOperation(client,ownerId,'storage:retired-evidence-delete',remove);
  if(result.error) throw Object.assign(new Error('Evidence reference retired; storage cleanup can be retried safely.'),{statusCode:409,code:'storage_delete_failed'});
}
