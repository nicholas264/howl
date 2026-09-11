export function reviewProduct(value) {
  const key = String(value || '').toLowerCase().replace(/^https?:\/\/[^/]+\/products\//, '').replace(/^(the-)?howl-/, '').replace(/[^a-z0-9]/g, '');
  return ['r1', 'r3', 'r4mkii'].includes(key) ? key : null;
}

// A variant is one review/background combination, shared by both placements.
export function reviewAdVariants(reviews, images, mode) {
  const backgrounds = [...new Set(images.filter(Boolean))];
  const selected = backgrounds.length ? (mode === 'rotate' || mode === 'cycle' ? backgrounds : backgrounds.slice(0, 1)) : [null];
  return reviews.flatMap((review, reviewIndex) => (mode === 'cycle' ? [backgrounds[reviewIndex % backgrounds.length] || null] : selected).map((backgroundImage, imageIndex) => ({
    key: `${review.id}:${imageIndex}`, review, backgroundImage, imageIndex: mode === 'cycle' ? Math.max(0, backgrounds.indexOf(backgroundImage)) : imageIndex,
  })));
}

export async function addReviewAdPairs(variants, render, save, onProgress = () => {}) {
  let saved = 0;
  for (const variant of variants) {
    onProgress(saved, variants.length);
    const renders = await render(variant, ['square', 'story']);
    if (!renders.square || !renders.story) throw new Error('Both 4:5 and 9:16 must render before saving this ad.');
    const review = variant.review;
    await save({
      id: crypto.randomUUID(), type: 'static',
      ...(reviewProduct(review.handle) ? { product: reviewProduct(review.handle) } : {}),
      squareUrl: renders.square, storyUrl: renders.story,
      name: `HOWL | Review | ${review.nickname || review.handle || 'Customer'} | Image ${variant.imageIndex + 1} | ${String(review.id)}`,
      hook: (review.quote || '').slice(0, 80).trim(), body: '',
    });
    onProgress(++saved, variants.length);
  }
  return saved;
}
