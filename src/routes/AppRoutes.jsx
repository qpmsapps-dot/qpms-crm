import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import App from '../App.jsx';
import MainLayout from '../layouts/MainLayout.jsx';
import Login from '../pages/Login.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import CRM from '../pages/CRM.jsx';
import Sites from '../pages/Sites.jsx';
import Tasks from '../pages/Tasks.jsx';
import Employees from '../pages/Employees.jsx';
import Settings from '../pages/Settings.jsx';
import UserManagement from '../pages/settings/UserManagement.jsx';
import { isDemoMode } from '../config/demoMode.js';
import {
  AssetCenterPage,
  ApprovalCenterPage,
  ExistingBusinessPage,
  ProposalCenterPage,
  ReportingCenterPage,
  SiteMonitoringPage,
  TicketCenterPage,
} from '../pages/OperationalModules.jsx';

const FOActivities = lazy(() => import('../pages/FOActivities.jsx'));

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/login" replace /> },
      { path: 'login', element: <Login /> },
      {
        element: <MainLayout />,
        children: [
          { path: 'dashboard', element: <Dashboard /> },
          { path: 'crm', element: <CRM /> },
          { path: 'sites', element: <Sites /> },
          { path: 'site-visit/:id', element: <Sites /> },
          { path: 'site-monitoring', element: <SiteMonitoringPage /> },
          { path: 'proposals', element: <ProposalCenterPage /> },
          { path: 'approvals', element: <ApprovalCenterPage /> },
          { path: 'existing-business', element: <ExistingBusinessPage /> },
          { path: 'tickets', element: <TicketCenterPage /> },
          { path: 'assets', element: <AssetCenterPage /> },
          { path: 'tasks', element: <Tasks /> },
          {
            path: 'fo-activities',
            element: (
              <Suspense fallback={<div className="enterprise-card p-6 text-sm font-semibold text-slate-500">Loading field operations map...</div>}>
                <FOActivities />
              </Suspense>
            ),
          },
          { path: 'reports', element: <ReportingCenterPage /> },
          { path: 'employees', element: isDemoMode ? <Navigate to="/dashboard" replace /> : <Employees /> },
          { path: 'settings', element: <Settings /> },
          { path: 'settings/user-management', element: <UserManagement /> },
        ],
      },
      { path: '*', element: <Navigate to="/login" replace /> },
    ],
  },
]);
