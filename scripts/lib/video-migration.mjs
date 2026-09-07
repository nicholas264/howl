// Source copy and reference inventory must be verified by the caller first.
export async function migrateVideoReference(sql,session,{url,pathname}) {
 if(!session.user_id || session.creator_id || session.deliverable_id || ['rendering','render_unknown','transcribing'].includes(session.status))throw new Error('Source session requires separate migration review');
 const target=new URL(url);
 if(target.protocol!=='https:' || !target.hostname.endsWith('.private.blob.vercel-storage.com') || target.search || target.hash || target.username || target.password || target.port
  || decodeURIComponent(target.pathname).slice(1)!==pathname || !/^ugc-source\/migrated\/\d+-[a-f0-9]{64}\.mp4$/.test(pathname))throw new Error('Invalid private migration destination');
 const [saved]=await sql`WITH moved AS (
  UPDATE ugc_sessions u SET video_url=${url},revision=revision+1,updated_at=now()
  WHERE id=${session.id} AND to_jsonb(u)=${JSON.stringify(session)}::jsonb RETURNING id,user_id
 ), registered AS (
  INSERT INTO app_media_objects(url,pathname,owner_id,scope,content_type)
  SELECT ${url},${pathname},user_id,'assets','video/mp4' FROM moved RETURNING url
 ) SELECT moved.id FROM moved JOIN registered ON true`;
 return Boolean(saved);
}
