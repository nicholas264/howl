// Isolated review environment: synthetic local PostgreSQL, simulated Gmail, no production credentials.
import {createServer} from 'vite';
import {PGlite} from '@electric-sql/pglite';
import {neon} from '@neondatabase/serverless';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {useTestDatabase} from '../tests/neon-test-adapter.mjs';
import {ensureRateLimits} from '../api/_lib/rate-limit.js';
import {ensureDealerIntake} from '../api/_lib/dealer-intake.js';
import {createDealerIntakeHandler} from '../api/dealer-intake.js';
import {ensureCrm} from '../api/_lib/crm.js';
import {ensureGoogleOAuthTables} from '../api/_lib/google-user-oauth.js';
import {initializeSchema} from '../api/db/schema.js';
import {ensureLaunchDrafts} from '../api/_lib/launch-drafts.js';
import {createCrmEmailHandler} from '../api/crm-email.js';
import {createCrmHandler} from '../api/crm.js';
import {ROLE_PERMISSIONS} from '../api/_lib/app-access.js';
if(process.env.NODE_ENV==='production')throw new Error('Local preview only.');
for(const key of Object.keys(process.env))if(/^(VITE_|DATABASE_|GOOGLE_|CLERK_|VERCEL_|AUTH_)/.test(key))delete process.env[key];
Object.assign(process.env,{NODE_ENV:'development',AUTH_DISABLED:'true',VITE_AUTH_DISABLED:'true',DATABASE_URL:'postgres://test:test@localhost/crm_preview'});
// Prevent accidental calls to external providers even if an unrelated app feature is opened.
globalThis.fetch=async()=>{throw new Error('External requests are disabled in the isolated CRM preview.');};
const directory=await mkdtemp(join(tmpdir(),'campfire-crm-preview-'));
const db=new PGlite(directory);useTestDatabase(db);const sql=neon(process.env.DATABASE_URL);
await initializeSchema(sql);await ensureCrm(sql);await ensureDealerIntake(sql);await ensureRateLimits(sql);await ensureGoogleOAuthTables(sql);await ensureLaunchDrafts(sql);
const authorize=async()=>({sql,userId:'local-dev',role:'owner',permissions:ROLE_PERMISSIONS.owner});
const crm=createCrmHandler({authorize});
for(const [company,title,stage,value,nextAction] of [['Sample Outdoor Co.','Opening assortment','new',2400,'Introduce the HOWL lineup'],['Sample Trail Supply','Fall restock','contacted',5600,'Call the store buyer'],['Sample Camp Store','Holiday floor display','qualified',8200,'Confirm display space'],['Sample Outfitters','Three-store rollout','proposal',12500,'Review the proposal'],['Sample Basecamp','First order','won',3600,'']]) {
 const id=randomUUID();await crm({method:'POST',body:{action:'create',id,requestId:randomUUID(),data:{company,title,stage,value,nextAction,owner:'Roy',followUp:stage==='won'?'':'2026-09-24',closeDate:'',contacts:[{name:'Sample buyer',email:'buyer@example.com',phone:''}],notes:'Synthetic preview record.'}}},{setHeader(){},status(){return this;},json(){}});
}
const emailHandler=createCrmEmailHandler({authorize,getConnection:async()=>({google_email:'roy-preview@example.com',scopes:['https://www.googleapis.com/auth/gmail.send']}),getToken:async()=>'simulation',fetchImpl:async()=>Response.json({id:'simulated-'+randomUUID()})});
const intake=createDealerIntakeHandler({getSql:()=>sql});
const previewPlugin={name:'isolated-crm-review',enforce:'pre',transformIndexHtml(html){return html.replace('<body>','<body><div style="background:#285840;color:white;padding:9px 16px;font:13px sans-serif;text-align:center">Local CRM preview · Sample data · Email sending is simulated</div>');},configureServer(server){server.middlewares.use(async(req,res,next)=>{
 const url=new URL(req.url,'http://localhost');if(url.pathname==='/dealer-intake'){req.url='/dealer-intake.html';return next();}if(!['/api/crm-email','/api/dealer-intake'].includes(url.pathname))return next();
 const chunks=[];for await(const c of req)chunks.push(c);req.query=Object.fromEntries(url.searchParams);req.body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
 res.status=code=>{res.statusCode=code;return res;};res.json=body=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};if(url.pathname==='/api/dealer-intake'){req.headers.origin='https://welcometothecampfire.io';await intake(req,res);}else await emailHandler(req,res);
});}};
const server=await createServer({plugins:[previewPlugin],server:{host:'127.0.0.1',port:5190,strictPort:true}});await server.listen();
console.log('Isolated CRM preview: http://127.0.0.1:5190/?tab=crm');
console.log('Preview database:',directory);
