export async function associateDrivePair(sql,{feedFileId,storyFileId,userId,email=null}) {
  if(![feedFileId,storyFileId].every(id=>typeof id==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(id)) || feedFileId===storyFileId) {
    throw Object.assign(new Error('Select two distinct valid Drive files'),{statusCode:400});
  }
  try {
    // Serializable isolation also protects cross-column reuse: one file cannot
    // concurrently become the feed in one pair and the story in another.
    const results=await sql.transaction(tx=>[
      tx`DELETE FROM ugc_asset_pairs WHERE feed_file_id IN (${feedFileId},${storyFileId}) OR story_file_id IN (${feedFileId},${storyFileId})`,
      tx`INSERT INTO ugc_asset_pairs(feed_file_id,story_file_id,created_by_user_id,created_by_email,updated_at)
        VALUES (${feedFileId},${storyFileId},${userId},${email},now()) RETURNING *`,
    ],{isolationLevel:'Serializable'});
    return results[1][0];
  } catch(error) {
    if(['40001','40P01','23505'].includes(error.code)) throw Object.assign(new Error('These files were paired concurrently. Reload the assets before trying again.'),{statusCode:409});
    throw error;
  }
}
