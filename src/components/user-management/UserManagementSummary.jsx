export default function UserManagementSummary({ employees, total }) {
  const stats = [
    ['Total Users', total],
    ['Active on Page', employees.filter((item) => item.isActive).length],
    ['Inactive on Page', employees.filter((item) => !item.isActive).length],
    ['Provisioned on Page', employees.filter((item) => item.provisioningStatus === 'provisioned').length],
    ['Access Disabled', employees.filter((item) => !item.webAccess || !item.mobileAccess).length],
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {stats.map(([label, value]) => (
        <article key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{value || 0}</p>
        </article>
      ))}
    </section>
  );
}
