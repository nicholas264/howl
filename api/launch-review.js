import {creativeTestIntent} from '../src/lib/creative-test-intent.js';
import {newAdsetIntent,validReviewMediaRoles} from '../src/lib/launch-review.js';
import {requirePermission,hasPermission} from './_lib/app-access.js';
import {assertLaunchReady,assertApprovalMediaMatches} from './_lib/launch-preflight.js';
import {driveContentDigest} from './_lib/approval-evidence.js';
import {fetchPublicResource} from './_lib/safe-fetch.js';
import {digest} from './_lib/operation-journal.js';
import {videoReadUrl,redactPrivateMediaError} from './_lib/private-video.js';
import {claimWork,finishWork} from './_lib/work-controls.js';
import {checkRateLimit,sendRateLimited} from './_lib/rate-limit.js';
import {readLaunchAdset} from './_lib/launch-packets.js';

export const config={maxDuration:120};
export default async function handler(req,res) {
  const access=await requirePermission(req,res,'launch.write');if(!access)return;
  res.setHeader('Cache-Control','private, no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  let workId;
  try{
    const input=req.body?.input,media=req.body?.media;
    if(!input || typeof input!=='object' || !validReviewMediaRoles(media))
      return res.status(400).json({error:'One creative with a single asset, a pair, or up to ten ordered cards is required.'});
    if(media.some(item=>item.role.startsWith('card:')&&item.drive_file_id))return res.status(400).json({error:'Carousel review requires image URLs or local image fingerprints.'});
    const creativeTest=req.body.creative_test?creativeTestIntent(req.body.creative_test):null;
    const newAdset=req.body.new_adset?newAdsetIntent(req.body.new_adset):null;
    const limit=await checkRateLimit(access.sql,{route:'launch-review',key:digest(access.userId),limit:120,windowSeconds:3600});
    if(!limit.allowed)return sendRateLimited(res,limit);
    workId=await claimWork(access.sql,'launch-review',access.userId,{globalLimit:4,userLimit:2,ttlSeconds:150});
    if(!workId){res.setHeader('Retry-After','15');return res.status(429).json({error:'Other launch reviews are running. Retry shortly.'});}
    const deadline=Date.now()+85000;
    const approval=await assertLaunchReady(access.sql,{...input,review_sources:media.map(item=>item.drive_file_id?{drive_file_id:item.drive_file_id}:item.url?{role:item.role,imageUrl:item.url}:{})});
    const checked=[];
    for(const item of media){
      if(Date.now()>=deadline)throw new Error('Media review timed out. Review fewer creatives at once.');
      if(item.drive_file_id){
        if(!/^[A-Za-z0-9_-]{1,200}$/.test(item.drive_file_id))throw new Error('Invalid Drive file');
        checked.push({role:item.role,drive_file_id:item.drive_file_id,drive_md5:await driveContentDigest(item.drive_file_id)});
      }else if(item.url){
        const url=new URL(item.url);
        if(url.protocol!=='https:')throw new Error('Remote launch media must use HTTPS');
        let readable=item.url;
        if(url.hostname.endsWith('.private.blob.vercel-storage.com')){
          if(!hasPermission(access,'assets.read'))return res.status(403).json({error:'Asset read permission required'});
          const [session]=await access.sql`SELECT id FROM ugc_sessions WHERE video_url=${item.url} LIMIT 1`;
          if(!session)throw new Error('Private source must be attached to an accessible session before review');
          readable=await videoReadUrl(access.sql,item.url);
        }
        const result=await fetchPublicResource(readable,{maxBytes:2*1024*1024*1024,timeoutMs:Math.max(1,deadline-Date.now()),hashOnly:true,contentTypes:/^(video|image)\//i});
        checked.push({role:item.role,url:item.url,sha256:result.sha256,size:result.size});
      }else if(/^[a-f0-9]{64}$/.test(item.sha256 || '')){
        checked.push({role:item.role,sha256:item.sha256});
      }else throw new Error('Media reference or local content fingerprint required');
    }
    assertApprovalMediaMatches(approval,checked);
    const approvals=JSON.parse(JSON.stringify([approval]));
    const adset=req.body.adset_id?await readLaunchAdset(req.body.adset_id):null;
    return res.json({approvals,approval_hash:digest(approvals),media:checked,adset,new_adset:newAdset,creative_test:creativeTest,
      default_instagram_user_id:input.action==='launch_meta_ad'?(process.env.META_INSTAGRAM_USER_ID || '').trim():''});
  }catch(error){return res.status(error.statusCode || 400).json({error:redactPrivateMediaError(error)});}
  finally{if(workId)await finishWork(access.sql,workId,'launch-review',res.statusCode || 200).catch(error=>console.error('Review lease release failed',error.message));}
}
