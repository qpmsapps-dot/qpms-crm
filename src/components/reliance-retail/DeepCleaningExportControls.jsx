import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,Download} from 'lucide-react';
import {authenticatedApiRequest} from '../../services/api.js';
import {indiaMonth,loadCleaningExport,collectCleaningExport,cleaningExportFilename} from '../../utils/deepCleaningExport.js';
import './trainingExports.css';

export default function DeepCleaningExportControls({row,from,to,state,store,status,query,disabled=false,children}) {
  const [open,setOpen]=useState(false),[month,setMonth]=useState(indiaMonth),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[position,setPosition]=useState(null);
  const running=useRef(false),toggle=useRef(null),menu=useRef(null),menuId=useId();
  useEffect(()=>{if(open)menu.current?.querySelector('input,button')?.focus();},[open]);
  async function run(format,monthly=false) {
    if(running.current)return;
    running.current=true;setBusy(true);setError('');setMessage('Preparing authorized Deep Cleaning export...');
    try {
      const loaded=await loadCleaningExport({request:authenticatedApiRequest,month:monthly?month:null,from,to,filter:{state,store,status,query},row});
      const data=await collectCleaningExport({...loaded,request:authenticatedApiRequest,photos:format==='pptx',onProgress:setMessage});
      const {downloadCleaningExport}=await import('../../utils/deepCleaningExportFiles.js');
      const record=row?data.records[0]:null;
      const scope=[`${loaded.range.from} to ${loaded.range.to} (Asia/Kolkata)`,state&&`State: ${state}`,store&&`Store ID: ${store}`,status&&`Status: ${status}`,query?.trim()&&`Search: ${query.trim()}`].filter(Boolean).join(' | ');
      await downloadCleaningExport(data,{format,filename:cleaningExportFilename({format,month:monthly?month:null,range:loaded.range,record}),title:row?'Deep Cleaning submission':'Reliance Retail - Deep Cleaning',scope});
      setMessage(`Download prepared: ${data.records.length} persisted submission(s).${data.warnings.length?' Warnings: '+data.warnings.join(' '):''}`);
    }catch(e){setError(e.response?.data?.message||e.message||'Cleaning export failed. Please retry.');setMessage('');}
    finally{running.current=false;setBusy(false);}
  }
  return <div className="training-export-control" onKeyDown={e=>{if(e.key==='Escape'&&!busy){setOpen(false);toggle.current?.focus();}}}>
    {children}
    <button ref={toggle} type="button" className="training-export-toggle" aria-label={row?`Download cleaning submission ${row.store?.store_code||row.id}`:'More Deep Cleaning export options'} aria-expanded={open} aria-controls={open?menuId:undefined} disabled={disabled||busy} onClick={e=>{setPosition(e.currentTarget.getBoundingClientRect());setOpen(v=>!v);}}>{row?<Download size={14}/>:<ChevronDown size={14}/>}</button>
    {open&&createPortal(<div id={menuId} ref={menu} className="training-export-menu" role="group" aria-label={row?'Cleaning submission exports':'Deep Cleaning report exports'} style={{left:Math.max(20,Math.min((position?.right||320)-300,window.innerWidth-320)),top:Math.max(12,Math.min((position?.bottom||0)+6,window.innerHeight-390))}}>
      {!row&&<label>Export month (Asia/Kolkata)<input aria-label="Deep Cleaning export month" type="month" min="2000-01" max="2100-12" value={month} disabled={busy} onChange={e=>setMonth(e.target.value)}/></label>}
      {row?<><button disabled={busy} onClick={()=>void run('xlsx')}>Export Excel — This Submission</button><button disabled={busy} onClick={()=>void run('pptx')}>Export PowerPoint — This Submission</button></>:<><button disabled={busy||!month} onClick={()=>void run('xlsx',true)}>Export Excel — Monthly</button><button disabled={busy||!month} onClick={()=>void run('pptx',true)}>Export PowerPoint — Monthly</button><button disabled={busy} onClick={()=>void run('xlsx')}>Export Excel — Current Filtered View</button></>}
      {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
      <button disabled={busy} onClick={()=>{setOpen(false);toggle.current?.focus();}}>Close</button>
    </div>,document.body)}
  </div>;
}
