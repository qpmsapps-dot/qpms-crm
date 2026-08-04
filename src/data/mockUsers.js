export const mockUsers = [
  {
    id: 'md',
    name: 'Bharath',
    email: 'md@qpms.co.in',
    password: '123456',
    role: 'MD',
    access: 'Enterprise operational visibility and final approval oversight',
  },
  {
    id: 'admin',
    name: 'Admin',
    email: 'admin@qpms.co.in',
    password: '123456',
    role: 'Admin',
    access: 'Full system access',
  },
  {
    id: 'bd-head',
    name: 'BD Head',
    email: 'bdhead@qpms.co.in',
    password: '123456',
    role: 'BD Head',
    access: 'BD department workflow oversight',
  },
  {
    id: 'bd-1',
    name: 'Ananya Rao',
    email: 'bd1@qpms.co.in',
    password: '123456',
    role: 'BD Executive',
    access: 'Own leads, MOMs, site visits, and estimations',
  },
  {
    id: 'bd-2',
    name: 'Karthik Menon',
    email: 'bd2@qpms.co.in',
    password: '123456',
    role: 'BD Executive',
    access: 'Own leads, MOMs, site visits, and estimations',
  },
  {
    id: 'bd-3',
    name: 'Nisha Iyer',
    email: 'bd3@qpms.co.in',
    password: '123456',
    role: 'BD Executive',
    access: 'Own leads, MOMs, site visits, and estimations',
  },
  {
    id: 'operations-1',
    name: 'Operations Reviewer 1',
    email: 'operations1@qpms.co.in',
    password: '123456',
    role: 'Operations Team',
    access: 'Operational feasibility and execution readiness review',
  },
  {
    id: 'operations-2',
    name: 'Operations Reviewer 2',
    email: 'operations2@qpms.co.in',
    password: '123456',
    role: 'Operations Team',
    access: 'Operational feasibility and execution readiness review',
  },
  {
    id: 'coordinator-1',
    name: 'Coordinator 1',
    email: 'coordinator1@qpms.co.in',
    password: '123456',
    role: 'Coordinator',
    access: 'Costing readiness, reliever, and zone review',
  },
  {
    id: 'coordinator-2',
    name: 'Coordinator 2',
    email: 'coordinator2@qpms.co.in',
    password: '123456',
    role: 'Coordinator',
    access: 'Costing readiness, reliever, and zone review',
  },
  {
    id: 'commercial-1',
    name: 'Commercial Team 1',
    email: 'commercial1@qpms.co.in',
    password: '123456',
    role: 'Commercial Reviewer',
    access: 'Commercial review queue and approval actions',
  },
  {
    id: 'commercial-2',
    name: 'Commercial Team 2',
    email: 'commercial2@qpms.co.in',
    password: '123456',
    role: 'Commercial Reviewer',
    access: 'Commercial review queue and approval actions',
  },
  {
    id: 'finance-1',
    name: 'Finance Team 1',
    email: 'finance1@qpms.co.in',
    password: '123456',
    role: 'Finance Reviewer',
    access: 'Finance review queue and approval actions',
  },
  {
    id: 'finance-2',
    name: 'Finance Team 2',
    email: 'finance2@qpms.co.in',
    password: '123456',
    role: 'Finance Reviewer',
    access: 'Finance review queue and approval actions',
  },
  {
    id: 'hr-1',
    name: 'HR Reviewer 1',
    email: 'hr1@qpms.co.in',
    password: '123456',
    role: 'HR Reviewer',
    access: 'HR manpower and wage review queue',
  },
  {
    id: 'hr-2',
    name: 'HR Reviewer 2',
    email: 'hr2@qpms.co.in',
    password: '123456',
    role: 'HR Reviewer',
    access: 'HR manpower and wage review queue',
  },
  {
    id: 'finance-gm',
    name: 'Finance GM',
    email: 'financegm@qpms.co.in',
    password: '123456',
    role: 'Finance GM',
    access: 'Proposal financial approval and escalation oversight',
  },
  {
    id: 'cfo',
    name: 'CFO',
    email: 'cfo@qpms.co.in',
    password: '123456',
    role: 'CFO',
    access: 'Proposal value and financial approval oversight',
  },
  {
    id: 'coo',
    name: 'COO',
    email: 'coo@qpms.co.in',
    password: '123456',
    role: 'COO',
    access: 'Operational monitoring and proposal approval oversight',
  },
  {
    id: 'gm',
    name: 'General Manager',
    email: 'gm@qpms.co.in',
    password: '123456',
    role: 'GM / Top Management',
    access: 'Enterprise monitoring and lead assignment oversight',
  },
  {
    id: 'existing-operations',
    name: 'Existing Business Operations',
    email: 'existingoperations@qpms.co.in',
    password: '123456',
    role: 'Existing Business Operations Team',
    access: 'Active site and field operations monitoring',
  },
  {
    id: 'client-1',
    name: 'Client User 1',
    email: 'client1@qpms.co.in',
    password: '123456',
    role: 'Client Login',
    access: 'Client service interaction access',
  },
];

export const bdExecutives = mockUsers.filter((user) => user.role === 'BD Executive');
export const commercialTeamUsers = mockUsers.filter((user) => user.role === 'Commercial Reviewer');
export const financeTeamUsers = mockUsers.filter((user) => user.role === 'Finance Reviewer');
export const hrReviewerUsers = mockUsers.filter((user) => user.role === 'HR Reviewer');
export const operationsTeamUsers = mockUsers.filter((user) => user.role === 'Operations Team');
export const coordinatorUsers = mockUsers.filter((user) => user.role === 'Coordinator');

export function isCommercialTeam(user) {
  return ['Commercial Reviewer', 'Commercial Team', 'Commercial'].includes(user?.role);
}

export function isFinanceTeam(user) {
  return ['Finance Reviewer', 'Finance Team', 'Finance'].includes(user?.role);
}

export function isHrReviewer(user) {
  return user?.role === 'HR Reviewer';
}

export function isOperationsTeam(user) {
  return ['Operations Team', 'Operations Manager', 'Business Head', 'Branch Head', 'KAM'].includes(user?.role);
}

export function isCoordinator(user) {
  return user?.role === 'Coordinator';
}

export function isManagement(user) {
  return ['MD', 'Admin', 'DEMO_ADMIN', 'COO', 'Management', 'GM', 'Top Management', 'GM / Top Management'].includes(user?.role);
}

export function isFinanceLeadership(user) {
  return ['Finance GM', 'CFO'].includes(user?.role);
}

export function isAdmin(user) {
  return ['Admin', 'QPMS Admin', 'Developer', 'DEMO_ADMIN'].includes(user?.role);
}

export function isExistingBusinessOperations(user) {
  return user?.role === 'Existing Business Operations Team';
}

export function isFieldOfficer(user) {
  return ['Field Officer', 'FO'].includes(user?.role);
}

export function isApprovalReviewer(user) {
  return isCommercialTeam(user) || isFinanceTeam(user) || isHrReviewer(user) || isOperationsTeam(user) || isCoordinator(user);
}

export function canManageLeads(user) {
  return ['BD Head', 'BD Executive', 'Business Head', 'Branch Head', 'Admin', 'QPMS Admin', 'Developer'].includes(user?.role) || isManagement(user);
}

export function canViewBdTeam(user) {
  return ['BD Head', 'Business Head', 'Branch Head', 'Admin', 'QPMS Admin', 'Developer', 'DEMO_VIEWER'].includes(user?.role) || isManagement(user) || isFinanceLeadership(user);
}

export function findMockUser(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  return mockUsers.find((user) => (user.email === normalizedEmail || user.username?.toLowerCase() === normalizedEmail) && user.password === password);
}

export function getExecutiveByName(name) {
  return bdExecutives.find((user) => user.name === name);
}
