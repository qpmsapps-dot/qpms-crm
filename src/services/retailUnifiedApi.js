import {authenticatedApiRequest} from './api.js';
const base='/api/reliance-retail/unified-master';
const request=async config=>(await authenticatedApiRequest(config)).data.result;
const upload=async(operation,file,stamp)=>request({method:'POST',url:base+'/'+operation,data:await file.arrayBuffer(),headers:{'Content-Type':'application/octet-stream','x-file-name':encodeURIComponent(file.name),...(stamp?{'x-preview-stamp':stamp}:{})}});
export const retailUnifiedApi={snapshot:params=>request({url:base,params}),preview:file=>upload('preview',file),stage:(file,stamp)=>upload('stage',file,stamp),pending:data=>request({method:'POST',url:base+'/pending-store',data}),propose:data=>request({method:'POST',url:base+'/propose',data}),decide:data=>request({method:'POST',url:base+'/decide',data}),apply:proposal_id=>request({method:'POST',url:base+'/apply',data:{proposal_id}})};
