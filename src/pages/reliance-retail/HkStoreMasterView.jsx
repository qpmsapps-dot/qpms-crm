import { useEffect, useMemo, useState } from 'react';
import { authenticatedApiRequest } from '../../services/api.js';
import { usePageTitle } from '../../hooks/usePageTitle.js';

const columns=[['store_code','Store Code'],['store_name','Store Name'],['state','State'],['city','City'],['store_format','Format'],['zone_name','Zone'],['current_responsible_fo_employee_code','FO'],['hk_aop','HK AOP'],['status','Status']];
const getValue=(row,key)=>key==='hk_aop'?(row.aop_conflict?'Conflict':row.hk_aop??'Pending'):(row[key]??'—');
const control='rounded-lg border bg-white px-3 py-2 text-sm dark:bg-slate-800';
export default function HkStoreMasterView(){
  usePageTitle('Reliance Retail Store Master');
  const [report,setReport]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[refresh,setRefresh]=useState(0);
  const [search,setSearch]=useState(''),[state,setState]=useState(''),[status,setStatus]=useState(''),[zone,setZone]=useState(''),[fo,setFo]=useState(''),[pending,setPending]=useState(false),[selected,setSelected]=useState(null),[page,setPage]=useState(1);
  useEffect(()=>{let alive=true;authenticatedApiRequest({url:'/api/reliance-retail/mis/hk-store-master'}).then(r=>{if(alive){setReport(r.data.result);setError('');}}).catch(e=>{if(alive){setReport(null);setError(e.response?.data?.message||e.message);}}).finally(()=>{if(alive)setBusy(false);});return()=>{alive=false;};},[refresh]);
  const all=useMemo(()=>report?.rows||[],[report]);
  const scoped=useMemo(()=>all.filter(r=>!state||r.state===state),[all,state]);
  const filtered=useMemo(()=>scoped.filter(r=>(!status||r.status===status)&&(!zone||(r.zone_name||'Unassigned')===zone)&&(!fo||(r.current_responsible_fo_employee_code||'Unassigned')===fo)&&(!pending||r.hk_aop==null)&&(!search||[r.store_code,r.store_name].some(v=>String(v||'').toLowerCase().includes(search.toLowerCase().trim())))),[scoped,status,zone,fo,pending,search]);
  const active=scoped.filter(r=>r.status==='Active');
  const metrics=[['Total Stores',scoped.length],['Active',active.length],['Inactive',scoped.filter(r=>r.status==='Inactive').length],['Known active HK AOP',active.reduce((sum,r)=>sum+Number(r.hk_aop??0),0)],['Active AOP Pending',active.filter(r=>r.hk_aop==null).length],['Active FO Mapping Pending',active.filter(r=>!r.current_responsible_fo_employee_code).length]];
  function change(setter,value){setter(value);setPage(1);setSelected(null);}
  async function download(){try{const {default:ExcelJS}=await import('exceljs');const {downloadUnified}=await import('../../utils/retailUnifiedExport.js');const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Store Master');sheet.addRow(columns.map(c=>c[1]));filtered.forEach(r=>sheet.addRow(columns.map(([k])=>getValue(r,k))));await downloadUnified(book,'Reliance_Retail_HK_Store_Master.xlsx');}catch(e){setError(e.message);}}
  return <section className="space-y-4 p-4">
    <header><p className="text-sm font-bold text-blue-600">Reliance Retail</p><h1 className="text-2xl font-bold">Store Master</h1><p className="text-sm text-slate-500">Assigned states only · View and download · As of {report?.as_of||'—'}</p></header>
    {error&&<p role="alert" className="text-red-700">{error}</p>}
    {busy&&<p role="status">Loading Store Master…</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{metrics.map(([label,value])=><article key={label} className="rounded-xl border p-4"><p className="text-sm text-slate-500">{label}</p><b className="text-xl">{report?value:'—'}</b></article>)}</div>
    <div className="flex flex-wrap gap-2">
      <input aria-label="Search stores" placeholder="Store code or name" className={control} value={search} onChange={e=>change(setSearch,e.target.value)}/>
      <select aria-label="State" className={control} value={state} onChange={e=>{change(setState,e.target.value);setZone('');setFo('');}}><option value="">All assigned states</option>{(report?.states||[]).map(s=><option key={s}>{s}</option>)}</select>
      <select aria-label="Status" className={control} value={status} onChange={e=>change(setStatus,e.target.value)}><option value="">All statuses</option><option>Active</option><option>Inactive</option></select>
      {[[zone,setZone,'Zone','zone_name'],[fo,setFo,'FO','current_responsible_fo_employee_code']].map(([value,setter,label,key])=><select key={key} aria-label={label} className={control} value={value} onChange={e=>change(setter,e.target.value)}><option value="">All {label}</option>{[...new Set(scoped.map(r=>r[key]||'Unassigned'))].sort().map(v=><option key={v}>{v}</option>)}</select>)}
      <label className={control}><input type="checkbox" checked={pending} onChange={e=>change(setPending,e.target.checked)}/> HK AOP pending</label>
      <button className={control} disabled={busy} onClick={()=>{setBusy(true);setSelected(null);setReport(null);setPage(1);setRefresh(x=>x+1);}}>Refresh</button>
      <button className={control} disabled={busy||!report} onClick={download}>Export Excel</button>
    </div>
    <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm"><thead><tr>{columns.map(([k,l])=><th className="p-3 text-left" key={k}>{l}</th>)}<th className="p-3">Details</th></tr></thead><tbody>{filtered.slice((page-1)*50,page*50).map(r=><tr className="border-t" key={r.id}>{columns.map(([k])=><td className="p-3" key={k}>{getValue(r,k)}</td>)}<td className="p-3"><button className="text-blue-600" onClick={()=>setSelected(r)}>View</button></td></tr>)}</tbody></table></div>
    <div className="flex items-center justify-between text-sm"><span>{filtered.length} stores</span><div><button className={control} disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</button> Page {page} <button className={control} disabled={page*50>=filtered.length} onClick={()=>setPage(p=>p+1)}>Next</button></div></div>
    {selected&&<section className="rounded-xl border p-4"><button className={control} onClick={()=>setSelected(null)}>Close details</button><h2 className="font-bold">{selected.store_code} — {selected.store_name}</h2><h3>HK AOP history</h3>{!selected.aop_history?.length&&<p>No HK AOP recorded.</p>}<ul>{selected.aop_history?.map((h,i)=><li key={i}>{h.effective_from} to {h.effective_to||'open'}: {h.hk_count??'Pending'} {h.superseded_at?'(superseded)':''}</li>)}</ul></section>}
  </section>;
}
