import { authenticatedApiRequest } from './api.js';
const base='/api/admin/client-ticketing';
const request=async config=>(await authenticatedApiRequest(config)).data;
export const clientTicketingManagementApi={
  list:()=>request({url:base}),
  draft:id=>request({url:`${base}/${encodeURIComponent(id)}`}),
  save:(id,resource,data)=>request({method:'POST',url:id?`${base}/${encodeURIComponent(id)}/${resource}`:base,data}),
};
