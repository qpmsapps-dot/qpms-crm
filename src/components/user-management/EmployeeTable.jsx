import { MoreVertical } from 'lucide-react';
import UserStatusBadge from './UserStatusBadge.jsx';

const columns = [
  ['fullName', 'Employee'],
  ['employeeCode', 'Employee Code'],
  ['designation', 'Designation'],
  ['department', 'Department'],
  ['reportingManager', 'Reports To'],
  ['hod', 'HOD'],
  ['loginMethod', 'Login Method'],
  ['loginId', 'Login ID'],
  ['mobileAccess', 'Mobile Access'],
  ['accountStatus', 'Account Status'],
];

export default function EmployeeTable({ employees, onOpen, onAction }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-[1120px] divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              {columns.map(([, label]) => (
                <th key={label} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</th>
              ))}
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {employees.map((employee) => (
              <tr key={employee.id} className="hover:bg-qpms-50/40">
                {columns.map(([key]) => (
                  <td key={key} onClick={() => onOpen(employee)} className="max-w-48 cursor-pointer truncate px-4 py-3 text-sm font-semibold text-slate-700">
                    {key === 'accountStatus' ? <UserStatusBadge status={employee[key]} /> : key === 'mobileAccess' ? (employee.mobileAccess ? 'Enabled' : 'Disabled') : employee[key] || 'Not assigned'}
                  </td>
                ))}
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
