import {useEffect,useState} from 'react';
import {retailUnifiedApi} from '../../services/retailUnifiedApi.js';
import RetailServiceTrackers from './RetailServiceTrackers.jsx';
import FaultTracker from '../FaultTracker.jsx';
export default function RetailOperationalTrackers({kind='OOS'}) {
 const [master,setMaster]=useState(null),[error,setError]=useState(''),[legacy,setLegacy]=useState(false);
 useEffect(()=>{let live=true;retailUnifiedApi.snapshot().then(v=>live&&setMaster(v)).catch(e=>live&&setError(e.response?.data?.message||e.message));return()=>{live=false;};},[]);
 return <section className="space-y-4">{kind==='FAULT'&&<div className="flex gap-3"><button onClick={()=>setLegacy(false)}>Store Fault Registration</button><button onClick={()=>setLegacy(true)}>Historical IFMS tickets</button></div>}{legacy?<FaultTracker retailScope/>:error?<p role="alert">{error}</p>:master?<RetailServiceTrackers key={kind} master={master} initialKind={kind} lockKind/>:<p>Loading authorized Store Master?</p>}</section>;
}
