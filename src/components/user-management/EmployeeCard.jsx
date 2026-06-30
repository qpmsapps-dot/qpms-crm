import { MoreVertical } from 'lucide-react';
import { useState } from 'react';
import UserStatusBadge from './UserStatusBadge.jsx';

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'QP';
}

export default function EmployeeCard({ employee, onOpen, onAction }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const actions = [
    'View',
    'Edit',
    ...(!employee.loginEnabled ? ['Enable Login Access'] : []),
    employee.isActive ? 'Deactivate' : 'Reactivate',
  ];

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpen(employee)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(employee);
        }
      }}
      className="min-h-[168px] rounded-lg border border-slate-200 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.055)] outline-none transition hover:border-qpms-200 hover:shadow-[0_16px_30px_rgba(15,23,42,0.08)] focus-visible:ring-2 focus-visible:ring-qpms-300"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-qpms-50 to-sky-100 text-sm font-black text-qpms-700 ring-1 ring-qpms-100">
          {initials(employee.fullName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-slate-950">{employee.fullName}</h3>
              <p className="truncate text-xs font-semibold text-slate-400">@{employee.employeeCode}</p>
            </div>
            <div className="relative" onClick={(event) => event.stopPropagation()}>
              <button type="button" aria-label={`Open actions for ${employee.fullName}`} onClick={() => setMenuOpen((value) => !value)} className="focus-ring grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-50 hover:text-slate-700">
                <MoreVertical className="h-4 w-4" />
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-8 z-10 w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                  {actions.map((action) => (
                    <button key={action} type="button" onClick={() => { setMenuOpen(false); onAction(action, employee); }} className="block w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-600 hover:bg-slate-50">
                      {action}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          <p className="mt-2 truncate text-xs font-bold text-slate-800">{employee.designation || 'No designation'}</p>
          <p className="truncate text-xs font-medium text-slate-500">{employee.department || 'No department'} · {employee.business || 'No business'}</p>
          <p className="truncate text-xs font-medium text-slate-500">{employee.email || employee.mobile || 'No contact details'}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <UserStatusBadge status={employee.accountStatus} />
            <UserStatusBadge status={employee.loginLabel} />
            <UserStatusBadge status={employee.provisioningLabel} />
            {!employee.webAccess ? <UserStatusBadge status="Web disabled" /> : null}
            {!employee.mobileAccess ? <UserStatusBadge status="Mobile disabled" /> : null}
          </div>
        </div>
      </div>
    </article>
  );
}
