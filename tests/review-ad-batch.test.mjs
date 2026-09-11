import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewAdVariants, addReviewAdPairs } from '../src/lib/review-ad-batch.js';

const reviews = [{ id: 'one', quote: 'First review', nickname: 'A' }, { id: 'two', quote: 'Second review', nickname: 'B' }];
test('every-image mode produces each review/image combination exactly once', () => {
  const variants = reviewAdVariants(reviews, ['a.jpg', 'b.jpg', 'a.jpg'], 'rotate');
  assert.deepEqual(variants.map(v => [v.review.id, v.backgroundImage]), [['one','a.jpg'],['one','b.jpg'],['two','a.jpg'],['two','b.jpg']]);
  assert.equal(new Set(variants.map(v => v.key)).size, 4);
  assert.equal(reviewAdVariants(reviews, ['a.jpg','b.jpg'], 'single').length, 2);
  assert.deepEqual(reviewAdVariants(reviews, [], 'rotate').map(v => v.backgroundImage), [null,null]);
  assert.deepEqual(reviewAdVariants([], ['a.jpg'], 'rotate'), []);
});

test('both placements retain the same review and image and save as a single awaited launcher item', async () => {
  const variants = reviewAdVariants(reviews, ['a.jpg','b.jpg'], 'rotate');
  const saved = [], progress = [];
  let saving = false;
  const count = await addReviewAdPairs(variants, async (v, formats) => {
    assert.equal(saving, false, 'must await saving before rendering the next pair');
    assert.deepEqual(formats, ['square','story']);
    return Object.fromEntries(formats.map(f => [f, `${v.review.quote}|${v.backgroundImage}|${f}`]));
  }, async item => {
    saving = true;
    await new Promise(resolve => setTimeout(resolve, 2));
    saved.push(item); saving = false;
  }, (n, total) => progress.push([n,total]));
  assert.equal(count, 4); assert.equal(saved.length, 4);
  assert.equal(new Set(saved.map(item => item.id)).size, 4);
  for (const item of saved) {
    assert.equal(item.squareUrl.replace('|square',''), item.storyUrl.replace('|story',''));
    assert.equal(item.type, 'static');
  }
  assert.deepEqual(progress.at(-1), [4,4]);
});

test('an incomplete pair is never saved and a persistence failure stops the batch', async () => {
  const variants = reviewAdVariants(reviews, ['a.jpg'], 'single');
  let saves = 0, renders = 0;
  await assert.rejects(addReviewAdPairs(variants, async () => ({square:'feed'}), async () => saves++), /Both 4:5 and 9:16/);
  assert.equal(saves, 0);
  await assert.rejects(addReviewAdPairs(variants, async () => { renders++; return {square:'feed',story:'story'}; }, async () => { throw new Error('Storage unavailable'); }), /Storage unavailable/);
  assert.equal(renders, 1);
});

test('cycle mode distributes backgrounds in order without multiplying the batch', () => {
  const many = Array.from({length:5}, (_,i)=>({id:String(i),handle:'r1',quote:`Review ${i}`}));
  const variants=reviewAdVariants(many,['a.jpg','b.jpg'],'cycle');
  assert.deepEqual(variants.map(v=>v.backgroundImage),['a.jpg','b.jpg','a.jpg','b.jpg','a.jpg']);
  assert.deepEqual(variants.map(v=>v.imageIndex),[0,1,0,1,0]);
  assert.equal(variants.length,5);
});

import {reviewProduct} from '../src/lib/review-ad-batch.js';
test('Loox product handles normalize to the launcher product without guessing unknown products', async () => {
  for(const [input,expected] of [['the-howl-r1','r1'],['r3','r3'],['r4-mkii','r4mkii'],['https://howlcampfires.com/products/the-howl-r4mkii','r4mkii'],['camping-bundle',null]])assert.equal(reviewProduct(input),expected);
  const saved=[];
  await addReviewAdPairs(reviewAdVariants([{id:'r4-review',handle:'r4-mkii',quote:'Warm'}],['photo'],'cycle'),async()=>({square:'feed',story:'story'}),async item=>saved.push(item));
  assert.equal(saved[0].product,'r4mkii');
});
