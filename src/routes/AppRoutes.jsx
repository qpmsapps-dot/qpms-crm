import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import App from '../App.jsx';
import MainLayout from '../layouts/MainLayout.jsx';
import AccountDeletion from '../pages/AccountDeletion.jsx';
import Login from '../pages/Login.jsx';
import Profile from '../pages/Profile.jsx';
import SetPassword from '../pages/SetPassword.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import CRM from '../pages/CRM.jsx';
import Sites from '../pages/Sites.jsx';
import Tasks from '../pages/Tasks.jsx';
import Employees from '../pages/Employees.jsx';
import Settings from '../pages/Settings.jsx';
import StoreMaster from '../pages/StoreMaster.jsx';
import Tickets from '../pages/Tickets.jsx';
import FaultTracker from '../pages/FaultTracker.jsx';
import DeepCleaning from '../pages/DeepCleaning.jsx';
import UserManagement from '../pages/settings/UserManagement.jsx';
import { isDemoMode } from '../config/demoMode.js';
import { isSiteVisitV2Enabled } from '../config/siteVisitFeature.js';
import {
  AssetCenterPage,
  ApprovalCenterPage,
  ExistingBusinessPage,
  ProposalCenterPage,
  ReportingCenterPage,
  SiteMonitoringPage,
} from '../pages/OperationalModules.jsx';

const FOActivities = lazy(() => import('../pages/FOActivities.jsx'));

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/login" replace /> },
      { path: 'login', element: <Login /> },
      { path: 'set-password', element: <SetPassword /> },
      { path: 'account-deletion', element: <AccountDeletion /> },
      {
        element: <MainLayout />,
        children: [
          { path: 'dashboard', element: <Dashboard /> },
          { path: 'crm', element: <CRM /> },
          { path: 'sites', element: isSiteVisitV2Enabled ? <Sites /> : <Navigate to="/dashboard" replace /> },
          { path: 'site-visit/:id', element: isSiteVisitV2Enabled ? <Sites /> : <Navigate to="/dashboard" replace /> },
          { path: 'site-monitoring', element: <SiteMonitoringPage /> },
          { path: 'proposals', element: <ProposalCenterPage /> },
          { path: 'approvals', element: <ApprovalCenterPage /> },
          { path: 'existing-business', element: <ExistingBusinessPage /> },
          { path: 'tickets', element: <Tickets /> },
          { path: 'fault-tracker', element: <FaultTracker /> },
          { path: 'deep-cleaning', element: <DeepCleaning /> },
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
          { path: 'store-master', element: <StoreMaster /> },
          { path: 'employees', element: isDemoMode ? <Navigate to="/dashboard" replace /> : <Employees /> },
          { path: 'settings', element: <Settings /> },
          { path: 'settings/user-management', element: <UserManagement /> },
          { path: 'profile', element: <Profile /> },
        ],
      },
      { path: '*', element: <Navigate to="/login" replace /> },
    ],
  },
]);
