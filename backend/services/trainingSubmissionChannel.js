// Enrich only records already admitted by the authoritative reporting contract.
// Never accept a client-supplied channel or classify historical unknown sources.
export function trainingSubmissionChannel(session, events = []) {
  if (session.submission_source === 'Mobile') return 'FO Mobile';
  if (session.submission_source !== 'Web') return 'Unknown';
  return events.some(e => e.training_session_id === session.id &&
    e.event_type === 'management_mobile_created_v3' &&
    e.metadata?.submission_channel === 'Mobile Management') ? 'Mobile Management' : 'Web';
}
export async function withTrainingChannels(client, sessions) {
  const ids = sessions.filter(s => s.submission_source === 'Web').map(s => s.id);
  const events = [];
  for (let start = 0; start < ids.length; start += 100) {
    const {data,error} = await client.from('training_events')
      .select('training_session_id,event_type,metadata').in('training_session_id',ids.slice(start,start+100))
      .eq('event_type','management_mobile_created_v3');
    if (error) throw error; // Missing provenance is an unavailable report, never a guess.
    events.push(...data || []);
  }
  return sessions.map(s => ({...s,submission_channel:trainingSubmissionChannel(s,events)}));
}
