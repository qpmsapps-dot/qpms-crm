export const ticketSummary = [
  { label: 'Total Tickets', value: 247, trend: '↑ 12% vs last 7 days', tone: 'blue' },
  { label: 'Open', value: 68, trend: '↗ 8% vs last 7 days', tone: 'orange' },
  { label: 'Assigned', value: 96, trend: '↗ 15% vs last 7 days', tone: 'purple' },
  { label: 'Closed', value: 83, trend: '↗ 18% vs last 7 days', tone: 'green' },
];

export const mockTickets = [
  { id: 'TKT-2024-0512', client: 'Jio', site: 'QPMS HQ', category: 'HVAC', priority: 'High', status: 'Open', assignee: 'Unassigned', created: '20 May 2024 09:15 AM', title: 'Air conditioning failure in meeting room' },
  { id: 'TKT-2024-0511', client: 'Reliance', site: 'Trends Pallavaram', category: 'Electrical', priority: 'Medium', status: 'Assigned', assignee: 'QPMSTN6702 / M. Karthik', created: '20 May 2024 04:40 AM', title: 'Intermittent power issue near billing counter' },
  { id: 'TKT-2024-0510', client: 'Jio', site: 'Airport Site (T2)', category: 'Plumbing', priority: 'High', status: 'In Progress', assignee: 'QPMSTN5702 / M. Karthik', created: '19 May 2024 03:25 PM', title: 'Water Leakage in Restroom – Near Gate A' },
  { id: 'TKT-2024-0509', client: 'Reliance', site: 'Reliance Digital MG Road', category: 'CCTV', priority: 'Low', status: 'Escalated', assignee: 'QPMSECO318 / Venkatesan Kumar', created: '19 May 2024 11:10 AM', title: 'Camera feed unavailable at loading bay' },
  { id: 'TKT-2024-0508', client: 'Jio', site: 'Retail Store Coimbatore', category: 'Access Control', priority: 'Medium', status: 'Assigned', assignee: 'QPMSTN5702 / M. Karthik', created: '18 May 2024 06:55 PM', title: 'Staff access reader not responding' },
  { id: 'TKT-2024-0507', client: 'Air India', site: 'Chennai Airport', category: 'HVAC', priority: 'High', status: 'Closed', assignee: 'QPMSKL0318', created: '18 May 2024 04:20 PM', title: 'Departure lounge cooling restored' },
  { id: 'TKT-2024-0506', client: 'Reliance', site: 'Trends Pune', category: 'Plumbing', priority: 'Low', status: 'Closed', assignee: 'QPMSTN1105 / Ramesh B', created: '17 May 2024 05:30 PM', title: 'Wash basin drainage blockage' },
];

export const featuredTicketDetails = {
  contact: 'Ravi Kumar',
  contactPhone: '+91 98765 43210',
  createdOn: '19 May 2024, 03:25 PM',
  slaDue: '20 May 2024, 03:25 PM',
  slaRemaining: '03h 45m left',
  description: 'Water leakage observed in the men’s restroom near Gate A. Water dripping from ceiling and wall. Floor is wet and causing inconvenience to passengers. Immediate attention required.',
  activity: [
    { role: 'Client', message: 'Water leakage is getting worse. Please fix this urgently.', time: '19 May 2024, 03:25 PM', tone: 'pink' },
    { role: 'Operations Manager', message: 'Issue received and logged. Our team is looking into it.', time: '19 May 2024, 03:35 PM', tone: 'blue' },
    { role: 'Branch Head', message: 'Assigning to FO. Please acknowledge and act ASAP.', time: '19 May 2024, 03:50 PM', tone: 'slate' },
    { role: 'GM', message: 'Escalated due to high passenger impact. Keep updated.', time: '19 May 2024, 04:05 PM', tone: 'orange' },
    { role: 'Field Officer', message: 'Reached site. Starting inspection and root cause check.', time: '19 May 2024, 04:20 PM', tone: 'amber' },
    { role: 'Field Officer', message: 'Leakage source identified. Replacement in progress.', time: '19 May 2024, 05:10 PM', tone: 'amber' },
  ],
  statusFlow: [
    { label: 'Raised', time: '19 May, 03:25 PM', state: 'complete' },
    { label: 'Assigned', time: '19 May, 03:35 PM', state: 'complete' },
    { label: 'Accepted', time: '19 May, 04:20 PM', state: 'complete' },
    { label: 'In Progress', time: '19 May, 04:20 PM', state: 'active' },
    { label: 'Escalated', time: '', state: 'pending' },
    { label: 'Resolved', time: '', state: 'pending' },
  ],
  history: [
    '19 May, 03:35 PM — Ticket assigned to FO M. Karthik',
    '19 May, 03:35 PM — Client notified',
    '19 May, 05:10 PM — Status updated to In Progress',
    '19 May, 05:10 PM — Client notified',
  ],
};
