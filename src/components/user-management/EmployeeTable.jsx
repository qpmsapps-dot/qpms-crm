import { MoreVertical } from 'lucide-react';
import UserStatusBadge from './UserStatusBadge.jsx';

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'QP';
}

export default function EmployeeTable({ employees, onOpen, onAction }) {
  if (!employees.length) {
    return <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">No users match the current search or filters.</div>;
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-[1320px] divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {['Employee', 'Code', 'Contact', 'Role / Designation', 'Department / Business', 'State', 'Access', 'Provisioning', 'Attendance', 'Visits', 'GPS', 'Actions'].map((label) => (
                <th key={label} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {employees.map((employee) => (
              <tr key={employee.id} className="hover:bg-qpms-50/40">
                <td onClick={() => onOpen(employee)} className="cursor-pointer px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-qpms-50 text-xs font-black text-qpms-700 ring-1 ring-qpms-100">
                      {employee.avatarUrl ? (
                        <img src={employee.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initials(employee.fullName)
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="max-w-48 truncate text-sm font-bold text-slate-900">{employee.fullName}</p>
                      <UserStatusBadge status={employee.accountStatus} />
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-slate-700">{employee.employeeCode}</td>
                <td className="px-4 py-3 text-xs font-semibold text-slate-600">
                  <p className="max-w-52 truncate">{employee.email || 'No email'}</p>
                  <p>{employee.mobile || 'No mobile'}</p>
                </td>
                <td className="px-4 py-3 text-xs font-semibold text-slate-600">{employee.role || '—'} / {employee.designation || '—'}</td>
                <td className="px-4 py-3 text-xs font-semibold text-slate-600">{employee.department || '—'} / {employee.business || '—'}</td>
                <td className="px-4 py-3 text-sm font-semibold text-slate-600">{employee.state || '—'}</td>
                <td className="px-4 py-3 text-xs font-semibold text-slate-600">
                  Web: {employee.webAccess ? 'On' : 'Off'}<br />Mobile: {employee.mobileAccess ? 'On' : 'Off'}
                </td>
                <td className="space-y-1 px-4 py-3">
                  <UserStatusBadge status={employee.loginLabel} />
                  <UserStatusBadge status={employee.inviteLabel} />
                  <UserStatusBadge status={employee.provisioningLabel} />
                </td>
                <td className="px-4 py-3 text-sm font-bold text-slate-700">{employee.attendanceCount}</td>
                <td className="px-4 py-3 text-sm font-bold text-slate-700">{employee.siteVisitCount}</td>
                <td className="px-4 py-3 text-sm font-bold text-slate-700">{employee.gpsLogCount}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {!employee.loginEnabled ? (
                      <button type="button" onClick={() => onAction('Enable Login Access', employee)} className="focus-ring rounded-lg border border-emerald-200 px-2 py-1 text-[11px] font-bold text-emerald-700">
                        Enable Login
                      </button>
                    ) : null}
                    <button type="button" aria-label={`Edit ${employee.fullName}`} onClick={() => onAction('Edit', employee)} className="focus-ring grid h-8 w-8 place-items-center rounded-full border border-slate-200 text-slate-500">
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
