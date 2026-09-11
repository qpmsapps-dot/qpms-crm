import { ShieldAlert } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useHospitalTicketAccess } from '../../hooks/useHospitalTicketAccess.js';

export default function HospitalTicketRouteGuard({ children }) {
  const location = useLocation();
  const presentation = location.pathname.includes('/client') ? 'client' : 'qpms';
  const access = useHospitalTicketAccess(presentation);

  if (access.loading) {
    return <div className="grid min-h-[45vh] place-items-center text-sm font-semibold text-slate-500">Loading Hospital Ticketing access...</div>;
  }
  if (!access.allowed) {
    return (
      <section className="mx-auto mt-12 max-w-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto h-9 w-9 text-amber-500" />
        <h1 className="mt-3 text-lg font-bold text-slate-900">Hospital Ticketing access required</h1>
        <p className="mt-2 text-sm text-slate-500">{access.error}</p>
      </section>
    );
  }
  return children;
}
