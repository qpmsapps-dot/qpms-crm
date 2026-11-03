import { cleaningViewerStoreIds } from './retailCleaningDeliveryService.js';

// Legacy evidence remains in its original tables/bucket. Do not expose global
// visit/profile collections to scope-limited viewers or infer client from a name.
export async function scopedLegacyCleaningRecords(client, profile, options = {}) {
  const stores = await cleaningViewerStoreIds(client, profile, options);
  const submissions = [], uploads = [];
  for (let offset = 0; offset < stores.length; offset += 100) {
    const codes = stores.slice(offset, offset + 100).map(s => s.store_code);
    const { data, error } = await client.from('fo_activity_submissions').select('*').eq('activity_type', 'deep_cleaning').in('store_code', codes).order('submitted_at', { ascending: false }).limit(1000);
    if (error) throw error;
    // Canonical code alone is insufficient when legacy records name another client.
    const safe = (data || []).filter(r => [r.business, r.client_name, r.metadata?.business, r.metadata?.client_name].filter(Boolean).every(v => ['RELIANCE', 'RELIANCERETAIL'].includes(String(v).toUpperCase().replace(/[^A-Z]/g, ''))) && [r.business,r.client_name,r.metadata?.business,r.metadata?.client_name].some(Boolean));
    submissions.push(...safe);
    for (let i = 0; i < safe.length; i += 100) {
      const result = await client.from('fo_activity_uploads').select('*').in('submission_id', safe.slice(i, i + 100).map(r => r.id));
      if (result.error) throw result.error;
      for (const upload of result.data || []) {
        if (upload.storage_bucket !== 'fo-activity-uploads' || !upload.storage_path) continue;
        const signed = await client.storage.from(upload.storage_bucket).createSignedUrl(upload.storage_path, 300);
        if (signed.error) throw signed.error;
        uploads.push({...upload, signed_url:signed.data.signedUrl});
      }
    }
  }
  return {ok:true, submissions, uploads, stores, profiles:[], visits:[]};
}
