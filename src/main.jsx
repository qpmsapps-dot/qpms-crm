import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { WorkflowProvider } from './context/WorkflowContext.jsx';
import { isTenderDemoModeEnabled } from './config/tenderDemo.js';
import { router } from './routes/AppRoutes.jsx';
import './index.css';

const app = isTenderDemoModeEnabled() ? (
  <RouterProvider router={router} />
) : (
  <AuthProvider>
    <WorkflowProvider>
      <RouterProvider router={router} />
    </WorkflowProvider>
  </AuthProvider>
);

createRoot(document.getElementById('root')).render(<StrictMode>{app}</StrictMode>);
