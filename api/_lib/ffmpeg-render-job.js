import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export async function claimFfmpegRender(sql,session) {
 const token=randomUUID();
 const [claimed]=await sql`UPDATE ugc_sessions SET status='rendering',last_error=NULL,
  settings=COALESCE(settings,'{}'::jsonb) || ${JSON.stringify({ffmpeg_attempt:token,ffmpeg_started_at:new Date().toISOString(),remotion_render:null})}::jsonb,updated_at=now()
  WHERE id=${session.id} AND video_url=${session.video_url} AND revision=${session.revision}
   AND status NOT IN ('rendering','render_unknown','transcribing') RETURNING id`;
 return claimed?token:null;
}

export async function saveFfmpegRender(sql,session,token,url,userId) {
 const [saved]=await sql`WITH saved AS (
  UPDATE ugc_sessions SET rendered_url=${url},status='rendered',last_error=NULL,revision=revision+1,updated_at=now()
  WHERE id=${session.id} AND video_url=${session.video_url} AND revision=${session.revision}
   AND status='rendering' AND settings->>'ffmpeg_attempt'=${token}
  RETURNING id,creator_id,deliverable_id
 ), deliverable_update AS (
  UPDATE creator_deliverables d SET output_url=${url},status='edited',completed_asset_count=GREATEST(completed_asset_count,1),
   completed_at=COALESCE(completed_at,now()),updated_at=now()
  FROM saved WHERE d.id=saved.deliverable_id AND d.creator_id=saved.creator_id
   AND d.status IN ('requested','received','editing','edited')
 ), activity AS (
  INSERT INTO creator_activity(creator_id,kind,summary,metadata,user_id)
  SELECT creator_id,'edit_rendered','Creator footage rendered',
   jsonb_build_object('session_id',id,'deliverable_id',deliverable_id,'output_url',${url}::text),${userId}
  FROM saved WHERE creator_id IS NOT NULL
 ) SELECT id FROM saved`;
 return Boolean(saved);
}

export async function failFfmpegRender(sql,id,token,message) {
 await sql`UPDATE ugc_sessions SET status='render_error',last_error=${message},updated_at=now()
  WHERE id=${id} AND status='rendering' AND settings->>'ffmpeg_attempt'=${token}`;
}

export function runFfmpeg(args,signal,spawnProcess=spawn) {
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const child=spawnProcess(ffmpegPath,args,{stdio:['ignore','ignore','pipe']});let stderr='';
  const abort=()=>child.kill('SIGKILL');
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)abort();
  child.stderr.on('data',chunk=>{stderr=`${stderr}${chunk}`.slice(-12000);});
  child.once('error',error=>{signal.removeEventListener('abort',abort);reject(error);});
  child.once('close',code=>{
   signal.removeEventListener('abort',abort);
   if(signal.aborted)reject(new Error('Render exceeded its processing deadline'));
   else if(code===0)resolve();else reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-2500)}`));
  });
 });
}
