import { requirePermission } from './_lib/app-access.js';
import { getScript, saveScript, scriptPerformance, scriptDocumentHtml } from './_lib/script-studio-store.js';
import { getGoogleConnection, getUserGoogleAccessToken } from './_lib/google-user-oauth.js';
import { runExternalStep, digest } from './_lib/operation-journal.js';
import { validateBrandCopy, loadBrandGuidelines } from './_lib/brand-guardrails.js';

export default async function handler(req,res) {
  const action=req.query?.action || req.body?.action || 'list';
  const permission=['performance','ads'].includes(action)?'analytics.read':['link_ad','unlink_ad'].includes(action)?'analytics.write':req.method==='GET'?'briefs.read':'briefs.write';
  const access=await requirePermission(req,res,permission);if(!access)return;
  const {sql,userId}=access;res.setHeader('Cache-Control','no-store');
  try {
    if(req.method==='GET') {
      if(action==='list') {
        const offset=Math.max(0,Math.min(100000,Number(req.query?.offset)||0));
        const scripts=await sql`SELECT id,parent_id,title,product,delivery,created_by,created_at FROM script_studio_scripts ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ${Math.floor(offset)}`;
        return res.json({scripts:scripts.slice(0,50),next_offset:scripts.length>50?offset+50:null});
      }
      if(action==='get')return res.json({saved:await getScript(sql,req.query?.id)});
      if(action==='performance')return res.json(await scriptPerformance(sql,req.query?.id,req.query?.days||30));
      if(action==='ads') {
        const search=String(req.query?.q||'').slice(0,200);
        const ads=await sql`SELECT DISTINCT ON (l.ad_id) l.ad_id,l.ad_name,l.launched_at,a.script_id,a.hook_variant FROM launch_history l LEFT JOIN script_studio_ads a ON a.ad_id=l.ad_id
          WHERE l.ad_id ILIKE ${'%'+search+'%'} OR l.ad_name ILIKE ${'%'+search+'%'} ORDER BY l.ad_id,l.launched_at DESC LIMIT 50`;
        return res.json({ads});
      }
      return res.status(400).json({error:'Unknown action.'});
    }
    if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
    const body=req.body||{};
    if(JSON.stringify(body).length>150000)return res.status(413).json({error:'Script is too large.'});
    if(action==='save') {
      const violations=validateBrandCopy(JSON.stringify(body.script||{}),await loadBrandGuidelines(sql));
      if(violations.length)return res.status(422).json({error:`Brand checks flagged: ${violations.join(', ')}`});
      return res.status(201).json({saved:await saveScript(sql,userId,body)});
    }
    if(action==='link_ad'||action==='unlink_ad') {
      const saved=await getScript(sql,body.id);
      const adId=String(body.ad_id||'').trim();
      if(!/^\d{5,40}$/.test(adId))return res.status(400).json({error:'Enter a valid Meta ad ID.'});
      if(action==='unlink_ad') {await sql`DELETE FROM script_studio_ads WHERE ad_id=${adId} AND script_id=${saved.id}`;return res.json({ok:true});}
      const variant=body.hook_variant;
      if(!['primary','first','second','third','custom'].includes(variant))return res.status(400).json({error:'Choose the hook actually used in this ad.'});
      const known=await sql`SELECT ad_id FROM launch_history WHERE ad_id=${adId} UNION SELECT ad_id FROM creative_insights_daily WHERE ad_id=${adId} LIMIT 1`;
      if(!known.length)return res.status(400).json({error:'This ad is not in Campfire yet. Sync its Meta results or launch it through Campfire first.'});
      const [linked]=await sql`INSERT INTO script_studio_ads(ad_id,script_id,hook_variant,linked_by) VALUES (${adId},${saved.id},${variant},${userId})
        ON CONFLICT(ad_id) DO UPDATE SET hook_variant=EXCLUDED.hook_variant WHERE script_studio_ads.script_id=EXCLUDED.script_id RETURNING *`;
      if(!linked)return res.status(409).json({error:'This ad already belongs to another saved script version. Unlink it there before reassigning it.'});
      return res.json({linked});
    }
    if(action==='export_docs') {
      const saved=await getScript(sql,body.id);
      const connection=await getGoogleConnection(sql,userId);
      if(!connection?.scopes?.some(s=>['https://www.googleapis.com/auth/drive.file','https://www.googleapis.com/auth/drive'].includes(s)))return res.status(409).json({error:'Connect Google Docs to export scripts.',reconnect_required:true});
      const token=await getUserGoogleAccessToken(sql,userId);
      const html=scriptDocumentHtml(saved);
      const result=await runExternalStep(sql,{operationKey:digest(['script-doc',saved.id,userId]),stepKey:'create',payload:{id:saved.id,content:digest(html)},actorId:userId},async()=>{
        const boundary='howl_script_'+saved.id;
        const metadata={name:`${saved.title} — HOWL ${saved.id.slice(0,8)}`,mimeType:'application/vnd.google-apps.document',appProperties:{howlScriptId:saved.id}};
        const payload=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${boundary}--`;
        const response=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':`multipart/related; boundary=${boundary}`},body:payload,signal:AbortSignal.timeout(45000)});
        const file=await response.json();
        if(!response.ok)throw Object.assign(new Error('Google Docs export failed. Check the Google connection and try again.'),{statusCode:502,definitelyNotApplied:response.status<500});
        if(!file.id || file.mimeType!=='application/vnd.google-apps.document' || !/^https:\/\/docs\.google\.com\//.test(file.webViewLink||''))throw new Error('Google did not confirm a document. Review the export before retrying.');
        return {id:file.id,url:file.webViewLink,name:file.name};
      });
      // Read-back also verifies access and conversion when returning a cached export.
      const check=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(result.id)}?fields=id,mimeType,webViewLink,trashed`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
      const file=await check.json();
      if(!check.ok || file.trashed || file.mimeType!=='application/vnd.google-apps.document')return res.status(409).json({error:'The exported document could not be verified. Check your Google Drive access.'});
      return res.json({document:result});
    }
    return res.status(400).json({error:'Unknown action.'});
  } catch(error) {return res.status(error.statusCode || (error.reconnectRequired?409:500)).json({error:error.message,reconnect_required:Boolean(error.reconnectRequired)});}
}
