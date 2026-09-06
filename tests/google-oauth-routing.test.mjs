import test from 'node:test';
import assert from 'node:assert/strict';
import {googleCallbackUrl,googleReturnPath} from '../api/_lib/google-oauth-routing.js';
import {cleanGoogleConnectionUrl,readGoogleConnectionResult} from '../src/lib/google-connection-result.js';
const env={NODE_ENV:'production',GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'fixture',GOOGLE_REDIRECT_URI:'https://app.example/api/auth/callback'};
test('OAuth start refuses retired callback origins before navigating away',()=>{
 assert.equal(googleCallbackUrl(env,'https://app.example'),env.GOOGLE_REDIRECT_URI);
 assert.throws(()=>googleCallbackUrl({...env,GOOGLE_REDIRECT_URI:'https://retired.example/api/auth/callback'},'https://app.example'),/old or different/);
 for(const uri of ['http://app.example/api/auth/callback','https://app.example/wrong','https://app.example/api/auth/callback?return=evil'])assert.throws(()=>googleCallbackUrl({...env,GOOGLE_REDIRECT_URI:uri}));
});
test('success and failure return to Studio and URL cleanup preserves the selected tool',()=>{
 for(const error of ['', 'access_denied','token_exchange','no_refresh_token','scope_not_granted','save_failed']){
  const path=googleReturnPath('static_studio',error);
  assert.equal(new URL(path,'https://app.example').searchParams.get('tab'),'static-studio');
  const result=readGoogleConnectionResult(path.split('?')[1]);assert.equal(!!result.connectionError,!!error);assert.equal(result.connectionSucceeded,!error);
  assert.equal(cleanGoogleConnectionUrl('https://app.example'+path+'&drive_token=legacy#assets'),'/?tab=static-studio#assets');
 }
 assert.equal(googleReturnPath('https://evil.example','access_denied'),'/?drive_error=access_denied');
 assert.equal(googleReturnPath('creator_email'),'/?gmail_connected=1');
});

test('actual OAuth callback preserves Studio failures and stores credentials only after the required Drive scope is granted',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const {neon}=await import('@neondatabase/serverless');
 const {useTestDatabase}=await import('./neon-test-adapter.mjs');
 const {createGoogleOAuthState}=await import('../api/_lib/google-user-oauth.js');
 const {default:callback}=await import('../api/auth/callback.js');
 const db=new PGlite(),restore=useTestDatabase(db),oldFetch=globalThis.fetch,previous={...process.env};
 Object.assign(process.env,env,{DATABASE_URL:'postgresql://test:test@fixture.local/test',GOOGLE_TOKEN_ENCRYPTION_KEY_V2:'isolated-test-key'});
 const sql=neon(process.env.DATABASE_URL);
 let providerCalls=0,providerResult={error:'invalid_grant'},providerStatus=400;
 globalThis.fetch=async url=>{providerCalls++;if(String(url).includes('/userinfo'))return Response.json({email:'fixture@example.test'});return Response.json(providerResult,{status:providerStatus});};
 const invoke=async query=>{const res={setHeader(){},redirect(url){this.url=url;}};await callback({query},res);return res.url;};
 try {
  let state=await createGoogleOAuthState(sql,'fixture-owner','static_studio');
  assert.equal(await invoke({state,error:'access_denied'}),'/?tab=static-studio&drive_error=access_denied');assert.equal(providerCalls,0);
  assert.equal(await invoke({state,code:'used'}),'/?drive_error=invalid_state');assert.equal(providerCalls,0);
  state=await createGoogleOAuthState(sql,'fixture-owner','static_studio');
  assert.equal(await invoke({state,code:'fixture-code'}),'/?tab=static-studio&drive_error=token_exchange');
  providerStatus=200;providerResult={access_token:'fixture-access',refresh_token:'fixture-refresh',scope:'openid email'};
  state=await createGoogleOAuthState(sql,'fixture-owner','static_studio');
  assert.equal(await invoke({state,code:'fixture-code'}),'/?tab=static-studio&drive_error=scope_not_granted');
  assert.equal((await db.query('SELECT * FROM app_google_connections')).rows.length,0);
  providerResult.scope+=' https://www.googleapis.com/auth/drive.readonly';
  state=await createGoogleOAuthState(sql,'fixture-owner','static_studio');
  assert.equal(await invoke({state,code:'fixture-code'}),'/?tab=static-studio&drive_connected=1');
  const rows=(await db.query('SELECT * FROM app_google_connections')).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].user_id,'fixture-owner');assert.ok(!rows[0].encrypted_refresh_token.includes('fixture-refresh'));
 }finally{globalThis.fetch=oldFetch;restore();for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);await db.close();}
});
