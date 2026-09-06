import { randomUUID } from 'node:crypto';
export async function ensureTranscriptionJobs(sql) {
  await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS transcription_token TEXT`;
}
export async function claimTranscription(sql,id,sourceUrl) {
  await ensureTranscriptionJobs(sql);
  const token=randomUUID();
  const [claimed]=await sql`UPDATE ugc_sessions SET status='transcribing',transcription_token=${token},last_error=NULL,updated_at=now()
    WHERE id=${id} AND video_url=${sourceUrl}
      AND status NOT IN ('rendering','render_unknown')
      AND (status<>'transcribing' OR updated_at<now()-interval '6 minutes')
    RETURNING revision`;
  return claimed ? {token,revision:claimed.revision} : null;
}
export async function saveTranscription(sql,id,sourceUrl,job,{words,duration,audioUrl}) {
  const [saved]=await sql`UPDATE ugc_sessions SET words=${JSON.stringify(words)},duration=${duration},audio_url=${audioUrl},
      status='transcribed',transcription_token=NULL,last_error=NULL,revision=revision+1,updated_at=now()
    WHERE id=${id} AND video_url=${sourceUrl} AND transcription_token=${job.token} AND revision=${job.revision}
    RETURNING id`;
  return Boolean(saved);
}
