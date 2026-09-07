import { CheckCircle2, Eye, Search, ShieldCheck, UserRound, XCircle } from 'lucide-react';
import { useState } from 'react';
import PageHeader from '../../components/PageHeader.jsx';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import { getFieldOperationsAccessPreview } from '../../services/api.js';

const capabilityLabels = [
  ['command_center_view', 'Operations Command Center - View'],
  ['employee_details_view', 'Employee Details - View'],
  ['visit_history_view', 'Visit History - View'],
  ['km_view', 'KM - View'],
  ['missing_km_approve', 'Missing KM - Approve'],
];

function Value({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-bold text-slate-900">{value || 'Not configured'}</dd>
    </div>
  );
}

function Capability({ allowed, label }) {
  const Icon = allowed ? CheckCircle2 : XCircle;
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${allowed ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
      <Icon className="h-4 w-4" />
      {label}
    </div>
  );
}

export default function FieldOperationsAccess() {
  usePageTitle('Field Operations Access');
  const [employee, setEmployee] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadPreview(event) {
    event.preventDefault();
    const value = employee.trim();
    if (!value || loading) return;
    setLoading(true);
    setError('');
    setPreview(null);
    try {
      const result = await getFieldOperationsAccessPreview({ employee: value });
      setPreview(result);
    } catch (requestError) {
      setError(requestError?.message || 'Unable to preview Field Operations access.');
    } finally {
      setLoading(false);
    }
  }

  const scope = preview?.effective_scope || {};
  const selected = preview?.employee || {};
  const visibleEmployees = preview?.visible_employees || [];

  return (
    <div className="space-y-5">
      <PageHeader title="Field Operations Access" description="Read-only preview of current legacy Operations Command Center permissions and scope." />

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Mode</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase text-emerald-700">Legacy</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase text-slate-600">Preview only</span>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black uppercase text-amber-700">No save action</span>
            </div>
          </div>
          <form onSubmit={loadPreview} className="flex w-full gap-2 sm:w-auto">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 sm:w-80">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={employee}
                onChange={(event) => setEmployee(event.target.value)}
                placeholder="Employee code or exact name"
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={loading || !employee.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-qpms-600 px-4 py-2 text-sm font-black text-white shadow-sm disabled:opacity-50"
            >
              <Eye className="h-4 w-4" />
              Preview Access
            </button>
          </form>
        </div>
        {error ? <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</p> : null}
      </section>

      {preview ? (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-5">
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-qpms-50 text-qpms-600">
                  <UserRound className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-950">{selected.full_name || selected.employee_code}</h2>
                  <p className="text-sm font-bold text-slate-500">{selected.employee_code}</p>
                </div>
              </div>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Value label="Current Role" value={selected.role} />
                <Value label="Current Business" value={selected.business} />
                <Value label="Current State" value={selected.state} />
                <Value label="Web Access" value={selected.web_access_enabled ? 'Enabled' : 'Disabled'} />
              </dl>
            </article>

            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-qpms-600" />
                <h2 className="text-base font-black text-slate-950">Effective Field Operations Access</h2>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {capabilityLabels.map(([key, label]) => (
                  <Capability key={key} allowed={preview.capabilities?.[key] === true} label={label} />
                ))}
              </div>
            </article>
          </div>

          <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Effective Scope</p>
            <h2 className="mt-1 text-lg font-black text-slate-950">{scope.label || 'Not configured'}</h2>
            <dl className="mt-5 grid gap-4">
              <Value label="Business" value={(scope.businesses || []).join(', ') || selected.business} />
              <Value label="States" value={(scope.states || []).join(', ') || selected.state} />
              <Value label="Role" value={scope.role} />
              <Value label="Source" value={scope.source} />
              <Value label="Employees Currently Visible" value={String(preview.visible_employee_count || 0)} />
            </dl>
            <div className="mt-5 max-h-96 overflow-auto rounded-lg border border-slate-100">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Employee</th>
                    <th className="px-3 py-2">Scope</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleEmployees.slice(0, 100).map((row) => (
                    <tr key={`${row.employee_code}-${row.id}`}>
                      <td className="px-3 py-2">
                        <p className="font-bold text-slate-900">{row.full_name || row.employee_code}</p>
                        <p className="text-xs font-semibold text-slate-500">{row.employee_code}</p>
                      </td>
                      <td className="px-3 py-2 text-xs font-bold text-slate-600">{[row.state, row.business].filter(Boolean).join(' / ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </aside>
        </section>
      ) : null}
    </div>
  );
}
