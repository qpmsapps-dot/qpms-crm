export default function UserManagementSummary({ employees }) {
  const stats = [
    ['Total Users', employees.length],
    ['Draft', employees.filter((item) => item.accountStatus === 'Draft').length],
    ['Ready to Create', employees.filter((item) => item.accountStatus === 'Ready to Create').length],
    ['Mobile Access Enabled', employees.filter((item) => item.mobileAccess).length],
    ['Disabled', employees.filter((item) => item.accountStatus === 'Disabled').length],
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {stats.map(([label, value]) => (
        <article key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
        </article>
      ))}
    </section>
  );
}
