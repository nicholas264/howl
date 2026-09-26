import { randomBytes,createHash,createCipheriv,createDecipheriv } from 'node:crypto';
import { fiscalMonths } from '../../src/lib/finance.js';
export async function ensureFinance(sql){
 await sql`CREATE TABLE IF NOT EXISTS finance_workspace(id TEXT PRIMARY KEY,settings JSONB NOT NULL,revision INTEGER NOT NULL DEFAULT 1,snapshot JSONB,updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
 await sql`CREATE TABLE IF NOT EXISTS finance_connection(id TEXT PRIMARY KEY,realm TEXT NOT NULL,tokens TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,version TEXT NOT NULL,environment TEXT NOT NULL,lease_until TIMESTAMPTZ,connected_by TEXT NOT NULL)`;
 await sql`CREATE TABLE IF NOT EXISTS finance_oauth(state TEXT PRIMARY KEY,binding TEXT NOT NULL,user_id TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL)`;
 await sql`ALTER TABLE finance_oauth ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`;
}
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const nonce=()=>randomBytes(32).toString('base64url');
export const defaultSettings=()=>({start:`${new Date().getUTCFullYear()}-01`,basis:'Accrual',currency:'USD',targets:{},mapping:{}});
export function validateSettings(s){
 if(!s||!/^20\d\d-(0[1-9]|1[0-2])$/.test(s.start)||!['Cash','Accrual'].includes(s.basis)||!['USD','CAD','GBP','EUR','AUD','NZD'].includes(s.currency))throw new Error('Choose a valid fiscal start, accounting basis, and supported currency.');
 const periods=fiscalMonths(s.start),targets={},mapping={},ebitdaAdjustments={};
 if(!s.targets||typeof s.targets!=='object'||!s.mapping||typeof s.mapping!=='object'||Object.keys(s.mapping).length>3000)throw new Error('Invalid financial plan.');
 for(const [m,v] of Object.entries(s.targets)){if(!periods.includes(m)||!Number.isFinite(v)||v<0||v>1e12)throw new Error('Targets must be nonnegative numbers within the fiscal year.');targets[m]=v;}
 for(const [id,v] of Object.entries(s.mapping)){if(!/^[\w:.-]{1,100}$/.test(id)||!Number.isFinite(v?.variablePct)||v.variablePct<0||v.variablePct>100)throw new Error('Variable cost percentages must be between 0 and 100.');mapping[id]={variablePct:v.variablePct};}
 if(s.ebitdaAdjustments!==undefined){
 if(!s.ebitdaAdjustments||typeof s.ebitdaAdjustments!=='object'||Array.isArray(s.ebitdaAdjustments)||Object.keys(s.ebitdaAdjustments).length>12)throw new Error('Invalid EBITDA adjustments.');
 for(const [month,entries] of Object.entries(s.ebitdaAdjustments)){
 if(!periods.includes(month)||!entries||typeof entries!=='object'||Array.isArray(entries))throw new Error('Invalid EBITDA month.');
 const clean={};for(const [key,v] of Object.entries(entries)){
 if(!['interest','incomeTax','depreciation','amortization'].includes(key)||!Number.isFinite(v)||Math.abs(v)>1e12)throw new Error('EBITDA adjustments must be valid amounts.');
 clean[key]=v;
 }ebitdaAdjustments[month]=clean;
 }
 }
 if(s.sellingAccountIds!==undefined&&(!Array.isArray(s.sellingAccountIds)||s.sellingAccountIds.length>3000||s.sellingAccountIds.some(id=>typeof id!=='string'||!/^Expenses:[\w.-]{1,90}$/.test(id))))throw new Error('Invalid selling expense accounts.');
 const productItemMapping={};
 const productCogsAccounts={};
 if(s.productCogsAccounts!==undefined){
 if(!s.productCogsAccounts||typeof s.productCogsAccounts!=='object'||Array.isArray(s.productCogsAccounts)||Object.keys(s.productCogsAccounts).length>4)throw new Error('Invalid product COGS accounts.');
 const used=new Set();
 for(const [product,id] of Object.entries(s.productCogsAccounts)){
 if(!['r1','r3','r4','bags'].includes(product)||typeof id!=='string'||(id!=='items'&&!/^COGS:[\w.-]{1,90}$/.test(id))||(id!=='items'&&used.has(id)))throw new Error('Each product must use a distinct COGS account.');
 productCogsAccounts[product]=id;if(id!=='items')used.add(id);
 }
 }
 if(s.productItemMapping!==undefined){
 if(!s.productItemMapping||typeof s.productItemMapping!=='object'||Array.isArray(s.productItemMapping)||Object.keys(s.productItemMapping).length>5000)throw new Error('Invalid product item mapping.');
 for(const [id,product] of Object.entries(s.productItemMapping)){if(!/^\d{1,40}$/.test(id)||!['r1','r3','r4','bags','exclude'].includes(product))throw new Error('Invalid product item mapping.');productItemMapping[id]=product;}
 }
 return {start:s.start,basis:s.basis,currency:s.currency,targets,mapping,...(s.productCogsAccounts!==undefined?{productCogsAccounts}:{}),...(s.productItemMapping!==undefined?{productItemMapping}:{}),...(s.sellingAccountIds!==undefined?{sellingAccountIds:[...new Set(s.sellingAccountIds)]}:{}),...(s.ebitdaAdjustments!==undefined?{ebitdaAdjustments}: {})};
}
export function setup(env=process.env){
 const keys=['QUICKBOOKS_CLIENT_ID','QUICKBOOKS_CLIENT_SECRET','QUICKBOOKS_REDIRECT_URI','QUICKBOOKS_ENVIRONMENT','QUICKBOOKS_TOKEN_ENCRYPTION_KEY'];
 const checks=keys.map(key=>({key,configured:!!env[key]}));
 let valid=false;try{const u=new URL(env.QUICKBOOKS_REDIRECT_URI);valid=u.pathname==='/api/quickbooks-callback'&&!u.search&&!u.hash&&!u.username&&!u.password&&(u.protocol==='https:'||(env.NODE_ENV!=='production'&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)));}catch{}
 const ready=checks.every(c=>c.configured)&&valid&&['sandbox','production'].includes(env.QUICKBOOKS_ENVIRONMENT)&&(env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY?.length>=32);
 return {checks,ready,redirectUri:valid?env.QUICKBOOKS_REDIRECT_URI:null,environment:env.QUICKBOOKS_ENVIRONMENT==='production'?'production':'sandbox'};
}
function key(env){if((env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY?.length||0)<32)throw new Error('Token encryption is not configured.');return createHash('sha256').update(env.QUICKBOOKS_TOKEN_ENCRYPTION_KEY).digest();}
export function encrypt(value,env=process.env){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(env),iv),data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),data.toString('base64url')].join('.');}
export function decrypt(value,env=process.env){const [version,iv,tag,data]=value.split('.');if(version!=='v1')throw new Error('Invalid credential version.');const c=createDecipheriv('aes-256-gcm',key(env),Buffer.from(iv,'base64url'));c.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([c.update(Buffer.from(data,'base64url')),c.final()]).toString());}
export function readRealm(value,env=process.env){
 const realm=/^\d{1,40}$/.test(value)?value:decrypt(value,env);
 if(typeof realm!=='string'||!/^\d{1,40}$/.test(realm))throw new Error('Invalid QuickBooks company identity. Reconnect QuickBooks.');
 return realm;
}
export async function protectRealm(sql,connection,env=process.env){
 if(!connection)return null;
 const realm=readRealm(connection.realm,env);
 // Upgrade older rows without changing or overwriting a concurrently connected company.
 if(connection.realm===realm){const encrypted=encrypt(realm,env);await sql`UPDATE finance_connection SET realm=${encrypted} WHERE id='company' AND realm=${realm}`;}
 return {...connection,realm};
}
// Provider bodies, URLs, credentials and company identifiers must never enter
// diagnostics. Intuit trace IDs contain hexadecimal characters and hyphens.
function recordProviderFailure(response,operation){
 const trace=response.headers?.get?.('intuit_tid');
 console.warn('QuickBooks provider failure',{operation,status:response.status,
  ...(typeof trace==='string'&&/^[a-f\d-]{1,128}$/i.test(trace)?{intuitTid:trace}:{})});
}
export async function exchange(params,env=process.env,fetcher=fetch){
 const response=await fetcher('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Basic ${Buffer.from(`${env.QUICKBOOKS_CLIENT_ID}:${env.QUICKBOOKS_CLIENT_SECRET}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams(params)});
 if(!response.ok){recordProviderFailure(response,'token');throw new Error('QuickBooks authorization expired or was declined. Reconnect QuickBooks.');}const t=await response.json();if(!t.access_token||!t.refresh_token||!Number.isFinite(t.expires_in)||t.expires_in<=0)throw new Error('QuickBooks returned an incomplete authorization.');return t;
}
export async function provider(path,access,realm,env=process.env,fetcher=fetch){
 const base=env.QUICKBOOKS_ENVIRONMENT==='production'?'https://quickbooks.api.intuit.com':'https://sandbox-quickbooks.api.intuit.com';
 const r=await fetcher(`${base}/v3/company/${encodeURIComponent(realm)}/${path}`,{headers:{Authorization:`Bearer ${access}`,Accept:'application/json'},signal:AbortSignal.timeout(15000)});
 if(!r.ok){recordProviderFailure(r,'report');throw new Error(r.status===401?'QuickBooks authorization expired. Reconnect QuickBooks.':'QuickBooks could not return a complete report. Try syncing again.');}return r.json();
}
// A lease serializes refresh/sync; the version also prevents an old sync from
// overwriting a new connection. No refresh credential leaves the server.
export async function acquireConnection(sql,env=process.env,fetcher=fetch){
 const [c]=await sql`UPDATE finance_connection SET lease_until=now()+interval '5 minutes',version=${nonce()} WHERE id='company' AND (lease_until IS NULL OR lease_until<now()) RETURNING *`;
 if(!c)throw new Error('Connect QuickBooks first, or wait for the current sync to finish.');
 try{if(c.environment!==env.QUICKBOOKS_ENVIRONMENT)throw new Error('Environment changed. Reconnect QuickBooks.');let tokens=decrypt(c.tokens,env);
 if(new Date(c.expires_at).getTime()<Date.now()+120000){tokens=await exchange({grant_type:'refresh_token',refresh_token:tokens.refresh_token},env,fetcher);const encrypted=encrypt(tokens,env),expiry=new Date(Date.now()+tokens.expires_in*1000).toISOString();const saved=await sql`UPDATE finance_connection SET tokens=${encrypted},expires_at=${expiry} WHERE id='company' AND version=${c.version} RETURNING id`;if(!saved.length)throw new Error('Connection changed. Sync again.');}
 const connection=await protectRealm(sql,c,env);return {...connection,access:tokens.access_token};
 }catch(error){await releaseConnection(sql,c.version);throw error;}
}
export async function releaseConnection(sql,version){await sql`UPDATE finance_connection SET lease_until=NULL WHERE id='company' AND version=${version}`;}
export function monthEnd(month){const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);}
export function closedThrough(now=new Date()){return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),0)).toISOString().slice(0,7);}
