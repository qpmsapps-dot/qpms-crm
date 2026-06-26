import { FileText, Mail, ShieldCheck, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';

const requestSteps = [
  {
    title: 'Step 1',
    body: (
      <>
        Send an email to:{' '}
        <a className="font-bold text-qpms-700 underline decoration-qpms-200 underline-offset-4" href="mailto:qpmsapps@gmail.com">
          qpmsapps@gmail.com
        </a>
      </>
    ),
  },
  {
    title: 'Step 2',
    body: <>Use the subject line: <span className="font-bold text-slate-950">QPMS Account Deletion Request</span></>,
  },
  {
    title: 'Step 3',
    body: (
      <>
        Include the following details:
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>Full name</li>
          <li>Employee code / registered user ID</li>
          <li>Registered mobile number or email ID</li>
          <li>Department / state, if applicable</li>
          <li>Reason for deletion request, optional</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Step 4',
    body: 'QPMS will verify the request and process eligible account deletion as per company policy.',
  },
];

const deletedItems = [
  'App login account',
  'Profile/contact details where eligible',
  'Non-essential personal data linked to the app account',
  'Access permissions assigned to the user',
];

export default function AccountDeletion() {
  usePageTitle('Account Deletion Request');

  return (
    <main className="min-h-screen bg-white text-slate-800">
      <header className="bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[900px] flex-col gap-6 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <Logo className="h-12 w-12" textClassName="[&_p]:text-2xl [&_p]:text-white [&_span]:text-slate-300" />
          <Link
            to="/login"
            className="inline-flex w-fit items-center rounded-full border border-white/20 px-4 py-2 text-sm font-bold text-white/90 transition hover:border-white/40 hover:bg-white/10"
          >
            Back to Login
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-[900px] px-5 py-10 sm:py-14">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_20px_70px_rgba(15,23,42,0.08)] sm:p-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-qpms-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-qpms-700">
            <Trash2 className="h-4 w-4" />
            Public account support
          </div>
          <h1 className="mt-5 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">
            Account Deletion Request – QPMS
          </h1>
          <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-slate-600 sm:text-lg">
            Request deletion of your QPMS app account and eligible associated personal data.
          </p>
        </div>

        <div className="mt-8 space-y-6">
          <InfoCard icon={<ShieldCheck className="h-5 w-5" />} title="About QPMS Account Management">
            <p>
              QPMS is an organization-managed internal business operations application used by authorized employees,
              field officers, managers, business users, and clients of QP Management Services Pvt. Ltd.
            </p>
            <p>
              User accounts in QPMS are created and managed by authorized QPMS administrators. QPMS does not provide
              open public account creation. When an employee leaves the organization or access is no longer required,
              QPMS administrators may deactivate or delete the user’s app login account.
            </p>
            <p>
              This page explains how users can request deletion of their QPMS app account and eligible associated
              personal data.
            </p>
          </InfoCard>

          <InfoCard icon={<Mail className="h-5 w-5" />} title="How to Request Account Deletion">
            <div className="grid gap-4">
              {requestSteps.map((step) => (
                <div key={step.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-black uppercase tracking-wide text-qpms-700">{step.title}</p>
                  <div className="mt-2 text-sm font-semibold leading-6 text-slate-700">{step.body}</div>
                </div>
              ))}
            </div>
          </InfoCard>

          <InfoCard icon={<Trash2 className="h-5 w-5" />} title="What Data May Be Deleted">
            <ul className="list-disc space-y-2 pl-5">
              {deletedItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </InfoCard>

          <InfoCard icon={<FileText className="h-5 w-5" />} title="What Data May Be Retained">
            <p>
              Some records may be retained where required for company operations, attendance records, field visit
              verification, payroll/conveyance, client reporting, audit, legal, security, or compliance purposes.
            </p>
            <p>
              Retained records will be used only for legitimate business, legal, audit, security, or compliance
              requirements.
            </p>
          </InfoCard>

          <InfoCard icon={<ShieldCheck className="h-5 w-5" />} title="Processing Time">
            <p>
              After receiving a valid request, QPMS will verify the user identity and process eligible account deletion
              within a reasonable time. If additional verification is required, the QPMS team may contact the user using
              the registered mobile number or email address.
            </p>
          </InfoCard>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-[900px] flex-col gap-3 px-5 py-6 text-sm font-semibold text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <a className="text-qpms-700 hover:underline" href="https://www.qpms.com/privacy-policy" target="_blank" rel="noreferrer">
              Privacy Policy
            </a>
            <Link className="text-qpms-700 hover:underline" to="/account-deletion">
              Account Deletion Request
            </Link>
          </div>
          <p>Copyright © QPMS Pvt. Ltd.</p>
        </div>
      </footer>
    </main>
  );
}

function InfoCard({ icon, title, children }) {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-qpms-50 text-qpms-700">
          {icon}
        </div>
        <div>
          <h2 className="text-xl font-black text-slate-950">{title}</h2>
          <div className="mt-3 space-y-3 text-sm font-semibold leading-7 text-slate-600 sm:text-base">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
