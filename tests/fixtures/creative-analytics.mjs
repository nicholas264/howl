import { initializeSchema } from '../../api/db/schema.js';
export async function seedCreativeAnalytics(db) {
  const sql = async (parts,...values) => (await db.query(parts.reduce((text,part,i) => text+(i?`$${i}`:'')+part,''),values)).rows;
  await initializeSchema(sql);
  const [creator] = await sql`INSERT INTO creators(name) VALUES ('Demo Creator') RETURNING id`;
  const [archived] = await sql`INSERT INTO creators(name, source, archived_at) VALUES ('Past Creator', 'clickup', now()) RETURNING id`;
  for (let i=0;i<16;i++) {
    const key=`fixture-${i}`, ad=`fixture-ad-${i}`;
    await sql`INSERT INTO creative_performance(ad_id,ad_name,group_key,image_hash,created_time,status) VALUES (${ad},${['Product walkthrough','Evening outside','Pack down demonstration','First impressions'][i%4] + ' ' + (i+1)},${key},${key},now(),'ACTIVE')`;
    await sql`INSERT INTO creative_insights_daily(ad_id,date,spend,purchases,purchase_value,impressions,clicks) VALUES (${ad},current_date,${2400-i*120},${20+i},${8000-i*200},10000,120)`;
    await sql`INSERT INTO creative_assets(group_key,mime_type) VALUES (${key},'image/jpeg')`;
    if(i%3===0) await sql`INSERT INTO creative_creator_assignments(group_key,creator_id,source_type,source_label) VALUES (${key},${creator.id},'external_creator','Demo Creator')`;
  }
  return {sql, creator, archived};
}
