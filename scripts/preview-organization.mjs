// Isolated preview: only synthetic people and an in-memory database; no external calls.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {PGlite} from '@electric-sql/pglite';
import {neon} from '@neondatabase/serverless';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {useTestDatabase} from '../tests/neon-test-adapter.mjs';
import {ensureOrganization,applyOrganizationCommand} from '../api/_lib/organization.js';
import {createOrganizationHandler} from '../api/organization.js';
const db=new PGlite();useTestDatabase(db);const sql=neon('postgres://test:test@localhost/test');await ensureOrganization(sql);
await sql`CREATE TABLE finance_connection(id TEXT,version TEXT)`;await sql`INSERT INTO finance_connection VALUES ('company','fixture')`;
let state=applyOrganizationCommand(null,{action:'save',values:{name:'Preview CEO',title:'CEO'}},'preview');const root=state.people[0].id;
for(let i=0;i<8;i++){state=applyOrganizationCommand(state,{action:'save',values:{name:`Preview Lead ${i+1}`,title:'Team lead',managerId:root}},'preview');let managerId=state.people.at(-1).id;for(let j=0;j<4;j++){state=applyOrganizationCommand(state,{action:'save',values:{name:`Preview Worker ${i+1}-${j+1}`,title:'Technician',managerId}},'preview');managerId=state.people.at(-1).id;}}
await sql`INSERT INTO organization_workspace(id,data,updated_by) VALUES ('company',${JSON.stringify(state)}::jsonb,'preview')`;
const handler=createOrganizationHandler({authorize:async()=>({sql,role:'owner',userId:'preview',permissions:['*']}),acquire:async()=>({version:'fixture'}),release:async()=>{},fetchPeople:async()=>[{key:'a',name:'Example Assembly Tech',kind:'Employee',email:''},{key:'b',name:'Example Contractor',kind:'Contractor',email:''},{key:'c',name:'Example Supply Company',kind:'Vendor',email:''},{key:'d',name:'Preview CEO',kind:'Employee',email:''}]});
const server=await createServer({configFile:false,root:process.cwd(),envDir:await mkdtemp(join(tmpdir(),'org-preview-')),plugins:[react(),{name:'organization-preview',configureServer(s){s.middlewares.use(async(req,res,next)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/org-preview'){res.setHeader('Content-Type','text/html');return res.end(await s.transformIndexHtml(url.pathname,'<html><head><title>Organization test preview</title></head><body><div id="root"></div><script type="module" src="/scripts/preview-organization-entry.jsx"></script></body></html>'));}
 if(url.pathname!=='/api/organization')return next();
 req.query=Object.fromEntries(url.searchParams);res.status=code=>{res.statusCode=code;return res;};res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};let raw='';for await(const chunk of req)raw+=chunk;req.body=raw?JSON.parse(raw):undefined;await handler(req,res);
 });}}],server:{host:'127.0.0.1',port:5193,strictPort:true}});await server.listen();console.log('Isolated organization preview: http://127.0.0.1:5193/org-preview');
