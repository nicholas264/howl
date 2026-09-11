// Local-only review with an ephemeral PostgreSQL database; no production credentials.
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';
import { useTestDatabase } from '../tests/neon-test-adapter.mjs';
import { seedCreativeAnalytics } from '../tests/fixtures/creative-analytics.mjs';
for (const key of Object.keys(process.env)) if (/TOKEN|SECRET|API_KEY|DATABASE_URL/.test(key)) delete process.env[key];
Object.assign(process.env, { NODE_ENV:'development', AUTH_DISABLED:'true', FORCE_BOOTSTRAP:'true', DATABASE_URL:'postgresql://fixture:fixture@fixture.invalid/fixture', META_ACCESS_TOKEN:'fixture', META_AD_ACCOUNT_ID:'fixture' });
const db=new PGlite();useTestDatabase(db);await seedCreativeAnalytics(db);
const page='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fff"><div id="root"></div><script type="module" src="/scripts/creative-analytics-preview.jsx"></script></body></html>';
const server=await createServer({server:{host:'127.0.0.1',port:5184,strictPort:true},plugins:[{name:'creative-review-page',configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url?.split('?')[0]!=='/__creative-review')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__creative-review',page));});}}]});
await server.listen();console.log('Creative analytics preview: http://127.0.0.1:5184/__creative-review (synthetic data)');
