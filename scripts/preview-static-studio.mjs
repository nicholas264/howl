// Local-only renderer bench. No provider, database or campaign writes.
// STUDIO_QA_ASSETS must contain r1.jpg, r3.jpg and r4mkii.jpg.
import {createServer} from 'vite';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const assets=process.env.STUDIO_QA_ASSETS || '/private/tmp/howl-static-qa';
const output=path.join(assets,'creative-v2');await mkdir(output,{recursive:true});
const page=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px system-ui;background:#eee;color:#222;margin:30px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}section{background:white;padding:18px}img{max-width:48%;vertical-align:top}pre{white-space:pre-wrap;font-size:12px}.fail{color:#a20}button{padding:12px}</style></head><body><h1>Static Studio renderer bench</h1><p>Local fixtures. These are engineering checks, not approved campaign concepts.</p><button id="run">Run rendering checks</button><p id="status">Ready</p><main></main><script type="module" src="/bench.js"></script></body></html>`;
const entry=`import {renderPair,inspectImage} from '/src/lib/static-studio/render.js';
import {generateConcepts,blankWorkspace,DIRECTIONS} from '/src/lib/static-studio/model.js';
document.querySelector('#run').onclick=async()=>{
const status=document.querySelector('#status');status.textContent='Rendering';document.querySelector('main').replaceChildren();const results=[];
try{
for(const id of ['r1','r3','r4mkii']){
 const response=await fetch('/original/'+id),blob=await response.blob();
 const a={id:'asset-'+id,url:'/original/'+id,...await inspectImage(blob),productId:id,approved:true,role:'product',features:[]};
 const c=generateConcepts({...blankWorkspace(),assets:[a],count:1,selectedProducts:[id]})[0];
 for(const d of DIRECTIONS.filter(d=>d.id!=='scene' && d.id!=='technical')){
 const pair=await renderPair({...c,direction:d.id},a);const errors=pair.checks.filter(c=>c.level==='error');results.push({product:id,direction:d.id,errors});
 const card=document.createElement('section'),heading=document.createElement('h2');heading.textContent=id+' / '+d.name;card.append(heading);
 for(const format of ['feed','story']){const img=document.createElement('img');img.src=URL.createObjectURL(pair[format].blob);img.alt=id+' '+d.id+' '+format;card.append(img);}
 const checks=document.createElement('pre');checks.textContent=errors.length?JSON.stringify(errors):'Production checks pass';checks.className=errors.length?'fail':'';card.append(checks);document.querySelector('main').append(card);
 }
}
// Exercise the immersive path with synthetic dark and bright source fixtures.
// The inner box represents a protected subject; this is not campaign photography.
for(const bright of [false,true]){
 const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=3200;const ctx=canvas.getContext('2d');ctx.fillStyle=bright?'#fff':'#101719';ctx.fillRect(0,0,1800,3200);ctx.fillStyle='#a74218';ctx.fillRect(600,1350,550,750);
 const blob=await new Promise(r=>canvas.toBlob(r,'image/png')),url=URL.createObjectURL(blob);
 const a={id:'scene-fixture',url,...await inspectImage(blob),productId:'r3',approved:true,role:'product',features:[],protectedRegion:{x:600/1800,y:1350/3200,w:550/1800,h:750/3200,approved:true}};
 const c={id:'scene',assetId:a.id,productId:'r3',headline:'Nobody called\\nlast call.',body:'',cta:'Explore the R3',direction:'scene',scale:1,align:'left',storyAlign:'left'};
 const pair=await renderPair(c,a),errors=pair.checks.filter(c=>c.level==='error');
 results.push({scenario:bright?'bright background must fail':'dark background must pass',errors});
 if(bright && !errors.some(e=>e.code.includes('contrast')))throw Error('Bright background incorrectly passed');
 if(!bright && errors.length)throw Error('Dark fixture failed: '+JSON.stringify(errors));
 const overlapping=await renderPair(c,{...a,protectedRegion:{x:.2,y:.15,w:.5,h:.45,approved:true}});
 if(!overlapping.checks.some(e=>e.level==='error' && e.code.includes('layout')))throw Error('Product/text overlap incorrectly passed');
 results.push({scenario:'text overlap blocked',passed:true});URL.revokeObjectURL(url);
}
if(results.some(r=>r.product && r.errors.length))throw Error('A product rendering failed');
const saved=await fetch('/results',{method:'POST',body:JSON.stringify(results)});if(!saved.ok)throw Error('Evidence save failed');status.textContent='All rendering checks passed. Evidence saved locally.';
}catch(e){status.textContent='Failed: '+e.message;}
};`;
const server=await createServer({configFile:false,root:process.cwd(),envDir:path.join(output,'empty-env'),plugins:[{name:'renderer-bench',configureServer(s){s.middlewares.use(async(req,res,next)=>{
const url=new URL(req.url,'http://127.0.0.1');
if(url.pathname==='/'){res.setHeader('content-type','text/html');return res.end(await s.transformIndexHtml('/',page));}
if(url.pathname==='/bench.js'){res.setHeader('content-type','text/javascript');return res.end(entry);}
if(/^\/original\/(r1|r3|r4mkii)$/.test(url.pathname)){res.setHeader('content-type','image/png');return res.end(await readFile(path.join(assets,url.pathname.split('/').at(-1)+'.jpg')));}
if(url.pathname==='/results' && req.method==='POST'){let bytes='';for await(const chunk of req){bytes+=chunk;if(bytes.length>100000){res.statusCode=413;return res.end();}}await writeFile(path.join(output,'render-checks.json'),JSON.stringify(JSON.parse(bytes),null,2));return res.end('saved');}
next();
});}}],server:{host:'127.0.0.1',port:5191,strictPort:true}});
await server.listen();console.log('Renderer bench: http://127.0.0.1:5191');
