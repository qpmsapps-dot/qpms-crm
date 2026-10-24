import { authenticatedApiRequest } from './api.js';
const base = '/api/reliance-retail/attendance';
async function request(config) { return (await authenticatedApiRequest(config)).data; }
export const retailAttendanceApi = {
  summary: params => request({ url: `${base}/summary`, params }),
  employees: params => request({ url: `${base}/employees`, params }),
  preview: file => request({ method: 'POST', url: `${base}/preview`, data: file,
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, timeout: 120000 }),
  commit: data => request({ method: 'POST', url: `${base}/commit`, data }),
};
