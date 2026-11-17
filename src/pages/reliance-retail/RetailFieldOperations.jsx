import {useEffect,useState} from 'react';
import {authenticatedApiRequest} from '../../services/api.js';
import {OperationsView} from './RetailHkMisWorkspace.jsx';

export default function RetailFieldOperations(){
 const [report,setReport]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{let active=true;
  authenticatedApiRequest({url:'/api/reliance-retail/field-operations'}).then(response=>{
   if(active){setReport(response.data.report);setError('');}
  }).catch(e=>{if(active){setReport(null);setError(e.response?.data?.message||'Authorized Retail FO operations are unavailable.');}});
  return()=>{active=false;};
 },[refresh]);
 return <section className="space-y-4 p-4"><h1>Reliance Retail Operations</h1>
  <p>Verified South Head geographic scope · Last-known FO locations · Operational view only</p>
  <button onClick={()=>{setReport(null);setError('');setRefresh(v=>v+1);}}>Refresh</button>
  {error&&<p role="alert">{error}</p>}
  {!report&&!error&&<p role="status">Loading authorized Retail operations…</p>}
  {report&&<OperationsView report={report}/>}
 </section>;
}
