import { useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import BdOpportunityWork from '../components/preSales/BdOpportunityWork.jsx';
import OpportunityNotifications from '../components/preSales/OpportunityNotifications.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';

const tabs = [
  ['all', 'My Opportunities'],
  ['handover', 'Pending Handovers'],
  ['meetings', 'Meetings & MOM'],
  ['survey', 'Site Survey Progress'],
  ['approvals', 'Approval Tracking'],
  ['proposals', 'Proposals'],
  ['notifications', 'Notifications'],
];

export default function BusinessDevelopment() {
  const [activeTab, setActiveTab] = useState('all');
  usePageTitle('Business Development');

  return <div className="space-y-6">
    <PageHeader
      title="Business Development"
      description="Own assigned opportunities from Pre-Sales acceptance through meeting, survey, approvals, proposal, and client decision."
    />
    <nav aria-label="Business Development workspace" className="overflow-x-auto">
      <div className="inline-flex min-w-full gap-1 rounded-2xl bg-slate-100 p-1">
        {tabs.map(([key, label]) => <button
          key={key}
          type="button"
          onClick={() => setActiveTab(key)}
          className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-bold ${activeTab === key ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600'}`}
        >
          {label}
        </button>)}
      </div>
    </nav>
    {activeTab === 'notifications'
      ? <OpportunityNotifications limit={50} showEmpty />
      : <BdOpportunityWork mode={activeTab} showNotifications={false} />}
  </div>;
}
