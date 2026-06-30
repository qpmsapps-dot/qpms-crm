const classes = {
  Active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Inactive: 'bg-slate-100 text-slate-700 ring-slate-200',
  Provisioned: 'bg-sky-50 text-sky-700 ring-sky-200',
  'Unknown provisioning': 'bg-amber-50 text-amber-800 ring-amber-200',
  'Failed provisioning': 'bg-rose-50 text-rose-700 ring-rose-200',
  'Profile Only': 'bg-amber-50 text-amber-800 ring-amber-200',
  'Login Enabled': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'Invite Sent': 'bg-sky-50 text-sky-700 ring-sky-200',
  'Manual Setup Link Generated': 'bg-violet-50 text-violet-700 ring-violet-200',
  'Password Set / Accepted': 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'Password Change Required': 'bg-amber-50 text-amber-800 ring-amber-200',
  'Web disabled': 'bg-violet-50 text-violet-700 ring-violet-200',
  'Mobile disabled': 'bg-indigo-50 text-indigo-700 ring-indigo-200',
};

export default function UserStatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${classes[status] || classes['Unknown provisioning']}`}>
      {status || 'Unknown provisioning'}
    </span>
  );
}
