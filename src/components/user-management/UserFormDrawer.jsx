import { X } from 'lucide-react';
import { useMemo, useState } from 'react';

const emptyForm = {
  fullName: '',
  employeeCode: '',
  email: '',
  mobileNumber: '',
  designation: '',
  department: '',
  reportingManager: '',
  hod: '',
  role: 'Other',
  mobileAccess: true,
  webAccess: true,
  accountStatus: 'Draft',
  primaryBusiness: '',
  additionalBusiness: '',
  stateRegion: '',
};

const roleOptions = ['MD', 'COO', 'HOD', 'Manager', 'KAM', 'Field Officer', 'HR', 'Finance', 'Admin', 'Other'];
const statusOptions = ['Draft', 'Ready to Create', 'Disabled'];

function normalizeUser(values) {
  return {
    ...values,
    fullName: values.fullName.trim(),
    employeeCode: values.employeeCode.trim().toUpperCase(),
    email: values.email.trim().toLowerCase(),
    mobileNumber: values.mobileNumber.trim(),
    designation: values.designation.trim(),
    department: values.department.trim(),
    reportingManager: values.reportingManager.trim(),
    hod: values.hod.trim(),
    primaryBusiness: values.primaryBusiness.trim(),
    additionalBusiness: values.additionalBusiness.trim(),
    stateRegion: values.stateRegion.trim(),
  };
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function loginPreview(values) {
  const normalized = normalizeUser(values);
  if (normalized.email && isValidEmail(normalized.email)) {
    return { loginMethod: 'Email', loginId: normalized.email };
  }
  return { loginMethod: 'Employee Code', loginId: normalized.employeeCode };
}

function TextField({ name, label, required = false, type = 'text', value, error, onChange }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}{required ? ' *' : ''}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(name, event.target.value)}
        className={`mt-1 h-10 w-full rounded-xl border bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-qpms-400 focus:ring-2 focus:ring-qpms-100 ${error ? 'border-rose-300' : 'border-slate-200'}`}
      />
      {error ? <p className="field-error">{error}</p> : null}
    </label>
  );
}

export default function UserFormDrawer({ open, mode, initialUser, users, onClose, onSave }) {
  const [values, setValues] = useState(() => (initialUser ? { ...emptyForm, ...initialUser } : emptyForm));
  const [errors, setErrors] = useState({});

  const preview = useMemo(() => loginPreview(values), [values]);

  if (!open) return null;

  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function validate() {
    const normalized = normalizeUser(values);
    const nextErrors = {};
    const otherUsers = users.filter((user) => user.id !== initialUser?.id);

    if (!normalized.fullName) nextErrors.fullName = 'Full Name is required.';
    if (!normalized.employeeCode) nextErrors.employeeCode = 'Employee Code is required.';
    if (!normalized.designation) nextErrors.designation = 'Designation is required.';
    if (!normalized.department) nextErrors.department = 'Department is required.';
    if (normalized.employeeCode && otherUsers.some((user) => user.employeeCode === normalized.employeeCode)) {
      nextErrors.employeeCode = 'Employee Code must be unique.';
    }
    if (normalized.email && !isValidEmail(normalized.email)) nextErrors.email = 'Enter a valid email address.';
    if (normalized.email && otherUsers.some((user) => user.email === normalized.email)) nextErrors.email = 'Email must be unique.';
    if (normalized.mobileNumber && !/^[0-9+\-()\s]+$/.test(normalized.mobileNumber)) {
      nextErrors.mobileNumber = 'Mobile number can contain only numbers, spaces, +, -, and brackets.';
    }
    if (normalized.reportingManager && normalized.reportingManager.toUpperCase() === normalized.employeeCode) {
      nextErrors.reportingManager = 'Reporting Manager cannot be the same employee.';
    }

    setErrors(nextErrors);
    return { valid: Object.keys(nextErrors).length === 0, normalized };
  }

  function submit(event) {
    event.preventDefault();
    const result = validate();
    if (!result.valid) return;
    onSave({ ...result.normalized, ...loginPreview(result.normalized) });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30">
      <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">{mode === 'edit' ? 'Edit User' : 'Add User'}</h2>
            <p className="text-sm font-semibold text-slate-500">UI draft only. No database or login account is created.</p>
          </div>
          <button type="button" aria-label="Close user form" onClick={onClose} className="focus-ring grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-5 p-5">
          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-950">Employee Details</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <TextField name="fullName" label="Full Name" required value={values.fullName} error={errors.fullName} onChange={update} />
              <TextField name="employeeCode" label="Employee Code" required value={values.employeeCode} error={errors.employeeCode} onChange={update} />
              <TextField name="email" label="Email" type="email" value={values.email} error={errors.email} onChange={update} />
              <TextField name="mobileNumber" label="Mobile Number" value={values.mobileNumber} error={errors.mobileNumber} onChange={update} />
              <TextField name="designation" label="Designation" required value={values.designation} error={errors.designation} onChange={update} />
              <TextField name="department" label="Department" required value={values.department} error={errors.department} onChange={update} />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-950">Hierarchy</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <TextField name="reportingManager" label="Reporting Manager" value={values.reportingManager} error={errors.reportingManager} onChange={update} />
              <TextField name="hod" label="HOD" value={values.hod} error={errors.hod} onChange={update} />
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Role</span>
                <select value={values.role} onChange={(event) => update('role', event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold">
                  {roleOptions.map((role) => <option key={role}>{role}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-950">Access</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold">
                <input type="checkbox" checked={values.mobileAccess} onChange={(event) => update('mobileAccess', event.target.checked)} />
                Mobile Access Enabled
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold">
                <input type="checkbox" checked={values.webAccess} onChange={(event) => update('webAccess', event.target.checked)} />
                Web Access Enabled
              </label>
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Account Status</span>
                <select value={values.accountStatus} onChange={(event) => update('accountStatus', event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold">
                  {statusOptions.map((status) => <option key={status}>{status}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-950">Business Details</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <TextField name="primaryBusiness" label="Primary Business" value={values.primaryBusiness} error={errors.primaryBusiness} onChange={update} />
              <TextField name="additionalBusiness" label="Additional Business" value={values.additionalBusiness} error={errors.additionalBusiness} onChange={update} />
              <TextField name="stateRegion" label="State or Region" value={values.stateRegion} error={errors.stateRegion} onChange={update} />
            </div>
          </section>

          <section className="rounded-xl border border-qpms-200 bg-qpms-50/50 p-4">
            <h3 className="text-sm font-bold text-slate-950">Login Identity Display</h3>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Login Method</dt>
                <dd className="mt-1 text-sm font-bold text-slate-950">{preview.loginMethod}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Login ID</dt>
                <dd className="mt-1 break-all text-sm font-bold text-slate-950">{preview.loginId || 'Enter Employee Code or Email'}</dd>
              </div>
            </dl>
          </section>

          <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
            <button type="button" onClick={onClose} className="focus-ring rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700">Cancel</button>
            <button type="submit" className="focus-ring rounded-xl bg-qpms-600 px-4 py-2 text-sm font-bold text-white">Save User</button>
          </div>
        </form>
      </aside>
    </div>
  );
}
