import {uploadPolicy} from './upload-policy.js';

export async function ensureMediaObjects(sql) {
  await sql`CREATE TABLE IF NOT EXISTS app_media_objects (
    url TEXT PRIMARY KEY, pathname TEXT NOT NULL, owner_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('assets','creators','submission')),
    content_type TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS app_media_objects_owner ON app_media_objects(owner_id,created_at)`;
}

// Call only after the Blob SDK has verified the completion callback signature.
export async function recordBlobUpload(sql,{blob,tokenPayload},token=process.env.BLOB_READ_WRITE_TOKEN,access='public') {
  let identity;
  try{identity=JSON.parse(tokenPayload);}catch{return {legacy:true};}
  if(identity?.v!==1)return {legacy:true};
  if(typeof identity.ownerId!=='string' || !identity.ownerId || identity.ownerId.length>256
    || !['assets','creators','submission'].includes(identity.scope))throw new Error('Invalid upload ownership metadata');
  const url=new URL(blob.url),store=token?.split('_')[3]?.toLowerCase();
  if(!store || url.protocol!=='https:' || url.hostname!==`${store}.${access}.blob.vercel-storage.com`
    || url.username || url.password || url.port || url.search || url.hash
    || decodeURIComponent(url.pathname).slice(1)!==blob.pathname)throw new Error('Upload callback does not match the configured store');
  const contentType=String(blob.contentType || '').split(';')[0].trim().toLowerCase();
  if(identity.scope==='submission') {
    const id=identity.ownerId.match(/^creator-submit:(\d+)$/)?.[1];
    if(!id || !blob.pathname.startsWith(`creator-submissions/${id}/`) || !contentType.startsWith('video/'))throw new Error('Upload callback does not match its submission');
  } else {
    const policy=uploadPolicy(blob.pathname);
    if(policy.permission!==`${identity.scope}.write` || !policy.allowedContentTypes.includes(contentType))throw new Error('Upload callback does not match its purpose');
  }
  const [record]=await sql`INSERT INTO app_media_objects(url,pathname,owner_id,scope,content_type)
    VALUES (${blob.url},${blob.pathname},${identity.ownerId},${identity.scope},${contentType})
    ON CONFLICT (url) DO UPDATE SET last_seen_at=now()
    WHERE app_media_objects.owner_id=EXCLUDED.owner_id AND app_media_objects.scope=EXCLUDED.scope
      AND app_media_objects.pathname=EXCLUDED.pathname AND app_media_objects.content_type=EXCLUDED.content_type
    RETURNING url`;
  if(!record)throw new Error('Upload ownership conflicts with its existing record');
  return {recorded:true};
}
