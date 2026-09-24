// Local-only preview. Real COO handler and PostgreSQL semantics; no provider calls or production credentials.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { PGlite } from '@electric-sql/pglite';
import { neon } from '@neondatabase/serverless';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTestDatabase } from '../tests/neon-test-adapter.mjs';
import { ensureCooWorkspace, applyCooCommand } from '../api/_lib/coo.js';
import { createCooHandler } from '../api/coo-workspace.js';
import { dayString } from '../src/lib/coo.js';
const db=new PGlite();useTestDatabase(db);
const sql=neon('postgres://test:test@localhost/test');await ensureCooWorkspace(sql);
const now=new Date(),today=dayString(now),year=now.getFullYear(),quarter=Math.floor(now.getMonth()/3),start=dayString(new Date(year,quarter*3,1)),end=dayString(new Date(year,quarter*3+3,0));
let state=applyCooCommand(null,{action:'setup'},'Demo COO',now);
const save=(kind,values)=>{state=applyCooCommand(state,{action:'save',kind,values},'Demo COO',now);return state[{cycle:'cycles',objective:'objectives',metric:'metrics',initiative:'initiatives',review:'reviews',constraint:'constraints'}[kind]].at(-1);};
const annual=save('cycle',{name:`${year} annual plan`,start:`${year}-01-01`,end:`${year}-12-31`,description:'Demonstration planning data'});
const cycle=save('cycle',{name:`Q${quarter+1} ${year}`,start,end,parentId:annual.id});
const company=save('objective',{title:'Grow revenue without compromising delivery',owner:'COO',departmentId:'',cycleId:annual.id,description:'Demonstration company objective: balance commercial growth with reliable operations.'});
const configs=[
 {index:0,title:'Build a reliable production engine',owner:'Jordan',metric:'Production output',baseline:0,target:1000,unit:'units',direction:'increase',value:320,previous:285,planned:400,forecast:800,initiative:'Standardize final assembly checks',status:'at-risk',blocker:'Two assembly stations need revised work instructions.'},
 {index:1,title:'Grow profitable customer demand',owner:'Alex',metric:'Qualified sales pipeline',baseline:200000,target:450000,unit:'USD',direction:'increase',value:465000,previous:385000,planned:420000,forecast:480000,initiative:'Launch the autumn dealer program',status:'on-track',blocker:''},
 {index:2,title:'Keep critical parts available',owner:'Morgan',metric:'Supplier on-time delivery',baseline:75,target:95,unit:'%',direction:'increase',value:81,previous:88,planned:90,forecast:90,initiative:'Qualify a second component supplier',status:'blocked',blocker:'Waiting on sample approval before the next purchase order.'},
];
for(const c of configs){const departmentId=state.departments[c.index].id;state.departments[c.index].owner=c.owner;
 const objective=save('objective',{title:c.title,owner:c.owner,departmentId,cycleId:cycle.id,parentId:company.id,description:'Demo objective — replace with your own operating priorities.'});
 const metric=save('metric',{title:c.metric,owner:c.owner,departmentId,cycleId:cycle.id,objectiveId:objective.id,kind:'kr',baseline:c.baseline,target:c.target,unit:c.unit,direction:c.direction,cadence:7,tolerance:0,plan:[...new Map([{date:start,value:c.baseline},{date:today,value:c.planned},{date:end,value:c.target}].map(p=>[p.date,p])).values()].sort((a,b)=>a.date.localeCompare(b.date)),source:'Demo report',description:'Demonstration measure, entered manually.'});
 const earlier=dayString(new Date(now.getTime()-7*86400000));
 if(earlier>=start)state=applyCooCommand(state,{action:'checkin',kind:'metric',id:metric.id,values:{date:earlier,value:c.previous}},'Demo COO',now);
 state=applyCooCommand(state,{action:'checkin',kind:'metric',id:metric.id,values:{date:today,value:c.value,forecast:c.forecast,blocker:c.blocker,note:'Demonstration weekly check-in'}},'Demo COO',now);
 const item=save('initiative',{title:c.initiative,owner:c.owner,departmentId,cycleId:cycle.id,objectiveId:objective.id,dueDate:end});
 state=applyCooCommand(state,{action:'checkin',kind:'initiative',id:item.id,values:{date:today,status:c.status,blocker:c.blocker}},'Demo COO',now);
}
const constraint=save('constraint',{title:'Critical component delivery at risk',owner:'Morgan',departmentId:state.departments[2].id,cycleId:cycle.id,metricIds:state.metrics.map(m=>m.id),objectiveIds:[],dueDate:end,impact:'Missing components limit production and put planned customer deliveries at risk.',decision:'Approve the alternate supplier sample and expedited freight.'});
state=applyCooCommand(state,{action:'checkin',kind:'constraint',id:constraint.id,values:{date:today,status:'blocked',note:'Alternate samples arrived; QA approval is outstanding.',nextStep:'Complete inspection and release the purchase order.'}},'Demo COO',now);
const review=save('review',{title:'Weekly operating review',owner:'Demo COO',departmentId:'',cycleId:cycle.id,date:today,description:'Demo review: production reliability, pipeline coverage, and critical supplier readiness.',decisions:'Prioritize sample approval and update assembly work instructions before the next production run.',lessons:'Include supplier readiness in the next quarterly planning discussion.'});
save('initiative',{title:'Approve the alternate supplier sample',owner:'Morgan',departmentId:state.departments[2].id,cycleId:cycle.id,dueDate:end,type:'action',constraintId:constraint.id,reviewId:review.id,description:'Demo follow-up from the operating review.'});
await sql`INSERT INTO coo_workspace(id,data,updated_by) VALUES ('company',${JSON.stringify(state)}::jsonb,'demo')`;
const handler=createCooHandler({authorize:async(req,res,p)=>{const viewer=req.headers['x-coo-preview-role']==='viewer';if(viewer&&p==='analytics.write'){res.status(403).json({error:'Read-only access'});return null;}return {sql,userId:'Demo COO',role:viewer?'viewer':'owner',permissions:viewer?['analytics.read']:['analytics.read','analytics.write']};}});
const emptyEnv=await mkdtemp(join(tmpdir(),'coo-preview-env-'));
const server=await createServer({configFile:false,root:process.cwd(),envDir:emptyEnv,define:{'import.meta.env.VITE_AUTH_DISABLED':'"true"'},plugins:[react(),{name:'coo-isolated-preview',transformIndexHtml(html){return html.replace('<body>','<body><div style="padding:8px 20px;background:#eaf2f8;color:#244b68;font:12px Helvetica;text-align:center">COO workspace preview · Demo data only · Changes stay in this temporary local database</div>');},configureServer(s){s.middlewares.use(async(req,res,next)=>{
 const url=new URL(req.url,'http://127.0.0.1');if(!url.pathname.startsWith('/api/'))return next();
 res.status=code=>{res.statusCode=code;return res;};res.json=body=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return res;};
 if(url.pathname==='/api/forecast')return res.json({forecast:{sheetName:'Demo financial forecast',months:Array.from({length:12},(_,i)=>({month:`${year}-${String(i+1).padStart(2,'0')}`,netRevenue:(i+1)*100000,units:(i+1)*100}))},updatedAt:now.toISOString()});
 if(url.pathname!=='/api/coo-workspace')return res.json({count:0,records:[],drafts:[]});
 try{let body='';for await(const chunk of req){body+=chunk;if(body.length>100000){res.status(413).json({error:'Request too large'});return;}}req.body=body?JSON.parse(body):null;await handler(req,res);}catch(e){res.status(500).json({error:e.message});}
 });}}],server:{host:'127.0.0.1',port:5194,strictPort:true}});
await server.listen();console.log('COO preview: http://127.0.0.1:5194/?tab=coo');
