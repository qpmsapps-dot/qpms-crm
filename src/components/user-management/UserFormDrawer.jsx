import { X } from 'lucide-react';
import { useState } from 'react';

const emptyForm = {
  employee_code: '',
  full_name: '',
  display_name: '',
  mobile: '',
  email: '',
  state: '',
  role: 'FO',
  designation: '',
  department: '',
  business: '',
  temporary_password: '',
  requires_password_change: true,
  mobile_access_enabled: true,
  web_access_enabled: true,
  status: 'Active',
  is_active: true,
  manager_employee_code: '',
  managers_manager_employee_code: '',
  business_head_employee_code: '',
  gm_employee_code: '',
  coo_employee_code: '',
};

const roleOptions = [
  'Admin', 'MD', 'COO', 'GM', 'Management', 'HR', 'HR Reviewer', 'HR GM',
  'Finance GM', 'Operations Manager', 'Manager', 'Branch Head', 'KAM', 'FO',
];

function normalizeInitial(initialUser) {
  if (!initialUser) return emptyForm;
  return {
    ...emptyForm,
    ...initialUser.raw,
    ...(initialUser.hierarchy || {}),
    employee_code: initialUser.employeeCode || '',
    full_name: initialUser.fullName || '',
    display_name: initialUser.displayName || '',
    mobile: initialUser.mobile || '',
    email: initialUser.email || '',
    state: initialUser.state || '',
    role: initialUser.role || 'FO',
    designation: initialUser.designation || '',
    department: initialUser.department || '',
    business: initialUser.business || '',
    status: initialUser.status || 'Active',
    is_active: initialUser.isActive,
    mobile_access_enabled: initialUser.mobileAccess,
    web_access_enabled: initialUser.webAccess,
    temporary_password: '',
  };
}

function TextField({
  name,
  label,
  value,
  onChange,
  required = false,
  type = 'text',
  readOnly = false,
  error,
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label}{required ? ' *' : ''}
      </span>
      <input
        type={type}
        value={value ?? ''}
        readOnly={readOnly}
        autoComplete={type === 'password' ? 'new-password' : undefined}
        onChange={(event) => onChange(name, event.target.value)}
        className={`mt-1 h-10 w-full rounded-xl border px-3 text-sm font-semibold outline-none ${
          readOnly
            ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-500'
            : 'border-slate-200 bg-white text-slate-800 focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100'
        } ${error ? 'border-rose-300' : ''}`}
      />
      {error ? <p className="mt-1 text-xs font-semibold text-rose-600">{error}</p> : null}
    </label>
  );
}

export default function UserFormDrawer({
  open,
  mode,
  initialUser,
  busy,
  serverError,
  onClose,
  onSave,
}) {
  const [values, setValues] = useState(() => normalizeInitial(initialUser));
  const [errors, setErrors] = useState({});

  if (!open) return null;

  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    const nextErrors = {};
    const employeeCode = values.employee_code.trim().toUpperCase();
    const fullName = values.full_name.trim();
    const email = values.email.trim().toLowerCase();
    if (!employeeCode) nextErrors.employee_code = 'Employee code is required.';
    if (!fullName) nextErrors.full_name = 'Full name is required.';
    if (!email) nextErrors.email = 'Email is required for Supabase Auth.';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      nextErrors.email = 'Enter a valid email.';
    }
    if (mode === 'add' && !values.temporary_password) {
      nextErrors.temporary_password = 'Temporary password is required.';
    }
    if (
      values.manager_employee_code &&
      values.manager_employee_code.trim().toUpperCase() === employeeCode
    ) {
      nextErrors.manager_employee_code = 'Manager cannot be the same employee.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const payload = {
      employee_code: employeeCode,
      full_name: fullName,
      display_name: values.display_name.trim() || fullName,
      mobile: values.mobile.trim() || null,
      email,
      state: values.state.trim() || null,
      role: values.role,
      designation: values.designation.trim() || null,
      department: values.department.trim() || null,
      business: values.business.trim() || null,
      requires_password_change: values.requires_password_change,
      mobile_access_enabled: values.mobile_access_enabled,
      web_access_enabled: values.web_access_enabled,
      manager_employee_code: values.manager_employee_code.trim().toUpperCase() || null,
      managers_manager_employee_code:
        values.managers_manager_employee_code.trim().toUpperCase() || null,
      business_head_employee_code:
        values.business_head_employee_code.trim().toUpperCase() || null,
      gm_employee_code: values.gm_employee_code.trim().toUpperCase() || null,
      coo_employee_code: values.coo_employee_code.trim().toUpperCase() || null,
    };
    if (mode === 'add') {
      payload.temporary_password = values.temporary_password;
    } else {
      delete payload.employee_code;
      payload.status = values.status;
      payload.is_active = values.is_active;
    }
    await onSave(payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30">
      <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">
              {mode === 'edit' ? 'Edit User' : 'Create User'}
            </h2>
            <p className="text-sm font-semibold text-slate-500">
              {mode === 'edit'
                ? 'Updates the profile and linked Supabase Auth metadata.'
                : 'Creates a Supabase Auth account and profile.'}
            </p>
          </div>
          <button type="button" aria-label="Close user form" onClick={onClose} className="focus-ring grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-5 p-5">
          {serverError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
              {serverError}
            </div>
          ) : null}

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-950">Employee Details</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TextField name="employee_code" label="Employee Code" required value={values.employee_code} readOnly={mode === 'edit'} error={errors.employee_code} onChange={update} />
              <TextField name="full_name" label="Full Name" required value={values.full_name} error={errors.full_name} onChange={update} />
              {mode === 'edit' ? (
                <p className="sm:col-span-2 -mt-1 text-xs font-semibold text-amber-700">
                  Employee code repair must use the dedicated repair flow.
                </p>
              ) : null}
              <TextField name="display_name" label="Display Name" value={values.display_name} onChange={update} />
              <TextField name="email" label="Email" required type="email" value={values.email} error={errors.email} onChange={update} />
              <TextField name="mobile" label="Mobile" value={values.mobile} onChange={update} />
              <TextField name="state" label="State" value={values.state} onChange={update} />
              <TextField name="designation" label="Designation" value={values.designation} onChange={update} />
              <TextField name="department" label="Department" value={values.department} onChange={update} />
              <TextField name="business" label="Business" value={values.business} onChange={update} />
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Role</span>
                <select value={values.role} onChange={(event) => update('role', event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold">
                  {roleOptions.map((role) => <option key={role}>{role}</option>)}
                </select>
              </label>
            </div>
          </section>

          {mode === 'add' ? (
            <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
              <h3 className="text-sm font-bold text-slate-950">Temporary Password</h3>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                The password remains only in this unsaved form and is never stored locally.
              </p>
              <div className="mt-3">
                <TextField name="temporary_password" label="Temporary Password" required type="password" value={values.temporary_password} error={errors.temporary_password} onChange={update} />
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-950">Hierarchy</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TextField name="manager_employee_code" label="Manager Employee Code" value={values.manager_employee_code} error={errors.manager_employee_code} onChange={update} />
              <TextField name="managers_manager_employee_code" label="Manager's Manager Code" value={values.managers_manager_employee_code} onChange={update} />
              <TextField name="business_head_employee_code" label="Business Head Code" value={values.business_head_employee_code} onChange={update} />
              <TextField name="gm_employee_code" label="GM Code" value={values.gm_employee_code} onChange={update} />
              <TextField name="coo_employee_code" label="COO Code" value={values.coo_employee_code} onChange={update} />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-950">Access</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {[
                ['mobile_access_enabled', 'Mobile Access Enabled'],
                ['web_access_enabled', 'Web Access Enabled'],
                ['requires_password_change', 'Require Password Change'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold">
                  <input type="checkbox" checked={Boolean(values[key])} onChange={(event) => update(key, event.target.checked)} />
                  {label}
                </label>
              ))}
              {mode === 'edit' ? (
                <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold">
                  <input type="checkbox" checked={Boolean(values.is_active)} onChange={(event) => update('is_active', event.target.checked)} />
                  Active Profile
                </label>
              ) : null}
            </div>
          </section>

          <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
            <button type="button" disabled={busy} onClick={onClose} className="focus-ring rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700">Cancel</button>
            <button type="submit" disabled={busy} className="focus-ring rounded-xl bg-qpms-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
              {busy ? 'Saving...' : mode === 'edit' ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
