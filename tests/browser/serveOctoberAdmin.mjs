import {build,preview,mergeConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import base from '../../vite.config.js';
const root=fileURLToPath(new URL('../..',import.meta.url));
process.env.VITE_SUPABASE_URL='';process.env.VITE_SUPABASE_ANON_KEY='';process.env.VITE_API_URL='http://127.0.0.1:4999';
await build(mergeConfig(base,{root,build:{outDir:'tmp/october-admin-ui',emptyOutDir:true,rollupOptions:{input:fileURLToPath(new URL('../browser/fixtures/october-admin.html',import.meta.url))}}}));
await preview({root,build:{outDir:'tmp/october-admin-ui'},preview:{host:'127.0.0.1',port:4198,strictPort:true}});
