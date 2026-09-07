import {createHash} from 'node:crypto';

export const mediaHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const identifier=value=>'"'+String(value).replaceAll('"','""')+'"';

export async function contractReferences(sql,url) {
  const tables=await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const references={};
  for(const {tablename} of tables) {
    const [row]=await sql.query(`SELECT count(*)::int AS n FROM public.${identifier(tablename)} t WHERE position($1 in to_jsonb(t)::text)>0`,[url]);
    if(row.n)references[tablename]=row.n;
  }
  return references;
}

// The file has already been copied and hash-verified. Change every known database
// reference atomically, preserving the agreement's owner, status, version and terms.
export async function migrateContractReferences(sql,entry) {
  const {agreement,activities,destination,pathname,sha256,bytes}=entry;
  if(agreement.status!=='uploaded' || agreement.source_type!=='uploaded_pdf'
    || agreement.token_hash || agreement.accepted_at || agreement.sent_at || !agreement.created_by)throw new Error('Only unsent uploaded contracts can use this migration');
  const [result]=await sql`
    WITH moved AS (
      UPDATE creator_agreements a SET source_pdf_url=${destination},
        agreement_body=replace(a.agreement_body,${agreement.source_pdf_url},${destination}),updated_at=now()
      WHERE a.id=${agreement.id} AND to_jsonb(a)=${JSON.stringify(agreement)}::jsonb
      RETURNING a.id,a.creator_id,a.created_by
    ), registered AS (
      INSERT INTO app_media_objects(url,pathname,owner_id,scope,content_type)
      SELECT ${destination},${pathname},created_by,'creators','application/pdf' FROM moved RETURNING url
    ), activity AS (
      UPDATE creator_activity a SET metadata=jsonb_set(a.metadata,'{source_pdf_url}',to_jsonb(${destination}::text))
      FROM moved WHERE a.creator_id=moved.creator_id
        AND a.metadata->>'source_pdf_url'=${agreement.source_pdf_url}
        AND to_jsonb(a) IN (SELECT value FROM jsonb_array_elements(${JSON.stringify(activities)}::jsonb))
      RETURNING a.id
    ), audited AS (
      INSERT INTO creator_activity(creator_id,kind,summary,metadata,user_id)
      SELECT creator_id,'contract_media_migrated','Contract PDF moved to private storage',
        ${JSON.stringify({agreement_id:agreement.id,sha256,bytes,source_pdf_url:destination})}::jsonb,created_by FROM moved
      RETURNING id
    )
    SELECT moved.id, 1 / CASE WHEN (SELECT count(*) FROM registered)=1
      AND (SELECT count(*) FROM activity)=${activities.length} AND (SELECT count(*) FROM audited)=1 THEN 1 ELSE 0 END AS verified
    FROM moved`;
  if(!result)throw new Error('Contract changed after the migration snapshot; no references were moved');
  return result;
}
