import { authenticatedApiRequest } from './api.js';

async function request(config) {
  const response = await authenticatedApiRequest(config);
  return response.data;
}

export const relianceRetailApi = {
  access: () => request({ url: '/api/reliance-retail/access' }),
  dashboard: (params) => request({ url: '/api/reliance-retail/dashboard', params }),
  stores: (params) => request({ url: '/api/reliance-retail/stores', params }),
  createStore: (data) => request({ method: 'POST', url: '/api/reliance-retail/stores', data }),
  updateStore: (id, data) => request({ method: 'PATCH', url: `/api/reliance-retail/stores/${id}`, data }),
  moveStore: (id, data) => request({ method: 'POST', url: `/api/reliance-retail/stores/${id}/zone`, data }),
  saveBudget: (id, data) => request({ method: 'PUT', url: `/api/reliance-retail/stores/${id}/manpower`, data }),
  zones: (params) => request({ url: '/api/reliance-retail/zones', params }),
  createZone: (data) => request({ method: 'POST', url: '/api/reliance-retail/zones', data }),
  updateZone: (id, data) => request({ method: 'PATCH', url: `/api/reliance-retail/zones/${id}`, data }),
  assignZoneFo: (id, data) => request({ method: 'PUT', url: `/api/reliance-retail/zones/${id}/fo`, data }),
  syncFoZones: (profileId, zone_ids) => request({ method: 'PUT', url: `/api/reliance-retail/fos/${profileId}/zones`, data: { zone_ids } }),
  employees: () => request({ url: '/api/reliance-retail/fos' }),
  history: () => request({ url: '/api/reliance-retail/history' }),
};
