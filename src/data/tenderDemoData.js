export const tenderDemoModules = [
  { key: 'dashboard', label: 'Dashboard', route: '/demo/dashboard', noun: 'summary' },
  { key: 'leads', label: 'Lead Management', route: '/demo/leads', noun: 'lead' },
  { key: 'site-visits', label: 'Site Visit + Estimation', route: '/demo/site-visits', noun: 'visit' },
  { key: 'hr-review', label: 'HR Review', route: '/demo/hr-review', noun: 'review' },
  { key: 'commercial-review', label: 'Commercial Review', route: '/demo/commercial-review', noun: 'review' },
  { key: 'finance-review', label: 'Finance Review', route: '/demo/finance-review', noun: 'review' },
  { key: 'proposals', label: 'Proposals', route: '/demo/proposals', noun: 'proposal' },
  { key: 'approvals', label: 'Approvals', route: '/demo/approvals', noun: 'approval' },
  { key: 'existing-business', label: 'Existing Business', route: '/demo/existing-business', noun: 'contract' },
  { key: 'operations', label: 'Operations', route: '/demo/operations', noun: 'operation' },
  { key: 'tickets', label: 'Tickets', route: '/demo/tickets', noun: 'ticket' },
  { key: 'soft-services-feedback', label: 'Soft Services Feedback', route: '/demo/soft-services-feedback', noun: 'feedback' },
  { key: 'fault-tracker', label: 'Fault Tracker', route: '/demo/fault-tracker', noun: 'fault' },
  { key: 'deep-cleaning', label: 'Deep Cleaning', route: '/demo/deep-cleaning', noun: 'task' },
  { key: 'asset-management', label: 'Asset Management', route: '/demo/asset-management', noun: 'asset' },
  { key: 'reports', label: 'Reports', route: '/demo/reports', noun: 'report' },
];

export const tenderDemoBlockedLabels = [
  'Store Master',
  'Settings',
  'User Management',
  'Employee Management',
  'Roles and Permissions',
  'Access Management',
  'Password tools',
  'Integrations',
  'Audit logs',
];

const owners = ['Aarav Mehta', 'Diya Raman', 'Kabir Iyer', 'Meera Nair', 'Rohan Shah'];
const sites = ['Orion Tech Park', 'Lotus Medical Centre', 'Bluebay Mall', 'Vertex Campus', 'Northline Tower'];

export function buildTenderDemoRecords(moduleKey) {
  return Array.from({ length: 8 }, (_, index) => {
    const id = `${moduleKey}-${index + 1}`;
    const statusCycle = ['Open', 'In Review', 'Approved', 'Rejected', 'Closed'];
    const priorityCycle = ['Low', 'Medium', 'High', 'Critical'];
    return {
      id,
      title: `${sites[index % sites.length]} ${moduleKey.replaceAll('-', ' ')} ${index + 1}`,
      owner: owners[index % owners.length],
      site: sites[index % sites.length],
      status: statusCycle[index % statusCycle.length],
      priority: priorityCycle[index % priorityCycle.length],
      amount: 125000 + index * 37500,
      updatedAt: `0${(index % 5) + 1} Aug 2026`,
      notes: 'Fictional sample record for tender demonstration workflows.',
    };
  });
}
