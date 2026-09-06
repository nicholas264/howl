import { neon } from '@neondatabase/serverless';
import { consumeGoogleOAuthState, saveGoogleConnection } from '../_lib/google-user-oauth.js';
import { googleCallbackUrl, googleReturnPath } from '../_lib/google-oauth-routing.js';

// Callback outcomes use only server-stored purpose, never a client return URL.
export default async function handler(req,res) {
  const {code,error,state}=req.query;
  let purpose='drive',phase='state';
  try {
    const sql=neon(process.env.DATABASE_URL);
    const oauthState=await consumeGoogleOAuthState(sql,state);
    if(!oauthState)return res.redirect(googleReturnPath(purpose,'invalid_state'));
    purpose=oauthState.purpose;
    if(error || !code)return res.redirect(googleReturnPath(purpose,error==='access_denied'?'access_denied':'token_exchange'));
    phase='token_exchange';
    const tokenRes=await fetch('https://oauth2.googleapis.com/token',{
      method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:googleCallbackUrl(process.env),grant_type:'authorization_code'}),
    });
    const tokens=await tokenRes.json();
    if(!tokenRes.ok || !tokens.access_token){console.error('Google OAuth callback failed',{phase,status:tokenRes.status});return res.redirect(googleReturnPath(purpose,'token_exchange'));}
    if(!tokens.refresh_token)return res.redirect(googleReturnPath(purpose,'no_refresh_token'));
    const scopes=(tokens.scope || '').split(/\s+/).filter(Boolean);
    if(purpose==='static_studio' && !scopes.some(s=>['https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/drive'].includes(s)))return res.redirect(googleReturnPath(purpose,'scope_not_granted'));
    let googleEmail=null;
    try {
      const response=await fetch('https://www.googleapis.com/oauth2/v2/userinfo',{headers:{Authorization:`Bearer ${tokens.access_token}`},signal:AbortSignal.timeout(10000)});
      const profile=await response.json();if(response.ok)googleEmail=profile.email || null;
    }catch { /* Account label is optional; credentials remain on the server. */ }
    phase='save_failed';
    await saveGoogleConnection(sql,{userId:oauthState.user_id,refreshToken:tokens.refresh_token,scopes,googleEmail});
    const attrs=`Path=/; Max-Age=0; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}`;
    res.setHeader('Set-Cookie',[`drive_refresh=; HttpOnly; ${attrs}`,`drive_connected=; ${attrs}`,`gmail_connected=; ${attrs}`]);
    return res.redirect(googleReturnPath(purpose));
  }catch {
    // Do not log authorization codes, provider responses, tokens or request URLs.
    console.error('Google OAuth callback failed',{phase});
    return res.redirect(googleReturnPath(purpose,phase==='state'?'invalid_state':phase));
  }
}
