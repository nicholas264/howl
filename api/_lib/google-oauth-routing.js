export function googleCallbackUrl(env, requestOrigin) {
  if(!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new Error('Google sign-in is not configured. Ask an administrator to configure the Google OAuth client.');
  }
  let callback;
  try {callback=new URL(env.GOOGLE_REDIRECT_URI);} catch {throw new Error('Google callback address is invalid.');}
  const local=env.NODE_ENV!=='production' && ['localhost','127.0.0.1'].includes(callback.hostname);
  if((callback.protocol!=='https:' && !local) || callback.username || callback.password || callback.search || callback.hash || callback.pathname!=='/api/auth/callback')throw new Error('Google callback must be the app’s HTTPS /api/auth/callback address.');
  if(requestOrigin && requestOrigin!==callback.origin)throw new Error('Google sign-in points to an old or different app address. An administrator must register this app’s /api/auth/callback address in Google and update GOOGLE_REDIRECT_URI.');
  return callback.href;
}
export function googleReturnPath(purpose,error='') {
  const params=new URLSearchParams();
  if(purpose==='static_studio')params.set('tab','static-studio');
  if(error)params.set('drive_error',error);
  else params.set(purpose==='creator_email'?'gmail_connected':'drive_connected','1');
  return '/?'+params;
}
