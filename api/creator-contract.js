import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { requirePermission } from './_lib/app-access.js';
import { CONTRACT_MAX_BYTES, getPrivateContract } from './_lib/private-contracts.js';
import { fetchPublicResource } from './_lib/safe-fetch.js';

export const config={maxDuration:60};

export default async function handler(req, res) {
  const access = await requirePermission(req, res, 'creators.read');
  if (!access) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new Error('Contract download timed out')),45000);
  const disconnected=()=>controller.abort(new Error('Contract download disconnected'));
  res.once('close',disconnected);
  try {
    const id = Number(req.query.id);
    if (!Number.isSafeInteger(id) || id<=0) return res.status(400).json({ error: 'Agreement id required' });
    const [agreement] = await access.sql`
      SELECT id, title, source_pdf_url, source_file_name
      FROM creator_agreements
      WHERE id = ${id}
        AND source_type = 'uploaded_pdf'
        AND source_pdf_url IS NOT NULL
      LIMIT 1
    `;
    if (!agreement) return res.status(404).json({ error: 'Uploaded contract not found' });

    const url=new URL(agreement.source_pdf_url);
    let source;
    if(url.hostname.endsWith('.private.blob.vercel-storage.com')) {
      source=Readable.fromWeb(await getPrivateContract(access.sql,agreement.source_pdf_url,controller.signal));
    } else {
      // Legacy contracts remain readable with pinned public DNS, checked redirects,
      // a strict PDF type, a size cap and a deadline. No storage token is sent.
      const legacy=await fetchPublicResource(agreement.source_pdf_url,{
        maxBytes:CONTRACT_MAX_BYTES,timeoutMs:20000,contentTypes:/^application\/pdf(;|$)/i,
      });
      source=Readable.from([legacy.bytes]);
    }
    const name=String(agreement.source_file_name || agreement.title || 'creator-contract.pdf').slice(0,180);
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`inline; filename="creator-contract.pdf"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`);
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
    res.status(200);
    let bytes=0;
    const bounded=new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;done(bytes>CONTRACT_MAX_BYTES?new Error('Contract exceeds size limit'):null,chunk);}});
    await pipeline(source,bounded,res,{signal:controller.signal});
  } catch (err) {
    console.error('creator-contract error', err.message);
    if(!res.headersSent && !res.destroyed)return res.status(err.statusCode || 502).json({error:err.message || 'Contract download failed'});
    if(!res.destroyed)res.destroy(err);
  } finally {
    clearTimeout(timer);
    res.off('close',disconnected);
  }
}
