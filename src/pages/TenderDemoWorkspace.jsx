import { Download, Edit3, Filter, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { buildTenderDemoRecords, tenderDemoModules } from '../data/tenderDemoData.js';
import { usePageTitle } from '../hooks/usePageTitle.js';

const statusOptions = ['All', 'Open', 'In Review', 'Approved', 'Rejected', 'Closed'];

function statusClass(status) {
  if (status === 'Approved') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'Rejected') return 'bg-rose-50 text-rose-700 ring-rose-200';
  if (status === 'Closed') return 'bg-slate-100 text-slate-700 ring-slate-200';
  if (status === 'In Review') return 'bg-amber-50 text-amber-700 ring-amber-200';
  return 'bg-blue-50 text-blue-700 ring-blue-200';
}

function downloadCsv(filename, rows) {
  const headers = ['Title', 'Owner', 'Site', 'Status', 'Priority', 'Amount', 'Updated At', 'Notes'];
  const csvRows = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => {
      const key = {
        Title: 'title',
        Owner: 'owner',
        Site: 'site',
        Status: 'status',
        Priority: 'priority',
        Amount: 'amount',
        'Updated At': 'updatedAt',
        Notes: 'notes',
      }[header];
      return `"${String(row[key] ?? '').replaceAll('"', '""')}"`;
    }).join(',')),
  ];
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function TenderDemoWorkspace() {
  const params = useParams();
  const moduleKey = params.moduleKey || 'dashboard';
  const moduleConfig = tenderDemoModules.find((item) => item.key === moduleKey);
  const [recordsByModule, setRecordsByModule] = useState(() => ({
    [moduleKey]: buildTenderDemoRecords(moduleKey),
  }));
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('All');
  const [selectedId, setSelectedId] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  usePageTitle(moduleConfig ? `Demo ${moduleConfig.label}` : 'Demo');

  const records = recordsByModule[moduleKey] || buildTenderDemoRecords(moduleKey);

  const selectedRecord = records.find((record) => record.id === selectedId) || records[0];
  const filteredRecords = useMemo(() => records.filter((record) => {
    const matchesStatus = status === 'All' || record.status === status;
    const haystack = `${record.title} ${record.owner} ${record.site} ${record.priority}`.toLowerCase();
    return matchesStatus && haystack.includes(query.trim().toLowerCase());
  }), [query, records, status]);

  if (!moduleConfig) {
    return <Navigate to="/demo/dashboard" replace />;
  }

  function setModuleRecords(updater) {
    setRecordsByModule((current) => {
      const currentRecords = current[moduleKey] || buildTenderDemoRecords(moduleKey);
      return {
        ...current,
        [moduleKey]: typeof updater === 'function' ? updater(currentRecords) : updater,
      };
    });
  }

  function updateSelectedStatus(nextStatus) {
    if (!selectedRecord) return;
    setModuleRecords((current) => current.map((record) => (
      record.id === selectedRecord.id ? { ...record, status: nextStatus, updatedAt: '04 Aug 2026' } : record
    )));
  }

  function handleCreate() {
    const nextNumber = records.length + 1;
    const nextRecord = {
      id: `${moduleKey}-${Date.now()}`,
      title: `${moduleConfig.label} demo ${nextNumber}`,
      owner: 'Demo Presenter',
      site: 'Fictional Client Campus',
      status: 'Open',
      priority: 'Medium',
      amount: 185000,
      updatedAt: '04 Aug 2026',
      notes: 'New fictional record created during the presentation.',
    };
    setModuleRecords((current) => [nextRecord, ...current]);
    setSelectedId(nextRecord.id);
  }

  function handleEdit() {
    if (!selectedRecord || !draftTitle.trim()) return;
    setModuleRecords((current) => current.map((record) => (
      record.id === selectedRecord.id ? { ...record, title: draftTitle.trim(), updatedAt: '04 Aug 2026' } : record
    )));
    setDraftTitle('');
  }

  const totalValue = records.reduce((sum, row) => sum + row.amount, 0);
  const approvedCount = records.filter((record) => record.status === 'Approved').length;
  const openCount = records.filter((record) => !['Closed', 'Rejected'].includes(record.status)).length;

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_44px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="section-kicker">Interactive Tender Demo</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">{moduleConfig.label}</h1>
            <p className="mt-2 max-w-3xl text-sm font-medium text-slate-500">
              Create, edit, approve, reject, close, filter, search and download fictional {moduleConfig.noun} records. No production APIs are used.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleCreate} className="focus-ring inline-flex items-center gap-2 rounded-xl bg-qpms-600 px-4 py-2.5 text-sm font-bold text-white">
              <Plus className="h-4 w-4" /> Create
            </button>
            <button type="button" onClick={() => downloadCsv(`myqpms-demo-${moduleKey}.csv`, filteredRecords)} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">
              <Download className="h-4 w-4" /> Download CSV
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ['Total Demo Records', records.length],
          ['Open Work Items', openCount],
          ['Approved Items', approvedCount],
          ['Sample Value', `Rs. ${totalValue.toLocaleString('en-IN')}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search demo records"
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-semibold outline-none focus:border-qpms-300"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-600">
              <Filter className="h-4 w-4" />
              <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold">
                {statusOptions.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {['Record', 'Owner', 'Site', 'Priority', 'Status', 'Updated'].map((heading) => (
                    <th key={heading} className="px-4 py-3 font-black">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRecords.map((record) => (
                  <tr key={record.id} onClick={() => setSelectedId(record.id)} className="cursor-pointer hover:bg-qpms-50/60">
                    <td className="px-4 py-3 font-bold text-slate-900">{record.title}</td>
                    <td className="px-4 py-3 text-slate-600">{record.owner}</td>
                    <td className="px-4 py-3 text-slate-600">{record.site}</td>
                    <td className="px-4 py-3 text-slate-600">{record.priority}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ring-1 ${statusClass(record.status)}`}>{record.status}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{record.updatedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="section-kicker">Selected Demo Record</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">{selectedRecord?.title}</h2>
          <p className="mt-2 text-sm font-medium text-slate-500">{selectedRecord?.notes}</p>
          <div className="mt-5 space-y-3">
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              placeholder="Edit selected record title"
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-qpms-300"
            />
            <button type="button" onClick={handleEdit} className="focus-ring inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700">
              <Edit3 className="h-4 w-4" /> Save Edit
            </button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            {['Approved', 'Rejected', 'Closed', 'In Review'].map((nextStatus) => (
              <button key={nextStatus} type="button" onClick={() => updateSelectedStatus(nextStatus)} className="focus-ring rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
                {nextStatus}
              </button>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
