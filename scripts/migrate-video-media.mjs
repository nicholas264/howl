import {readFile,writeFile,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {neon} from '@neondatabase/serverless';
import {get,put} from '@vercel/blob';
import {fetchPublicResource} from '../api/_lib/safe-fetch.js';
import {contractReferences,mediaHash} from './lib/contract-migration.mjs';
import {migrateVideoReference} from './lib/video-migration.mjs';
const [mode,path,...extra]=process.argv.slice(2);
if(!['--plan','--apply'].includes(mode)||!isAbsolute(path||'')||extra.length)throw Error('Usage: --plan|--apply /private/manifest.json');
const sql=neon(process.env.DATABASE_URL),token=process.env.HOWL_PRIVATE_READ_WRITE_TOKEN;
const privateHost=`${token?.split('_')[3]?.toLowerCase()}.private.blob.vercel-storage.com`;
const publicHost=`${process.env.BLOB_READ_WRITE_TOKEN?.split('_')[3]?.toLowerCase()}.public.blob.vercel-storage.com`;
if(!token||!process.env.BLOB_READ_WRITE_TOKEN)throw Error('Both storage credentials required');
const [{database}]=await sql`SELECT current_database() AS database`;
const target={database,host:new URL(process.env.DATABASE_URL).hostname,privateHost,publicHost};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const assertRefs=async url=>{const refs=await contractReferences(sql,url);if(refs.ugc_sessions!==1||Object.keys(refs).length!==1)throw Error('Unexpected source references; separate review required');};
const sourceBytes=async value=>{
 const url=new URL(value);
 if(url.origin!==`https://${publicHost}`||url.search||url.hash||url.username||url.password||!url.pathname.startsWith('/ugc-source/'))throw Error('Unexpected public source');
 // This migration is restricted to the reviewed small editor source. Larger
 // objects require a streaming migration and must not be buffered here.
 return (await fetchPublicResource(url,{maxBytes:100*1024*1024,timeoutMs:120000,contentTypes:/^video\/mp4(;|$)/i})).bytes;
};
if(mode==='--plan'){
 const rows=await sql`SELECT to_jsonb(u) AS session FROM ugc_sessions u WHERE video_url LIKE 'https://%.public.blob.vercel-storage.com/%'`;
 if(rows.length!==1)throw Error('Expected the one reviewed public source');
 const {session}=rows[0];
 if(!session.user_id||session.creator_id||session.deliverable_id||['rendering','render_unknown','transcribing'].includes(session.status))throw Error('Session needs separate review');
 await assertRefs(session.video_url);
 const bytes=await sourceBytes(session.video_url),sha256=mediaHash(bytes),pathname=`ugc-source/migrated/${session.id}-${sha256}.mp4`;
 await writeFile(path+'.mp4',bytes,{mode:0o600,flag:'wx'});
 await writeFile(path,JSON.stringify({version:1,target,session,sha256,bytes:bytes.length,pathname,url:`https://${privateHost}/${pathname}`},null,2),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({planned:1,bytes:bytes.length,recoveryCopySaved:true}));
}else{
 if((await stat(path)).mode&0o077||(await stat(path+'.mp4')).mode&0o077)throw Error('Recovery files must be owner-only');
 const entry=JSON.parse(await readFile(path,'utf8')),bytes=await readFile(path+'.mp4');
 if(entry.version!==1||!same(entry.target,target)||mediaHash(bytes)!==entry.sha256||bytes.length!==entry.bytes)throw Error('Migration target or recovery copy mismatch');
 if(entry.pathname!==`ugc-source/migrated/${entry.session.id}-${entry.sha256}.mp4`||entry.url!==`https://${privateHost}/${entry.pathname}`)throw Error('Invalid destination');
 const [{session}]=await sql`SELECT to_jsonb(u) AS session FROM ugc_sessions u WHERE id=${entry.session.id}`;
 const already=session.video_url===entry.url;
 if(!already){if(!same(session,entry.session))throw Error('Session changed since plan');await assertRefs(session.video_url);if(mediaHash(await sourceBytes(session.video_url))!==entry.sha256)throw Error('Public source changed');}
 let copy=await get(entry.pathname,{access:'private',token,abortSignal:AbortSignal.timeout(120000)});
 if(!copy){await put(entry.pathname,bytes,{access:'private',token,addRandomSuffix:false,allowOverwrite:false,contentType:'video/mp4',abortSignal:AbortSignal.timeout(120000)});copy=await get(entry.pathname,{access:'private',token,abortSignal:AbortSignal.timeout(120000)});}
 if(!copy||copy.statusCode!==200||copy.blob.size!==entry.bytes){await copy?.stream?.cancel();throw Error('Private copy metadata mismatch');}
 const chunks=[];let size=0;for await(const chunk of copy.stream){size+=chunk.length;if(size>entry.bytes)throw Error('Private copy exceeds expected size');chunks.push(chunk);}
 if(size!==entry.bytes||mediaHash(Buffer.concat(chunks))!==entry.sha256)throw Error('Private copy hash mismatch');
 const anonymous=await fetch(entry.url,{redirect:'manual',signal:AbortSignal.timeout(10000)});await anonymous.body?.cancel();if(![401,403].includes(anonymous.status))throw Error('Private copy allows anonymous access');
 if(!already&&!await migrateVideoReference(sql,session,entry))throw Error('Concurrent change prevented migration');
 const [owner]=await sql`SELECT owner_id FROM app_media_objects WHERE url=${entry.url} AND pathname=${entry.pathname}`;
 if(owner?.owner_id!==entry.session.user_id)throw Error('Private ownership verification failed');
 console.log(JSON.stringify({migrated:1,replay:already,hashVerified:true,anonymousDenied:true,publicOriginalRetained:true}));
}
