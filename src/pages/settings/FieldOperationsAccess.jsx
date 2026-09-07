import { CheckCircle2, Eye, Filter, Search, ShieldCheck, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../components/PageHeader.jsx';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import {
  getFieldOperationsAccessPreview,
  getFieldOperationsAccessUsers,
  previewFieldOperationsAccessTeam,
  saveFieldOperationsAccess,
} from '../../services/api.js';

const businessOptions = [
  { key: 'reliance_retail', label: 'Reliance Retail' },
  { key: 'standalone', label: 'Standalone' },
];

const stateOptions = ['AP', 'KA', 'KL', 'TN', 'TG'];
const roleOptions = [
  { key: 'gm', label: 'GM' },
  { key: 'branch_head', label: 'Branch Head' },
];

const capabilities = [
  ['command_center_view', 'Operations Command Center - View'],
  ['employee_details_view', 'Employee Details - View'],
  ['visit_history_view', 'Visit History - View'],
  ['km_view', 'KM - View'],
  ['missing_km_approve', 'Missing KM - Approve'],
];

function text(value) {
  return String(value || '').trim();
}

function roleKey(value) {
  const key = text(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (key === 'branchhead' || key === 'bh') return 'branch_head';
  if (key === 'general_manager') return 'gm';
  return key;
}

function businessKey(value) {
  const key = text(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (key === 'retail' || key === 'reliance_retail') return 'reliance_retail';
  if (key === 'standalone') return 'standalone';
  return key;
}

function scopeFromPreview(preview, fallback) {
  const scope = preview?.effective_scope || fallback?.effective_scope || {};
  const role = roleKey(scope.role || fallback?.normalized_role || fallback?.role);
  const states = scope.states?.length ? scope.states : [fallback?.state].filter(Boolean);
  const businesses = scope.businesses?.length ? scope.businesses : [fallback?.business].filter(Boolean);
  return {
    role: roleOptions.some((option) => option.key === role) ? role : roleKey(fallback?.role),
    states: [...new Set(states.map((state) => text(state).toUpperCase()).filter((state) => stateOptions.includes(state)))],
    businesses: [...new Set(businesses.map(businessKey).filter((key) => businessOptions.some((option) => option.key === key)))],
  };
}

function Badge({ children, tone = 'slate' }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-slate-100 text-slate-600',
  };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-black ${tones[tone] || tones.slate}`}>{children}</span>;
}

function CheckRow({ checked, label, onChange, disabled = false }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-qpms-600 focus:ring-qpms-500"
      />
    </label>
  );
}

function SelectFilter({ label, value, onChange, options }) {
  return (
    <label className="grid gap-1 text-xs font-black uppercase tracking-wide text-slate-400">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-800 outline-none focus:border-qpms-400"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value || option} value={option.value || option}>{option.label || option}</option>
        ))}
      </select>
    </label>
  );
}

function Drawer({ selected, preview, draft, setDraft, onClose, onPreviewTeam, onSave, saving, previewing, teamPreview, message }) {
  if (!selected) return null;
  const employee = preview?.employee || selected;
  const effective = teamPreview?.effective_scope || preview?.effective_scope || selected.effective_scope || {};
  const visibleEmployees = teamPreview?.visible_employees || preview?.visible_employees || [];
  const visibleCount = teamPreview?.visible_employee_count ?? preview?.visible_employee_count ?? selected.visible_employee_count ?? 0;

  const toggleBusiness = (key, checked) => setDraft((current) => ({
    ...current,
    businesses: checked
      ? [...new Set([...current.businesses, key])]
      : current.businesses.filter((item) => item !== key),
  }));
  const toggleState = (state, checked) => setDraft((current) => ({
    ...current,
    states: checked
      ? [...new Set([...current.states, state])]
      : current.states.filter((item) => item !== state),
  }));

  return (
    <div className="fixed inset-0 z-40 bg-slate-950/30">
      <aside className="ml-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Field Operations Access</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">{employee.full_name || employee.employee_code}</h2>
            <p className="text-sm font-bold text-slate-500">{employee.employee_code}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <section>
            <h3 className="text-sm font-black text-slate-950">Field Operations Role</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {roleOptions.map((option) => (
                <CheckRow
                  key={option.key}
                  label={option.label}
                  checked={draft.role === option.key}
                  onChange={() => setDraft((current) => ({ ...current, role: option.key }))}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-black text-slate-950">Business Access</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {businessOptions.map((option) => (
                <CheckRow
                  key={option.key}
                  label={option.label}
                  checked={draft.businesses.includes(option.key)}
                  onChange={(checked) => toggleBusiness(option.key, checked)}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-black text-slate-950">State Access</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {stateOptions.map((state) => (
                <CheckRow
                  key={state}
                  label={state}
                  checked={draft.states.includes(state)}
                  onChange={(checked) => toggleState(state, checked)}
                />
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-black text-slate-950">Capabilities - Inherited from Role</h3>
            <div className="mt-3 grid gap-2">
              {capabilities.map(([key, label]) => (
                <CheckRow key={key} label={label} checked={preview?.capabilities?.[key] === true} disabled />
              ))}
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-500">Capability controls are disabled because permissions are role-derived today; this screen saves only business/state scope.</p>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">Effective Access</p>
                <h3 className="mt-1 text-lg font-black text-slate-950">{effective.label || 'Preview required'}</h3>
              </div>
              <Badge tone={effective.configured ? 'blue' : 'amber'}>{effective.configured ? 'Configured' : 'Legacy / Draft'}</Badge>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-black uppercase tracking-wide text-slate-400">Business</dt>
                <dd className="mt-1 text-sm font-bold text-slate-900">{(effective.businesses || []).filter((value) => value !== 'Retail').join(', ') || '-'}</dd>
              </div>
              <div>
                <dt className="text-xs font-black uppercase tracking-wide text-slate-400">States</dt>
                <dd className="mt-1 text-sm font-bold text-slate-900">{(effective.states || []).join(', ') || '-'}</dd>
              </div>
              <div>
                <dt className="text-xs font-black uppercase tracking-wide text-slate-400">Role</dt>
                <dd className="mt-1 text-sm font-bold text-slate-900">{effective.role || '-'}</dd>
              </div>
              <div>
                <dt className="text-xs font-black uppercase tracking-wide text-slate-400">Visible Employees</dt>
                <dd className="mt-1 text-sm font-bold text-slate-900">{visibleCount}</dd>
              </div>
            </dl>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-slate-950">Preview Team</h3>
              <button
                type="button"
                onClick={onPreviewTeam}
                disabled={previewing || !draft.states.length || !draft.businesses.length}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-700 disabled:opacity-50"
              >
                <Eye className="h-4 w-4" />
                {previewing ? 'Previewing...' : 'Preview Team'}
              </button>
            </div>
            <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-100">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Employee</th>
                    <th className="px-3 py-2">Scope</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleEmployees.slice(0, 150).map((row) => (
                    <tr key={`${row.id}-${row.employee_code}`}>
                      <td className="px-3 py-2">
                        <p className="font-bold text-slate-900">{row.full_name || row.employee_code}</p>
                        <p className="text-xs font-semibold text-slate-500">{row.employee_code}</p>
                      </td>
                      <td className="px-3 py-2 text-xs font-bold text-slate-600">{[row.state, row.business].filter(Boolean).join(' / ') || '-'}</td>
                    </tr>
                  ))}
                  {!visibleEmployees.length ? (
                    <tr>
                      <td colSpan="2" className="px-3 py-6 text-center text-sm font-bold text-slate-400">No preview loaded</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="border-t border-slate-200 p-5">
          {message ? <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">{message}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-black text-slate-700">Cancel</button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !draft.states.length || !draft.businesses.length}
              className="rounded-lg bg-qpms-600 px-4 py-2 text-sm font-black text-white shadow-sm disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Access'}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function FieldOperationsAccess() {
  usePageTitle('Field Operations Access');
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [teamPreview, setTeamPreview] = useState(null);
  const [draft, setDraft] = useState({ role: 'branch_head', businesses: [], states: [] });
  const [filters, setFilters] = useState({ business: '', state: '', role: '', search: '' });
  const [loading, setLoading] = useState(true);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      const result = await getFieldOperationsAccessUsers();
      setUsers(result.users || []);
    } catch (requestError) {
      setError(requestError?.message || 'Unable to load Field Operations access users.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function openEmployee(user) {
    setSelected(user);
    setPreview(null);
    setTeamPreview(null);
    setMessage('');
    setDrawerLoading(true);
    try {
      const result = await getFieldOperationsAccessPreview({ profile_id: user.id });
      setPreview(result);
      setDraft(scopeFromPreview(result, user));
    } catch (requestError) {
      setError(requestError?.message || 'Unable to load access details.');
    } finally {
      setDrawerLoading(false);
    }
  }

  async function previewTeam() {
    if (!selected) return;
    setPreviewing(true);
    setMessage('');
    try {
      const result = await previewFieldOperationsAccessTeam({
        profile_id: selected.id,
        role: draft.role,
        businesses: draft.businesses,
        states: draft.states,
      });
      setTeamPreview(result);
    } catch (requestError) {
      setError(requestError?.message || 'Unable to preview team.');
    } finally {
      setPreviewing(false);
    }
  }

  async function saveAccess() {
    if (!selected) return;
    setSaving(true);
    setMessage('');
    try {
      const result = await saveFieldOperationsAccess(selected.id, {
        role: draft.role,
        businesses: draft.businesses,
        states: draft.states,
      });
      setPreview(result);
      setTeamPreview(result);
      setMessage('Access saved without modifying profile role, state, or business.');
      await loadUsers();
    } catch (requestError) {
      setError(requestError?.message || 'Unable to save Field Operations access.');
    } finally {
      setSaving(false);
    }
  }

  const filteredUsers = useMemo(() => {
    const search = text(filters.search).toLowerCase();
    return users.filter((user) => {
      if (filters.business && businessKey(user.business) !== filters.business && !(user.effective_scope?.businesses || []).map(businessKey).includes(filters.business)) return false;
      if (filters.state && user.state !== filters.state && !(user.effective_scope?.states || []).includes(filters.state)) return false;
      if (filters.role && roleKey(user.normalized_role || user.role) !== filters.role) return false;
      if (!search) return true;
      return [user.full_name, user.employee_code, user.role, user.business, user.state].some((value) => text(value).toLowerCase().includes(search));
    });
  }, [filters, users]);

  return (
    <div className="space-y-5">
      <PageHeader title="Field Operations Access" description="Manage web Command Center scope for GM and Branch Head users without changing mobile-facing profile fields." />

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone="blue">Access foundation</Badge>
            <Badge tone="green">Profiles unchanged</Badge>
            <Badge tone="amber">Legacy fallback preserved</Badge>
          </div>
          <button type="button" onClick={loadUsers} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-700">Refresh</button>
        </div>
        {error ? <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</p> : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
          <label className="grid min-w-64 flex-1 gap-1 text-xs font-black uppercase tracking-wide text-slate-400">
            Search
            <span className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={filters.search}
                onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                placeholder="Name, code, role, state, business"
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold normal-case tracking-normal text-slate-800 outline-none"
              />
            </span>
          </label>
          <SelectFilter label="Business" value={filters.business} onChange={(value) => setFilters((current) => ({ ...current, business: value }))} options={businessOptions.map((option) => ({ value: option.key, label: option.label }))} />
          <SelectFilter label="State" value={filters.state} onChange={(value) => setFilters((current) => ({ ...current, state: value }))} options={stateOptions} />
          <SelectFilter label="Role" value={filters.role} onChange={(value) => setFilters((current) => ({ ...current, role: value }))} options={roleOptions.map((option) => ({ value: option.key, label: option.label }))} />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Employee Code</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Business</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Effective Scope</th>
                <th className="px-4 py-3">Access Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map((user) => (
                <tr key={user.id} onClick={() => openEmployee(user)} className="cursor-pointer hover:bg-qpms-50/60">
                  <td className="px-4 py-3 font-bold text-slate-950">{user.full_name || '-'}</td>
                  <td className="px-4 py-3 font-semibold text-slate-600">{user.employee_code || '-'}</td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{user.role || '-'}</td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{user.business || '-'}</td>
                  <td className="px-4 py-3 font-semibold text-slate-700">{user.state || '-'}</td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-600">{user.effective_scope?.label || '-'}</td>
                  <td className="px-4 py-3"><Badge tone={user.access_status === 'Configured' ? 'blue' : 'amber'}>{user.access_status}</Badge></td>
                </tr>
              ))}
              {!loading && !filteredUsers.length ? (
                <tr>
                  <td colSpan="7" className="px-4 py-10 text-center text-sm font-bold text-slate-400">
                    <Filter className="mx-auto mb-2 h-5 w-5" />
                    No eligible GM or Branch Head users found
                  </td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-4 py-10 text-center text-sm font-bold text-slate-400">Loading Field Operations users...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <Drawer
          selected={selected}
          preview={preview}
          draft={draft}
          setDraft={setDraft}
          onClose={() => setSelected(null)}
          onPreviewTeam={previewTeam}
          onSave={saveAccess}
          saving={saving}
          previewing={previewing || drawerLoading}
          teamPreview={teamPreview}
          message={message}
        />
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <UsersRound className="h-4 w-4 text-qpms-600" />
          Showing {filteredUsers.length} of {users.length} eligible Field Operations management users
          <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-600" />
        </div>
      </section>
    </div>
  );
}
