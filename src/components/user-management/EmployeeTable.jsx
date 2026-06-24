import { MoreVertical } from 'lucide-react';
import UserStatusBadge from './UserStatusBadge.jsx';

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
                  <p className="max-w-48 truncate text-sm font-bold text-slate-900">{employee.fullName}</p>
                  <UserStatusBadge status={employee.accountStatus} />
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
                <td className="px-4 py-3"><UserStatusBadge status={employee.provisioningLabel} /></td>
                <td className="px-4 py-3 text-sm font-bold text-slate-700">{employee.attendanceCount}</td>
                <td className="px-4 py-3 text-sm font-bold text-slate-700">{employee.siteVisitCount}</td>
                <td className="px-4 py-3 text-sm font-bold text-slate-700">{employee.gpsLogCount}</td>
                <td className="px-4 py-3">
                  <button type="button" aria-label={`Edit ${employee.fullName}`} onClick={() => onAction('Edit', employee)} className="focus-ring grid h-8 w-8 place-items-center rounded-full border border-slate-200 text-slate-500">
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
