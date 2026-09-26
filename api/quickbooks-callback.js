import { neon } from '@neondatabase/serverless';
import { hash,nonce,setup,exchange,encrypt } from './_lib/finance.js';
export function createQuickBooksCallback({getSql=()=>neon(process.env.DATABASE_URL),env=process.env,fetcher=fetch}={}){return async(req,res)=>{
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');
 if(req.method!=='GET')return res.status(405).end();
 res.setHeader('Set-Cookie',`qb_oauth=; HttpOnly; SameSite=Lax; Path=/api/quickbooks-callback; Max-Age=0${env.QUICKBOOKS_REDIRECT_URI?.startsWith('https:')?'; Secure':''}`);
 const finish=result=>res.redirect(303,`/?tab=finance&quickbooks=${result}`);
 try{
 if(!setup(env).ready)return finish('setup_required');
 const {state,code,realmId,error}=req.query||{},binding=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('qb_oauth='))?.slice(9);
 if(typeof state!=='string'||!/^[-\w]{43}$/.test(state)||!binding||!/^[-\w]{43}$/.test(binding))return finish('invalid_state');
 const sql=getSql();const [s]=await sql`UPDATE finance_oauth SET claimed_at=now() WHERE state=${hash(state)} AND binding=${hash(binding)} AND expires_at>now() AND claimed_at IS NULL RETURNING user_id`;
 if(!s)return finish('invalid_state');
 const [owner]=await sql`SELECT user_id FROM app_users WHERE user_id=${s.user_id} AND role='owner' AND status='active'`;if(!owner)return finish('access_denied');
 if(error||typeof code!=='string'||code.length>4000||typeof realmId!=='string'||!/^\d{1,40}$/.test(realmId))return finish('authorization_declined');
 const t=await exchange({grant_type:'authorization_code',code,redirect_uri:env.QUICKBOOKS_REDIRECT_URI},env,fetcher),tokens=encrypt(t,env),encryptedRealm=encrypt(realmId,env),expires=new Date(Date.now()+t.expires_in*1000).toISOString(),version=nonce();
 // Consume consent at commit so disconnect or a newer connect cancels an in-flight exchange.
 // Recheck owner at commit. Reconnection clears cached data and account mapping.
 const results=await sql.transaction([
 sql`WITH consent AS (DELETE FROM finance_oauth WHERE state=${hash(state)} AND binding=${hash(binding)} AND claimed_at IS NOT NULL AND expires_at>now() RETURNING user_id) INSERT INTO finance_connection(id,realm,tokens,expires_at,version,environment,connected_by) SELECT 'company',${encryptedRealm},${tokens},${expires},${version},${env.QUICKBOOKS_ENVIRONMENT},${s.user_id} FROM app_users JOIN consent ON consent.user_id=app_users.user_id WHERE app_users.user_id=${s.user_id} AND role='owner' AND status='active' ON CONFLICT(id) DO UPDATE SET realm=EXCLUDED.realm,tokens=EXCLUDED.tokens,expires_at=EXCLUDED.expires_at,version=EXCLUDED.version,environment=EXCLUDED.environment,connected_by=EXCLUDED.connected_by,lease_until=NULL RETURNING id`,
 sql`UPDATE finance_workspace SET snapshot=NULL,settings=jsonb_set(settings-'ebitdaAdjustments'-'sellingAccountIds'-'productItemMapping','{mapping}','{}'::jsonb),revision=revision+1 WHERE id='company' AND EXISTS(SELECT 1 FROM finance_connection WHERE version=${version})`
 ]);return finish(results[0].length?'connected':'access_denied');
 }catch{console.error('QuickBooks callback failed');return finish('connection_failed');}
};}
export default createQuickBooksCallback();
