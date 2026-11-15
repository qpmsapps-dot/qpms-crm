import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,Download} from 'lucide-react';
import {authenticatedApiRequest} from '../../services/api.js';
import {retailUnifiedApi} from '../../services/retailUnifiedApi.js';
import {collectTrainingExport,indiaMonth,loadMonthlyTrainingExport,trainingExportFilename} from '../../utils/trainingExport.js';
import './trainingExports.css';

// Self-contained controls: existing review export, filters, details and evidence viewer are unchanged.
export default function TrainingExportControls({row,rows=[],snapshot,filter,query,from,to,disabled=false,children}) {
  const [open,setOpen]=useState(false),[month,setMonth]=useState(indiaMonth),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const running=useRef(false);
  const [position,setPosition]=useState(null);
  const toggle=useRef(null),menu=useRef(null),menuId=useId();
  useEffect(()=>{if(open)menu.current?.querySelector('input,button')?.focus();},[open]);
  async function run(format,monthly=false) {
    if(running.current)return;
    running.current=true;setBusy(true);setError('');setMessage('Preparing authorized Training export…');
    try {
      let selected=row?[row]:rows,master=snapshot,range={from,to};
      if(monthly){const result=await loadMonthlyTrainingExport({request:authenticatedApiRequest,loadSnapshot:retailUnifiedApi.snapshot,month,filter,query});selected=result.rows;master=result.snapshot;range=result.range;}
      const data=await collectTrainingExport({rows:selected,snapshot:master,request:authenticatedApiRequest,photos:format==='pptx',onProgress:setMessage});
      const {downloadTrainingExport}=await import('../../utils/trainingExportFiles.js');
      const session=row?data.sessions[0]:null;
      const scopeLabels=[filter?.state&&`State: ${filter.state}`,filter?.class&&`Class: ${filter.class}`,
        filter?.zone&&`Zone: ${master?.zones?.find(z=>z.id===filter.zone)?.zone_name||filter.zone}`,
        filter?.fo&&`FO: ${master?.fos?.find(fo=>fo.id===filter.fo)?.full_name||filter.fo}`,
        filter?.store&&`Store: ${master?.stores?.find(store=>store.id===filter.store)?.store_code||filter.store}`,
        query?.trim()&&`Search: ${query.trim()}`].filter(Boolean);
      await downloadTrainingExport(data,{format,filename:trainingExportFilename({format,month:monthly?month:null,session,...range}),title:row?`${session.trainingClass} Training session`:'HK & MEPC Training',scope:row?`Session ${session.id}`:`${range.from} to ${range.to} (Asia/Kolkata) | ${scopeLabels.length?scopeLabels.join(' | '):'All authorized records'}`});
      setMessage(`Download prepared: ${data.sessions.length} verified session(s).${data.historical.length?` ${data.historical.length} historical source row(s) listed separately.`:''}${data.warnings.length?' Warnings: '+data.warnings.join(' '):''}`);
    }catch(e){setError(e.response?.data?.message||e.message||'Training export failed. Please retry.');setMessage('');}
    finally{running.current=false;setBusy(false);}
  }
  const unavailable=disabled||busy||row?.source_kind==='IFMS_EXCEL';
  return <div className="training-export-control" onKeyDown={e=>{if(e.key==='Escape'&&!busy){setOpen(false);toggle.current?.focus();}}}>
    {children}
    <button ref={toggle} type="button" className="training-export-toggle" aria-label={row?`Download Training session ${row.store?.store_code||row.id}`:'More Training export options'} aria-expanded={open} aria-controls={open?menuId:undefined} disabled={unavailable} title={row?.source_kind==='IFMS_EXCEL'?'Historical source row has no verified session to export':undefined} onClick={e=>{setPosition(e.currentTarget.getBoundingClientRect());setOpen(value=>!value);}}>{row?<Download size={14}/>:<ChevronDown size={14}/>}</button>
    {open&&createPortal(<div id={menuId} ref={menu} className="training-export-menu" role="group" aria-label={row?'Training session exports':'Training report exports'} style={{left:Math.max(20,Math.min((position?.right||320)-300,window.innerWidth-320)),top:Math.max(12,Math.min((position?.bottom||0)+6,window.innerHeight-390))}}>
      {!row&&<label>Export month (Asia/Kolkata)<input aria-label="Training export month" type="month" min="2000-01" max="2100-12" value={month} disabled={busy} onChange={e=>setMonth(e.target.value)}/></label>}
      {row?<><button disabled={busy} onClick={()=>void run('xlsx')}>Export Excel — This Session</button><button disabled={busy} onClick={()=>void run('pptx')}>Export PowerPoint — This Session</button></>:<><button disabled={busy||!month} onClick={()=>void run('xlsx',true)}>Export Excel — Monthly</button><button disabled={busy||!month} onClick={()=>void run('pptx',true)}>Export PowerPoint — Monthly</button><button disabled={busy} onClick={()=>void run('xlsx')}>Export Excel — Current Filtered View</button></>}
      {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
      <button disabled={busy} onClick={()=>{setOpen(false);toggle.current?.focus();}}>Close</button>
    </div>,document.body)}
  </div>;
}
