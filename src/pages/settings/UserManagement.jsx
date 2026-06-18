import { LayoutGrid, List, UserPlus, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import EmployeeCardGrid from '../../components/user-management/EmployeeCardGrid.jsx';
import EmployeeDetailsDrawer from '../../components/user-management/EmployeeDetailsDrawer.jsx';
import EmployeeFilters from '../../components/user-management/EmployeeFilters.jsx';
import EmployeeTable from '../../components/user-management/EmployeeTable.jsx';
import UserFormDrawer from '../../components/user-management/UserFormDrawer.jsx';
import UserManagementHeader from '../../components/user-management/UserManagementHeader.jsx';
import UserManagementSummary from '../../components/user-management/UserManagementSummary.jsx';
import { usePageTitle } from '../../hooks/usePageTitle.js';

export const USER_DRAFT_STORAGE_KEY = 'myqpms_user_management_drafts';

const tabs = ['Employees', 'Hierarchy', 'HOD Mapping', 'Create Accounts', 'Activity'];
const emptyFilters = {
  accountStatus: '',
  role: '',
  department: '',
  hod: '',
  mobileAccess: '',
};

function readDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(USER_DRAFT_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDrafts(users) {
  localStorage.setItem(USER_DRAFT_STORAGE_KEY, JSON.stringify(users));
}

function uniqueValues(users, key) {
  return Array.from(new Set(users.map((item) => item[key]).filter(Boolean))).sort();
}

function newLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function placeholderText() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-500">
        <Users className="h-7 w-7" />
      </div>
      <h2 className="mt-4 text-lg font-bold text-slate-950">This section will become available after employee data is added and the backend is connected.</h2>
    </section>
  );
}

export default function UserManagement() {
  usePageTitle('User Management');

  const [users, setUsers] = useState(readDrafts);
  const [activeTab, setActiveTab] = useState('Employees');
  const [viewMode, setViewMode] = useState('card');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  const [drawerUser, setDrawerUser] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState('add');
  const [editingUser, setEditingUser] = useState(null);
  const [message, setMessage] = useState('');

  const filterOptions = useMemo(() => ({
    accountStatus: uniqueValues(users, 'accountStatus'),
    role: uniqueValues(users, 'role'),
    department: uniqueValues(users, 'department'),
    hod: uniqueValues(users, 'hod'),
    mobileAccess: ['Enabled', 'Disabled'],
  }), [users]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      const searchable = [
        user.fullName,
        user.employeeCode,
        user.email,
        user.designation,
        user.department,
        user.hod,
      ].join(' ').toLowerCase();
      const matchesSearch = !query || searchable.includes(query);
      const matchesFilters = Object.entries(filters).every(([key, value]) => {
        if (!value) return true;
        if (key === 'mobileAccess') return value === (user.mobileAccess ? 'Enabled' : 'Disabled');
        return String(user[key] || '') === value;
      });
      return matchesSearch && matchesFilters;
    });
  }, [filters, search, users]);

  function persist(nextUsers) {
    setUsers(nextUsers);
    writeDrafts(nextUsers);
  }

  function showMessage(text) {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 3000);
  }

  function openAddUser() {
    setEditingUser(null);
    setFormMode('add');
    setFormOpen(true);
  }

  function openEditUser(user) {
    setEditingUser(user);
    setFormMode('edit');
    setFormOpen(true);
  }

  function duplicateUser(user) {
    setEditingUser({
      designation: user.designation,
      department: user.department,
      reportingManager: user.reportingManager,
      hod: user.hod,
      role: user.role,
      mobileAccess: user.mobileAccess,
      webAccess: user.webAccess,
      accountStatus: 'Draft',
      primaryBusiness: user.primaryBusiness,
      additionalBusiness: user.additionalBusiness,
      stateRegion: user.stateRegion,
      fullName: '',
      employeeCode: '',
      email: '',
      mobileNumber: '',
    });
    setFormMode('add');
    setFormOpen(true);
  }

  function deleteUser(user) {
    if (!window.confirm(`Delete ${user.fullName} from UI drafts?`)) return;
    persist(users.filter((item) => item.id !== user.id));
    setDrawerUser(null);
    showMessage('User removed from UI draft.');
  }

  function handleAction(action, user) {
    if (action === 'View') setDrawerUser(user);
    if (action === 'Edit') openEditUser(user);
    if (action === 'Duplicate') duplicateUser(user);
    if (action === 'Delete') deleteUser(user);
  }

  function saveUser(user) {
    if (formMode === 'edit' && editingUser?.id) {
      const updated = { ...editingUser, ...user, updatedAt: new Date().toISOString() };
      persist(users.map((item) => (item.id === editingUser.id ? updated : item)));
      setDrawerUser((current) => (current?.id === editingUser.id ? updated : current));
      showMessage('User draft updated.');
    } else {
      const created = {
        ...user,
        id: newLocalId(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      persist([...users, created]);
      showMessage('User added to UI draft.');
    }
    setFormOpen(false);
    setEditingUser(null);
  }

  function clearDrafts() {
    if (!window.confirm('Clear only User Management UI drafts from this browser?')) return;
    localStorage.removeItem(USER_DRAFT_STORAGE_KEY);
    setUsers([]);
    setDrawerUser(null);
    setFilters(emptyFilters);
    setSearch('');
    showMessage('User Management UI drafts cleared.');
  }

  function renderEmptyState() {
    return (
      <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-qpms-50 text-qpms-600">
          <UserPlus className="h-8 w-8" />
        </div>
        <h2 className="mt-5 text-xl font-bold text-slate-950">No users added yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm font-semibold text-slate-500">Add an employee manually or import the HR Excel to begin.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={openAddUser} className="focus-ring rounded-xl bg-qpms-600 px-4 py-2 text-sm font-bold text-white">Add User</button>
          <button type="button" onClick={() => showMessage('Import HR Excel is coming in the next phase.')} className="focus-ring rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700">Import HR Excel</button>
        </div>
      </section>
    );
  }

  function renderEmployees() {
    return (
      <div className="space-y-4">
        <UserManagementSummary employees={users} />
        {users.length === 0 ? renderEmptyState() : (
          <>
            <EmployeeFilters
              open={filtersOpen}
              filters={filters}
              options={filterOptions}
              onChange={(key, value) => setFilters((current) => ({ ...current, [key]: value }))}
              onReset={() => setFilters(emptyFilters)}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-bold text-slate-600">{filteredUsers.length} users shown</p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={clearDrafts} className="focus-ring rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700">Clear UI Drafts</button>
                <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                  <button type="button" onClick={() => setViewMode('card')} className={`focus-ring inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${viewMode === 'card' ? 'bg-qpms-600 text-white' : 'text-slate-600'}`}>
                    <LayoutGrid className="h-4 w-4" /> Card View
                  </button>
                  <button type="button" onClick={() => setViewMode('table')} className={`focus-ring inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${viewMode === 'table' ? 'bg-qpms-600 text-white' : 'text-slate-600'}`}>
                    <List className="h-4 w-4" /> Table View
                  </button>
                </div>
              </div>
            </div>
            {filteredUsers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">No users match the current search or filters.</div>
            ) : viewMode === 'card' ? (
              <EmployeeCardGrid employees={filteredUsers} onOpen={setDrawerUser} onAction={handleAction} />
            ) : (
              <EmployeeTable employees={filteredUsers} onOpen={setDrawerUser} onAction={handleAction} />
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <UserManagementHeader
        search={search}
        onSearch={setSearch}
        onToggleFilters={() => setFiltersOpen((value) => !value)}
        onImportClick={() => showMessage('Import HR Excel is coming in the next phase.')}
        onPreviewAccounts={() => setActiveTab('Create Accounts')}
        onAddUser={openAddUser}
      />

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
        UI draft mode — users added here are not yet created in the database or mobile login system.
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {tabs.map((tab) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`focus-ring whitespace-nowrap rounded-xl px-3 py-2 text-sm font-bold ${activeTab === tab ? 'bg-qpms-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Employees' ? renderEmployees() : placeholderText()}

      {message ? (
        <div className="fixed bottom-5 right-5 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-xl">
          <span>{message}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setMessage('')} className="grid h-7 w-7 place-items-center rounded-full text-slate-400 hover:bg-slate-50"><X className="h-4 w-4" /></button>
        </div>
      ) : null}

      <UserFormDrawer key={`${formMode}-${editingUser?.id || editingUser?.employeeCode || 'new'}-${formOpen ? 'open' : 'closed'}`} open={formOpen} mode={formMode} initialUser={editingUser} users={users} onClose={() => setFormOpen(false)} onSave={saveUser} />
      <EmployeeDetailsDrawer employee={drawerUser} onClose={() => setDrawerUser(null)} onAction={handleAction} />
    </div>
  );
}
