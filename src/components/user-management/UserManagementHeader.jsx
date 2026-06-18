import { Filter, Plus, Search, Upload, UserPlus, Users } from 'lucide-react';

export default function UserManagementHeader({
  search,
  onSearch,
  onToggleFilters,
  onImportClick,
  onPreviewAccounts,
  onAddUser,
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.045)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-kicker">Settings</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">User Management</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">Manage employee hierarchy, app access and account onboarding.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative block min-w-0 sm:w-72">
            <span className="sr-only">Search employees</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm font-semibold text-slate-700 outline-none focus:border-qpms-400 focus:bg-white focus:ring-2 focus:ring-qpms-100"
              placeholder="Search name or code"
            />
          </label>
          <button type="button" onClick={onToggleFilters} className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">
            <Filter className="h-4 w-4" /> Filter
          </button>
          <button type="button" onClick={onImportClick} className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">
            <Upload className="h-4 w-4" /> Import HR Excel
          </button>
          <button type="button" onClick={onPreviewAccounts} className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-qpms-600 px-3 text-sm font-bold text-white shadow-sm">
            <Users className="h-4 w-4" /> Create Accounts
          </button>
          <button type="button" onClick={onAddUser} className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-full border border-qpms-300 bg-white px-4 text-sm font-bold text-qpms-700">
            <UserPlus className="h-4 w-4" /> Add User <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
