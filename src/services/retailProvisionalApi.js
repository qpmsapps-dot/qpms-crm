import { authenticatedApiRequest } from './api.js';
const base = '/api/reliance-retail/provisional-stores';
async function request(config) { return (await authenticatedApiRequest(config)).data.result; }
export const retailProvisionalApi = {
  review: () => request({ url: base }),
  upload: file => request({ method: 'POST', url: `${base}/upload`, data: file, headers: { 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) } }),
  propose: data => request({ method: 'POST', url: `${base}/propose`, data }),
  decide: data => request({ method: 'POST', url: `${base}/decide`, data }),
  withdraw: data => request({ method: 'POST', url: `${base}/withdraw`, data }),
};
