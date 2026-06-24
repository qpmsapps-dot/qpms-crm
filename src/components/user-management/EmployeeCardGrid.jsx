import EmployeeCard from './EmployeeCard.jsx';

export default function EmployeeCardGrid({ employees, onOpen, onAction }) {
  if (!employees.length) {
    return <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">No employees match the current filters.</div>;
  }

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {employees.map((employee) => (
        <EmployeeCard key={employee.id} employee={employee} onOpen={onOpen} onAction={onAction} />
      ))}
    </section>
  );
}
