import {digest} from './operation-journal.js';

export async function ensureSessionCreation(sql) {
  await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS creation_key TEXT`;
  await sql`ALTER TABLE ugc_sessions ADD COLUMN IF NOT EXISTS creation_hash TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_ugc_sessions_creation_key ON ugc_sessions(creation_key)`;
}

export async function createSession(sql,actor,input) {
  const explicit=input.creation_key;
  if(explicit!=null && (typeof explicit!=='string' || !explicit.trim() || explicit.length>200))throw Object.assign(new Error('Invalid session creation key'),{statusCode:400});
  if(typeof input.video_url!=='string' || !input.video_url)throw Object.assign(new Error('video_url required'),{statusCode:400});
  const value={title:input.title || input.file_name || 'Untitled session',file_name:input.file_name || null,file_size:input.file_size || null,
    duration:input.duration || null,video_url:input.video_url,words:input.words || null,settings:input.settings || null,
    thumbnail_url:input.thumbnail_url || null,status:input.status || 'uploaded',creator_id:Number(input.creator_id) || null,
    source_type:input.source_type || (input.creator_id?'external_creator':'internal_employee'),
    source_label:input.source_label || (input.creator_id?null:actor.email) || null,brief_id:Number(input.brief_id) || null,deliverable_id:Number(input.deliverable_id) || null};
  // A retained upload URL identifies legacy retries. Callers may supply a stable
  // explicit key when intentionally creating another session for the same source.
  const key=digest(['ugc-session-create',actor.userId,explicit?'explicit':'upload',explicit || input.video_url]),hash=digest(value);
  const [session]=await sql`INSERT INTO ugc_sessions
    (user_id,title,file_name,file_size,duration,video_url,words,settings,thumbnail_url,status,creator_id,source_type,source_label,brief_id,deliverable_id,creation_key,creation_hash)
    VALUES (${actor.userId},${value.title},${value.file_name},${value.file_size},${value.duration},${value.video_url},
      ${value.words?JSON.stringify(value.words):null},${value.settings?JSON.stringify(value.settings):null},${value.thumbnail_url},${value.status},
      ${value.creator_id},${value.source_type},${value.source_label},${value.brief_id},${value.deliverable_id},${key},${hash})
    ON CONFLICT (creation_key) DO UPDATE SET creation_key=ugc_sessions.creation_key
      WHERE ugc_sessions.creation_hash=EXCLUDED.creation_hash
    RETURNING *`;
  if(!session)throw Object.assign(new Error('This upload was already saved with different session details. Open it from the session library.'),{statusCode:409});
  return session;
}
