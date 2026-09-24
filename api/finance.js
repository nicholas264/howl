import { requirePermission } from './_lib/app-access.js';
import { canAccessFinance,fiscalMonths } from '../src/lib/finance.js';
import { defaultSettings,validateSettings,setup,nonce,hash,acquireConnection,releaseConnection,provider,monthEnd,closedThrough,protectRealm } from './_lib/finance.js';
import { parseProfitLoss,parseBalanceSheet,combineAccounts } from './_lib/quickbooks-reports.js';
export function createFinanceHandler({authorize=requirePermission,env=process.env,fetcher=fetch,now=()=>new Date()}={}){return async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 const access=await authorize(req,res,'analytics.read');if(!access)return;if(!canAccessFinance(access))return res.status(403).json({error:'Financials is restricted to the owner.'});
 const {sql,userId}=access;
 try{
 const [row]=await sql`SELECT * FROM finance_workspace WHERE id='company'`;
 const [storedConnection]=await sql`SELECT realm,environment FROM finance_connection WHERE id='company'`;
 const connection=req.method==='GET'?await protectRealm(sql,storedConnection,env):null;
 if(req.method==='GET'&&row?.snapshot&&Object.hasOwn(row.snapshot,'realm')){
 await sql`UPDATE finance_workspace SET snapshot=snapshot-'realm' WHERE id='company' AND snapshot ? 'realm'`;
 delete row.snapshot.realm;
 }
 if(req.method==='GET')return res.json({settings:row?.settings||defaultSettings(),revision:row?.revision||0,snapshot:row?.snapshot||null,connection:connection||null,setup:setup(env)});
 const b=req.body;if(!b||JSON.stringify(b).length>200000)return res.status(400).json({error:'Invalid request.'});
 if(b.action==='connect'){
 if(!setup(env).ready)return res.status(400).json({error:'Complete the server connection setup first.'});
 const state=nonce(),binding=nonce();await sql`DELETE FROM finance_oauth WHERE expires_at<now() OR user_id=${userId}`;
 await sql`INSERT INTO finance_oauth(state,binding,user_id,expires_at) VALUES (${hash(state)},${hash(binding)},${userId},now()+interval '10 minutes')`;
 const secure=new URL(env.QUICKBOOKS_REDIRECT_URI).protocol==='https:';
 res.setHeader('Set-Cookie',`qb_oauth=${binding}; HttpOnly; SameSite=Lax; Path=/api/quickbooks-callback; Max-Age=600${secure?'; Secure':''}`);
 const url=new URL('https://appcenter.intuit.com/connect/oauth2');url.search=new URLSearchParams({client_id:env.QUICKBOOKS_CLIENT_ID,redirect_uri:env.QUICKBOOKS_REDIRECT_URI,response_type:'code',scope:'com.intuit.quickbooks.accounting',state}).toString();return res.json({url:url.toString()});
 }
 if(b.action==='disconnect'){
 // Atomic removal also invalidates pending consent and cached company data.
 await sql.transaction([sql`DELETE FROM finance_connection WHERE id='company'`,sql`UPDATE finance_workspace SET snapshot=NULL,settings=jsonb_set(settings-'ebitdaAdjustments'-'sellingAccountIds','{mapping}','{}'::jsonb),revision=revision+1 WHERE id='company'`,sql`DELETE FROM finance_oauth WHERE user_id=${userId}`]);return res.json({ok:true});
 }
 if(b.action==='save'){
 let settings;try{settings=validateSettings(b.settings);}catch(e){return res.status(400).json({error:e.message});}
 if(!Number.isSafeInteger(b.revision)||b.revision!==(row?.revision||0))return res.status(409).json({error:'Financial settings changed. Reload before saving. Your edits remain on screen.'});
 const data=JSON.stringify(settings),same=row&&row.settings.start===settings.start&&row.settings.basis===settings.basis&&row.settings.currency===settings.currency;
 const saved=row?await sql`UPDATE finance_workspace SET settings=${data}::jsonb,revision=revision+1,snapshot=CASE WHEN ${!!same} THEN snapshot ELSE NULL END,updated_at=now() WHERE id='company' AND revision=${b.revision} RETURNING revision`:await sql`INSERT INTO finance_workspace(id,settings) VALUES ('company',${data}::jsonb) ON CONFLICT DO NOTHING RETURNING revision`;
 if(!saved.length)return res.status(409).json({error:'Financial settings changed. Reload before saving.'});return res.json({ok:true});
 }
 if(b.action==='sync'){
 if(!row)return res.status(400).json({error:'Save your financial settings before syncing.'});
 if(!setup(env).ready)return res.status(400).json({error:'Complete the server connection setup first.'});
 const settings=row.settings,closed=closedThrough(now()),periods=fiscalMonths(settings.start).filter(m=>m<=closed);
 if(!periods.length)return res.status(400).json({error:'There are no completed months in this fiscal year yet.'});
 const c=await acquireConnection(sql,env,fetcher);
 try{
 const months=[];
 // Bounded batches avoid bursting the provider; one complete snapshot is saved.
 for(let i=0;i<periods.length;i+=3){const batch=await Promise.all(periods.slice(i,i+3).map(async m=>{const start=`${m}-01`,end=monthEnd(m),q=new URLSearchParams({start_date:start,end_date:end,accounting_method:settings.basis,summarize_column_by:'Total'});return parseProfitLoss(await provider(`reports/ProfitAndLoss?${q}`,c.access,c.realm,env,fetcher),start,end,settings.basis);}));months.push(...batch);}
 const start=`${settings.start}-01`,end=monthEnd(periods.at(-1)),q=new URLSearchParams({start_date:start,end_date:end,accounting_method:settings.basis,summarize_column_by:'Total'});
 const balance=parseBalanceSheet(await provider(`reports/BalanceSheet?${q}`,c.access,c.realm,env,fetcher),start,end,settings.basis);
 if(months.some(m=>m.currency!==settings.currency)||balance.currency!==settings.currency)throw new Error('Report currency differs from your plan. Update the plan currency and sync again.');
 const snapshot={months:months.map(({accounts,...m})=>m),accounts:combineAccounts(months),balance,closedThrough:periods.at(-1),syncedAt:now().toISOString(),environment:c.environment,basis:settings.basis,currency:settings.currency};
 const saved=await sql`UPDATE finance_workspace SET snapshot=${JSON.stringify(snapshot)}::jsonb WHERE id='company' AND revision=${row.revision} AND EXISTS(SELECT 1 FROM finance_connection WHERE id='company' AND version=${c.version}) RETURNING id`;
 if(!saved.length)throw new Error('Settings or connection changed during sync. Sync again.');return res.json({ok:true});
 }finally{await releaseConnection(sql,c.version);}
 }
 return res.status(400).json({error:'Unknown financial action.'});
 }catch(error){console.error('Financial workspace failed',error.code||'request_failed');return res.status(503).json({error: error.code?'Financial storage is unavailable. Check the migration and try again.':error.message||'Financials is unavailable. Previous saved reports have been kept.'});}
};}
export default createFinanceHandler();
