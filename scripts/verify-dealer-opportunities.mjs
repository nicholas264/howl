// Local verification only: real handlers and isolated PostgreSQL, no live writes.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { PGlite } from '@electric-sql/pglite';
import { neon } from '@neondatabase/serverless';
import { useTestDatabase } from '../tests/neon-test-adapter.mjs';
import { ensureDealerOutreach } from '../api/_lib/dealer-outreach.js';
import { createDealerOutreachHandler } from '../api/dealer-outreach.js';
const db = new PGlite();
const restore = useTestDatabase(db);
const sql = neon('postgres://test:test@localhost/test');
await ensureDealerOutreach(sql);
const shop = {name:'Dealer verification fixtures',domain:'dealer.example.myshopify.com',currency:'USD',timeZone:'America/Chicago'};
let fail = false;
const orders = [];
for (const [i,name,values] of [[1,'Alpine Outfitters',[2000,4000,6000]],[2,'Scheels Fargo',[5000,6000,7000]],[3,'Trail Supply',[1800]]]) {
  values.forEach((netSales,j)=>orders.push({id:`${i}-${j}`,customerKey:`customer:${i}`,customerId:String(i),customerName:name,contactName:`Test buyer ${i}`,contactEmail:`buyer${i}@example.com`,location:'Minneapolis, MN',netSales,day:`2026-0${j+4}-01`,createdAt:`2026-0${j+4}-01T12:00:00Z`}));
}
const handler=createDealerOutreachHandler({getShop:()=>shop.domain,authorize:async()=>({sql,userId:'verification',permissions:['analytics.read','analytics.write']})});
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Dealer opportunities verification</title><style>body{margin:0;background:#f8faf9;font-family:Arial,sans-serif}#qa{padding:12px;background:#fff4c8}#qa button{margin:0 6px;padding:8px}</style></head><body><div id="qa">Local test data only <button id="order">Simulate Alpine reorder</button><button id="failure">Toggle tracking outage</button></div><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import DealerDashboard from '/src/components/DealerDashboard.jsx';createRoot(document.getElementById('root')).render(React.createElement(DealerDashboard));document.getElementById('order').onclick=()=>fetch('/qa/order',{method:'POST'});document.getElementById('failure').onclick=()=>fetch('/qa/failure',{method:'POST'});</script></body></html>`;
const server = await createServer({configFile:false,root:process.cwd(),plugins:[react(),{name:'dealer-qa',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  res.status=(code)=>{res.statusCode=code;return res;};res.json=(data)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(req.url==='/dealer-qa.html'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,html));return;}
  if(req.url==='/api/dealer-analytics') return res.json({shop,asOf:'2026-09-22T18:00:00Z',orders,meta:{historyComplete:true}});
  if(req.url==='/qa/order' && req.method==='POST'){if(!orders.some(o=>o.id==='new'))orders.push({...orders[0],id:'new',day:'2026-09-22',createdAt:'2026-09-22T12:00:00Z'});return res.json({ok:true});}
  if(req.url==='/qa/failure' && req.method==='POST'){fail=!fail;return res.json({ok:true});}
  if(req.url==='/api/dealer-outreach'){
    if(fail)return res.status(503).json({error:'Test tracking outage'});
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks).toString();req.body=body?JSON.parse(body):null;
    return handler(req,res);
  }
  next();
});}}],server:{host:'127.0.0.1',port:5194,strictPort:true}});
await server.listen();
console.log('Dealer QA: http://127.0.0.1:5194/dealer-qa.html (isolated data)');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();restore();await db.close();process.exit();});
