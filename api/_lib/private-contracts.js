import { get } from '@vercel/blob';

export const CONTRACT_MAX_BYTES=20*1024*1024;

export function privateContractPath(value,token=process.env.HOWL_PRIVATE_READ_WRITE_TOKEN) {
  const store=token?.split('_')[3]?.toLowerCase();
  let url;
  try{url=new URL(value);}catch{throw new Error('Invalid private contract URL');}
  const pathname=decodeURIComponent(url.pathname).slice(1);
  if(!store || url.protocol!=='https:' || url.hostname!==`${store}.private.blob.vercel-storage.com`
    || url.username || url.password || url.port || url.search || url.hash
    || !pathname.startsWith('creator-contracts/') || /[\\\x00-\x1f]/.test(pathname)
    || pathname.split('/').some(part=>!part || part==='.' || part==='..'))throw new Error('Contract must belong to the configured private store');
  return pathname;
}

export async function requireRegisteredContract(sql,url,ownerId) {
  const pathname=privateContractPath(url);
  const [record]=await sql`SELECT owner_id FROM app_media_objects
    WHERE url=${url} AND pathname=${pathname} AND scope='creators' AND content_type='application/pdf'`;
  if(!record)throw Object.assign(new Error('Contract upload is still being verified. Please retry shortly.'),{statusCode:409});
  if(ownerId && record.owner_id!==ownerId)throw Object.assign(new Error('Contract upload belongs to another member'),{statusCode:403});
  return pathname;
}

export async function getPrivateContract(sql,url,signal,getBlob=get) {
  const pathname=await requireRegisteredContract(sql,url);
  // Pass a validated pathname, never a caller-supplied URL, to the credentialed SDK.
  const result=await getBlob(pathname,{access:'private',token:process.env.HOWL_PRIVATE_READ_WRITE_TOKEN,abortSignal:signal});
  if(!result || result.statusCode!==200)throw new Error('Contract file is unavailable');
  if(result.blob.contentType?.split(';')[0].trim().toLowerCase()!=='application/pdf'
    || !Number.isFinite(result.blob.size) || result.blob.size>CONTRACT_MAX_BYTES || result.blob.size<0) {
    await result.stream.cancel();
    throw new Error('Contract file has an invalid type or exceeds the size limit');
  }
  return result.stream;
}
