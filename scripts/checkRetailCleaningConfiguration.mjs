import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function checkMobileCleaningConfiguration(values={}) {
 const errors=[];
 const names=['SUPABASE_URL','SUPABASE_ANON_KEY','BACKEND_API_URL'];
 const present=Object.fromEntries(names.map(name=>[name,typeof values[name]==='string'&&values[name].trim().length>0]));
 for(const name of names)if(!present[name])errors.push(`${name}: missing`);
 if(Object.keys(values).some(name=>/SERVICE_ROLE|SERVICE_KEY|SECRET_KEY|DATABASE_URL|PGPASSWORD/.test(name)))errors.push('Backend credential variable is forbidden in Android configuration');
 for(const name of ['SUPABASE_URL','BACKEND_API_URL'])if(present[name]){
  try{const url=new URL(values[name]);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)errors.push(`${name}: use an HTTPS base URL without credentials, query or fragment`);if(name==='SUPABASE_URL'&&url.pathname!=='/')errors.push('SUPABASE_URL: use project base URL, without /rest/v1');}catch{errors.push(`${name}: invalid URL`);}
 }
 if(present.SUPABASE_ANON_KEY){
  const key=values.SUPABASE_ANON_KEY.trim();
  if(key.startsWith('sb_secret_'))errors.push('SUPABASE_ANON_KEY: backend secret key is forbidden');
  else if(!key.startsWith('sb_publishable_')){
   try{const payload=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());if(payload.role!=='anon')errors.push('SUPABASE_ANON_KEY: expected public anon role');if(payload.ref&&present.SUPABASE_URL&&new URL(values.SUPABASE_URL).hostname.split('.')[0]!==payload.ref)errors.push('SUPABASE_ANON_KEY: project does not match SUPABASE_URL');}catch{errors.push('SUPABASE_ANON_KEY: expected public anon/publishable key');}
  }
 }
 return{ok:errors.length===0,configured:present,errors,values_printed:false,apk_built:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const at=process.argv.indexOf('--mobile-config');
 if(at<0||!process.argv[at+1]){console.error('Usage: node scripts/checkRetailCleaningConfiguration.mjs --mobile-config <private JSON path>');process.exitCode=2;}
 else{try{const result=checkMobileCleaningConfiguration(JSON.parse(fs.readFileSync(process.argv[at+1],'utf8')));console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;}catch{console.error('Cannot read/parse private configuration JSON; no values printed.');process.exitCode=1;}}
}
