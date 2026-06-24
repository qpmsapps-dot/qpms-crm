import { AlertTriangle, KeyRound, ShieldOff, ShieldCheck, Trash2, Wrench, X } from 'lucide-react';
import { useState } from 'react';
import UserStatusBadge from './UserStatusBadge.jsx';

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-slate-800">
        {value === null || value === undefined || value === '' ? 'Not available' : String(value)}
      </dd>
    </div>
  );
}

function CountCard({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center">
      <p className="text-xl font-black text-slate-950">{value || 0}</p>
      <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
    </div>
  );
}

function ActionPanel({ action, employee, busy, onCancel, onSubmit }) {
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [newEmployeeCode, setNewEmployeeCode] = useState('');
  const [confirmationText, setConfirmationText] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');

  const isHardDelete = action === 'Hard Delete';
  const isRepair = action === 'Repair Employee Code';
  const isReset = action === 'Reset Password';
  const requiredConfirmation = isHardDelete
    ? 'HARD DELETE TEST USER'
    : isRepair
      ? 'REPAIR EMPLOYEE CODE'
      : '';
  const needsReason = ['Deactivate', 'Reactivate', 'Reset Password', 'Hard Delete', 'Repair Employee Code'].includes(action);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (needsReason && !reason.trim()) {
      setError('Reason is required.');
      return;
    }
    if (isReset && !password) {
      setError('Temporary password is required.');
      return;
    }
    if (isRepair && !newEmployeeCode.trim()) {
      setError('New employee code is required.');
      return;
    }
    try {
      if ((isHardDelete || isRepair) && !preview) {
        const result = await onSubmit(
          isHardDelete ? 'Hard Delete Preview' : 'Repair Employee Code Preview',
          {
            reason: reason.trim(),
            old_employee_code: employee.employeeCode,
            new_employee_code: newEmployeeCode.trim().toUpperCase(),
          },
        );
        setPreview(result);
        return;
      }
      await onSubmit(action, {
        reason: reason.trim(),
        temporary_password: isReset ? password : undefined,
        requires_password_change: isReset ? true : undefined,
        old_employee_code: isRepair ? employee.employeeCode : undefined,
        new_employee_code: isRepair ? newEmployeeCode.trim().toUpperCase() : undefined,
        confirmation_text: isHardDelete || isRepair ? confirmationText : undefined,
      });
    } catch (actionError) {
      setError(actionError.message || 'Action failed.');
    }
  }

  const title = action;
  return (
    <form onSubmit={submit} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-black text-slate-950">{title}</h3>
        <button type="button" onClick={onCancel} className="text-xs font-bold text-slate-500">Cancel</button>
      </div>
      {action === 'Deactivate' ? (
        <p className="mt-2 text-xs font-semibold leading-5 text-amber-800">
          This blocks login/access but keeps attendance, site visit, GPS and petrol/KM history.
        </p>
      ) : null}
      {isHardDelete ? (
        <p className="mt-2 text-xs font-semibold leading-5 text-rose-700">
          Danger Zone: only test or duplicate users with no business history or hierarchy references can be removed.
        </p>
      ) : null}
      {isRepair ? (
        <p className="mt-2 text-xs font-semibold leading-5 text-amber-800">
          This rewrites the operational identity aliases listed in the server preview. It is not normal profile editing.
        </p>
      ) : null}

      <div className="mt-3 space-y-3">
        {needsReason ? (
          <label className="block">
            <span className="text-[11px] font-bold uppercase text-slate-500">Reason *</span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-semibold" />
          </label>
        ) : null}
        {isReset ? (
          <label className="block">
            <span className="text-[11px] font-bold uppercase text-slate-500">Temporary Password *</span>
            <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold" />
          </label>
        ) : null}
        {isRepair ? (
          <label className="block">
            <span className="text-[11px] font-bold uppercase text-slate-500">New Employee Code *</span>
            <input value={newEmployeeCode} onChange={(event) => setNewEmployeeCode(event.target.value.toUpperCase())} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold" />
          </label>
        ) : null}

        {preview ? (
          <div className={`rounded-xl border p-3 text-xs font-semibold ${preview.hard_delete_allowed === false || preview.repair_allowed === false ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            <p className="font-black">{preview.recommendation || preview.warning || 'Preview ready'}</p>
            {preview.affected_counts ? (
              <div className="mt-2 max-h-52 overflow-y-auto rounded-lg bg-white/70 p-2">
                {Object.entries(preview.affected_counts).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3 border-b border-slate-100 py-1 last:border-0">
                    <span className="break-all">{key}</span>
                    <strong>{typeof value === 'object' ? value.count ?? value.updated ?? 0 : value}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <span>Attendance: {preview.attendance_count || 0}</span>
                <span>Visits: {preview.site_visit_count || 0}</span>
                <span>GPS: {preview.gps_log_count || 0}</span>
                <span>Stores: {preview.store_created_count || 0}</span>
                <span>Hierarchy refs: {preview.hierarchy_reference_count || 0}</span>
                <span>Live status: {preview.live_status_count || 0}</span>
              </div>
            )}
          </div>
        ) : null}

        {preview && ((isHardDelete && preview.hard_delete_allowed) || (isRepair && preview.repair_allowed)) ? (
          <label className="block">
            <span className="text-[11px] font-bold uppercase text-slate-500">
              Type {isHardDelete ? 'HARD DELETE TEST USER' : 'REPAIR EMPLOYEE CODE'} *
            </span>
            <input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-rose-300 bg-white px-3 text-sm font-semibold" />
          </label>
        ) : null}
      </div>
      {error ? <p className="mt-3 text-xs font-bold text-rose-700">{error}</p> : null}
      <button
        type="submit"
        disabled={
          busy ||
          (isHardDelete && preview?.hard_delete_allowed === false) ||
          (preview && requiredConfirmation && confirmationText !== requiredConfirmation)
        }
        className={`mt-3 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${isHardDelete ? 'bg-rose-700' : 'bg-qpms-600'}`}
      >
        {busy
          ? 'Working...'
          : (isHardDelete || isRepair) && !preview
            ? 'Run Safety Preview'
            : action}
      </button>
    </form>
  );
}

export default function EmployeeDetailsDrawer({
  employee,
  loading,
  busy,
  onClose,
  onEdit,
  onAction,
}) {
  const [activeAction, setActiveAction] = useState(null);
  if (!employee) return null;

  const hierarchy = employee.hierarchy || {};
  const inactive = !employee.isActive;
  const sections = [
    ['Employee Information', [
      ['Employee name', employee.fullName],
      ['Employee code', employee.employeeCode],
      ['Email', employee.email],
      ['Mobile number', employee.mobile],
      ['Designation', employee.designation],
      ['Department', employee.department],
      ['State', employee.state],
      ['Business', employee.business],
    ]],
    ['Hierarchy', [
      ['Manager', hierarchy.manager_employee_code],
      ["Manager's manager", hierarchy.managers_manager_employee_code],
      ['Business head', hierarchy.business_head_employee_code],
      ['GM', hierarchy.gm_employee_code],
      ['COO', hierarchy.coo_employee_code],
    ]],
    ['Access and Provisioning', [
      ['Role', employee.role],
      ['Profile status', employee.status],
      ['Provisioning', employee.provisioningStatus],
      ['Mobile access', employee.mobileAccess ? 'Enabled' : 'Disabled'],
      ['Web access', employee.webAccess ? 'Enabled' : 'Disabled'],
      ['Password change required', employee.requiresPasswordChange ? 'Yes' : 'No'],
    ]],
  ];

  async function submitAction(action, payload) {
    const result = await onAction(action, employee, payload);
    if (!['Hard Delete Preview', 'Repair Employee Code Preview'].includes(action)) {
      setActiveAction(null);
    }
    return result;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30">
      <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">{employee.fullName}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-400">@{employee.employeeCode}</span>
              <UserStatusBadge status={employee.accountStatus} />
              <UserStatusBadge status={employee.provisioningLabel} />
            </div>
          </div>
          <button type="button" aria-label="Close employee details" onClick={onClose} className="focus-ring grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {loading ? <p className="text-sm font-semibold text-slate-500">Loading complete profile...</p> : null}
          {inactive ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
              Access disabled; history preserved.
            </div>
          ) : null}
          <section className="grid grid-cols-3 gap-3">
            <CountCard label="Attendance" value={employee.attendanceCount} />
            <CountCard label="Site visits" value={employee.siteVisitCount} />
            <CountCard label="GPS logs" value={employee.gpsLogCount} />
          </section>
          {employee.attendanceCount || employee.siteVisitCount || employee.gpsLogCount ? (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs font-bold text-sky-800">
              This user has operational history. Deactivate instead of hard delete.
            </div>
          ) : null}
          {sections.map(([title, fields]) => (
            <section key={title} className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-bold text-slate-950">{title}</h3>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                {fields.map(([label, value]) => <Field key={label} label={label} value={value} />)}
              </dl>
            </section>
          ))}

          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-950">Account Actions</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => onEdit(employee)} className="focus-ring rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">Edit Profile</button>
              <button type="button" onClick={() => setActiveAction('Reset Password')} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-violet-200 px-3 py-2 text-xs font-bold text-violet-700"><KeyRound className="h-3.5 w-3.5" /> Reset Password</button>
              {inactive ? (
                <button type="button" onClick={() => setActiveAction('Reactivate')} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-emerald-200 px-3 py-2 text-xs font-bold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" /> Reactivate</button>
              ) : (
                <button type="button" onClick={() => setActiveAction('Deactivate')} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-amber-200 px-3 py-2 text-xs font-bold text-amber-700"><ShieldOff className="h-3.5 w-3.5" /> Deactivate</button>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-rose-200 bg-rose-50/30 p-4">
            <h3 className="flex items-center gap-2 text-sm font-black text-rose-800"><AlertTriangle className="h-4 w-4" /> Danger Zone</h3>
            <p className="mt-1 text-xs font-semibold text-rose-700">These actions require server previews and exact confirmation text.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setActiveAction('Repair Employee Code')} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800"><Wrench className="h-3.5 w-3.5" /> Repair Employee Code</button>
              <button type="button" onClick={() => setActiveAction('Hard Delete')} className="focus-ring inline-flex items-center gap-2 rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-800"><Trash2 className="h-3.5 w-3.5" /> Hard Delete Test User</button>
            </div>
          </section>

          {activeAction ? (
            <ActionPanel
              key={activeAction}
              action={activeAction}
              employee={employee}
              busy={busy}
              onCancel={() => setActiveAction(null)}
              onSubmit={submitAction}
            />
          ) : null}
        </div>
      </aside>
    </div>
  );
}
