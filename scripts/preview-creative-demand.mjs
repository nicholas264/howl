// Local-only read-only preview. The data file stays outside the repository.
import {createServer} from 'vite';
import fs from 'node:fs';
const path=process.env.CREATIVE_DEMAND_INPUT;
if(!path)throw Error('Set CREATIVE_DEMAND_INPUT to the historical baseline JSON.');
const history=JSON.parse(fs.readFileSync(path));
const page='<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f6f7f3;font-family:Arial,sans-serif"><div id="root"></div><script type="module" src="/scripts/creative-demand-preview.jsx"></script></body></html>';
const server=await createServer({root:process.cwd(),configFile:false,envDir:'/private/tmp/campfire-demand-empty-env',plugins:[{name:'creative-demand-preview',configureServer(s){s.middlewares.use(async(req,res,next)=>{const pathname=new URL(req.url,'http://127.0.0.1').pathname;if(pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(await s.transformIndexHtml('/',page));}if(pathname==='/api/creative-demand'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({history,assumptions:null}));}next();});}}],server:{host:'127.0.0.1',port:5197,strictPort:true}});
await server.listen();console.log('Read-only creative demand preview: http://127.0.0.1:5197');
