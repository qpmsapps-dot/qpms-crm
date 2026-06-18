import { X } from 'lucide-react';
import UserStatusBadge from './UserStatusBadge.jsx';

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-slate-800">{value || 'Not available'}</dd>
    </div>
  );
}

export default function EmployeeDetailsDrawer({ employee, onClose, onAction }) {
  if (!employee) return null;

  const sections = [
    ['Employee Information', [
      ['Employee name', employee.fullName],
      ['Employee code', employee.employeeCode],
      ['Email', employee.email],
      ['Mobile number', employee.mobileNumber],
      ['Designation', employee.designation],
      ['Department', employee.department],
    ]],
    ['Hierarchy', [
      ['Reporting manager', employee.reportingManager],
      ['HOD', employee.hod],
      ['Role', employee.role],
    ]],
    ['Business Details', [
      ['Primary business', employee.primaryBusiness],
      ['Additional business', employee.additionalBusiness],
      ['State or region', employee.stateRegion],
    ]],
    ['Login Identity', [
      ['Login method', employee.loginMethod],
      ['Login ID', employee.loginId],
      ['Account status', employee.accountStatus],
      ['Mobile access', employee.mobileAccess ? 'Enabled' : 'Disabled'],
      ['Web access', employee.webAccess ? 'Enabled' : 'Disabled'],
    ]],
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30">
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950">{employee.fullName}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-400">@{employee.employeeCode}</span>
              <UserStatusBadge status={employee.accountStatus} />
            </div>
          </div>
          <button type="button" aria-label="Close employee details" onClick={onClose} className="focus-ring grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          {sections.map(([title, fields]) => (
            <section key={title} className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-bold text-slate-950">{title}</h3>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                {fields.map(([label, value]) => <Field key={label} label={label} value={value} />)}
              </dl>
            </section>
          ))}
          <section className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-950">Actions</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {['Edit', 'Duplicate', 'Delete'].map((action) => (
                <button key={action} type="button" onClick={() => onAction(action, employee)} className="focus-ring rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
                  {action}
                </button>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
