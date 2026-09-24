// Isolated financial preview with real handlers and PostgreSQL semantics.
// No production database, credentials, or external provider requests are used.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { PGlite } from '@electric-sql/pglite';
import { neon } from '@neondatabase/serverless';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTestDatabase } from '../tests/neon-test-adapter.mjs';
import { ensureFinance,encrypt,nonce } from '../api/_lib/finance.js';
import { createFinanceHandler } from '../api/finance.js';
import { env,plan,fixtureFetch } from '../tests/fixtures/finance.mjs';
const db=new PGlite();useTestDatabase(db);const sql=neon('postgres://test:test@localhost/test');await ensureFinance(sql);
if(process.argv.includes('--example')){
 await sql`INSERT INTO finance_workspace(id,settings) VALUES ('company',${JSON.stringify(plan)}::jsonb)`;
 await sql`INSERT INTO finance_connection(id,realm,tokens,expires_at,version,environment,connected_by) VALUES ('company','000-example',${encrypt({access_token:'example-access',refresh_token:'example-refresh'},env)},now()+interval '1 hour',${nonce()},'sandbox','Local owner')`;
}
const handler=createFinanceHandler({authorize:async req=>({sql,userId:'Local owner',role:req.headers['x-finance-preview-role']||'owner'}),env:process.argv.includes('--example')?env:{},fetcher:fixtureFetch});
if(process.argv.includes('--example'))await handler({method:'POST',body:{action:'sync'},headers:{}},{setHeader(){},status(){return this;},json(){}});
const emptyEnv=await mkdtemp(join(tmpdir(),'finance-preview-env-'));
const server=await createServer({configFile:false,root:process.cwd(),envDir:emptyEnv,define:{'import.meta.env.VITE_AUTH_DISABLED':'"true"'},plugins:[react(),{name:'finance-isolated-preview',transformIndexHtml(html){return html.replace('<body>','<body><div style="padding:8px 20px;background:#fff0cc;color:#624513;font:13px Helvetica;text-align:center">Financials local preview · All financial figures are illustrative · No live QuickBooks connection · Changes stay in a temporary database</div>');},configureServer(s){s.middlewares.use(async(req,res,next)=>{
 const url=new URL(req.url,'http://127.0.0.1');if(!url.pathname.startsWith('/api/'))return next();res.status=code=>{res.statusCode=code;return res;};res.json=body=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return res;};
 if(url.pathname!=='/api/finance')return res.json({count:0,records:[],drafts:[]});
 try{let body='';for await(const chunk of req){body+=chunk;if(body.length>200000)return res.status(413).json({error:'Request too large'});}req.body=body?JSON.parse(body):null;if(req.body?.action==='connect')return res.status(400).json({error:'This isolated preview cannot connect to Intuit. Use a configured deployment to authorize your company.'});await handler(req,res);}catch{return res.status(500).json({error:'Preview request failed'});}
 });}}],server:{host:'127.0.0.1',port:5195,strictPort:true}});
await server.listen();console.log('Financials preview: http://127.0.0.1:5195/?tab=finance');
