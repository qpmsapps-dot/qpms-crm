import { Bell, Building, ShieldCheck, UserCog, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';

const settings = [
  { title: 'Company profile', description: 'Manage myQPMS identity, logo, address, and workspace details.', icon: Building },
  { title: 'User roles', description: 'Configure access levels for administrators, managers, and agents.', icon: UserCog },
  { title: 'User Management', description: 'Preview employee hierarchy, HOD mapping, imports, and app account onboarding.', icon: Users, to: '/settings/user-management' },
  { title: 'Notifications', description: 'Set ticket, task, SLA, and approval notification preferences.', icon: Bell },
  { title: 'Security', description: 'Prepare authentication, session, and audit settings for backend integration.', icon: ShieldCheck },
];

export default function Settings() {
  usePageTitle('Settings');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
      />

      <section className="grid gap-4 md:grid-cols-2">
        {settings.map((item) => {
          const content = (
            <div className="flex gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-qpms-50 text-qpms-600">
                <item.icon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-950">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
              </div>
            </div>
          );

          return item.to ? (
            <Link key={item.title} to={item.to} className="enterprise-card-compact block p-5 focus-ring">
              {content}
            </Link>
          ) : (
            <article key={item.title} className="enterprise-card-compact p-5">
              {content}
            </article>
          );
        })}
      </section>
    </div>
  );
}
