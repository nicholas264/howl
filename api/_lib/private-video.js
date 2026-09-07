import {issueSignedToken,presignUrl} from '@vercel/blob';

export function videoSource(value,token=process.env.HOWL_PRIVATE_READ_WRITE_TOKEN) {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.username || url.password || url.port || url.hash)throw new Error('Invalid video source URL');
  if(url.hostname.endsWith('.public.blob.vercel-storage.com'))return {url,private:false};
  const store=token?.split('_')[3]?.toLowerCase();
  const pathname=decodeURIComponent(url.pathname).slice(1);
  if(!store || url.hostname!==`${store}.private.blob.vercel-storage.com` || url.search
    || !/^(ugc-source\/|creator-footage\/\d+\/|creator-submissions\/\d+\/)/.test(pathname)
    || /[\\\x00-\x1f]/.test(pathname) || pathname.split('/').some(p=>!p || p==='.' || p==='..'))throw new Error('Private video must belong to the configured media store');
  return {url,private:true,pathname};
}

export async function requirePrivateVideo(sql,value,ownerId) {
  const source=videoSource(value);
  if(!source.private)throw new Error('Expected a private video');
  const [record]=await sql`SELECT owner_id FROM app_media_objects WHERE url=${value} AND pathname=${source.pathname}
    AND scope IN ('assets','creators','submission') AND content_type LIKE 'video/%'`;
  if(!record)throw Object.assign(new Error('Video upload is still being verified. Retry shortly.'),{statusCode:409});
  if(ownerId && record.owner_id!==ownerId)throw Object.assign(new Error('Video upload belongs to another member'),{statusCode:403});
  return source;
}

// Call only after authorizing access to the record that references this video.
// The delegation itself is restricted to this pathname and operation; neither its
// signing material nor the store read/write token is returned to the caller.
export async function videoReadUrl(sql,value,{method='get',ttlSeconds=600}={},sdk={issueSignedToken,presignUrl}) {
  const source=videoSource(value);
  if(!source.private)return source.url.href;
  if(!['get','head'].includes(method) || !Number.isInteger(ttlSeconds) || ttlSeconds<1 || ttlSeconds>1800)throw new Error('Invalid video read grant');
  await requirePrivateVideo(sql,value);
  const validUntil=Date.now()+ttlSeconds*1000;
  const delegation=await sdk.issueSignedToken({token:process.env.HOWL_PRIVATE_READ_WRITE_TOKEN,
    pathname:source.pathname,operations:[method],validUntil,abortSignal:AbortSignal.timeout(10000)});
  const {presignedUrl}=await sdk.presignUrl(delegation,{pathname:source.pathname,operation:method,validUntil,access:'private'});
  const signed=new URL(presignedUrl);
  if(signed.origin!==source.url.origin || signed.pathname!==source.url.pathname || signed.username || signed.password || signed.hash)throw new Error('Signed video destination does not match its source');
  return presignedUrl;
}

export function redactPrivateMediaError(error,fallback='Video processing failed') {
  return String(error?.message || fallback).replace(/https:\/\/[^\s/]+\.private\.blob\.vercel-storage\.com\/[^\s"'<>]*/g,'[private media]').slice(0,2000);
}

export async function recordPrivateAudio(sql,blob,sessionId,ownerId) {
  const store=process.env.HOWL_PRIVATE_READ_WRITE_TOKEN?.split('_')[3]?.toLowerCase(),url=new URL(blob.url);
  if(!store || url.origin!==`https://${store}.private.blob.vercel-storage.com` || url.search || url.hash
    || decodeURIComponent(url.pathname).slice(1)!==blob.pathname || blob.contentType!=='audio/mpeg'
    || !blob.pathname.startsWith(`ugc-audio/session-${sessionId}-`) || !/^ugc-audio\/session-\d+-[^/\\\x00-\x1f]+\.mp3$/.test(blob.pathname)
    || typeof ownerId!=='string' || !ownerId || ownerId.length>256)throw new Error('Generated audio does not match the private destination');
  await sql`INSERT INTO app_media_objects(url,pathname,owner_id,scope,content_type)
    VALUES (${blob.url},${blob.pathname},${ownerId},'assets','audio/mpeg')`;
}
