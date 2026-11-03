import RetailExcelModuleRecords from '../../components/reliance-retail/RetailExcelModuleRecords.jsx';
import {usePageTitle} from '../../hooks/usePageTitle.js';
export default function RetailManpower(){
 usePageTitle('Reliance Retail Manpower');
 return <main className="space-y-4">
  <header><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Reliance Retail</p>
   <h1 className="text-2xl font-bold text-blue-950">Manpower Reports</h1>
   <p className="text-sm text-slate-600">October source records for vacancies and daily manpower shortages. Imported data is read-only and does not alter attendance or salary.</p>
  </header>
  <RetailExcelModuleRecords modules={['manpower_vacancy','shortage']}/>
 </main>;
}
