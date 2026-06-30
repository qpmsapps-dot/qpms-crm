import { ChevronLeft, ChevronRight, LayoutGrid, List, UserPlus, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import EmployeeCardGrid from '../../components/user-management/EmployeeCardGrid.jsx';
import EmployeeDetailsDrawer from '../../components/user-management/EmployeeDetailsDrawer.jsx';
import EmployeeFilters from '../../components/user-management/EmployeeFilters.jsx';
import EmployeeTable from '../../components/user-management/EmployeeTable.jsx';
import ImportEmployeesPanel from '../../components/user-management/ImportEmployeesPanel.jsx';
import UserFormDrawer from '../../components/user-management/UserFormDrawer.jsx';
import UserManagementHeader from '../../components/user-management/UserManagementHeader.jsx';
import UserManagementSummary from '../../components/user-management/UserManagementSummary.jsx';
import { usePageTitle } from '../../hooks/usePageTitle.js';
import {
  createAdminUser,
  deactivateAdminUser,
  getAdminUser,
  getAdminUsers,
  getHardDeletePreview,
  hardDeleteAdminUser,
  previewEmployeeCodeRepair,
  reactivateAdminUser,
  repairEmployeeCode,
  resetAdminUserPassword,
  enableLoginAccess,
  syncAuthUsersToProfiles,
  updateAdminUser,
} from '../../services/api.js';
import { parseEmployeeExcel } from '../../utils/employeeExcelParser.js';

const tabs = ['Employees', 'Hierarchy', 'HOD Mapping', 'Create Accounts', 'Activity'];
const pageSize = 24;
const emptyFilters = {
  state: '',
  role: '',
  designation: '',
  department: '',
  business: '',
  status: '',
  is_active: '',
  auth_provisioning_status: '',
};

function apiErrorMessage(error) {
  return error?.response?.data?.message || error?.response?.data?.error || error?.message || 'Request failed.';
}

function provisioningLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'provisioned') return 'Provisioned';
  if (normalized.includes('fail') || normalized.includes('error')) return 'Failed provisioning';
  return 'Unknown provisioning';
}

function mapProfile(profile, hierarchy = null) {
  const isActive = profile?.is_active === true;
  return {
    id: profile.id,
    raw: profile,
    hierarchy,
    employeeCode: profile.employee_code || profile.username || 'Not assigned',
    fullName: profile.full_name || profile.display_name || profile.email || 'Unnamed user',
    displayName: profile.display_name || '',
    mobile: profile.mobile || '',
    email: profile.email || '',
    state: profile.state || '',
    role: profile.role || '',
    designation: profile.designation || '',
    department: profile.department || '',
    business: profile.business || '',
    status: profile.status || (isActive ? 'Active' : 'Inactive'),
    isActive,
    authUserId: profile.auth_user_id || '',
    loginEnabled: Boolean(profile.auth_user_id),
    loginLabel: profile.auth_user_id ? 'Login Enabled' : 'Profile Only',
    accountStatus: isActive ? 'Active' : 'Inactive',
    webAccess: profile.web_access_enabled !== false,
    mobileAccess: profile.mobile_access_enabled !== false,
    provisioningStatus: String(profile.auth_provisioning_status || 'unknown').toLowerCase(),
    provisioningLabel: provisioningLabel(profile.auth_provisioning_status),
    requiresPasswordChange: profile.requires_password_change === true,
    attendanceCount: Number(profile.attendance_count || 0),
    siteVisitCount: Number(profile.site_visit_count || 0),
    gpsLogCount: Number(profile.gps_log_count || 0),
  };
}

function uniqueOptions(users, key, defaults = []) {
  return Array.from(new Set([...defaults, ...users.map((user) => user[key]).filter(Boolean)])).sort();
}

function placeholderText(tab) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-500">
        <Users className="h-7 w-7" />
      </div>
      <h2 className="mt-4 text-lg font-bold text-slate-950">{tab} is not wired in this phase.</h2>
      <p className="mt-2 text-sm font-semibold text-slate-500">User account actions are available from the Employees tab. No placeholder operation will report fake success.</p>
    </section>
  );
}

export default function UserManagement() {
  usePageTitle('User Management');

  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState('Employees');
  const [viewMode, setViewMode] = useState('card');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [drawerUser, setDrawerUser] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState('add');
  const [editingUser, setEditingUser] = useState(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importReview, setImportReview] = useState(null);
  const [importEmployees, setImportEmployees] = useState([]);
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [enableLoginUser, setEnableLoginUser] = useState(null);
  const [enableLoginEmail, setEnableLoginEmail] = useState('');
  const [enableLoginMobile, setEnableLoginMobile] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadUsers = useCallback(async () => {
    void refreshVersion;
    setLoading(true);
    setLoadError('');
    try {
      const params = { page, pageSize, search: debouncedSearch || undefined };
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== '') params[key] = value;
      });
      const result = await getAdminUsers(params);
      setUsers((result.users || []).map((profile) => mapProfile(profile)));
      setTotal(Number(result.total || 0));
      setTotalPages(Number(result.totalPages || 0));
    } catch (error) {
      setLoadError(apiErrorMessage(error));
      setUsers([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filters, page, refreshVersion]);

  useEffect(() => {
    // Data fetching is the external synchronization performed by this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers();
  }, [loadUsers]);

  const filterOptions = useMemo(() => ({
    state: uniqueOptions(users, 'state'),
    role: uniqueOptions(users, 'role'),
    designation: uniqueOptions(users, 'designation'),
    department: uniqueOptions(users, 'department'),
    business: uniqueOptions(users, 'business'),
    status: uniqueOptions(users, 'status', ['Active', 'Inactive']),
    is_active: [
      { value: 'true', label: 'Active' },
      { value: 'false', label: 'Inactive' },
    ],
    auth_provisioning_status: uniqueOptions(users, 'provisioningStatus', ['provisioned', 'unknown'])
      .map((value) => ({ value, label: provisioningLabel(value) })),
  }), [users]);

  function refreshList() {
    setRefreshVersion((value) => value + 1);
  }

  function showMessage(text) {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 5000);
  }

  function openAddUser() {
    setEditingUser(null);
    setFormError('');
    setFormMode('add');
    setFormOpen(true);
  }

  async function openEditUser(user) {
    let completeUser = user;
    if (!user.hierarchy) {
      setBusy(true);
      try {
        const result = await getAdminUser(user.id);
        completeUser = mapProfile(result.profile, result.hierarchy);
      } catch (error) {
        showMessage(apiErrorMessage(error));
        return;
      } finally {
        setBusy(false);
      }
    }
    setEditingUser(completeUser);
    setFormError('');
    setFormMode('edit');
    setFormOpen(true);
  }

  async function openDetails(user) {
    setDrawerUser(user);
    setDetailLoading(true);
    try {
      const result = await getAdminUser(user.id);
      setDrawerUser(mapProfile(result.profile, result.hierarchy));
    } catch (error) {
      showMessage(apiErrorMessage(error));
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveUser(payload) {
    setBusy(true);
    setFormError('');
    try {
      const result = formMode === 'edit'
        ? await updateAdminUser(editingUser.id, payload)
        : await createAdminUser(payload);
      const next = result.profile ? mapProfile(result.profile, result.hierarchy) : null;
      if (next && drawerUser?.id === next.id) setDrawerUser(next);
      setFormOpen(false);
      setEditingUser(null);
      refreshList();
      if (formMode === 'edit') {
        showMessage('User profile updated.');
      } else if (result.invite?.setup_link) {
        showMessage(`${result.invite.message} Link: ${result.invite.setup_link}`);
      } else {
        showMessage(result.invite?.message || 'User account created and invite prepared.');
      }
    } catch (error) {
      setFormError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(action, user, payload = {}) {
    const initiatedFromActionPanel = Object.keys(payload).length > 0;
    if (action === 'View') {
      await openDetails(user);
      return null;
    }
    if (action === 'Edit') {
      openEditUser(user);
      return null;
    }
    if (action === 'Enable Login Access') {
      setEnableLoginUser(user);
      setEnableLoginEmail(user.email || '');
      setEnableLoginMobile(user.mobile || '');
      return null;
    }

    let actionPayload = payload;
    if (['Deactivate', 'Reactivate'].includes(action) && !actionPayload.reason) {
      const reason = window.prompt(`${action} reason:`);
      if (!reason?.trim()) return null;
      actionPayload = { reason: reason.trim() };
    }

    setBusy(true);
    try {
      let result;
      if (action === 'Deactivate') result = await deactivateAdminUser(user.id, actionPayload);
      if (action === 'Reactivate') result = await reactivateAdminUser(user.id, actionPayload);
      if (action === 'Reset Password') result = await resetAdminUserPassword(user.id, actionPayload);
      if (action === 'Hard Delete Preview') result = await getHardDeletePreview(user.id);
      if (action === 'Hard Delete') result = await hardDeleteAdminUser(user.id, actionPayload);
      if (action === 'Repair Employee Code Preview') result = await previewEmployeeCodeRepair(user.id, actionPayload);
      if (action === 'Repair Employee Code') result = await repairEmployeeCode(user.id, actionPayload);
      if (!result) throw new Error(`Unsupported action: ${action}`);

      if (['Hard Delete Preview', 'Repair Employee Code Preview'].includes(action)) return result;

      if (action === 'Hard Delete') {
        setDrawerUser(null);
      } else {
        try {
          const refreshed = await getAdminUser(user.id);
          setDrawerUser(mapProfile(refreshed.profile, refreshed.hierarchy));
        } catch {
          setDrawerUser(null);
        }
      }
      refreshList();
      showMessage(`${action} completed.`);
      return result;
    } catch (error) {
      const messageText = apiErrorMessage(error);
      if (initiatedFromActionPanel) throw new Error(messageText);
      showMessage(messageText);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submitEnableLogin(event) {
    event.preventDefault();
    if (!enableLoginUser) return;
    setBusy(true);
    try {
      const result = await enableLoginAccess(enableLoginUser.employeeCode, {
        email: enableLoginEmail.trim().toLowerCase(),
        mobile: enableLoginMobile.trim() || undefined,
      });
      if (result.profile && drawerUser?.employeeCode === enableLoginUser.employeeCode) {
        setDrawerUser(mapProfile(result.profile, drawerUser.hierarchy));
      }
      setEnableLoginUser(null);
      setEnableLoginEmail('');
      setEnableLoginMobile('');
      refreshList();
      showMessage(result.invite?.setup_link ? `${result.invite.message} Link: ${result.invite.setup_link}` : result.invite?.message || 'Login access enabled.');
    } catch (error) {
      showMessage(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function syncAuthUsers() {
    if (!window.confirm('Scan Supabase Auth and synchronize matching profiles? Existing profile values will not be overwritten with empty metadata.')) return;
    setSyncing(true);
    try {
      const result = await syncAuthUsersToProfiles();
      const errorCount = Array.isArray(result.errors) ? result.errors.length : Number(result.errors || 0);
      showMessage(
        `Auth sync: ${result.total_auth_users_scanned || 0} scanned, ${result.profiles_created || 0} created, ${result.profiles_updated || 0} updated, ${result.profiles_already_existing || 0} existing, ${result.skipped_users || 0} skipped, ${errorCount} errors.`,
      );
      refreshList();
    } catch (error) {
      showMessage(apiErrorMessage(error));
    } finally {
      setSyncing(false);
    }
  }

  async function readImportFile(file) {
    if (!file) return;
    setImporting(true);
    setImportError('');
    try {
      const result = await parseEmployeeExcel(file);
      setImportEmployees(result.employees);
      setImportReview(result.review);
    } catch (error) {
      setImportEmployees([]);
      setImportReview(null);
      setImportError(error.message || 'Could not read workbook.');
    } finally {
      setImporting(false);
    }
  }

  function closeImport() {
    setImportOpen(false);
    setImportReview(null);
    setImportEmployees([]);
    setImportError('');
  }

  function downloadImportErrors() {
    const rows = [...(importReview?.errors || []), ...(importReview?.warnings || [])];
    if (!rows.length) {
      showMessage('No import errors or warnings to download.');
      return;
    }
    const csv = ['row,employee_code,issue', ...rows.map((row) => [
      row.row || '',
      `"${String(row.employeeCode || '').replaceAll('"', '""')}"`,
      `"${String(row.issue || '').replaceAll('"', '""')}"`,
    ].join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'user-import-review.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function renderEmptyState() {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-qpms-50 text-qpms-600">
          <UserPlus className="h-8 w-8" />
        </div>
        <h2 className="mt-5 text-xl font-bold text-slate-950">No profiles found</h2>
        <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-slate-500">Adjust the backend filters, sync existing Auth users, or create a user.</p>
        <button type="button" onClick={openAddUser} className="focus-ring mt-5 rounded-xl bg-qpms-600 px-4 py-2 text-sm font-bold text-white">Add User</button>
      </section>
    );
  }

  function renderEmployees() {
    return (
      <div className="space-y-4">
        <UserManagementSummary employees={users} total={total} />
        <EmployeeFilters
          open={filtersOpen}
          filters={filters}
          options={filterOptions}
          onChange={(key, value) => {
            setPage(1);
            setFilters((current) => ({ ...current, [key]: value }));
          }}
          onReset={() => {
            setPage(1);
            setFilters(emptyFilters);
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-bold text-slate-600">
            {loading ? 'Loading profiles...' : `${users.length} shown of ${total} profiles`}
          </p>
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <button type="button" onClick={() => setViewMode('card')} className={`focus-ring inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${viewMode === 'card' ? 'bg-qpms-600 text-white' : 'text-slate-600'}`}>
              <LayoutGrid className="h-4 w-4" /> Card View
            </button>
            <button type="button" onClick={() => setViewMode('table')} className={`focus-ring inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${viewMode === 'table' ? 'bg-qpms-600 text-white' : 'text-slate-600'}`}>
              <List className="h-4 w-4" /> Table View
            </button>
          </div>
        </div>

        {loadError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">
            {loadError}
            <button type="button" onClick={refreshList} className="ml-3 underline">Retry</button>
          </div>
        ) : loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-500">Loading real profiles from the backend...</div>
        ) : users.length === 0 ? renderEmptyState() : viewMode === 'card' ? (
          <EmployeeCardGrid employees={users} onOpen={openDetails} onAction={handleAction} />
        ) : (
          <EmployeeTable employees={users} onOpen={openDetails} onAction={handleAction} />
        )}

        {totalPages > 1 ? (
          <div className="flex items-center justify-center gap-3">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="focus-ring inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <span className="text-xs font-bold text-slate-500">Page {page} of {totalPages}</span>
            <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)} className="focus-ring inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <UserManagementHeader
        search={search}
        syncing={syncing}
        onSearch={setSearch}
        onToggleFilters={() => setFiltersOpen((value) => !value)}
        onImportClick={() => setImportOpen(true)}
        onSyncAuth={syncAuthUsers}
        onAddUser={openAddUser}
      />

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
        Backend mode — profiles and account actions are protected by Supabase JWT and server-side User Management permission checks.
      </div>

      <ImportEmployeesPanel
        open={importOpen}
        review={importReview}
        employees={importEmployees}
        error={importError}
        importing={importing}
        onFile={readImportFile}
        onCancel={closeImport}
        onAccept={() => showMessage('Bulk import API not implemented yet. Preview data was not saved.')}
        onDownloadErrors={downloadImportErrors}
      />

      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {tabs.map((tab) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`focus-ring whitespace-nowrap rounded-xl px-3 py-2 text-sm font-bold ${activeTab === tab ? 'bg-qpms-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Employees' ? renderEmployees() : placeholderText(activeTab)}

      {message ? (
        <div className="fixed bottom-5 right-5 z-[70] flex max-w-lg items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-xl">
          <span>{message}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setMessage('')} className="grid h-7 w-7 place-items-center rounded-full text-slate-400 hover:bg-slate-50"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      {enableLoginUser ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/35 px-4">
          <form onSubmit={submitEnableLogin} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-bold text-slate-950">Enable Login Access</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {enableLoginUser.fullName} - {enableLoginUser.employeeCode}
            </p>
            <label className="mt-4 block">
              <span className="text-[11px] font-bold uppercase text-slate-500">Email *</span>
              <input
                type="email"
                required
                value={enableLoginEmail}
                onChange={(event) => setEnableLoginEmail(event.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100"
              />
            </label>
            <label className="mt-3 block">
              <span className="text-[11px] font-bold uppercase text-slate-500">Mobile Number</span>
              <input
                value={enableLoginMobile}
                onChange={(event) => setEnableLoginMobile(event.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setEnableLoginUser(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700">Cancel</button>
              <button type="submit" disabled={busy} className="rounded-xl bg-qpms-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                {busy ? 'Sending invite...' : 'Enable Login Access'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <UserFormDrawer
        key={`${formMode}-${editingUser?.id || 'new'}-${formOpen ? 'open' : 'closed'}`}
        open={formOpen}
        mode={formMode}
        initialUser={editingUser}
        busy={busy}
        serverError={formError}
        onClose={() => setFormOpen(false)}
        onSave={saveUser}
      />
      <EmployeeDetailsDrawer
        employee={drawerUser}
        loading={detailLoading}
        busy={busy}
        onClose={() => setDrawerUser(null)}
        onEdit={openEditUser}
        onAction={handleAction}
      />
    </div>
  );
}
