import {usePageTitle} from '../../hooks/usePageTitle.js';
import RetailImportedHistory from '../../components/reliance-retail/RetailImportedHistory.jsx';
export default function RetailManpowerHistory(){
 usePageTitle('Reliance Retail Manpower Vacancy & Shortage');
 return <section className="space-y-4 p-3 md:p-5" aria-label="Reliance Retail manpower">
  <header className="rounded-xl border border-slate-200 bg-white p-4"><h1 className="text-lg font-bold text-slate-900">Manpower Vacancy & Shortage</h1>
   <p className="text-sm text-slate-600">October 2026 Store-wise Excel source register. Historical reported figures; no staff deployment or joining is created.</p></header>
  <RetailImportedHistory module="manpower_vacancy" title="Manpower Vacancy"/>
  <RetailImportedHistory module="shortage" title="Manpower Shortage"/>
 </section>;
}
