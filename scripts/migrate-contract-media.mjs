import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {Readable} from 'node:stream';
import {neon} from '@neondatabase/serverless';
import {put,get,del} from '@vercel/blob';
import {fetchPublicResource} from '../api/_lib/safe-fetch.js';
import {CONTRACT_MAX_BYTES,privateContractPath,requireRegisteredContract} from '../api/_lib/private-contracts.js';
import {contractReferences,mediaHash,migrateContractReferences} from './lib/contract-migration.mjs';

const [mode,manifestPath,...extra]=process.argv.slice(2);
if(!['--plan','--apply','--retire-public'].includes(mode) || !manifestPath || !isAbsolute(manifestPath) || extra.length)throw new Error('Usage: node scripts/migrate-contract-media.mjs --plan|--apply|--retire-public /private/manifest.json');
const sql=neon(process.env.DATABASE_URL);
const privateToken=process.env.HOWL_PRIVATE_READ_WRITE_TOKEN,publicToken=process.env.BLOB_READ_WRITE_TOKEN;
const publicHost=`${publicToken?.split('_')[3]?.toLowerCase()}.public.blob.vercel-storage.com`;
const privateHost=`${privateToken?.split('_')[3]?.toLowerCase()}.private.blob.vercel-storage.com`;
if(!privateToken || !publicToken || privateHost.startsWith('undefined'))throw new Error('Both store credentials are required');
const [{database}]=await sql`SELECT current_database() AS database`;
const target={database,host:new URL(process.env.DATABASE_URL).hostname.replace('-pooler',''),publicHost,privateHost};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const save=async value=>{
  const temporary=manifestPath+'.'+randomUUID()+'.next';
  await writeFile(temporary,JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});
  await rename(temporary,manifestPath);
};
function publicSource(value){const url=new URL(value);if(url.protocol!=='https:' || url.hostname!==publicHost || url.username || url.password || url.port || url.search || url.hash || !url.pathname.startsWith('/creator-contracts/'))throw new Error('Unexpected public contract destination');return url;}
async function sourceBytes(url){publicSource(url);return (await fetchPublicResource(url,{maxBytes:CONTRACT_MAX_BYTES,timeoutMs:20000,contentTypes:/^application\/pdf(;|$)/i})).bytes;}
async function privateBytes(pathname){
  const result=await get(pathname,{access:'private',token:privateToken,abortSignal:AbortSignal.timeout(30000)});
  if(!result)return null;
  if(result.statusCode!==200 || result.blob.contentType?.split(';')[0]!=='application/pdf' || result.blob.size>CONTRACT_MAX_BYTES){await result.stream?.cancel();throw new Error('Invalid private copy');}
  const chunks=[];let size=0;
  for await(const chunk of Readable.fromWeb(result.stream)){size+=chunk.length;if(size>CONTRACT_MAX_BYTES)throw new Error('Private copy exceeds size limit');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function verifyCopy(entry){
  privateContractPath(entry.destination);
  const bytes=await privateBytes(entry.pathname);
  if(!bytes || bytes.length!==entry.bytes || mediaHash(bytes)!==entry.sha256)throw new Error('Private copy hash mismatch');
  const res=await fetch(entry.destination,{redirect:'manual',signal:AbortSignal.timeout(10000)});await res.body?.cancel();
  if(res.status!==403 && res.status!==401)throw new Error('Private copy did not deny anonymous access');
}

if(mode==='--plan'){
  const rows=await sql`SELECT to_jsonb(a) AS agreement FROM creator_agreements a WHERE source_pdf_url IS NOT NULL ORDER BY id`;
  const entries=[];
  await mkdir(manifestPath+'.files',{mode:0o700});
  for(const {agreement} of rows){
    if(new URL(agreement.source_pdf_url).hostname.endsWith('.private.blob.vercel-storage.com'))continue;
    publicSource(agreement.source_pdf_url);
    if(agreement.status!=='uploaded' || agreement.source_type!=='uploaded_pdf' || agreement.token_hash || agreement.accepted_at || agreement.sent_at || !agreement.created_by)throw new Error('Contract requires separate review');
    const activities=(await sql`SELECT to_jsonb(a) AS activity FROM creator_activity a WHERE metadata->>'source_pdf_url'=${agreement.source_pdf_url} ORDER BY id`).map(row=>row.activity);
    const references=await contractReferences(sql,agreement.source_pdf_url);
    if(references.creator_agreements!==1 || (references.creator_activity || 0)!==activities.length || Object.keys(references).some(key=>!['creator_agreements','creator_activity'].includes(key)))throw new Error('Unexpected contract references require review');
    const content=await sourceBytes(agreement.source_pdf_url),sha256=mediaHash(content);
    await writeFile(`${manifestPath}.files/${agreement.id}.pdf`,content,{mode:0o600,flag:'wx'});
    const pathname=`creator-contracts/migrated/${agreement.id}-${sha256}.pdf`;
    entries.push({agreement,activities,references,sha256,bytes:content.length,pathname,destination:`https://${privateHost}/${pathname}`,state:'planned'});
  }
  await writeFile(manifestPath,JSON.stringify({version:1,target,createdAt:new Date().toISOString(),entries},null,2),{mode:0o600,flag:'wx'});
  console.log({planned:entries.length,recoveryCopiesSaved:true});
}else{
  if((await stat(manifestPath)).mode & 0o077)throw new Error('Migration manifest must be owner-only');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  if(manifest.version!==1 || !same(manifest.target,target))throw new Error('Migration target does not match the snapshot');
  for(const entry of manifest.entries){
    publicSource(entry.agreement.source_pdf_url);
    if(privateContractPath(entry.destination)!==entry.pathname)throw new Error('Destination path does not match manifest URL');
    const backup=await readFile(`${manifestPath}.files/${entry.agreement.id}.pdf`);
    if(mediaHash(backup)!==entry.sha256 || backup.length!==entry.bytes)throw new Error('Local recovery copy failed verification');
    const [current]=await sql`SELECT to_jsonb(a) AS agreement FROM creator_agreements a WHERE id=${entry.agreement.id}`;
    if(!current)throw new Error('Agreement no longer exists');
    if(mode==='--apply'){
      if(current.agreement.source_pdf_url!==entry.destination){
        if(!same(current.agreement,entry.agreement))throw new Error('Agreement changed since snapshot');
        if(mediaHash(await sourceBytes(entry.agreement.source_pdf_url))!==entry.sha256)throw new Error('Public source changed since snapshot');
        const existing=await privateBytes(entry.pathname);
        if(existing){if(mediaHash(existing)!==entry.sha256)throw new Error('Existing destination differs from recovery copy');}
        else {const created=await put(entry.pathname,backup,{access:'private',token:privateToken,contentType:'application/pdf',addRandomSuffix:false,allowOverwrite:false});if(created.url!==entry.destination)throw new Error('Unexpected private upload URL');}
        await verifyCopy(entry);
        await migrateContractReferences(sql,entry);
      }
      await requireRegisteredContract(sql,entry.destination,entry.agreement.created_by);
      await verifyCopy(entry);
      if(entry.state!=='retired')entry.state='migrated';await save(manifest);
      console.log({agreementId:entry.agreement.id,state:entry.state});
    }else{
      if(current.agreement.source_pdf_url!==entry.destination)throw new Error('Agreement has not been migrated');
      await requireRegisteredContract(sql,entry.destination,entry.agreement.created_by);
      await verifyCopy(entry);
      if(Object.keys(await contractReferences(sql,entry.agreement.source_pdf_url)).length)throw new Error('Public source still has database references');
      const before=await fetch(entry.agreement.source_pdf_url,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(10000)});
      if(before.status!==404){
        if(mediaHash(await sourceBytes(entry.agreement.source_pdf_url))!==entry.sha256)throw new Error('Public source changed; refusing retirement');
        await del(entry.agreement.source_pdf_url,{token:publicToken});
      }
      entry.state='retirement_requested';await save(manifest);
      const after=await fetch(entry.agreement.source_pdf_url,{redirect:'manual',signal:AbortSignal.timeout(10000)});await after.body?.cancel();
      if(after.status!==404)throw new Error('Public retirement is not yet verified; rerun after cache propagation');
      entry.state='retired';await save(manifest);
      console.log({agreementId:entry.agreement.id,state:entry.state});
    }
  }
}
