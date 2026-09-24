// Run real Intuit sandbox OAuth against the production handlers and isolated,
// in-memory PostgreSQL. Configuration is a mode-0600 JSON file outside the repo.
// Never supply production credentials. Stop the process to discard test records.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { PGlite } from '@electric-sql/pglite';
import { neon } from '@neondatabase/serverless';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTestDatabase } from '../tests/neon-test-adapter.mjs';
import { ensureFinance, setup } from '../api/_lib/finance.js';
import { createFinanceHandler } from '../api/finance.js';
import { createQuickBooksCallback } from '../api/quickbooks-callback.js';

const configPath=process.argv[2];
if(!configPath)throw new Error('Supply a protected sandbox configuration JSON path.');
if((await stat(configPath)).mode&0o077)throw new Error('Configuration must be private to its owner (0600).');
const env=JSON.parse(await readFile(configPath,'utf8'));
const origin='http://localhost:5196';
if(env.NODE_ENV!=='development'||env.QUICKBOOKS_ENVIRONMENT!=='sandbox'||env.QUICKBOOKS_REDIRECT_URI!==`${origin}/api/quickbooks-callback`||!setup(env).ready)throw new Error('Only the configured local Intuit sandbox is allowed.');
const db=new PGlite();useTestDatabase(db);const sql=neon('postgres://test:test@localhost/test');
await ensureFinance(sql);
await sql`CREATE TABLE app_users(user_id TEXT PRIMARY KEY,role TEXT,status TEXT)`;
await sql`INSERT INTO app_users VALUES ('sandbox-owner','owner','active')`;
const handler=createFinanceHandler({authorize:async()=>({sql,userId:'sandbox-owner',role:'owner'}),env});
const callback=createQuickBooksCallback({getSql:()=>sql,env});
const envDir=await mkdtemp(join(tmpdir(),'campfire-sandbox-vite-'));
const server=await createServer({configFile:false,root:process.cwd(),envDir,
 define:{'import.meta.env.VITE_AUTH_DISABLED':'"true"'},
 plugins:[react(),{name:'intuit-sandbox-verification',
 transformIndexHtml:html=>html.replace('<body>','<body><div style="padding:10px;background:#fff0cc;color:#624513;text-align:center;font:14px system-ui">INTUIT SANDBOX TEST · Test-company data only · Temporary local database</div>'),
 configureServer(s){s.middlewares.use(async(req,res,next)=>{
  if(req.headers.host!=='localhost:5196'){res.statusCode=403;return res.end('Local sandbox host required');}
  const url=new URL(req.url,origin);
  if(!url.pathname.startsWith('/api/'))return next();
  res.status=code=>{res.statusCode=code;return res;};
  res.json=body=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return res;};
  res.redirect=(code,target)=>{res.statusCode=code;res.setHeader('Location',target);res.end();};
  if(req.method==='POST'&&(req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json')))return res.status(403).json({error:'Same-origin JSON request required.'});
  req.query=Object.fromEntries(url.searchParams);
  try{
   if(url.pathname==='/api/quickbooks-callback')return await callback(req,res);
   if(url.pathname!=='/api/finance')return res.json({count:0,records:[],drafts:[]});
   let body='';for await(const chunk of req){body+=chunk;if(body.length>200000)return res.status(413).json({error:'Request too large'});}
   req.body=body?JSON.parse(body):null;await handler(req,res);
  }catch{return res.status(500).json({error:'Sandbox request failed.'});}
 });}}],server:{host:'127.0.0.1',port:5196,strictPort:true,allowedHosts:['localhost']}});
await server.listen();console.log(`Intuit sandbox verification: ${origin}/?tab=finance`);
