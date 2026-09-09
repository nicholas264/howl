import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceImages, resolveReferenceImages, accountReferenceRows } from '../api/_lib/static-studio-references.js';
const a = 'a'.repeat(32), b = 'b'.repeat(32);
test('keeps dynamic alternatives and carousel images without confusing video thumbnails with statics', () => {
  assert.deepEqual(referenceImages({thumbnail_url:'https://example.com/video.jpg'}), []);
  const images = referenceImages({image_hash:a, asset_feed_spec:{images:[{hash:b,adlabels:[{name:'Story'}]},{hash:a}]},object_story_spec:{link_data:{child_attachments:[{image_hash:b}]}}});
  assert.equal(images.length, 2);
  assert.match(images[1].label, /Story.*Carousel card 1/);
  assert.deepEqual(referenceImages({image_hash:'https://example.com'}), []);
});
test('Meta resolver binds to account, uses header auth, and excludes unexpected hashes and hosts', async () => {
  const images = await resolveReferenceImages([a], {accountId:'act_123',token:'test-secret',fetchImpl:async (url, options) => {
    assert.match(url, /\/act_123\/adimages\?/); assert.ok(!url.includes('test-secret'));
    assert.equal(options.headers.Authorization, 'Bearer test-secret'); assert.equal(options.redirect, 'error');
    return {ok:true,status:200,json:async()=>({data:[{hash:a,url:'https://scontent.fbcdn.net/original.jpg',width:1080,height:1350},{hash:b,url:'https://scontent.fbcdn.net/other.jpg'},{hash:a,url:'https://evil.test/image.jpg'}]})};
  }});
  assert.equal(images.length, 1); assert.equal(images[0].width, 1080);
});
test('account results retain variant-level metrics and window without stale AI analysis', async () => {
  const sql = async strings => strings.join('').includes('AS through') ? [{since:'2026-08-01',through:'2026-08-30'}] : [
    {variant_key:'one',name:'Static',ad_ids:['1','2'],spend:200,purchases:4,purchase_value:800,observed_days:12,definition:{image_hash:a},analysis:'stale'},
    {variant_key:'video',spend:100,definition:{thumbnail_url:'video.jpg'}},
  ];
  const data = await accountReferenceRows(sql);
  assert.equal(data.variants.length,1); assert.equal(data.variants[0].roas,4);
  assert.deepEqual(data.variants[0].adIds,['1','2']); assert.equal(data.variants[0].analysis,undefined);
  assert.equal(data.window.through,'2026-08-30');
});
