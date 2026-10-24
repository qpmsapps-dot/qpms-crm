import { Construction } from 'lucide-react';
import { usePageTitle } from '../../hooks/usePageTitle.js';

export default function RetailComingSoon({ title }) {
  usePageTitle(`Reliance Retail — ${title}`);
  return <div className="space-y-6">
    <div><p className="text-sm font-bold text-qpms-600">Reliance Retail</p><h1 className="text-2xl font-black text-slate-950">{title}</h1></div>
    <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-sm">
      <Construction className="mx-auto h-10 w-10 text-amber-500" />
      <h2 className="mt-4 text-lg font-black">Under Development</h2>
      <p className="mt-2 text-sm font-semibold text-slate-500">No synthetic data or placeholder workflow has been created.</p>
    </div>
  </div>;
}
