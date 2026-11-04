import {usePageTitle} from '../../hooks/usePageTitle.js';
import RetailImportedHistory from '../../components/reliance-retail/RetailImportedHistory.jsx';
import RetailStatePerformance from '../../components/reliance-retail/RetailStatePerformance.jsx';
import {useRetailExcelRows} from '../../utils/useRetailExcelRows.js';
import {summarizeStateRows} from '../../utils/retailStatePerformance.js';

export default function RetailManpowerHistory(){
 usePageTitle('Reliance Retail Manpower Vacancy & Shortage');
 const vacancy=useRetailExcelRows('manpower_vacancy');
 const shortage=useRetailExcelRows('shortage');
 const all=[...vacancy.rows.map(r=>({...r,source_module:'vacancy'})),
  ...shortage.rows.map(r=>({...r,source_module:'shortage'}))];
 const summary=summarizeStateRows(all,row=>({
  entries:1,
  vacancies:row.source_module==='vacancy'?Number(row.data?.vacant_count||1):0,
  shortage:row.source_module==='shortage'?Number(row.data?.total_shortage||0):0
 }));
 return <section className="space-y-4 p-3 md:p-5" aria-label="Reliance Retail manpower">
  <header className="rounded-xl border border-slate-200 bg-white p-4"><h1 className="text-lg font-bold text-slate-900">Manpower — state-wise report</h1>
   <p className="text-sm text-slate-600">October 2026 Excel-reported vacancies and manpower shortages. Actual employee joining and deployment remain separate.</p></header>
  <RetailStatePerformance title="State-wise manpower status" summary={summary}
   columns={[{key:'shortage',label:'Reported shortage'},{key:'vacancies',label:'Vacant positions'},
    {key:'entries',label:'Source records'}]}
   note="Source: 28 October Excel snapshot. These are reported shortages and vacancies, not verified attendance or newly approved headcount."/>
  {(vacancy.loading||shortage.loading)&&<p role="status">Loading October manpower source rows…</p>}
  {(vacancy.error||shortage.error)&&<p role="alert">October manpower data unavailable: {vacancy.error||shortage.error}</p>}
  <h2 className="text-base font-bold text-slate-900">Store-wise manpower details</h2>
  <RetailImportedHistory module="manpower_vacancy" title="Manpower Vacancy"/>
  <RetailImportedHistory module="shortage" title="Manpower Shortage"/>
 </section>;
}
