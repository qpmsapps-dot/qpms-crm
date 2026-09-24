import { Navigate, useLocation } from 'react-router-dom';
import CRM from '../pages/CRM.jsx';

export default function LegacyCrmRoute() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  return params.get('workspace') === 'pre-sales' && params.get('action') === 'add'
    ? <Navigate to="/pre-sales/leads/new" replace />
    : <CRM />;
}
